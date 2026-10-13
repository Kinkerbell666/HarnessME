import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeFactoryPageBase64 } from "@ezcorp/factory-sdk/page-bytes";
import type {
  FactoryActivities,
  FactoryDefinitionPageReference,
  FactoryDefinitionSource,
  FactoryManifestPage,
  ImmutableObjectReference,
} from "../src/contracts.ts";
import { loadCompiledFactory } from "../src/definition-pages.ts";

/** The manifest pages are edited in place to stage each fault. */
type EditableManifestPage = { -readonly [Key in keyof FactoryManifestPage]: FactoryManifestPage[Key] };
type DefinitionReader = Pick<FactoryActivities, "loadManifestPage" | "loadDefinitionPage">;

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const identity = { tenantId: "tenant", projectId: "project", logicalRunId: "run", interpreterId: "build" };
const reference = (objectId: string, character: string, encodedBytes = 1): ImmutableObjectReference => ({ objectId, digest: digest(character), encodedBytes });
const pageOf = (objectId: string, character: string, index: number, encodedBytes = 1): FactoryDefinitionPageReference => ({ ...reference(objectId, character, encodedBytes), index });

function fixture() {
  const definitionDigest = digest("a");
  const content = JSON.stringify({ digest: definitionDigest, partitions: [] });
  const cut = Math.floor(content.length / 2);
  const chunks = [content.slice(0, cut), content.slice(cut)];
  const [firstChunk, secondChunk] = chunks;
  assert.ok(firstChunk !== undefined && secondChunk !== undefined);
  const firstPage = pageOf("page-0", "b", 0, Buffer.byteLength(firstChunk));
  const secondPage = pageOf("page-1", "c", 1, Buffer.byteLength(secondChunk));
  const root = reference("manifest-0", "d");
  const next = reference("manifest-1", "e");
  const source: { -readonly [Key in keyof FactoryDefinitionSource]: FactoryDefinitionSource[Key] } = { definitionDigest, definitionEncodedBytes: Buffer.byteLength(content), manifest: root };
  const manifests = new Map<string, EditableManifestPage>([
    [root.objectId, { schemaVersion: "factory.manifest-page.v1", definitionDigest, definitionEncodedBytes: source.definitionEncodedBytes, self: root, pages: [secondPage], next }],
    [next.objectId, { schemaVersion: "factory.manifest-page.v1", definitionDigest, definitionEncodedBytes: source.definitionEncodedBytes, self: next, pages: [firstPage] }],
  ]);
  const manifest = (objectId: string): EditableManifestPage => {
    const page = manifests.get(objectId);
    assert.ok(page, `fixture has no manifest page ${objectId}`);
    return page;
  };
  const reader: { -readonly [Key in keyof DefinitionReader]: DefinitionReader[Key] } = {
    loadManifestPage: async ({ page }) => structuredClone(manifest(page.objectId)),
    loadDefinitionPage: async ({ page }) => {
      const chunk = chunks[page.index];
      assert.ok(chunk !== undefined, `fixture has no definition page ${page.index}`);
      return { index: page.index, objectId: page.objectId, digest: page.digest, contentBase64: encodeFactoryPageBase64(new TextEncoder().encode(chunk)) };
    },
  };
  return { chunks, content, definitionDigest, manifest, manifests, next, reader, root, source };
}

describe("paged compiled factory loading", () => {
  it("loads a hierarchical manifest through recorded, ordered pages", async () => {
    const value = fixture();
    assert.deepEqual(await loadCompiledFactory(identity, value.source, value.reader), JSON.parse(value.content));
  });

  it("rejects manifest identity, definition, cycles, and page-count faults", async () => {
    const wrongSelf = fixture();
    wrongSelf.manifest(wrongSelf.root.objectId).self = reference("wrong", "d");
    await assert.rejects(loadCompiledFactory(identity, wrongSelf.source, wrongSelf.reader), /identity/);

    const wrongDefinition = fixture();
    wrongDefinition.manifest(wrongDefinition.root.objectId).definitionDigest = digest("f");
    await assert.rejects(loadCompiledFactory(identity, wrongDefinition.source, wrongDefinition.reader), /requested definition/);

    const cycle = fixture();
    cycle.manifest(cycle.next.objectId).next = cycle.root;
    await assert.rejects(loadCompiledFactory(identity, cycle.source, cycle.reader), /cycle/);

    const noPages = fixture();
    noPages.manifest(noPages.root.objectId).pages = [];
    noPages.manifest(noPages.root.objectId).next = undefined;
    await assert.rejects(loadCompiledFactory(identity, noPages.source, noPages.reader), /at least one/);

    const tooMany = fixture();
    tooMany.manifest(tooMany.root.objectId).pages = Array.from({ length: 512 }, (_, index) => pageOf(`first-${index}`, "b", index));
    tooMany.manifest(tooMany.next.objectId).pages = [pageOf("overflow", "c", 512)];
    await assert.rejects(loadCompiledFactory(identity, tooMany.source, tooMany.reader), /definition exceeds 512/);

    let manifestIndex = 0;
    const longSource = { definitionDigest: digest("a"), definitionEncodedBytes: 1, manifest: reference("manifest-0", "b") };
    const longReader: DefinitionReader = {
      loadManifestPage: async ({ page }) => ({ schemaVersion: "factory.manifest-page.v1", definitionDigest: longSource.definitionDigest, definitionEncodedBytes: 1, self: page, pages: [], next: reference(`manifest-${++manifestIndex}`, "b") }),
      loadDefinitionPage: async () => { throw new Error("not reached"); },
    };
    await assert.rejects(loadCompiledFactory(identity, longSource, longReader), /manifest exceeds 512/);
  });

  it("rejects discontinuous pages, byte drift, invalid JSON, and digest drift", async () => {
    const discontinuous = fixture();
    const discontinuousManifest = discontinuous.manifest(discontinuous.next.objectId);
    discontinuousManifest.pages = discontinuousManifest.pages.map((page) => ({ ...page, index: 2 }));
    await assert.rejects(loadCompiledFactory(identity, discontinuous.source, discontinuous.reader), /unique and contiguous/);

    const byteDrift = fixture();
    byteDrift.source.definitionEncodedBytes += 1;
    for (const manifest of byteDrift.manifests.values()) manifest.definitionEncodedBytes += 1;
    await assert.rejects(loadCompiledFactory(identity, byteDrift.source, byteDrift.reader), /byte count/);

    const invalid = fixture();
    invalid.reader.loadDefinitionPage = async ({ page }) => ({ index: page.index, objectId: page.objectId, digest: page.digest, contentBase64: encodeFactoryPageBase64(new TextEncoder().encode(page.index === 0 ? "{".repeat(page.encodedBytes) : "x".repeat(page.encodedBytes))) });
    await assert.rejects(loadCompiledFactory(identity, invalid.source, invalid.reader), /valid JSON/);

    for (const parsed of [null, [], { digest: digest("f") }]) {
      const wrong = fixture();
      const content = JSON.stringify(parsed);
      const page = pageOf("only", "b", 0, Buffer.byteLength(content));
      wrong.source.definitionEncodedBytes = page.encodedBytes;
      wrong.manifest(wrong.root.objectId).definitionEncodedBytes = page.encodedBytes;
      wrong.manifest(wrong.root.objectId).pages = [page];
      wrong.manifest(wrong.root.objectId).next = undefined;
      wrong.reader.loadDefinitionPage = async () => ({ index: 0, objectId: page.objectId, digest: page.digest, contentBase64: encodeFactoryPageBase64(new TextEncoder().encode(content)) });
      await assert.rejects(loadCompiledFactory(identity, wrong.source, wrong.reader), /digest/);
    }
  });
});
