import { expect, test } from "bun:test";
import { compileFactory } from "./compiler";
import { advanceKernel, assertKernelContinuationState, createKernelState } from "./kernel";
import { referenceCodeV1 } from "./references";
import { FACTORY_LIMITS } from "./types";
import type { CompiledFactory, FactoryDefinition, JsonValue, KernelCommand, KernelEvent, KernelState } from "./index";
import { mutableClone } from "../tests/mutable";

const REJECTION = "factory_assurance_claim_failed";
const stringPort = { type: "string" as const };

function compiled(definition: FactoryDefinition): CompiledFactory {
  const result = compileFactory(definition);
  if (!result.ok) throw new Error(result.diagnostics.map(item => item.code).join(","));
  return result.factory;
}

/** One artifact per seed, so a repaired generation cannot pass with the rejected tree. */
function artifactOf(seed: number): JsonValue {
  return { digest: `sha256:${String(seed).padStart(64, "0")}`, mediaType: "application/json", storage: "ezcorp" };
}

const codeInput: JsonValue = { repositoryConnection: { id: "repo" }, baseCommitSha: "abc123", request: "slugify the input", destinationRepository: { id: "repo" }, baseBranch: "main" };
const codeGenerateInput = (remediation: string): JsonValue => ({ snapshot: artifactOf(1), request: "slugify the input", baseBranch: "main", remediation });

/** A minimal producer plus acceptance, so a bound can be declared, omitted, or forged. */
function acceptanceFixture(maxRepairs?: number): CompiledFactory {
  const definition = mutableClone(referenceCodeV1);
  const producer = definition.graph.nodes.find(node => node.id === "generate-private-candidate");
  if (producer?.kind !== "task") throw new Error("fixture");
  definition.inputPorts = { request: stringPort };
  definition.outputPorts = {};
  definition.graph = {
    nodes: [
      {
        id: "candidate",
        kind: "task",
        runner: structuredClone(producer.runner),
        inputPorts: { request: stringPort, remediation: stringPort },
        bindings: { request: { kind: "ref", root: "input", name: "request" }, remediation: { kind: "literal", value: "none" } },
        repairableInputs: ["remediation"],
        outputPorts: { candidate: stringPort },
        effects: ["write"],
      },
      {
        id: "accept",
        kind: "acceptance",
        dependsOn: ["candidate"],
        contract: definition.acceptance.id,
        candidate: { kind: "ref", root: "node", name: "candidate", path: ["candidate"] },
        evidence: { kind: "literal", value: [] },
        ...(maxRepairs === undefined ? {} : { maxRepairs }),
        outputPorts: { acceptedCandidate: stringPort },
      },
    ],
    outputs: {},
  };
  return compiled(definition);
}

function outputFor(command: Extract<KernelCommand, { kind: "dispatch-node" }>): JsonValue {
  const input = command.input as Record<string, JsonValue>;
  if (command.nodeId === "snapshot-repository") return { snapshot: artifactOf(1) };
  if (command.nodeId === "generate-private-candidate") return { candidate: artifactOf(10 + command.candidateGeneration) };
  if (command.nodeId === "freeze-complete-git-tree") return { candidate: input.candidate! };
  if (command.nodeId === "protected-checks") return { evidence: [artifactOf(30 + command.candidateGeneration)] };
  if (command.nodeId === "candidate") return { candidate: `candidate-${command.candidateGeneration}` };
  throw new Error(`no fixture output for ${command.nodeId}`);
}

/** Settles one ordinary command. Acceptance and timers are the caller's to answer. */
function answer(command: KernelCommand, atMs: number): KernelEvent | null {
  if (command.kind === "request-admission") return { kind: "admission-result", id: `${command.id}:granted`, atMs, nodeId: command.nodeId, commandId: command.id, candidateGeneration: command.candidateGeneration, granted: true };
  if (command.kind === "dispatch-node") return { kind: "node-result", id: `${command.id}:done`, atMs, nodeId: command.nodeId, commandId: command.id, candidateGeneration: command.candidateGeneration, attempt: command.attempt, output: outputFor(command) };
  if (command.kind === "cancel-node") return { kind: "attempt-stopped", id: `${command.id}:stopped`, atMs, nodeId: command.nodeId, commandId: command.attemptCommandId, candidateGeneration: command.candidateGeneration, attempt: command.attempt };
  return null;
}

interface Step {
  readonly state: KernelState;
  readonly queue: readonly KernelCommand[];
  readonly issued: readonly KernelCommand[];
  readonly applied: readonly KernelEvent[];
}

function begin(factory: CompiledFactory, runId: string, input: JsonValue): Step {
  const start: KernelEvent = { kind: "start", id: `${runId}:start`, atMs: 0 };
  const advanced = advanceKernel(factory, createKernelState(factory, runId, input, 0), start);
  return { state: advanced.nextState, queue: advanced.commands, issued: advanced.commands, applied: [start] };
}

function apply(factory: CompiledFactory, step: Step, event: KernelEvent, queue: readonly KernelCommand[]): Step {
  const advanced = advanceKernel(factory, step.state, event);
  return { state: advanced.nextState, queue: queue.concat(advanced.commands), issued: step.issued.concat(advanced.commands), applied: step.applied.concat(event) };
}

/** Runs every ordinary command to success and returns at the next protected decision. */
function toAcceptance(factory: CompiledFactory, start: Step, atMs: number): { step: Step; command: Extract<KernelCommand, { kind: "request-acceptance" }> } {
  let step = start;
  for (let guard = 0; guard < 128; guard += 1) {
    const [command, ...rest] = step.queue;
    if (!command) throw new Error("the run settled without asking for a decision");
    if (command.kind === "request-acceptance") return { step: { ...step, queue: rest }, command };
    const event = answer(command, atMs);
    step = event ? apply(factory, { ...step, queue: rest }, event, rest) : { ...step, queue: rest };
  }
  throw new Error("the bounded driver did not settle");
}

function rejectionFor(command: Extract<KernelCommand, { kind: "request-acceptance" }>, attempt: number, atMs: number): KernelEvent {
  return { kind: "node-failed", id: `protected-rejection:${command.id}`, atMs, nodeId: command.nodeId, commandId: command.id, candidateGeneration: command.candidateGeneration, attempt, error: REJECTION, failureKind: "acceptance_rejected" };
}

function cancelCommandNodeIds(commands: readonly KernelCommand[]): readonly string[] {
  return commands.flatMap(command => command.kind === "cancel-node" ? [command.nodeId] : []);
}

test("a protected rejection waits for bounded remediation and stops no task that never existed", () => {
  const factory = compiled(referenceCodeV1);
  const first = toAcceptance(factory, begin(factory, "reject-wait", codeInput), 1);
  expect(first.command.candidateGeneration).toBe(0);

  const rejected = advanceKernel(factory, first.step.state, rejectionFor(first.command, 1, 2));
  expect(rejected.commands).toEqual([]);
  expect(cancelCommandNodeIds(rejected.commands)).toEqual([]);
  expect(rejected.nextState.nodes.acceptance).toMatchObject({ status: "waiting", waitingReason: "remediation", error: REJECTION, candidateGeneration: 0 });
  expect(rejected.nextState.nodes.acceptance!.waitingDeadlineAtMs).toBe(rejected.nextState.runDeadlineAtMs);
  expect(rejected.nextState.nodes.acceptance!.attempts.every(attempt => attempt.stopped && !attempt.uncertain)).toBe(true);
  expect(rejected.nextState.status).toBe("waiting");
  expect(() => assertKernelContinuationState(factory, rejected.nextState)).not.toThrow();
});

test("remediation produces a new candidate, refreezes, reruns every check, and asks for a new decision", () => {
  const factory = compiled(referenceCodeV1);
  const first = toAcceptance(factory, begin(factory, "reject-repair", codeInput), 1);
  const rejected = apply(factory, first.step, rejectionFor(first.command, 1, 2), first.step.queue);
  const before = rejected.issued.length;

  const repaired = apply(factory, rejected, { kind: "repair", id: "repair-1", atMs: 3, nodeId: "generate-private-candidate", reason: REJECTION, inputOverride: codeGenerateInput("add the missing protected test") }, rejected.queue);
  const second = toAcceptance(factory, repaired, 4);

  expect(second.command.candidateGeneration).toBe(1);
  expect(second.command.candidate).not.toEqual(first.command.candidate);
  expect(second.command.evidence).not.toEqual(first.command.evidence);
  expect(second.step.issued.slice(before).flatMap(command => command.kind === "dispatch-node" ? [command.nodeId] : [])).toEqual([
    "generate-private-candidate",
    "freeze-complete-git-tree",
    "protected-checks",
  ]);
  expect(second.step.issued.slice(before).flatMap(command => command.kind === "dispatch-node" && command.nodeId === "generate-private-candidate" ? [command.input] : [])).toEqual([codeGenerateInput("add the missing protected test")]);
  expect(cancelCommandNodeIds(second.step.issued)).toEqual([]);

  // The rejected candidate and its evidence stay exactly as the contract saw them.
  expect(second.step.state.nodes["generate-private-candidate"]!.priorCandidates).toEqual([{ candidateGeneration: 0, status: "succeeded", output: { candidate: artifactOf(10) }, inputOverride: codeGenerateInput("") }]);
  expect(second.step.state.nodes.acceptance!.priorCandidates).toEqual([{ candidateGeneration: 0, status: "cancelled", error: REJECTION }]);
  expect(second.step.state.runDeadlineAtMs).toBe(first.step.state.runDeadlineAtMs);
});

test("the declared bound is consumed, never exceeded, and exhaustion fails the run instead of waiting again", () => {
  const factory = compiled(referenceCodeV1);
  const bound = (factory.definition.graph.nodes.find(node => node.id === "acceptance") as { maxRepairs: number }).maxRepairs;
  expect(bound).toBe(FACTORY_LIMITS.maxCandidateGenerations - 1);

  let current = toAcceptance(factory, begin(factory, "bound-exhausted", codeInput), 1);
  const decisions: number[] = [];
  let step = current.step;
  for (let round = 0; round <= bound; round += 1) {
    decisions.push(current.command.candidateGeneration);
    step = apply(factory, step, rejectionFor(current.command, 1, 10 + round), step.queue);
    if (round === bound) break;
    step = apply(factory, step, { kind: "repair", id: `repair-${round}`, atMs: 20 + round, nodeId: "generate-private-candidate", reason: REJECTION, inputOverride: codeGenerateInput(`round ${round}`) }, step.queue);
    current = toAcceptance(factory, step, 30 + round);
    step = current.step;
  }

  expect(decisions).toEqual([0, 1, 2]);
  expect(decisions.length).toBe(FACTORY_LIMITS.maxCandidateGenerations);
  expect(step.state.nodes.acceptance).toMatchObject({ status: "failed", error: "ACCEPTANCE_BOUND_EXHAUSTED", candidateGeneration: bound });
  expect(step.state.status).toBe("failed");
  expect(step.issued.some(command => command.kind === "fail-run" && command.error === "ACCEPTANCE_BOUND_EXHAUSTED")).toBe(true);
  expect(step.issued.some(command => command.kind === "request-release")).toBe(false);
  expect(cancelCommandNodeIds(step.issued)).toEqual([]);

  // A repair offered after the bound is spent cannot revive the run or buy a fourth generation.
  const refused = advanceKernel(factory, step.state, { kind: "repair", id: "repair-late", atMs: 99, nodeId: "generate-private-candidate", reason: REJECTION, inputOverride: codeGenerateInput("too late") });
  expect(refused.nextState.nodes["generate-private-candidate"]!.candidateGeneration).toBe(bound);
  expect(refused.commands).toEqual([]);
});

test("an undeclared bound authorizes no remediation at all", () => {
  const factory = acceptanceFixture();
  const first = toAcceptance(factory, begin(factory, "no-bound", { request: "build it" }), 1);
  const rejected = advanceKernel(factory, first.step.state, rejectionFor(first.command, 1, 2));
  expect(rejected.nextState.nodes.accept).toMatchObject({ status: "failed", error: "ACCEPTANCE_BOUND_EXHAUSTED" });
  expect(rejected.nextState.status).toBe("failed");
  expect(cancelCommandNodeIds(rejected.commands)).toEqual([]);
});

test("a forged plan cannot buy more candidate generations than the launch ceiling", () => {
  const honest = acceptanceFixture(FACTORY_LIMITS.maxCandidateGenerations - 1);
  const forged = structuredClone(honest) as CompiledFactory;
  (forged.definition.graph.nodes.find(node => node.id === "accept") as { maxRepairs: number }).maxRepairs = 99;

  let current = toAcceptance(forged, begin(forged, "forged-bound", { request: "build it" }), 1);
  let step = current.step;
  const decisions: number[] = [];
  for (let round = 0; round < 8; round += 1) {
    decisions.push(current.command.candidateGeneration);
    step = apply(forged, step, rejectionFor(current.command, 1, 10 + round), step.queue);
    if (step.state.nodes.accept!.status === "failed") break;
    step = apply(forged, step, { kind: "repair", id: `forged-repair-${round}`, atMs: 20 + round, nodeId: "candidate", reason: REJECTION, inputOverride: { request: "build it", remediation: `round ${round}` } }, step.queue);
    current = toAcceptance(forged, step, 30 + round);
    step = current.step;
  }

  expect(decisions).toEqual([0, 1, 2]);
  expect(step.state.nodes.accept).toMatchObject({ status: "failed", error: "ACCEPTANCE_BOUND_EXHAUSTED" });
});

test("a repair cannot re-ask the same contract about an unchanged candidate", () => {
  const factory = compiled(referenceCodeV1);
  const first = toAcceptance(factory, begin(factory, "repair-acceptance", codeInput), 1);
  const rejected = advanceKernel(factory, first.step.state, rejectionFor(first.command, 1, 2));

  const refused = advanceKernel(factory, rejected.nextState, { kind: "repair", id: "repair-acceptance", atMs: 3, nodeId: "acceptance", reason: REJECTION });
  expect(refused.commands).toEqual([]);
  expect(refused.nextState.nodes.acceptance).toMatchObject({ status: "waiting", waitingReason: "remediation", candidateGeneration: 0 });
  expect(refused.nextState.nodes.acceptance!.priorCandidates).toBeUndefined();
});

test("a rejection from a spent generation cannot consume a second repair", () => {
  const factory = compiled(referenceCodeV1);
  const first = toAcceptance(factory, begin(factory, "stale-rejection", codeInput), 1);
  const rejected = apply(factory, first.step, rejectionFor(first.command, 1, 2), first.step.queue);
  const repaired = apply(factory, rejected, { kind: "repair", id: "repair-1", atMs: 3, nodeId: "generate-private-candidate", reason: REJECTION, inputOverride: codeGenerateInput("first fix") }, rejected.queue);
  const second = toAcceptance(factory, repaired, 4);

  const stale = advanceKernel(factory, second.step.state, rejectionFor(first.command, 1, 5));
  expect(stale.commands).toEqual([]);
  expect(stale.nextState).toEqual(second.step.state);
  expect(stale.nextState.nodes.acceptance).toMatchObject({ status: "waiting", candidateGeneration: 1, waitingReason: "external_reconciliation" });
});

test("cancellation and the run deadline both end a remediation wait", () => {
  const factory = compiled(referenceCodeV1);
  const base = toAcceptance(factory, begin(factory, "remediation-stop", codeInput), 1);
  const rejected = advanceKernel(factory, base.step.state, rejectionFor(base.command, 1, 2));

  const cancelled = advanceKernel(factory, rejected.nextState, { kind: "cancel", id: "cancel", atMs: 3, reason: "OPERATOR_CANCELLED" });
  expect(cancelled.nextState.status).toBe("cancelled");
  expect(cancelled.nextState.nodes.acceptance!.status).toBe("cancelled");
  expect(cancelled.commands.some(command => command.kind === "cancel-run" && command.reason === "OPERATOR_CANCELLED")).toBe(true);

  const expired = advanceKernel(factory, rejected.nextState, { kind: "timer-expired", id: "run-deadline", atMs: rejected.nextState.runDeadlineAtMs, commandId: rejected.nextState.runTimerId });
  expect(expired.nextState.status).toBe("failed");
  expect(expired.commands.some(command => command.kind === "fail-run" && command.error === "RUN_DEADLINE_EXPIRED")).toBe(true);
});

test("remediation preserves recorded spending and replays to the same command identities", () => {
  const factory = compiled(referenceCodeV1);
  const first = toAcceptance(factory, begin(factory, "remediation-replay", codeInput), 1);
  const dispatched = first.step.issued.find(command => command.kind === "dispatch-node" && command.nodeId === "generate-private-candidate");
  if (dispatched?.kind !== "dispatch-node") throw new Error("fixture");

  const settled = apply(factory, first.step, { kind: "usage-settled", id: "usage", atMs: 2, nodeId: "generate-private-candidate", commandId: dispatched.id, candidateGeneration: 0, attempt: 1, revision: 1, knownCostMicros: "1500", unknownCostMicros: "250" }, first.step.queue);
  const rejected = apply(factory, settled, rejectionFor(first.command, 1, 3), settled.queue);
  const repaired = apply(factory, rejected, { kind: "repair", id: "repair-1", atMs: 4, nodeId: "generate-private-candidate", reason: REJECTION, inputOverride: codeGenerateInput("keep the spend") }, rejected.queue);
  const second = toAcceptance(factory, repaired, 5);

  expect(second.step.state.spentCostMicros).toBe("1500");
  expect(second.step.state.unknownCostMicros).toBe("250");
  expect(second.step.state.scopes.root!.spentCostMicros).toBe("1500");
  expect(second.step.state.usageSettlements[dispatched.id]).toMatchObject({ revision: 1, knownCostMicros: "1500" });
  expect(second.step.state.nodes["generate-private-candidate"]!.nextAttempt).toBe(1);

  let replayed = createKernelState(factory, "remediation-replay", codeInput, 0);
  const replayedCommands: KernelCommand[] = [];
  for (const event of second.step.applied) {
    const advanced = advanceKernel(factory, replayed, event);
    replayed = advanced.nextState;
    replayedCommands.push(...advanced.commands);
  }
  expect(replayedCommands.map(command => command.id)).toEqual(second.step.issued.map(command => command.id));
  expect(replayed).toEqual(second.step.state);
  expect(() => assertKernelContinuationState(factory, replayed)).not.toThrow();
});

test("no stop path asks a worker to cancel a decision that has no attempt to cancel", () => {
  const factory = acceptanceFixture(1);
  const inFlight = toAcceptance(factory, begin(factory, "virtual-stops", { request: "build it" }), 1);
  expect(inFlight.step.state.nodes.accept).toMatchObject({ status: "waiting" });

  // Run cancellation, the run deadline, and an invalid decision output each settle it in place.
  const cancelled = advanceKernel(factory, inFlight.step.state, { kind: "cancel", id: "cancel", atMs: 2, reason: "OPERATOR_CANCELLED" });
  expect(cancelCommandNodeIds(cancelled.commands)).toEqual([]);
  expect(cancelled.nextState.nodes.accept).toMatchObject({ status: "cancelled" });
  expect(cancelled.nextState.status).toBe("cancelled");

  const expired = advanceKernel(factory, inFlight.step.state, { kind: "timer-expired", id: "run-deadline", atMs: inFlight.step.state.runDeadlineAtMs, commandId: inFlight.step.state.runTimerId });
  expect(cancelCommandNodeIds(expired.commands)).toEqual([]);
  expect(expired.nextState.status).toBe("failed");

  const invalid = advanceKernel(factory, inFlight.step.state, { kind: "node-result", id: "bad-output", atMs: 2, nodeId: "accept", commandId: inFlight.command.id, candidateGeneration: 0, attempt: 1, output: { acceptedCandidate: 7 } });
  expect(cancelCommandNodeIds(invalid.commands)).toEqual([]);
  expect(invalid.nextState.nodes.accept).toMatchObject({ status: "failed", error: "OUTPUT_INVALID" });
  expect(invalid.nextState.status).toBe("failed");

  // An infrastructure failure is still a failure, but it is never answered with a stop command.
  const infrastructure = advanceKernel(factory, inFlight.step.state, { kind: "node-failed", id: "infra", atMs: 2, nodeId: "accept", commandId: inFlight.command.id, candidateGeneration: 0, attempt: 1, error: "VALIDATOR_UNREACHABLE" });
  expect(cancelCommandNodeIds(infrastructure.commands)).toEqual([]);
  expect(infrastructure.nextState.nodes.accept).toMatchObject({ status: "failed", error: "VALIDATOR_UNREACHABLE" });
  expect(infrastructure.nextState.status).toBe("failed");

  // A task in the same graph still gets the physical stop its attempt needs.
  const running = begin(factory, "physical-stop", { request: "build it" });
  const admission = running.queue.find(command => command.kind === "request-admission");
  if (admission?.kind !== "request-admission") throw new Error("fixture");
  const admitted = apply(factory, running, answer(admission, 1)!, running.queue);
  const cancelledTask = advanceKernel(factory, admitted.state, { kind: "cancel", id: "cancel-task", atMs: 2, reason: "OPERATOR_CANCELLED" });
  expect(cancelCommandNodeIds(cancelledTask.commands)).toEqual(["candidate"]);
});
