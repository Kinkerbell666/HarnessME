import { describe, expect, test } from "bun:test";
import { compileFactory } from "./compiler";
import { FACTORY_COMMAND_FAILED_DETAIL_LIMIT, FactoryKernelError, advanceKernel, createKernelState, factoryAdmissionRefusedEvent, factoryCommandFailedEvent } from "./kernel";
import { referenceCodeV1 } from "./references.js";
import { FACTORY_LAZY_INPUT_SCHEMA_VERSION } from "./types";
import type { CompiledFactory, Effect, FactoryDefinition, FactoryNode, JsonValue } from "./types";
import { findCommand } from "../tests/kernel-commands";

const digest = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const runner = { package: "inert", manifestName: "inert", version: "1", digest, export: "run" } as const;

function compiled(nodes: readonly FactoryNode[], _outputs: Record<string, { readonly kind: "ref"; readonly root: "node"; readonly name: string }>, inputPorts: FactoryDefinition["inputPorts"] = {}): CompiledFactory {
  const normalize = (node: FactoryNode): FactoryNode => {
    if (node.kind === "map") return { ...node, outputPorts: node.outputPorts ?? {}, body: { ...node.body, nodes: node.body.nodes.map(normalize), outputs: node.body.outputs } };
    if (node.kind === "loop") return { ...node, outputPorts: node.outputPorts ?? {}, body: { ...node.body, nodes: node.body.nodes.map(normalize), outputs: node.body.outputs } };
    if (node.kind === "branch") return { ...node, outputPorts: node.outputPorts ?? {}, then: { ...node.then, nodes: node.then.nodes.map(normalize) }, else: { ...node.else, nodes: node.else.nodes.map(normalize) } };
    return node;
  };
  const definition: FactoryDefinition = {
    schemaVersion: "factory.v1", id: "kernel-event-regression", version: "1", interpreterCompatibility: "1",
    inputPorts, outputPorts: {}, graph: { nodes: nodes.map(normalize), outputs: {} },
    acceptance: referenceCodeV1.acceptance,
    packages: [{ name: runner.package, version: runner.version, digest }, ...referenceCodeV1.packages],
    capabilities: [], effects: [...new Set<Effect>(["none", ...nodes.flatMap((node) => node.effects ?? [])])], bounds: { maxExpandedNodes: 10_000, maxScopeDepth: 16 },
  };
  const result = compileFactory(definition);
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.code).join(", "));
  return result.factory;
}

const event = <const T extends object>(id: string, values: T): T & { readonly id: string; readonly atMs: number } => ({ id, atMs: 1, ...values });

function activeWork(graph: CompiledFactory, runId: string) {
  const started = advanceKernel(graph, createKernelState(graph, runId, {}, 0), event("start", { kind: "start" }));
  const admission = findCommand(started.commands, "request-admission", "work");
  if (!admission) throw new Error("work admission was not emitted");
  return advanceKernel(graph, started.nextState, event("admit", {
    kind: "admission-result", nodeId: "work", commandId: admission.id, candidateGeneration: admission.candidateGeneration, granted: true,
  })).nextState;
}

function dispatchedAttempt(state: import("./kernel-types").KernelState, nodeId: string) {
  const attempt = state.nodes[nodeId]?.attempts.at(-1);
  if (!attempt) throw new Error(`missing dispatched attempt for ${nodeId}`);
  return attempt;
}

describe("factory kernel", () => {
  test("completes a valid empty root graph immediately", () => {
    const graph = compiled([], {});
    const result = advanceKernel(graph, createKernelState(graph, "empty", {}, 0), event("start", { kind: "start" }));
    expect(result.nextState.status).toBe("completed");
    expect(result.commands.find((command) => command.kind === "complete-run")).toEqual(expect.objectContaining({ kind: "complete-run", output: {} }));
  });

  test("records known and uncertain usage as persistent decimal ledger entries", () => {
    const graph = compiled([{ id: "work", kind: "task", runner }], { result: { kind: "ref", root: "node", name: "work" } });
    const state = activeWork(graph, "usage");
    const work = dispatchedAttempt(state, "work");
    const settled = advanceKernel(graph, state, { kind: "usage-settled", id: "usage-1", atMs: 1, nodeId: "work", commandId: work.commandId, candidateGeneration: work.candidateGeneration, attempt: work.attempt, revision: 1, knownCostMicros: "12", unknownCostMicros: "3" });
    expect(settled.nextState.spentCostMicros).toBe("12");
    expect(settled.nextState.unknownCostMicros).toBe("3");
    expect(advanceKernel(graph, settled.nextState, { kind: "usage-settled", id: "usage-1", atMs: 2, nodeId: "work", commandId: work.commandId, candidateGeneration: work.candidateGeneration, attempt: work.attempt, revision: 1, knownCostMicros: "99" }).nextState.spentCostMicros).toBe("12");
  });

  test("rejects malformed and negative recorded usage charges", () => {
    const graph = compiled([{ id: "work", kind: "task", runner }], { result: { kind: "ref", root: "node", name: "work" } });
    const state = activeWork(graph, "usage-invalid");
    const work = dispatchedAttempt(state, "work");
    const settlement = { nodeId: "work", commandId: work.commandId, candidateGeneration: work.candidateGeneration, attempt: work.attempt, revision: 1 };
    expect(() => advanceKernel(graph, state, { kind: "usage-settled", id: "negative", atMs: 1, ...settlement, knownCostMicros: "-1" })).toThrow("usage cost");
    expect(() => advanceKernel(graph, state, { kind: "usage-settled", id: "decimal", atMs: 1, ...settlement, knownCostMicros: "1.5" })).toThrow("usage cost");
    expect(() => advanceKernel(graph, state, { kind: "usage-settled", id: "unsafe", atMs: 1, ...settlement, knownCostMicros: "01" })).toThrow("usage cost");
  });

  test("rejects a settlement for a nonexistent node without changing the run ledger", () => {
    const graph = compiled([{ id: "work", kind: "task", runner }], { result: { kind: "ref", root: "node", name: "work" } });
    const initial = createKernelState(graph, "usage-fence", {}, 0);
    const settled = advanceKernel(graph, initial, { kind: "usage-settled", id: "unknown-node", atMs: 1, nodeId: "does-not-exist", commandId: "missing", candidateGeneration: 0, attempt: 1, revision: 1, knownCostMicros: "7" });
    expect(settled.nextState.spentCostMicros).toBe("0");
    expect(settled.nextState.unknownCostMicros).toBe("0");
  });

  test("settlements fence the attempt and reconcile cumulative revisions without double charging", () => {
    const graph = compiled([{ id: "work", kind: "task", runner }], { result: { kind: "ref", root: "node", name: "work" } });
    const state = activeWork(graph, "usage-revision");
    const work = dispatchedAttempt(state, "work");
    const initial = advanceKernel(graph, state, { kind: "usage-settled", id: "delivery-a", atMs: 1, nodeId: "work", commandId: work.commandId, candidateGeneration: work.candidateGeneration, attempt: work.attempt, revision: 1, knownCostMicros: "4", unknownCostMicros: "6" });
    expect(initial.nextState.spentCostMicros).toBe("4");
    expect(initial.nextState.unknownCostMicros).toBe("6");
    const duplicate = advanceKernel(graph, initial.nextState, { kind: "usage-settled", id: "delivery-b", atMs: 2, nodeId: "work", commandId: work.commandId, candidateGeneration: work.candidateGeneration, attempt: work.attempt, revision: 1, knownCostMicros: "4", unknownCostMicros: "6" });
    expect(duplicate.nextState.spentCostMicros).toBe("4");
    const reconciled = advanceKernel(graph, duplicate.nextState, { kind: "usage-settled", id: "delivery-c", atMs: 3, nodeId: "work", commandId: work.commandId, candidateGeneration: work.candidateGeneration, attempt: work.attempt, revision: 2, knownCostMicros: "10", unknownCostMicros: "0" });
    expect(reconciled.nextState.spentCostMicros).toBe("10");
    expect(reconciled.nextState.unknownCostMicros).toBe("0");
    expect(() => advanceKernel(graph, reconciled.nextState, { kind: "usage-settled", id: "delivery-conflict", atMs: 4, nodeId: "work", commandId: work.commandId, candidateGeneration: work.candidateGeneration, attempt: work.attempt, revision: 2, knownCostMicros: "11" })).toThrow(FactoryKernelError);
    const stale = advanceKernel(graph, reconciled.nextState, { kind: "usage-settled", id: "delivery-stale", atMs: 5, nodeId: "work", commandId: work.commandId, candidateGeneration: work.candidateGeneration, attempt: work.attempt, revision: 1, knownCostMicros: "4", unknownCostMicros: "6" });
    expect(stale.nextState.spentCostMicros).toBe("10");
    expect(() => advanceKernel(graph, reconciled.nextState, { kind: "usage-settled", id: "delivery-gap", atMs: 5, nodeId: "work", commandId: work.commandId, candidateGeneration: work.candidateGeneration, attempt: work.attempt, revision: 4, knownCostMicros: "10" })).toThrow(FactoryKernelError);
  });

  test("uses stable command identities and independently advances a ready successor", () => {
    const graph = compiled([
      { id: "first", kind: "task", runner },
      { id: "second", kind: "task", runner, dependsOn: ["first"] },
    ], { result: { kind: "ref", root: "node", name: "second" } });
    const initial = createKernelState(graph, "run-1", {}, 0);
    const started = advanceKernel(graph, initial, event("start", { kind: "start" }));
    const replay = advanceKernel(graph, createKernelState(graph, "run-1", {}, 0), event("replay-start", { kind: "start" }));
    expect(started.commands.map((command) => command.id)).toEqual(replay.commands.map((command) => command.id));
    expect(started.commands.find((command) => command.kind === "start-timer" && command.nodeId === undefined)).toEqual(expect.objectContaining({ kind: "start-timer", deadlineAtMs: 7 * 24 * 60 * 60 * 1_000 }));
    const admission = findCommand(started.commands, "request-admission", "first");
    expect(admission).toEqual(expect.objectContaining({ kind: "request-admission", nodeId: "first", candidateGeneration: 0, deadlineAtMs: 1_800_001 }));
    const admitted = advanceKernel(graph, started.nextState, event("admit", { kind: "admission-result", nodeId: "first", commandId: admission!.id, candidateGeneration: admission!.candidateGeneration, granted: true }));
    const dispatch = findCommand(admitted.commands, "dispatch-node", "first");
    const timer = started.commands.find((command) => command.kind === "start-timer" && command.nodeId === "first");
    expect(dispatch).toEqual(expect.objectContaining({ kind: "dispatch-node", nodeId: "first", candidateGeneration: 0, attempt: 1, input: {}, deadlineAtMs: 1_800_001, cancellationEpoch: 0 }));
    expect(timer).toEqual(expect.objectContaining({ kind: "start-timer", nodeId: "first", deadlineAtMs: 1_800_001 }));
    const completed = advanceKernel(graph, admitted.nextState, event("result", { kind: "node-result", nodeId: "first", commandId: dispatch!.id, candidateGeneration: dispatch!.candidateGeneration, attempt: dispatch!.attempt, output: { value: 1 } }));
    expect(completed.nextState.nodes.second?.status).toBe("reserved");
    expect(completed.commands.find((command) => command.kind === "request-admission" && command.nodeId === "second")).toEqual(expect.objectContaining({ kind: "request-admission", nodeId: "second", candidateGeneration: 0, deadlineAtMs: 1_800_001 }));
  });

  test("ignores duplicate and stale completion fences", () => {
    const graph = compiled([{ id: "only", kind: "task", runner }], { result: { kind: "ref", root: "node", name: "only" } });
    let state = advanceKernel(graph, createKernelState(graph, "run-2", {}, 0), event("start", { kind: "start" })).nextState;
    const admission = state.nodes.only!.attempts.at(-1)!;
    state = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "only", commandId: admission.commandId, candidateGeneration: admission.candidateGeneration, granted: true })).nextState;
    const only = dispatchedAttempt(state, "only");
    const stale = advanceKernel(graph, state, event("wrong-attempt", { kind: "node-result", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt + 1, output: {} }));
    expect(stale.nextState.nodes.only?.status).toBe("running");
    const complete = advanceKernel(graph, stale.nextState, event("result", { kind: "node-result", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt, output: {} }));
    expect(complete.nextState.status).toBe("completed");
    expect(advanceKernel(graph, complete.nextState, event("result", { kind: "node-result", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt, output: {} })).commands).toEqual([]);
  });

  test("does not retry before an attempt has stopped", () => {
    const graph = compiled([{ id: "only", kind: "task", runner, retry: { maxAttempts: 2, initialDelayMs: 5, maximumDelayMs: 5 } }], { result: { kind: "ref", root: "node", name: "only" } });
    let state = advanceKernel(graph, createKernelState(graph, "run-3", {}, 0), event("start", { kind: "start" })).nextState;
    const admission = state.nodes.only!.attempts.at(-1)!;
    state = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "only", commandId: admission.commandId, candidateGeneration: admission.candidateGeneration, granted: true })).nextState;
    const only = dispatchedAttempt(state, "only");
    const failed = advanceKernel(graph, state, event("failed", { kind: "node-failed", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt, error: "boom" }));
    expect(failed.nextState.nodes.only?.status).toBe("stopping");
    expect(failed.commands.some((command) => command.kind === "request-admission")).toBe(false);
    const stopped = advanceKernel(graph, failed.nextState, event("stopped", { kind: "attempt-stopped", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt }));
    expect(stopped.nextState.nodes.only?.status).toBe("retry_wait");
    expect(stopped.commands.find((command) => command.kind === "start-timer" && command.nodeId === "only")).toEqual(expect.objectContaining({ kind: "start-timer", nodeId: "only", deadlineAtMs: 6 }));
  });

  test("W03f: a node failed by a typed provider error ends the run failed with that reason once its stop is certain, and waits while it is not", () => {
    // One attempt, as the graph proof's nodes are compiled: a node with attempts left would retry instead.
    const graph = compiled([{ id: "only", kind: "task", runner, retry: { maxAttempts: 1, initialDelayMs: 1_000, maximumDelayMs: 2_000 } }], { result: { kind: "ref", root: "node", name: "only" } });
    for (const error of ["provider_unavailable", "provider_auth_failed", "provider_rate_limited", "model_pin_mismatch"]) {
      let state = advanceKernel(graph, createKernelState(graph, `run-provider-${error}`, {}, 0), event("start", { kind: "start" })).nextState;
      const admission = state.nodes.only!.attempts.at(-1)!;
      state = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "only", commandId: admission.commandId, candidateGeneration: admission.candidateGeneration, granted: true })).nextState;
      const only = dispatchedAttempt(state, "only");
      const failed = advanceKernel(graph, state, event("failed", { kind: "node-failed", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt, error, failureKind: "execution" }));
      expect(failed.commands.map((command) => command.kind)).toEqual(["cancel-node"]);
      const stop = { kind: "attempt-stopped", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt } as const;
      // The stop that settled the usage from the journal is certain: the run fails with the provider's reason.
      const certain = advanceKernel(graph, failed.nextState, event("stopped", stop));
      expect(certain.nextState).toMatchObject({ status: "failed", unresolvedUncertainNodeIds: [] });
      expect(certain.commands.filter((command) => command.kind === "fail-run")).toEqual([expect.objectContaining({ kind: "fail-run", error })]);
      // The pre-W03f shape: a held usage makes the stop uncertain, and the run waits on it by name.
      const held = advanceKernel(graph, failed.nextState, event("stopped", { ...stop, uncertain: true }));
      expect(held.nextState.status).not.toBe("failed");
      expect(held.nextState.unresolvedUncertainNodeIds).toEqual(["only"]);
      expect(held.commands.some((command) => command.kind === "fail-run")).toBe(false);
    }
  });

  test("W03f: a refused credential is not retried while attempts remain; a rate limit keeps its retry and backoff", () => {
    const graph = compiled([{ id: "only", kind: "task", runner, retry: { maxAttempts: 2, initialDelayMs: 5, maximumDelayMs: 5 } }], { result: { kind: "ref", root: "node", name: "only" } });
    const stoppedAfter = (error: string) => {
      let state = advanceKernel(graph, createKernelState(graph, `run-retry-${error}`, {}, 0), event("start", { kind: "start" })).nextState;
      const admission = state.nodes.only!.attempts.at(-1)!;
      state = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "only", commandId: admission.commandId, candidateGeneration: admission.candidateGeneration, granted: true })).nextState;
      const only = dispatchedAttempt(state, "only");
      const failed = advanceKernel(graph, state, event("failed", { kind: "node-failed", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt, error, failureKind: "execution" }));
      return advanceKernel(graph, failed.nextState, event("stopped", { kind: "attempt-stopped", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt }));
    };
    // The same credential fails the same way on every attempt, so the attempt sequence ends here.
    const auth = stoppedAfter("provider_auth_failed");
    expect(auth.nextState.nodes.only?.status).toBe("failed");
    expect(auth.nextState.status).toBe("failed");
    expect(auth.commands.filter((command) => command.kind === "fail-run")).toEqual([expect.objectContaining({ kind: "fail-run", error: "provider_auth_failed" })]);
    expect(auth.commands.some((command) => command.kind === "start-timer")).toBe(false);
    // A rate limit passes with time: the existing retry and its backoff stand.
    for (const error of ["provider_rate_limited", "provider_unavailable"]) {
      const retried = stoppedAfter(error);
      expect(retried.nextState.nodes.only?.status).toBe("retry_wait");
      expect(retried.commands.find((command) => command.kind === "start-timer" && command.nodeId === "only")).toEqual(expect.objectContaining({ kind: "start-timer", nodeId: "only", deadlineAtMs: 6 }));
    }
  });

  test("cancellation fences late work and retains uncertainty", () => {
    const graph = compiled([{ id: "only", kind: "task", runner }], { result: { kind: "ref", root: "node", name: "only" } });
    let state = advanceKernel(graph, createKernelState(graph, "run-4", {}, 0), event("start", { kind: "start" })).nextState;
    const admission = state.nodes.only!.attempts.at(-1)!;
    state = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "only", commandId: admission.commandId, candidateGeneration: admission.candidateGeneration, granted: true })).nextState;
    const only = dispatchedAttempt(state, "only");
    const cancelling = advanceKernel(graph, state, event("cancel", { kind: "cancel", reason: "user" }));
    expect(cancelling.nextState.cancellationEpoch).toBe(1);
    expect(cancelling.nextState.status).toBe("stopping");
    const stopped = advanceKernel(graph, cancelling.nextState, event("uncertain", { kind: "attempt-stopped", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt, uncertain: true }));
    expect(stopped.nextState.status).toBe("stopping");
    expect(stopped.nextState.unresolvedUncertainNodeIds).toEqual(["only"]);
  });

  test("a usage-resolved stop clears the uncertain attempt once and ends the cancelled run with its reason, deterministically on replay", () => {
    const graph = compiled([{ id: "only", kind: "task", runner }], { result: { kind: "ref", root: "node", name: "only" } });
    const start = createKernelState(graph, "run-usage-resolved", {}, 0);
    const first = advanceKernel(graph, start, event("start", { kind: "start" })).nextState;
    const admission = first.nodes.only!.attempts.at(-1)!;
    const admitted = advanceKernel(graph, first, event("admit", { kind: "admission-result", nodeId: "only", commandId: admission.commandId, candidateGeneration: admission.candidateGeneration, granted: true })).nextState;
    const only = dispatchedAttempt(admitted, "only");
    const stop = { kind: "attempt-stopped", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt } as const;
    // W05b: reconciliation re-sends the sealed stop as `<cancel>:usage-resolved` with uncertain:false.
    const events = [
      event("start", { kind: "start" }),
      event("admit", { kind: "admission-result", nodeId: "only", commandId: admission.commandId, candidateGeneration: admission.candidateGeneration, granted: true }),
      event("cancel", { kind: "cancel", reason: "factory_package_quarantined" }),
      event("stopped", { ...stop, uncertain: true }),
      event("usage-resolved", { ...stop, uncertain: false }),
    ];
    const fold = () => events.reduce<{ state: typeof start; commands: ReturnType<typeof advanceKernel>["commands"][] }>((acc, next) => { const advanced = advanceKernel(graph, acc.state, next); return { state: advanced.nextState, commands: [...acc.commands, advanced.commands] }; }, { state: start, commands: [] });
    const folded = fold();
    // Before the clearing event the run waits; the clearing event ends it with its reason.
    expect(folded.commands[3]!.some(command => command.kind === "cancel-run")).toBe(false);
    expect(folded.commands[4]).toEqual([expect.objectContaining({ kind: "cancel-run", reason: "factory_package_quarantined" })]);
    expect(folded.state.unresolvedUncertainNodeIds).toEqual([]);
    expect(folded.state.nodes.only!.attempts.at(-1)).toMatchObject({ stopped: true, uncertain: false });
    // Replay from the start produces the same state and the same commands.
    expect(fold()).toEqual(folded);
    // Redelivering the clearing event changes nothing and ends nothing twice.
    const redelivered = advanceKernel(graph, folded.state, events[4]!);
    expect(redelivered.commands).toEqual([]);
    expect(redelivered.nextState).toEqual(folded.state);
  });

  test("a failed effect command stops the run and fails it with the typed reason, never a cancel", () => {
    const graph = compiled([{ id: "only", kind: "task", runner }], { result: { kind: "ref", root: "node", name: "only" } });
    let state = advanceKernel(graph, createKernelState(graph, "run-command-failed", {}, 0), event("start", { kind: "start" })).nextState;
    const admission = state.nodes.only!.attempts.at(-1)!;
    state = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "only", commandId: admission.commandId, candidateGeneration: admission.candidateGeneration, granted: true })).nextState;
    const only = dispatchedAttempt(state, "only");
    const reason = "FACTORY_COMMAND_FAILED: request-release run:release:request-release:7: factory gateway returned HTTP 500";
    const failing = advanceKernel(graph, state, event("failed", { kind: "command-failed", commandId: "run:release:request-release:7", error: reason }));
    // The physical attempt is stopped first, exactly as a run deadline stops it.
    expect(failing.nextState.status).toBe("stopping");
    expect(failing.nextState.stopKind).toBe("failed");
    expect(failing.nextState.stopReason).toBe(reason);
    expect(failing.commands.map((command) => command.kind)).toEqual(["cancel-node"]);
    const stopped = advanceKernel(graph, failing.nextState, event("stopped", { kind: "attempt-stopped", nodeId: "only", commandId: only.commandId, candidateGeneration: only.candidateGeneration, attempt: only.attempt }));
    expect(stopped.commands.filter((command) => command.kind === "fail-run")).toEqual([expect.objectContaining({ kind: "fail-run", error: reason })]);
    expect(stopped.commands.some((command) => command.kind === "cancel-run")).toBe(false);
    // Redelivering the same event changes nothing.
    expect(advanceKernel(graph, stopped.nextState, event("failed", { kind: "command-failed", commandId: "run:release:request-release:7", error: reason })).commands).toEqual([]);
  });

  test("a failed acceptance effect with no physical work left fails the run at once, and needs a bounded reason", () => {
    // The shape the started application hit: the candidate is done, and the acceptance node — the
    // one virtual node — waits on its effect when that effect's command fails.
    const graph = compiled([
      { id: "candidate", kind: "task", runner, outputPorts: { candidate: { type: "string" } } },
      { id: "accept", kind: "acceptance", dependsOn: ["candidate"], contract: referenceCodeV1.acceptance.id, candidate: { kind: "ref", root: "node", name: "candidate", path: ["candidate"] }, evidence: { kind: "literal", value: [] }, outputPorts: { acceptedCandidate: { type: "string" } } },
    ], {});
    let state = advanceKernel(graph, createKernelState(graph, "run-command-failed-idle", {}, 0), event("start", { kind: "start" })).nextState;
    const admission = state.nodes.candidate!.attempts.at(-1)!;
    const admitted = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "candidate", commandId: admission.commandId, candidateGeneration: 0, granted: true }));
    const dispatch = admitted.commands.find((command) => command.kind === "dispatch-node")!;
    const done = advanceKernel(graph, admitted.nextState, event("done", { kind: "node-result", nodeId: "candidate", commandId: dispatch.id, candidateGeneration: 0, attempt: 1, output: { candidate: "tree" } }));
    const acceptance = done.commands.find((command) => command.kind === "request-acceptance")!;
    state = done.nextState;
    const reason = `FACTORY_COMMAND_FAILED: request-acceptance ${acceptance.id}: factory gateway returned HTTP 500`;
    const failed = advanceKernel(graph, state, event("failed", { kind: "command-failed", commandId: acceptance.id, error: reason }));
    expect(failed.commands.filter((command) => command.kind === "fail-run")).toEqual([expect.objectContaining({ kind: "fail-run", error: reason })]);
    expect(failed.commands.some((command) => command.kind === "cancel-node")).toBe(false);
    expect(failed.nextState.status).toBe("failed");
    expect(failed.nextState.nodes.accept?.status).toBe("failed");
    expect(() => advanceKernel(graph, state, event("empty", { kind: "command-failed", commandId: acceptance.id, error: "" }))).toThrow(FactoryKernelError);
    expect(() => advanceKernel(graph, state, event("long", { kind: "command-failed", commandId: acceptance.id, error: "x".repeat(4097) }))).toThrow(FactoryKernelError);
  });

  test("a validator that crashed or ended uncertain fails the acceptance node in place with its typed reason, and starts no repair", () => {
    for (const maxRepairs of [0, 2]) {
      const graph = compiled([
        { id: "candidate", kind: "task", runner, outputPorts: { candidate: { type: "string" } } },
        { id: "accept", kind: "acceptance", dependsOn: ["candidate"], contract: referenceCodeV1.acceptance.id, candidate: { kind: "ref", root: "node", name: "candidate", path: ["candidate"] }, evidence: { kind: "literal", value: [] }, maxRepairs, outputPorts: { acceptedCandidate: { type: "string" } } },
      ], {});
      const state = advanceKernel(graph, createKernelState(graph, `run-validator-crashed-${maxRepairs}`, {}, 0), event("start", { kind: "start" })).nextState;
      const admission = state.nodes.candidate!.attempts.at(-1)!;
      const admitted = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "candidate", commandId: admission.commandId, candidateGeneration: 0, granted: true }));
      const dispatch = admitted.commands.find((command) => command.kind === "dispatch-node")!;
      const done = advanceKernel(graph, admitted.nextState, event("done", { kind: "node-result", nodeId: "candidate", commandId: dispatch.id, candidateGeneration: 0, attempt: 1, output: { candidate: "tree" } }));
      const acceptance = done.commands.find((command) => command.kind === "request-acceptance")!;
      const failed = advanceKernel(graph, done.nextState, event("crashed", { kind: "node-failed", nodeId: "accept", commandId: acceptance.id, candidateGeneration: 0, attempt: 1, error: "factory_validator_attempt_failed", failureKind: "execution" }));
      // No repair round: nothing re-dispatches the candidate, and nothing stops a virtual attempt.
      expect(failed.commands.some((command) => command.kind === "request-admission" || command.kind === "dispatch-node" || command.kind === "cancel-node")).toBe(false);
      expect(failed.commands.filter((command) => command.kind === "fail-run")).toEqual([expect.objectContaining({ kind: "fail-run", error: "factory_validator_attempt_failed" })]);
      expect(failed.nextState.nodes.accept).toMatchObject({ status: "failed", error: "factory_validator_attempt_failed", candidateGeneration: 0 });
      expect(failed.nextState.stopReason).toBe("factory_validator_attempt_failed");
    }
  });

  test("the command-failed builder names the kind, the command, and a bounded detail, with one id per command", () => {
    const built = factoryCommandFailedEvent({ id: "run:release:request-release:7", kind: "request-release" }, "factory_protected_effect_untrusted", 9);
    expect(built).toEqual({ kind: "command-failed", id: "run:release:request-release:7:command-failed", atMs: 9, commandId: "run:release:request-release:7", error: "FACTORY_COMMAND_FAILED: request-release run:release:request-release:7: factory_protected_effect_untrusted" });
    const long = factoryCommandFailedEvent({ id: "c", kind: "k" }, "x".repeat(FACTORY_COMMAND_FAILED_DETAIL_LIMIT + 10), 1);
    expect(long.error).toBe(`FACTORY_COMMAND_FAILED: k c: ${"x".repeat(FACTORY_COMMAND_FAILED_DETAIL_LIMIT)}`);
  });

  test("a dispatch the product refused before anything was queued fails its task node in place with the refusal's name, with no cancel", () => {
    const graph = compiled([{ id: "work", kind: "task", runner, outputPorts: {} }], {});
    const state = advanceKernel(graph, createKernelState(graph, "run-admission-refused", {}, 0), event("start", { kind: "start" })).nextState;
    const admission = state.nodes.work!.attempts.at(-1)!;
    const admitted = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "work", commandId: admission.commandId, candidateGeneration: 0, granted: true }));
    const dispatch = admitted.commands.find((command) => command.kind === "dispatch-node")!;
    const refused = factoryAdmissionRefusedEvent(dispatch, "factory_package_quarantined", 2);
    expect(refused).toEqual({ kind: "node-failed", id: `${dispatch.id}:admission-refused`, atMs: 2, nodeId: "work", commandId: dispatch.id, candidateGeneration: 0, attempt: dispatch.attempt, error: "factory_package_quarantined", failureKind: "admission_denied" });
    const failed = advanceKernel(graph, admitted.nextState, refused);
    expect(failed.commands.some((command) => command.kind === "cancel-node" || command.kind === "dispatch-node")).toBe(false);
    expect(failed.commands.filter((command) => command.kind === "fail-run")).toEqual([expect.objectContaining({ kind: "fail-run", error: "factory_package_quarantined" })]);
    expect(failed.nextState.status).toBe("failed");
    expect(failed.nextState.nodes.work).toMatchObject({ status: "failed", error: "factory_package_quarantined" });
    expect(failed.nextState.nodes.work!.attempts.every((attempt) => attempt.stopped)).toBe(true);
    // The same failure any other way keeps the ordinary stop, because a lost response can hide a launch.
    const lost = advanceKernel(graph, admitted.nextState, factoryCommandFailedEvent(dispatch, "factory gateway returned HTTP 500", 2));
    expect(lost.commands.map((command) => command.kind)).toEqual(["cancel-node"]);
    const execution = advanceKernel(graph, admitted.nextState, event("crash", { kind: "node-failed", nodeId: "work", commandId: dispatch.id, candidateGeneration: 0, attempt: dispatch.attempt, error: "boom", failureKind: "execution" }));
    expect(execution.commands.map((command) => command.kind)).toEqual(["cancel-node"]);
  });

  test("admission_denied is only an in-place end for a running task: an acceptance node keeps its own path", () => {
    const graph = compiled([
      { id: "candidate", kind: "task", runner, outputPorts: { candidate: { type: "string" } } },
      { id: "accept", kind: "acceptance", dependsOn: ["candidate"], contract: referenceCodeV1.acceptance.id, candidate: { kind: "ref", root: "node", name: "candidate", path: ["candidate"] }, evidence: { kind: "literal", value: [] }, outputPorts: { acceptedCandidate: { type: "string" } } },
    ], {});
    const state = advanceKernel(graph, createKernelState(graph, "run-admission-denied-acceptance", {}, 0), event("start", { kind: "start" })).nextState;
    const admission = state.nodes.candidate!.attempts.at(-1)!;
    const admitted = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "candidate", commandId: admission.commandId, candidateGeneration: 0, granted: true }));
    const dispatch = admitted.commands.find((command) => command.kind === "dispatch-node")!;
    const done = advanceKernel(graph, admitted.nextState, event("done", { kind: "node-result", nodeId: "candidate", commandId: dispatch.id, candidateGeneration: 0, attempt: 1, output: { candidate: "tree" } }));
    const acceptance = done.commands.find((command) => command.kind === "request-acceptance")!;
    const failed = advanceKernel(graph, done.nextState, event("denied", { kind: "node-failed", nodeId: "accept", commandId: acceptance.id, candidateGeneration: 0, attempt: 1, error: "factory_x", failureKind: "admission_denied" }));
    expect(failed.nextState.nodes.accept).toMatchObject({ status: "failed", error: "factory_x" });
  });

  test("a failed release effect fails the run at once: the release's attempt is the effect, so nothing is left to stop", () => {
    const graph = compiled([
      { id: "candidate", kind: "task", runner, outputPorts: { candidate: { type: "string" } } },
      { id: "accept", kind: "acceptance", dependsOn: ["candidate"], contract: referenceCodeV1.acceptance.id, candidate: { kind: "ref", root: "node", name: "candidate", path: ["candidate"] }, evidence: { kind: "literal", value: [] }, outputPorts: { acceptedCandidate: { type: "string" } } },
      { id: "release", kind: "release", dependsOn: ["accept"], adapter: runner, acceptedCandidate: { kind: "ref", root: "node", name: "accept", path: ["acceptedCandidate"] }, destination: { kind: "literal", value: { target: "t" } }, effects: ["publish"], outputPorts: { receipt: { type: "object", additionalProperties: true } } },
    ], {});
    let state = advanceKernel(graph, createKernelState(graph, "run-release-failed", {}, 0), event("start", { kind: "start" })).nextState;
    const admission = state.nodes.candidate!.attempts.at(-1)!;
    const admitted = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "candidate", commandId: admission.commandId, candidateGeneration: 0, granted: true }));
    const dispatch = admitted.commands.find((command) => command.kind === "dispatch-node")!;
    const done = advanceKernel(graph, admitted.nextState, event("done", { kind: "node-result", nodeId: "candidate", commandId: dispatch.id, candidateGeneration: 0, attempt: 1, output: { candidate: "tree" } }));
    const acceptance = done.commands.find((command) => command.kind === "request-acceptance")!;
    const accepted = advanceKernel(graph, done.nextState, event("accepted", { kind: "node-result", nodeId: "accept", commandId: acceptance.id, candidateGeneration: 0, attempt: 1, output: { acceptedCandidate: "tree" } }));
    const release = accepted.commands.find((command) => command.kind === "request-release")!;
    state = accepted.nextState;
    const reason = `FACTORY_COMMAND_FAILED: request-release ${release.id}: factory gateway returned HTTP 500`;
    const failed = advanceKernel(graph, state, event("failed", { kind: "command-failed", commandId: release.id, error: reason }));
    expect(failed.commands.some((command) => command.kind === "cancel-node")).toBe(false);
    expect(failed.commands.filter((command) => command.kind === "fail-run")).toEqual([expect.objectContaining({ kind: "fail-run", error: reason })]);
    expect(failed.nextState.status).toBe("failed");
    expect(failed.nextState.nodes.release).toMatchObject({ status: "failed", error: reason });
  });

  test("a failed dispatch still stops its task, because a lost response may hide a launch that committed", () => {
    const graph = compiled([{ id: "only", kind: "task", runner }], {});
    let state = advanceKernel(graph, createKernelState(graph, "run-dispatch-failed", {}, 0), event("start", { kind: "start" })).nextState;
    const admission = state.nodes.only!.attempts.at(-1)!;
    const admitted = advanceKernel(graph, state, event("admit", { kind: "admission-result", nodeId: "only", commandId: admission.commandId, candidateGeneration: 0, granted: true }));
    const dispatch = admitted.commands.find((command) => command.kind === "dispatch-node")!;
    state = admitted.nextState;
    const failed = advanceKernel(graph, state, event("failed", { kind: "command-failed", commandId: dispatch.id, error: "FACTORY_COMMAND_FAILED: dispatch-node" }));
    expect(failed.commands.filter((command) => command.kind === "cancel-node").map((command) => command.nodeId)).toEqual(["only"]);
    expect(failed.nextState.status).toBe("stopping");
    expect(failed.nextState.stopReason).toBe("FACTORY_COMMAND_FAILED: dispatch-node");
  });

  test("cancelling a map stops admitted items and never opens a blocked index", () => {
    const body = { nodes: [{ id: "item", kind: "task" as const, runner }], outputs: {} };
    const map = { id: "map", kind: "map" as const, collection: { kind: "literal" as const, value: ["one", "two", "three"] }, itemSchema: { type: "string" as const }, body, mode: "all" as const, maxItems: 3, maxConcurrency: 1 };
    const graph = compiled([map], { result: { kind: "ref", root: "node", name: "map" } });
    const started = advanceKernel(graph, createKernelState(graph, "cancel-map", {}, 0), event("start", { kind: "start" }));
    const admission = started.commands.find((command) => command.kind === "request-admission")!;
    const admitted = advanceKernel(graph, started.nextState, event("admit", { kind: "admission-result", nodeId: admission.nodeId, commandId: admission.id, candidateGeneration: 0, granted: true }));
    const cancelled = advanceKernel(graph, admitted.nextState, event("cancel", { kind: "cancel", reason: "user" }));
    expect(cancelled.nextState.status).toBe("stopping");
    expect(cancelled.commands.some((command) => command.kind === "cancel-node" && command.nodeId === "map/items/0/item")).toBe(true);
    expect(cancelled.nextState.nodes["map/items/1/item"]).toBeUndefined();
    expect(cancelled.nextState.nodes["map/items/2/item"]).toBeUndefined();
  });

  test("keeps only the active map window and safely reopens an evicted item repair", () => {
    const body = { nodes: [{ id: "item", kind: "task" as const, runner }], outputs: {} };
    const map = { id: "map", kind: "map" as const, collection: { kind: "literal" as const, value: ["one", "two", "three"] }, itemSchema: { type: "string" as const }, body, mode: "all" as const, maxItems: 3, maxConcurrency: 1 };
    const graph = compiled([map], { result: { kind: "ref", root: "node", name: "map" } });
    const started = advanceKernel(graph, createKernelState(graph, "repair-evicted-map", {}, 0), event("start", { kind: "start" }));
    expect(Object.keys(started.nextState.nodes)).toEqual(["map", "map/items/0/item"]);
    const admission = started.commands.find((command) => command.kind === "request-admission")!;
    const admitted = advanceKernel(graph, started.nextState, event("admit-item-zero", { kind: "admission-result", nodeId: admission.nodeId, commandId: admission.id, candidateGeneration: 0, granted: true }));
    const attempt = admitted.commands.find((command) => command.kind === "dispatch-node")!;
    const completed = advanceKernel(graph, admitted.nextState, event("complete-item-zero", { kind: "node-result", nodeId: attempt.nodeId, commandId: attempt.id, candidateGeneration: 0, attempt: 1, output: {} }));
    expect(completed.nextState.nodes["map/items/0/item"]).toBeUndefined();
    expect(completed.nextState.nodes["map/items/1/item"]?.status).toBe("reserved");

    const repaired = advanceKernel(graph, completed.nextState, event("repair-evicted-item", { kind: "repair", nodeId: "map/items/0/item", reason: "replace item" }));
    const cancel = repaired.commands.find((command) => command.kind === "cancel-node");
    expect(cancel).toEqual(expect.objectContaining({ nodeId: "map/items/1/item" }));
    const stopped = advanceKernel(graph, repaired.nextState, event("stop-item-one", { kind: "attempt-stopped", nodeId: cancel!.nodeId, commandId: cancel!.attemptCommandId, candidateGeneration: cancel!.candidateGeneration, attempt: cancel!.attempt }));
    expect(stopped.nextState.nodes.map?.candidateGeneration).toBe(1);
    expect(Object.keys(stopped.nextState.nodes)).toEqual(["map", "map/items/0/item"]);
    expect(stopped.commands).toContainEqual(expect.objectContaining({ kind: "request-admission", nodeId: "map/items/0/item" }));
  });

  test("repairs an active map item through its aggregate and clears the prior result", () => {
    const body = { nodes: [{ id: "item", kind: "task" as const, runner }], outputs: {} };
    const map = { id: "map", kind: "map" as const, collection: { kind: "literal" as const, value: ["one"] }, itemSchema: { type: "string" as const }, body, mode: "all" as const, maxItems: 1, maxConcurrency: 1 };
    const graph = compiled([map], { result: { kind: "ref", root: "node", name: "map" } });
    const started = advanceKernel(graph, createKernelState(graph, "repair-active-map", {}, 0), event("start", { kind: "start" }));
    const repair = advanceKernel(graph, started.nextState, event("repair-active-item", { kind: "repair", nodeId: "map/items/0/item", reason: "replace active item" }));
    const cancel = repair.commands.find((command) => command.kind === "cancel-node")!;
    const stopped = advanceKernel(graph, repair.nextState, event("stop-active-item", { kind: "attempt-stopped", nodeId: cancel.nodeId, commandId: cancel.attemptCommandId, candidateGeneration: cancel.candidateGeneration, attempt: cancel.attempt }));
    expect(stopped.nextState.nodes.map?.map?.outcomes).toEqual({});
    expect(stopped.nextState.nodes.map?.candidateGeneration).toBe(1);
    expect(stopped.nextState.nodes["map/items/0/item"]?.candidateGeneration).toBe(1);
  });

  test("does not replay an approved item after its protected node is evicted", () => {
    const approval = { id: "approve", kind: "approval" as const, choices: ["approve"], context: { kind: "literal" as const, value: null }, actorScope: "owner", expiresInMs: 60_000, onDenied: "fail" as const, onExpired: "fail" as const };
    const map = { id: "map", kind: "map" as const, collection: { kind: "literal" as const, value: ["one", "two"] }, itemSchema: { type: "string" as const }, body: { nodes: [approval], outputs: {} }, mode: "all" as const, maxItems: 2, maxConcurrency: 1 };
    const graph = compiled([map], {});
    const started = advanceKernel(graph, createKernelState(graph, "protected-evicted-map", {}, 0), event("start", { kind: "start" }));
    const request = started.commands.find((command) => command.kind === "request-approval")!;
    const approved = advanceKernel(graph, started.nextState, event("approve-item-zero", { kind: "approval-decided", nodeId: request.nodeId, commandId: request.id, choice: "approve" }));
    expect(approved.nextState.nodes["map/items/0/approve"]).toBeUndefined();
    expect(approved.nextState.nodes["map/items/1/approve"]?.status).toBe("waiting");
    const repair = advanceKernel(graph, approved.nextState, event("repair-old-approval", { kind: "repair", nodeId: "map/items/0/approve", reason: "must remain approved" }));
    expect(repair.commands).toEqual([]);
    expect(repair.nextState.nodes.map?.candidateGeneration).toBe(0);
    expect(repair.nextState.nodes.map?.map?.completedIndexes).toEqual([0]);
  });

  test("does not replay an evicted map item after its release effect started", () => {
    const work = { id: "work", kind: "task" as const, runner };
    const acceptance = {
      id: "accept", kind: "acceptance" as const, dependsOn: ["work"], contract: referenceCodeV1.acceptance.id,
      candidate: { kind: "literal" as const, value: {} }, evidence: { kind: "literal" as const, value: {} },
      outputPorts: { acceptedCandidate: { type: "object" as const, additionalProperties: true } },
    };
    const release = {
      id: "publish", kind: "release" as const, dependsOn: ["accept"], adapter: runner,
      acceptedCandidate: { kind: "ref" as const, root: "node" as const, name: "accept", path: ["acceptedCandidate"] },
      destination: { kind: "literal" as const, value: {} }, effects: ["publish" as const],
    };
    const map = {
      id: "map", kind: "map" as const, collection: { kind: "literal" as const, value: ["one"] }, itemSchema: { type: "string" as const },
      body: { nodes: [work, acceptance, release], outputs: {} }, mode: "all" as const, maxItems: 1, maxConcurrency: 1, effects: ["publish" as const],
    };
    const graph = compiled([map, { id: "hold", kind: "task", runner }], {});
    const started = advanceKernel(graph, createKernelState(graph, "protected-release-map", {}, 0), event("start", { kind: "start" }));
    const admission = findCommand(started.commands, "request-admission", "map/items/0/work")!;
    const admitted = advanceKernel(graph, started.nextState, event("admitted", { kind: "admission-result", nodeId: admission.nodeId, commandId: admission.id, candidateGeneration: admission.candidateGeneration, granted: true }));
    const dispatch = admitted.commands.find((command) => command.kind === "dispatch-node")!;
    const worked = advanceKernel(graph, admitted.nextState, event("worked", { kind: "node-result", nodeId: dispatch.nodeId, commandId: dispatch.id, candidateGeneration: dispatch.candidateGeneration, attempt: dispatch.attempt, output: {} }));
    const accept = worked.commands.find((command) => command.kind === "request-acceptance")!;
    const accepted = advanceKernel(graph, worked.nextState, event("accepted", { kind: "node-result", nodeId: accept.nodeId, commandId: accept.id, candidateGeneration: accept.candidateGeneration, attempt: 1, output: { acceptedCandidate: {} } }));
    const publish = accepted.commands.find((command) => command.kind === "request-release")!;
    const published = advanceKernel(graph, accepted.nextState, event("published", { kind: "node-result", nodeId: publish.nodeId, commandId: publish.id, candidateGeneration: publish.candidateGeneration, attempt: 1, output: {} }));
    expect(published.nextState.status).toBe("running");
    expect(Object.keys(published.nextState.nodes).sort()).toEqual(["hold", "map"]);
    expect(published.nextState.nodes.map?.map?.protectedEffectStarted).toBe(true);
    const childRepair = advanceKernel(graph, published.nextState, event("repair-work", { kind: "repair", nodeId: "map/items/0/work", reason: "must not republish" }));
    expect(childRepair.commands).toEqual([]);
    expect(childRepair.nextState.nodes.map?.candidateGeneration).toBe(0);
    const parentRepair = advanceKernel(graph, childRepair.nextState, event("repair-map", { kind: "repair", nodeId: "map", reason: "must not republish" }));
    expect(parentRepair.commands).toEqual([]);
    expect(parentRepair.nextState.nodes.map?.candidateGeneration).toBe(0);
    expect(parentRepair.nextState.nodes.map?.map?.completedIndexes).toEqual([0]);
  });

  test("completes 9,999 immediate nested controls without retaining scopes or recursing", () => {
    const emptyOutput = { nodes: [], outputs: { value: { kind: "literal" as const, value: "" } } };
    const branch = { id: "choose", kind: "branch" as const, condition: { kind: "literal" as const, value: true }, then: emptyOutput, else: emptyOutput, outputPorts: { value: { type: "string" as const } } };
    const map = {
      id: "map", kind: "map" as const, collection: { kind: "ref" as const, root: "input" as const, name: "items", path: [] }, itemSchema: { type: "number" as const },
      body: { nodes: [branch], outputs: { values: { kind: "ref" as const, root: "node" as const, name: "choose", path: ["value"] } } },
      outputPorts: { values: { type: "array" as const, items: { type: "string" as const } } }, mode: "all" as const, maxItems: 9_999, maxConcurrency: 1,
    };
    const graph = compiled([map], {}, { items: { type: "array", items: { type: "number" }, maxItems: 9_999 } });
    const started = advanceKernel(graph, createKernelState(graph, "immediate-map", { items: Array.from({ length: 9_999 }, (_, index) => index) }, 0), event("start", { kind: "start" }));
    expect(started.nextState.status).toBe("completed");
    expect(Object.keys(started.nextState.nodes)).toEqual(["map"]);
    expect(Object.keys(started.nextState.scopes)).toEqual(["root"]);
    expect(started.nextState.scopes.root?.expandedNodeCount).toBe(10_000);
    const output = started.nextState.nodes.map?.output;
    if (!output || typeof output !== "object" || Array.isArray(output)) throw new Error("map output is not an object");
    expect(output.values).toHaveLength(9_999);
  }, 30_000);
});

void ({} as JsonValue);

test("artifact input fields wait for an exact bounded result before activation", () => {
  const graph = compiled([{ id: "work", kind: "task", runner, bindings: { value: { kind: "ref", root: "input", name: "data", path: ["label"] } }, inputPorts: { value: { type: "string" } } }], {}, { data: { type: "object", properties: { label: { type: "string" } }, required: ["label"] } });
  const artifact = { artifactId: "artifact", digest, encodedBytes: 70_000 };
  const started = advanceKernel(graph, createKernelState(graph, "lazy", { data: { label: "placeholder" } }, 0, { schemaVersion: FACTORY_LAZY_INPUT_SCHEMA_VERSION, parameters: { data: { kind: "artifact", artifact } } }), event("start", { kind: "start" }));
  const read = started.commands.find(command => command.kind === "read-input-value");
  expect(read).toMatchObject({ name: "data", path: ["label"], artifact });
  if (read?.kind !== "read-input-value") throw new Error("lazy input read was not emitted");
  expect(() => advanceKernel(graph, started.nextState, event("wrong", { kind: "input-value-read", commandId: read.id, nodeId: read.nodeId, candidateGeneration: read.candidateGeneration, cancellationEpoch: read.cancellationEpoch, name: "data", artifact: { ...artifact, digest: `sha256:${"0".repeat(64)}` }, path: ["label"], storageVersion: "v1", mediaType: "application/json", value: "ok" }))).toThrow(FactoryKernelError);
  const loaded = advanceKernel(graph, started.nextState, event("loaded", { kind: "input-value-read", commandId: read.id, nodeId: read.nodeId, candidateGeneration: read.candidateGeneration, cancellationEpoch: read.cancellationEpoch, name: "data", artifact, path: ["label"], storageVersion: "v1", mediaType: "application/json", value: "ok" }));
  const admission = loaded.commands.find(command => command.kind === "request-admission");
  expect(admission).toMatchObject({ nodeId: "work" });
  if (admission?.kind !== "request-admission") throw new Error("lazy field admission was not emitted");
  const dispatched = advanceKernel(graph, loaded.nextState, event("admitted", { kind: "admission-result", nodeId: admission.nodeId, commandId: admission.id, candidateGeneration: admission.candidateGeneration, granted: true }));
  expect(dispatched.commands).toContainEqual(expect.objectContaining({ kind: "dispatch-node", nodeId: "work", input: { value: "ok" } }));
});

test("artifact maps retain only one page while advancing exact absolute cursors", () => {
  const map: Extract<FactoryNode, { kind: "map" }> = { id: "map", kind: "map", collection: { kind: "ref", root: "input", name: "items" }, itemSchema: { type: "string" }, body: { nodes: [], outputs: {} }, mode: "all", maxItems: 96, maxConcurrency: 4, outputPorts: {} };
  const graph = compiled([map], {}, { items: { type: "array", items: { type: "string" }, maxItems: 96 } });
  const artifact = { artifactId: "items", digest, encodedBytes: 96 * 1024 };
  const started = advanceKernel(graph, createKernelState(graph, "lazy-map", { items: [] }, 0, { schemaVersion: FACTORY_LAZY_INPUT_SCHEMA_VERSION, parameters: { items: { kind: "artifact", artifact } } }), event("start", { kind: "start" }));
  const first = started.commands.find(command => command.kind === "read-input-page");
  expect(first).toMatchObject({ nodeId: "map", name: "items", cursor: 0, maxItems: 32, artifact });
  if (first?.kind !== "read-input-page") throw new Error("first map page was not emitted");
  const page = (id: string, command: typeof first, items: readonly JsonValue[], nextCursor?: number) => event(id, { kind: "input-page-read" as const, commandId: command.id, nodeId: command.nodeId, candidateGeneration: command.candidateGeneration, cancellationEpoch: command.cancellationEpoch, name: command.name, artifact, path: [], storageVersion: "v1", mediaType: "application/json" as const, cursor: command.cursor, maxItems: command.maxItems, items, ...(nextCursor === undefined ? {} : { nextCursor }) });
  expect(() => advanceKernel(graph, started.nextState, page("bad-page", first, ["a"], 2))).toThrow(FactoryKernelError);
  const second = advanceKernel(graph, started.nextState, page("page-0", first, ["a", "b"], 2));
  expect(() => advanceKernel(graph, second.nextState, page("stale-page", first, ["a", "b"], 2))).toThrow(FactoryKernelError);
  expect(second.nextState.nodes.map?.map?.completedIndexes).toEqual([0, 1]);
  expect(second.nextState.nodes.map?.map?.snapshot).toEqual([]);
  const next = second.commands.find(command => command.kind === "read-input-page");
  expect(next).toMatchObject({ cursor: 2, expectedStorageVersion: "v1" });
  if (next?.kind !== "read-input-page") throw new Error("second map page was not emitted");
  const third = advanceKernel(graph, second.nextState, page("page-2", next, ["c"], 3));
  expect(third.nextState.nodes.map?.map?.completedIndexes).toEqual([0, 1, 2]);
  const terminal = third.commands.find(command => command.kind === "read-input-page");
  expect(terminal).toMatchObject({ cursor: 3, expectedStorageVersion: "v1" });
  if (terminal?.kind !== "read-input-page") throw new Error("terminal map page was not emitted");
  const complete = advanceKernel(graph, third.nextState, page("page-3", terminal, []));
  expect(complete.nextState.nodes.map?.status).toBe("succeeded");
  expect(complete.nextState.nodes.map?.map?.snapshot).toEqual([]);
  expect(JSON.stringify(complete.nextState).length).toBeLessThan(32 * 1024);
});


test("artifact map pages preserve absolute map.item values across windows", () => {
  const task: Extract<FactoryNode, { kind: "task" }> = { id: "work", kind: "task", runner, bindings: { value: { kind: "ref", root: "map", name: "item" } }, inputPorts: { value: { type: "string" } }, outputPorts: { value: { type: "string" } } };
  const map: Extract<FactoryNode, { kind: "map" }> = { id: "map", kind: "map", collection: { kind: "ref", root: "input", name: "items" }, itemSchema: { type: "string" }, body: { nodes: [task], outputs: { value: { kind: "ref", root: "node", name: "work", path: ["value"] } } }, mode: "all", maxItems: 96, maxConcurrency: 4, outputPorts: { value: { type: "array", items: { type: "string" }, maxItems: 96 } } };
  const graph = compiled([map], { result: { kind: "ref", root: "node", name: "map" } }, { items: { type: "array", items: { type: "string" }, maxItems: 96 } });
  const artifact = { artifactId: "map-items", digest, encodedBytes: 96 * 1024 };
  const started = advanceKernel(graph, createKernelState(graph, "lazy-window", { items: [] }, 0, { schemaVersion: FACTORY_LAZY_INPUT_SCHEMA_VERSION, parameters: { items: { kind: "artifact", artifact } } }), event("start", { kind: "start" }));
  const first = started.commands.find(command => command.kind === "read-input-page");
  if (first?.kind !== "read-input-page") throw new Error("first map page missing");
  const page = (id: string, command: Extract<typeof first, { kind: "read-input-page" }>, items: readonly JsonValue[], nextCursor?: number) => event(id, { kind: "input-page-read" as const, commandId: command.id, nodeId: command.nodeId, candidateGeneration: command.candidateGeneration, cancellationEpoch: command.cancellationEpoch, name: command.name, artifact, path: [], storageVersion: "v1", mediaType: "application/json" as const, cursor: command.cursor, maxItems: command.maxItems, items, ...(nextCursor === undefined ? {} : { nextCursor }) });
  let step = advanceKernel(graph, started.nextState, page("window-0", first, ["a", "b"], 2));
  const settlePage = (expected: readonly string[]) => {
    const admissions = step.commands.filter(command => command.kind === "request-admission");
    expect(admissions).toHaveLength(expected.length);
    for (let index = 0; index < admissions.length; index += 1) {
      const admission = admissions[index]!;
      const dispatch = advanceKernel(graph, step.nextState, event(`admit-${admission.id}`, { kind: "admission-result" as const, nodeId: admission.nodeId, commandId: admission.id, candidateGeneration: admission.candidateGeneration, granted: true }));
      const work = dispatch.commands.find(command => command.kind === "dispatch-node");
      expect(work).toMatchObject({ input: { value: expected[index] } });
      if (work?.kind !== "dispatch-node") throw new Error("map task was not dispatched");
      step = advanceKernel(graph, dispatch.nextState, event(`result-${work.id}`, { kind: "node-result" as const, nodeId: work.nodeId, commandId: work.id, candidateGeneration: work.candidateGeneration, attempt: work.attempt, output: { value: `${expected[index]}!` } }));
    }
  };
  settlePage(["a", "b"]);
  const second = step.commands.find(command => command.kind === "read-input-page");
  expect(second).toMatchObject({ cursor: 2, expectedStorageVersion: "v1" });
  if (second?.kind !== "read-input-page") throw new Error("second map page missing");
  step = advanceKernel(graph, step.nextState, page("window-2", second, ["c"], 3));
  settlePage(["c"]);
  const terminal = step.commands.find(command => command.kind === "read-input-page");
  if (terminal?.kind !== "read-input-page") throw new Error("terminal map page missing");
  step = advanceKernel(graph, step.nextState, page("window-3", terminal, []));
  expect(step.nextState.nodes.map?.output).toEqual({ value: ["a!", "b!", "c!"] });
});


test("durable artifact ports do not require an inline placeholder while inline ports remain strict", () => {
  const graph = compiled([], {}, {
    payload: { type: "object", properties: { required: { type: "string", const: "authoritative" } }, required: ["required"] },
  });
  const artifact = { artifactId: "durable-payload", digest, encodedBytes: 70_000 };
  const state = createKernelState(graph, "durable-required", {}, 0, {
    schemaVersion: FACTORY_LAZY_INPUT_SCHEMA_VERSION,
    parameters: { payload: { kind: "artifact", artifact } },
  });
  expect(state.durableInput).toMatchObject({ parameters: { payload: { kind: "artifact", artifact } } });
  expect(() => createKernelState(graph, "bad-inline", {}, 0, {
    schemaVersion: FACTORY_LAZY_INPUT_SCHEMA_VERSION,
    parameters: { payload: { kind: "inline", value: {} } },
  })).toThrow(FactoryKernelError);
});
