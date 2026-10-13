# Projects & Root Resolution

> _Two unrelated "project" concepts: a user-facing **project record** (a named workspace whose `path` parameterizes every file tool) and the host-internal **install-root resolver** (`getProjectRoot()`) that locates the EZCorp checkout for bundled-extension discovery and the `$CWD` grant._

## Intent

A **project** is the workspace a conversation runs against. Each project row carries a name, a filesystem `path`, an icon, and a free-form `variables` bag. The `path` is the single source of truth for *where on disk* an agent's file tools may read and write — every built-in file tool and the `@`-mention file scanner are parameterized by the active conversation's project path. Per-project tool-permission modes let an operator dial the approval friction (`ask` / `auto-edit` / `yolo`) independently per workspace.

Separately and confusingly named, `getProjectRoot()` in `src/extensions/project-root.ts` (re-exported from `src/extensions/bundled.ts`, where it used to live) resolves the **EZCorp install root** — the directory containing `docs/extensions/examples/`. This is host infrastructure (bundled-extension lookup, `$CWD` grant base), **not** a user project path. The two never coincide except by accident.

## How it works

### The project record (user-facing)

1. **Schema** — `projects` (`src/db/schema.ts`): `id` (TEXT — a uuid for user-created rows, or the seeded literals `global` / `self`), `name`, `path` (both `notNull`), `icon` (nullable), `variables` (jsonb, default `{}`), plus timestamps. There is **no `userId`/`createdBy` column on `projects` itself** — ownership is expressed through the separate `project_members` join table instead (see Notes).
2. **CRUD queries** — `src/db/queries/projects.ts` exposes `listProjects` / `getProject` / `createProject` / `updateProject` / `deleteProject` / `getProjectByName`. None filter by user; `listProjects()` returns every row.
3. **HTTP surface** — `web/src/routes/api/projects/+server.ts` (`GET` list, `POST` create) and `web/src/routes/api/projects/[id]/+server.ts` (`GET` / `PUT` / `DELETE`). Bodies are Zod-validated (`.strict()`); create requires non-empty `name` and `path` (preserved 400 message: `"name and path required"`).
4. **Conversation binding** — `conversations.projectId` is `notNull` with `onDelete: "cascade"`: a conversation always belongs to exactly one project, and deleting a project deletes its conversations. Many other tables FK to `projects` (runs, memories, features, lessons, knowledge_base_files, …) with `set null` or `cascade`.
5. **The data path into agents** — when a turn runs, `ExecutorEngine.resolveInput` (`src/runtime/executor.ts`) merges, in priority order, account settings → `{ cwd: project.path }` → `project.variables` → the call's explicit input. So the project's `path` becomes the agent's `cwd` and its `variables` become input defaults. In the chat send path, `web/src/routes/api/conversations/[id]/messages/+server.ts` calls `getProject(conv.projectId)` and passes `project.path` as `projectRoot` to the streaming runtime; that `projectRoot` is what file tools resolve against.
6. **File-tool containment** — built-in file tools resolve relative paths against `projectRoot` via `validatePath` (`src/runtime/tools/validate.ts`), a **lexical** `resolve`/`relative`/`startsWith` check (no realpath). The `@`-mention / autocomplete scanner (`src/runtime/fs/scan-fs.ts`) instead uses `realpathInsideRoot` (realpath-based, symlink-escape filtered). This asymmetry is intentional but worth knowing (see Notes).
7. **Seeded rows** — `migrate()` idempotently seeds two rows on boot: the `global` sentinel (`id='global'`, `path='/'`) and — only when `EZCORP_SELF_PROJECT_PATH` is set — the **self project** (`id='self'`, `src/db/seed-self-project.ts`), a workspace whose `path` is the app's own source checkout so a dev-compose instance can dogfood EZCorp on its own code. First insert also seeds a standing-guidance system prompt as `settings['project:self:systemPrompt']` (delivered via `resolveSystemPrompt`, editable/deletable at `/project/self/settings` — never re-seeded, so user edits stick) and the repo-shipped icon (`/self-project-icon.png` from `web/static/`, backfilled onto older rows only while `icon` is NULL). On later boots only `path` follows the env var; name/icon choices are preserved, and deleting the project re-creates it next boot (a dev affordance, by design). `listProjects()` pins the `self` row first so it's the top option in every project surface. The dev compose stack sets the var to `/repo` (the full-checkout mount); the older seed-marketplace "Test Project" (`path` = container cwd) is superseded by this for dogfooding.

### Per-project tool-permission mode

8. Stored as a **settings KV entry**, not a project column: key `project:<projectId>:tool_permission_mode`, value one of `ask` / `auto-edit` / `yolo`. Read/written by `handleGetPermissionMode` / `handleSetPermissionMode` in `src/routes/tool-permission.ts`, fronted by `web/src/routes/api/projects/[id]/tool-permission-mode/+server.ts`. `GET` falls back to `DEFAULT_PERMISSION_MODE` (`"yolo"`) when unset. `PUT` upserts the setting and, if a `conversationId` is supplied, emits a `tool:permission_mode_change` bus event so live UIs update. **Both verbs require project `member` role**, and the `conversationId` is authorization input, not a label: it must name a chat the caller owns inside this project, or the whole request is refused `403` with nothing written. **`PUT` is additionally session-only** (`requireSessionAuth`): the stored mode is standing consent to auto-run tools, so no API key may set it, while `GET` stays key-readable — see [[rbac-and-permission-modes]].

### The install-root resolver (host-internal, unrelated)

9. `getProjectRoot()` / `resolveProjectRoot()` (`src/extensions/project-root.ts`, re-exported from `src/extensions/bundled.ts` so pre-existing importers needed no edit) resolve the EZCorp checkout root, first-match-wins:
   1. `EZCORP_PROJECT_ROOT` env var — accepted only if it exists **and** contains `docs/extensions/examples/` (a stale/typo'd value falls through rather than failing closed).
   2. substring match on `import.meta.dir` / `import.meta.url` containing `src/extensions` (direct `bun src/...` runs).
   3. `.git` walk-up from the meta dir then `process.cwd()`, accepted only if the result contains `docs/extensions/examples/` (needed under `vite preview`, where the bundler rewrites `import.meta.url`).
   4. `process.cwd()` fallback with a WARN log.
   The result is cached process-lifetime (`__resetProjectRootCacheForTests` resets it for tests). **Step 4 is what the shipped container actually takes** — see the gotcha below; steps 1–3 are dev/test paths.
10. **Consumers**: `ensureBundledExtensions()` joins `getProjectRoot()` with each bundled entry's `path` to load its on-disk manifest; the `$CWD` extension-grant token expands to `getProjectRoot()` via `grantCwdBase()` in `src/extensions/permissions.ts` (`expandGrantPrefix`); the registry injects `EZCORP_EXTENSION_DATA_ROOT = getProjectRoot()` into extension subprocess env. In production the host cwd already **is** the install root (`/app`), so `$CWD` → project-root is a no-op there; it only matters under the vite-SSR dev server where host cwd is `/app/web`.

## Usage

**REST**

- `GET /api/projects` — list all projects (requires `read` scope + auth).
- `POST /api/projects` — create. Body `{ name, path, icon?, variables? }`; returns `201`.
- `GET /api/projects/:id` — fetch one (`404` if missing).
- `PUT /api/projects/:id` — partial update of `name` / `path` / `icon` / `variables`. **Requires project `member` role** (`checkProjectRole`, instance admins bypass); `403` otherwise — see the ownership note below.
- `DELETE /api/projects/:id` — delete (cascades to conversations, including other members'). **Requires project `owner` role** (or an instance admin); `403` otherwise. The project settings page shows the Delete control only to such callers (`canDeleteProject` in `web/src/lib/admin-guard.ts`).
- `GET /api/projects/:id/members` — list a project's members. **Requires project `member` role.**
- `POST /api/projects/:id/members` — add a member or change an existing member's role. Body `{ userId, role? }` (`role ∈ {member, owner}`, defaults `member`). **Requires project `owner` role.** Refuses with `409` if it would demote the last owner.
- `DELETE /api/projects/:id/members/:userId` — remove a member. **Requires project `owner` role**; refuses with `409` if it would remove the last member or the last owner.
- `GET /api/projects/:id/tool-permission-mode` — `{ mode }` (defaults `"yolo"`). **Requires project `member` role.**
- `PUT /api/projects/:id/tool-permission-mode` — body `{ mode, conversationId? }`; `mode ∈ {ask, auto-edit, yolo}` (`chat` scope for `PUT`, `read` for `GET`). **Session-only** (refuses every API key, `403`) and **requires project `member` role**, and a supplied `conversationId` must name a chat the caller owns inside this project; `403` otherwise.
- `/api/projects/:id/features…` — the per-project feature index lives under this prefix (separate feature; see [[feature-index]]).

**Frontend**

- `web/src/lib/api.ts` — `fetchProjects` / `createProject` / `updateProject` / `deleteProject` client helpers.
- `web/src/lib/components/ProjectForm.svelte` — create/edit form. The default new-project path is `/app/web/.ezcorp/projects/`, bound to the host at `./.ezcorp/projects`. That container path is not a free choice; it is pinned by three constraints at once:
  1. inside the **dev** fs-API sandbox root (`EZCORP_PROJECT_ROOT ?? process.cwd()` = `/app/web`), or "Create Folder" 403s;
  2. inside the **prod** sandbox root too (`/app` — `Dockerfile` `WORKDIR`, `CMD ["bun","run","web/build/index.js"]`). `/app/web/…` is the only shape that satisfies both, because `/app/web` is strictly inside `/app`;
  3. under a `.ezcorp` segment (Vite's watcher ignores `**/.ezcorp/**`, so project build output doesn't churn HMR).

  **Every stack binds the identical path** — `docker-compose.yml`, `compose.prod.yml`, and by inheritance `compose.prod.localtest.yml`. That is load-bearing rather than tidy: `projects.path` stores an absolute CONTAINER path, so a database moved between stacks only resolves if they agree. `src/__tests__/compose-projects-root.test.ts` holds the bind, the form default, all three constraints, and cross-stack equality together.

  Two tempting shortcuts are wrong. Setting `EZCORP_PROJECT_ROOT=/app` in dev so both cwds agree **widens the dev fs jail** to expose `/app/.ezcorp/data` (the live DB) to `/api/fs/list`. And putting projects at `/app/.ezcorp/projects` — which reads better as a sibling of `.ezcorp/data` — is illegal in dev, where the jail is `/app/web`.

  The pre-`.ezcorp` default `/app/projects/` satisfied none of the three, which is why folder creation failed there and hand-typed `~/projects/…` paths silently landed on the container's throwaway overlay.

- **Path shape is validated on write.** `projectPathSchema` (`web/src/lib/server/security/validation.ts`) rejects non-absolute paths, a bare `~` segment, and `..`, on both `POST /api/projects` and `PUT /api/projects/[id]`. It checks SHAPE, not location — the seeded `global` (`/`) and `self` (`/repo`) projects legitimately sit outside the bind. Before this, both routes took `path: z.string()` and checked only emptiness, which is how `~/projects/<name>` (270 MB onto the throwaway overlay) and `app/<name>` (a row pointing at nothing from the moment it saved) both got in without any error at the time.
- `web/src/lib/components/ProjectPicker.svelte`, `ProjectRail.svelte` — workspace selection UI.
- `web/src/lib/components/PermissionModeIndicator.svelte` — surfaces / toggles the per-project mode.
- `web/src/lib/stores.svelte.ts` — `activeProjectId` state, persisted to `localStorage` (key `activeProjectId`), defaulting to the `"global"` sentinel (a non-project scope used by cross-project surfaces like memories/search, **not** a real project id). Written only through `setActiveProjectId`.
- `web/src/routes/(app)/+layout.svelte` — an `$effect` keeps `activeProjectId` in lock-step with the URL so a bookmark / refresh / direct link restores the workspace. It resolves the id from the **pathname** via `projectIdFromPath` (`$lib/resume-path.ts`), never from `page.params.id` (see Notes).

**Env vars / settings**

- `EZCORP_PROJECT_ROOT` — explicit override for the install-root resolver (must contain `docs/extensions/examples/`).
- `EZCORP_SELF_PROJECT_PATH` / `EZCORP_SELF_PROJECT_NAME` — boot-seed the `self` project **record** at that path (dev-compose dogfooding). Despite the similar name, unrelated to `EZCORP_PROJECT_ROOT`: this creates a user-facing workspace row; the other configures the host-internal install-root resolver.
- `EZCORP_EXTENSION_DATA_ROOT` — injected into extension subprocesses; derived from `getProjectRoot()`.
- Settings key `project:<id>:tool_permission_mode` — per-project mode (not a project column).
- Settings key `project:<id>:systemPrompt` — per-project standing prompt; seeded once for `self` with self-modification guidance.

## Key files

- `src/db/schema.ts` — `projects` table (id/name/path/icon/variables/timestamps); `project_members` table (projectId/userId/role, `PROJECT_MEMBER_ROLES`); `conversations.projectId` notNull FK.
- `src/db/queries/projects.ts` — project CRUD queries (reads unfiltered by user; `createProject` stamps the creator as `owner` in `project_members`).
- `src/db/queries/project-members.ts` — `listProjectMembers` / `upsertProjectMember` / `removeProjectMember` / `countProjectMembers` / `getProjectMembership`.
- `src/db/seed-self-project.ts` — env-gated boot seed of the `self` project + its guidance prompt (called from `migrate()`).
- `src/auth/middleware.ts` — `checkProjectRole` (`member` < `owner` ladder, instance-admin bypass).
- `web/src/routes/api/projects/+server.ts` — list / create routes.
- `web/src/routes/api/projects/[id]/+server.ts` — get / update / delete routes (update gated on `checkProjectRole(..., "member")`, delete on `"owner"`).
- `web/src/routes/api/projects/[id]/members/+server.ts` — list members (`member`) / add-or-change a member (`owner`).
- `web/src/routes/api/projects/[id]/members/[userId]/+server.ts` — remove a member (`owner`; refuses to remove the last one).
- `web/src/routes/api/projects/[id]/tool-permission-mode/+server.ts` — per-project mode route shim.
- `src/routes/tool-permission.ts` — `handleGet/SetPermissionMode` (settings-KV backed) + the tool-call approval handler.
- `src/runtime/executor.ts` — `resolveInput` merges `cwd: project.path` + `project.variables` into agent input.
- `web/src/routes/api/conversations/[id]/messages/+server.ts` — loads `getProject(conv.projectId)`, passes `project.path` as `projectRoot` to the runtime.
- `src/runtime/tools/validate.ts` — `validatePath` lexical containment against `projectRoot`.
- `src/runtime/fs/scan-fs.ts` — `realpathInsideRoot` (realpath-based scanner containment).
- `src/extensions/project-root.ts` — `getProjectRoot` / `resolveProjectRoot` install-root resolver (only dependency: `src/logger.ts`).
- `src/extensions/bundled.ts` — `BUNDLED_EXTENSIONS`; re-exports the resolver above so existing `from ".../extensions/bundled"` importers keep working.
- `src/extensions/permissions.ts` — `grantCwdBase` / `expandGrantPrefix` ($CWD → install root).
- `web/src/lib/components/ProjectForm.svelte`, `ProjectPicker.svelte`, `ProjectRail.svelte`, `PermissionModeIndicator.svelte` — UI.
- `web/src/lib/api.ts`, `web/src/lib/stores.svelte.ts` — client helpers + `activeProjectId` store.

## Features it touches

- [[conversations]] — every conversation has a `notNull` `projectId`; deleting a project cascades its conversations.
- [[builtin-file-tools]] — file tools resolve relative paths against the active project's `path`.
- [[mention-grammar]] — the `@[file:…]` / `@[dir:…]` sigils scan the active project's filesystem.
- [[rbac-and-permission-modes]] — per-project `tool_permission_mode` selects approval friction.
- [[permissions-and-grants]] — the `$CWD` extension grant expands to the install root (`getProjectRoot()`), not the project path.
- [[bundled-catalog]] — `ensureBundledExtensions` joins `getProjectRoot()` with each entry's path to load manifests.
- [[runtime-and-rpc]] — `EZCORP_EXTENSION_DATA_ROOT` (from `getProjectRoot()`) is injected into extension subprocesses.
- [[feature-index]] — features live under `/api/projects/:id/features`, scoped to the active project.
- [[persistent-memory]] — memories FK to `projects` and can be project-scoped or global.
- [[runs-lifecycle]] — runs carry a nullable `projectId`.
- [[api-security]] — project routes gate on `requireAuth` + `requireScope`.

## Related docs

- [extension data storage convention](../../extensions/data-storage.md) — the `<projectRoot>/.ezcorp/extension-data/<name>/` path that `$CWD` / `getProjectRoot()` anchors.
- The user-facing project record itself has no dedicated doc — this is the primary reference.

## Notes & gotchas

- **Projects ARE user-scoped, via a membership table — `listProjects()` reads stay unfiltered.** `project_members` (`src/db/schema.ts`) is the platform's project-membership model: a join table keyed by `(projectId, userId)` with a `role` of `member` or `owner` (`PROJECT_MEMBER_ROLES`). `createProject` (`web/src/routes/api/projects/+server.ts`) stamps its creator as `owner`. Reads are still deliberately instance-global — `listProjects()` and `GET /api/projects/:id` apply no membership filter, because narrowing them would show every non-admin an empty project list on any instance that predates this table (pre-existing rows are backfilled onto the first admin by migration). Conversations *are* user-owned (`conversations.userId`); their containing project is shared reading, membership-gated writing.
- **Mutating a project or its membership is gated by `checkProjectRole`, a `member` < `owner` ladder with an instance-admin bypass.** `checkProjectRole` (`src/auth/middleware.ts`) treats `user.role === "admin"` as holding `owner` on every project; otherwise it looks up the caller's row in `project_members`. `PUT /api/projects/:id` requires `member` and `DELETE` requires `owner`, because a delete cascades to every member's conversations (`web/src/routes/api/projects/[id]/+server.ts`). `POST /api/projects/:id/members` (add a member or change an existing one's role) and `DELETE /api/projects/:id/members/:userId` (remove one) require `owner` (`web/src/routes/api/projects/[id]/members/+server.ts`, `.../members/[userId]/+server.ts`) — granting authority is the narrower right, so it sits above ordinary mutation. The last remaining member of a project cannot be removed, and the last owner cannot be removed or demoted (`409`, not `403`; `web/src/routes/api/projects/[id]/members/_owner-guard.ts`), so the API itself can never strand a project down to admin-only reach. **This replaces an earlier admin-only stop-gap**: `PUT`/`DELETE` used to run with no authorization past `requireAuth`, so any authenticated caller with the `read`/`write` scope could delete any project by id or silently repoint its `path` (the filesystem-scoping source of truth for every built-in file tool); at the time no column recorded who created a project, so "let the owner mutate it" wasn't expressible and the enforced rule was role-based admin-only. `project_members` is what makes creator/owner-scoped mutation expressible. Denials are `403`, not the fail-closed `404` used on owner-scoped routes like `/api/memories/:id` — reads stay unfiltered, so there is no existence to hide. Pinned by `src/__tests__/security/cross-tenant-deletion-projects-kb-modes.test.ts` and `web/e2e/real-auth/project-mutation-authz-flow.spec.ts`.
- **Two unrelated "project" concepts.** `project.path` (a user-chosen workspace dir, e.g. `/app/web/.ezcorp/projects/foo`) and `getProjectRoot()` (the EZCorp install root, e.g. `/app`) are independent. `getProjectRoot()` is **never** derived from a project record and a project's `path` is **never** the `$CWD` grant base. Conflating them is the easiest mistake here.
- **Lexical vs realpath containment asymmetry.** Built-in file tools use `validatePath` (lexical `startsWith`, no realpath), while the `@`-mention scanner uses `realpathInsideRoot` (realpath). A symlink inside `project.path` pointing outside it is filtered by the scanner but **not** by the lexical tool check — the tool would resolve through it. This is a known asymmetry, not a fixed bug.
- **`DEFAULT_PERMISSION_MODE = "yolo"`** (`src/runtime/tools/permissions.ts`) is an intentional, permanent product decision; the per-project mode falls back to it when unset. Not a security finding.
- **Cross-tenant active-run IDOR — FIXED (was open).** `web/src/routes/api/conversations/[id]/active-run/+server.ts` now gates on `resolveRootConversationForOwnership` (fail-closed 404) in addition to `requireAuth` + `requireScope`, as of `20adfe86` (PR #12). The point that made it relevant *here* is unchanged and still worth knowing: **a conversation's project binding adds no ownership gate of its own.** Project scoping is not an authorization boundary — every route must authorize against the conversation's owning root itself.
- **`activeProjectId === "global"`** is a sentinel for cross-project surfaces (memories, Cmd+K search), not a real project id — guard for it before treating it as a uuid.
- **`[id]` is not a project id.** `/extensions/[id]`, `/extensions/[id]/audit`, `/marketplace/[id]` and `/runs/[id]` all declare the same route param name as `/project/[id]`. The `(app)` layout's URL sync therefore parses the **pathname** (`projectIdFromPath`, which returns null for every non-project route) — reading `page.params.id` there wrote an extension / listing / run id into `activeProjectId` and kicked the user out of their project (fixed; regression-pinned by `web/src/routes/(app)/__tests__/layout-active-project-sync.component.test.ts` and `web/e2e/project-context-non-project-routes.spec.ts`). Any *new* consumer that derives a project id from the URL must do the same. `page.params.id` is only safe **inside** a `/project/[id]/…` route (e.g. `AgentDetailPanel`, mounted solely from the chat page).
- **`$CWD` is a dev-only widening.** In production host cwd already equals the install root, so `$CWD → getProjectRoot()` is a no-op; it only differs under the vite-SSR dev server (`/app/web` → `/app`), which can only *permit* more, never less. `getProjectRoot` is imported **statically** in `permissions.ts` because a lazy `require` silently fails under the vite-SSR transform.
- **The resolver's own module has to stay dependency-light.** It lives in `src/extensions/project-root.ts` with exactly one non-builtin import (`src/logger.ts`), pinned by `src/extensions/__tests__/project-root.test.ts` ("static import closure"). It used to sit at the top of `bundled.ts`, which reaches `db/queries/extensions.ts → db/connection.ts → migrate.ts` — so `src/db/migrate.ts` and `src/startup/background-timers.ts` both had to reach `getProjectRoot()` by dynamic `import()` to keep that cycle open. Both are plain static imports now. Adding a DB/registry import to `project-root.ts` would re-create the cycle and quietly force the workaround back.
- **In production, resolution reaches step 4 and logs the WARN on every boot — and that is correct, not a fault.** Verifiable from the image definition: the Dockerfile sets no `EZCORP_PROJECT_ROOT` (the only writer in the repo is `web/playwright.real.config.ts`), so step 1 misses; the entrypoint is `CMD ["bun","run","web/build/index.js"]`, so vite has rewritten `import.meta` into `web/build/server/` and step 2 misses; `.dockerignore` excludes `.git`, so the step-3 walk-up finds nothing. `WORKDIR /app` makes `process.cwd()` the right answer, which is why this has never surfaced as a bug. Two consequences: (a) `getProjectRoot() === process.cwd()` in prod is a *coincidence of `WORKDIR`*, not a designed invariant — a Dockerfile that changed `WORKDIR` would silently relocate every bundled-extension lookup and every `$CWD` grant; (b) the boot log carries a `warn` every start. Setting `ENV EZCORP_PROJECT_ROOT=/app` would make step 1 win and fix both, but it is a deploy change, tracked separately — do not "fix" it by deleting the log line.
- **Steps 1–3 are exercised only by dev, tests and the vitest/Node leg.** `import.meta.dir` is a Bun extension (`undefined` under Node); the `import.meta.url` half of step 2 exists solely for a runtime that resolves this module without it, which is the vitest leg — pinned by `web/src/__tests__/project-root-node-leg.server.test.ts`. Don't delete it as dead code on the strength of a backend-suite reading; the backend suite runs under Bun, where it is unreachable by construction.
- **Project deletion cascades.** Because `conversations.projectId` is `onDelete: "cascade"`, `DELETE /api/projects/:id` silently removes every conversation in that project (and, transitively, their messages/runs). The route does no confirmation or soft-delete.
