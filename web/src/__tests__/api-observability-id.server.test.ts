/**
 * Server-handler unit tests for /api/observability/[conversationId]/+server.ts.
 *
 * Auth + read-scope gated, and owner-gated: the events carry tool errors and
 * agent result previews, so only the conversation's (root) owner or an admin
 * may read them. Anyone else gets the same 404 as an unknown id. Happy path
 * fans out to both observability queries and merges the result. No real DB.
 */

import { test, expect, describe, vi, beforeEach } from "vitest";
import { makeRequestEvent } from "./helpers/server-route-test-utils";

vi.mock("$server/db/queries/observability", () => ({
  getConversationObservability: vi.fn(async () => []),
  getConversationStats: vi.fn(async () => ({ runs: 0 })),
}));

vi.mock("$server/db/queries/conversations", () => ({
  getConversation: vi.fn(),
}));

const { getConversation } = await import("$server/db/queries/conversations");
const { getConversationObservability, getConversationStats } = await import(
  "$server/db/queries/observability"
);
const { GET } = await import(
  "../routes/api/observability/[conversationId]/+server"
);

function makeEvent(opts: {
  conversationId?: string;
  locals?: Record<string, unknown>;
}) {
  const id = opts.conversationId ?? "c-1";
  const url = `http://localhost/api/observability/${id}`;
  return makeRequestEvent(url, {
    locals: opts.locals ?? {},
    params: { conversationId: id },
  });
}

const authedUser = { user: { id: "u1", email: "u@x", name: "u", role: "user" } };
const otherUser = { user: { id: "u2", email: "o@x", name: "o", role: "user" } };
const adminUser = { user: { id: "a1", email: "a@x", name: "a", role: "admin" } };

describe("GET /api/observability/[conversationId]", () => {
  beforeEach(() => {
    vi.mocked(getConversationObservability).mockReset();
    vi.mocked(getConversationStats).mockReset();
    vi.mocked(getConversation).mockReset();
    vi.mocked(getConversation).mockImplementation(async (id: string) =>
      id === "missing" ? null : ({ id, userId: "u1", parentConversationId: null } as any),
    );
  });

  test("returns 401 when locals.user is missing", async () => {
    const res = await GET(makeEvent({}));
    expect(res.status).toBe(401);
    expect(getConversationObservability).not.toHaveBeenCalled();
  });

  test("another user gets 404 and no events are read", async () => {
    const res = await GET(makeEvent({ conversationId: "conv-42", locals: otherUser }));
    expect(res.status).toBe(404);
    expect(getConversationObservability).not.toHaveBeenCalled();
    expect(getConversationStats).not.toHaveBeenCalled();
  });

  test("an unknown conversation gets the same 404", async () => {
    const res = await GET(makeEvent({ conversationId: "missing", locals: authedUser }));
    expect(res.status).toBe(404);
  });

  test("an admin may read any conversation", async () => {
    vi.mocked(getConversationObservability).mockResolvedValue([]);
    vi.mocked(getConversationStats).mockResolvedValue({ runs: 0 } as any);
    const res = await GET(makeEvent({ conversationId: "conv-42", locals: adminUser }));
    expect(res.status).toBe(200);
  });

  test("the owner of the root conversation may read a sub-conversation", async () => {
    vi.mocked(getConversation).mockImplementation(async (id: string) =>
      id === "sub" ? ({ id, userId: null, parentConversationId: "root" } as any) : ({ id, userId: "u1", parentConversationId: null } as any),
    );
    vi.mocked(getConversationObservability).mockResolvedValue([]);
    vi.mocked(getConversationStats).mockResolvedValue({ runs: 0 } as any);
    const res = await GET(makeEvent({ conversationId: "sub", locals: authedUser }));
    expect(res.status).toBe(200);
  });

  test("rejects 403 when API-key lacks 'read' scope", async () => {
    const res = await GET(
      makeEvent({ locals: { ...authedUser, apiKeyScopes: ["chat"] } }),
    );
    expect(res.status).toBe(403);
  });

  test("the owner gets merged events + stats for the conversation id", async () => {
    vi.mocked(getConversationObservability).mockResolvedValue([
      { id: "e1" },
    ] as any);
    vi.mocked(getConversationStats).mockResolvedValue({ runs: 3 } as any);
    const res = await GET(
      makeEvent({ conversationId: "conv-42", locals: authedUser }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events?: Array<{ id: string }>;
      stats?: { runs: number };
    };
    expect(body.events).toEqual([{ id: "e1" }]);
    expect(body.stats).toEqual({ runs: 3 });
    expect(getConversationObservability).toHaveBeenCalledWith("conv-42");
    expect(getConversationStats).toHaveBeenCalledWith("conv-42");
  });
});
