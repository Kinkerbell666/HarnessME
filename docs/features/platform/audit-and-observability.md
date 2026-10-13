# Audit Log & Observability

> _EZCorp's two parallel record-keeping planes: a redaction-gated **governance audit** trail of every permission decision and SDK capability call, and a lightweight **performance/cost observability** stream of per-turn telemetry._

## Intent

Two separate subsystems answer two different questions, and they are deliberately not the same table:

- **Audit** (security/governance) — _"who was allowed to do what, and what did they actually do with it?"_ Every permission grant/revoke/rejection, every brokered SDK capability call (`ctx.llm`, `ctx.memory`, `ctx.lessons`, `ctx.schedule`, `ctx.events`, `ctx.search`), and every memory/lesson mutation lands in a queryable, admin-readable, redaction-scrubbed trail. This is the SOC-2 / SIEM / "why did this extension just fail" surface.
- **Observability** (perf/cost) — _"how fast and how expensive was each turn?"_ A `tool:complete` / `tool:error` / `obs:turn` / `agent:complete` / `run:error` event stream persisted to `observability_events`, powering the per-conversation panel and the global dashboard's token/duration/cost charts.

Keeping them separate means the high-signal governance trail isn't drowned by high-volume perf telemetry, and the perf charts don't have to understand permission semantics.

A third, unrelated thing also lives under `src/runtime/audit/` — the **feature-classification audit** (`runAudit`, LLM-classifies a project's `$feature` index). That is NOT the security audit log; do not conflate them.

## How it works

### Plane 1 — Governance audit (three sources, one merge)

The audit drill-down fans in **three** physical sources and normalizes them into one `AuditTimelineEntry` union (`src/db/queries/audit-merge.ts`):

1. **`audit_log` (governance rows).** A flat `{userId, action, target, metadata}` table. `action` is one of the typed `ext:*` strings in `src/extensions/audit-actions.ts` (`EXT_AUDIT_ACTIONS` — permission grant/revoke/reject/reapprove, bundled install/regrant/ceiling-clamp/manifest-tamper, MCP netns/seccomp/veth, env-key-leak, PDP `perm:allowed`/`perm:denied`/`perm:prompted`, the `SDK_*` governance siblings, etc.) **or** a legacy `extension:*` string. Per-extension queries match `target = extensionId AND action LIKE 'ext:%' OR 'extension:%'`.
2. **`sdk_capability_calls` (capability telemetry).** One high-volume row per brokered SDK call, carrying `capability`, `action`, `success`, `durationMs`, redacted `before`/`after`, plus `tokensUsed` / `costUsd` / `provider` / `model` (LLM bucket) and a self-FK `parentCallId` chaining e.g. scheduled-fire → its child LLM call.
3. **Resource rows** — `lessons_audit_log` (`actorExtensionId` column) + `memory_audit_log` (matched via `reason = ext:<id>`). These carry full before/after body + frontmatter for forensic comparison, which the lean `sdk_capability_calls` row deliberately omits.

`mergeAuditForExtension` / `mergeAuditForConversation` issue three (or four) scoped `SELECT`s, normalize to the union, sort `createdAt DESC` with an `id` tie-break, and paginate via a base64url `{ts, id}` cursor (`encodeCursor`/`decodeCursor`). It does **not** UNION in SQL — the tables' shapes diverge too much. The conversation-scoped variant surfaces only `sdk_capability_calls` rows (the resource tables carry no `conversation_id` column today). `listGlobalAudit` (`src/db/queries/audit-global.ts`) is the same shape without the extension filter.

### The single audit-write chokepoint + redaction

There is exactly **one** `getDb().insert(auditLog)` call in the codebase, inside `insertAuditEntry` (`src/db/queries/audit-log.ts`). Every one of the 18+ governance call sites routes through it, and it **always** runs `metadata` through `redactForAudit` before the JSONB hits Postgres. The capability path has its own dual/triple-write wrapper, `recordCapabilityCall` (`src/extensions/recordCapabilityCall.ts`), which also redacts `before`/`after` first.

`redactForAudit` (`src/extensions/audit-redaction.ts`) is the credential chokepoint:

- Pure, never-throws (returns `[REDACTION_FAILED]` on internal error so the insert still has a payload), circular-ref-safe via a `WeakSet`.
- Recursive descent: a closed set of **value-pattern** regexes (OpenAI `sk-…`, Anthropic `sk-ant-…`, Google `AIza…`, AWS `AKIA…`, GitHub `gh[pousr]_…`, `Bearer …`, JWT `eyJ….….…`) plus **key-name** matches (`authorization`, `x-api-key`, `cookie`, and env-shaped `SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY`). A matched string is wholly replaced with `[REDACTED]` (no partial-secret leaks). It also descends into `Error.message` / `.cause`.
- 8 KB serialized cap: over-cap stores a 4 KB preview + a SHA-256 of the full post-redaction JSON for forensic anchoring. `truncate: false` mode (used by `redactToolCallOutputContent` at the `tool_calls.output` boundary) skips the size cap so UI-rendered tool output keeps full structure but still gets secret-scrubbed.

**Fail-open by design:** an audit-write failure must NEVER abort the business call. `insertAuditEntry` and all three `recordCapabilityCall` writes wrap each insert in its own try/catch and route failures to `persistError` (`src/db/queries/error-logs.ts`, fire-and-forget) so admins can observe the hiccup without it propagating.

### `recordCapabilityCall` — three writes per call

Each Phase-51 capability handler calls `recordCapabilityCall(spec)`, which performs up to three independent writes:

1. **`sdk_capability_calls`** row (redacted `before`/`after`). Returns its `id`.
2. **Optional per-resource audit** — a `memory_audit_log` or `lessons_audit_log` row (full body/frontmatter) when `perResourceAudit` is set.
3. **Optional in-chat capability-event pill** — a `messages` row with `role: "capability-event"` whose `content` is a JSON sentinel blob (`__ezcorp_capability_event`) referencing the `sdkCapabilityCallId`. Defaults on when a `conversationId` is present. The chat pill renderer reads that sentinel.

Each write is independently try/caught; a failure is logged to `error_logs` and swallowed.

### Plane 2 — Performance/cost observability

`ObservabilityCollector` (`src/observability/collector.ts`) subscribes to the runtime event bus and persists `observability_events` rows for `tool:complete` (→ `tool_call`), `tool:error` (→ `tool_error`), `obs:turn` (→ `turn_summary` with token usage + LLM/tool/total durations), `agent:complete` (→ `agent_call`/`agent_error`, anchored to the **parent** conversation), and `run:error` (→ `run_error`, incl. watchdog timeouts/force-cancels). Every insert is `.catch()`-logged — never fatal.

`src/db/queries/observability.ts` aggregates these. Notable correctness detail: **authoritative token + turn counts come from `messages.usage`, not from `turn_summary` rows** — `turn_summary` only captures the _last_ turn of a run and would under-report multi-turn conversations. Response-time averages and tool-call counts still come from `observability_events` (messages carry no duration).

## Usage

### REST API — governance audit (admin-gated)

| Method & path | Scope / role | Purpose |
|---|---|---|
| `GET /api/audit` | `admin` scope + `admin` role | Cross-extension global feed over `sdk_capability_calls` + governance rows. Query: `extensionId`, `capability`, `action`, `onBehalfOf`, `denialOnly=true`, `search`, `cursor`, `limit` (clamp 1–200). |
| `GET /api/audit/stats?range=24h\|7d\|30d` | `admin` | 24h headline strip: `denialCount`, `totalCalls`, `totalCostUsd`, top-3 chattiest extensions, top-3 LLM spenders. |
| `GET /api/audit-log` | `admin` | Legacy flat `audit_log` viewer (`limit`/`offset`/`action`). Powers the `/settings/admin/audit` page via `AuditLogSection.svelte`. |
| `GET /api/extensions/[id]/audit` | `admin` | Per-extension 3-source merged timeline. Filters: `capability`, `status=denial`, `since`, `until`, `cursor`, `limit`. `?legacy=1` falls back to governance-only `listAuditForExtension`. |
| `GET /api/extensions/[id]/audit/stats?range=…` | `admin` | Per-extension stats strip (`totalCalls`, `totalCostUsd`, `successRate`, `denialCount`). |
| `GET /api/conversations/[id]/audit` | `read` scope, conversation owner (admin fallback for unowned rows) | Per-conversation `sdk_capability_calls` timeline. 404 on unknown/not-owned. |

### REST API — observability (perf/cost)

| Method & path | Scope | Purpose |
|---|---|---|
| `GET /api/observability?days=30` | `read` | Usage stats: token totals, turn count, avg response ms, tokens-by-day chart, top-10 extensions by tool-call count. An admin gets every user's totals (`scope: "all"`); anyone else gets the same shape for their own conversations and their sub-conversations only (`scope: "own"`) — `getGlobalStats({ userId })` filters in SQL. No session → 401. |
| `GET /api/observability/[conversationId]` | `read` | Per-conversation `{events, stats}` (raw event list + token/tool/duration roll-up). Owner of the root conversation or admin only; anyone else gets 404. No session → 401. |

### UI entry points

- `/audit` (`web/src/routes/(app)/audit/+page.svelte`) — admin global audit page: 24h stats strip + filters + cursor-paginated timeline.
- `/observability` (`web/src/routes/(app)/observability/+page.svelte`) — perf/cost dashboard (`?days=` range). Under the title it says whose usage it shows: "All users" for an admin, "Your conversations" for anyone else.
- `/settings/admin/audit` — the legacy flat `audit_log` viewer (`AuditLogSection.svelte` → `/api/audit-log`).
- `/extensions/[id]/audit` — per-extension drill-down (timeline + capability filter pills + 24h stats + current-grants rail).
- `/project/[id]/chat/[convId]/audit` — per-conversation audit timeline.
- **In-chat capability-event pills** — `role: "capability-event"` message rows rendered inline; click to expand the underlying `sdk_capability_calls` row. (Emitted by `recordCapabilityCall` write 3 whenever the call carries a `conversationId` and the caller didn't pass `insertChatPill: false` — there is no bundled-vs-user-installed gate. Calls that fire without a chat context — scheduled fires, event-subscribe handlers — have a `null` `conversationId` and don't pill; the audit page is their canonical record.)

### Settings keys

- `global:eventSubscriptionAuditSampleN` — 1-in-N sampling for `SDK_EVENT_DELIVERED` audit rows (event delivery is too chatty to log every fire).

## Key files

- `src/extensions/audit-actions.ts` — `EXT_AUDIT_ACTIONS` (the typed `ext:*` action vocabulary) + `ExtensionAuditMetadata` contract. Includes the MCP lifecycle rows `MCP_SERVER_INSTALLED` / `_UPDATED` / `_REFRESHED` and `EXTENSION_UNINSTALLED` — see [MCP servers § Audit trail](../tools/mcp-servers.md#audit-trail-mcp-lifecycle).
- `src/extensions/mcp-audit.ts` — the credential-free projection an MCP server definition takes before it reaches `audit_log.metadata` (transport, executable or URL origin+path, auth KEY names, tool count). The first net; `redactForAudit` is the second.
- `src/extensions/audit-redaction.ts` — `redactForAudit` (credential chokepoint, 8 KB cap, SHA-256 truncation) + `redactToolCallOutputContent`.
- `src/extensions/recordCapabilityCall.ts` — triple-write wrapper (sdk row → per-resource audit → in-chat pill), each fail-open.
- `src/db/queries/audit-log.ts` — `insertAuditEntry` (the single `audit_log` write, always redacted, fail-open), `listAuditLog`, `listAuditForExtension`, plus the retention sweep `cleanupOldAuditLog` / `resolveAuditRetentionDays` / `DEFAULT_AUDIT_RETENTION_DAYS`.
- `src/extensions/perm-audit-coalescer.ts` — the burst folder for repeated PDP allow/deny rows (window, early-flush threshold, key shape, lossless-summary contract).
- `src/startup/background-timers.ts` — arms the hourly sweeps: sessions, `error_logs` (30d), `audit_log` (180d, #206), `sdk_capability_calls` (per-capability).
- `src/db/queries/audit-merge.ts` — `mergeAuditForExtension` / `mergeAuditForConversation`, the `AuditTimelineEntry` union, `encodeCursor`/`decodeCursor`, `statsForExtension`.
- `src/db/queries/audit-global.ts` — `listGlobalAudit`, `globalStats` (24h denials/spend/chattiest), `sanitizeSearchTerm` (strips LIKE wildcards).
- `src/db/queries/sdk-capability-calls.ts` — `insertSdkCapabilityCall` + types for the capability-telemetry table.
- `src/db/queries/error-logs.ts` — `persistError`, the fire-and-forget sink for swallowed audit-write failures.
- `src/observability/collector.ts` — `ObservabilityCollector` / `startCollector`, the event-bus → `observability_events` bridge.
- `src/db/queries/observability.ts` — `insertObservabilityEvent`, `getConversationStats`, `getGlobalStats` (token counts sourced from `messages.usage`, not `turn_summary`).
- `src/db/schema.ts` — `auditLog`, `sdkCapabilityCalls` (indexed `(extension_id, created_at)`, `(conversation_id, …)`, `(on_behalf_of, capability, …)`), `observabilityEvents`, `lessonsAuditLog`, `memoryAuditLog`, `errorLogs`.
- `web/src/routes/api/audit/+server.ts` · `web/src/routes/api/audit/stats/+server.ts` · `web/src/routes/api/audit-log/+server.ts` — global + legacy audit APIs.
- `web/src/routes/api/extensions/[id]/audit/+server.ts` · `.../audit/stats/+server.ts` — per-extension drill-down APIs.
- `web/src/routes/api/conversations/[id]/audit/+server.ts` — per-conversation audit (owner-gated, fail-closed 404).
- `web/src/routes/api/observability/+server.ts` · `web/src/routes/api/observability/[conversationId]/+server.ts` — perf/cost APIs.
- `web/src/routes/(app)/audit/+page.svelte` · `web/src/routes/(app)/observability/+page.svelte` — the two dashboards.
- `web/src/lib/components/settings/AuditLogSection.svelte` — the legacy flat `audit_log` admin viewer.

## Features it touches

- [[permissions-and-grants]] — every grant / revoke / rejection / clamp / drift writes an `ext:*` governance row; the drill-down's right rail reads `extensions.grantedPermissions`.
- [[rbac-and-permission-modes]] — the PDP emits `perm:allowed` / `perm:denied` / `perm:prompted` rows; admin role gates every audit API.
- [[runtime-and-rpc]] — brokered SDK capability calls (`ctx.llm/memory/lessons/schedule/events/search`) are recorded via `recordCapabilityCall`.
- [[persistent-memory]] — memory mutations write `memory_audit_log` rows (matched into the merge via `reason=ext:<id>`).
- [[lessons]] — lesson mutations write `lessons_audit_log` rows with full before/after body + frontmatter.
- [[scheduling-and-loops]] — schedule register/fire/quota/reaped emit `SDK_SCHEDULE_*` rows; `parentCallId` chains a fire to its child LLM call.
- [[sandbox-and-isolation]] — MCP netns / veth / seccomp / conntrack / sandbox-required refusals emit `ext:mcp:*` governance rows for fleet monitoring.
- [[mcp-servers]] — host-side MCP capability calls are audited; protocol frames between host and MCP binary are not.
- [[conversations]] — the per-conversation audit timeline + in-chat capability-event pills hang off conversation rows.
- [[streaming-runtime]] — `obs:turn` / `tool:*` / `run:error` bus events feed the observability collector.
- [[agents]] — `agent:complete` events anchor sub-agent success/failure to the parent conversation's observability panel.
- [[api-security]] — every audit/observability route is gated by `requireScope` (+ `requireRole("admin")` for governance); the conversation audit route is fail-closed 404.
- [[admin-surfaces]] — `/audit` and `/settings/admin/audit` are admin-facing operational views; `/observability` is open to every user but shows non-admins only their own usage.
- [[builtin-file-tools]] — `tool_calls.output` is secret-scrubbed at the write boundary via `redactToolCallOutputContent`.

## Related docs

- [Reading the audit drill-down](../../permissions/audit-drilldown.md) — operator-facing walkthrough of the `/audit` and `/extensions/[id]/audit` surfaces, the in-chat pills, and "what's recorded vs. not".

## Notes & gotchas

- **Two planes, two tables — don't conflate.** Governance lives in `audit_log` + `sdk_capability_calls` (+ resource logs); perf/cost lives in `observability_events`. They have separate routes, separate auth (governance = admin-only; observability = `read`), and separate aggregators.
- **`src/runtime/audit/` is NOT the security log.** It's the `$feature`-index classification audit (`runAudit` → LLM classifier → markdown report). Same word, unrelated subsystem.
- **Audit writes are fail-open.** A redaction or insert failure is logged to `error_logs` and swallowed — it never aborts the underlying business call. Conversely, a missing audit row does not mean the operation didn't happen; check `error_logs` for `audit-write-failed`.
- **Redaction is a closed-set credential scrubber, not a PII redactor.** It targets provider keys / JWTs / bearer tokens / env-shaped key names. It will not strip arbitrary PII; do not treat the audit trail as PII-safe by default.
- **Token/turn counts come from `messages.usage`, not observability rows.** `turn_summary` rows only capture a run's last turn; sourcing aggregates from them under-reports multi-turn runs (the queries deliberately read `messages.usage` instead).
- **Cost is approximate.** `cost_usd` is a derived estimate (provider pricing tables drift); the stats strips render an "approximate; provider billing may differ" disclaimer. Use for trends, not invoicing.
- **Retention: `audit_log` is swept hourly on a 180-day window** (`cleanupOldAuditLog`, armed in `src/startup/background-timers.ts`; #206 — before that there was no sweep at all and the table grew for the life of the instance). Operator knob: `EZCORP_AUDIT_RETENTION_DAYS`, clamped to `[1, 3650]`, with anything below 1 or unparseable keeping the default rather than purging (a `0` meant as "keep forever" must never become "delete all but today"). Deletion is batched 5000 rows/statement, ≤1M rows/tick, because the first tick on a long-lived instance is the large one. The other tables differ: `sdk_capability_calls` has its own per-capability windows (90/30/30/90 days, admin-settable), `lessons_audit_log` is cascade-deleted with its lesson, and `sdk_capability_calls.on_behalf_of` is `ON DELETE RESTRICT` (a user with capability-call rows can't be hard-deleted until an admin scrubs PII).
- **PDP decision rows are burst-COALESCED, so one row can stand for hundreds.** `perm-audit-coalescer.ts` folds repeated *identical* `ext:perm:allowed` and `ext:perm:denied` rows inside a 10s window: the first is written verbatim, the tail becomes ONE row whose `reason` opens with `coalesced-{allow,deny}-tail (N suppressed in Xms)` and whose metadata carries `suppressed`, `totalInWindow`, `firstAt`, `lastAt` and `headAuditId`. Two rows fold only when the decision, extension, user, conversation, tool, calling extension AND (for a deny) the missing capability kind/value + reason are all equal. **Never read a count off row cardinality** — `SELECT count(*)` under-reports a folded burst; sum `totalInWindow` where present. Never folded: the fail-closed `override-lookup-failed` deny (per-row `underlyingError`), `ext:perm:prompted`, and the sensitive `bundled-ceiling-auto-allow` allow.
- **`audit_log.metadata` is the only redacted-at-rest copy.** The redaction happens once, at insert. `truncate: false` paths (tool output, `tool_calls`) are secret-scrubbed but **not** size-capped, by design (UI rendering).
- **Pagination is per-source-over-fetched.** The merge fetches `limit × N` per source then slices, to avoid losing the oldest rows from a hot source after a same-millisecond tie. A keepalive cursor is a v1.4 candidate.
- **In-chat pills are gated on `conversationId`, not on bundled-vs-user-installed.** `recordCapabilityCall` write 3 inserts a `capability-event` row whenever the call carries a non-null `conversationId` (and the caller didn't pass `insertChatPill: false`) — any extension holding the relevant capability grant pills, bundled or not. Calls without a chat context (scheduled fires, event-subscribe handlers) carry a `null` `conversationId` and never pill; the audit page is the canonical record for those.
