# Streaming Chat Runtime

> _The per-turn execution engine behind every chat message: `AgentExecutor.streamChat` loads the branch, builds the prompt, constructs a per-call pi-agent, bridges its event stream onto an in-process EventBus, and fans those events to the browser over a single SSE pipe with per-subscriber conversation-scoped authorization._

## Intent

When a chat message is sent, the conversations API mints a `runId` and hands off to `AgentExecutor.streamChat` — this is where the actual LLM turn runs. The runtime owns the full lifecycle of one assistant turn: rehydrating branch history (with attachments + tool-generated images), expanding mentions/commands/features/lessons into the prompt, resolving the provider model and tool surface, driving pi-agent-core's agentic tool loop, persisting each turn + tool call as it streams, and surviving cancels / idle stalls / provider failures with exactly one visible error bubble. Everything the user sees stream into the chat (tokens, thinking, tool cards, status pills) is a bus event emitted from this pipeline and delivered over SSE.

## How it works

### Per-turn pipeline (`AgentExecutor.streamChat`)

The `streamChat` method (`src/runtime/executor.ts`) is invoked fire-and-forget by the messages route (it isn't awaited — the HTTP response returns the `runId` immediately while the turn streams over SSE). It builds two long-lived per-call objects and threads them through phase modules under `src/runtime/stream-chat/`:

- **`ctx` — `StreamChatContext`** (`stream-chat/context.ts`): all mutable per-turn state (system prompt, tool list, accumulated `allTurnsText` / `turnText` / `turnThinking`, `lastSavedMessageId`, the serializing `dbQueue`, every `unsub*` closure). Phase modules take `(ctx, host, …)` and mutate it in place instead of threading 20+ locals.
- **`host` — `StreamChatHost`** (`stream-chat/host.ts`): a read-only view onto the executor's shared maps (`runs`, `controllers`, `activeAgents`, `runConversations`, `pendingPermissions`), the `bus`, the `watchdog`, the shared `permissionEngine`, and `spawnQuota`. Phase modules never import the executor class.

The phases run in this fixed order:

1. **Register the run.** A `running` `AgentRun` is stored in `runs` + `controllers` + `runConversations`; `run:start` and a `run:status` ("Loading conversation history…") are emitted. If `persist`, the run row + an `active_runs` row (crash recovery) are written.
2. **`loadHistory`** (`stream-chat/load-history.ts`) — resolve the branch path (`getConversationPath` from `parentMessageId`, else from `getLatestLeaf`), **drop `excluded` rows** so pi-ai never sees them, rehydrate past-turn attachments + tool-generated images (newest-first, capped at `MAX_REHYDRATED_IMAGES`=5 / ~5 MB), and map each row to a pi-ai message — only `user` and `assistant` rows are turns; every other role (`ez-action-result`, `preprocess-result`, `capability-event`, `extension`) maps to `null` (UI-only, never sent to the LLM). Resolves the system prompt (conversation > project > global) onto `ctx.system`.
3. **`setupTools`** (`stream-chat/setup-tools.ts`) — validate the provider model and credential first. If no model is pinned, use the heuristic classifier to select a quality tier. Then run memory/KB retrieval and tool loading in parallel. The retrieved block stays in `ctx.systemMemoryTail`, outside the cached system prefix (see [[persistent-memory]]). Returns `SetupToolsResult { resolved, initialCred, effectiveTier }`; the endpoint URL is stored on `ctx.modelBaseUrl` so a connection error can name the unreachable host.
4. **Start the watchdog** (`executor-watchdog.ts`) — an activity-based liveness tracker. It refreshes the heartbeat while progress signals arrive and auto-cancels the run after `WATCHDOG_IDLE_MS` (default **90s**, longer for reasoning models) of silence with no pending permission. Its closure reads `ctx.allTurnsText` lazily so a watchdog-kill can persist the latest partial response, and it can write the single visible error message.
5. **`applyAutoSpinUp`** + tool-scope filters — auto-spin-up team members (if flagged) and inject the orchestrator prompt; then apply mode tool restrictions (`computeModeToolScope` + `applyToolFilters`) and invocation-level team allow/deny scoping.
6. **`buildPiAgent`** (`stream-chat/build-pi-agent.ts`) — construct the pi-agent-core `Agent` for this turn: system prompt, model, tools, history, thinking level. It wires `transformContext` (the compaction hook), `convertToLlm` (filters to user/assistant/toolResult), an async `getApiKey` (fetches a *fresh* credential per call via `credentialConversationId` — sub-conversations inherit the parent's credentials), and `onPayload` (forces detailed reasoning summaries so thinking text is visible; on Anthropic, appends the memory/KB tail as an uncached trailing system block and shapes cache-retention TTLs). OAuth-eligible models are swapped to their subscription-compatible `Model` object. The agent is registered on `host.activeAgents` so cancel/watchdog can `.abort()` it.
7. **`subscribeBridge`** (`stream-chat/subscribe-bridge.ts`) — subscribe to the pi-agent `AgentEvent` stream and translate it onto the local EventBus (details below).
8. **`buildPromptInput`** (`stream-chat/build-prompt.ts`) — produce the LLM-facing prompt text + image parts via four literal, non-fatal expansions (EZ-token strip → slash-command → `@file`/`$feature`/`%lesson` prepended notes → multi-modal attachment lift). Then `piAgent.prompt(text[, images])` runs the agentic loop.

Steps 6–8 (agent build → subscribe → prompt) run **inside `runWithFailover`** (`stream-chat/failover.ts`): if the provider fails before the first token reaches the client, the loop retries the same provider once (jittered backoff), then rebuilds the agent on a tier-peer fallback provider (feeding the per-user circuit breaker); each attempt re-runs 6–7 with the attempt's own model and passes the **served** provider/model into `subscribeBridge` so persisted rows and the usage meter reflect what actually served the turn. See [LLM routing & failover](../../llm-routing-and-failover.md).
9. **Finalize** (`stream-chat/finalize.ts`) — `finalizeSuccess` / `finalizeError` / always-`finalizeCleanup`; a setup-phase safety net (`finalizeSetupError`) wraps the whole inner block to catch credential/model-resolution failures.

**Mid-run tool re-assembly.** Step 3 runs once and pi-agent **copies** the tool array at construction, so an extension installed by a tool call *during* the turn would otherwise be uncallable until the next turn. The executor hangs a `prepareNextTurnWithContext` hook on every agent it builds (each failover attempt included); between agentic-loop iterations it asks `ctx.refreshExtensionTools` (the seam `setupTools` leaves behind) for in-scope extension tools missing from the live list, re-applies the run's scope narrowings from step 5, and returns an updated turn context. Properties: gated on `ExtensionRegistry.generation`, so a turn where nothing was installed costs one integer compare, zero DB queries, and a byte-stable cached system+tools prefix; **additive only** — a tool the model may already have called is never pulled out from under it; and **scope-preserving** — an install cannot widen a mode allowlist or a team deny-list. "In scope" is the same union step 3 uses (the agent config's extensions ∪ the conversation-wired ones), so an extension reaches the turn only once it is attached or wired.

### Event bridge (`subscribeBridge`)

`piAgent.subscribe` receives pi-agent-core `AgentEvent`s synchronously; **every** event first calls `watchdog.bumpActivity(run.id)` (any event = progress). The handler switches on `event.type`:

- `turn_start` → reset `ctx.turnText`/`turnThinking`/`turnHasToolCalls`; emit `run:status` "Thinking…".
- `message_update` → accumulate `text_delta` / `thinking_delta` onto `ctx`, emit `run:token { kind: "text" | "thinking" }`.
- `tool_execution_start` → emit `tool:start` (carrying `cardType`/`cardLayout`/`category`/`invocationId`); register the in-flight call with the watchdog under a resolved `callTimeoutMs` (manifest > built-in > `DEFAULT_BUILTIN_CALL_TIMEOUT_MS`) — a built-in that suspends on a gate (the Ez client-side tools) declares a budget derived from that gate's timeout, so the gate's own error wins the race. `invoke_agent` is special-cased (uses `agent:spawn`/`agent:complete` instead).
- `tool_execution_end` → emit `tool:complete` or `tool:error`; persist the tool-call row (`persistToolCall`, keyed by `toolCallId` so streaming + hydrated rows dedupe) with the four analytics dimensions (user/agent/model/provider).
- `turn_end` → persist this turn as its own assistant message (`createMessage`), anchor unanchored tool-call rows + agent sub-conversations to it, advance `ctx.lastSavedMessageId`, and emit `run:usage` + `run:turn_saved`.

Sub-agent bus events (`agent:spawn`/`agent:status`/`agent:complete`) for this `run.id` are also wired into `watchdog.bumpActivity` so a multi-minute auto-spin-up turn isn't killed by the idle detector. DB writes from the sync callback are serialized through `ctx.dbQueue` (a chained promise the finalize phase awaits).

### Finalization

- **`finalizeSuccess`** — set `run.status = "success"`, drain `ctx.dbQueue`, write a fallback single message if no per-turn save happened, emit `run:complete` + `obs:turn`.
- **`finalizeError`** — three sub-paths: `AbortError` → `cancelled` (saves the partial turn text, emits `run:cancel`); `ProviderUnavailableError` → structured JSON error payload; any other `Error` → `friendlyProviderError` rewrite of cryptic connection text. The error message is written at most once via `claimErrorPersistSlot` (a shared `errorMessagePersisted` set the watchdog also claims synchronously — exactly one visible error bubble per run).
- **`finalizeCleanup`** — always runs: detach every `unsub*`, clear per-tool abort controllers, `watchdog.clearRun`, drop the run from `controllers`/`activeAgents`/`runConversations`, persist the terminal run row, and delete (or mark interrupted) the `active_runs` row.
- **`finalizeSetupError`** — safety net for failures before the inner try (credential/OAuth/model resolution); marks the run errored, aborts the controller so in-flight auto-spin-up sub-agents unwind, and calls the same `finalizeCleanup` used after streaming. `setupTools` validates the provider and credentials before it starts parallel memory and tool loading. A credential failure cannot leave a tool listener behind or wait for a tool dependency that ignores cancellation.

### Context compaction

`buildPiAgent` wires `makeCompactionTransform(model, options.compaction)` as pi-agent-core's `transformContext` hook, so it runs **before every LLM call** (initial turn + each tool-loop iteration + retries). It computes a per-model input-token budget from the model's own `contextWindow` (minus an output reserve and a safety margin) and, when over budget, runs a swappable `CompactionStrategy` — `trim` (default; evicts oldest whole turn blocks, leaves a marker, truncates oversized `toolResult` text as a last resort) or `none`. **Trimming is input-only — `model.maxTokens` is never mutated.** Overrides come from `compaction:*` settings, resolved per turn by `resolveCompactionConfig` in `executor.ts`. See [context-compaction](../../context-compaction.md).

### EventBus → SSE transport

- **EventBus** (`src/runtime/events.ts`) is a tiny in-process typed pub/sub (`Map<string, Set<listener>>`); `emit` swallows individual listener errors so one bad handler can't break the loop. It is process-local — the SSE route subscribes to it directly.
- **SSE endpoint** `GET /api/runtime-events` (`web/src/routes/api/runtime-events/+server.ts`) opens a `text/event-stream`. It subscribes one bus listener per name in `BUS_EVENTS` (an alias for the canonical `RUNTIME_EVENT_NAMES`), sends a priming `: connected` frame + a `: heartbeat` every **15s** (to survive NAT/relay idle-close), and sets `Content-Encoding: identity` + `X-Accel-Buffering: no` to defeat buffering proxies. Auth inherits the session-cookie check from `hooks.server.ts`, plus an explicit `requireScope(locals, "read")` + `requireAuth`. SSE replaced the older WebSocket fan-out because Bun's `node:http` upgrade handoff is broken under vite proxying — SSE is plain HTTP and works identically in dev (vite) and prod (svelte-adapter-bun).
- **Per-subscriber authorization** (`src/runtime/sse-conversation-filter.ts`): each event is run through `shouldDeliverEvent(eventType, payload, subscriber, getConversation)` on a microtask before enqueue. Only the enumerated **direct-carrier** event types (those that carry a top-level `conversationId`, plus extension-declared events) are filtered; everything else passes through (the client resolves it via `runId`). Conversation-scoped events check `isAuthorizedForConversation` (owner-only today, 30s membership cache) and **fail open** on a DB error — a momentary leak beats blacking out the whole UI. User-scoped events (`extensions:installed`, `conversation:created`) and an optional `userId` on `tool:permission_request` use dedicated **fail-closed** branches — never broadcast cross-user. (`shouldDeliverEvent` also has a fail-closed branch for `briefing:delivered`, but that event is *not* in `BUS_EVENTS`/`RUNTIME_EVENT_NAMES`, so the SSE route never subscribes to or forwards it — the branch is defensive only.)
- **Client** (`web/src/lib/ws.ts`): `createWSClient` wraps a single `EventSource("/api/runtime-events")` with reconnect/backoff + a grace window before surfacing connection problems. Its public surface (`subscribe`/`close`/`manualRetry`) is identical to the old WS client. The event-name union (`WSRunEvent.type`) is derived from the same `RUNTIME_EVENT_NAMES` list shared by the server `BUS_EVENTS` and the harness client.
- **Re-dispatch** (`web/src/lib/stores.svelte.ts`): a single global subscriber switches on `type` to drive chat stores (`run:token`, `tool:start`, …). Events it doesn't case for (e.g. `ext:page-state`, `extensions:installed`, `conversation:created`) are re-emitted as `window` `CustomEvent`s so each feature consumes the **one** SSE stream without opening a second `EventSource`.

## Usage

### How a turn is triggered

- `POST /api/conversations/[id]/messages` (scope `chat`) is the entry point: it mints a `runId` and calls `executor.streamChat(conversationId, content, { … })` fire-and-forget at `messages/+server.ts:482`, returning `{ userMessage, runId, … }` immediately. The turn then streams over SSE. (See [[conversations]] for the full send pipeline.)
- `streamChat` options include `provider`/`model`/`system`/`runId`/`parentMessageId`/`agentConfigId`/`permissionMode`/`thinkingLevel`/`modeId`/`toolRestriction`/`allowedTools`/`deniedTools`/`memberOverrides`/`subAgentMembers`/`attachments`/`commandResolver`.

### Consuming the stream

- The browser opens `GET /api/runtime-events?conversationId=…` (the `conversationId` query param is a connect-time scoping hint; authorization is enforced per-event regardless).
- `GET /api/conversations/[id]/active-run` polls the live run (status, `partialResponse`, `pendingPermissions`, `pendingAskUser`, `stalenessMs`); `POST` cancels it (`action: "cancel" | "force-cancel"`). Both are root-walk ownership-gated (fail-closed 404).

### Settings & env vars

- `compaction:strategy` (`trim` default, `none` to disable), `compaction:responseReserveCap` / `:responseReserveFloor` / `:safetyFraction` / `:cacheAnchorFraction` — per-model context trimming; `compaction:cacheRetention` — Anthropic prompt-cache TTL shaping; `compaction:toolResultCap` (`32000` chars, `0` to disable) — always-on cap on stale tool results, independent of the strategy and the budget.
- `EZCORP_WATCHDOG_IDLE_MS` (default `90000`), `EZCORP_WATCHDOG_IDLE_REASONING_MS` (`300000`), `EZCORP_WATCHDOG_IDLE_REASONING_HIGH_MS` (`900000`) — idle-kill thresholds.

## Key files

- `src/runtime/executor.ts` — `AgentExecutor`; `streamChat` orchestrates the per-turn pipeline; `cancelRun`, run-tracking maps, `resolveCompactionConfig`.
- `src/runtime/stream-chat/context.ts` — `StreamChatContext` per-call state bundle + `createStreamChatContext`.
- `src/runtime/stream-chat/host.ts` — `StreamChatHost` read-only view onto the executor's shared state (the phase-module composition seam).
- `src/runtime/stream-chat/load-history.ts` — branch load (`excluded` filtered out), attachment + tool-image rehydration, pi-ai message mapping (only `user`/`assistant` rows are turns; every other role → null).
- `src/runtime/stream-chat/setup-tools.ts` — model + credential resolution and tool-surface loading (`SetupToolsResult`).
- `src/runtime/stream-chat/build-prompt.ts` — `buildPromptInput`: EZ-strip → slash-command → file/feature/lesson prepended notes → attachment lift.
- `src/runtime/stream-chat/build-pi-agent.ts` — constructs the pi-agent-core `Agent`; OAuth model swap; wires `transformContext`/`convertToLlm`/`getApiKey`/`onPayload` (memory-tail append + cache-retention shaping on Anthropic).
- `src/runtime/stream-chat/failover.ts` — `runWithFailover`: same-provider retry + pre-stream cross-provider failover around the agent build/subscribe/prompt phases; feeds the per-user circuit breaker.
- `src/runtime/stream-chat/system-cache-split.ts` — appends the memory/KB tail as an uncached trailing system block (cache-prefix protection).
- `src/runtime/stream-chat/subscribe-bridge.ts` — bridges pi-agent `AgentEvent`s onto the EventBus; persists tool calls + per-turn assistant messages (served provider/model + routing provenance in `messages.usage`); feeds the watchdog.
- `src/runtime/stream-chat/finalize.ts` — `finalizeSuccess` / `finalizeError` / `finalizeCleanup` / `finalizeSetupError`; single-error-bubble guard.
- `src/runtime/stream-chat/context-compaction.ts` — per-model input-budget trimming; `trim`/`none` strategies; `makeCompactionTransform`.
- `src/runtime/executor-watchdog.ts` — activity-based liveness, idle auto-cancel, orphan cleanup, per-tool `callTimeoutMs`.
- `src/runtime/executor-helpers.ts` — `createPiLlmAdapter`, `persistErrorMessage`.
- `src/runtime/events.ts` — the in-process typed `EventBus`.
- `src/runtime/sse-conversation-filter.ts` — per-subscriber delivery filter (`shouldDeliverEvent`, `DIRECT_CARRIER_EVENT_TYPES`, membership cache, extension-event registry).
- `web/src/routes/api/runtime-events/+server.ts` — the SSE endpoint (subscribe → filter → enqueue, heartbeat, anti-buffering headers).
- `web/src/routes/api/runtime-events/bus-events.ts` — re-exports `RUNTIME_EVENT_NAMES` as `BUS_EVENTS` (SvelteKit forbids non-handler exports from `+server.ts`).
- `web/src/lib/runtime-event-names.ts` — the single canonical client-facing event-name list (`RUNTIME_EVENT_NAMES` + `RuntimeEventName`).
- `web/src/lib/ws.ts` — `createWSClient`: the browser `EventSource` consumer with reconnect/backoff + grace window.
- `web/src/lib/stores.svelte.ts` — the single global SSE subscriber; updates chat stores + re-dispatches uncased events as window `CustomEvent`s.
- `web/src/routes/api/conversations/[id]/active-run/+server.ts` — poll (`GET`) / cancel (`POST`) the active run.

## Features it touches

- [[conversations]] — the send pipeline mints the `runId` and calls `executor.streamChat`; the assistant turn streams back over this runtime.
- [[runs-lifecycle]] — `streamChat` *is* the run; it registers/persists the `AgentRun`, drives the watchdog, and writes the terminal row in `finalizeCleanup`.
- [[context-compaction]] — wired into pi-agent via `transformContext`; input-only trimming per LLM call.
- [[providers-and-models]] — `setupTools` + `buildPiAgent` resolve the model, swap OAuth-eligible models, and fetch fresh credentials per call.
- [[mention-grammar]] / [[slash-commands]] / [[feature-index]] / [[lessons]] — `buildPromptInput` expands `/cmd`, `@file`/`$feature`/`%lesson`, and strips `![EZ:]` into the LLM-facing prompt.
- [[attachments]] — `loadHistory` rehydrates past-turn attachments + tool-generated images; `buildPromptInput` lifts current-turn parts.
- [[builtin-file-tools]] — built-in tool calls stream via `tool:start`/`tool:complete` and persist with analytics dimensions.
- [[ask-user]] — pending `ask_user_question` gates surface through the active-run poll + `ask-user:answer` events.
- [[agents]] / [[teams]] — auto-spin-up + `invoke_agent` emit `agent:*` events that keep the parent watchdog alive.
- [[goal-autopilot]] — the `goal:update` chip event is a conversation-scoped direct carrier filtered by the same SSE layer.
- [[canvas-cards]] / [[message-toolbar]] — `cardType`/`cardLayout` on tool events route the chat UI's tool cards.
- [[permissions-and-grants]] — `tool:permission_request` is delivered user-scoped through the SSE filter.
- [[api-security]] — SSE auth (`requireScope`/`requireAuth` + session cookie) and the per-event conversation/user authorization filter.
- [[remote-testability]] — the harness client imports the same `RUNTIME_EVENT_NAMES` list and consumes the SSE stream.
- [[audit-and-observability]] — `obs:turn` (durations + token usage) is emitted on success; the collector subscribes to the bus.

## Related docs

- [context-compaction](../../context-compaction.md) — the input-only trimming wired into this runtime's `transformContext`.
- [llm-routing-and-failover](../../llm-routing-and-failover.md) — tier routing + the pre-stream failover loop wrapped around this pipeline.
- [conversations.md](conversations.md) — the upstream send pipeline that calls `streamChat`.
- [harness-contract](../../harness-contract.md) — the external harness's view of runs + the runtime event stream.

## Notes & gotchas

- **Active-run IDOR — FIXED (was OPEN).** `GET`/`POST /api/conversations/[id]/active-run` now add a root-walk ownership gate (`resolveRootConversationForOwnership`) on top of `requireScope` + `requireAuth`, failing closed with **404** (fixed in `20adfe86`, PR #12). The structural reason it was missing still applies to any *new* route: SvelteKit does not wrap a child `+server.ts` in a parent guard.
- **SSE conversation filter fails OPEN on DB error.** `isAuthorizedForConversation` returns `true` if the membership lookup throws (logged), and its decision is cached 30s — so a revoked share keeps receiving events for up to 30s. The fail-open is deliberate (a UI blackout is worse than a momentary leak), but it is *not* a hard tenant boundary; user-scoped events fail closed instead.
- **`streamChat` is fire-and-forget.** The messages route does not await it; errors that escape are caught by the outer `finalizeSetupError` and surfaced as a `run:error` bus event, not as an HTTP error. The HTTP response only confirms the `runId`.
- **Exactly one error bubble per run.** `claimErrorPersistSlot` (a shared `errorMessagePersisted` set) is claimed synchronously by both the finalize path and the watchdog-trip branch, so a watchdog kill followed by the unblocked await's `finalizeError` writes only one visible assistant error message.
- **`excluded` rows are stripped at load, not at trim.** `loadHistory` drops `excluded` messages before pi-ai ever sees them; compaction operates on the already-filtered set. (Toggling `excluded` mid-run is blocked upstream — `PATCH /messages/[mid]` returns 409 while a run is active.)
- **UI-only rows never reach the LLM.** `loadHistory`'s mapper keeps only `user` and `assistant` rows (an allowlist, filtered at the source), so `ez-action-result` / `preprocess-result` / `capability-event` JSON sentinels and `extension` tool-card rows can't leak in as fake user turns — even when an owner un-excludes one.
- **Credentials are fetched fresh per LLM call.** `getApiKey` calls `getCredential(provider, credentialConversationId)` on every call, and `credentialConversationId` is the **parent** conversation id for sub-conversations — sub-agent/team turns inherit the parent's credentials.
- **`ext:page-state` is intentionally absent from the direct-carrier set.** The mediator strips the page tree before emitting, so it's a content-free "page X changed" signal safe to broadcast; adding it to `DIRECT_CARRIER_EVENT_TYPES` would silently drop it (no `conversationId`/`userId` to authorize against).
- **`RUNTIME_EVENT_NAMES` is the single source of truth.** Server `BUS_EVENTS`, client `WSRunEvent`, and the harness client all derive from it. Server-only events (e.g. `obs:turn`, `briefing:delivered`) are intentionally excluded from the client list even though they're emitted on the bus.
- **Compaction never mutates `model.maxTokens`.** For the Codex API that field is metadata only (no `max_output_tokens` is sent); other providers derive the output cap from it. Trimming is input-only — `responseReserve` sizes the budget but is never written back.
- **The watchdog idle timer is reset by *any* bus activity**, including sub-agent `agent:*` events — that's what keeps multi-minute auto-spin-up orchestration turns from being killed at 90s.
