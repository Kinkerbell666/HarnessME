# Extension Data, Storage & Entities

> _The three persistence surfaces an extension can reach: a gitignored project-filesystem convention for user-visible files, a server-authoritative encrypted key-value store, and `defineEntity` typed collections that render a paginated table UI and feed the LLM byte-identical records._

## Intent

Extensions need somewhere to keep state — and EZCorp deliberately offers three tiers rather than one, because the right home depends on who reads the data. User-facing artifacts a human would open in an editor (markdown vaults, JSON task stores, logs) belong on the filesystem under a single predictable, gitignored path. Opaque internal state belongs in the `ezcorp/storage` reverse-RPC KV store, which is DB-backed, isolated per-extension, quota-enforced, and optionally AES-256-GCM encrypted. Structured, user-managed, named records (post types, characters, playbooks) belong in `defineEntity` collections, where one manifest declaration generates the CRUD tools, the storage routing, and a settings-page table — all schema-validated. Everything an extension subprocess does to reach these surfaces is host-mediated: the sandbox poisons raw fs primitives, so reads and writes round-trip to the host over JSON-RPC.

## How it works

### Surface 1 — filesystem convention (`.ezcorp/extension-data/<name>/`)

- Every extension's user-visible files live under `<projectRoot>/.ezcorp/extension-data/<extension-name>/`, where `<projectRoot>` is the nearest `.git` ancestor (`.ezcorp/` is gitignored). The convention is the contract — agents and the assistant read from this path directly rather than asking where an extension stored data.
- **Inside a subprocess the extension can't walk for `.git` itself** — the Phase 3 sandbox-preload poisons `node:fs` / `Bun.file` / `Bun.write`. So the production pattern has two host-injected halves:
  1. **Project root** — the host walks `.git` once (`findProjectRoot` in `packages/@ezcorp/sdk/src/runtime/fs.ts`) and injects `EZCORP_PROJECT_ROOT` (and `EZCORP_EXTENSION_DATA_ROOT`) at spawn time via `buildAllowedEnv` in `src/extensions/registry.ts`.
  2. **File IO** — the SDK's host-mediated helpers `fsRead` / `fsWrite` / `fsList` / `fsStat` / `fsExists` / `fsMkdir` / `fsUnlink` wrap the `ezcorp/fs.{read,write,list,stat,exists,mkdir,unlink}` reverse-RPC. These are the *only* supported fs path from extension code; the same file also exports legacy host-side helpers (`getExtensionDataDir`, `atomicWrite`, `loadJSON`, …) that throw if called inside the poisoned subprocess.
- Host-side, `src/extensions/fs-handler.ts` services each RPC: it first applies per-tool `capabilities.filesystem.mode` narrowing (`checkToolMode`), then `realpath`s the path **before** the PDP authorize (closing the symlink-swap TOCTOU window) via `checkFilesystemPermission` (prefix-match against granted prefixes + the implicit install-dir allow), then `engine.authorize`s and performs the IO with `node:fs/promises`. Reads above 1 MB stream in 256 KB chunked frames; the hard cap is 100 MB per op.
- Write-side ops (`write`/`mkdir`/`unlink`) gate on the realpath'd parent + appended basename because the target may not exist yet (`gateWritePath`, `resolveLowestExistingAncestor`). `unlink` is POSIX-correct: it `lstat`s the leaf and removes the *link*, never the symlink target.

### Surface 2 — `ezcorp/storage` key-value

- The SDK client is `packages/@ezcorp/sdk/src/runtime/storage.ts` — a `Storage` class scoped to `"global" | "conversation" | "user"`, exposing `get` / `set` / `delete` / `list` / `batch`. It pre-guards a 1 MB-per-value ceiling client-side and rides out `-32029` throttle errors with exponential backoff (20 ms base, 5 retries).
- The host handler is `src/extensions/storage-handler.ts`. Every non-builtin call is gated by the **PDP** (`engine.authorize` with `kind: "storage"`), which also writes the audit row; a legacy structural `grantedPermissions.storage` check is the fallback for callers that didn't thread the engine.
- **Scope resolution** (`resolveScopeId`): `global` is deliberately ownerless (`scopeId = NULL`) — one install-wide bucket shared across all users, reachable from ownerless cron fires; `conversation` → `ctx.conversationId`; `user` → `ctx.userId`. Conversation scope additionally requires the extension to be wired to that conversation (`getConversationExtensionIds`).
- **Encryption** is per-write (`set({ encrypted: true })`) via AES-256-GCM (`encrypt`/`decrypt` from `src/providers/encryption.ts`). Encrypted writes to `global` scope are **rejected** for non-builtin extensions — a per-user secret must never land in a cross-user bucket.
- **Limits & validation**: keys match `^[a-zA-Z0-9_.\-/:]{1,256}$`, can't start/end with `.` or `/`, and reject reserved prefixes `__` / `ezcorp/` (builtin exempt). Value ≤ 1 MB; per-extension quota from `manifest.resources.storage` (default 5 MB, max 100 MB); rate limit 50 ops/sec; optional `ttlSeconds` (≤ 1 year) sets `expiresAt`; `batch` is capped at 100 ops with tokens consumed up-front; `list` takes a string `prefix` and an integer `limit` from 0 (default 100, capped at 1000), else `-32602`.
- Rows live in the `extension_storage` table (`src/db/schema.ts`): `(extensionId, scope, scopeId, key) → value (jsonb), encrypted, sizeBytes, expiresAt`.

### Surface 3 — `defineEntity` typed collections

Entities are built on Surface 2's `extension_storage` table but layered with a managed namespace, JSON-Schema validation, auto-generated tools, and a table UI.

- **Declaration.** An author adds an `entities[]` block to the manifest (`EntityDeclaration` in `packages/@ezcorp/sdk/src/entities/types.ts`): `type`, `label`, `pluralLabel`, `scope` (default `"user"`), a JSON-Schema `schema` (a locked subset — object/string/number/boolean/array), optional `preview` template, `seed[]`, and `cascadeOnUninstall` (default `false` — user data survives uninstall). `src/extensions/entities/clamp.ts`'s `validateEntitiesArray` rejects malformed declarations at manifest-validation time (bad type slug, out-of-subset schema, duplicate types, tool-name/settings collisions, reserved-namespace keys).
- **Managed namespace.** Records persist as `__entity:<type>:<slug>` plus a sorted/deduped slug list at `__entity-index:<type>` (`packages/@ezcorp/sdk/src/entities/storage.ts`). The index is a cache; the record is the source of truth — `listEntityRecords` silently drops index slugs whose record is missing, and the index self-heals on the next mutation. Extensions can't write `__entity:*` directly (the `__` reserved-prefix clamp in `storage-handler.ts` blocks it).
- **Auto-generated tools.** `packages/@ezcorp/sdk/src/entities/tools.ts` derives five tools per type — `list_<plural>`, `get_<sing>`, `create_<sing>`, `update_<sing>`, `delete_<sing>` — with `ToolDefinition`s for the LLM. Validation is **hard on write** (`create`/`update` throw `EntityValidationError` on schema fail) and **soft on read** (`get`/`list` attach `_validationWarning: { code: "SCHEMA_DRIFT", issues }` to drifted records so the LLM can repair in place). Slug is immutable; `update` shallow-merges a `patch`.
- **Host-served dispatch.** These tools are NOT subprocess-served. `buildEntityRegisteredTools` in `src/extensions/registry.ts` emits `RegisteredTool` entries (`name: "<ext>__<auto-name>"`, `entityKind`, `entityType`) and the tool-executor short-circuits the subprocess, calling the SDK handlers against a `createHostEntityStore` adapter (`src/extensions/entities/host-store.ts`). That adapter routes the entity's `scope` onto the storage enum (`project` → `conversation` in v1), and **never encrypts** — entity records are user-visible so the table UI can read them as plain JSON.
- **UI & REST.** `web/src/routes/api/extensions/[id]/entities/[type]/+server.ts` (GET list / POST create) and `.../[type]/[slug]/+server.ts` (GET / PUT / DELETE) mirror the SDK tool dispatch exactly — same store, same `assertRecord` validation, same soft-read shape — so the UI and the LLM see byte-identical records. The settings page (`web/src/routes/(app)/extensions/[id]/+page.svelte`) renders `EntityTable.svelte` per declared type (slug / preview / `SCHEMA_DRIFT` banner / row actions).
- **Lifecycle.** Install seeds declared `seed[]` records idempotently (`src/extensions/entities/seed.ts`; `{file:./path}` placeholders resolve against the source dir with lexical + realpath escape clamps). A legacy hand-rolled CRUD store can port to entities via the per-user, idempotent, audit-logged namespace renamer in `src/extensions/entities/migrate.ts`.

## Usage

### SDK (inside an extension subprocess)

```ts
import { fsRead, fsWrite } from "@ezcorp/sdk/runtime";
import { Storage } from "@ezcorp/sdk/runtime"; // scoped KV

// Filesystem convention
const root = process.env.EZCORP_PROJECT_ROOT;            // host-injected
const path = `${root}/.ezcorp/extension-data/my-ext/config.json`;
await fsWrite(path, JSON.stringify(cfg));
const text = await fsRead(path);                          // string (utf-8) by default

// Key-value store
const kv = new Storage("user");
await kv.set("token", secret, { encrypted: true, ttlSeconds: 3600 });
const { value, exists } = await kv.get("token");
```

Entity CRUD tools (`list_<plural>`, `get_<sing>`, `create_<sing>`, `update_<sing>`, `delete_<sing>`) are auto-generated from the manifest's `entities[]` block — the author writes no tool code.

### REST (settings UI / API-key clients)

| Method & path | Scope | Purpose |
|---|---|---|
| `GET /api/extensions/[id]/entities/[type]` | `read` | List records (soft-read; `_validationWarning` on drift). |
| `POST /api/extensions/[id]/entities/[type]` | `extensions` | Create (`{ slug, data }`; 409 on dup, 400 on validation fail). |
| `GET /api/extensions/[id]/entities/[type]/[slug]` | `read` | Fetch one. |
| `PUT /api/extensions/[id]/entities/[type]/[slug]` | `extensions` | Shallow-merge update (`{ patch }` or `{ data }`); slug immutable. |
| `DELETE /api/extensions/[id]/entities/[type]/[slug]` | `extensions` | Delete + index update. |

All entity routes `requireAuth` + `requireScope`, bind to the acting user's id as the `user`-scope id, and reject `conversation`-scoped types from the settings UI (400). Cross-user reads are unsupported in v1.

### Env vars

- `EZCORP_PROJECT_ROOT` — host-injected project root for computing the `.ezcorp/extension-data/<name>/` path inside the sandbox.
- `EZCORP_EXTENSION_DATA_ROOT` — dedicated data-dir root (`getProjectRoot()` → `/app` in dev and prod), deliberately separate from `EZCORP_PROJECT_ROOT` (which also drives the landlock jail root).
- `EZCORP_FS_ALLOWED` — informational `"1"` flag; the SDK fs helpers fail-fast when absent. The sandbox-preload deniers fire regardless.

### Manifest keys

- `entities: EntityDeclaration[]` — declare typed collections.
- `resources.storage: "<N>KB|MB|GB"` — per-extension KV quota (default 5 MB, hard-capped at 100 MB).
- `permissions.filesystem` / per-tool `capabilities.filesystem.mode` — gate fs access (grant the path at install time).

## Key files

- `packages/@ezcorp/sdk/src/runtime/fs.ts` — host-mediated fs helpers (`fsRead`/`fsWrite`/…) + legacy host-side helpers (`findProjectRoot`, `getExtensionDataDir`, `atomicWrite`, `loadJSON`).
- `packages/@ezcorp/sdk/src/runtime/storage.ts` — scoped `Storage` KV client (size guard, throttle backoff, batch).
- `packages/@ezcorp/sdk/src/entities/types.ts` — `EntityDeclaration`, JSON-Schema subset, reserved-key constants.
- `packages/@ezcorp/sdk/src/entities/storage.ts` — managed-namespace key helpers + CRUD primitives over `EntityStoreLike`.
- `packages/@ezcorp/sdk/src/entities/tools.ts` — auto-generated CRUD tool handlers + LLM `ToolDefinition`s; hard-write/soft-read validation.
- `packages/@ezcorp/sdk/src/entities/validate.ts` — `assertRecord` / `validateRecord` against the schema subset.
- `src/extensions/fs-handler.ts` — host `ezcorp/fs.*` handlers; realpath-before-authorize, mode narrowing, streaming, reserved-sensitive-path hard-deny.
- `src/extensions/storage-handler.ts` — host `ezcorp/storage` handler; PDP gate, scope resolution, encryption, quota/rate/TTL.
- `src/extensions/entities/host-store.ts` — `createHostEntityStore`: `EntityStoreLike` adapter onto `extension_storage` (no encryption/quota/rate-limit; scope mapping).
- `src/extensions/entities/clamp.ts` — `validateEntitiesArray`: manifest-time entity validation.
- `src/extensions/entities/seed.ts` — idempotent install-seed; `{file:…}` placeholder resolution with escape clamps.
- `src/extensions/entities/migrate.ts` — per-user, idempotent, audit-logged legacy→managed namespace renamer.
- `src/extensions/registry.ts` — `buildAllowedEnv` (env injection), `buildEntityRegisteredTools` (host-served tool wiring).
- `src/db/schema.ts` — `extension_storage` table (`extensionStorage`).
- `src/db/queries/extension-storage.ts` — `getStorageValue` / `setStorageValue` / `deleteStorageValue` / `listStorageKeys` / `getStorageUsage`.
- `web/src/routes/api/extensions/[id]/entities/[type]/+server.ts` — list/create entity REST routes.
- `web/src/routes/api/extensions/[id]/entities/[type]/[slug]/+server.ts` — get/update/delete entity REST routes.
- `web/src/lib/components/EntityTable.svelte` / `EntityFormModal.svelte` — the auto-generated settings-page table + create/edit modal.

## Features it touches

- [[permissions-and-grants]] — every fs and storage op is PDP-gated; the manifest's filesystem grant + per-tool `capabilities.filesystem.mode` decide what a path can reach.
- [[sandbox-and-isolation]] — the sandbox-preload poisons raw fs primitives, which is *why* all IO is host-mediated reverse-RPC.
- [[runtime-and-rpc]] — `ezcorp/fs.*` and `ezcorp/storage` are reverse-RPC methods over the subprocess channel.
- [[builtin-file-tools]] — the built-in file tools and the extension fs surface share the project filesystem; note the containment asymmetry (see gotchas).
- [[overview-and-authoring]] — `entities[]`, `resources.storage`, and `permissions.filesystem` are manifest fields an author declares.
- [[settings]] — the entity table + create/edit modal render on the extension detail/settings page.
- [[audit-and-observability]] — storage PDP decisions and the entity namespace migration write audit rows.
- [[scheduling-and-loops]] — ownerless `global`-scope KV is the durable store reachable from cron/loop fires that carry no user or conversation.
- [[bundled-catalog]] — bundled extensions (`todo-tracker`, `scratchpad`, `task-tracking`, etc.) use these surfaces; the `task-stack` / `auto-note` examples cited throughout `data-storage.md` live under `docs/extensions/examples/` but are NOT in `BUNDLED_EXTENSIONS` — "examples on disk" ≠ "bundled at boot".
- [[database-and-migrations]] — `extension_storage` is a migrated table; entity records share its rows.

## Related docs

- [data-storage](../../extensions/data-storage.md) — the filesystem convention spec (the primary reference for Surface 1).
- [api-reference](../../extensions/api-reference.md) — the `ezcorp/storage` KV + fs API surface.
- [manifest-schema](../../extensions/manifest-schema.md) — manifest fields including `resources.storage` and permissions.
- [settings](../../extensions/settings.md) — per-extension settings (the `encrypted: true` "this is a secret" signal).
- [security](../../extensions/security.md) — the sandbox + permission model behind host-mediation.

> Note: `defineEntity` is shipped but, as of this writing, not yet covered by a standalone doc under `docs/extensions/` — this file is the primary reference for entities.

## Notes & gotchas

- **`global` scope is ownerless and shared.** `resolveScopeId("global")` returns `NULL` — one install-wide bucket across every user. Encrypted writes to it are rejected for non-builtin extensions (`-32602`) so per-user secrets can't leak cross-user. Never put per-user data there; use `user` (or `conversation`) scope.
- **Entity records are never encrypted by the host-served path.** `createHostEntityStore` writes plaintext (the table UI must read them) and surfaces a `null` (not ciphertext) if it somehow reads an encrypted row. Don't expect entity data to be encrypted at rest.
- **Soft-read vs hard-write.** `get`/`list` (tool *and* REST) return drifted records with a `SCHEMA_DRIFT` `_validationWarning` rather than erroring — so the LLM/UI can repair. `create`/`update` reject on schema fail. A schema change can silently strand existing records as "drifted" until re-validated.
- **Filesystem containment asymmetry.** The extension fs-handler and the FS scanner use `realpath` (resolving symlinks before authorize), but the built-in file-tool path check (`validatePath` in `src/runtime/tools/validate.ts`) is **lexical** (no realpath). The two surfaces don't share a containment implementation — keep that in mind when reasoning about symlink escapes across the two tool families.
- **Grant-independent hard-deny for the DB + secret dir.** `isReservedSensitivePath` (`src/extensions/permissions.ts`) hard-denies reads/writes to `<projectRoot>/.ezcorp/data` (the PGlite DB holding the JWT/encryption secret) *before* any allow — even an extension whose grant was widened to the project root via `$CWD`. The deny is segment-bounded, so a sibling like `.ezcorp/data-export` is NOT swept up. It is an ORDINARY deny, not a security violation — the gate tags it `reserved-carveout` and never disables the extension (see [[permissions-and-grants]]); only an `out-of-grant` path does.
- **`$CWD` grant expands to the project root.** `expandGrantPrefix` resolves the `$CWD` token via `getProjectRoot()` (= `/app` in dev and prod), not `process.cwd()` (which is `/app/web` under the vite-SSR dev server). This aligns a bundled extension's data-dir read with where the host writes; in prod it's a no-op since cwd is already the project root.
- **`project` scope maps to `conversation`.** v1 has no project-scoped storage tier; `mapScope` routes `project` entities onto conversation rows. The SDK schema reserves `project` so a future tier can land without an SDK breaking change.
- **Conversation-scoped entities aren't seed-able or UI-editable.** Install-seed skips them (no conversation id at install time) and the settings REST routes reject them (400). Bundled-at-boot installs with no acting user also skip user-scoped seeds.
- **Quota/encryption/rate-limit only apply to the subprocess `set` path.** The host-served entity store (`host-store.ts`) skips the quota check, rate-limiter, and encryption — it's trusted host code serving the user's own UI/LLM, not a hostile subprocess. Entity records still count against the extension's quota because they share the `extension_storage` table.
- **DEFAULT_PERMISSION_MODE is `yolo`.** The default tool-call permission mode (`src/runtime/tools/permissions.ts`) is an intentional, permanent product decision — not a finding.
