import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { canonicalizeJson } from "@ezcorp/factory-sdk/canonical";
import { decodeFactoryPageBase64, encodeFactoryPageBase64 } from "@ezcorp/factory-sdk/page-bytes";
import type { KernelEvent, KernelState } from "@ezcorp/factory-sdk/kernel-types";
import type { FactoryTransitionManifest, FactoryTransitionPage, TransitionArtifact, TransitionRecord } from "../src/contracts.ts";
import { loadTransitionArtifact, persistTransition, splitTransitionContent, type TransitionReader, type TransitionWriter } from "../src/transition-pages.ts";
import { asJson, malformed } from "./typing.ts";

const digest = (content: string) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const identity = { tenantId: "tenant", projectId: "project", logicalRunId: "run", interpreterId: "interpreter" };

const transitionState: KernelState = {
  logicalRunId: "run", definitionDigest: digest("definition"), input: {}, status: "cancelled", runDeadlineAtMs: 10, nowMs: 4,
  cancellationEpoch: 1, commandCounter: 0, eventSequence: 9, spentCostMicros: "0", unknownCostMicros: "0", usageSettlements: {}, nodes: {}, scopes: {}, appliedEventIds: ["decision-1"], unresolvedUncertainNodeIds: [],
};

function storedTransition() {
  const event: KernelEvent = { kind: "cancel", id: "decision-1", atMs: 4, reason: "stop" };
  const artifact: TransitionArtifact = { schemaVersion: "factory.transition.v1", ...identity, sourceSequence: 9, event, nextState: transitionState, commands: [] };
  const content = canonicalizeJson(asJson(artifact));
  const parts = splitTransitionContent(content);
  const pages = parts.map((part, index) => ({ index, objectId: `page-${index}`, digest: digest(part), encodedBytes: Buffer.byteLength(part) }));
  const manifestValue = { schemaVersion: "factory.transition-manifest.v1" as const, ...identity, sourceSequence: 9, eventId: event.id, eventHash: digest(canonicalizeJson(asJson(event))), encodedBytes: Buffer.byteLength(content), pages };
  const manifestContent = canonicalizeJson(manifestValue);
  const manifest = { objectId: "transition-manifest", digest: digest(manifestContent), encodedBytes: Buffer.byteLength(manifestContent) };
  const reader: TransitionReader = {
    async loadTransitionManifest() { return { ...manifestValue, self: manifest }; },
    async loadTransitionPage({ page }) {
      const part = parts[page.index];
      assert.ok(part !== undefined, `fixture has no transition page ${page.index}`);
      return { ...page, contentBase64: encodeFactoryPageBase64(new TextEncoder().encode(part)) };
    },
  };
  const [firstPage] = pages;
  const [firstPart] = parts;
  assert.ok(firstPage !== undefined && firstPart !== undefined);
  return { artifact, content, firstPage, firstPart, manifest, manifestValue, pages, parts, reader };
}

function writer(overrides: Partial<TransitionWriter> = {}) {
  const contents: string[] = [];
  const records: TransitionRecord[] = [];
  const sink: TransitionWriter = {
    async stageTransitionPage(request) {
      const content = new TextDecoder().decode(decodeFactoryPageBase64(request.contentBase64));
      contents[request.index] = content;
      return { index: request.index, objectId: `page-${request.index}`, digest: digest(content), encodedBytes: request.encodedBytes };
    },
    async finalizeTransitionArtifact(request) {
      const artifact = JSON.parse(contents.join(""));
      assert.equal(request.encodedBytes, new TextEncoder().encode(contents.join("")).byteLength);
      assert.equal(request.eventId, artifact.event.id);
      const eventHash = digest(canonicalizeJson(artifact.event));
      if (request.expectedEventHash !== undefined) assert.equal(request.expectedEventHash, eventHash);
      return { manifest: { objectId: "transition-manifest", digest: digest(contents.join("")), encodedBytes: 512 }, eventHash };
    },
    async recordTransition(record) { records.push(record); },
    ...overrides,
  };
  return { ...sink, contents, records };
}

describe("transition paging", () => {
  it("splits UTF-8 content into exact bounded pages", () => {
    assert.deepEqual(splitTransitionContent(""), [""]);
    const content = `start-${"🙂".repeat(20_000)}-end`;
    const pages = splitTransitionContent(content);
    assert.equal(pages.join(""), content);
    assert.ok(pages.length > 2);
    assert.ok(pages.every((page) => new TextEncoder().encode(page).byteLength <= 32 * 1024));
  });

  it("finalizes immutable pages and commits the compact exact inbox identity", async () => {
    const event: KernelEvent = { kind: "cancel", id: "decision-1", atMs: 4, reason: "🙂".repeat(18_000) };
    const eventHash = digest(canonicalizeJson(asJson(event)));
    const sink = writer();
    await persistTransition(identity, 9, event, {
      logicalRunId: "run", definitionDigest: digest("definition"), input: {}, status: "cancelled", runDeadlineAtMs: 10, nowMs: 4,
      cancellationEpoch: 1, commandCounter: 0, eventSequence: 9, spentCostMicros: "0", unknownCostMicros: "0", usageSettlements: {}, nodes: {}, scopes: {}, appliedEventIds: [event.id], unresolvedUncertainNodeIds: [],
    }, [], { sequence: 7, eventId: event.id, eventHash }, sink);
    assert.ok(sink.contents.length > 2);
    assert.deepEqual(sink.records, [{ ...identity, sourceSequence: 9, eventId: event.id, eventHash, inboxSequence: 7, artifactManifest: { objectId: "transition-manifest", digest: digest(sink.contents.join("")), encodedBytes: 512 } }]);
  });

  it("rejects a mismatched page receipt, event digest, or inbox ID before audit", async () => {
    const event: KernelEvent = { kind: "cancel", id: "decision-1", atMs: 4, reason: "stop" };
    const state: KernelState = { logicalRunId: "run", definitionDigest: digest("definition"), input: {}, status: "cancelled", runDeadlineAtMs: 10, nowMs: 4, cancellationEpoch: 1, commandCounter: 0, eventSequence: 1, spentCostMicros: "0", unknownCostMicros: "0", usageSettlements: {}, nodes: {}, scopes: {}, appliedEventIds: [event.id], unresolvedUncertainNodeIds: [] };
    await assert.rejects(persistTransition(identity, 1, event, state, [], undefined, writer({ stageTransitionPage: async () => ({ index: 2, objectId: "wrong", digest: digest("wrong"), encodedBytes: 1 }) })), /does not match staged content/);
    await assert.rejects(persistTransition(identity, 1, event, state, [], undefined, writer({ finalizeTransitionArtifact: async () => ({ manifest: { objectId: "manifest", digest: digest("manifest"), encodedBytes: 1 }, eventHash: "wrong" }) })), /invalid event digest/);
    const eventHash = digest(canonicalizeJson(asJson(event)));
    await assert.rejects(persistTransition(identity, 1, event, state, [], { sequence: 1, eventId: "other", eventHash }, writer()), /did not preserve/);
    let staged = false;
    const oversized: KernelState = { ...state, input: { value: "x".repeat(576 * 1024) } };
    await assert.rejects(persistTransition(identity, 1, event, oversized, [], undefined, writer({ stageTransitionPage: async () => { staged = true; throw new Error("must not stage"); } })), /transition exceeds/);
    assert.equal(staged, false);
  });

  it("restores the exact canonical transition from immutable pages", async () => {
    const stored = storedTransition();
    assert.deepEqual(await loadTransitionArtifact(identity, 9, stored.manifest, stored.reader), stored.artifact);
  });

  it("rejects altered manifest identity, scope, bounds, event identity, and page descriptors", async () => {
    const stored = storedTransition();
    await assert.rejects(loadTransitionArtifact(identity, 9, { ...stored.manifest, digest: "wrong" }, stored.reader), /SHA-256/);
    const cases: Array<[Partial<Record<keyof FactoryTransitionManifest, unknown>>, RegExp]> = [
      [{ schemaVersion: "wrong" }, /identity/],
      [{ self: { ...stored.manifest, objectId: "other" } }, /identity/],
      [{ tenantId: "other" }, /scope/],
      [{ encodedBytes: 0 }, /byte count/],
      [{ encodedBytes: 600_000 }, /byte count/],
      [{ eventHash: "wrong" }, /event identity/],
      [{ eventId: "" }, /event identity/],
      [{ pages: [] }, /page count/],
      [{ pages: Array.from({ length: 19 }, (_, index) => ({ index, objectId: `page-${index}`, digest: digest(String(index)), encodedBytes: 1 })) }, /page count/],
      [{ pages: [{ ...stored.firstPage, index: 1 }] }, /staged content/],
    ];
    for (const [change, expected] of cases) {
      const reader: TransitionReader = { ...stored.reader, async loadTransitionManifest() { return malformed<FactoryTransitionManifest>({ ...stored.manifestValue, self: stored.manifest, ...change }); } };
      await assert.rejects(loadTransitionArtifact(identity, 9, stored.manifest, reader), expected);
    }
  });

  it("rejects altered page identity, bytes, digest, total size, JSON, canonical form, scope, and event", async () => {
    const stored = storedTransition();
    const readWith = (page: FactoryTransitionPage): TransitionReader => ({ ...stored.reader, async loadTransitionPage() { return page; } });
    const encodedPart = encodeFactoryPageBase64(new TextEncoder().encode(stored.firstPart));
    await assert.rejects(loadTransitionArtifact(identity, 9, stored.manifest, readWith({ ...stored.firstPage, index: 1, contentBase64: encodedPart })), /staged content/);
    await assert.rejects(loadTransitionArtifact(identity, 9, stored.manifest, readWith({ ...stored.firstPage, objectId: "other", contentBase64: encodedPart })), /identity/);
    await assert.rejects(loadTransitionArtifact(identity, 9, stored.manifest, readWith({ ...stored.firstPage, contentBase64: encodeFactoryPageBase64(new TextEncoder().encode(`${stored.firstPart}x`)) })), /bytes/);
    const sameLengthMutation = `${stored.firstPart.slice(0, -1)} `;
    await assert.rejects(loadTransitionArtifact(identity, 9, stored.manifest, readWith({ ...stored.firstPage, contentBase64: encodeFactoryPageBase64(new TextEncoder().encode(sameLengthMutation)) })), /bytes/);
    const wrongTotal: TransitionReader = { ...stored.reader, async loadTransitionManifest() { return { ...stored.manifestValue, self: stored.manifest, encodedBytes: stored.manifestValue.encodedBytes + 1 }; } };
    await assert.rejects(loadTransitionArtifact(identity, 9, stored.manifest, wrongTotal), /byte count does not match/);
    const replacement = (content: string): { manifest: FactoryTransitionManifest; reader: TransitionReader } => {
      const page = { index: 0, objectId: "replacement", digest: digest(content), encodedBytes: Buffer.byteLength(content) };
      const manifest = { ...stored.manifestValue, self: stored.manifest, encodedBytes: page.encodedBytes, pages: [page] };
      return { manifest, reader: { async loadTransitionManifest() { return manifest; }, async loadTransitionPage() { return { ...page, contentBase64: encodeFactoryPageBase64(new TextEncoder().encode(content)) }; } } };
    };
    const invalid = replacement("{");
    await assert.rejects(loadTransitionArtifact(identity, 9, stored.manifest, invalid.reader), /valid JSON/);
    const noncanonical = replacement(JSON.stringify(stored.artifact, null, 2));
    await assert.rejects(loadTransitionArtifact(identity, 9, stored.manifest, noncanonical.reader), /canonical JSON/);
    const wrongScope = replacement(canonicalizeJson(asJson({ ...stored.artifact, projectId: "other" })));
    await assert.rejects(loadTransitionArtifact(identity, 9, stored.manifest, wrongScope.reader), /scope/);
    const wrongEvent = replacement(canonicalizeJson(asJson({ ...stored.artifact, event: { ...stored.artifact.event, id: "other" } })));
    await assert.rejects(loadTransitionArtifact(identity, 9, stored.manifest, wrongEvent.reader), /event/);
  });
});
