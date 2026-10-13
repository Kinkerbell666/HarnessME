import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import { setupTestDb, closeTestDb, mockDbConnection } from "./helpers/test-pglite";

// Must mock before importing modules that use db/connection
mockDbConnection();

import { getDb } from "../db/connection";
import { projects, agentConfigs, conversations, observabilityEvents, users } from "../db/schema";
import {
  createConversation,
  createMessage,
  listConversations,
  getTestConversations,
  deleteTestConversations,
} from "../db/queries/conversations";
import {
  insertObservabilityEvent,
  getConversationObservability,
  getConversationStats,
  getGlobalStats,
} from "../db/queries/observability";
import { ObservabilityCollector, startCollector } from "../observability/collector";
import { EventBus } from "../runtime/events";
import type { AgentEvents } from "../types";
import { eq, sql } from "drizzle-orm";

// ── Setup ────────────────────────────────────────────────────────────

let projectId: string;
let agentConfigId: string;
let agentConfigId2: string;
// Test conversations are per user; every sandbox row here belongs to this one.
let userId: string;

beforeAll(async () => {
  await setupTestDb();
  const userRows = await getDb()
    .insert(users)
    .values({ email: "sandbox-obs@test.com", passwordHash: "hash", name: "Sandbox Obs" })
    .returning();
  userId = userRows[0]!.id;

  // Seed a project
  const projRows = await getDb()
    .insert(projects)
    .values({ name: "Test Project", path: "/test" })
    .returning();
  projectId = projRows[0]!.id;

  // Seed agent configs for sandbox tests
  const configRows = await getDb()
    .insert(agentConfigs)
    .values([
      { name: "agent-alpha", prompt: "You are alpha" },
      { name: "agent-beta", prompt: "You are beta" },
    ])
    .returning();
  agentConfigId = configRows[0]!.id;
  agentConfigId2 = configRows[1]!.id;
});

afterAll(async () => {
  await closeTestDb();
});

afterEach(async () => {
  // Delete the observability rows OUTRIGHT, then the conversations.
  //
  // The cascade alone is no longer sufficient: `conversation_id` is
  // nullable, and a row with no conversation has nothing to cascade FROM
  // — it would survive every `afterEach` and accumulate. `getGlobalStats`
  // is deliberately unfiltered by conversation, so the exact-count
  // assertions in this file (`totalToolCalls`, `topExtensions.length`)
  // would silently inflate the first time anything in the shared test DB
  // wrote a workflow-scoped tool call.
  await getDb().delete(observabilityEvents);
  await getDb().delete(conversations);
});

// ── 1. Conversation Sandbox Queries ──────────────────────────────────

describe("createConversation", () => {
  test("creates conversation with test:false by default", async () => {
    const conv = await createConversation(projectId);
    expect(conv.test).toBe(false);
    expect(conv.projectId).toBe(projectId);
    expect(conv.id).toBeDefined();
  });

  test("creates conversation with test:true when specified", async () => {
    const conv = await createConversation(projectId, { test: true });
    expect(conv.test).toBe(true);
  });

  test("creates conversation with agentConfigId", async () => {
    const conv = await createConversation(projectId, {
      agentConfigId,
      test: true,
    });
    expect(conv.agentConfigId).toBe(agentConfigId);
  });

  test("creates conversation with all optional fields", async () => {
    const conv = await createConversation(projectId, {
      title: "Full Options Test",
      model: "claude-3",
      provider: "anthropic",
      agentConfigId,
      systemPrompt: "Be helpful",
      test: true,
    });
    expect(conv.title).toBe("Full Options Test");
    expect(conv.model).toBe("claude-3");
    expect(conv.provider).toBe("anthropic");
    expect(conv.agentConfigId).toBe(agentConfigId);
    expect(conv.systemPrompt).toBe("Be helpful");
    expect(conv.test).toBe(true);
  });
});

describe("listConversations", () => {
  test("returns only non-test conversations (test=false or test=null)", async () => {
    await createConversation(projectId, { title: "Normal 1" });
    await createConversation(projectId, { title: "Normal 2" });
    await createConversation(projectId, { title: "Test Conv", test: true, agentConfigId, userId });

    const list = await listConversations(projectId);
    expect(list.length).toBe(2);
    expect(list.every((c) => !c.test)).toBe(true);
  });

  test("does NOT return test conversations (test=true)", async () => {
    await createConversation(projectId, { title: "Test Only", test: true, agentConfigId, userId });

    const list = await listConversations(projectId);
    expect(list.length).toBe(0);
  });

  test("orders by updatedAt desc", async () => {
    const older = await createConversation(projectId, { title: "Older" });
    // Force updatedAt difference
    await getDb()
      .update(conversations)
      .set({ updatedAt: sql`NOW() + interval '1 second'` })
      .where(eq(conversations.id, older.id));

    const newer = await createConversation(projectId, { title: "Newer" });
    await getDb()
      .update(conversations)
      .set({ updatedAt: sql`NOW() + interval '2 seconds'` })
      .where(eq(conversations.id, newer.id));

    const list = await listConversations(projectId);
    expect(list.length).toBe(2);
    expect(list[0]!.title).toBe("Newer");
    expect(list[1]!.title).toBe("Older");
  });
});

describe("getTestConversations", () => {
  test("returns only test conversations for given agentConfigId", async () => {
    await createConversation(projectId, { title: "Test Alpha", test: true, agentConfigId, userId });
    await createConversation(projectId, { title: "Test Beta", test: true, agentConfigId: agentConfigId2, userId });
    await createConversation(projectId, { title: "Normal", agentConfigId });

    const tests = await getTestConversations(agentConfigId, userId);
    expect(tests.length).toBe(1);
    expect(tests[0]!.title).toBe("Test Alpha");
    expect(tests[0]!.test).toBe(true);
    expect(tests[0]!.agentConfigId).toBe(agentConfigId);
  });

  test("returns empty array when no test conversations exist", async () => {
    const tests = await getTestConversations(agentConfigId, userId);
    expect(tests).toEqual([]);
  });

  test("orders by createdAt desc", async () => {
    await createConversation(projectId, { title: "First", test: true, agentConfigId, userId });
    // Push second conversation's createdAt into the future so ordering is deterministic
    const second = await createConversation(projectId, { title: "Second", test: true, agentConfigId, userId });
    await getDb()
      .update(conversations)
      .set({ createdAt: sql`NOW() + interval '1 second'` })
      .where(eq(conversations.id, second.id));

    const tests = await getTestConversations(agentConfigId, userId);
    expect(tests.length).toBe(2);
    // Most recent first
    expect(tests[0]!.title).toBe("Second");
    expect(tests[1]!.title).toBe("First");
  });
});

describe("deleteTestConversations", () => {
  test("deletes all test conversations for given agentConfigId", async () => {
    await createConversation(projectId, { title: "T1", test: true, agentConfigId, userId });
    await createConversation(projectId, { title: "T2", test: true, agentConfigId, userId });

    const count = await deleteTestConversations(agentConfigId, userId);
    expect(count).toBe(2);

    const remaining = await getTestConversations(agentConfigId, userId);
    expect(remaining.length).toBe(0);
  });

  test("returns count of deleted conversations", async () => {
    await createConversation(projectId, { title: "T1", test: true, agentConfigId, userId });
    await createConversation(projectId, { title: "T2", test: true, agentConfigId, userId });
    await createConversation(projectId, { title: "T3", test: true, agentConfigId, userId });

    const count = await deleteTestConversations(agentConfigId, userId);
    expect(count).toBe(3);
  });

  test("does NOT delete non-test conversations", async () => {
    await createConversation(projectId, { title: "Normal", agentConfigId });
    await createConversation(projectId, { title: "Test", test: true, agentConfigId, userId });

    await deleteTestConversations(agentConfigId, userId);

    const list = await listConversations(projectId);
    expect(list.length).toBe(1);
    expect(list[0]!.title).toBe("Normal");
  });

  test("does NOT delete test conversations for other agentConfigIds", async () => {
    await createConversation(projectId, { title: "Alpha Test", test: true, agentConfigId, userId });
    await createConversation(projectId, { title: "Beta Test", test: true, agentConfigId: agentConfigId2, userId });

    await deleteTestConversations(agentConfigId, userId);

    const alphaTests = await getTestConversations(agentConfigId, userId);
    const betaTests = await getTestConversations(agentConfigId2, userId);
    expect(alphaTests.length).toBe(0);
    expect(betaTests.length).toBe(1);
    expect(betaTests[0]!.title).toBe("Beta Test");
  });
});

// ── 2. Observability Queries ─────────────────────────────────────────

describe("insertObservabilityEvent", () => {
  test("inserts event with all fields", async () => {
    const conv = await createConversation(projectId);
    // Seed a message for messageId reference
    const msgId = crypto.randomUUID();
    await getDb().execute(
      sql`INSERT INTO messages (id, conversation_id, role, content) VALUES (${msgId}, ${conv.id}, 'user', 'hello')`,
    );

    const event = await insertObservabilityEvent({
      conversationId: conv.id,
      messageId: msgId,
      eventType: "turn_summary",
      data: { tokenUsage: { input: 100, output: 200 }, totalDurationMs: 500 },
      durationMs: 500,
    });

    expect(event.id).toBeDefined();
    expect(event.conversationId).toBe(conv.id);
    expect(event.messageId).toBe(msgId);
    expect(event.eventType).toBe("turn_summary");
    expect(event.durationMs).toBe(500);
    expect((event.data as any).tokenUsage.input).toBe(100);
  });

  test("inserts event with optional fields omitted", async () => {
    const conv = await createConversation(projectId);

    const event = await insertObservabilityEvent({
      conversationId: conv.id,
      eventType: "tool_call",
      data: { toolName: "search" },
    });

    expect(event.id).toBeDefined();
    expect(event.messageId).toBeNull();
    expect(event.durationMs).toBeNull();
    expect(event.eventType).toBe("tool_call");
  });

  test("generated ID is a UUID", async () => {
    const conv = await createConversation(projectId);

    const event = await insertObservabilityEvent({
      conversationId: conv.id,
      eventType: "tool_call",
      data: { toolName: "test" },
    });

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(event.id).toMatch(uuidRegex);
  });
});

describe("getConversationObservability (getConversationEvents)", () => {
  test("returns events ordered by createdAt asc", async () => {
    const conv = await createConversation(projectId);

    await insertObservabilityEvent({
      conversationId: conv.id,
      eventType: "tool_call",
      data: { toolName: "first" },
      durationMs: 100,
    });
    await insertObservabilityEvent({
      conversationId: conv.id,
      eventType: "tool_call",
      data: { toolName: "second" },
      durationMs: 200,
    });

    const events = await getConversationObservability(conv.id);
    expect(events.length).toBe(2);
    expect((events[0]!.data as any).toolName).toBe("first");
    expect((events[1]!.data as any).toolName).toBe("second");
    expect(events[0]!.createdAt.getTime()).toBeLessThanOrEqual(events[1]!.createdAt.getTime());
  });

  test("returns empty array for conversation with no events", async () => {
    const conv = await createConversation(projectId);
    const events = await getConversationObservability(conv.id);
    expect(events).toEqual([]);
  });

  test("only returns events for the specified conversation", async () => {
    const conv1 = await createConversation(projectId, { title: "Conv 1" });
    const conv2 = await createConversation(projectId, { title: "Conv 2" });

    await insertObservabilityEvent({
      conversationId: conv1.id,
      eventType: "tool_call",
      data: { toolName: "conv1-tool" },
    });
    await insertObservabilityEvent({
      conversationId: conv2.id,
      eventType: "tool_call",
      data: { toolName: "conv2-tool" },
    });

    const events1 = await getConversationObservability(conv1.id);
    expect(events1.length).toBe(1);
    expect((events1[0]!.data as any).toolName).toBe("conv1-tool");

    const events2 = await getConversationObservability(conv2.id);
    expect(events2.length).toBe(1);
    expect((events2[0]!.data as any).toolName).toBe("conv2-tool");
  });
});

describe("getConversationStats", () => {
  test("returns aggregated stats (total tokens, duration, counts)", async () => {
    const conv = await createConversation(projectId);

    // Token + turn counts are sourced from messages.usage.
    await createMessage(conv.id, { role: "assistant", content: "turn1", usage: { inputTokens: 100, outputTokens: 200 } });
    await createMessage(conv.id, { role: "assistant", content: "turn2", usage: { inputTokens: 50, outputTokens: 100 } });

    // Durations are sourced from observability turn_summary rows.
    await insertObservabilityEvent({
      conversationId: conv.id,
      eventType: "turn_summary",
      data: { tokenUsage: { input: 100, output: 200 } },
      durationMs: 400,
    });
    await insertObservabilityEvent({
      conversationId: conv.id,
      eventType: "turn_summary",
      data: { tokenUsage: { input: 50, output: 100 } },
      durationMs: 200,
    });
    // Insert tool calls
    await insertObservabilityEvent({
      conversationId: conv.id,
      eventType: "tool_call",
      data: { toolName: "search" },
      durationMs: 50,
    });
    await insertObservabilityEvent({
      conversationId: conv.id,
      eventType: "tool_call",
      data: { toolName: "read" },
      durationMs: 30,
    });

    const stats = await getConversationStats(conv.id);
    expect(stats.totalInputTokens).toBe(150);
    expect(stats.totalOutputTokens).toBe(300);
    expect(stats.turnCount).toBe(2);
    expect(stats.totalToolCalls).toBe(2);
    expect(stats.avgDurationMs).toBe(300); // (400 + 200) / 2
  });

  test("returns zeros/empty for conversation with no events", async () => {
    const conv = await createConversation(projectId);

    const stats = await getConversationStats(conv.id);
    expect(stats.totalInputTokens).toBe(0);
    expect(stats.totalOutputTokens).toBe(0);
    expect(stats.totalToolCalls).toBe(0);
    expect(stats.turnCount).toBe(0);
    // avgDurationMs should be 0 for empty set
    expect(stats.avgDurationMs).toBe(0);
  });
});

describe("getGlobalStats", () => {
  test("returns stats across all conversations within time range", async () => {
    const conv1 = await createConversation(projectId, { title: "G1" });
    const conv2 = await createConversation(projectId, { title: "G2" });

    await createMessage(conv1.id, { role: "assistant", content: "t1", usage: { inputTokens: 100, outputTokens: 200 } });
    await createMessage(conv2.id, { role: "assistant", content: "t2", usage: { inputTokens: 200, outputTokens: 300 } });

    const stats = await getGlobalStats({ days: 30 });
    expect(stats.totalInputTokens).toBe(300);
    expect(stats.totalOutputTokens).toBe(500);
    expect(stats.totalTurnCount).toBe(2);
  });

  test("returns token usage aggregation (tokensByDay)", async () => {
    const conv = await createConversation(projectId);
    await createMessage(conv.id, { role: "assistant", content: "t1", usage: { inputTokens: 100, outputTokens: 200 } });

    const stats = await getGlobalStats({ days: 1 });
    expect(stats.tokensByDay.length).toBeGreaterThanOrEqual(1);
    // Today's entry should have our tokens
    const today = stats.tokensByDay[stats.tokensByDay.length - 1]!;
    expect(today.input).toBe(100);
    expect(today.output).toBe(200);
  });

  test("returns top extensions by call count", async () => {
    const conv = await createConversation(projectId);

    // Insert tool calls with extensionId
    await insertObservabilityEvent({
      conversationId: conv.id,
      eventType: "tool_call",
      data: { extensionId: "ext-a", toolName: "search", success: true },
      durationMs: 100,
    });
    await insertObservabilityEvent({
      conversationId: conv.id,
      eventType: "tool_call",
      data: { extensionId: "ext-a", toolName: "read", success: true },
      durationMs: 150,
    });
    await insertObservabilityEvent({
      conversationId: conv.id,
      eventType: "tool_call",
      data: { extensionId: "ext-b", toolName: "write", success: false },
      durationMs: 200,
    });

    const stats = await getGlobalStats({ days: 1 });
    expect(stats.topExtensions.length).toBe(2);
    // ext-a should be first (2 calls vs 1)
    expect(stats.topExtensions[0]!.extensionId).toBe("ext-a");
    expect(stats.topExtensions[0]!.callCount).toBe(2);
    expect(stats.topExtensions[1]!.extensionId).toBe("ext-b");
    expect(stats.topExtensions[1]!.callCount).toBe(1);
  });

  test("filters by date range correctly (excludes old events)", async () => {
    const conv = await createConversation(projectId);

    // Insert a recent assistant message
    await createMessage(conv.id, { role: "assistant", content: "recent", usage: { inputTokens: 100, outputTokens: 200 } });

    // Manually insert an old message (60 days ago)
    await getDb().execute(sql`
      INSERT INTO messages (id, conversation_id, role, content, usage, created_at)
      VALUES (
        ${crypto.randomUUID()},
        ${conv.id},
        'assistant',
        'old',
        '{"inputTokens": 999, "outputTokens": 999}'::jsonb,
        NOW() - interval '60 days'
      )
    `);

    const stats = await getGlobalStats({ days: 7 });
    // Should only see the recent message
    expect(stats.totalInputTokens).toBe(100);
    expect(stats.totalOutputTokens).toBe(200);
    expect(stats.totalTurnCount).toBe(1);
  });
});

// ── 3. ObservabilityCollector ────────────────────────────────────────

describe("ObservabilityCollector", () => {
  test("start() subscribes to tool:complete, tool:error, obs:turn", async () => {
    const conv = await createConversation(projectId);
    const bus = new EventBus<AgentEvents>();
    const collector = new ObservabilityCollector(bus);
    collector.start();

    bus.emit("tool:complete", {
      conversationId: conv.id,
      extensionId: "ext-1",
      toolName: "search",
      output: {},
      duration: 100,
      success: true,
    });

    bus.emit("tool:error", {
      conversationId: conv.id,
      extensionId: "ext-1",
      toolName: "broken",
      error: "fail",
      duration: 50,
    });

    bus.emit("obs:turn", {
      conversationId: conv.id,
      llmDurationMs: 200,
      toolDurationMs: 100,
      totalDurationMs: 300,
      tokenUsage: { input: 10, output: 20 },
    });

    await new Promise((r) => setTimeout(r, 150));

    const events = await getConversationObservability(conv.id);
    expect(events.length).toBe(3);

    const types = events.map((e) => e.eventType).sort();
    expect(types).toEqual(["tool_call", "tool_error", "turn_summary"]);

    collector.stop();
  });

  test("tool:complete calls insertObservabilityEvent with correct data shape", async () => {
    const conv = await createConversation(projectId);
    const bus = new EventBus<AgentEvents>();
    const stop = startCollector(bus);

    bus.emit("tool:complete", {
      conversationId: conv.id,
      extensionId: "ext-search",
      toolName: "vector_search",
      output: { results: [1, 2, 3] },
      duration: 250,
      success: true,
    });

    await new Promise((r) => setTimeout(r, 150));

    const events = await getConversationObservability(conv.id);
    expect(events.length).toBe(1);
    const event = events[0]!;
    expect(event.eventType).toBe("tool_call");
    expect(event.durationMs).toBe(250);
    const data = event.data as any;
    expect(data.toolName).toBe("vector_search");
    expect(data.extensionId).toBe("ext-search");
    expect(data.duration).toBe(250);
    expect(data.success).toBe(true);

    stop();
  });

  test("tool:error calls insertObservabilityEvent with correct data shape", async () => {
    const conv = await createConversation(projectId);
    const bus = new EventBus<AgentEvents>();
    const stop = startCollector(bus);

    bus.emit("tool:error", {
      conversationId: conv.id,
      extensionId: "ext-broken",
      toolName: "flaky_tool",
      error: "Timeout after 30s",
      duration: 30000,
    });

    await new Promise((r) => setTimeout(r, 150));

    const events = await getConversationObservability(conv.id);
    expect(events.length).toBe(1);
    const event = events[0]!;
    expect(event.eventType).toBe("tool_error");
    expect(event.durationMs).toBe(30000);
    const data = event.data as any;
    expect(data.toolName).toBe("flaky_tool");
    expect(data.extensionId).toBe("ext-broken");
    expect(data.error).toBe("Timeout after 30s");
    expect(data.duration).toBe(30000);

    stop();
  });

  test("obs:turn calls insertObservabilityEvent with correct data shape", async () => {
    const conv = await createConversation(projectId);
    const msgId = crypto.randomUUID();
    await getDb().execute(
      sql`INSERT INTO messages (id, conversation_id, role, content) VALUES (${msgId}, ${conv.id}, 'assistant', 'reply')`,
    );

    const bus = new EventBus<AgentEvents>();
    const stop = startCollector(bus);

    bus.emit("obs:turn", {
      conversationId: conv.id,
      messageId: msgId,
      llmDurationMs: 800,
      toolDurationMs: 200,
      totalDurationMs: 1000,
      tokenUsage: { input: 500, output: 250 },
    });

    await new Promise((r) => setTimeout(r, 150));

    const events = await getConversationObservability(conv.id);
    expect(events.length).toBe(1);
    const event = events[0]!;
    expect(event.eventType).toBe("turn_summary");
    expect(event.messageId).toBe(msgId);
    expect(event.durationMs).toBe(1000);
    const data = event.data as any;
    expect(data.llmDurationMs).toBe(800);
    expect(data.toolDurationMs).toBe(200);
    expect(data.totalDurationMs).toBe(1000);
    expect(data.tokenUsage).toEqual({ input: 500, output: 250 });

    stop();
  });

  test("stop() unsubscribes all listeners (subsequent events do not trigger inserts)", async () => {
    const conv = await createConversation(projectId);
    const bus = new EventBus<AgentEvents>();
    const collector = new ObservabilityCollector(bus);
    collector.start();

    // Emit one event before stop
    bus.emit("tool:complete", {
      conversationId: conv.id,
      extensionId: "ext-1",
      toolName: "before_stop",
      output: {},
      duration: 10,
      success: true,
    });

    await new Promise((r) => setTimeout(r, 100));
    collector.stop();

    // Emit events after stop - should NOT be persisted
    bus.emit("tool:complete", {
      conversationId: conv.id,
      extensionId: "ext-1",
      toolName: "after_stop",
      output: {},
      duration: 10,
      success: true,
    });
    bus.emit("tool:error", {
      conversationId: conv.id,
      extensionId: "ext-1",
      toolName: "after_stop_err",
      error: "nope",
      duration: 5,
    });
    bus.emit("obs:turn", {
      conversationId: conv.id,
      llmDurationMs: 1,
      toolDurationMs: 1,
      totalDurationMs: 2,
      tokenUsage: { input: 1, output: 1 },
    });

    await new Promise((r) => setTimeout(r, 100));

    const events = await getConversationObservability(conv.id);
    expect(events.length).toBe(1);
    expect((events[0]!.data as any).toolName).toBe("before_stop");
  });

  test("startCollector() returns a stop function", async () => {
    const conv = await createConversation(projectId);
    const bus = new EventBus<AgentEvents>();
    const stop = startCollector(bus);

    expect(typeof stop).toBe("function");

    bus.emit("tool:complete", {
      conversationId: conv.id,
      extensionId: "ext-1",
      toolName: "test",
      output: {},
      duration: 10,
      success: true,
    });

    await new Promise((r) => setTimeout(r, 100));
    stop();

    bus.emit("tool:complete", {
      conversationId: conv.id,
      extensionId: "ext-1",
      toolName: "after",
      output: {},
      duration: 10,
      success: true,
    });

    await new Promise((r) => setTimeout(r, 100));

    const events = await getConversationObservability(conv.id);
    expect(events.length).toBe(1);
  });

  test("multiple start/stop cycles work correctly", async () => {
    const conv = await createConversation(projectId);
    const bus = new EventBus<AgentEvents>();
    const collector = new ObservabilityCollector(bus);

    // Cycle 1
    collector.start();
    bus.emit("tool:complete", {
      conversationId: conv.id,
      extensionId: "ext-1",
      toolName: "cycle1",
      output: {},
      duration: 10,
      success: true,
    });
    await new Promise((r) => setTimeout(r, 100));
    collector.stop();

    // Cycle 2
    collector.start();
    bus.emit("tool:complete", {
      conversationId: conv.id,
      extensionId: "ext-1",
      toolName: "cycle2",
      output: {},
      duration: 20,
      success: true,
    });
    await new Promise((r) => setTimeout(r, 100));
    collector.stop();

    // Between cycles, no events should be captured
    bus.emit("tool:complete", {
      conversationId: conv.id,
      extensionId: "ext-1",
      toolName: "orphan",
      output: {},
      duration: 30,
      success: true,
    });
    await new Promise((r) => setTimeout(r, 100));

    const events = await getConversationObservability(conv.id);
    expect(events.length).toBe(2);
    const names = events.map((e) => (e.data as any).toolName);
    expect(names).toContain("cycle1");
    expect(names).toContain("cycle2");
    expect(names).not.toContain("orphan");
  });
});

// ── 4. Integration: Full Sandbox Lifecycle ───────────────────────────

describe("integration: full sandbox lifecycle", () => {
  test("complete sandbox workflow with observability and cleanup", async () => {
    // Step 1: Create a test conversation with agentConfigId
    const testConv = await createConversation(projectId, {
      title: "Sandbox Test Run",
      test: true,
      agentConfigId,
      userId,
    });
    expect(testConv.test).toBe(true);
    expect(testConv.agentConfigId).toBe(agentConfigId);

    // Also create a normal conversation to verify isolation
    const normalConv = await createConversation(projectId, {
      title: "Normal Conversation",
    });

    // Step 2: Verify test conversation appears in getTestConversations
    const testConvs = await getTestConversations(agentConfigId, userId);
    expect(testConvs.length).toBe(1);
    expect(testConvs[0]!.id).toBe(testConv.id);

    // Step 3: Verify test conversation does NOT appear in listConversations
    const normalConvs = await listConversations(projectId);
    expect(normalConvs.length).toBe(1);
    expect(normalConvs[0]!.id).toBe(normalConv.id);
    expect(normalConvs.find((c) => c.id === testConv.id)).toBeUndefined();

    // Step 4: Create observability events + assistant message for the test conversation
    await createMessage(testConv.id, { role: "assistant", content: "sandbox-turn", usage: { inputTokens: 50, outputTokens: 100 } });
    await insertObservabilityEvent({
      conversationId: testConv.id,
      eventType: "tool_call",
      data: { toolName: "sandbox_tool", extensionId: "ext-1", success: true },
      durationMs: 100,
    });
    await insertObservabilityEvent({
      conversationId: testConv.id,
      eventType: "turn_summary",
      data: { tokenUsage: { input: 50, output: 100 }, totalDurationMs: 300 },
      durationMs: 300,
    });

    // Also add an event to the normal conversation
    await insertObservabilityEvent({
      conversationId: normalConv.id,
      eventType: "tool_call",
      data: { toolName: "normal_tool", extensionId: "ext-1", success: true },
      durationMs: 50,
    });

    // Step 5: Verify events appear in getConversationObservability
    const testEvents = await getConversationObservability(testConv.id);
    expect(testEvents.length).toBe(2);

    // Step 6: Verify conversation stats work for the test conversation
    const testStats = await getConversationStats(testConv.id);
    expect(testStats.totalInputTokens).toBe(50);
    expect(testStats.totalOutputTokens).toBe(100);
    expect(testStats.totalToolCalls).toBe(1);
    expect(testStats.turnCount).toBe(1);

    // Step 7: Delete test conversations
    const deletedCount = await deleteTestConversations(agentConfigId, userId);
    expect(deletedCount).toBe(1);

    // Step 8: Verify test conversation is gone
    const remainingTests = await getTestConversations(agentConfigId, userId);
    expect(remainingTests.length).toBe(0);

    // Step 9: Verify cascade deletes observability events for the test conversation
    const orphanedEvents = await getConversationObservability(testConv.id);
    expect(orphanedEvents.length).toBe(0);

    // Step 10: Verify normal conversation and its events are untouched
    const normalList = await listConversations(projectId);
    expect(normalList.length).toBe(1);
    expect(normalList[0]!.id).toBe(normalConv.id);

    const normalEvents = await getConversationObservability(normalConv.id);
    expect(normalEvents.length).toBe(1);
    expect((normalEvents[0]!.data as any).toolName).toBe("normal_tool");
  });
});
