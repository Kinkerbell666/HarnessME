import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkflowExecutionAlreadyStartedError, type WorkflowStartOptions } from "@temporalio/client";
import type { ClaimedFactoryCommand, FactoryCommandQueue, FactoryTransportCommand } from "../src/contracts.ts";
import {
  dispatchClaim, dispatchNext, deliverFactoryCommand, FactoryPreSendError, reconcileClaim, reconcileFactoryCommand,
  type FactoryDispatchClient, type FactoryDispatchHandle,
} from "../src/dispatcher.ts";

type FakeWorkflow = FactoryDispatchClient["workflow"];
type SettleCall = Parameters<FactoryCommandQueue["settle"]>;

// Every fake member the code under test does not stub fails loudly, so a
// test cannot pass by never reaching the call it claims to exercise.
const unexpected = (name: string) => async (): Promise<never> => { throw new Error(`unexpected ${name} call`); };

function handle(parts: Partial<FactoryDispatchHandle> = {}): FactoryDispatchHandle {
  return { describe: unexpected("describe"), query: unexpected("query"), signal: unexpected("signal"), ...parts };
}

function client(parts: Partial<FakeWorkflow> = {}): { workflow: FakeWorkflow } {
  return { workflow: { start: unexpected("start"), getHandle: () => handle(), ...parts } };
}

function queue(parts: Partial<FactoryCommandQueue> = {}): FactoryCommandQueue {
  return { claim: async () => null, settle: unexpected("settle"), ...parts };
}

const workflowInput = {
  tenantId: "tenant",
  projectId: "project",
  logicalRunId: "run",
  interpreterId: "interpreter",
  startedAtMs: 1,
  definition: { definitionDigest: `sha256:${"a".repeat(64)}`, definitionEncodedBytes: 1, manifest: { objectId: "manifest", digest: `sha256:${"b".repeat(64)}`, encodedBytes: 1 } },
  input: {},
};

const cancelEvent = { kind: "cancel", id: "event-1", atMs: 2, reason: "test" };

function command(kind: FactoryTransportCommand["kind"] = "start_run"): FactoryTransportCommand {
  return {
    commandId: "command-1",
    requestId: "command-1",
    tenantId: "tenant",
    projectId: "project",
    logicalRunId: "run",
    workflowId: "tenant/run",
    kind,
    interpreterId: kind === "start_run" ? "interpreter" : "root",
    eventId: kind === "start_run" ? undefined : "event-1",
    eventSequence: kind === "start_run" ? undefined : 1,
    eventHash: kind === "start_run" ? undefined : `sha256:${"c".repeat(64)}`,
    body: kind === "start_run" ? workflowInput : cancelEvent,
  };
}

describe("factory outbox dispatcher", () => {
  it("uses the durable command ID as the Temporal start request ID", async () => {
    let captured: WorkflowStartOptions | undefined;
    await deliverFactoryCommand(client({ start: async (_type, options) => { captured = options; } }), command());
    assert.ok(captured, "the dispatcher started the workflow");
    assert.partialDeepStrictEqual(Reflect.get(captured, Symbol.for("__temporal_internal_client_workflow_start_options")), { requestId: "command-1" });
    assert.equal(captured.workflowId, "tenant/run");
    assert.equal(captured.retry?.maximumAttempts, 1);
    assert.equal(captured.workflowIdReusePolicy, "REJECT_DUPLICATE");
    assert.deepEqual(captured.memo?.["ezcorp.factory.start.v1"], { commandId: "command-1", tenantId: "tenant", projectId: "project", logicalRunId: "run", interpreterId: "interpreter" });
  });

  it("uses a stable workflow identity for a partition interpreter", async () => {
    let workflowId: string | undefined;
    const partitionInput = {
      ...workflowInput,
      definition: {
        definitionDigest: workflowInput.definition.definitionDigest,
        executionManifest: workflowInput.definition.manifest,
        partition: { ...workflowInput.definition.manifest, partitionId: "partition-7" },
      },
    };
    const partitionCommand = {
      ...command(),
      workflowId: "tenant/run/partitions/partition-7",
      body: partitionInput,
    };
    await deliverFactoryCommand(client({ start: async (_type, options) => { workflowId = options.workflowId; } }), partitionCommand);
    assert.equal(workflowId, partitionCommand.workflowId);
    await assert.rejects(deliverFactoryCommand(client(), { ...partitionCommand, workflowId: "tenant/run" }), /identity/);
  });

  it("acknowledges only a repeated start with the same durable identity", async () => {
    const existing = { commandId: "command-1", tenantId: "tenant", projectId: "project", logicalRunId: "run", interpreterId: "interpreter" };
    const alreadyStarted = async (): Promise<never> => {
      throw new WorkflowExecutionAlreadyStartedError("exists", "tenant/run", "factoryWorkflow");
    };
    const described = (memo: Record<string, unknown>) => client({
      start: alreadyStarted,
      getHandle: () => handle({ describe: async () => ({ type: "factoryWorkflow", memo: { "ezcorp.factory.start.v1": memo } }) }),
    });
    await assert.doesNotReject(deliverFactoryCommand(described(existing), command()));
    await assert.rejects(deliverFactoryCommand(described({ ...existing, commandId: "other" }), command()), WorkflowExecutionAlreadyStartedError);
  });

  it("signals the existing workflow with a stable inbox event", async () => {
    const calls: unknown[][] = [];
    const fake = client({ getHandle: (id) => handle({ signal: async (name, envelope) => { calls.push([id, name, envelope]); } }) });
    await deliverFactoryCommand(fake, command("decision"));
    const value = command("decision");
    assert.deepEqual(calls, [["tenant/run", "factoryInbox", { sequence: value.eventSequence, eventId: value.eventId, eventHash: value.eventHash, event: value.body }]]);
  });

  it("addresses partition notifications to their partition interpreter", async () => {
    const calls: string[] = [];
    const fake = client({ getHandle: (id) => handle({ signal: async () => { calls.push(id); } }) });
    await deliverFactoryCommand(fake, { ...command("partition_notification"), interpreterId: "partition-7" });
    assert.deepEqual(calls, ["tenant/run/partitions/partition-7"]);
  });

  it("rejects invalid durable identities and payloads", async () => {
    await assert.rejects(deliverFactoryCommand(client(), { ...command(), requestId: "different" }), /request ID/);
    await assert.rejects(deliverFactoryCommand(client(), { ...command(), body: null }), /workflow input object/);
    await assert.rejects(deliverFactoryCommand(client(), { ...command(), body: [] }), /workflow input object/);
    await assert.rejects(deliverFactoryCommand(client(), { ...command(), body: 1 }), /workflow input object/);
    await assert.rejects(deliverFactoryCommand(client(), { ...command(), tenantId: "other" }), /identity/);
    await assert.rejects(deliverFactoryCommand(client(), { ...command(), workflowId: "other/run" }), /identity/);
    await assert.rejects(deliverFactoryCommand(client({ start: async () => { throw new Error("start failed"); } }), command()), /start failed/);
    await assert.rejects(deliverFactoryCommand(client(), { ...command("decision"), eventId: undefined }), /stable event identity/);
    await assert.rejects(deliverFactoryCommand(client(), { ...command("decision"), eventSequence: undefined }), /stable event identity/);
    await assert.rejects(deliverFactoryCommand(client(), { ...command("decision"), eventHash: undefined }), /stable event identity/);
    await assert.rejects(deliverFactoryCommand(client(), { ...command("decision"), body: null }), /inbox event/);
    await assert.rejects(deliverFactoryCommand(client(), { ...command("decision"), eventId: "different" }), /does not match/);
  });

  it("reconciles acknowledged and pending decisions by durable identity", async () => {
    const value = command("decision");
    const { eventSequence, eventId, eventHash } = value;
    assert.ok(eventSequence !== undefined && eventId !== undefined && eventHash !== undefined);
    const receipt = (acknowledgedSequence: number, pending: { sequence: number; eventId: string; eventHash: string }[] = []) =>
      client({ getHandle: () => handle({ query: async () => ({ acknowledgedSequence, pending }) }) });
    assert.equal(await reconcileFactoryCommand(receipt(0, [{ sequence: eventSequence, eventId, eventHash }]), value), "delivered");
    assert.equal(await reconcileFactoryCommand(receipt(1), value), "outcome_unknown");
    assert.equal(await reconcileFactoryCommand(receipt(1), value, { confirmInboxIdentity: async (candidate) => candidate.eventId === value.eventId && candidate.eventHash === value.eventHash }), "delivered");
    assert.equal(await reconcileFactoryCommand(receipt(1), { ...value, eventId: "forged", body: { ...cancelEvent, id: "forged" } }, { confirmInboxIdentity: async () => false }), "outcome_unknown");
    assert.equal(await reconcileFactoryCommand(receipt(0), value), "outcome_unknown");
    const unavailable = client({ getHandle: () => handle({ query: async () => { throw new Error("unavailable"); } }) });
    assert.equal(await reconcileFactoryCommand(unavailable, value), "outcome_unknown");
    assert.equal(await reconcileFactoryCommand(unavailable, { ...value, eventSequence: undefined }), "outcome_unknown");
  });

  it("settles a recovered unknown claim only after identity reconciliation", async () => {
    const value = command("decision");
    const claim: ClaimedFactoryCommand = { claimToken: "token", command: value };
    const settled: SettleCall[] = [];
    const recovering = queue({ settle: async (...args) => { settled.push(args); }, confirmInboxIdentity: async () => true });
    const receipt = (acknowledgedSequence: number) => client({ getHandle: () => handle({ query: async () => ({ acknowledgedSequence, pending: [] }) }) });
    assert.equal(await reconcileClaim(receipt(1), recovering, claim), "delivered");
    assert.deepEqual(settled.map((entry) => entry.slice(1)), [["delivered"]]);
    assert.equal(await reconcileClaim(receipt(0), recovering, claim), "outcome_unknown");
    assert.equal(settled.length, 1);
  });

  it("settles only after an acknowledged delivery", async () => {
    const settled: SettleCall[] = [];
    const claim: ClaimedFactoryCommand = { claimToken: "token", command: command("decision") };
    const fake = client({ getHandle: () => handle({ signal: async () => undefined }) });
    assert.equal(await dispatchNext(fake, queue({ claim: async () => claim, settle: async (...args) => { settled.push(args); } })), "delivered");
    assert.deepEqual(settled.map((entry) => entry.slice(1)), [["delivered"]]);
    assert.equal(await dispatchNext(fake, queue()), "empty");
  });

  it("retries known pre-send connection failures and parks uncertain errors", async () => {
    const outcomes: [SettleCall[1], SettleCall[2]][] = [];
    const recording = queue({ settle: async (_claim, outcome, code) => { outcomes.push([outcome, code]); }, confirmInboxIdentity: async () => true });
    const claim: ClaimedFactoryCommand = { claimToken: "token", command: command("decision") };
    const failingWith = (thrown: unknown) => client({ getHandle: () => handle({ signal: async () => { throw thrown; } }) });
    assert.equal(await dispatchClaim(failingWith(new FactoryPreSendError("client proved the request was not sent")), recording, claim), "retry");
    assert.equal(await dispatchClaim(failingWith(new Error("deadline exceeded after send")), recording, claim), "outcome_unknown");
    assert.equal(await dispatchClaim(failingWith(new TypeError("bad payload")), recording, claim), "outcome_unknown");
    assert.equal(await dispatchClaim(failingWith("unknown"), recording, claim), "outcome_unknown");
    assert.deepEqual(outcomes, [["retry", "FactoryPreSendError"], ["outcome_unknown", "Error"], ["outcome_unknown", "TypeError"], ["outcome_unknown", "UNKNOWN"]]);
  });

  it("settles an uncertain send as delivered when the workflow receipt confirms it", async () => {
    const outcomes: [SettleCall[1], SettleCall[2]][] = [];
    const value = command("decision");
    const recording = queue({ settle: async (_claim, outcome, code) => { outcomes.push([outcome, code]); }, confirmInboxIdentity: async () => true });
    let signals = 0;
    const fake = client({
      getHandle: () => handle({
        signal: async () => {
          signals += 1;
          throw new Error("connection closed after acknowledgement");
        },
        query: async () => ({ acknowledgedSequence: 1, pending: [] }),
      }),
    });
    assert.equal(await dispatchClaim(fake, recording, { claimToken: "token", command: value }), "delivered");
    assert.equal(signals, 1);
    assert.deepEqual(outcomes, [["delivered", undefined]]);
  });
});
