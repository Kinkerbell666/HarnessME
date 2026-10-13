import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { setupPiAiMocks } from "./helpers/mock-pi-ai";

// Set up pi-ai mocks BEFORE any imports that trigger executor module loading
setupPiAiMocks({ textChunks: ["Hello"] });

import { EventBus } from "../runtime/events";
import { AgentExecutor } from "../runtime/executor";
import { loadAgents } from "../runtime/loader";
import { startTestServer as startServer, TEST_USER_HEADER } from "./helpers/test-server";
import { setupTestDb, closeTestDb, mockDbConnection, mockRealSettings, restoreFetch } from "./helpers/test-pglite";
import { createProject } from "../db/queries/projects";
import { createAgentConfig } from "../db/queries/agent-configs";
import { createUser } from "../db/queries/users";
import type { AgentEvents } from "../types";

mockDbConnection();

mockRealSettings();
let server: Awaited<ReturnType<typeof startServer>>;
let baseUrl: string;
let projectId: string;
let agentConfigId: string;
let asUser: Record<string, string>;
let asOtherUser: Record<string, string>;

beforeAll(async () => {
  restoreFetch();
  mockDbConnection();
  mockRealSettings();
  await setupTestDb();
  const agents = await loadAgents(import.meta.dir + "/../agents");
  const bus = new EventBus<AgentEvents>();
  const executor = new AgentExecutor(agents, bus);
  server = await startServer(0, executor, bus);
  baseUrl = `http://localhost:${server.port}`;

  const project = await createProject({ name: "Sandbox Test Project", path: "/tmp/sandbox-test" });
  projectId = project.id;

  const agentConfig = await createAgentConfig({ name: "Test Agent", description: "test", prompt: "You are a test agent" });
  agentConfigId = agentConfig.id;

  const user = await createUser({ email: "sandbox-api@test.com", passwordHash: "hash", name: "Sandbox API" });
  const other = await createUser({ email: "sandbox-api-other@test.com", passwordHash: "hash", name: "Sandbox Other" });
  asUser = { [TEST_USER_HEADER]: user.id };
  asOtherUser = { [TEST_USER_HEADER]: other.id };
});

afterAll(async () => {
  server?.stop(true);
  await closeTestDb();
});

beforeEach(() => {
  restoreFetch();
  mockDbConnection();
  mockRealSettings();
});

describe("Sandbox test conversation API", () => {
  let normalConvId: string;
  let testConvId: string;

  test("create normal and test conversations", async () => {
    const normalRes = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title: "Normal Conv" }),
    });
    expect(normalRes.status).toBe(201);
    normalConvId = ((await normalRes.json()) as any).id;

    const testRes = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asUser },
      body: JSON.stringify({ projectId, title: "Test Conv", test: true, agentConfigId }),
    });
    expect(testRes.status).toBe(201);
    testConvId = ((await testRes.json()) as any).id;
  });

  test("GET /api/conversations excludes test conversations", async () => {
    const res = await fetch(`${baseUrl}/api/conversations?projectId=${projectId}`);
    expect(res.status).toBe(200);
    const convs = (await res.json()) as any[];
    expect(convs.some((c: any) => c.id === normalConvId)).toBe(true);
    expect(convs.some((c: any) => c.id === testConvId)).toBe(false);
  });

  test("GET /api/agents/:agentConfigId/test-conversations returns only test conversations", async () => {
    const res = await fetch(`${baseUrl}/api/agents/${agentConfigId}/test-conversations`, { headers: asUser });
    expect(res.status).toBe(200);
    const convs = (await res.json()) as any[];
    expect(convs.some((c: any) => c.id === testConvId)).toBe(true);
    expect(convs.some((c: any) => c.id === normalConvId)).toBe(false);
  });

  test("another user neither sees nor deletes them", async () => {
    const list = await fetch(`${baseUrl}/api/agents/${agentConfigId}/test-conversations`, { headers: asOtherUser });
    expect(await list.json()).toEqual([]);
    const del = await fetch(`${baseUrl}/api/agents/${agentConfigId}/test-conversations`, { method: "DELETE", headers: asOtherUser });
    expect(((await del.json()) as any).deleted).toBe(0);
  });

  test("DELETE /api/agents/:agentConfigId/test-conversations bulk deletes and returns count", async () => {
    const res = await fetch(`${baseUrl}/api/agents/${agentConfigId}/test-conversations`, {
      method: "DELETE",
      headers: asUser,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.deleted).toBeGreaterThanOrEqual(1);
  });

  test("after delete, GET returns empty array", async () => {
    const res = await fetch(`${baseUrl}/api/agents/${agentConfigId}/test-conversations`, { headers: asUser });
    expect(res.status).toBe(200);
    const convs = (await res.json()) as any[];
    expect(convs).toEqual([]);
  });
});
