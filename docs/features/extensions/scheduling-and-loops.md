# Extension Scheduling & Loop SDK

> _A persistent, TZ/DST-safe cron daemon (`ctx.schedule`) with at-most-once delivery, plus `defineLoop` — a declarative SDK primitive that collapses the whole autonomous-loop lifecycle (settings, run-record state machine, idempotency, retention, failure policy, artifact mirror, dashboard) onto one trigger surface (cron | event | manual)._

## Intent

EZCorp extensions frequently need to run work in the background: distill a lesson when a chat finishes, sweep memories on a cron, dispatch a coding-agent run and track it to completion. Two layers serve this. The **schedule daemon** is the host-side cron engine: it parses 5-field cron expressions, persists registrations, and delivers ownerless "fire" notifications to an extension subprocess with claim-before-dispatch durability. The **Loop SDK primitive** (`defineLoop`) sits on top in the SDK, turning the boilerplate every autonomous loop hand-rolls into one declarative call over those triggers — so an author writes only `act` (what to do) plus a small `contract`.

## How it works

### Cron parsing (`src/extensions/cron.ts`)

- `parseCron(expr, tz="UTC")` returns a `CronInstance` whose `.next(from)` walks wall-clock minutes in the named TZ and converts each candidate back to a UTC `Date`. This naturally rolls forward over a DST spring-forward gap, and picks the **earlier** UTC instant in the fall-back ambiguous window (conservative for at-most-once).
- `validateCron(expr)` enforces the rules: **5-field only** (`min hour dom month dow`) — `@`-shorthands and seconds are rejected; lists/ranges/steps allowed; **minimum 5-minute interval** (checked by walking 48 consecutive fire times in UTC, so every dense form is refused: `* * * * *`, `*/1..*/4`, `0-59 * * * *`, `1,2,3 * * * *`, `* * * * 1`). Day-of-month vs day-of-week follow the Vixie cron OR-rule when both are restricted.
- `findNextWallClock` caps its search at ~4 years to avoid spinning on an impossible expression (e.g. Feb 30).

### Manifest → DB mirror (`src/extensions/schedule-reconcile.ts`)

Cron expressions are **manifest-only** — they live in the manifest's `permissions.schedule.crons[]`, never registered dynamically from extension code. On install/activate, `reconcileSchedules(extensionId, manifestCrons)` mirrors them into `extension_schedules` non-destructively (it is invoked from `web/src/lib/server/extensions/activate-extension.ts`, and failures are swallowed as non-fatal):

- **New cron** → fresh row (`enabled: true`, `next_fire_at` seeded from `parseCron(...).next(now)`).
- **Removed cron** → **soft-disable** (`enabled: false`) — the row is preserved so its `extension_schedule_fires` history survives.
- **Existing cron** → no-op (preserves `next_fire_at`/`last_fire_at`); a previously-disabled match is re-enabled.
- Only the first **8** valid crons are taken; invalid ones are dropped.
- **Capability removed**: publishing a release whose manifest drops `permissions.triggers` soft-disables every user-created cron and webhook (`revokeDynamicTriggers`, one audit row each).
- **Extension disable** sets `enabled: false` on manifest cron and webhook rows only. User-created (`ctx.triggers`) rows keep their own state, the schedule daemon skips them, the inbound hook route answers 404, and the webhook delivery daemon leaves already-queued deliveries `pending` (drained after re-enable) while the extension is disabled, so re-enabling the extension restores them. A row auto-disabled for errors stays disabled.
- The `ctx.triggers` `maxCron` / `maxWebhooks` caps count **enabled** rows only. Re-registering an enabled key is an update and always passes; re-registering a disabled key re-enables it and needs a free slot.

### The daemon (`src/extensions/schedule-daemon.ts`)

`ScheduleDaemon` is a singleton owned by `src/startup/background-timers.ts`, started at boot (gated by `EZCORP_DISABLE_SCHEDULE_DAEMON=1`). Its locked invariants:

- **At-most-once delivery (default).** `next_fire_at` IS the queue. On each `tick()` it selects due, enabled rows of enabled extensions (`next_fire_at <= now`, `limit 100`), and for each: inserts an `extension_schedule_fires` row (`status: running`) and advances `next_fire_at` to the next cron slot — only *then* dispatches the notification. A crash between commit and dispatch is acceptable because the row already advanced. Correctness rests on a **single writer**, not on row-level locking: the current `tick()` does a plain `SELECT … LIMIT 100` (no `FOR UPDATE SKIP LOCKED`) on both Postgres and PGlite, and the PID lockfile is what guarantees only one daemon claims rows. (The source still documents `FOR UPDATE SKIP LOCKED` as the intended multi-writer path, but it is not implemented today.)
- **At-least-once is opt-in** via `maxRetries > 0`. A failed fire under `attempt < maxRetries` is marked `error` and a fresh attempt row is synthesized. A `running` row older than `maxRunDurationMs * 2` is reaped on startup (`reapCrashedFires`) — but only retried when `maxRetries > 0`; otherwise it is left `running` indefinitely (preserving at-most-once) and audited.
- **Single-process invariant.** PID lockfile at `.ezcorp/schedule-daemon.pid` (via `src/startup/process-lockfile.ts`, PID-reuse-safe). A sibling daemon refuses to start. Distributed cron is out of scope.
- **Concurrency caps.** 5 concurrent fires per extension, 30 host-wide. Counters seed from `running` rows on startup, are enforced both across overlapping ticks (`inFlight*`) and within a tick (`tickClaims*`), and decrement on every completion path (ok / error / timeout).
- **Auto-disable after 5 consecutive errors** (`AUTO_DISABLE_AFTER`) — sets `enabled: false` and audits `SDK_SCHEDULE_DISABLED`. Any `ok` fire resets `consecutive_errors` to 0.
- **`maxRunsPerDay` quota** (default 24) counted per-extension across all its schedules over the UTC calendar day; exceeded fires are skipped + audited (`SDK_SCHEDULE_QUOTA_EXCEEDED`), with `next_fire_at` still advanced.
- **Missed-run policy on offline catch-up** (`applyMissedRunPolicies`, run on start): `skip` (advance only), `fire-once` (default — one catch-up fire), or `fire-all` (enumerate every missed slot back to `last_fire_at`, capped by `maxRunsPerDay`). Catch-up fires get **0–60s jitter** and carry `catchUp: true`.

Each fire is dispatched as a `ezcorp/schedule-fire` JSON-RPC **notification** to the extension subprocess. Cron fires are **ownerless** — no conversation, user, or run — so a host-issued correlation token (`registerFireCallProvenance({ ownerless: true })`) makes any reverse-RPC the fire handler attempts soft-fail cleanly (`-32106` + info log) instead of hanging on a missing `onBehalfOf`.

### Reverse-RPC: fire-now only (`src/extensions/schedule-handler.ts`)

The only reverse-RPC an extension can send over `ezcorp/schedule` is `action: "fire-now"`. `handlePiSchedule` validates the cron is in the extension's granted `crons` list (defense-in-depth over the manifest reconcile), checks the daily quota, and routes through `ScheduleDaemon.fireNow` — which inserts a `running` fire and dispatches immediately. Soft-fail codes: `-32001` (permission missing / `cron-not-declared` / `schedule-disabled`), `-32103`/`-32601`/`-32603` for quota / unknown-action / no-daemon. There is no register/list reverse-RPC — those live at the manifest tier.

### SDK client (`packages/@ezcorp/sdk/src/runtime/schedule.ts`)

`Schedule.on(cron, handler)` registers a per-cron handler and installs a single `ezcorp/schedule-fire` receiver. A fire for a cron with no registered handler is **silently dropped** (the host should never fire an undeclared cron — defense-in-depth). `Schedule.fireNow(cron)` sends the reverse-RPC above (counts against quota). The handler receives `{ cron, scheduledAt, firedAt, fireId, catchUp, retry, attempt }`.

### The Loop primitive (`packages/@ezcorp/sdk/src/runtime/loop.ts` + `loop-core.ts` + `loop-store.ts` + `loop-log.ts`)

`defineLoop({ id, trigger, contract, act, log })` is an I/O-bearing facade that composes a **pure state machine** (`loop-core.ts`), a **Storage-backed run store** (`loop-store.ts`), and the existing SDK trigger primitives. It owns **no new transport and no host table** — run-state lives in the SDK `Storage` KV. Registration flow:

1. `resolveContract` (in `loop-core.ts`) fills every gap: `states` (default `["done"]`), `terminal` (default = all states), `scope` (default `"global"`), `maxRuns`/`maxEventsPerRun` (100 / 50), failure `classify` (default all `transient`) + `autoDisableAfter`.
2. A `LoopRunStore` is constructed per `(loopId, scope)`. It stores **one Storage key per run** (`loop:<id>:run:<runId>`) plus an index key (`loop:<id>:index`) and a meta key (`loop:<id>:meta`), every mutation under `withLock` — fixing ez-code's single packed-array key that raced under concurrent fires.
3. `wireLog` registers the optional dashboard (and **throws** if `log.dashboard` is set on a non-`global` loop).
4. Each `trigger` is wired (`wireTrigger`):
   - **cron** → `new Schedule().on(cron, …)` (rides the daemon above).
   - **event** → `registerEventHandler(event, …)`, with an optional `filter` whose falsey result records a `skip`.
   - **manual** → a tool handler accumulated into a shared map; exposed via `getLoopTools()` and merged into one `createToolDispatcher` (last-call-wins). A duplicate manual `tool` name throws at registration.
5. A shared `task:assignment_update` event handler is installed once (`ensureAssignmentHandler`) to fan deferred completions back to whichever loop owns the matching open run.

A **fire** (`runFire`) resolves settings (`{}` fallback), builds the `act` context, runs `act`, and persists:

- **Terminal** result → `store.claim` writes the run already at its terminal status carrying the `outcome` (single event-log entry), then `afterTerminal` mirrors the artifact + pushes the dashboard.
- **Deferred** result → an open run keyed by the spawned `runId`; the later `task:assignment_update` maps the host status onto `contract.states` (`mapAssignmentStatus`) and closes it.
- **Skip** → first-class decline (logged, not an error).
- A **thrown** `act` is classified (`classifyFailure`): a `transient` error resets the consecutive counter; a `permanent` one increments it and auto-disables at `autoDisableAfter` (firing `onAutoDisable`). It is **never re-thrown** to the host — fires are fire-and-forget.

Idempotency: a `contract.idempotencyKey(input)` that matches a still-**OPEN** run makes the fire a no-op (`findOpenDuplicate`) — safe under cron catch-up + double-delivered events. A key that only matches **terminal** runs is *not* a dupe. Retention (`trimRetention`) evicts the **oldest terminal** runs first; an open run is never dropped.

### Artifact mirror & dashboard (`loop-log.ts`)

`log.artifact(run, outcome)` returns `{ path, body }` written under `.ezcorp/extension-data/<loop>/<path>` via host-mediated `fsWrite`/`fsMkdir` — **fail-soft** (a write error never fails the run) and **never the source of truth**. `log.dashboard` registers a Hub page whose `render(runs)` re-derives the run list; the primitive pushes a fresh tree (content-free SSE invalidation) on every state change and routes `rowActions` through. **A dashboard requires `contract.scope: "global"`** — the Hub page tree is cached per-`(ext, page)` and served to all users, so a `user`/`conversation`-scoped store would leak runs cross-user; `wireLog` throws at registration to make this a loud install-time crash.

## Usage

### Declaring a schedule (manifest)

```jsonc
// ezcorp.config.ts / manifest permissions
"schedule": {
  "crons": ["0 9 * * 1-5"],        // max 8, 5-field, ≥5-min interval
  "maxRunsPerDay": 12,             // default 24
  "maxRunDurationMs": 300000,      // default 300000 (5 min)
  "missedRunPolicy": "fire-once",  // skip | fire-once (default) | fire-all
  "maxRetries": 0                  // >0 opts into at-least-once
}
```

### SDK calls

```ts
import { Schedule } from "@ezcorp/sdk/runtime";
const schedule = new Schedule();
schedule.on("0 9 * * 1-5", async (ctx) => { /* ctx.fireId, ctx.catchUp, … */ });
await schedule.fireNow("0 9 * * 1-5");   // counts against maxRunsPerDay
```

```ts
import { createToolDispatcher, defineLoop, getChannel, getLoopTools } from "@ezcorp/sdk/runtime";
defineLoop({
  id: "summarize",
  trigger: { kind: "event", event: "run:complete" },
  contract: { states: ["done"], scope: "user", idempotencyKey: (i) => i.conversationId },
  act: async (ctx) => { /* ctx.input, ctx.settings, ctx.llm, ctx.recentMessages, ctx.spawn, ctx.log */
    return { kind: "terminal", status: "done", outcome: { summary: "…" } };
  },
  log: { artifact: (run, o) => ({ path: `summaries/${run.id}.md`, body: o.summary }) },
});
createToolDispatcher({ ...getLoopTools() });   // merge loop manual tools with your own
getChannel().start();
```

### Triggers, env vars & reverse-RPC

- `LoopTrigger`: `{ kind: "cron", cron, timezone? }` | `{ kind: "event", event, filter? }` | `{ kind: "manual", tool?, pageAction? }`. One trigger or an array.
- Reverse-RPC method: `ezcorp/schedule` with `{ action: "fire-now", cron }`. Fire notifications arrive on `ezcorp/schedule-fire`.
- `EZCORP_DISABLE_SCHEDULE_DAEMON=1` — fence off cron-driven extensions in an env.
- `global:sdkScheduleRetentionDays` setting (default 90) — retention sweep for schedule capability-call audit rows (hourly, in `background-timers.ts`).
- `EZCORP_PROJECT_ROOT` — where the SDK side resolves `.ezcorp/extension-data/<loop>/` for artifact mirrors.

## Key files

- `src/extensions/cron.ts` — 5-field cron parser; `validateCron`, `parseCron`, TZ/DST-safe `next()`.
- `src/extensions/schedule-reconcile.ts` — `reconcileSchedules` manifest→`extension_schedules` non-destructive mirror.
- `src/extensions/schedule-daemon.ts` — `ScheduleDaemon`: claim-before-dispatch tick, caps, retries, reaping, missed-run policy, `fireNow`.
- `src/extensions/schedule-handler.ts` — `handlePiSchedule` reverse-RPC handler (`fire-now` only; quota + manifest enforcement + audit).
- `src/startup/background-timers.ts` — boots the `ScheduleDaemon` singleton (and stops it on shutdown); `EZCORP_DISABLE_SCHEDULE_DAEMON` gate.
- `src/startup/process-lockfile.ts` — PID-reuse-safe lockfile primitive the daemon uses for single-process enforcement.
- `src/extensions/types.ts` — `permissions.schedule` grant shape (`crons`, `maxRunsPerDay`, `maxRunDurationMs`, `missedRunPolicy`, `maxRetries`).
- `src/db/schema.ts` — `extension_schedules` + `extension_schedule_fires` tables (Phase 51).
- `src/extensions/audit-actions.ts` — `SDK_SCHEDULE_*` audit action constants (registered / fire / fire-now / disabled / reaped / quota-exceeded).
- `packages/@ezcorp/sdk/src/runtime/schedule.ts` — `Schedule` SDK client (`on`, `fireNow`).
- `packages/@ezcorp/sdk/src/runtime/loop.ts` — `defineLoop` facade: trigger wiring, fire execution, deferred dispatch fan-out, `getLoopTools`.
- `packages/@ezcorp/sdk/src/runtime/loop-core.ts` — pure state machine: `resolveContract`, `createRun`, `transition`, `findOpenDuplicate`, `trimRetention`, `classifyFailure`, `validateActResult`.
- `packages/@ezcorp/sdk/src/runtime/loop-store.ts` — Storage-backed run store (per-run keys + index + meta, all under `withLock`).
- `packages/@ezcorp/sdk/src/runtime/loop-log.ts` — `wireLog` dashboard wiring + `runTerminalLog` artifact mirror; `global`-scope privacy guard.
- `packages/@ezcorp/sdk/src/runtime/loop-types.ts` — `LoopDefinition`, `LoopContract`, `LoopTrigger`, `ActResult`, `LoopRunState` types.
- `docs/extensions/examples/sample-loop/index.ts` — runnable reference loop (+ `try-loop.test.ts` hands-on demo).

## Features it touches

- [[runtime-and-rpc]] — fires + `fire-now` ride the extension subprocess JSON-RPC channel (`ezcorp/schedule`, `ezcorp/schedule-fire`).
- [[permissions-and-grants]] — `permissions.schedule.crons` + per-grant caps (`maxRunsPerDay`, `maxRetries`, `missedRunPolicy`) gate every fire.
- [[hub-pages]] — `log.dashboard` registers a Hub page with content-free SSE invalidation; row actions route back through the loop.
- [[audit-and-observability]] — every fire / fire-now / disable / reap / quota-exceeded emits an `SDK_SCHEDULE_*` audit row.
- [[overview-and-authoring]] — schedules are manifest-declared; loops are authored against the SDK runtime.
- [[data-and-entities]] — durable run-state lives in the SDK `Storage` KV; `.ezcorp/extension-data/<loop>/` holds artifact mirrors only.
- [[bundled-catalog]] — the bundled `memory-extractor` (event capture + cron compaction loops) and `lessons-distiller` (event capture loop) are built on `defineLoop`. `ez-code` is **not** migrated — it stays bespoke (`spawnAssignment` + a hand-wired `Schedule.on` cron + its own `task:assignment_update` handler), but its exported pure helpers are what `loop-core.ts`'s deferred state machine was generalized from.
- [[daily-briefing]] — `BriefingDaemon` is a sibling claim-before-dispatch daemon mirroring the same `next_fire_at`/missed-run invariants.
- [[runs-lifecycle]] — deferred loops `spawn` long-lived runs and close on inbound `task:assignment_update` events.
- [[sandbox-and-isolation]] — loop fs writes must go through host-mediated `fsWrite`/`fsRead`, never `node:fs` (the sandbox poisons it).

## Related docs

- [Loops — `defineLoop`](../../extensions/loops.md) — the primary author-facing spec for the Loop SDK primitive.
- [Data Storage Convention](../../extensions/data-storage.md) — the `.ezcorp/extension-data/<loop>/` artifact layout.
- [Pages](../../extensions/pages.md) — the Hub page model the loop dashboard reuses.
- [API Reference](../../extensions/api-reference.md) — `Storage`, `Schedule`, `spawnAssignment`, fs helpers.
- The standalone cron **daemon** has no dedicated doc — this file is its primary reference.

## Notes & gotchas

- **Manifest is the source of truth for crons.** The SDK `Schedule.on()` for a cron not in the manifest is silently dropped, and the reverse-RPC `fire-now` hard-rejects an undeclared cron. You cannot register a cron from extension code at runtime; edit the manifest and re-activate to reconcile.
- **Cron rules are strict.** 5-field only (no `@hourly`, no seconds), and the **5-minute minimum** rejects any expression with two fires less than 5 minutes apart (`* * * * *`, `*/1..*/4`, `0-59 * * * *`, `* 9 * * *`, ...). The validator returns a `reason` you can surface.
- **At-most-once is the default; retries are opt-in.** With `maxRetries: 0`, a crash-mid-fire `running` row is left `running` forever (audited, not retried) to preserve at-most-once. Set `maxRetries > 0` only if your handler is idempotent.
- **Cron fires are ownerless.** No conversation/user/run context — capability reverse-RPCs from a fire handler clean-soft-fail (`-32106`). Don't write a fire handler that assumes an active user or conversation.
- **The claim relies on a single writer, not row locks.** `tick()` does a plain `SELECT … LIMIT 100` on both Postgres and PGlite — `FOR UPDATE SKIP LOCKED` is documented in the source as the intended multi-writer path but is **not** implemented. The PID lockfile is what guarantees the single writer the at-most-once invariant depends on.
- **Daemon is a process-wide singleton.** Started once from `background-timers.ts` behind a `started` flag; a sibling refuses via the PID lockfile. Disabling it (`EZCORP_DISABLE_SCHEDULE_DAEMON=1`) freezes all cron-driven loops in that env.
- **A loop dashboard forces `global` scope.** `defineLoop` throws at registration if `log.dashboard` is present on a `user`/`conversation`-scoped loop — the Hub page is cross-user cached. Keep per-user runs on a separate scoped loop with no dashboard.
- **Loop run-state is Storage, never the filesystem.** `.ezcorp/extension-data/<loop>/` is artifacts/config only (fail-soft mirror). Durable state, idempotency, retention, and scoping all come from the `Storage` KV under `withLock`.
- **Manual-tool name collisions throw.** Because `createToolDispatcher` is last-call-wins, two loops claiming the same manual `tool` name (or a loop tool clashing with a hand-written one not merged via `getLoopTools()`) silently clobber — so `defineLoop` makes a same-extension collision a loud install-time error, and you must spread `getLoopTools()` into your single `createToolDispatcher` call.
- **`fire-all` can lose data under quota.** Missed-run `fire-all` enumeration is capped at `maxRunsPerDay`; slots beyond the cap in a long offline window are dropped (documented invariant), and `_nextForTesting` in `cron.ts` is a test-only stub — never use it in production paths.
