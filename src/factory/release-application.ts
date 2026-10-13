import type { FactoryReleaseApprovalDecisionBody, FactoryReleaseContractBody, FactoryReleasePolicyBody, FactoryReleasePrepareBody, FactoryReleaseReconciliationBody } from "@ezcorp/factory-sdk";
import type { FactoryAssurance } from "./assurance";
import type { FactoryGrants, FactoryPrincipal } from "./grants";
import { FactoryNotificationDelivery } from "./notification-delivery";
import type { JsonValue } from "@ezcorp/factory-sdk";
import { FactoryReleaseError, factoryRequestedReleaseProfile, type FactoryReleaseOperation, type FactoryReleaseProvider, type FactoryReleases } from "./releases";

export interface FactoryReleaseProviderResolver {
  resolve(operation: FactoryReleaseOperation): FactoryReleaseProvider | Promise<FactoryReleaseProvider>;
}

/** Public application seam over the durable stores. Provider selection always uses the persisted destination. */
export class FactoryReleaseApplication {
  private readonly providers: FactoryReleaseProviderResolver;
  readonly notifications: FactoryNotificationDelivery;
  constructor(
    readonly tenantId: string,
    private readonly grants: FactoryGrants,
    private readonly assurance: FactoryAssurance,
    private readonly releases: FactoryReleases,
    providers: FactoryReleaseProviderResolver,
  ) {
    if (grants.tenantId !== tenantId || assurance.tenantId !== tenantId || releases.tenantId !== tenantId) throw new FactoryReleaseError("factory_release_scope");
    this.providers = Object.freeze({ resolve: providers.resolve.bind(providers) });
    this.notifications = new FactoryNotificationDelivery(releases);
  }

  async putContract(actor: FactoryPrincipal, projectId: string, contractId: string, body: FactoryReleaseContractBody, expectedRevision: number, idempotencyKey: string) {
    const snapshot = structuredClone(body);
    await this.assurance.approveContract(actor, { projectId, contractId, revision: expectedRevision + 1, ...snapshot }, idempotencyKey);
    return { contractId, revision: expectedRevision + 1, ...snapshot };
  }

  /**
   * The direct release API.
   *
   * The caller supplies the exact destination and request, so the profile is the identity one; the
   * resolve still runs outside every transaction and still seals the acceptance decision and the
   * pinned material the bytes were chosen against. `acceptedManifest` is `null` here because this
   * path resolves no manifest: the request IS the caller's manifest.
   */
  async prepare(actor: FactoryPrincipal, projectId: string, body: FactoryReleasePrepareBody, idempotencyKey: string, signal?: AbortSignal) {
    const request = { projectId, ...structuredClone(body) };
    // Authorize before the resolve reads the run's acceptance, so a caller without the grant
    // learns nothing about another project's runs. The store authorizes again in its transaction.
    await this.grants.authorize(actor, projectId, "factory.release");
    const preparation = await this.releases.resolvePreparation({
      projectId, runId: request.runId, nodeInstanceId: request.nodeInstanceId, candidateGeneration: request.candidateGeneration,
      decisionId: request.decisionId, candidateDigest: request.candidateDigest,
      acceptedManifest: null, requestedDestination: request.destination as unknown as JsonValue, deadlineMs: request.deadlineMs,
    }, factoryRequestedReleaseProfile(request), signal ?? new AbortController().signal);
    return this.releases.prepare(actor, preparation, idempotencyKey);
  }

  async inspect(actor: FactoryPrincipal, projectId: string, operationId: string) {
    await this.grants.authorize(actor, projectId, "factory.release");
    return this.releases.inspect(projectId, operationId);
  }

  listNotifications(actor: FactoryPrincipal, projectId: string, options?: Parameters<FactoryNotificationDelivery["listForHuman"]>[2]) {
    return this.notifications.listForHuman(actor, projectId, options);
  }

  async requestApproval(actor: FactoryPrincipal, projectId: string, operationId: string, body: { readonly expiresAtMs: number }, expectedGeneration: number, idempotencyKey: string) {
    const snapshot = structuredClone(body);
    const result = await this.releases.requestApproval(actor, projectId, operationId, snapshot.expiresAtMs, expectedGeneration, idempotencyKey);
    return { operationId, expiresAtMs: snapshot.expiresAtMs, status: "pending" as const, ...result };
  }

  async decideApproval(actor: FactoryPrincipal, projectId: string, approvalId: string, body: FactoryReleaseApprovalDecisionBody, expectedRevision: number, idempotencyKey: string) {
    if (expectedRevision !== 0) throw new FactoryReleaseError("factory_release_precondition");
    await this.assurance.decideApproval(actor, projectId, approvalId, body.contextDigest, body.decision === "approved", idempotencyKey);
    return { approvalId, contextDigest: body.contextDigest, status: body.decision };
  }

  async putPolicy(actor: FactoryPrincipal, projectId: string, policyId: string, body: FactoryReleasePolicyBody, expectedRevision: number, idempotencyKey: string) {
    if (expectedRevision !== 0) throw new FactoryReleaseError("factory_release_precondition");
    const snapshot = structuredClone(body);
    await this.releases.createPolicy(actor, { projectId, policyId, principal: snapshot.principalKind === "user" ? { kind: "user", id: snapshot.principalId, authentication: "session" } : { kind: "service", id: snapshot.principalId, authentication: "service" }, action: snapshot.action, destinationProvider: snapshot.destinationProvider, destinationAccount: snapshot.destinationAccount, destinationPrefix: snapshot.destinationPrefix, contractDigest: snapshot.contractDigest, revision: 1, maxOperations: snapshot.maxOperations, maxSpendMicros: snapshot.maxSpendMicros, expiresAtMs: snapshot.expiresAtMs }, idempotencyKey);
    return { policyId, revision: 1 as const, revoked: false as const, ...snapshot };
  }

  async deletePolicy(actor: FactoryPrincipal, projectId: string, policyId: string, expectedRevision: number, idempotencyKey: string) {
    await this.releases.revokePolicy(actor, projectId, policyId, expectedRevision, idempotencyKey);
    return { policyId, revision: expectedRevision + 1, revoked: true as const };
  }

  async reconcile(actor: FactoryPrincipal, projectId: string, operationId: string, body: FactoryReleaseReconciliationBody, expectedGeneration: number, idempotencyKey: string) {
    if (actor.kind !== "user" || actor.authentication !== "session") throw new FactoryReleaseError("factory_release_human_required");
    const snapshot = structuredClone(body);
    await this.grants.authorize(actor, projectId, "factory.operate");
    const operation = await this.releases.inspect(projectId, operationId);
    if (!operation) throw new FactoryReleaseError("factory_release_not_found");
    const provider = await this.providers.resolve(operation);
    return this.releases.reconcile(actor, { projectId, operationId, ...snapshot }, expectedGeneration, provider, idempotencyKey);
  }
}
