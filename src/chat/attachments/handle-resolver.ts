/**
 * Resolves `ez-attachment://<id>` handles embedded in tool-call args to real
 * `data:<mime>;base64,<bytes>` URIs. Walks strings, arrays, and plain objects
 * recursively. Non-matching values pass through untouched.
 *
 * The handle scheme is defined in `./content-builder.ts` so the builder
 * (which emits handles for the LLM to cite) and the resolver (which replaces
 * them at tool-dispatch time) agree on the wire format.
 */

import { ATTACHMENT_HANDLE_SCHEME, type StagedAttachment } from "./content-builder";
import { readAttachmentBytes } from "./storage";

interface ResolvableAttachment {
	id: string;
	mimeType: string;
	storagePath: string;
}

export function buildAttachmentHandleResolver(attachments: ResolvableAttachment[]) {
	if (attachments.length === 0) {
		return async (input: Record<string, unknown>) => input;
	}
	const byId = new Map(attachments.map((a) => [a.id, a]));
	// Cache bytes-as-base64 per attachment so two tool calls in the same turn
	// that reference the same handle only pay the read+encode once.
	const cache = new Map<string, string>();

	async function toDataUri(att: ResolvableAttachment): Promise<string> {
		const hit = cache.get(att.id);
		if (hit) return hit;
		const bytes = await readAttachmentBytes(att.storagePath);
		const b64 = Buffer.from(bytes).toString("base64");
		const uri = `data:${att.mimeType};base64,${b64}`;
		cache.set(att.id, uri);
		return uri;
	}

	async function resolveString(s: string): Promise<string> {
		if (!s.includes(ATTACHMENT_HANDLE_SCHEME)) return s;
		// Multi-occurrence: replace every handle in the string. An id is the
		// run of id characters after the scheme — `messageAttachments.id` is
		// a UUID — so prose punctuation after a handle (`.`, `;`, a closing
		// backtick) ends it instead of becoming part of the id.
		const parts: string[] = [];
		let i = 0;
		while (i < s.length) {
			const hit = s.indexOf(ATTACHMENT_HANDLE_SCHEME, i);
			if (hit < 0) { parts.push(s.slice(i)); break; }
			if (hit > i) parts.push(s.slice(i, hit));
			let end = hit + ATTACHMENT_HANDLE_SCHEME.length;
			while (end < s.length && /[A-Za-z0-9_-]/.test(s[end]!)) end++;
			const id = s.slice(hit + ATTACHMENT_HANDLE_SCHEME.length, end);
			const att = byId.get(id);
			if (!att) {
				// Unknown handle — leave verbatim so the error surfaces in the
				// tool's validation layer (instead of silently swallowing).
				parts.push(s.slice(hit, end));
			} else {
				parts.push(await toDataUri(att));
			}
			i = end;
		}
		return parts.join("");
	}

	async function walk(value: unknown): Promise<unknown> {
		if (typeof value === "string") return resolveString(value);
		if (Array.isArray(value)) {
			const out: unknown[] = [];
			for (const v of value) out.push(await walk(v));
			return out;
		}
		if (value && typeof value === "object") {
			const src = value as Record<string, unknown>;
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(src)) out[k] = await walk(v);
			return out;
		}
		return value;
	}

	return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
		return (await walk(input)) as Record<string, unknown>;
	};
}

/** Narrow a StagedAttachment[] to the fields the resolver actually uses. */
export function toResolvableAttachments(list: StagedAttachment[]): ResolvableAttachment[] {
	return list.map((a) => ({ id: a.id, mimeType: a.mimeType, storagePath: a.storagePath }));
}
