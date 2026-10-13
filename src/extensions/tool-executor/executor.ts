import type { ExtensionRegistry } from "../registry";
import type { ExtensionProcess } from "../subprocess";
import { verifyInvocationLocks, type InvocationGuard } from "../runtime-locks";
import type { ToolCallResult, JsonRpcRequest, JsonRpcResponse } from "../types";
import type { ExtensionStateMediator } from "../state-mediator";
import { getStateMediator } from "../state-mediator";
import type { EventBus } from "../../runtime/events";
import type { AgentEvents } from "../../types";
import type { AgentExecutor } from "../../runtime/executor";
import type { PendingPermissionInfo } from "../../runtime/stream-chat/host";
import { resolveSharedVariables } from "../shared-variables";
import type { FsRpcResponse } from "../fs-handler";
import { getUserById } from "../../db/queries/users";
import { getDb, type DbTransaction } from "../../db/connection";
import type { StorageDatabase } from "../../db/queries/extension-storage";
import { hasExtensionScope } from "../../auth/extension-rbac";
import type { ScheduleDaemon } from "../schedule-daemon";
import type { SpawnQuota } from "../spawn-quota";
import { getConversation } from "../../db/queries/conversations";
import { getProject } from "../../db/queries/projects";
import { emitPersistedDomainEvent, type DomainExtensionEvent } from "../domain-event-outbox";
import { persistToolCall } from "../../db/queries/tool-calls";
import { resolveExtensionSettings } from "../../db/queries/extension-settings";
import type { Decision, PermissionEngine } from "../permission-engine";
import { capabilityDeclarationToSet, type Capability, type CapabilitySet, type SensitiveCapabilityKind } from "../capability-types";
import { getRuntimeToolContext, withRuntimeToolContext } from "../runtime-tool-context";
import { isSealedServiceInvocation, type ServiceInvocation } from "../service-invocation";
import {
  createExtensionPermissionGate,
  type ApprovalResolution,
} from "../../runtime/tools/permissions";
import { LONG_BLOCKING_ORCHESTRATION_TOOLS } from "../../runtime/tools/filter";
import { buildEntityToolHandlers } from "@ezcorp/sdk/entities";
import { createHostEntityStore } from "../entities/host-store";
import { redactLargeDataUris } from "../audit-redaction";
import { logger } from "../../logger";
import {
  registerCallProvenance,
  releaseCallProvenance,
} from "../call-provenance";

// ── extracted sibling modules ──────────────────────────────────────────
import {
  MAX_TOOL_CALLS_PER_TURN,
  MaxToolCallsExceededError,
  toolCallsThisTurn,
  wireMaxToolCallsCounter,
} from "./limits";
import { dispatchReverseRpcWithTimeout } from "./reverse-rpc-timeout";
import { handleHostApi } from "../host-api-broker";
import { handleProjectPullRequest } from "../project-pr-broker";
import { handleProjectGit } from "../project-git-broker";
import { handleProjectPullRequestReview } from "../project-pull-request-broker";
import { handleNetworkBroker } from "../network-broker";
import { handleNetworkTunnel } from "../network-tunnel-broker";
import { handleCredentialBroker } from "../credential-broker";
import { PermissionDeniedError, type ArgsResolver, type ToolExecutorOptions } from "./errors";
import { resolveReverseRpcMeta as provResolveReverseRpcMeta } from "./provenance";
import {
  handlePiFs as fsHandlePiFs,
  handlePiFsRead as fsHandlePiFsRead,
  handlePiFsWrite as fsHandlePiFsWrite,
  handlePiFsList as fsHandlePiFsList,
  handlePiFsStat as fsHandlePiFsStat,
  handlePiFsExists as fsHandlePiFsExists,
  handlePiFsMkdir as fsHandlePiFsMkdir,
  handlePiFsUnlink as fsHandlePiFsUnlink,
  type FsRpcDeps,
} from "./fs-rpc";
import { handlePiInvoke as rpcHandlePiInvoke, type InvokeHost } from "./invoke";
import {
  routeReverseRpc,
  handlePiStorage as rpcHandlePiStorage,
  handlePiAgentConfigs as rpcHandlePiAgentConfigs,
  handlePiEmitTaskEvent as rpcHandlePiEmitTaskEvent,
  handlePiEmitLoopEvent as rpcHandlePiEmitLoopEvent,
  handlePiSpawnAssignment as rpcHandlePiSpawnAssignment,
  handlePiCancelRun as rpcHandlePiCancelRun,
  handlePiQueueAgentMessage as rpcHandlePiQueueAgentMessage,
  handlePiNetworkInternal as rpcHandlePiNetworkInternal,
  handlePiLlmComplete as rpcHandlePiLlmComplete,
  handlePiMemory as rpcHandlePiMemory,
  handlePiLessons as rpcHandlePiLessons,
  handlePiSearch as rpcHandlePiSearch,
  handlePiSchedule as rpcHandlePiSchedule,
  handlePiDrafts as rpcHandlePiDrafts,
  handlePiWorkflows as rpcHandlePiWorkflows,
  handlePiWorkflowsDelegated as rpcHandlePiWorkflowsDelegated,
  handlePiTriggers as rpcHandlePiTriggers,
  handlePiGithubProjects as rpcHandlePiGithubProjects,
  handlePiRbacCheck as rpcHandlePiRbacCheck,
  handlePiAppendMessage as rpcHandlePiAppendMessage,
  handlePiFinalizeToolCall as rpcHandlePiFinalizeToolCall,
  type RpcHandlerDeps,
} from "./rpc-handlers";

const log = logger.child("ext.tool-executor");

/** Per-call options of {@link ToolExecutor.executeToolCall}. */
interface ExecuteToolCallOpts {
  callerExtensionId?: string;
  expectedReleaseBinding?: string;
  signal?: AbortSignal;
  invocationGuard?: InvocationGuard;
  serviceInvocation?: ServiceInvocation;
  _callDepth?: number;
  metadata?: { invocationId?: string; source?: "inline" | "agent-run" };
  /** Phase 4: caller∩callee intersected cap set for cross-ext invokes. */
  capContext?: CapabilitySet;
  /** Phase 1: parent audit row for the chain — set by `handlePiInvoke` etc. */
  parentAuditId?: string;
}

/** What the PDP gate and the sensitive prompt need to know about one call. */
interface SensitivePromptCall {
  toolName: string;
  originalName: string;
  extensionId: string;
  conversationId: string;
  messageId: string | null;
  input: Record<string, unknown>;
  registered: NonNullable<ReturnType<ExtensionRegistry["getRegisteredTool"]>>;
  meta: ExecuteToolCallOpts["metadata"];
  signal: AbortSignal | undefined;
  /** Idempotent `tool:start` emitter shared with the dispatch path. */
  emitToolStart: (timestamp: number) => void;
}

/** Count one tool call against the conversation's per-turn budget. */
function chargeTurnToolCall(conversationId: string): void {
  if (conversationId && conversationId !== "cross-ext") {
    const next = (toolCallsThisTurn.get(conversationId) ?? 0) + 1;
    if (next > MAX_TOOL_CALLS_PER_TURN) {
      throw new MaxToolCallsExceededError(conversationId, next);
    }
    toolCallsThisTurn.set(conversationId, next);
  }
}

export class ToolExecutor {
  private bus?: EventBus<AgentEvents>;
  private stateMediator?: ExtensionStateMediator;
  // Tracks which subprocess INSTANCES have had their reverse-RPC
  // request handler wired. MUST be keyed by the ExtensionProcess
  // instance, NOT by extensionId: the registry replaces a dead /
  // idle-killed / crashed subprocess with a brand-new ExtensionProcess
  // object for the same extensionId (registry.ts getProcess). An
  // extensionId-keyed Set would early-return and skip
  // `setRequestHandler` on the new instance, leaving its
  // `transport.onRequest` null — every reverse-RPC the respawned child
  // makes is then silently dropped and its `tools/call` hangs until the
  // 90s watchdog (the "stuck chat" defect). A WeakSet keyed by the proc
  // object re-wires each fresh instance and lets GC'd corpses drop.
  private wiredProcs = new WeakSet<ExtensionProcess>();
  private currentUserId?: string;
  private currentConversationId?: string;
  private currentModel?: string;
  private currentProvider?: string;
  private currentAgentConfigId?: string;
  private executor?: AgentExecutor;
  private spawnQuota?: SpawnQuota;
  private scheduleDaemon?: ScheduleDaemon;
  private argsResolver?: ArgsResolver;
  // Watchdog visibility for the extension sensitive-cap PDP-prompt gate.
  // Built-in tool gates register in the executor's `pendingPermissions`
  // map directly (setup-tools.ts); the extension gate must too, or the
  // watchdog mis-reads a user-blocked prompt as a hung in-flight tool
  // and kills the run at the callTimeoutMs ceiling (the "stuck chat"
  // defect). No-op until wired so unit tests / non-streamChat callers
  // are unaffected.
  private registerPendingPermission: (key: string, info: PendingPermissionInfo) => void = () => {};
  private deregisterPendingPermission: (key: string) => void = () => {};
  /** Phase 53.7 — see ToolExecutorOptions.eventDriven. */
  private readonly eventDriven: boolean;

  constructor(
    private registry: ExtensionRegistry,
    private engine: PermissionEngine,
    options?: ToolExecutorOptions,
  ) {
    if (!engine) {
      throw new Error(
        "ToolExecutor requires a PermissionEngine (Phase 1 fail-closed contract)",
      );
    }
    this.bus = options?.bus;
    this.eventDriven = options?.eventDriven === true;
    // Phase 6 (M3): reset the per-turn counter on run:complete/cancel/error.
    // Idempotent module-level wiring — see wireMaxToolCallsCounter (limits.ts).
    if (this.bus) wireMaxToolCallsCounter(this.bus);
  }

  /** Set the state mediator for routing extension notifications. */
  setStateMediator(mediator: ExtensionStateMediator): void {
    this.stateMediator = mediator;
  }

  /** Set the current user ID for storage scope resolution. */
  setCurrentUserId(userId: string): void {
    this.currentUserId = userId;
  }

  /** Set the current conversation ID. Production code wires this via
   *  `executeToolCall` (line 599); this setter exists primarily for
   *  tests that need to pin the conversation id without dispatching a
   *  real tool call (e.g. the SEC-03 per-conversation depth tests). */
  setCurrentConversationId(conversationId: string | null | undefined): void {
    this.currentConversationId = conversationId ?? undefined;
  }

  /** Set the calling conversation's model + provider so bundled extensions
   *  (ai-kit) can inherit them when spawning sibling conversations. This
   *  is ONLY a default — the LLM's explicit `model` / `provider` args
   *  always win over these values at the ai-kit client layer. */
  setCurrentModel(model: string | null | undefined): void {
    this.currentModel = model ?? undefined;
  }

  /** Set the calling agent's config id so tool_calls rows carry it for
   *  admin analytics. `null`/`undefined` clear it (top-level chat with no
   *  bound agent). */
  setCurrentAgentConfigId(agentConfigId: string | null | undefined): void {
    this.currentAgentConfigId = agentConfigId ?? undefined;
  }

  setCurrentProvider(provider: string | null | undefined): void {
    this.currentProvider = provider ?? undefined;
  }

  /** Wire the owning AgentExecutor so `ezcorp/spawn-assignment` can call
   *  `startAssignment`, which in turn calls back into `executor.streamChat`. */
  setExecutor(executor: AgentExecutor): void {
    this.executor = executor;
  }

  /** Wire the shared spawn-quota tracker. One instance lives on the
   *  AgentExecutor; every ToolExecutor in the same process shares it
   *  so hourly/concurrent caps apply across all of a user's turns. */
  setSpawnQuota(quota: SpawnQuota): void {
    this.spawnQuota = quota;
  }

  /** Wire the shared ScheduleDaemon so `ctx.schedule.fireNow()` can
   *  share its quota counters + dispatch path. The daemon is owned by
   *  `src/startup/background-timers.ts`; this setter lets the same
   *  instance be threaded into every ToolExecutor in the process. */
  setScheduleDaemon(daemon: ScheduleDaemon): void {
    this.scheduleDaemon = daemon;
  }

  /** Register a pre-call transformer for tool args. Used to substitute
   *  symbolic references (e.g. `ez-attachment://<id>` handles) with their
   *  concrete values before the extension subprocess receives them. */
  setArgsResolver(fn: ArgsResolver): void {
    this.argsResolver = fn;
  }

  /** Wire the executor's `pendingPermissions` map (the watchdog's only
   *  signal for "a run is legitimately waiting on the user, don't kill
   *  it"). The built-in tool path registers there directly in
   *  setup-tools.ts; the extension sensitive-cap PDP-prompt gate must
   *  too — otherwise the watchdog mis-classifies a user-blocked prompt
   *  as a hung in-flight tool and kills the run at the 90s callTimeoutMs
   *  ceiling with a misleading reason (the "stuck chat" defect). No-op
   *  by default so unit tests and non-streamChat callers are
   *  unaffected. */
  setPendingPermissionGate(
    register: (key: string, info: PendingPermissionInfo) => void,
    deregister: (key: string) => void,
  ): void {
    this.registerPendingPermission = register;
    this.deregisterPendingPermission = deregister;
  }

  /** Service-invocation identity, abort and invocation-guard checks that
   *  run before the tool is even looked up. */
  private async assertCallPreconditions(
    serviceInvocation: ServiceInvocation | undefined,
    opts: ExecuteToolCallOpts | undefined,
  ): Promise<void> {
    if (serviceInvocation) {
      if (!isSealedServiceInvocation(serviceInvocation) || this.currentUserId) throw new Error("Service invocation cannot use a human identity or an unsealed host origin");
      await serviceInvocation.assertActive();
    }
    opts?.signal?.throwIfAborted();
    if (opts?.invocationGuard) await opts.invocationGuard();
    opts?.signal?.throwIfAborted();
  }

  /** Service-capability or extension-RBAC gate (see the call site). Returns
   *  the invocation guard the dispatch re-checks under its transaction and
   *  the service target release binding. */
  private async authorizeInvocationScope(a: {
    serviceInvocation: ServiceInvocation | undefined;
    extensionId: string;
    toolName: string;
    conversationId: string;
    needed: Capability[];
    requiredScope: string | undefined;
    manifestName: string | undefined;
    opts: ExecuteToolCallOpts | undefined;
  }): Promise<{ invocationGuard: InvocationGuard | undefined; serviceTargetBinding: string | undefined }> {
    const { serviceInvocation, extensionId, toolName, conversationId, needed, requiredScope, opts } = a;
    let serviceTargetBinding: string | undefined;
    if (serviceInvocation) {
      const { assertServiceCapabilities } = await import("../service-capabilities");
      serviceTargetBinding = await assertServiceCapabilities(serviceInvocation, extensionId, needed, { toolName, rbacScope: requiredScope });
      if (opts?.expectedReleaseBinding !== undefined && opts.expectedReleaseBinding !== serviceTargetBinding) throw new Error("Service target does not match the expected release");
    } else if (requiredScope) {
      const scopeGranted = await this.resolveExtensionScopeGrant(
        a.manifestName ?? extensionId,
        requiredScope,
        this.currentUserId ?? null,
        conversationId ?? null,
      );
      if (!scopeGranted) {
        throw new PermissionDeniedError(
          extensionId,
          toolName,
          `requires extension RBAC scope '${requiredScope}'`,
        );
      }
    }
    const invocationGuard: InvocationGuard | undefined = serviceInvocation ? async database => {
      await opts?.invocationGuard?.(database);
      const { assertServiceCapabilities } = await import("../service-capabilities");
      const current = await assertServiceCapabilities(serviceInvocation, extensionId, needed, { toolName, rbacScope: requiredScope, database });
      if (current !== serviceTargetBinding) throw new Error("Service target release changed during invocation");
    } : opts?.invocationGuard;
    return { invocationGuard, serviceTargetBinding };
  }

  /** Inject the mandatory one-shot approval caps for the bundled
   *  extension-author's install / modify tools. */
  private addAuthorApprovalCaps(
    needed: Capability[],
    originalName: string,
    manifestName: string | undefined,
    extensionId: string,
  ): void {
    if (manifestName !== "extension-author" || this.registry.isBundled?.(extensionId) !== true) return;
    // Mandatory in-chat approval for agent-driven extension install.
    // The bundled `extension-author.install_draft` tool installs
    // model-authored code that then runs with its declared
    // permissions — the strongest trust boundary in the system. We
    // inject the sensitive `ezcorp:extension:install` cap into the
    // needed set HERE (rather than via the manifest CapabilityDeclaration
    // machinery) so the existing watchdog-bounded sensitive-cap gate
    // fires at tool-call start: the PDP subset check passes
    // (extension-author is granted it via `custom.drafts.kinds`), it's
    // sensitive + carved out of the bundled auto-allow + never
    // persisted, so it ALWAYS prompts. Approve → tool body runs the
    // `ezcorp/drafts.install` RPC; Deny → PermissionDeniedError, nothing
    // installed. Scoped to the bundled extension-author so a
    // user-installed look-alike can't reach this path.
    if (originalName === "install_draft") {
      // Boolean cap (no value) — like `shell`. The granted side
      // (`grantsToCapabilitySet` from `custom.drafts.kinds`) is also
      // valueless, so the subset check passes (a valued needed cap
      // would FAIL `capabilityCovers` against the valueless grant).
      // The specific draftId is already audited via the tool input.
      needed.push({ kind: "ezcorp:extension:install" });
    }

    // Mandatory in-chat approval for agent-driven extension MODIFY.
    // The bundled `extension-author.modify_extension` tool re-opens an
    // installed extension for editing — the entry point to rewriting
    // model-authored code. Same trust class and injection rationale as
    // `install_draft` above: sensitive, carved out of the bundled
    // auto-allow, never persisted → ALWAYS prompts. The host
    // `ezcorp/drafts.reopen` action independently enforces owner +
    // admin-`modifiable` + not-bundled authorization (defense in
    // depth). Scoped to the bundled extension-author so a user-
    // installed look-alike can't reach this path.
    if (originalName === "modify_extension") {
      needed.push({ kind: "ezcorp:extension:modify" });
    }
  }

  /** Run the PDP, then ask the user for each sensitive cap it prompts
   *  for, re-authorizing after every approval until it allows or denies. */
  private async authorizeWithPrompts(
    call: SensitivePromptCall,
    needed: Capability[],
    ctx: {
      serviceInvocation: ServiceInvocation | undefined;
      callerExtensionId: string | undefined;
      capContext: CapabilitySet | undefined;
      parentAuditId: string | undefined;
    },
  ): Promise<Decision> {
    const { extensionId, toolName, originalName, conversationId } = call;
    // Explicit `Decision` (not `typeof this.engine.authorize`): the
    // `typeof this` type query is fragile under the backend-only tsc
    // graph (a new drafts-handler→author-install→registry import edge
    // exposed a resolution cycle that made `this` unresolvable here).
    // `engine.authorize` returns `Promise<Decision>`, so this is
    // semantically identical and graph-independent.
    let decision: Decision;
    // Re-authorize after each approved prompt: one call can need several
    // sensitive caps, and approving one must never carry the others.
    const promptApproved: Capability[] = [];
    for (;;) {
      try {
        decision = await this.engine.authorize(
          {
            extensionId,
            // Phase 6: null is the canonical "no user" signal — the
            // PDP serializes it as JSON null in the audit row instead
            // of the literal string "unknown".
            userId: this.currentUserId ?? null,
            serviceInvocation: ctx.serviceInvocation,
            conversationId: conversationId ?? null,
            toolName: originalName,
            callerExtensionId: ctx.callerExtensionId,
            capContext: ctx.capContext,
            ...(ctx.parentAuditId !== undefined ? { parentAuditId: ctx.parentAuditId } : {}),
            ...(promptApproved.length > 0 ? { promptApproved } : {}),
          },
          needed,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new PermissionDeniedError(
          extensionId,
          toolName,
          `engine error: ${msg}`,
        );
      }

      if (decision.decision === "deny") {
        throw new PermissionDeniedError(extensionId, toolName, decision.reason);
      }
      if (decision.decision !== "prompt") return decision;
      await this.awaitSensitivePrompt(call, decision);
      promptApproved.push(decision.sensitive);
    }
  }

  /** The always-allow row key for the scope the user picked. */
  private alwaysAllowScopeId(scope: string, conversationId: string): string {
    // Project scopeId resolution is deferred — for a `project` scope we use
    // the conversationId as a stable key for now; a future commit can map
    // conversation→project when the PDP gains project-aware lookups (the
    // cache key already accommodates it). Comment lifted out of the ternary
    // branch below so bun doesn't emit a phantom, never-hit DA record on an
    // in-ternary comment line (which the per-file gate can't clear).
    return scope === "conversation"
      ? conversationId
      : scope === "session"
        ? `session:${this.currentUserId ?? ""}`
        : scope === "project"
          ? conversationId
          : "*";
  }

  /** Phase 6 sensitive-cap UI gate for one `prompt` decision: show the
   *  card and the prompt, await the user, and persist an approval. Throws
   *  PermissionDeniedError on decline or gate failure. */
  private async awaitSensitivePrompt(
    call: SensitivePromptCall,
    decision: Extract<Decision, { decision: "prompt" }>,
  ): Promise<void> {
    const { toolName, originalName, extensionId, conversationId, messageId, input, registered, meta } = call;
    // Phase 6 — sensitive-cap UI gate. The PDP returned a `prompt`
    // decision (every needed cap is granted, but a sensitive cap
    // — `shell` or `fs.write` — lacks an always-allow row for the
    // (user, scope, scopeId, capability) tuple). We open an
    // extension-scoped permission gate, emit `tool:permission_request`
    // for the originating user's UI, and AWAIT the user's
    // `{allowed, scope}` decision. The user's chosen scope is
    // persisted via `setSensitiveAlwaysAllow` so the next call to
    // the same sensitive cap inside the same scope auto-allows.
    //
    // The PDP path also wrote a `PERM_PROMPTED` audit row before
    // returning; we don't write a second row here. On user decline
    // we throw `PermissionDeniedError` to mirror the deny path.
    const sensitive = decision.sensitive;
    // The PDP prompts only for a SENSITIVE_KINDS cap. Name it as-is:
    // the user must see an install, not a generic file write.
    const capabilityKind = sensitive.kind as SensitiveCapabilityKind;

    const promptStartedAt = Date.now();
    // Terminalize the (now visible) tool card on any prompt-branch
    // failure — deny, gate transport error, or resolvePrompt error.
    // Without this the card we just rendered would hang forever even
    // though the call rejects. Uses the same namespaced `toolName` as
    // tool:start so the store correlates it to the same card.
    const terminalizePromptCard = async (message: string): Promise<void> => {
      const errorResult: ToolCallResult = {
        content: [{ type: "text", text: message }],
        isError: true,
      };
      const toolEvent: DomainExtensionEvent = { id: crypto.randomUUID(), type: "tool:error", conversationId, payload: {
        conversationId,
        extensionId,
        toolName,
        error: message,
        duration: Date.now() - promptStartedAt,
        ...(registered.cardType && { cardType: registered.cardType }),
        ...(registered.cardLayout && { cardLayout: registered.cardLayout }),
        ...(meta?.source && { source: meta.source }),
        ...(meta?.invocationId && { invocationId: meta.invocationId }),
      } };
      await this.recordToolCall(
        conversationId,
        messageId,
        extensionId,
        toolName,
        input,
        errorResult,
        promptStartedAt,
        registered.cardType,
        registered.cardLayout,
        toolEvent,
      );
      emitPersistedDomainEvent(this.bus, toolEvent);
    };

    // Emit tool:start FIRST so the card + tool_ref block exist before
    // the prompt arrives. Same (namespaced) `toolName` the
    // start/complete/error events use — previously this emitted
    // `originalName`, which never matched the namespaced tool:start
    // entry in the store, so even a rendered card wouldn't correlate.
    call.emitToolStart(promptStartedAt);

    // Surface the prompt to the originating user's UI session only.
    // `userId` is the H7-scoped delivery key — the SSE filter at
    // `sse-conversation-filter.ts:shouldDeliverEvent` enforces that
    // only the matching subscriber sees the event.
    this.bus?.emit("tool:permission_request", {
      conversationId,
      toolCallId: decision.promptId,
      toolName,
      input,
      userId: this.currentUserId,
      extensionId,
      capabilityKind,
      ...(sensitive.value !== undefined ? { capabilityValue: sensitive.value } : {}),
      promptId: decision.promptId,
    });

    // Make this gate visible to the watchdog as a legitimate
    // user-wait, exactly like the built-in tool path
    // (setup-tools.ts). Keyed by `decision.promptId` — the same key
    // `createExtensionPermissionGate` and the resolve route use, so
    // register/deregister stay aligned with no toolCallId↔promptId
    // skew. Without this the watchdog treats the wait as a hung
    // in-flight tool and kills the run at the callTimeoutMs ceiling,
    // tearing down the prompt before the user can answer it.
    this.registerPendingPermission(decision.promptId, {
      conversationId,
      toolCallId: decision.promptId,
      toolName: originalName,
      input,
      category: "extension-sensitive",
    });

    let resolution: ApprovalResolution;
    try {
      resolution = await createExtensionPermissionGate({
        ...(call.signal ? { signal: call.signal } : {}),
        promptId: decision.promptId,
        conversationId,
        userId: this.currentUserId ?? "",
        extensionId,
        toolName: originalName,
        capabilityKind,
        ...(sensitive.value !== undefined ? { capabilityValue: sensitive.value } : {}),
      });
    } catch (err) {
      // The gate's promise resolves with `{allowed: false}` on
      // decline; reaching the catch arm means a transport-level
      // failure (e.g. server restart). Treat as deny.
      const msg = err instanceof Error ? err.message : String(err);
      await terminalizePromptCard(`permission gate error: ${msg}`);
      throw new PermissionDeniedError(
        extensionId,
        toolName,
        `permission gate error: ${msg}`,
      );
    } finally {
      // Runs on every exit — gate resolved (allow/deny), gate threw
      // (catch above), or any unexpected throw. Race-safe: the key is
      // the immutable `decision.promptId`. Symmetric with the
      // built-in path's `finally` deregister (setup-tools.ts).
      this.deregisterPendingPermission(decision.promptId);
    }

    if (!resolution.allowed) {
      await terminalizePromptCard("User declined permission prompt");
      throw new PermissionDeniedError(
        extensionId,
        toolName,
        "User declined permission prompt",
      );
    }

    // Persist always-allow at the user-chosen scope (default session
    // — least surprise; the gate falls back to "session" when no
    // scope is supplied, matching the spec's locked default).
    //
    // `engine.resolvePrompt` is the single source of truth: it writes
    // the always-allow settings row AND updates the engine's in-memory
    // allow cache so the next call to the same sensitive cap in the
    // same scope auto-allows. A previous version of this code ALSO
    // called `setSensitiveAlwaysAllow` directly here, which wrote a
    // second row under a different key shape (kind-only vs kind+value)
    // — the reader's lookup never found the legacy row, so users
    // hitting Allow Forever still re-prompted on every subsequent
    // call. Collapsed to one writer to make the asymmetry impossible.
    const scope = resolution.scope ?? "session";
    const scopeId = this.alwaysAllowScopeId(scope, conversationId);
    // Phase 56: forward the picker's `ttlOverrideMs` (when supplied)
    // so the engine persists the per-row override alongside the
    // always-allow row. `undefined` here means the user hit Allow
    // via a legacy path (pre-Phase-56 client) — engine falls back
    // to the existing TTL_CONFIG[kind] / foreverTtlMs lookup.
    const resolvePromptOptions =
      resolution.ttlOverrideMs !== undefined
        ? { ttlOverrideMs: resolution.ttlOverrideMs }
        : undefined;
    try {
      await this.engine.resolvePrompt(
        decision.promptId,
        true,
        scope,
        scopeId,
        resolvePromptOptions,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await terminalizePromptCard(`permission persist error: ${msg}`);
      throw err;
    }
  }

  /** Execute a tool call through the extension subprocess.
   *
   *  `invocationMetadata` (Phase 4 §5.1a) is opaque per-turn data threaded
   *  onto the JSON-RPC `_meta` channel alongside `params`. Subprocess
   *  handlers surface it on the tool-handler ctx as `invocationMetadata`
   *  — the orchestration extension uses it to receive overrides /
   *  teamToolScope / parentMessageId bound by the host at
   *  wire-orchestration-tools-for-turn time. */
  async executeToolCall(
    toolName: string,
    input: Record<string, unknown>,
    conversationId: string,
    messageId: string | null,
    _opts?: ExecuteToolCallOpts,
    invocationMetadata?: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    const serviceInvocation = _opts?.serviceInvocation ?? getRuntimeToolContext()?.serviceInvocation;
    // Awaited only when there is something to check, so a plain call reaches
    // the PDP in the same number of microtasks as before the split.
    if (serviceInvocation || _opts?.invocationGuard) await this.assertCallPreconditions(serviceInvocation, _opts);
    else _opts?.signal?.throwIfAborted();
    const registered = this.registry.getRegisteredTool(toolName);
    if (!registered) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    const extensionId = registered.extensionId;
    const originalName = registered.originalName;

    // `tool:start` MUST precede any `tool:permission_request` so the
    // streaming UI has a `tool_ref` block to anchor the PermissionGate
    // card to. The built-in path already does this (subscribe-bridge
    // emits tool:start at tool_execution_start, before its gate);
    // emitting it only AFTER the gate (the old extension behavior) made
    // a sensitive-cap prompt (e.g. extension-author.create_extension's
    // fs.write) invisible — no card, no Allow button, and the watchdog
    // suspended by the pending-permission registration → a permanent
    // "generating extension" with no error. One idempotent emitter,
    // shared by the prompt branch and the normal post-gate path; the
    // flag prevents a double-emit (which would render two cards).
    const meta = _opts?.metadata;
    let toolStartEmitted = false;
    const emitToolStart = (timestamp: number): void => {
      if (toolStartEmitted) return;
      toolStartEmitted = true;
      this.bus?.emit("tool:start", {
        conversationId,
        extensionId,
        toolName,
        // `input` is read at CALL time — after the args resolver has
        // substituted attachment handles with real `data:` URIs. Redact
        // large base64 payloads at the emit boundary so SSE consumers
        // never carry multi-MB frames; execution below still uses the
        // unredacted resolved input.
        input: redactLargeDataUris(input),
        timestamp,
        ...(registered.cardType && { cardType: registered.cardType }),
        ...(registered.cardLayout && { cardLayout: registered.cardLayout }),
        ...(meta?.source && { source: meta.source }),
        ...(meta?.invocationId && { invocationId: meta.invocationId }),
      });
    };

    // Phase 6 (M3) — per-conversation per-turn tool-call cap. Increment
    // BEFORE the PDP gate so a denied call still counts against the
    // budget; this prevents an attacker who keeps tripping deny from
    // exhausting the engine and stalling the turn. The bus listener in
    // the constructor resets the counter on `run:complete`/`:cancel`/
    // `:error`. Cross-ext synthetic ids (`"cross-ext"` from the legacy
    // `handlePiInvoke` path — replaced with the real parent
    // conversationId in the same Phase 6 commit, see M4) DON'T count
    // against the budget so their nested calls don't double-charge the
    // parent's quota.
    chargeTurnToolCall(conversationId);

    // Resolve symbolic arg references (e.g. attachment handles → data URIs)
    // BEFORE the PDP check. The post-resolved args are what the
    // subprocess actually receives, so the PDP sees the same shape it
    // is enforcing on. (Closes finding C5: pre-resolver schemes like
    // `ez-attachment://` cannot launder into `file://` because the PDP
    // gate runs after the resolver.)
    if (this.argsResolver) {
      input = await this.argsResolver(input);
    }

    // Compute the tool's required capability set from its manifest
    // declaration.
    //
    // Which loader put the declaration there depends on where the manifest
    // came from, and BOTH paths matter — a manifest that reaches here without
    // one authorizes against an EMPTY needed set, which `firstMissingCapability`
    // can never fail, i.e. the PDP is inert for that tool:
    //   • disk extensions — `loader.ts` runs `migrateManifestV2ToV3`, which
    //     inherits the extension-wide `permissions` onto every tool, and the
    //     installer persists that migrated manifest.
    //   • `kind: "mcp"` rows — synthesized straight into the DB by
    //     `installMcpExtension`, so they NEVER see that migration. The
    //     registry normalizes them on read instead
    //     (`mcp-capabilities.ts:normalizeMcpManifest`), deriving each tool's
    //     declaration from the hosts the server definition names.
    const manifest = this.registry.getManifest(extensionId);
    const tool = manifest?.tools?.find((t) => t.name === originalName);
    const needed: Capability[] = [
      ...capabilityDeclarationToSet(tool?.capabilities, input, this.currentUserId),
    ];

    // Extension-RBAC (user→extension) ENFORCEMENT gate. When the tool's
    // manifest DECLARES an `rbacScope`, the acting user MUST hold it — the
    // host resolves the grant and DENIES the call before the subprocess
    // runs, regardless of whether the extension bothered to call the
    // advisory `ctx.rbac.check`. This is what makes declared scopes real:
    // an extension can no longer perform a denied action by ignoring the
    // check result. Tools with NO declared scope skip this entirely
    // (unchanged path). The grant coordinate is the manifest NAME (what
    // `extension_rbac_grants` references), and the project is derived
    // server-side from the conversation — identical semantics to the
    // advisory `ctx.rbac.check` via the shared `resolveExtensionScopeGrant`.
    const requiredScope = tool?.rbacScope;
    const { invocationGuard, serviceTargetBinding } = serviceInvocation || requiredScope
      ? await this.authorizeInvocationScope({
        serviceInvocation, extensionId, toolName, conversationId, needed, requiredScope,
        manifestName: manifest?.name, opts: _opts,
      })
      : { invocationGuard: _opts?.invocationGuard, serviceTargetBinding: undefined };

    this.addAuthorApprovalCaps(needed, originalName, manifest?.name, extensionId);

    // Phase 1 PDP gate. Fail-closed if the engine isn't wired —
    // constructor already enforces that, but the typecheck here is
    // additional belt-and-braces.
    //
    // Runtime fail-closed: if `engine.authorize` itself throws (DB
    // blip in `getSetting`, malformed cap, transient bug), convert to
    // PermissionDeniedError so the caller still rejects rather than
    // silently allowing the dispatch on the existing try/catch's
    // success path. The thrown error propagates up the same reject
    // path as a normal deny.
    // Phase 4 §M1/M2 — chain `parentAuditId` from the upstream
    // runtime context (set by the previous authorize() in this call
    // chain) when the caller didn't supply one explicitly. Top-level
    // dispatches see `getRuntimeToolContext() === undefined` and pass
    // `parentAuditId` as undefined; nested invokes pick it up from
    // the surrounding ALS scope.
    const upstreamCtx = getRuntimeToolContext();
    const inheritedParentAuditId =
      _opts?.parentAuditId ?? upstreamCtx?.currentAuditId;

    const decision = await this.authorizeWithPrompts(
      { toolName, originalName, extensionId, conversationId, messageId, input, registered, meta, signal: _opts?.signal, emitToolStart },
      needed,
      {
        serviceInvocation,
        callerExtensionId: _opts?.callerExtensionId,
        capContext: _opts?.capContext,
        parentAuditId: inheritedParentAuditId,
      },
    );

    // Track current call context for reverse RPC handlers (e.g. ezcorp/storage)
    this.currentConversationId = conversationId;

    // Phase 4 §M1/M2 — establish the runtime tool context for the
    // remainder of this dispatch. Any nested `handlePiInvoke` reads
    // `currentCapContext` (the post-intersection set this call ran
    // with) and `currentAuditId` (this authorize's row id). Inherits
    // unspecified fields from any surrounding scope so nested
    // invocations stack chained-deputy intersections correctly.
    const runtimeCtxForCall: import("../runtime-tool-context").RuntimeToolContext = {
      ...(_opts?.capContext !== undefined ? { currentCapContext: _opts.capContext } : {}),
      signal: _opts?.signal,
      invocationGuard,
      currentAuditId: decision.auditId,
      ...(serviceInvocation ? { serviceInvocation } : {}),
    };

    const startTime = Date.now();
    // Idempotent: a no-op if the prompt branch already emitted it;
    // otherwise the normal pre-dispatch tool:start (unchanged behavior).
    emitToolStart(startTime);

    return withRuntimeToolContext(runtimeCtxForCall, async () => {
    try {
      _opts?.signal?.throwIfAborted();
      // Resolve shared variables (x-shared) before dispatching to either
      // subprocess or MCP client.
      const resolvedInput = resolveSharedVariables(
        registered.inputSchema,
        input,
      );

      const manifest = this.registry.getManifest(extensionId);
      const isMcp = manifest?.kind === "mcp";

      // Phase 3 SDK-served branch — entity CRUD tools dispatch directly
      // to the SDK's auto-generated handler (bypassing the subprocess
      // and the MCP client entirely). The registry tagged these with
      // `entityKind` + `entityType`; dispatch finds the declaration on
      // the manifest, binds an EntityStoreLike to the acting scope, and
      // returns the SDK's `ToolCallResult` directly. The audit log
      // (`recordToolCall` below) still runs uniformly so SDK-served
      // calls appear in the same row as subprocess-served ones — only
      // the bytes between PDP and audit differ.
      if (registered.entityKind && registered.entityType && manifest) {
        const decl = manifest.entities?.find(
          (e) => e.type === registered.entityType,
        );
        if (!decl) {
          throw new Error(
            `Entity declaration "${registered.entityType}" not found on manifest for extension ${extensionId}`,
          );
        }
        const scope = decl.scope ?? "user";
        // Bind the host store to the acting scope. For "user", we use
        // the acting user (currentUserId). For "conversation", we use
        // the conversation id. "project" maps onto conversation per the
        // host-store adapter (v1 has no project tier).
        const scopeId =
          scope === "user"
            ? (this.currentUserId ?? null)
            : (conversationId ?? null);
        if (!scopeId) {
          throw new Error(
            `Cannot dispatch entity tool ${toolName}: no ${scope}-scope id available`,
          );
        }
        const executeEntity = async (database?: StorageDatabase) => {
          _opts?.signal?.throwIfAborted();
          const store = createHostEntityStore({ extensionId, scope, scopeId, ...(database ? { database } : {}) });
          const handler = buildEntityToolHandlers(decl, store)[registered.entityKind!];
          const result = await handler(resolvedInput);
          _opts?.signal?.throwIfAborted();
          return result;
        };
        const entityResult = await getDb().transaction(async (transaction: DbTransaction) => {
          await verifyInvocationLocks(transaction, invocationGuard);
          const result = await executeEntity(transaction);
          await verifyInvocationLocks(transaction, invocationGuard);
          return result;
        });
        const duration = Date.now() - startTime;
        const toolEvent: DomainExtensionEvent = { id: crypto.randomUUID(), type: "tool:complete", conversationId, payload: {
          conversationId,
          extensionId,
          toolName,
          output: entityResult,
          duration,
          success: !entityResult.isError,
          ...(registered.cardType && { cardType: registered.cardType }),
          ...(registered.cardLayout && { cardLayout: registered.cardLayout }),
          ...(meta?.source && { source: meta.source }),
          ...(meta?.invocationId && { invocationId: meta.invocationId }),
        } };
        await this.recordToolCall(
          conversationId,
          messageId,
          extensionId,
          toolName,
          input,
          entityResult,
          startTime,
          registered.cardType,
          registered.cardLayout,
          toolEvent,
        );
        emitPersistedDomainEvent(this.bus, toolEvent);
        return entityResult;
      }

      let result: ToolCallResult;
      {
        const proc = isMcp && manifest?.mcpServers?.[0]?.transport !== "stdio" ? undefined : await this.registry.getProcess(extensionId);

        // Wire handlers if not already wired for this extension
        if (proc) await this.ensureSubprocessRpcWired(extensionId, proc);

        // Use originalName for RPC call to subprocess, not the namespaced name
        const callArgs = _opts?._callDepth != null && _opts._callDepth > 0
          ? { ...resolvedInput, _depth: _opts._callDepth }
          : resolvedInput;
        // Propagate the acting-user id through the JSON-RPC `_meta`
        // side-channel. The subprocess sees it in `extra._meta.ezOnBehalfOf`
        // and bundled extensions (like ai-kit) forward it as the
        // X-Ezcorp-On-Behalf-Of header on any outbound call back into
        // this server. This is the ONLY path by which the conversation
        // owner's id reaches a tool handler — it is never part of the
        // LLM-visible arguments (see bearer-auth.ts for the reason).
        const meta: Record<string, unknown> = {};
        if (this.currentUserId) meta.ezOnBehalfOf = this.currentUserId;
        if (conversationId) {
          meta.ezConversationId = conversationId;
          // Resolve the conversation's ACTIVE project root so filesystem-
          // scoping extensions (ez-code-factory's gate) target the RIGHT
          // project. A single persistent subprocess serves every
          // conversation, so the subprocess-wide `EZCORP_PROJECT_ROOT` env
          // var only ever names ONE project — structurally wrong. The host
          // owns the truth (`conversations.projectId` → `projects.path`),
          // so we resolve it per-call and forward it on `_meta`. Best-effort:
          // any failure leaves it undefined (the SDK/ext fall back to the
          // env var) rather than failing the tool call.
          try {
            const conv = await getConversation(conversationId);
            if (conv?.projectId) {
              const project = await getProject(conv.projectId);
              if (project?.path) meta.ezProjectRoot = project.path;
            }
          } catch {
            // leave meta.ezProjectRoot unset — resolve defensively
          }
        }
        if (this.currentModel) meta.ezModel = this.currentModel;
        if (this.currentProvider) meta.ezProvider = this.currentProvider;
        // Public origin of the EZCorp UI — bundled MCP tools (ai-kit)
        // use it to build clickable deep-links in tool responses. Safe
        // to pass to every subprocess; non-URL-building tools ignore it.
        const publicUrl = process.env.EZCORP_PUBLIC_URL;
        if (publicUrl) meta.ezPublicUrl = publicUrl;
        // Phase 4 §5.1a: opaque per-turn invocation metadata rides in
        // `_meta.invocationMetadata`. The SDK's tools/call dispatcher
        // surfaces it on the handler ctx.
        //
        // Per-extension user/global settings (lazy-foraging-hammock):
        // when the manifest declares a `settings` schema, resolve the
        // effective values for the acting user and merge them under
        // `invocationMetadata.settings`. Caller-supplied settings win
        // over resolved values (the host orchestrator may pre-bind
        // overrides at wire time); resolved values fill the gaps.
        let mergedInvocationMetadata = invocationMetadata;
        if (manifest?.settings) {
          // Pass the in-memory schema so the resolver skips the
          // per-call `extensions.manifest` DB query — N+1 fix.
          const resolved = await resolveExtensionSettings(
            extensionId,
            this.currentUserId ?? null,
            manifest.settings,
          );
          const callerSettings = (invocationMetadata?.settings ?? undefined) as
            | Record<string, unknown>
            | undefined;
          mergedInvocationMetadata = {
            ...invocationMetadata,
            settings: { ...resolved, ...(callerSettings ?? {}) },
          };
        }
        if (mergedInvocationMetadata && Object.keys(mergedInvocationMetadata).length > 0) {
          meta.invocationMetadata = mergedInvocationMetadata;
        }
        // Per-call reverse-RPC provenance. The subprocess echoes ONLY
        // this opaque, host-issued token back on its capability calls;
        // the host resolves the real {onBehalfOf, conversationId, runId,
        // parentCallId} from the registry — never from mutable singleton
        // state. The snapshot is taken from THIS call's values, so it
        // stays correct under concurrency and for long-running tools.
        const im = mergedInvocationMetadata as
          | { runId?: unknown; parentCallId?: unknown }
          | undefined;
        const ezCallId = registerCallProvenance({
          onBehalfOf: this.currentUserId ?? null,
          conversationId: conversationId ?? null,
          runId: typeof im?.runId === "string" ? im.runId : null,
          parentCallId: typeof im?.parentCallId === "string" ? im.parentCallId : null,
          actorExtensionId: extensionId,
          kind: "tool",
          ownerless: !this.currentUserId && !serviceInvocation,
          ...(serviceInvocation ? { serviceInvocation, invocationGuard, runId: serviceInvocation.workflowRunId, ...(serviceInvocation.projectId ? { projectId: serviceInvocation.projectId } : {}) } : {}),
        });
        meta.ezCallId = ezCallId;
        if (serviceTargetBinding !== undefined || _opts?.expectedReleaseBinding !== undefined) meta.expectedReleaseBinding = serviceTargetBinding ?? _opts?.expectedReleaseBinding;
        // Only pass the fourth `options` arg when there's something to set —
        // keeps the 3-arg call shape for the common case (tests assert with
        // strict `toHaveBeenCalledWith` arity). The token is released the
        // moment the forward call returns — all reverse-RPCs for it have
        // necessarily completed by then.
        // Long-blocking exemption from the flat per-call subprocess RPC timeout
        // (subprocess.ts kills the process on any call exceeding callTimeoutMs,
        // default 30s). Two host-controlled cases opt out:
        //   1. `requiresUserInput` — human-in-the-loop (ask-user); bounded by the
        //      user.
        //   2. A BUNDLED orchestration tool that legitimately awaits async events
        //      (invoke_agent / collect_agent_result — see
        //      LONG_BLOCKING_ORCHESTRATION_TOOLS). Without this, a >30s wait kills
        //      the SHARED orchestration subprocess, dropping every backgroundSpawn
        //      + in-flight invoke across all conversations.
        // Gated on `registry.isBundled` so a third-party manifest cannot self-grant
        // supervision evasion (the bare-name set is host-produced; see filter.ts).
        // Unbounded here (not a raised finite cap) because the activity-sliding
        // give-up deadline + configurable maxCycles exceed any fixed cap; the tool
        // self-bounds via its own reap/gate, and the parent-run watchdog provides
        // the run-level bound (bounded for collect; agent:* liveness for invoke).
        const skipCallTimeout =
          registered.requiresUserInput === true ||
          (LONG_BLOCKING_ORCHESTRATION_TOOLS.has(originalName) &&
            this.registry.isBundled?.(extensionId) === true);
        try {
          _opts?.signal?.throwIfAborted();
          if (invocationGuard) await invocationGuard();
          _opts?.signal?.throwIfAborted();
          const controlOptions = { ...(_opts?.signal ? { signal: _opts.signal } : {}), ...(invocationGuard ? { invocationGuard } : {}) };
          const controlled = _opts?.signal || invocationGuard;
          const callOptions = controlled ? { skipTimeout: skipCallTimeout, ...controlOptions } : skipCallTimeout ? { skipTimeout: true } : undefined;
          result = isMcp
            ? await (await this.registry.getMcpClient(extensionId)).callTool(originalName, callArgs, meta, ...(controlled ? [controlOptions] : []))
            : callOptions
            ? await proc!.callTool(originalName, callArgs, meta, callOptions)
            : await proc!.callTool(originalName, callArgs, meta);
        } finally {
          releaseCallProvenance(ezCallId);
        }
      }

      // Record to tool_calls table
      const duration = Date.now() - startTime;
      const toolEvent: DomainExtensionEvent = { id: crypto.randomUUID(), type: "tool:complete", conversationId, payload: {
        conversationId,
        extensionId,
        toolName,
        output: result,
        duration,
        success: !result.isError,
        ...(registered.cardType && { cardType: registered.cardType }),
        ...(registered.cardLayout && { cardLayout: registered.cardLayout }),
        ...(meta?.source && { source: meta.source }),
        ...(meta?.invocationId && { invocationId: meta.invocationId }),
      } };
      await this.recordToolCall(
        conversationId,
        messageId,
        extensionId,
        toolName,
        input,
        result,
        startTime,
        registered.cardType,
        registered.cardLayout,
        toolEvent,
      );
      emitPersistedDomainEvent(this.bus, toolEvent);

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));
      const errorResult: ToolCallResult = {
        content: [{ type: "text", text: errorMsg }],
        isError: true,
      };

      // Record error to tool_calls table
      const duration = Date.now() - startTime;
      const toolEvent: DomainExtensionEvent = { id: crypto.randomUUID(), type: "tool:error", conversationId, payload: {
        conversationId,
        extensionId,
        toolName,
        error: errorMsg,
        duration,
        ...(registered.cardType && { cardType: registered.cardType }),
        ...(registered.cardLayout && { cardLayout: registered.cardLayout }),
        ...(meta?.source && { source: meta.source }),
        ...(meta?.invocationId && { invocationId: meta.invocationId }),
      } };
      await this.recordToolCall(
        conversationId,
        messageId,
        extensionId,
        toolName,
        input,
        errorResult,
        startTime,
        registered.cardType,
        registered.cardLayout,
        toolEvent,
      );
      emitPersistedDomainEvent(this.bus, toolEvent);

      return errorResult;
    }
    });
  }

  /** Legacy `ezcorp/fs` path-check shim — see {@link fsHandlePiFs}. */
  async handlePiFs(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return fsHandlePiFs(this.registry, extensionId, req);
  }

  // ── Phase 3: per-operation `ezcorp/fs.*` handlers ─────────────────

  private fsDeps(): FsRpcDeps {
    return { engine: this.engine, registry: this.registry };
  }

  /** `ezcorp/fs.read` — see {@link fsHandlePiFsRead}. */
  async handlePiFsRead(extensionId: string, req: JsonRpcRequest): Promise<FsRpcResponse> {
    return fsHandlePiFsRead(this.fsDeps(), extensionId, req);
  }

  /** `ezcorp/fs.write` — see {@link fsHandlePiFsWrite}. */
  async handlePiFsWrite(extensionId: string, req: JsonRpcRequest): Promise<FsRpcResponse> {
    return fsHandlePiFsWrite(this.fsDeps(), extensionId, req);
  }

  /** `ezcorp/fs.list` — see {@link fsHandlePiFsList}. */
  async handlePiFsList(extensionId: string, req: JsonRpcRequest): Promise<FsRpcResponse> {
    return fsHandlePiFsList(this.fsDeps(), extensionId, req);
  }

  /** `ezcorp/fs.stat` — see {@link fsHandlePiFsStat}. */
  async handlePiFsStat(extensionId: string, req: JsonRpcRequest): Promise<FsRpcResponse> {
    return fsHandlePiFsStat(this.fsDeps(), extensionId, req);
  }

  /** `ezcorp/fs.exists` — see {@link fsHandlePiFsExists}. */
  async handlePiFsExists(extensionId: string, req: JsonRpcRequest): Promise<FsRpcResponse> {
    return fsHandlePiFsExists(this.fsDeps(), extensionId, req);
  }

  /** `ezcorp/fs.mkdir` — see {@link fsHandlePiFsMkdir}. */
  async handlePiFsMkdir(extensionId: string, req: JsonRpcRequest): Promise<FsRpcResponse> {
    return fsHandlePiFsMkdir(this.fsDeps(), extensionId, req);
  }

  /** `ezcorp/fs.unlink` — see {@link fsHandlePiFsUnlink}. */
  async handlePiFsUnlink(extensionId: string, req: JsonRpcRequest): Promise<FsRpcResponse> {
    return fsHandlePiFsUnlink(this.fsDeps(), extensionId, req);
  }

  /** `ezcorp/invoke` cross-extension dispatch — see {@link rpcHandlePiInvoke}. */
  async handlePiInvoke(
    callerExtId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiInvoke(this.invokeHost(), callerExtId, req);
  }

  /** Build the {@link InvokeHost} snapshot for the cross-ext invoke path. */
  private invokeHost(): InvokeHost {
    return {
      registry: this.registry,
      eventDriven: this.eventDriven,
      currentConversationId: this.currentConversationId,
      currentUserId: this.currentUserId,
      executeToolCall: this.executeToolCall.bind(this),
    };
  }

  /** Build the {@link RpcHandlerDeps} snapshot for the thin reverse-RPC delegates. */
  private rpcDeps(): RpcHandlerDeps {
    return {
      registry: this.registry,
      engine: this.engine,
      bus: this.bus,
      executor: this.executor,
      spawnQuota: this.spawnQuota,
      scheduleDaemon: this.scheduleDaemon,
      currentModel: this.currentModel,
      currentProvider: this.currentProvider,
      currentUserId: this.currentUserId,
      currentConversationId: this.currentConversationId,
      resolveExtensionScopeGrant: (name, scope, obo, conv) =>
        this.resolveExtensionScopeGrant(name, scope, obo, conv),
    };
  }

  /**
   * Create the `tools` object for AgentContext.
   * Code-based agents can call ctx.tools.invoke("tool_name", {input}).
   */
  createToolsContext(conversationId: string, messageId: string | null, options?: { signal?: AbortSignal; invocationGuard?: InvocationGuard; serviceInvocation?: ServiceInvocation }) {
    return {
      invoke: async (toolName: string, input: Record<string, unknown>): Promise<unknown> => {
        const result = await this.executeToolCall(toolName, input, conversationId, messageId, ...(options ? [options] : []));
        if (result.isError) {
          throw new Error(result.content.map((c) => c.text).join("\n"));
        }
        // Return the text content as the result
        return result.content.map((c) => c.text).join("\n");
      },
    };
  }

  /** `ezcorp/storage` reverse-RPC — see {@link rpcHandlePiStorage}. */
  async handlePiStorage(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiStorage(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/AgentConfigs` reverse-RPC — see {@link rpcHandlePiAgentConfigs}. */
  async handlePiAgentConfigs(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiAgentConfigs(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/EmitTaskEvent` reverse-RPC — see {@link rpcHandlePiEmitTaskEvent}. */
  async handlePiEmitTaskEvent(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiEmitTaskEvent(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/EmitLoopEvent` reverse-RPC — see {@link rpcHandlePiEmitLoopEvent}. */
  async handlePiEmitLoopEvent(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiEmitLoopEvent(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/SpawnAssignment` reverse-RPC — see {@link rpcHandlePiSpawnAssignment}. */
  async handlePiSpawnAssignment(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiSpawnAssignment(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/CancelRun` reverse-RPC — see {@link rpcHandlePiCancelRun}. */
  async handlePiCancelRun(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiCancelRun(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/QueueAgentMessage` reverse-RPC — see {@link rpcHandlePiQueueAgentMessage}. */
  async handlePiQueueAgentMessage(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiQueueAgentMessage(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/NetworkInternal` reverse-RPC — see {@link rpcHandlePiNetworkInternal}. */
  async handlePiNetworkInternal(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiNetworkInternal(this.rpcDeps(), extensionId, req);
  }

  /**
   * Install the reverse-RPC request handler + state-mediator
   * notification handler on this extension's subprocess. Idempotent
   * PER PROCESS INSTANCE: `wiredProcs` (a WeakSet keyed by the
   * ExtensionProcess object) is consulted first.
   *
   * Keying on the instance — not extensionId — is load-bearing. The
   * registry hands back a NEW ExtensionProcess whenever the previous
   * one died (idle-kill / crash / respawn); that new instance must get
   * its own `setRequestHandler`, or its `transport.onRequest` stays
   * null and every reverse-RPC the respawned child makes is silently
   * dropped at `json-rpc.ts` — the child's `getChannel().request(...)`
   * never resolves, so it never returns its `tools/call` result and
   * the host's `proc.callTool` hangs until the 90s watchdog (the
   * "stuck chat" defect). The old extensionId-keyed Set never cleared,
   * so a respawned subprocess was permanently mis-wired.
   *
   * Public so the messageToolbar event route can pre-wire the
   * subprocess BEFORE the bus emit (purely event-driven extensions
   * like `kokoro-tts` otherwise have no `onRequest` when they send
   * `ezcorp/append-message`).
   *
   * The closures capture `this`, but every handler reads from
   * `this.registry` / static helpers — no per-turn state — so
   * re-wiring a fresh proc is always safe.
   */
  async ensureSubprocessRpcWired(
    extensionId: string,
    proc: ExtensionProcess,
  ): Promise<void> {
    if (this.wiredProcs.has(proc)) return;
    this.wiredProcs.add(proc);

    // Install the page-state / panel-state notification handler whenever
    // a mediator is reachable. Fall back to the process-wide singleton
    // (registered at boot in context.ts) when this executor was never
    // given a per-instance `this.stateMediator` — the case for the boot
    // `bootExecutor` and per-request render-pull / events executors.
    // Without this, boot-spawned and lazily-spawned `persistent:true`
    // dashboards never get the handler, so their `ezcorp/page-state`
    // (`pushPage`) live-refresh signal is silently dropped and the Hub
    // only updates via the render-pull stale-serve fallback. Purely
    // additive: it ONLY adds installs where there were none; the
    // existing `this.stateMediator` behavior is preserved.
    const mediator = this.stateMediator ?? getStateMediator();
    if (mediator) {
      proc.setNotificationHandler((notification) => {
        mediator.handleNotification(extensionId, notification);
      });
    }

    // Every inbound reverse-RPC routes through the declarative dispatch
    // table (rpc-handlers.ts `routeReverseRpc`), wrapped in
    // `dispatchReverseRpcWithTimeout` so a host handler that never settles
    // can't wedge the child's reverse-RPC `request()` until the 90s watchdog
    // (the "stuck chat" defect). Exempt methods (`ezcorp/invoke`,
    // `ezcorp/llm-complete`) bypass the bound — see REVERSE_RPC_HANDLER_TIMEOUT_EXEMPT.
    proc.setRequestHandler((req) => {
      // `ezcorp/drafts` verify/install run a sandboxed smoke-test
      // round-trip that legitimately exceeds the 20s per-handler cap;
      // install additionally only runs post user-approval. Exempt
      // ONLY those two actions — the other drafts actions stay bounded.
      const draftsAction =
        req.method === "ezcorp/drafts"
          ? (req.params as { action?: unknown } | undefined)?.action
          : undefined;
      const exempt =
        draftsAction === "verify" || draftsAction === "install";
      return dispatchReverseRpcWithTimeout(
        req.method,
        extensionId,
        req.id,
        () => routeReverseRpc(this, extensionId, req),
        exempt,
      );
    });
  }

  /** `ezcorp/LlmComplete` reverse-RPC — see {@link rpcHandlePiLlmComplete}. */
  async handlePiLlmComplete(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiLlmComplete(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/Memory` reverse-RPC — see {@link rpcHandlePiMemory}. */
  async handlePiMemory(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiMemory(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/Lessons` reverse-RPC — see {@link rpcHandlePiLessons}. */
  async handlePiLessons(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiLessons(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/Search` reverse-RPC — see {@link rpcHandlePiSearch}. */
  async handlePiSearch(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiSearch(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/Schedule` reverse-RPC — see {@link rpcHandlePiSchedule}. */
  async handlePiSchedule(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiSchedule(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/Drafts` reverse-RPC — see {@link rpcHandlePiDrafts}. */
  async handlePiDrafts(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiDrafts(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/Workflows` reverse-RPC — see {@link rpcHandlePiWorkflows}. */
  async handlePiWorkflows(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiWorkflows(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/workflows-delegated` reverse-RPC — see
   *  {@link rpcHandlePiWorkflowsDelegated}. */
  async handlePiWorkflowsDelegated(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiWorkflowsDelegated(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/triggers` reverse-RPC — see {@link rpcHandlePiTriggers}. */
  async handlePiTriggers(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiTriggers(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/GithubProjects` reverse-RPC — see {@link rpcHandlePiGithubProjects}. */
  async handlePiGithubProjects(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiGithubProjects(this.rpcDeps(), extensionId, req);
  }

  async handlePiHostApi(extensionId: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return handleHostApi(this.rpcDeps(), extensionId, request);
  }

  async handlePiProjectPullRequest(extensionId: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return handleProjectPullRequest(this.rpcDeps(), extensionId, request);
  }

  async handlePiProjectGit(extensionId: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return handleProjectGit(this.rpcDeps(), extensionId, request);
  }

  async handlePiProjectPullRequestReview(extensionId: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return handleProjectPullRequestReview(this.rpcDeps(), extensionId, request);
  }

  async handlePiNetworkBroker(extensionId: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return handleNetworkBroker(this.rpcDeps(), extensionId, request);
  }

  async handlePiNetworkTunnel(extensionId: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return handleNetworkTunnel(this.rpcDeps(), extensionId, request);
  }

  async handlePiCredentialBroker(extensionId: string, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return handleCredentialBroker(this.rpcDeps(), extensionId, request);
  }

  /** `ezcorp/RbacCheck` reverse-RPC — see {@link rpcHandlePiRbacCheck}. */
  async handlePiRbacCheck(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiRbacCheck(this.rpcDeps(), extensionId, req);
  }

  /**
   * The SINGLE decision core for the extension-RBAC (user→extension) axis:
   * does `onBehalfOf` hold `scope` for `extensionName` at the project
   * derived from `conversationId`? Shared by the advisory
   * `ctx.rbac.check` reverse-RPC (`handlePiRbacCheck`) and the host-side
   * pre-dispatch ENFORCEMENT gate in `executeToolCall`, so the answer the
   * extension is *told* and the answer the host *enforces* can never
   * diverge.
   *
   * Deny-by-default + fail-closed: no acting user, an unknown/deleted
   * user, or no covering grant all resolve `false`. Admins resolve `true`
   * inside `hasExtensionScope` without a grants query (the core sentinel).
   * The PROJECT coordinate is derived SERVER-SIDE from the conversation —
   * never the wire (same rule as the github-projects handler); a
   * background fire with no conversation checks at the "all projects"
   * (null) coordinate, which only NULL-project grant rows cover.
   *
   * `extensionName` MUST be the manifest NAME (`extension_rbac_grants`
   * references `extensions.name`), NOT the registry instance id.
   */
  private async resolveExtensionScopeGrant(
    extensionName: string,
    scope: string,
    onBehalfOf: string | null,
    conversationId: string | null,
  ): Promise<boolean> {
    if (!onBehalfOf) return false;
    const user = await getUserById(onBehalfOf);
    if (!user) {
      log.warn("extension RBAC: acting user not found — deny-by-default", {
        extension: extensionName,
        scope,
      });
      return false;
    }
    let projectId: string | null = null;
    if (conversationId && conversationId !== "unknown") {
      const conversation = await getConversation(conversationId);
      projectId = conversation?.projectId ?? null;
    }
    return hasExtensionScope(
      { id: user.id, role: user.role },
      { projectId, extensionId: extensionName, scope },
    );
  }

  /**
   * Reverse-RPC provenance resolution — see {@link provResolveReverseRpcMeta}.
   * Retained as an instance method purely as the trust-boundary test seam that
   * `tool-executor.provenance.test.ts` exercises via a cast; production paths
   * call the free `provResolveReverseRpcMeta` directly.
   */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: test seam — exercised via cast in tool-executor.provenance.test.ts
  private resolveReverseRpcMeta(
    extensionId: string,
    req: JsonRpcRequest,
  ) {
    return provResolveReverseRpcMeta(extensionId, req);
  }

  /** `ezcorp/AppendMessage` reverse-RPC — see {@link rpcHandlePiAppendMessage}. */
  async handlePiAppendMessage(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiAppendMessage(this.rpcDeps(), extensionId, req);
  }

  /** `ezcorp/FinalizeToolCall` reverse-RPC — see {@link rpcHandlePiFinalizeToolCall}. */
  async handlePiFinalizeToolCall(
    extensionId: string,
    req: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    return rpcHandlePiFinalizeToolCall(this.rpcDeps(), extensionId, req);
  }

  private async recordToolCall(
    conversationId: string,
    messageId: string | null,
    extensionId: string,
    toolName: string,
    input: Record<string, unknown>,
    result: ToolCallResult,
    startTime: number,
    cardType?: string,
    cardLayout?: string,
    event?: DomainExtensionEvent,
  ): Promise<void> {
    // Route through the shared persist helper — single insert site for
    // tool_calls across the extension-tool path here and the built-in
    // path in executor.ts. The helper swallows DB errors itself so tool
    // execution is never blocked by a DB glitch.
    //
    // `input` here is the POST-resolver value (attachment handles already
    // substituted with real `data:` URIs by the args resolver) — redact
    // large base64 payloads at this persist boundary so multi-MB blobs
    // never land in the jsonb. This is the extension-executor chokepoint:
    // every dispatch path (subprocess, MCP, entity, cross-ext invoke,
    // error arm) records through here. The built-in path (executor.ts)
    // never carries resolved attachment payloads.
    await persistToolCall({
      conversationId,
      messageId,
      extensionId,
      toolName,
      input: redactLargeDataUris(input) as Record<string, unknown>,
      output: result,
      success: !result.isError,
      durationMs: Date.now() - startTime,
      cardType: cardType ?? null,
      cardLayout: cardLayout === "dock" || cardLayout === "inline" ? cardLayout : null,
      userId: this.currentUserId ?? null,
      agentConfigId: this.currentAgentConfigId ?? null,
      model: this.currentModel ?? null,
      provider: this.currentProvider ?? null,
    }, event);
  }
}
