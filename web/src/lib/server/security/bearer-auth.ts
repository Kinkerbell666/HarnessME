/**
 * Routes a `Bearer` token to the correct verifier (internal vs user-issued)
 * and, on success, mutates the event's `locals` so downstream handlers see
 * an authenticated principal. Extracted from `hooks.server.ts` so the
 * routing logic can be unit-tested in isolation.
 */

import type { ApiKeyScope } from "$lib/server/security/api-keys";
import { verifyApiKey } from "$lib/server/security/api-keys";
import type { AuthMethod } from "$server/auth/middleware";
import type { ToolPolicy } from "$server/auth/tool-policy";
import {
  INTERNAL_KEY_PREFIX,
  verifyInternalKey,
} from "$lib/server/security/internal-auth";
import { getUserById } from "$server/db/queries/users";
import { logger } from "$server/logger";
import { FACTORY_SERVICE_TOKEN_PREFIX, verifyFactoryServiceToken, type FactoryServiceScope, type FactoryServiceTokenClaims } from "$server/auth/factory-service-token";
import { factoryServiceRouteScope } from "$server/auth/factory-service-routes";
import { factoryBootConfig } from "$server/factory/boot";
import { getFactoryApplication } from "$server/factory/application";
import { getJwtSecret } from "$server/auth/jwt";

const log = logger.child("bearer-auth");

export interface BearerAuthEvent {
  locals: {
    user?: { id: string; email: string; name: string; role: string };
    apiKeyScopes?: ApiKeyScope[];
    /** Stamped by this module on success so downstream gates can allowlist
     *  the auth METHOD rather than infer it. Neither branch here is ever a
     *  human at a browser, so neither may clear a consent gate — see
     *  `requireSessionAuth` in `src/auth/middleware.ts`. */
    authMethod?: AuthMethod;
    /** WHICH key authenticated, stamped alongside `authMethod` so the two
     *  are never out of step. `authMethod` says a key was used; this says
     *  which one, and the pair is what `principalId` turns into a comparable
     *  identity for gate confinement. Never set on the cookie path. */
    apiKeyId?: string;
    /** The verifying key's tool policy, stamped ONLY when the key carries
     *  one. Its POSITIVE PRESENCE is what every downstream boundary binds on
     *  — the route allowlist in `hooks.server.ts`, the mode lock and the
     *  autopilot refusals on the run-start routes, the caller-tool
     *  declaration cap. A cookie session, an unpolicied key and an internal
     *  `ezkint_` principal all leave it undefined and are unchanged. */
    apiKeyToolPolicy?: ToolPolicy;
    factoryServicePrincipal?: FactoryServiceTokenClaims;
  };
  method?: string;
  routeId?: string | null;
  /** Remote IP as reported by the adapter; SvelteKit's `getClientAddress()`
   *  on the Bun adapter returns the direct socket peer. Critically: when
   *  the server sits behind a reverse proxy (nginx, Caddy, Traefik), this
   *  is ALWAYS the loopback address because the proxy terminates the
   *  connection. That's why the caller must also pass
   *  `proxyForwardedHeadersPresent` — if any hop added forwarding headers
   *  we cannot treat the peer as a trusted loopback subprocess. */
  remoteAddress: string | undefined;
  /** True if ANY proxy-forwarded header was observed on the request
   *  (x-forwarded-for, x-real-ip, forwarded). Set by hooks.server.ts at
   *  the top of the auth pipeline; derived, not user-supplied. */
  proxyForwardedHeadersPresent?: boolean;
  /** Value of the X-Ezcorp-On-Behalf-Of header, if present. Only honored
   *  when the Authorization header carries an internal-auth token — see
   *  attachBearerAuth for the gating rules. */
  onBehalfOfHeader?: string | null;
}

export interface FactoryServiceAuthDependencies {
  readonly scope: FactoryServiceScope | null;
  readonly secret: string;
  readonly installationId: string;
  authenticate(claims: FactoryServiceTokenClaims, scope: FactoryServiceScope): Promise<void>;
}

export async function attachFactoryServiceBearer(
  event: BearerAuthEvent,
  raw: string,
  dependencies: FactoryServiceAuthDependencies,
): Promise<boolean> {
  if (!dependencies.scope) return false;
  const claims = await verifyFactoryServiceToken(raw, dependencies.secret, dependencies.installationId);
  if (!claims) return false;
  await dependencies.authenticate(claims, dependencies.scope);
  event.locals.factoryServicePrincipal = claims;
  return true;
}

/** Attempts to authenticate a request by its `Authorization: Bearer …`
 *  header. No-ops when the header is missing, malformed, or points at a
 *  key that doesn't verify. Returns `true` when `event.locals.user` was
 *  populated by this call — the caller uses the flag only for diagnostics
 *  today, but exposing it makes testing the routing decisions trivial. */
export async function attachBearerAuth(
  event: BearerAuthEvent,
  authHeader: string | null | undefined,
  factoryServiceDependencies?: FactoryServiceAuthDependencies,
): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const raw = authHeader.slice(7);

  if (raw.startsWith(FACTORY_SERVICE_TOKEN_PREFIX)) {
    try {
      if (factoryServiceDependencies) return await attachFactoryServiceBearer(event, raw, factoryServiceDependencies);
      const scope = factoryServiceRouteScope(event.method ?? "", event.routeId);
      const application = getFactoryApplication();
      if (!scope || !factoryBootConfig.enabled || !factoryBootConfig.installationId || !application) return false;
      return await attachFactoryServiceBearer(event, raw, { scope, secret: await getJwtSecret(), installationId: factoryBootConfig.installationId, authenticate: (claims, requiredScope) => application.credentials.authenticate(claims, requiredScope).then(() => undefined) });
    } catch {
      return false;
    }
  }

  // Internal, bundled-extension keys route exclusively through
  // verifyInternalKey. On prefix-match we NEVER fall through to
  // verifyApiKey even if verification fails, because:
  //   - a non-loopback request carrying an internal-prefixed token must
  //     be indistinguishable from an unauth'd request (no DB probe, no
  //     timing signal about whether the prefix is special);
  //   - an internal key that fails verification is a client-side bug or
  //     an attack — we don't want it accidentally matching against the
  //     user-key hash table.
  if (raw.startsWith(INTERNAL_KEY_PREFIX)) {
    // Reverse-proxy defense: if ANY forwarding header was present on the
    // request, the peer address cannot be trusted as "truly local" —
    // nginx/Caddy/Traefik all terminate the remote connection and
    // reopen to 127.0.0.1, which would otherwise let a public-internet
    // attacker present an `ezkint_*` token and pass the loopback gate.
    // A genuine bundled-subprocess call loops back directly without any
    // HTTP proxy, so this header set is ALWAYS empty — rejecting on any
    // presence is fail-closed.
    if (event.proxyForwardedHeadersPresent) return false;
    const principal = verifyInternalKey(raw, event.remoteAddress);
    if (!principal) return false;

    // On-behalf-of override: the internal-auth principal (e.g. `sys-ai-kit`)
    // can request that a call execute AS a different, real user — but only
    // if every check below passes:
    //   1. The X-Ezcorp-On-Behalf-Of header is present.
    //   2. The header value is a non-empty string.
    //   3. It does NOT itself start with `sys-` (no chaining; only human
    //      users are targetable, so a compromised extension can't pivot
    //      across other system identities).
    //   4. A user row with that id exists in the DB (validates the target
    //      and keeps the conversations.user_id FK happy).
    //   5. The loopback check already ran inside verifyInternalKey; an
    //      external request can't even reach this branch.
    // On any failure, we fall back to the system principal's own userId —
    // the call still authenticates, but anything it writes is owned by
    // `sys-*`, preserving the invariant that unauthorized impersonation
    // attempts are a no-op rather than a privilege escalation.
    let effectiveUserId = principal.userId;
    let effectiveName = principal.name;
    // Trim first so a whitespace-only header is treated as absent — the
    // raw header comes straight from an HTTP request and could contain
    // stray whitespace from a proxy/rewrite.
    const obo = typeof event.onBehalfOfHeader === "string"
      ? event.onBehalfOfHeader.trim()
      : "";
    if (obo.length > 0 && !obo.startsWith("sys-")) {
      try {
        const target = await getUserById(obo);
        // Reject inactive (soft-banned) users — an admin who disabled a
        // user MUST continue to keep them out, even when a bundled
        // extension's call presents their id as an OBO target. A live
        // row with status !== "active" is treated as "no such user".
        if (target && target.status === "active") {
          effectiveUserId = target.id;
          // Keep the audit breadcrumb: the principal name records BOTH the
          // originating system identity AND the user being acted for.
          effectiveName = `${principal.name} on-behalf-of ${target.id}`;
          // Structured audit entry at the moment of elevation. No raw
          // key material is logged — only the metadata an operator
          // would need during incident response: which extension, which
          // target user, which keyId, and that it came from loopback
          // (implicit, since verifyInternalKey already gated that).
          log.info("internal-auth: on-behalf-of elevation", {
            extensionName: principal.extensionName,
            keyId: principal.keyId,
            targetUserId: target.id,
          });
        }
      } catch {
        // DB not available (shouldn't happen post-boot, but be defensive):
        // fall back to the system principal. No 401 — an internal call
        // that the server can't validate against the user table simply
        // runs as itself, which is safe.
      }
    }

    event.locals.user = {
      id: effectiveUserId,
      email: "",
      name: effectiveName,
      role: "member",
    };
    event.locals.apiKeyScopes = [...principal.scopes];
    event.locals.authMethod = "internal";
    event.locals.apiKeyId = principal.keyId;
    return true;
  }

  try {
    const keyData = await verifyApiKey(raw);
    if (!keyData) return false;

    // Owner re-validation. A key's role/ownership is snapshotted at MINT time,
    // so a since-demoted or since-banned owner would otherwise keep a live
    // admin key. Re-load the owner once per request (the session path gets
    // the same status check from lookupSessionByTokenHash, which matches only
    // an active user's session) and:
    //   1. reject the key outright if the owner is gone or not `active` — an
    //      admin who disables/deletes a user MUST kill that user's keys too;
    //   2. CLAMP the effective role DOWN to the owner's CURRENT role — the key
    //      is admin only while its owner is currently admin, so a demoted
    //      admin's key silently degrades to `member`.
    // Scopes are NOT clamped here (unchanged pre-existing semantics; the scope
    // ceiling is enforced at mint time).
    const owner = await getUserById(keyData.userId);
    if (owner?.status !== "active") return false;
    const effectiveRole =
      keyData.role === "admin" && owner.role === "admin" ? "admin" : "member";

    event.locals.user = {
      id: keyData.userId,
      email: "",
      name: keyData.name,
      // Role-carrying keys: the principal's role is the key's stored role
      // CLAMPED to the owner's current role (default `member`; `admin` only
      // for an explicitly minted admin key whose owner is still admin). This
      // is what makes requireRole(admin) routes reachable by an admin-role
      // key. NB: internal `ezkint_` keys are handled in the branch above and
      // stay `member` — they are subprocess identities, never admin principals.
      role: effectiveRole,
    };
    event.locals.apiKeyScopes = keyData.scopes;
    event.locals.authMethod = "api-key";
    event.locals.apiKeyId = keyData.keyId;
    // Assigned only when the row carried one, so an unpolicied key leaves the
    // field genuinely absent rather than explicitly undefined. Every boundary
    // downstream tests presence.
    if (keyData.toolPolicy) event.locals.apiKeyToolPolicy = keyData.toolPolicy;
    return true;
  } catch {
    // DB not available (e.g., PI_SKIP_INIT for unit tests) — fall through.
    return false;
  }
}
