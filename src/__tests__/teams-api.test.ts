import { test, expect, describe, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { restoreModuleMocks } from "./helpers/mock-cleanup";
import { setupTestDb, closeTestDb, mockDbConnection } from "./helpers/test-pglite";
import { mockServerAlias, createMockEvent, jsonFromResponse } from "./helpers/mock-request";
import type { AuthUser } from "../auth/types";

// ── Module-level mocks (BEFORE handler imports) ──────────────────
mockDbConnection();
mockServerAlias();

// Mock $types (type-only in source, but guard against resolution errors)
for (const path of [
  "../../web/src/routes/api/teams/$types",
  "../../web/src/routes/api/teams/[id]/$types",
  "../../web/src/routes/api/teams/[id]/members/$types",
]) {
  mock.module(path, () => ({}));
}

// ── Handler imports ──────────────────────────────────────────────
import { GET as teamsGet, POST as teamsPost } from "../../web/src/routes/api/teams/+server";
import { GET as teamGet, PUT as teamPut, DELETE as teamDelete } from "../../web/src/routes/api/teams/[id]/+server";
import { GET as membersGet, POST as membersPost, DELETE as membersDelete } from "../../web/src/routes/api/teams/[id]/members/+server";

// ── Query helpers for test setup ─────────────────────────────────
import { createUser } from "../db/queries/users";
import { createTeam, addTeamMember } from "../db/queries/teams";
import { teams, teamMembers } from "../db/schema";
import { getTestDb } from "./helpers/test-pglite";

// ── Test fixtures ────────────────────────────────────────────────
let adminUser: AuthUser;
let memberUser: AuthUser;
let adminDbId: string;
let memberDbId: string;

beforeAll(async () => {
  await setupTestDb();

  // Create real DB users so requireTeamRole can find memberships
  const admin = await createUser({
    email: "admin@teams-test.local",
    passwordHash: "hashed",
    name: "Admin User",
    role: "admin",
  });
  adminDbId = admin.id;
  adminUser = { id: admin.id, email: admin.email, name: admin.name, role: "admin" };

  const member = await createUser({
    email: "member@teams-test.local",
    passwordHash: "hashed",
    name: "Member User",
    role: "member",
  });
  memberDbId = member.id;
  memberUser = { id: member.id, email: member.email, name: member.name, role: "member" };
});

afterAll(async () => {
  restoreModuleMocks();
  await closeTestDb();
});

beforeEach(async () => {
  const db = getTestDb();
  await db.delete(teamMembers);
  await db.delete(teams);
});

// ── GET /api/teams ───────────────────────────────────────────────
describe("GET /api/teams", () => {
  test("admin sees all teams", async () => {
    await createTeam("Alpha");
    await createTeam("Bravo");

    const event = createMockEvent({ user: adminUser });
    const res = await teamsGet(event);
    expect(res.status).toBe(200);

    const body = await jsonFromResponse(res);
    expect(body.teams).toHaveLength(2);
    expect(body.teams.map((t: any) => t.name).sort()).toEqual(["Alpha", "Bravo"]);
  });

  test("member sees only own teams", async () => {
    const teamA = await createTeam("Alpha");
    await createTeam("Bravo");
    await addTeamMember(teamA.id, memberDbId, "viewer");

    const event = createMockEvent({ user: memberUser });
    const res = await teamsGet(event);
    expect(res.status).toBe(200);

    const body = await jsonFromResponse(res);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].name).toBe("Alpha");
  });
});

// ── POST /api/teams ──────────────────────────────────────────────
describe("POST /api/teams", () => {
  test("admin creates team (201)", async () => {
    const event = createMockEvent({
      method: "POST",
      user: adminUser,
      body: { name: "New Team" },
    });
    const res = await teamsPost(event);
    expect(res.status).toBe(201);

    const body = await jsonFromResponse(res);
    expect(body.team.name).toBe("New Team");
    expect(body.team.id).toBeTruthy();
  });

  test("member gets 403", async () => {
    const event = createMockEvent({
      method: "POST",
      user: memberUser,
      body: { name: "Forbidden Team" },
    });
    const res = await teamsPost(event);
    expect(res.status).toBe(403);
  });

  test("rejects empty name (400)", async () => {
    const event = createMockEvent({
      method: "POST",
      user: adminUser,
      body: { name: "  " },
    });
    const res = await teamsPost(event);
    expect(res.status).toBe(400);
  });
});

// ── GET /api/teams/[id] ─────────────────────────────────────────
describe("GET /api/teams/[id]", () => {
  test("team member can view team details", async () => {
    const team = await createTeam("Viewable");
    await addTeamMember(team.id, memberDbId, "viewer");

    const event = createMockEvent({
      user: memberUser,
      params: { id: team.id },
    });
    const res = await teamGet(event);
    expect(res.status).toBe(200);

    const body = await jsonFromResponse(res);
    expect(body.team.name).toBe("Viewable");
    expect(body.members).toBeInstanceOf(Array);
  });

  test("non-member gets 403", async () => {
    const team = await createTeam("Secret");

    const event = createMockEvent({
      user: memberUser,
      params: { id: team.id },
    });
    const res = await teamGet(event);
    expect(res.status).toBe(403);
  });
});

// ── PUT /api/teams/[id] ─────────────────────────────────────────
describe("PUT /api/teams/[id]", () => {
  test("owner can update team name", async () => {
    const team = await createTeam("Old Name");
    await addTeamMember(team.id, memberDbId, "owner");

    const event = createMockEvent({
      method: "PUT",
      user: memberUser,
      params: { id: team.id },
      body: { name: "New Name" },
    });
    const res = await teamPut(event);
    expect(res.status).toBe(200);

    const body = await jsonFromResponse(res);
    expect(body.team.name).toBe("New Name");
  });

  test("non-owner member gets 403", async () => {
    const team = await createTeam("Protected");
    await addTeamMember(team.id, memberDbId, "viewer");

    const event = createMockEvent({
      method: "PUT",
      user: memberUser,
      params: { id: team.id },
      body: { name: "Hijacked" },
    });
    const res = await teamPut(event);
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/teams/[id] ───────────────────────────────────────
describe("DELETE /api/teams/[id]", () => {
  test("admin can delete team", async () => {
    const team = await createTeam("Doomed");

    const event = createMockEvent({
      method: "DELETE",
      user: adminUser,
      params: { id: team.id },
    });
    const res = await teamDelete(event);
    expect(res.status).toBe(200);

    const body = await jsonFromResponse(res);
    expect(body.success).toBe(true);
  });

  test("member gets 403", async () => {
    const team = await createTeam("Guarded");

    const event = createMockEvent({
      method: "DELETE",
      user: memberUser,
      params: { id: team.id },
    });
    const res = await teamDelete(event);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/teams/[id]/members ──────────────────────────────────
describe("GET /api/teams/[id]/members", () => {
  test("viewer can list members", async () => {
    const team = await createTeam("Club");
    await addTeamMember(team.id, adminDbId, "owner");
    await addTeamMember(team.id, memberDbId, "viewer");

    const event = createMockEvent({
      user: memberUser,
      params: { id: team.id },
    });
    const res = await membersGet(event);
    expect(res.status).toBe(200);

    const body = await jsonFromResponse(res);
    expect(body.members).toHaveLength(2);
  });
});

// ── POST /api/teams/[id]/members ─────────────────────────────────
describe("POST /api/teams/[id]/members", () => {
  test("owner adds member (201)", async () => {
    const team = await createTeam("Expand");
    await addTeamMember(team.id, memberDbId, "owner");

    const event = createMockEvent({
      method: "POST",
      user: memberUser,
      params: { id: team.id },
      body: { userId: adminDbId, role: "editor" },
    });
    const res = await membersPost(event);
    expect(res.status).toBe(201);

    const body = await jsonFromResponse(res);
    expect(body.member.userId).toBe(adminDbId);
    expect(body.member.role).toBe("editor");
  });

  test("unknown user is 404, not a 500 from the foreign key", async () => {
    const team = await createTeam("Ghost");
    await addTeamMember(team.id, memberDbId, "owner");

    const event = createMockEvent({
      method: "POST",
      user: memberUser,
      params: { id: team.id },
      body: { userId: "no-such-user", role: "viewer" },
    });
    const res = await membersPost(event);
    expect(res.status).toBe(404);
  });

  test("re-adding a member updates the role instead of a 500 on the unique index", async () => {
    const team = await createTeam("Again");
    await addTeamMember(team.id, memberDbId, "owner");
    await addTeamMember(team.id, adminDbId, "viewer");

    const event = createMockEvent({
      method: "POST",
      user: memberUser,
      params: { id: team.id },
      body: { userId: adminDbId, role: "editor" },
    });
    const res = await membersPost(event);
    expect(res.status).toBe(201);
    expect((await jsonFromResponse(res)).member.role).toBe("editor");
    const rows = await getTestDb().select().from(teamMembers);
    expect(rows.filter((r: { userId: string }) => r.userId === adminDbId)).toHaveLength(1);
  });

  test("the last owner cannot demote themselves (400)", async () => {
    const team = await createTeam("Keep Owner");
    await addTeamMember(team.id, memberDbId, "owner");

    const event = createMockEvent({
      method: "POST",
      user: memberUser,
      params: { id: team.id },
      body: { userId: memberDbId, role: "viewer" },
    });
    const res = await membersPost(event);
    expect(res.status).toBe(400);
    expect((await jsonFromResponse(res)).error).toContain("last owner");
  });

  test("viewer gets 403", async () => {
    const team = await createTeam("Locked");
    await addTeamMember(team.id, memberDbId, "viewer");

    const event = createMockEvent({
      method: "POST",
      user: memberUser,
      params: { id: team.id },
      body: { userId: adminDbId, role: "viewer" },
    });
    const res = await membersPost(event);
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/teams/[id]/members ───────────────────────────────
describe("DELETE /api/teams/[id]/members", () => {
  test("cannot remove last owner (400)", async () => {
    const team = await createTeam("Solo Owner");
    await addTeamMember(team.id, memberDbId, "owner");

    const event = createMockEvent({
      method: "DELETE",
      user: memberUser,
      params: { id: team.id },
      body: { userId: memberDbId },
    });
    const res = await membersDelete(event);
    expect(res.status).toBe(400);

    const body = await jsonFromResponse(res);
    expect(body.error).toContain("last owner");
  });

  test("owner can remove a non-last-owner member", async () => {
    const team = await createTeam("Flexible");
    await addTeamMember(team.id, memberDbId, "owner");
    await addTeamMember(team.id, adminDbId, "viewer");

    const event = createMockEvent({
      method: "DELETE",
      user: memberUser,
      params: { id: team.id },
      body: { userId: adminDbId },
    });
    const res = await membersDelete(event);
    expect(res.status).toBe(200);

    const body = await jsonFromResponse(res);
    expect(body.success).toBe(true);
  });
});
