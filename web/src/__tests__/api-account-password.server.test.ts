/**
 * Server-handler unit tests for /api/account/password/+server.ts.
 *
 * Covers auth gate, scope gate, validation, current-password verification,
 * happy-path side-effects (hashPassword + updateUserPassword keeping the
 * current session + audit log, with the session cookie untouched), and 404
 * when the user row is missing.
 */

import { test, expect, describe, vi, beforeEach } from "vitest";
import { expectThrownResponse } from "./helpers/server-route-test-utils";

vi.mock("$server/db/queries/users", () => ({
	getUserById: vi.fn(),
	updateUserPassword: vi.fn(),
}));

vi.mock("$server/auth/password", () => ({
	verifyPassword: vi.fn(),
	hashPassword: vi.fn(),
}));

vi.mock("$server/db/queries/audit-log", () => ({
	insertAuditEntry: vi.fn(async () => undefined),
}));

const { getUserById, updateUserPassword } = await import(
	"$server/db/queries/users"
);
const { verifyPassword, hashPassword } = await import("$server/auth/password");
const { insertAuditEntry } = await import("$server/db/queries/audit-log");
const { PUT } = await import("../routes/api/account/password/+server");

interface CookieCall {
	name: string;
	value: string;
	opts: Record<string, unknown>;
}

function makeEvent(opts: {
	body?: unknown;
	locals?: Record<string, unknown>;
	cookieCalls?: CookieCall[];
}) {
	return {
		url: new URL("http://localhost/api/account/password"),
		locals: opts.locals ?? {},
		cookies: {
			set: (name: string, value: string, o: Record<string, unknown>) => {
				opts.cookieCalls?.push({ name, value, opts: o });
			},
			get: () => undefined,
			delete: () => undefined,
		},
		request: new Request("http://localhost/api/account/password", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
		}),
	} as any;
}

const user = { id: "u1", email: "u@x", name: "u", role: "user" };
const dbUser = {
	id: "u1",
	email: "u@x",
	name: "u",
	role: "user",
	passwordHash: "$argon2id$old",
	createdAt: new Date(),
};

const VALID_BODY = { currentPassword: "OldPass1!", newPassword: "NewPass1!" };

describe("PUT /api/account/password", () => {
	beforeEach(() => {
		vi.mocked(getUserById).mockReset();
		vi.mocked(updateUserPassword).mockReset();
		vi.mocked(verifyPassword).mockReset();
		vi.mocked(hashPassword).mockReset();
		vi.mocked(insertAuditEntry).mockReset();
	});

	test("rejects 401 when no auth", async () => {
		await expectThrownResponse(
			() => PUT(makeEvent({ body: VALID_BODY })),
			401,
		);
	});

	test("returns 403 when API-key scope missing 'admin'", async () => {
		const res = await PUT(
			makeEvent({
				body: VALID_BODY,
				locals: { user, apiKeyScopes: ["chat"] },
			}),
		);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error?: string; required?: string };
		expect(body.error).toBe("Insufficient scope");
		expect(body.required).toBe("admin");
	});

	test("returns 400 on validation failure (missing fields)", async () => {
		const res = await PUT(
			makeEvent({
				body: {},
				locals: { user },
			}),
		);
		expect(res.status).toBe(400);
	});

	test("returns 404 when user row missing", async () => {
		vi.mocked(getUserById).mockResolvedValue(undefined as any);
		const res = await PUT(
			makeEvent({
				body: VALID_BODY,
				locals: { user },
			}),
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error?: string };
		expect(body.error).toBe("User not found");
	});

	test("returns 400 when currentPassword is incorrect", async () => {
		vi.mocked(getUserById).mockResolvedValue(dbUser as any);
		vi.mocked(verifyPassword).mockResolvedValue(false);
		const res = await PUT(
			makeEvent({
				body: VALID_BODY,
				locals: { user },
			}),
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: string };
		expect(body.error).toBe("Current password is incorrect");
		expect(vi.mocked(updateUserPassword)).not.toHaveBeenCalled();
		expect(vi.mocked(hashPassword)).not.toHaveBeenCalled();
	});

	test("happy path: hashes, persists, audits, and keeps only the current session", async () => {
		const cookieCalls: CookieCall[] = [];
		vi.mocked(getUserById).mockResolvedValue(dbUser as any);
		vi.mocked(verifyPassword).mockResolvedValue(true);
		vi.mocked(hashPassword).mockResolvedValue("$argon2id$NEW");
		vi.mocked(updateUserPassword).mockResolvedValue(true as any);

		const res = await PUT(
			makeEvent({
				body: VALID_BODY,
				locals: { user, sessionId: "current-session" },
				cookieCalls,
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { success?: boolean; message?: string };
		expect(body.success).toBe(true);
		expect(body.message).toBe("Password changed. Other sessions were signed out.");

		// Side-effect: hash was called with the new password
		expect(vi.mocked(hashPassword)).toHaveBeenCalledWith("NewPass1!");
		// The stored hash is the hashPassword return value, NOT the plaintext.
		// The caller's session is kept; updateUserPassword revokes the others.
		expect(vi.mocked(updateUserPassword)).toHaveBeenCalledWith(
			user.id,
			"$argon2id$NEW",
			{ keepSessionId: "current-session" },
		);
		// Side-effect: audit log entry written
		expect(vi.mocked(insertAuditEntry)).toHaveBeenCalledWith(
			user.id,
			"auth:password_changed",
		);
		// The current tab stays signed in: the session cookie is not touched.
		expect(cookieCalls).toEqual([]);
	});
});
