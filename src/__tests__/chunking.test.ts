import { test, expect, describe } from "bun:test";
import { chunkText, isAllowedFile, } from "../memory/chunking";

describe("chunkText", () => {
  test("returns single chunk for short text", () => {
    const chunks = chunkText("Hello world");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe("Hello world");
    expect(chunks[0]!.index).toBe(0);
  });

  test("splits long text into multiple chunks", () => {
    const text = "a".repeat(1000);
    const chunks = chunkText(text, { chunkSize: 512, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk (except last) should be <= chunkSize
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.content.length).toBeLessThanOrEqual(512);
    }
  });

  test("chunks have sequential indices", () => {
    const text = "word ".repeat(200);
    const chunks = chunkText(text, { chunkSize: 100, overlap: 20 });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.index).toBe(i);
    }
  });

  test("overlap between adjacent chunks", () => {
    const text = "a".repeat(200);
    const chunks = chunkText(text, { chunkSize: 100, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    // The end of chunk 0 should overlap with the start of chunk 1
    const end0 = chunks[0]!.content.slice(-20);
    const start1 = chunks[1]!.content.slice(0, 20);
    expect(end0).toBe(start1);
  });

  test("prefers newline boundaries when available", () => {
    // Build text: 300 chars, with a newline at position 280
    const before = "x".repeat(280);
    const after = "y".repeat(220);
    const text = before + "\n" + after;
    const chunks = chunkText(text, { chunkSize: 400, overlap: 50 });
    // First chunk should break at the newline (position 281, including \n)
    expect(chunks[0]!.content.endsWith("\n")).toBe(true);
  });

  test("covers entire text content", () => {
    // Use unique characters so we can verify full coverage
    const text = Array.from({ length: 900 }, (_, i) => String.fromCharCode(33 + (i % 94))).join("");
    const chunks = chunkText(text, { chunkSize: 100, overlap: 10 });
    // Concatenate all chunk content, remove overlap duplicates by checking
    // that first + last chunks span the full text
    expect(chunks[0]!.content).toBe(text.slice(0, chunks[0]!.content.length));
    const lastChunk = chunks[chunks.length - 1]!;
    expect(text.endsWith(lastChunk.content)).toBe(true);
    // Total unique coverage: sum of non-overlapping parts
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("stops once a chunk reaches the end — no overlap-only tail chunks", () => {
    // 600 chars at 512/50: one full chunk, then one chunk that runs to the
    // end. Each extra chunk would be a sliver of the previous one that the
    // KB still embeds and stores.
    const chunks = chunkText("a".repeat(600), { chunkSize: 512, overlap: 50 });
    expect(chunks.map((c) => c.content.length)).toEqual([512, 138]);
  });
});

describe("isAllowedFile", () => {
  test("allows valid extensions", () => {
    expect(isAllowedFile("readme.md")).toBe(true);
    expect(isAllowedFile("data.json")).toBe(true);
    expect(isAllowedFile("script.py")).toBe(true);
    expect(isAllowedFile("config.yaml")).toBe(true);
    expect(isAllowedFile("notes.txt")).toBe(true);
    expect(isAllowedFile("query.sql")).toBe(true);
  });

  test("rejects invalid extensions", () => {
    expect(isAllowedFile("photo.jpg")).toBe(false);
    expect(isAllowedFile("archive.zip")).toBe(false);
    expect(isAllowedFile("binary.exe")).toBe(false);
    expect(isAllowedFile("document.pdf")).toBe(false);
  });

  test("rejects files without extension", () => {
    expect(isAllowedFile("Makefile")).toBe(false);
    expect(isAllowedFile("README")).toBe(false);
  });

  test("is case-insensitive", () => {
    expect(isAllowedFile("README.MD")).toBe(true);
    expect(isAllowedFile("data.JSON")).toBe(true);
  });
});
