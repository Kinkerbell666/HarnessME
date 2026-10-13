# Persistent Memory

> _Durable, project-scoped facts about a user, extracted from completed chats, embedded locally with all-MiniLM-L6-v2, and injected back into future turns via hybrid (vector + keyword) retrieval under a token budget — as an uncached block kept out of the cached system prefix._

## Intent

Persistent Memory gives EZCorp a long-term recollection layer that survives across conversations: it captures durable facts (preferences, biographical details, technical context, decisions/goals) from completed chat runs, stores them with a 384-dim embedding, and re-injects the most relevant ones into later turns so the model "remembers" the user without re-reading old threads. Embedding generation runs **locally** (Transformers.js, no API key), so memory works in fully self-hosted / offline deployments. Memories decay on an access-driven schedule and are de-duplicated/merged so the store stays small and high-signal. Extensions can author and read their own memories over a reverse-RPC capability.

## How it works

The system spans a host-side `src/memory/*` library, a DB table, a bundled extension that drives extraction, an injection hook in the chat runtime, and a CRUD API + UI.

### Storage model

- Memories live in the `memories` table (`src/db/schema.ts`): `content`, `category` (`preferences` | `biographical` | `technical` | `decisions_goals`), `confidence` (`high`/`medium`/`low`), `status` (`active`/`stale`/`archived`), `embedding` (384-dim `vector`), `provenance` JSONB, `lastAccessedAt`, `injectionEligible` (boolean), `userId`, and a nullable `projectId`/`conversationId`.
- Project membership is **many-to-many** via the `memory_projects` junction table — a memory belongs to N projects (or zero = "global"). The legacy single `projectId` column is a compatibility mirror: every supported assignment path updates it, but the M2M table is authoritative for scoping.
- The first creation of `memory_projects` imports non-null legacy `projectId` values once in the same database statement. Later boots never re-import them, so an explicit global assignment remains global. Historical rows that already disagree between the two representations are not changed automatically because an old direct extension write and a deliberate later unassignment are indistinguishable; inspect them before any operator repair.
- `memory_audit_log` records create/update/merge/delete/status_change history; `extension_memory_writes_daily` atomically reserves a per-extension write allowance in the same transaction as the memory, membership, and resource audit write.

### Embeddings (local)

- `src/memory/embeddings.ts` loads `Xenova/all-MiniLM-L6-v2` once (singleton `getExtractor`) via `@huggingface/transformers`, producing **384-dim** mean-pooled, L2-normalized vectors. `EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2@384"` is the single source of truth — the bare model name handed to `pipeline()` is derived by stripping the `@dim` suffix, so the loaded model can't drift from the recorded id.
- Input is capped at `CHUNK_TOKENS = 256` tokens by writing `tokenizer.config.model_max_length` once at load (input-only — never `model.maxTokens`, honoring the context-compaction invariant). Since `@huggingface/transformers` v4 the `model_max_length` property is a getter with no setter, reading back through the same config object; writing the bare property throws, and on v3 writing through `.config` was a silent no-op — see the comment at `src/memory/embeddings.ts`. The effective cap is pinned by `src/__tests__/memory-embeddings-token-cap.test.ts`, which asserts observed truncation against the real tokenizer class. `src/memory/message-chunker.ts` windows longer text into ≤256-token chunks with a 32-token overlap.
- The model is lazy-loaded everywhere it's consumed (`await import("./embeddings")`) to keep `onnxruntime-node` off the eager import graph (it breaks Vite SSR on NixOS). `POST /api/warmup` pre-warms it; `warmupEmbeddings()` is fire-and-forget.

### Extraction (bundled `memory-extractor` extension)

- The legacy host module `src/memory/extraction.ts` was **deleted**; extraction now lives entirely in the bundled `memory-extractor` extension (`extensions/memory-extractor/index.ts`), wired at boot via `BUNDLED_EXTENSIONS` in `src/extensions/bundled.ts` with `bootSpawn: true` (event-only extensions must boot-spawn or `run:complete` is silently dropped).
- It registers two `defineLoop` loops (`defineMemoryLoops`):
  1. **`extract`** — a `run:complete` event loop. On a successful `chat`-agent run it pulls the last-20 messages (`runtime.conversations.getMessages`), asks a cheap LLM (default `gemini-2.0-flash-lite`) for a JSON array of facts using `EXTRACTION_SYSTEM_PROMPT`, parses/tolerates ```json fences, and writes each fact via `runtime.memory.dedupMemoryWrite`. Extractor writes are stamped `injectionEligible: true`.
  2. **`compaction`** — a cron loop (default `0 */6 * * *`, configurable to 1/3/6/12/24h) that calls `runtime.memory.compact`.
- Both RPCs are **bundled-only** (`src/extensions/runtime-invoke-handler.ts` → `checkBundledOnly`, gated on the host-stamped `ctx.extensionName`); user extensions get `-32604`. The handlers delegate to the surviving host modules `dedupAndWriteMemory` (`src/memory/dedup.ts`) and `runCompaction` (`src/memory/compaction.ts`).

### Dedup on write

- `src/memory/dedup.ts#dedupAndWriteMemory` is the single insert path. It embeds the candidate, finds the most-similar existing active memory in the writer's scope (`findSimilarMemory`, cosine — a project fact matches only rows that are members of that project, a global fact only global rows, so a fact is never merged into a row that is invisible where it was said), and if similarity ≥ `EXTRACTION_DEDUP_THRESHOLD = 0.85` **updates** the existing row in place (newer wins, provenance history extended); otherwise it **inserts** a new row.
- **The INSERT branch sets the real columns, not just provenance JSON.** `user_id` gets the source conversation's owner — the same row the similarity scope resolved, so the column and the dedup scope can never disagree — and `injection_eligible` gets the caller's `injectionEligible` when supplied (omitted → the schema default `true`, which is what the host pipeline relies on). Retrieval filters on the columns; provenance keeps its copy for audit only.
- **The UPDATE branch touches neither column.** Eligibility is owner-editable via `PATCH /api/memories/[id]`, so a later dedup hit must not silently re-inject a memory the owner took out; ownership already matched, because the similarity query was scoped to that owner.
- The whole similarity-check + insert/update runs under `withDedupLock(projectKey)` — a per-project async mutex (global memories share `"__global__"`) so concurrent `run:complete` events can't both pass the check and produce duplicates. Dedup is **host-side and cross-extension by design**: an extension can't dedup against memories it can't see.

### Compaction / merge (periodic)

- `src/memory/compaction.ts#runCompaction` sweeps active memories, finds pairs above `COMPACTION_SIMILARITY_THRESHOLD = 0.90` (stricter than extraction-time dedup), and merges each pair into one consolidated statement via a cheap LLM call (`mergeContents`, `CHEAP_MODEL_BY_PROVIDER`, falls back to `"A; B"` concat if no LLM). It only merges active rows with the same owner, exact project-membership set, and injection eligibility. The replacement preserves that membership and eligibility, then it and both removals commit in one transaction. A settings-based lock (`compaction:lastRun`) prevents runs <1 minute apart.

### Decay (access-driven)

- `src/memory/lifecycle.ts#startDecayTimer` runs `runDecaySweep` hourly (wired in `src/startup/background-timers.ts`). `computeStatus(lastAccessedAt)`: `active` → **`stale` at 30 days** since last access → **`archived` at 60 days**. `getMemoriesForDecay` only returns rows past their next threshold.
- Retrieval refreshes recency: every hybrid-search hit's `lastAccessedAt` is bumped via `touchMemoryAccess` (fire-and-forget), so memories that keep getting recalled never decay.

### Retrieval + injection (per turn)

- The chat runtime hooks memory injection in `src/runtime/stream-chat/setup-tools.ts` (non-fatal; degrades to `run:status: memory_unavailable` on error):
  1. **Fast-path skip** — if the project has no memories and no KB chunks (`hasMemories` / `hasKBChunks`), skip embedding entirely.
  2. Embed the user message once (`generateEmbedding`), reuse it for both memory and KB search.
  3. `src/memory/injection.ts#buildSystemPromptWithMemories` calls `hybridSearch` and greedily fills memory lines (`- [category] content (confidence: …)`) into a `## Relevant Memories` block under a **2000-token budget** (`estimateTokens = len/4`), then fills a `## Knowledge Base` block from KB chunks with the remaining budget. It returns the raw block as `injectionBlock` alongside the merged `systemPrompt`.
  4. **The injected block is kept OUT of the cached system prefix.** `setup-tools.ts` does **not** merge it into `ctx.system`; it stashes `injection.injectionBlock` on `ctx.systemMemoryTail`. At payload time (`build-pi-agent.ts`), Anthropic requests get it appended as a separate **trailing system block with no `cache_control`** (`src/runtime/stream-chat/system-cache-split.ts`) so the query-dependent recall can vary per turn without busting the byte-stable, prompt-cached region-1 prefix (system + tools); non-Anthropic providers get it merged into the plain `systemPrompt` string. See [context-compaction](../../context-compaction.md).
- `src/memory/retrieval.ts#hybridSearch` combines two rankings with **Reciprocal Rank Fusion** (`k = 60`): vector cosine (`embedding <=> $vec`) and keyword (`ts_rank` over `to_tsvector('english', content)` / `plainto_tsquery`), `FULL OUTER JOIN`ed and scored `(1/(k+rank_v) + 1/(k+rank_k)) * boost * statusWeight`. Archived memories are always excluded; **`stale` memories are weighted ×0.5**; in non-isolated project mode, memories belonging to the active project get a **×1.5 boost**.
- **Scoping:** default = this project's memories **+** global (no-project) memories, no cross-project leak. With `project:<id>:memoryIsolation` set, only memories explicitly assigned to that project are searched. `global:memoryEnabled === false` disables injection entirely.
- The injected memories ride back on `run.memoriesUsed` (set in `setup-tools.ts`) → `runs.result.output.memoriesUsed` (written in `src/runtime/stream-chat/finalize.ts`), surfaced on the assistant message (`Message.memoriesUsed` in `web/src/lib/api.ts`, rendered by `MemoriesCard.svelte`) so the UI can show which memories shaped a reply.

### Extension memory capability (`ctx.memory.*`)

- `src/extensions/memory-handler.ts` serves the `ezcorp/memory` reverse-RPC: `list` / `get` / `write` / `update` / `archive`. Locked invariants:
  - Provenance is stamped **host-side** from `ctx.actorExtensionId` (never from RPC meta — spoof defense).
  - Extension-authored memories default `injectionEligible: false` so they don't auto-inject.
  - `selfOnly: true` (default) narrows list/get to the extension's own memories; `update`/`archive` reject non-authors (`-32001 not-author`).
  - Every read/write is scoped to the acting user via `ownedByActingUser` (`onBehalfOf`, host-stamped) — a shared bundled identity acting for user B can't read user A's PII.
  - Daily write quota via `extension_memory_writes_daily`; quota reservation, memory, membership, and audit write are one transaction. Over-quota → `-32103`.

## Usage

### REST API (`/api/memories`)

| Method & path | Scope | Purpose |
|---|---|---|
| `GET /api/memories?projectId=&scope=&search=&status=&category=&limit=&offset=` | `read` | List memories (org-wide; auth required). `scope` = `project`/`global`/`all`. Returns each row + its `projectIds[]`. |
| `POST /api/memories` | `read`* | Create a memory manually. Body: `content`, `category` (required), optional `confidence`, `projectId` **or** `projectIds[]` (≤50 UUIDs). Embedding is generated fire-and-forget after insert. 201. |
| `GET /api/memories/[id]` | `read` | Fetch one (fail-closed: cross-user / unowned → 404). |
| `PUT /api/memories/[id]` | `read`* | Update `content` (re-embeds async), `confidence`, `status`, `projectIds[]`. |
| `PATCH /api/memories/[id]` | `read`* | Flip `injectionEligible` (`{ injectionEligible: boolean }`, `.strict()`). Writes an `audit_log` row on a real transition; idempotent on same-value. |
| `DELETE /api/memories/[id]` | `read`* | Delete (cascades junction + audit rows). 204. |
| `POST /api/warmup` | `read` | Pre-warm the embedding model singleton. |

\* These routes call `requireScope(locals, "read")` — the `read` scope gates API-key callers (cookie auth bypasses scope); ownership is enforced separately (`memory.userId !== user.id && role !== "admin"` → 404).

### UI

- **Memories page** (`web/src/routes/(app)/memories/+page.svelte`) — browse/search/edit memories and knowledge-base files; `?focus=<id>` auto-expands a memory (linked from a chat's `MemoriesCard`). `MemoryItem.svelte` exposes the per-memory injection-eligibility toggle (→ `PATCH`).
- **Save to memory** from chat — single-message save (`handleSaveMemory` in `web/src/lib/chat/page-handlers/send-message.ts`) and bulk multi-select save (`useSelectMode.svelte.ts`) both `POST /api/memories`.

### Settings keys

- `global:memoryEnabled` (boolean) — master injection kill-switch. Migrated into the bundled `memory-extractor`'s per-extension `enabled` setting.
- `project:<projectId>:memoryIsolation` (truthy) — strict per-project isolation (excludes global memories from injection).
- `memory-extractor` extension settings: `enabled`, `provider`, `model`, `compaction_enabled`, `compaction_interval_hours` (1/3/6/12/24).
- `compaction:lastRun` — internal compaction lock timestamp (not user-facing).

### Extension SDK

- `ctx.memory.{list,get,write,update,archive}` (requires the `memory` permission; `write`/`update`/`archive` need `access: "write"`).

## Key files

- `src/memory/embeddings.ts` — local all-MiniLM-L6-v2 embedder singleton; `EMBEDDING_MODEL_ID`, 384-dim, 256-token input cap, warmup.
- `src/memory/message-chunker.ts` — token-aware chunker (`CHUNK_TOKENS=256`, 32-token overlap) + embed-eligibility predicate.
- `src/memory/retrieval.ts` — `hybridSearch` (vector + tsvector RRF, project/status/isolation weighting) + KB-chunk wrapper.
- `src/memory/injection.ts` — `buildSystemPromptWithMemories`: greedy token-budgeted assembly; returns the raw `injectionBlock` for cache-aware callers.
- `src/runtime/stream-chat/system-cache-split.ts` — appends the memory/KB block as an uncached trailing system block on Anthropic (cache-prefix protection).
- `src/memory/dedup.ts` — host-side cross-extension dedup (`dedupAndWriteMemory`, `withDedupLock`, 0.85 threshold).
- `src/memory/compaction.ts` — periodic LLM merge of ≥0.90-similar memories (`runCompaction`, `mergeContents`).
- `src/memory/lifecycle.ts` — access-driven decay sweep (active→stale@30d→archived@60d).
- `src/memory/vector-utils.ts` / `src/memory/types.ts` — vector literal helper + shared types/constants.
- `src/db/queries/memories.ts` — `insertMemory`/`updateMemory`/`searchMemories`/`findSimilarMemory`/`touchMemoryAccess`/`getMemoriesForDecay`/`hasMemories`, etc.
- `src/db/schema.ts` — `memories`, `memory_projects`, `memory_audit_log`, `extension_memory_writes_daily` tables.
- `extensions/memory-extractor/index.ts` — bundled extraction + compaction loops (`defineMemoryLoops`, `extract`, `handleCompactionTick`).
- `extensions/memory-extractor/ezcorp.config.ts` — manifest (LLM + `memory:{access:write, selfOnly:false}` + cron permissions, settings).
- `src/extensions/bundled.ts` — wires `memory-extractor` into `BUNDLED_EXTENSIONS` (`bootSpawn`) + settings/wiring migrations.
- `src/extensions/runtime-invoke-handler.ts` — bundled-only `runtime.memory.compact` / `runtime.memory.dedupMemoryWrite` RPC handlers.
- `src/extensions/memory-handler.ts` — `ezcorp/memory` reverse-RPC (`ctx.memory.*`), per-user scoping + write quota.
- `src/runtime/stream-chat/setup-tools.ts` — per-turn memory/KB injection hook (fast-path skip, shared embedding, degrade-on-error).
- `src/startup/background-timers.ts` — starts the hourly decay timer.
- `web/src/routes/api/memories/+server.ts` / `[id]/+server.ts` / `schema.ts` — CRUD API + Zod schemas.
- `web/src/routes/(app)/memories/+page.svelte`, `web/src/lib/components/MemoryItem.svelte` / `MemoryList.svelte` — UI.
- `web/src/lib/chat/page-handlers/send-message.ts`, `useSelectMode.svelte.ts` — save-to-memory from chat.

## Features it touches

- [[knowledge-base]] — shares the same 384-dim embedder; KB chunks are injected into the same token budget alongside memories (`searchKBChunksForQuery`, `## Knowledge Base` block).
- [[streaming-runtime]] — `setup-tools.ts` runs memory/KB injection as a non-fatal step before the LLM call (stashing the block on `ctx.systemMemoryTail`); degraded state rides `run:status`.
- [[context-compaction]] — injection is input-only and respects the same "never touch `model.maxTokens`" invariant; the 256-token embed cap is set on the tokenizer, not the model. The injected block rides outside the cached system prefix (`system-cache-split.ts`).
- [[runs-lifecycle]] — extraction fires on the `run:complete` event for successful `chat` runs; `run.memoriesUsed` is recorded in the run result.
- [[scheduling-and-loops]] — extraction + compaction are `defineLoop` loops; compaction rides the extension cron schedule.
- [[bundled-catalog]] — `memory-extractor` is a boot-spawned bundled extension; the only one granted `memory.selfOnly: false`.
- [[runtime-and-rpc]] — bundled-only `runtime.memory.*` invokes and the `ezcorp/memory` reverse-RPC capability.
- [[permissions-and-grants]] — the `memory` capability grant (`access`, `categories`, `selfOnly`, `maxWritesPerDay`) gates extension memory ops.
- [[conversations]] — single-message + bulk save-to-memory originate from the chat surface / message toolbar.
- [[message-toolbar]] — per-message "save to memory" action.
- [[projects]] — memories are project-scoped (M2M) with a global tier; isolation is a per-project setting.
- [[settings]] / [[settings-system]] — `global:memoryEnabled`, `memoryIsolation`, and the extractor's per-extension settings.
- [[audit-and-observability]] — injection-eligibility flips and per-memory mutations write audit rows.
- [[providers-and-models]] — extraction and compaction call cheap per-provider models.
- [[api-security]] — `/api/memories` routes are `requireScope("read")` + ownership-gated (fail-closed 404).

## Related docs

None yet — this is the primary reference. (The extraction-pipeline-port rationale lives in `tasks/v1.3-phase-53-bundled-extension-ports.md`; the injection-eligibility UI in `tasks/v1.4-memory-injection-eligibility-ui.md`. See [context-compaction](../../context-compaction.md) for the shared input-only invariant.)

## Notes & gotchas

- **`injectionEligible` IS enforced in the injection path.** `buildSystemPromptWithMemories` calls `hybridSearch` with `injectionEligibleOnly: true`, which adds an `injection_eligible = true` predicate to both RRF CTEs — flipping the flag off via `PATCH /api/memories/[id]` removes that memory from LLM injection. The filter is **opt-in per caller**: search/palette and other non-injection consumers of `hybridSearch` still see ineligible rows. Every write path sets the column: `ctx.memory.write` hard-codes `false`, `dedupAndWriteMemory` writes what its caller passes (host pipeline passes nothing and takes the `true` default), and `runtime.memory.dedupMemoryWrite` forwards the extractor's `injectionEligible` arg.
- **Injection, dedup, and compaction are all per-user scoped.** The injection path always passes the acting `userId`; `hybridSearch` restricts results to rows the user owns (directly-stamped `user_id`, or `user_id IS NULL` with the source conversation owned by the user — a null/unowned actor matches nothing, fail-closed). `findSimilarMemory` accepts the same owner scope: dedup resolves the owner from the writing conversation (an unowned conversation never matches, so it inserts fresh instead of overwriting someone's row) **and writes that owner into the new row's `user_id`**, so the memory survives the deletion of its source conversation (`conversation_id` is `on delete set null`, which would otherwise strand the row as unattributable). Compaction only merges rows with the same resolved owner, skips unattributable rows, and stamps the merged row's `user_id` so it stays visible to its owner.
- **Two different similarity thresholds.** Extraction-time dedup merges at **0.85** (aggressive — the LLM rephrases the same fact across runs); the periodic compaction sweep merges at **0.90** (stricter). Both are host-controlled constants; extensions cannot widen them.
- **Decay is access-driven, not creation-driven.** A memory only goes stale/archived 30/60 days after its **last access**, and every retrieval hit refreshes `lastAccessedAt` (fire-and-forget via `touchMemoryAccess`). Frequently-recalled memories never decay; archived memories are excluded from search but not deleted.
- **Embedding is best-effort and async on the write path.** `POST`/`PUT /api/memories` insert the row first and generate/update the embedding in a fire-and-forget IIFE. A memory has **no embedding** for a short window after creation (and won't surface in vector search until then); embedding failures are logged, not surfaced.
- **Local model, lazy import.** The embedder is `onnxruntime-node`-backed and must be lazy-imported (`await import("./embeddings")`) everywhere — eager import breaks Vite SSR on NixOS. First use pays a model-load cost; call `POST /api/warmup` to pre-pay it.
- **Cross-extension dedup needs a privileged RPC.** The bundled extractor calls `runtime.memory.dedupMemoryWrite` (not the public `ctx.memory.write`) because the dedup join must see memories authored by the legacy host pipeline and any other extension. That RPC + `runtime.memory.compact` are **bundled-only** (`checkBundledOnly` on host-stamped `ctx.extensionName`); `memory-extractor` is the sole bundled extension with `memory.selfOnly: false`.
- **Token budget uses a crude estimator.** Injection budgeting uses `Math.ceil(text.length / 4)` — a heuristic, not a tokenizer count — so the real injected token count can drift from the nominal 2000-token budget.
- **`memory_projects` (M2M) is authoritative for scope.** Don't reason about a memory's project from the legacy single `projectId` column — scoping (project / global / isolated) is computed from the junction table in both retrieval and `searchMemories`.
- **Org-wide list, per-row ownership.** `GET /api/memories` (list) is intentionally org-wide (any authenticated reader sees the list query), but the single-row routes (`GET`/`PUT`/`PATCH`/`DELETE /[id]`) and the `ctx.memory.*` capability are strictly per-user fail-closed (unowned/cross-user → 404). Treat memory content as per-user PII.
