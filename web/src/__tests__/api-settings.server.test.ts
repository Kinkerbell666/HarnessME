/**
 * GET /api/settings — the instance-wide settings list.
 *
 * Two things are pinned here:
 *
 *  1. The admin gate DENIES BY RETURNING. This route used to call the throwing
 *     `requireRole(locals, "admin")`; SvelteKit does not recognise a Response
 *     thrown from a route handler, so every non-admin caller received a 500
 *     `{"message":"Internal Error"}` instead of a 403. It now uses
 *     `requireAdmin`, which RETURNS its denial. `expectDenied` fails the test
 *     if the handler throws, so the regression cannot come back silently.
 *
 *  2. Sensitive keys are scrubbed from the payload even for an admin — the
 *     deny-list (`./deny-list`) is exercised for real, not mocked, because the
 *     scrub is the security-relevant half of this handler.
 */

import { test, expect, describe, vi, beforeEach } from "vitest";
import { expectDenied } from "./fixtures/expect-denied";
import { makeRequestEvent } from "./helpers/server-route-test-utils";

const getAllSettings = vi.fn(async () => ({}) as Record<string, unknown>);
vi.mock("$server/db/queries/settings", () => ({
  getAllSettings: (...a: unknown[]) =>
    (getAllSettings as unknown as (...x: unknown[]) => unknown)(...a),
  getSetting: vi.fn(async () => undefined),
  upsertSetting: vi.fn(async () => undefined),
}));

const { GET } = await import("../routes/api/settings/+server");

function makeEvent(locals: Record<string, unknown> = {}) {
  return makeRequestEvent("http://localhost/api/settings", {
    locals,
  });
}

const adminUser = { user: { id: "admin-1", email: "a@x", name: "a", role: "admin" } };
const memberUser = { user: { id: "u1", email: "u@x", name: "u", role: "member" } };

beforeEach(() => {
  getAllSettings.mockClear();
  getAllSettings.mockResolvedValue({});
});

describe("GET /api/settings", () => {
  test("non-admin cookie session → RETURNS 403 (never throws); settings never read", async () => {
    const res = await expectDenied(() => GET(makeEvent(memberUser)), 403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Admin role required");
    expect(getAllSettings).not.toHaveBeenCalled();
  });

  test("no principal at all → RETURNS 403 (never throws); settings never read", async () => {
    const res = await expectDenied(() => GET(makeEvent()), 403);
    expect(res.status).toBe(403);
    expect(getAllSettings).not.toHaveBeenCalled();
  });

  test("admin → 200 with the non-sensitive settings", async () => {
    getAllSettings.mockResolvedValue({ "ui:theme": "dark", "limits:rateLimit": { chat: 20 } });
    const res = await GET(makeEvent(adminUser));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ui:theme"]).toBe("dark");
    expect(body["limits:rateLimit"]).toEqual({ chat: 20 });
  });

  test("admin → sensitive keys are scrubbed from the payload", async () => {
    getAllSettings.mockResolvedValue({
      "ui:theme": "dark",
      "instance:jwtSecret": "super-secret",
      "provider:apiKey:openai": "enc:sk-x",
      "provider:oauth:google": { token: "t" },
      "apikey:u1:k1": { hash: "h" },
      "apikeyhash:abc": { userId: "u1", keyId: "k1" },
      "oauth:pending:st4te": { state: "st4te", codeVerifier: "pkce-verifier" },
    });
    const res = await GET(makeEvent(adminUser));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["ui:theme"]);
    expect(body["instance:jwtSecret"]).toBeUndefined();
    expect(body["provider:apiKey:openai"]).toBeUndefined();
    expect(body["provider:oauth:google"]).toBeUndefined();
    expect(body["apikey:u1:k1"]).toBeUndefined();
    expect(body["apikeyhash:abc"]).toBeUndefined();
    expect(body["oauth:pending:st4te"]).toBeUndefined();
  });
});
