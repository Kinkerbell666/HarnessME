/**
 * Unit tests for requireAdmin (locked decision 1) — all four branches:
 * admin user returned; null for member role / non-ok response / fetch
 * throw / empty body.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { canDeleteProject, requireAdmin, type CurrentUser } from "./admin-guard";

const admin: CurrentUser = { id: "u1", email: "boss@corp.io", name: "Boss", role: "admin" };
const member: CurrentUser = { id: "u2", email: "pleb@corp.io", name: "Pleb", role: "member" };

afterEach(() => vi.unstubAllGlobals());

describe("requireAdmin", () => {
	test("returns the user when they are an admin", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user: admin })));
		await expect(requireAdmin()).resolves.toEqual(admin);
		expect(fetch).toHaveBeenCalledWith("/api/auth/me");
	});

	test("returns null for a member user", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user: member })));
		await expect(requireAdmin()).resolves.toBeNull();
	});

	test("returns null on a non-ok response", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user: admin }, { status: 401 })));
		await expect(requireAdmin()).resolves.toBeNull();
	});

	test("returns null when fetch throws", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => {
			throw new Error("network down");
		}));
		await expect(requireAdmin()).resolves.toBeNull();
	});

	test("returns null on an empty / userless body", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
		await expect(requireAdmin()).resolves.toBeNull();

		// Truly empty body — res.json() rejects, caught by the guard.
		vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
		await expect(requireAdmin()).resolves.toBeNull();
	});
});

describe("canDeleteProject", () => {
	function stub(user: CurrentUser | null, members: { userId: string; role: string }[] | number) {
		vi.stubGlobal("fetch", vi.fn(async (input: string) => {
			if (input === "/api/auth/me") return user ? Response.json({ user }) : Response.json({}, { status: 401 });
			if (input === "/api/projects/p%2F1/members") {
				return typeof members === "number" ? Response.json({ error: "Forbidden" }, { status: members }) : Response.json(members);
			}
			throw new Error(`unexpected fetch ${input}`);
		}));
	}

	test("an instance admin may delete without a membership row", async () => {
		stub(admin, []);
		await expect(canDeleteProject("p/1")).resolves.toBe(true);
	});

	test("a project owner may delete", async () => {
		stub(member, [{ userId: member.id, role: "owner" }]);
		await expect(canDeleteProject("p/1")).resolves.toBe(true);
	});

	test("a plain project member may not", async () => {
		stub(member, [{ userId: member.id, role: "member" }, { userId: "other", role: "owner" }]);
		await expect(canDeleteProject("p/1")).resolves.toBe(false);
	});

	test("a non-member, refused the member list, may not", async () => {
		stub(member, 403);
		await expect(canDeleteProject("p/1")).resolves.toBe(false);
	});

	test("no signed-in user may not", async () => {
		stub(null, []);
		await expect(canDeleteProject("p/1")).resolves.toBe(false);
	});

	test("a member list request that throws hides the control", async () => {
		vi.stubGlobal("fetch", vi.fn(async (input: string) => {
			if (input === "/api/auth/me") return Response.json({ user: member });
			throw new Error("network down");
		}));
		await expect(canDeleteProject("p/1")).resolves.toBe(false);
		expect(fetch).toHaveBeenCalledWith("/api/projects/p%2F1/members");
	});
});
