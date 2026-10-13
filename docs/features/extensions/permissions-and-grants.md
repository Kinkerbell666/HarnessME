# Extension Permissions & Grants

> _The Policy Decision Point (PDP) that gates every privileged extension operation — capability subset checks, interactive sensitive-cap prompts with a four-scope always-allow model, grant-independent hard-denies for the platform DB, supply-chain ceilings/lockfiles for bundled code, TTL grant expiry, and host-issued reverse-RPC provenance._

## Intent

Extensions in EZCorp run model-authored or user-authored code that can read/write the filesystem, shell out, hit the network, call LLMs, spawn agents, and mutate platform state. The permission system exists to make every such action consent-gated and auditable: a single Policy Decision Point maps an extension's effective grants to an `allow` / `deny` / `prompt` decision per capability per call, the most-sensitive capabilities (`shell`, `fs.write`, install/modify) prompt the user interactively, the platform's own database + secret directory is hard-denied regardless of grant, and bundled first-party code is bounded by a hardcoded ceiling plus a manifest lockfile so a supply-chain compromise can't silently widen scope. Grants age out on a TTL sweep, and reverse-RPC calls carry a host-minted provenance token so the host never trusts subprocess-supplied identity.

## How it works

### Capability model (`capability-types.ts`)

- A `Capability` is a `{kind, value?}` pair. `CapabilityKind` is a closed union: `network`, `fs.read` / `fs.write` / `fs.list` / `fs.stat`, `shell`, `env`, `storage`, and the namespaced `ezcorp:*` caps (`chat:append`, `agent:config`, `agent:spawn`, `tasks:emit`, `events:subscribe`, `extension:install`, `extension:modify`, `mcp:invoke`).
- `ezcorp:mcp:invoke` is the valueless **dispatch sentinel** every `kind:"mcp"` tool needs. It exists because an empty declaration produces an empty needed set, which `firstMissingCapability` can never fail — see the note below on why that is an unconditional allow. Not sensitive: MCP tools dispatch from cron/webhook/workflow contexts where a `prompt` is unanswerable.
- `SENSITIVE_KINDS` = `{ shell, fs.write, ezcorp:extension:install, ezcorp:extension:modify }`. These are the caps that trigger an interactive prompt when no always-allow row exists.
- Comparison logic is centralized: `capabilityCovers` (per-kind matching — `fs.*` is **prefix-match** `/foo` covers `/foo/bar` but not `/foobar`; `network` / `env` / `ezcorp:*` are exact), `isSubset`, `firstMissingCapability`, and `intersect`.
- Two translators feed the PDP: `capabilityDeclarationToSet` (a tool's manifest `CapabilityDeclaration` → needed set) and `grantsToCapabilitySet` (an extension's installed `ExtensionPermissions` grant blob → granted set). Both expand the `$CWD` token via `expandGrantPrefix` so the needed↔granted compare stays consistent.

### The PDP — `engine.authorize(ctx, needed)` (`permission-engine.ts`)

`createPermissionEngine` returns a process-singleton (via `getPermissionEngine`) shared by every short-lived `ToolExecutor`. Construction is **fail-closed**: it throws if `registry`, `bus`, or the opaque `db` token is missing. `authorize` runs in order:

1. **Resolve the effective grant set**, most-specific first:
   a. `ctx.capContext` — the `intersect(callerCaps, calleeCaps)` set for a cross-extension `ezcorp/invoke`.
   b. A per-conversation override (`loadConversationOverride`) — written by the spawn-assignment handler so a sub-conversation is capped by `intersect(parent, child-agent)` without mutating installed grants. A TTL-bounded process cache (`OVERRIDE_CACHE_TTL_MS` = 60 s) absorbs PGlite warm-up lag; **a post-cache DB read failure fails CLOSED** (deny, reason `override-lookup-failed`).
   c. The extension's installed registry grants (default).
2. **Subset check** — `firstMissingCapability(needed, granted)`. The first missing cap is the deny reason → `{decision: "deny"}`.
3. **Sensitive-cap gate** — every needed cap in `SENSITIVE_KINDS` is checked in order; the first one that no always-allow row covers for the `(user, scope, scopeId, kind)` tuple returns `{decision: "prompt", promptId, sensitive}`. Consent for one sensitive cap never carries another in the same request. Carve-outs: `ezcorp:extension:install` / `ezcorp:extension:modify` force the always-allow read to `false` (never auto-allowed, prompt every time). **Bundled-ceiling auto-allow**: a registered bundled extension (`registry.isBundled?.(id) === true`) skips the prompt for `shell` / `fs.write` (it already passed the subset check against its vetted ceiling) and is audited `bundled-ceiling-auto-allow` — but install/modify still always prompt.
4. **Allow** otherwise.

Every decision writes exactly one `auditLog` row (`AUDIT_PERM_ALLOWED` / `_DENIED` / `_PROMPTED`) via `insertAuditEntry`, with a `parentAuditId` chain so a spawned child's tool calls trace back to the spawn's authorize row. User/extension strings are control-char-stripped + length-capped before logging.

### Where the PDP is called

`engine.authorize` is the single gate consulted by every host-side handler: `tool-executor/executor.ts` (forward tool dispatch), `fs-handler.ts` (read/write/list/stat), `network-handler.ts`, `storage-handler.ts`, `mcp-proxy.ts`, `append-message-handler.ts`, `agent-configs-handler.ts`, `task-events-handler.ts`, `spawn-assignment-handler.ts`, `cancel-run-handler.ts`, `finalize-tool-call-handler.ts`, and `file-organizer-applier.ts`.

### Sensitive-cap prompt flow (`tool-executor/executor.ts` → gate → resolve route)

When `authorize` returns `prompt`, `ToolExecutor`:

1. Emits `tool:start` (so the card exists), then `tool:permission_request` scoped to the originating `userId` (the SSE filter in `sse-conversation-filter.ts` enforces single-subscriber delivery).
2. Registers a pending-permission entry keyed by `decision.promptId` so the run watchdog treats the wait as a legitimate human-input pause, not a hung tool.
3. Awaits `createExtensionPermissionGate(...)`, which resolves with `{allowed, scope, ttlOverrideMs}` when the user answers via **`POST /api/tool-calls/[id]/permission`** (handler `src/routes/tool-permission.ts`). That handler enforces ownership of the gate's conversation and **admin-gates `scope: "forever"`** (`user.role !== "admin"` → 403).
4. On allow, persists via the single writer `engine.resolvePrompt(promptId, true, scope, scopeId, {ttlOverrideMs})`. `resolvePrompt` is the *only* writer of always-allow grants: a `session` grant goes to the engine's in-memory set only (never to disk, gone on restart); every other scope writes a settings row. Install/modify approvals return early (one-shot, never persisted). On decline it throws `PermissionDeniedError` and terminalizes the card.

### Always-allow scopes & persistence (`permissions.ts`)

- `AlwaysAllowScope` = `"session" | "conversation" | "project" | "forever"`. The settings key is `alwaysAllowSettingKey({extensionId, userId, scope, scopeId, capability})` → `ext:<id>:<userId>:<scope>:<scopeId>:always_allow:<capability>` (per-user — closes a multi-user collision where two users shared one row). `forever` uses `scopeId: "*"`. `session` grants (`scopeId: session:<userId>`) are never written to this table.
- The persisted value is `AlwaysAllowRecord` (`buildAlwaysAllowValue`): `{allowed, grantedAt, ttlOverrideMs?, expiresAt?}`. `parseAlwaysAllowValue` reads both this shape and a legacy bare `boolean` (legacy `true` = "allowed, never expires"); anything malformed fails closed to `needs_confirmation`. Given `now`, a row whose `expiresAt` has passed also reads as `needs_confirmation`, so an expired grant prompts before the sweep revokes it.
- Always-allow grants are **kind-only**: `alwaysAllowCapKey(c) = c.kind`, so "Allow forever" on `fs.write` grants the kind for *any* path. `isAlwaysAllowed` probes scope candidates in order (`conversation`, `session`, `project`, then `forever`). It reads the persisted scopes from `settings` on every sensitive call (no positive cache), so a revoked or expired row denies on the next call.
- `readTtlOverrideMs` parses the per-row TTL override: `null` = "Never" (sweep skips), positive finite number = explicit override (wins over the TTL table + forever knob), `undefined` = legacy/absent → fall back to the config table.

### `$CWD` expansion & reserved-path hard-deny (`permissions.ts`)

- `expandGrantPrefix` maps the literal `$CWD` token (and `$CWD/<sub>`) to the **project root** via `grantCwdBase()` → `getProjectRoot()` — explicitly NOT `process.cwd()` (under the vite-SSR dev server cwd is `/app/web` but bundled extensions resolve their data dir relative to `/app`). `getProjectRoot` is imported statically (a lazy `require` silently fails under the SSR transform). In prod `getProjectRoot() === process.cwd()`, so it's a no-op.
- `resolveGrantPrefixCanonical` realpaths a granted prefix, tolerating a not-yet-created dir by resolving the lowest existing ancestor + re-appending the tail (bootstrap fix for a fresh project where `.ezcorp/` is absent). A non-existent component can't contain a symlink, so this adds no escape surface.
- `isReservedSensitivePath` is a **grant-independent hard-deny** wired BEFORE any allow (including the implicit install-dir allow) in both `checkFilesystemPermission` (read) and `checkPrefixForWrite` (write) in `fs-handler.ts`. It denies `<projectRoot>/.ezcorp/data`, `<projectRoot>/.ezcorp/backups`, and `getDbMaskDirs()` (`EZCORP_DB_PATH` + its `backups/` sibling) — the PGlite DB that holds the JWT/encryption secret in the `settings` table. Matching is realpath-resolved and **segment-bounded** (`p === reserved || p.startsWith(reserved + "/")`) so `.ezcorp/data-export` is NOT swept up. The extension store at `.ezcorp/extension-data/<name>/` stays fully allowed. This exists because Landlock is OFF in these containers, so the grant is otherwise the only gate.
- **A reserved-path deny is NOT a security violation.** Both gates return a discriminated `FilesystemDenialKind` — `not-found` / `reserved-carveout` / `out-of-grant` — and only `out-of-grant` (checked via `isGrantEscape`, whose lookup table is `satisfies Record<FilesystemDenialKind, boolean>` so a new kind is a compile error until classified) trips `denyAndDisable`. A `reserved-carveout` deny stays `-32001`, leaves the extension **enabled**, and writes one `ext:perm:denied` audit row with `metadata.reason = "reserved-path"`. Why: under the shipped Docker layout (`Dockerfile` — `EZCORP_DB_PATH=/app/data/ezcorp`, project root `/app`) the datadir sits *inside* the `$CWD` grant, so every project-root-walking extension (`ez-factory` `read_files`, `todo-tracker`, `claude-design`, `file-refactor`) listed it on its first correct run and was permanently disabled — with no `clearSecurityViolations` route to recover. `fs-handler.ts`'s `refuseFs` is the single router and the only path to `denyAndDisable` from the fs gates.

### Wiring an extension into a conversation (`src/auth/extension-wire-authz.ts`)

Attaching an extension to a conversation is what makes its tools callable by an LLM turn, so it is its own authorization question — distinct from the PDP (what the extension may DO) and narrower than the RBAC resolver it consults.

`canWireExtension(ext, actor)` is the single decision point, fail-closed:

1. **Bundled** rows are always wire-able — first-party code, ceiling-clamped and lockfile-pinned, carrying no admin-supplied credential.
2. **Non-MCP** extensions keep their prior behaviour (allowed). Gating every extension on the `use` scope would deny every member every extension on day one, because `extension_rbac_grants` is deny-by-default and no shipped instance seeds rows.
3. **MCP** extensions (`manifest.kind === "mcp"` OR `source` starting `mcp:` — two host-written signals, either sufficient) are wire-able only by (a) an instance **admin**, (b) the row's own **`creatorUserId`**, or (c) a member holding the dedicated **`mcp-wire`** grant at the conversation's (project, extension) coordinates. A NULL `creatorUserId` — every row predating the stamp — matches nobody, so legacy rows are admin-only.
4. No acting user, an inactive/deleted user, or a throwing grants lookup all **deny**.

Why MCP specifically: an MCP row is a stored connection plus the credential authenticating to it (`extension_secrets`, rehydrated host-side by `rehydrateMcpServerSecrets`). Installing one is admin-only on both axes, so wiring one must not be weaker than installing it. Before this gate any authenticated member could attach an admin-installed MCP server to their own chat and drive the admin's credential — and `requireScope(locals,"extensions")` was no barrier, because it is a no-op for cookie sessions.

**`mcp-wire` is a distinct core verb, not `use`.** `use` means "may act with this extension" and is asked on advisory rungs (github-projects poll-now / dashboard-data, `ctx.rbac.check`). Attaching an MCP extension spends an admin-installed credential the holder never sees, which is a different right. Reusing `use` would have retro-authorized every grant that already existed — and because `grantCovers` is NULL-covers-all, a single wildcard row (`projectId: null, extensionId: null, scopes: ["use"]`) would have authorized **every MCP server on the instance**. The separate verb makes an operator say this on purpose.

### The gate is asked at THREE seams

Wiring is not the only way an MCP tool reaches a dispatch. Gating only the wire step was cosmetic, because discovery is free (`GET /api/extensions` is read+auth) and neither dispatch path consults `conversation_extensions`:

| Seam | Where | What it was before |
|---|---|---|
| Wire route | `POST /api/conversations/[id]/extensions` | ownership + a scope that is a no-op for cookie sessions |
| Mentions | `![ext:…]` / `![agent:…]` → `wireMentionedExtensions` | no per-extension check |
| **Direct dispatch** | `POST /api/tool-invoke` | resolved the tool from the GLOBAL registry map and called `executeToolCall` — no wiring, **no conversation ownership** |
| **Agent configs** | `registry.getToolsForAgent` at `stream-chat/setup-tools.ts` (2b) | attached `agent_configs.extensions` (author-supplied raw ids) straight to the turn |

`POST /api/tool-invoke` now resolves conversation ownership **before** the task-tracking wire (which mutates `conversation_extensions`) and runs `canWireExtension` on the resolved row. It is deliberately NOT a blanket "must be wired" requirement: `canWireExtension` is equivalent for authorization purposes — a caller who passes it could wire the extension and dispatch anyway — while avoiding a behaviour change that would break inline tool cards and Hub actions that legitimately dispatch unwired.

`getToolsForAgent` takes an `allowExtension` hook applied per extension id. Agent-config create/edit additionally validate `extensions[]` at write time (`web/src/lib/server/agent-config-extension-gate.ts`) so the author gets a 400 instead of an agent that silently has fewer tools than its config lists; the runtime hook is the one that protects the credential, because it re-decides every turn.

**Spawned runs inherit, they do not acquire.** A sub-conversation is stamped with its ancestor's owner at creation (`start-assignment.ts` calls `resolveConversationOwnerUserId`; `POST /api/conversations` stamps `user.id` even with a `parentConversationId`), so a child run resolves the same principal as its parent and gets exactly the parent's reach. `userId: null` is the LEGACY row shape only, and `migrate()` reassigns ownerless conversations to the first admin at boot; the gate reads a residual null as "no principal" and denies.

Both wiring call sites report a denial as a **miss**, never as a distinct outcome, so a member cannot enumerate installed MCP servers by probing names:

- `POST /api/conversations/[id]/extensions` folds the denied name into its existing all-or-nothing `404 {error:"Unknown extension(s)", unknown}`.
- `![ext:…]` / `![agent:…]` mention wiring (`src/runtime/mention-wiring.ts`) drops it **silently** — the binding mention-grammar contract for an unknown target. The agent branch is gated too: an agent config's `extensions` array is user-authored, so gating only the direct mention would leave a one-hop bypass.

The project coordinate is always derived server-side from the conversation row, never from the request — the same rule `resolveExtensionScopeGrant` follows in the tool-executor.

### Bundled capability ceiling (`bundled-ceiling.ts`)

- `BUNDLED_CEILING` is a hardcoded `Record<name, ExtensionPermissions>` — the security *maximum* for each bundled extension, sourced from this code-reviewed file, NOT from the (potentially tampered) manifest. Keys mirror `BUNDLED_EXTENSIONS[*].name`.
- `clampToBundledCeiling(name, requested)` returns `{effective: intersectPermissions(requested, ceiling), clamped}`. The install path in `bundled.ts` persists the **clamped** grant and logs/audits when `clamped`. Unknown (non-bundled) names pass through unchanged — the ceiling does not apply to user-installed extensions (their checksum + manifest re-approval gate governs them). Numeric ceilings (`spawnAgents.maxPerHour`, LLM call caps, schedule durations) are clamped via `Math.min` inside `intersectPermissions`.
- Composes with the lockfile: manifest tamper is caught even if an attacker widens the ceiling, and ceiling violation is caught even if an attacker regenerates the lockfile.

### Manifest lockfile tamper detection (`bundled-lock.ts`)

- `verifyManifestAgainstLock(name, manifest)` checks the on-disk manifest's `version`, `entrypoint`, and `toolsHash` (canonical-JSON SHA-256 of `manifest.tools`, prefixed `sha256-…`) against `manifest.lock.json` at the project root. Any drift, a missing entry, or a missing/malformed lockfile → `{ok: false}` and the caller (`bundled.ts` refresh path, `bundled-drift-reapprove.ts`) treats it **fail-closed**: disable the extension, write an `ext:manifest-drifted`-class audit row, do not refresh. The lockfile is cached at startup (live reload would defeat the boot gate).

### Grant expiry sweep (`perm-expiry-sweep.ts`)

- `runSweep({db, now, config?})` is a **pure planner** (read-only): it scans enabled extensions' `grantedPermissions.grantedAt[*]` and `ext:%:always_allow:%` settings rows, maps each onto a `CapabilityExpiryKind`, compares age vs. the per-kind TTL (`perm-expiry-config.ts`'s `TTL_CONFIG`, with `forever` scope using the env-driven `EZCORP_PERM_FOREVER_TTL_DAYS` knob, default 90d), and returns `{revocations, audits, events}`. A per-row `ttlOverrideMs` short-circuits the fallback: `null` skips the row entirely (honest "Never" even at `forever` scope), a positive number wins over both the table and the forever knob.
- Session and conversation scopes are skipped (in-memory / lifetime-bound); legacy unscoped rows and legacy boolean `true` are treated as never-expires.
- `applySweepResult(db, result)` applies the plan best-effort with `SELECT … FOR UPDATE` re-reads + CHECK-clause UPDATEs and per-key freshness checks so a concurrent user-approve isn't clobbered — skipped rows re-converge next tick, and **audit rows are written 1:1 only with revocations that actually applied**.

### Call-provenance tokens (`call-provenance.ts`)

Extension capability calls (`ctx.llm`, `ctx.memory`, `ctx.schedule`, `ctx.drafts`, …) return to the host as *reverse* JSON-RPC. The host mints an opaque `ezCallId` (`registerCallProvenance` for forward tool calls, released in a `finally`; `registerFireCallProvenance` for schedule/event fires, auto-released after 2 min) and snapshots the correct `{onBehalfOf, conversationId, runId, parentCallId, actorExtensionId, kind, ownerless}` at that instant. The subprocess echoes only the token; `resolveCallProvenance` returns a defensive shallow copy. `actorExtensionId` always comes from the registered-tool record, **never the wire** — the anti-spoofing anchor. A kind-aware TTL sweep (6h for `tool`, 10min for fire/render) + a 10k hard cap are loud-logging leak backstops; under correct operation the live set stays tiny.

## Usage

### REST API

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/tool-calls/[id]/permission` | `chat` + auth + gate-ownership | Answer a pending sensitive-cap gate. Body `{approved, scope?, ttlOverrideMs?}`. `scope: "forever"` is **admin-only**. |
| `GET / PUT /api/extensions/[id]/permissions` | GET: auth · PUT: **admin** | Read / overwrite an extension's granted permissions; PUT clamps to `manifest.permissions` (admin cannot exceed the author's declaration). |
| `POST /api/extensions/[id]/reapprove` | auth (`forever` admin-gated) | Re-grant a manifest-declared capability after expiry; resets `grantedAt`. Body `{capability, scope?, ttlOverrideMs?}`. |
| `GET /api/extensions/[id]/expired-grants` | auth | Feeds the settings-page expired-grants banner (sweep audit rows, last 7 days, + sticky picker TTL). |
| `POST /api/extensions/[id]/reapprove-drift` | admin | Heal a drifted bundled extension after a lockfile/ceiling re-check. |
| `GET /api/extensions/[id]/audit` | admin | Per-extension audit drill-down. Default mode fans in governance + SDK-capability + resource-mutation rows via `mergeAuditForExtension`; the governance filter is `target = <id> AND (action LIKE 'ext:%' OR action LIKE 'extension:%')`. `?legacy=1` falls back to the governance-only `listAuditForExtension`. |
| `GET /api/extensions/[id]/violations` | admin | Filesystem/capability violations recorded by the host gates. |

### Settings keys / env vars

- `EZCORP_DB_PATH` — on-disk PGlite path; its dir + `backups/` sibling are reserved (hard-deny).
- `EZCORP_PERM_FOREVER_TTL_DAYS` (default 90) — TTL applied to `forever`-scope always-allow rows by the sweep.
- `EZCORP_PROJECT_ROOT` — the canonical project-root anchor injected into the extension sandbox (`build-sandbox-argv.ts` / `subprocess.ts`); the kernel jail's actual tier is selected by capability probing (`landlockAbiVersion()`), not by this var. It's unset in these containers, so the in-kernel Landlock jail is OFF — which is why the software hard-deny exists. (`permissions.ts` uses "`EZCORP_PROJECT_ROOT` unset" as shorthand for "no jail here".)
- Always-allow rows live in the `settings` table under `ext:<id>:<userId>:<scope>:<scopeId>:always_allow:<capability>`.

### UI entry points

- In-chat sensitive-cap modal (rendered from `tool:permission_request`) with Allow once / Allow for session / conversation / project / **Approve forever (admin only)** + a per-row TTL picker.
- Settings → extension detail: granted-permissions editor (admin PUT), the expired-grants re-approve banner, the audit drill-down, and violations list.

## Key files

- `src/extensions/permission-engine.ts` — the PDP: `createPermissionEngine`/`getPermissionEngine`, `authorize`, `resolvePrompt`, override cache, audit writes.
- `src/extensions/capability-types.ts` — `Capability` union, `SENSITIVE_KINDS`, `isSubset`/`capabilityCovers`/`intersect`, `intersectPermissions`, `grantsToCapabilitySet`, `capabilityDeclarationToSet`.
- `src/extensions/permissions.ts` — `expandGrantPrefix` (`$CWD`→project root), `resolveGrantPrefixCanonical`, `isReservedSensitivePath`, `checkFilesystemPermission`, `alwaysAllowSettingKey`, `AlwaysAllowRecord`, `parseAlwaysAllowValue`, `readTtlOverrideMs`, `buildAlwaysAllowValue`.
- `src/extensions/bundled-ceiling.ts` — `BUNDLED_CEILING` table + `clampToBundledCeiling`/`getCeiling`.
- `src/extensions/bundled-lock.ts` — `verifyManifestAgainstLock`, `canonicalizeAndHash`, lockfile load/cache.
- `src/extensions/perm-expiry-sweep.ts` — `runSweep` (pure planner) + `applySweepResult` (race-safe applier) + grant-key→expiry-kind mappers.
- `src/extensions/perm-expiry-config.ts` — `TTL_CONFIG` per-kind TTL table + `getForeverTtlMs()`.
- `src/extensions/call-provenance.ts` — `registerCallProvenance`/`registerFireCallProvenance`/`resolveCallProvenance`/`releaseCallProvenance`.
- `src/extensions/audit-actions.ts` — `EXT_AUDIT_ACTIONS` + `AUDIT_PERM_*` constants.
- `src/auth/extension-wire-authz.ts` — `canWireExtension` / `partitionWirableExtensions` / `findUnauthorizedExtensionIds` / `loadWireActor` / `isMcpExtension`: the gate, asked at all four seams.
- `web/src/routes/api/tool-invoke/+server.ts` — direct dispatch: conversation ownership (before the task-tracking wire) + `canWireExtension`.
- `web/src/lib/server/agent-config-extension-gate.ts` — write-time validation of an agent config's `extensions[]`.
- `src/extensions/registry.ts` — `getToolsForAgent`'s `allowExtension` hook (the runtime half of the agent-config fix).
- `src/runtime/mention-wiring.ts` — `wireMentionedExtensions`; the mention-side call site (silent drop on denial).
- `web/src/routes/api/conversations/[id]/extensions/+server.ts` — the typed wiring route (denial folded into the unknown-name 404).
- `src/extensions/fs-handler.ts` — host read/write/list/stat gates; calls `engine.authorize` + `isReservedSensitivePath`.
- `src/extensions/tool-executor/executor.ts` — forward-dispatch gate: `authorize` → prompt → `createExtensionPermissionGate` → `resolvePrompt`.
- `src/routes/tool-permission.ts` — gate-answer handler (ownership + `forever` admin gate + TTL validation).
- `src/db/queries/audit-log.ts` — `insertAuditEntry` (redacts metadata; on failure fire-and-forgets to `error_logs` via `persistError`, returns `""`).
- `web/src/routes/api/tool-calls/[id]/permission/+server.ts` — thin route → `handleToolPermission`.
- `web/src/routes/api/extensions/[id]/permissions/+server.ts` — admin permission read/overwrite (clamp to manifest).
- `web/src/routes/api/extensions/[id]/reapprove/+server.ts` — post-expiry re-grant (`forever` admin-gated).
- `web/src/routes/api/extensions/[id]/expired-grants/+server.ts` — expired-grants banner feed.

## Features it touches

- [[sandbox-and-isolation]] — the PDP is the software gate above the kernel jail (Landlock/bwrap); the reserved-path hard-deny exists because Landlock is off in these containers.
- [[runtime-and-rpc]] — capability calls return as reverse-RPC; provenance tokens are host-issued per forward call/fire.
- [[overview-and-authoring]] — a manifest's declared `permissions` + per-tool `capabilities` define the needed/granted sets the PDP compares.
- [[bundled-catalog]] — `BUNDLED_CEILING` keys mirror `BUNDLED_EXTENSIONS[*].name`; the ceiling clamps each bundled install.
- [[marketplace]] — user-installed extensions are clamped to their manifest declaration (not the bundled ceiling) and gated by a checksum re-approval.
- [[builtin-file-tools]] — note the asymmetry: built-in file-tool containment (`src/runtime/tools/validate.ts` `validatePath`) is **lexical**, while the extension FS gate here is **realpath**-resolved.
- [[audit-and-observability]] — every PDP decision + sweep revocation writes an `audit_log` row; the per-extension drill-down filters `action LIKE 'ext:%' OR action LIKE 'extension:%'` (legacy `extension:*` rows included).
- [[rbac-and-permission-modes]] — `scope: "forever"` and the permissions-overwrite PUT require the admin role.
- [[agents]] — spawn-assignment writes per-conversation grant overrides = `intersect(parent, child-agent)`.
- [[scheduling-and-loops]] — schedule/event fires mint fire-provenance tokens; schedule grants have their own ceiling + expiry tier.
- [[mcp-servers]] — `mcp-proxy.ts` PDP-gates each MCP host call against the extension's network grant, and `mcp-capabilities.ts` derives the manifest declaration + install grant that make that gate reachable; the wiring gate above decides who may attach an MCP extension in the first place, and the four lifecycle mutations are audited.
- [[settings-system]] — always-allow rows + sticky picker TTLs persist in the `settings` KV table.

## Related docs

- [docs/extensions/security.md](../../extensions/security.md) — bundled ceiling + manifest lockfile (maintainer-facing).
- [docs/permissions/four-scope-modal.md](../../permissions/four-scope-modal.md) — the session/conversation/project/forever sensitive-cap modal.
- [docs/permissions/capability-expiry.md](../../permissions/capability-expiry.md) — the TTL grant-expiry milestone.
- [docs/permissions/audit-drilldown.md](../../permissions/audit-drilldown.md) — the per-extension audit surface.
- [docs/extensions/data-storage.md](../../extensions/data-storage.md) — the `.ezcorp/extension-data/<name>/` convention the FS grants cover.

## Notes & gotchas

- **The reserved-path hard-deny is the only DB protection in these containers.** Landlock is OFF (`EZCORP_PROJECT_ROOT` unset), so a bundled extension with a `$CWD`-widened-to-project-root grant would otherwise host-mediated-read `.ezcorp/data` (PGlite + JWT secret). `isReservedSensitivePath` closes that in software, wired before every allow on both read and write gates. The deny is realpath-resolved + segment-bounded so symlink/`..`/sibling tricks don't bypass it.
- **Lexical vs. realpath asymmetry.** The extension FS gate (`checkFilesystemPermission`, `checkPrefixForWrite`) realpaths both target and prefix. The built-in file tools (`src/runtime/tools/validate.ts` `validatePath`) do a **lexical** containment check (no realpath), while the FS scanner / `@`-autocomplete (`src/runtime/fs/scan-fs.ts` `realpathInsideRoot`) does realpath. Don't assume one containment model platform-wide.
- **An empty needed set is an unconditional allow, so a missing declaration disables the PDP for that tool.** `firstMissingCapability([], granted)` returns `null` no matter what is granted. Any path that reaches `authorize` with `needed = []` is *not* being gated — it is being waved through. `kind:"mcp"` rows were exactly that until 2026-08 (they bypass `migrateManifestV2ToV3`, so no tool carried a `capabilities` block); the registry now derives one on read via `mcp-capabilities.ts:normalizeMcpManifest`. Treat "which loader put the declaration there?" as a required question for any new manifest producer.
- **A non-empty *declaration* is not the same as a non-empty *needed set*.** The first fix for the MCP hole declared `permissions.network` on every MCP row — but `deriveCapsFromExtensionPerms` skips an EMPTY host array, so a stdio server naming no host still produced `capabilities: {}` and still authorized against `[]`. The gate looked fixed and was inert for the most common shape. That is why `ezcorp:mcp:invoke` is unconditional. When you add a derived declaration, assert on the flattened `capabilityDeclarationToSet` output and on an actual DENIAL — not on the declaration you passed in.
- **The wiring gate is NOT the PDP, and neither subsumes the other.** The PDP asks what a running extension may do; the wiring gate asks who may make it runnable in this conversation. An MCP extension's credential lives in the transport rather than in a capability, so no PDP grant can narrow it — which is exactly why the wire step needed its own control.
- **`prompt` ≠ `deny`.** A `prompt` decision means every cap was granted but a sensitive one lacks an always-allow row. The tool-executor opens the interactive gate and *can* still proceed; only a user decline (or missing grant) is a hard deny.
- **Install/modify are never persistable.** `ezcorp:extension:install` / `ezcorp:extension:modify` force the always-allow read to `false`, are excluded from the bundled-ceiling auto-allow, and `resolvePrompt` returns early without writing a row — every install / reopen-for-edit re-consents. `modify` is additionally gated host-side (owner + admin-`modifiable` + not-bundled) in the drafts/reopen handler.
- **Always-allow "forever" grants the whole kind.** Because the always-allow key is kind-only, "Allow forever" on `fs.write` authorizes *any* path under that cap, not just the prompted one. This was a deliberate collapse to fix a writer/reader key-shape mismatch where users hitting Allow Forever still re-prompted.
- **Audit is best-effort, not transactional.** `insertAuditEntry` wraps the insert in try/catch; a failure fire-and-forgets to `error_logs` via `persistError` and returns `""`. The PDP's *decision* always succeeds even if its audit row can't be written — audit is the secondary observability path, not a blocking dependency. (It is a two-tier `audit_log`→`error_logs` fallback, not a synchronous triple-write.)
- **Post-cache override DB failure fails closed.** After the override cache miss, a thrown DB read in `loadConversationOverride` upgrades the decision to `deny` (reason `override-lookup-failed`) rather than silently falling back to the wider registry grant — closing a grant-widening regression.
- **Bundled ≠ examples on disk.** `BUNDLED_EXTENSIONS` (`src/extensions/bundled.ts`) wires ~24 extensions at boot, but `docs/extensions/examples/` holds ~39 dirs including example-only and `test-*` / `harness-smoke-test` fixtures. The ceiling table only covers genuinely-bundled names; `getCeiling` returns `null` (passthrough) for anything else.
- **`DEFAULT_PERMISSION_MODE = "yolo"`** (`src/runtime/tools/permissions.ts`) is the intentional, permanent product default for *built-in* tool gating — distinct from this extension PDP. It is not a security finding.
- **Provenance is host-resolved, never wire-trusted.** Even a hostile subprocess can only echo a host-issued opaque token; `actorExtensionId` is read from the registered tool record. A resolve miss is logged at warn and surfaced as a fast hard error, not a hang.
