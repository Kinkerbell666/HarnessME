/**
 * Server-handler unit tests for /api/observability/+server.ts.
 *
 * Auth + read-scope gated. An admin gets totals across every user; anyone
 * else gets the same shape for their own conversations only (the query
 * filters by `userId`). `scope` tells the dashboard which one it got. The
 * observability query is mocked; the test also asserts the NaN-safe
 * default (30) and that query values flow through.
 */

import { test, expect, describe, vi, beforeEach } from "vitest";
import { makeRequestEvent } from "./helpers/server-route-test-utils";

vi.mock("$server/db/queries/observability", () => ({
  getGlobalStats: vi.fn(async () => ({ totalRuns: 0 })),
}));

const { getGlobalStats } = await import(
  "$server/db/queries/observability"
);
const { GET } = await import("../routes/api/observability/+server");

function makeEvent(opts: {
  locals?: Record<string, unknown>;
  query?: Record<string, string>;
}) {
  const qs = opts.query
    ? "?" + new URLSearchParams(opts.query).toString()
    : "";
  const url = "http://localhost/api/observability" + qs;
  return makeRequestEvent(url, {
    locals: opts.locals ?? {},
  });
}

const authedUser = { user: { id: "u1", email: "u@x", name: "u", role: "user" } };
const adminUser = { user: { id: "a1", email: "a@x", name: "a", role: "admin" } };

describe("GET /api/observability", () => {
  beforeEach(() => vi.mocked(getGlobalStats).mockReset());

  test("returns 401 when locals.user is missing", async () => {
    const res = await GET(makeEvent({}));
    expect(res.status).toBe(401);
    expect(getGlobalStats).not.toHaveBeenCalled();
  });

  test("an admin gets totals across all users", async () => {
    vi.mocked(getGlobalStats).mockResolvedValue({ totalRuns: 9 } as any);
    const res = await GET(makeEvent({ locals: adminUser }));
    expect(getGlobalStats).toHaveBeenCalledWith({ days: 30 });
    expect(await res.json()).toEqual({ totalRuns: 9, scope: "all" });
  });

  test("any other user gets totals for their own conversations only", async () => {
    vi.mocked(getGlobalStats).mockResolvedValue({ totalRuns: 1 } as any);
    const res = await GET(makeEvent({ locals: authedUser }));
    expect(getGlobalStats).toHaveBeenCalledWith({ days: 30, userId: "u1" });
    expect(await res.json()).toEqual({ totalRuns: 1, scope: "own" });
  });

  test("rejects 403 when API-key lacks 'read' scope", async () => {
    const res = await GET(
      makeEvent({ locals: { ...authedUser, apiKeyScopes: ["chat"] } }),
    );
    expect(res.status).toBe(403);
  });

  test("defaults days to 30 when not supplied", async () => {
    vi.mocked(getGlobalStats).mockResolvedValue({ totalRuns: 5 } as any);
    await GET(makeEvent({ locals: adminUser }));
    expect(getGlobalStats).toHaveBeenCalledWith({ days: 30 });
  });

  test("falls back to 30 when days query is NaN", async () => {
    vi.mocked(getGlobalStats).mockResolvedValue({ totalRuns: 5 } as any);
    await GET(
      makeEvent({ locals: adminUser, query: { days: "notanumber" } }),
    );
    expect(getGlobalStats).toHaveBeenCalledWith({ days: 30 });
  });

  test("passes parsed days through to getGlobalStats", async () => {
    vi.mocked(getGlobalStats).mockResolvedValue({ totalRuns: 5 } as any);
    await GET(makeEvent({ locals: adminUser, query: { days: "7" } }));
    expect(getGlobalStats).toHaveBeenCalledWith({ days: 7 });
  });

  test("returns 200 with stats body", async () => {
    vi.mocked(getGlobalStats).mockResolvedValue({ totalRuns: 42 } as any);
    const res = await GET(makeEvent({ locals: authedUser }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalRuns?: number };
    expect(body.totalRuns).toBe(42);
  });
});
