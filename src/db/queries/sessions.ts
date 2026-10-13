import { eq, and, or, sql, lt, gt, desc, ne } from "drizzle-orm";
import { getDb, type DbTransaction } from "../connection";
import { sessions, users } from "../schema";
import type { Session } from "../schema";

export type { Session };

/**
 * Result of a token-hash lookup, including which hash it matched on.
 * `viaPrevious` is true when the inbound token matched `previous_token_hash`
 * within its grace window — the caller should NOT trigger another rotation
 * since the row was already rotated by a peer request.
 */
export interface SessionLookup {
  session: Session;
  viaPrevious: boolean;
}

/**
 * Hash a raw token string to SHA-256 hex for storage/lookup.
 */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(opts: {
  userId: string;
  tokenHash: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  expiresAt: Date;
}): Promise<Session> {
  const rows = await getDb()
    .insert(sessions)
    .values({
      userId: opts.userId,
      tokenHash: opts.tokenHash,
      userAgent: opts.userAgent ?? null,
      ipAddress: opts.ipAddress ?? null,
      expiresAt: opts.expiresAt,
    })
    .returning();
  return rows[0]!;
}

export async function getSessionByTokenHash(tokenHash: string): Promise<Session | null> {
  const lookup = await lookupSessionByTokenHash(tokenHash);
  return lookup?.session ?? null;
}

/**
 * Lookup that also reports whether the match came via the rotation-grace
 * `previous_token_hash` column. Hooks use this to suppress a re-rotation
 * when another concurrent request just rotated the row.
 *
 * Only a session of an ACTIVE user matches. The hook reads "no match" as a
 * revoked session, so a deactivated user is refused in this same query
 * rather than by a second per-request user read.
 */
export async function lookupSessionByTokenHash(tokenHash: string): Promise<SessionLookup | null> {
  const rows = await getDb()
    .select()
    .from(sessions)
    .where(
      and(
        or(
          eq(sessions.tokenHash, tokenHash),
          and(
            eq(sessions.previousTokenHash, tokenHash),
            gt(sessions.previousTokenExpiresAt, sql`NOW()`),
          ),
        ),
        sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${sessions.userId} AND ${users.status} = 'active')`,
      ),
    );
  const row = rows[0];
  if (!row) return null;
  return { session: row, viaPrevious: row.tokenHash !== tokenHash };
}

export async function revokeSession(id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(sessions)
    .where(eq(sessions.id, id))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

/**
 * Revoke every session of a user. `keepSessionId` spares the caller's own
 * session (self-service password change); `tx` lets the revocation commit
 * with the account change that requires it.
 */
export async function revokeAllUserSessions(
  userId: string,
  opts: { keepSessionId?: string; tx?: DbTransaction } = {},
): Promise<number> {
  const rows = await (opts.tx ?? getDb())
    .delete(sessions)
    .where(and(
      eq(sessions.userId, userId),
      opts.keepSessionId ? ne(sessions.id, opts.keepSessionId) : undefined,
    ))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function listSessionsByUser(userId: string): Promise<Session[]> {
  return getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt));
}

export async function listAllSessions() {
  return getDb()
    .select({
      id: sessions.id,
      userId: sessions.userId,
      tokenHash: sessions.tokenHash,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      expiresAt: sessions.expiresAt,
      lastActiveAt: sessions.lastActiveAt,
      createdAt: sessions.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(sessions)
    .leftJoin(users, eq(sessions.userId, users.id))
    .orderBy(desc(sessions.createdAt));
}

/**
 * Update last_active_at, throttled to avoid write amplification.
 * Only writes if last update was more than `throttleMs` ago.
 */
export async function touchSession(id: string, throttleMs = 60_000): Promise<Session | null> {
  const rows = await getDb()
    .update(sessions)
    .set({ lastActiveAt: sql`NOW()` })
    .where(
      and(
        eq(sessions.id, id),
        lt(sessions.lastActiveAt, sql`NOW() - make_interval(secs => ${throttleMs} / 1000.0)`),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Atomically rotate a session's token hash and extend its expiry.
 *
 * Used by the sliding-refresh path in hooks.server.ts: when a JWT crosses the
 * refresh threshold we re-issue it and want the DB row to point at the new
 * hash. The match on `oldTokenHash` is the CAS predicate — if a concurrent
 * request already rotated the row, we lose silently (returns null) and the
 * caller leaves the inbound cookie alone.
 */
export async function rotateSessionToken(opts: {
  id: string;
  oldTokenHash: string;
  newTokenHash: string;
  newExpiresAt: Date;
  /**
   * How long the previous (pre-rotation) hash should keep validating.
   * Bridges concurrent in-flight requests that still carry the old cookie
   * across the rotation. See `lookupSessionByTokenHash` and the sliding
   * refresh path in `web/src/hooks.server.ts`.
   */
  previousTokenGraceSeconds: number;
}): Promise<Session | null> {
  const previousTokenExpiresAt = new Date(Date.now() + opts.previousTokenGraceSeconds * 1000);
  const rows = await getDb()
    .update(sessions)
    .set({
      tokenHash: opts.newTokenHash,
      expiresAt: opts.newExpiresAt,
      previousTokenHash: opts.oldTokenHash,
      previousTokenExpiresAt,
    })
    .where(and(eq(sessions.id, opts.id), eq(sessions.tokenHash, opts.oldTokenHash)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteExpiredSessions(): Promise<number> {
  const rows = await getDb()
    .delete(sessions)
    .where(lt(sessions.expiresAt, sql`NOW()`))
    .returning({ id: sessions.id });
  return rows.length;
}
