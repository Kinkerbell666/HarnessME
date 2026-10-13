import { test, expect, describe, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { restoreModuleMocks } from "./helpers/mock-cleanup";
import { setupTestDb, closeTestDb, getTestDb, mockDbConnection } from "./helpers/test-pglite";
import { mockServerAlias, createMockEvent, jsonFromResponse } from "./helpers/mock-request";

// ── Module-level mocks (BEFORE handler imports) ──────────────────
mockDbConnection();
mockServerAlias();

mock.module("../../web/src/routes/api/account/$types", () => ({}));
mock.module("../../web/src/routes/api/account/password/$types", () => ({}));
mock.module("$lib/server/security/validation", () =>
  require("../../web/src/lib/server/security/validation"),
);

// ── Handler imports ──────────────────────────────────────────────
import { GET as accountGet, PUT as accountPut } from "../../web/src/routes/api/account/+server";
import { PUT as passwordPut } from "../../web/src/routes/api/account/password/+server";

// ── DB helpers ───────────────────────────────────────────────────
import { users, auditLog } from "../db/schema";
import { createSession, listSessionsByUser } from "../db/queries/sessions";
import { hashPassword, verifyPassword } from "../auth/password";
import type { AuthUser } from "../auth/types";

let testUserId: string;
let testUser: AuthUser;

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  restoreModuleMocks();
  await closeTestDb();
});

beforeEach(async () => {
  const db = getTestDb();
  await db.delete(auditLog);
  await db.delete(users);

  const hash = await hashPassword("password123");
  const [user] = await db.insert(users).values({
    email: "user@test.local",
    passwordHash: hash,
    name: "Test User",
    role: "member",
  }).returning();
  testUserId = user!.id;
  testUser = { id: testUserId, email: "user@test.local", name: "Test User", role: "member" };
});

// ── GET /api/account ─────────────────────────────────────────────

describe("GET /api/account", () => {
  test("returns user profile for authenticated user", async () => {
    const event = createMockEvent({
      url: "http://localhost/api/account",
      user: testUser,
    });

    const res = await accountGet(event);
    expect(res.status).toBe(200);

    const data = await jsonFromResponse(res);
    expect(data.id).toBe(testUserId);
    expect(data.email).toBe("user@test.local");
    expect(data.name).toBe("Test User");
    expect(data.role).toBe("member");
    expect(data.createdAt).toBeDefined();
  });

  test("returns 401 for unauthenticated request", async () => {
    const event = createMockEvent({
      url: "http://localhost/api/account",
    });

    let res: Response;
    try {
      res = await accountGet(event);
    } catch (e) {
      res = e as Response;
    }
    expect(res.status).toBe(401);
  });
});

// ── PUT /api/account (update profile) ────────────────────────────

describe("PUT /api/account", () => {
  test("updates display name without password", async () => {
    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account",
      body: { name: "New Name" },
      user: testUser,
    });

    const res = await accountPut(event);
    expect(res.status).toBe(200);

    const data = await jsonFromResponse(res);
    expect(data.name).toBe("New Name");
    expect(data.email).toBe("user@test.local");
  });

  test("updates email with current password", async () => {
    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account",
      body: { email: "new@test.local", currentPassword: "password123" },
      user: testUser,
    });

    const res = await accountPut(event);
    expect(res.status).toBe(200);

    const data = await jsonFromResponse(res);
    expect(data.email).toBe("new@test.local");
  });

  test("rejects email change without password", async () => {
    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account",
      body: { email: "new@test.local" },
      user: testUser,
    });

    const res = await accountPut(event);
    expect(res.status).toBe(400);

    const data = await jsonFromResponse(res);
    expect(data.error).toBe("Current password is required to change email");
  });

  test("rejects email change with wrong password", async () => {
    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account",
      body: { email: "new@test.local", currentPassword: "wrongpassword" },
      user: testUser,
    });

    const res = await accountPut(event);
    expect(res.status).toBe(400);

    const data = await jsonFromResponse(res);
    expect(data.error).toBe("Current password is incorrect");
  });

  test("returns 400 when nothing to update", async () => {
    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account",
      body: {},
      user: testUser,
    });

    const res = await accountPut(event);
    expect(res.status).toBe(400);

    const data = await jsonFromResponse(res);
    expect(data.error).toBe("Nothing to update");
  });

  test("creates audit log entry for name change", async () => {
    const db = getTestDb();
    await db.delete(auditLog);

    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account",
      body: { name: "Updated Name" },
      user: testUser,
    });

    await accountPut(event);

    const logs = await db.select().from(auditLog);
    const nameLog = logs.find(l => l.action === "auth:name_changed");
    expect(nameLog).toBeDefined();
  });

  test("creates audit log entry for email change", async () => {
    const db = getTestDb();
    await db.delete(auditLog);

    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account",
      body: { email: "changed@test.local", currentPassword: "password123" },
      user: testUser,
    });

    await accountPut(event);

    const logs = await db.select().from(auditLog);
    const emailLog = logs.find(l => l.action === "auth:email_changed");
    expect(emailLog).toBeDefined();
  });
});

// ── PUT /api/account/password ────────────────────────────────────

describe("PUT /api/account/password", () => {
  test("changes password with correct current password", async () => {
    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account/password",
      body: { currentPassword: "password123", newPassword: "NewPassword456" },
      user: testUser,
    });

    const res = await passwordPut(event);
    expect(res.status).toBe(200);

    const data = await jsonFromResponse(res);
    expect(data.success).toBe(true);
    expect(data.message).toContain("Password changed");

    // Verify password actually changed in DB
    const db = getTestDb();
    const [row] = await db.select().from(users);
    const matches = await verifyPassword("NewPassword456", row!.passwordHash);
    expect(matches).toBe(true);
  });

  test("rejects wrong current password", async () => {
    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account/password",
      body: { currentPassword: "wrongpassword", newPassword: "NewPassword456" },
      user: testUser,
    });

    const res = await passwordPut(event);
    expect(res.status).toBe(400);

    const data = await jsonFromResponse(res);
    expect(data.error).toBe("Current password is incorrect");
  });

  test("rejects short new password", async () => {
    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account/password",
      body: { currentPassword: "password123", newPassword: "short" },
      user: testUser,
    });

    const res = await passwordPut(event);
    expect(res.status).toBe(400);
  });

  test("keeps the current session and its cookie, and revokes the user's other sessions", async () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    const current = await createSession({ userId: testUserId, tokenHash: `pw-current-${crypto.randomUUID()}`, expiresAt });
    const other = await createSession({ userId: testUserId, tokenHash: `pw-other-${crypto.randomUUID()}`, expiresAt });
    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account/password",
      body: { currentPassword: "password123", newPassword: "NewPassword456" },
      user: testUser,
      cookies: { ezcorp_session: "some-session-token" },
    });
    event.locals.sessionId = current.id;

    const res = await passwordPut(event);

    expect(res.status).toBe(200);
    expect(event.cookies.get("ezcorp_session")).toBe("some-session-token");
    const remaining = (await listSessionsByUser(testUserId)).map((session) => session.id);
    expect(remaining).toContain(current.id);
    expect(remaining).not.toContain(other.id);
  });

  test("returns 401 for unauthenticated request", async () => {
    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account/password",
      body: { currentPassword: "password123", newPassword: "NewPassword456" },
    });

    let res: Response;
    try {
      res = await passwordPut(event);
    } catch (e) {
      res = e as Response;
    }
    expect(res.status).toBe(401);
  });

  test("creates audit log entry", async () => {
    const db = getTestDb();
    await db.delete(auditLog);

    const event = createMockEvent({
      method: "PUT",
      url: "http://localhost/api/account/password",
      body: { currentPassword: "password123", newPassword: "NewPassword456" },
      user: testUser,
    });

    await passwordPut(event);

    const logs = await db.select().from(auditLog);
    const pwLog = logs.find(l => l.action === "auth:password_changed");
    expect(pwLog).toBeDefined();
  });
});
