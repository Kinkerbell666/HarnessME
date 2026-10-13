// ── Re-exported pi-ai types ──────────────────────────────────────────
// Downstream code imports from here for convenience

export type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ThinkingContent,
  ImageContent,
  ToolCall,
  Context,
  Tool,
  Usage,
  AssistantMessageEvent,
  Model,
} from "@earendil-works/pi-ai";

export type { KnownProvider } from "@earendil-works/pi-ai";

// ── Provider Name ────────────────────────────────────────────────────
// Open-ended string to support all 20+ pi-ai providers

export type ProviderName = string;

// ── Capability & Status ──────────────────────────────────────────────

export type AgentCapability = "llm" | "shell" | "file" | "http" | "agent" | "custom";

export type AgentStatus = "idle" | "running" | "success" | "error" | "cancelled";

// ── Logging ──────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AgentLog {
  timestamp: number;
  level: LogLevel;
  message: string;
}

// ── Provider Interfaces ──────────────────────────────────────────────

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ShellOptions {
  cwd?: string;
  quiet?: boolean;
  timeout?: number;
}

export interface ShellProvider {
  run(command: string, options?: ShellOptions): Promise<ShellResult>;
}

export interface FileProvider {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

// ── Agent Context & Result ───────────────────────────────────────────

export interface AgentContext {
  input: Record<string, unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: the public agent-authoring surface: a code-based agent's `llm` is whichever wrapper the runtime installed, and narrowing it here would pin every third-party agent to one adapter's shape.
  llm: any; // Code-based agents receive an LLM wrapper; typed as any for flexibility
  shell: ShellProvider;
  file: FileProvider;
  log(message: string, level?: LogLevel): void;
  signal: AbortSignal;
  run(agentName: string, input: Record<string, unknown>): Promise<AgentResult>;
  tools?: {
    invoke(toolName: string, input: Record<string, unknown>): Promise<unknown>;
  };
}

export interface AgentResult {
  success: boolean;
  output: unknown;
  /**
   * Either a free-form string (legacy/agent-thrown failures) or a
   * structured discriminator used by the cancel paths. The cancel path
   * populates `{ code: "cancelled" | "swallowed_abort", message }` so
   * downstream consumers can distinguish a well-behaved abort (agent
   * threw on `ctx.signal`) from a swallowed abort (agent resolved
   * despite the signal). See cancelRun / runAgent in
   * src/runtime/executor.ts and the parity branch in
   * src/runtime/stream-chat/finalize.ts.
   */
  error?: string | { code: string; message: string };
}

// ── Input Schema ────────────────────────────────────────────────────

export type InputFieldType = "string" | "text" | "number" | "boolean" | "select" | "file-path" | "custom";

export interface InputField {
  type: InputFieldType;
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: string[];       // for "select" type
  component?: string;       // for "custom" type: filename in web/src/lib/custom/
}

export type InputSchema = Record<string, InputField>;

// ── Agent Definition ─────────────────────────────────────────────────

export interface AgentDefinition {
  name: string;
  description: string;
  capabilities: AgentCapability[];
  inputSchema?: InputSchema;
  execute(ctx: AgentContext): Promise<AgentResult>;
}

// ── Agent Run ────────────────────────────────────────────────────────

export interface AgentRun {
  id: string;
  agentName: string;
  projectId?: string;
  provider?: string;
  /** Model id the run's LLM call actually resolved to. Populated on the
   *  `runAgent` path from the pi-ai adapter's last resolution (see
   *  `createPiLlmAdapter`); undefined for a run that never called an LLM.
   *  `provider` is the matching half. */
  model?: string;
  /** Tokens this run's LLM call(s) reported, summed across every call.
   *  Populated on the `runAgent` path from the pi-llm adapter's running
   *  total; **undefined — never 0 — when nothing reported usage** (a run
   *  that never touched `ctx.llm`, a cached response, a stream that
   *  errored before its `done` frame). Zero is a claim that deflates
   *  every aggregate summing it; undefined becomes SQL NULL, which every
   *  SQL aggregate already ignores. */
  inputTokens?: number;
  outputTokens?: number;
  status: AgentStatus;
  startedAt: number;
  finishedAt?: number;
  logs: AgentLog[];
  result?: AgentResult;
  memoriesUsed?: { id: string; content: string; category: string }[];
}

// ── Agent Config (declarative) ──────────────────────────────────────

export interface AgentConfig {
  name: string;
  description: string;
  capabilities: AgentCapability[];
  inputSchema?: InputSchema;
  prompt: string;
  outputFormat?: "text" | "json";
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ── Workflow ─────────────────────────────────────────────────────────
//
// A workflow is a named graph of steps. Steps come in three kinds:
//   - `agent`     — invoke a named agent (the only historical kind).
//   - `transform` — a pure, declarative data reshape (no LLM, no I/O).
//   - `gate`      — evaluate a declarative condition; throw if it fails.
// Steps may `loop` (bounded repetition with an until-condition). The word
// "pipeline" is retained only as a hidden CLI alias + legacy YAML glob.

/** Comparison operator for a leaf {@link WorkflowCondition}. Comparisons
 *  on non-numbers evaluate to `false` (never throw). `contains` covers
 *  string-substring and array-includes; `exists` = not undefined/null;
 *  `truthy` = JS truthiness. */
export type WorkflowConditionOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "exists"
  | "truthy";

/** Declarative condition tree evaluated by `gate` steps and loop `until`
 *  clauses. A leaf resolves `ref` (a `$input.` / `$prev.` / `$steps.` ref,
 *  plus `$result.` / `$iteration` inside a loop `until`) and compares it
 *  against `value`; `all` / `any` / `not` compose leaves. Never evaluates
 *  arbitrary code — this is a security constraint (spec §Design 2). */
export type WorkflowCondition =
  | { ref: string; op: WorkflowConditionOp; value?: unknown }
  | { all: WorkflowCondition[] }
  | { any: WorkflowCondition[] }
  | { not: WorkflowCondition };

/** Bounded per-step repetition. `maxIterations` is REQUIRED and
 *  server-clamped to 1..25. `until` is evaluated AFTER each iteration; when
 *  satisfied the loop exits successfully. `onExhausted` decides the
 *  budget-exhausted outcome — default `"fail"` (loud; never a silent
 *  truncation). Mutually exclusive with `retries`; invalid on `gate`. */
export interface LoopConfig {
  maxIterations: number;
  until?: WorkflowCondition;
  onExhausted?: "fail" | "pass";
}

/**
 * `workflow` runs a NESTED definition as one step of this graph. It is the
 * only kind whose body is another workflow, which is why it is also the
 * only kind added to the `loop` allow-list: looping a graph that contains
 * an LLM or a gate is bounded re-execution, while looping a raw
 * side-effecting `tool` call is not — and that ban is unchanged.
 */
export type WorkflowStepKind =
  | "agent"
  | "transform"
  | "gate"
  | "tool"
  | "approval"
  | "workflow";

/**
 * What happens to an `approval` step whose `timeoutMs` elapses.
 *
 * `abort` is the default and the only safe one to default to: an approval
 * that silently became `approve` because nobody looked at it is a consent
 * bypass, and defaults are exactly where those hide. The other two exist
 * because some gates genuinely are advisory, but an author has to say so.
 */
export type ApprovalTimeoutPolicy = "abort" | "approve" | "skip";

/**
 * The result an answered `approval` step contributes to `$steps`.
 *
 * The shape is FIXED and every field is always present, because
 * `workflow-refs.ts` resolves refs strictly: a downstream
 * `$steps.gate.output.form` against an answer that happened to omit a
 * form would throw at run time, long after the definition was written.
 * `form` is `{}` and `itemIds` is `[]` rather than absent.
 */
export interface ApprovalStepOutput {
  /** The choice the human picked. Always one the definition declared. */
  choice: string;
  /** Structured answer fields, `{}` when the step declared no form. */
  form: Record<string, unknown>;
  /** The items the answer named, `[]` when none were required. */
  itemIds: string[];
  /** User id of the answerer; null for a timeout-synthesized answer. */
  answeredBy: string | null;
  /** ISO-8601. Set for a timeout answer too — something did decide. */
  answeredAt: string;
}

/**
 * Reasoning-effort level a model binding may request. Mirrors pi-ai's
 * `ThinkingLevel` verbatim — the value is handed to `completeSimple` /
 * `streamSimple`, which normalize it into each provider's own knob
 * (`reasoningEffort` on OpenAI, a thinking budget on Anthropic, …).
 *
 * There is deliberately no `"off"`: the `runAgent` LLM path sends no
 * reasoning option at all unless one is asked for, so "off" IS the
 * default and a value for it would only be a second way to spell it.
 */
export type ModelEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * A RESOLVED model binding that overrides whatever the callee would
 * otherwise use. Every value here is concrete — refs are already gone.
 *
 * Every field is optional and independently applied: an override naming
 * only `model` keeps the agent's own `provider`, and an ABSENT override
 * (undefined) leaves the callee's binding untouched — including the
 * {@link CURRENT_MODEL_SENTINEL} inherit sentinel — so today's behaviour
 * is unchanged wherever no override is supplied.
 */
export interface ModelOverride {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  effort?: ModelEffort;
}

/**
 * A model binding as WRITTEN IN A WORKFLOW DEFINITION — the same fields,
 * except that the string ones may be refs (`{ effort: "$input.tier" }`)
 * whose value does not exist until the run resolves them. That is the one
 * and only difference from {@link ModelOverride}, and it is why `effort`
 * widens to `string` here: a ref is not an effort level, and typing it as
 * one would make the ref language unusable in a binding.
 *
 * `resolveModelOverride` is the crossing point: a `WorkflowModelBinding`
 * goes in, a fully-concrete `ModelOverride` comes out (or a loud throw).
 * `temperature` / `maxTokens` are numbers and therefore never refs.
 */
export interface WorkflowModelBinding extends Omit<ModelOverride, "effort"> {
  effort?: string;
}

/**
 * State of a workflow run. Extends the agent `AgentStatus`
 * union with ONE workflow-only state:
 *
 *   `awaiting_approval` — the graph ran every step it could run without a
 *   human, then hit a step whose capability needs interactive consent
 *   (a sensitive-capability PDP `prompt`, which nobody can answer in a
 *   workflow — there is no conversation). It is NOT `success` (nothing
 *   was approved and the remaining steps never ran) and NOT `error`
 *   (nothing went wrong — the run is simply blocked on a human). Callers
 *   that branch on `=== "success"` (the CLI's exit code, the run route's
 *   consumers) therefore treat it as a non-success outcome for free.
 *
 *   `suspended` — the run PARKED at a step boundary and is safe to
 *   resume. The ONLY non-terminal, non-`running` state: no process owns
 *   the run, its {@link WorkflowCursor} records where to pick up, and a
 *   resume continues it in place.
 *
 * `suspended` deliberately does NOT reuse `awaiting_approval`, whose
 * meaning is unchanged: parked AND dead. Reusing it would retroactively
 * make every historical `awaiting_approval` row look resumable.
 *
 *   `skipped` — **a STEP status only.** The step's `when` evaluated false,
 *   or a step it depends on was skipped. Nothing ran, nothing failed, and
 *   the RUN keeps going: that is the entire distinction from `gate`, which
 *   throws. A *run* never terminalizes `skipped` — the union is shared by
 *   {@link WorkflowRun} and {@link WorkflowStepRun}, and
 *   `TerminalWorkflowRunStatus` (`db/queries/workflow-runs.ts`) is the
 *   narrower type that says so for runs.
 */
export type WorkflowRunStatus =
  | AgentStatus
  | "awaiting_approval"
  | "suspended"
  | "skipped";

/**
 * Which side of a step boundary the executor was on when it last wrote.
 *
 * Written synchronously and STRICTLY (never through the error-swallowing
 * telemetry path) around the batch dispatch, so crash recovery never has
 * to guess:
 *
 *   `boundary`  — between batches. Nothing is in flight; the cursor is
 *                 authoritative and the run can be resumed from it.
 *   `in-batch`  — a batch is mid-flight. An LLM call or a side-effecting
 *                 `tool` dispatch may be half-applied, so a crash here
 *                 FAILS CLOSED rather than re-entering a half-executed
 *                 step.
 *
 * The recovery sweep selects on one predicate (an expired lease) and
 * branches its ACTION on this column — that is what keeps the sweep dumb
 * without lying about the run's status.
 */
export type WorkflowRunPhase = "boundary" | "in-batch";

/**
 * Where a suspended/orphaned run resumes from.
 *
 * `batchIndex` is a stable coordinate because `resolveExecutionOrder` is
 * pure and deterministic: the no-deps path emits one step per batch in
 * declaration order, and the topo path iterates `steps` in declaration
 * order within each batch. Recomputing it on resume from the same
 * definition yields byte-identical batches — which is also why a resume
 * against a CHANGED definition must fail closed (`definition_hash`).
 */
export interface WorkflowCursor {
  /** Index of the next batch to execute. */
  batchIndex: number;
  /** Every step name completed so far, in completion order. */
  completedSteps: string[];
  /**
   * The step whose result is `$prev` for `batchIndex`.
   *
   * Recorded rather than recomputed on purpose. Today `$prev` is
   * `results[results.length - 1]` — the LAST step of the previous batch
   * in declaration order, which is documented as order-fragile in
   * parallel batches. Reproducing that exactly is the point: making
   * `$prev` graph-deterministic on resume would give a resumed run a
   * different `$prev` than the same run straight through, which is a far
   * worse bug than the documented fragility.
   */
  prevStepName: string | null;
}

export interface WorkflowStep {
  name: string;
  /** Defaults to `"agent"` — every legacy pipeline step stays valid with
   *  zero edits. */
  kind?: WorkflowStepKind;

  // ── agent kind ──
  agent?: string;
  /** Input mapping. Shared by the `agent` and `tool` kinds — both resolve
   *  it through the SAME ref language (`workflow-refs.ts`); a tool step
   *  passes the resolved object straight through as the tool's arguments. */
  input?: Record<string, string>;
  /**
   * Per-step retry budget (agent kind only). When a step's agent run
   * finishes unsuccessfully, the executor re-runs it up to `retries` more
   * times before failing the whole workflow. Clamped to 0..2; absent /
   * invalid ⇒ 0 (no retry). A run that was *cancelled* (workflow abort or
   * sibling-failure cancel) is never retried — only a genuine failure is.
   * Mutually exclusive with `loop`.
   */
  retries?: number;

  // ── transform kind ──
  /** Output mapping resolved with the step-input ref language PLUS
   *  `{{…}}` template interpolation. Produces an `AgentResult`-shaped
   *  `{ success: true, output: <resolved object> }`. */
  output?: Record<string, string>;

  // ── gate kind ──
  /** Condition evaluated by a gate step; false ⇒ the workflow fails. */
  condition?: WorkflowCondition;

  // ── tool kind ──
  /**
   * Runtime-namespaced extension tool name (`<extension>__<tool>`, e.g.
   * `extension-author__create_extension`) dispatched through
   * `ToolExecutor.executeToolCall`. Mutually exclusive with `agent` — a
   * tool step invokes a deterministic tool, never an LLM.
   */
  tool?: string;

  /**
   * Per-step model binding (agent kind only) — the step's agent runs on
   * THIS model instead of the one its config declares, so one workflow
   * can mix a cheap extractor with an expensive validator. Overrides the
   * definition's {@link WorkflowDefinition.defaultModel}; absent on both
   * ⇒ the agent's own binding, byte-for-byte as before.
   *
   * Values may be refs (`{ model: "$input.verifyModel" }`), resolved with
   * the same ref context as the step's `input`. Rejected at definition
   * time on any non-agent step.
   */
  model?: WorkflowModelBinding;

  // ── approval kind ──
  /** What the human is being asked. Required on an `approval` step. */
  prompt?: string;
  /**
   * The answers the definition allows. Required and non-empty on an
   * `approval` step; an answer outside this set is rejected, never
   * coerced, so the set is also the contract downstream `$steps` refs
   * read against.
   */
  choices?: string[];
  /** RBAC scope gating who may answer. Absent ⇒ project members. The
   *  check is fail-closed: a throw is a DENY. */
  rbacScope?: string;
  /** Optional structured fields collected alongside the choice. */
  formSchema?: Record<string, unknown>;
  /**
   * Require the answer to NAME the items it acts on. Paired with
   * {@link itemsRef}: with nothing to consent to the requirement is
   * vacuous, which is deliberate — a clean gate answers ids-free.
   */
  requireItemConsent?: boolean;
  /**
   * Ref to the items REQUIRING CONSENT (e.g. `$steps.review.output.asks`),
   * resolved AT SUSPEND TIME so the answer is checked against what the
   * run actually produced rather than what the definition hoped for.
   */
  itemsRef?: string;
  /** Park for at most this long before {@link onTimeout} applies. */
  timeoutMs?: number;
  /** Default `abort` — see {@link ApprovalTimeoutPolicy}. */
  onTimeout?: ApprovalTimeoutPolicy;

  // ── workflow kind ──
  /**
   * Name of the NESTED definition this step runs — resolved through the
   * same merged cache the top-level run route uses, so an extension
   * workflow is addressed by its namespaced `<ext>:<name>`.
   *
   * **A LITERAL name, never a ref.** `$input.child` and
   * `$steps.pick.output.name` are rejected at definition time
   * (`isResolvableWorkflowName`, enforced in `validateWorkflow`), and the
   * executor uses this string verbatim as its lookup key. The ref language
   * could resolve one — refusing is the choice, because the nesting cycle
   * check and the depth cap are definition-time checks that a run-time name
   * makes uncomputable, and because C3's delegated-execution consent hashes
   * the transitive closure of nested workflows: a graph that picks its own
   * children cannot be consented to.
   *
   * The child is a first-class run: its own `workflow_runs` row, its own
   * cursor, its own `definition_hash`, and its own `parent_run_id`
   * pointing here. That independence is what lets a nested graph containing
   * an `approval` step park on its own while the parent parks alongside it.
   */
  workflow?: string;

  // ── control flow (any kind) ──
  /**
   * Guard evaluated BEFORE the step dispatches. False ⇒ the step is
   * `skipped` and **the run continues**.
   *
   * The whole distinction from `condition` (gate): a false gate THROWS and
   * fails the run — there was no way to say "skip this branch" before this.
   * Same {@link WorkflowCondition} grammar and the same `evaluateCondition`,
   * against the same ref context the step's `input` would have used.
   *
   * On a step that also declares `loop`, evaluated ONCE, before the loop —
   * a per-iteration guard is `loop.until`, not this.
   */
  when?: WorkflowCondition;
  /**
   * Skip this step's declared dependents too when it is skipped. Default
   * **true**, because that is the only reading that keeps a graph
   * consistent: a step exists to consume what its dependency produced, and
   * running it against a value nobody produced is the silent-wrong-answer
   * outcome this subsystem refuses everywhere else.
   *
   * `false` opts a step out — its dependents run anyway — which is only
   * safe when they do not read `$steps.<this step>`. `validateWorkflow`
   * enforces exactly that at definition time.
   */
  skipDependents?: boolean;

  dependsOn?: string[];
  /** Bounded loop (agent | transform | workflow kinds only). */
  loop?: LoopConfig;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  inputSchema?: InputSchema;
  /** Model binding applied to every `agent` step that does not declare its
   *  own {@link WorkflowStep.model}. Whole-bundle fallback, NOT a
   *  field-by-field merge: a step that names `model` replaces this
   *  entirely, so a step can drop back to the provider default without
   *  inheriting a definition-level `maxTokens` it never asked for. */
  defaultModel?: WorkflowModelBinding;
  steps: WorkflowStep[];
  /**
   * Render the run's own final output (`$steps.<last>.output` — the same
   * value `run.result.output` carries) into human-readable text,
   * deterministically. Optional: absent ⇒ the run's `result` is unchanged
   * from before this field existed (**backward compatible**).
   *
   * Same `{{ ref }}` interpolation `transform` steps already use
   * (`interpolateTemplate`, `workflow-refs.ts`) — reused verbatim, not a
   * second templating engine — but scoped to exactly ONE ref root,
   * `$output[.path]`, addressing the final output object rather than any
   * step's. `validateWorkflow` rejects every other root at save time, and
   * `$output` itself is always LENIENT (a missing path renders empty,
   * never throws) — rendering is a pure, best-effort function of `output`
   * and must never be able to fail the run it describes.
   *
   * Rendered ONLY on a `success` terminal status, into
   * `WorkflowRun.result.renderedOutput` — a NEW, additive field. The raw
   * `output` this was rendered from is never replaced or hidden: the card
   * that renders `renderedOutput` still shows the verbatim JSON `result`
   * beside it, unmodified. That is load-bearing — see
   * `workflow-run-card-logic.ts`'s header comment for why a deterministic
   * result must never be re-rendered by anything that can drift from it.
   *
   * Every workflow string is attacker-controlled (`POST /api/workflows`
   * needs only the `chat` scope, and workflows are global), so this crosses
   * TWO trust boundaries and each has its own defence:
   *
   *   - The BROWSER. The host renders `renderedOutput` as PLAIN TEXT —
   *     never markdown, never HTML — exactly like every other
   *     author-supplied string this subsystem interpolates into a surface
   *     someone else's browser renders (`mention-wiring.ts`'s
   *     `sanitizeNoteValue`). Here "plain text, no exceptions" IS the whole
   *     of the DOM-XSS defence — see `WorkflowRunCard.svelte`.
   *   - The MODEL. `run_workflow`'s tool result also carries
   *     `renderedOutput` straight into the calling model's own context, in
   *     the SAME turn — a second-order prompt-injection surface the DOM
   *     defence above does nothing for (Svelte's text binding stops a
   *     forged `<script>`, not a forged "SYSTEM: …" sentence an LLM reads
   *     as an instruction). That surface is marked, not escaped: the
   *     projection carries a sibling `renderedOutputNote` field whenever
   *     `renderedOutput` is non-null (`RENDERED_OUTPUT_UNTRUSTED_NOTE`,
   *     `runtime/tools/run-workflow.ts`), and the tool's own description
   *     repeats the warning before the model ever sees a result.
   *
   * `outputTemplate` cannot influence what a run DOES even under
   * composition: a `kind: "workflow"` step's `renderedOutput` is stripped
   * before the child's result becomes the parent's `$steps.<name>` value
   * (`nestedOutcome`, `workflow-executor.ts`) — see **Composition** in
   * `docs/features/orchestration/workflows.md`.
   */
  outputTemplate?: string;
  /**
   * Which loader produced this definition. Stamped by the loader itself —
   * NEVER read from the YAML/JSON a definition was parsed out of, so an
   * extension asset that declares `source: db` is overwritten, not trusted.
   *
   * `canRunWorkflow` dispatches on it: the alternative (looking the name up
   * in `workflow_definitions` to infer the source) is wrong, because on a
   * YAML/DB name collision the YAML entry wins execution — authz would gate
   * a different object than the executor runs.
   *
   * Optional because a definition can also be hand-built (tests, an ad-hoc
   * caller); an absent source falls through to the permissive default.
   *
   * NOTE: `GET /api/workflows` serves this field, and
   * `workflowBodySchema` is `.strict()` — never echo it back into a `PUT`.
   */
  source?: "extension" | "yaml" | "db";
}

/**
 * Who a DB-backed workflow belongs to.
 *
 * Deliberately NOT a field on {@link WorkflowDefinition}, which is the
 * shape of the GRAPH and is shared by YAML- and extension-shipped
 * workflows that have no owner, by `runWorkflow`, by the CLI and by
 * `validateWorkflow`. Provenance travels alongside the definition on
 * `CachedWorkflow` instead (`src/runtime/workflow-scope.ts`).
 *
 *   `system`  — ships with the install. No project, no owner. Any `chat`
 *               caller may run it; only an admin may edit it. Every row
 *               that predates C6 is this, which is why adding the ladder
 *               changed no existing caller's access. Written by the
 *               ordinary create route and by `systemCachedWorkflow`.
 *   `project` — carries a project id and a creator. The platform has no
 *               project-membership model, so on the read/run axis this
 *               admits EVERY AUTHENTICATED PRINCIPAL — see
 *               `WorkflowAudience` in `src/runtime/workflow-scope.ts`.
 *               Its real content is the EDIT boundary it holds (the
 *               creator, which `system` has no room for). Written by
 *               fork, by the admin claim route, and by an author who
 *               names it on create.
 *   `private` — owner and admins only, and the one tier narrower than
 *               "everyone with a login": the platform's only workflow
 *               confidentiality boundary. Reachable since `visibility`
 *               became a selectable key on the create/update body — the
 *               author names it, and no extra right is needed, because
 *               choosing a NARROWER audience for your own row grants
 *               nobody anything. (`system`, which does, is admin-only to
 *               assign: `denyVisibilityAssignment`.) Which tiers are
 *               reachable and what each is worth is pinned by
 *               `src/__tests__/workflow-visibility-reach.test.ts`.
 */
export type WorkflowVisibility = "system" | "project" | "private";

/**
 * A workflow run's `result` — an {@link AgentResult} plus the OPTIONAL text
 * a definition's `outputTemplate` rendered from `output`. Its own type
 * (rather than widening {@link AgentResult} itself) because `AgentResult`
 * is the generic per-agent-run shape too, and a plain agent run has no
 * template to render — adding the field there would be a workflow-only
 * concept leaking into every `AgentRun` in the codebase.
 *
 * `renderedOutput` is present ONLY on a `success` run whose definition
 * declared `outputTemplate` — every other run's `result` carries no such
 * field, byte-identical to what it was before this type existed
 * (**backward compatible**).
 */
export interface WorkflowRunResult extends AgentResult {
  renderedOutput?: string;
}

export interface WorkflowRun {
  id: string;
  workflowName: string;
  projectId?: string;
  status: WorkflowRunStatus;
  startedAt: number;
  finishedAt?: number;
  steps: WorkflowStepRun[];
  result?: WorkflowRunResult;
}

export interface WorkflowStepRun {
  stepName: string;
  /** Owning `runs.id` for an `agent` step. `""` for transform / gate /
   *  tool steps, which mint no AgentRun (persisted as SQL NULL). */
  runId: string;
  status: WorkflowRunStatus;
  /** Final iteration count for a looped step (omitted for non-loop steps). */
  iterations?: number;
  /**
   * Why a `skipped` step was skipped — its own `when`, or the name of the
   * skipped dependency that suppressed it.
   *
   * Carried on the step run (and therefore on the `workflow:step` SSE
   * frame) rather than left to the reader to infer, because a trace showing
   * a skipped step with no explanation is indistinguishable from a step
   * that was never reached. Omitted for every other status.
   *
   * Persisted to `workflow_step_runs.skipped_reason` by
   * `upsertWorkflowStepRun` and read back by the run trace, so a reloaded
   * trace explains a skip rather than showing a bare `status = 'skipped'`.
   */
  skippedReason?: string;
  /** Provider / model the step's agent run RESOLVED to — what actually
   *  served the call, not what was requested (a `$input` ref, an
   *  agent-config binding and a bare model id all land here identically).
   *  Undefined for a step that ran no LLM (transform / gate / tool, or an
   *  agent whose `execute` never touched `ctx.llm`). */
  provider?: string;
  model?: string;
  /** Agent invocations this step consumed. Counts retries AND loop
   *  iterations, so for a looped step it is the total number of LLM
   *  calls, not the iteration count — `iterations` is that. Undefined
   *  for a step that invokes no agent. */
  attempt?: number;
  /** Tokens this step consumed, SUMMED across its retries and loop
   *  iterations — overwriting per attempt would undercount a step that
   *  retried. Contrast `provider`/`model`, which are deliberately
   *  last-write: "what served the call" has one answer, "what did this
   *  step cost" is a total.
   *
   *  Undefined — never 0 — when nothing reported usage. See
   *  `AgentRun.inputTokens`. */
  inputTokens?: number;
  outputTokens?: number;
  /** Typed failure reason, stable enough to GROUP BY — unlike a message.
   *  Derived from the exception CLASS the step threw, so it says which
   *  kind of ending this was (`cancelled`, `approval-required`,
   *  `suspended`, `step-failed`) rather than restating the text. */
  errorCode?: string;
}

/**
 * Out-of-band sink for a step's RESOLVED INPUT, on its way to
 * `workflow_step_runs.resolved_input`.
 *
 * **Deliberately not a field on {@link WorkflowStepRun}.** That object is
 * a published SSE payload, and this value is the raw mapping the ref
 * language produced — whatever the author threaded through `$input`,
 * credentials included. It is redacted and capped by
 * `prepareResolvedInput` on the way into the row; putting it on the event
 * stream would publish it unredacted to every subscribed client.
 *
 * The same reasoning already keeps a step's `output` off the payload.
 */
export interface WorkflowStepInputSink {
  resolvedInput?: Record<string, unknown>;
}

/* NOTE: a step's `durationMs` is deliberately NOT a field on
 * {@link WorkflowStepRun} either, for a second and independent reason: it
 * is a CLOCK READING, and this object is compared byte-for-byte by the
 * demo-workflow determinism test ("a transform/gate-only workflow is a
 * pure function — no LLM, no I/O, no clock"). Putting a wall-clock value
 * on a published payload makes two identical runs differ whenever they
 * straddle a millisecond. It lives in the executor's per-step closure and
 * goes straight to the column. */

// ── Team Member Types ────────────────────────────────────────────────

/** Sentinel value meaning "use the parent conversation's current model/provider." */
export const CURRENT_MODEL_SENTINEL = "__current__";

export interface TeamMemberOverrides {
  permissionMode?: "ask" | "auto-edit" | "yolo";
  toolRestriction?: "all" | "read-only" | "none";
  modeId?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  provider?: string;
  model?: string;
  systemPromptAppend?: string;
}

export interface TeamMember {
  agentConfigId: string;
  overrides?: TeamMemberOverrides;
  subAgents?: TeamMember[];
}

/**
 * Team-level tool scoping applied to every invoked member of the team.
 * When set (either list non-empty), overrides each member's individual
 * `toolRestriction` / `allowedTools` / `deniedTools`. Orchestration tools
 * (invoke_agent, task tracking, scratchpad) are always preserved.
 */
export interface TeamToolScope {
  /** If set & non-empty, only these tool names are available to members. */
  allowedTools?: string[];
  /** Tool names always filtered out (applied after allow list). */
  deniedTools?: string[];
}

// ── Events ───────────────────────────────────────────────────────────

export interface AgentEvents {
  [key: string]: unknown;
  // `runId` duplicates `run.id` so SSE clients get a top-level `data.runId`
  // to correlate on (parity with `run:status`), without traversing `data.run`.
  "run:start": { run: AgentRun; runId: string };
  "run:log": { runId: string; log: AgentLog };
  "run:complete": { run: AgentRun; conversationId?: string };
  "run:error": { run: AgentRun; error: string; conversationId?: string; runId: string };
  "run:cancel": { run: AgentRun; conversationId?: string };
  "run:status": { runId: string; status: string };
  "run:token": { runId: string; token: string; kind?: "thinking" | "text" };
  "run:usage": {
    runId: string;
    usage: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      /** Subset of `cacheWrite` written with 1h retention (Anthropic-only split). */
      cacheWrite1h?: number;
      totalTokens: number;
      cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        total: number;
      };
    };
  };
  // `userId` (Wave 0) names the initiating user so the SSE filter can
  // scope delivery fail-closed. CLI-triggered workflows omit it and are
  // not SSE-observable (stdout/DB only).
  "workflow:start": { workflowRun: WorkflowRun; userId?: string };
  "workflow:step": { workflowRun: WorkflowRun; step: WorkflowStepRun; userId?: string };
  "workflow:complete": { workflowRun: WorkflowRun; userId?: string };
  "workflow:error": { workflowRun: WorkflowRun; error: string; userId?: string };
  /**
   * A run just parked on an `approval` step and a human has to decide.
   *
   * Emitted alongside the `workflow:error` suspend signal rather than
   * folded into it, because the two answer different questions: that one
   * says "this run stopped", this one says "and YOU can unblock it".
   * Everything the tray card renders rides here, so the surface can paint
   * the moment the run parks without a round-trip.
   *
   * `userId` is the run's owner and is what the fail-closed SSE filter
   * scopes on. It is OPTIONAL because an unowned run (CLI, extension
   * trigger with no acting user) has nobody to notify — the filter drops
   * an event with no user rather than broadcasting a prompt that names
   * what is about to be done and to what.
   */
  "workflow:approval_request": {
    approvalId: string;
    workflowRunId: string;
    workflowName: string;
    stepName: string;
    prompt: string;
    choices: string[];
    requireItemConsent: boolean;
    itemIds: string[];
    expiresAt: string | null;
    userId?: string;
  };
  "tool:start": { conversationId: string; extensionId: string; toolName: string; input: unknown; timestamp: number; source?: 'inline' | 'agent-run'; invocationId?: string; cardType?: string; cardLayout?: string; category?: string };
  "tool:complete": { conversationId: string; extensionId: string; toolName: string; output: unknown; duration: number; success: boolean; source?: 'inline' | 'agent-run'; invocationId?: string; cardType?: string; cardLayout?: string };
  "tool:error": { conversationId: string; extensionId: string; toolName: string; error: string; duration: number; source?: 'inline' | 'agent-run'; invocationId?: string; cardType?: string; cardLayout?: string };
  "tool:permission_request": {
    conversationId: string;
    toolCallId: string;
    toolName: string;
    input: unknown;
    cardType?: string;
    cardLayout?: string;
    category?: string;
    /**
     * Phase 6 H7: owning user id. The SSE filter at
     * `runtime-events/+server.ts` cross-checks this against the
     * subscriber so a permission prompt fires only on the originating
     * user's UI session — never cross-tab / cross-user.
     */
    userId?: string;
    /**
     * Phase 6: extension-scoped permission request marker. When set,
     * the event was emitted by the PDP's `prompt` branch in
     * `tool-executor.ts` and the UI MUST render the four-scope chooser
     * (session/conversation/project/forever) plus the extension's
     * display name + capability description.
     */
    extensionId?: string;
    /** Sensitive capability kind that triggered the prompt. Used by the
     *  modal to render a human-readable description of what's being
     *  requested. */
    capabilityKind?: import("./extensions/capability-types").SensitiveCapabilityKind;
    /** Sensitive capability value (for `fs.write` it's the concrete
     *  path). Empty / undefined for `shell`. */
    capabilityValue?: string;
    /** PDP prompt id — becomes the `toolCallId` here so the existing
     *  `/api/tool-calls/:id/permission` route resolves the gate
     *  unchanged. Mirrors the gate key for clarity. */
    promptId?: string;
  };
  "tool:kill": { toolCallId: string };
  "tool:permission_mode_change": { conversationId: string; mode: string };
  /**
   * agent-install-ux-polish Phase 2 (D3): a lightweight, USER-SCOPED
   * signal that an agent-driven extension install just succeeded.
   * Emitted host-side from the `ezcorp/drafts` install path AFTER
   * `registry.reload()`, best-effort (D6 — emitting it must never
   * fail or delay the install). Carries NO `conversationId` — it is a
   * cross-surface "your Library is stale" nudge, scoped to the
   * installing user ONLY. Delivery is gated by `shouldDeliverEvent`'s
   * `userId` branch (mirrors `tool:permission_request`'s H7 scoping):
   * never broadcast, never cross-user.
   */
  "extensions:installed": {
    userId: string;
    extensionId: string;
    name: string;
  };
  /**
   * Daily Briefing Phase 1: a server-initiated conversation was created
   * on the user's behalf (the briefing pipeline today; any future
   * server-side creator can reuse it via `source`). USER-scoped like
   * `extensions:installed` — the SSE filter delivers it ONLY to the
   * owning `userId` and FAILS CLOSED on a missing/mismatched id, so a
   * briefing landing in user A's sidebar can never ping user B.
   * Phase 2 wires the client: sidebar live-insert + unread mark.
   */
  "conversation:created": {
    conversationId: string;
    projectId: string;
    userId: string;
    source: "briefing" | (string & {});
  };
  /**
   * Daily Briefing Phase 1: a briefing run finished successfully and
   * its conversation carries real assistant content. Same fail-closed
   * per-user SSE scoping as `conversation:created`.
   */
  "briefing:delivered": {
    userId: string;
    conversationId: string;
    projectId: string;
  };
  /**
   * github-projects integration: a board-move proposal was created,
   * decided (approve/dismiss), or reached a terminal state. A content-free
   * Hub-refresh nudge (mirrors `ext:page-state`) — carries only the owning
   * `projectId` so the Hub re-fetches the project's proposal list. Emitted
   * by the poller daemon and the approve/dismiss API routes.
   */
  "github-projects:proposal-update": {
    projectId: string;
  };
  "obs:turn": { conversationId: string; messageId?: string; llmDurationMs: number; toolDurationMs: number; totalDurationMs: number; tokenUsage: { input: number; output: number } };
  "run:turn_saved": { runId: string; conversationId: string; messageId: string; parentMessageId: string | null; content: string; thinkingContent?: string; final: boolean };
  "run:turn_text_reset": { runId: string };
  // ── Multi-Agent Orchestration ──
  "agent:spawn": {
    runId: string;
    agentRunId: string;
    subConversationId: string;
    agentName: string;
    agentConfigId: string;
    task: string;
    parentConversationId: string;
  };
  "agent:status": {
    runId: string;
    subConversationId: string;
    agentName: string;
    status: string;
  };
  "agent:complete": {
    runId: string;
    agentRunId: string;
    subConversationId: string;
    agentName: string;
    agentConfigId: string;
    success: boolean;
    resultPreview: string;
    parentConversationId: string;
  };
  // ── ask-user extension: bundled tool for asking the user a question
  //    (free-text or multiple-choice). Single direction event: the host
  //    POST endpoint at `/api/ask-user/answer` emits this when the user
  //    submits a response, and the extension's subscription handler
  //    resolves the pending gate keyed on `toolCallId`. The question side
  //    rides on the regular `tool:start` lifecycle (cardType:
  //    "ask-user-question") — no separate question event is needed.
  "ask-user:answer": {
    toolCallId: string;
    conversationId: string;
    answer: string;
  };
  // ── Ez concierge client-side tools (read_page, fill_form, navigate_to).
  //    The runtime emits this when the LLM calls a `clientSide: true` tool:
  //    the panel intercepts it via the SSE stream, runs the UI-side
  //    resolution (page-read, form-fill, goto), and POSTs the result back
  //    so the LLM continues.
  "ez:client-tool": {
    conversationId: string;
    toolCallId: string;
    toolName: string;
    input: unknown;
  };
  // ── Caller-executed tools.
  //    Emitted when the LLM calls a tool an external application declared on
  //    this conversation: the app receives it over SSE, runs the call on ITS
  //    machine, and POSTs the result back to the same `tool-results` endpoint
  //    the Ez panel uses. `toolName` is the BARE declared name the app
  //    dispatches on, never the `_caller__` wire form.
  //
  //    `conversationId` IS THE FIELD THAT SCOPES DELIVERY. The event is a
  //    `SCOPED_RUNTIME_EVENT_TYPES` member, and that filter returns on the
  //    first scope key present — so this one takes the fail-closed
  //    conversation-OWNERSHIP branch and never reaches the exact-user branch.
  //    `userId` (the conversation owner) rides along for attribution, and the
  //    same owner is what the pending-call registry checks a result POST
  //    against; it narrows nothing on the delivery side, so removing
  //    `conversationId` here would weaken the check, not shift it.
  "caller:tool-call": {
    conversationId: string;
    runId: string;
    toolCallId: string;
    toolName: string;
    input: unknown;
    userId: string;
  };
  // ── Task Tracking Panel ──
  "task:snapshot": {
    conversationId: string;
    tasks: Array<{
      id: string;
      title: string;
      description: string;
      status: "pending" | "active" | "completed" | "failed";
      agentId?: string;
      agentName?: string;
      assignments: Array<{
        id: string;
        agentConfigId: string;
        agentName: string;
        isTeam: boolean;
        status: "assigned" | "running" | "completed" | "failed";
        assignedAt: string;
        startedAt?: string;
        completedAt?: string;
        failedAt?: string;
        subConversationId?: string;
        agentRunId?: string;
        resultPreview?: string;
      }>;
      subtasks: Array<{ id: string; title: string; completed: boolean; position: number }>;
      createdAt: string;
      startedAt?: string;
      completedAt?: string;
      failedAt?: string;
      failureReason?: string;
      completionSummary?: string;
      priority: number;
    }>;
    activeTaskId?: string;
  };
  "task:assignment_update": {
    conversationId: string;
    taskId: string;
    assignment: {
      id: string;
      agentConfigId: string;
      agentName: string;
      isTeam: boolean;
      status: "assigned" | "running" | "completed" | "failed";
      assignedAt: string;
      startedAt?: string;
      completedAt?: string;
      failedAt?: string;
      subConversationId?: string;
      agentRunId?: string;
      resultPreview?: string;
    };
    /**
     * Orchestration reliability (Wave 1): the sub-agent's FULL final
     * text (sentinel-stripped, capped at {@link ASSIGNMENT_RESULT_FULL_CAP}),
     * present only on a terminal update. Kept OFF the `assignment` object
     * so the persisted task-store snapshot and the panel `task:snapshot`
     * stay lean — only the orchestration extension reads it, to return
     * the complete result to the orchestrator LLM instead of the
     * 200-char `resultPreview`.
     */
    resultFull?: string;
    /**
     * Structured output (Phase B1): when the invocation carried an
     * `outputSchema` and the child's final text validated against it, the
     * host-validated parsed value — present only on the terminal update.
     * Kept OFF the `assignment` object for the same reason as
     * `resultFull`: only the orchestration extension reads it, to return
     * validated JSON to the orchestrator LLM.
     */
    structuredResult?: unknown;
    /**
     * Structured output (Phase B1): set INSTEAD of `structuredResult` when
     * the child completed but never produced schema-valid JSON within the
     * bounded re-prompt budget — a human-readable summary of the
     * violations. The child's status stays `completed` (it did finish);
     * the orchestration extension surfaces this as a distinct error.
     */
    structuredResultError?: string;
    /**
     * Set alongside `structuredResultError` when the output DID validate
     * against the schema but its compact serialization exceeded the 30KB
     * structured cap — the (capped) `resultFull` carries the salvage.
     * Lets consumers frame this as an oversized success rather than a
     * schema violation.
     */
    structuredResultOverCap?: boolean;
  };
  // ── Extension Panel State ──
  "ext:state": {
    userId: string;
    extensionId: string;
    extensionName: string;
    state: Record<string, unknown>;
    timestamp: number;
  };
  /**
   * Extension Pages Hub §2.5 — content-free invalidation signal.
   * Emitted by the state mediator after a VALIDATED `ezcorp/page-state`
   * push. Deliberately carries NO tree content: the payload leaks only
   * "page X of extension Y changed", so the SSE layer broadcasts it to
   * every authenticated subscriber (it is NOT in
   * `DIRECT_CARRIER_EVENT_TYPES`). Hub tabs showing
   * `ext:<extensionName>:<pageId>` re-pull the render endpoint, which
   * is session-authed and serves from the freshly-updated page cache.
   */
  "ext:page-state": {
    extensionId: string;
    extensionName: string;
    pageId: string;
    timestamp: number;
  };
  /**
   * `/goal` autopilot indicator (PRD §6 FR-20, decision D7). Emitted
   * by the host-side goal-host (`src/runtime/goal-host.ts`) on every
   * state transition: arm, evaluator update, pause, achieve, clear.
   * Phase 1 emits the event; Phase 2 wires SSE delivery
   * (`runtime-events/+server.ts` `BUS_EVENTS` allowlist +
   * `sse-conversation-filter.ts` `DIRECT_CARRIER_EVENT_TYPES`) and
   * the `◎ /goal active|paused` chip in the chat header. The payload
   * carries `conversationId` so the SSE filter can scope delivery per
   * subscriber.
   */
  "goal:update": {
    conversationId: string;
    state: "active" | "paused" | "off";
    condition?: string;
    armedAt?: number;
    turnsEvaluated?: number;
    lastReason?: string | null;
  };
  /**
   * Sessions P4 (rewind/checkpoint): the conversation's message tree /
   * durable leaf pointer changed (a rewind moved the leaf). A content-free
   * nudge — the client re-fetches the ownership-gated `GET
   * /api/conversations/:id/tree` on receipt. Carries `conversationId` at the
   * top level so the SSE filter scopes delivery to the owner
   * (`DIRECT_CARRIER_EVENT_TYPES`), same as `goal:update`. `currentLeaf` is
   * the new durable leaf (a `messages` row id) so a same-tab client can
   * update without the round-trip.
   */
  "conversation:tree-changed": {
    conversationId: string;
    currentLeaf: string | null;
  };
  /**
   * Loops EZ Mode Phase 2 — a loop run PARKED awaiting a human approve/decline
   * (`approval_pending`) or was RESOLVED (`approval_resolved`). Both are
   * CONTENT-FREE invalidation nudges (loopId + runId, + `decision` on resolve)
   * — the web badge/inbox re-fetches the authorized dashboard on receipt; the
   * proposal body NEVER rides the event. The `loopId` is host-STAMPED
   * (`<extensionId>:<loopId>`) so it is provenance-bound to the emitting
   * extension; consumers treat it as an opaque invalidation key.
   * `conversationId` is OPTIONAL: present
   * when the loop is conversation-wired (SSE scopes delivery to that owner via
   * the standard conv-scope branch), absent for a global-scope loop (the nudge
   * broadcasts to every authenticated subscriber, like `ext:page-state` /
   * `github-projects:proposal-update`). Listed in `DIRECT_CARRIER_EVENT_TYPES`
   * as optional carriers (fail-open, mirroring `run:complete`).
   */
  "loops:approval_pending": {
    loopId: string;
    runId: string;
    conversationId?: string;
  };
  "loops:approval_resolved": {
    loopId: string;
    runId: string;
    decision: "approved" | "declined";
    conversationId?: string;
  };
  /**
   * Loops EZ Mode Phase 2 — a loop auto-disabled after N consecutive
   * permanent errors. A user-visible notice so a stop is never silent
   * (inbox/toast surface). Content-carrying but non-sensitive (loop id +
   * error count). Optional conversationId scopes delivery like the approval
   * events; a global loop broadcasts.
   */
  "loops:auto_disabled": {
    loopId: string;
    consecutiveErrors: number;
    conversationId?: string;
  };
}
