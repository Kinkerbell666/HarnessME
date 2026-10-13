# RBAC & Permission Modes

> _The independent authorization layers in EZCorp: instance roles (`admin`/`member`) that gate admin/extension-lifecycle APIs, team roles (`owner`/`editor`/`viewer`) for collaborative resources, **project membership** (`owner`/`member`) that decides who may mutate a project and read/run its workflows, and per-project tool **permission modes** (`ask`/`auto-edit`/`yolo`) that decide which built-in tool calls auto-run vs. pause for the user._

## Intent

EZCorp has to answer two distinct questions on every privileged action: *"is this human/principal allowed to do this?"* (RBAC) and *"should this LLM-initiated tool call run without asking the user?"* (permission modes). These are deliberately separate axes. RBAC is human-identity authorization enforced at the HTTP boundary (`requireRole`, `requireTeamRole`, `requireAdmin`). Permission modes are a per-project trust dial for **built-in** tools (file read/write/exec) that the model invokes mid-turn. A third, orthogonal system — the [PermissionEngine PDP](#extension-capabilities-the-pdp-orthogonal-axis) — governs **extension** capabilities (grants → allow/deny/prompt) and is documented mainly under [[permissions-and-grants]]; this doc covers how the three relate and where each one bites.

## How it works

There are five authorization layers, each with its own enforcement point.

### 1. Instance roles (`admin` / `member`) — `users.role`

- The principal type is `AuthUser` (`src/auth/types.ts`): `{ id, email, name, role: "admin" | "member" }`. The role column lives on `users.role` (`src/db/schema.ts`, defaulting to `"member"`).
- `requireAuth(locals)` (`src/auth/middleware.ts`) returns the user or throws a raw `401` Response. `requireRole(locals, "admin")` calls `requireAuth` then throws a `403` Response unless `user.role === "admin"`. Both throw a `Response` object, which SvelteKit surfaces as a `500` unless the route catches it — several routes wrap it in a `requireAdminOr403`-style try/catch to return a clean `403` (e.g. `web/src/routes/api/extensions/[id]/+server.ts`).
- Admin-gated operations include: extension **install** / **modify** / **disable** (`POST`/`PATCH /api/extensions[/...]`), **reapprove-drift** (`POST /api/extensions/[id]/reapprove-drift`), permission editing (`PUT /api/extensions/[id]/permissions`), the **audit** log (`GET /api/audit`), marketplace flags/delete, provider CRUD, admin sessions/errors/analytics/system endpoints, and the `forever`-scope grant escalation in the permission modal (below).

### 2. API-key scopes — a second authorization axis

- Bearer / API-key principals carry `locals.apiKeyScopes` (`ApiKeyScope = "read" | "write" | "chat" | "extensions" | "admin"`, from `src/auth/api-key.ts`). `requireScope(locals, scope)` (`web/src/lib/server/security/api-keys.ts`) returns a `403` Response if the key lacks the scope — **but is a no-op (allow-all) for cookie sessions**, because `locals.apiKeyScopes` is `undefined` there.
- The scopes are **FLAT** — `hasRequiredScope` is a plain `includes()`, so there is no hierarchy: `chat` does not subsume `read`, and `admin` subsumes nothing. `write` was added 2026-08 because none of the original four meant "may modify data" and `read` had been doing that job for 18 mutating handlers; a boot migration (`src/db/migrations/backfill-api-key-write-scope.ts`) granted `write` to every already-issued `read` key so no secret had to be re-minted. See [the audit](../../audit/2026-08-read-scope-mutation-inventory.md).
- That no-op is the footgun: `requireScope(locals, "admin")` alone lets any cookie-authed *member* through. The role axis is the real authority. Two defenses exist:
  - **API-key principals are always minted with `role: "member"`** (`web/src/lib/server/security/bearer-auth.ts`), so a key can never be an admin *by role* even if it holds the `admin` *scope*.
  - `requireAdmin(locals)` checks `locals.user.role === "admin"` directly, and admin routes are expected to pair `requireScope("admin")` with `requireRole("admin")` — a route-contract meta-test enforces the pairing.

#### `scope: "session"` — the routes NO key can call

`src/api-registry.ts` records each route's gate in `ApiRouteScope`, which is
`ApiKeyScope | "public" | "session"`. Only the first names a key scope:

| value | meaning |
|---|---|
| `read` / `write` / `chat` / `extensions` / `admin` | call it with a key holding that scope (renders as `security: [{ bearerAuth: [scope] }]`) |
| `public` | no authentication at all |
| `session` | **session-only** — authorization is by interactive browser session; **no API key can call it regardless of the key's scopes** |

`session` (`SESSION_ROUTE_SCOPE`, `src/auth/api-key.ts`) is deliberately **not**
a member of `API_KEY_SCOPES`, so `isApiKeyScope("session")` is `false` and it
can never be minted onto a key or satisfy `hasRequiredScope`. Three consumers
handle it explicitly, and each would otherwise publish or grant a reach that
does not exist:

- **OpenAPI** (`src/openapi.ts`) secures those operations with a
  `sessionCookie` scheme (`apiKey` in cookie `ezcorp_session`), never `bearerAuth`
  — `bearerAuth: ["session"]` would tell an integrator to mint a scope that
  does not exist for a route that refuses every key.
- **Mint validation** (`validateToolPolicy`, `src/auth/tool-policy.ts`) refuses
  a `routeAllowlist` entry naming a session-only route, for the same reason it
  refuses a typo: the entry grants nothing and denies silently forever.
- **The route-contract ratchet** (`web/src/__tests__/route-contract.test.ts`)
  counts them as scoped, which took `KNOWN_SCOPELESS` from 90 to 78.

**The registry is documentation and tooling, not enforcement.** It feeds the
OpenAPI builder, `/api/docs` and mint validation only; `requireSessionAuth`
(or `requireAdminSession`, which composes it with the admin role check) in the
handler is what actually refuses the key.
`src/__tests__/session-scope-surface.test.ts` walks every route handler and
asserts the two agree in **both** directions — an entry declaring `session`
whose handler never gates on one fails, and a handler that gates on one whose
entry does not declare it fails. `POST /api/hub/pages/[id]/actions/[action]` is
the one carve-out and it is asserted as such: its session gate applies only to
an action listed in `sessionOnlyActions`, so the route stays `chat`-scoped and
key-callable for everything else.

The thirteen session-only entries are the **consent** surfaces: answering a
workflow approval, the four delegation verbs plus the preview and the
delegated-runs read, the five service-account verbs, and
`PUT /api/projects/[id]/tool-permission-mode`. The rule that decides membership
is the capability-vs-consent tell at the foot of this document.

### 3. Team roles (`owner` / `editor` / `viewer`) — `team_members.role`

- `requireTeamRole(locals, teamId, minRole)` (`src/auth/middleware.ts`) resolves the caller's membership via `getTeamMembership(user.id, teamId)` and compares against a numeric ladder `ROLE_LEVELS = { viewer: 0, editor: 1, owner: 2 }`.
- **Instance admins bypass the team check entirely** (`if (user.role === "admin") return user;`). Non-members get `403` "Not a member of this team"; insufficient level gets `403` "Insufficient team permissions".
- Used by the teams API: `GET /api/teams/[id]` (viewer), `PUT /api/teams/[id]` + member add/remove (owner).

### 3b. Project membership (`owner` / `member`) — `project_members.role`

- `checkProjectRole(locals, projectId, minRole)` (`src/auth/middleware.ts`) resolves the caller's row via `getProjectMembership(user.id, projectId)` and compares against `PROJECT_ROLE_LEVELS = { member: 0, owner: 1 }`. **Instance admins bypass** (same as `requireTeamRole`). Unlike `requireTeamRole` it RETURNS `AuthUser | Response` rather than throwing — every consumer is a `+server.ts` handler, and a thrown `Response` there is a 500.
- `member` may read and **rename** the project; `owner` additionally **deletes** it and manages membership. Delete is owner-only because it cascades to every member's conversations.
- Both roles have a writer, so neither rung is unreachable: `createProject(data, ownerUserId)` stamps its creator `owner`, `POST /api/projects/:id/members` writes `member`. `migrate()` backfills every project with **no** members to the first admin (the `conversations`/`memories` ownerless-backfill rule), id `pm-backfill-<projectId>` so a re-run collides with itself.
- Enforcement: `PUT /api/projects/:id` (`member`), `DELETE /api/projects/:id` (`owner`), `GET /api/projects/:id/members` (`member`), `POST /api/projects/:id/members` + `DELETE /api/projects/:id/members/:userId` (`owner`), `GET`/`PUT /api/projects/:id/tool-permission-mode` (`member`). Removing the LAST member is refused **409** — a memberless project is reachable only through the admin override, which is the state the backfill exists to prevent. **Reads are deliberately NOT narrowed**: `GET /api/projects` stays instance-global, because after the backfill a membership filter would show every non-admin an empty project list on an upgraded instance (recorded in `web/src/routes/api/projects/+server.ts`, pinned in `src/__tests__/security/cross-tenant-deletion-projects-kb-modes.test.ts`).
- The workflow read/run ladder consumes the same table — see the [[workflows]] entry below.

### 4. Permission modes (`ask` / `auto-edit` / `yolo`) — per-project built-in-tool gate

This is the LLM-action gate, defined in `src/runtime/tools/permissions.ts`. It governs only **built-in** tools, classified by `ToolCategory` (`read` / `write` / `execute` / `ez`; `src/runtime/tools/types.ts`).

- The auto-approve matrix:

  | Mode | Auto-approved categories | Prompts for |
  |---|---|---|
  | `ask` | `read`, `ez` | `write`, `execute` |
  | `auto-edit` | `read`, `write`, `ez` | `execute` |
  | `yolo` | `read`, `write`, `execute`, `ez` | (nothing) |

  `ez` (concierge propose/fill/navigate tools) is auto-approved in **every** mode — they're proposal/informational and the real mutation surface is a destination form's Submit button.
- `needsApproval(category, mode)` returns `!AUTO_APPROVE[mode].has(category)`. `getPermissionMode(projectId, sessionOverride?)` resolves the effective mode: an explicit `sessionOverride` wins; else the stored `project:${projectId}:tool_permission_mode` setting; else `DEFAULT_PERMISSION_MODE`.
- **`DEFAULT_PERMISSION_MODE = "yolo"`** — this is an intentional, permanent product decision (fresh installs auto-approve everything), not a security gap.

#### Gate lifecycle (built-in tool)

The gate is `withPermissionGate(def, deps)` (`src/runtime/tools/permission-wrap.ts`). It is the projection **every** built-in wire uses — the project file tools in `setup-tools.ts` block 2a, and the host-wired families (Ez, briefing, briefing-chat, `run_workflow`). `permissionDeps` is a REQUIRED parameter on each wire, so a built-in cannot be registered ungated by omission.

1. Resolve the effective mode, at the moment of the call: `options.permissionMode` (per-turn override from the send body) → `busOverrideMode` (live mid-run mode switch via the `tool:permission_mode_change` bus event, read through a getter so a switch after wrap time still lands) → `await getPermissionMode(projectId)`. A turn with no project falls back to `DEFAULT_PERMISSION_MODE` — there is nowhere to store a mode without one.
2. If `needsApproval(def.category, mode)`, register the call in `host.pendingPermissions` (with the opening run's `runId`), emit a `tool:permission_request` bus event (renders the inline `PermissionGate.svelte` card) and `await createPermissionGate(toolCallId, conversationId, opts?)` — a promise stored in an in-memory `pendingApprovals` Map that blocks the tool until resolved.
3. The user answers via `POST /api/tool-calls/:id/permission` → `handleToolPermission` (`src/routes/tool-permission.ts`) → `resolvePermission(toolCallId, approved)`. Approve resolves the promise (tool runs); deny rejects it (tool returns an `isError` result).
4. On approval the wrapper calls `watchdog.refreshToolStart(runId, toolCallId)`. The watchdog started that call's `callTimeoutMs` clock at `tool_execution_start`, which fires BEFORE the gate, so without the refresh a slow approval spent the tool's whole execution budget.

`createPermissionGate`'s optional third argument bounds the gate — `{timeoutMs, signal, nonInteractiveGuard}`, the same shape `createExtensionPermissionGate` has. Omitting it is the default and reproduces the historical unbounded "wait for the human" gate exactly (no timer, no `cleanup`, no `hardReject`). An expired gate rejects `PermissionGateTimeoutError` and the wrapper renders it as `"Permission for <tool> expired after <n>s with no decision"`, distinct from the generic `"Permission denied by user"`.

The `pendingApprovals` Map stores the gate's `conversationId` so the resolver can run a **sec-H2 ownership check**: only the conversation owner (or an instance admin) may approve/deny a pending gate. Without it, a low-privileged user could approve an admin's pending `shell` execution.

It also stores the gate's **initiator** — the `principalId` (`session:<userId>` / `api-key:<keyId>` / `internal:<keyId>`, `src/auth/principal-id.ts`) of the request whose run raised it. The initiator is recorded from an `AsyncLocalStorage` scope opened once in `hooks.server.ts`, around the single post-auth `resolve(event)`, so every route's runs are attributed without each route knowing. **Ownership is not consent:** a `chat` key can own the conversation a gate belongs to, so before this a leaked key could approve a `shell` gate the owner's own browser run had parked. An interactive session may answer anything it owns (unchanged); any other principal may answer only a gate its own request raised. A gate with **no recorded initiator** (goal autopilot, briefings, github-projects spawns, CLI runs) is refused to non-session principals — fail-closed, and it strands nothing, because the owner's session and instance admins can still answer it.

### Extension capabilities: the PDP (orthogonal axis)

Extension tool calls do **not** go through permission modes. They route through the `PermissionEngine` PDP (`src/extensions/permission-engine.ts`), the single place mapping grants → `allow` / `deny` / `prompt`:

- `authorize(ctx, needed)` computes the effective grant set (cross-ext `capContext` → per-conversation override → registry grants), does a subset check (`firstMissingCapability`), and for **sensitive** caps (`SENSITIVE_KINDS` in `src/extensions/capability-types.ts` — `shell`, `fs.write`, plus `ezcorp:extension:install` / `ezcorp:extension:modify`) without an always-allow row returns `prompt`. The four-scope persisted gate (below) only carries `shell` / `fs.write` (`ExtensionGateMeta.capabilityKind` is typed exactly those two); install/modify take the one-shot, never-persisted path described in the last bullet.
- A `prompt` opens a *second* gate type via `createExtensionPermissionGate` (`src/runtime/tools/permissions.ts`, consumed in `src/extensions/tool-executor/executor.ts`). Unlike built-in gates, this resolves to a structured `ApprovalResolution { allowed, scope, ttlOverrideMs }` so the chosen always-allow **scope** (session / conversation / project / forever) can be persisted via `resolvePrompt`. See the [four-scope modal](#related-docs).
- **Where RBAC re-enters the LLM path:** the `forever` scope is admin-gated *at the API layer* — `handleToolPermission` rejects `scope: "forever"` from a non-admin caller (`user.role !== "admin"` → `403`), defense-in-depth behind the client-side `isAdmin` prop on `PermissionGate.svelte`. Also, `ezcorp:extension:install` and `ezcorp:extension:modify` are never persisted as always-allow rows (every install/reopen-for-edit re-prompts), and **bundled** first-party extensions get a `bundled-ceiling-auto-allow` for non-install/non-modify sensitive caps so they don't hit an unanswerable gate.

### 5. Extension RBAC grants (`extension_rbac_grants`) — per-user, per-project, per-extension

A fourth axis answers *"may **this user** use / configure / approve-runs-for **this extension** in **this project**?"* — distinct from the PDP (which governs what the *extension* may do) and from instance roles (which are all-or-nothing across the instance). The resolver and delegation rules live in one place: `src/auth/extension-rbac.ts`.

- **Grant row** (`extension_rbac_grants`, `src/db/queries/extension-rbac.ts`): `(user_id, project_id?, extension_id?, scopes[])`. A `NULL` `project_id` covers **all** projects; a `NULL` `extension_id` covers **all** extensions. A COALESCE-unique index over `(user_id, COALESCE(project_id,''), COALESCE(extension_id,''))` makes each (user, project-or-all, extension-or-all) tuple singular (the same NULL-collapse pattern as `extension_secrets`; the query layer uses select-then-write with retry-once, never `ON CONFLICT`).
- **Scopes** = the fixed core verbs `use` / `configure` / `secrets` / `approve-runs` / `manage` / `mcp-wire`, plus any **custom** scopes an extension declares in its manifest (`permissions.rbacScopes: [{name, description}]`, validated by `src/extensions/rbac-scopes.ts`: grammar `[a-z][a-z0-9-]*`, no core-verb collision, ≤16, description required). github-projects declares `write-tickets`.
- **Resolution** (`resolveEffectiveScopes` / `hasExtensionScope`): `role === "admin"` → the `RBAC_ALL_SCOPES` sentinel **without a DB hit** (a non-admin can never obtain it). Otherwise the union of `scopes` across grants whose `project_id` is NULL-or-equal AND `extension_id` is NULL-or-equal. **Deny-by-default** — no grant means empty set (a deliberate 2026-07-03 decision for a clean long-term posture; the instance has no non-admin users yet, so nothing regresses).
- **Delegation** (`canManageGrant`): admins always; otherwise the actor needs a `manage` scope whose grant coverage **contains** the target grant's exact (project, extension) coordinates — reusing the resolver, so a project-scoped manager can never mint a NULL-project (broader) grant. Managers may **never** grant or revoke a `manage`-bearing grant, and may never touch an admin user's grants. Upsert re-checks `canManageGrant` against both the new **and** existing scope sets (so overwriting to strip a broader grant is refused).
- **`mcp-wire` is deliberately NOT `use`.** `use` is the advisory "may act with this extension" verb; `mcp-wire` authorizes attaching an MCP extension, which spends an admin-installed credential the holder never sees. Folding the two together would have retro-authorized every existing grant, and since matching is NULL-covers-all a single wildcard `use` row would have covered **every** MCP server on the instance.
- **Enforcement points**: **MCP wiring and dispatch** (`src/auth/extension-wire-authz.ts` — an MCP-kind extension may be attached to a conversation, invoked via `POST /api/tool-invoke`, or attached through an agent config's `extensions[]` only by an admin, the row's `creatorUserId`, or an `mcp-wire` grant; a denial is reported as a MISS, never a 403, so installed MCP servers stay unenumerable — see [[permissions-and-grants]]), the github-projects web routes (`_shared.ts` `requireGithubScope` → 403 naming the missing scope, checked **after** the opaque 404 so existence never leaks), the extension-secrets route (`secrets` scope), the reverse-RPC handler (`github-projects-handler.ts`: approve/dismiss/rerun → `approve-runs`, poll-now/dashboard-data → `use`, ticket mutations → `write-tickets`; `dashboard-data` degrades to `{permissionDenied:true}` rather than erroring so the Hub renders), and the SDK broker `ctx.rbac.check(scope)` (tool-executor `ezcorp/rbac-check`, provenance-derived user + registry-resolved extension, never the wire). The daemon's own auto-spawn path is system-initiated (no user) and correctly bypasses.
- **Grants API + UI**: `GET/POST /api/rbac/extension-grants` + `DELETE /api/rbac/extension-grants/[id]` (delegation-gated, audit rows `RBAC_GRANTED` / `RBAC_REVOKED`), surfaced at the admin `/settings/permissions` page. Grant list visibility is scoped to the actor (admin: all; manager: their coverage; member: own).

## Usage

### RBAC enforcement (server-side, SvelteKit `+server.ts`)

```ts
import { requireAuth, requireRole, requireTeamRole } from "$server/auth/middleware";
import { requireScope, requireAdmin } from "$lib/server/security/api-keys";

requireAuth(locals);                       // 401 if unauthenticated
requireRole(locals, "admin");              // 403 unless instance admin (throws a Response)
const err = requireScope(locals, "chat");  // 403 Response | null (no-op for cookie auth)
const adminErr = requireAdmin(locals);     // 403 Response | null, role-based
await requireTeamRole(locals, teamId, "editor"); // team ladder; admins bypass (THROWS)
const gate = await checkProjectRole(locals, projectId, "member"); // AuthUser | Response
if (gate instanceof Response) return gate;                        // admins bypass
```

### Permission-mode API & UI

| Method & path | Scope | Purpose |
|---|---|---|
| `GET /api/projects/[id]/tool-permission-mode` | `read` + project `member` | Current stored mode (defaults to `yolo`). |
| `PUT /api/projects/[id]/tool-permission-mode` | **session-only** + `chat` + project `member` | Set mode (`{ mode, conversationId? }`); emits `tool:permission_mode_change` so an in-flight run picks it up live. A supplied `conversationId` must name a chat the CALLER OWNS inside THIS project — else `403`, and nothing is written. |
| `POST /api/tool-calls/[id]/permission` | `chat` | Approve/deny a pending gate (`{ approved, scope?, ttlOverrideMs? }`); ownership-checked; `scope:"forever"` admin-gated. |

- **The WRITE is session-only: no API key of any scope can move this dial.** `requireSessionAuth(locals)` runs on `PUT` (not on `GET`). The stored mode is not a capability, it is STANDING CONSENT — it pre-answers every future permission prompt in the project, for every member, until someone lowers it again. `POST /api/workflows/approvals/[id]` is session-only for the strictly weaker act of spending ONE approval ("a leaked key must not be able to spend one"), so the row that abolishes all of them cannot be looser. It also closes a self-escalation loop: a `chat`-scoped key runs the agent whose `shell` / `write` / `edit_file` calls this dial gates, so a key that could raise the mode could auto-approve its own tool calls — the gate asking the caller's permission to gate the caller. The `chat` scope check stays, and stays FIRST — a live gate, and defense in depth if the session check is ever edited out — but the registry entry declares `scope: "session"`, because `scope` renders as a bearer requirement and "call this with a chat key" is false for a route that refuses every key. No caller who could succeed can observe the `chat` check: every principal it refuses is refused one line later anyway. **`GET` is deliberately NOT session-gated** — an agent must be able to read the posture it runs under, and disclosure to a project member escalates nothing. Nothing shipped regressed: the only writer is `PermissionModeIndicator.svelte` (a cookie session), and the route is not `harness: { controllable: true }`.
- **Both mode verbs are membership-gated, and that is a fix, not a decoration.** They carried `requireAuth` + `requireScope` alone until 2026-08, and `requireScope` is a no-op for cookie sessions — so any principal that could reach the route could PUT `yolo` onto ANY project id and re-arm every run in it, and could push a `tool:permission_mode_change` into ANY conversation id, disabling the gate on a stranger's in-flight turn. The project half is `checkProjectRole(locals, params.id, "member")` in the route; the conversation half is in `handleSetPermissionMode`, which compares BOTH `conv.projectId` and `conv.userId` (admins bypass the owner half only) and refuses BEFORE the write so a denial leaves no mode change behind. Pinned by `src/__tests__/security/project-permission-mode-authz.test.ts`.
- **The READ is gated even though `GET /api/projects/:id` is not.** That asymmetry is deliberate on both sides: the project row stays instance-global because the LIST route is unfiltered, so hiding one project there would be theatre. The MODE is in no list, and it says whether a project's shell calls auto-run — reconnaissance for exactly the attack above. `GET /api/projects/:id/members` is the precedent: a project subresource gates where the project row does not. A denied read costs the UI nothing, since `PermissionModeIndicator` already falls back to `DEFAULT_PERMISSION_MODE` on any non-200.
- **The denial is `403`, not the sec-H3 `404` — and that is not an existence oracle.** A 404 hides *that an id exists*. Project ids are not secret: `GET /api/projects` is deliberately instance-global and unfiltered, so any authenticated caller enumerates every project id one request later. Answering `404` here would therefore be theatre AND a lie about a row the same caller may read, which is `checkProjectRole`'s own documented reasoning (`src/auth/middleware.ts`) and is pinned by the "reads stay instance-global" block in `src/__tests__/security/cross-tenant-deletion-projects-kb-modes.test.ts`. Use the `404` shape where the id genuinely is a secret (the sec-H3 routes, workflow traces, delegations); use `403` for projects. If the list route is ever filtered, revisit both together.
- **Per-turn override:** the chat send body (`POST /api/conversations/[id]/messages`) accepts an optional `permissionMode` (`z.enum(["ask","auto-edit","yolo"])`, `messages/schema.ts`) that wins over the stored project mode for that one turn. It is **ceiling-checked**: a principal that is not an interactive session may narrow the mode but never widen it past the project's effective mode (`checkPermissionModeCeiling`, `src/auth/permission-mode-ceiling.ts` → `403`). Both intake paths — the zod body schema and the multipart form parser — funnel through the one check. "Wider" is derived from `AUTO_APPROVE` by `widensPermissionMode`, never from a hand-written ladder. A project with no stored mode has a `yolo` ceiling (the default), so the check bites exactly the projects that deliberately tightened.
- **UI:** `ChatHeader.svelte` hosts the picker by rendering `PermissionModeIndicator.svelte`, which is itself both the colored dot (`ask`=red, `auto-edit`=yellow, `yolo`=green via `web/src/lib/permission-mode.ts`) and the dropdown that GET/PUTs `/api/projects/[id]/tool-permission-mode`; `PermissionGate.svelte` renders the inline approve/deny (and four-scope) card.

### Storage keys (settings KV)

- `project:${projectId}:tool_permission_mode` — the per-project mode.
- Always-allow grant rows + the `user:${id}:reapprove:lastTtl:${kind}` sticky TTL default (extension PDP side).
- `EZCORP_PERM_FOREVER_TTL_DAYS` — env override for the forever-grant TTL (default 90 days).

## Key files

- `src/auth/middleware.ts` — `requireAuth`, `requireRole(admin)`, `requireTeamRole(viewer|editor|owner)` (admins bypass team checks), `checkProjectRole(member|owner)` (admins bypass; returns the denial instead of throwing).
- `src/db/queries/project-members.ts` — `getProjectMembership`, `listProjectIdsForUser` (the set the workflow ladder authorizes against), `listProjectMembers`, `upsertProjectMember`, `removeProjectMember`, `countProjectMembers`.
- `web/src/routes/api/projects/[id]/members/+server.ts` + `.../[userId]/+server.ts` — the membership API (GET `member`, POST/DELETE `owner`, last-member 409).
- `src/auth/types.ts` — `AuthUser` / `JWTPayload`; the `role: "admin" | "member"` principal shape.
- `src/auth/api-key.ts` — `ApiKeyScope` union + `API_KEY_SCOPES` (`read`/`write`/`chat`/`extensions`/`admin`).
- `src/auth/extension-wire-authz.ts` — the conversation-wiring gate over `hasExtensionScope`: bundled → allow, non-MCP → allow, MCP → admin / creator / `use` grant, everything else → deny.
- `web/src/lib/server/security/api-keys.ts` — `requireScope` (no-op for cookie auth), `requireAdmin` (role-based), `verifyApiKey`.
- `web/src/lib/server/security/bearer-auth.ts` — API-key principals minted with `role: "member"`.
- `src/runtime/tools/permissions.ts` — `PermissionMode`, `DEFAULT_PERMISSION_MODE = "yolo"`, `AUTO_APPROVE` matrix, `needsApproval`, `widensPermissionMode` (the derived mode ordering), `getPermissionMode`, built-in `createPermissionGate` (+ `PermissionGateOptions`) + extension `createExtensionPermissionGate`, the shared `refuseIfNonInteractive`, `resolvePermission`, the `pendingApprovals` Map + sec-H2 `getPendingApprovalConversation`, and the gate-initiator scope (`runWithGateInitiator` / `getPendingApprovalInitiator`).
- `src/auth/principal-id.ts` — `principalId(locals)`: the comparable `session:` / `api-key:` / `internal:` identity a parked gate is confined to.
- `src/auth/permission-mode-ceiling.ts` — `checkPermissionModeCeiling`: refuses a per-turn `permissionMode` that widens the project's stored mode for a non-session principal.
- `src/auth/middleware.ts` — `isInteractiveSession`, the predicate half of `requireSessionAuth`'s allowlist, shared by both gates above.
- `src/runtime/tools/types.ts` — `ToolCategory = "read" | "write" | "execute" | "ez"`.
- `src/routes/tool-permission.ts` — `handleToolPermission` (ownership + `forever`-admin gate), `handleGetPermissionMode`, `handleSetPermissionMode`.
- `src/runtime/tools/permission-wrap.ts` — `withPermissionGate` + `PermissionWrapDeps`: the one gate wrapper, shared by the project file tools and every host-wired family.
- `src/runtime/stream-chat/setup-tools.ts` — builds `permissionDeps` once per turn and threads it to every wire; owns the `tool:permission_mode_change` subscription behind `getBusOverrideMode`.
- `src/extensions/permission-engine.ts` — the PDP: `authorize` (allow/deny/prompt), `resolvePrompt`, sensitive-cap gate, bundled-ceiling auto-allow, audit rows.
- `src/extensions/tool-executor/executor.ts` — consumes `createExtensionPermissionGate`; emits the extension `tool:permission_request` to the originating user only.
- `web/src/routes/api/projects/[id]/tool-permission-mode/+server.ts` — GET/PUT mode endpoints; both gate on `checkProjectRole(…, "member")`, and PUT additionally on `requireSessionAuth` (session-only write).
- `web/src/routes/api/tool-calls/[id]/permission/+server.ts` — POST gate resolution (requireAuth + requireScope("chat")).
- `web/src/lib/permission-mode.ts` — pure mode→label/color/description helpers + frontend `DEFAULT_PERMISSION_MODE`.
- `web/src/lib/components/tool-cards/PermissionGate.svelte` — inline approve/deny card; `isAdmin`-gated "Allow forever".
- `src/runtime/tools/validate.ts` — `validatePath`: **lexical** project-dir containment for built-in file tools (no realpath).
- `src/runtime/fs/scan-fs.ts` — `realpathInsideRoot`: realpath-based containment for the `@`-mention FS scanner (the asymmetry — see gotchas).
- `src/db/schema.ts` — `users.role` (`admin`/`member`), `team_members.role` (`owner`/`editor`/`viewer`), `project_members.role` (`owner`/`member`).

## Features it touches

- [[permissions-and-grants]] — the extension-capability PDP, four-scope always-allow modal, and grant lifecycle live there; permission modes only gate built-in tools.
- [[authentication]] — supplies the `AuthUser` principal (`role`) that every RBAC check reads.
- [[api-security]] — `requireScope`/`requireAdmin` are the API-key authorization axis; RBAC is enforced per-route at the HTTP boundary.
- [[developer-api-keys]] — API keys carry `ApiKeyScope`s and are minted with `role: "member"`, so they can never satisfy a `requireRole("admin")` gate.
- [[teams]] — `requireTeamRole` (owner/editor/viewer) gates team resources; instance admins bypass it.
- [[builtin-file-tools]] — the read/write/execute categories that permission modes auto-approve or gate; `validatePath` containment.
- [[streaming-runtime]] — permission gating wraps each built-in tool's `execute` during the streamed turn; the gate blocks the tool, not the stream.
- [[runs-lifecycle]] — a pending gate is a legitimate user-wait the watchdog must not kill; mode can change mid-run via the bus.
- [[admin-surfaces]] — admin-only pages (audit, moderation, dashboard, settings/admin) all sit behind `requireRole("admin")`.
- [[audit-and-observability]] — every PDP decision writes an `auditLog` row; the audit API is admin-gated.
- [[marketplace]] — flags/delete/install are admin-gated via `requireRole("admin")`.
- [[sandbox-and-isolation]] — extension sensitive-cap prompts (`shell`/`fs.write`) complement OS-level jail isolation.
- [[projects]] — permission mode is a per-project setting (`project:${id}:tool_permission_mode`).
- [[projects]] — `project_members` is the membership model these gates read; `checkProjectRole` is where it is enforced on the projects API.
- [[workflows]] — read/run/update/delete apply the per-resource ownership ladder over `workflow_definitions.user_id` + `visibility` (`src/runtime/workflow-scope.ts`) on top of the `chat` scope check. `system` is readable and runnable by anyone and editable by its OWNER or an admin — the `edit` rung asks ownership before it asks the tier, which is what makes the create route's `system` default usable by the non-admin who just created the row; `private` is owner-or-admin throughout. A NULL owner matches nobody either way, so both an ORPHANED private row and a legacy ownerless `system` row (owner deleted, `user_id` `SET NULL`, or never stamped) are admin-only rather than public. Since `project_members` landed, a `project` row that NAMES a project is read/run-restricted to that project's members plus admins (`readRunAudience(visibility, projectId)` → `project-members-and-admins`); one with a NULL `project_id` is unchanged and still admits every authenticated principal. Assigning `system` is a separate, admin-only question (`denyVisibilityAssignment`), so owner-edit is not a promotion path. The ladder compares `user.role === "admin"` directly rather than calling `checkRole`, which would also demand the `admin` API-key scope and so reject a cookie-authed admin on a `chat`-scoped route. A second owner column, `created_by`, briefly existed alongside it and is dropped — it read a NULL owner as "anyone may act", the exact inverse of the ladder.

## Related docs

- [The four-scope permission modal](../../permissions/four-scope-modal.md) — the extension always-allow scope picker (session/conversation/project/forever) and why "Always allow" is admin-gated.
- [Capability expiry](../../permissions/capability-expiry.md) — TTL aging of project/forever grants + the expired-grants banner.
- [Audit drill-down](../../permissions/audit-drilldown.md) — the per-extension audit + grants view.
- [Authentication](authentication.md) — how the `AuthUser` principal (and its role) is established.

## Notes & gotchas

- **`yolo` default is intentional and permanent.** `DEFAULT_PERMISSION_MODE = "yolo"` means a fresh project auto-approves read **and** write **and** execute built-in tools. This is a locked product decision — do not file it as a security finding.
- **A no-op scope check is not a gate — THREE routes learned this.** `/api/conversations/:id/extensions` and `/api/tool-invoke` both gated on the `extensions` scope alone; the latter also accepted `conversationId` as a label rather than as authorization input, so a member could dispatch any registered tool into an admin's conversation. `PUT /api/projects/:id/tool-permission-mode` was the third, and it repeated BOTH mistakes at once: `chat` scope as the only check, plus a `conversationId` read as a label. When a route's scope is its only non-ownership check, assume it is unguarded for browser users — and when it takes an id from the body, ask what authorizes THAT id, separately.
- **Ask whether the act is a CAPABILITY or a CONSENT before picking a gate.** A capability ("start a run", "read the mode") may be key-reachable; scope + ownership is the right ladder. A consent — anything that pre-answers a question a human is supposed to be asked — belongs behind `requireSessionAuth`, because a leaked key must not be able to spend it. The tell is self-reference: if the principal being gated could use the route to relax the gate on itself, it is a consent. So far: answering a workflow approval, minting/adjusting/revoking a delegation, minting a service account, and **setting the project tool-permission mode**. Since 2026-08 the registry can SAY it: those routes declare `scope: "session"` rather than nothing at all, so a consent surface is no longer indistinguishable from an entry whose author forgot a scope — see [`scope: "session"`](#scope-session--the-routes-no-key-can-call).
- **The old note, kept for the specific case:** Its `extensions` scope check passes for every cookie session, so before `extension-wire-authz.ts` the route's only real control was conversation ownership, and any member could wire an admin-installed MCP server (with the admin's stored credential) into their own chat. When a route's scope is its only non-ownership check, assume it is unguarded for browser users.
- **`requireScope` is a no-op for cookie auth.** `requireScope(locals, "admin")` *alone* allows any cookie-authed member through (because `locals.apiKeyScopes` is undefined). Admin routes must also call `requireRole("admin")` / `requireAdmin`. The route-contract meta-test enforces the pairing.
- **`requireRole` throws a raw `Response`.** SvelteKit doesn't auto-catch it, so an uncaught `requireRole` becomes a `500`. Routes wanting a clean `403` wrap it (`requireAdminOr403` pattern in `web/src/routes/api/extensions/[id]/+server.ts`).
- **Instance admins bypass `requireTeamRole`.** An `admin` is treated as having owner-level access to every team regardless of membership.
- **The gate is per-run for the watchdog.** `PendingPermissionInfo.runId` is set by the built-in wrapper and left UNSET by the extension tool executor and the workflow host. `WatchdogManager.deferralReason` matches on `runId` when present and on `conversationId` when absent — a conversation can host two concurrent runs, and a conversation-wide match let one run's open card suppress the other run's idle kill.
- **Two distinct gate mechanisms share one Map.** `createPermissionGate` (built-in, resolves `void`) and `createExtensionPermissionGate` (extension, resolves a structured `ApprovalResolution` with a scope) both live in `pendingApprovals` keyed by `toolCallId`/`promptId`. `resolvePermission` branches on the `extension` marker; built-in gates ignore `scope`/`ttlOverrideMs`.
- **Built-in gate ownership (sec-H2).** `POST /api/tool-calls/:id/permission` looks up the pending gate's owning conversation and refuses (`403`) unless the caller owns it or is an admin — fail-closed if the conversation can't load. The `forever` scope is *additionally* admin-gated server-side even though the button is client-side `isAdmin`-hidden.
- **A key answers only its OWN gates.** The ownership check above is about *whose data*; consent is about *who decides*. An API-key (or `internal`) principal may answer only a gate raised by a run its own request started — matched on `principalId`, so two keys of the SAME user are distinguishable and the admin-role bypass on the ownership check does not carry over. Cookie sessions are unchanged in both directions: a session may answer a key-started run's gate, because the human is the answerer the gate is parked for.
- **`apiKeyId` on locals is stamped with `authMethod`, never separately.** `bearer-auth.ts` sets the pair together for both the `ezk_` and `ezkint_` branches. `authMethod` alone cannot tell two keys apart; `apiKeyId` alone cannot tell a key from a session. `principalId` returns `undefined` rather than a partial id when either half is missing, and every consumer reads `undefined` as the DENY side.
- **Lexical vs. realpath path containment asymmetry.** Built-in file tools use `validatePath` (`src/runtime/tools/validate.ts`), which is purely **lexical** (`resolve` + `relative` string checks, no `realpath`). The `@`-mention FS scanner uses `realpathInsideRoot` (`src/runtime/fs/scan-fs.ts`), which resolves symlinks. A symlink inside the project that points outside it is filtered by the scanner but is **not** caught by `validatePath` — the built-in file tools' containment is symlink-naive.
- **Permission modes ≠ extension capabilities.** Permission modes only govern built-in `read`/`write`/`execute`/`ez` tools. Extension tools are gated solely by the PDP (`permission-engine.ts`); changing the project's permission mode has no effect on extension capability prompts.
- **FOUR role taxonomies, one column name.** `users.role` is `admin|member`; `team_members.role` is `owner|editor|viewer`; `project_members.role` is `owner|member`; `messages.role` is the chat role — all four are `text("role")` columns. Don't conflate them. `owner` means something different on a team than on a project, and `member` means something different on a project than on the instance. The API's role enum is generated from `PROJECT_MEMBER_ROLES` in `schema.ts` rather than hand-written for exactly this reason — posting `role: "viewer"` (a TEAM role) to the members route is a 400.
- **A project-scoped workflow is now confidential to its project.** `readRunAudience(visibility, projectId)` splits the `project` tier on the ROW's `project_id`: with one it is `project-members-and-admins`, without one it stays `any-authenticated-principal` (there is nothing to be a member of). The membership set travels on `WorkflowCaller.projectMemberships` and is **required**, never defaulted — an optional field would let a call site that never resolved memberships keep compiling while authorizing against an empty set. `NO_PROJECT_MEMBERSHIPS` is the named fail-closed value for the paths that provably cannot reach the read/run switch (`edit`, `denyVisibilityAssignment`). `caller.projectId` is still read by nothing: it comes off the request, so comparing it would be a boundary the caller controls.
