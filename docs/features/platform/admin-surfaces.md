# Admin Surfaces

> _The instance-operator control plane: dual-gated (`admin` scope + `admin` role) read-only telemetry APIs, user lifecycle management with agent-ownership transfer, marketplace moderation, and the dashboard / moderation / settings-admin UI that consumes them._

## Intent

Admin surfaces are the operator-facing layer of EZCorp: the routes and pages an instance admin uses to observe the running system (analytics, system health, sessions, errors, embed-index progress) and to act on it (deactivate users, revoke sessions, moderate marketplace listings). They are deliberately separated from **self-service** account routes (`/api/account/*`) that every authenticated user gets for their own profile/password/sessions. The defining property is the **dual gate** — every genuinely-privileged route checks both the API-key `admin` *scope* and the principal's `admin` *role*, because either check alone is bypassable (see [How it works](#how-it-works)).

## How it works

### The dual gate (the load-bearing invariant)

There are two orthogonal authorization axes, and admin routes must clear **both**:

- **`requireScope(locals, "admin")`** (`web/src/lib/server/security/api-keys.ts`) gates the *API-key scope*. Critically, it returns `null` (ALLOW) when `locals.apiKeyScopes` is `undefined` — i.e. for **any cookie session** — because scopes only exist on API-key principals. On its own it lets any logged-in *member* with a browser cookie through an "admin" route.
- **`requireRole(locals, "admin")`** (`src/auth/middleware.ts`) gates the *human role*. It throws a `403` `Response` unless `locals.user.role === "admin"`. API-key / internal principals are always minted with `role: "member"` in bearer-auth, so they can never satisfy this even if they hold the `admin` scope.

The canonical admin route therefore does:

```ts
const scopeErr = requireScope(locals, "admin");
if (scopeErr) return scopeErr;
try {
  requireRole(locals, "admin");     // throws a 403 Response on failure
  // ... handler ...
} catch (e) { if (e instanceof Response) return e; throw e; }
```

`requireAdmin(locals)` (in `api-keys.ts`) is an equivalent single-call shorthand that gates purely on role and returns a `403` Response.

This pairing is enforced statically by a **governance meta-test** (`web/src/__tests__/route-contract.test.ts`, `describe("admin-gate pairing")`): any `+server.ts` that matches `requireScope(_, "admin")` but neither `requireRole(_, "admin")` nor `requireAdmin(...)` fails the build, unless it is in a frozen `KNOWN_SCOPE_ONLY_ADMIN` allowlist of reviewed self-service writes (the `/api/account/*` routes, own developer keys, own team membership, and `extensions/[id]/violations` which uses an inline role check the regex can't see). The baseline cannot silently grow.

### Telemetry APIs (read-only)

The `/api/admin/*` routes are all GET-only reads (except `sessions` which adds a DELETE), each gated by the dual pattern above:

- **`/api/admin/system`** fans out three analytics queries (`getSystemHealth`, `getActivityFeed`, `getErrorSummary` from `src/db/queries/analytics.ts`) via `Promise.all` and returns `{ health, activityFeed, errorSummary }`. `health` carries `dbSizeBytes` (a DB-size SQL probe, `0` on failure), `uptimeSeconds` (`process.uptime()`), and `tableRowCounts` (per-table counts). `activityFeed` is the recent `audit_log` joined to `users`. `errorSummary` aggregates `error_logs` over 7 days.
- **`/api/admin/analytics?days=N`** (N clamped 1–365, default 30) returns chat activity, model usage, agent/extension/user stats, and a four-dimensional tool-usage breakdown (by tool / agent / user / model). It runs its **nine** aggregations **sequentially, not via `Promise.all`** — a deliberate fix: fanned out, a single request demands up to 11 pooled connections, and `Bun.sql`'s default pool (max 10) hits a hold-and-wait deadlock at N=2 concurrent requests that wedges the whole process. Sequential execution caps each request at one in-flight connection.
- **`/api/admin/sessions`** — `GET` lists all sessions (`listAllSessions`, optionally `?userId=` filtered) with the `tokenHash` projected away; `DELETE` revokes by `sessionId` (single) or `userId` (all of a user's), body validated by a Zod refine requiring at least one.
- **`/api/admin/errors?limit&offset`** (limit 1–500, default 100) returns paged `error_logs` rows + total count.
- **`/api/admin/embed-progress`** is thin glue over the shared `getEmbedProgress(db)` (the same source feeding the backfill CLI's `--status`): outbox backlog (pending/inProgress/failed/total) + coverage (eligible vs embedded messages).

### User management vs. self-service account

Two distinct surfaces, never conflated:

- **Admin user management** (`/api/users`, `/api/users/[id]`):
  - `GET /api/users` (dual-gated) lists all users with `passwordHash` stripped. **Opt-in pagination** (Settings v2 locked decision): with no `limit` param the legacy contract is preserved — full list as `{ users }` (TeamsSection and others depend on this); only an explicit `limit` branches to `listUsersPage({ limit, offset, q })` and returns `{ users, total }`. `parseNonNegInt` rejects non-canonical numerics (`1e2`, `0x10`, empty string) via a strict `/^\d+$/` guard; `limit` clamps to `MAX_LIMIT = 100`.
  - `PUT /api/users/[id]` (dual-gated) sets `status` to `active`/`inactive`. Two protections live here: **no self-deactivation** (`params.id === admin.id` → `400 "Cannot deactivate yourself"`), and **agent-ownership transfer** — deactivating a user reassigns all their `agentConfigs.userId` to the acting admin (so orphaned agents stay operable) and writes a `user:deactivated` audit entry.
- **Self-service account** (`/api/account/*`) — every authenticated user manages *their own* identity here. These gate on `requireScope(...)` + `requireAuth`, **not** `requireRole`. The scope is split by verb: **reads** gate on `requireScope("read")` (GET profile, GET sessions, login-history) and **writes** on `requireScope("admin")` (PUT profile, PUT password, DELETE sessions). In both cases the scope is only a write/read-gate for API-key principals — cookie sessions are allow-all there by design:
  - `GET/PUT /api/account` — read profile; update name (audit `auth:name_changed`) or email (requires `currentPassword` re-verification; audit `auth:email_changed`).
  - `PUT /api/account/password` — change password (verifies current, re-hashes, audit `auth:password_changed`). Keeps the caller's current session and cookie and revokes all of the user's other sessions.
  - `GET/DELETE /api/account/sessions` — list own sessions (flags `isCurrent` by hashing the cookie token); revoke a session, but **never the current one** (`400` — "use logout instead").
  - `GET /api/account/login-history` — own last 10 `auth:login` audit entries.

### Admin UI

Three Svelte surfaces consume the APIs above; all guard client-side by fetching `/api/auth/me` and redirecting non-admins (the server routes are the real gate — the client check is UX only):

- **`(app)/admin/dashboard`** — the four-tab dashboard (Overview / Usage / Activity / System). Each data source (`/api/admin/analytics`, `/system`, `/embed-progress`) settles **independently** in its own `.finally` with no shared `Promise.all` barrier, so a slow endpoint never blocks the other cards; a per-source inline "Retry" replaces an infinite skeleton on failure. Auto-refreshes every 30s (paused when the tab is hidden) with a live "Updated Ns ago" tick.
- **`(app)/admin/moderation`** — the marketplace flag queue. Lists pending flags (`GET /api/marketplace/flags`), and per flag: Dismiss / Remove Listing (`PATCH /api/marketplace/[id]/flags`) or hard Delete (`DELETE /api/marketplace/[id]/delete`). Has a server-side `+page.server.ts` guard (`load` redirects non-admins) in addition to the client check.
- **`(app)/settings/admin`** + **`(app)/settings/admin/audit`** — the settings-embedded admin panel: `UsersSection` (the activate/deactivate UI calling `/api/users/[id]`), `TeamsSection`, `InvitesSection`, `SecuritySettings`, `SystemHealth`, plus a link out to the dedicated audit log. Guarded by the client `requireAdmin()` helper (`web/src/lib/admin-guard.ts`).

The settings nav (`web/src/lib/settings-nav.ts`) marks admin entries `adminOnly: true`; `visibleNavItems(isAdmin)` filters them out for members. Settings v2 *additively* surfaced the canonical `/admin/dashboard` (as "System") and `/admin/moderation` pages as child links in the settings nav — they link out, the routes themselves are untouched.

## Usage

### REST API

| Method & path | Gate | Purpose |
|---|---|---|
| `GET /api/admin/system` | scope `admin` + role `admin` | DB size, uptime, table row counts, activity feed, 7-day error summary. |
| `GET /api/admin/analytics?days=N` | scope + role | Chat/model/agent/extension/user stats + 4-axis tool usage (sequential queries). |
| `GET /api/admin/sessions?userId=` | scope + role | List all sessions (`tokenHash` stripped). |
| `DELETE /api/admin/sessions` | scope + role | Revoke by `sessionId` or all of `userId`. |
| `GET /api/admin/errors?limit&offset` | scope + role | Paged error logs + total. |
| `GET /api/admin/embed-progress` | scope + role | Embed-outbox backlog + coverage. |
| `GET /api/users?limit&offset&q` | scope + role | List users (opt-in paged; full list when no `limit`). |
| `PUT /api/users/[id]` | scope + role | Activate/deactivate; transfers agent ownership; blocks self-deactivation. |
| `GET /api/marketplace/flags` | scope + role | Pending moderation flag queue. |
| `PATCH /api/marketplace/[id]/flags` | scope + role | Resolve a flag (dismiss / remove listing). |
| `DELETE /api/marketplace/[id]/delete` | scope + role | Hard-delete a listing. |
| `GET /api/account` | scope `read` + auth | Read own profile. |
| `PUT /api/account` | scope `admin` + auth | Update own name / email (email needs current password). |
| `PUT /api/account/password` | scope `admin` + auth | Change own password (keeps this session, revokes the others). |
| `GET /api/account/sessions` | scope `read` + auth | List own sessions (flags `isCurrent`). |
| `DELETE /api/account/sessions` | scope `admin` + auth | Revoke own session (not the current one). |
| `GET /api/account/login-history` | scope `read` + auth | Own last 10 logins. |

### UI entry points

- `/admin/dashboard` — operator telemetry dashboard (4 tabs, auto-refresh).
- `/admin/moderation` — marketplace flag queue.
- `/settings/admin` — user/team/invite management + security + health; `/settings/admin/audit` — dedicated audit log.
- The admin/audit/system/moderation nav entries appear in `/settings` only for admins.

## Key files

- `web/src/routes/api/admin/system/+server.ts` — health + activity + error-summary aggregation; dual-gate exemplar.
- `web/src/routes/api/admin/analytics/+server.ts` — 9 sequential analytics aggregations (pool-deadlock fix); 4-axis tool usage.
- `web/src/routes/api/admin/sessions/+server.ts` — list all sessions (GET) + revoke by session/user (DELETE).
- `web/src/routes/api/admin/errors/+server.ts` — paged error logs.
- `web/src/routes/api/admin/embed-progress/+server.ts` — embed-outbox backlog + coverage (shared `getEmbedProgress`).
- `web/src/routes/api/users/+server.ts` — admin user list with opt-in pagination + strict numeric parsing.
- `web/src/routes/api/users/[id]/+server.ts` — activate/deactivate; agent-ownership transfer; no self-deactivation; audit.
- `web/src/routes/api/account/+server.ts` — self-service profile read/update (email re-verification).
- `web/src/routes/api/account/password/+server.ts` — self-service password change (keeps this session, revokes the others).
- `web/src/routes/api/account/sessions/+server.ts` — self-service session list/revoke (can't revoke current).
- `web/src/routes/api/account/login-history/+server.ts` — own recent logins.
- `web/src/routes/(app)/admin/dashboard/+page.svelte` — per-source-independent telemetry dashboard.
- `web/src/routes/(app)/admin/moderation/+page.svelte` + `+page.server.ts` — flag queue UI + server-side admin redirect.
- `web/src/routes/(app)/settings/admin/+page.svelte` — settings-embedded admin panel (Users/Teams/Invites/Security/Health).
- `web/src/routes/(app)/settings/admin/audit/+page.svelte` — dedicated audit-log page.
- `web/src/lib/components/settings/UsersSection.svelte` — activate/deactivate UI hitting `/api/users/[id]`.
- `web/src/lib/admin-guard.ts` — client `requireAdmin()` (resolves `/api/auth/me`, returns admin user or null).
- `web/src/lib/settings-nav.ts` — `adminOnly` nav flags + `visibleNavItems(isAdmin)` filter.
- `src/auth/middleware.ts` — `requireAuth` / `requireRole` (role axis).
- `web/src/lib/server/security/api-keys.ts` — `requireScope` / `requireAdmin` (scope axis).
- `web/src/__tests__/route-contract.test.ts` — meta-test enforcing the scope+role dual gate (and registry/test-surface contracts).
- `src/db/queries/analytics.ts` — `getSystemHealth`, `getActivityFeed`, `getErrorSummary`, and the analytics aggregations.

## Features it touches

- [[authentication]] — `requireAuth` and `locals.user` (populated in `hooks.server.ts`) are the substrate all admin gates build on.
- [[rbac-and-permission-modes]] — the `admin` *role* axis (`requireRole`/`requireAdmin`) is the RBAC half of the dual gate.
- [[api-security]] — the `admin` *scope* axis (`requireScope`) and the route-contract meta-test that pairs the two.
- [[developer-api-keys]] — API-key principals carry scopes but are role-`member`, so they can hold `admin` scope yet never pass `requireRole`.
- [[audit-and-observability]] — admin telemetry reads the audit log + error logs; admin actions (deactivate, name/email/password change) write audit entries.
- [[settings-system]] — the admin panel lives under `/settings/admin`; `settings-nav` hides admin entries from members.
- [[marketplace]] — the moderation surface acts on marketplace flags and listings.
- [[agents]] — deactivating a user transfers their agent-config ownership to the acting admin.
- [[remote-testability]] — the same route-contract meta-test polices the test-surface gating and the api-registry mirror.
- [[knowledge-base]] — the embed-progress card reports the message-embedding outbox/coverage that powers semantic search.

## Related docs

- [api-security](./api-security.md) — the scope axis and how routes are gated.
- [rbac-and-permission-modes](./rbac-and-permission-modes.md) — the role axis and RBAC model.
- [authentication](./authentication.md) — session/principal establishment feeding `locals`.
- [developer-api-keys](./developer-api-keys.md) — scopes on API-key principals.
- `docs/harness-contract.md` — the route-contract governance the meta-test enforces.

## Notes & gotchas

- **`requireScope("admin")` alone is allow-all for cookie sessions.** It only gates API-key principals (`locals.apiKeyScopes` is `undefined` for cookies). A genuinely-privileged route MUST also call `requireRole(locals, "admin")` or `requireAdmin(locals)`. The `route-contract.test.ts` admin-gate scan fails the build on any new offender; the frozen `KNOWN_SCOPE_ONLY_ADMIN` allowlist is exactly the reviewed self-service writes (`/api/account/*`, own developer keys, own team membership, `extensions/[id]/violations`) where cookie allow-all is intentional and `requireRole(admin)` would lock members out of their own data — do not add to it without justification.
- **Self-service ≠ admin.** `/api/account/*` lets every user manage *their own* identity (the `admin` scope there is a write-gate for API-key callers, not a role gate). Don't confuse it with `/api/users/*`, which is true admin user management.
- **No self-deactivation.** `PUT /api/users/[id]` with `status:"inactive"` and `params.id === admin.id` returns `400`. Deactivation also transfers all of the target's `agentConfigs.userId` to the acting admin — a side effect outside the obvious "set status" contract.
- **Opt-in pagination is a contract, not a default.** `GET /api/users` with *no* `limit` returns the full unpaged `{ users }` list (TeamsSection and others depend on this); only an explicit `limit` switches to `{ users, total }`. Numeric params use a strict `/^\d+$/` guard, not `Number()`, to reject `1e2`/`0x10`/empty-string.
- **`/api/admin/analytics` runs queries sequentially on purpose.** Fanning the 9 aggregations out with `Promise.all` over-subscribes `Bun.sql`'s default 10-connection pool at just 2 concurrent requests and deadlocks the entire process (every endpoint shares the pool). The sequential rewrite is the fix — do not "optimize" it back to `Promise.all`.
- **Dashboard cards settle independently.** Each data source flips only its own loading/error flags; there is no shared `Promise.all` barrier, so a hanging endpoint never blanks the whole page. `lastUpdated` advances as soon as the first source resolves.
- **Client admin checks are UX, not security.** The dashboard/moderation/settings pages fetch `/api/auth/me` and `goto("/")` for non-admins, but the server routes are the enforcing boundary; moderation additionally has a `+page.server.ts` `load` redirect.
- **`tokenHash` is always stripped.** Both `/api/admin/sessions` and `/api/account/sessions` project the session `tokenHash` away before returning; admin user lists strip `passwordHash`.
