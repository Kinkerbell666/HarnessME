import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { canonicalizeJson, compileFactory, createCompiledExecutionManifest, createCompiledPartitionArtifact } from "@ezcorp/factory-sdk";
import { loadPartitionKernelPlan } from "../src/partition-plan.ts";
import { asJson } from "./typing.ts";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const runnerDigest = digest("partition-runner");
const runner = { package: "inert", manifestName: "inert", version: "1", digest: runnerDigest, export: "run" };
const identity = { tenantId: "tenant", projectId: "project", logicalRunId: "run", interpreterId: "partition-0" };

function fixture() {
  const result = compileFactory({
    schemaVersion: "factory.v1",
    id: "partition-plan",
    version: "1",
    interpreterCompatibility: "1",
    inputPorts: {},
    outputPorts: {},
    graph: {
      nodes: [
        { id: "a", kind: "task", runner, deadlineMs: 600_000 },
        { id: "b", kind: "task", runner, deadlineMs: 600_000, dependsOn: ["a"] },
        { id: "joined", kind: "join", mode: "all", predecessors: ["b"] },
      ],
      outputs: {},
    },
    acceptance: { id: "acceptance", version: "1", claims: [{ id: "claim", validator: runner, required: true, protected: true }], groups: [] },
    packages: [{ name: runner.package, version: runner.version, digest: runner.digest }],
    factories: [],
    capabilities: [],
    effects: ["none"],
    bounds: { maxExpandedNodes: 100, maxScopeDepth: 16, runDeadlineMs: 600_000 },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("partition plan fixture did not compile");
  const factory = result.factory;
  const manifest = createCompiledExecutionManifest(factory);
  const artifact = createCompiledPartitionArtifact(factory, "partition-0");
  const partition = factory.partitions[0];
  assert.ok(partition);
  const manifestJson = canonicalizeJson(asJson(manifest));
  const source = {
    definitionDigest: factory.digest,
    executionManifest: { objectId: "manifest", digest: digest(manifestJson), encodedBytes: Buffer.byteLength(manifestJson) },
    partition: { objectId: "partition", partitionId: "partition-0", digest: partition.digest, encodedBytes: partition.encodedBytes },
  };
  const reader = {
    loadExecutionManifest: async () => structuredClone(manifest),
    loadPartitionArtifact: async () => structuredClone(artifact),
  };
  return { artifact, factory, manifest, reader, source };
}

describe("partition execution plan loading", () => {
  it("builds the bounded kernel view from two validated recorded activities", async () => {
    const value = fixture();
    const plan = await loadPartitionKernelPlan(identity, value.source, value.reader);
    assert.equal(plan.digest, value.factory.digest);
    assert.deepEqual(plan.definition.graph.nodes.map(({ id }) => id), ["a", "b", "joined"]);
    assert.deepEqual({ ...plan.indexes.successors }, { a: ["b"], b: ["joined"], joined: [] });
    assert.deepEqual(plan.partitions[0], value.factory.partitions[0]);
  });

  it("rejects digest, structure, and partition identity drift", async () => {
    const manifestDrift = fixture();
    manifestDrift.reader.loadExecutionManifest = async () => ({ ...manifestDrift.manifest, factoryDigest: digest("wrong") });
    await assert.rejects(loadPartitionKernelPlan(identity, manifestDrift.source, manifestDrift.reader), /execution manifest/);

    const artifactDrift = fixture();
    artifactDrift.reader.loadPartitionArtifact = async () => ({ ...artifactDrift.artifact, nodeIds: [] });
    await assert.rejects(loadPartitionKernelPlan(identity, artifactDrift.source, artifactDrift.reader), /partition artifact/);

    const identityDrift = fixture();
    identityDrift.reader.loadPartitionArtifact = async () => ({ ...identityDrift.artifact, id: "partition-other" });
    await assert.rejects(loadPartitionKernelPlan(identity, identityDrift.source, identityDrift.reader), /artifact ID/);
  });
});
