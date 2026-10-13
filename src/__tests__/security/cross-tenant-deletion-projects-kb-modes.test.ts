// Regression test for two confirmed cross-tenant DELETION holes, plus the
// sibling instances found by sweeping the same shape repo-wide.
//
// ── Bug 1: PUT/DELETE /api/projects/[id] had NO authorization at all ──
//
//   export const DELETE = async ({ params, locals }) => {
//     const scopeErr = requireScope(locals, "read");
//     if (scopeErr) return scopeErr;
//     requireAuth(locals);
//     const deleted = await projectQueries.deleteProject(params.id);   // ← boom
//
// Scope, auth, then straight to the delete. Any authenticated principal
// destroyed (or silently rewrote, via PUT) ANY project by id.
//
// The complication AT THE TIME: `projects` had NO owner column — no
// `userId`, no `createdBy` — and there was no `project_members` table. So
// "check the owner" was not expressible; there was no owner to check. The
// narrowest authorization that WAS expressible was role-based, and PR #82
// shipped it: mutating an instance-global object is an admin action. It
// closed the hole and broke a real case — the non-admin who created a
// project could not rename or delete it.
//
// ── That complication is GONE. `project_members` exists. ──
//
// `src/db/schema.ts` now carries a project ↔ user join table with a role,
// `createProject` stamps its creator as an `owner`, and `migrate()`
// attributes every pre-existing project to the first admin. So these tests
// pin the rule the product actually wanted, not the stop-gap:
//
//   PUT /api/projects/[id]     →  any MEMBER of that project,
//                                 or an instance admin.
//   DELETE /api/projects/[id]  →  an OWNER of that project, or an
//                                 instance admin (a delete cascades to
//                                 every member's conversations).
//
// The admin cases below are unchanged and still pass — the override
// survived — but the "even the member who created it cannot delete it" case
// INVERTED, and that inversion is the whole point of this branch.
//
// Read stays instance-global (GET and the list route are deliberately
// unfiltered and are NOT changed here) — so unlike the sec-H3 routes there
// is no existence secret to protect, and the denial is an honest 403 rather
// than a 404 existence-oracle dodge. Why the read side was not narrowed with
// the write side is recorded in `web/src/routes/api/projects/+server.ts` and
// pinned by the "reads stay instance-global" block at the end of this file:
// after the ownerless backfill, a membership filter on the LIST would show
// every non-admin an empty project list on any upgraded instance.
//
// ── Bug 2: DELETE /api/knowledge-base/[id] failed OPEN on unowned rows ──
//
//   if (file.userId && file.userId !== user.id) return errorJson(404, "…");
//
// The leading `file.userId &&` short-circuits, so a row with `userId IS NULL`
// passed the check for EVERY user — any authenticated caller could delete an
// unowned knowledge-base file. This is the exact sec-H3 shape
// (src/__tests__/security/h3-conversations-memories-idor.test.ts) that a
// prior pass fixed on conversations/memories and missed here. The fix is the
// sec-H3 pattern verbatim, including the deliberate 404-not-403 so the route
// does not become an id-existence oracle:
//
//   if (file.userId !== user.id && user.role !== "admin") return 404;
//
// ── Siblings found by the sweep ──
//
// PUT + DELETE /api/modes/[id] carried the identical fail-open shape on
// `existing.userId`. The separate `existing.builtin` guard does NOT cover it:
// `builtin` and `userId` are independent columns (src/db/schema.ts:1459+),
// and `createMode` writes `builtin: false, userId: data.userId ?? null`
// (src/db/queries/modes.ts:74-75) — so a non-builtin mode with a null userId
// is representable and was editable/deletable by any authenticated user.
//
// POST /api/__test/reset carried the shape too (it deletes a conversation).
// It already had the `&& user.role !== "admin"` clause but kept the leading
// `conv.userId &&` short-circuit, so a null-owner conversation was resettable
// by any caller. Lower severity — the route is fail-closed behind
// `isTestSurfaceEnabled()` and never serves in production — but it is the
// same defect and is fixed with the same one-token change.
//
// Deliberately NOT changed (documented as intentional, evidence in report):
//   - GET /api/agent-configs/[id]:52 — the same shape, but lines 29-33 of
//     that file document null-userId rows as SYSTEM-owned and intentionally
//     world-READABLE; its PUT/DELETE already fail closed correctly.
//   - GET /api/knowledge-base/[id] — read side. The list route
//     (web/src/routes/api/knowledge-base/+server.ts) deliberately shows
//     null-userId files to every user, so tightening GET alone would make a
//     file visible in the list but 404 on fetch. Reported, not changed — and
//     since RULED deliberate: null-owner KB rows are SHARED on both read
//     surfaces, pinned as one invariant by
//     src/__tests__/security/kb-ownerless-rows-are-shared.test.ts.
//   - /api/runs/[id]:30 `if (userId && userId === user.id) return true` — a
//     positive-ALLOW shape, already fail-closed (null grants nothing) and
//     documented at lines 11-35.
//
// Strategy mirrors the sec-H3 test: (A) source-level regression gates that
// flip together with the fix, (B) behavioral probes proving the attack is
// refused AND that the legitimate owner and an admin still succeed.

import { test, expect, describe, afterAll, beforeEach, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { restoreModuleMocks, webLibModule } from "../helpers/mock-cleanup";
import {
  mockServerAlias,
  createMockEvent,
  jsonFromResponse,
  ADMIN_USER,
  MEMBER_USER,
} from "../helpers/mock-request";

// ── Module-level mocks (BEFORE handler imports) ──────────────────

mockServerAlias();

mock.module("../../../web/src/routes/api/projects/$types", () => ({}));
mock.module("../../../web/src/routes/api/projects/[id]/$types", () => ({}));
mock.module("../../../web/src/routes/api/knowledge-base/[id]/$types", () => ({}));
mock.module("../../../web/src/routes/api/modes/[id]/$types", () => ({}));

// Scope check = noop allow. These tests are about the OWNERSHIP axis; the
// scope axis (`requireScope(locals, "read")`) is deliberately left exactly
// as-is by this change and is covered by its own suites.
const apiKeysMock = () => webLibModule("server/security/api-keys", { requireScope: () => null });
mock.module("$lib/server/security/api-keys", apiKeysMock);
mock.module("../../../web/src/lib/server/security/api-keys", apiKeysMock);
// Project mutation authorization is the subject here. The persisted
// workspace policy is tested separately and must not require database setup
// in these route-level ownership probes.
mock.module("$server/runtime/workspace/target", () => ({ projectRequiresSandbox: async () => false }));
mock.module("../../runtime/workspace/target", () => ({ projectRequiresSandbox: async () => false }));

mock.module("$lib/server/security/validation", () =>
  require("../../../web/src/lib/server/security/validation"),
);

// `$server/auth/middleware` is deliberately NOT stubbed. It used to be —
// a two-line `requireAuth` replacement — and that was fine while the
// projects gate was a role comparison inside the route. It is not fine now:
// the gate is `checkProjectRole` IN that module, so stubbing the module
// would replace the very thing these probes exist to exercise, and they
// would pass against a hand-written copy of the rule. `mockServerAlias()`
// points the alias at the real implementation; only the DB read underneath
// it is stubbed, below.

// ── In-memory stores ─────────────────────────────────────────────

type Project = { id: string; name: string; path: string; icon: string | null };
type KBFile = { id: string; userId: string | null; filename: string };
type Mode = { id: string; userId: string | null; name: string; slug: string; builtin: boolean };

let projectStore: Map<string, Project>;
let kbStore: Map<string, KBFile>;
let modeStore: Map<string, Mode>;

/**
 * Membership rows, keyed `${projectId}:${userId}`.
 *
 * Stubbed at the QUERY layer rather than at the gate, so the real
 * `checkProjectRole` — admin bypass, missing-row 403, role ladder — is what
 * runs during every probe below.
 */
let membershipStore: Map<string, { role: "owner" | "member" }>;

const projectMembersMock = () => ({
  getProjectMembership: async (userId: string, projectId: string) => {
    const row = membershipStore.get(`${projectId}:${userId}`);
    return row ? { id: "pm-1", projectId, userId, role: row.role, createdAt: new Date() } : undefined;
  },
});
mock.module("$server/db/queries/project-members", projectMembersMock);
mock.module("../../db/queries/project-members", projectMembersMock);

const projectsMock = () => ({
  listProjects: async () => [...projectStore.values()],
  getProject: async (id: string) => projectStore.get(id) ?? undefined,
  updateProject: async (id: string, data: Partial<Project>) => {
    const existing = projectStore.get(id);
    if (!existing) return undefined;
    const next = { ...existing, ...data };
    projectStore.set(id, next);
    return next;
  },
  deleteProject: async (id: string) => projectStore.delete(id),
});
mock.module("$server/db/queries/projects", projectsMock);
mock.module("../../db/queries/projects", projectsMock);

const kbMock = () => ({
  getKBFile: async (id: string) => kbStore.get(id) ?? undefined,
  deleteKBFile: async (id: string) => kbStore.delete(id),
});
mock.module("$server/db/queries/knowledge-base", kbMock);
mock.module("../../db/queries/knowledge-base", kbMock);

const modesMock = () => ({
  getMode: async (id: string) => modeStore.get(id) ?? undefined,
  updateMode: async (id: string, data: Partial<Mode>) => {
    const existing = modeStore.get(id);
    if (!existing) return undefined;
    const next = { ...existing, ...data };
    modeStore.set(id, next);
    return next;
  },
  deleteMode: async (id: string) => modeStore.delete(id),
});
mock.module("$server/db/queries/modes", modesMock);
mock.module("../../db/queries/modes", modesMock);

// ── Handler imports (AFTER mocks) ────────────────────────────────

import {
  GET as projectGet,
  PUT as projectPut,
  DELETE as projectDelete,
} from "../../../web/src/routes/api/projects/[id]/+server";
import { GET as projectList } from "../../../web/src/routes/api/projects/+server";
import {
  DELETE as kbDelete,
} from "../../../web/src/routes/api/knowledge-base/[id]/+server";
import {
  PUT as modePut,
  DELETE as modeDelete,
} from "../../../web/src/routes/api/modes/[id]/+server";

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

// USER_A is "the person who created the project" and the DB now RECORDS
// that: `createProject` stamps its creator as an `owner` row, so A holds a
// claim B does not. Both are plain instance members — the difference is
// membership, not role, which is the whole point of the model.
const USER_A = { id: "user-a", email: "a@test.local", name: "User A", role: "member" } as const;
const USER_B = { id: "user-b", email: "b@test.local", name: "User B", role: "member" } as const;

beforeEach(() => {
  projectStore = new Map<string, Project>([
    ["proj-1", { id: "proj-1", name: "A's project", path: "/srv/a", icon: null }],
  ]);
  // A created proj-1. B is a member of nothing. ADMIN_USER is deliberately
  // given NO row either — every admin success below therefore proves the
  // role override, not a membership.
  membershipStore = new Map([["proj-1:user-a", { role: "owner" as const }]]);
  kbStore = new Map<string, KBFile>([
    ["kb-owned-a", { id: "kb-owned-a", userId: "user-a", filename: "a-private.md" }],
    ["kb-null-owner", { id: "kb-null-owner", userId: null, filename: "unowned-legacy.md" }],
  ]);
  modeStore = new Map<string, Mode>([
    ["mode-owned-a", { id: "mode-owned-a", userId: "user-a", name: "A's mode", slug: "a-mode", builtin: false }],
    ["mode-null-owner", { id: "mode-null-owner", userId: null, name: "Unowned mode", slug: "unowned-mode", builtin: false }],
  ]);
});

// ── (A) Source-level regression gates ─────────────────────────────

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const read = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

describe("source: projects mutating routes are membership-gated", () => {
  const REL = "web/src/routes/api/projects/[id]/+server.ts";

  test(`${REL} — PUT and DELETE gate on project membership`, () => {
    const src = read(REL);
    // Pre-#82 this file contained NO authorization whatsoever past
    // `requireAuth`; #82 added a bare `user.role === "admin"` comparison.
    // Both shapes are now wrong, and the regression signal is that the
    // route delegates to the shared gate instead of comparing anything
    // itself — a route that re-derived the rule is how the API and the
    // ladder drift apart.
    expect(src).toContain("checkProjectRole");
    // Asserted over the HANDLERS only. The file's header comment quotes the
    // old `user.role === "admin"` shape while explaining why it is gone, and
    // a whole-file assertion would be satisfied by that prose — the exact
    // way a source-level gate stops testing anything.
    const handlers = src.slice(src.indexOf("export const GET"));
    expect(handlers.indexOf("export const GET")).toBe(0);
    expect(handlers).not.toMatch(/user\.role\s*===\s*"admin"/);
    // BOTH mutating verbs must invoke it: PUT at `member`, DELETE at
    // `owner` (deleting a project also deletes other members'
    // conversations). GET is excluded on purpose (reads stay
    // instance-global).
    expect(src.match(/checkProjectRole\(locals, params\.id, "member"\)/g) ?? []).toHaveLength(1);
    expect(src.match(/checkProjectRole\(locals, params\.id, "owner"\)/g) ?? []).toHaveLength(1);
    // …and the denial must be RETURNED, never thrown: SvelteKit surfaces a
    // thrown Response from a handler as a 500, which is how an intended
    // 403 becomes an unintended 500.
    expect(src.match(/if \(gate instanceof Response\) return gate;/g) ?? []).toHaveLength(2);
  });

  test(`${REL} — the mutators are \`write\`-scoped, GET stays \`read\``, () => {
    const src = read(REL);
    // This pin originally asserted all three handlers still asked for `read`,
    // deliberately, so that the separate open question — whether `read` should
    // authorize destruction — could not be resolved SILENTLY by this branch.
    // It has since been resolved deliberately: the `write` scope landed and
    // PUT/DELETE moved onto it, leaving GET on `read`. The pin now guards the
    // new shape in both directions, which is the same job it always had.
    const readHits = src.match(/requireScope\(locals,\s*"read"\)/g) ?? [];
    const writeHits = src.match(/requireScope\(locals,\s*"write"\)/g) ?? [];
    expect(readHits.length).toBe(1);
    expect(writeHits.length).toBe(2);
    // The ownership gate is a SEPARATE axis and must not be traded for the
    // scope one: `admin` scope here would let a role-only check masquerade as
    // authorization. Ownership stays on `checkProjectRole`, asserted above.
    expect(src).not.toMatch(/requireScope\(locals,\s*"admin"\)/);
  });
});

describe("source: fail-closed ownership on the swept routes", () => {
  // `sliceFrom` narrows the assertion to the handler that was actually in
  // scope. It matters for knowledge-base: its GET is DELIBERATELY left on the
  // old shape (see the carve-out test below), so a whole-file assertion there
  // would either fail or have to be weakened. Narrowing keeps the regression
  // signal sharp on the path that was fixed.
  const CASES: Array<{ rel: string; varName: string; sliceFrom?: string }> = [
    {
      rel: "web/src/routes/api/knowledge-base/[id]/+server.ts",
      varName: "file",
      sliceFrom: "export const DELETE",
    },
    { rel: "web/src/routes/api/modes/[id]/+server.ts", varName: "existing" },
    { rel: "web/src/routes/api/__test/reset/+server.ts", varName: "conv" },
  ];

  for (const { rel, varName, sliceFrom } of CASES) {
    const scoped = () => {
      const src = read(rel);
      if (!sliceFrom) return src;
      const at = src.indexOf(sliceFrom);
      // A missing anchor would silently make the assertion vacuous.
      expect(at).toBeGreaterThan(-1);
      return src.slice(at);
    };

    test(`${rel} — has the fail-closed admin escape hatch`, () => {
      expect(scoped()).toMatch(/user\.role\s*!==\s*"admin"/);
    });

    test(`${rel} — no truthiness short-circuit on the fixed path`, () => {
      // The exploitable shape: `x.userId && x.userId !== user.id`. Its
      // absence is the regression signal — it flips together with the fix.
      const shortCircuit = new RegExp(
        `${varName}\\.userId\\s*&&\\s*${varName}\\.userId\\s*!==\\s*user\\.id`,
      );
      expect(scoped()).not.toMatch(shortCircuit);
    });
  }
});

describe("source: knowledge-base GET carve-out is deliberate, not missed", () => {
  const REL = "web/src/routes/api/knowledge-base/[id]/+server.ts";

  test("GET keeps the permissive shape — RULED deliberate, no longer an open gap", () => {
    // Recording the decision rather than hiding it. GET was NOT tightened
    // because the list route deliberately shows null-userId files to every
    // user (web/src/routes/api/knowledge-base/+server.ts,
    // `files.filter(f => !f.userId || f.userId === user.id)`). Tightening the
    // single-file GET alone would make a file appear in the list but 404 on
    // fetch. The read side needs list + detail changed together, which was a
    // wider decision than this deletion fix.
    //
    // That wider decision has since been MADE, and the outcome is "keep it":
    // `user_id IS NULL` is the knowledge base's deliberate sharing mechanism,
    // not an orphan marker, on BOTH read surfaces. The rationale now lives at
    // the predicates themselves (anchor `KB-SHARED-NULL-OWNER`) and the two
    // sides are pinned as ONE invariant by
    // `src/__tests__/security/kb-ownerless-rows-are-shared.test.ts`.
    //
    // So this assertion is no longer a placeholder for an unresolved gap — it
    // is the deletion-suite's local witness that the READ carve-out survived
    // the write-side fix. If it fails, do NOT move GET into the CASES table
    // above; go read the invariant suite first, because tightening GET alone
    // is the list-but-404 defect that ruling exists to prevent.
    const src = read(REL);
    const getSlice = src.slice(
      src.indexOf("export const GET"),
      src.indexOf("export const DELETE"),
    );
    expect(getSlice).toMatch(/file\.userId\s*&&\s*file\.userId\s*!==\s*user\.id/);
  });
});

// ── (B) Behavioral probes ─────────────────────────────────────────

describe("ATTACK: DELETE /api/projects/[id] — cross-tenant project destruction", () => {
  test("member who did not create the project cannot delete it", async () => {
    const res = await call(
      projectDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/projects/proj-1",
        params: { id: "proj-1" },
        user: USER_B as any,
      }),
    );
    expect(res.status).toBe(403);
    // The load-bearing assertion: the row must still be there.
    expect(projectStore.has("proj-1")).toBe(true);
  });

  test("the member who created it CAN delete it — this cell inverted", async () => {
    // This assertion used to be `403`, with a comment explaining that
    // `projects` recorded no creator so the platform genuinely could not
    // tell A from B. It records one now (`project_members`), so the
    // product gap PR #82 documented is closed, and this is the line where
    // that reads as a behaviour change rather than as a comment.
    //
    // A is a plain instance `member` — the grant comes from the membership
    // row, not from a role.
    expect(USER_A.role).toBe("member");
    const res = await call(
      projectDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/projects/proj-1",
        params: { id: "proj-1" },
        user: USER_A as any,
      }),
    );
    expect(res.status).toBe(200);
    expect(projectStore.has("proj-1")).toBe(false);
  });

  test("a member of a DIFFERENT project is still refused", async () => {
    // Discrimination for the two cells above: the gate is not "has any
    // membership row at all". B belongs to proj-2 and is still refused
    // proj-1, so the projectId is actually compared.
    membershipStore.set("proj-2:user-b", { role: "owner" });
    const res = await call(
      projectDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/projects/proj-1",
        params: { id: "proj-1" },
        user: USER_B as any,
      }),
    );
    expect(res.status).toBe(403);
    expect(projectStore.has("proj-1")).toBe(true);
  });

  test("a plain member of the project cannot delete it — 403", async () => {
    // Deleting a project cascades to every member's conversations, so it
    // needs the owner role, not just a membership row.
    membershipStore.set("proj-1:user-b", { role: "member" });
    const res = await call(
      projectDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/projects/proj-1",
        params: { id: "proj-1" },
        user: USER_B as any,
      }),
    );
    expect(res.status).toBe(403);
    expect(projectStore.has("proj-1")).toBe(true);
  });

  test("admin CAN still delete the project — the override survived", async () => {
    // ADMIN_USER has no membership row (see `beforeEach`), so this can only
    // pass through `checkProjectRole`'s role bypass.
    expect(membershipStore.has(`proj-1:${ADMIN_USER.id}`)).toBe(false);
    const res = await call(
      projectDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/projects/proj-1",
        params: { id: "proj-1" },
        user: ADMIN_USER,
      }),
    );
    expect(res.status).toBe(200);
    expect(await jsonFromResponse(res)).toEqual({ ok: true });
    expect(projectStore.has("proj-1")).toBe(false);
  });

  test("admin deleting a project that does not exist still 404s", async () => {
    const res = await call(
      projectDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/projects/nope",
        params: { id: "nope" },
        user: ADMIN_USER,
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("ATTACK: PUT /api/projects/[id] — cross-tenant project rewrite", () => {
  test("member cannot repoint a project's path", async () => {
    const res = await call(
      projectPut as any,
      createMockEvent({
        method: "PUT",
        url: "http://localhost/api/projects/proj-1",
        params: { id: "proj-1" },
        body: { path: "/attacker/controlled" },
        user: USER_B as any,
      }),
    );
    expect(res.status).toBe(403);
    // No mutation may have landed — `path` drives filesystem scoping, so a
    // silent rewrite here is the sharpest edge of this bug.
    expect(projectStore.get("proj-1")!.path).toBe("/srv/a");
  });

  test("admin CAN still update the project", async () => {
    const res = await call(
      projectPut as any,
      createMockEvent({
        method: "PUT",
        url: "http://localhost/api/projects/proj-1",
        params: { id: "proj-1" },
        body: { name: "Renamed by admin" },
        user: ADMIN_USER,
      }),
    );
    expect(res.status).toBe(200);
    expect(projectStore.get("proj-1")!.name).toBe("Renamed by admin");
  });

  test("the member who created it CAN rename it — the case #82 broke", async () => {
    // The concrete user-visible regression PR #82 accepted: a non-admin
    // could not rename the project they had just made from
    // `/project/[id]/settings`. This is that page's request.
    const res = await call(
      projectPut as any,
      createMockEvent({
        method: "PUT",
        url: "http://localhost/api/projects/proj-1",
        params: { id: "proj-1" },
        body: { name: "Renamed by its creator" },
        user: USER_A as any,
      }),
    );
    expect(res.status).toBe(200);
    expect(projectStore.get("proj-1")!.name).toBe("Renamed by its creator");
  });
});

describe("reads stay instance-global (deliberately unchanged)", () => {
  test("a NON-MEMBER can still read any project", async () => {
    // Reads are NOT narrowed by this change, and the asymmetry with
    // PUT/DELETE above is deliberate rather than an oversight. Two reasons,
    // both recorded in `web/src/routes/api/projects/+server.ts`:
    //   1. the LIST route is unfiltered, so hiding a single project here
    //      would be theatre — the same caller finds it a request later; and
    //   2. `migrate()` attributes every pre-existing project to the first
    //      admin, so a membership filter on the list would hand every
    //      non-admin on an upgraded instance an EMPTY project list.
    //
    // If this assertion ever fails, someone narrowed the read side: that is
    // a legitimate change, but it needs the list route and a backfill story
    // to move WITH it. Written to fail LOUDLY on that change rather than to
    // bless the current shape forever.
    expect(membershipStore.has(`proj-1:${USER_B.id}`)).toBe(false);
    const res = await call(
      projectGet as any,
      createMockEvent({
        url: "http://localhost/api/projects/proj-1",
        params: { id: "proj-1" },
        user: USER_B as any,
      }),
    );
    expect(res.status).toBe(200);
    expect((await jsonFromResponse(res)).id).toBe("proj-1");
  });

  test("the LIST route returns projects the caller is not a member of", async () => {
    // The other half, asserted directly rather than inferred: this is the
    // route whose behaviour makes hiding a single project pointless.
    const res = await call(
      projectList as any,
      createMockEvent({ url: "http://localhost/api/projects", user: USER_B as any }),
    );
    expect(res.status).toBe(200);
    expect((await jsonFromResponse(res)).map((p: Project) => p.id)).toEqual(["proj-1"]);
  });
});

describe("ATTACK: DELETE /api/knowledge-base/[id] — unowned-row deletion", () => {
  test("any member could delete an UNOWNED file (the fail-open branch)", async () => {
    const res = await call(
      kbDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/knowledge-base/kb-null-owner",
        params: { id: "kb-null-owner" },
        user: MEMBER_USER,
      }),
    );
    expect(res.status).toBe(404);
    expect(kbStore.has("kb-null-owner")).toBe(true);
  });

  test("non-owner cannot delete another user's file", async () => {
    const res = await call(
      kbDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/knowledge-base/kb-owned-a",
        params: { id: "kb-owned-a" },
        user: USER_B as any,
      }),
    );
    expect(res.status).toBe(404);
    expect(kbStore.has("kb-owned-a")).toBe(true);
  });

  test("the legitimate OWNER can still delete their own file", async () => {
    const res = await call(
      kbDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/knowledge-base/kb-owned-a",
        params: { id: "kb-owned-a" },
        user: USER_A as any,
      }),
    );
    expect(res.status).toBe(204);
    expect(kbStore.has("kb-owned-a")).toBe(false);
  });

  test("an ADMIN can still delete an unowned file", async () => {
    const res = await call(
      kbDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/knowledge-base/kb-null-owner",
        params: { id: "kb-null-owner" },
        user: ADMIN_USER,
      }),
    );
    expect(res.status).toBe(204);
    expect(kbStore.has("kb-null-owner")).toBe(false);
  });

  test("denial is 404, not 403 — no existence oracle", async () => {
    // Deliberate, inherited from the sec-H3 pattern: a distinguishable 403
    // would confirm the id exists. A missing row must be indistinguishable
    // from a forbidden one.
    const forbidden = await call(
      kbDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/knowledge-base/kb-owned-a",
        params: { id: "kb-owned-a" },
        user: USER_B as any,
      }),
    );
    const missing = await call(
      kbDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/knowledge-base/no-such-file",
        params: { id: "no-such-file" },
        user: USER_B as any,
      }),
    );
    expect(forbidden.status).toBe(missing.status);
    expect(await jsonFromResponse(forbidden)).toEqual(await jsonFromResponse(missing));
  });
});

describe("SIBLING: /api/modes/[id] — unowned-row edit and deletion", () => {
  test("member cannot DELETE an unowned mode", async () => {
    const res = await call(
      modeDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/modes/mode-null-owner",
        params: { id: "mode-null-owner" },
        user: MEMBER_USER,
      }),
    );
    expect(res.status).toBe(404);
    expect(modeStore.has("mode-null-owner")).toBe(true);
  });

  test("member cannot PUT an unowned mode", async () => {
    const res = await call(
      modePut as any,
      createMockEvent({
        method: "PUT",
        url: "http://localhost/api/modes/mode-null-owner",
        params: { id: "mode-null-owner" },
        body: { name: "hijacked" },
        user: MEMBER_USER,
      }),
    );
    expect(res.status).toBe(404);
    expect(modeStore.get("mode-null-owner")!.name).toBe("Unowned mode");
  });

  test("non-owner cannot delete another user's mode", async () => {
    const res = await call(
      modeDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/modes/mode-owned-a",
        params: { id: "mode-owned-a" },
        user: USER_B as any,
      }),
    );
    expect(res.status).toBe(404);
    expect(modeStore.has("mode-owned-a")).toBe(true);
  });

  test("the legitimate OWNER can still delete their own mode", async () => {
    const res = await call(
      modeDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/modes/mode-owned-a",
        params: { id: "mode-owned-a" },
        user: USER_A as any,
      }),
    );
    expect(res.status).toBe(200);
    expect(modeStore.has("mode-owned-a")).toBe(false);
  });

  test("the legitimate OWNER can still edit their own mode", async () => {
    const res = await call(
      modePut as any,
      createMockEvent({
        method: "PUT",
        url: "http://localhost/api/modes/mode-owned-a",
        params: { id: "mode-owned-a" },
        body: { name: "Renamed by owner" },
        user: USER_A as any,
      }),
    );
    expect(res.status).toBe(200);
    expect(modeStore.get("mode-owned-a")!.name).toBe("Renamed by owner");
  });

  test("an ADMIN can still delete an unowned mode", async () => {
    const res = await call(
      modeDelete as any,
      createMockEvent({
        method: "DELETE",
        url: "http://localhost/api/modes/mode-null-owner",
        params: { id: "mode-null-owner" },
        user: ADMIN_USER,
      }),
    );
    expect(res.status).toBe(200);
    expect(modeStore.has("mode-null-owner")).toBe(false);
  });
});
