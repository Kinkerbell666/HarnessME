import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { canonicalizeJson } from "./canonical";
import { factoryApiMutationPayload, factoryApiPayloadDigest, validateFactoryApiPayloadDigest } from "./api";
import { compileFactory } from "./compiler";
import { referenceCodeV1 } from "./references";
import { factoryApiRequestJsonSchema, factoryApiResponseJsonSchema, isFactoryApiRequest, isFactoryApiResponse } from "./schema";
import type { FactoryApiRequest, FactoryApiResponse, FactoryDraftSummary, JsonValue } from "./types";
import { FACTORY_API_REQUEST_SCHEMA_VERSION, FACTORY_API_RESPONSE_SCHEMA_VERSION, FACTORY_LIMITS } from "./types";
import { validateFactoryApiRequest, validateFactoryApiResponse } from "./validation";

const compiledResult = compileFactory(referenceCodeV1);
if (!compiledResult.ok) throw new Error(JSON.stringify(compiledResult.diagnostics));
const compiled = compiledResult.factory;
const sourceDigest = createHash("sha256").update(canonicalizeJson(referenceCodeV1 as unknown as JsonValue)).digest("hex");
const compiledJson = canonicalizeJson(compiled as unknown as JsonValue);
const compiledBlobDigest = createHash("sha256").update(compiledJson).digest("hex");
const preconditions = { idempotencyKey: "request-1", payloadDigest: sourceDigest, expectedRevision: 1 } as const;
const project = { projectId: "project-1" } as const;
const draft = { ...project, factoryId: referenceCodeV1.id } as const;
const definitionBody = { source: referenceCodeV1 } as const;
const packageLock = { package: "@ezcorp/release-runner", manifestName: "release-runner", version: "1.2.3", digest: `sha256:${sourceDigest}`, export: "release", model: "model-1", configurationDigest: `sha256:${compiledBlobDigest}` } as const;
const releaseDestination = { provider: "s3", account: "tenant-1", object: "releases/output.json", expectedVersion: "v1" } as const;
const releasePolicy = { principalKind: "service" as const, principalId: "service-1", action: "publish", destinationProvider: "s3", destinationAccount: "tenant-1", destinationPrefix: "releases/", contractDigest: `sha256:${compiledBlobDigest}`, maxOperations: 2, maxSpendMicros: 10, expiresAtMs: 2_000_000_000_000 };

function code(result: ReturnType<typeof validateFactoryApiRequest> | ReturnType<typeof validateFactoryApiResponse>): string | undefined {
  return result.ok ? undefined : result.issues[0]?.code;
}

function requests(): FactoryApiRequest[] {
  const values: FactoryApiRequest[] = [
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "draft.create", path: project, preconditions: { ...preconditions, expectedRevision: 0 }, body: definitionBody },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "draft.update", path: draft, preconditions, body: definitionBody },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "draft.delete", path: draft, preconditions },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "draft.get", path: draft },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "draft.list", path: project, query: { limit: 50, availability: "available", archived: false } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "draft.import", path: project, preconditions: { ...preconditions, expectedRevision: 0 }, body: { format: "yaml", source: "schemaVersion: factory.v1" } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "draft.export", path: draft, query: { format: "json" } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "draft.validate", path: draft, body: definitionBody },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "version.publish", path: draft, preconditions, body: { version: referenceCodeV1.version } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "version.get", path: { ...draft, version: referenceCodeV1.version } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "version.list", path: draft, query: {} },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "run.start", path: draft, preconditions: { ...preconditions, expectedRevision: 0 }, body: { factoryVersion: referenceCodeV1.version, definitionDigest: compiled.digest, grantRevision: 3, parameters: { request: { kind: "inline", value: "build it" } } } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "run.get", path: { ...project, runId: "run-1" } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "run.list", path: project, query: { status: "running", factoryId: referenceCodeV1.id } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "run.control", path: { ...project, runId: "run-1" }, preconditions, body: { action: "cancel", reason: "User request" } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "run.control", path: { ...project, runId: "run-1" }, preconditions, body: { action: "repair", nodeId: "compile", parameters: { instruction: { kind: "inline", value: "fix tests" } } } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "run.control", path: { ...project, runId: "run-1" }, preconditions, body: { action: "replan", nodeId: "compile", replacement: { id: "child-factory", version: "2", digest: compiled.digest }, parameters: {} } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "approval.get", path: { ...project, runId: "run-1", approvalId: "approval-1" } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "approval.list", path: project, query: { limit: 200 } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "approval.decide", path: { ...project, runId: "run-1", approvalId: "approval-1" }, preconditions: { ...preconditions, expectedRevision: 0 }, body: { choice: "approve", contextDigest: sourceDigest } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "grant.list", path: project, query: { principalKind: "service", action: "factory.run" } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "grant.set", path: { ...project, principalKind: "service", principalId: "agent-1", action: "factory.run" }, preconditions: { ...preconditions, expectedRevision: 0 }, body: { expiresAtMs: 2_000_000_000_000 } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "grant.revoke", path: { ...project, principalKind: "user", principalId: "user-1", action: "factory.author" }, preconditions },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "service-credential.issue", path: { ...project, serviceAccountId: "service-1" }, preconditions: { ...preconditions, expectedRevision: 0 }, body: { scopes: ["read", "chat"], expiresAtMs: 2_000_000_000_000 } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "service-credential.revoke", path: { ...project, serviceAccountId: "service-1", credentialId: "credential-1" }, preconditions },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.trust.publish", path: project, preconditions: { ...preconditions, expectedRevision: 0 }, body: { packageLock, validatorTrustDigest: `sha256:${sourceDigest}` } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.trust.revoke", path: project, preconditions },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.control.set", path: project, preconditions: { ...preconditions, expectedRevision: 0 }, body: { enabled: true } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.contract.put", path: { ...project, contractId: "contract-1" }, preconditions: { ...preconditions, expectedRevision: 0 }, body: { contractDigest: `sha256:${sourceDigest}`, validatorLockDigest: `sha256:${compiledBlobDigest}`, mandatoryClaims: [{ id: "tests", validatorId: "validator-1", freshnessMs: 60_000, required: false }], claimGroups: [{ id: "required", claimIds: ["tests"], minimumPasses: 1, requireAllDecisive: true }] } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.prepare", path: project, preconditions: { ...preconditions, expectedRevision: 0 }, body: { runId: "run-1", nodeInstanceId: "node-1", candidateGeneration: 0, decisionId: "decision-1", candidateDigest: `sha256:${sourceDigest}`, action: "publish", destination: releaseDestination, request: { contentType: "application/json" }, estimatedSpendMicros: 10, deadlineMs: 2_000_000_000_000 } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.get", path: { ...project, operationId: "operation-1" } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.approval.request", path: { ...project, operationId: "operation-1" }, preconditions: { ...preconditions, expectedRevision: 0 }, body: { expiresAtMs: 2_000_000_000_000 } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.approval.decide", path: { ...project, approvalId: "approval-1" }, preconditions: { ...preconditions, expectedRevision: 0 }, body: { contextDigest: sourceDigest, decision: "approved" } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.policy.put", path: { ...project, policyId: "policy-1" }, preconditions: { ...preconditions, expectedRevision: 0 }, body: releasePolicy },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.policy.delete", path: { ...project, policyId: "policy-1" }, preconditions },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.reconcile", path: { ...project, operationId: "operation-1" }, preconditions, body: { action: "keep_uncertain", reason: "Provider outcome remains unknown", providerEvidence: { checkedAt: 1 } } },
    { schemaVersion: FACTORY_API_REQUEST_SCHEMA_VERSION, kind: "release.notification.list", path: project, query: { limit: 50, cursor: "notification-1" } },
  ];
  return values.map((request) => "preconditions" in request
    ? { ...request, preconditions: { ...request.preconditions, payloadDigest: factoryApiPayloadDigest(request) } } as FactoryApiRequest
    : request);
}

function draftSummary(): FactoryDraftSummary {
  return { factoryId: referenceCodeV1.id, revision: 1, archived: false, availability: "available", sourceDigest, updatedAtMs: 1 };
}

function responses(): FactoryApiResponse[] {
  const version = { factoryId: referenceCodeV1.id, version: referenceCodeV1.version, draftRevision: 1, definitionDigest: compiled.digest, compiledBlobDigest, compiledBytes: new TextEncoder().encode(compiledJson).byteLength, publishedAtMs: 1 } as const;
  const run = { runId: "run-1", factoryId: referenceCodeV1.id, factoryVersion: referenceCodeV1.version, definitionDigest: compiled.digest, grantRevision: 1, revision: 1, status: "running", createdAtMs: 1, updatedAtMs: 1 } as const;
  const approval = { approvalId: "approval-1", runId: "run-1", commandId: "command-1", nodeInstanceId: "approval-node", revision: 1, contextDigest: sourceDigest, status: "pending", choices: ["approve", "deny"], context: { subject: "deploy" }, actorScope: "operator", expiresAtMs: 2 } as const;
  const grant = { principalKind: "user", principalId: "user-1", action: "factory.author", revision: 1, expiresAtMs: null, revoked: false, displayName: "Ada Author" } as const;
  const credential = { serviceAccountId: "service-1", credentialId: "credential-1", scopes: ["read", "chat"] as const, revision: 1, issuedAtMs: 1_999_999_940_000, expiresAtMs: 2_000_000_000_000, revoked: false } as const;
  const trust = { revision: 1, state: "active" as const, packageLock, packageTrustDigest: `sha256:${compiledBlobDigest}`, validatorTrustDigest: `sha256:${sourceDigest}`, approvedBy: "admin-1", approvalGrantRevision: 1 };
  const releaseOperation = { operationId: "operation-1", runId: "run-1", nodeInstanceId: "node-1", candidateGeneration: 0, decisionId: "decision-1", candidateDigest: `sha256:${sourceDigest}`, contractDigest: `sha256:${compiledBlobDigest}`, executionEpoch: 1, cancellationEpoch: 0, releaseEnableEpoch: 1, action: "publish", destination: releaseDestination, destinationDigest: `sha256:${sourceDigest}`, requestDigest: `sha256:${compiledBlobDigest}`, estimatedSpendMicros: 10, deadlineMs: 2_000_000_000_000, state: "pending" as const, dispatchGeneration: 0, dispatchStarted: false, archiveReady: true };
  return [
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "draft.summary", resource: draftSummary() },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "draft.details", resource: { ...draftSummary(), source: referenceCodeV1 } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "draft.page", page: { items: [draftSummary()], nextCursor: "next" } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "draft.export", format: "json", source: "{}" },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "draft.validation", valid: true, diagnostics: [] },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "version.summary", resource: version },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "version.page", page: { items: [version] } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "run.details", resource: { ...run, parameters: {} } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "run.page", page: { items: [run] } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "approval.resource", resource: approval },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "approval.page", page: { items: [approval] } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "grant.resource", resource: grant },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "grant.page", page: { items: [grant] } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "mutation.accepted", receipt: { resourceId: "run-1", commandId: "command-1", statusUrl: "/api/factories/runs/run-1" } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "error", error: { code: "revision_conflict", message: "Reload the draft.", retryable: false, currentRevision: 2 } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "version.details", resource: { ...version, source: referenceCodeV1 } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "service-credential.issued", resource: credential, token: "ezkfsvc_aaa.bbb.ccc" },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "service-credential.resource", resource: { ...credential, revision: 2, revoked: true } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "release.trust.resource", resource: trust },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "release.control.resource", resource: { enabled: true, enableEpoch: 1 } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "release.contract.resource", resource: { contractId: "contract-1", revision: 1, contractDigest: `sha256:${sourceDigest}`, validatorLockDigest: `sha256:${compiledBlobDigest}`, mandatoryClaims: [{ id: "tests", validatorId: "validator-1", freshnessMs: 60_000 }], claimGroups: [] } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "release.operation.resource", resource: releaseOperation },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "release.approval.resource", resource: { approvalId: "approval-1", operationId: "operation-1", contextDigest: sourceDigest, status: "pending", expiresAtMs: 2_000_000_000_000 } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "release.policy.resource", resource: { policyId: "policy-1", revision: 1, revoked: false, ...releasePolicy } },
    { schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "release.notification.page", page: { items: [
      { notificationId: "notification-1", operationId: "operation-1", createdAtMs: 1, kind: "approval_requested", approvalId: "approval-1", contextDigest: sourceDigest, expiresAtMs: 2_000_000_000_000 },
      { notificationId: "notification-2", operationId: "operation-2", createdAtMs: 2, kind: "release_uncertain", dispatchGeneration: 1, outcomeCode: "provider_response_unknown" },
      { notificationId: "notification-3", operationId: "operation-3", createdAtMs: 3, kind: "release_settled", dispatchGeneration: 1, outcomeCode: "confirmed" },
      { notificationId: "notification-4", createdAtMs: 4, kind: "command_approval_requested", approvalId: "approval-2", runId: "run-1", commandId: "command-2", nodeInstanceId: "review", contextDigest: sourceDigest, context: { subject: "deploy" }, choices: ["ship", "hold"], actorScope: "operator", expiresAtMs: 2_000_000_000_000 },
    ] } },
  ];
}

describe("factory product API schema", () => {
  test("accepts every canonical request and response variant", () => {
    expect(factoryApiRequestJsonSchema.$id).toBe("urn:ezcorp:factory:api-request:v1");
    expect(factoryApiResponseJsonSchema.$id).toBe("urn:ezcorp:factory:api-response:v1");
    for (const request of requests()) {
      expect(isFactoryApiRequest(request)).toBe(true);
      expect(validateFactoryApiRequest(request)).toEqual({ ok: true });
    }
    for (const response of responses()) {
      expect(isFactoryApiResponse(response)).toBe(true);
      expect(validateFactoryApiResponse(response)).toEqual({ ok: true });
    }
    const runList = requests()[13] as Extract<FactoryApiRequest, { kind: "run.list" }>;
    expect(validateFactoryApiRequest({ ...runList, query: { ...runList.query, status: "cancelling" } })).toEqual({ ok: true });
    const runDetails = responses()[7] as Extract<FactoryApiResponse, { kind: "run.details" }>;
    expect(validateFactoryApiResponse({ ...runDetails, resource: { ...runDetails.resource, status: "cancelling" } })).toEqual({ ok: true });
  });

  test("rejects unknown fields, caller tenancy, missing headers, and unsafe revisions", () => {
    const create = requests()[0] as Extract<FactoryApiRequest, { kind: "draft.create" }>;
    expect(code(validateFactoryApiRequest({ ...create, tenantId: "attacker" }))).toBe("API_REQUEST_SCHEMA");
    expect(code(validateFactoryApiRequest({ ...create, body: { ...create.body, projectId: "attacker" } }))).toBe("API_REQUEST_SCHEMA");
    expect(code(validateFactoryApiRequest({ ...create, path: { ...create.path, unknown: true } }))).toBe("API_REQUEST_SCHEMA");
    expect(code(validateFactoryApiRequest({ ...create, preconditions: { ...create.preconditions, unknown: true } }))).toBe("API_REQUEST_SCHEMA");
    const { preconditions: _missing, ...withoutHeaders } = create;
    expect(code(validateFactoryApiRequest(withoutHeaders))).toBe("API_REQUEST_SCHEMA");
    expect(code(validateFactoryApiRequest({ ...create, preconditions: { ...create.preconditions, expectedRevision: 1 } }))).toBe("API_EXPECTED_REVISION");
    expect(code(validateFactoryApiRequest({ ...requests()[2]!, preconditions: { idempotencyKey: "key", payloadDigest: sourceDigest, expectedRevision: 0 } }))).toBe("API_EXPECTED_REVISION");
    expect(code(validateFactoryApiRequest({ ...create, preconditions: { idempotencyKey: "bad\nkey", payloadDigest: sourceDigest, expectedRevision: 0 } }))).toBe("API_IDEMPOTENCY_KEY");
    expect(code(validateFactoryApiRequest({ ...create, preconditions: { ...create.preconditions, payloadDigest: "A".repeat(64) } }))).toBe("API_PAYLOAD_DIGEST");
    expect(code(validateFactoryApiRequest({ ...requests()[2]!, preconditions: { ...preconditions, expectedRevision: 1.5 } }))).toBe("API_EXPECTED_REVISION");
    expect(code(validateFactoryApiRequest({ ...requests()[3]!, path: { ...draft, factoryId: "bad\0id" } }))).toBe("API_PATH_IDENTITY");
    expect(code(validateFactoryApiRequest({ ...requests()[4]!, query: { limit: 201 } }))).toBe("API_REQUEST_SCHEMA");
    expect(code(validateFactoryApiRequest({ ...requests()[4]!, query: { cursor: "bad\ncursor" } }))).toBe("API_QUERY");
    expect(code(validateFactoryApiRequest({ ...requests()[21]!, body: { expiresAtMs: null } }))).toBe("API_GRANT_EXPIRY");
    const issue = requests()[23] as Extract<FactoryApiRequest, { kind: "service-credential.issue" }>;
    expect(code(validateFactoryApiRequest({ ...issue, body: { ...issue.body, scopes: ["chat", "read"] } }))).toBe("API_CREDENTIAL_SCOPES");
    expect(code(validateFactoryApiRequest({ ...issue, body: { ...issue.body, expiresAtMs: issue.body.expiresAtMs + 1 } }))).toBe("API_CREDENTIAL_EXPIRY");
    expect(code(validateFactoryApiRequest({ ...issue, preconditions: { ...issue.preconditions, expectedRevision: 1 } }))).toBe("API_EXPECTED_REVISION");
    const publishTrust = requests()[25] as Extract<FactoryApiRequest, { kind: "release.trust.publish" }>;
    expect(code(validateFactoryApiRequest({ ...publishTrust, body: { ...publishTrust.body, validatorTrustDigest: `sha256:${"A".repeat(64)}` } }))).toBe("API_RELEASE_TRUST_DIGEST");
    expect(code(validateFactoryApiRequest({ ...publishTrust, body: { ...publishTrust.body, packageLock: { ...publishTrust.body.packageLock, version: "latest" } } }))).toBe("RUNNER_PIN");
    expect(code(validateFactoryApiRequest({ ...publishTrust, body: { ...publishTrust.body, packageLock: { ...publishTrust.body.packageLock, configurationDigest: `sha256:${"A".repeat(64)}` } } }))).toBe("RUNNER_MODEL_PIN");
    expect(code(validateFactoryApiRequest({ ...publishTrust, body: { ...publishTrust.body, candidateDigest: `sha256:${sourceDigest}` } }))).toBe("API_REQUEST_SCHEMA");
    const control = requests()[27] as Extract<FactoryApiRequest, { kind: "release.control.set" }>;
    expect(code(validateFactoryApiRequest({ ...control, body: { ...control.body, currentEpoch: 0 } }))).toBe("API_REQUEST_SCHEMA");
  });

  test("hashes the canonical mutation payload and rejects changed key reuse", () => {
    const update = requests()[1] as Extract<FactoryApiRequest, { kind: "draft.update" }>;
    expect(validateFactoryApiPayloadDigest(update)).toEqual({ ok: true });
    const payload: unknown = factoryApiMutationPayload(update);
    expect(payload).toEqual({
      schemaVersion: update.schemaVersion,
      kind: update.kind,
      path: update.path,
      preconditions: { expectedRevision: 1 },
      body: update.body,
    });
    expect(validateFactoryApiRequest({ ...update, preconditions: { ...update.preconditions, idempotencyKey: "rotated-key" } })).toEqual({ ok: true });
    const changed = { ...update, body: { source: { ...referenceCodeV1, version: "changed" } } } as FactoryApiRequest;
    expect(code(validateFactoryApiRequest(changed))).toBe("API_PAYLOAD_DIGEST_MISMATCH");
    const read = requests()[3]!;
    expect(validateFactoryApiPayloadDigest(read)).toMatchObject({ ok: false, issues: [{ code: "API_NOT_MUTATION" }] });
    expect(() => factoryApiMutationPayload(read)).toThrow("not a mutation");
  });

  test("rejects mismatched definitions, malformed digests, and oversized transport", () => {
    const update = requests()[1] as Extract<FactoryApiRequest, { kind: "draft.update" }>;
    expect(code(validateFactoryApiRequest({ ...update, path: { ...update.path, factoryId: "different" } }))).toBe("API_FACTORY_ID");
    const start = requests()[11] as Extract<FactoryApiRequest, { kind: "run.start" }>;
    expect(code(validateFactoryApiRequest({ ...start, body: { ...start.body, definitionDigest: `sha256:${"A".repeat(64)}` } }))).toBe("API_DEFINITION_DIGEST");
    expect(code(validateFactoryApiRequest({ ...start, body: { ...start.body, parameters: { "bad\nname": { kind: "inline", value: 1 } } } }))).toBe("API_PARAMETER_NAME");
    expect(code(validateFactoryApiRequest({ ...start, body: { ...start.body, parameters: { value: { kind: "inline", value: "x".repeat(FACTORY_LIMITS.maxInlineValueBytes + 1) } } } }))).toBe("API_PARAMETER_BYTES");
    expect(code(validateFactoryApiRequest({ ...start, body: { ...start.body, parameters: { value: { kind: "artifact", artifact: { artifactId: "../file", digest: `sha256:${sourceDigest}`, encodedBytes: 1 } } } } }))).toBe("RUNNER_ARTIFACT_ID");
    const nearLimit = "x".repeat(FACTORY_LIMITS.maxInlineValueBytes - 2);
    expect(code(validateFactoryApiRequest({ ...start, body: { ...start.body, parameters: { value: { kind: "inline", value: nearLimit } } } }))).toBe("API_RUN_START_BYTES");
    const approval = requests()[19] as Extract<FactoryApiRequest, { kind: "approval.decide" }>;
    expect(code(validateFactoryApiRequest({ ...approval, body: { ...approval.body, contextDigest: "bad" } }))).toBe("API_REQUEST_SCHEMA");
    const imported = requests()[5] as Extract<FactoryApiRequest, { kind: "draft.import" }>;
    expect(code(validateFactoryApiRequest({ ...imported, body: { ...imported.body, source: "界".repeat(5_600_000) } }))).toBe("API_IMPORT_BYTES");
    const largeDefinition = structuredClone(referenceCodeV1);
    (largeDefinition.inputPorts.request as { description?: string }).description = "界".repeat(5_600_000);
    const create = requests()[0] as Extract<FactoryApiRequest, { kind: "draft.create" }>;
    expect(code(validateFactoryApiRequest({ ...create, body: { source: largeDefinition } }))).toBe("API_DEFINITION_BYTES");
    expect(code(validateFactoryApiRequest({ ...start, body: { ...start.body, factoryVersion: "bad\nversion" } }))).toBe("API_VERSION");
    const repair = requests()[15] as Extract<FactoryApiRequest, { kind: "run.control" }>;
    if (repair.body.action !== "repair") throw new Error("repair fixture");
    expect(code(validateFactoryApiRequest({ ...repair, body: { action: "repair", parameters: repair.body.parameters } }))).toBe("API_REQUEST_SCHEMA");
    expect(code(validateFactoryApiRequest({ ...repair, body: { action: "repair", nodeId: "bad\nnode", parameters: repair.body.parameters } }))).toBe("API_CONTROL_NODE");
    expect(code(validateFactoryApiRequest({ ...repair, body: { action: "repair", nodeId: repair.body.nodeId, parameters: { value: { kind: "inline", value: "x".repeat(FACTORY_LIMITS.maxInlineValueBytes + 1) } } } }))).toBe("API_PARAMETER_BYTES");
    expect(code(validateFactoryApiRequest({ ...repair, body: { action: "repair", nodeId: repair.body.nodeId, parameters: { value: { kind: "inline", value: "x".repeat(FACTORY_LIMITS.maxInlineValueBytes - 2) } } } }))).toBe("API_CONTROL_BYTES");
    const replan = requests()[16] as Extract<FactoryApiRequest, { kind: "run.control" }>;
    if (replan.body.action !== "replan") throw new Error("replan fixture");
    expect(code(validateFactoryApiRequest({ ...replan, body: { action: "replan", nodeId: replan.body.nodeId, parameters: {} } }))).toBe("API_REQUEST_SCHEMA");
    expect(code(validateFactoryApiRequest({ ...replan, body: { ...replan.body, replacement: { ...replan.body.replacement, version: "latest" } } }))).toBe("API_CONTROL_REPLACEMENT");
    expect(code(validateFactoryApiRequest({ ...replan, body: { ...replan.body, replacement: { ...replan.body.replacement, digest: `sha256:${"A".repeat(64)}` } } }))).toBe("API_CONTROL_REPLACEMENT");
    const contractRequest = requests()[28] as Extract<FactoryApiRequest, { kind: "release.contract.put" }>;
    expect(code(validateFactoryApiRequest({ ...contractRequest, body: { ...contractRequest.body, mandatoryClaims: [...contractRequest.body.mandatoryClaims, contractRequest.body.mandatoryClaims[0]!] } }))).toBe("API_RELEASE_CONTRACT_CLAIM");
    expect(code(validateFactoryApiRequest({ ...contractRequest, body: { ...contractRequest.body, mandatoryClaims: [{ ...contractRequest.body.mandatoryClaims[0]!, required: "yes" }] } } as unknown as FactoryApiRequest))).toBe("API_REQUEST_SCHEMA");
    const reconcile = requests()[35] as Extract<FactoryApiRequest, { kind: "release.reconcile" }>;
    expect(code(validateFactoryApiRequest({ ...reconcile, body: { ...reconcile.body, providerEvidence: {} } }))).toBe("API_RELEASE_RECONCILIATION");
    expect(code(validateFactoryApiRequest({ ...reconcile, body: { ...reconcile.body, receipt: { provider: "s3", account: "tenant-1", object: "release", requestDigest: `sha256:${sourceDigest}`, operationId: "operation-1", dispatchGeneration: 1, providerReceiptId: "receipt-1", version: "v1", effectDigest: `sha256:${sourceDigest}` } } }))).toBe("API_RELEASE_RECONCILIATION");
  });

  test("rejects inconsistent and oversized response resources", () => {
    const summary = responses()[0] as Extract<FactoryApiResponse, { kind: "draft.summary" }>;
    expect(code(validateFactoryApiResponse({ ...summary, unknown: true }))).toBe("API_RESPONSE_SCHEMA");
    expect(code(validateFactoryApiResponse({ ...summary, resource: { ...summary.resource, unknown: true } }))).toBe("API_RESPONSE_SCHEMA");
    expect(code(validateFactoryApiResponse({ ...summary, resource: { ...summary.resource, sourceDigest: "bad" } }))).toBe("API_RESPONSE_SCHEMA");
    expect(code(validateFactoryApiResponse({ ...summary, resource: { ...summary.resource, availability: "unavailable" } }))).toBe("API_DRAFT_RESOURCE");
    expect(code(validateFactoryApiResponse({ ...summary, resource: { ...summary.resource, availabilityReason: "unexpected" } }))).toBe("API_DRAFT_RESOURCE");
    expect(validateFactoryApiResponse({ ...summary, resource: { ...summary.resource, availability: "unavailable", availabilityReason: "GPU unavailable" } })).toEqual({ ok: true });
    const details = responses()[1] as Extract<FactoryApiResponse, { kind: "draft.details" }>;
    expect(code(validateFactoryApiResponse({ ...details, resource: { ...details.resource, factoryId: "different" } }))).toBe("API_FACTORY_ID");
    const approval = responses()[9] as Extract<FactoryApiResponse, { kind: "approval.resource" }>;
    expect(code(validateFactoryApiResponse({ ...approval, resource: { ...approval.resource, status: "answered" } }))).toBe("API_APPROVAL_RESOURCE");
    const approvalPage = responses()[10] as Extract<FactoryApiResponse, { kind: "approval.page" }>;
    expect(code(validateFactoryApiResponse({ ...approvalPage, page: { items: [{ ...approvalPage.page.items[0]!, contextDigest: "b".repeat(64), status: "answered" }] } }))).toBe("API_APPROVAL_RESOURCE");
    const version = responses()[5] as Extract<FactoryApiResponse, { kind: "version.summary" }>;
    expect(code(validateFactoryApiResponse({ ...version, resource: { ...version.resource, compiledBlobDigest: "b".repeat(63) } }))).toBe("API_RESPONSE_SCHEMA");
    const versionPage = responses()[6] as Extract<FactoryApiResponse, { kind: "version.page" }>;
    expect(code(validateFactoryApiResponse({ ...versionPage, page: { items: [{ ...versionPage.page.items[0]!, compiledBlobDigest: "A".repeat(64) }] } }))).toBe("API_VERSION_DIGEST");
    const versionDetails = responses()[15] as Extract<FactoryApiResponse, { kind: "version.details" }>;
    expect(code(validateFactoryApiResponse({ ...versionDetails, resource: { ...versionDetails.resource, source: { ...versionDetails.resource.source, version: "different" } } }))).toBe("API_VERSION_IDENTITY");
    const runDetails = responses()[7] as Extract<FactoryApiResponse, { kind: "run.details" }>;
    expect(code(validateFactoryApiResponse({ ...runDetails, resource: { ...runDetails.resource, definitionDigest: `sha256:${"A".repeat(64)}` } }))).toBe("API_RUN_DIGEST");
    expect(code(validateFactoryApiResponse({ ...runDetails, resource: { ...runDetails.resource, parameters: { value: { kind: "inline", value: "x".repeat(FACTORY_LIMITS.maxInlineValueBytes + 1) } } } }))).toBe("API_PARAMETER_BYTES");
    expect(code(validateFactoryApiResponse({ ...runDetails, resource: { ...runDetails.resource, output: { kind: "artifact", artifact: { artifactId: "../output", digest: `sha256:${sourceDigest}`, encodedBytes: 1 } } } }))).toBe("RUNNER_ARTIFACT_ID");
    const runPage = responses()[8] as Extract<FactoryApiResponse, { kind: "run.page" }>;
    expect(code(validateFactoryApiResponse({ ...runPage, page: { items: [{ ...runPage.page.items[0]!, definitionDigest: `sha256:${"A".repeat(64)}` }] } }))).toBe("API_RUN_DIGEST");
    const grant = responses()[11] as Extract<FactoryApiResponse, { kind: "grant.resource" }>;
    expect(code(validateFactoryApiResponse({ ...grant, resource: { ...grant.resource, principalKind: "service", expiresAtMs: null } }))).toBe("API_GRANT_EXPIRY");
    const grantPage = responses()[12] as Extract<FactoryApiResponse, { kind: "grant.page" }>;
    expect(code(validateFactoryApiResponse({ ...grantPage, page: { items: [{ ...grantPage.page.items[0]!, principalKind: "service", expiresAtMs: null }] } }))).toBe("API_GRANT_EXPIRY");
    // W04b: the grantee's display name is required, bounded, and never empty.
    const { displayName: _name, ...unnamed } = grant.resource;
    for (const resource of [unnamed, { ...grant.resource, displayName: "" }, { ...grant.resource, displayName: "x".repeat(257) }]) {
      expect(validateFactoryApiResponse({ ...grant, resource } as never).ok).toBe(false);
    }
    expect(validateFactoryApiResponse({ ...grant, resource: { ...grant.resource, displayName: "x".repeat(256) } }).ok).toBe(true);
    const receipt = responses()[13] as Extract<FactoryApiResponse, { kind: "mutation.accepted" }>;
    expect(code(validateFactoryApiResponse({ ...receipt, receipt: { ...receipt.receipt, statusUrl: "/wrong/run-1" } }))).toBe("API_RECEIPT");
    const error = responses()[14] as Extract<FactoryApiResponse, { kind: "error" }>;
    expect(code(validateFactoryApiResponse({ ...error, error: { ...error.error, code: "bad\ncode" } }))).toBe("API_ERROR");
    const draftPage = responses()[2] as Extract<FactoryApiResponse, { kind: "draft.page" }>;
    expect(code(validateFactoryApiResponse({ ...draftPage, page: { items: Array(201).fill(draftSummary()) } }))).toBe("API_RESPONSE_SCHEMA");
    expect(code(validateFactoryApiResponse({ schemaVersion: FACTORY_API_RESPONSE_SCHEMA_VERSION, kind: "draft.export", format: "yaml", source: "界".repeat(5_600_000) }))).toBe("API_RESPONSE_BYTES");
    const credential = responses()[16] as Extract<FactoryApiResponse, { kind: "service-credential.issued" }>;
    for (const token of ["wrong", "ezkfsvc_a.b", "ezkfsvc_a.b.c.d", "ezkfsvc_.b.c", "ezkfsvc_a..c", "ezkfsvc_a.b.", "ezkfsvc_a.b.c=", "ezkfsvc_a.b.c+", "ezkfsvc_a.b.c/", "ezkfsvc_a.b.é", "ezkfsvc_a.b.c\n"]) {
      expect(code(validateFactoryApiResponse({ ...credential, token }))).toBe("API_CREDENTIAL_TOKEN");
    }
    expect(validateFactoryApiResponse({ ...credential, token: "ezkfsvc_Az09_-.Az09_-.Az09_-" }).ok).toBe(true);
    expect(code(validateFactoryApiResponse({ ...credential, resource: { ...credential.resource, scopes: ["chat", "read"] } }))).toBe("API_CREDENTIAL_RESOURCE");
    expect(code(validateFactoryApiResponse({ ...credential, resource: { ...credential.resource, expiresAtMs: credential.resource.issuedAtMs } }))).toBe("API_CREDENTIAL_RESOURCE");
    const trust = responses()[18] as Extract<FactoryApiResponse, { kind: "release.trust.resource" }>;
    expect(code(validateFactoryApiResponse({ ...trust, resource: { ...trust.resource, packageTrustDigest: `sha256:${"A".repeat(64)}` } }))).toBe("API_RELEASE_TRUST_DIGEST");
    expect(code(validateFactoryApiResponse({ ...trust, resource: { ...trust.resource, packageLock: { ...trust.resource.packageLock, version: "latest" } } }))).toBe("RUNNER_PIN");
    const releaseOperation = responses()[21] as Extract<FactoryApiResponse, { kind: "release.operation.resource" }>;
    expect(validateFactoryApiResponse({ ...releaseOperation, resource: { ...releaseOperation.resource, receipt: { provider: "s3", account: "tenant-1", object: "releases/output.json", requestDigest: `sha256:${compiledBlobDigest}`, operationId: "operation-1", dispatchGeneration: 1, providerReceiptId: "receipt-1", version: "v1", effectDigest: `sha256:${sourceDigest}` } } })).toEqual({ ok: true });
    expect(code(validateFactoryApiResponse({ ...releaseOperation, resource: { ...releaseOperation.resource, requestDigest: `sha256:${"A".repeat(64)}` } }))).toBe("API_RELEASE_OPERATION");
    expect(code(validateFactoryApiResponse({ ...releaseOperation, resource: { ...releaseOperation.resource, senderToken: "leaked" } }))).toBe("API_RESPONSE_SCHEMA");
    const notifications = responses()[24] as Extract<FactoryApiResponse, { kind: "release.notification.page" }>;
    expect(code(validateFactoryApiResponse({ ...notifications, page: { items: [{ ...notifications.page.items[0]!, contextDigest: "A".repeat(64) }] } }))).toBe("API_RELEASE_NOTIFICATION");
    expect(code(validateFactoryApiResponse({ ...notifications, page: { items: [{ ...notifications.page.items[1]!, dispatchGeneration: 0 }] } }))).toBe("API_RESPONSE_SCHEMA");
  });
});
