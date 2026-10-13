import { test, expect, describe, beforeAll, afterAll, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreModuleMocks } from "./helpers/mock-cleanup";
import { setupTestDb, closeTestDb, mockDbConnection } from "./helpers/test-pglite";

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
    async upsertSetting() {},
    async deleteSetting() { return false; },
    async isListingInstalled() { return false; },
  };
});

mockDbConnection();

import { loadPastAttachments, rehydrateUserMessageContent } from "../chat/attachments/history-rehydrate";
import { writeAttachment } from "../chat/attachments/storage";
import { createProject } from "../db/queries/projects";
import { createConversation, createMessage } from "../db/queries/conversations";
import { insertAttachment } from "../db/queries/attachments";
import { getCapabilities } from "../providers/model-capabilities";
import { ATTACHMENT_HANDLE_SCHEME } from "../chat/attachments/content-builder";

const PNG_A = new TextEncoder().encode("PNG-A");
const PNG_B = new TextEncoder().encode("PNG-B");
const PNG_A_B64 = Buffer.from(PNG_A).toString("base64");

let tmpRoot: string;
let convId: string;
let msgWithImgId: string;
let msgWithTwoImgsId: string;
let msgNoAttId: string;
let attAId: string;
let attBId: string;

beforeAll(async () => {
  await setupTestDb();
  tmpRoot = await mkdtemp(join(tmpdir(), "ezcorp-rehydrate-"));
  const project = await createProject({ name: "Rehydrate", path: tmpRoot });
  const conv = await createConversation(project.id, { title: "c" });
  convId = conv.id;

  // Turn 1 — user uploaded an image.
  const msg1 = await createMessage(convId, { role: "user", content: "look at this" });
  msgWithImgId = msg1.id;
  const w1 = await writeAttachment({
    projectRoot: tmpRoot, conversationId: convId, messageId: msg1.id,
    filename: "cow.png", mimeType: "image/png", bytes: PNG_A,
  });
  const rowA = await insertAttachment({
    messageId: msg1.id, conversationId: convId,
    filename: "cow.png", mimeType: "image/png",
    sizeBytes: w1.sizeBytes, storagePath: w1.storagePath, kind: "image",
  });
  attAId = rowA.id;

  // Turn 2 — plain text follow-up, no attachments.
  const msg2 = await createMessage(convId, { role: "user", content: "what is this?", parentMessageId: msg1.id });
  msgNoAttId = msg2.id;

  // Turn 3 — two images on a single message.
  const msg3 = await createMessage(convId, { role: "user", content: "compare", parentMessageId: msg2.id });
  msgWithTwoImgsId = msg3.id;
  const w3a = await writeAttachment({
    projectRoot: tmpRoot, conversationId: convId, messageId: msg3.id,
    filename: "man.png", mimeType: "image/png", bytes: PNG_B,
  });
  await insertAttachment({
    messageId: msg3.id, conversationId: convId,
    filename: "man.png", mimeType: "image/png",
    sizeBytes: w3a.sizeBytes, storagePath: w3a.storagePath, kind: "image",
  });
  const w3b = await writeAttachment({
    projectRoot: tmpRoot, conversationId: convId, messageId: msg3.id,
    filename: "cow2.png", mimeType: "image/png", bytes: PNG_A,
  });
  const rowB = await insertAttachment({
    messageId: msg3.id, conversationId: convId,
    filename: "cow2.png", mimeType: "image/png",
    sizeBytes: w3b.sizeBytes, storagePath: w3b.storagePath, kind: "image",
  });
  attBId = rowB.id;
});

afterAll(async () => {
  restoreModuleMocks();
  await closeTestDb();
  await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe("loadPastAttachments", () => {
  test("returns empty maps when branch has no user messages", async () => {
    const out = await loadPastAttachments([{ id: "x", role: "assistant", content: "hi" }]);
    expect(out.all.length).toBe(0);
    expect(out.byMessage.size).toBe(0);
  });

  test("groups attachments by messageId and returns the flat union", async () => {
    const out = await loadPastAttachments([
      { id: msgWithImgId, role: "user", content: "look" },
      { id: msgNoAttId, role: "user", content: "?" },
      { id: msgWithTwoImgsId, role: "user", content: "compare" },
    ]);
    expect(out.byMessage.get(msgWithImgId)!.length).toBe(1);
    expect(out.byMessage.get(msgNoAttId)).toBeUndefined();
    expect(out.byMessage.get(msgWithTwoImgsId)!.length).toBe(2);
    // Flat union has all three attachment rows.
    expect(out.all.length).toBe(3);
    const ids = out.all.map((a) => a.id);
    expect(ids).toContain(attAId);
    expect(ids).toContain(attBId);
  });

  test("returned StagedAttachment shape includes storagePath (server-only)", async () => {
    const out = await loadPastAttachments([{ id: msgWithImgId, role: "user", content: "x" }]);
    const att = out.byMessage.get(msgWithImgId)![0]!;
    expect(att.id).toBe(attAId);
    expect(att.storagePath).toContain(".ezcorp/attachments/");
    expect(att.mimeType).toBe("image/png");
  });
});

describe("rehydrateUserMessageContent", () => {
  const vision = getCapabilities("anthropic", "claude-sonnet-4-5");
  const textOnly = getCapabilities("my-custom-provider", "local");

  test("no attachments → returns raw text (no part wrapping)", async () => {
    const out = await rehydrateUserMessageContent("plain text", [], vision);
    expect(out).toBe("plain text");
  });

  test("image attachment → parts array with ImageContent + handle ref block", async () => {
    const atts = (await loadPastAttachments([{ id: msgWithImgId, role: "user", content: "x" }]))
      .byMessage.get(msgWithImgId)!;
    const out = await rehydrateUserMessageContent("look", atts, vision);
    expect(Array.isArray(out)).toBe(true);
    const parts = out as any[];
    expect(parts[0]).toEqual({ type: "text", text: "look" });
    expect(parts[1].type).toBe("image");
    expect(parts[1].data).toBe(PNG_A_B64);
    expect(parts[2].type).toBe("text");
    expect(parts[2].text).toContain(`${ATTACHMENT_HANDLE_SCHEME}${attAId}`);
  });

  test("unsupported model falls back to raw text without throwing", async () => {
    const atts = (await loadPastAttachments([{ id: msgWithImgId, role: "user", content: "x" }]))
      .byMessage.get(msgWithImgId)!;
    const out = await rehydrateUserMessageContent("look", atts, textOnly);
    // Graceful fallback: image is dropped but the turn is still sendable.
    expect(out).toBe("look");
  });

  test("switch to a text-only model drops only the image — a text attachment on the same message survives", async () => {
    const [image] = (await loadPastAttachments([{ id: msgWithImgId, role: "user", content: "x" }]))
      .byMessage.get(msgWithImgId)!;
    const notes = await writeAttachment({
      projectRoot: tmpRoot, conversationId: convId, messageId: msgWithImgId,
      filename: "notes.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("budget is 40k"),
    });
    const atts = [image!, { id: "att-notes", filename: "notes.md", mimeType: "text/markdown", storagePath: notes.storagePath }];

    const out = await rehydrateUserMessageContent("look", atts, textOnly);

    const parts = out as Array<{ type: string; text?: string }>;
    expect(parts.some((p) => p.type === "image")).toBe(false);
    expect(parts.map((p) => p.text ?? "").join("\n")).toContain("budget is 40k");
  });

  test("two images on one message → both rebuilt as ImageContent parts", async () => {
    const atts = (await loadPastAttachments([{ id: msgWithTwoImgsId, role: "user", content: "x" }]))
      .byMessage.get(msgWithTwoImgsId)!;
    const out = await rehydrateUserMessageContent("compare", atts, vision);
    const parts = out as any[];
    const images = parts.filter((p) => p.type === "image");
    expect(images.length).toBe(2);
    const refBlock = parts[parts.length - 1].text as string;
    expect(refBlock).toContain(`index="1"`);
    expect(refBlock).toContain(`index="2"`);
  });
});
