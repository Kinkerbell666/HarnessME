import { expect, test } from "bun:test";
import { compileFactory } from "./compiler";
import { advanceKernel, assertKernelContinuationState, createKernelState, currentEffectCommandMatches } from "./kernel";
import { referenceCatalogV1, referenceCodeV1 } from "./references";
import type { CompiledFactory, FactoryDefinition, FactoryReference, KernelCommand, KernelState } from "./index";
import { mutableClone } from "../tests/mutable";

const stringPort = { type: "string" as const };

function compiled(definition: FactoryDefinition): CompiledFactory {
  const result = compileFactory(definition);
  if (!result.ok) throw new Error(result.diagnostics.map(item => item.code).join(","));
  return result.factory;
}

function taskFactory(): CompiledFactory {
  const definition = mutableClone(referenceCodeV1);
  definition.inputPorts = { source: stringPort };
  definition.outputPorts = { result: stringPort };
  definition.graph = {
    nodes: [{
      id: "candidate",
      kind: "task",
      runner: structuredClone(referenceCodeV1.graph.nodes[1] as Extract<(typeof referenceCodeV1.graph.nodes)[number], { kind: "task" }>).runner,
      inputPorts: { source: stringPort, instruction: stringPort },
      bindings: { source: { kind: "ref", root: "input", name: "source" }, instruction: { kind: "literal", value: "first" } },
      repairableInputs: ["instruction"],
      outputPorts: { result: stringPort },
    }, {
      id: "hold",
      kind: "task",
      runner: structuredClone(referenceCodeV1.graph.nodes[1] as Extract<(typeof referenceCodeV1.graph.nodes)[number], { kind: "task" }>).runner,
      inputPorts: { source: stringPort },
      bindings: { source: { kind: "ref", root: "input", name: "source" } },
      outputPorts: {},
    }],
    outputs: { result: { kind: "ref", root: "node", name: "candidate", path: ["result"] } },
  };
  return compiled(definition);
}

function childFactory(): CompiledFactory {
  const definition = mutableClone(referenceCatalogV1);
  const original = definition.graph.nodes.find(node => node.id === "static-catalog-code")!;
  if (original.kind !== "subfactory") throw new Error("fixture");
  definition.inputPorts = { source: stringPort };
  definition.outputPorts = { result: stringPort };
  definition.graph = {
    nodes: [{
      ...original,
      id: "child",
      dependsOn: [],
      inputPorts: { source: stringPort, instruction: stringPort },
      bindings: { source: { kind: "ref", root: "input", name: "source" }, instruction: { kind: "literal", value: "first" } },
      repairableInputs: ["instruction"],
      outputPorts: { result: stringPort },
    }],
    outputs: { result: { kind: "ref", root: "node", name: "child", path: ["result"] } },
  };
  return compiled(definition);
}

function start(factory: CompiledFactory, runId: string): { state: KernelState; commands: readonly KernelCommand[] } {
  const result = advanceKernel(factory, createKernelState(factory, runId, { source: "protected" }, 0), { kind: "start", id: `${runId}:start`, atMs: 0 });
  return { state: result.nextState, commands: result.commands };
}

test("repair changes only opted-in literal input and preserves prior candidate evidence", () => {
  const factory = taskFactory();
  const started = start(factory, "repair-input");
  const admission = started.commands.find(command => command.kind === "request-admission" && command.nodeId === "candidate")!;
  const admittedFirst = advanceKernel(factory, started.state, { kind: "admission-result", id: "admitted", atMs: 1, nodeId: "candidate", commandId: admission.id, candidateGeneration: 0, granted: true });
  const dispatch = admittedFirst.commands.find(command => command.kind === "dispatch-node")!;
  const current = advanceKernel(factory, admittedFirst.nextState, { kind: "node-result", id: "done", atMs: 2, nodeId: "candidate", commandId: dispatch.id, candidateGeneration: 0, attempt: 1, output: { result: "old" } });

  expect(() => advanceKernel(factory, current.nextState, { kind: "repair", id: "protected-change", atMs: 4, nodeId: "candidate", reason: "repair", inputOverride: { source: "changed", instruction: "second" } })).toThrow("protected binding");
  const repaired = advanceKernel(factory, current.nextState, { kind: "repair", id: "repair", atMs: 4, nodeId: "candidate", reason: "repair", inputOverride: { source: "protected", instruction: "second" } });
  expect(repaired.nextState.nodes.candidate).toMatchObject({ candidateGeneration: 1, inputOverride: { source: "protected", instruction: "second" }, priorCandidates: [{ candidateGeneration: 0, inputOverride: { source: "protected", instruction: "first" }, output: { result: "old" } }] });
  const nextAdmission = repaired.commands.find(command => command.kind === "request-admission")!;
  const admitted = advanceKernel(factory, repaired.nextState, { kind: "admission-result", id: "readmitted", atMs: 4, nodeId: "candidate", commandId: nextAdmission.id, candidateGeneration: 1, granted: true });
  expect(admitted.commands.find(command => command.kind === "dispatch-node")).toMatchObject({ input: { source: "protected", instruction: "second" }, candidateGeneration: 1 });
});

test("replan waits for the current child attempt and dispatches only the sealed replacement", () => {
  const factory = childFactory();
  const current = start(factory, "replan-child");
  const active = current.commands.find(command => command.kind === "run-child")!;
  const original = (factory.definition.graph.nodes[0] as Extract<(typeof factory.definition.graph.nodes)[number], { kind: "subfactory" }>).factory;
  const replacement: FactoryReference = { id: original.id, version: "2", digest: `sha256:${"d".repeat(64)}` };
  const replanning = advanceKernel(factory, current.state, { kind: "replan", id: "replan", atMs: 1, nodeId: "child", reason: "replace defective transform", replacement, inputOverride: { source: "protected", instruction: "second" } });
  expect(replanning.nextState.pendingRepair).toMatchObject({ rootNodeId: "child", priorFactory: original, factoryOverride: replacement, inputOverride: { source: "protected", instruction: "second" } });
  expect(replanning.commands).toContainEqual(expect.objectContaining({ kind: "cancel-node", attemptCommandId: active.id }));
  expect(replanning.commands.some(command => command.kind === "run-child")).toBe(false);

  const stopped = advanceKernel(factory, replanning.nextState, { kind: "attempt-stopped", id: "stopped", atMs: 2, nodeId: "child", commandId: active.id, candidateGeneration: 0, attempt: 1 });
  expect(stopped.nextState.nodes.child).toMatchObject({ candidateGeneration: 1, factoryOverride: replacement, inputOverride: { source: "protected", instruction: "second" }, priorCandidates: [{ candidateGeneration: 0, factoryOverride: original, inputOverride: { source: "protected", instruction: "first" } }] });
  expect(stopped.commands.find(command => command.kind === "run-child")).toMatchObject({ factory: replacement, input: { source: "protected", instruction: "second" }, candidateGeneration: 1 });
  expect(() => assertKernelContinuationState(factory, stopped.nextState)).not.toThrow();
  expect(() => assertKernelContinuationState(factory, { ...stopped.nextState, nodes: { ...stopped.nextState.nodes, child: { ...stopped.nextState.nodes.child, factoryOverride: { ...replacement, id: "foreign" } } } })).toThrow("factory override");
  expect(() => assertKernelContinuationState(factory, { ...replanning.nextState, pendingRepair: { ...replanning.nextState.pendingRepair!, inputOverride: { source: "protected" } } })).toThrow("input override");
});

test("replan rejects another factory and ordinary repair keeps the current child override", () => {
  const factory = childFactory();
  const current = start(factory, "replan-fence");
  const original = (factory.definition.graph.nodes[0] as Extract<(typeof factory.definition.graph.nodes)[number], { kind: "subfactory" }>).factory;
  const foreign = { id: "foreign", version: "2", digest: `sha256:${"e".repeat(64)}` };
  const rejected = advanceKernel(factory, current.state, { kind: "replan", id: "foreign", atMs: 1, nodeId: "child", reason: "foreign", replacement: foreign });
  expect(rejected.nextState.pendingRepair).toBeUndefined();
  expect(rejected.commands).toEqual([]);
  const missing = advanceKernel(factory, current.state, { kind: "replan", id: "missing", atMs: 1, nodeId: "missing", reason: "missing", replacement: original });
  expect(missing.nextState.pendingRepair).toBeUndefined();
  expect(missing.commands).toEqual([]);
});

test("protected effect comparison rejects state that can no longer resolve its sealed input", () => {
  const definition = mutableClone(referenceCodeV1);
  definition.inputPorts = { candidate: stringPort, evidence: stringPort };
  definition.outputPorts = {};
  definition.graph = {
    nodes: [{
      id: "accept",
      kind: "acceptance",
      contract: definition.acceptance.id,
      candidate: { kind: "ref", root: "input", name: "candidate" },
      evidence: { kind: "ref", root: "input", name: "evidence" },
      outputPorts: { acceptedCandidate: stringPort },
    }],
    outputs: {},
  };
  const factory = compiled(definition);
  const started = advanceKernel(factory, createKernelState(factory, "protected-input-corrupt", { candidate: "candidate", evidence: "evidence" }, 0), { kind: "start", id: "start", atMs: 0 });
  const command = started.commands.find(value => value.kind === "request-acceptance");
  if (command?.kind !== "request-acceptance") throw new Error("acceptance command is missing");

  expect(currentEffectCommandMatches(factory, started.nextState, command)).toBe(true);
  expect(currentEffectCommandMatches(factory, { ...started.nextState, input: {} }, command)).toBe(false);
});

test("a node that fails for good while a sibling runs stops the run once: one epoch step, and the sibling's cancel carries it", () => {
  // Defect 2 (W01h): the product's run fence follows exactly this epoch, so the
  // sibling's cancel-node must carry the value the stopping transition raised.
  const definition = mutableClone(taskFactory().definition);
  definition.graph.nodes = definition.graph.nodes.map(node => node.id === "candidate" ? { ...node, retry: { maxAttempts: 1, initialDelayMs: 1_000, maximumDelayMs: 2_000 } } : node);
  const factory = compiled(definition);
  let current = start(factory, "sibling-failure");
  for (const nodeId of ["candidate", "hold"]) {
    const admission = current.commands.find(command => command.kind === "request-admission" && command.nodeId === nodeId)!;
    const admitted = advanceKernel(factory, current.state, { kind: "admission-result", id: `admitted-${nodeId}`, atMs: 1, nodeId, commandId: admission.id, candidateGeneration: 0, granted: true });
    current = { state: admitted.nextState, commands: [...current.commands, ...admitted.commands] };
  }
  const dispatch = (nodeId: string) => current.commands.find((command): command is Extract<KernelCommand, { kind: "dispatch-node" }> => command.kind === "dispatch-node" && command.nodeId === nodeId)!;
  expect(current.state.cancellationEpoch).toBe(0);
  const failed = advanceKernel(factory, current.state, { kind: "node-failed", id: "candidate-failed", atMs: 2, nodeId: "candidate", commandId: dispatch("candidate").id, candidateGeneration: 0, attempt: 1, error: "RUNNER_CONTAINER_EXIT", failureKind: "execution" });
  // Stopping one failed attempt is not a run stop: the epoch stays.
  expect(failed.nextState.cancellationEpoch).toBe(0);
  const cancelOwn = failed.commands.find(command => command.kind === "cancel-node")!;
  const exhausted = advanceKernel(factory, failed.nextState, { kind: "attempt-stopped", id: "candidate-stopped", atMs: 3, nodeId: "candidate", commandId: dispatch("candidate").id, candidateGeneration: 0, attempt: 1 });
  expect(cancelOwn).toMatchObject({ cancellationEpoch: 0 });
  // The node failed for good, so the run stops: one step, and the sibling is cancelled at the new epoch.
  expect(exhausted.nextState).toMatchObject({ status: "stopping", cancellationEpoch: 1 });
  expect(exhausted.commands).toContainEqual(expect.objectContaining({ kind: "cancel-node", nodeId: "hold", attemptCommandId: dispatch("hold").id, cancellationEpoch: 1 }));
  const settled = advanceKernel(factory, exhausted.nextState, { kind: "attempt-stopped", id: "hold-stopped", atMs: 4, nodeId: "hold", commandId: dispatch("hold").id, candidateGeneration: 0, attempt: 1 });
  expect(settled.nextState.cancellationEpoch).toBe(1);
  expect(settled.commands).toContainEqual(expect.objectContaining({ kind: "fail-run" }));
});

/** A waiting approval gate, with the task either gated behind it or running beside it. */
function approvalFactory(taskDependsOnGate: boolean): CompiledFactory {
  const definition = mutableClone(taskFactory().definition);
  const task = { ...definition.graph.nodes.find(node => node.id === "hold")!, ...(taskDependsOnGate ? { dependsOn: ["gate"] } : {}) };
  definition.graph = {
    nodes: [{ id: "gate", kind: "approval", choices: ["approve", "deny"], context: { kind: "literal", value: null }, actorScope: "operator", expiresInMs: 60_000, onDenied: "fail", onExpired: "fail" }, task],
    outputs: {},
  };
  definition.outputPorts = {};
  return compiled(definition);
}

function waitingGate(factory: CompiledFactory, runId: string) {
  const started = advanceKernel(factory, createKernelState(factory, runId, { source: "source" }, 0), { kind: "start", id: "start", atMs: 0 });
  const request = started.commands.find((command): command is Extract<KernelCommand, { kind: "request-approval" }> => command.kind === "request-approval")!;
  const expiry = started.commands.find((command): command is Extract<KernelCommand, { kind: "start-timer" }> => command.kind === "start-timer" && command.nodeId === "gate")!;
  expect(started.nextState.nodes.gate).toMatchObject({ status: "waiting", waitingReason: "approval" });
  return { state: started.nextState, request, expiry };
}

// W01h: an approval's attempt is a human request, so no stop of it may wait for a cancel-node
// that the attempt queue can only refuse. Every stop of a waiting gate settles it in place.
test.each([
  ["denied in the inbox", "failed", "APPROVAL_DENIED"],
  ["past its own expiry", "failed", "APPROVAL_EXPIRED"],
  ["cancelled by a user", "cancelled", "user stop"],
  ["past the run deadline", "failed", "RUN_DEADLINE_EXPIRED"],
] as const)("an approval gate %s ends its run in the same transition, with no cancel-node", (label, status, reason) => {
  const factory = approvalFactory(true);
  const { state, request, expiry } = waitingGate(factory, `gate-${label.replaceAll(" ", "-")}`);
  const event = label === "denied in the inbox" ? { kind: "approval-decided" as const, id: "deny", atMs: 1, nodeId: "gate", commandId: request.id, choice: "deny" }
    : label === "past its own expiry" ? { kind: "timer-expired" as const, id: "expired", atMs: expiry.deadlineAtMs, nodeId: "gate", commandId: expiry.id }
    : label === "cancelled by a user" ? { kind: "cancel" as const, id: "cancel", atMs: 1, reason: "user stop" }
    : { kind: "timer-expired" as const, id: "deadline", atMs: state.runDeadlineAtMs, commandId: state.runTimerId! };
  const ended = advanceKernel(factory, state, event);
  expect(ended.commands.some(command => command.kind === "cancel-node")).toBe(false);
  expect(ended.nextState).toMatchObject({ status, cancellationEpoch: 1 });
  expect(ended.nextState.nodes.gate?.attempts.every(attempt => attempt.stopped)).toBe(true);
  if (status === "failed") expect(ended.commands).toContainEqual(expect.objectContaining({ kind: "fail-run", error: reason }));
  else expect(ended.commands).toContainEqual(expect.objectContaining({ kind: "cancel-run" }));
  // A decision that arrives after the stop changes nothing.
  expect(advanceKernel(factory, ended.nextState, { kind: "approval-decided", id: "late", atMs: 2, nodeId: "gate", commandId: request.id, choice: "approve" }).commands).toEqual([]);
});

test("a denied gate beside a running task stops only the task physically, then fails the run", () => {
  const factory = approvalFactory(false);
  const { state, request } = waitingGate(factory, "gate-beside-task");
  const denied = advanceKernel(factory, state, { kind: "approval-decided", id: "deny", atMs: 1, nodeId: "gate", commandId: request.id, choice: "deny" });
  const cancels = denied.commands.filter((command): command is Extract<KernelCommand, { kind: "cancel-node" }> => command.kind === "cancel-node");
  expect(cancels.map(command => command.nodeId)).toEqual(["hold"]);
  expect(denied.nextState).toMatchObject({ status: "stopping", cancellationEpoch: 1 });
  expect(denied.nextState.nodes.gate).toMatchObject({ status: "failed", error: "APPROVAL_DENIED" });
  const stopped = advanceKernel(factory, denied.nextState, { kind: "attempt-stopped", id: "hold-stopped", atMs: 2, nodeId: "hold", commandId: cancels[0]!.attemptCommandId, candidateGeneration: 0, attempt: cancels[0]!.attempt });
  expect(stopped.nextState.status).toBe("failed");
  expect(stopped.commands).toContainEqual(expect.objectContaining({ kind: "fail-run", error: "APPROVAL_DENIED" }));
});

/** One task node alone, so a run's whole fate follows that node's admission. */
function singleTaskFactory(): CompiledFactory {
  const definition = mutableClone(referenceCodeV1);
  definition.inputPorts = { source: stringPort };
  definition.outputPorts = { result: stringPort };
  definition.graph = {
    nodes: [{
      id: "candidate",
      kind: "task",
      runner: structuredClone(referenceCodeV1.graph.nodes[1] as Extract<(typeof referenceCodeV1.graph.nodes)[number], { kind: "task" }>).runner,
      inputPorts: { source: stringPort },
      bindings: { source: { kind: "ref", root: "input", name: "source" } },
      outputPorts: { result: stringPort },
    }],
    outputs: { result: { kind: "ref", root: "node", name: "candidate", path: ["result"] } },
  };
  return compiled(definition);
}

test("a denied admission ends its attempt: the run fails by name and cancels nothing that never existed (W02d R9)", () => {
  const factory = singleTaskFactory();
  const current = start(factory, "admission-denied");
  const admission = current.commands.find(command => command.kind === "request-admission" && command.nodeId === "candidate")!;
  const denied = advanceKernel(factory, current.state, { kind: "admission-result", id: "denied", atMs: 1, nodeId: "candidate", commandId: admission.id, candidateGeneration: 0, granted: false });
  // The pool assigned nothing, so there is no process to stop and no cancel that could ever settle.
  expect(denied.commands.filter(command => command.kind === "cancel-node")).toEqual([]);
  expect(denied.nextState.nodes.candidate).toMatchObject({ status: "failed", error: "ADMISSION_DENIED" });
  expect(denied.nextState.nodes.candidate!.attempts.every(attempt => attempt.stopped)).toBe(true);
  expect(denied.nextState.status).toBe("failed");
});

/** An accepted candidate whose release is in flight: the run's only physical-free external effect (W09e). */
function releasingRun(runId: string) {
  const definition = mutableClone(taskFactory().definition);
  const releaseTemplate = referenceCodeV1.graph.nodes.find(node => node.kind === "release")!;
  const artifact = { digest: `sha256:${"a".repeat(64)}`, mediaType: "application/json", storage: "immutable" };
  definition.graph = {
    nodes: [
      { id: "accept", kind: "acceptance", contract: referenceCodeV1.acceptance.id, candidate: { kind: "literal", value: artifact }, evidence: { kind: "literal", value: null }, outputPorts: { acceptedCandidate: { type: "object", additionalProperties: true } } },
      { ...mutableClone(releaseTemplate), id: "release", dependsOn: ["accept"], acceptedCandidate: { kind: "ref", root: "node", name: "accept", path: ["acceptedCandidate"] }, destination: { kind: "literal", value: "destination" } },
    ],
    outputs: {},
  };
  definition.outputPorts = {};
  const factory = compiled(definition);
  const started = advanceKernel(factory, createKernelState(factory, runId, { source: "source" }, 0), { kind: "start", id: "start", atMs: 0 });
  const acceptance = started.commands.find(command => command.kind === "request-acceptance")!;
  const releasing = advanceKernel(factory, started.nextState, { kind: "node-result", id: "accepted", atMs: 1, nodeId: "accept", commandId: acceptance.id, candidateGeneration: 0, attempt: 1, output: { acceptedCandidate: artifact } });
  const release = releasing.commands.find(command => command.kind === "request-release")!;
  const cancelled = advanceKernel(factory, releasing.nextState, { kind: "cancel", id: "user-cancel", atMs: 2, reason: "user stop" });
  const cancel = cancelled.commands.find((command): command is Extract<KernelCommand, { kind: "cancel-node" }> => command.kind === "cancel-node")!;
  return { factory, state: cancelled.nextState, release, cancel };
}

const releaseStop = (cancel: Extract<KernelCommand, { kind: "cancel-node" }>, values: Record<string, unknown>) =>
  ({ kind: "attempt-stopped", id: `${cancel.id}:stopped`, atMs: 3, nodeId: cancel.nodeId, commandId: cancel.attemptCommandId, candidateGeneration: cancel.candidateGeneration, attempt: cancel.attempt, ...values }) as never;

// W09e R2: a release's stop is certain (the node stops, the run ends) while its external effect may not be.
test.each([
  ["uncertain", "RELEASE_EFFECT_UNCERTAIN"],
  ["published", "RELEASE_PUBLISHED_BEFORE_STOP"],
] as const)("a release stopped with its effect %s ends the run and names the effect on the node", (effect, error) => {
  const { factory, state, cancel } = releasingRun(`release-${effect}`);
  expect(cancel).toMatchObject({ nodeId: "release" });
  const ended = advanceKernel(factory, state, releaseStop(cancel, { uncertain: false, effect }));
  expect(ended.nextState.status).toBe("cancelled");
  expect(ended.commands).toContainEqual(expect.objectContaining({ kind: "cancel-run" }));
  expect(ended.nextState.nodes.release).toMatchObject({ status: "cancelled", error });
  expect(ended.nextState.unresolvedUncertainNodeIds).toEqual([]);
});

test("a stop effect is refused unless it is a known effect on a release node's certain stop", () => {
  const { factory, state, cancel } = releasingRun("release-refusals");
  for (const values of [{ effect: "maybe" }, { uncertain: true, effect: "uncertain" }]) {
    expect(() => advanceKernel(factory, state, releaseStop(cancel, values))).toThrow("an attempt-stopped effect names a release's external effect and needs a certain stop");
  }
  const tasks = taskFactory();
  const started = start(tasks, "task-effect");
  const admission = started.commands.find(command => command.kind === "request-admission" && command.nodeId === "hold")!;
  const admitted = advanceKernel(tasks, started.state, { kind: "admission-result", id: "admitted", atMs: 1, nodeId: "hold", commandId: admission.id, candidateGeneration: 0, granted: true });
  const dispatch = admitted.commands.find((command): command is Extract<KernelCommand, { kind: "dispatch-node" }> => command.kind === "dispatch-node")!;
  expect(() => advanceKernel(tasks, admitted.nextState, { kind: "attempt-stopped", id: "task-effect", atMs: 2, nodeId: "hold", commandId: dispatch.id, candidateGeneration: 0, attempt: dispatch.attempt, effect: "uncertain" } as never))
    .toThrow("an attempt-stopped effect names a release's external effect and needs a certain stop");
});

/** Both task nodes wait for compute admission when the user cancels; each gets a cancel-node naming its admission. */
function cancelledWhileReserved(runId: string) {
  const factory = taskFactory();
  const started = start(factory, runId);
  const cancelled = advanceKernel(factory, started.state, { kind: "cancel", id: `${runId}:cancel`, atMs: 1, reason: "user stop" });
  const cancels = cancelled.commands.filter((command): command is Extract<KernelCommand, { kind: "cancel-node" }> => command.kind === "cancel-node");
  return { factory, started, state: cancelled.nextState, cancels };
}

const stoppedBeforeAdmission = (cancel: Extract<KernelCommand, { kind: "cancel-node" }>, values: Record<string, unknown> = {}) =>
  ({ kind: "attempt-stopped", id: `${cancel.id}:stopped`, atMs: 2, nodeId: cancel.nodeId, commandId: cancel.attemptCommandId, candidateGeneration: cancel.candidateGeneration, attempt: cancel.attempt, stoppedBefore: "admission", ...values }) as never;

// W09h R2: a node stopped while it waits for compute admission settles in place; the run ends without the pool.
test("a task stopped before compute admission is cancelled by name and the run ends", () => {
  const { factory, started, state, cancels } = cancelledWhileReserved("admission-stop");
  const admissions = started.commands.filter(command => command.kind === "request-admission");
  expect(cancels.map(cancel => cancel.attemptCommandId).sort()).toEqual(admissions.map(command => command.id).sort());
  expect(state.status).toBe("stopping");
  const ended = cancels.reduce((current, cancel) => advanceKernel(factory, current, stoppedBeforeAdmission(cancel)).nextState, state);
  expect(ended.status).toBe("cancelled");
  for (const cancel of cancels) expect(ended.nodes[cancel.nodeId]).toMatchObject({ status: "cancelled", error: "STOPPED_BEFORE_ADMISSION" });
  expect(ended.unresolvedUncertainNodeIds).toEqual([]);
});

test("stopped before admission is refused unless it is a task's certain stop with no release effect", () => {
  const { factory, state, cancels } = cancelledWhileReserved("admission-stop-refusals");
  for (const values of [{ stoppedBefore: "dispatch" }, { uncertain: true }]) {
    expect(() => advanceKernel(factory, state, stoppedBeforeAdmission(cancels[0]!, values))).toThrow("an attempt-stopped before admission names a task's certain stop and no effect");
  }
  // A release effect on a task is already refused by W09e's rule, before this one is reached.
  expect(() => advanceKernel(factory, state, stoppedBeforeAdmission(cancels[0]!, { uncertain: false, effect: "uncertain" }))).toThrow("an attempt-stopped effect names a release's external effect and needs a certain stop");
  const { factory: releases, state: releasing, cancel } = releasingRun("admission-stop-release");
  expect(() => advanceKernel(releases, releasing, stoppedBeforeAdmission(cancel))).toThrow("an attempt-stopped before admission names a task's certain stop and no effect");
});
