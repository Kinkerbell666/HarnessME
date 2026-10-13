import { test, expect, describe, beforeEach, afterAll } from "bun:test";
import { setupTestDb, getTestDb, closeTestDb, mockDbConnection } from "./helpers/test-pglite";

// Mock db before importing query modules
mockDbConnection();

import { sql } from "drizzle-orm";
import { getGlobalStats, getConversationStats, insertObservabilityEvent } from "../db/queries/observability";
import { createMessage } from "../db/queries/conversations";

// ── Regression tests for the "token usage by day is not rendering" bug ──
//
// The bug: the global `tokensByDay` chart was sourced from the
// `observability_events.turn_summary` rows, which the runtime only emits
// once per run using the LAST turn's token usage. That caused:
//   (1) multi-turn runs to under-report tokens, and
//   (2) runs whose final turn had zero usage to produce an all-zero chart.
//
// The fix sources token aggregation from `messages.usage` (authoritative:
// one row per assistant turn, never overwritten). These tests lock in the
// new behaviour.

let projectId: string;

async function createConv(
  title = "c",
  owner: { userId?: string; parentId?: string } = {},
): Promise<string> {
  const db = getTestDb();
  const id = crypto.randomUUID();
  await db.execute(sql`INSERT INTO conversations (id, project_id, title, user_id, parent_conversation_id)
    VALUES (${id}, ${projectId}, ${title}, ${owner.userId ?? null}, ${owner.parentId ?? null})`);
  return id;
}

async function createUserRow(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await getTestDb().execute(sql`INSERT INTO users (id, email, password_hash, name)
    VALUES (${id}, ${`${name}-${id}@test.com`}, 'hash', ${name})`);
  return id;
}

/** One assistant turn with usage, one tool call and one turn summary. */
async function seedActivity(convId: string, tokens: number, extensionId: string, durationMs: number) {
  await createMessage(convId, { role: "assistant", content: "r", usage: { inputTokens: tokens, outputTokens: tokens } });
  await insertObservabilityEvent({ conversationId: convId, eventType: "tool_call", data: { extensionId, success: true }, durationMs });
  await insertObservabilityEvent({ conversationId: convId, eventType: "turn_summary", data: {}, durationMs });
}

async function insertOldMessage(convId: string, inputTokens: number, outputTokens: number, daysAgo: number) {
  const db = getTestDb();
  const id = crypto.randomUUID();
  const usage = JSON.stringify({ inputTokens, outputTokens });
  await db.execute(sql.raw(
    `INSERT INTO messages (id, conversation_id, role, content, usage, created_at)
     VALUES ('${id}', '${convId}', 'assistant', 'old', '${usage}'::jsonb, NOW() - interval '${daysAgo} days')`,
  ));
}

beforeEach(async () => {
  await setupTestDb();
  projectId = "tbd-proj";
  const db = getTestDb();
  await db.execute(sql`INSERT INTO projects (id, name, path) VALUES (${projectId}, 'Tokens by day test', '/tmp/tbd') ON CONFLICT (id) DO NOTHING`);
});

afterAll(async () => {
  await closeTestDb();
});

describe("tokensByDay — authoritative from messages.usage", () => {
  test("returns non-empty chart when assistant messages have usage", async () => {
    const conv = await createConv();
    await createMessage(conv, { role: "assistant", content: "r1", usage: { inputTokens: 100, outputTokens: 200 } });
    await createMessage(conv, { role: "assistant", content: "r2", usage: { inputTokens: 50, outputTokens: 75 } });

    const stats = await getGlobalStats({ days: 30 });

    expect(stats.tokensByDay.length).toBeGreaterThan(0);
    expect(stats.totalInputTokens).toBe(150);
    expect(stats.totalOutputTokens).toBe(275);
    const today = stats.tokensByDay[stats.tokensByDay.length - 1]!;
    expect(today.input).toBe(150);
    expect(today.output).toBe(275);
  });

  test("multi-turn run is reflected fully (previously under-reported)", async () => {
    // Simulates 3 turns within a single run. Before the fix, only the LAST
    // turn's tokens would show up via observability_events.turn_summary.
    const conv = await createConv();
    await createMessage(conv, { role: "assistant", content: "t1", usage: { inputTokens: 10, outputTokens: 20 } });
    await createMessage(conv, { role: "assistant", content: "t2", usage: { inputTokens: 30, outputTokens: 40 } });
    await createMessage(conv, { role: "assistant", content: "t3", usage: { inputTokens: 50, outputTokens: 60 } });

    // Only a single turn_summary row exists (the runtime emits one per run).
    await insertObservabilityEvent({
      conversationId: conv,
      eventType: "turn_summary",
      data: { tokenUsage: { input: 50, output: 60 } }, // last turn only
      durationMs: 1234,
    });

    const stats = await getGlobalStats({ days: 30 });
    expect(stats.totalInputTokens).toBe(90);   // 10 + 30 + 50, not just 50
    expect(stats.totalOutputTokens).toBe(120); // 20 + 40 + 60, not just 60
    expect(stats.totalTurnCount).toBe(3);
    expect(stats.avgResponseMs).toBe(1234);    // durations still from events
  });

  test("returns empty chart when no assistant messages have usage", async () => {
    // Even if turn_summary events exist with tokens, they are ignored for
    // tokensByDay — so a broken runtime path can't "resurrect" a stale chart.
    const conv = await createConv();
    await insertObservabilityEvent({
      conversationId: conv,
      eventType: "turn_summary",
      data: { tokenUsage: { input: 999, output: 999 } },
      durationMs: 50,
    });

    const stats = await getGlobalStats({ days: 30 });
    expect(stats.tokensByDay).toEqual([]);
    expect(stats.totalInputTokens).toBe(0);
    expect(stats.totalOutputTokens).toBe(0);
    expect(stats.totalTurnCount).toBe(0);
  });

  test("user messages are not counted", async () => {
    const conv = await createConv();
    const db = getTestDb();
    // user messages never get a usage column, but make sure the WHERE clause
    // holds even if one were set.
    await db.execute(sql`INSERT INTO messages (id, conversation_id, role, content, usage) VALUES (${crypto.randomUUID()}, ${conv}, 'user', 'hi', '{"inputTokens":99999,"outputTokens":99999}'::jsonb)`);
    await createMessage(conv, { role: "assistant", content: "r", usage: { inputTokens: 5, outputTokens: 10 } });

    const stats = await getGlobalStats({ days: 30 });
    expect(stats.totalInputTokens).toBe(5);
    expect(stats.totalOutputTokens).toBe(10);
  });

  test("days filter excludes old messages", async () => {
    const conv = await createConv();
    await createMessage(conv, { role: "assistant", content: "recent", usage: { inputTokens: 100, outputTokens: 200 } });
    await insertOldMessage(conv, 999, 999, 60);

    const stats = await getGlobalStats({ days: 7 });
    expect(stats.totalInputTokens).toBe(100);
    expect(stats.totalOutputTokens).toBe(200);
    expect(stats.totalTurnCount).toBe(1);
  });

  test("tokensByDay is grouped by date", async () => {
    const conv = await createConv();
    await createMessage(conv, { role: "assistant", content: "today-1", usage: { inputTokens: 10, outputTokens: 20 } });
    await createMessage(conv, { role: "assistant", content: "today-2", usage: { inputTokens: 30, outputTokens: 40 } });
    await insertOldMessage(conv, 5, 8, 3);

    const stats = await getGlobalStats({ days: 30 });
    expect(stats.tokensByDay.length).toBeGreaterThanOrEqual(2);
    const sorted = [...stats.tokensByDay].sort((a, b) => a.date.localeCompare(b.date));
    // Oldest bucket has the 3-days-ago values
    expect(sorted[0]!.input).toBe(5);
    expect(sorted[0]!.output).toBe(8);
    // Newest bucket has both of today's turns summed
    expect(sorted[sorted.length - 1]!.input).toBe(40);
    expect(sorted[sorted.length - 1]!.output).toBe(60);
  });

  test("aggregates across multiple conversations (global scope)", async () => {
    const c1 = await createConv("conv-1");
    const c2 = await createConv("conv-2");
    await createMessage(c1, { role: "assistant", content: "a", usage: { inputTokens: 100, outputTokens: 200 } });
    await createMessage(c2, { role: "assistant", content: "b", usage: { inputTokens: 50, outputTokens: 75 } });

    const stats = await getGlobalStats({ days: 30 });
    expect(stats.totalInputTokens).toBe(150);
    expect(stats.totalOutputTokens).toBe(275);
    expect(stats.totalTurnCount).toBe(2);
  });
});

describe("getConversationStats — authoritative from messages.usage", () => {
  test("aggregates per-conversation tokens from messages", async () => {
    const conv = await createConv();
    await createMessage(conv, { role: "assistant", content: "t1", usage: { inputTokens: 25, outputTokens: 50 } });
    await createMessage(conv, { role: "assistant", content: "t2", usage: { inputTokens: 75, outputTokens: 100 } });

    const stats = await getConversationStats(conv);
    expect(stats.totalInputTokens).toBe(100);
    expect(stats.totalOutputTokens).toBe(150);
    expect(stats.turnCount).toBe(2);
  });

  test("other conversations' messages don't bleed into this one", async () => {
    const a = await createConv("a");
    const b = await createConv("b");
    await createMessage(a, { role: "assistant", content: "a", usage: { inputTokens: 1, outputTokens: 2 } });
    await createMessage(b, { role: "assistant", content: "b", usage: { inputTokens: 999, outputTokens: 999 } });

    const stats = await getConversationStats(a);
    expect(stats.totalInputTokens).toBe(1);
    expect(stats.totalOutputTokens).toBe(2);
    expect(stats.turnCount).toBe(1);
  });

  test("duration comes from observability_events (not messages)", async () => {
    const conv = await createConv();
    await createMessage(conv, { role: "assistant", content: "t1", usage: { inputTokens: 10, outputTokens: 20 } });
    await insertObservabilityEvent({
      conversationId: conv,
      eventType: "turn_summary",
      data: { tokenUsage: { input: 10, output: 20 } },
      durationMs: 500,
    });
    await insertObservabilityEvent({
      conversationId: conv,
      eventType: "turn_summary",
      data: { tokenUsage: { input: 10, output: 20 } },
      durationMs: 700,
    });

    const stats = await getConversationStats(conv);
    expect(stats.avgDurationMs).toBe(600); // (500 + 700) / 2
  });
});

describe("getGlobalStats — per-user scope", () => {
  test("a user's totals cover only their own conversations and their sub-conversations", async () => {
    const userA = await createUserRow("a");
    const userB = await createUserRow("b");
    const aConv = await createConv("a", { userId: userA });
    const aSub = await createConv("a-sub", { parentId: aConv });
    const bConv = await createConv("b", { userId: userB });
    const unowned = await createConv("unowned");
    await seedActivity(aConv, 10, "ext-a", 100);
    await seedActivity(aSub, 5, "ext-a", 300);
    await seedActivity(bConv, 1000, "ext-b", 5000);
    await seedActivity(unowned, 7000, "ext-x", 9000);

    const mine = await getGlobalStats({ days: 30, userId: userA });
    expect(mine.totalInputTokens).toBe(15);
    expect(mine.totalOutputTokens).toBe(15);
    expect(mine.totalTurnCount).toBe(2);
    expect(mine.totalToolCalls).toBe(2);
    expect(mine.avgResponseMs).toBe(200);
    expect(mine.tokensByDay.reduce((n, d) => n + d.input, 0)).toBe(15);
    expect(mine.topExtensions.map((e) => e.extensionId)).toEqual(["ext-a"]);

    const all = await getGlobalStats({ days: 30 });
    expect(all.totalInputTokens).toBe(8015);
    expect(all.totalToolCalls).toBe(4);
    expect(all.topExtensions.map((e) => e.extensionId).sort()).toEqual(["ext-a", "ext-b", "ext-x"]);
  });
});
