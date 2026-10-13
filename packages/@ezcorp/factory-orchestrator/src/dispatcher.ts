import { type WorkflowStartOptions, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { WorkflowIdConflictPolicy, WorkflowIdReusePolicy } from "@temporalio/common";
import {
  FACTORY_INBOX_RECEIPT_QUERY,
  FACTORY_INBOX_SIGNAL,
  FACTORY_TASK_QUEUE,
  FACTORY_WORKFLOW_TYPE,
  factoryWorkflowId,
  type ClaimedFactoryCommand,
  type FactoryCommandQueue,
  type FactoryInboxEnvelope,
  type FactoryInboxReceipt,
  type FactoryTransportCommand,
  type FactoryWorkflowInput,
} from "./contracts.ts";
import { isPartitionSource, validateInboxEnvelope, validateWorkflowInput } from "./validation.ts";

const START_OPTIONS = Symbol.for("__temporal_internal_client_workflow_start_options");
const START_MEMO_KEY = "ezcorp.factory.start.v1";

export type DispatchVerdict = "delivered" | "retry" | "outcome_unknown";

/** The part of a Temporal workflow handle the dispatcher uses. */
export interface FactoryDispatchHandle {
  describe(): Promise<{ readonly type: string; readonly memo?: Record<string, unknown> }>;
  query(queryType: string): Promise<FactoryInboxReceipt>;
  signal(signalName: string, envelope: FactoryInboxEnvelope): Promise<void>;
}

/** The part of a Temporal Client the dispatcher uses; a real Client satisfies it. */
export interface FactoryDispatchClient {
  readonly workflow: {
    start(workflowType: string, options: WorkflowStartOptions): Promise<unknown>;
    getHandle(workflowId: string): FactoryDispatchHandle;
  };
}

/** Only infrastructure that proves no Temporal request was issued may use this marker. */
export class FactoryPreSendError extends Error {
  override readonly name = "FactoryPreSendError";
}

export { factoryWorkflowId } from "./contracts.ts";

function commandWorkflowId(command: FactoryTransportCommand): string {
  if (command.kind === "start_run") return command.workflowId;
  if (!command.interpreterId || command.workflowId !== factoryWorkflowId(command.tenantId, command.logicalRunId)) throw new Error("signal command must address a scoped interpreter from its root workflow identity");
  return factoryWorkflowId(command.tenantId, command.logicalRunId, command.interpreterId);
}

function startInput(command: FactoryTransportCommand): FactoryWorkflowInput {
  if (command.kind !== "start_run" || typeof command.body !== "object" || command.body === null || Array.isArray(command.body)) {
    throw new Error("start command body must be a workflow input object");
  }
  const input = command.body as unknown as FactoryWorkflowInput;
  validateWorkflowInput(input);
  if (
    command.tenantId !== input.tenantId
    || command.projectId !== input.projectId
    || command.logicalRunId !== input.logicalRunId
    || command.interpreterId !== input.interpreterId
    || command.workflowId !== (isPartitionSource(input.definition)
      ? factoryWorkflowId(input.tenantId, input.logicalRunId, input.definition.partition.partitionId)
      : factoryWorkflowId(input.tenantId, input.logicalRunId))
  ) throw new Error("start command identity does not match its workflow input");
  return input;
}

function startIdentity(command: FactoryTransportCommand): Record<string, string | undefined> {
  return {
    commandId: command.commandId,
    tenantId: command.tenantId,
    projectId: command.projectId,
    logicalRunId: command.logicalRunId,
    interpreterId: command.interpreterId,
  };
}

function sameStartIdentity(actual: unknown, expected: Record<string, string | undefined>): boolean {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) => (actual as Record<string, unknown>)[key] === value);
}

export async function reconcileFactoryCommand(
  client: FactoryDispatchClient,
  command: FactoryTransportCommand,
  identityStore?: Pick<FactoryCommandQueue, "confirmInboxIdentity">,
): Promise<"delivered" | "outcome_unknown"> {
  try {
    const handle = client.workflow.getHandle(commandWorkflowId(command));
    if (command.kind === "start_run") {
      const description = await handle.describe();
      return description.type === FACTORY_WORKFLOW_TYPE && sameStartIdentity(description.memo?.[START_MEMO_KEY], startIdentity(command))
        ? "delivered"
        : "outcome_unknown";
    }
    if (!command.eventId || !command.eventSequence || !command.eventHash) return "outcome_unknown";
    const receipt = await handle.query(FACTORY_INBOX_RECEIPT_QUERY);
    if (receipt.pending.some((item) => item.sequence === command.eventSequence && item.eventId === command.eventId && item.eventHash === command.eventHash)) return "delivered";
    if (receipt.acknowledgedSequence < command.eventSequence || !identityStore?.confirmInboxIdentity) return "outcome_unknown";
    return await identityStore.confirmInboxIdentity(command) ? "delivered" : "outcome_unknown";
  } catch {
    return "outcome_unknown";
  }
}

export async function deliverFactoryCommand(client: FactoryDispatchClient, command: FactoryTransportCommand): Promise<void> {
  if (command.requestId !== command.commandId) throw new Error("Temporal request ID must equal command ID");
  if (command.kind === "start_run") {
    const input = startInput(command);
    const options = {
      args: [input],
      taskQueue: FACTORY_TASK_QUEUE,
      workflowId: command.workflowId,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      retry: { maximumAttempts: 1 },
      memo: { [START_MEMO_KEY]: startIdentity(command) },
      [START_OPTIONS]: { requestId: command.commandId },
    };
    try {
      await client.workflow.start(FACTORY_WORKFLOW_TYPE, options);
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError) || await reconcileFactoryCommand(client, command) !== "delivered") throw error;
    }
    return;
  }
  if (!command.eventId || !command.eventSequence || !command.eventHash) throw new Error("signal command requires a stable event identity, hash, and sequence");
  const envelope = { sequence: command.eventSequence, eventId: command.eventId, eventHash: command.eventHash, event: command.body };
  validateInboxEnvelope(envelope);
  await client.workflow.getHandle(commandWorkflowId(command)).signal(FACTORY_INBOX_SIGNAL, envelope);
}

export function classifyDispatchError(error: unknown): DispatchVerdict {
  return error instanceof FactoryPreSendError ? "retry" : "outcome_unknown";
}

export async function dispatchClaim(client: FactoryDispatchClient, queue: FactoryCommandQueue, claim: ClaimedFactoryCommand): Promise<DispatchVerdict> {
  try {
    await deliverFactoryCommand(client, claim.command);
    await queue.settle(claim, "delivered");
    return "delivered";
  } catch (error) {
    if (await reconcileFactoryCommand(client, claim.command, queue) === "delivered") {
      await queue.settle(claim, "delivered");
      return "delivered";
    }
    const verdict = classifyDispatchError(error);
    await queue.settle(claim, verdict, error instanceof Error ? error.name : "UNKNOWN");
    return verdict;
  }
}

export async function reconcileClaim(client: FactoryDispatchClient, queue: FactoryCommandQueue, claim: ClaimedFactoryCommand): Promise<"delivered" | "outcome_unknown"> {
  const verdict = await reconcileFactoryCommand(client, claim.command, queue);
  if (verdict === "delivered") await queue.settle(claim, "delivered");
  return verdict;
}

export async function dispatchNext(client: FactoryDispatchClient, queue: FactoryCommandQueue): Promise<DispatchVerdict | "empty"> {
  const claim = await queue.claim();
  return claim ? dispatchClaim(client, queue, claim) : "empty";
}
