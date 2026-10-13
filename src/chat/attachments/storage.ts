/**
 * Attachment on-disk storage under <projectRoot>/.ezcorp/attachments/.
 *
 * Layout: .ezcorp/attachments/<conversationId>/<messageId>/<uuid>.<ext>
 * This mirrors the extension-data convention documented in AGENTS.md.
 */

import { resolve, join, extname } from "node:path";
import { rm, mkdir } from "node:fs/promises";

interface WrittenAttachment {
  storagePath: string;
  sizeBytes: number;
}

/** Root directory for all message attachments. */
export function attachmentsRoot(projectRoot: string): string {
  return resolve(projectRoot, ".ezcorp", "attachments");
}

function sanitizeSegment(s: string): string {
  // Defensive — ids are UUIDs/DB-generated, but never allow path traversal.
  // A segment of only dots ("", ".", "..") would resolve to the parent or the
  // root itself, and the delete helpers rm -rf whatever it names.
  const safe = s.replace(/[^a-zA-Z0-9._-]/g, "_");
  return /^\.*$/.test(safe) ? safe.replace(/\./g, "_") || "_" : safe;
}

function extFromMime(mimeType: string, filename: string): string {
  const fromName = extname(filename).toLowerCase();
  if (fromName && /^\.[a-z0-9]{1,8}$/i.test(fromName)) return fromName;
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType.startsWith("text/")) return ".txt";
  return "";
}

export async function writeAttachment(opts: {
  projectRoot: string;
  conversationId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<WrittenAttachment> {
  const dir = join(
    attachmentsRoot(opts.projectRoot),
    sanitizeSegment(opts.conversationId),
    sanitizeSegment(opts.messageId),
  );
  await mkdir(dir, { recursive: true });
  const ext = extFromMime(opts.mimeType, opts.filename);
  const storagePath = join(dir, `${crypto.randomUUID()}${ext}`);
  await Bun.write(storagePath, opts.bytes);
  return { storagePath, sizeBytes: opts.bytes.byteLength };
}

export async function readAttachmentBytes(storagePath: string): Promise<Uint8Array> {
  const buf = await Bun.file(storagePath).arrayBuffer();
  return new Uint8Array(buf);
}

export async function deleteForMessage(opts: {
  projectRoot: string;
  conversationId: string;
  messageId: string;
}): Promise<void> {
  const dir = join(
    attachmentsRoot(opts.projectRoot),
    sanitizeSegment(opts.conversationId),
    sanitizeSegment(opts.messageId),
  );
  await rm(dir, { recursive: true, force: true });
}

export async function deleteForConversation(opts: {
  projectRoot: string;
  conversationId: string;
}): Promise<void> {
  const dir = join(attachmentsRoot(opts.projectRoot), sanitizeSegment(opts.conversationId));
  await rm(dir, { recursive: true, force: true });
}
