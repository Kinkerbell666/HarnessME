/**
 * Owner scoping of the observability and agent test-conversation routes,
 * end to end over a real PGlite database.
 *
 *   - GET /api/observability/[conversationId]: the root conversation's
 *     owner or an admin; anyone else gets the same 404 as an unknown id.
 *   - GET /api/observability: an admin gets every user's totals
 *     (`scope: "all"`), anyone else only their own (`scope: "own"`).
 *   - GET/DELETE /api/agents/[name]/test-conversations: agent configs are
 *     shared, but each test conversation is its runner's own.
 *   - No session is a 401 on every one, returned rather than thrown.
 *
 * Same harness as feature-endpoints.test.ts: real queries behind the mocked
 * `$server/*` aliases, scope opened at the boundary.
 */
import { test, expect, describe, beforeEach, afterAll, mock } from "bun:test";
import { setupTestDb, closeTestDb, mockDbConnection } from "./helpers/test-pglite";
import { restoreModuleMocks, webLibModule } from "./helpers/mock-cleanup";
import { mockServerAlias, createMockEvent, ADMIN_USER, MEMBER_USER } from "./helpers/mock-request";

mockDbConnection();
mockServerAlias();

mock.module("$server/db/queries/observability", () => require("../db/queries/observability"));
mock.module("$lib/server/security/api-keys", () => webLibModule("server/security/api-keys", { requireScope: () => null }));
mock.module("$lib/server/http-errors", () => require("../../web/src/lib/server/http-errors"));
mock.module("$lib/server/conversation-ownership", () => require("../../web/src/lib/server/conversation-ownership"));
mock.module("../../web/src/routes/api/observability/$types", () => ({}));
mock.module("../../web/src/routes/api/observability/[conversationId]/$types", () => ({}));
mock.module("../../web/src/routes/api/agents/[name]/test-conversations/$types", () => ({}));

import { GET as statsGet } from "../../web/src/routes/api/observability/+server";
import { GET as conversationGet } from "../../web/src/routes/api/observability/[conversationId]/+server";
import { GET as testConvsGet, DELETE as testConvsDelete } from "../../web/src/routes/api/agents/[name]/test-conversations/+server";

const { createProject } = await import("../db/queries/projects");
const { createUser } = await import("../db/queries/users");
const { createConversation, createMessage } = await import("../db/queries/conversations");
const { insertObservabilityEvent } = await import("../db/queries/observability");
const { createAgentConfig } = await import("../db/queries/agent-configs");

const OTHER_USER = { ...MEMBER_USER, id: "member-002", email: "other@test.local" };

afterAll(async () => {
  restoreModuleMocks();
  await closeTestDb();
});

let ownConv: string;
let ownSub: string;
let otherConv: string;

beforeEach(async () => {
  await setupTestDb();
  for (const u of [ADMIN_USER, MEMBER_USER, OTHER_USER]) {
    await createUser({ id: u.id, email: u.email, passwordHash: "hash", name: u.name, role: u.role });
  }
  const project = await createProject({ name: "Scope", path: "/tmp/scope" });
  ownConv = (await createConversation(project.id, { title: "mine", userId: MEMBER_USER.id })).id;
  ownSub = (await createConversation(project.id, { title: "sub", parentConversationId: ownConv })).id;
  otherConv = (await createConversation(project.id, { title: "theirs", userId: OTHER_USER.id })).id;
  for (const [conv, tokens] of [[ownConv, 10], [ownSub, 5], [otherConv, 1000]] as const) {
    await createMessage(conv, { role: "assistant", content: "r", usage: { inputTokens: tokens, outputTokens: tokens } });
    await insertObservabilityEvent({ conversationId: conv, eventType: "tool_call", data: { extensionId: "ext", success: true }, durationMs: 10 });
  }
});

const convEvent = (conversationId: string, user?: unknown) =>
  createMockEvent({ url: `http://localhost/api/observability/${conversationId}`, params: { conversationId }, user: user as any });

describe("GET /api/observability/[conversationId]", () => {
  test("the owner reads their conversation, and a sub-conversation below it", async () => {
    for (const id of [ownConv, ownSub]) {
      const res = (await conversationGet(convEvent(id, MEMBER_USER) as any)) as Response;
      expect(res.status).toBe(200);
      const body = (await res.json()) as { events: unknown[] };
      expect(body.events).toHaveLength(1);
    }
  });

  test("another user and an unknown id both get 404; an admin reads any", async () => {
    expect(((await conversationGet(convEvent(otherConv, MEMBER_USER) as any)) as Response).status).toBe(404);
    expect(((await conversationGet(convEvent("no-such-conv", MEMBER_USER) as any)) as Response).status).toBe(404);
    expect(((await conversationGet(convEvent(otherConv, ADMIN_USER) as any)) as Response).status).toBe(200);
  });

  test("no session is a 401 response, not a thrown one", async () => {
    expect(((await conversationGet(convEvent(ownConv) as any)) as Response).status).toBe(401);
  });
});

describe("GET /api/observability", () => {
  const statsEvent = (user?: unknown) => createMockEvent({ url: "http://localhost/api/observability?days=30", user: user as any });

  test("a member gets totals for their own conversations only", async () => {
    const res = (await statsGet(statsEvent(MEMBER_USER) as any)) as Response;
    const body = (await res.json()) as { scope: string; totalInputTokens: number; totalToolCalls: number };
    expect(body).toMatchObject({ scope: "own", totalInputTokens: 15, totalToolCalls: 2 });
  });

  test("an admin gets every user's totals", async () => {
    const res = (await statsGet(statsEvent(ADMIN_USER) as any)) as Response;
    const body = (await res.json()) as { scope: string; totalInputTokens: number; totalToolCalls: number };
    expect(body).toMatchObject({ scope: "all", totalInputTokens: 1015, totalToolCalls: 3 });
  });

  test("no session is a 401 response", async () => {
    expect(((await statsGet(statsEvent() as any)) as Response).status).toBe(401);
  });
});

describe("/api/agents/[name]/test-conversations", () => {
  test("lists and deletes only the caller's own test conversations of a shared agent", async () => {
    const agent = await createAgentConfig({ name: "shared-agent", description: "d", prompt: "p" } as any);
    const project = await createProject({ name: "Agents", path: "/tmp/agents" });
    const mine = await createConversation(project.id, { title: "my test", agentConfigId: agent.id, test: true, userId: MEMBER_USER.id });
    const theirs = await createConversation(project.id, { title: "their test", agentConfigId: agent.id, test: true, userId: OTHER_USER.id });
    const event = (method: string, user: unknown) =>
      createMockEvent({ method, url: "http://localhost/api/agents/shared-agent/test-conversations", params: { name: "shared-agent" }, user: user as any });

    const listed = (await (await testConvsGet(event("GET", MEMBER_USER) as any) as Response).json()) as Array<{ id: string }>;
    expect(listed.map((c) => c.id)).toEqual([mine.id]);

    const deleted = (await (await testConvsDelete(event("DELETE", MEMBER_USER) as any) as Response).json()) as { deleted: number };
    expect(deleted.deleted).toBe(1);
    const left = (await (await testConvsGet(event("GET", OTHER_USER) as any) as Response).json()) as Array<{ id: string }>;
    expect(left.map((c) => c.id)).toEqual([theirs.id]);
  });
});
