/**
 * The project-members API — the WRITER that makes `project_members` a
 * membership model rather than an owner column with extra steps.
 *
 * Two things are under test and only one of them is the routes:
 *
 *  1. `checkProjectRole` (`src/auth/middleware.ts`) — the REAL gate. Only
 *     the DB read beneath it is stubbed, so the admin bypass, the
 *     missing-row 403 and the `member` < `owner` ladder are the shipped
 *     implementations, not a copy of them written in this file.
 *  2. The routes' own ordering: scope → project exists → role → body.
 *
 * ## The rule these tests pin, stated once
 *
 * A plain `member` may rename the project but may NOT add a member, and may
 * not delete the project either (`[id]/+server.ts` needs `owner`, because a
 * delete cascades to every member's conversations). A member who could add
 * members could add a confederate, and that compounds.
 */
import { test, expect, describe, afterAll, beforeEach, mock } from "bun:test";
import { restoreModuleMocks, webLibModule } from "../helpers/mock-cleanup";
import {
  mockServerAlias,
  createMockEvent,
  jsonFromResponse,
  ADMIN_USER,
} from "../helpers/mock-request";

mockServerAlias();

mock.module("../../../web/src/routes/api/projects/[id]/members/$types", () => ({}));
mock.module("../../../web/src/routes/api/projects/[id]/members/[userId]/$types", () => ({}));

// The scope axis is covered by its own suites; these tests are about the
// MEMBERSHIP axis, so scope is a no-op allow.
const apiKeysMock = webLibModule("server/security/api-keys", { requireScope: () => null });
mock.module("$lib/server/security/api-keys", () => apiKeysMock);
mock.module("../../../web/src/lib/server/security/api-keys", () => apiKeysMock);

// ── In-memory stores ─────────────────────────────────────────────

type MemberRow = { id: string; projectId: string; userId: string; role: "owner" | "member" };

let projectStore: Set<string>;
let userStore: Set<string>;
let memberRows: MemberRow[];

const key = (projectId: string, userId: string) => `${projectId}:${userId}`;

const projectMembersMock = () => ({
  getProjectMembership: async (userId: string, projectId: string) =>
    memberRows.find((r) => r.userId === userId && r.projectId === projectId),
  listProjectMembers: async (projectId: string) =>
    memberRows
      .filter((r) => r.projectId === projectId)
      .map((r) => ({ ...r, userName: `Name ${r.userId}`, userEmail: `${r.userId}@t.local` })),
  countProjectMembers: async (projectId: string, role?: "owner" | "member") =>
    memberRows.filter((r) => r.projectId === projectId && (!role || r.role === role)).length,
  upsertProjectMember: async (projectId: string, userId: string, role: "owner" | "member") => {
    const existing = memberRows.find((r) => r.userId === userId && r.projectId === projectId);
    if (existing) {
      existing.role = role;
      return existing;
    }
    const row: MemberRow = { id: `pm-${key(projectId, userId)}`, projectId, userId, role };
    memberRows.push(row);
    return row;
  },
  removeProjectMember: async (projectId: string, userId: string) => {
    const at = memberRows.findIndex((r) => r.userId === userId && r.projectId === projectId);
    if (at === -1) return false;
    memberRows.splice(at, 1);
    return true;
  },
});
mock.module("$server/db/queries/project-members", projectMembersMock);
mock.module("../../db/queries/project-members", projectMembersMock);

const projectsMock = () => ({
  getProject: async (id: string) => (projectStore.has(id) ? { id, name: id, path: `/srv/${id}` } : undefined),
});
mock.module("$server/db/queries/projects", projectsMock);
mock.module("../../db/queries/projects", projectsMock);

const usersMock = () => ({
  getUserById: async (id: string) =>
    userStore.has(id) ? { id, email: `${id}@t.local`, name: id } : undefined,
});
mock.module("$server/db/queries/users", usersMock);
mock.module("../../db/queries/users", usersMock);

// ── Handler imports (AFTER mocks) ────────────────────────────────

import {
  GET as membersGet,
  POST as membersPost,
} from "../../../web/src/routes/api/projects/[id]/members/+server";
import { DELETE as memberDelete } from "../../../web/src/routes/api/projects/[id]/members/[userId]/+server";

async function call(handler: (ev: any) => unknown, event: any): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

afterAll(() => {
  restoreModuleMocks();
});

const OWNER_USER = { id: "u-owner", email: "o@t.local", name: "Owner", role: "member" } as const;
const PLAIN_MEMBER = { id: "u-member", email: "m@t.local", name: "Member", role: "member" } as const;
const OUTSIDER = { id: "u-outsider", email: "x@t.local", name: "Outsider", role: "member" } as const;

const listEvent = (user: unknown, id = "proj-1") =>
  createMockEvent({ url: `http://localhost/api/projects/${id}/members`, params: { id }, user: user as any });

const addEvent = (user: unknown, body: unknown, id = "proj-1") =>
  createMockEvent({
    method: "POST",
    url: `http://localhost/api/projects/${id}/members`,
    params: { id },
    body,
    user: user as any,
  });

const removeEvent = (user: unknown, userId: string, id = "proj-1") =>
  createMockEvent({
    method: "DELETE",
    url: `http://localhost/api/projects/${id}/members/${userId}`,
    params: { id, userId },
    user: user as any,
  });

beforeEach(() => {
  projectStore = new Set(["proj-1", "proj-2"]);
  userStore = new Set([OWNER_USER.id, PLAIN_MEMBER.id, OUTSIDER.id, ADMIN_USER.id]);
  memberRows = [
    { id: "pm-1", projectId: "proj-1", userId: OWNER_USER.id, role: "owner" },
    { id: "pm-2", projectId: "proj-1", userId: PLAIN_MEMBER.id, role: "member" },
    // The outsider is a member of a DIFFERENT project — so every refusal
    // below is about the project id, not about having no memberships.
    { id: "pm-3", projectId: "proj-2", userId: OUTSIDER.id, role: "owner" },
  ];
});

describe("GET /api/projects/[id]/members", () => {
  test("a plain member may see who else is on the project", async () => {
    const res = await call(membersGet as any, listEvent(PLAIN_MEMBER));
    expect(res.status).toBe(200);
    const body = await jsonFromResponse(res);
    expect(body.map((m: MemberRow) => m.userId).sort()).toEqual(
      [OWNER_USER.id, PLAIN_MEMBER.id].sort(),
    );
    // The join is what the UI renders; asserted so a route that returned
    // bare rows would fail here rather than in a screenshot.
    expect(body[0].userEmail).toContain("@t.local");
  });

  test("a member of another project is refused 403", async () => {
    const res = await call(membersGet as any, listEvent(OUTSIDER));
    expect(res.status).toBe(403);
  });

  test("an admin with no membership row may still see the list", async () => {
    expect(memberRows.some((r) => r.userId === ADMIN_USER.id)).toBe(false);
    const res = await call(membersGet as any, listEvent(ADMIN_USER));
    expect(res.status).toBe(200);
  });

  test("an unknown project is a 404, checked BEFORE the role", async () => {
    // Ordering matters: a 403 for a project that does not exist would send
    // an operator hunting for a permissions problem that is a typo.
    const res = await call(membersGet as any, listEvent(OUTSIDER, "no-such-project"));
    expect(res.status).toBe(404);
  });

  test("an unauthenticated caller is 401, not 403", async () => {
    const res = await call(membersGet as any, listEvent(undefined));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/projects/[id]/members — granting authority is owner-only", () => {
  test("an owner may add a member", async () => {
    const res = await call(membersPost as any, addEvent(OWNER_USER, { userId: OUTSIDER.id }));
    expect(res.status).toBe(201);
    expect((await jsonFromResponse(res)).role).toBe("member");
    expect(memberRows.some((r) => r.projectId === "proj-1" && r.userId === OUTSIDER.id)).toBe(true);
  });

  test("an owner may add another OWNER when the role is named", async () => {
    const res = await call(
      membersPost as any,
      addEvent(OWNER_USER, { userId: OUTSIDER.id, role: "owner" }),
    );
    expect(res.status).toBe(201);
    expect((await jsonFromResponse(res)).role).toBe("owner");
  });

  test("the LAST owner cannot demote themselves — 409, the project keeps an owner", async () => {
    // A project with members but no owner can grant authority only through
    // the instance-admin override — the same stranding the last-member rule
    // refuses.
    const res = await call(
      membersPost as any,
      addEvent(OWNER_USER, { userId: OWNER_USER.id, role: "member" }),
    );
    expect(res.status).toBe(409);
    expect((await jsonFromResponse(res)).error).toContain("at least one owner");
    expect(memberRows.find((r) => r.userId === OWNER_USER.id)!.role).toBe("owner");
  });

  test("an owner may step down when another owner remains", async () => {
    memberRows.find((r) => r.userId === PLAIN_MEMBER.id)!.role = "owner";
    const res = await call(
      membersPost as any,
      addEvent(OWNER_USER, { userId: OWNER_USER.id, role: "member" }),
    );
    expect(res.status).toBe(201);
    expect(memberRows.find((r) => r.userId === OWNER_USER.id)!.role).toBe("member");
  });

  test("a re-add UPDATES the role rather than duplicating the row", async () => {
    const before = memberRows.length;
    const res = await call(
      membersPost as any,
      addEvent(OWNER_USER, { userId: PLAIN_MEMBER.id, role: "owner" }),
    );
    expect(res.status).toBe(201);
    expect(memberRows).toHaveLength(before);
    expect(memberRows.find((r) => r.userId === PLAIN_MEMBER.id)!.role).toBe("owner");
  });

  test("a PLAIN MEMBER may NOT add anyone — the asymmetry, asserted", async () => {
    // The same principal CAN delete the entire project
    // (`cross-tenant-deletion-projects-kb-modes.test.ts`). Granting
    // authority is the narrower right; destroying one object is not.
    const res = await call(membersPost as any, addEvent(PLAIN_MEMBER, { userId: OUTSIDER.id }));
    expect(res.status).toBe(403);
    expect(memberRows.some((r) => r.projectId === "proj-1" && r.userId === OUTSIDER.id)).toBe(false);
  });

  test("a member of another project may not add anyone", async () => {
    const res = await call(membersPost as any, addEvent(OUTSIDER, { userId: OUTSIDER.id }));
    expect(res.status).toBe(403);
  });

  test("an admin with no membership row may add a member", async () => {
    const res = await call(membersPost as any, addEvent(ADMIN_USER, { userId: OUTSIDER.id }));
    expect(res.status).toBe(201);
  });

  test("an unknown project is a 404", async () => {
    const res = await call(
      membersPost as any,
      addEvent(ADMIN_USER, { userId: OUTSIDER.id }, "no-such-project"),
    );
    expect(res.status).toBe(404);
  });

  test("a body with no userId is a 400", async () => {
    const res = await call(membersPost as any, addEvent(OWNER_USER, {}));
    expect(res.status).toBe(400);
    expect((await jsonFromResponse(res)).error).toContain("userId");
  });

  test("an unknown ROLE is a 400 — the vocabulary comes from the schema", async () => {
    const res = await call(
      membersPost as any,
      addEvent(OWNER_USER, { userId: OUTSIDER.id, role: "viewer" }),
    );
    // `viewer` is a TEAM role, not a project role. Two role taxonomies with
    // overlapping words is exactly why the enum is generated from the
    // schema's `PROJECT_MEMBER_ROLES` rather than hand-written.
    expect(res.status).toBe(400);
  });

  test("an unknown TARGET USER is a clean 404, never a 500 from the FK", async () => {
    const res = await call(membersPost as any, addEvent(OWNER_USER, { userId: "ghost" }));
    expect(res.status).toBe(404);
    expect((await jsonFromResponse(res)).error).toContain("User");
    expect(memberRows.some((r) => r.userId === "ghost")).toBe(false);
  });

  test("a malformed body is a 400, not a crash", async () => {
    const event = addEvent(OWNER_USER, undefined);
    event.request.json = async () => {
      throw new Error("not json");
    };
    const res = await call(membersPost as any, event);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/projects/[id]/members/[userId]", () => {
  test("an owner may remove a member", async () => {
    const res = await call(memberDelete as any, removeEvent(OWNER_USER, PLAIN_MEMBER.id));
    expect(res.status).toBe(200);
    expect(await jsonFromResponse(res)).toEqual({ ok: true });
    expect(memberRows.some((r) => r.userId === PLAIN_MEMBER.id)).toBe(false);
  });

  test("a plain member may not remove anyone — not even themselves", async () => {
    // A member who could revoke an owner could take the project over.
    const res = await call(memberDelete as any, removeEvent(PLAIN_MEMBER, PLAIN_MEMBER.id));
    expect(res.status).toBe(403);
    expect(memberRows.some((r) => r.userId === PLAIN_MEMBER.id)).toBe(true);
  });

  test("the LAST member cannot be removed — 409, not 403", async () => {
    // A project with zero members is reachable only through the
    // instance-admin override, which is the state `migrate()`'s backfill
    // exists to prevent. The API must not be able to re-create it one
    // DELETE at a time.
    //
    // 409 rather than 403 because the caller HAS the authority; the request
    // is refused for the state it would leave behind. A 403 would send the
    // operator looking at roles instead of at the member count.
    memberRows = memberRows.filter((r) => r.userId !== PLAIN_MEMBER.id);
    const res = await call(memberDelete as any, removeEvent(OWNER_USER, OWNER_USER.id));
    expect(res.status).toBe(409);
    expect((await jsonFromResponse(res)).error).toContain("at least one member");
    expect(memberRows.some((r) => r.projectId === "proj-1")).toBe(true);
  });

  test("the LAST owner cannot be removed while members remain — 409", async () => {
    const res = await call(memberDelete as any, removeEvent(ADMIN_USER, OWNER_USER.id));
    expect(res.status).toBe(409);
    expect((await jsonFromResponse(res)).error).toContain("at least one owner");
    expect(memberRows.some((r) => r.userId === OWNER_USER.id)).toBe(true);
  });

  test("an admin cannot remove the last member either", async () => {
    // The override is about AUTHORITY, and this refusal is not about
    // authority — so it must not be bypassable by role.
    memberRows = memberRows.filter((r) => r.userId !== PLAIN_MEMBER.id);
    const res = await call(memberDelete as any, removeEvent(ADMIN_USER, OWNER_USER.id));
    expect(res.status).toBe(409);
  });

  test("removing someone who is not a member is a 404", async () => {
    const res = await call(memberDelete as any, removeEvent(OWNER_USER, "ghost"));
    expect(res.status).toBe(404);
  });

  test("an unknown project is a 404", async () => {
    const res = await call(
      memberDelete as any,
      removeEvent(ADMIN_USER, OWNER_USER.id, "no-such-project"),
    );
    expect(res.status).toBe(404);
  });

  test("a member of another project is refused 403", async () => {
    const res = await call(memberDelete as any, removeEvent(OUTSIDER, OWNER_USER.id));
    expect(res.status).toBe(403);
  });
});

describe("checkProjectRole — the gate itself, through the routes", () => {
  test("the `member` < `owner` ladder is a real ordering, not a set membership", async () => {
    // GET asks for `member` and an owner clears it; POST asks for `owner`
    // and a member does not. Both directions, so a ladder implemented as
    // `held === needed` would fail one of them.
    expect((await call(membersGet as any, listEvent(OWNER_USER))).status).toBe(200);
    expect((await call(membersGet as any, listEvent(PLAIN_MEMBER))).status).toBe(200);
    expect((await call(membersPost as any, addEvent(OWNER_USER, { userId: OUTSIDER.id }))).status).toBe(201);
    expect((await call(membersPost as any, addEvent(PLAIN_MEMBER, { userId: OUTSIDER.id }))).status).toBe(403);
  });

  test("a role this build does not know denies rather than sorting lowest", async () => {
    // `?? -1` in the ladder. A row written by a newer version — or edited
    // by hand — must fail CLOSED, not be treated as the weakest known rung
    // (which would still clear a `member` gate).
    memberRows.push({
      id: "pm-weird",
      projectId: "proj-1",
      userId: OUTSIDER.id,
      role: "superowner" as unknown as "owner",
    });
    expect((await call(membersGet as any, listEvent(OUTSIDER))).status).toBe(403);
  });
});
