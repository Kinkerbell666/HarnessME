import { describe, expect, test } from "bun:test";
import { factoryChildAcceptanceResult } from "./child-acceptance";
import { compileFactory } from "./compiler";
import { referenceCatalogV1, referenceCodeV1, referenceDataV1, referenceFactories, referenceImageV1 } from "./references";
import type { CompiledFactory, FactoryDefinition, FactoryNode, JsonValue } from "./types";
import { simulateFactory, type FactorySimulatorOptions, type SimulatedOutcome } from "./simulator";

const artifact = (label: string): JsonValue => ({ digest: `sha256:${label.charCodeAt(0).toString(16).padStart(2, "0").repeat(32)}`, mediaType: "application/octet-stream", storage: `fixture://${label}` });
const evidence = (label: string): JsonValue => [artifact(label)];
const fixtureDigest = (label: string): string => `sha256:${label.charCodeAt(0).toString(16).padStart(2, "0").repeat(32)}`;

/**
 * What a `releaseMode: "none"` child returns.
 *
 * Built by the real `factoryChildAcceptanceResult`, not hand-written. The
 * shape, its builder, and the port schema that admits it all live in
 * `child-acceptance.ts` in this package, so a fixture that restated the seven
 * fields would be the second declaration the single-declaration move removed.
 * Every catalog child declares `factoryChildAcceptancePortSchema`, and
 * `advanceKernel` validates each node result against its declared output port,
 * so a drifted envelope fails the catalog simulation rather than passing.
 */
const acceptanceOnlyReceipt = (label: string, accepted: JsonValue): JsonValue => factoryChildAcceptanceResult({
  decisionId: `decision-${label}`,
  contractDigest: fixtureDigest("c"),
  candidateDigest: fixtureDigest(label),
  evidenceSetDigest: fixtureDigest("e"),
  artifact: accepted,
}) as unknown as JsonValue;

const artifacts = {
  catalog: artifact("catalog"),
  code: artifact("code"),
  data: artifact("data"),
  image: artifact("image"),
  manifest: artifact("manifest"),
  repository: artifact("repository"),
} as const;

function record(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("fixture expected an object");
  return value;
}

/** A field the task's input must carry; a missing one is a fixture bug. */
function field(input: Record<string, JsonValue>, name: string): JsonValue {
  const value = input[name];
  if (value === undefined) throw new Error(`fixture input has no ${name}`);
  return value;
}

function compiled(definition: FactoryDefinition): CompiledFactory {
  const result = compileFactory(definition);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.factory;
}

function inputFor(id: FactoryDefinition["id"]): JsonValue {
  if (id === "reference.code.v1") return { repositoryConnection: { id: "repo" }, baseCommitSha: "abc123", request: "slugify the input", destinationRepository: { id: "repo" }, baseBranch: "main" };
  if (id === "reference.image.v1") return { brief: "One green oak tree on a plain white background, no text.", outputName: "tree.png", destination: { bucket: "accepted", prefix: "images" } };
  if (id === "reference.data.v1") return { csv: artifact("csv"), destination: { bucket: "accepted", prefix: "data" } };
  return { csv: artifact("csv"), brief: "One green oak tree on a plain white background, no text.", repository: { id: "repo" }, baseCommitSha: "abc123", githubDestination: { repository: { id: "repo" }, baseBranch: "main" } };
}

function fixtureOptions(overrides: { failImages?: boolean; missingEvidence?: boolean; denyApproval?: boolean } = {}): FactorySimulatorOptions & { readonly inputs: Map<string, JsonValue>; readonly childInputs: Map<string, JsonValue> } {
  const inputs = new Map<string, JsonValue>();
  const childInputs = new Map<string, JsonValue>();
  return {
    inputs,
    childInputs,
    execute(node, command): SimulatedOutcome {
      if (node.kind !== "task") throw new Error(`fixture dispatched a ${node.kind} node`);
      inputs.set(command.nodeId, command.input);
      const input = record(command.input);
      switch (node.runner.export) {
        case "snapshotRepository": return { kind: "success", output: { snapshot: artifacts.repository } };
        case "generateCandidate": return { kind: "success", output: { candidate: artifacts.code } };
        case "freezeGitTree": return { kind: "success", output: { candidate: field(input, "candidate") } };
        case "protectedChecks": return { kind: "success", output: overrides.missingEvidence ? {} : { evidence: evidence("checks") } };
        case "snapshotBrief": return { kind: "success", output: { brief: field(input, "brief") } };
        case "generateSdxl": return overrides.failImages ? { kind: "failure", error: "variant rejected" } : { kind: "success", output: { image: artifacts.image } };
        case "normalizePng": {
          const variants = input.variants as JsonValue[];
          if (variants.every((entry) => record(entry).outcome === "failed")) return { kind: "failure", error: "no passing image variant" };
          return { kind: "success", output: { variants: variants.flatMap((entry) => record(entry).outcome === "succeeded" ? [record(entry).value!] : []) } };
        }
        case "validateImage": return { kind: "success", output: { evidence: evidence("vision") } };
        case "selectFirstAccepted": return { kind: "success", output: { result: { accepted: true, candidate: (input.variants as JsonValue[])[0]!, evidence: field(input, "evidence"), revisedPrompt: "revised tree prompt" } } };
        case "snapshotCsv": return { kind: "success", output: { snapshot: field(input, "csv") } };
        case "parseCsv": return { kind: "success", output: { partitions: [artifact("partition-a"), artifact("partition-b")] } };
        case "transformPartition": return { kind: "success", output: { partition: field(input, "partition") } };
        case "orderedReduce": return { kind: "success", output: { dataset: artifacts.data, manifest: artifacts.manifest } };
        case "reconcile": return { kind: "success", output: { evidence: evidence("reconcile") } };
        case "prepareCatalogRequest": return { kind: "success", output: { request: "embed accepted data and image" } };
        case "protectedCatalogChecks": return { kind: "success", output: { evidence: evidence("catalog-checks") } };
        default: throw new Error(`No fixture task for ${node.runner.export}`);
      }
    },
    child(command) {
      childInputs.set(command.nodeId, command.input);
      if (command.factory.id === "reference.data.v1") return { kind: "success", output: { receipt: acceptanceOnlyReceipt("data", artifacts.data) } };
      if (command.factory.id === "reference.image.v1") return { kind: "success", output: { receipt: acceptanceOnlyReceipt("image", artifacts.image) } };
      return { kind: "success", output: { receipt: acceptanceOnlyReceipt("catalog", artifacts.catalog) } };
    },
    acceptance(command) {
      return { kind: "success", output: { acceptedCandidate: command.candidate } };
    },
    approval() { return overrides.denyApproval ? "deny" : "approve"; },
    release() { return { kind: "success", output: { receipt: { provider: "fixture", confirmed: true } } }; },
  };
}

function commandTrace(result: ReturnType<typeof simulateFactory>): string[] {
  return result.commands.filter((command) => command.kind !== "start-timer" && command.kind !== "request-admission").map((command) => `${command.kind}:${("nodeId" in command ? command.nodeId : undefined) ?? "run"}`);
}

describe("C10 reference execution", () => {
  test("executes the four compiled fixtures through typed handoffs and stable commands", () => {
    const expectedTerminal = ["reference.code.v1", "reference.image.v1", "reference.data.v1", "reference.catalog.v1"];
    const completed: string[] = [];
    for (const definition of referenceFactories) {
      const options = fixtureOptions();
      const result = simulateFactory(compiled(definition), `golden-${definition.id}`, inputFor(definition.id), options);
      expect(result.state.status).toBe("completed");
      expect(result.commands.at(-1)).toEqual(expect.objectContaining({ kind: "complete-run", output: { receipt: { provider: "fixture", confirmed: true } } }));
      expect(result.commands[0]?.id).toBe(`golden-${definition.id}:run:start-timer:1`);
      expect(result.commands.some((command) => command.kind === "request-release")).toBe(true);
      completed.push(definition.id);
    }
    expect(completed).toEqual(expectedTerminal);
  });

  test("matches independent golden command traces and required C10 handoffs", () => {
    const codeOptions = fixtureOptions();
    const code = simulateFactory(compiled(referenceCodeV1), "trace-code", inputFor(referenceCodeV1.id), codeOptions);
    expect(commandTrace(code)).toEqual([
      "dispatch-node:snapshot-repository",
      "dispatch-node:generate-private-candidate",
      "dispatch-node:freeze-complete-git-tree",
      "dispatch-node:protected-checks",
      "request-acceptance:acceptance",
      "request-approval:release-approval",
      "request-release:github-pr-release",
      "complete-run:run",
    ]);
    expect(codeOptions.inputs.get("generate-private-candidate")).toEqual({ snapshot: artifacts.repository, request: "slugify the input", baseBranch: "main", remediation: "" });
    expect(codeOptions.inputs.get("freeze-complete-git-tree")).toEqual({ candidate: artifacts.code, baseCommitSha: "abc123" });
    expect(referenceCodeV1.graph.nodes.find((node): node is Extract<FactoryNode, { kind: "task" }> => node.id === "generate-private-candidate" && node.kind === "task")?.runner).toEqual(expect.objectContaining({ model: "gpt-6-luna", configurationDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) }));
    expect(code.commands.map((command) => command.id)).toEqual([
      "trace-code:run:start-timer:1",
      "trace-code:snapshot-repository:request-admission:2",
      "trace-code:snapshot-repository:start-timer:3",
      "trace-code:snapshot-repository:dispatch-node:4",
      "trace-code:generate-private-candidate:request-admission:5",
      "trace-code:generate-private-candidate:start-timer:6",
      "trace-code:generate-private-candidate:dispatch-node:7",
      "trace-code:freeze-complete-git-tree:request-admission:8",
      "trace-code:freeze-complete-git-tree:start-timer:9",
      "trace-code:freeze-complete-git-tree:dispatch-node:10",
      "trace-code:protected-checks:request-admission:11",
      "trace-code:protected-checks:start-timer:12",
      "trace-code:protected-checks:dispatch-node:13",
      "trace-code:acceptance:request-acceptance:14",
      "trace-code:acceptance:start-timer:15",
      "trace-code:release-approval:request-approval:16",
      "trace-code:release-approval:start-timer:17",
      "trace-code:github-pr-release:request-release:18",
      "trace-code:github-pr-release:start-timer:19",
      "trace-code:run:complete-run:20",
    ]);

    const imageOptions = fixtureOptions();
    const image = simulateFactory(compiled(referenceImageV1), "trace-image", inputFor(referenceImageV1.id), imageOptions);
    expect(commandTrace(image)).toEqual([
      "dispatch-node:brief-snapshot",
      "dispatch-node:candidate-rounds/items/0/generate-four-seeds/items/0/generate-seed",
      "dispatch-node:candidate-rounds/items/0/generate-four-seeds/items/1/generate-seed",
      "dispatch-node:candidate-rounds/items/0/generate-four-seeds/items/2/generate-seed",
      "dispatch-node:candidate-rounds/items/0/generate-four-seeds/items/3/generate-seed",
      "dispatch-node:candidate-rounds/items/0/normalize-png",
      "dispatch-node:candidate-rounds/items/0/protected-image-checks",
      "dispatch-node:candidate-rounds/items/0/choose-first-accepted",
      "request-acceptance:acceptance",
      "request-approval:release-approval",
      "request-release:s3-publication",
      "complete-run:run",
    ]);
    const imageInputs = [0, 1, 2, 3].map((index) => imageOptions.inputs.get(`candidate-rounds/items/0/generate-four-seeds/items/${index}/generate-seed`));
    expect(imageInputs.map((input) => record(input!).seed)).toEqual([11, 23, 37, 53]);
    expect(imageInputs.every((input) => record(input!).inferenceSteps === 30 && record(input!).guidance === 7.5 && record(input!).width === 1024 && record(input!).height === 1024)).toBe(true);
    expect((record(imageOptions.inputs.get("candidate-rounds/items/0/normalize-png")!).variants as JsonValue[]).every((entry) => record(entry).outcome === "succeeded")).toBe(true);
    expect(referenceImageV1.acceptance.groups).toEqual([{ id: "semantic-quorum", claimIds: ["semantic-evaluation-1", "semantic-evaluation-2", "semantic-evaluation-3"], minimumPasses: 2, requireAllDecisive: true }]);

    const dataOptions = fixtureOptions();
    const data = simulateFactory(compiled(referenceDataV1), "trace-data", inputFor(referenceDataV1.id), dataOptions);
    expect(commandTrace(data)).toEqual([
      "dispatch-node:input-snapshot",
      "dispatch-node:parse-schema-validation",
      "dispatch-node:transform-partitions/items/0/pyarrow-transform",
      "dispatch-node:transform-partitions/items/1/pyarrow-transform",
      "dispatch-node:ordered-reduction",
      "dispatch-node:protected-reconciliation",
      "request-acceptance:acceptance",
      "request-approval:release-approval",
      "request-release:s3-export",
      "complete-run:run",
    ]);
    expect(dataOptions.inputs.get("ordered-reduction")).toEqual({ partitions: [artifact("partition-a"), artifact("partition-b")] });

    const catalogOptions = fixtureOptions();
    const catalog = simulateFactory(compiled(referenceCatalogV1), "trace-catalog", inputFor(referenceCatalogV1.id), catalogOptions);
    expect(commandTrace(catalog)).toEqual([
      "run-child:accepted-data",
      "run-child:accepted-image",
      "dispatch-node:prepare-catalog-request",
      "run-child:static-catalog-code",
      "dispatch-node:protected-catalog-tests",
      "request-acceptance:acceptance",
      "request-approval:release-approval",
      "request-release:github-pr-release",
      "complete-run:run",
    ]);
    expect(catalogOptions.childInputs.get("accepted-data")).toEqual({ csv: artifact("csv") });
    expect(catalogOptions.childInputs.get("accepted-image")).toEqual({ brief: "One green oak tree on a plain white background, no text.", outputName: "catalog-tree.png" });
    expect(catalogOptions.childInputs.get("static-catalog-code")).toEqual({ repositoryConnection: { id: "repo" }, baseCommitSha: "abc123", request: "embed accepted data and image", destinationRepository: { id: "repo" }, baseBranch: "main" });

    for (const [result, acceptedCandidate, destination] of [
      [code, artifacts.code, { id: "repo" }],
      [image, artifacts.image, { bucket: "accepted", prefix: "images" }],
      [data, artifacts.data, { bucket: "accepted", prefix: "data" }],
      [catalog, artifacts.catalog, { repository: { id: "repo" }, baseBranch: "main" }],
    ] as const) expect(result.commands.find((command) => command.kind === "request-release")).toEqual(expect.objectContaining({ input: { acceptedCandidate, destination } }));
  });

  test("does not release after missing evidence, failed image variants, or denied approval", () => {
    for (const [definition, options] of [
      [referenceCodeV1, fixtureOptions({ missingEvidence: true })],
      [referenceImageV1, fixtureOptions({ failImages: true })],
      [referenceDataV1, fixtureOptions({ denyApproval: true })],
    ] as const) {
      const result = simulateFactory(compiled(definition), `negative-${definition.id}`, inputFor(definition.id), options);
      expect(result.state.status).toBe("failed");
      expect(result.commands.some((command) => command.kind === "request-release")).toBe(false);
    }
  });
});
