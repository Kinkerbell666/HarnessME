/**
 * Phase 53.4 Stage 1 — `src/memory/dedup.ts` direct unit test.
 *
 * The helper was extracted from `src/memory/extraction.ts` so that
 * Stage 2's deletion of extraction.ts doesn't break the bundled
 * memory-extractor's dedup path. This test exercises the moved helper
 * directly and asserts:
 *
 *   1. New fact → INSERT branch creates a memory row (with the
 *      provenance factory's stamped fields).
 *   2. Repeat fact → UPDATE branch (dedup hit) reuses the existing id.
 *   3. The mutex serializes concurrent calls within a project.
 *   4. Different projects use independent locks (no false serialization
 *      across projects).
 *
 * The mutex serialization assertion uses a deliberately racy two-call
 * pattern (concurrent Promise.all). Without the mutex, both calls
 * would pass the similarity check and produce duplicate rows; with
 * the mutex, the second call sees the inserted row and updates it.
 */
import { test, expect, describe, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { restoreModuleMocks } from "./helpers/mock-cleanup";
import { setupTestDb, closeTestDb, mockDbConnection } from "./helpers/test-pglite";

mockDbConnection();

mock.module("../memory/embeddings", () => {
  function hashCode(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h;
  }
  function makeVector(text: string): number[] {
    const seed = hashCode(text);
    const vec = new Array(384);
    for (let i = 0; i < 384; i++) {
      vec[i] = Math.sin(seed + i) * 0.1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return vec.map((v) => v / norm);
  }
  return {
    generateEmbedding: async (text: string) => makeVector(text),
    generateEmbeddings: async (texts: string[]) => texts.map(makeVector),
    resetEmbeddingProvider: () => {},
  };
});

const {
  dedupAndWriteMemory,
  legacyExtractionProvenance,
  withDedupLock,
  dedupLockKey,
} = await import("../memory/dedup");
const { searchMemories, updateMemoryStatus, assignMemoryToProjects } = await import("../db/queries/memories");
// The mocked embedder above — seeding a row the dedup query must MATCH
// means computing its vector with the same function the helper uses.
const { generateEmbedding } = await import("../memory/embeddings");
const { createProject } = await import("../db/queries/projects");
const { createConversation } = await import("../db/queries/conversations");
const { getDb } = await import("../db/connection");
const { users, memories } = await import("../db/schema");
const { sql, eq } = await import("drizzle-orm");

/** Read the owner + eligibility COLUMNS (not provenance JSON) for one row. */
async function readColumns(memoryId: string): Promise<{
  userId: string | null;
  injectionEligible: boolean;
}> {
  const rows = await getDb()
    .select({ userId: memories.userId, injectionEligible: memories.injectionEligible })
    .from(memories)
    .where(eq(memories.id, memoryId));
  return rows[0]!;
}

const OWNER_A = "dedup-user-a";
const OWNER_B = "dedup-user-b";

let projectAId: string;
let projectBId: string;
let conversationAId: string;
let conversationBId: string;
// Same owner as conversationAId but no owner at all — exercises the
// fail-closed no-owner path (similar-match disabled, always insert).
let conversationUnownedId: string;
// Owned by OWNER_B in project A — exercises the cross-user scope wall.
let conversationB2Id: string;

beforeAll(async () => {
  await setupTestDb();
  await getDb().insert(users).values([
    { id: OWNER_A, email: "dedup-a@test.local", name: "Dedup A", passwordHash: "fake-hash" },
    { id: OWNER_B, email: "dedup-b@test.local", name: "Dedup B", passwordHash: "fake-hash" },
  ]).onConflictDoNothing();
  const a = await createProject({ name: "dedup-A", path: "/tmp/dedup-a" });
  const b = await createProject({ name: "dedup-B", path: "/tmp/dedup-b" });
  projectAId = a.id;
  projectBId = b.id;
  const convA = await createConversation(projectAId, { title: "A", userId: OWNER_A });
  const convB = await createConversation(projectBId, { title: "B", userId: OWNER_A });
  conversationAId = convA.id;
  conversationBId = convB.id;
  const convUnowned = await createConversation(projectAId, { title: "unowned" });
  conversationUnownedId = convUnowned.id;
  const convB2 = await createConversation(projectAId, { title: "B's conv", userId: OWNER_B });
  conversationB2Id = convB2.id;
});

afterAll(async () => {
  restoreModuleMocks();
  await closeTestDb();
});

beforeEach(async () => {
  // Wipe memories between scenarios so dedup behavior is observable.
  await getDb().execute(sql`TRUNCATE TABLE memories CASCADE`);
});

describe("dedupAndWriteMemory — INSERT branch (new fact)", () => {
  test("first write inserts a row with the provenance factory's fields", async () => {
    const result = await dedupAndWriteMemory({
      fact: { content: "User prefers TypeScript", category: "preferences", confidence: "high", messageIds: ["m1"] },
      conversationId: conversationAId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });

    expect(result.action).toBe("inserted");
    expect(result.memoryId).toBeDefined();

    const rows = await searchMemories({ projectId: projectAId });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe("User prefers TypeScript");
    expect(rows[0]!.category).toBe("preferences");
  });

  test("custom provenance factory's fields land on the row", async () => {
    const result = await dedupAndWriteMemory({
      fact: { content: "Custom-factory fact", category: "technical", confidence: "medium", messageIds: ["m1"] },
      conversationId: conversationAId,
      projectId: projectAId,
      provenanceFactory: (action, fact, conversationId) => ({
        sourceConversationId: conversationId,
        sourceMessageIds: fact.messageIds ?? [],
        extractedAt: new Date(),
        confidence: fact.confidence ?? "medium",
        history: [{ action, timestamp: new Date(), reason: "custom-factory" }],
        // Custom stamps the bundled extension uses:
        extensionId: "memory-extractor",
        injectionEligible: true,
      }),
    });

    expect(result.action).toBe("inserted");
    const rows = await searchMemories({ projectId: projectAId });
    expect(rows).toHaveLength(1);
    const prov = rows[0]!.provenance as { extensionId?: string; history?: Array<{ reason?: string }> } | null;
    expect(prov?.extensionId).toBe("memory-extractor");
    expect(prov?.history?.[0]?.reason).toBe("custom-factory");
  });
});

describe("dedupAndWriteMemory — UPDATE branch (similar existing)", () => {
  test("second write of the same content updates the existing row", async () => {
    const fact = { content: "Repeated fact for dedup", category: "preferences" as const, confidence: "high" as const, messageIds: ["m1"] };

    const first = await dedupAndWriteMemory({
      fact,
      conversationId: conversationAId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });
    expect(first.action).toBe("inserted");

    const second = await dedupAndWriteMemory({
      fact,
      conversationId: conversationAId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });
    expect(second.action).toBe("updated");
    expect(second.memoryId).toBe(first.memoryId);

    // Total rows in projectA still 1 — no duplicates.
    const rows = await searchMemories({ projectId: projectAId });
    expect(rows).toHaveLength(1);
  });

  test("an archived match is not a dedup target — the restated fact lands as a new active row", async () => {
    // Retrieval never returns archived rows. Writing the restated fact into
    // one would make it invisible to injection for good.
    const fact = { content: "Restated fact after decay", category: "preferences" as const, confidence: "high" as const, messageIds: ["m1"] };
    const first = await dedupAndWriteMemory({
      fact,
      conversationId: conversationAId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });
    await updateMemoryStatus(first.memoryId, "archived", "auto-decay");

    const second = await dedupAndWriteMemory({
      fact,
      conversationId: conversationAId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });
    expect(second.action).toBe("inserted");
    expect(second.memoryId).not.toBe(first.memoryId);
    const active = await searchMemories({ projectId: projectAId, status: "active" });
    expect(active.map((m) => m.id)).toEqual([second.memoryId]);
  });
});

describe("dedupAndWriteMemory — owner and eligibility COLUMNS", () => {
  // These assert the real `memories.user_id` / `memories.injection_eligible`
  // columns, never provenance JSON. Retrieval filters on the columns:
  // `hybridSearch` reads `injection_eligible`, and it only falls back to the
  // source conversation's owner while `user_id` is null — a fallback that
  // dies with the conversation (`on delete set null`), stranding the row as
  // unattributable.

  test("INSERT stamps the source conversation's owner into user_id", async () => {
    const result = await dedupAndWriteMemory({
      fact: { content: "Owner column fact", category: "preferences", confidence: "high", messageIds: ["m1"] },
      conversationId: conversationAId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });

    expect(result.action).toBe("inserted");
    expect((await readColumns(result.memoryId)).userId).toBe(OWNER_A);
  });

  test("INSERT from an unowned conversation stores user_id null", async () => {
    const result = await dedupAndWriteMemory({
      fact: { content: "Unowned owner-column fact", category: "technical", confidence: "medium", messageIds: [] },
      conversationId: conversationUnownedId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });

    expect(result.action).toBe("inserted");
    expect((await readColumns(result.memoryId)).userId).toBeNull();
  });

  test("INSERT writes injectionEligible when the caller supplies it", async () => {
    const ineligible = await dedupAndWriteMemory({
      fact: { content: "Ineligible fact", category: "technical", confidence: "medium", messageIds: [] },
      conversationId: conversationAId,
      projectId: projectAId,
      injectionEligible: false,
      provenanceFactory: legacyExtractionProvenance,
    });
    expect(ineligible.action).toBe("inserted");
    expect((await readColumns(ineligible.memoryId)).injectionEligible).toBe(false);

    // An explicit `true` is a distinct path from omitting the field, so
    // assert it rather than leaning on the column default.
    const eligible = await dedupAndWriteMemory({
      fact: { content: "Explicitly eligible fact", category: "biographical", confidence: "high", messageIds: [] },
      conversationId: conversationAId,
      projectId: projectAId,
      injectionEligible: true,
      provenanceFactory: legacyExtractionProvenance,
    });
    expect(eligible.action).toBe("inserted");
    expect((await readColumns(eligible.memoryId)).injectionEligible).toBe(true);
  });

  test("INSERT omits injectionEligible when unset, so the column default (true) applies", async () => {
    // The host extraction pipeline never passes the field; its rows must
    // stay injectable exactly as before the column was written here.
    const result = await dedupAndWriteMemory({
      fact: { content: "Default eligibility fact", category: "preferences", confidence: "high", messageIds: [] },
      conversationId: conversationAId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });

    expect(result.action).toBe("inserted");
    expect((await readColumns(result.memoryId)).injectionEligible).toBe(true);
  });

  test("UPDATE leaves user_id and injection_eligible untouched", async () => {
    // A legacy row: unattributed (`user_id` null, owned only through its
    // conversation) and taken OUT of injection by its owner. The dedup hit
    // below asks for the opposite of both. Neither may move — eligibility is
    // the owner's setting, and re-attributing the row is not this path's job.
    const fact = {
      content: "Existing row the update branch must not re-stamp",
      category: "preferences" as const,
      confidence: "high" as const,
      messageIds: ["m1"],
    };
    const [seeded] = await getDb().insert(memories).values({
      content: fact.content,
      category: fact.category,
      conversationId: conversationAId,
      projectId: projectAId,
      confidence: "high",
      embedding: await generateEmbedding(fact.content),
      userId: null,
      injectionEligible: false,
      provenance: legacyExtractionProvenance("created", fact, conversationAId) as never,
    }).returning({ id: memories.id });
    // The junction, not the legacy column, puts the row in project A.
    await assignMemoryToProjects(seeded!.id, [projectAId]);

    const result = await dedupAndWriteMemory({
      fact,
      conversationId: conversationAId,
      projectId: projectAId,
      injectionEligible: true,
      provenanceFactory: legacyExtractionProvenance,
    });

    expect(result.action).toBe("updated");
    expect(result.memoryId).toBe(seeded!.id);
    const after = await readColumns(seeded!.id);
    expect(after.userId).toBeNull();
    expect(after.injectionEligible).toBe(false);
  });
});

describe("dedupAndWriteMemory — per-user scope wall", () => {
  test("a similar fact from ANOTHER user's conversation inserts fresh — never overwrites the first user's row", async () => {
    const fact = { content: "Shared-sounding fact for scope wall", category: "preferences" as const, confidence: "high" as const, messageIds: ["m1"] };

    // User A writes the fact via A's conversation.
    const first = await dedupAndWriteMemory({
      fact,
      conversationId: conversationAId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });
    expect(first.action).toBe("inserted");

    // User B extracts the SAME content via B's conversation. Unscoped dedup
    // would take the update branch and overwrite A's row with B's write —
    // the cross-user leak this scope closes.
    const second = await dedupAndWriteMemory({
      fact,
      conversationId: conversationB2Id,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });
    expect(second.action).toBe("inserted");
    expect(second.memoryId).not.toBe(first.memoryId);

    const rows = await searchMemories({ projectId: projectAId });
    expect(rows).toHaveLength(2);
  });

  test("a conversation with no resolvable owner matches nothing (fail-closed) and inserts", async () => {
    const fact = { content: "Unowned-conversation fact", category: "technical" as const, confidence: "medium" as const, messageIds: ["m1"] };

    const first = await dedupAndWriteMemory({
      fact,
      conversationId: conversationUnownedId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });
    expect(first.action).toBe("inserted");

    // Identical repeat from the same unowned conversation still inserts —
    // an unattributable writer may not claim (or mutate) any existing row.
    const second = await dedupAndWriteMemory({
      fact,
      conversationId: conversationUnownedId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });
    expect(second.action).toBe("inserted");
    expect(second.memoryId).not.toBe(first.memoryId);
  });
});

describe("withDedupLock — per-project mutex serialization", () => {
  test("same project key serializes concurrent operations", async () => {
    const order: string[] = [];
    const key = dedupLockKey(projectAId);

    await Promise.all([
      withDedupLock(key, async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 20));
        order.push("a-end");
      }),
      withDedupLock(key, async () => {
        order.push("b-start");
        await new Promise((r) => setTimeout(r, 5));
        order.push("b-end");
      }),
    ]);

    // Either A wholly precedes B or vice-versa — never interleaved.
    const interleaved =
      order.join() === "a-start,a-end,b-start,b-end" ||
      order.join() === "b-start,b-end,a-start,a-end";
    expect(interleaved).toBe(true);
  });

  test("different project keys run concurrently (no false serialization)", async () => {
    const order: string[] = [];
    const keyA = dedupLockKey(projectAId);
    const keyB = dedupLockKey(projectBId);

    await Promise.all([
      withDedupLock(keyA, async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 20));
        order.push("a-end");
      }),
      withDedupLock(keyB, async () => {
        order.push("b-start");
        await new Promise((r) => setTimeout(r, 5));
        order.push("b-end");
      }),
    ]);

    // B should complete before A's end — they ran concurrently. The
    // interleaving "a-start,b-start,b-end,a-end" is the proof.
    expect(order[0]).toBe("a-start");
    expect(order[1]).toBe("b-start");
    expect(order[2]).toBe("b-end");
    expect(order[3]).toBe("a-end");
  });

  test("null projectId maps to a single global key", async () => {
    expect(dedupLockKey(null)).toBe("__global__");
    expect(dedupLockKey(undefined)).toBe("__global__");
    expect(dedupLockKey("specific-id")).toBe("specific-id");
  });
});

describe("dedupAndWriteMemory — cross-extension visibility", () => {
  test("dedup considers memories regardless of which extension authored them", async () => {
    // Insert via "host" provenance (no extensionId).
    const fact = { content: "Cross-ext shared fact", category: "biographical" as const, confidence: "high" as const, messageIds: [] };
    const first = await dedupAndWriteMemory({
      fact,
      conversationId: conversationAId,
      projectId: projectAId,
      provenanceFactory: legacyExtractionProvenance,
    });
    expect(first.action).toBe("inserted");

    // Second pass via the bundled-extractor's provenance factory.
    // Even though the second pass stamps a different extensionId,
    // the dedup helper's similarity check is cross-extension —
    // the second call MUST hit the existing row.
    const second = await dedupAndWriteMemory({
      fact,
      conversationId: conversationBId,
      projectId: projectAId,
      provenanceFactory: (action, f, cId) => ({
        sourceConversationId: cId,
        sourceMessageIds: f.messageIds ?? [],
        extractedAt: new Date(),
        confidence: f.confidence ?? "medium",
        history: [{ action, timestamp: new Date(), reason: "bundled" }],
        extensionId: "memory-extractor",
        injectionEligible: true,
      }),
    });
    expect(second.action).toBe("updated");
    expect(second.memoryId).toBe(first.memoryId);
  });
});

describe("dedupAndWriteMemory — project scope", () => {
  // Retrieval for project P reads P's rows (+ global rows unless P is
  // isolated). A fact written into a row outside that set is invisible in P.
  const write = (content: string, projectId: string | null) => dedupAndWriteMemory({
    fact: { content, category: "technical", confidence: "high", messageIds: [] },
    conversationId: conversationAId,
    projectId,
    provenanceFactory: legacyExtractionProvenance,
  });

  test("a fact from project A never merges into a row only project B has", async () => {
    const inB = await write("Deploys go through the staging cluster", projectBId);
    const fromA = await write("Deploys go through the staging cluster", projectAId);

    expect(fromA.action).toBe("inserted");
    expect(fromA.memoryId).not.toBe(inB.memoryId);
    const visibleInA = await searchMemories({ projectId: projectAId });
    expect(visibleInA.map((m) => m.id)).toContain(fromA.memoryId);
  });

  test("a global fact never merges into a project-only row", async () => {
    const inB = await write("Prefers tabs over spaces", projectBId);
    const global = await write("Prefers tabs over spaces", null);

    expect(global.action).toBe("inserted");
    expect(global.memoryId).not.toBe(inB.memoryId);
  });

  test("a fact still merges into a row its own project shares with others", async () => {
    const shared = await write("Uses pnpm workspaces", projectAId);
    await assignMemoryToProjects(shared.memoryId, [projectBId]);

    const again = await write("Uses pnpm workspaces", projectBId);
    expect(again.action).toBe("updated");
    expect(again.memoryId).toBe(shared.memoryId);
  });
});
