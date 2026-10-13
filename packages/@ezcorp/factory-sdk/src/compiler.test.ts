import { describe, expect, test } from "bun:test";
import { FactoryAuthoringError, defineFactory } from "./authoring";
import { canonicalizeJson } from "./canonical";
import { compileFactory } from "./compiler";
import { referenceCatalogV1, referenceCodeV1, referenceDataV1, referenceFactories, referenceImageV1 } from "./references";
import { factoryGraphNodes } from "./validation";
import { FACTORY_LIMITS } from "./types";
import type { FactoryDefinition, FactoryNode, FactoryReference, JsonValue } from "./types";
import { mutableClone, type Mutable } from "../tests/mutable";

function clone(definition: FactoryDefinition = referenceCodeV1): Mutable<FactoryDefinition> {
  return mutableClone(definition);
}

function codes(definition: unknown): string[] {
  const result = compileFactory(definition);
  return result.ok ? [] : result.diagnostics.map((entry) => entry.code);
}

/** One node kind, as editable as the clone it came from. */
type NodeOf<K extends FactoryNode["kind"]> = Extract<Mutable<FactoryNode>, { kind: K }>;

/** A node of a cloned definition is as editable as the clone. */
function node(definition: Mutable<FactoryDefinition>, id: string): Mutable<FactoryNode>;
function node(definition: FactoryDefinition, id: string): FactoryNode;
function node(definition: FactoryDefinition, id: string): FactoryNode {
  const found = factoryGraphNodes(definition.graph).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no node ${id} in ${definition.id}`);
  return found;
}

describe("factory compiler", () => {
  test("compiles exact C10 signatures deterministically into immutable pinned IR", () => {
    expect(referenceFactories.map((item) => item.id)).toEqual(["reference.code.v1", "reference.image.v1", "reference.data.v1", "reference.catalog.v1"]);
    for (const definition of [referenceCodeV1, referenceImageV1, referenceDataV1, referenceCatalogV1]) {
      const first = compileFactory(definition);
      const second = compileFactory(structuredClone(definition));
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) continue;
      expect(first.factory.digest).toBe(second.factory.digest);
      expect(first.factory.schemaVersion).toBe("factory.ir.v1");
      expect(first.factory.lock.packages).toEqual([...first.factory.lock.packages].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      expect(first.factory.pages.every((page) => page.encodedBytes <= 32 * 1024)).toBe(true);
      expect(first.factory.partitions.every((partition) => partition.nodeIds.length <= 128)).toBe(true);
      expect(first.factory.partitions.flatMap((partition) => partition.nodeIds)).toEqual(definition.graph.nodes.map((node) => node.id));
      expect(Object.isFrozen(first.factory)).toBe(true);
      expect(Object.isFrozen(first.factory.definition.graph.nodes)).toBe(true);
    }
    const imageRounds = node(referenceImageV1, "candidate-rounds") as NodeOf<"loop">;
    const imageMap = node(referenceImageV1, "generate-four-seeds") as NodeOf<"map">;
    const imageTask = node(referenceImageV1, "generate-seed") as NodeOf<"task">;
    expect(imageRounds.maxIterations).toBe(2);
    expect((imageMap.collection as { value: unknown }).value).toEqual([11, 23, 37, 53]);
    expect((imageTask.bindings!.inferenceSteps as { value: number }).value).toBe(30);
    expect((imageTask.bindings!.guidance as { value: number }).value).toBe(7.5);
    expect((imageTask.bindings!.width as { value: number }).value).toBe(1024);
    expect(referenceImageV1.acceptance.groups).toEqual([{ id: "semantic-quorum", claimIds: ["semantic-evaluation-1", "semantic-evaluation-2", "semantic-evaluation-3"], minimumPasses: 2, requireAllDecisive: true }]);
    expect(referenceCodeV1.acceptance.claims.map((claim) => claim.id)).toEqual(["frozen-install", "build", "typecheck", "declared-tests", "protected-fixtures", "dependency-advisory", "secret-scan", "allowed-paths", "protected-assets-unchanged", "supervised-review"]);
    expect((node(referenceDataV1, "parse-schema-validation") as NodeOf<"task">).bindings!.partitionRows).toEqual({ kind: "literal", value: 10_000 });
    for (const definition of referenceFactories) for (const taskNode of factoryGraphNodes(definition.graph).filter((candidate): candidate is Extract<FactoryNode, { kind: "task" }> => candidate.kind === "task")) expect(Object.keys(taskNode.bindings ?? {}).sort()).toEqual(Object.keys(taskNode.inputPorts ?? {}).sort());
  });

  test("materializes defaults and separates presentation digest", () => {
    const left = clone();
    const right = clone();
    left.presentation = { x: 1 };
    right.presentation = { x: 2 };
    const first = compileFactory(left);
    const second = compileFactory(right);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.factory.digest).toBe(second.factory.digest);
    expect(first.factory.presentationDigest).not.toBe(second.factory.presentationDigest);
    expect(first.factory.definition.bounds.runDeadlineMs).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(first.factory.definition.graph.nodes[0]?.deadlineMs).toBe(30 * 60 * 1_000);
  });

  test("bounds default and explicit node deadlines by the run deadline", () => {
    const defaulted = clone();
    defaulted.bounds.runDeadlineMs = 600_000;
    for (const claim of defaulted.acceptance.claims) (claim as { freshnessMs?: number }).freshnessMs = 600_000;
    const compiled = compileFactory(defaulted);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.factory.definition.graph.nodes.every((item) => item.deadlineMs === 600_000)).toBe(true);

    const explicit = clone();
    explicit.bounds.runDeadlineMs = 600_000;
    for (const claim of explicit.acceptance.claims) (claim as { freshnessMs?: number }).freshnessMs = 600_000;
    (node(explicit, "snapshot-repository") as { deadlineMs?: number }).deadlineMs = 600_001;
    expect(codes(explicit)).toContain("BOUND_NODE_DEADLINE");
  });

  test("uses safe own-property indexes for hostile identifiers", () => {
    const definition = clone(referenceDataV1);
    const first = definition.graph.nodes[0] as { id: string };
    const oldId = first.id;
    first.id = "__proto__";
    for (const candidate of definition.graph.nodes) if (candidate.dependsOn?.includes(oldId)) (candidate as { dependsOn: string[] }).dependsOn = candidate.dependsOn.map((id) => id === oldId ? "__proto__" : id);
    ((node(definition, "parse-schema-validation") as NodeOf<"task">).bindings!.snapshot as { name: string }).name = "__proto__";
    ((node(definition, "protected-reconciliation") as NodeOf<"task">).bindings!.snapshot as { name: string }).name = "__proto__";
    const result = compileFactory(definition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.getPrototypeOf(result.factory.indexes.nodeById)).toBeNull();
    expect(Object.hasOwn(result.factory.indexes.nodeById, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("rejects invalid root bounds and immutable pins", () => {
    expect(codes(undefined)).toEqual(["FACTORY_SCHEMA"]);
    for (const [field, value, code] of [
      ["maxExpandedNodes", 0, "BOUND_EXPANDED_NODES"],
      ["maxScopeDepth", 17, "BOUND_SCOPE_DEPTH"],
      ["runDeadlineMs", 31 * 24 * 60 * 60 * 1_000, "BOUND_RUN_DEADLINE"],
    ] as const) {
      const definition = clone();
      definition.bounds[field] = value;
      expect(codes(definition)).toContain(code);
    }
    const moving = clone();
    (moving.packages[0] as { version: string }).version = "latest";
    expect(codes(moving)).toContain("REFERENCE_VERSION");
    const badDigest = clone();
    (badDigest.packages[0] as { digest: string }).digest = "sha256:BAD";
    expect(codes(badDigest)).toContain("REFERENCE_DIGEST");
    const duplicate = clone();
    duplicate.packages.push(mutableClone(duplicate.packages[0]!));
    expect(codes(duplicate)).toContain("REFERENCE_DUPLICATE");

    const identity = clone();
    (identity as { id: string; version: string; interpreterCompatibility: string }).id = "";
    (identity as { version: string }).version = "latest";
    (identity as { interpreterCompatibility: string }).interpreterCompatibility = "";
    expect(codes(identity)).toContain("FACTORY_IDENTITY");
  });

  test("rejects graph cycles, missing dependencies, duplicate IDs, and bad outputs", () => {
    const cycle = clone();
    (cycle.graph.nodes[0] as { dependsOn?: string[] }).dependsOn = [cycle.graph.nodes[1]!.id];
    expect(codes(cycle)).toContain("GRAPH_CYCLE");
    const missing = clone();
    (missing.graph.nodes[0] as { dependsOn?: string[] }).dependsOn = ["missing"];
    expect(codes(missing)).toContain("GRAPH_MISSING_NODE");
    const duplicate = clone();
    (duplicate.graph.nodes[1] as { id: string }).id = duplicate.graph.nodes[0]!.id;
    expect(codes(duplicate)).toContain("GRAPH_DUPLICATE_NODE");
    const ambiguous = clone();
    (ambiguous.graph.nodes[0] as { id: string }).id = "scope/node";
    expect(codes(ambiguous)).toContain("GRAPH_NODE_ID");
    const noOutput = clone();
    delete (noOutput.graph.outputs as Record<string, unknown>).receipt;
    expect(codes(noOutput)).toContain("GRAPH_OUTPUT_MISSING");
    const unknownOutput = clone();
    (unknownOutput.graph.outputs as Record<string, unknown>).other = { kind: "literal", value: true };
    expect(codes(unknownOutput)).toContain("GRAPH_OUTPUT_UNKNOWN");
    const incompatible = clone();
    (incompatible.outputPorts as Record<string, unknown>).receipt = { type: "string" };
    expect(codes(incompatible)).toContain("GRAPH_OUTPUT_INCOMPATIBLE");
  });

  test("rejects bindings that are missing, unknown, unreachable, or incompatible", () => {
    const definition = clone();
    const target = node(definition, "freeze-complete-git-tree") as { inputPorts: Record<string, unknown>; bindings: Record<string, unknown>; dependsOn: string[] };
    target.inputPorts = { candidate: { type: "string" } };
    target.bindings = { candidate: { kind: "ref", root: "node", name: "snapshot-repository", path: ["snapshot"] }, extra: { kind: "literal", value: true } };
    expect(codes(definition)).toEqual(expect.arrayContaining(["BINDING_INCOMPATIBLE", "BINDING_UNKNOWN"]));
    expect(codes(definition)).not.toContain("BINDING_REACHABILITY");
    target.bindings.candidate = { kind: "ref", root: "node", name: "protected-checks", path: ["evidence"] };
    expect(codes(definition)).toContain("BINDING_REACHABILITY");
    const absent = clone();
    (node(absent, "freeze-complete-git-tree") as { inputPorts: Record<string, unknown> }).inputPorts = { candidate: { type: "string" } };
    (node(absent, "freeze-complete-git-tree") as { bindings: Record<string, unknown> }).bindings = {};
    expect(codes(absent)).toContain("BINDING_MISSING");
    const missingInput = clone();
    (node(missingInput, "freeze-complete-git-tree") as { inputPorts: Record<string, unknown>; bindings: Record<string, unknown> }).inputPorts = { candidate: { type: "string" } };
    (node(missingInput, "freeze-complete-git-tree") as { bindings: Record<string, unknown> }).bindings = { candidate: { kind: "ref", root: "input", name: "missing" } };
    expect(codes(missingInput)).toContain("BINDING_INPUT");
  });

  test("allows repair only for explicitly opted-in literal input ports", () => {
    const valid = clone(referenceDataV1);
    (node(valid, "parse-schema-validation") as NodeOf<"task">).repairableInputs = ["partitionRows"];
    expect(codes(valid)).toEqual([]);

    for (const repairableInputs of [["partitionRows", "partitionRows"], ["missing"], ["snapshot"]]) {
      const invalid = clone(referenceDataV1);
      (node(invalid, "parse-schema-validation") as NodeOf<"task">).repairableInputs = repairableInputs;
      expect(codes(invalid)).toContain("REPAIR_INPUT");
    }

    const protectedNode = clone();
    (node(protectedNode, "release-approval") as unknown as { repairableInputs: string[] }).repairableInputs = ["decision"];
    expect(codes(protectedNode)).toContain("FACTORY_SCHEMA");
  });

  test("rejects authority widening and unsafe control bounds", () => {
    const capability = clone();
    (node(capability, "snapshot-repository") as { capabilities: string[] }).capabilities = ["admin"];
    expect(codes(capability)).toContain("AUTHORITY_CAPABILITY");
    const effect = clone();
    effect.effects = ["read"];
    expect(codes(effect)).toContain("AUTHORITY_EFFECT");
    const cost = clone();
    (node(cost, "snapshot-repository") as { resources: unknown }).resources = { maxCostMicros: "01" };
    expect(codes(cost)).toContain("BOUND_COST");
    const deadline = clone();
    (node(deadline, "snapshot-repository") as { deadlineMs: number }).deadlineMs = 0;
    expect(codes(deadline)).toContain("BOUND_NODE_DEADLINE");
    const retry = clone();
    (node(retry, "snapshot-repository") as { retry: unknown }).retry = { maxAttempts: 0, initialDelayMs: 2, maximumDelayMs: 1 };
    expect(codes(retry)).toContain("BOUND_RETRY");
    const loop = clone(referenceImageV1);
    (node(loop, "candidate-rounds") as { maxIterations: number; budget: unknown }).maxIterations = 0;
    (node(loop, "candidate-rounds") as { budget: unknown }).budget = { maxCostMicros: "-1" };
    expect(codes(loop)).toEqual(expect.arrayContaining(["BOUND_LOOP", "BOUND_COST"]));
    const map = clone(referenceImageV1);
    (node(map, "generate-four-seeds") as { maxConcurrency: number }).maxConcurrency = FACTORY_LIMITS.maxConcurrentActivities + 1;
    expect(codes(map)).toContain("BOUND_MAP");

    const resources = clone();
    (node(resources, "snapshot-repository") as { resources: unknown }).resources = { maxTokens: -1, maxComputeMs: 1.5, memoryBytes: -1, resourceClass: "" };
    expect(codes(resources)).toEqual(expect.arrayContaining(["BOUND_RESOURCE"]));

    const loopBudget = clone(referenceImageV1);
    (node(loopBudget, "candidate-rounds") as { budget: unknown }).budget = { maxTokens: -1 };
    expect(codes(loopBudget)).toContain("BOUND_RESOURCE");

    const unsupportedRetry = clone(referenceImageV1);
    (node(unsupportedRetry, "candidate-rounds") as { retry: unknown }).retry = { maxAttempts: 1, initialDelayMs: 0, maximumDelayMs: 0 };
    expect(codes(unsupportedRetry)).toContain("RETRY_UNSUPPORTED");
  });

  test("rejects malformed joins, approvals, release authority, and expressions", () => {
    const approval = clone();
    (node(approval, "release-approval") as { choices: string[] }).choices = [];
    expect(codes(approval)).toContain("BOUND_APPROVAL");
    const release = clone();
    (node(release, "github-pr-release") as { dependsOn: string[] }).dependsOn = ["release-approval"];
    expect(codes(release)).toContain("RELEASE_ACCEPTANCE");
    const expression = clone(referenceImageV1);
    (node(expression, "candidate-rounds") as { until: unknown }).until = { kind: "wat" };
    expect(codes(expression)).toContain("FACTORY_SCHEMA");
    const joinBase = clone();
    (joinBase.graph.nodes as FactoryNode[]).splice(1, 0, { id: "join", kind: "join", mode: "any", predecessors: ["snapshot-repository"], quorum: 0 });
    expect(codes(joinBase)).toContain("JOIN_CONFIGURATION");
    const all = clone();
    (all.graph.nodes as FactoryNode[]).splice(1, 0, { id: "join", kind: "join", mode: "all", predecessors: ["snapshot-repository"], quorum: 1, eligibleOutcomes: ["succeeded"] });
    expect(codes(all)).toContain("JOIN_CONFIGURATION");

    const wrongAcceptedPort = clone();
    (node(wrongAcceptedPort, "github-pr-release") as NodeOf<"release">).acceptedCandidate = { kind: "ref", root: "node", name: "acceptance", path: ["other"] };
    expect(codes(wrongAcceptedPort)).toContain("RELEASE_ACCEPTANCE");

    const wrongContract = clone();
    (node(wrongContract, "acceptance") as NodeOf<"acceptance">).contract = "other";
    // In range for the published schema but not a whole repair, so the compiler is the only gate left.
    (node(wrongContract, "acceptance") as NodeOf<"acceptance">).maxRepairs = 1.5;
    expect(codes(wrongContract)).toEqual(expect.arrayContaining(["ACCEPTANCE_CONTRACT", "BOUND_REPAIR"]));
    // Three candidate generations is the launch ceiling, so the schema refuses a wider declared bound.
    for (const declared of [-1, FACTORY_LIMITS.maxCandidateGenerations]) {
      const overBound = clone();
      (node(overBound, "acceptance") as NodeOf<"acceptance">).maxRepairs = declared;
      expect(codes(overBound)).toContain("FACTORY_SCHEMA");
    }
  });

  test("rejects speculative publication, unlocked dependencies, and validator authority overlap", () => {
    const branch = clone();
    (branch.graph.nodes as FactoryNode[]).splice(1, 0, { id: "branch", kind: "branch", condition: { kind: "literal", value: true }, then: { nodes: [structuredClone(node(branch, "github-pr-release"))], outputs: {} }, else: { nodes: [], outputs: {} } });
    expect(codes(branch)).toContain("SPECULATIVE_PUBLICATION");
    const unlocked = clone();
    (node(unlocked, "snapshot-repository") as { runner: { digest: string } }).runner.digest = `sha256:${"1".repeat(64)}`;
    expect(codes(unlocked)).toContain("REFERENCE_UNLOCKED");
    const overlap = clone();
    (overlap.acceptance.claims[0] as { validator: unknown }).validator = structuredClone((node(overlap, "generate-private-candidate") as { runner: unknown }).runner);
    expect(codes(overlap)).toContain("ACCEPTANCE_AUTHORITY");

    const self = clone(referenceCatalogV1);
    (node(self, "accepted-data") as NodeOf<"subfactory">).factory = { id: self.id, version: "1.0.0", digest: `sha256:${"a".repeat(64)}` };
    (self.factories as FactoryDefinition["factories"] as FactoryReference[]).push((node(self, "accepted-data") as NodeOf<"subfactory">).factory);
    expect(codes(self)).toContain("REFERENCE_CYCLE");

    const claims = clone();
    (claims.acceptance.claims[0] as { id: string }).id = "";
    expect(codes(claims)).toContain("ACCEPTANCE_CLAIM");

    const runner = clone();
    (node(runner, "snapshot-repository") as NodeOf<"task">).runner.export = "";
    (node(runner, "snapshot-repository") as NodeOf<"task">).runner.configurationDigest = "bad";
    expect(codes(runner)).toEqual(expect.arrayContaining(["REFERENCE_EXPORT", "REFERENCE_CONFIGURATION"]));
  });

  test("uses the largest speculative branch for expansion bounds", () => {
    const definition = clone();
    const implementation = structuredClone((node(definition, "snapshot-repository") as NodeOf<"task">).runner);
    const arm = (id: string): Mutable<FactoryNode> => ({ id, kind: "task", runner: implementation, effects: ["read"] });
    definition.bounds.maxExpandedNodes = 3;
    definition.graph = {
      nodes: [{ id: "choice", kind: "branch", condition: { kind: "literal", value: true }, then: { nodes: [arm("then-a"), arm("then-b")], outputs: {} }, else: { nodes: [arm("else-a"), arm("else-b")], outputs: {} } }],
      outputs: { receipt: { kind: "literal", value: {} } },
    };
    expect(codes(definition)).toEqual([]);
  });

  test("requires explicit typed control output records", () => {
    const missingMap = clone(referenceImageV1);
    delete (node(missingMap, "generate-four-seeds") as NodeOf<"map">).body.outputs.variants;
    expect(codes(missingMap)).toContain("CONTROL_OUTPUT_MISSING");

    const incompatibleMap = clone(referenceImageV1);
    (node(incompatibleMap, "generate-four-seeds") as NodeOf<"map">).outputPorts!.variants = { type: "array", items: { type: "string" } };
    expect(codes(incompatibleMap)).toContain("CONTROL_OUTPUT_TYPE");

    const unknownMap = clone(referenceImageV1);
    (node(unknownMap, "generate-four-seeds") as NodeOf<"map">).body.outputs.other = { kind: "literal", value: true };
    expect(codes(unknownMap)).toContain("CONTROL_OUTPUT_UNKNOWN");

    const invalidLoop = clone(referenceImageV1);
    (node(invalidLoop, "candidate-rounds") as NodeOf<"loop">).resultSchema = { type: "string" };
    expect(codes(invalidLoop)).toContain("LOOP_RESULT_SCHEMA");

    const incompatibleLoop = clone(referenceImageV1);
    const loop = node(incompatibleLoop, "candidate-rounds") as NodeOf<"loop">;
    loop.resultSchema = { ...loop.resultSchema, properties: { ...loop.resultSchema.properties, candidate: { type: "string" } } };
    expect(codes(incompatibleLoop)).toContain("CONTROL_OUTPUT_TYPE");

    const branch = clone();
    (branch.graph.nodes as FactoryNode[]).splice(1, 0, { id: "branch-output", kind: "branch", condition: { kind: "literal", value: true }, outputPorts: { selected: { type: "boolean" } }, then: { nodes: [], outputs: {} }, else: { nodes: [], outputs: {} } });
    expect(codes(branch)).toContain("CONTROL_OUTPUT_MISSING");

    const join = clone();
    (join.graph.nodes as FactoryNode[]).splice(1, 0, { id: "join-output", kind: "join", mode: "all", predecessors: ["snapshot-repository"], outputPorts: {} });
    expect(codes(join)).toContain("JOIN_OUTPUT");

    const approval = clone();
    (node(approval, "release-approval") as NodeOf<"approval">).outputPorts = {};
    expect(codes(approval)).toContain("APPROVAL_OUTPUT");
  });

  test("validates typed paths, scope references, nested outputs, and control sources", () => {
    const path = clone();
    const target = node(path, "freeze-complete-git-tree") as { inputPorts: Record<string, unknown>; bindings: Record<string, unknown> };
    target.inputPorts = { candidate: { type: "string" } };
    target.bindings = { candidate: { kind: "ref", root: "node", name: "snapshot-repository", path: ["snapshot", "missing"] } };
    expect(codes(path)).toContain("BINDING_PATH");
    target.bindings.candidate = { kind: "ref", root: "map", name: "item" };
    expect(codes(path)).toContain("BINDING_SCOPE");

    const nestedOutput = clone(referenceImageV1);
    ((node(nestedOutput, "generate-four-seeds") as NodeOf<"map">).body.outputs as Record<string, unknown>).image = { kind: "ref", root: "node", name: "missing", path: ["image"] };
    expect(codes(nestedOutput)).toContain("BINDING_NODE");

    const badMap = clone(referenceImageV1);
    (node(badMap, "generate-four-seeds") as NodeOf<"map">).itemSchema = { type: "string" };
    expect(codes(badMap)).toContain("MAP_COLLECTION_TYPE");
    const badLoop = clone(referenceImageV1);
    (node(badLoop, "candidate-rounds") as NodeOf<"loop">).initialInput = { kind: "literal", value: 7 };
    expect(codes(badLoop)).toContain("LOOP_INPUT_TYPE");

    const missingPort = clone();
    (missingPort.graph.outputs as Record<string, unknown>).receipt = { kind: "ref", root: "node", name: "github-pr-release", path: ["missing"] };
    expect(codes(missingPort)).toContain("BINDING_PORT");

    const literals = clone();
    const literalTarget = node(literals, "snapshot-repository") as { inputPorts: Record<string, unknown>; bindings: Record<string, unknown> };
    literalTarget.inputPorts = {
      nil: { type: "null" }, empty: { type: "array", maxItems: 0 }, record: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }, flag: { type: "boolean" },
    };
    literalTarget.bindings = {
      nil: { kind: "literal", value: null }, empty: { kind: "literal", value: [] }, record: { kind: "literal", value: { ok: true } }, flag: { kind: "literal", value: true },
    };
    expect(codes(literals)).toEqual([]);

    const referenced = clone();
    (referenced.inputPorts as Record<string, unknown>).nested = {
      $defs: { rows: { type: "array", items: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } } },
      $ref: "#/$defs/rows",
    };
    const referencedTarget = node(referenced, "snapshot-repository") as { inputPorts: Record<string, unknown>; bindings: Record<string, unknown> };
    referencedTarget.inputPorts = { value: { type: "string" } };
    referencedTarget.bindings = { value: { kind: "ref", root: "input", name: "nested", path: [0, "value"] } };
    expect(codes(referenced)).toEqual([]);

    const missingItems = clone(referenced);
    (missingItems.inputPorts as Record<string, unknown>).nested = { type: "string" };
    expect(codes(missingItems)).toContain("BINDING_PATH");

    const badReference = clone(referenced);
    (badReference.inputPorts as Record<string, unknown>).nested = { $ref: "remote" };
    expect(codes(badReference)).toEqual(expect.arrayContaining(["SCHEMA_REF_INVALID"]));
    const cyclicReference = clone(referenced);
    (cyclicReference.inputPorts as Record<string, unknown>).nested = { $defs: { a: { $ref: "#/$defs/b" }, b: { $ref: "#/$defs/a" } }, $ref: "#/$defs/a" };
    expect(codes(cyclicReference)).toEqual(expect.arrayContaining(["SCHEMA_RECURSIVE"]));

    const finalReference = clone(referenced);
    const finalTarget = node(finalReference, "snapshot-repository") as { inputPorts: Record<string, unknown>; bindings: Record<string, unknown> };
    finalTarget.inputPorts = { rows: { type: "array", items: { type: "object", additionalProperties: true } } };
    finalTarget.bindings = { rows: { kind: "ref", root: "input", name: "nested" } };
    expect(codes(finalReference)).toEqual([]);
  });

  test("type-checks expression references and rejects unsafe expansion or retries", () => {
    const branch = clone();
    (branch.graph.nodes as FactoryNode[]).splice(1, 0, { id: "typed-branch", kind: "branch", dependsOn: ["snapshot-repository"], condition: { kind: "ref", root: "node", name: "snapshot-repository", path: ["snapshot"] }, then: { nodes: [], outputs: {} }, else: { nodes: [], outputs: {} } });
    expect(codes(branch)).toContain("EXPRESSION_TYPE");
    const loop = clone(referenceImageV1);
    (node(loop, "candidate-rounds") as NodeOf<"loop">).nextInput = { kind: "literal", value: 7 };
    expect(codes(loop)).toContain("EXPRESSION_TYPE");
    const retry = clone();
    (node(retry, "snapshot-repository") as { retry: unknown }).retry = { maxAttempts: 4, initialDelayMs: 0, maximumDelayMs: 0 };
    expect(codes(retry)).toContain("BOUND_RETRY");
    const iterations = clone();
    (node(iterations, "generate-private-candidate") as { maxIterations: number }).maxIterations = 0;
    expect(codes(iterations)).toContain("BOUND_AGENT_ITERATIONS");
    const expansion = clone(referenceImageV1);
    (node(expansion, "generate-four-seeds") as NodeOf<"map">).maxItems = 10_000;
    expect(codes(expansion)).toContain("BOUND_EXPANDED_NODES");

    const operators = clone();
    (operators.graph.nodes as FactoryNode[]).splice(1, 0, {
      id: "operator-branch", kind: "branch", dependsOn: ["snapshot-repository"],
      condition: {
        kind: "and",
        values: [
          { kind: "not", value: { kind: "literal", value: false } },
          { kind: "exists", value: { kind: "ref", root: "input", name: "request" } },
          { kind: "eq", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 1 } },
          { kind: "in", value: { kind: "literal", value: "a" }, collection: { kind: "literal", value: ["a"] } },
          { kind: "gt", left: { kind: "length", value: { kind: "ref", root: "input", name: "request" } }, right: { kind: "literal", value: 0 } },
        ],
      },
      then: { nodes: [], outputs: {} }, else: { nodes: [], outputs: {} },
    });
    expect(codes(operators)).toEqual([]);
    ((node(operators, "operator-branch") as NodeOf<"branch">).condition as { values: unknown[] }).values = [{ kind: "literal", value: 1 }];
    expect(codes(operators)).toContain("EXPRESSION_TYPE");
    const nullable = clone();
    (nullable.inputPorts as Record<string, unknown>).maybe = { type: ["boolean", "null"] };
    (nullable.graph.nodes as FactoryNode[]).splice(1, 0, { id: "nullable-branch", kind: "branch", condition: { kind: "ref", root: "input", name: "maybe" }, then: { nodes: [], outputs: {} }, else: { nodes: [], outputs: {} } });
    expect(codes(nullable)).toContain("EXPRESSION_TYPE");
  });

  test("rejects oversize definition and page payloads before execution", () => {
    const page = clone();
    (node(page, "snapshot-repository") as NodeOf<"task">).runner = {
      ...(node(page, "snapshot-repository") as NodeOf<"task">).runner,
      export: "x".repeat(33 * 1024),
    };
    (page.packages[0] as { digest: string }).digest = (node(page, "snapshot-repository") as NodeOf<"task">).runner.digest;
    expect(codes(page)).toEqual(expect.arrayContaining(["PAYLOAD_NODE", "PAYLOAD_PARTITION"]));

    const manifest = clone();
    (manifest.inputPorts.request as { description?: string }).description = "x".repeat(33 * 1024);
    expect(codes(manifest)).toContain("PAYLOAD_EXECUTION_MANIFEST");

    const definition = clone();
    (definition.inputPorts.request as { description?: string }).description = "x".repeat(16 * 1024 * 1024);
    expect(codes(definition)).toContain("BOUND_DEFINITION_BYTES");
  });

  test("rejects compiled IR expansion above the definition byte limit", () => {
    const definition = clone();
    const implementation = structuredClone((node(definition, "snapshot-repository") as NodeOf<"task">).runner);
    const outputSchema = structuredClone(definition.outputPorts.receipt!);
    const padding = "x".repeat(14_000);
    definition.graph.nodes = Array.from({ length: 650 }, (_, index): Mutable<FactoryNode> => ({
      id: `large-${index}`,
      kind: "task",
      runner: implementation,
      outputPorts: { receipt: { ...outputSchema, description: padding } },
      effects: ["read"],
    }));
    definition.graph.outputs = { receipt: { kind: "ref", root: "node", name: "large-649", path: ["receipt"] } };
    expect(new TextEncoder().encode(canonicalizeJson(definition as unknown as JsonValue)).byteLength).toBeLessThan(FACTORY_LIMITS.maxDefinitionBytes);
    expect(codes(definition)).toContain("PAYLOAD_COMPILED_IR");
  }, 30_000);

  test("partitions the maximum 10,000-node static graph without recursion", () => {
    const definition = clone();
    const implementation = structuredClone((node(definition, "snapshot-repository") as NodeOf<"task">).runner);
    const outputSchema = structuredClone(definition.outputPorts.receipt!);
    const nodes = Array.from({ length: 10_000 }, (_, index): Mutable<FactoryNode> => ({
      id: index === 9_997 ? "constructor" : index === 9_998 ? "toString" : index === 9_999 ? "last" : `node-${index}`,
      kind: "task",
      runner: implementation,
      outputPorts: { receipt: outputSchema },
      effects: ["read"],
    }));
    definition.graph = { nodes, outputs: { receipt: { kind: "ref", root: "node", name: "last", path: ["receipt"] } } };
    const result = compileFactory(definition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.factory.indexes.nodeById)).toHaveLength(10_000);
    expect(result.factory.partitions.length).toBeGreaterThan(79);
    expect(result.factory.partitions.every((partition) => partition.encodedBytes <= FACTORY_LIMITS.maxRecordedPageBytes)).toBe(true);
    expect(result.factory.partitions.every((partition) => partition.inbound.length === 0 && partition.outbound.length === 0)).toBe(true);
    expect(result.factory.pages.every((page) => page.encodedBytes <= 32 * 1024)).toBe(true);
  });

  test("splits edge-dense partitions to keep recorded artifacts bounded", () => {
    const definition = clone();
    const template = node(definition, "snapshot-repository") as NodeOf<"task">;
    const sourceIds = Array.from({ length: 32 }, (_, index) => `source-${index.toString().padStart(2, "0")}`);
    const targetIds = Array.from({ length: 16 }, (_, index) => `target-${index.toString().padStart(2, "0")}`);
    definition.graph = {
      nodes: [
        ...sourceIds.map((id) => ({ ...template, id, dependsOn: [] })),
        ...targetIds.map((id) => ({ ...template, id, dependsOn: sourceIds })),
      ],
      outputs: { receipt: { kind: "ref", root: "node", name: targetIds.at(-1)!, path: ["snapshot"] } },
    };
    definition.outputPorts = { receipt: template.outputPorts!.snapshot! };
    const result = compileFactory(definition);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factory.partitions.every((partition) => partition.encodedBytes <= FACTORY_LIMITS.maxRecordedPageBytes)).toBe(true);
    expect(result.factory.partitions.some((partition) => partition.outbound.length > 0)).toBe(true);
  });

  test("authoring returns the canonical definition or located diagnostics", () => {
    expect(defineFactory(referenceCodeV1).id).toBe("reference.code.v1");
    expect(() => defineFactory({ ...referenceCodeV1, bounds: { ...referenceCodeV1.bounds, maxExpandedNodes: 0 } })).toThrow(FactoryAuthoringError);
  });
});
