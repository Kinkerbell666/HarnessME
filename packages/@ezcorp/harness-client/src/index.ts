/**
 * @ezcorp/harness-client — remote-control client for an EZCorp instance.
 *
 * Lets an external runner (Playwright, CI script, or another agent)
 * authenticate with a bearer API key and: configure settings, create + drive
 * conversations, observe the runtime SSE stream with runId correlation,
 * approve tool-call permission gates, and (against a test-mode instance)
 * script the deterministic mock LLM. Transport-agnostic: configurable
 * baseUrl + apiKey + fetch, no SvelteKit/cookie coupling.
 *
 * See README.md for a worked example.
 */
export * from "./events";
export * from "./routes";
export { SseDataBuffer } from "./sse";

import { SseDataBuffer } from "./sse";
import type { RuntimeEvent } from "./events";
import { HARNESS_ROUTES, buildPath, type HarnessRouteName } from "./routes";
import type { FactoryApiResponse, FactoryDefinition, FactoryDefinitionListQuery, FactoryGrantListQuery, FactoryListQuery, FactoryRunListQuery, FactoryRunStartBody, FactoryRunControlBody } from "@ezcorp/factory-sdk";

export interface HarnessClientOptions {
  /** Base origin of the EZCorp instance, e.g. `http://localhost:3000`. */
  baseUrl: string;
  /** `ezk_*` API key (mint via `ezcorp key mint`). Sent as a bearer token. */
  apiKey?: string;
  /** Injectable fetch (defaults to the global). */
  fetch?: typeof fetch;
}

export interface MockToolCall {
  id?: string;
  name: string;
  arguments?: Record<string, unknown> | string;
}
/** Synthetic token usage (incl. cache hits/misses) reported on a mock turn.
 *  Mirrors the server's `MockUsage`; maps 1:1 onto the parsed
 *  `AssistantMessage.usage` that flows through the `run:usage` event. */
export interface MockUsage {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
}
/** A deterministic provider failure for a mock turn. Mirrors the server's
 *  `MockFault`: `status` (400–599) fails at that HTTP status (429/5xx);
 *  `kind:"connection"` aborts the body pre-first-token (transport failure). */
export interface MockFault {
  status?: number;
  kind?: "connection";
  message?: string;
}
export interface MockTurn {
  text?: string;
  toolCalls?: MockToolCall[];
  finishReason?: "stop" | "tool_calls" | "length";
  /** Synthetic usage (incl. cache hits/misses) reported on this turn. */
  usage?: MockUsage;
  /** Fail this turn deterministically instead of replying (retry/failover). */
  fault?: MockFault;
}

export interface SendMessageOptions {
  provider?: string;
  model?: string;
  parentMessageId?: string;
  permissionMode?: "ask" | "auto-edit" | "yolo";
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

export interface SendMessageResult {
  userMessage: { id: string; [k: string]: unknown };
  runId: string | null;
  [k: string]: unknown;
}

/** One node of a conversation's session-backed message tree. `parentId` is the
 *  tree topology; `excluded` rows are kept (struck-through in the UI). */
export interface ConversationTreeNode {
  id: string;
  parentId: string | null;
  role: string;
  excluded: boolean;
  createdAt: string;
}

/** The conversation's whole message tree + durable leaf pointer, as returned by
 *  `GET/POST /api/conversations/:id/{tree,rewind}` (Sessions P4). */
export interface ConversationTree {
  conversationId: string;
  /** The durable rewind/checkpoint leaf (a `messages` row id, or null when the
   *  conversation is empty). */
  currentLeaf: string | null;
  nodes: ConversationTreeNode[];
}

export interface RunResult {
  outcome: "complete" | "error" | "cancel";
  run: Record<string, unknown> & { id: string; status: string; result?: { output?: unknown; error?: unknown } };
  error?: string;
}

/** An installed-extension row as the server returns it. `id` is the extensions-
 *  table UUID (the `:id` path param for lifecycle routes); `name` is the stable
 *  manifest slug (used for wiring + secrets). Extra columns pass through. */
export interface ExtensionRecord {
  id: string;
  name: string;
  enabled?: boolean;
  [k: string]: unknown;
}

/** Source for `installExtension`. Mirrors the server's `installExtensionSchema`:
 *  `local` needs `path`, `github` needs `repo`, `git` needs `url` (+ optional
 *  `ref`). The server clones/enables nothing beyond the manifest declaration —
 *  install lands disabled; grant + enable happen via `activateExtension`. */
export type InstallExtensionInput =
  | { source: "local"; path: string }
  | { source: "github"; repo: string }
  | { source: "git"; url: string; ref?: string };

/** Result of a hub action dispatch: `{ ok }`, optionally with a freshly
 *  rendered page tree when the action returned one. */
export interface HubActionResult {
  ok: boolean;
  page?: unknown;
  renderedAt?: number;
}

// ── Caller-executed tools ────────────────────────────────────────────────

/** One tool this client device can execute, as declared on a conversation.
 *  `parameters` is a JSON Schema object (`{ type: "object", properties }`);
 *  the server validates its structure and refuses `$ref`/`$defs`. */
export interface CallerToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * A per-key TOOL POLICY as the mint route accepts it.
 *
 * Mirrors `ToolPolicy` in `src/auth/tool-policy.ts` by hand — this package
 * ships standalone and cannot import the server tree — plus the `routeBundle`
 * input alias, which the route expands and never stores. State the bundle by
 * NAME: it is a reviewed set, and every entry is validated against the API
 * registry at mint time so a typo is a 400 rather than a route that silently
 * denies forever.
 *
 * Give `routeBundle` OR `routeAllowlist`, never both.
 */
export interface ToolPolicyInput {
  routeBundle?: string;
  routeAllowlist?: string[];
  allowedCallerTools?: string[];
  maxCallerTools?: number;
  lockedModeId?: string;
}

/** `POST /api/settings/developer/api-keys`. `key` is the raw secret and is
 *  returned EXACTLY once — only its hash is persisted. */
export interface MintedApiKey {
  key: string;
  keyId: string;
  name: string;
  scopes: string[];
  role: string;
  toolPolicy?: ToolPolicyInput;
}

/** `PUT …/caller-tools`. `appliedFrom` is always `"next-turn"` — tool
 *  definitions bind once at turn setup, so `activeRunId` names the run this
 *  declaration will NOT affect. */
export interface DeclareCallerToolsResult {
  tools: CallerToolDeclaration[];
  appliedFrom: "next-turn";
  activeRunId: string | null;
}

/**
 * One inbound `caller:tool-call`.
 *
 * `toolName` is the BARE declared name (`open_app`) — the app registered its
 * handler under what it declared, and the `_caller__` prefix is the server's
 * wire concern. The two events are deliberately asymmetric on this point:
 * `tool:permission_request` carries the WIRE name, because that gate is the
 * generic one every tool passes through and it reports the tool as the
 * runtime knows it. {@link HarnessClient.serveCallerTools} strips the prefix
 * before looking a handler up anyway, so it is correct against either form.
 */
export interface CallerToolCall {
  conversationId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** Return value becomes the tool result's `detail`, rendered as fenced JSON
 *  into the LLM-visible content. Throwing reports a tool-level failure —
 *  it does not abort `serveCallerTools`. */
export type CallerToolHandler = (
  input: unknown,
  call: CallerToolCall,
) => unknown | Promise<unknown>;

/** `POST …/tool-results`. `ok` means the request was accepted; `resolved`
 *  means THIS result reached the waiting tool. A second device that lost the
 *  race gets `{ ok: true, resolved: false, reason: "already-resolved" }`. */
export interface ToolResultAck {
  ok: boolean;
  resolved: boolean;
  reason?: string;
}

/** `GET …/active-run`. `pendingCallerTools` is the authoritative recovery
 *  source after a disconnect (see {@link HarnessClient.serveCallerTools}). */
export interface ActiveRunInfo {
  runId: string | null;
  pendingCallerTools?: CallerToolCall[];
  [k: string]: unknown;
}

export interface ServeCallerToolsOptions {
  /** Stops the serve loop. Without one this never returns. */
  signal?: AbortSignal;
  /**
   * Answer this conversation's `_caller__*` permission gates automatically.
   * Defaults TRUE, and that default is a considered position rather than a
   * convenience: a caller tool ALWAYS opens a gate (the category is in no
   * auto-approve set, under `yolo` too), so a client that did not answer its
   * own gates would park every call until it timed out. The key holder wrote
   * the code the tool runs, so self-approval grants nothing new — what the
   * gate buys is a recorded, per-call, deniable decision the human owner can
   * see and veto live. Set false when a human approves out of band.
   *
   * Strictly THIS conversation's: a gate the shared user-scoped stream
   * carries for any other conversation is left for whoever owns it, so a
   * second loop's `autoApprove: false` keeps its veto.
   */
  autoApprove?: boolean;
  /** Delay before reconnecting after the stream ends or errors. */
  reconnectDelayMs?: number;
  /** Called on a stream/transport error instead of throwing, so a dropped
   *  connection does not end the serve loop. */
  onError?: (err: unknown) => void;
}

/** Runtime prefix for a declared caller tool. */
const CALLER_TOOL_NAMESPACE = "_caller__";

/**
 * Cap on the dedupe set so a long-lived server does not grow without bound.
 * Entries are dropped oldest-first (Set preserves insertion order).
 *
 * 512 is not a round number picked for comfort: the server's SSE resume ring
 * is 500 GLOBAL entries, so a replay can never deliver more than 500 events
 * of any kind, and remembering 512 tool calls therefore covers every call
 * replay could possibly repeat. Below that the cap would start forgetting
 * calls that are still replayable — which is the one case dedupe exists for.
 *
 * The set is NOT pruned per-run on a run's terminal event, deliberately: a
 * reconnect can replay a `caller:tool-call` from a run that has since ended,
 * and re-running it would repeat a side effect on the user's own machine to
 * produce a result the server would then discard as `already-resolved`.
 */
const DEDUPE_CEILING = 512;

/**
 * Handlers are keyed by the BARE declared name. `caller:tool-call` already
 * carries that form, so this is normally a no-op — kept because it makes the
 * lookup correct against the wire form too, and the two events on this
 * feature disagree about which they send (see {@link CallerToolCall}).
 */
function stripCallerNamespace(name: string): string {
  return name.startsWith(CALLER_TOOL_NAMESPACE)
    ? name.slice(CALLER_TOOL_NAMESPACE.length)
    : name;
}

/** A `caller:tool-call` payload, defensively narrowed — the event crosses a
 *  network boundary, and a malformed one must be ignored, not thrown on. */
function asCallerToolCall(data: Record<string, unknown>): CallerToolCall | null {
  const { conversationId, runId, toolCallId, toolName } = data;
  if (typeof conversationId !== "string" || typeof runId !== "string") return null;
  if (typeof toolCallId !== "string" || typeof toolName !== "string") return null;
  return { conversationId, runId, toolCallId, toolName, input: data.input };
}

export class HarnessApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`${method} ${path} → ${status}: ${typeof body === "object" && body && "error" in body ? (body as { error: string }).error : status}`);
    this.name = "HarnessApiError";
  }
}

export class HarnessClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HarnessClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers({ ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extraHeaders }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Never follow a 3xx: fetch strips `Authorization` on a cross-origin
      // redirect but FORWARDS it on a same-origin one, so the exposure is a
      // same-origin redirect (open-redirect route, misconfigured proxy)
      // replaying the `ezk_*` bearer token — plus not trusting a response
      // body a redirect could steer us to.
      redirect: "error",
    });
    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) throw new HarnessApiError(res.status, method, path, parsed ?? text);
    return parsed as T;
  }

  /** Drive a named route from the shared `HARNESS_ROUTES` table: resolves the
   *  HTTP method + path template once, substitutes `:param` segments, and
   *  delegates to `request()`. Every single-request method routes through here
   *  so a path string is never written inline. */
  private route<T>(name: HarnessRouteName, params?: Record<string, string>, body?: unknown, headers?: Record<string, string>): Promise<T> {
    const r = HARNESS_ROUTES[name];
    return this.request<T>(r.httpMethod, buildPath(r.pathTemplate, params), body, headers);
  }

  private factoryMutation(name: HarnessRouteName, params: Record<string, string>, expectedRevision: number, idempotencyKey: string, body?: unknown): Promise<FactoryApiResponse> {
    return this.route(name, params, body, { "If-Match": String(expectedRevision), "Idempotency-Key": idempotencyKey });
  }

  private factoryQuery(name: HarnessRouteName, params: Record<string, string>, query: object): Promise<FactoryApiResponse> {
    const route = HARNESS_ROUTES[name];
    const path = buildPath(route.pathTemplate, params);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) search.set(key, String(value));
    return this.request(route.httpMethod, search.size === 0 ? path : `${path}?${search}`);
  }

  // ── Factory authoring ──────────────────────────────────────────────
  listFactoryDefinitions(projectId: string, query: FactoryDefinitionListQuery = {}): Promise<FactoryApiResponse> {
    return this.factoryQuery("listFactoryDefinitions", { projectId }, query);
  }

  createFactoryDraft(projectId: string, source: FactoryDefinition, idempotencyKey: string): Promise<FactoryApiResponse> {
    return this.factoryMutation("createFactoryDraft", { projectId }, 0, idempotencyKey, { source });
  }

  importFactoryDraft(projectId: string, format: "json" | "yaml", source: string, idempotencyKey: string): Promise<FactoryApiResponse> {
    return this.factoryMutation("importFactoryDraft", { projectId }, 0, idempotencyKey, { format, source });
  }

  getFactoryDraft(projectId: string, factoryId: string): Promise<FactoryApiResponse> {
    return this.route("getFactoryDraft", { projectId, factoryId });
  }

  updateFactoryDraft(projectId: string, factoryId: string, source: FactoryDefinition, expectedRevision: number, idempotencyKey: string): Promise<FactoryApiResponse> {
    return this.factoryMutation("updateFactoryDraft", { projectId, factoryId }, expectedRevision, idempotencyKey, { source });
  }

  archiveFactoryDraft(projectId: string, factoryId: string, expectedRevision: number, idempotencyKey: string): Promise<FactoryApiResponse> {
    return this.factoryMutation("archiveFactoryDraft", { projectId, factoryId }, expectedRevision, idempotencyKey);
  }

  exportFactoryDraft(projectId: string, factoryId: string, format: "json" | "yaml"): Promise<FactoryApiResponse> {
    return this.factoryQuery("exportFactoryDraft", { projectId, factoryId }, { format });
  }

  validateFactoryDraft(projectId: string, factoryId: string, source: FactoryDefinition): Promise<FactoryApiResponse> {
    return this.route("validateFactoryDraft", { projectId, factoryId }, { source });
  }

  listFactoryVersions(projectId: string, factoryId: string, query: FactoryListQuery = {}): Promise<FactoryApiResponse> {
    return this.factoryQuery("listFactoryVersions", { projectId, factoryId }, query);
  }

  getFactoryVersion(projectId: string, factoryId: string, version: string): Promise<FactoryApiResponse> {
    return this.route("getFactoryVersion", { projectId, factoryId, version });
  }

  startFactoryRun(projectId: string, factoryId: string, body: FactoryRunStartBody, idempotencyKey: string): Promise<FactoryApiResponse> {
    return this.factoryMutation("startFactoryRun", { projectId, factoryId }, 0, idempotencyKey, body);
  }

  listFactoryRuns(projectId: string, query: FactoryRunListQuery = {}): Promise<FactoryApiResponse> {
    return this.factoryQuery("listFactoryRuns", { projectId }, query);
  }

  getFactoryRun(projectId: string, runId: string): Promise<FactoryApiResponse> {
    return this.route("getFactoryRun", { projectId, runId });
  }

  controlFactoryRun(projectId: string, runId: string, body: FactoryRunControlBody, expectedRevision: number, idempotencyKey: string): Promise<FactoryApiResponse> {
    return this.factoryMutation("controlFactoryRun", { projectId, runId }, expectedRevision, idempotencyKey, body);
  }

  getFactoryCommand(projectId: string, runId: string, commandId: string): Promise<FactoryApiResponse> {
    return this.route("getFactoryCommand", { projectId, runId, commandId });
  }

  listFactoryGrants(projectId: string, query: FactoryGrantListQuery = {}): Promise<FactoryApiResponse> {
    return this.factoryQuery("listFactoryGrants", { projectId }, query);
  }

  // ── Configure ──────────────────────────────────────────────────────
  getSetting<T = unknown>(key: string): Promise<T> {
    return this.route("getSetting", { key });
  }
  setSetting(key: string, value: unknown): Promise<unknown> {
    return this.route("setSetting", { key }, { value });
  }

  // ── Provisioning ───────────────────────────────────────────────────
  /**
   * Mint a NEW API key for the calling principal's own user
   * (`POST /api/settings/developer/api-keys`). Needs the `admin` scope.
   *
   * The point of the `toolPolicy` argument is provisioning a CONFINED
   * credential — a companion app asks its operator's admin key for a key that
   * reaches only the `desktop-companion` route bundle, runs only under one
   * mode, and may declare only the tools it actually implements:
   *
   * ```ts
   * const child = await admin.mintApiKey("my-app", ["read", "write", "chat"], {
   *   toolPolicy: {
   *     routeBundle: "desktop-companion",
   *     allowedCallerTools: ["open_app"],
   *     maxCallerTools: 1,
   *     lockedModeId: modeId,
   *   },
   * });
   * ```
   *
   * A POLICIED key calling this can only mint an equal-or-narrower key, and
   * can never mint an unpolicied one — a widening request is a 403 naming the
   * fields it widened.
   */
  mintApiKey(
    name: string,
    scopes: string[],
    opts: { role?: "member" | "admin"; toolPolicy?: ToolPolicyInput } = {},
  ): Promise<MintedApiKey> {
    return this.route("mintApiKey", undefined, {
      name,
      scopes,
      ...(opts.role !== undefined ? { role: opts.role } : {}),
      ...(opts.toolPolicy !== undefined ? { toolPolicy: opts.toolPolicy } : {}),
    });
  }

  // ── Conversations + drive ──────────────────────────────────────────
  /** `projectId` is REQUIRED by the server (`createConversationSchema`);
   *  default it to the `"global"` project so the zero-config call works —
   *  an explicit `input.projectId` always wins. */
  createConversation(input: Record<string, unknown> = {}): Promise<{ id: string; [k: string]: unknown }> {
    return this.route("createConversation", undefined, { projectId: "global", ...input });
  }
  sendMessage(conversationId: string, content: string, opts: SendMessageOptions = {}): Promise<SendMessageResult> {
    return this.route("sendMessage", { id: conversationId }, { content, ...opts });
  }

  /** Update a conversation's title / model / provider / system prompt / mode
   *  (`PUT /api/conversations/:id`). Needs the `chat` scope.
   *
   *  `modeId` is the field a confined key cares about: a key minted with
   *  `toolPolicy.lockedModeId` is refused on every send whose conversation is
   *  not under that mode, and this is how a client puts it there. Passing
   *  `modeId: null` clears the mode — which, for a locked key, BRICKS that
   *  conversation for it (the lock is fail-closed on `null` by design). */
  updateConversation(
    conversationId: string,
    patch: {
      title?: string;
      model?: string;
      provider?: string;
      systemPrompt?: string;
      modeId?: string | null;
    },
  ): Promise<{ id: string; [k: string]: unknown }> {
    return this.route("updateConversation", { id: conversationId }, patch);
  }

  /** Fetch a conversation's session-backed message tree + durable leaf pointer
   *  (`GET /api/conversations/:id/tree`, Sessions P4). Needs the `read` scope.
   *  Throws `HarnessApiError` 409 when the `sessions:historyProducer` flag is
   *  off (the tree is meaningless without the producer). */
  getConversationTree(conversationId: string): Promise<ConversationTree> {
    return this.route("getConversationTree", { id: conversationId });
  }

  /** Rewind/checkpoint a conversation to `targetMessageId`, moving the durable
   *  leaf pointer there (`POST /api/conversations/:id/rewind`, Sessions P4).
   *  Needs the `chat` scope. The abandoned tail survives as a recoverable
   *  sibling branch. Throws `HarnessApiError` 409 (flag off / active run) or 400
   *  (target not in the conversation). Returns the refreshed tree. */
  rewindConversation(
    conversationId: string,
    targetMessageId: string,
    opts: { summary?: string } = {},
  ): Promise<ConversationTree> {
    return this.route("rewindConversation", { id: conversationId }, {
      targetMessageId,
      ...(opts.summary !== undefined ? { summary: opts.summary } : {}),
    });
  }

  /** Clean A/B retry (Sessions P5): re-run the turn that produced `messageId`
   *  (an assistant row) from its parent USER message, WITHOUT duplicating that
   *  user row — the new response is a same-role SIBLING of the original
   *  assistant. Needs the `chat` scope. Optional `provider`/`model`/`thinkingLevel`
   *  retry against a different model without touching the conversation's pin;
   *  omitted → the conversation's own identity. Throws `HarnessApiError` 409
   *  (flag off / active run) or 400 (target is not an assistant with a user
   *  parent). Returns `{ userMessage, retriedMessageId, runId }` — `userMessage`
   *  is the EXISTING anchor turn (no new row was created). */
  retryMessage(
    conversationId: string,
    messageId: string,
    opts: { provider?: string; model?: string; thinkingLevel?: string } = {},
  ): Promise<SendMessageResult & { retriedMessageId: string }> {
    return this.route("retryMessage", { id: conversationId, mid: messageId }, {
      ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
    });
  }

  // ── Caller-executed tools ──────────────────────────────────────────
  /** Declare the tools this client device can execute for a conversation
   *  (`PUT …/caller-tools`). Needs the `chat` scope. ROOT conversations only —
   *  a sub-conversation is a 400, because it would inherit nothing. Replaces
   *  the whole set; declare `[]` to leave the key present but empty. */
  declareCallerTools(
    conversationId: string,
    tools: CallerToolDeclaration[],
  ): Promise<DeclareCallerToolsResult> {
    return this.route("declareCallerTools", { id: conversationId }, { tools });
  }

  /** Read back what is declared (`GET …/caller-tools`). Needs `read`. */
  async getCallerTools(conversationId: string): Promise<CallerToolDeclaration[]> {
    const res = await this.route<{ tools: CallerToolDeclaration[] }>("getCallerTools", {
      id: conversationId,
    });
    return res.tools;
  }

  /** Drop every declaration (`DELETE …/caller-tools`). Needs `chat`.
   *  Idempotent — clearing an empty set is `{ ok: true, cleared: 0 }`. */
  clearCallerTools(conversationId: string): Promise<{ ok: true; cleared: number }> {
    return this.route("clearCallerTools", { id: conversationId });
  }

  /** Return a client-side tool's result to the waiting host invocation
   *  (`POST …/tool-results`). Needs `chat`. See {@link ToolResultAck} for why
   *  `ok` and `resolved` are different questions. */
  submitToolResult(
    conversationId: string,
    toolCallId: string,
    result: unknown,
  ): Promise<ToolResultAck> {
    return this.route("submitToolResult", { id: conversationId }, { toolCallId, result });
  }

  /** The conversation's in-flight run plus anything awaiting a client-side
   *  result (`GET …/active-run`). Needs `read`. */
  getActiveRun(conversationId: string): Promise<ActiveRunInfo> {
    return this.route("getActiveRun", { id: conversationId });
  }

  // ── Extensions ─────────────────────────────────────────────────────
  extensionControl<Result = unknown>(
    tool: "extensions_describe" | "extensions_workspace" | "extensions_build" | "extensions_inspect" | "extensions_release",
    input: Record<string, unknown> = {},
  ): Promise<Result> {
    return this.route("extensionControl", undefined, { tool, input });
  }

  /** List installed extensions. `GET /api/extensions` returns a bare array;
   *  a `{ extensions: [...] }` wrapper is tolerated too. Any other shape throws
   *  (a silent `[]` would mask a contract drift as "no extensions installed"). */
  async listExtensions(): Promise<ExtensionRecord[]> {
    const res = await this.route<unknown>("listExtensions");
    if (Array.isArray(res)) {
      return res as ExtensionRecord[];
    }
    if (res && typeof res === "object" && Array.isArray((res as { extensions?: unknown }).extensions)) {
      return (res as { extensions: ExtensionRecord[] }).extensions;
    }
    throw new Error(
      `listExtensions: unexpected /api/extensions response shape — expected an array or { extensions: [...] }, got ${res === null ? "null" : typeof res}`,
    );
  }

  /** Install an extension from a local path, a GitHub release, or a git clone
   *  URL (`POST /api/extensions`). Requires an admin-ROLE key. The install lands
   *  DISABLED with no permissions granted — call `activateExtension` next to
   *  enable it and grant its manifest-declared permissions. Returns the new
   *  extension row (its `id` is the `:id` param for the lifecycle routes). */
  installExtension(input: InstallExtensionInput): Promise<ExtensionRecord> {
    return this.route("installExtension", undefined, input);
  }

  /** Enable an installed extension and (optionally) grant permissions
   *  (`POST /api/extensions/:id/activate`). Requires an admin-ROLE key. Omit
   *  `grantedPermissions` to just flip enabled=true; when supplied it is clamped
   *  to the manifest (nothing beyond what the author declared is granted).
   *  Returns the updated extension row. */
  activateExtension(
    extensionId: string,
    grantedPermissions?: Record<string, unknown>,
  ): Promise<ExtensionRecord> {
    return this.route(
      "activateExtension",
      { id: extensionId },
      grantedPermissions !== undefined ? { grantedPermissions } : {},
    );
  }

  /** Enable/disable an installed extension (`PATCH /api/extensions/:id`).
   *  Requires an admin-ROLE key + the `extensions` scope. NOTE: the server only
   *  permits DISABLING here (`enabled: false`); passing `true` returns 400 —
   *  enabling must go through `activateExtension` (which does the manifest-
   *  clamped permission review). Returns the updated extension row. */
  setExtensionEnabled(extensionId: string, enabled: boolean): Promise<ExtensionRecord> {
    return this.route("setExtensionEnabled", { id: extensionId }, { enabled });
  }

  /** Uninstall an extension (`DELETE /api/extensions/:id`). Requires an
   *  admin-ROLE key + the `extensions` scope. Destructive + instance-wide:
   *  retires the subprocess, drops the DB row, deletes the install directory
   *  when the host created it, invalidates cached Hub pages. Resolves
   *  (204, no body) on success.
   *
   *  `purgeData` additionally deletes everything the extension stored under
   *  `.ezcorp/extension-data/<name>/`. It defaults to FALSE and is worth an
   *  explicit decision: leaving it off means a reinstall resumes from that
   *  data, turning it on cannot be undone.
   *
   *  Built-in (bundled) extensions are refused with 409 — disable them with
   *  {@link setExtensionEnabled} instead, which now survives a restart. */
  uninstallExtension(
    extensionId: string,
    opts: { purgeData?: boolean } = {},
  ): Promise<void> {
    const { httpMethod, pathTemplate } = HARNESS_ROUTES.uninstallExtension;
    const path = buildPath(pathTemplate, { id: extensionId });
    return this.request(httpMethod, opts.purgeData ? `${path}?purgeData=1` : path);
  }

  /** Replace an extension's granted permissions (`PUT /api/extensions/:id/permissions`).
   *  Requires an admin-ROLE key. The submitted permissions are clamped to the
   *  manifest — anything beyond the author's declaration is dropped silently.
   *  Returns the updated extension row. */
  updateExtensionPermissions(
    extensionId: string,
    permissions: Record<string, unknown>,
  ): Promise<ExtensionRecord> {
    return this.route("updateExtensionPermissions", { id: extensionId }, { permissions });
  }

  /** Set (or rotate) a scope-isolated extension secret
   *  (`POST /api/extensions/:id/secrets`). Needs the `extensions` scope plus the
   *  per-extension `secrets` RBAC scope at `projectId` (`null`/omitted = the
   *  instance-wide scope; admins hold every scope). The plaintext `value` is
   *  never echoed back. */
  setExtensionSecret(
    extensionId: string,
    name: string,
    value: string,
    opts: { projectId?: string | null } = {},
  ): Promise<{ ok: true }> {
    return this.route("setExtensionSecret", { id: extensionId }, {
      name,
      value,
      ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
    });
  }

  /** Delete a scope-isolated extension secret
   *  (`DELETE /api/extensions/:id/secrets`). Same authz as `setExtensionSecret`.
   *  `deleted` is false when no matching secret existed. */
  deleteExtensionSecret(
    extensionId: string,
    name: string,
    opts: { projectId?: string | null } = {},
  ): Promise<{ deleted: boolean }> {
    return this.route("deleteExtensionSecret", { id: extensionId }, {
      name,
      ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
    });
  }

  /** Wire installed extensions (by manifest name) to a conversation. All-or-
   *  nothing: an unknown name 404s and wires nothing. Idempotent — re-wiring an
   *  already-wired extension is a no-op success. */
  wireExtensions(conversationId: string, names: string[]): Promise<{ wired: string[]; extensionIds: string[] }> {
    return this.route("wireExtensions", { id: conversationId }, { names });
  }

  /** List the extensions wired to a conversation. */
  async listWiredExtensions(conversationId: string): Promise<Array<{ id: string; name: string }>> {
    const res = await this.route<{ extensions: Array<{ id: string; name: string }> }>(
      "listWiredExtensions",
      { id: conversationId },
    );
    return res.extensions;
  }

  /** Invoke an extension tool directly via `POST /api/tool-invoke`. A missing
   *  `invocationId` is auto-generated. The extension must already be wired to
   *  the conversation for storage-scoped tools to succeed. A tool-level failure
   *  resolves (not throws) with `{ success: false, error }`; an unknown tool or
   *  a scope/ownership rejection throws `HarnessApiError`. */
  invokeExtensionTool(
    conversationId: string,
    extensionName: string,
    toolName: string,
    input: Record<string, unknown> = {},
    opts: { invocationId?: string; messageId?: string } = {},
  ): Promise<{ success: boolean; output?: unknown; error?: string; [k: string]: unknown }> {
    return this.route("invokeExtensionTool", undefined, {
      conversationId,
      extensionName,
      toolName,
      input,
      invocationId: opts.invocationId ?? crypto.randomUUID(),
      ...(opts.messageId !== undefined ? { messageId: opts.messageId } : {}),
    });
  }

  /** Dispatch a named action on a CORE Hub page
   *  (`POST /api/hub/pages/:id/actions/:action`). Needs the `chat` scope.
   *  `payload` values must be scalars (string | number | boolean). Returns
   *  `{ ok }`, optionally with a freshly rendered `page` tree. */
  triggerHubAction(
    pageId: string,
    action: string,
    payload?: Record<string, string | number | boolean>,
  ): Promise<HubActionResult> {
    return this.route(
      "triggerHubAction",
      { id: pageId, action },
      payload !== undefined ? { payload } : {},
    );
  }

  // ── Loops EZ Mode Phase 4: inbound webhook delivery ────────────────
  /**
   * Deliver an inbound webhook to a loop's webhook trigger
   * (`POST /api/hooks/:extensionId/:slug`). PUBLIC route — auth is the per-hook
   * secret, so this method sends its OWN headers and NEVER attaches the harness
   * `Authorization: Bearer ezk_*` key (which would collide with the hook token).
   * Supply either `token` (→ `Authorization: Bearer <token>`) or `signature`
   * (→ `X-Hub-Signature-256`); the raw `body` is sent verbatim (the exact bytes
   * an HMAC was computed over). Returns `{ accepted, deliveryId }` on 202; any
   * non-2xx throws {@link HarnessApiError} (401/404/413/429).
   */
  async deliverHook(
    extensionId: string,
    slug: string,
    opts: {
      body?: string;
      contentType?: string;
      /** Per-hook secret → `Authorization: Bearer <token>`. */
      token?: string;
      /** Precomputed `X-Hub-Signature-256` value (`sha256=<hex>`). */
      signature?: string;
    } = {},
  ): Promise<{ accepted: boolean; deliveryId: string }> {
    const r = HARNESS_ROUTES.deliverHook;
    const path = buildPath(r.pathTemplate, { extensionId, slug });
    const headers: Record<string, string> = {};
    if (opts.contentType) headers["Content-Type"] = opts.contentType;
    if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
    if (opts.signature) headers["X-Hub-Signature-256"] = opts.signature;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: r.httpMethod,
      headers,
      body: opts.body ?? "",
      redirect: "error",
    });
    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) throw new HarnessApiError(res.status, r.httpMethod, path, parsed ?? text);
    return parsed as { accepted: boolean; deliveryId: string };
  }

  // ── Run-to-completion ──────────────────────────────────────────────
  getRun(runId: string): Promise<Record<string, unknown>> {
    return this.route("getRun", { id: runId });
  }
  /** Block until the run reaches a terminal state (server-side wait). */
  awaitRun(runId: string, timeoutMs = 120_000): Promise<RunResult> {
    const { httpMethod, pathTemplate } = HARNESS_ROUTES.awaitRun;
    return this.request(httpMethod, `${buildPath(pathTemplate, { id: runId })}?wait=1&timeoutMs=${timeoutMs}`);
  }
  /** Cancel an in-flight run (`DELETE /api/runs/:id`). Needs the `chat` scope;
   *  ownership-gated (a non-owner sees 404). `ok` is false-ish via a 404 when
   *  the run isn't running. */
  cancelRun(runId: string): Promise<{ ok: boolean }> {
    return this.route("cancelRun", { id: runId });
  }
  /** Send a message and block until its run finishes. */
  async runToCompletion(conversationId: string, content: string, opts: SendMessageOptions & { timeoutMs?: number } = {}): Promise<RunResult> {
    const { timeoutMs, ...send } = opts;
    const { runId } = await this.sendMessage(conversationId, content, send);
    if (!runId) throw new Error("Message produced no run (action-only or disabled command)");
    return this.awaitRun(runId, timeoutMs);
  }

  // ── Tool-call permission gates ─────────────────────────────────────
  resolveToolPermission(
    toolCallId: string,
    approved: boolean,
    opts: { scope?: "session" | "conversation" | "project" | "forever"; ttlOverrideMs?: number } = {},
  ): Promise<unknown> {
    return this.route("resolveToolPermission", { id: toolCallId }, { approved, ...opts });
  }

  // ── Deterministic mock LLM (test-mode instances only) ──────────────
  scriptLlm(scriptKey: string, turns: MockTurn[]): Promise<unknown> {
    return this.route("scriptLlm", undefined, { scriptKey, turns });
  }
  clearLlmScripts(): Promise<unknown> {
    return this.route("clearLlmScripts");
  }
  /**
   * Convenience: script a deterministic turn list, then drive a message
   * selecting the mock provider, and await the run. `scriptKey` defaults to
   * the conversation id. Uses `permissionMode: "yolo"` so tool turns
   * auto-approve unless overridden.
   */
  async runScripted(
    conversationId: string,
    content: string,
    turns: MockTurn[],
    opts: { scriptKey?: string; permissionMode?: SendMessageOptions["permissionMode"]; timeoutMs?: number } = {},
  ): Promise<RunResult> {
    const scriptKey = opts.scriptKey ?? conversationId;
    await this.scriptLlm(scriptKey, turns);
    return this.runToCompletion(conversationId, content, {
      provider: "ezcorp-mock",
      model: `mock:${scriptKey}`,
      permissionMode: opts.permissionMode ?? "yolo",
      timeoutMs: opts.timeoutMs,
    });
  }

  // ── Observe (SSE) ──────────────────────────────────────────────────
  /**
   * Async iterator over the runtime SSE stream. Pass an AbortSignal to stop.
   * Optional `conversationId` scopes the server-side subscription hint.
   *
   * `lastEventId` asks the server to replay from its resume ring;
   * `onEventId` reports each id as it arrives so a reconnecting caller can
   * feed the next attempt. Both are best-effort — the ring is 500 GLOBAL
   * entries including every `run:token`, so anything that must not be missed
   * is re-read from an authoritative endpoint on reconnect (see
   * {@link HarnessClient.serveCallerTools}).
   */
  async *streamEvents(
    opts: {
      conversationId?: string;
      signal?: AbortSignal;
      lastEventId?: string;
      onEventId?: (id: string) => void;
    } = {},
  ): AsyncGenerator<RuntimeEvent> {
    // Path comes from the shared table; the SSE-specific fetch (streaming body,
    // text/event-stream Accept) stays here.
    const { httpMethod, pathTemplate } = HARNESS_ROUTES.streamEvents;
    const path = buildPath(pathTemplate);
    const qs = opts.conversationId ? `?conversationId=${encodeURIComponent(opts.conversationId)}` : "";
    const sseHeaders: Record<string, string> = { Accept: "text/event-stream" };
    if (opts.lastEventId) sseHeaders["Last-Event-ID"] = opts.lastEventId;
    const res = await this.fetchImpl(`${this.baseUrl}${path}${qs}`, {
      method: httpMethod,
      headers: this.headers(sseHeaders),
      signal: opts.signal,
      // Mirror request(): never follow a 3xx. fetch forwards `Authorization`
      // on a same-origin redirect (only strips it cross-origin), so the real
      // exposure is a same-origin redirect replaying the `ezk_*` bearer
      // token — plus not trusting a response body a redirect could steer us
      // to.
      redirect: "error",
    });
    if (!res.ok || !res.body) throw new HarnessApiError(res.status, httpMethod, path, await res.text().catch(() => ""));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const buf = new SseDataBuffer();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const payload of buf.push(decoder.decode(value, { stream: true }))) {
          if (buf.lastEventId) opts.onEventId?.(buf.lastEventId);
          const evt = safeJson(payload);
          if (evt && typeof evt === "object") yield evt as RuntimeEvent;
        }
      }
    } finally {
      // Cancel, not only release: the server never ends an SSE stream, so a
      // consumer that stops early would otherwise leave the connection open.
      // An already-errored stream rejects with the error the read threw.
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  // ── Serve caller-executed tools ────────────────────────────────────
  /**
   * Run this device as the executor for a conversation's caller tools until
   * `opts.signal` aborts: approve each of THIS conversation's `_caller__*`
   * permission gates, execute the call with the matching handler, POST the
   * result back.
   *
   * `handlers` is keyed by the BARE declared name (`open_app`), not the
   * namespaced runtime name.
   *
   * ── RECOVERY IS A DRAIN, NOT A REPLAY ────────────────────────────────
   *
   * `GET …/active-run` is re-read on EVERY connect and reconnect, BEFORE the
   * event loop starts, and anything it reports as pending is dispatched.
   * That is the authoritative half. `Last-Event-ID` replay is the
   * best-effort half and cannot be relied on: the server's resume ring holds
   * 500 GLOBAL entries including every `run:token`, so a busy instance turns
   * it over in seconds and a `caller:tool-call` from before a five-second
   * blip is simply gone. Dropping the drain would leave a run parked until
   * its gate expired, with no error anywhere.
   *
   * Both halves feed one `toolCallId` dedupe set, so a call delivered by
   * replay AND by drain executes exactly once.
   *
   * ── AN UNKNOWN TOOL IS ANSWERED, NOT IGNORED ─────────────────────────
   *
   * A `caller:tool-call` naming a tool with no handler POSTs a failure
   * result immediately. Ignoring it would park the gate for its whole
   * timeout — minutes of a silently stalled run — to reach the same outcome
   * with less information in it.
   */
  async serveCallerTools(
    conversationId: string,
    handlers: Record<string, CallerToolHandler>,
    opts: ServeCallerToolsOptions = {},
  ): Promise<void> {
    const { signal, onError } = opts;
    const autoApprove = opts.autoApprove ?? true;
    const reconnectDelayMs = opts.reconnectDelayMs ?? 1000;
    /** toolCallIds already dispatched — the drain/replay dedupe. */
    const handled = new Set<string>();
    /** runId → toolCallIds still awaiting a result, dropped on that run's
     *  terminal event so an abandoned call stops being tracked. */
    const openByRun = new Map<string, Set<string>>();

    const post = async (call: CallerToolCall, result: unknown): Promise<void> => {
      await this.submitToolResult(conversationId, call.toolCallId, result);
      openByRun.get(call.runId)?.delete(call.toolCallId);
    };

    const dispatch = async (call: CallerToolCall): Promise<void> => {
      if (call.conversationId !== conversationId) return;
      if (handled.has(call.toolCallId)) return;
      handled.add(call.toolCallId);
      if (handled.size > DEDUPE_CEILING) handled.delete(handled.values().next().value as string);
      let open = openByRun.get(call.runId);
      if (!open) {
        open = new Set();
        openByRun.set(call.runId, open);
      }
      open.add(call.toolCallId);

      const bare = stripCallerNamespace(call.toolName);
      const handler = handlers[bare];
      if (!handler) {
        await post(call, {
          ok: false,
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          error: `No handler registered for caller tool '${bare}'`,
          code: "unknown-tool",
        });
        return;
      }
      try {
        const detail = await handler(call.input, call);
        await post(call, {
          ok: true,
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          detail,
        });
      } catch (err) {
        await post(call, {
          ok: false,
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          error: err instanceof Error ? err.message : String(err),
          code: "rejected",
        });
      }
    };

    const drain = async (): Promise<void> => {
      const active = await this.getActiveRun(conversationId);
      for (const pending of active.pendingCallerTools ?? []) {
        await dispatch(pending);
      }
    };

    let lastEventId: string | undefined;
    while (!signal?.aborted) {
      try {
        // Authoritative recovery FIRST — before a single event is consumed.
        await drain();
        for await (const evt of this.streamEvents({
          conversationId,
          signal,
          lastEventId,
          onEventId: (id) => {
            lastEventId = id;
          },
        })) {
          if (evt.type === "caller:tool-call") {
            const call = asCallerToolCall(evt.data);
            if (call) await dispatch(call);
          } else if (evt.type === "tool:permission_request") {
            const toolName = evt.data.toolName;
            const toolCallId = evt.data.toolCallId;
            if (
              autoApprove &&
              // Same scope check `dispatch` opens with, and for the same
              // reason: the SSE stream is USER-scoped, not conversation-scoped
              // (the `conversationId` query param is a cache-key hint), so this
              // connection carries the gates of every conversation the key's
              // user owns. Without this, one serve loop with `autoApprove` on
              // would answer the gates of a second loop that deliberately left
              // it off for a human to decide. The comparison is against a
              // `string` parameter, so a missing or non-string id fails it —
              // an unattributable gate is never ours to approve.
              evt.data.conversationId === conversationId &&
              typeof toolName === "string" &&
              toolName.startsWith(CALLER_TOOL_NAMESPACE) &&
              typeof toolCallId === "string"
            ) {
              try {
                await this.resolveToolPermission(toolCallId, true);
              } catch (err) {
                // A refused approval is this gate's problem, not the stream's:
                // throwing here would unwind the `for await` and drop the
                // connection, so report it the way a transport error is
                // reported and keep serving.
                onError?.(err);
              }
            }
          } else if (TERMINAL_RUN_EVENTS.has(evt.type)) {
            // Per-runId drop: this run's gates are gone, so anything of its
            // that is still open can never be answered.
            if (typeof evt.data.runId === "string") openByRun.delete(evt.data.runId);
          }
        }
      } catch (err) {
        if (signal?.aborted) break;
        onError?.(err);
      }
      if (signal?.aborted) break;
      await sleep(reconnectDelayMs, signal);
    }
  }
}

/** Run-terminal events, after which a run's pending caller tools are dead. */
const TERMINAL_RUN_EVENTS: ReadonlySet<string> = new Set([
  "run:complete",
  "run:error",
  "run:cancel",
]);

/** Abortable delay — resolves early (not rejects) when the signal fires, so
 *  the serve loop's own `aborted` check decides what happens next. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
