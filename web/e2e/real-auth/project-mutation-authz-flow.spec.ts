/**
 * e2e: PUT/DELETE /api/projects/[id] are gated on PROJECT MEMBERSHIP,
 * end-to-end, with an instance-admin override.
 *
 * ## What this spec used to assert, and why it had to change twice
 *
 * Originally these two handlers ran with NO authorization past
 * `requireAuth` — scope check, auth check, then straight to the write. Any
 * authenticated principal could destroy any project by id, or silently
 * repoint its `path` (which drives filesystem scoping for that project).
 *
 * PR #82 closed that with the only rule then expressible: `role === "admin"`.
 * `projects` had no owner column and there was no `project_members` table, so
 * "let the person who made it rename it" could not be written. The cost was
 * real and known — a non-admin could no longer rename or delete the project
 * they had just created.
 *
 * `project_members` now exists, so the rule is membership: any MEMBER of the
 * project (plus any instance admin) may rename it, only an OWNER (or admin)
 * may delete it, and a non-member may do neither.
 *
 * ## The second correction: this spec had stopped testing what it claimed
 *
 * The previous version minted its member-role key with `scopes: ["read"]` and
 * said, in a comment, that the key "clears the scope gate and is stopped only
 * by the role gate". That was true when it was written and became FALSE when
 * the `write` scope landed (PR #80/#85) and these handlers moved onto it: the
 * key no longer held the scope the handlers ask for, so its 403s came from
 * `requireScope`, and the authorization axis the spec exists for was not
 * being exercised at all. A spec that asserts the right status for the wrong
 * reason is indistinguishable from a passing one.
 *
 * The key below therefore holds `write` — the exact scope PUT and DELETE
 * demand — so every 403 here is provably the MEMBERSHIP gate.
 *
 * ## Why the member-role key is the interesting principal
 *
 * It carries `role: "member"` (bearer-auth clamps every key to member) while
 * its `userId` is the admin who minted it. So it is the one principal that
 * can show membership and role are separate axes: it is refused when its
 * owner is not a member, and admitted when its owner is — never because of
 * the role, which never changes.
 *
 * Raw `fetch` is used for the key's calls so the bootstrapped admin's session
 * cookie is provably absent — the only authority is the key.
 *
 * Not covered here: the null-`userId` knowledge-base branch of the original
 * change. `POST /api/knowledge-base` always stamps `userId`, so an unowned
 * row is not reachable over HTTP and that branch is pinned at handler level
 * in src/__tests__/security/cross-tenant-deletion-projects-kb-modes.test.ts.
 */
import { test, expect } from "../fixtures/hydration.js";

type MemberRow = { userId: string; role: string; userEmail: string };

test.describe("projects — mutating routes are membership-gated", () => {
  test("a member-role key renames a project it belongs to, and is refused one it does not", async ({
    request,
    baseURL,
  }) => {
    // ── 1. The admin creates the project; the creator is stamped an owner ──
    const createRes = await request.post("/api/projects", {
      data: { name: "e2e-authz-target", path: "/tmp/e2e-authz-target" },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const project = (await createRes.json()) as { id: string; path: string };
    expect(project.id).toBeTruthy();
    const secondEmail = `e2e-authz-second-${project.id}@example.com`;

    const meRes = await request.get("/api/auth/me");
    expect(meRes.status()).toBe(200);
    const admin = ((await meRes.json()) as { user: { id: string; role: string } }).user;
    expect(admin.role).toBe("admin");

    // The membership model's ordinary writer, asserted over HTTP: a create
    // produces a row, not just a project.
    const membersRes = await request.get(`/api/projects/${project.id}/members`);
    expect(membersRes.status(), await membersRes.text()).toBe(200);
    const members = (await membersRes.json()) as MemberRow[];
    expect(members).toHaveLength(1);
    expect(members[0]!.userId).toBe(admin.id);
    expect(members[0]!.role).toBe("owner");

    // ── 2. A member-role key that HOLDS the scope the handlers require ──
    const keyRes = await request.post("/api/settings/developer/api-keys", {
      // role omitted → member. `write` is what PUT/DELETE ask for, so the
      // scope gate cannot be what refuses anything below.
      data: { name: "e2e-projects-authz", scopes: ["read", "write"] },
    });
    expect(keyRes.status(), await keyRes.text()).toBe(201);
    const memberKey = (await keyRes.json()) as { key: string; role: string };
    expect(memberKey.role).toBe("member");

    const call = (path: string, init: RequestInit = {}) =>
      fetch(`${baseURL}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${memberKey.key}` },
      });

    // Sanity: the principal really is a member-ROLE, and really authenticated
    // (so every status below is authorization, not a failed login).
    const keyMe = await call("/api/auth/me");
    expect(keyMe.status).toBe(200);
    expect(((await keyMe.json()) as { user: { role: string } }).user.role).toBe("member");

    // ── 3. THE CASE #82 BROKE, working ────────────────────────────────
    // A non-admin-role principal renames the project it is a member of.
    // Under #82 this was a 403 by design.
    const memberRename = await call(`/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "e2e-renamed-by-a-member" }),
    });
    expect(memberRename.status, await memberRename.text()).toBe(200);

    // ── 4. A second user, so the admin can stop being a member ────────
    const inviteRes = await request.post("/api/auth/invite", {
      data: { email: secondEmail, role: "member" },
    });
    expect(inviteRes.status(), await inviteRes.text()).toBe(201);
    const invite = ((await inviteRes.json()) as { invite: { token: string } }).invite;

    // Raw fetch: accepting sets a session cookie, which must not land in the
    // admin's `request` context.
    const acceptRes = await fetch(`${baseURL}/api/auth/invite/${invite.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Second User",
        email: secondEmail,
        password: "e2e-Second-User-Passw0rd!",
      }),
    });
    expect(acceptRes.status, await acceptRes.clone().text()).toBe(201);
    const second = ((await acceptRes.json()) as { user: { id: string } }).user;

    // The second user joins as an owner: a project must keep at least one
    // owner, so the admin (the only owner so far) can leave only after that.
    const addRes = await request.post(`/api/projects/${project.id}/members`, {
      data: { userId: second.id, role: "owner" },
    });
    expect(addRes.status(), await addRes.text()).toBe(201);

    // Now removable — the last-member and last-owner rules only bite at one.
    const dropAdmin = await request.delete(`/api/projects/${project.id}/members/${admin.id}`);
    expect(dropAdmin.status(), await dropAdmin.text()).toBe(200);

    // ── 5. ATTACK: the same key, now a NON-member ─────────────────────
    // Nothing about the principal changed — same key, same `member` role,
    // same `write` scope. Only its membership did.
    const memberPut = await call(`/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/attacker/controlled" }),
    });
    expect(memberPut.status, await memberPut.text()).toBe(403);

    const memberDelete = await call(`/api/projects/${project.id}`, { method: "DELETE" });
    expect(memberDelete.status, await memberDelete.text()).toBe(403);

    // No mutation landed — `path` drives filesystem scoping, so a silent
    // rewrite is the sharpest edge of the original bug.
    const afterAttack = await request.get(`/api/projects/${project.id}`);
    expect(afterAttack.status()).toBe(200);
    expect(((await afterAttack.json()) as { path: string }).path).toBe("/tmp/e2e-authz-target");

    // Reads stay instance-global: the non-member can still SEE it, so the
    // 403s above are the write gate, not a lost id.
    const memberGet = await call(`/api/projects/${project.id}`);
    expect(memberGet.status).toBe(200);

    // ── 6. The admin override survives, without a membership row ──────
    const adminMembers = (await (
      await request.get(`/api/projects/${project.id}/members`)
    ).json()) as MemberRow[];
    expect(adminMembers.map((m) => m.userId)).toEqual([second.id]);

    const adminPut = await request.put(`/api/projects/${project.id}`, {
      data: { name: "e2e-authz-renamed-by-admin" },
    });
    expect(adminPut.status(), await adminPut.text()).toBe(200);
    expect(((await adminPut.json()) as { name: string }).name).toBe("e2e-authz-renamed-by-admin");

    // ── 7. The last member cannot be removed — 409, not 403 ───────────
    const dropLast = await request.delete(`/api/projects/${project.id}/members/${second.id}`);
    expect(dropLast.status(), await dropLast.text()).toBe(409);

    // ── 8. …and the admin can still delete the project itself ─────────
    const adminDelete = await request.delete(`/api/projects/${project.id}`);
    expect(adminDelete.status(), await adminDelete.text()).toBe(200);

    const gone = await request.get(`/api/projects/${project.id}`);
    expect(gone.status()).toBe(404);
  });
});
