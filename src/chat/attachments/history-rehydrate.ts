/**
 * Rebuild conversation-history messages so image content from prior turns is
 * replayed to the model in the current turn.
 *
 * Two paths:
 *   - `rehydrateUserMessageContent`: user-uploaded attachments (DB-backed).
 *     Without this, a user who attached an image on turn N has no way to
 *     refer to it on turn N+M — the stored message row only has the typed
 *     text, and the `ez-attachment://<id>` handles from turn N's trailing
 *     ref block are long gone from the model's context.
 *   - `rehydrateAssistantMessageContent`: tool-generated images persisted
 *     to disk under `/api/ext-files/<name>/...`. The tool result writes a
 *     short URL (not base64) into the assistant text — great for not
 *     blowing the context window on the turn the image was generated, but
 *     on subsequent turns the model sees only a URL string, not the image.
 *     This helper reads the bytes back in and attaches them as
 *     `ImageContent` parts alongside the original text.
 */

import { isMimeAccepted, type AttachmentCapabilities } from "../../providers/model-capabilities";
import { buildUserContent, type PiContentPart, type StagedAttachment } from "./content-builder";
import { listAttachmentsForMessages } from "../../db/queries/attachments";
import { readFile, stat } from "node:fs/promises";
import { resolveExtFilesPath, MIME_BY_EXT } from "./ext-files-resolver";

export interface HistoryUserRow {
	id: string;
	role: string;
	content: string;
}

export async function loadPastAttachments(
	branchMessages: HistoryUserRow[],
): Promise<{ byMessage: Map<string, StagedAttachment[]>; all: StagedAttachment[] }> {
	const byMessage = new Map<string, StagedAttachment[]>();
	const all: StagedAttachment[] = [];
	const userMsgIds = branchMessages.filter((m) => m.role === "user").map((m) => m.id);
	if (userMsgIds.length === 0) return { byMessage, all };
	const rows = await listAttachmentsForMessages(userMsgIds);
	for (const r of rows) {
		const att: StagedAttachment = {
			id: r.id,
			filename: r.filename,
			mimeType: r.mimeType,
			storagePath: r.storagePath,
		};
		all.push(att);
		const list = byMessage.get(r.messageId) ?? [];
		list.push(att);
		byMessage.set(r.messageId, list);
	}
	return { byMessage, all };
}

/**
 * Produce the rebuilt user-message content. Attachments the current model
 * cannot take (e.g. the user switched to a text-only model after an image
 * turn) are dropped one by one, so the rest of the message — its text
 * files, its PDFs — still reach the model. On any other build failure we
 * fall back to the raw text: the turn doesn't crash.
 */
export async function rehydrateUserMessageContent(
	text: string,
	attachments: StagedAttachment[],
	caps: AttachmentCapabilities,
): Promise<string | PiContentPart[]> {
	const accepted = attachments.filter((a) => isMimeAccepted(caps, a.mimeType));
	if (accepted.length === 0) return text;
	try {
		return await buildUserContent(text, accepted, caps);
	} catch {
		return text;
	}
}

// Match `![optional alt](URL)`. The URL portion rejects whitespace and `)`,
// keeping the parser strict enough that mentions like `![a]( url )` or a
// stray `)` in surrounding prose don't produce false-positive captures.
const MARKDOWN_IMAGE_MATCH = /!\[[^\]]*\]\(([^()\s]+)\)/g;

// Any URL starting with `/api/ext-files/<name>/<rest>` — capture the name and
// the remainder so we can feed the pair to `resolveExtFilesPath`. We
// deliberately do NOT match externally-hosted images, `data:` URIs, or bare
// URLs; those get handled (or correctly ignored) by other paths.
const EXT_FILES_URL = /^\/api\/ext-files\/([^/]+)\/(.+)$/;

export interface AssistantRehydrateOptions {
	/** Project root for `.ezcorp/extension-data/…` lookup. Defaults to cwd. */
	cwd?: string;
}

/**
 * Extract every markdown-image URL from `text` in source order. Returns
 * raw URL strings — the caller decides which to resolve. Pure (no I/O),
 * so the smart-cap walker in load-history can cheaply enumerate
 * candidates before spending file reads.
 */
export function extractExtFilesUrls(text: string): string[] {
	const out: string[] = [];
	if (!text) return out;
	for (const m of text.matchAll(MARKDOWN_IMAGE_MATCH)) out.push(m[1]!);
	return out;
}

/**
 * Cheap pre-flight: is `url` a valid, allowlist-passing ext-files URL with
 * a recognised image extension, and does the file exist on disk? Returns
 * the resolved path + byte size when so, `null` otherwise. Used by the
 * smart-cap walker to count bytes before committing to read+encode.
 *
 * Never throws.
 */
export async function statExtFilesImage(
	url: string,
	opts: AssistantRehydrateOptions = {},
): Promise<{ absPath: string; mimeType: string; sizeBytes: number } | null> {
	const m = EXT_FILES_URL.exec(url);
	if (!m) return null;
	const [, name, relPath] = m;
	const resolved = resolveExtFilesPath(name, relPath, opts.cwd);
	if (!resolved) return null;
	const ext = (resolved.absPath.split(".").pop() ?? "").toLowerCase();
	if (!(ext in MIME_BY_EXT)) return null;
	try {
		const s = await stat(resolved.absPath);
		if (!s.isFile()) return null;
		return { absPath: resolved.absPath, mimeType: resolved.mimeType, sizeBytes: s.size };
	} catch {
		return null;
	}
}

/**
 * Read + base64-encode a previously-stat'd ext-files image. Split from
 * `statExtFilesImage` so the smart-cap walker can stat many but read few.
 *
 * Never throws.
 */
export async function loadExtFilesImage(absPath: string, mimeType: string): Promise<
	{ type: "image"; data: string; mimeType: string } | null
> {
	try {
		const bytes = await readFile(absPath);
		return { type: "image", data: bytes.toString("base64"), mimeType };
	} catch {
		return null;
	}
}

/**
 * Scan an assistant message text for `![](/api/ext-files/<ext>/<path>)` URLs
 * and return a content-parts array: one text part (the full original text)
 * followed by one `ImageContent` part per successfully-resolved URL.
 *
 * Return shape is always a non-empty `PiContentPart[]` — even for texts that
 * contain no URLs at all — so callers can rely on `out[0].type === "text"`.
 *
 * Rehydration is best-effort: any URL that fails the allowlist / containment
 * / file-existence / MIME-allowlist / read checks is silently dropped from
 * the output. The original URL text stays in the text part either way, so
 * the model's narrative reference is preserved even when the bytes aren't.
 * This also means we never throw — a bad URL can't crash a turn.
 */
export async function rehydrateAssistantMessageContent(
	text: string,
	opts: AssistantRehydrateOptions = {},
): Promise<PiContentPart[]> {
	const parts: PiContentPart[] = [{ type: "text", text }];
	const urls = extractExtFilesUrls(text);
	if (urls.length === 0) return parts;

	const resolved = await Promise.all(urls.map((u) => resolveUrlToImage(u, opts.cwd)));
	for (const img of resolved) {
		if (img) parts.push(img);
	}
	return parts;
}

/**
 * Resolve one markdown-URL capture to an `ImageContent` part or null.
 *
 * Returns null (never throws) for any non-local URL, any URL that fails
 * security checks, or any read/stat failure.
 */
async function resolveUrlToImage(
	url: string,
	cwd: string | undefined,
): Promise<PiContentPart | null> {
	const info = await statExtFilesImage(url, { cwd });
	if (!info) return null;
	return loadExtFilesImage(info.absPath, info.mimeType);
}
