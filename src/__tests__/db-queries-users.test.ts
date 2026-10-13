import { test, expect, describe, beforeEach, afterAll } from "bun:test";
import { setupTestDb, closeTestDb, mockDbConnection } from "./helpers/test-pglite";

mockDbConnection();

const {
  createUser,
  getUserByEmail,
  getUserById,
  getUsersByIds,
  listUsers,
  updateUserStatus,
  updateUserPassword,
  updateUserEmail,
  updateUserName,
  getUserCount,
  markUserOnboarded,
} = await import("../db/queries/users");
const { createSession, listSessionsByUser } = await import("../db/queries/sessions");

describe("users queries", () => {
  beforeEach(async () => await setupTestDb());
  afterAll(async () => await closeTestDb());

  test("createUser inserts and returns row with defaults", async () => {
    const u = await createUser({
      email: "alice@test.com",
      passwordHash: "hash-1",
      name: "Alice",
    });

    expect(u.id).toBeDefined();
    expect(u.email).toBe("alice@test.com");
    expect(u.passwordHash).toBe("hash-1");
    expect(u.name).toBe("Alice");
    expect(u.role).toBe("member");
    expect(u.status).toBe("active");
    expect(u.createdAt).toBeInstanceOf(Date);
  });

  test("createUser accepts admin role", async () => {
    const u = await createUser({
      email: "admin@test.com",
      passwordHash: "hash-a",
      name: "Admin",
      role: "admin",
    });
    expect(u.role).toBe("admin");
  });

  test("createUser with duplicate email throws (unique constraint)", async () => {
    await createUser({ email: "dupe@test.com", passwordHash: "h", name: "First" });
    await expect(
      createUser({ email: "dupe@test.com", passwordHash: "h2", name: "Second" }),
    ).rejects.toThrow();
  });

  test("getUserByEmail returns user, lowercases lookup", async () => {
    await createUser({ email: "bob@test.com", passwordHash: "h", name: "Bob" });
    const byLower = await getUserByEmail("bob@test.com");
    const byUpper = await getUserByEmail("BOB@TEST.COM");
    expect(byLower).toBeDefined();
    expect(byUpper).toBeDefined();
    expect(byLower!.id).toBe(byUpper!.id);
    expect(byLower!.name).toBe("Bob");
  });

  test("getUserByEmail returns undefined for missing email", async () => {
    const result = await getUserByEmail("ghost@test.com");
    expect(result).toBeUndefined();
  });

  test("getUserById returns user", async () => {
    const created = await createUser({ email: "c@test.com", passwordHash: "h", name: "Carol" });
    const found = await getUserById(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.email).toBe("c@test.com");
  });

  test("getUserById returns undefined for missing id", async () => {
    const result = await getUserById(crypto.randomUUID());
    expect(result).toBeUndefined();
  });

  describe("getUsersByIds (batched)", () => {
    test("returns an empty map for an empty id list (no query)", async () => {
      const result = await getUsersByIds([]);
      expect(result.size).toBe(0);
    });

    test("maps every id to its user, missing ids to null", async () => {
      const a = await createUser({ email: "ba@test.com", passwordHash: "h", name: "BA" });
      const b = await createUser({ email: "bb@test.com", passwordHash: "h", name: "BB" });
      const ghost = crypto.randomUUID();

      const result = await getUsersByIds([a.id, b.id, ghost]);
      expect(result.size).toBe(3);
      expect(result.get(a.id)!.email).toBe("ba@test.com");
      expect(result.get(b.id)!.name).toBe("BB");
      expect(result.get(ghost)).toBeNull();
    });

    test("dedupes the IN list but keys the map by every input id (incl. duplicates)", async () => {
      const a = await createUser({ email: "dup@test.com", passwordHash: "h", name: "Dup" });
      const result = await getUsersByIds([a.id, a.id]);
      // Duplicate input id collapses to a single map key, still resolved.
      expect(result.size).toBe(1);
      expect(result.get(a.id)!.id).toBe(a.id);
    });
  });

  test("listUsers returns all users", async () => {
    await createUser({ email: "x@test.com", passwordHash: "h", name: "X" });
    await createUser({ email: "y@test.com", passwordHash: "h", name: "Y" });
    const all = await listUsers();
    expect(all.length).toBe(2);
    const emails = all.map((u) => u.email).sort();
    expect(emails).toEqual(["x@test.com", "y@test.com"]);
  });

  test("getUserCount returns count", async () => {
    expect(await getUserCount()).toBe(0);
    await createUser({ email: "c1@test.com", passwordHash: "h", name: "C1" });
    await createUser({ email: "c2@test.com", passwordHash: "h", name: "C2" });
    expect(await getUserCount()).toBe(2);
  });

  test("getUserCount excludes synthetic system users (id `sys-*`)", async () => {
    // Synthetic system users (e.g. ai-kit's `sys-ai-kit`) must not count
    // toward the first-run gate, otherwise a fresh instance with bundled
    // extensions never reaches /setup. UUIDs never start with "sys".
    await createUser({
      id: "sys-ai-kit",
      email: "ai-kit@sys.ezcorp.invalid",
      passwordHash: "x",
      name: "System: ai-kit",
    });
    expect(await getUserCount()).toBe(0);
    await createUser({ email: "human@test.com", passwordHash: "h", name: "Human" });
    expect(await getUserCount()).toBe(1);
  });

  test("updateUserStatus flips active/inactive", async () => {
    const u = await createUser({ email: "s@test.com", passwordHash: "h", name: "Stat" });
    expect(u.status).toBe("active");

    const ok = await updateUserStatus(u.id, "inactive");
    expect(ok).toBe(true);

    const updated = await getUserById(u.id);
    expect(updated!.status).toBe("inactive");

    const ok2 = await updateUserStatus(u.id, "active");
    expect(ok2).toBe(true);
    expect((await getUserById(u.id))!.status).toBe("active");
  });

  test("updateUserStatus returns false for missing user", async () => {
    const result = await updateUserStatus(crypto.randomUUID(), "inactive");
    expect(result).toBe(false);
  });

  test("updateUserPassword replaces hash", async () => {
    const u = await createUser({ email: "p@test.com", passwordHash: "old", name: "Pass" });
    const ok = await updateUserPassword(u.id, "new-hash");
    expect(ok).toBe(true);
    const updated = await getUserById(u.id);
    expect(updated!.passwordHash).toBe("new-hash");
  });

  test("updateUserPassword revokes every session of that user only", async () => {
    const u = await createUser({ email: "p2@test.com", passwordHash: "old", name: "Pass" });
    const other = await createUser({ email: "p3@test.com", passwordHash: "old", name: "Other" });
    const expiresAt = new Date(Date.now() + 3_600_000);
    await createSession({ userId: u.id, tokenHash: "pw-a", expiresAt });
    await createSession({ userId: u.id, tokenHash: "pw-b", expiresAt });
    const kept = await createSession({ userId: other.id, tokenHash: "pw-other", expiresAt });

    expect(await updateUserPassword(u.id, "new-hash")).toBe(true);

    expect(await listSessionsByUser(u.id)).toEqual([]);
    expect((await listSessionsByUser(other.id)).map((s) => s.id)).toEqual([kept.id]);
  });

  test("updateUserPassword keeps the caller's session and revokes the others", async () => {
    const u = await createUser({ email: "p4@test.com", passwordHash: "old", name: "Pass" });
    const expiresAt = new Date(Date.now() + 3_600_000);
    const current = await createSession({ userId: u.id, tokenHash: "pw-current", expiresAt });
    await createSession({ userId: u.id, tokenHash: "pw-stolen", expiresAt });

    expect(await updateUserPassword(u.id, "new-hash", { keepSessionId: current.id })).toBe(true);

    expect((await listSessionsByUser(u.id)).map((s) => s.id)).toEqual([current.id]);
  });

  test("updateUserPassword returns false for missing user", async () => {
    const result = await updateUserPassword(crypto.randomUUID(), "new");
    expect(result).toBe(false);
  });

  test("updateUserEmail lowercases", async () => {
    const u = await createUser({ email: "e@test.com", passwordHash: "h", name: "E" });
    const ok = await updateUserEmail(u.id, "NEW@TEST.COM");
    expect(ok).toBe(true);
    const updated = await getUserById(u.id);
    expect(updated!.email).toBe("new@test.com");
  });

  test("updateUserEmail returns false for missing user", async () => {
    const result = await updateUserEmail(crypto.randomUUID(), "x@test.com");
    expect(result).toBe(false);
  });

  test("updateUserName updates name", async () => {
    const u = await createUser({ email: "n@test.com", passwordHash: "h", name: "Old" });
    const ok = await updateUserName(u.id, "New");
    expect(ok).toBe(true);
    const updated = await getUserById(u.id);
    expect(updated!.name).toBe("New");
  });

  test("updateUserName returns false for missing user", async () => {
    const result = await updateUserName(crypto.randomUUID(), "x");
    expect(result).toBe(false);
  });

  test("createUser leaves onboardedAt null by default", async () => {
    const u = await createUser({ email: "fresh@test.com", passwordHash: "h", name: "Fresh" });
    expect(u.onboardedAt).toBeNull();
    const found = await getUserById(u.id);
    expect(found!.onboardedAt).toBeNull();
  });

  test("markUserOnboarded sets onboardedAt to current time", async () => {
    const u = await createUser({ email: "onb@test.com", passwordHash: "h", name: "Onb" });
    expect(u.onboardedAt).toBeNull();

    const ok = await markUserOnboarded(u.id);
    expect(ok).toBe(true);

    const after = await getUserById(u.id);
    expect(after!.onboardedAt).toBeInstanceOf(Date);
    // Sanity: stamp is recent (last 5 seconds).
    expect(Date.now() - after!.onboardedAt!.getTime()).toBeLessThan(5_000);
  });

  test("markUserOnboarded is first-write-wins — second call returns false, timestamp unchanged", async () => {
    const u = await createUser({ email: "idem@test.com", passwordHash: "h", name: "Idem" });
    const firstOk = await markUserOnboarded(u.id);
    expect(firstOk).toBe(true);
    const first = (await getUserById(u.id))!.onboardedAt!;
    // Sleep so any incidental re-write would produce a later NOW().
    await new Promise((r) => setTimeout(r, 10));
    const secondOk = await markUserOnboarded(u.id);
    // First-write-wins: second call matches no rows (WHERE onboarded_at IS NULL).
    expect(secondOk).toBe(false);
    const second = (await getUserById(u.id))!.onboardedAt!;
    expect(second.getTime()).toBe(first.getTime());
  });

  test("markUserOnboarded returns false for missing user", async () => {
    const result = await markUserOnboarded(crypto.randomUUID());
    expect(result).toBe(false);
  });
});
