import { eq } from "drizzle-orm";
import { getDb } from "../connection";
import type { DbTransaction } from "../connection";
import { agentConfigs, users } from "../schema";
import { insertAuditEntry } from "./audit-log";
import { revokeAllUserSessions } from "./sessions";

/**
 * Atomically deactivate a user and transfer their agents to the acting
 * admin.
 *
 * The pre-fix route did this as an unguarded two-step: a raw
 * `agentConfigs` UPDATE in the handler followed by a separate
 * `updateUserStatus` call. A crash or DB error between the two left the
 * agents silently reassigned while the target user stayed fully ACTIVE.
 * Here both state mutations run inside ONE transaction so they commit
 * together or not at all — no partial state is observable.
 *
 * The `user:deactivated` audit row is written AFTER the transaction
 * commits, on purpose:
 *   - `insertAuditEntry` is the single redaction chokepoint (see
 *     `audit-log.ts`) — the codebase forbids any other direct
 *     audit-table insert call site, so the audit write cannot move inside
 *     the `tx` without going through that wrapper, and the wrapper uses
 *     the top-level connection.
 *   - By contract an audit-write failure MUST NEVER abort (here: roll
 *     back) the business operation. The audit row is a log, not state;
 *     losing it on a crash does not corrupt the invariant the transaction
 *     protects (user status ⇔ agent ownership stay consistent).
 *
 * Works on both drivers (PGlite embedded + Bun.sql external Postgres):
 * drizzle exposes `.transaction()` for each, matching the existing
 * transactional writes in `conversations.ts`.
 *
 * @returns `true` if the target user existed (status was flipped),
 *   `false` otherwise. The audit row is still written on `false` so an
 *   attempted deactivation of a missing user is auditable, mirroring the
 *   pre-fix behaviour.
 */
export async function deactivateUserAndTransferAgents(
  targetUserId: string,
  adminId: string,
): Promise<boolean> {
  // `tx` is `any` by the deliberate repo-wide `Database = any` design in
  // connection.ts (see the same annotation in conversations.ts).
  const existed: boolean = await getDb().transaction(async (tx: DbTransaction) => {
    await tx
      .update(agentConfigs)
      .set({ userId: adminId, updatedAt: new Date() })
      .where(eq(agentConfigs.userId, targetUserId));

    const updated = await tx
      .update(users)
      .set({ status: "inactive" })
      .where(eq(users.id, targetUserId))
      .returning();

    // The session cookie path never re-reads users.status, so an open browser
    // keeps access until its session row is gone.
    await revokeAllUserSessions(targetUserId, { tx });

    return updated.length > 0;
  });

  await insertAuditEntry(adminId, "user:deactivated", targetUserId);
  return existed;
}
