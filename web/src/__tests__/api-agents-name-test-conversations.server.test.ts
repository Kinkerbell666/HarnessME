/**
 * Server-handler unit tests for /api/agents/[name]/test-conversations
 * (+server.ts).
 *
 * Covers GET/DELETE auth gate (401), missing-agent 404 via
 * getAgentConfigByName, and the happy paths with mocked DB queries.
 *
 * Agent configs are shared, but each test conversation belongs to the user
 * who ran it. GET lists, and DELETE removes, only the caller's own: the
 * route passes the caller's id to both queries, which scope by it (see
 * src/__tests__/agent-sandbox.test.ts for the query-level proof).
 */

import { test, expect, describe, vi, beforeEach } from "vitest";
import { expectThrownResponse as expectThrown, makeRequestEvent } from "./helpers/server-route-test-utils";

vi.mock("$server/db/queries/agent-configs", () => ({
  getAgentConfigByName: vi.fn(),
}));

vi.mock("$server/db/queries/conversations", () => ({
  getTestConversations: vi.fn(),
  deleteTestConversations: vi.fn(),
}));

const { getAgentConfigByName } = await import(
  "$server/db/queries/agent-configs"
);
const { getTestConversations, deleteTestConversations } = await import(
  "$server/db/queries/conversations"
);
const { GET, DELETE } = await import(
  "../routes/api/agents/[name]/test-conversations/+server.ts"
);

function makeEvent(opts: {
  name?: string;
  locals?: Record<string, unknown>;
}) {
  const name = opts.name ?? "test-agent";
  const href = `http://localhost/api/agents/${name}/test-conversations`;
  return makeRequestEvent(href, {
    locals: opts.locals ?? {},
    params: { name },
  });
}

const user = { id: "u1", email: "u@x", name: "u", role: "user" };

describe("GET /api/agents/[name]/test-conversations", () => {
  beforeEach(() => {
    vi.mocked(getAgentConfigByName).mockReset();
    vi.mocked(getTestConversations).mockReset();
  });

  test("rejects 401 when unauthenticated", async () => {
    await expectThrown(() => GET(makeEvent({ locals: {} })), 401);
  });

  test("returns 404 when agent-config not found", async () => {
    vi.mocked(getAgentConfigByName).mockResolvedValue(undefined);
    const res = await GET(makeEvent({ locals: { user } }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Agent not found");
  });

  test("lists only the caller's own test conversations", async () => {
    vi.mocked(getAgentConfigByName).mockResolvedValue({
      id: "cfg-1",
      name: "test-agent",
    } as any);
    vi.mocked(getTestConversations).mockResolvedValue([{ id: "c-1", title: "mine", userId: "u1" }] as any);
    const res = await GET(makeEvent({ locals: { user } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((c) => c.id)).toEqual(["c-1"]);
    expect(getTestConversations).toHaveBeenCalledWith("cfg-1", "u1");
  });
});

describe("DELETE /api/agents/[name]/test-conversations", () => {
  beforeEach(() => {
    vi.mocked(getAgentConfigByName).mockReset();
    vi.mocked(deleteTestConversations).mockReset();
  });

  test("rejects 401 when unauthenticated", async () => {
    await expectThrown(() => DELETE(makeEvent({ locals: {} })), 401);
  });

  test("returns 404 when agent-config not found", async () => {
    vi.mocked(getAgentConfigByName).mockResolvedValue(undefined);
    const res = await DELETE(makeEvent({ locals: { user } }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Agent not found");
  });

  test("deletes only the caller's own test conversations", async () => {
    vi.mocked(getAgentConfigByName).mockResolvedValue({
      id: "cfg-1",
      name: "test-agent",
    } as any);
    vi.mocked(deleteTestConversations).mockResolvedValue(2);
    const res = await DELETE(makeEvent({ locals: { user } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(2);
    expect(deleteTestConversations).toHaveBeenCalledWith("cfg-1", "u1");
  });
});
