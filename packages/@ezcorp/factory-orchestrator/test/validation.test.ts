import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileFactory, FACTORY_LAZY_INPUT_SCHEMA_VERSION } from "@ezcorp/factory-sdk";
import { encodeFactoryPageBase64 } from "@ezcorp/factory-sdk/page-bytes";
import type { CompiledFactory, JsonValue } from "@ezcorp/factory-sdk/types";
import type { FactoryContinuation, FactoryDefinitionPage, FactoryDefinitionSource, FactoryManifestPage, FactoryPartitionSource, FactoryWorkflowInput, ImmutableObjectReference } from "../src/contracts.ts";
import { malformed } from "./typing.ts";
import { assertActivityPayloadSize, assertCommandBatchSize, assertContinuationSize, isPartitionSource, validateCompiledFactoryShape, validateDefinitionSource, validateInboxEnvelope, validateInboxEvent, validateLoadedDefinitionPage, validateManifestPage, validateObjectReference, validatePartitionSource, validateWorkflowInput } from "../src/validation.ts";

const digest = `sha256:${"a".repeat(64)}`;
const reference = { objectId: "object", digest, encodedBytes: 2 };
const definition = { definitionDigest: digest, definitionEncodedBytes: 2, manifest: reference };
const valid = { tenantId: "tenant", projectId: "project", logicalRunId: "run", interpreterId: "build", startedAtMs: 1, definition, input: {} };
const runner = { package: "inert", manifestName: "inert", version: "1", digest, export: "run" };

function compiledFactory() {
  const result = compileFactory({
    schemaVersion: "factory.v1",
    id: "validation-test",
    version: "1",
    interpreterCompatibility: "1",
    inputPorts: {},
    outputPorts: {},
    graph: { nodes: [{ id: "work", kind: "task", runner, deadlineMs: 600_000 }], outputs: {} },
    acceptance: { id: "acceptance", version: "1", claims: [{ id: "claim", validator: runner, required: true, protected: true }], groups: [] },
    packages: [{ name: runner.package, version: runner.version, digest: runner.digest }],
    factories: [],
    capabilities: [],
    effects: ["none"],
    bounds: { maxExpandedNodes: 10_000, maxScopeDepth: 16, runDeadlineMs: 600_000 },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("validation fixture did not compile");
  return result.factory;
}

describe("orchestrator boundary validation", () => {
  it("accepts bounded workflow identities and deadlines", () => {
    assert.doesNotThrow(() => validateWorkflowInput(valid));
    assert.doesNotThrow(() => validateWorkflowInput({ ...valid, deadlineAtMs: 1 }));
    assert.doesNotThrow(() => validateWorkflowInput({ ...valid, durableInput: { schemaVersion: FACTORY_LAZY_INPUT_SCHEMA_VERSION, parameters: { data: { kind: "artifact", artifact: { artifactId: "artifact", digest, encodedBytes: 70_000 } } } } }));
    assert.doesNotThrow(() => validateWorkflowInput({
      ...valid,
      continuation: { stateArtifact: { sourceSequence: 7, manifest: reference }, inbox: [], pendingInbox: [], sourceSequence: 7, handledSinceContinuation: 0, acknowledgedInboxSequence: 0 },
    }));
  });
  it("rejects missing, oversized, and invalid workflow fields", () => {
    for (const field of ["tenantId", "projectId", "logicalRunId", "interpreterId"]) {
      assert.throws(() => validateWorkflowInput({ ...valid, [field]: "" }), /1 to 512/);
      assert.throws(() => validateWorkflowInput({ ...valid, [field]: "x".repeat(513) }), /1 to 512/);
    }
    assert.throws(() => validateWorkflowInput({ ...valid, startedAtMs: -1 }), /timestamp/);
    assert.throws(() => validateWorkflowInput({ ...valid, startedAtMs: 1.5 }), /timestamp/);
    assert.throws(() => validateWorkflowInput({ ...valid, deadlineAtMs: 0 }), /workflow deadline/);
    assert.throws(() => validateWorkflowInput({ ...valid, deadlineAtMs: 1.5 }), /workflow deadline/);
    assert.throws(() => validateWorkflowInput({ ...valid, input: "x".repeat(70_000) }), /65536 bytes/);
    assert.throws(() => validateWorkflowInput({ ...valid, durableInput: { schemaVersion: FACTORY_LAZY_INPUT_SCHEMA_VERSION, parameters: { data: { kind: "artifact", artifact: { artifactId: "artifact", digest: "bad", encodedBytes: 1 } } } } }), /durable input artifact digest/);
    assert.throws(() => validateWorkflowInput({ ...valid, continuation: malformed<FactoryWorkflowInput["continuation"]>({ state: { definitionDigest: `sha256:${"b".repeat(64)}` }, acknowledgedInboxSequence: 0 }) }), /digest/);
    assert.throws(() => validateWorkflowInput({ ...valid, continuation: malformed<FactoryWorkflowInput["continuation"]>({ state: { definitionDigest: digest }, acknowledgedInboxSequence: -1 }) }), /inbox sequence/);
    assert.throws(() => validateWorkflowInput({ ...valid, continuation: malformed<FactoryWorkflowInput["continuation"]>({ state: { definitionDigest: digest }, acknowledgedInboxSequence: 1.5 }) }), /inbox sequence/);
    const artifactContinuation = { stateArtifact: { sourceSequence: 7, manifest: reference }, inbox: [], pendingInbox: [], sourceSequence: 7, handledSinceContinuation: 0, acknowledgedInboxSequence: 0 };
    assert.throws(() => validateWorkflowInput({ ...valid, continuation: { ...artifactContinuation, sourceSequence: 8 } }), /artifact sequence/);
    assert.throws(() => validateWorkflowInput({ ...valid, continuation: { ...artifactContinuation, stateArtifact: { ...artifactContinuation.stateArtifact, manifest: { ...reference, digest: "bad" } } } }), /SHA-256/);
  });
  it("validates immutable definition and manifest page contracts", () => {
    assert.doesNotThrow(() => validateDefinitionSource(definition));
    for (const source of malformed<FactoryDefinitionSource[]>([null, { ...definition, definitionDigest: "bad" }, { ...definition, definitionEncodedBytes: 0 }, { ...definition, definitionEncodedBytes: 16 * 1024 * 1024 + 1 }])) assert.throws(() => validateDefinitionSource(source), /definition|between/);
    for (const value of malformed<ImmutableObjectReference[]>([null, { ...reference, objectId: "" }, { ...reference, digest: "bad" }, { ...reference, encodedBytes: 0 }, { ...reference, encodedBytes: 32 * 1024 + 1 }])) assert.throws(() => validateObjectReference(value, "test"));
    const manifest: FactoryManifestPage = { schemaVersion: "factory.manifest-page.v1", definitionDigest: digest, definitionEncodedBytes: 2, self: reference, pages: [{ ...reference, index: 0 }] };
    assert.doesNotThrow(() => validateManifestPage(manifest));
    assert.doesNotThrow(() => validateManifestPage({ ...manifest, next: reference }));
    for (const value of malformed<FactoryManifestPage[]>([null, { ...manifest, schemaVersion: "bad" }, { ...manifest, pages: {} }, { ...manifest, pages: Array(513).fill({ ...reference, index: 0 }) }, { ...manifest, pages: [{ ...reference, index: -1 }] }, { ...manifest, pages: [{ ...reference, index: 1.5 }] }])) assert.throws(() => validateManifestPage(value), /manifest|index/);
    const encodedObject = encodeFactoryPageBase64(new TextEncoder().encode("{}"));
    assert.doesNotThrow(() => validateLoadedDefinitionPage({ index: 0, objectId: "object", digest, contentBase64: encodedObject }, { ...reference, index: 0 }));
    assert.throws(() => validateLoadedDefinitionPage(malformed<FactoryDefinitionPage>(null), { ...reference, index: 0 }), /loaded/);
    assert.throws(() => validateLoadedDefinitionPage({ index: 1, objectId: "object", digest, contentBase64: encodedObject }, { ...reference, index: 0 }), /identity/);
    assert.throws(() => validateLoadedDefinitionPage({ index: 0, objectId: "object", digest, contentBase64: encodeFactoryPageBase64(new TextEncoder().encode("x")) }, { ...reference, index: 0 }), /byte count/);
  });
  it("validates bounded partition sources and their continuation identity", () => {
    const partition = {
      definitionDigest: digest,
      executionManifest: reference,
      partition: { ...reference, objectId: "partition", partitionId: "partition-0" },
    };
    assert.equal(isPartitionSource(definition), false);
    assert.equal(isPartitionSource(partition), true);
    assert.doesNotThrow(() => validatePartitionSource(partition));
    assert.doesNotThrow(() => validateWorkflowInput({ ...valid, definition: partition }));
    assert.doesNotThrow(() => validateWorkflowInput({ ...valid, definition: partition, continuation: malformed<FactoryWorkflowInput["continuation"]>({ state: { definitionDigest: digest, partition: { id: "partition-0" } }, acknowledgedInboxSequence: 0 }) }));
    assert.throws(() => validatePartitionSource(malformed<FactoryPartitionSource>(null)), /partition source/);
    assert.throws(() => validatePartitionSource({ ...partition, definitionDigest: "bad" }), /digest/);
    assert.throws(() => validatePartitionSource({ ...partition, executionManifest: malformed<ImmutableObjectReference>(null) }), /execution manifest/);
    assert.throws(() => validatePartitionSource({ ...partition, partition: { ...partition.partition, partitionId: "" } }), /partition ID/);
    assert.throws(() => validateWorkflowInput({ ...valid, definition: partition, continuation: malformed<FactoryWorkflowInput["continuation"]>({ state: { definitionDigest: digest }, acknowledgedInboxSequence: 0 }) }), /partition ID/);
  });
  it("validates compiled partitions, command batches, and sequenced inbox envelopes", () => {
    const factory = compiledFactory();
    const [firstPartition] = factory.partitions;
    assert.ok(firstPartition);
    assert.doesNotThrow(() => validateCompiledFactoryShape(factory));
    assert.throws(() => validateCompiledFactoryShape({ ...factory, partitions: malformed<CompiledFactory["partitions"]>(null) }), /COMPILED_SCHEMA/);
    assert.throws(() => validateCompiledFactoryShape({ ...factory, partitions: [{ ...firstPartition, nodeIds: Array(129).fill("work") }] }), /COMPILED_SCHEMA|COMPILED_PARTITION/);
    assert.doesNotThrow(() => assertActivityPayloadSize({}, "test"));
    assert.doesNotThrow(() => assertCommandBatchSize([]));
    assert.throws(() => assertCommandBatchSize(["x".repeat(513 * 1024)]), /524288 bytes/);
    const envelope = { sequence: 1, eventId: "event", eventHash: digest, event: { id: "event", atMs: 1, kind: "cancel", reason: "test" } };
    assert.doesNotThrow(() => validateInboxEnvelope(envelope));
    for (const value of [null, { ...envelope, sequence: 0 }, { ...envelope, sequence: 1.5 }, { ...envelope, eventId: "" }, { ...envelope, eventHash: "bad" }, { ...envelope, eventId: "other" }, { ...envelope, event: { ...envelope.event, reason: "x".repeat(70_000) } }]) assert.throws(() => validateInboxEnvelope(value));
  });
  it("requires stable, recorded inbox events", () => {
    assert.doesNotThrow(() => validateInboxEvent({ id: "event", atMs: 1, kind: "cancel", reason: "test" }));
    // W09e: a release stop names its external effect from one enum.
    for (const effect of ["uncertain", "published"]) assert.doesNotThrow(() => validateInboxEvent({ id: "stop", atMs: 1, kind: "attempt-stopped", effect }));
    for (const effect of ["maybe", 1, null]) assert.throws(() => validateInboxEvent({ id: "stop", atMs: 1, kind: "attempt-stopped", effect }), /effect must be uncertain or published/);
    // W09h: a stop before compute admission is named by one value.
    assert.doesNotThrow(() => validateInboxEvent({ id: "stop", atMs: 1, kind: "attempt-stopped", stoppedBefore: "admission" }));
    for (const stoppedBefore of ["dispatch", 1, null]) assert.throws(() => validateInboxEvent({ id: "stop", atMs: 1, kind: "attempt-stopped", stoppedBefore }), /stoppedBefore must be admission/);
    for (const value of [null, [], 1]) assert.throws(() => validateInboxEvent(value), /object/);
    for (const id of [undefined, "", "x".repeat(513)]) assert.throws(() => validateInboxEvent(malformed<JsonValue>({ id, atMs: 1, kind: "cancel" })), /stable ID/);
    for (const atMs of [undefined, -1, 1.5]) assert.throws(() => validateInboxEvent(malformed<JsonValue>({ id: "event", atMs, kind: "cancel" })), /timestamp/);
    assert.throws(() => validateInboxEvent({ id: "event", atMs: 1 }), /kind/);
    assert.doesNotThrow(() => validateInboxEvent({ id: "repair", atMs: 1, kind: "repair", nodeId: "task", reason: "retry", inputOverride: { instruction: "fixed" } }));
    assert.doesNotThrow(() => validateInboxEvent({ id: "replan", atMs: 1, kind: "replan", nodeId: "child", replacement: { id: "factory", version: "2", digest } }));
    assert.throws(() => validateInboxEvent({ id: "repair", atMs: 1, kind: "repair", nodeId: "", inputOverride: {} }), /node ID/);
    assert.throws(() => validateInboxEvent({ id: "repair", atMs: 1, kind: "repair", nodeId: "task", replacement: { id: "factory", version: "2", digest } }), /unknown fields/);
    assert.throws(() => validateInboxEvent({ id: "replan", atMs: 1, kind: "replan", nodeId: "child", replacement: { id: "factory", version: "latest", digest } }), /must be exact/);
    assert.throws(() => validateInboxEvent({ id: "replan", atMs: 1, kind: "replan", nodeId: "child", replacement: { id: "factory", version: "2", digest, extra: true } }), /unknown fields/);
  });
  it("rejects continuation snapshots larger than 64 KiB", () => {
    assert.doesNotThrow(() => assertContinuationSize(malformed<FactoryContinuation>({ state: {}, inbox: [], pendingInbox: [], sourceSequence: 1, handledSinceContinuation: 0, acknowledgedInboxSequence: 0 })));
    assert.throws(() => assertContinuationSize(malformed<FactoryContinuation>({ state: { value: "x".repeat(70_000) }, inbox: [], pendingInbox: [], sourceSequence: 1, handledSinceContinuation: 0, acknowledgedInboxSequence: 0 })), /65536 bytes/);
  });
});
