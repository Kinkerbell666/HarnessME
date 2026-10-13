/**
 * Security regression (db-audit/security-web) for the admin
 * user-deactivation write path.
 *
 * Pre-fix the route did a raw in-handler agentConfigs UPDATE followed by a
 * SEPARATE updateUserStatus call — no transaction — so a failure between
 * them could leave a user ACTIVE while all their agents had silently moved
 * to the admin. The fix routes both writes through
 * deactivateUserAndTransferAgents, which commits them in ONE transaction
 * (audit row follows). These tests exercise the new query module against a
 * real PGlite instance.
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { restoreModuleMocks } from "./helpers/mock-cleanup";
import { setupTestDb, closeTestDb, mockDbConnection, getTestDb } from "./helpers/test-pglite";

mockDbConnection();

const { deactivateUserAndTransferAgents } = await import(
  "../db/queries/user-deactivation"
);
const { createUser, getUserById, updateUserStatus } = await import("../db/queries/users");
const { listAuditLog } = await import("../db/queries/audit-log");
const { createSession, listSessionsByUser, lookupSessionByTokenHash } = await import(
  "../db/queries/sessions"
);
const { agentConfigs } = await import("../db/schema");
const { eq } = await import("drizzle-orm");

let adminId: string;
let memberId: string;

beforeAll(async () => {
  await setupTestDb();
  const admin = await createUser({
    email: "deact-admin@example.com",
    passwordHash: "hashed",
    name: "Deact Admin",
    role: "admin",
    status: "active",
  });
  adminId = admin.id;
});

beforeEach(async () => {
  const member = await createUser({
    email: `deact-member-${crypto.randomUUID()}@example.com`,
    passwordHash: "hashed",
    name: "Deact Member",
    role: "member",
    status: "active",
  });
  memberId = member.id;
});

afterAll(async () => {
  restoreModuleMocks();
  await closeTestDb();
});

describe("deactivateUserAndTransferAgents", () => {
  test("transfers agents, flips status to inactive, and writes the audit row atomically", async () => {
    const db = getTestDb();
    const agentId = crypto.randomUUID();
    await db.insert(agentConfigs).values({
      id: agentId,
      name: `deact-agent-${agentId.slice(0, 8)}`,
      prompt: "p",
      userId: memberId,
    });

    const existed = await deactivateUserAndTransferAgents(memberId, adminId);
    expect(existed).toBe(true);

    // Agent now owned by the admin.
    const rows = await db.select().from(agentConfigs).where(eq(agentConfigs.id, agentId));
    expect(rows[0]!.userId).toBe(adminId);

    // User is inactive.
    const updated = await getUserById(memberId);
    expect(updated!.status).toBe("inactive");

    // Audit row written targeting the member.
    const audits = await listAuditLog({ action: "user:deactivated" });
    expect(audits.some((a) => a.target === memberId && a.userId === adminId)).toBe(true);
  });

  test("returns false for a nonexistent target (no user row to flip)", async () => {
    const existed = await deactivateUserAndTransferAgents(
      "00000000-0000-0000-0000-000000000000",
      adminId,
    );
    expect(existed).toBe(false);
  });

  test("revokes every session of the target, so an open browser loses access", async () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    await createSession({ userId: memberId, tokenHash: `deact-a-${memberId}`, expiresAt });
    await createSession({ userId: memberId, tokenHash: `deact-b-${memberId}`, expiresAt });
    const adminSession = await createSession({ userId: adminId, tokenHash: `deact-admin-${memberId}`, expiresAt });

    await deactivateUserAndTransferAgents(memberId, adminId);

    expect(await listSessionsByUser(memberId)).toEqual([]);
    expect((await listSessionsByUser(adminId)).map((s) => s.id)).toContain(adminSession.id);
  });

  test("a session row of an inactive user no longer authenticates", async () => {
    // The hook treats a missing lookup as a revoked session. A row that
    // survives (e.g. status flipped outside deactivation) must not count.
    const expiresAt = new Date(Date.now() + 3_600_000);
    const tokenHash = `inactive-${memberId}`;
    await createSession({ userId: memberId, tokenHash, expiresAt });
    expect(await lookupSessionByTokenHash(tokenHash)).not.toBeNull();

    await updateUserStatus(memberId, "inactive");

    expect(await lookupSessionByTokenHash(tokenHash)).toBeNull();
  });

  test("with no agents owned by the target, still deactivates the user", async () => {
    const existed = await deactivateUserAndTransferAgents(memberId, adminId);
    expect(existed).toBe(true);
    const updated = await getUserById(memberId);
    expect(updated!.status).toBe("inactive");
  });
});
