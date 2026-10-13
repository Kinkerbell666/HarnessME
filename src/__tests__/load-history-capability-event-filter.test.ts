/**
 * Integration coverage for `loadHistory`'s `capability-event` filter —
 * the spec invariant "the LLM never sees capability-event rows".
 *
 * Why this test exists: load-history's row-to-pi-ai mapper used to
 * branch only on `role === "assistant"` (with an `ez-action-result`
 * filter added in Phase 49). The Phase 50 capability-pill row
 * (`role: "capability-event"`) is also a synthetic UI-only row whose
 * `content` is a JSON sentinel describing a `sdk_capability_calls` row.
 * Without an explicit filter, that JSON sentinel would fall through to
 * the user-message mapping and hit the LLM as a fake user turn.
 *
 * Fix: explicit role filter at the source — return null from the mapper
 * for `capability-event` rows and drop the nulls before shaping into
 * pi-ai messages. This test pins the invariant down at the integration
 * level.
 *
 * Branch shape under test: user → assistant → capability-event → user
 * Expected post-load history shape: user → assistant → user (3 rows;
 * capability-event row is ABSENT, NOT mapped to user).
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { setupTestDb, closeTestDb, mockDbConnection } from "./helpers/test-pglite";
import { restoreModuleMocks } from "./helpers/mock-cleanup";
import { tmpdir } from "node:os";

mockDbConnection();

const { loadHistory } = await import("../runtime/stream-chat/load-history");
const { createUser } = await import("../db/queries/users");
const { createProject } = await import("../db/queries/projects");
const { createConversation, createMessage } = await import(
  "../db/queries/conversations"
);
import type { StreamChatContext } from "../runtime/stream-chat/context";

const SAFE_CWD = tmpdir();

let userId = "";
let projectId = "";

beforeAll(async () => {
  await setupTestDb();
  const u = await createUser({
    email: "loadhist-capevent@test.com",
    passwordHash: "h",
    name: "LH-CAP",
  });
  userId = u.id;
  const p = await createProject({ name: "p", path: "/tmp" });
  projectId = p.id;
});

afterAll(async () => {
  restoreModuleMocks();
  await closeTestDb();
  process.chdir(SAFE_CWD);
});

function mkCtx(): StreamChatContext {
  return { system: undefined } as unknown as StreamChatContext;
}

/** Flatten pi-ai content (string | parts array) into one text blob. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) =>
      typeof p === "object" && p !== null && "text" in p
        ? String((p as { text: unknown }).text)
        : "",
    )
    .join("\n");
}

describe("loadHistory — capability-event filter", () => {
  test("capability-event row is ABSENT from the LLM-visible history (not mapped to user)", async () => {
    const conv = await createConversation(projectId, { userId });
    const u1 = await createMessage(conv.id, {
      role: "user",
      content: "first user turn",
    });
    const a1 = await createMessage(conv.id, {
      role: "assistant",
      content: "first assistant reply",
      parentMessageId: u1.id,
    });
    // Mirror the JSON sentinel that recordCapabilityCall persists.
    const capEventPayload = JSON.stringify({
      __ezcorp_capability_event: true,
      sdkCapabilityCallId: "c-fake-id",
      capability: "llm",
      action: "complete",
      success: true,
      durationMs: 42,
      model: "claude-sonnet-4",
      provider: "anthropic",
    });
    const cap = await createMessage(conv.id, {
      role: "capability-event",
      content: capEventPayload,
      parentMessageId: a1.id,
    });
    const u2 = await createMessage(conv.id, {
      role: "user",
      content: "second user turn (after the capability pill)",
      parentMessageId: cap.id,
    });

    const result = await loadHistory(mkCtx(), conv.id, {
      parentMessageId: u2.id,
      projectId,
    });

    // 4 DB rows, 1 filtered → 3 LLM messages.
    expect(result.history.length).toBe(3);
    expect(result.history.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);

    // The JSON-encoded sentinel MUST NOT have leaked into history,
    // either as a fake user turn or anywhere else.
    const blob = result.history.map((m) => textOf(m.content)).join("\n");
    expect(blob).toContain("first user turn");
    expect(blob).toContain("first assistant reply");
    expect(blob).toContain("second user turn (after the capability pill)");
    // None of these sentinel fragments should appear in any LLM message.
    expect(blob).not.toContain("__ezcorp_capability_event");
    expect(blob).not.toContain("sdkCapabilityCallId");
    expect(blob).not.toContain("capability-event");
    // The raw sentinel id shouldn't be there either.
    expect(blob).not.toContain("c-fake-id");
  });

  test("two consecutive capability-event rows both filtered (no loop-counter regressions)", async () => {
    // A single LLM turn can fire multiple capability calls back-to-back
    // (e.g. `ctx.memory.read` followed by `ctx.llm.complete`), persisting
    // two synthetic capability-event rows in sequence. Both must drop.
    const conv = await createConversation(projectId, { userId });
    const u1 = await createMessage(conv.id, { role: "user", content: "go" });
    const c1 = await createMessage(conv.id, {
      role: "capability-event",
      content: JSON.stringify({
        __ezcorp_capability_event: true,
        sdkCapabilityCallId: "c-1",
        capability: "memory",
        action: "read",
      }),
      parentMessageId: u1.id,
    });
    const c2 = await createMessage(conv.id, {
      role: "capability-event",
      content: JSON.stringify({
        __ezcorp_capability_event: true,
        sdkCapabilityCallId: "c-2",
        capability: "llm",
        action: "complete",
      }),
      parentMessageId: c1.id,
    });

    const result = await loadHistory(mkCtx(), conv.id, {
      parentMessageId: c2.id,
      projectId,
    });

    expect(result.history.length).toBe(1);
    expect(result.history[0]!.role).toBe("user");
    const blob = result.history.map((m) => textOf(m.content)).join("\n");
    expect(blob).toBe("go");
  });

  test("an extension row stays out of history even when it is not excluded", async () => {
    // append-message stamps extension rows `excluded: true`, but the
    // owner can toggle that flag off (PATCH .../messages/[mid]). The row
    // must still never reach the LLM as a fake user turn.
    const conv = await createConversation(projectId, { userId });
    const u1 = await createMessage(conv.id, { role: "user", content: "read it aloud" });
    const ext = await createMessage(conv.id, {
      role: "extension",
      content: "tts-player header card",
      parentMessageId: u1.id,
    });
    const u2 = await createMessage(conv.id, {
      role: "user",
      content: "thanks",
      parentMessageId: ext.id,
    });

    const result = await loadHistory(mkCtx(), conv.id, {
      parentMessageId: u2.id,
      projectId,
    });

    expect(result.history.map((m) => m.role)).toEqual(["user", "user"]);
    const blob = result.history.map((m) => textOf(m.content)).join("\n");
    expect(blob).not.toContain("tts-player header card");
  });

  test("mixed ez-action-result + capability-event rows both filtered (orthogonal paths)", async () => {
    // The two filter branches are independent — make sure that adding
    // one didn't regress the other.
    const conv = await createConversation(projectId, { userId });
    const u1 = await createMessage(conv.id, { role: "user", content: "x" });
    const ez = await createMessage(conv.id, {
      role: "ez-action-result",
      content: JSON.stringify({
        kind: "success",
        card: { title: "T", body: "b", variant: "success" },
      }),
      parentMessageId: u1.id,
    });
    const cap = await createMessage(conv.id, {
      role: "capability-event",
      content: JSON.stringify({
        __ezcorp_capability_event: true,
        sdkCapabilityCallId: "c-mixed",
        capability: "lessons",
        action: "write",
      }),
      parentMessageId: ez.id,
    });
    const u2 = await createMessage(conv.id, {
      role: "user",
      content: "y",
      parentMessageId: cap.id,
    });

    const result = await loadHistory(mkCtx(), conv.id, {
      parentMessageId: u2.id,
      projectId,
    });

    expect(result.history.length).toBe(2);
    expect(result.history.map((m) => m.role)).toEqual(["user", "user"]);
    const blob = result.history.map((m) => textOf(m.content)).join("\n");
    expect(blob).not.toContain("__ezcorp_capability_event");
    expect(blob).not.toContain("ez-action-result");
    expect(blob).not.toContain("c-mixed");
  });
});
