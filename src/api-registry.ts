/**
 * API Registry - describes all API routes for auto-generated documentation.
 *
 * Schemas are NOT imported here to avoid cross-workspace Zod instance issues.
 * The docs endpoint (web/src/routes/api/docs/+server.ts) maps schemas at serve time.
 */

// Type-only, deliberately: `ApiRouteScope` derives the session literal with
// `typeof SESSION_ROUTE_SCOPE`, which is a TYPE position, so nothing here
// needs `api-key.ts` at runtime. One spelling of the value, zero runtime
// coupling — this file is imported by the docs route, the CLI and the OpenAPI
// builder, and none of them should load a crypto module to read a union.
import type { SESSION_ROUTE_SCOPE, ApiKeyScope } from "./auth/api-key";

/**
 * What authorizes a call to this route.
 *
 * Three kinds of value, and only the first is an API-KEY scope:
 *
 *  - an {@link ApiKeyScope} — "call this with a key holding that scope".
 *    Renders as `security: [{ bearerAuth: [scope] }]` (`src/openapi.ts`).
 *  - `"public"` — no authentication at all.
 *  - `"session"` ({@link SESSION_ROUTE_SCOPE}) — SESSION-ONLY: authorization
 *    is by INTERACTIVE BROWSER SESSION, and **no API key can call the route
 *    regardless of the key's scopes** (`requireSessionAuth` answers every key
 *    with a 403). It is NOT a scope anyone can hold: it cannot be minted onto
 *    a key, it may not appear in a key's `routeAllowlist`
 *    (`validateToolPolicy` refuses one), and it never renders as a bearer
 *    requirement.
 *
 * A consumer that reads `scope` as "the key scope to mint" must therefore
 * handle `"session"` (and `"public"`) FIRST — the union is not a key scope.
 *
 * Optional today (not yet backfilled across all entries); NEW entries should
 * declare it — the OpenAPI builder surfaces it and the route-contract
 * meta-test ratchets the remaining gap down.
 */
export type ApiRouteScope = ApiKeyScope | "public" | typeof SESSION_ROUTE_SCOPE;

export interface ApiRouteEntry {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  category: string;
  /** What authorizes a call: an API-key scope, `"public"`, or `"session"`
   *  (session-only — no key of any scope). See {@link ApiRouteScope}. */
  scope?: ApiRouteScope;
  /** Remote-control metadata. `controllable: true` marks a route an external
   *  harness is expected to be able to drive (and the harness client should
   *  cover). See docs/harness-contract.md. */
  harness?: { controllable?: boolean };
  /** Schema key used by docs endpoint to resolve the Zod schema */
  schemaKey?: string;
  responseDescription?: string;
}

export const apiRegistry: ApiRouteEntry[] = [
  // Factory authoring, scoped to C01's authority table. Version publish is a
  // `write` row gated by the project `factory.publish` grant, grant management
  // is an `admin` row gated by the tenant-administrator role, and the trust,
  // consent, and approval rows stay session-only because C01 requires an actual
  // human session for each of them. Package install and quarantine is the one
  // C01 row with no route: it needs W02's package lifecycle before it can be
  // registered against a handler that enforces anything.
  { method: "GET", path: "/api/factories/projects/:projectId/definitions", description: "List current project factory drafts with trusted resource availability", category: "factories", scope: "read", harness: { controllable: true } },
  { method: "POST", path: "/api/factories/projects/:projectId/definitions", description: "Create revision 1 of a factory draft", category: "factories", scope: "write", harness: { controllable: true } },
  { method: "POST", path: "/api/factories/projects/:projectId/definitions/import", description: "Import canonical JSON or supported YAML as revision 1", category: "factories", scope: "write", harness: { controllable: true } },
  { method: "GET", path: "/api/factories/projects/:projectId/definitions/:factoryId", description: "Read one current project factory draft", category: "factories", scope: "read", harness: { controllable: true } },
  { method: "PUT", path: "/api/factories/projects/:projectId/definitions/:factoryId", description: "Save a factory draft at an exact revision", category: "factories", scope: "write", harness: { controllable: true } },
  { method: "DELETE", path: "/api/factories/projects/:projectId/definitions/:factoryId", description: "Archive a factory draft at an exact revision", category: "factories", scope: "write", harness: { controllable: true } },
  { method: "GET", path: "/api/factories/projects/:projectId/definitions/:factoryId/export", description: "Export a factory draft as canonical JSON or JSON-subset YAML", category: "factories", scope: "read", harness: { controllable: true } },
  { method: "POST", path: "/api/factories/projects/:projectId/definitions/:factoryId/validate", description: "Validate unsaved factory source with author authority", category: "factories", scope: "write", harness: { controllable: true } },
  { method: "GET", path: "/api/factories/projects/:projectId/definitions/:factoryId/versions", description: "List immutable published factory versions", category: "factories", scope: "read", harness: { controllable: true } },
  { method: "POST", path: "/api/factories/projects/:projectId/definitions/:factoryId/versions", description: "Publish an exact pinned draft revision under the project factory.publish grant", category: "factories", scope: "write" },
  { method: "GET", path: "/api/factories/projects/:projectId/definitions/:factoryId/versions/:version", description: "Read and verify one immutable factory version", category: "factories", scope: "read", harness: { controllable: true } },
  { method: "POST", path: "/api/factories/projects/:projectId/definitions/:factoryId/runs", description: "Queue a run from a pinned factory version and input", category: "factories", scope: "chat", harness: { controllable: true } },
  { method: "GET", path: "/api/factories/projects/:projectId/runs", description: "List bounded current project run summaries", category: "factories", scope: "read", harness: { controllable: true } },
  { method: "GET", path: "/api/factories/projects/:projectId/runs/:runId", description: "Read canonical factory run status", category: "factories", scope: "read", harness: { controllable: true } },
  { method: "POST", path: "/api/factories/projects/:projectId/runs/:runId/control", description: "Queue an authorized factory run control request", category: "factories", scope: "chat", harness: { controllable: true } },
  { method: "GET", path: "/api/factories/projects/:projectId/runs/:runId/commands/:commandId", description: "Read the durable dispatch state of a scoped run command", category: "factories", scope: "read", harness: { controllable: true } },
  { method: "GET", path: "/api/factories/projects/:projectId/grants", description: "List current project factory grants and revocations", category: "factories", scope: "read", harness: { controllable: true } },
  { method: "PUT", path: "/api/factories/projects/:projectId/grants/:principalKind/:principalId/:action", description: "Issue or replace an exact project factory grant as a tenant administrator", category: "factories", scope: "admin" },
  { method: "DELETE", path: "/api/factories/projects/:projectId/grants/:principalKind/:principalId/:action", description: "Revoke an exact project factory grant as a tenant administrator", category: "factories", scope: "admin" },
  { method: "POST", path: "/api/factories/projects/:projectId/service-accounts/:serviceAccountId/credentials", description: "Issue one short-lived project factory service credential from an interactive tenant-admin session", category: "factories", scope: "session" },
  { method: "DELETE", path: "/api/factories/projects/:projectId/service-accounts/:serviceAccountId/credentials/:credentialId", description: "Revoke one project factory service credential from an interactive tenant-admin session", category: "factories", scope: "session" },
  { method: "PUT", path: "/api/factories/projects/:projectId/release/trust", description: "Publish an exact trusted release package and validator lock from an interactive human session", category: "factories", scope: "session" },
  { method: "DELETE", path: "/api/factories/projects/:projectId/release/trust", description: "Revoke the current release trust revision from an interactive human session", category: "factories", scope: "session" },
  { method: "PUT", path: "/api/factories/projects/:projectId/release/control", description: "Enable or disable protected release at an exact control epoch from an interactive human session", category: "factories", scope: "session" },
  { method: "PUT", path: "/api/factories/projects/:projectId/release/contracts/:contractId", description: "Approve the next sealed acceptance contract revision from an interactive human session", category: "factories", scope: "session" },
  { method: "POST", path: "/api/factories/projects/:projectId/releases", description: "Prepare one exact accepted candidate release and verify its recovery archive", category: "factories", scope: "chat" },
  { method: "GET", path: "/api/factories/projects/:projectId/releases/:operationId", description: "Read a sanitized release operation after current project authorization", category: "factories", scope: "chat" },
  { method: "POST", path: "/api/factories/projects/:projectId/releases/:operationId/approvals", description: "Request human approval for the exact pending release generation", category: "factories", scope: "session" },
  { method: "PUT", path: "/api/factories/projects/:projectId/release/approvals/:approvalId", description: "Approve or deny an exact release context from an interactive human session", category: "factories", scope: "session" },
  { method: "GET", path: "/api/factories/projects/:projectId/release/notifications", description: "List delivered release approvals, uncertain outcomes, and completion receipts under current human authority", category: "factories", scope: "session" },
  { method: "PUT", path: "/api/factories/projects/:projectId/runs/:runId/approvals/:approvalId", description: "Answer the exact current generic factory approval command", category: "factories", scope: "session" },
  { method: "PUT", path: "/api/factories/projects/:projectId/release/policies/:policyId", description: "Create a bounded automatic release policy from an interactive human session", category: "factories", scope: "session" },
  { method: "DELETE", path: "/api/factories/projects/:projectId/release/policies/:policyId", description: "Revoke an exact automatic release policy revision from an interactive human session", category: "factories", scope: "session" },
  { method: "POST", path: "/api/factories/projects/:projectId/releases/:operationId/reconciliations", description: "Reconcile an uncertain release with operator reason and provider evidence", category: "factories", scope: "write" },
  { method: "GET", path: "/api/factories/projects/:projectId/runs/:runId/inspection", description: "Read one bounded run snapshot: nested runs, attempts, blockers, costs, artifacts, acceptance reasons, releases, and its event cursor", category: "factories", scope: "read" },
  { method: "GET", path: "/api/factories/projects/:projectId/runs/:runId/events", description: "Stream a run's contiguous committed events from a signed snapshot cursor, rechecking read authority per batch", category: "factories", scope: "read" },
  { method: "POST", path: "/api/factories/projects/:projectId/runs/:runId/artifacts/:artifactId/ticket", description: "Mint a one-minute download ticket for one run artifact and the calling principal", category: "factories", scope: "read" },
  { method: "GET", path: "/api/factories/projects/:projectId/runs/:runId/artifacts/:artifactId/download", description: "Download one run artifact's exact bytes as an attachment under a current ticket", category: "factories", scope: "read" },
  { method: "POST", path: "/api/factories/projects/:projectId/runs/:runId/artifacts/:artifactId/shares", description: "Grant another project a read of one artifact's exact bytes from an interactive human session", category: "factories", scope: "session" },
  { method: "DELETE", path: "/api/factories/projects/:projectId/runs/:runId/artifacts/:artifactId/shares/:targetProjectId", description: "Revoke one cross-project artifact read from an interactive human session", category: "factories", scope: "session" },
  { method: "GET", path: "/api/factories/tenants/:tenantId/restores", description: "List the tenant's restore epochs and their recovery reports (findings without raw detail, blocked checks, blocked runs), from an interactive tenant-administrator session", category: "factories", scope: "session" },
  { method: "POST", path: "/api/factories/tenants/:tenantId/restores/:restoreId/signatures", description: "Sign one recovery report by its digest from an interactive tenant-administrator session. The console refuses a report that no longer matches its stored digest; W15's restore then records the signature, moves unblocked runs to the new epoch, and reopens service", category: "factories", scope: "session" },
  { method: "GET", path: "/api/factories/projects/:projectId/validator-materials", description: "Read the registered validator material a published version (?factoryId&factoryVersion) or a validator lock (?validatorLockDigest) names: the contract a release approval pins, without validator runtimes", category: "factories", scope: "read" },
  { method: "GET", path: "/api/factories/projects/:projectId/shared-artifacts/:artifactId", description: "Read the exact bytes another project shared into this one", category: "factories", scope: "read" },
  { method: "GET", path: "/api/factories/projects/:projectId/packages", description: "List the project's bound runner packages and their current trust state", category: "factories", scope: "read" },
  { method: "POST", path: "/api/factories/projects/:projectId/packages", description: "Bind an installed v4 runner release to the project from an interactive tenant-administrator session", category: "factories", scope: "session" },
  { method: "POST", path: "/api/factories/projects/:projectId/packages/:referenceId/trust", description: "Publish, quarantine, or revoke a runner package at its exact trust revision from an interactive tenant-administrator session", category: "factories", scope: "session" },
  { method: "GET", path: "/api/factories/projects/:projectId/packages/:referenceId/impact", description: "Preview the live runs a runner package trust transition would reach", category: "factories", scope: "read" },
  { method: "GET", path: "/api/factories/projects/:projectId/packages/:referenceId/affected-runs", description: "Read the attempts a runner package quarantine or revocation reached and what the fence did (?trustRevision&limit&cursor)", category: "factories", scope: "read" },
  { method: "GET", path: "/api/factories/tenants/:tenantId/purge-preview", description: "Preview the closing preconditions and audit loss of a tenant purge from an interactive tenant-administrator session", category: "factories", scope: "session" },
  { method: "POST", path: "/api/factories/tenants/:tenantId/purge-requests", description: "Record an auditable tenant purge request from an interactive tenant-administrator session; it deletes nothing", category: "factories", scope: "session" },
  { method: "GET", path: "/api/github/connection", description: "Read the current user's personal GitHub connection status", category: "github", scope: "session" },
  { method: "DELETE", path: "/api/github/connection", description: "Disconnect the current user's GitHub account and invalidate pending authority", category: "github", scope: "session" },
  { method: "POST", path: "/api/github/authorize", description: "Start GitHub authorization bound to the current browser session", category: "github", scope: "session" },
  { method: "POST", path: "/api/github/device/start", description: "Start GitHub device authorization for the current user and browser session", category: "github", scope: "session" },
  { method: "POST", path: "/api/github/device/poll", description: "Check the current browser session's GitHub device authorization attempt", category: "github", scope: "session" },
  { method: "POST", path: "/api/github/device/cancel", description: "Cancel the current browser session's GitHub device authorization attempt", category: "github", scope: "session" },
  { method: "GET", path: "/api/github/callback", description: "Complete one GitHub authorization attempt for the same browser session", category: "github", scope: "session" },
  { method: "GET", path: "/api/github/repositories", description: "List repositories available to the current user's GitHub App connection", category: "github", scope: "session" },
  { method: "GET", path: "/api/github/repositories/check", description: "Check personal GitHub repository access and installation readiness", category: "github", scope: "session" },
  { method: "POST", path: "/api/github/sandboxes", description: "Admit a private personal repository sandbox awaiting import", category: "github", scope: "session" },
  { method: "GET", path: "/api/github/personal-prs/runs/:runId", description: "Read the owner's sandbox run publication state", category: "github", scope: "session" },
  { method: "POST", path: "/api/github/personal-prs/runs/:runId/prepare", description: "Freeze the owner's completed sandbox run for pull request review", category: "github", scope: "session" },
  { method: "GET", path: "/api/github/personal-prs/proposals/:id", description: "Read the owner's exact personal pull request proposal", category: "github", scope: "session" },
  { method: "POST", path: "/api/github/personal-prs/proposals/:id/confirm", description: "Confirm the owner's unchanged personal draft pull request proposal", category: "github", scope: "session" },
  { method: "POST", path: "/api/github/personal-prs/sandboxes/:projectId/import", description: "Import an approved GitHub repository into the owner's new private sandbox", category: "github", scope: "session" },
  { method: "POST", path: "/api/__test/project-proposal", description: "Seed a controlled project review fixture only when the test surface is enabled", category: "extensions", scope: "session" },
  { method: "POST", path: "/api/__test/marketplace-release", description: "Seed marketplace source from an existing owned verified release only when the test surface is enabled", category: "extensions", scope: "session" },
  { method: "POST", path: "/api/extensions/import-source", description: "Import bounded extension source into an isolated lifecycle build", category: "extensions", scope: "session" },
  { method: "POST", path: "/api/extensions/control", description: "Manage versioned extension workspaces, builds and releases", category: "extensions", scope: "extensions", harness: { controllable: true } },
  { method: "POST", path: "/api/extensions/releases/:installationId/approve", description: "Approve or reject an exact extension release from a human session", category: "extensions", scope: "session" },
  { method: "POST", path: "/api/extensions/releases/:installationId/project", description: "Bind or revoke project access for the exact active release from its owner's human session", category: "extensions", scope: "session" },
  { method: "GET", path: "/api/extensions/:name/preview", description: "Read an opaque-origin browser bundle for an exact active release and owned conversation", category: "extensions", scope: "session" },
  { method: "POST", path: "/api/extensions/:name/preview", description: "Invoke only the declared browser tools for an exact release and owned conversation", category: "extensions", scope: "session" },
  // Auth
  { method: "POST", path: "/api/auth/login", description: "Authenticate user and create session", category: "auth", scope: "public", schemaKey: "loginSchema" },
  { method: "POST", path: "/api/auth/logout", description: "End current session", category: "auth" },
  { method: "GET", path: "/api/auth/me", description: "Get current authenticated user", category: "auth", responseDescription: "User object with id, name, email, role" },
  { method: "POST", path: "/api/auth/setup", description: "Initial admin setup (first-run only)", category: "auth", schemaKey: "setupSchema" },
  // C12 step 7: the provisioned installation's human bootstrap. The status is
  // public and names only a state and an invitation; consent is session-only.
  { method: "GET", path: "/api/installation/bootstrap/status", description: "Where the installation's first-administrator bootstrap stands (state and invitation only)", category: "auth", scope: "public", responseDescription: "{ state, invitationId }" },
  { method: "POST", path: "/api/installation/bootstrap", description: "Explicit bootstrap consent by the first administrator (human session only)", category: "auth", scope: "session", responseDescription: "{ state, consentDigest, grants }" },
  { method: "POST", path: "/api/installation/purge-approval", description: "An administrator's approval to purge this provisioned installation after teardown (human session only)", category: "auth", scope: "session", responseDescription: "{ approvalId, expiresAtMs }" },
  // F5 moved the BARE `/api/auth/invite` path out of the hooks PUBLIC_PATHS
  // allowlist into PUBLIC_SUBPATHS_ONLY (web/src/hooks.server.ts:397), so both
  // methods are now genuinely reachable by an authenticated admin — before
  // that, `locals.user` was never populated on a public path and the role gate
  // denied every caller (a broken feature, failing closed).
  // F6 then closed the KEY axis: both gate on `checkRole(locals,"admin")`,
  // which demands the admin ROLE *and* — for a key principal — the `admin`
  // SCOPE. Minting an invite carries a `role`, so a nominally read-only
  // admin-role key could otherwise hand out an ADMIN invite.
  { method: "POST", path: "/api/auth/invite", description: "Create user invitation link (admin role + admin scope)", category: "auth", scope: "admin", schemaKey: "createInviteSchema" },
  { method: "GET", path: "/api/auth/invite", description: "List outstanding user invitations (admin role + admin scope)", category: "auth", scope: "admin", responseDescription: "{ invites }" },
  { method: "POST", path: "/api/auth/invite/:token", description: "Accept invitation and create account", category: "auth" },
  // Had the SAME defect F5 fixed for invite, and is fixed the same way:
  // the bare path moved from PUBLIC_PATHS to PUBLIC_SUBPATHS_ONLY, so
  // `locals.user` is populated and `requireRole(locals,"admin")` can finally
  // pass. Before that this route — and the "Generate reset link" button in
  // UsersSection.svelte that calls it — 401'd every caller, admins included.
  // Only `/:token` (the locked-out user redeeming an emailed token) is
  // anonymous. Still no `requireScope`, hence no scope declared.
  { method: "POST", path: "/api/auth/reset-password", description: "Generate password reset token (admin). Gate: requireRole(locals,\"admin\") only — no API-key scope gate", category: "auth", schemaKey: "generateResetSchema" },
  { method: "POST", path: "/api/auth/reset-password/:token", description: "Consume reset token and set new password", category: "auth", schemaKey: "consumeResetSchema" },
  // Not a user "login" flow despite the path: this begins the INSTANCE
  // provider BYOK-over-OAuth handshake, writes the `oauth:pending:<state>`
  // PKCE row and binds the loopback callback port. Gated on the same two axes
  // as the callback that completes it, so a member is refused HERE rather
  // than after being walked through a provider consent screen.
  { method: "GET", path: "/api/auth/oauth", description: "Begin the provider OAuth (PKCE) handshake for openai|google and stash the pending state. Gate: admin role + admin scope", category: "auth", scope: "admin" },
  // `GET /api/auth/oauth/callback` used to be registered here and does not
  // exist — the handler on disk exports POST and DELETE only. It was carried
  // in route-contract.test.ts's now-retired KNOWN_STALE set for exactly that
  // reason; with that set gone the phantom entry has to go too.
  //
  // The OTHER door to the instance LLM credential. POST/DELETE here write and
  // remove `provider:oauth:<provider>`, which `src/providers/credentials.ts`
  // resolves for every user's turns — the same room `provider:apiKey:*` (and
  // therefore `POST`/`DELETE /api/providers`) lives in. Both were gated on
  // `requireAuth` alone until sec-F2/#86, so any authenticated member could
  // redirect or delete the organisation's provider credential. Both are now
  // gated on BOTH axes, exactly as /api/providers is: `requireAdmin(locals)`
  // for the role and `requireScope(locals,"admin")` for the API-key scope.
  { method: "POST", path: "/api/auth/oauth/callback", description: "Exchange an OAuth authorization code (PKCE) and store the INSTANCE provider credential at provider:oauth:<provider>, encrypted. Gate: admin role + admin scope", category: "auth", scope: "admin" },
  { method: "DELETE", path: "/api/auth/oauth/callback", description: "Disconnect a provider by deleting the instance credential at provider:oauth:<provider>. Gate: admin role + admin scope", category: "auth", scope: "admin" },

  // Account
  { method: "GET", path: "/api/account", description: "Get current user account details", category: "account" },
  { method: "PUT", path: "/api/account", description: "Update account name or email", category: "account" },
  { method: "PUT", path: "/api/account/password", description: "Change account password", category: "account" },
  { method: "GET", path: "/api/account/sessions", description: "List the caller's OWN active sessions with the current one flagged", category: "account", scope: "read", responseDescription: "{ sessions: [{ id, userAgent, ipAddress, lastActiveAt, createdAt, isCurrent }] }" },
  // Self-service revoke: the `admin` SCOPE is a key write-gate, and the row is
  // re-checked against the caller's own session list (404 otherwise) — hence
  // no role check, and hence this file's presence in
  // route-contract.test.ts's KNOWN_SCOPE_ONLY_ADMIN list.
  { method: "DELETE", path: "/api/account/sessions", description: "Revoke one of the caller's OWN sessions by { sessionId } — 404 for a session the caller does not own, 400 for the current session (log out instead)", category: "account", scope: "admin", responseDescription: "{ success: true }" },
  { method: "GET", path: "/api/account/login-history", description: "The caller's last 10 `auth:login` audit entries", category: "account", scope: "read", responseDescription: "{ entries }" },

  // Conversations
  { method: "GET", path: "/api/conversations", description: "List conversations for active project", category: "conversations", responseDescription: "Array of conversation objects" },
  { method: "POST", path: "/api/conversations", description: "Create a new conversation", category: "conversations", scope: "chat", harness: { controllable: true }, schemaKey: "createConversationSchema" },
  { method: "GET", path: "/api/conversations/:id", description: "Get conversation by ID", category: "conversations", scope: "read" },
  // The update verb is PUT, registered in the backlog block below. The PATCH
  // entry that used to sit here described no handler (KNOWN_STALE).
  { method: "DELETE", path: "/api/conversations/:id", description: "Delete a conversation", category: "conversations", scope: "chat" },
  { method: "GET", path: "/api/conversations/:id/messages", description: "List messages in a conversation", category: "conversations", scope: "read", responseDescription: "Array of message objects with tool calls" },
  { method: "POST", path: "/api/conversations/:id/messages", description: "Send a message and trigger AI response", category: "conversations", scope: "chat", harness: { controllable: true }, schemaKey: "createMessageSchema" },
  { method: "GET", path: "/api/conversations/:id/extensions", description: "List extensions wired to a conversation", category: "conversations", scope: "read", harness: { controllable: true }, responseDescription: "{ extensions: [{ id, name }] }" },
  { method: "POST", path: "/api/conversations/:id/extensions", description: "Wire installed extensions to a conversation. Per-extension authorization (src/auth/extension-wire-authz.ts): an MCP-kind extension is wire-able only by an admin, the row's creator, or a holder of the `use` RBAC grant — a denial is reported as an unknown name (404) so installed MCP servers stay unenumerable", category: "conversations", scope: "extensions", harness: { controllable: true }, responseDescription: "{ wired: string[], extensionIds: string[] }" },
  { method: "GET", path: "/api/conversations/:id/export", description: "Export conversation as JSON/Markdown", category: "conversations" },
  { method: "POST", path: "/api/conversations/:id/active-run", description: "Cancel active run in conversation", category: "conversations" },
  { method: "GET", path: "/api/conversations/:id/tree", description: "Session-backed message tree + durable leaf pointer for the rewind/branch UI (409 when the history-producer flag is off)", category: "conversations", scope: "read", harness: { controllable: true }, responseDescription: "{ conversationId, currentLeaf: string|null, nodes: [{ id, parentId, role, excluded, createdAt }] }" },
  { method: "GET", path: "/api/conversations/:id/graph", description: "Chat DAG for a conversation — level 1 (prompts + rewind/A-B forks + sub-agent spawns) by default, or level 2 (one turn's thinking/tool/sub-agent/error internals) with ?turn=<userMessageId>. Degrades to a flat chain instead of 409 when the history-producer flag is off", category: "conversations", scope: "read", responseDescription: "{ level: 1|2, rootId: string|null, conversationId, nodes: [{ id, kind, label, fullLabel?, status, createdAt, durationMs?, excluded?, drillable?, subConversationId?, extensionId? }], edges: [{ from, to, kind }], degraded? }" },
  { method: "POST", path: "/api/conversations/:id/rewind", description: "Rewind/checkpoint the conversation to a message (moves the durable leaf pointer; 409 when the flag is off or a run is active)", category: "conversations", scope: "chat", harness: { controllable: true }, schemaKey: "rewindConversationSchema", responseDescription: "{ conversationId, currentLeaf, nodes } (the refreshed tree)" },
  { method: "POST", path: "/api/conversations/:id/messages/:mid/retry", description: "Clean A/B retry — re-run the target assistant message's parent user turn as a same-role sibling (no duplicate user row; 409 when the flag is off or a run is active)", category: "conversations", scope: "chat", harness: { controllable: true }, schemaKey: "retryMessageSchema", responseDescription: "{ userMessage, retriedMessageId, runId }" },
  { method: "GET", path: "/api/search/messages", description: "Hybrid/keyword/semantic message search (RRF)", category: "conversations", responseDescription: "{ hits, degraded, requestedMode, servedMode }" },
  { method: "GET", path: "/api/conversations/:id/audit", description: "Per-conversation audit timeline (sdk_capability_calls scoped to the conversation), cursor-paginated with ?capability ?status=denial ?since ?until ?limit. Owner-only with an admin fallback for unowned rows; 404 (not 403) so the endpoint is not a conversation-id oracle", category: "conversations", scope: "read", responseDescription: "{ entries, nextCursor }" },

  // Topic Contexts
  { method: "GET", path: "/api/conversations/:id/topics", description: "Cached topic pills for a conversation (no LLM)", category: "contexts", scope: "read", responseDescription: "{ topics: [{ id, label, typeId, messageIds }], stale, analyzedAt }" },
  { method: "POST", path: "/api/conversations/:id/topics", description: "Detect topics for a conversation (stage-1 LLM); 503 when no model is available", category: "contexts", scope: "chat", responseDescription: "{ topics, stale, analyzedAt }" },
  { method: "POST", path: "/api/conversations/:id/topics/:topicId/extract", description: "Extract + save a topic's context (stage-2 LLM); 503 when no model is available", category: "contexts", scope: "chat", responseDescription: "{ context: { id, topicLabel, typeId, title, content, model, updatedAt } }" },
  { method: "GET", path: "/api/contexts", description: "Search saved topic contexts (library): ?projectId=&search=&typeId=&limit=&offset=", category: "contexts", scope: "read", responseDescription: "{ contexts, total }" },
  { method: "DELETE", path: "/api/contexts/:id", description: "Delete a saved context (owner or admin; 404 otherwise)", category: "contexts", scope: "write" },
  { method: "GET", path: "/api/context-types", description: "List the DB-resident topic classification types", category: "contexts", scope: "read", responseDescription: "{ types: [{ id, label, description, sortOrder }] }" },

  // Daily Briefing
  { method: "GET", path: "/api/briefing/config", description: "Get the current user's Daily Briefing configuration (defaults when never configured)", category: "briefing" },
  { method: "PUT", path: "/api/briefing/config", description: "Update the current user's Daily Briefing configuration (cron, timezone, project, instructions, watchlist, model)", category: "briefing" },
  { method: "POST", path: "/api/briefing/run-now", description: "Trigger an immediate briefing run for the current user (rate-limited 1/5min)", category: "briefing", responseDescription: "{ started: true } (202)" },

  // GitHub Projects integration
  { method: "POST", path: "/api/integrations/github-projects/connect", description: "Resolve + validate a GitHub Projects board and link it to a project (stores an encrypted PAT for authMode 'pat')", category: "integrations", scope: "extensions", responseDescription: "{ linkId, boardTitle, ownerLogin, statusOptions, scopes, canComment }" },
  { method: "GET", path: "/api/integrations/github-projects/link", description: "List every GitHub board connected to the project, each with health and pause state", category: "integrations", scope: "extensions", responseDescription: "{ links: [...] }" },
  { method: "PATCH", path: "/api/integrations/github-projects/link", description: "Update the board's column→action map, poll interval, or pause/resume state", category: "integrations", scope: "extensions" },
  { method: "DELETE", path: "/api/integrations/github-projects/link", description: "Disconnect the board: purge the stored token, cancel active proposals, drop the link", category: "integrations", scope: "extensions" },
  { method: "POST", path: "/api/integrations/github-projects/link/refresh-columns", description: "Re-fetch the connected board's Status columns (id+name) host-side and persist them — self-heals empty/stale status_options without re-entering the PAT", category: "integrations", scope: "extensions" },
  { method: "GET", path: "/api/integrations/github-projects/proposals", description: "List a project's board-move proposals (active + history)", category: "integrations", scope: "extensions" },
  { method: "POST", path: "/api/integrations/github-projects/proposals/:id/approve", description: "Approve a pending proposal — spawn the PDP-gated conversation + run", category: "integrations", scope: "extensions" },
  { method: "POST", path: "/api/integrations/github-projects/proposals/:id/dismiss", description: "Dismiss a pending proposal without spawning", category: "integrations", scope: "extensions" },
  { method: "POST", path: "/api/integrations/github-projects/proposals/:id/rerun", description: "Re-run a terminal proposal — create a fresh pending proposal for the same card (normal approval gate applies)", category: "integrations", scope: "extensions" },

  // Agent Configs
  { method: "GET", path: "/api/agent-configs", description: "List agent configurations", category: "agents" },
  { method: "POST", path: "/api/agent-configs", description: "Create agent configuration", category: "agents", schemaKey: "createAgentConfigSchema" },
  { method: "GET", path: "/api/agent-configs/:id", description: "Get agent config by ID", category: "agents" },
  { method: "PUT", path: "/api/agent-configs/:id", description: "Update agent configuration", category: "agents" },
  { method: "DELETE", path: "/api/agent-configs/:id", description: "Delete agent configuration", category: "agents" },
  { method: "POST", path: "/api/agent-configs/generate", description: "Generate agent config from conversation", category: "agents", schemaKey: "generateAgentConfigSchema" },

  // Agents
  { method: "GET", path: "/api/agents", description: "List available agents", category: "agents" },
  { method: "POST", path: "/api/agents/:name/run", description: "Execute an agent by name", category: "agents", scope: "chat", schemaKey: "runAgentSchema" },
  { method: "GET", path: "/api/agents/:name/test-conversations", description: "List test conversations for agent", category: "agents" },
  // `POST /api/agents/:id/share` used to sit here described as "Share agent to
  // marketplace". It does not touch the marketplace (that is
  // `POST /api/marketplace`) — the handler imports `shareAgent` /
  // `shareAgentWithUser` from `db/queries/agent-shares` and grants team/user
  // access. Re-registered accurately, with its GET and DELETE siblings, in the
  // backlog block at the bottom of this file. The `no duplicate method+path`
  // assertion in `src/__tests__/api-docs.test.ts` is what caught the double
  // entry — the route-vs-disk parity scan could not, because the path WAS
  // registered; only the description was wrong.

  // Extensions
  { method: "GET", path: "/api/extensions", description: "List installed extensions", category: "extensions", scope: "read", harness: { controllable: true } },
  { method: "POST", path: "/api/extensions", description: "Install extension from local path, a GitHub release, or a git clone URL — lands disabled with no permissions (requires an admin-role key)", category: "extensions", scope: "admin", harness: { controllable: true }, schemaKey: "installExtensionSchema" },
  { method: "GET", path: "/api/extensions/:id", description: "Get extension details", category: "extensions" },
  { method: "PATCH", path: "/api/extensions/:id", description: "Disable an installed extension (enabled:false only; enable via /activate) (requires an admin-role key)", category: "extensions", scope: "extensions", harness: { controllable: true } },
  { method: "DELETE", path: "/api/extensions/:id", description: "Uninstall an extension: drop the row and delete its install directory when that directory is inside a host-owned install root. Add `?purgeData=1` to also delete the extension's stored data under .ezcorp/extension-data/<name>/ (irreversible; omitted means a reinstall resumes from it). Built-in extensions are refused with 409 — disable them instead (requires an admin-role key)", category: "extensions", scope: "extensions", harness: { controllable: true } },
  { method: "POST", path: "/api/extensions/:id/activate", description: "Enable an installed extension and (optionally) grant manifest-clamped permissions (requires an admin-role key)", category: "extensions", scope: "admin", harness: { controllable: true } },
  { method: "POST", path: "/api/extensions/:id/confirm", description: "Confirm extension installation", category: "extensions" },
  { method: "GET", path: "/api/extensions/:id/permissions", description: "Get extension permissions", category: "extensions" },
  { method: "PUT", path: "/api/extensions/:id/permissions", description: "Update extension permissions — clamped to the manifest (requires an admin-role key)", category: "extensions", scope: "admin", harness: { controllable: true } },
  { method: "GET", path: "/api/extensions/:id/triggers", description: "List an extension's DYNAMIC cron + webhook triggers (created at runtime via ctx.triggers; invisible to the manifest and both reconcilers)", category: "extensions", scope: "admin" },
  { method: "GET", path: "/api/extensions/:id/reapprove-drift", description: "Preview a bundled extension's current on-disk, ceiling-clamped permissions and how they differ from the stored grant (requires an admin-role key)", category: "extensions", scope: "admin", responseDescription: "{ version, permissions, diffs: [{ field, oldValue, newValue }], ceilingClamped }" },
  { method: "POST", path: "/api/extensions/:id/reapprove-drift", description: "Re-approve a bundled extension's permission drift from its current on-disk manifest, clamped to the bundled ceiling (requires an admin-role key)", category: "extensions", scope: "admin", responseDescription: "{ extension, diffs: [{ field, oldValue, newValue }] }" },
  { method: "GET", path: "/api/extensions/:name/tools", description: "List tools provided by extension", category: "extensions", scope: "read" },
  { method: "POST", path: "/api/extensions/:id/secrets", description: "Set (or rotate) an extension secret — encrypted, scope-isolated, AAD-bound; value never echoed back", category: "extensions", scope: "extensions", harness: { controllable: true } },
  { method: "DELETE", path: "/api/extensions/:id/secrets", description: "Delete an extension secret", category: "extensions", scope: "extensions", harness: { controllable: true } },
  // The ONLY recovery path for an extension the host disabled on a filesystem
  // security violation: `activateExtension` refuses to re-enable while
  // `hasSecurityViolation(id)` holds ("Clear violations first."), and DELETE
  // here is what clears it. It went unregistered, so the one route an operator
  // needs to un-brick an extension was absent from the OpenAPI spec and the
  // harness client. Admin-role gated inline (`locals.user?.role !== "admin"`).
  { method: "GET", path: "/api/extensions/:id/violations", description: "List the filesystem/capability security violations recorded against an extension by the host gates (requires an admin-role key)", category: "extensions", scope: "admin", responseDescription: "{ violations: [{ extensionId, reason, path, timestamp }] }" },
  { method: "DELETE", path: "/api/extensions/:id/violations", description: "Clear an extension's recorded security violations — the prerequisite for re-enabling it via POST /api/extensions/:id/activate, which refuses while any violation stands (requires an admin-role key)", category: "extensions", scope: "admin", responseDescription: "{ cleared: true }" },

  // ── Per-extension audit drill-down ────────────────────────────────────
  // Both pair requireScope("admin") with checkRole(locals,"admin").
  { method: "GET", path: "/api/extensions/:id/audit", description: "Unified audit timeline for one extension — governance rows, SDK capability calls, and memory/lesson mutations fanned in and cursor-paginated (?capability ?status=denial ?since ?until ?limit); ?legacy=1 serves the pre-merge governance-only shape (requires an admin-role key)", category: "extensions", scope: "admin", responseDescription: "{ entries, nextCursor }" },
  { method: "GET", path: "/api/extensions/:id/audit/stats", description: "Stats strip for one extension over ?range=24h|7d|30d (unknown values fall back to 24h) — cost is an estimate, not provider billing (requires an admin-role key)", category: "extensions", scope: "admin", responseDescription: "{ totalCalls, totalCostUsd, successRate, denialCount }" },

  // ── defineEntity record CRUD (SDK phase 5) ────────────────────────────
  // Every handler binds the store to the CALLING user (`scopeId: user.id`),
  // so there is no cross-user read. Reads take "read", writes take
  // "extensions" — mirroring the settings PUT gate.
  { method: "GET", path: "/api/extensions/:id/entities/:type", description: "List an extension's entity records for the calling user; each row carries `_validationWarning` when its body no longer matches the manifest schema (soft read)", category: "extensions", scope: "read", responseDescription: "{ items: [{ slug, data, _validationWarning? }] }" },
  { method: "POST", path: "/api/extensions/:id/entities/:type", description: "Create one entity record — server-side slug + JSON-Schema validation (the client form is untrusted); 404 unknown extension/type, 409 duplicate slug", category: "extensions", scope: "extensions", responseDescription: "{ slug, data } (201)" },
  { method: "GET", path: "/api/extensions/:id/entities/:type/:slug", description: "Read one entity record (soft read — `_validationWarning` on schema drift)", category: "extensions", scope: "read", responseDescription: "{ slug, data, _validationWarning? }" },
  { method: "PUT", path: "/api/extensions/:id/entities/:type/:slug", description: "Shallow-merge update of one entity record — accepts { patch } or { data }; slug is immutable and a `slug` key in the body is a 400", category: "extensions", scope: "extensions", responseDescription: "{ slug, data }" },
  { method: "DELETE", path: "/api/extensions/:id/entities/:type/:slug", description: "Delete one entity record and drop it from the type index", category: "extensions", scope: "extensions", responseDescription: "{ deleted: boolean }" },

  { method: "GET", path: "/api/extensions/:id/expired-grants", description: "The capability grants that expired for this extension in the last 7 days, enriched with the user's sticky per-kind re-approval TTL — feeds the settings-page ExpiredGrantsBanner. Any authenticated caller: the rows are the caller's OWN permission state, unlike the admin-only /audit drill-down", category: "extensions", scope: "extensions", responseDescription: "{ grants: [{ …, capabilityKind, stickyTtlMs }] }" },

  // The three routes below apply NO `requireScope` call at all, so no
  // `scope` is declared — inventing one here would document an enforcement
  // the handler does not perform. What each DOES enforce is in its
  // description. Flagged in the registry-reconciliation findings.
  { method: "GET", path: "/api/extensions/:id/settings", description: "Per-user settings schema, declared defaults, the caller's values, the resolved blob, write-only secret presence probes, and held host capabilities. Gate: requireAuth only — no API-key scope gate, so a read-scoped key reaches it", category: "extensions", responseDescription: "{ schema, declaredDefaults, userValues, resolved, secrets, capabilities }" },
  { method: "PUT", path: "/api/extensions/:id/settings/user", description: "Write the caller's per-extension settings — secret-typed fields are encrypted into extension storage (empty string clears) and never echoed; the mutation is audited name-only. Gate: requireAuth only — no API-key scope gate, so a read-scoped key can perform this WRITE (and set/clear secrets)", category: "extensions", responseDescription: "{ ok: true, userValues, secrets }" },
  { method: "DELETE", path: "/api/extensions/:id/settings/user", description: "Reset the caller's per-extension settings to declared defaults (409 when the extension declares no settings schema). Gate: requireAuth only — no API-key scope gate", category: "extensions", responseDescription: "{ ok: true }" },
  { method: "POST", path: "/api/extensions/:id/modifiable", description: "Flip the per-extension `modifiable` flag that authorizes its CREATOR to re-open and edit it; refused for bundled extensions, idempotent, audited. Gate: requireAdmin(locals) only — no API-key scope gate, so any scope on an admin-role key reaches it", category: "extensions" },

  // Loops EZ Mode Phase 4 — inbound webhook trigger. Public data-plane: auth is
  // the per-hook token (NOT a session), so scope "public". Persists a delivery
  // onto the claim-before-dispatch queue; the WebhookDeliveryDaemon fires it.
  { method: "POST", path: "/api/hooks/:extensionId/:slug", description: "Deliver an inbound webhook to a loop's webhook trigger (per-hook token or X-Hub-Signature-256 HMAC; 256KB cap; per-hook rate limit + daily budget)", category: "extensions", scope: "public", harness: { controllable: true } },
  { method: "POST", path: "/api/extensions/:name/webhooks/:slug/rotate", description: "Rotate a webhook hook's per-hook secret and return the plaintext once (admin-gated; shown-once secrets UX)", category: "extensions", scope: "admin" },

  // Extension RBAC grants (runtime gate = the delegation check in
  // src/auth/extension-rbac.ts; scope "admin" documents the surface for the
  // docs/OpenAPI tier — see the route headers).
  { method: "GET", path: "/api/rbac/extension-grants", description: "List extension RBAC grants visible to the caller (admin: all; manage-grant holders: their coverage + own; members: own rows only)", category: "admin", scope: "admin", responseDescription: "{ grants: [{ id, user: {id,email,name}, projectId, extensionId, scopes, grantedBy, updatedAt }] }" },
  { method: "POST", path: "/api/rbac/extension-grants", description: "Create an extension RBAC grant or replace an existing row's scope list (delegation-gated: admin, or a covering `manage` grant; `manage` itself is admin-only to grant)", category: "admin", scope: "admin" },
  { method: "DELETE", path: "/api/rbac/extension-grants/:id", description: "Revoke an extension RBAC grant (same delegation rules as create; audit row carries the pre-delete scopes)", category: "admin", scope: "admin" },

  // Marketplace
  { method: "GET", path: "/api/marketplace", description: "Browse marketplace listings", category: "marketplace" },
  { method: "POST", path: "/api/marketplace", description: "Publish agent to marketplace", category: "marketplace", schemaKey: "publishListingSchema" },
  { method: "GET", path: "/api/marketplace/:id", description: "Get marketplace listing details", category: "marketplace" },
  { method: "DELETE", path: "/api/marketplace/:id", description: "Soft-remove a listing (status → \"removed\"), audited as marketplace:remove — distinct from the legacy DELETE /api/marketplace/:id/delete path (requires an admin-role key)", category: "marketplace", scope: "admin", responseDescription: "{ ok: true }" },
  { method: "DELETE", path: "/api/marketplace/:id/delete", description: "Remove marketplace listing", category: "marketplace" },
  { method: "POST", path: "/api/marketplace/:id/install", description: "Stage marketplace source for isolated build and human review", category: "marketplace", scope: "session" },
  { method: "POST", path: "/api/marketplace/:id/rate", description: "Rate a marketplace listing", category: "marketplace" },
  { method: "POST", path: "/api/marketplace/:id/flag", description: "Flag listing for moderation", category: "marketplace" },
  { method: "GET", path: "/api/marketplace/:id/flags", description: "Get flags for a listing (admin)", category: "marketplace" },
  { method: "PATCH", path: "/api/marketplace/:id/flags", description: "Resolve a pending moderation flag: { flagId, action: \"dismissed\" | \"removed\" }, audited as marketplace:flag:<action> (requires an admin-role key)", category: "marketplace", scope: "admin", responseDescription: "{ ok: true }" },
  { method: "GET", path: "/api/marketplace/:id/versions", description: "List versions of a listing", category: "marketplace" },
  { method: "GET", path: "/api/marketplace/flags", description: "List all flagged listings (admin)", category: "marketplace" },
  { method: "GET", path: "/api/marketplace/updates", description: "Check for available updates", category: "marketplace" },
  { method: "GET", path: "/api/marketplace/export/:id", description: "Export listing as manifest JSON", category: "marketplace" },
  { method: "POST", path: "/api/marketplace/import", description: "Import agent from manifest", category: "marketplace", schemaKey: "importManifestSchema" },

  // Knowledge Base
  { method: "GET", path: "/api/knowledge-base", description: "List knowledge base files for project", category: "knowledge-base", scope: "read" },
  { method: "POST", path: "/api/knowledge-base", description: "Upload file to knowledge base (multipart)", category: "knowledge-base", scope: "write" },
  { method: "GET", path: "/api/knowledge-base/:id", description: "Get knowledge base file details", category: "knowledge-base", scope: "read" },
  { method: "DELETE", path: "/api/knowledge-base/:id", description: "Delete knowledge base file", category: "knowledge-base", scope: "write" },
  { method: "POST", path: "/api/knowledge-base/:id/share", description: "Share a knowledge base file with its project (owner + project member only)", category: "knowledge-base", scope: "write" },
  { method: "DELETE", path: "/api/knowledge-base/:id/share", description: "Un-share a knowledge base file, returning it to its original owner", category: "knowledge-base", scope: "write" },

  // Memories
  { method: "GET", path: "/api/memories", description: "Search and list memories", category: "memories", scope: "read" },
  { method: "POST", path: "/api/memories", description: "Create a memory", category: "memories", scope: "write" },
  { method: "GET", path: "/api/memories/:id", description: "Get memory by ID", category: "memories", scope: "read" },
  { method: "PUT", path: "/api/memories/:id", description: "Update a memory", category: "memories", scope: "write" },
  { method: "DELETE", path: "/api/memories/:id", description: "Delete a memory", category: "memories", scope: "write" },

  // Projects
  { method: "GET", path: "/api/projects", description: "List projects for current user", category: "projects", scope: "read" },
  { method: "POST", path: "/api/projects", description: "Create a new project", category: "projects", scope: "write" },
  { method: "GET", path: "/api/projects/:id", description: "Get project by ID", category: "projects", scope: "read" },
  { method: "PUT", path: "/api/projects/:id", description: "Update project settings (project members and instance admins)", category: "projects", scope: "write" },
  { method: "DELETE", path: "/api/projects/:id", description: "Delete a project (project members and instance admins)", category: "projects", scope: "write" },
	{ method: "GET", path: "/api/projects/:id/sandbox", description: "Read a project member's dedicated local sandbox status", category: "projects", scope: "read" },
	{ method: "POST", path: "/api/projects/:id/sandbox", description: "Admit a start, stop, or irreversible destroy action for a dedicated local sandbox", category: "projects", scope: "write" },
	{ method: "POST", path: "/api/sandboxes", description: "Create a dedicated empty local sandbox project from a reviewed provider", category: "projects", scope: "write" },
	{ method: "GET", path: "/api/sandboxes/providers", description: "List reviewed active local sandbox providers", category: "projects", scope: "read" },
	{ method: "POST", path: "/api/local-sandbox/operations/:id/execute", description: "Execute an already admitted local sandbox lifecycle operation", category: "projects", scope: "write" },
  { method: "GET", path: "/api/projects/:id/members", description: "List a project's members (project members and instance admins)", category: "projects", scope: "read", responseDescription: "[{ id, projectId, userId, role, createdAt, userName, userEmail }]" },
  { method: "POST", path: "/api/projects/:id/members", description: "Add a member to a project, or change an existing member's role (project owners and instance admins)", category: "projects", scope: "write", responseDescription: "{ id, projectId, userId, role, createdAt }" },
  { method: "DELETE", path: "/api/projects/:id/members/:userId", description: "Remove a member from a project; the LAST member is refused with 409 (project owners and instance admins)", category: "projects", scope: "write", responseDescription: "{ ok: true }" },
  // SESSION-ONLY, and now declared as such. It carried `scope: "chat"` for one
  // commit — the truest value the type could then express, since the handler
  // really does run `requireScope(locals,"chat")` FIRST — but the entry as a
  // whole was a false statement about the boundary: `scope` renders as
  // `security: [{ bearerAuth: ["chat"] }]`, "call this with a chat key", and a
  // chat key is refused here every time. `"session"` is the true answer to the
  // same question, so it is the one declared.
  //
  // The `chat` check STAYS in the handler and stays first — it is a live gate
  // (defense in depth if the session check is ever edited out), it is simply
  // not the gate that decides who may call. No caller who could ever succeed
  // can observe it: every principal it refuses is refused by the session check
  // one line later. Setting this row is standing consent to auto-run tools,
  // not a capability — a key that could raise it would be raising the ceiling
  // on its own tool calls.
  { method: "PUT", path: "/api/projects/:id/tool-permission-mode", description: "Set the project's built-in-tool permission mode. SESSION-ONLY: refuses every API key (403) — this row pre-answers every future permission prompt in the project, so it is standing consent rather than a capability, and a `chat` key raising it would be raising the ceiling on its own tool calls. The handler also runs `requireScope(locals,\"chat\")` first, but no key reaches past the session check whatever it holds. Project members and instance admins; an optional conversationId — which must name a chat the caller owns inside this project — pushes the change live into that run", category: "projects", scope: "session", responseDescription: "{ ok: true }" },

  // Settings
  { method: "GET", path: "/api/settings", description: "Get every non-deny-listed instance setting. Gate: requireAdmin(locals) for the ROLE plus requireScope(locals,\"admin\") for the KEY axis (F6) — until 2026-08 the scope half was missing, so an admin-role key minted `--scopes read` read the whole settings blob", category: "settings", scope: "admin" },
  { method: "GET", path: "/api/settings/:key", description: "Get single setting by key (requires an admin-role key)", category: "settings", scope: "admin", harness: { controllable: true } },
  { method: "PUT", path: "/api/settings/:key", description: "Update a setting value (requires an admin-role key)", category: "settings", scope: "admin", harness: { controllable: true } },
  { method: "DELETE", path: "/api/settings/:key", description: "Delete a setting value; internally-managed keys (the sensitive deny-list) are refused with 403 (requires an admin-role key)", category: "settings", scope: "admin", responseDescription: "{ ok: true }" },
  { method: "GET", path: "/api/settings/developer", description: "Get developer settings and API keys", category: "settings" },
  // Controllable: provisioning a CONFINED child key is a harness operation —
  // an operator's admin key mints the narrow key its companion app then runs
  // as (`toolPolicy`, optionally from a named `routeBundle`). Gate is
  // requireScope("admin") in the handler; the scope column stays unset here
  // because the scope-ratchet meta-test freezes that list.
  { method: "POST", path: "/api/settings/developer/api-keys", description: "Create API key (optionally confined by a `toolPolicy` — route allowlist / locked mode / caller-tool caps)", category: "settings", harness: { controllable: true }, schemaKey: "createApiKeySchema" },
  // Self-service key management. The `admin` SCOPE on the write paths is a
  // write-gate for KEY principals only — there is no role check, and none is
  // wanted: every row is filtered to the CALLING user, so forcing an admin
  // role would lock members out of their own keys. This is why
  // `settings/developer{,/api-keys}` sit in route-contract.test.ts's
  // KNOWN_SCOPE_ONLY_ADMIN list.
  { method: "GET", path: "/api/settings/developer/api-keys", description: "List the caller's OWN API keys — keyId, name, scopes, role (legacy rows default to \"member\"), createdAt. Never the hash or the raw key", category: "settings", scope: "read", responseDescription: "{ keys: [{ keyId, name, scopes, role, createdAt }] }" },
  { method: "DELETE", path: "/api/settings/developer/api-keys", description: "Revoke one of the caller's OWN API keys by { keyId } — drops both the canonical row and its hash-index pointer so the key cannot re-authenticate via the fast path; 404 when the key is not the caller's", category: "settings", scope: "admin", responseDescription: "204 No Content" },
  { method: "POST", path: "/api/settings/developer", description: "Mint the caller's marketplace publish token — only its SHA-256 hash is stored, and the raw value is returned exactly once", category: "settings", scope: "admin", responseDescription: "{ token }" },
  { method: "DELETE", path: "/api/settings/developer", description: "Revoke the caller's marketplace publish token", category: "settings", scope: "admin", responseDescription: "204 No Content" },

  // Providers & Models
  { method: "GET", path: "/api/providers", description: "List configured AI providers", category: "providers" },
  // Both spend the instance's BYOK provider credential, so both gate on the
  // ROLE (requireAdmin) *and* the KEY axis (requireScope "admin") — the F6
  // pairing their own comments already claimed but did not perform.
  { method: "POST", path: "/api/providers/:provider/test", description: "Test provider connection with a live 1-token completion using the instance BYOK credential (admin role + admin scope)", category: "providers", scope: "admin" },
  { method: "POST", path: "/api/providers/:provider/refresh-models", description: "Fetch latest models from the provider (direct /v1/models, enriched/backed by the models.dev catalog) and overwrite provider:discoveredModels:* (admin role + admin scope)", category: "providers", scope: "admin" },
  { method: "GET", path: "/api/models", description: "List available AI models", category: "providers" },
  { method: "GET", path: "/api/models/default-selection", description: "Default model selection for a user with no saved pick — `provider:defaultSelection`, \"auto\" (route the first turn) or \"first\" (pin models[0]). Read-scoped, not admin-only, so an operator's revert reaches every user", category: "providers", scope: "read", responseDescription: '{ value: "auto" | "first" }' },

  // ── Instance-state writes gated on BOTH axes ──────────────────────────
  // Every entry in this block now pairs `requireAdmin(locals)` (the ROLE) with
  // `requireScope(locals,"admin")` (the KEY axis), role first so a non-admin
  // gets the uniform 403 "Admin role required" instead of learning that scope
  // was also short. Both helpers RETURN their denial — `requireRole` used to
  // THROW it and SvelteKit renders a thrown Response as a 500, so these routes
  // once answered "Internal Error" instead of 403.
  //
  // This block's comment used to say "ROLE ONLY … no `requireScope` … no
  // `scope` is declared because none is enforced". That stopped being true
  // when F2 landed the scope half (pinned for all eleven handlers by
  // `web/src/__tests__/api-admin-scope-gate.server.test.ts`, which probes an
  // admin-role key scoped `["read"]` and asserts 403 + no write). The stale
  // prose survived because nothing cross-checks a registry DESCRIPTION against
  // the handler — only `scope` and the method/path are machine-checked.
  { method: "POST", path: "/api/providers", description: "Store (encrypted) the instance's BYOK API key for anthropic|openai|google|openrouter, audited as provider:key_upsert (admin role + admin scope)", category: "providers", scope: "admin" },
  { method: "DELETE", path: "/api/providers", description: "Delete the instance's stored BYOK API key for one provider, audited as provider:key_delete (admin role + admin scope)", category: "providers", scope: "admin" },
  { method: "POST", path: "/api/providers/local/models", description: "List models offered by a caller-supplied local OpenAI-compatible baseUrl. Server-side fetch behind the sec-H1 SSRF guard: http(s) only, private/loopback rejected, and every resolved A/AAAA re-checked (DNS-rebinding pin) (admin role + admin scope)", category: "providers", scope: "admin" },
  { method: "POST", path: "/api/providers/local/test", description: "Probe one { baseUrl, modelId } on a local OpenAI-compatible server, behind the same sec-H1 SSRF guard as /local/models (admin role + admin scope)", category: "providers", scope: "admin" },

  // MCP server lifecycle. Same two-axis shape as the block above; each of
  // these opens an outbound connection to an operator-supplied MCP server.
  { method: "POST", path: "/api/mcp-servers", description: "Probe an MCP catalog and stage immutable source for build and human approval. Requires an administrator browser session; does not activate.", category: "extensions", scope: "session", responseDescription: "workspace, queued operation and authoring openUrl (202)" },
  { method: "PUT", path: "/api/mcp-servers/:id", description: "Stage changed MCP connection settings in a new workspace. The active release and credentials remain unchanged until approval.", category: "extensions", scope: "session", responseDescription: "workspace, queued operation and authoring openUrl (202)" },
  { method: "POST", path: "/api/mcp-servers/:id/refresh", description: "Probe and stage a new sealed catalog for human approval. Never changes the active tool catalog directly.", category: "extensions", scope: "session", responseDescription: "workspace, queued operation and authoring openUrl (202)" },

  // Search backend config — reuses the encrypted, deny-listed
  // `provider:apiKey:*` store, so keys are never readable back out.
  { method: "GET", path: "/api/search/backend", description: "Presence-only search-backend status: hasKey per BYOK provider (tavily|brave|exa|serpapi|jina) plus the SearXNG base URL. Keys are never returned (admin role + admin scope)", category: "settings", scope: "admin", responseDescription: "{ providers: [{ provider, hasKey }], searxngUrl }" },
  { method: "POST", path: "/api/search/backend", description: "Upsert either a BYOK search key (encrypted into provider:apiKey:*) or the SearXNG base URL (http(s) validated), audited as search:backend_upsert (admin role + admin scope)", category: "settings", scope: "admin" },
  { method: "DELETE", path: "/api/search/backend", description: "Delete one BYOK search key, audited as search:backend_delete (admin role + admin scope)", category: "settings", scope: "admin" },

  // Users & Teams
  { method: "GET", path: "/api/users", description: "List users (admin)", category: "users" },
  // `GET /api/users/:id` was registered and does not exist — the handler
  // exports PUT only (registered directly below). KNOWN_STALE.
  { method: "PUT", path: "/api/users/:id", description: "Activate or deactivate a user ({ status: \"active\" | \"inactive\" }); deactivation atomically transfers the user's agents to the acting admin and refuses self-deactivation (requires an admin-role key)", category: "users", scope: "admin", responseDescription: "{ user } (password hash stripped)" },
  { method: "GET", path: "/api/users/search", description: "Search users by name or email", category: "users" },
  { method: "GET", path: "/api/teams", description: "List teams", category: "teams" },
  { method: "POST", path: "/api/teams", description: "Create a team", category: "teams" },
  { method: "GET", path: "/api/teams/:id", description: "Get team by ID", category: "teams" },
  { method: "PUT", path: "/api/teams/:id", description: "Update team", category: "teams" },
  { method: "DELETE", path: "/api/teams/:id", description: "Delete team", category: "teams" },
  { method: "GET", path: "/api/teams/:id/members", description: "List team members", category: "teams" },
  { method: "POST", path: "/api/teams/:id/members", description: "Add member to team", category: "teams" },
  // Authorization here is the TEAM role (`requireTeamRole(locals, id, "owner")`,
  // which instance admins bypass), not the instance role — so the `admin`
  // SCOPE is a key write-gate only. That is why this file sits in
  // route-contract.test.ts's KNOWN_SCOPE_ONLY_ADMIN list.
  { method: "DELETE", path: "/api/teams/:id/members", description: "Remove a member from a team by { userId } — team OWNER (or an instance admin) only; refuses to remove the last owner", category: "teams", scope: "admin", responseDescription: "{ success: true }" },

  // Workflows
  { method: "GET", path: "/api/workflows", description: "List workflows the caller may see — filtered by ownership, so a read-scoped key with no project sees system workflows only (shorter array than pre-C6, same shape)", category: "workflows" },
  { method: "GET", path: "/api/workflows/:name", description: "Get workflow by name (404, not 403, when unauthorized — the endpoint is not an existence oracle)", category: "workflows" },
  { method: "POST", path: "/api/workflows/:name/run", description: "Execute a workflow", category: "workflows", scope: "chat" },
  // NOT `controllable` yet: that flag asserts a matching
  // `@ezcorp/harness-client` method exists, and the parity meta-test
  // correctly fails without one. Claiming it while shipping no client
  // method would make the registry lie about the remote surface.
  { method: "GET", path: "/api/workflows/approvals", description: "List pending workflow approvals this caller may answer", category: "workflows", scope: "read", responseDescription: "{ approvals: PendingApproval[] }" },
  // `scope: "session"`, and this is the entry that argued the value into
  // existence. A KEY scope renders as `security: [{ bearerAuth: [scope] }]`
  // (src/openapi.ts), i.e. "call this with a key holding that scope" — and
  // answering an approval is the CONSENT boundary, session-only
  // (`requireSessionAuth`), so no key of any scope can reach it and any key
  // scope here would publish a lie about a security boundary. The entry
  // therefore declared NOTHING, which made it indistinguishable from the 90
  // entries whose author simply never wrote one. `"session"` says the true
  // thing out loud instead of saying nothing.
  { method: "POST", path: "/api/workflows/approvals/:id", description: "Answer a parked workflow approval and resume its run. SESSION-ONLY: refuses every API key (403) — a run parks on an approval so that a person decides, so a leaked key must not be able to spend one. Body { choice, form?, itemIds?, consentAll? }", category: "workflows", scope: "session", responseDescription: "{ run: WorkflowRun, consentAllUsed: boolean }" },
  // Operator control over a durable run. NOT an approval-answering path:
  // resume takes no choice and cannot clear a pending consent gate — a run
  // parked on an unanswered approval comes back 409 and stays answerable.
  // See `workflow-run-control.ts` and ported invariant 7.
  { method: "GET", path: "/api/workflows/runs", description: "Workflow run history, newest first — keyset paginated on (started_at, id); a non-admin sees only runs they initiated", category: "workflows", scope: "read", responseDescription: "{ runs: WorkflowRunSummary[], nextCursor?: { startedAt, id } }" },
  { method: "GET", path: "/api/workflows/runs/:id", description: "One run's trace: the run, its steps with per-step model/tokens/duration/resolved input/output, and each step's loop iterations (404, not 403, when unauthorized — a trace carries redacted-but-untrusted payloads)", category: "workflows", scope: "read", responseDescription: "{ run, steps: WorkflowTraceStep[], totals }" },
  { method: "POST", path: "/api/workflows/runs/:id/resume", description: "Continue a suspended workflow run", category: "workflows", scope: "chat", responseDescription: "{ run: WorkflowRun }" },
  { method: "POST", path: "/api/workflows/runs/:id/cancel", description: "Cancel a running or suspended workflow run", category: "workflows", scope: "chat", responseDescription: "{ cancelled: true }" },
  { method: "POST", path: "/api/workflows/:name/dry-run", description: "Simulate a workflow — transform/gate steps evaluated, everything else stubbed; zero LLM, zero side effects, no run row", category: "workflows" },
  { method: "POST", path: "/api/workflows/:name/fork", description: "Clone a workflow the caller can READ into an editable copy they own — the single Duplicate verb behind the UI. Body { projectId?, name?, visibility? }: `name` is suffixed on collision with the global unique index, and `visibility` DEFAULTS TO `private` (it used to be an unconditional, invisible `project`, which the read/run ladder admits every account on the instance to). Naming `system` is admin-only, through the same shared rule as create", category: "workflows", responseDescription: "{ name, id, forkedFrom, visibility } — what LANDED, not what was asked for" },
  { method: "GET", path: "/api/workflows/:name/versions", description: "Version history for a workflow", category: "workflows" },
  { method: "POST", path: "/api/workflows/:name/claim", description: "Assign an owner to a system-owned workflow (admin)", category: "workflows", scope: "admin" },

  // C3 delegated execution — the consent surface.
  //
  // `scope: "session"` on all four, for the same reason
  // POST /api/workflows/approvals/:id carries it: a KEY scope renders as
  // `security: [{ bearerAuth: [scope] }]` (src/openapi.ts), i.e. "call
  // this with a key holding that scope". All four are session-only
  // (`requireSessionAuth`), so NO key of any scope reaches them and
  // declaring a key scope would publish a lie about a security boundary.
  //
  // Consent is a strictly stronger boundary than answering one approval:
  // an approval spends authority once, a delegation mints STANDING,
  // unattended authority over a workflow. The read and the revoke sit
  // behind the same gate deliberately — a revoke gated more strictly than
  // its consent would leave authority its owner cannot take back.
  { method: "GET", path: "/api/workflows/delegations", description: "List the live delegations this human consented to. SESSION-ONLY: refuses every API key (403)", category: "workflows", scope: "session", responseDescription: "{ delegations: WorkflowDelegation[] }" },
  { method: "POST", path: "/api/workflows/delegations", description: "Consent to a delegation: mint standing authority for an extension job to run one workflow as a chosen principal. SESSION-ONLY (403 for every API key). Authorizes AS THE PRINCIPAL THE DELEGATION WILL CARRY, so a service-account delegation for a non-system-visible workflow is refused here with the reason named, not silently at the first fire. Re-consenting supersedes your own live delegation for the same (extension, job); another user's is 409. Body { extensionId, jobRef, workflowName, ownerKind, ownerServiceAccountId?, projectId?, triggerKind, triggerSpec?, maxTokensPerRun, maxRunsPerDay }", category: "workflows", scope: "session", responseDescription: "{ delegation, supersededId, material } (201)" },
  { method: "DELETE", path: "/api/workflows/delegations/:id", description: "Revoke a delegation — a tombstone, not a delete, so the history survives and the (extension, job) can be consented to again. SESSION-ONLY (403 for every API key); the consenting human or an admin, 404 otherwise", category: "workflows", scope: "session", responseDescription: "{ revoked: boolean }" },
  // The FOURTH verb, and the one that makes a parked run resumable.
  // `RESUME_RULES["budget-exceeded"]` says "only raising that cap lets it
  // continue"; before this there was no way to raise it, because the only
  // writer of `max_tokens_per_run` was the consent route and a supersede
  // tombstones the row the parked run's own predicate re-reads. Same
  // Same `scope: "session"` rule as its three siblings above — session-only,
  // so any KEY scope would publish a boundary no key can actually reach.
  { method: "PATCH", path: "/api/workflows/delegations/:id", description: "Adjust a LIVE delegation's SPEND BOUNDS in place — no new row, no new consent hash, no `consented_at` write, so a run parked at `budget-exceeded` becomes resumable and a daily throttle becomes tunable without re-approving the capability set. SESSION-ONLY (403 for every API key); the consenting human or an admin, 404 otherwise. Body { maxTokensPerRun?, maxRunsPerDay? }, positive integers, AT LEAST ONE, and NOTHING else — the schema is strict, so naming the workflow, the owner kind, the consent hash or the enabled flag is a 400 rather than a silent no-op (those require re-consent, Ruling 2), and an empty body is a 400 rather than a 200 that changed nothing. Refuses a revoked or a platform-DISABLED delegation with 409 + the disabled reason: re-consent is the only re-enable path, because it re-asks the question that disabled the row", category: "workflows", scope: "session", responseDescription: "{ delegation: WorkflowDelegation }" },
  { method: "POST", path: "/api/workflows/delegations/preview", description: "What consenting WOULD authorize, computed without writing a row — the capability closure the consent dialog shows before asking. Runs the same two calls the POST does, in the same order, so the preview cannot disagree with the grant; the consent-time refusal (a service-account delegation for a non-system-visible workflow) is previewed too, with its reason and remedy. SESSION-ONLY (403 for every API key). `consentHash` is the SEMANTIC digest only — the delegation facts, the flat capability closure and the walk's bounds. The workflow definition is fingerprinted separately and ADVISORY (`workflow_delegations.definition_hash`, not previewed), because a bundled extension ships its workflows in the app image and folding them in parked every delegation on every release; what re-asks at fire time is a genuine WIDENING of the capability closure. Body { extensionId, workflowName, ownerKind, ownerServiceAccountId?, projectId?, triggerKind }", category: "workflows", scope: "session", responseDescription: "{ material, capabilitySet, consentHash, definitionVersionId, effortNoops, maxToolCallsPerRun, maxNestingDepth, reach }" },
  { method: "GET", path: "/api/workflows/delegated-runs", description: "Jobs running as me: the runs an extension started unattended under a delegation this human consented to. Scoped by `consented_by_user_id` (not by `run_as`), so a service-account job appears for the human answerable for it; revoked delegations are included, because 'what did it do as me?' is the question asked right after revoking. SESSION-ONLY (403 for every API key)", category: "workflows", scope: "session", responseDescription: "{ runs: DelegatedRun[] }" },

  // Tools
  { method: "GET", path: "/api/tools", description: "List available tools", category: "tools" },
  { method: "POST", path: "/api/tool-invoke", description: "Invoke a tool directly. Requires ownership of `conversationId` (404 otherwise) and per-extension wire authorization (an MCP extension the caller may not wire reports the unknown-tool 404). A PDP capability denial is 403 and is NOT retried; a tool-level failure still resolves 200 with `{success:false}`", category: "tools", scope: "extensions", harness: { controllable: true } },
  { method: "GET", path: "/api/tool-calls/:id/output", description: "Get tool call output", category: "tools" },
  { method: "POST", path: "/api/tool-calls/:id/permission", description: "Approve or deny tool permission", category: "tools", scope: "chat", harness: { controllable: true } },

  // Hub pages
  { method: "POST", path: "/api/hub/pages/:id/actions/:action", description: "Dispatch a named action on a core Hub page (scalar payload, rate-limited)", category: "hub", scope: "chat", harness: { controllable: true } },

  // Runs
  { method: "GET", path: "/api/runs", description: "List agent runs", category: "runs", scope: "read" },
  { method: "GET", path: "/api/runs/:id", description: "Get run details (append ?wait=1&timeoutMs= to block until terminal — run-to-completion)", category: "runs", scope: "read", harness: { controllable: true } },
  { method: "DELETE", path: "/api/runs/:id", description: "Cancel an in-flight run (ownership-gated)", category: "runs", scope: "chat", harness: { controllable: true } },

  // Observability
  { method: "GET", path: "/api/observability", description: "Usage totals: all users for an admin, the caller's own conversations for anyone else", category: "observability" },
  { method: "GET", path: "/api/observability/:conversationId", description: "Get events for a conversation (owner or admin only)", category: "observability" },
  { method: "GET", path: "/api/runtime-events", description: "SSE stream of runtime events (run/tool/workflow/agent lifecycle) — consumed by HarnessClient.streamEvents", category: "observability", scope: "read", harness: { controllable: true } },

  // Mentions
  { method: "GET", path: "/api/mentions/search", description: "Search mentionable items", category: "mentions" },

  // Composer suggestions
  { method: "POST", path: "/api/composer/suggest", description: "Rank the active mode/toolset's tools against a draft prompt (embedding retrieval + per-user usage prior) and optionally generate a local-LLM prompt enhancement", category: "composer", scope: "read", schemaKey: "suggestRequestSchema", responseDescription: "{ enabled, degraded?, tools?: [{name, extension, extensionType, description, score}], extensions?: [{name, description, score}], enhancement?: {enhanced, reason} | null, llmAvailable?, latencyMs }" },
  { method: "POST", path: "/api/composer/suggest/feedback", description: "Record composer-suggestion telemetry (shown/accepted/dismissed; never draft text)", category: "composer", scope: "chat", schemaKey: "suggestFeedbackSchema", responseDescription: "{ ok: true } (201)" },

  // System
  // Liveness probe, genuinely anonymous on its bare path (hooks
  // PUBLIC_PATHS) — and it has to stay that way, which is why the F5 /
  // sec-F2 remedy for /api/auth/invite and POST /api/auth/reset-password
  // (move the bare path into PUBLIC_SUBPATHS_ONLY) could not be applied here.
  // `?detail=true` was the last live instance of that defect: a public path
  // never populated `locals.user`, so the admin gate answered 401 to admins
  // too. hooks.server.ts now resolves a presented session cookie
  // OPPORTUNISTICALLY on public `/api/*` paths, so identification no longer
  // depends on enforcement; a cookieless probe is unchanged and still does
  // zero DB work. Until 2026-08 the detail branch also answered 500 instead
  // of 401 (a thrown `requireAuth`).
  { method: "GET", path: "/api/health", description: "Liveness probe — anonymous and DB-free on the bare path. `?detail=true` returns the component breakdown (db/embeddings/providers/localModels) to an admin session; 401 for anyone else", category: "system", scope: "public" },
  // Was registered as GET (and carried in route-contract.test.ts's KNOWN_STALE
  // for exactly that reason); the handler on disk only exports POST.
  { method: "POST", path: "/api/warmup", description: "Pre-warm the embedding model so the first memory/search turn doesn't pay the load cost — best-effort, always 200", category: "system", scope: "read", responseDescription: "{ ok: true }" },
  // Both of these are in the hooks PUBLIC_PATHS allowlist
  // (web/src/hooks.server.ts:365) AND apply no gate of their own, so they are
  // genuinely reachable unauthenticated — hence scope "public".
  { method: "GET", path: "/api/ready", description: "Readiness probe — orthogonal to /api/health (liveness). 200 once migrate() has succeeded and the image is safe to route traffic to, 503 otherwise; orchestrators gate rollouts on this", category: "system", scope: "public" },
  { method: "GET", path: "/api/version", description: "Running version plus the cached upstream update check", category: "system", scope: "public" },
  { method: "GET", path: "/api/auth/ping", description: "No-op keepalive for the client-side session refresher — the real work is the sliding JWT rotation hooks.server.ts performs on the way through. 401 when unauthenticated (inline `locals.user` check; no scope gate)", category: "auth", responseDescription: "{ ok: boolean }" },
  { method: "GET", path: "/api/docs", description: "Self-describing API index: every apiRegistry entry with its JSON Schema request body where a schemaKey resolves", category: "system", scope: "read" },
  { method: "GET", path: "/api/models/capabilities", description: "Capability intersection for a ?provider/?model pick (or the auto-routing ladder), widened by the extensions wired to ?conversationId plus any ?extensions= drafted via !ext: mentions", category: "providers", scope: "read" },
  { method: "GET", path: "/api/active-agents", description: "In-flight agent runs, optionally filtered by ?projectId. Non-admins see only runs in conversations they own — the ownership filter is what stops a read-scoped key enumerating every tenant's runIds, agent names and conversation titles", category: "agents", scope: "read", responseDescription: "[{ runId, agentName, conversationId, parentConversationId, projectId, conversationTitle, startedAt }]" },
  { method: "GET", path: "/api/quickstart", description: "Get quickstart checklist status", category: "system" },
  // `POST /api/quickstart` was registered and does not exist — the handler
  // exports GET only. KNOWN_STALE.
  { method: "GET", path: "/api/favicon", description: "Get application favicon", category: "system" },
  { method: "GET", path: "/api/audit-log", description: "List audit log entries (admin)", category: "admin" },
  { method: "GET", path: "/api/admin/analytics/routing", description: "Routing + cost analytics: routed-vs-pinned share, tier mix, failover rate, mid-conversation model switches, A/B retry rate, and priced spend per provider+model (admin)", category: "admin", scope: "admin", responseDescription: "{ days, turns: { total, routed, pinned, legacy }, routedShare, tierMix, failover, switches, retries, spend: { segments, routedUsd, pinnedUsd, legacyUsd, totalUsd, unpricedTurns, unpricedTokens, conversations, usdPerConversation } }" },

  // ── Admin console + audit feeds ───────────────────────────────────────
  // All eight gate on BOTH axes: `requireScope(locals,"admin")` followed by a
  // role gate, so a member cookie and a non-admin key are both rejected. The
  // /api/admin/* six use `requireRole` inside a try/catch that converts the
  // thrown denial; /api/audit + /api/audit/stats use `checkRole`, which
  // returns it. Registered from the handlers, not from intent.
  { method: "GET", path: "/api/admin/sessions", description: "List every live session across all users (admin), optionally filtered by ?userId — carries userAgent + ipAddress per row", category: "admin", scope: "admin", responseDescription: "{ sessions: [{ id, userId, userName, userEmail, userAgent, ipAddress, lastActiveAt, createdAt }] }" },
  { method: "DELETE", path: "/api/admin/sessions", description: "Force-logout: revoke one session by { sessionId } or every session of a user by { userId } (admin)", category: "admin", scope: "admin", responseDescription: "{ success: true, revokedCount? }" },
  { method: "GET", path: "/api/admin/analytics", description: "Admin dashboard aggregates over the last ?days (clamped 1–365): chat activity, model usage, agent/extension/user stats, and tool usage by tool/agent/user/model", category: "admin", scope: "admin" },
  { method: "GET", path: "/api/admin/system", description: "Admin dashboard system panel: health, activity feed, and error summary", category: "admin", scope: "admin", responseDescription: "{ health, activityFeed, errorSummary }" },
  { method: "GET", path: "/api/admin/errors", description: "Paginated error-log feed (?limit clamped 1–500, ?offset ≥ 0) for the admin dashboard", category: "admin", scope: "admin", responseDescription: "{ errors, total }" },
  { method: "GET", path: "/api/admin/embed-progress", description: "Read-only message-embedding backfill progress — the same source the backfill CLI's --status flag reads", category: "admin", scope: "admin" },
  { method: "GET", path: "/api/audit", description: "Global cross-extension audit feed (sdk_capability_calls + governance rows), cursor-paginated; filters ?extensionId ?capability ?action ?onBehalfOf ?denialOnly ?search ?limit (clamped 1–200)", category: "admin", scope: "admin", responseDescription: "{ entries, nextCursor }" },
  { method: "GET", path: "/api/audit/stats", description: "Headline audit aggregates for ?range=24h|7d|30d (unknown values fall back to 24h): denial count, total calls, total cost, top-3 chattiest extensions, top-3 LLM spenders", category: "admin", scope: "admin" },

  // ── C3 service accounts ───────────────────────────────────────────────
  // `scope: "session"` on all five — the same reasoning as
  // `POST /api/workflows/approvals/:id` above. A KEY scope renders as
  // `security: [{ bearerAuth: [scope] }]` (src/openapi.ts), i.e. "call
  // this with a key holding that scope". These routes gate on
  // `requireSessionAuth` FIRST, so NO key of any scope can reach them at all
  // and `scope: "admin"` would publish a lie about a security boundary. The
  // second gate is `checkRole(locals,"admin")`, which returns its denial
  // rather than throwing it (a thrown Response is a 500, not a 403) — the two
  // together are `requireAdminSession` (src/auth/middleware.ts).
  //
  // The ADMIN half is therefore in the description, not in `scope`: the field
  // holds one value and the binding one is "no key, ever". `category: "admin"`
  // still groups them where an operator looks for them.
  //
  // GET is the one exception on the ROLE axis, and it is still session-only:
  // it answers every authenticated session, with a two-field
  // `{id,name}` projection for a non-admin. Ruling 1 makes both owner kinds
  // selectable PER DELEGATION, and a consenter who cannot read the list cannot
  // name a service account to consent to.
  { method: "GET", path: "/api/service-accounts", description: "List service accounts (optionally ?projectId), plus the machine-readable reach warning. SESSION-ONLY: refuses every API key (403). An ADMIN gets the full ServiceAccountView per row; any other authenticated session gets `{ id, name }` ONLY, filtered to enabled accounts — scopes, createdBy, maxTokensPerDay, projectId and disabledReason are withheld. The narrow read exists so a non-admin consenting to a delegation can populate the owner-kind picker (Ruling 1). A service account is a non-human `run_as` principal with no users row — it cannot authenticate", category: "admin", scope: "session", responseDescription: "{ accounts: ServiceAccountView[] | { id, name }[], reach: { code, runnableVisibilities, message } }" },
  { method: "POST", path: "/api/service-accounts", description: "Mint a service account. SESSION-ONLY + admin. Scopes are CLAMPED to the creating admin's effective set and what was dropped is reported; `maxTokensPerDay` is mandatory (tokens are the enforced bound — a cents cap is refused, since an unpriced model would spend without bound under one). The response carries the reach warning: a service account has no user identity, so it can only be delegated system-visible workflows", category: "admin", scope: "session", responseDescription: "{ account, droppedScopes: string[], reach: { code, runnableVisibilities, message } } (201)" },
  { method: "PATCH", path: "/api/service-accounts/:id", description: "Enable or disable a service account, recording `disabledReason` when disabling. SESSION-ONLY + admin. The body is strict and takes `enabled` only — the daily token cap has its own route, so an enable/disable can never be mistaken for a budget change in the audit log", category: "admin", scope: "session", responseDescription: "{ account }" },
  { method: "PATCH", path: "/api/service-accounts/:id/daily-cap", description: "Set a service account's `max_tokens_per_day` — the remedy rung D10 names when a delegated fire is refused because the owning account spent its day, and which nothing exposed until now. SESSION-ONLY + admin. Body { maxTokensPerDay } (positive integer) and NOTHING else: strict, so a cents cap is a 400 rather than a silent no-op (Ruling 3 — tokens enforced, cost advisory). Lowers as readily as it raises. Does NOT re-enable a disabled account or clear its disabledReason; audited as `service-account:daily-cap-changed`", category: "admin", scope: "session", responseDescription: "{ account }" },
  { method: "DELETE", path: "/api/service-accounts/:id", description: "Delete a service account. SESSION-ONLY + admin. REFUSED with 409 + { delegationCount } while live delegations name it — the owner FK is ON DELETE CASCADE, so the delete would otherwise destroy those authorities silently", category: "admin", scope: "session", responseDescription: "204 No Content" },

  { method: "GET", path: "/api/fs/list", description: "List files in a directory", category: "system" },
  // Gate is `requireScope(locals,"read")` + an INLINE `user.role !== "admin"`
  // check — NOT requireAdmin/requireRole, so the admin-gate pairing scan in
  // route-contract.test.ts cannot see it. Declared scope mirrors the handler:
  // "read" is genuinely what the key axis demands, even though the call
  // MUTATES the filesystem. See the reconciliation findings.
  { method: "POST", path: "/api/fs/mkdir", description: "Create a directory (recursive) inside the project sandbox — admin ROLE required AND the `admin` scope (until 2026-08 the scope gate was only `read`, so a nominally read-only key reached it); the target's nearest existing ancestor is realpath-checked against EZCORP_PROJECT_ROOT to block symlink escapes", category: "system", scope: "admin", responseDescription: "{ path } (201)" },

  // ═══════════════════════════════════════════════════════════════════════
  // REGISTRY BACKLOG CLOSURE (2026-08)
  //
  // The 75 control routes that were on disk and absent from this file,
  // carried as the frozen `KNOWN_UNREGISTERED` debt set in
  // `web/src/__tests__/route-contract.test.ts`. AGENTS.md makes registration
  // binding for EVERY `/api/*` route; each of these was a standing violation.
  //
  // THE RULE FOLLOWED HERE, and it is the only one that keeps this file
  // useful: `scope` documents what the handler ENFORCES, never what it
  // ought to. `src/openapi.ts:40` renders `scope` as
  // `security: [{ bearerAuth: [scope] }]` — "call this with a key holding
  // that scope" — so a scope declared but not enforced is a false statement
  // about a security boundary in the published contract, and a scope
  // enforced but not declared sends an operator to mint the wrong key.
  // Where a route applies NO `requireScope` at all, no `scope` key appears
  // and the description says so in words; the same convention the
  // `/api/extensions/:id/settings` entries above already use.
  //
  // Registering a route is not the same as endorsing its gate. Scopes that
  // look too loose for what the handler does are called out inline below and
  // listed in the reconciliation report for review — one of them
  // (`POST /api/extensions/author/install`, F7) was tight enough of a hole
  // to fix rather than document, and was fixed in its own commit.
  // ═══════════════════════════════════════════════════════════════════════

  // ── Agents: sharing + test conversations ──────────────────────────────
  // The `inline-admin` shape in the share handlers is the sec-H3 OWNERSHIP
  // idiom (`row.userId !== user.id && user.role !== "admin"`), not a gate.
  { method: "GET", path: "/api/agents/:id/share", description: "List an agent config's team and per-user shares, resolved to names — owner-or-admin, 404 otherwise", category: "agents", scope: "read", responseDescription: "{ teams, users }" },
  { method: "POST", path: "/api/agents/:id/share", description: "Share an agent config with teams and/or users at permission read|edit ({ teamIds?, userIds?, permission })", category: "agents", scope: "chat" },
  { method: "DELETE", path: "/api/agents/:id/share", description: "Revoke an agent config's team and/or user shares", category: "agents", scope: "chat" },
  { method: "DELETE", path: "/api/agents/:name/test-conversations", description: "Delete every test conversation recorded for an agent by name", category: "agents", scope: "chat" },
  { method: "GET", path: "/api/user/agent-picker", description: "The caller's agent-picker preferences — saved searches plus pinned agent ids, with pins that no longer resolve trimmed on read. Gate: requireAuth only — no API-key scope gate", category: "agents", responseDescription: "{ savedSearches, pinned }" },
  { method: "PUT", path: "/api/user/agent-picker", description: "Replace the caller's agent-picker saved searches / pinned agents (settings KV, user:<id>:agentPicker:*). Gate: requireAuth only — no API-key scope gate", category: "agents" },

  // ── OAuth provider connect ────────────────────────────────────────────
  // `POST`/`DELETE /api/auth/oauth/callback` were part of this backlog and are
  // registered up in the Auth block instead, next to the initiator they
  // complete. This pass had recorded them as a FINDING — two doors to the
  // instance LLM credential, one locked (`/api/providers`) and one on
  // `requireAuth` alone — because that is what the tree said at the time.
  // sec-F2/#86 then CLOSED it: all three now gate on `requireAdmin` +
  // `requireScope(locals,"admin")`, so they carry `scope: "admin"` and there
  // is no longer a finding to record here.

  // ── Invites (anonymous redemption sub-path) ───────────────────────────
  // Genuinely unauthenticated: `/api/auth/invite/:token` is the one entry in
  // the hooks PUBLIC_SUBPATHS_ONLY list, so hooks lets it through with no
  // principal. Rate-limited 10 attempts / 15 min per IP.
  { method: "GET", path: "/api/auth/invite/:token", description: "Validate an invitation token before showing the signup form (does not consume it)", category: "auth", scope: "public", responseDescription: "{ invite: { email, role, expiresAt } }" },

  // ── Conversations: reads ──────────────────────────────────────────────
  // Every one is ownership-gated with the fail-closed sec-H3 idiom: a row
  // with a NULL user_id is admin-only, and denial is 404 rather than 403 so
  // the endpoint is not a conversation-id oracle.
  // Controllable: a caller-executed-tools client re-drains this on every SSE
  // (re)connect to recover tool calls it missed while disconnected — the SSE
  // resume ring is 500 GLOBAL entries including every `run:token`, i.e.
  // seconds of turnover, so replay is best-effort and this read is the
  // authoritative one.
  { method: "GET", path: "/api/conversations/:id/active-run", description: "The conversation's in-flight run, if any, plus any pending ask-user prompt and any caller-executed tool calls awaiting a result", category: "conversations", scope: "read", harness: { controllable: true } },
  { method: "GET", path: "/api/conversations/:id/caller-tools", description: "The caller-executed tool declarations currently stored on the conversation (`metadata.callerTools`). Ownership-gated to the root conversation's owner; 404 rather than 403 so it is not a conversation-id oracle", category: "conversations", scope: "read", harness: { controllable: true }, responseDescription: "{ tools: [{ name, description, parameters, timeoutMs? }] }" },
  { method: "GET", path: "/api/conversations/:id/sub-conversations", description: "Enumerate a conversation's sub-conversations (sub-agent spawns)", category: "conversations", scope: "read" },
  { method: "GET", path: "/api/conversations/:id/tasks", description: "Cold-start read of the task-tracking panel snapshot, straight from the task-tracking bundled extension's extension_storage row (409 when that extension is not installed)", category: "conversations", scope: "read" },
  { method: "GET", path: "/api/conversations/:id/tasks/:taskId/messages", description: "Messages for every assignment on one task, grouped by assignment (each assignment's sub-conversation loaded from the DB)", category: "conversations", scope: "read" },
  { method: "GET", path: "/api/conversations/:id/team/:agentConfigId/messages", description: "One team member's sub-conversation messages with their tool calls", category: "conversations", scope: "read" },
  // A READ behind the `chat` scope: a read-scoped key is refused. Enforced
  // as written; flagged as a scope-consistency question, not a hole.
  { method: "GET", path: "/api/conversations/:id/extension-toolbar", description: "Union of the `messageToolbar[]` items declared by every ENABLED installed extension, for MessageToolbar.svelte. Scope is `chat`, not `read`, so a read-scoped key cannot fetch it", category: "conversations", scope: "chat" },

  // ── Conversations: writes ─────────────────────────────────────────────
  // Controllable: a key minted with `toolPolicy.lockedModeId` must be able to
  // put its conversation under that mode before its first send, and the mode
  // MUTATION routes are deliberately absent from the companion bundle. See
  // HarnessClient.updateConversation.
  { method: "PUT", path: "/api/conversations/:id", description: "Update a conversation's title, model, system prompt or project (the registry previously advertised this as PATCH; the handler exports PUT)", category: "conversations", scope: "chat", harness: { controllable: true }, schemaKey: "updateConversationSchema" },
  { method: "PATCH", path: "/api/conversations/:id/messages/:mid", description: "Edit ONE message's content, or toggle its `excluded` flag — XOR, never both; refused while a run is active. Never touches parentMessageId (the session-tree invariant)", category: "conversations", scope: "chat" },
  { method: "POST", path: "/api/conversations/:id/clone-turns", description: "Copy a span of turns into another conversation (fork/branch support)", category: "conversations", scope: "chat" },
  { method: "POST", path: "/api/conversations/:id/agent-chat", description: "Send a message to a named agent config inside the conversation, spawning its sub-conversation run", category: "conversations", scope: "chat" },
  { method: "POST", path: "/api/conversations/:id/tool-results", description: "Return a CLIENT-side tool's result (EZ concierge or caller-executed) to the waiting host invocation. Body capped at 256 KiB, rate-limited 20/s per user. `{ ok, resolved, reason? }` — `ok` means the request was accepted, `resolved` means THIS result reached the waiting tool; a second device that lost the race gets `resolved: false, reason: \"already-resolved\"`", category: "conversations", scope: "chat", harness: { controllable: true }, responseDescription: "{ ok: true, resolved: boolean, reason?: \"already-resolved\" }" },
  // Caller-executed tool declarations. ROOT-ONLY (400 on a sub-conversation):
  // the runtime wires caller tools from the conversation it is running and a
  // sub-conversation inherits none, so accepting a declaration there would
  // look like it worked and do nothing.
  { method: "PUT", path: "/api/conversations/:id/caller-tools", description: "Declare the tools this conversation's connected client device can execute (≤16, wired as `_caller__<name>`). Root conversations only — 400 on a sub-conversation. Rate-limited to 5 declaration WRITES/s per user, shared with the DELETE below and charged only when a row is actually written (a request refused for shape, semantics or policy spends no budget); body capped at 64 KiB", category: "conversations", scope: "chat", harness: { controllable: true }, responseDescription: "{ tools, appliedFrom: \"next-turn\", activeRunId }" },
  { method: "DELETE", path: "/api/conversations/:id/caller-tools", description: "Drop every caller-executed tool declaration from the conversation. Idempotent — clearing an empty bag is `{ ok: true, cleared: 0 }`, not a 404. Shares the PUT's 5 declaration-writes/s per-user budget", category: "conversations", scope: "chat", harness: { controllable: true }, responseDescription: "{ ok: true, cleared: number }" },
  { method: "POST", path: "/api/ask-user/answer", description: "Answer a host-minted `ask_user` prompt by toolCallId — the option label or free text the user submitted", category: "conversations", scope: "chat" },

  // ── Task tracking (task-tracking bundled extension's HTTP surface) ────
  { method: "POST", path: "/api/conversations/:id/tasks/:taskId/assign", description: "Attach an agent config to a task or subtask; snapshot write is serialized by the task-snapshot lock and broadcast", category: "conversations", scope: "chat" },
  { method: "DELETE", path: "/api/conversations/:id/tasks/:taskId/assign", description: "Remove one assignment from a task by id", category: "conversations", scope: "chat" },
  { method: "POST", path: "/api/conversations/:id/tasks/:taskId/assignments/:assignmentId/start", description: "Start an assignment — spawn its agent run and move the task into progress", category: "conversations", scope: "chat" },
  { method: "POST", path: "/api/conversations/:id/tasks/:taskId/assignments/:assignmentId/stop", description: "Stop a running assignment and cancel its run", category: "conversations", scope: "chat" },
  { method: "POST", path: "/api/conversations/:id/tasks/:taskId/retry", description: "Re-run a failed assignment on a task", category: "conversations", scope: "chat" },

  // ── Attachments ───────────────────────────────────────────────────────
  { method: "GET", path: "/api/attachments/:id", description: "Stream an attachment's bytes; caller must own the owning conversation (unowned rows are admin-only). Cache-Control immutable — storagePath is UUID-keyed and never rewritten. `?download=1` forces the download disposition", category: "conversations", scope: "read" },

  // ── Modes ─────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/modes", description: "List the caller's modes (toolset presets)", category: "orchestration", scope: "read" },
  { method: "POST", path: "/api/modes", description: "Create a mode", category: "orchestration", scope: "chat" },
  { method: "GET", path: "/api/modes/:id", description: "Get one mode by id", category: "orchestration", scope: "read" },
  { method: "PUT", path: "/api/modes/:id", description: "Update a mode — built-in modes are refused 403; unowned (NULL user_id) rows are admin-only (sec-H3 fail-closed)", category: "orchestration", scope: "chat" },
  { method: "DELETE", path: "/api/modes/:id", description: "Delete a mode — built-ins refused, unowned rows admin-only", category: "orchestration", scope: "chat" },

  // ── Workflows (definitions) ───────────────────────────────────────────
  // `chat` is the DELIBERATE gate here: the per-resource ownership ladder in
  // `src/runtime/workflow-scope.ts` sits on top of it, and the ladder
  // compares `user.role === "admin"` directly rather than calling checkRole,
  // which would also demand the admin API-key scope and so reject a
  // cookie-authed admin on a chat-scoped route. See
  // docs/features/platform/rbac-and-permission-modes.md.
  { method: "POST", path: "/api/workflows", description: "Create a workflow definition (validated; a version row is stamped). Visibility assignment of `system` is admin-only", category: "workflows", scope: "chat" },
  { method: "PUT", path: "/api/workflows/:name", description: "Update a workflow definition — owner or admin per the ownership ladder; 404 (not 403) when unauthorized so the endpoint is not an existence oracle", category: "workflows", scope: "chat" },
  { method: "DELETE", path: "/api/workflows/:name", description: "Delete a workflow definition — same ownership ladder, same opaque 404", category: "workflows", scope: "chat" },

  // ── Lessons ───────────────────────────────────────────────────────────
  { method: "GET", path: "/api/lessons", description: "Lesson curation list for the /memories → Lessons tab (?projectId): the visibility-deduped set with full bodies, counters and an owner-of-mine flag", category: "memories", scope: "read" },
  { method: "PATCH", path: "/api/lessons/:id", description: "Change a lesson's visibility — owner-gated, 404 when the row is missing OR not the caller's (the two are indistinguishable, to block id enumeration)", category: "memories", scope: "write" },
  { method: "DELETE", path: "/api/lessons/:id", description: "Hard-delete a lesson — owner-gated, same opaque 404 (204 on success)", category: "memories", scope: "write" },
  { method: "PATCH", path: "/api/memories/:id", description: "Flip a memory's injection eligibility / status — re-scoped `read` → `write` by the 2026-08 mutation audit", category: "memories", scope: "write" },

  // ── User commands (slash-command definitions) ─────────────────────────
  { method: "GET", path: "/api/user-commands", description: "List the caller's DB-resident slash commands", category: "composer", scope: "read" },
  { method: "POST", path: "/api/user-commands", description: "Create a slash command (frontmatter filtered, body capped at COMMAND_BODY_MAX_BYTES); the command registry is refreshed", category: "composer", scope: "chat" },
  { method: "GET", path: "/api/user-commands/:name", description: "Get one slash command by name", category: "composer", scope: "read" },
  { method: "PATCH", path: "/api/user-commands/:name", description: "Update a slash command's body or metadata", category: "composer", scope: "chat" },
  { method: "DELETE", path: "/api/user-commands/:name", description: "Delete a slash command", category: "composer", scope: "chat" },

  // ── Feature index (`$[feature:…]` mentions) ───────────────────────────
  { method: "GET", path: "/api/projects/:id/features", description: "List a project's features with file counts", category: "composer", scope: "read" },
  { method: "POST", path: "/api/projects/:id/features", description: "Create a user-sourced feature", category: "composer", scope: "chat" },
  { method: "POST", path: "/api/projects/:id/features/scan", description: "Synchronous project scan that (re)populates the scanned feature set", category: "composer", scope: "chat" },
  { method: "GET", path: "/api/projects/:id/features/:featureId", description: "Read one feature with its full file list — the side-effect-free alternative to the old no-op-PATCH row-expand (audit defect D4)", category: "composer", scope: "read" },
  { method: "PATCH", path: "/api/projects/:id/features/:featureId", description: "Update one feature; the source-flip predicate is defended at the endpoint so an empty patch cannot silently reclassify a scanned feature as user-sourced", category: "composer", scope: "chat" },
  { method: "DELETE", path: "/api/projects/:id/features/:featureId", description: "Delete one feature", category: "composer", scope: "chat" },

  // ── Permission mode (read half; the PUT is registered above) ──────────
  { method: "GET", path: "/api/projects/:id/tool-permission-mode", description: "The project's stored built-in-tool permission mode (defaults to `yolo`); project members and instance admins", category: "projects", scope: "read", responseDescription: '{ mode: "ask" | "auto-edit" | "yolo" }' },

  // ── EZ concierge panel ────────────────────────────────────────────────
  // `read` on the find-or-create pair is deliberate and was re-affirmed by
  // the 2026-08 mutation audit: both verbs are the SAME idempotent
  // find-or-create keyed by the caller's own id, with uniqueness enforced by
  // the partial index `conversations_user_ez_unique`.
  { method: "GET", path: "/api/ez/conversation", description: "Find-or-create the caller's single Ez conversation", category: "composer", scope: "read" },
  { method: "POST", path: "/api/ez/conversation", description: "Idempotent alias of the GET — find-or-create the caller's single Ez conversation", category: "composer", scope: "read" },
  { method: "DELETE", path: "/api/ez/conversation/messages", description: "\"Clear conversation\" for the Ez panel: wipe the message list but keep the conversation row so the open SSE subscription and locked mode survive", category: "composer", scope: "chat" },
  { method: "GET", path: "/api/ez/drafts/:id", description: "Hydrate a destination form from an Ez draft — double-keyed, `getDraft(id, userId)` returns undefined for another user's, an expired, or a missing draft", category: "composer", scope: "read" },
  { method: "POST", path: "/api/ez/drafts/:id", description: "Consume an Ez draft (body { action: \"consume\" }) — idempotent, a second consume returns the existing consumedAt", category: "composer", scope: "chat" },
  { method: "POST", path: "/api/ez/drafts/:id/consume", description: "URL-shaped alias of the consume action above; identical semantics", category: "composer", scope: "chat" },
  { method: "POST", path: "/api/ez-actions/:name", description: "Dispatch an EZ action (`![EZ:name]`): resolve it in the in-memory registry, verify conversation ownership, run it, persist the result as a `role: \"ez-action-result\"` message. Re-scoped `read` → `chat` in 2026-08 — it dispatches a bundled-extension tool and writes a row", category: "composer", scope: "chat" },

  // ── Hub ───────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/hub/pages", description: "List the caller's Hub tabs — `core:<id>` providers plus `ext:<name>:<pageId>` pages from enabled extensions. v1 RBAC: every authenticated user sees every tab; per-user isolation happens inside each page's render(userId)", category: "hub", scope: "read" },
  { method: "GET", path: "/api/hub/pages/:id", description: "Render one Hub page for the session user. Every tree — core or extension — passes validatePageTree before it is served; render failures are 200 + { error } (the client shows a retry card), unknown ids 404, rate-limit hits 429", category: "hub", scope: "read" },

  // ── Extension runtime surfaces ────────────────────────────────────────
  { method: "GET", path: "/api/ext-files/:name/:path", description: "Serve a file an extension wrote under <projectRoot>/.ezcorp/extension-data/<name>/ — the alternative to replaying base64 data: URIs into the next turn's context. Extension name must match a strict allowlist (404 otherwise) so the path is not a probe for arbitrary extension state", category: "extensions", scope: "read" },
  { method: "GET", path: "/api/extensions/:name/data/:path", description: "Static-file read from <projectRoot>/.ezcorp/extension-data/<name>/, realpath-contained and rate-limited. Scope is `chat`, not `read`, so a read-scoped key cannot fetch it", category: "extensions", scope: "chat" },
  { method: "POST", path: "/api/extensions/:name/events/:event", description: "Deliver a registered UI event (canvas card / message-toolbar click) to an extension, wiring it to the conversation if needed. Only events the extension actually registered are accepted", category: "extensions", scope: "chat" },
  { method: "POST", path: "/api/extensions/:name/uploads", description: "Upload bytes on an extension's behalf and attach them to a message in a conversation the caller owns and the extension is wired to", category: "extensions", scope: "chat" },
  { method: "POST", path: "/api/extensions/:id/reapprove", description: "Re-approve an extension's permissions from its current manifest, clamped to the bundled ceiling; clears the always-allow rows the change invalidates. Gates on requireAdmin (ROLE) plus requireScope(\"extensions\")", category: "extensions", scope: "extensions" },
  // `chat` READS installed code into an editable draft. It cannot complete
  // the loop any more: the install half now demands `extensions` (F7). Still
  // flagged — the creator + `modifiable` + not-bundled check is the real
  // authority, and it is the SAME path the in-chat `ezcorp/drafts.reopen`
  // RPC takes. There is deliberately no admin-override edit path.
  { method: "POST", path: "/api/extensions/:id/reopen", description: "Re-open an installed extension the caller CREATED (and an admin flagged `modifiable`) as an editable author draft, then redirect to /extensions/author?prefill=<draftId>", category: "extensions", scope: "chat", responseDescription: "{ draftId, redirectUrl }" },

  // ── Extension authoring (draft staging) ───────────────────────────────
  // These three write into the DRAFT staging dir, which the host never
  // loads; the file keys are allowlisted to the scaffolder's known set.
  // `chat` is the authoring surface. The INSTALL step — the one that lands
  // executable code in the extension inventory — is `extensions` (F7).
  { method: "PUT", path: "/api/extensions/author/draft/:id", description: "Save edits to an author draft — owner-scoped via getDraft(id, userId); any file key outside the scaffolder allowlist is a 400", category: "extensions", scope: "chat" },
  { method: "DELETE", path: "/api/extensions/author/draft/:id", description: "Discard an author draft — removes the draft directory AND consumes the row", category: "extensions", scope: "chat" },
  { method: "POST", path: "/api/extensions/author/draft/:id/validate", description: "Run the host's FULL acceptance gate (`runAuthorAcceptanceGate` — the same one install calls) against a draft, so the editor cannot report \"ready to install\" for something install will 422", category: "extensions", scope: "chat", responseDescription: "{ ok, pass, steps, errors }" },
  { method: "POST", path: "/api/extensions/author/install", description: "Install an author draft as a real user-installed extension, `enabled: false` with no permissions. Lands EXECUTABLE CODE on disk, so the scope is `extensions` — it demanded only `chat` until 2026-08 (F7). Ownership, verify gate and env-key-leak gate all run inside the shared installAuthoredDraft pipeline", category: "extensions", scope: "extensions", responseDescription: "{ extensionId, redirectUrl } (201)" },

  // ── Import (commands + skill bundles) ─────────────────────────────────
  { method: "POST", path: "/api/import/preview", description: "Stage a directory upload or archive under <projectRoot>/.ezcorp/import-staging/<id> and return the command + skill checklist, scanned with the same scanners commit uses. Re-scoped `read` → `write` in 2026-08 (it writes staging dirs)", category: "extensions", scope: "write" },
  { method: "POST", path: "/api/import/commit", description: "Import commands or stage bounded UTF-8 skill source for an isolated build and human release review. Requires an administrator session; staging is removed in finally", category: "extensions", scope: "session" },

  // ── Marketplace ───────────────────────────────────────────────────────
  { method: "GET", path: "/api/marketplace/categories", description: "Marketplace tag taxonomy aggregated over ACTIVE listings, for the category filter chips. Same auth posture as GET /api/marketplace: any authenticated caller, no API-key scope gate (hooks still refuses anonymous /api/* callers, so this is not `public`)", category: "marketplace", responseDescription: "{ categories: [{ tag, count }] }" },

  // ── Secure preview ────────────────────────────────────────────────────
  { method: "POST", path: "/api/preview/:id/token", description: "Mint a ONE-TIME code from the authenticated app origin, redeemed by the browser at https://<id>.preview.<host>/__open?c=<code>. Ownership via getServablePreview (owned + active + unexpired + unrevoked); another user's preview is an opaque 404. Gate: requireAuth only — no API-key scope gate", category: "system", responseDescription: "{ code }" },
  { method: "POST", path: "/api/preview/consent", description: "Answer the expose-consent card ([Expose] / [Ignore] / [Always expose in this conversation]). The acting user IS the requester by construction — a userId is never taken from the wire. Gate: requireAuth only — no API-key scope gate", category: "system" },

  // ── Onboarding ────────────────────────────────────────────────────────
  { method: "POST", path: "/api/onboarding/complete", description: "Mark the CALLING user onboarded (204). Gate: requireAuth only — no API-key scope gate; the row written is the caller's own", category: "system" },
];
