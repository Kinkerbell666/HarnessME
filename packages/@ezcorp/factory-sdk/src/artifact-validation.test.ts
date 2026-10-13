import { describe, expect, test } from "bun:test";
import { canonicalizeJson } from "./canonical";
import { compileFactory, createCompiledExecutionManifest, createCompiledPartitionArtifact, factoryRunnerRequestDigest, factoryRunnerRequestIdentity, verifyCompiledFactoryArtifact, type CompiledFactoryPageBytes } from "./compiler";
import { referenceDataV1, referenceFactories } from "./references";
import type {
  CompiledFactory,
  FactoryRunnerRequest,
  FactoryRunnerResult,
  JsonValue,
} from "./types";
import {
  validateCompiledFactory,
  validateCompiledExecutionManifest,
  validateCompiledPartitionArtifact,
  validateFactoryRunnerRequest,
  validateFactoryRunnerResult,
} from "./validation";
import type { Mutable } from "../tests/mutable";

const prefixedDigest = `sha256:${"a".repeat(64)}`;
const rawDigest = "b".repeat(64);

function compiled(): CompiledFactory {
  const result = compileFactory(referenceDataV1);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.factory;
}

function clone<T>(value: T): Mutable<T> {
  return JSON.parse(canonicalizeJson(value as JsonValue)) as Mutable<T>;
}

function pageNode(factory: CompiledFactory, id: string): CompiledFactory["indexes"]["nodeById"][string] {
  const node = factory.indexes.nodeById[id];
  if (!node) throw new Error(`page names unknown node ${id}`);
  return node;
}

function pages(factory: CompiledFactory): CompiledFactoryPageBytes {
  return Object.fromEntries(factory.pages.map((page) => [
    page.id,
    new TextEncoder().encode(canonicalizeJson(page.nodeIds.map((id) => pageNode(factory, id)) as unknown as JsonValue)),
  ]));
}

function twoPartitionFactory(): CompiledFactory {
  const definition = clone(referenceDataV1);
  const template = definition.graph.nodes[0]!;
  definition.graph.nodes = Array.from({ length: 129 }, (_, index) => ({ ...template, id: `page-node-${index.toString().padStart(3, "0")}`, dependsOn: index === 128 ? ["page-node-000", "page-node-001"] : [] }));
  definition.outputPorts = { snapshot: template.outputPorts!.snapshot! };
  definition.graph.outputs = { snapshot: { kind: "ref", root: "node", name: "page-node-000", path: ["snapshot"] } };
  const result = compileFactory(definition);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.factory;
}

function controlFactory(): CompiledFactory {
  const definition = referenceDataV1;
  const predecessor = definition.graph.nodes[0]!.id;
  const result = compileFactory({
    ...definition,
    graph: {
      ...definition.graph,
      nodes: [
        ...definition.graph.nodes,
        { id: "structural-branch", kind: "branch", condition: { kind: "literal", value: true }, then: { nodes: [], outputs: {} }, else: { nodes: [], outputs: {} } },
        { id: "structural-join", kind: "join", mode: "all", predecessors: [predecessor] },
      ],
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.factory;
}

function code(result: ReturnType<typeof validateCompiledFactory>): string | undefined {
  return result.ok ? undefined : result.issues[0]?.code;
}

/** The literal's own type, so a test can edit any field it sets. */
function request() {
  return {
    schemaVersion: "factory.runner.request.v1",
    authority: {
      attemptId: "attempt-1",
      tenantId: "tenant-1",
      projectId: "project-1",
      runId: "run-1",
      nodeInstanceId: "node-1",
      candidateGeneration: 0,
      attemptNumber: 1,
      grantRevision: 2,
      reservationGeneration: 3,
      executionEpoch: 4,
      cancellationEpoch: 0,
      deadlineAtMs: 2_000_000_000_000,
      nextOperationIndex: 0,
    },
    runner: {
      package: "@example/runner",
      manifestName: "runner",
      version: "1.2.3",
      digest: prefixedDigest,
      export: "run",
      model: "model-v1",
      configurationDigest: prefixedDigest,
    },
    input: { kind: "inline", value: JSON.parse('{"__proto__":{"safe":true},"constructor":"value","toString":"value"}') as JsonValue },
    grants: ["model:invoke", "tool:read"],
    resources: { maxCostMicros: "1000", maxTokens: 200, maxComputeMs: 30_000, memoryBytes: 1_024, resourceClass: "cpu.small" },
    model: { provider: "anthropic", model: "model-v1", configurationDigest: prefixedDigest, configuration: { temperature: 0 }, policyDigest: prefixedDigest, policy: { retries: 1 } },
    tools: [{ name: "read", description: "Read a value", inputSchema: { type: "object", additionalProperties: false }, outputSchema: { type: "string" } }],
    broker: { attemptToken: "signed-attempt-token", audience: "installation-1" },
  } satisfies FactoryRunnerRequest;
}

function result() {
  const checkpoint = { artifactId: "checkpoint-1", digest: prefixedDigest, encodedBytes: 512, journalCursor: 5 };
  const usage = { kind: "measured" as const, inputTokens: 10, outputTokens: 20, computeMs: 30, costMicros: "40" };
  return {
    schemaVersion: "factory.runner.result.v1",
    status: "completed",
    journalCursor: 5,
    operations: [{ operationId: "run-1:node-1:0:5", operationIndex: 5, kind: "model", requestDigest: rawDigest, state: "completed", resultDigest: rawDigest, usage, workspaceCheckpoint: checkpoint }],
    resultDigest: rawDigest,
    output: { artifactId: "result-1", digest: prefixedDigest, encodedBytes: 256 },
    usage,
    workspaceCheckpoint: checkpoint,
  } satisfies FactoryRunnerResult;
}

describe("compiled artifact validation", () => {
  test("accepts canonical manifests and safe own-property identifiers", () => {
    for (const definition of referenceFactories) {
      const result = compileFactory(definition);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(validateCompiledFactory(result.factory)).toEqual({ ok: true });
      expect(verifyCompiledFactoryArtifact(result.factory, pages(result.factory))).toEqual({ ok: true });
    }
    expect(validateCompiledFactory(controlFactory())).toEqual({ ok: true });

    const hostileDefinition = JSON.parse(canonicalizeJson(referenceDataV1 as unknown as JsonValue).replaceAll("input-snapshot", "__proto__"));
    const hostile = compileFactory(hostileDefinition);
    if (!hostile.ok) throw new Error(JSON.stringify(hostile.diagnostics));
    expect(Object.hasOwn(hostile.factory.indexes.nodeById, "__proto__")).toBe(true);
    expect(validateCompiledFactory(hostile.factory)).toEqual({ ok: true });

    const factory = compiled();
    const manifest = createCompiledExecutionManifest(factory);
    expect(validateCompiledExecutionManifest(manifest, factory.digest, factory.executionManifest)).toEqual({ ok: true });
    const artifact = createCompiledPartitionArtifact(factory, factory.partitions[0]!.id);
    expect(validateCompiledPartitionArtifact(artifact, factory.digest, factory.partitions[0])).toEqual({ ok: true });
  });

  test("rejects standalone execution and partition payload tampering", () => {
    const factory = compiled();
    expect(code(validateCompiledExecutionManifest({}))).toBe("EXECUTION_MANIFEST_SCHEMA");
    const manifestBytes = clone(createCompiledExecutionManifest(factory));
    manifestBytes.inputPorts = { huge: { type: "string", description: "x".repeat(33 * 1024) } };
    expect(code(validateCompiledExecutionManifest(manifestBytes))).toBe("EXECUTION_MANIFEST_BYTES");
    const manifestDigest = clone(createCompiledExecutionManifest(factory));
    manifestDigest.factoryDigest = prefixedDigest;
    expect(code(validateCompiledExecutionManifest(manifestDigest, factory.digest))).toBe("EXECUTION_MANIFEST_DIGEST");
    const manifestSchema = clone(createCompiledExecutionManifest(factory));
    manifestSchema.inputPorts.csv = { type: "string", minLength: 2, maxLength: 1 };
    expect(code(validateCompiledExecutionManifest(manifestSchema))).toBe("COMPILED_PORT_SCHEMA");
    const manifestBound = clone(createCompiledExecutionManifest(factory));
    manifestBound.bounds.maxScopeDepth = 0;
    expect(code(validateCompiledExecutionManifest(manifestBound))).toBe("EXECUTION_MANIFEST_BOUND");

    expect(code(validateCompiledPartitionArtifact({}))).toBe("PARTITION_ARTIFACT_SCHEMA");
    const partition = factory.partitions[0]!;
    const artifactBytes = createCompiledPartitionArtifact(factory, partition.id);
    expect(code(validateCompiledPartitionArtifact(artifactBytes, factory.digest, { ...partition, encodedBytes: partition.encodedBytes + 1 }))).toBe("PARTITION_ARTIFACT_BYTES");
    const artifactDigest = clone(artifactBytes);
    artifactDigest.factoryDigest = prefixedDigest;
    expect(code(validateCompiledPartitionArtifact(artifactDigest, factory.digest))).toBe("PARTITION_ARTIFACT_DIGEST");
    const artifactManifest = clone(artifactBytes);
    artifactManifest.dependsOn = ["same", "same"];
    expect(code(validateCompiledPartitionArtifact(artifactManifest))).toBe("PARTITION_ARTIFACT_MANIFEST");
    const artifactNode = clone(artifactBytes);
    artifactNode.nodes[0]!.id = "changed";
    expect(code(validateCompiledPartitionArtifact(artifactNode))).toBe("PARTITION_ARTIFACT_NODE");
    const partitioned = twoPartitionFactory();
    const artifactEdge = clone(createCompiledPartitionArtifact(partitioned, partitioned.partitions.at(-1)!.id));
    artifactEdge.inbound.reverse();
    expect(code(validateCompiledPartitionArtifact(artifactEdge))).toBe("PARTITION_ARTIFACT_EDGES");
    const artifactMismatch = clone(artifactBytes);
    artifactMismatch.id = "partition-other";
    const mismatchedDescriptor = { ...partition, encodedBytes: new TextEncoder().encode(canonicalizeJson(artifactMismatch as unknown as JsonValue)).byteLength };
    expect(code(validateCompiledPartitionArtifact(artifactMismatch, factory.digest, mismatchedDescriptor))).toBe("PARTITION_ARTIFACT_MANIFEST");
    expect(() => createCompiledPartitionArtifact(factory, "absent")).toThrow("Unknown compiled partition");
  });

  test("rejects schema, digest, presentation, lock, and index tampering", () => {
    expect(code(validateCompiledFactory({}))).toBe("COMPILED_SCHEMA");
    const factory = clone(compiled());
    factory.digest = "sha256:BAD";
    expect(code(validateCompiledFactory(factory))).toBe("COMPILED_DIGEST");
    const presentation = clone(compiled());
    presentation.presentationDigest = prefixedDigest;
    expect(code(validateCompiledFactory(presentation))).toBe("COMPILED_PRESENTATION");
    const lock = clone(compiled());
    lock.lock.interpreter = "changed";
    expect(code(validateCompiledFactory(lock))).toBe("COMPILED_LOCK");
    const node = clone(compiled());
    const id = Object.keys(node.indexes.nodeById)[0]!;
    node.indexes.nodeById[id] = { ...node.indexes.nodeById[id]!, id: "changed" };
    expect(code(validateCompiledFactory(node))).toBe("COMPILED_NODE_INDEX");
    const keys = clone(compiled());
    delete keys.indexes.successors[Object.keys(keys.indexes.successors)[0]!];
    expect(code(validateCompiledFactory(keys))).toBe("COMPILED_INDEX_KEYS");
    const successor = clone(compiled());
    successor.indexes.successors[Object.keys(successor.indexes.successors)[0]!] = ["absent"];
    expect(code(validateCompiledFactory(successor))).toBe("COMPILED_SUCCESSORS");
    const selfConsistentEdge = clone(compiled());
    const edgeKeys = Object.keys(selfConsistentEdge.indexes.successors);
    const from = edgeKeys.at(-1);
    const to = edgeKeys[0];
    selfConsistentEdge.indexes.successors[from!] = [to!];
    selfConsistentEdge.indexes.dependencyCounts[to!] = 1;
    expect(code(validateCompiledFactory(selfConsistentEdge))).toBe("COMPILED_SUCCESSORS");
    const count = clone(compiled());
    count.indexes.dependencyCounts[Object.keys(count.indexes.dependencyCounts)[0]!] = 9;
    expect(code(validateCompiledFactory(count))).toBe("COMPILED_DEPENDENCIES");
  });

  test("rejects partition and page manifest tampering", () => {
    const invalidPartition = clone(compiled());
    invalidPartition.partitions[0]!.id = "other";
    expect(code(validateCompiledFactory(invalidPartition))).toBe("COMPILED_PARTITION");
    const dependency = clone(compiled());
    dependency.partitions[0]!.dependsOn = [dependency.partitions.at(-1)!.id];
    expect(code(validateCompiledFactory(dependency))).toBe("COMPILED_PARTITION_DEPENDENCIES");
    const partitioned = twoPartitionFactory();
    const sourcePartition = partitioned.partitions.find((partition) => partition.nodeIds.includes("page-node-000"))!;
    const targetPartition = partitioned.partitions.find((partition) => partition.nodeIds.includes("page-node-128"))!;
    expect(sourcePartition.outbound).toEqual([
      { nodeId: "page-node-000", toNodeId: "page-node-128", toPartitionId: targetPartition.id },
      { nodeId: "page-node-001", toNodeId: "page-node-128", toPartitionId: targetPartition.id },
    ]);
    expect(targetPartition.inbound).toEqual([
      { nodeId: "page-node-128", fromNodeId: "page-node-000", fromPartitionId: sourcePartition.id },
      { nodeId: "page-node-128", fromNodeId: "page-node-001", fromPartitionId: sourcePartition.id },
    ]);
    const exactDependency = clone(partitioned);
    exactDependency.partitions.find((partition) => partition.id === targetPartition.id)!.dependsOn = [];
    expect(code(validateCompiledFactory(exactDependency))).toBe("COMPILED_PARTITION_DEPENDENCIES");
    const exactEdges = clone(partitioned);
    exactEdges.partitions.find((partition) => partition.id === targetPartition.id)!.inbound[0]!.fromNodeId = "page-node-002";
    expect(code(validateCompiledFactory(exactEdges))).toBe("COMPILED_PARTITION_EDGES");
    const duplicateNode = clone(compiled());
    duplicateNode.partitions[0]!.nodeIds.push(duplicateNode.partitions[0]!.nodeIds[0]!);
    expect(code(validateCompiledFactory(duplicateNode))).toBe("COMPILED_PARTITION_NODE");
    const page = clone(compiled());
    page.pages[0]!.digest = "sha256:BAD";
    expect(code(validateCompiledFactory(page))).toBe("COMPILED_PAGE");
    const pageNode = clone(twoPartitionFactory());
    pageNode.pages.at(-1)!.nodeIds[0] = pageNode.partitions[0]!.nodeIds[0]!;
    expect(code(validateCompiledFactory(pageNode))).toBe("COMPILED_PAGE_NODE");
    const coverage = clone(compiled());
    coverage.pages[0]!.nodeIds.pop();
    expect(code(validateCompiledFactory(coverage))).toBe("COMPILED_PAGE_COVERAGE");
  });

  test("rejects semantic port, control, depth, expansion, and complete-IR bounds", () => {
    const port = clone(compiled());
    port.definition.inputPorts.csv = { type: "string", minLength: 2, maxLength: 1 };
    expect(code(validateCompiledFactory(port))).toBe("COMPILED_PORT_SCHEMA");
    const map = clone(compiled());
    const mapNode = map.definition.graph.nodes.find((node) => node.kind === "map")!;
    mapNode.maxConcurrency = 33;
    map.indexes.nodeById[mapNode.id] = mapNode;
    expect(code(validateCompiledFactory(map))).toBe("COMPILED_MAP");
    const depth = clone(compiled());
    depth.definition.bounds.maxScopeDepth = 1;
    expect(code(validateCompiledFactory(depth))).toBe("COMPILED_SCOPE_DEPTH");
    const expansion = clone(compiled());
    expansion.definition.bounds.maxExpandedNodes = expansion.definition.graph.nodes.length;
    expect(code(validateCompiledFactory(expansion))).toBe("COMPILED_NODES");
    const huge = clone(compiled());
    huge.definition.presentation = { huge: "x".repeat(16 * 1024 * 1024) };
    huge.presentationDigest = prefixedDigest;
    expect(code(validateCompiledFactory(huge))).toBe("COMPILED_BYTES");
  });

  test("recompiles the definition and verifies every fetched page byte", () => {
    const factory = compiled();
    const bytes = pages(factory);
    const nonCanonical = clone(factory);
    nonCanonical.digest = prefixedDigest;
    expect(code(verifyCompiledFactoryArtifact(nonCanonical, pages(nonCanonical)))).toBe("COMPILED_CANONICAL");
    const invalidDefinition = clone(factory);
    invalidDefinition.definition.acceptance.version = "latest";
    expect(code(verifyCompiledFactoryArtifact(invalidDefinition, pages(invalidDefinition)))).toBe("COMPILED_RECOMPILE");
    expect(code(verifyCompiledFactoryArtifact(factory, { ...bytes, extra: new Uint8Array() }))).toBe("COMPILED_PAGE_BYTES");
    const firstPage = factory.pages[0]!.id;
    const corrupted = { ...bytes, [firstPage]: bytes[firstPage]!.map((byte, index) => index === 0 ? byte ^ 1 : byte) };
    expect(code(verifyCompiledFactoryArtifact(factory, corrupted))).toBe("COMPILED_PAGE_BYTES");
  });
});

describe("runner request canonical identity", () => {
  test("excludes only the attempt token and hashes every durable request field", () => {
    const original = request();
    const identity = factoryRunnerRequestIdentity(original);
    expect(Object.hasOwn(identity.broker, "attemptToken")).toBe(false);
    expect(identity.broker).toEqual({ audience: original.broker.audience });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.authority)).toBe(true);
    const baseline = factoryRunnerRequestDigest(original);
    expect(baseline).toHaveLength(64);
    expect(factoryRunnerRequestDigest({ ...original, broker: { ...original.broker, attemptToken: "rotated-token" } })).toBe(baseline);

    const mutations: Array<(candidate: FactoryRunnerRequest) => void> = [
      (candidate) => { (candidate.authority as { attemptId: string }).attemptId = "attempt-2"; },
      (candidate) => { (candidate.runner as { export: string }).export = "resume"; },
      (candidate) => { (candidate.input as { value: JsonValue }).value = { changed: true }; },
      (candidate) => { (candidate.grants as string[]).push("tool:write"); },
      (candidate) => { (candidate.resources as { maxTokens: number }).maxTokens = 201; },
      (candidate) => { (candidate.model!.configuration as Record<string, JsonValue>).temperature = 1; },
      (candidate) => { (candidate.model!.policy as Record<string, JsonValue>).retries = 2; },
      (candidate) => { (candidate.tools[0] as { description: string }).description = "Read another value"; },
      (candidate) => { (candidate.broker as { audience: string }).audience = "installation-2"; },
      (candidate) => {
        (candidate as { checkpoint?: unknown }).checkpoint = { artifactId: "checkpoint-1", digest: prefixedDigest, encodedBytes: 1, journalCursor: 0 };
        (candidate.authority as { nextOperationIndex: number }).nextOperationIndex = 1;
      },
    ];
    for (const mutate of mutations) {
      const candidate = clone(original);
      mutate(candidate);
      expect(factoryRunnerRequestDigest(candidate)).not.toBe(baseline);
    }
    const reordered = clone(original);
    (reordered.model as { configuration: Record<string, JsonValue> }).configuration = { z: 1, a: 2 };
    const ordered = clone(reordered);
    (ordered.model as { configuration: Record<string, JsonValue> }).configuration = { a: 2, z: 1 };
    expect(factoryRunnerRequestDigest(reordered)).toBe(factoryRunnerRequestDigest(ordered));
    expect(() => factoryRunnerRequestIdentity({ ...original, broker: { ...original.broker, attemptToken: "" } })).toThrow("Broker authority");
  });
});

describe("C02 generated runner wire validation", () => {
  test("accepts canonical requests, artifact resumes, and every terminal result shape", () => {
    expect(validateFactoryRunnerRequest(request())).toEqual({ ok: true });
    const resumed: Mutable<FactoryRunnerRequest> = clone(request());
    resumed.input = { kind: "artifact", artifact: { artifactId: "input-1", digest: prefixedDigest, encodedBytes: 4_096 } };
    resumed.checkpoint = { artifactId: "checkpoint-0", digest: prefixedDigest, encodedBytes: 100, journalCursor: -1 };
    expect(validateFactoryRunnerRequest(resumed)).toEqual({ ok: true });
    expect(validateFactoryRunnerResult(result())).toEqual({ ok: true });
    const failed: FactoryRunnerResult = { schemaVersion: "factory.runner.result.v1", status: "failed", journalCursor: 5, operations: [{ operationId: "run-1:node-1:0:5", operationIndex: 5, kind: "tool", requestDigest: rawDigest, state: "failed", resultDigest: rawDigest }], resultDigest: rawDigest, error: { code: "TOOL_FAILED", message: "failed", retryable: true }, usage: { kind: "unknown", reason: "receipt lost", heldCostMicros: "100" } };
    expect(validateFactoryRunnerResult(failed)).toEqual({ ok: true });
    expect(validateFactoryRunnerResult({ schemaVersion: "factory.runner.result.v1", status: "cancelled", journalCursor: -1, operations: [] })).toEqual({ ok: true });
    expect(validateFactoryRunnerResult({ schemaVersion: "factory.runner.result.v1", status: "uncertain", journalCursor: 4, operations: [], providerReceiptDigest: rawDigest, usage: { kind: "unknown", reason: "provider pending", heldCostMicros: "200" } })).toEqual({ ok: true });
  });

  test("rejects malformed, oversized, stale-shaped, unpinned, and path-like requests", () => {
    expect(code(validateFactoryRunnerRequest({}))).toBe("RUNNER_REQUEST_SCHEMA");
    const oversized = request();
    oversized.broker.attemptToken = "x".repeat(70_000);
    expect(code(validateFactoryRunnerRequest(oversized))).toBe("RUNNER_WIRE_BYTES");
    const authority = request();
    authority.authority.attemptNumber = -1;
    expect(code(validateFactoryRunnerRequest(authority))).toBe("RUNNER_AUTHORITY");
    const deadline = request();
    deadline.authority.deadlineAtMs = 0;
    expect(code(validateFactoryRunnerRequest(deadline))).toBe("RUNNER_DEADLINE");
    const pin = request();
    pin.runner.version = "latest";
    expect(code(validateFactoryRunnerRequest(pin))).toBe("RUNNER_PIN");
    const model = request();
    model.model.model = "different";
    expect(code(validateFactoryRunnerRequest(model))).toBe("RUNNER_MODEL_PIN");
    const grants = request();
    grants.grants = ["same", "same"];
    expect(code(validateFactoryRunnerRequest(grants))).toBe("RUNNER_GRANT");
    const resources = request();
    resources.resources.maxCostMicros = "01";
    expect(code(validateFactoryRunnerRequest(resources))).toBe("RUNNER_RESOURCES");
    const artifact: Mutable<FactoryRunnerRequest> = request();
    artifact.input = { kind: "artifact", artifact: { artifactId: "../local", digest: prefixedDigest, encodedBytes: 1 } };
    expect(code(validateFactoryRunnerRequest(artifact))).toBe("RUNNER_ARTIFACT_ID");
    const checkpoint: Mutable<FactoryRunnerRequest> = request();
    checkpoint.checkpoint = { artifactId: "checkpoint", digest: prefixedDigest, encodedBytes: 1, journalCursor: -2 };
    expect(code(validateFactoryRunnerRequest(checkpoint))).toBe("RUNNER_CURSOR");
    const operationCursor = request();
    operationCursor.authority.nextOperationIndex = 4;
    expect(code(validateFactoryRunnerRequest(operationCursor))).toBe("RUNNER_CURSOR");
    const tools = request();
    tools.tools = [tools.tools[0]!, tools.tools[0]!];
    expect(code(validateFactoryRunnerRequest(tools))).toBe("RUNNER_TOOL");
    const toolSchema: Mutable<FactoryRunnerRequest> = request();
    toolSchema.tools[0]!.inputSchema = { type: "object", properties: {}, required: ["missing"] };
    expect(code(validateFactoryRunnerRequest(toolSchema))).toBe("RUNNER_TOOL_SCHEMA");
  });

  test("rejects malformed result cursors, operation evidence, usage, checkpoints, and terminal evidence", () => {
    expect(code(validateFactoryRunnerResult({}))).toBe("RUNNER_RESULT_SCHEMA");
    const oversized = result();
    oversized.output.artifactId = "x".repeat(70_000);
    expect(code(validateFactoryRunnerResult(oversized))).toBe("RUNNER_WIRE_BYTES");
    const cursor = result();
    cursor.journalCursor = -2;
    expect(code(validateFactoryRunnerResult(cursor))).toBe("RUNNER_CURSOR");
    const order = result();
    order.operations = [order.operations[0]!, { ...order.operations[0]! }];
    expect(code(validateFactoryRunnerResult(order))).toBe("RUNNER_OPERATION_ORDER");
    const operation = result();
    operation.operations[0]!.requestDigest = "bad";
    expect(code(validateFactoryRunnerResult(operation))).toBe("RUNNER_OPERATION");
    const operationUsage = result();
    operationUsage.operations[0]!.usage.costMicros = "01";
    expect(code(validateFactoryRunnerResult(operationUsage))).toBe("RUNNER_USAGE");
    const operationCheckpoint = result();
    operationCheckpoint.operations[0]!.workspaceCheckpoint.artifactId = "../checkpoint";
    expect(code(validateFactoryRunnerResult(operationCheckpoint))).toBe("RUNNER_ARTIFACT_ID");
    const operationCursor = result();
    operationCursor.operations[0]!.operationIndex = 6;
    operationCursor.operations[0]!.operationId = "run-1:node-1:0:6";
    operationCursor.operations[0]!.workspaceCheckpoint.journalCursor = 6;
    expect(code(validateFactoryRunnerResult(operationCursor))).toBe("RUNNER_OPERATION_CURSOR");
    const uncertainCursor: Mutable<FactoryRunnerResult> = result();
    uncertainCursor.operations = [{ operationId: "run-1:node-1:0:5", operationIndex: 5, kind: "model", requestDigest: rawDigest, state: "uncertain", providerReceiptDigest: rawDigest, usage: { kind: "unknown", reason: "lost", heldCostMicros: "10" } }];
    expect(code(validateFactoryRunnerResult(uncertainCursor))).toBe("RUNNER_OPERATION_CURSOR");
    const usage = result();
    usage.usage.computeMs = -1;
    expect(code(validateFactoryRunnerResult(usage))).toBe("RUNNER_USAGE");
    const checkpoint = result();
    checkpoint.workspaceCheckpoint = { ...checkpoint.workspaceCheckpoint, journalCursor: 4 };
    expect(code(validateFactoryRunnerResult(checkpoint))).toBe("RUNNER_CURSOR");
    const completed = result();
    completed.resultDigest = "bad";
    expect(code(validateFactoryRunnerResult(completed))).toBe("RUNNER_DIGEST");
    const failed = { schemaVersion: "factory.runner.result.v1", status: "failed", journalCursor: -1, operations: [], resultDigest: rawDigest, error: { code: "", message: "failed", retryable: false } };
    expect(code(validateFactoryRunnerResult(failed))).toBe("RUNNER_FAILURE");
    const uncertain = { schemaVersion: "factory.runner.result.v1", status: "uncertain", journalCursor: -1, operations: [], providerReceiptDigest: "bad", usage: { kind: "unknown", reason: "lost", heldCostMicros: "10" } };
    expect(code(validateFactoryRunnerResult(uncertain))).toBe("RUNNER_UNCERTAIN");
  });
});
