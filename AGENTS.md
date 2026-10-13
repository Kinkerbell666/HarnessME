## Project

EZCorp — a self-hosted AI platform for multi-model chat with persistent memory and an extension ecosystem.

**Goals:**
- **Extensibility** — user-built extensions for custom UI, tools, and interactions
- **Security** — RBAC and per-tool-call permissions for LLM actions
- **Reliability** — safe migrations, durable storage, single-container deploy

**Stack & layout:**
- `src/` — Bun backend: runtime executor + built-in tools, providers, auth/RBAC, db, extension host
- `web/` — SvelteKit frontend (Svelte 5 runes, Vite, Tailwind 4) — see `web/CLAUDE.md`
- `packages/@ezcorp/` — bun workspaces: `sdk` (extension authoring), `ai-kit` (LLM-driver integration kit), `harness-client` (remote-control client)
- `extensions/` and `docs/extensions/examples/*/` — first-party source built into immutable v4 releases; activation requires exact human approval. Read `src/extensions/CLAUDE.md` before changing extension authoring, execution, or authority.
- `worker/` — Cloudflare Workers deploy target (LLM-only agents reusing `src/runtime/executor` with stubbed shell/file providers)
- Database: PGlite embedded by default; external Postgres via `DATABASE_URL` (`Bun.sql`)

---

## Development lifecycle (binding)

Trunk-based: branch off `main` (`feat/ fix/ ci/ docs/ chore/ security/`), open a
PR, land all required checks green + a non-author review, squash-merge to `main`
(always deployable), release via an `app-vX.Y.Z` tag. Full spec (including the
complete required-check table): [docs/development-lifecycle.md](docs/development-lifecycle.md).

**Feature contract — every feature you ship MUST:**
1. Cover each **new source file** to its threshold (default **100%**) and add a
   key to `scripts/coverage-thresholds.json` (or a justified `EXCLUDES` entry in
   `scripts/coverage-config.ts`).
2. Cover **every new/changed executable line** (patch-coverage gate).
3. Add/update a **Playwright e2e spec** under `web/e2e/` for user-facing behavior.
4. For a **frontend-visual change** (route/layout pages, `web/src/lib/components/**`,
   css), ship an `@evidence`-tagged Playwright e2e spec under `web/e2e/` that
   calls `captureEvidence(page, testInfo, label)`. The `Visual evidence` CI gate
   enforces a spec is present and the bot attaches screenshots to the PR.
5. **Never** weaken the gate or fake green — no lowered thresholds, no new
   `EXCLUDES`, no `.skip/.only/.todo`, no assertion-free tests, no empty
   `catch {}` in test files, no committed `coverage/lcov.info`, and no
   **`biome.json`** opt-out (a new `"!<path>"` in `files.includes`, a new or
   widened `overrides[]` that turns a rule `"off"`, or a severity lowered out
   of `"error"` — only `error` blocks). These are blocked by the
   `Gate integrity` CI check; a maintainer-only `gate-change-approved` label
   is the only bypass (you cannot apply it).

The gate files (`scripts/coverage-*.ts`, `coverage-thresholds.json`, CI
workflows, `playwright.config.ts`) are CODEOWNERS-owned — changing them needs
human review. Verify locally before pushing:
`bun run typecheck && bun run lint && bun run test && bun run test:coverage`.
**That line does NOT cover everything CI does** — `bun run test` is the backend
pool only (not `scripts/test-web.sh`, not Vitest, not e2e), `bun run test:e2e`
runs the whole backlog rather than CI's manifest-defined `mock-gate` lane, and a rebase
invalidates any baseline you measured before it. Details and the exact lane
invocation:
[docs/development-lifecycle.md](docs/development-lifecycle.md#what-the-local-commands-do-not-cover).
Checked-in git hooks (`.githooks/`, auto-wired by `bun install`) shift the cheap
checks left — pre-commit lint + manifest-lock, pre-push lint/typecheck/svelte-check;
bypass with `EZ_SKIP_HOOKS=1` or `--no-verify`. They're advisory; CI is the gate.
See [docs/development-lifecycle.md](docs/development-lifecycle.md#local-hooks-shift-left).

**Worktree isolation (binding):** ALWAYS run agents in a separate git
worktree — never let a spawned agent edit the primary working directory
directly. Before delegating work, create an isolated worktree on its own
branch (`git worktree add ./.worktrees/<slug> -b <branch>`), point the
agent at that path, and have it do all reads/writes/commits there. This
keeps parallel agents from contaminating each other or the main tree, and
keeps `main` clean. Give Agent/Workflow tools that precreated path;
automatic `isolation: "worktree"` creates checkouts in `.claude/worktrees/`.
Notes: `tasks/` is gitignored and does NOT propagate to a fresh worktree —
copy any planning docs over after `git worktree add`; and dev-container
compose mounts resolve relative paths from the compose CWD, so recreate the
container from the worktree dir if it must serve worktree edits.

---

## Bun

Default to Bun instead of Node.js: `bun <file>`, `bun install`, `bun run
<script>`, `bunx <pkg>`. Bun auto-loads `.env` — don't use dotenv.

Don't add replaced deps:
- `Bun.serve()` (WebSockets/HTTPS/routes built in) — no `express`, no `ws`
- PGlite embedded + `Bun.sql` for external Postgres — no `pg`/`postgres.js`/`bun:sqlite`/`better-sqlite3`
- `Bun.redis` if Redis is ever introduced (none today) — no `ioredis`
- Prefer `Bun.file` over `node:fs` read/write; Bun.$`cmd` over execa

## Podman

Use rootless Podman. The development and production stacks need different
Compose overrides; they are not interchangeable.

### Development stack — Linux only

The development stack uses host networking and does not run on macOS or
Windows. Prepare `.env` as described in the README, start the rootless socket
once, then use the repository wrapper. The wrapper always loads
`docker-compose.yml` plus `compose.podman.yml`.

```sh
systemctl --user enable --now podman.socket
bun run podman up -d --build
bun run podman logs -f app
bun run podman down
```

Use `bun run podman --profile ollama up -d` to add the optional Ollama
sidecar. If you run the web server on the host instead of in Compose, use
`bun run dev:stack` so it connects to the Compose Postgres database.

### Production stack — Linux or macOS

Prepare `.env.prod` as described in the README. Create the bind sources as
your login user. Rootless Podman maps that user to the image's uid/gid 1000,
so do not run the Docker-only `sudo chown -R 1000:1000` step.

```sh
mkdir -p .ezcorp/data .ezcorp/extensions .ezcorp/extension-data .ezcorp/projects
```

On Linux, start the rootless socket, point Docker Compose at it, and start the
stack:

```sh
systemctl --user enable --now podman.socket
export DOCKER_HOST="unix:///run/user/$(id -u)/podman/podman.sock"
docker compose -f compose.prod.yml -f compose.podman-prod.yml \
  --env-file .env.prod up -d --build
```

On macOS, start `podman machine`, set `DOCKER_HOST` to the machine socket, and
start the stack with the standalone Docker Compose provider:

```sh
podman machine start
export DOCKER_HOST="unix://$(podman machine inspect \
  --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
docker-compose -f compose.prod.yml -f compose.podman-prod.yml \
  --env-file .env.prod up -d --build
```

See [docs/deployment.md](docs/deployment.md#running-the-production-stack-under-rootless-podman)
for first-time macOS machine setup, UID-range checks, verification, and
troubleshooting.

## Testing

Three runners; use the wrapper scripts, not raw `bun test` at the root.

- **Backend (`src/`)** — `bun run test` → `scripts/test.sh`, one isolated bun
  process PER FILE. **Never bare `bun test` at the repo root** — globbing the
  full backend pool into one process deadlocks on cross-file `mock.module()`
  contamination (it hangs, not fails). Targeted single-file runs
  (`bun test src/__tests__/foo.test.ts`) are fine.
- **Web** — plain unit tests: `scripts/test-web.sh`; Svelte component/server
  tests: Vitest, the one sanctioned Vitest surface (details: `web/CLAUDE.md`).
- **E2E** — Playwright in `web/e2e/`: `bun run test:e2e` (mock tier); real
  tier `web/playwright.real.config.ts` + `PI_E2E_REAL=1`.
- **Coverage** — `bun run test:coverage` → sharded bun coverage + package legs
  + a Node-run Vitest leg, merged into `coverage/lcov.info` and gated against
  `coverage-thresholds.json`. **It reports two verdicts and three exit codes:**
  `0` = coverage passed and no test failed; `1` = the COVERAGE verdict failed
  (thresholds, a gating leg, a dead producer); `2` = coverage passed but TESTS
  FAILED. Read the code, not just "non-zero" — and never read `0` off a run
  whose banner says `N fail`. It used to exit 0 in exactly that case.

Write backend/unit tests with `bun:test`. Lint and typecheck are separate:
`bun run lint` (biome) and `bun run typecheck`.

**A fresh worktree needs TWO installs, and skipping the second looks like a
code failure.** `web` is NOT a bun workspace (`workspaces` is only
`packages/@ezcorp/*`), so a root `bun install` leaves `web/node_modules` empty
and `web/.svelte-kit` ungenerated. The gate-integrity tests also need their
own locked parser (`scripts/gate-integrity-rule11.test.ts` fails closed with
`TypeScript AST parser is unavailable` without it). Run all three:

```sh
bun install --frozen-lockfile && bun install --cwd web --frozen-lockfile \
  && bun install --cwd .github/gate-integrity-deps --frozen-lockfile --ignore-scripts
```

Measured, because the symptoms do not name their cause: without the `web`
install, `bun run test:coverage` on a clean `main` reported **157 failing
files** and killed two coverage legs with
`could not determine executable to run for package svelte-kit`; the same
commit after both installs is `22967 pass | 0 fail`. `bun run typecheck` fails
the same way, as implicit-`any` errors plus a missing `.svelte-kit/tsconfig.json`.
Two agents lost time to this in one day. If a fresh worktree reds broadly,
check `ls web/node_modules` before you debug a single test.

**What the gate costs — measured, so don't estimate it.** On a 32-core / 30 GB
box with six other agents running (1273 backend files): `bun run test` is
**~6 min** and `bun run test:coverage` is **6m38s**. Both are runnable in one
sitting. Agents that priced them as "too slow to run" and pushed on a partial
local check are the direct cause of red CI.

**Raising `PARALLEL` is not the lever.** Measured back to back on that box:
`bun run test` was 325s at the default width and 309s at `PARALLEL=12` — five
percent. `bun run test:coverage` was **worse**: 639s green at the default vs
1121s at `PARALLEL=12`, which also OOM-killed the suggest coverage leg. Each
file is its own bun + PGlite process, so the pool runs out of memory and IO
bandwidth long before it runs out of cores. That is what `default_parallel()`'s
cap at 6 is for. If several agents share one box, they are already
oversubscribing it between them — see the note on bun's default timeout below.

**Never assert on wall clock.** A `performance.now()` budget, a `Date.now()`
refill you race, a `setTimeout` deadline you `Promise.race` — under a parallel
pool these measure the HOST, not the code, and they fail on a busy box while
passing on a broken one. Pin the varying term instead: freeze `Date.now()` with
`spyOn` (`src/extensions/__tests__/workflows-handler.test.ts`), or compare two
interleaved arms in the same process so load cancels in the ratio
(`src/__tests__/marketplace-search-perf.test.ts`). The pinned form is always
the *stronger* assertion — bounds become equalities. Raising a threshold,
adding a retry, or tagging the test slow is weakening the gate.

**The migrated PGlite datadir is cached ACROSS processes, and its key is a
content hash — never a version number.** 399 backend files import
`src/__tests__/helpers/test-pglite.ts`, and each one used to boot a blank
PGlite and replay all of `migrate()`: measured 3.2–6.4s per process on a loaded
box, against 0.7–0.9s to restore a prepared datadir. The helper now publishes
that datadir to the gitignored `.cache/pglite-snapshots/`, so the pool pays for
the migration once per RUN instead of once per FILE. The key
(`src/__tests__/helpers/pglite-snapshot-cache.ts`) hashes everything that can
change the result: the whole transitive import closure of `src/db/migrate.ts`
(including the modules it reaches only by lazy `import()`), `src/db/schema.ts`,
the helper itself, the installed PGlite version, `bun.lock`, and the two
`EZCORP_SELF_PROJECT_*` vars `seedSelfProject` reads. **This repo has no
migration version table, so there is nothing to key on but content — a stale
entry would be a silent false green on schema, where every test passes against
the old database.** Never narrow that input set; over-invalidation costs one
rebuild per run, under-invalidation costs the gate. If you suspect the cache,
`EZ_PGLITE_SNAPSHOT_CACHE=0` disables it and deleting `.cache/` is safe.

**A bare `bun test <file>` gets bun's 5s hook budget; the pool gets 30s.**
`scripts/test.sh` passes `--timeout 30000` because a DB suite's `beforeAll`
restores a migrated PGlite datadir, and that is not a 5s operation on a shared
box. Measured with 20 concurrent copies of one file: **20/20 red** under the
bare default, **20/20 green** through the wrapper, same code. So when a
targeted run reds in a hook (`(unnamed) [5xxx ms]`, or the file's *first* test
timing out), suspect the box before the test — re-run it through `bun run test`
or with `--timeout 30000` and see if it survives. Raising a hook timeout in a
shared helper to make that green is treating a saturated machine as a code
defect.

**Coverage trap — a `bun:test` under `src/` must not import a `web/src/lib/**`
module the vitest leg measures.** Bun's coverage emitter attributes zero-hit
`DA` records to the DECLARATION lines of a multi-line function signature, which
V8 — and so the vitest leg — never emits at all. `merge-lcov.ts` sums per
`(SF, line)`, so those bun-only zero-hit lines survive the merge as genuine
misses no test can ever reach, and the module's coverage DROPS. One such import
took `web/src/lib/workflow-delegations-logic.ts` from 100% to 79.6% without a
line of it becoming less tested. Assert from the vitest side instead (it
resolves both trees), or parse the file rather than importing it. Worked
examples: `web/src/__tests__/delegation-consent-handoff.unit.test.ts`,
`src/__tests__/author-draft-allowlist-parity.test.ts`.

**Coverage trap — the vitest leg can only measure `web/`, so a vitest test for
a repo-root `src/` module contributes ZERO lcov.** That leg runs
`cd web && npx vitest run …`, so all 224 `--coverage.include` patterns in
`scripts/test-coverage.sh` are `web/`-relative and the leg's lcov is then
re-rooted with `sed 's#^SF:src/#SF:web/src/#'`. Nothing outside `web/` can be
named on either side. A `src/**` module exercised only by a vitest suite reads
as untested however green that suite is — the mirror image of the two-allowlist
trap the file already documents (a suite on the run list but not the include
list). Cover a `src/` module from the bun pool; the vitest leg is for `web/`.

**Coverage trap — an importing-only shard's flat zero block used to outvote the
shard that RAN the code.** Bun span-fills an unexecuted function with a
contiguous `DA:<line>,0` block (blanks and comments included), while the shard
that executes it emits a sparse, sourcemap-shifted record set that skips real
statements — measured on `src/runtime/mention-wiring.ts`: 512 records from the
executing shard, 528 from the importing one, and 6 statements inside a function
that ran 40+ times named by neither. `merge-lcov.ts` now drops such a zero as
NO EVIDENCE (out of both `LH` and `LF`) when some shard executed straight
across the line and no shard measured it per statement; a line no shard
executed still reads as a miss. Two consequences for authors: you no longer
have to reshape source so bun's shifted attribution lands on a statement, and
`max`-per-line was never the fix — sum and max agree at the 0-vs-nonzero
boundary, and these lines have no record at all in the executing shard. See
`src/__tests__/merge-lcov-shard-vote.test.ts`.

## Binding invariants (digest)

Full rules live in the linked docs and nested CLAUDE.md files; these are the
ones that break things silently if missed:

- **The dev data lives in the compose Postgres, NOT in `~/ez-corp/.data`** —
  `DATABASE_URL` is set only on the `app` service in `docker-compose.yml`, so
  a host-side `bun run dev` silently falls back to an empty embedded PGlite
  and redirects to `/setup`. That looks exactly like data loss and has already
  been misdiagnosed as such. Use **`bun run dev:stack`**. Never put
  `DATABASE_URL` in `.env` — Bun loads it into every process and
  `__tests__/preload.ts` would then run the whole pool against that database
  ([platform/database-and-migrations.md](docs/features/platform/database-and-migrations.md)).
- **Session tree** — `parentMessageId` is append-only. The one sanctioned
  mutation is `reparentMessage()` (steered-row reconciliation), called only
  from `subscribe-bridge.ts`; rewind/retry never reparent
  ([chat/rewind-branching-sessions.md](docs/features/chat/rewind-branching-sessions.md)).
- **Context compaction is input-only** — never mutate `model.maxTokens` or
  clone the model to "save context"; trim input only, `responseReserve` is
  never written back ([docs/context-compaction.md](docs/context-compaction.md)).
- **Mention/command/feature expansion is literal** — the raw token is
  persisted, expanded text is never re-parsed for other mention kinds, unknown
  targets are silent no-ops
  ([composer/mention-grammar.md](docs/features/composer/mention-grammar.md),
  [docs/slash-commands.md](docs/slash-commands.md)).
- **Extensions** — state only under `<projectRoot>/.ezcorp/extension-data/<name>/`;
  `.ezcorp/data` is never reachable from a sandbox; host-side loggers only via
  `extensionLogger()` (`src/extensions/CLAUDE.md`).
- **API surface** — every new `/api/*` route registers in `src/api-registry.ts`
  with a scope; `/api/__test/**` routes gate on fail-closed
  `isTestSurfaceEnabled()`; new runtime event names go ONLY in
  `web/src/lib/runtime-event-names.ts`
  ([docs/harness-contract.md](docs/harness-contract.md), details: `web/CLAUDE.md`).

## Where to look

Canonical subsystem index: [docs/features/README.md](docs/features/README.md)
(50+ docs, each with a "Key files" section). Read the matching doc before
touching a subsystem:

| Working on | Read first |
|---|---|
| `web/` frontend, components, composer UI, e2e | `web/CLAUDE.md` |
| `src/extensions/` host, extension authoring | `src/extensions/CLAUDE.md` |
| DB & migrations (Drizzle, `src/db/`) | [platform/database-and-migrations.md](docs/features/platform/database-and-migrations.md) |
| Auth, RBAC, permission modes (`src/auth/`) | [platform/rbac-and-permission-modes.md](docs/features/platform/rbac-and-permission-modes.md) |
| Streaming runtime & runs (`src/runtime/`) | [chat/streaming-runtime.md](docs/features/chat/streaming-runtime.md) |
| Providers, routing, failover (`src/providers/`) | [docs/llm-routing-and-failover.md](docs/llm-routing-and-failover.md) |
| Memory & knowledge base (`src/memory/`) | [chat/persistent-memory.md](docs/features/chat/persistent-memory.md) |
| Session tree, rewind/branching (`src/db/session-*`) | [chat/rewind-branching-sessions.md](docs/features/chat/rewind-branching-sessions.md) |
| Context compaction (`src/runtime/stream-chat/`) | [docs/context-compaction.md](docs/context-compaction.md) |
| Mentions, slash commands, suggestions (`src/suggest/`), EZ actions | [composer/](docs/features/composer/) |
| Orchestration: agents/teams/modes/workflows | [orchestration/](docs/features/orchestration/) |
| Hub, marketplace, loops/webhooks/scheduling | [extensions/](docs/features/extensions/) |
| Remote control & test surfaces | [docs/harness-contract.md](docs/harness-contract.md) |
| Settings / observability / audit | [platform/](docs/features/platform/) |
| Deploy & releases | [platform/deployment-and-releases.md](docs/features/platform/deployment-and-releases.md) |
