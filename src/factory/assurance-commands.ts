import type { JsonValue, KernelEvent } from "@ezcorp/factory-sdk";
import { sql } from "drizzle-orm";
import type { MigrationDb, TransactionalDb } from "../db/migrations/types";
import { insertTransactionalAuditEntry } from "../db/queries/audit-log";
import { releaseRows as rows } from "../db/queries/extension-releases";
import { durableInputHash } from "../delivery-queue/durable-delivery-queue";
import { approvalContextDigest, assertApprovalUsable, canonicalApprovalContext, type ApprovalContext } from "../extensions/v4/approval-context";
import { digestObject } from "../extensions/v4/blobs";
import type { FactoryAuthorizedApprovalCommand, FactoryCommandAuthority } from "./command-authority";
import type { FactoryGrants, FactoryPrincipal } from "./grants";
import type { FactoryInbox } from "./inbox";
import { FactoryMutations } from "./mutations";
import { assertFactoryIdentity, encodeFactoryPayload } from "./records";
import type { TrustedFactoryCommandReference, TrustedFactoryServiceIdentity } from "./trusted-command-gateway";

export type FactoryCommandApprovalActorScope = "owner" | "operator" | "tenant-contract-admin";
type ActorScope = FactoryCommandApprovalActorScope;
type Status = "pending" | "answered";

export interface FactoryCommandApprovalNotifier {
  readonly tenantId: string;
  enqueueCommandApprovalInTransaction(transaction: MigrationDb, projectId: string, approvalId: string): Promise<unknown>;
}

export interface FactoryCommandApprovalDecision {
  readonly approvalId: string;
  readonly runId: string;
  readonly commandId: string;
  readonly nodeInstanceId: string;
  readonly revision: 1;
  readonly contextDigest: string;
  readonly status: "answered";
  readonly choices: readonly string[];
  readonly context: JsonValue;
  readonly actorScope: ActorScope;
  readonly expiresAtMs: number;
  readonly choice: string;
  readonly decidedBy: string;
  readonly decidedAtMs: number;
}

type ApprovalRow = {
  tenant_id: string; project_id: string; approval_id: string; run_id: string; interpreter_id: string; command_id: string;
  source_sequence: number | string; source_digest: string; node_instance_id: string; candidate_generation: number | string; attempt: number | string;
  definition_digest: string; execution_epoch: number | string; cancellation_epoch: number | string;
  initiator_kind: FactoryPrincipal["kind"]; initiator_id: string; actor_scope: ActorScope; choices_json: string; context_json: string;
  deadline_at_ms: number | string; context_digest: string; protected_digest: string; status: Status; choice: string | null;
  decided_by: string | null; decided_approve_revision: number | string | null; decided_trust_revision: number | string | null; decided_at_ms: number | string | null;
  event_json: string | null; event_digest: string | null;
};

type HeadRow = { source_sequence: number | string; digest: string };

export class FactoryAssuranceCommandError extends Error {
  constructor(readonly code: string) { super(code); this.name = "FactoryAssuranceCommandError"; }
}

const encoded = (value: unknown): string => encodeFactoryPayload(value);
const sha = (value: unknown): string => `sha256:${digestObject(value)}`;

export interface FactoryCommandApprovalProtectedFacts {
  readonly tenantId: string; readonly projectId: string; readonly runId: string; readonly interpreterId: string; readonly commandId: string;
  readonly sourceSequence: number; readonly sourceDigest: string; readonly nodeInstanceId: string; readonly candidateGeneration: number; readonly attempt: number;
  readonly initiator: { readonly kind: FactoryPrincipal["kind"]; readonly id: string }; readonly actorScope: FactoryCommandApprovalActorScope;
  readonly choices: readonly string[]; readonly context: JsonValue; readonly deadlineAtMs: number; readonly definitionDigest: string; readonly executionEpoch: number; readonly cancellationEpoch: number;
}

export function protectFactoryCommandApproval(facts: FactoryCommandApprovalProtectedFacts): { readonly context: ApprovalContext; readonly contextDigest: string; readonly protectedDigest: string } {
  const context = canonicalApprovalContext({ subjectId: facts.commandId, subjectDigest: digestObject(facts), principalId: facts.initiator.id, scope: facts.projectId, grants: facts.actorScope === "tenant-contract-admin" ? ["factory.approve", "factory.trust"] : ["factory.approve"], expectedGeneration: facts.candidateGeneration, expiresAtMs: facts.deadlineAtMs });
  return { context, contextDigest: approvalContextDigest(context), protectedDigest: sha({ facts, context }) };
}

function actorScope(value: string): ActorScope {
  if (value !== "owner" && value !== "operator" && value !== "tenant-contract-admin") throw new FactoryAssuranceCommandError("factory_command_approval_scope");
  return value;
}

function integer(value: number, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new FactoryAssuranceCommandError("factory_command_approval_invalid");
}

function text(...values: readonly string[]): void {
  if (values.some(value => typeof value !== "string" || value.length < 1 || value.length > 512 || value.includes("\0"))) throw new FactoryAssuranceCommandError("factory_command_approval_invalid");
}

function snapshot<Value>(value: Value): Value {
  return JSON.parse(encoded(value)) as Value;
}

/** Executes generic approval commands and commits their human answer to the existing interpreter inbox. */
export class FactoryAssuranceCommands {
  private readonly mutations: FactoryMutations;
  private readonly service: TrustedFactoryServiceIdentity;

  constructor(
    private readonly database: TransactionalDb,
    readonly tenantId: string,
    private readonly grants: FactoryGrants,
    private readonly authority: FactoryCommandAuthority,
    private readonly inbox: FactoryInbox,
    private readonly notifications: FactoryCommandApprovalNotifier,
    service: TrustedFactoryServiceIdentity,
    private readonly now: () => number = Date.now,
  ) {
    assertFactoryIdentity(tenantId, service.tenantId, service.subject);
    if (service.tenantId !== tenantId || grants.tenantId !== tenantId || authority.tenantId !== tenantId || inbox.tenantId !== tenantId || notifications.tenantId !== tenantId) throw new FactoryAssuranceCommandError("factory_command_approval_scope");
    this.service = Object.freeze({ tenantId: service.tenantId, subject: service.subject });
    authority.assertService(this.service);
    this.mutations = new FactoryMutations(database, tenantId, grants);
  }

  /** Returns null only while the exact current command awaits a human answer. */
  async execute(value: TrustedFactoryCommandReference): Promise<KernelEvent | null> {
    const reference = snapshot(value);
    this.reference(reference);
    this.authority.assertService(this.service);
    const settled = await this.findByCommand(this.database, reference);
    if (settled?.status === "answered") return this.event(settled);
    return this.authority.withCurrentApproval(this.service, reference, (transaction, current) => this.requestInTransaction(transaction, reference, current));
  }

  async decide(actor: FactoryPrincipal, projectId: string, runId: string, approvalId: string, contextDigest: string, choice: string, expectedRevision: number, idempotencyKey: string): Promise<FactoryCommandApprovalDecision> {
    [actor, projectId, runId, approvalId, contextDigest, choice] = snapshot([actor, projectId, runId, approvalId, contextDigest, choice]);
    text(projectId, runId, approvalId, choice); assertFactoryIdentity(projectId, runId, approvalId, actor.id);
    if (!/^[a-f0-9]{64}$/.test(contextDigest) || expectedRevision !== 0 || actor.kind !== "user" || actor.authentication !== "session") throw new FactoryAssuranceCommandError("factory_command_approval_invalid");
    // Authorize before the lookup, so a caller without the grant cannot tell a real approval
    // in another project from a missing one. The mutation authorizes again in its transaction.
    await this.grants.authorize(actor, projectId, "factory.approve");
    const locator = await this.findById(this.database, projectId, approvalId);
    if (!locator || locator.run_id !== runId) throw new FactoryAssuranceCommandError("factory_command_approval_not_found");
    this.decode(locator);
    return this.mutations.execute(
      { principal: actor, projectId, action: "factory.approve", idempotencyKey, input: { kind: "command.approval.decide", runId, approvalId, contextDigest, choice, expectedRevision } },
      transaction => this.authority.withCurrentApprovalInTransaction(transaction, this.service, this.referenceFor(locator), async (locked, current) => {
        const row = await this.lockById(locked, projectId, approvalId);
        if (!row) throw new FactoryAssuranceCommandError("factory_command_approval_not_found");
        this.assertCurrent(row, current);
        const decoded = this.decode(row);
        if (decoded.contextDigest !== contextDigest || !decoded.choices.includes(choice)) throw new FactoryAssuranceCommandError("factory_command_approval_stale");
        if (row.status !== "pending") throw new FactoryAssuranceCommandError("factory_command_approval_stale");
        try {
          assertApprovalUsable("pending", decoded.context, { subjectDigest: decoded.context.subjectDigest, principalId: current.initiator.id, scope: projectId, expectedGeneration: current.attempt.candidateGeneration }, this.now(), false);
        } catch {
          throw new FactoryAssuranceCommandError("factory_command_approval_stale");
        }
        const approve = await this.grants.authorizeInTransaction(locked, actor, projectId, "factory.approve");
        const trust = row.actor_scope === "tenant-contract-admin" ? await this.grants.authorizeInTransaction(locked, actor, projectId, "factory.trust") : undefined;
        this.assertActor(row, actor);
        const decidedAtMs = this.now(); integer(decidedAtMs);
        const event: KernelEvent = { id: `factory-approval-event:${digestObject({ tenantId: this.tenantId, projectId, approvalId, choice })}`, atMs: decidedAtMs, kind: "approval-decided", nodeId: row.node_instance_id, commandId: row.command_id, choice };
        const eventJson = encoded(event), eventDigest = durableInputHash(event);
        const changed = rows(await locked.execute(sql`UPDATE factory_command_approvals SET status='answered',choice=${choice},decided_by=${actor.id},decided_approve_revision=${approve.revision},decided_trust_revision=${trust?.revision ?? null},decided_at_ms=${decidedAtMs},event_json=${eventJson},event_digest=${eventDigest},updated_at=NOW()
          WHERE tenant_id=${this.tenantId} AND project_id=${projectId} AND approval_id=${approvalId} AND status='pending' RETURNING approval_id`));
        if (changed.length !== 1) throw new FactoryAssuranceCommandError("factory_command_approval_stale");
        await insertTransactionalAuditEntry(locked, `factory-command-approval-decision:${approvalId}`, actor.id, "factory.command.approval.decided", approvalId, { tenantId: this.tenantId, projectId, runId: row.run_id, interpreterId: row.interpreter_id, commandId: row.command_id, approvalId, choice, approveGrantRevision: approve.revision, ...(trust ? { trustGrantRevision: trust.revision } : {}) });
        await this.inbox.enqueueInTransaction(locked, { projectId, runId: row.run_id, interpreterId: row.interpreter_id }, event, "decision");
        return { approvalId, runId, commandId: row.command_id, nodeInstanceId: row.node_instance_id, revision: 1, contextDigest, status: "answered" as const, choices: decoded.choices, context: decoded.reviewContext, actorScope: row.actor_scope, expiresAtMs: Number(row.deadline_at_ms), choice, decidedBy: actor.id, decidedAtMs };
      }),
      transaction => this.authorizeDecision(transaction, actor, locator),
    );
  }

  private async requestInTransaction(transaction: MigrationDb, reference: TrustedFactoryCommandReference, current: FactoryAuthorizedApprovalCommand): Promise<KernelEvent | null> {
    const scope = actorScope(current.command.actorScope);
    const head = rows<HeadRow>(await transaction.execute(sql`SELECT a.source_sequence,a.digest FROM factory_transition_commands c JOIN factory_audit_batches a ON a.tenant_id=c.tenant_id AND a.project_id=c.project_id AND a.run_id=c.run_id AND a.interpreter_id=c.interpreter_id AND a.source_sequence=c.source_sequence
      WHERE c.tenant_id=${this.tenantId} AND c.project_id=${reference.projectId} AND c.run_id=${reference.logicalRunId} AND c.interpreter_id=${reference.interpreterId} AND c.command_id=${reference.commandId}`))[0];
    if (!head) throw new FactoryAssuranceCommandError("factory_command_approval_corrupt");
    const sourceSequence = Number(head.source_sequence); integer(sourceSequence, 1);
    const facts = this.facts(reference, current, sourceSequence, head.digest, scope);
    const { contextDigest, protectedDigest } = protectFactoryCommandApproval(facts);
    const approvalId = `factory-command-approval:${digestObject({ tenantId: this.tenantId, projectId: reference.projectId, runId: reference.logicalRunId, interpreterId: reference.interpreterId, commandId: reference.commandId })}`;
    await transaction.execute(sql`INSERT INTO factory_command_approvals
      (tenant_id,project_id,approval_id,run_id,interpreter_id,command_id,source_sequence,source_digest,node_instance_id,candidate_generation,attempt,definition_digest,execution_epoch,cancellation_epoch,initiator_kind,initiator_id,actor_scope,choices_json,context_json,deadline_at_ms,context_digest,protected_digest,status)
      VALUES (${this.tenantId},${reference.projectId},${approvalId},${reference.logicalRunId},${reference.interpreterId},${reference.commandId},${sourceSequence},${head.digest},${current.command.nodeId},${current.attempt.candidateGeneration},${current.attempt.attempt},${current.compiled.digest},${current.fence.executionEpoch},${current.fence.cancellationEpoch},${current.initiator.kind},${current.initiator.id},${scope},${encoded(current.command.choices)},${encoded(current.command.context)},${current.command.deadlineAtMs},${contextDigest},${protectedDigest},'pending') ON CONFLICT DO NOTHING`);
    const row = await this.lockById(transaction, reference.projectId, approvalId);
    if (!row) throw new FactoryAssuranceCommandError("factory_command_approval_corrupt");
    this.assertCurrent(row, current);
    const decoded = this.decode(row);
    if (decoded.contextDigest !== contextDigest || row.protected_digest !== protectedDigest) throw new FactoryAssuranceCommandError("factory_command_approval_conflict");
    if (row.status === "answered") return this.event(row);
    await insertTransactionalAuditEntry(transaction, `factory-command-approval-request:${approvalId}`, current.initiator.kind === "user" ? current.initiator.id : null, "factory.command.approval.requested", approvalId, { tenantId: this.tenantId, projectId: reference.projectId, runId: reference.logicalRunId, interpreterId: reference.interpreterId, commandId: reference.commandId, approvalId, contextDigest, actorScope: scope });
    await this.notifications.enqueueCommandApprovalInTransaction(transaction, reference.projectId, approvalId);
    return null;
  }

  private async authorizeDecision(transaction: MigrationDb, actor: FactoryPrincipal, row: ApprovalRow): Promise<void> {
    this.decode(row);
    await this.grants.authorizeInTransaction(transaction, actor, row.project_id, "factory.approve");
    if (row.actor_scope === "tenant-contract-admin") await this.grants.authorizeInTransaction(transaction, actor, row.project_id, "factory.trust");
    this.assertActor(row, actor);
  }

  private assertActor(row: ApprovalRow, actor: FactoryPrincipal): void {
    if (row.actor_scope === "owner" && (row.initiator_kind !== "user" || row.initiator_id !== actor.id)) throw new FactoryAssuranceCommandError("factory_command_approval_forbidden");
  }

  private assertCurrent(row: ApprovalRow, current: FactoryAuthorizedApprovalCommand): void {
    const reference = this.referenceFor(row);
    const facts = this.facts(reference, current, Number(row.source_sequence), row.source_digest, actorScope(row.actor_scope));
    const sealed = protectFactoryCommandApproval(facts);
    if (row.context_digest !== sealed.contextDigest || row.protected_digest !== sealed.protectedDigest) throw new FactoryAssuranceCommandError("factory_command_approval_stale");
  }

  private facts(reference: TrustedFactoryCommandReference, current: FactoryAuthorizedApprovalCommand, sourceSequence: number, sourceDigest: string, scope: ActorScope): FactoryCommandApprovalProtectedFacts {
    return { tenantId: this.tenantId, projectId: reference.projectId, runId: reference.logicalRunId, interpreterId: reference.interpreterId, commandId: reference.commandId, sourceSequence, sourceDigest, nodeInstanceId: current.command.nodeId, candidateGeneration: current.attempt.candidateGeneration, attempt: current.attempt.attempt, initiator: { kind: current.initiator.kind, id: current.initiator.id }, actorScope: scope, choices: current.command.choices, context: current.command.context, deadlineAtMs: current.command.deadlineAtMs, definitionDigest: current.compiled.digest, executionEpoch: current.fence.executionEpoch, cancellationEpoch: current.fence.cancellationEpoch };
  }

  private decode(row: ApprovalRow): { readonly context: ApprovalContext; readonly contextDigest: string; readonly choices: readonly string[]; readonly reviewContext: JsonValue } {
    try {
      text(row.tenant_id, row.project_id, row.approval_id, row.run_id, row.interpreter_id, row.command_id, row.source_digest, row.node_instance_id, row.definition_digest, row.initiator_id, row.context_digest, row.protected_digest);
      integer(Number(row.source_sequence), 1); integer(Number(row.candidate_generation)); integer(Number(row.attempt), 1); integer(Number(row.execution_epoch), 1); integer(Number(row.cancellation_epoch)); integer(Number(row.deadline_at_ms), 1);
      if ((row.initiator_kind !== "user" && row.initiator_kind !== "service") || !/^[a-f0-9]{64}$/.test(row.source_digest) || !/^sha256:[a-f0-9]{64}$/.test(row.definition_digest)) throw new Error("identity");
      const choices = JSON.parse(row.choices_json) as readonly string[];
      const contextValue = JSON.parse(row.context_json) as JsonValue;
      if (!Array.isArray(choices) || choices.length < 1 || choices.length > 100 || choices.some(choice => typeof choice !== "string" || choice.length < 1 || choice.length > 512)) throw new Error("choices");
      const facts = { tenantId: row.tenant_id, projectId: row.project_id, runId: row.run_id, interpreterId: row.interpreter_id, commandId: row.command_id, sourceSequence: Number(row.source_sequence), sourceDigest: row.source_digest, nodeInstanceId: row.node_instance_id, candidateGeneration: Number(row.candidate_generation), attempt: Number(row.attempt), initiator: { kind: row.initiator_kind, id: row.initiator_id }, actorScope: actorScope(row.actor_scope), choices, context: contextValue, deadlineAtMs: Number(row.deadline_at_ms), definitionDigest: row.definition_digest, executionEpoch: Number(row.execution_epoch), cancellationEpoch: Number(row.cancellation_epoch) };
      const sealed = protectFactoryCommandApproval(facts);
      if (row.context_digest !== sealed.contextDigest || row.protected_digest !== sealed.protectedDigest || row.status === "answered" && !this.event(row)) throw new Error("seal");
      return { context: sealed.context, contextDigest: row.context_digest, choices, reviewContext: contextValue };
    } catch (error) {
      if (error instanceof FactoryAssuranceCommandError) throw error;
      throw new FactoryAssuranceCommandError("factory_command_approval_corrupt");
    }
  }

  private event(row: ApprovalRow): KernelEvent {
    try {
      if (row.status !== "answered" || row.event_json === null || row.event_digest === null) throw new Error("pending");
      const event = JSON.parse(row.event_json) as KernelEvent;
      if (event.kind !== "approval-decided" || event.id !== `factory-approval-event:${digestObject({ tenantId: row.tenant_id, projectId: row.project_id, approvalId: row.approval_id, choice: row.choice })}` || event.nodeId !== row.node_instance_id || event.commandId !== row.command_id || event.choice !== row.choice || event.atMs !== Number(row.decided_at_ms) || durableInputHash(event) !== row.event_digest) throw new Error("event");
      return event;
    } catch { throw new FactoryAssuranceCommandError("factory_command_approval_corrupt"); }
  }

  private reference(value: TrustedFactoryCommandReference): void {
    assertFactoryIdentity(value.tenantId, value.projectId, value.logicalRunId, value.interpreterId, value.commandId);
    if (value.tenantId !== this.tenantId) throw new FactoryAssuranceCommandError("factory_command_approval_scope");
  }

  private referenceFor(row: ApprovalRow): TrustedFactoryCommandReference {
    return { tenantId: row.tenant_id, projectId: row.project_id, logicalRunId: row.run_id, interpreterId: row.interpreter_id, commandId: row.command_id };
  }

  private async findByCommand(database: MigrationDb, reference: TrustedFactoryCommandReference): Promise<ApprovalRow | undefined> {
    return rows<ApprovalRow>(await database.execute(sql`SELECT * FROM factory_command_approvals WHERE tenant_id=${this.tenantId} AND project_id=${reference.projectId} AND run_id=${reference.logicalRunId} AND interpreter_id=${reference.interpreterId} AND command_id=${reference.commandId}`))[0];
  }

  private async findById(database: MigrationDb, projectId: string, approvalId: string): Promise<ApprovalRow | undefined> {
    return rows<ApprovalRow>(await database.execute(sql`SELECT * FROM factory_command_approvals WHERE tenant_id=${this.tenantId} AND project_id=${projectId} AND approval_id=${approvalId}`))[0];
  }

  private async lockById(database: MigrationDb, projectId: string, approvalId: string): Promise<ApprovalRow | undefined> {
    return rows<ApprovalRow>(await database.execute(sql`SELECT * FROM factory_command_approvals WHERE tenant_id=${this.tenantId} AND project_id=${projectId} AND approval_id=${approvalId} FOR UPDATE`))[0];
  }
}
