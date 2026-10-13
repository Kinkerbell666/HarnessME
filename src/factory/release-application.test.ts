import { expect, mock, test } from "bun:test";
import type { FactoryAssurance } from "./assurance";
import type { FactoryGrants, FactoryPrincipal } from "./grants";
import { FactoryReleaseApplication } from "./release-application";
import { FactoryReleaseError, type FactoryReleaseOperation, type FactoryReleaseProvider, type FactoryReleases } from "./releases";

const tenantId = "tenant-1", projectId = "project-1";
const actor: FactoryPrincipal = { kind: "user", id: "admin-1", authentication: "session" };
const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const operation = { tenantId, projectId, operationId: "operation-1", runId: "run-1", nodeInstanceId: "node-1", candidateGeneration: 0, decisionId: "decision-1", candidateDigest: digest("a"), contractDigest: digest("b"), executionEpoch: 1, cancellationEpoch: 0, releaseEnableEpoch: 1, action: "publish", destination: { provider: "s3", account: "account-1", object: "release.json" }, destinationDigest: digest("c"), request: {}, requestDigest: digest("d"), material: { decisionId: "decision-1", evidence: [], packageTrustDigest: digest("e"), validatorTrustDigest: digest("f") }, materialDigest: digest("a"), estimatedSpendMicros: 1, deadlineMs: 2_000_000_000_000, state: "uncertain", dispatchGeneration: 1, dispatchStarted: true, archiveReady: true } satisfies FactoryReleaseOperation;

function fixture() {
  const grants = { tenantId, authorize: mock(async () => ({ revision: 1, expiresAtMs: null })) };
  const assurance = { tenantId, approveContract: mock(async () => {}), decideApproval: mock(async () => {}) };
  // The application resolves one profile outside every transaction, then hands the sealed
  // preparation to the store; the store is faked here, so both calls are observed by identity.
  const preparation = { request: { projectId, runId: operation.runId, nodeInstanceId: operation.nodeInstanceId, candidateGeneration: 0, decisionId: operation.decisionId, candidateDigest: operation.candidateDigest, action: operation.action, destination: operation.destination, request: {}, estimatedSpendMicros: 1, deadlineMs: operation.deadlineMs }, profileInput: { tenantId, projectId, runId: operation.runId, acceptedManifest: null, requestedDestination: operation.destination, decision: {}, material: operation.material }, profile: { schemaVersion: "factory.release-profile-result.v1" as const, destination: operation.destination, request: {}, estimatedSpendMicros: 1, inputDigest: digest("a"), resultDigest: digest("b"), resolvedAtMs: 1 } };
  const releases = { tenantId, preparation, resolvePreparation: mock(async (_input: unknown, _profile: unknown, _signal: unknown) => preparation), ensureArchived: mock(async () => operation), prepare: mock(async () => operation), inspect: mock(async () => operation), requestApproval: mock(async () => ({ approvalId: "approval-1", contextDigest: "a".repeat(64) })), deliverNextNotification: mock(async () => null), listDeliveredNotifications: mock(async () => ({ items: [], nextCursor: null })), createPolicy: mock(async () => {}), revokePolicy: mock(async () => {}), reconcile: mock(async () => operation) };
  const provider = {} as FactoryReleaseProvider;
  const providers = { resolve: mock(async () => provider) };
  return { grants, assurance, releases, provider, providers, application: new FactoryReleaseApplication(tenantId, grants as unknown as FactoryGrants, assurance as unknown as FactoryAssurance, releases as unknown as FactoryReleases, providers) };
}

test("release application forwards exact public preconditions into durable stores", async () => {
  const f = fixture();
  const contract = { contractDigest: digest("a"), validatorLockDigest: digest("b"), mandatoryClaims: [], claimGroups: [] };
  expect(await f.application.putContract(actor, projectId, "contract-1", contract, 1, "contract-key")).toEqual({ contractId: "contract-1", revision: 2, ...contract });
  expect(f.assurance.approveContract).toHaveBeenCalledWith(actor, { projectId, contractId: "contract-1", revision: 2, ...contract }, "contract-key");
  const prepared = await f.application.prepare(actor, projectId, { runId: operation.runId, nodeInstanceId: operation.nodeInstanceId, candidateGeneration: 0, decisionId: operation.decisionId, candidateDigest: operation.candidateDigest, action: operation.action, destination: operation.destination, request: {}, estimatedSpendMicros: 1, deadlineMs: operation.deadlineMs }, "prepare-key");
  expect(prepared).toBe(operation);
  // The resolve names the exact identity and carries no manifest, because this path has none.
  expect(f.releases.resolvePreparation).toHaveBeenCalledWith({ projectId, runId: operation.runId, nodeInstanceId: operation.nodeInstanceId, candidateGeneration: 0, decisionId: operation.decisionId, candidateDigest: operation.candidateDigest, acceptedManifest: null, requestedDestination: operation.destination, deadlineMs: operation.deadlineMs }, expect.objectContaining({ action: operation.action }), expect.any(AbortSignal));
  expect(f.releases.prepare).toHaveBeenCalledWith(actor, f.releases.preparation, "prepare-key");
  await f.application.requestApproval(actor, projectId, operation.operationId, { expiresAtMs: operation.deadlineMs }, 1, "approval-key");
  expect(f.releases.requestApproval).toHaveBeenCalledWith(actor, projectId, operation.operationId, operation.deadlineMs, 1, "approval-key");
  expect(await f.application.listNotifications(actor, projectId, { limit: 25 })).toEqual({ items: [], nextCursor: null });
  expect(f.releases.listDeliveredNotifications).toHaveBeenCalledWith(actor, projectId, { limit: 25 });
  expect(await f.application.notifications.deliverNext(projectId)).toBeNull();
  expect(f.releases.deliverNextNotification).toHaveBeenCalledWith(projectId);
  await expect(f.application.decideApproval(actor, projectId, "approval-1", { contextDigest: "a".repeat(64), decision: "approved" }, 1, "decision-key")).rejects.toMatchObject({ code: "factory_release_precondition" });
  await f.application.decideApproval(actor, projectId, "approval-1", { contextDigest: "a".repeat(64), decision: "denied" }, 0, "decision-key");
  expect(f.assurance.decideApproval).toHaveBeenCalledWith(actor, projectId, "approval-1", "a".repeat(64), false, "decision-key");
  const policy = { principalKind: "service" as const, principalId: "service-1", action: "publish", destinationProvider: "s3", destinationAccount: "account-1", destinationPrefix: "releases/", contractDigest: digest("a"), maxOperations: 1, maxSpendMicros: 1, expiresAtMs: operation.deadlineMs };
  expect(await f.application.putPolicy(actor, projectId, "policy-1", policy, 0, "policy-key")).toMatchObject({ revision: 1, revoked: false });
  await expect(f.application.putPolicy(actor, projectId, "policy-1", policy, 1, "policy-stale")).rejects.toMatchObject({ code: "factory_release_precondition" });
  expect(await f.application.deletePolicy(actor, projectId, "policy-1", 1, "policy-delete")).toEqual({ policyId: "policy-1", revision: 2, revoked: true });
});

test("release application authorizes reads and resolves reconciliation providers from stored operations", async () => {
  const f = fixture();
  expect(await f.application.inspect(actor, projectId, operation.operationId)).toBe(operation);
  expect(f.grants.authorize).toHaveBeenCalledWith(actor, projectId, "factory.release");
  const body = { action: "keep_uncertain" as const, reason: "Provider is still unknown", providerEvidence: { lookup: true } };
  expect(await f.application.reconcile(actor, projectId, operation.operationId, body, 1, "reconcile-key")).toBe(operation);
  expect(f.grants.authorize).toHaveBeenCalledWith(actor, projectId, "factory.operate");
  expect(f.providers.resolve).toHaveBeenCalledWith(operation);
  expect(f.releases.reconcile).toHaveBeenCalledWith(actor, { projectId, operationId: operation.operationId, ...body }, 1, f.provider, "reconcile-key");
  await expect(f.application.reconcile({ kind: "user", id: actor.id, authentication: "api-key" }, projectId, operation.operationId, body, 1, "api-key")).rejects.toMatchObject({ code: "factory_release_human_required" });
  expect(f.providers.resolve).toHaveBeenCalledTimes(1);
});

test("release application authorizes reconciliation before provider lookup", async () => {
  const f = fixture();
  f.grants.authorize.mockRejectedValueOnce(new Error("factory_forbidden"));
  const body = { action: "keep_uncertain" as const, reason: "Provider is still unknown", providerEvidence: { lookup: true } };
  await expect(f.application.reconcile(actor, projectId, operation.operationId, body, 1, "reconcile-denied")).rejects.toThrow("factory_forbidden");
  expect(f.releases.inspect).not.toHaveBeenCalled();
  expect(f.providers.resolve).not.toHaveBeenCalled();
});

test("release application authorizes a prepare before it reads the run's acceptance or resolves a profile", async () => {
  const f = fixture();
  f.grants.authorize.mockRejectedValueOnce(new Error("factory_forbidden"));
  await expect(f.application.prepare(actor, "project-of-another-user", { runId: operation.runId, nodeInstanceId: operation.nodeInstanceId, candidateGeneration: 0, decisionId: operation.decisionId, candidateDigest: operation.candidateDigest, action: operation.action, destination: operation.destination, request: {}, estimatedSpendMicros: 1, deadlineMs: operation.deadlineMs }, "prepare-denied")).rejects.toThrow("factory_forbidden");
  expect(f.grants.authorize).toHaveBeenCalledWith(actor, "project-of-another-user", "factory.release");
  expect(f.releases.resolvePreparation).not.toHaveBeenCalled();
  expect(f.releases.prepare).not.toHaveBeenCalled();
});

test("release application snapshots mutable public bodies before awaiting stores", async () => {
  const f = fixture();
  let finishContract!: () => void;
  f.assurance.approveContract.mockImplementationOnce(() => new Promise<void>(resolve => { finishContract = resolve; }));
  const contract = { contractDigest: digest("a"), validatorLockDigest: digest("b"), mandatoryClaims: [{ id: "tests", validatorId: "validator-1", freshnessMs: 60_000 }], claimGroups: [] };
  const contractPromise = f.application.putContract(actor, projectId, "contract-1", contract, 0, "contract-snapshot");
  contract.mandatoryClaims[0]!.id = "mutated";
  finishContract();
  expect((await contractPromise).mandatoryClaims[0]?.id).toBe("tests");

  let finishApproval!: () => void;
  f.releases.requestApproval.mockImplementationOnce(() => new Promise(resolve => { finishApproval = () => resolve({ approvalId: "approval-1", contextDigest: "a".repeat(64) }); }));
  const approvalBody = { expiresAtMs: operation.deadlineMs };
  const approvalPromise = f.application.requestApproval(actor, projectId, operation.operationId, approvalBody, 0, "approval-snapshot");
  approvalBody.expiresAtMs = 1;
  finishApproval();
  expect((await approvalPromise).expiresAtMs).toBe(operation.deadlineMs);

  let finishPolicy!: () => void;
  f.releases.createPolicy.mockImplementationOnce(() => new Promise<void>(resolve => { finishPolicy = resolve; }));
  const policy = { principalKind: "service" as const, principalId: "service-1", action: "publish", destinationProvider: "s3", destinationAccount: "account-1", destinationPrefix: "releases/", contractDigest: digest("a"), maxOperations: 1, maxSpendMicros: 1, expiresAtMs: operation.deadlineMs };
  const policyPromise = f.application.putPolicy(actor, projectId, "policy-1", policy, 0, "policy-snapshot");
  policy.destinationPrefix = "mutated/";
  finishPolicy();
  expect((await policyPromise).destinationPrefix).toBe("releases/");
});

test("release application rejects mixed tenant stores", () => {
  const f = fixture();
  expect(() => new FactoryReleaseApplication("other", f.grants as unknown as FactoryGrants, f.assurance as unknown as FactoryAssurance, f.releases as unknown as FactoryReleases, f.providers)).toThrow(FactoryReleaseError);
});
