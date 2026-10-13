/**
 * Server-handler unit tests for /api/teams/[id]/members/+server.ts.
 *
 * Each method has its own team-role gate (viewer / owner / owner). The
 * handler wraps the gate in a try/catch that rethrows non-Response
 * errors; Response throws flow back as the HTTP response. Team queries
 * are mocked so the test never touches the DB.
 */

import { test, expect, describe, vi, beforeEach } from "vitest";
import { makeRequestEvent } from "./helpers/server-route-test-utils";

vi.mock("$server/db/queries/teams", () => ({
  getTeamMembers: vi.fn(async () => []),
  getTeamMembership: vi.fn(async () => undefined),
  addTeamMember: vi.fn(async (tid: string, uid: string, role: string) => ({
    teamId: tid,
    userId: uid,
    role,
  })),
  removeTeamMember: vi.fn(async () => true),
}));

// POST checks that the target user exists; every id names a user here.
vi.mock("$server/db/queries/users", () => ({
  getUserById: vi.fn(async (id: string) => ({ id })),
}));

const {
  getTeamMembers,
  getTeamMembership,
  addTeamMember,
  removeTeamMember,
} = await import("$server/db/queries/teams");
const { GET, POST, DELETE } = await import(
  "../routes/api/teams/[id]/members/+server"
);

function makeEvent(opts: {
  id?: string;
  locals?: Record<string, unknown>;
  body?: unknown;
  method?: "GET" | "POST" | "DELETE";
}) {
  const id = opts.id ?? "team-1";
  const init: RequestInit = { method: opts.method ?? "GET" };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { "content-type": "application/json" };
  }
  return makeRequestEvent(`http://localhost/api/teams/${id}/members`, {
    locals: opts.locals ?? {},
    params: { id },
    request: init,
  });
}

const adminLocals = {
  user: { id: "a1", email: "a@x", name: "A", role: "admin" },
};
const memberLocals = {
  user: { id: "u1", email: "u@x", name: "U", role: "user" },
};

describe("GET /api/teams/[id]/members", () => {
  beforeEach(() => {
    vi.mocked(getTeamMembers).mockReset();
    vi.mocked(getTeamMembership).mockReset();
  });

  test("returns 401 when locals.user is missing", async () => {
    const res = await GET(makeEvent({}));
    expect(res.status).toBe(401);
  });

  test("returns 403 when non-admin is not a team member", async () => {
    vi.mocked(getTeamMembership).mockResolvedValue(undefined as any);
    const res = await GET(makeEvent({ locals: memberLocals }));
    expect(res.status).toBe(403);
  });

  test("rejects 403 when API-key lacks 'read' scope", async () => {
    const res = await GET(
      makeEvent({ locals: { ...adminLocals, apiKeyScopes: ["chat"] } }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { required?: string };
    expect(body.required).toBe("read");
  });

  test("returns 200 with member list for instance admin", async () => {
    vi.mocked(getTeamMembers).mockResolvedValue([
      { teamId: "team-1", userId: "u1", role: "viewer" },
    ] as any);
    const res = await GET(makeEvent({ locals: adminLocals }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members?: Array<{ userId: string }> };
    expect(body.members).toHaveLength(1);
  });
});

describe("POST /api/teams/[id]/members", () => {
  beforeEach(() => {
    vi.mocked(addTeamMember).mockClear();
    vi.mocked(getTeamMembership).mockReset();
  });

  test("returns 401 when locals.user is missing", async () => {
    const res = await POST(
      makeEvent({ method: "POST", body: { userId: "u2" } }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 403 when non-admin lacks owner role", async () => {
    vi.mocked(getTeamMembership).mockResolvedValue({
      role: "viewer",
    } as any);
    const res = await POST(
      makeEvent({
        method: "POST",
        locals: memberLocals,
        body: { userId: "u2" },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("rejects 400 when userId is missing", async () => {
    const res = await POST(
      makeEvent({
        method: "POST",
        locals: adminLocals,
        body: {},
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("userId is required");
  });

  test("rejects 400 when role is invalid", async () => {
    const res = await POST(
      makeEvent({
        method: "POST",
        locals: adminLocals,
        body: { userId: "u2", role: "superuser" },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Invalid role");
  });

  test("returns 201 with member on success (defaults to viewer)", async () => {
    const res = await POST(
      makeEvent({
        method: "POST",
        locals: adminLocals,
        body: { userId: "u2" },
      }),
    );
    expect(res.status).toBe(201);
    expect(addTeamMember).toHaveBeenCalledWith("team-1", "u2", "viewer");
  });
});

describe("DELETE /api/teams/[id]/members", () => {
  beforeEach(() => {
    vi.mocked(removeTeamMember).mockReset();
    vi.mocked(getTeamMembers).mockReset();
  });

  test("returns 401 when locals.user is missing", async () => {
    const res = await DELETE(
      makeEvent({ method: "DELETE", body: { userId: "u2" } }),
    );
    expect(res.status).toBe(401);
  });

  test("rejects 400 when userId missing", async () => {
    const res = await DELETE(
      makeEvent({ method: "DELETE", locals: adminLocals, body: {} }),
    );
    expect(res.status).toBe(400);
  });

  test("rejects 400 when removing the last owner", async () => {
    vi.mocked(getTeamMembers).mockResolvedValue([
      { teamId: "team-1", userId: "u1", role: "owner" },
    ] as any);
    const res = await DELETE(
      makeEvent({
        method: "DELETE",
        locals: adminLocals,
        body: { userId: "u1" },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Cannot remove the last owner");
  });

  test("returns 404 when the member did not exist", async () => {
    vi.mocked(getTeamMembers).mockResolvedValue([
      { teamId: "team-1", userId: "u-owner", role: "owner" },
    ] as any);
    vi.mocked(removeTeamMember).mockResolvedValue(false as any);
    const res = await DELETE(
      makeEvent({
        method: "DELETE",
        locals: adminLocals,
        body: { userId: "u-ghost" },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("returns 200 success on happy path", async () => {
    vi.mocked(getTeamMembers).mockResolvedValue([
      { teamId: "team-1", userId: "u-owner", role: "owner" },
      { teamId: "team-1", userId: "u-viewer", role: "viewer" },
    ] as any);
    vi.mocked(removeTeamMember).mockResolvedValue(true as any);
    const res = await DELETE(
      makeEvent({
        method: "DELETE",
        locals: adminLocals,
        body: { userId: "u-viewer" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
