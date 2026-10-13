import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAttachmentHandleResolver } from "../chat/attachments/handle-resolver";
import { writeAttachment } from "../chat/attachments/storage";

const PNG_BYTES = new TextEncoder().encode("PNG-FAKE-BYTES");
const JPG_BYTES = new TextEncoder().encode("JPG-FAKE-BYTES");
const PNG_B64 = Buffer.from(PNG_BYTES).toString("base64");
const JPG_B64 = Buffer.from(JPG_BYTES).toString("base64");

let root: string;
let pngPath: string;
let jpgPath: string;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "ezcorp-handles-"));
	pngPath = (await writeAttachment({
		projectRoot: root, conversationId: "c", messageId: "m",
		filename: "cow.png", mimeType: "image/png", bytes: PNG_BYTES,
	})).storagePath;
	jpgPath = (await writeAttachment({
		projectRoot: root, conversationId: "c", messageId: "m",
		filename: "man.jpg", mimeType: "image/jpeg", bytes: JPG_BYTES,
	})).storagePath;
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe("buildAttachmentHandleResolver", () => {
	test("empty input returns a no-op resolver", async () => {
		const resolver = buildAttachmentHandleResolver([]);
		const out = await resolver({ images: ["ez-attachment://whatever"] });
		expect((out.images as string[])[0]).toBe("ez-attachment://whatever");
	});

	test("substitutes a single handle inside an array of strings", async () => {
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
		]);
		const out = await resolver({ images: ["ez-attachment://a1"] });
		const imgs = out.images as string[];
		expect(imgs[0]).toBe(`data:image/png;base64,${PNG_B64}`);
	});

	test("substitutes multiple distinct handles", async () => {
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
			{ id: "a2", mimeType: "image/jpeg", storagePath: jpgPath },
		]);
		const out = await resolver({ images: ["ez-attachment://a1", "ez-attachment://a2"] });
		const imgs = out.images as string[];
		expect(imgs[0]).toBe(`data:image/png;base64,${PNG_B64}`);
		expect(imgs[1]).toBe(`data:image/jpeg;base64,${JPG_B64}`);
	});

	test("leaves unknown handles untouched so the tool can surface the error", async () => {
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
		]);
		const out = await resolver({ images: ["ez-attachment://nope"] });
		expect((out.images as string[])[0]).toBe("ez-attachment://nope");
	});

	test("walks nested objects and mixed shapes", async () => {
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
		]);
		const out = await resolver({
			prompt: "use ez-attachment://a1 please",
			nested: { image: "ez-attachment://a1", other: 42 },
			images: [{ url: "ez-attachment://a1" }],
		});
		expect(out.prompt).toBe(`use data:image/png;base64,${PNG_B64} please`);
		expect((out.nested as any).image).toBe(`data:image/png;base64,${PNG_B64}`);
		expect((out.nested as any).other).toBe(42);
		expect(((out.images as any[])[0] as any).url).toBe(`data:image/png;base64,${PNG_B64}`);
	});

	test("non-string / non-collection values pass through", async () => {
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
		]);
		const out = await resolver({ count: 3, flag: true, nothing: null });
		expect(out.count).toBe(3);
		expect(out.flag).toBe(true);
		expect(out.nothing).toBe(null);
	});

	test("caches bytes across repeated handles in one input", async () => {
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
		]);
		const out = await resolver({
			a: "ez-attachment://a1",
			b: "ez-attachment://a1",
			c: ["ez-attachment://a1", "ez-attachment://a1"],
		});
		const uri = `data:image/png;base64,${PNG_B64}`;
		expect(out.a).toBe(uri);
		expect(out.b).toBe(uri);
		expect((out.c as string[])[0]).toBe(uri);
		expect((out.c as string[])[1]).toBe(uri);
	});

	test("handle at start, middle, and end of a string are all substituted", async () => {
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
		]);
		const uri = `data:image/png;base64,${PNG_B64}`;
		const outStart = await resolver({ s: "ez-attachment://a1 trailing" });
		expect(outStart.s).toBe(`${uri} trailing`);
		const outMiddle = await resolver({ s: "before ez-attachment://a1 after" });
		expect(outMiddle.s).toBe(`before ${uri} after`);
		const outEnd = await resolver({ s: "leading ez-attachment://a1" });
		expect(outEnd.s).toBe(`leading ${uri}`);
	});

	test("handles adjacent to common terminators (comma, bracket, quote) parse correctly", async () => {
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
			{ id: "a2", mimeType: "image/jpeg", storagePath: jpgPath },
		]);
		const png = `data:image/png;base64,${PNG_B64}`;
		const jpg = `data:image/jpeg;base64,${JPG_B64}`;
		const out = await resolver({
			arrayLike: "[ez-attachment://a1,ez-attachment://a2]",
			quoted: `"ez-attachment://a1"`,
			paren: "(ez-attachment://a1)",
		});
		expect(out.arrayLike).toBe(`[${png},${jpg}]`);
		expect(out.quoted).toBe(`"${png}"`);
		expect(out.paren).toBe(`(${png})`);
	});

	test("a handle at the end of a sentence or in markdown code resolves — the punctuation is not part of the id", async () => {
		const uuid = "d92d8c65-fa8f-46f1-9568-04ed62593157";
		const resolver = buildAttachmentHandleResolver([
			{ id: uuid, mimeType: "image/png", storagePath: pngPath },
		]);
		const png = `data:image/png;base64,${PNG_B64}`;
		const out = await resolver({
			caption: `Use the cow from ez-attachment://${uuid}.`,
			code: `Edit \`ez-attachment://${uuid}\`, then crop it (see ez-attachment://${uuid}); done`,
		});
		expect(out.caption).toBe(`Use the cow from ${png}.`);
		expect(out.code).toBe(`Edit \`${png}\`, then crop it (see ${png}); done`);
	});

	test("id containing dashes and alphanumerics (UUID shape) resolves correctly", async () => {
		const uuid = "d92d8c65-fa8f-46f1-9568-04ed62593157";
		const resolver = buildAttachmentHandleResolver([
			{ id: uuid, mimeType: "image/png", storagePath: pngPath },
		]);
		const out = await resolver({ s: `ez-attachment://${uuid}` });
		expect(out.s).toBe(`data:image/png;base64,${PNG_B64}`);
	});

	test("does not treat known-looking substrings as handles when the scheme is missing", async () => {
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
		]);
		const out = await resolver({ s: "a1 or attachment://a1 or just a1 alone" });
		// Nothing changes — the full scheme prefix `ez-attachment://` must be present.
		expect(out.s).toBe("a1 or attachment://a1 or just a1 alone");
	});

	test("multiple different handles in one string are each resolved", async () => {
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
			{ id: "a2", mimeType: "image/jpeg", storagePath: jpgPath },
		]);
		const out = await resolver({
			sentence: "use ez-attachment://a1 then ez-attachment://a2 and again ez-attachment://a1",
		});
		const png = `data:image/png;base64,${PNG_B64}`;
		const jpg = `data:image/jpeg;base64,${JPG_B64}`;
		expect(out.sentence).toBe(`use ${png} then ${jpg} and again ${png}`);
	});

	test("dedupe: same attachment listed twice resolves once and yields identical data URIs", async () => {
		// Simulates the executor's union of current-turn + past-branch
		// attachments when the same file appears in both sets.
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
		]);
		const out = await resolver({ images: ["ez-attachment://a1"] });
		const uri = `data:image/png;base64,${PNG_B64}`;
		expect((out.images as string[])[0]).toBe(uri);
	});

	test("unknown handle adjacent to a known handle leaves only the unknown in place", async () => {
		const resolver = buildAttachmentHandleResolver([
			{ id: "a1", mimeType: "image/png", storagePath: pngPath },
		]);
		const out = await resolver({
			s: "ez-attachment://a1 and ez-attachment://nope end",
		});
		const uri = `data:image/png;base64,${PNG_B64}`;
		expect(out.s).toBe(`${uri} and ez-attachment://nope end`);
	});
});
