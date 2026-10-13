import { test, expect, describe, beforeEach, afterAll } from "bun:test";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import {
  writeAttachment,
  readAttachmentBytes,
  deleteForMessage,
  deleteForConversation,
  attachmentsRoot,
} from "../chat/attachments/storage";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ezcorp-att-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

async function fileExists(p: string) {
  try { await access(p); return true; } catch { return false; }
}

describe("attachment storage", () => {
  test("writeAttachment persists bytes under .ezcorp/attachments/<conv>/<msg>/", async () => {
    const payload = new TextEncoder().encode("hi there");
    const written = await writeAttachment({
      projectRoot: root, conversationId: "conv-1", messageId: "msg-1",
      filename: "greet.txt", mimeType: "text/plain", bytes: payload,
    });
    expect(written.sizeBytes).toBe(payload.byteLength);
    expect(written.storagePath).toContain(`/.ezcorp/attachments/conv-1/msg-1/`);
    expect(written.storagePath.endsWith(".txt")).toBe(true);
    expect(await fileExists(written.storagePath)).toBe(true);

    const back = await readAttachmentBytes(written.storagePath);
    expect(new TextDecoder().decode(back)).toBe("hi there");
  });

  test("derives .png extension for image/png without a file extension", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { storagePath } = await writeAttachment({
      projectRoot: root, conversationId: "c", messageId: "m",
      filename: "binary-blob", mimeType: "image/png", bytes,
    });
    expect(storagePath.endsWith(".png")).toBe(true);
  });

  test("deleteForMessage removes only that message's directory", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const a = await writeAttachment({
      projectRoot: root, conversationId: "c1", messageId: "m1",
      filename: "a.png", mimeType: "image/png", bytes,
    });
    const b = await writeAttachment({
      projectRoot: root, conversationId: "c1", messageId: "m2",
      filename: "b.png", mimeType: "image/png", bytes,
    });
    await deleteForMessage({ projectRoot: root, conversationId: "c1", messageId: "m1" });
    expect(await fileExists(a.storagePath)).toBe(false);
    expect(await fileExists(b.storagePath)).toBe(true);
  });

  test("deleteForConversation removes the whole conversation tree", async () => {
    const bytes = new Uint8Array([1]);
    const a = await writeAttachment({
      projectRoot: root, conversationId: "cX", messageId: "mA",
      filename: "a.png", mimeType: "image/png", bytes,
    });
    await deleteForConversation({ projectRoot: root, conversationId: "cX" });
    expect(await fileExists(a.storagePath)).toBe(false);
  });

  test("a bare '..' or '.' id cannot climb out of, or erase, the attachments root", async () => {
    const { storagePath } = await writeAttachment({
      projectRoot: root, conversationId: "..", messageId: ".",
      filename: "x.txt", mimeType: "text/plain", bytes: new Uint8Array([1]),
    });
    expect(storagePath.startsWith(`${attachmentsRoot(root)}/`)).toBe(true);
    expect(dirname(dirname(storagePath))).not.toBe(attachmentsRoot(root));

    // A sibling under .ezcorp must survive deleting the ".." conversation.
    const sibling = join(root, ".ezcorp", "keep.txt");
    await Bun.write(sibling, "keep");
    await deleteForConversation({ projectRoot: root, conversationId: ".." });
    expect(await fileExists(sibling)).toBe(true);
  });

  test("derives the extension from the MIME type when the filename has none", async () => {
    const cases: Array<[string, string]> = [
      ["image/jpeg", ".jpg"], ["image/webp", ".webp"], ["image/gif", ".gif"],
      ["application/pdf", ".pdf"], ["text/markdown", ".txt"], ["application/octet-stream", ""],
    ];
    for (const [mimeType, ext] of cases) {
      const { storagePath } = await writeAttachment({
        projectRoot: root, conversationId: "c", messageId: "m",
        filename: "blob", mimeType, bytes: new Uint8Array([1]),
      });
      expect(extname(storagePath)).toBe(ext);
    }
  });

  test("path traversal in conversationId or messageId is sanitized", async () => {
    const { storagePath } = await writeAttachment({
      projectRoot: root, conversationId: "../evil", messageId: "../../boom",
      filename: "x.txt", mimeType: "text/plain", bytes: new Uint8Array([1]),
    });
    expect(storagePath.startsWith(attachmentsRoot(root))).toBe(true);
    expect(storagePath.includes("../")).toBe(false);
  });
});
