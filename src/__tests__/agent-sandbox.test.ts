import { test, expect, describe, beforeAll, afterAll, mock } from "bun:test";
import { restoreModuleMocks } from "./helpers/mock-cleanup";
import { setupTestDb, closeTestDb, mockDbConnection } from "./helpers/test-pglite";

// Re-establish real settings implementation
mock.module("../db/queries/settings", () => {
  const { eq } = require("drizzle-orm");
  const { settings: tbl } = require("../db/schema");
  return {
    async getAllSettings() {
      const { getDb } = require("../db/connection");
      const rows = await getDb().select().from(tbl);
      return Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
    },
    async getSetting(key: string) {
      const { getDb } = require("../db/connection");
      const rows = await getDb().select().from(tbl).where(eq(tbl.key, key));
      return rows[0]?.value;
    },
    async upsertSetting(key: string, value: unknown) {
      const { getDb } = require("../db/connection");
      const db = getDb();
      const rows = await db.select().from(tbl).where(eq(tbl.key, key));
      if (rows[0]) {
        await db.update(tbl).set({ value, updatedAt: new Date() }).where(eq(tbl.key, key));
      } else {
        await db.insert(tbl).values({ key, value, updatedAt: new Date() });
      }
    },
    async deleteSetting(key: string) {
      const { getDb } = require("../db/connection");
      const rows = await getDb().select().from(tbl).where(eq(tbl.key, key));
      if (!rows[0]) return false;
      await getDb().delete(tbl).where(eq(tbl.key, key));
      return true;
    },
    async isListingInstalled() { return false; },
  };
});

mockDbConnection();

import {
  createConversation,
  listConversations,
  getTestConversations,
  deleteTestConversations,
} from "../db/queries/conversations";
import { createProject } from "../db/queries/projects";
import { createUser } from "../db/queries/users";
import { getDb } from "../db/connection";

let projectId: string;
let agentConfigId: string;
let userA: string;
let userB: string;

beforeAll(async () => {
  await setupTestDb();
  const project = await createProject({ name: "Sandbox Test", path: "/tmp/sandbox" });
  projectId = project.id;
  userA = (await createUser({ email: "sandbox-a@test.com", passwordHash: "hash", name: "Sandbox A" })).id;
  userB = (await createUser({ email: "sandbox-b@test.com", passwordHash: "hash", name: "Sandbox B" })).id;

  // Create a test agent config
  const db = getDb();
  const { agentConfigs } = require("../db/schema");
  const rows = await db
    .insert(agentConfigs)
    .values({
      name: "test-sandbox-agent",
      description: "Agent for sandbox testing",
      prompt: "You are a test agent",
    })
    .returning();
  agentConfigId = rows[0].id;
});

afterAll(async () => {
  restoreModuleMocks();
  await closeTestDb();
});

describe("agent sandbox - test flag", () => {
  test("createConversation with test=true stores flag correctly", async () => {
    const conv = await createConversation(projectId, {
      title: "Test Conv",
      agentConfigId,
      test: true,
    });
    expect(conv.test).toBe(true);
  });

  test("createConversation without test flag defaults to false", async () => {
    const conv = await createConversation(projectId, {
      title: "Normal Conv",
      agentConfigId,
    });
    expect(conv.test).toBe(false);
  });

  test("listConversations filters out test=true conversations by default", async () => {
    // Create a normal and a test conversation
    await createConversation(projectId, { title: "Visible Conv", agentConfigId });
    await createConversation(projectId, { title: "Hidden Test Conv", agentConfigId, test: true });

    const convs = await listConversations(projectId);
    const testConvs = convs.filter((c) => c.title === "Hidden Test Conv");
    expect(testConvs).toHaveLength(0);

    // Normal conversations should still appear
    const normalConvs = convs.filter((c) => c.title === "Visible Conv");
    expect(normalConvs.length).toBeGreaterThanOrEqual(1);
  });

  test("getTestConversations returns only test conversations for an agent", async () => {
    // Create test conversations for our agent
    await createConversation(projectId, { title: "Agent Test 1", agentConfigId, test: true, userId: userA });
    await createConversation(projectId, { title: "Agent Test 2", agentConfigId, test: true, userId: userA });

    // Create a normal conversation for the same agent
    await createConversation(projectId, { title: "Agent Normal", agentConfigId, userId: userA });

    const testConvs = await getTestConversations(agentConfigId, userA);
    expect(testConvs.length).toBeGreaterThanOrEqual(2);
    expect(testConvs.every((c) => c.test === true)).toBe(true);
    expect(testConvs.every((c) => c.agentConfigId === agentConfigId)).toBe(true);

    // Should be ordered by createdAt desc
    for (let i = 1; i < testConvs.length; i++) {
      expect(testConvs[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        testConvs[i]!.createdAt.getTime(),
      );
    }
  });

  test("deleteTestConversations removes all test conversations for an agent", async () => {
    // Create test conversations
    await createConversation(projectId, { title: "To Delete 1", agentConfigId, test: true, userId: userA });
    await createConversation(projectId, { title: "To Delete 2", agentConfigId, test: true, userId: userA });

    // Verify they exist
    let testConvs = await getTestConversations(agentConfigId, userA);
    const countBefore = testConvs.length;
    expect(countBefore).toBeGreaterThanOrEqual(2);

    // Delete all test conversations
    const deleted = await deleteTestConversations(agentConfigId, userA);
    expect(deleted).toBeGreaterThanOrEqual(2);

    // Verify they are gone
    testConvs = await getTestConversations(agentConfigId, userA);
    expect(testConvs).toHaveLength(0);

    // Normal conversations should still exist
    const allConvs = await listConversations(projectId);
    const normalAgentConvs = allConvs.filter((c) => c.agentConfigId === agentConfigId);
    expect(normalAgentConvs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("agent sandbox - test conversations are per user", () => {
  test("one user's calls never see or delete another user's test conversations", async () => {
    const mine = await createConversation(projectId, { title: "A's test", agentConfigId, test: true, userId: userA });
    const theirs = await createConversation(projectId, { title: "B's test", agentConfigId, test: true, userId: userB });
    const unowned = await createConversation(projectId, { title: "Unowned test", agentConfigId, test: true });

    const seenByA = (await getTestConversations(agentConfigId, userA)).map((c) => c.id);
    expect(seenByA).toContain(mine.id);
    expect(seenByA).not.toContain(theirs.id);
    expect(seenByA).not.toContain(unowned.id);

    expect(await deleteTestConversations(agentConfigId, userA)).toBe(1);
    expect((await getTestConversations(agentConfigId, userA)).map((c) => c.id)).toEqual([]);
    expect((await getTestConversations(agentConfigId, userB)).map((c) => c.id)).toEqual([theirs.id]);
    const { conversations } = require("../db/schema");
    const { eq } = require("drizzle-orm");
    const left = await getDb().select().from(conversations).where(eq(conversations.id, unowned.id));
    expect(left).toHaveLength(1);
  });
});
