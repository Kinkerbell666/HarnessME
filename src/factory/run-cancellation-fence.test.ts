import { afterAll, beforeAll, expect, test } from "bun:test";
import { canonicalJson } from "@ezcorp/extension-contract";
import { referenceCodeV1 } from "@ezcorp/factory-sdk";
import { sql } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupTestDb } from "../__tests__/helpers/test-pglite";
import { digestObject, FileBlobStore } from "../extensions/v4/blobs";
import { FactoryArtifacts } from "./artifacts";
import { FactoryDefinitionArtifacts } from "./definition-artifacts";
import { FactoryDefinitions } from "./definitions";
import { isFactoryAttemptNotLive, type FactoryAttemptAuthority } from "./executions";
import { FactoryGrants } from "./grants";
import { advanceFactoryRunCancellationEpochInTransaction, FACTORY_STOPPED_CANCELLATION_EPOCH } from "./run-cancellation-epoch";
import { FactoryRunLifecycle } from "./run-lifecycle";

// A command attempt carries the run fence it was admitted under. Once a stop
// raises the run's cancellation epoch, an attempt queued before it must be
// refused when it tries to launch, even while the run row is still `running`.

const tenantId = "fence-tenant";
const projectId = "fence-project";
const runId = "fence-run";
const ownerId = "fence-owner";
const definitionDigest = `sha256:${"c".repeat(64)}`;
let fixture: Awaited<ReturnType<typeof setupTestDb>>;
let lifecycle: FactoryRunLifecycle;
let directory: string;

beforeAll(async () => {
  fixture = await setupTestDb();
  await fixture.db.execute(sql`INSERT INTO factory_installation(singleton, tenant_id, execution_epoch) VALUES (1, ${tenantId}, 1)`);
  await fixture.db.execute(sql`INSERT INTO users(id, email, password_hash, name, role) VALUES (${ownerId}, 'fence@example.test', 'not-a-login', 'Fence owner', 'member')`);
  await fixture.db.execute(sql`INSERT INTO projects(id, name, path) VALUES (${projectId}, ${projectId}, ${`/${projectId}`})`);
  await fixture.db.execute(sql`INSERT INTO factory_projects(tenant_id, project_id) VALUES (${tenantId}, ${projectId})`);
  await fixture.db.execute(sql`INSERT INTO project_members(id, project_id, user_id, role) VALUES ('fence-member', ${projectId}, ${ownerId}, 'owner')`);
  await fixture.db.execute(sql`INSERT INTO factory_grants(tenant_id, project_id, principal_kind, principal_id, action, issuer_id, revision) VALUES (${tenantId}, ${projectId}, 'user', ${ownerId}, 'factory.run', ${ownerId}, 1)`);
  const request = { projectId, runId, definitionDigest, interpreterBuild: "fence-build", executionEpoch: 1, input: {}, principalId: ownerId, principalKind: "user" };
  await fixture.db.execute(sql`INSERT INTO factory_runs(tenant_id, project_id, run_id, definition_digest, interpreter_build, execution_epoch, request_digest, request_payload) VALUES (${tenantId}, ${projectId}, ${runId}, ${definitionDigest}, 'fence-build', 1, ${digestObject(request)}, ${canonicalJson(request)})`);
  await fixture.db.execute(sql`INSERT INTO factory_drafts(tenant_id, project_id, factory_id, revision, source_digest, source_json, required_resources_json, requirements_complete, validation_diagnostic_count) VALUES (${tenantId}, ${projectId}, 'fence-factory', 1, ${definitionDigest}, '{}', '[]', TRUE, 0)`);
  await fixture.db.execute(sql`INSERT INTO factory_versions(tenant_id, project_id, factory_id, version, draft_revision, definition_digest, compiled_blob_digest, compiled_bytes, lock_json) VALUES (${tenantId}, ${projectId}, 'fence-factory', 'v1', 1, ${definitionDigest}, ${"d".repeat(64)}, 1, '{}')`);
  await fixture.db.execute(sql`INSERT INTO factory_run_lifecycle(tenant_id, project_id, run_id, factory_id, factory_version, definition_digest, grant_revision, status, deadline_ms, parameters_json, parameters_digest) VALUES (${tenantId}, ${projectId}, ${runId}, 'fence-factory', 'v1', ${definitionDigest}, 1, 'running', ${Date.now() + 60_000}, '{}', ${digestObject({})})`);

  directory = await mkdtemp(join(tmpdir(), "factory-cancel-fence-"));
  const blobs = new FileBlobStore(directory);
  const grants = new FactoryGrants(fixture.db, tenantId);
  const artifacts = new FactoryArtifacts(fixture.db, blobs, tenantId);
  lifecycle = new FactoryRunLifecycle(fixture.db, tenantId, {
    definitions: new FactoryDefinitions(fixture.db, tenantId, grants, blobs),
    grants,
    interpreterBuild: "fence-build",
    interpreterCompatibility: referenceCodeV1.interpreterCompatibility,
    limits: { maxCostMicros: "100", maxTokens: 100, maxComputeMs: 100 },
    stageDefinitionInTransaction: (transaction, compiled, identity) => new FactoryDefinitionArtifacts(artifacts).stageDefinitionInTransaction(transaction, compiled, identity),
    resolveParameters: async () => ({ kind: "factory.run-resolved-parameters", input: {} }),
  });
});
afterAll(async () => { await fixture?.pglite.close(); await rm(directory, { recursive: true, force: true }); });

function authority(cancellationEpoch: number): FactoryAttemptAuthority {
  return {
    attemptId: "fence-attempt", tenantId, projectId, runId, nodeInstanceId: "fence-node", candidateGeneration: 1, attemptNumber: 1,
    grantRevision: 1, reservationGeneration: 1, executionEpoch: 1, cancellationEpoch,
    requestDigest: `sha256:${"e".repeat(64)}`, deadlineAt: new Date(Date.now() + 30_000),
  };
}

function authorize(candidate: FactoryAttemptAuthority): Promise<void> {
  return fixture.db.transaction(transaction => lifecycle.authorizeAttemptInTransaction(transaction, candidate));
}

test("an attempt admitted before a stop raised the cancellation epoch is refused factory_run_fence_changed and is not live", async () => {
  const queued = authority(0);
  await expect(authorize(queued)).resolves.toBeUndefined();

  await fixture.db.transaction(transaction => advanceFactoryRunCancellationEpochInTransaction(transaction, { tenantId, projectId, runId }, FACTORY_STOPPED_CANCELLATION_EPOCH));
  const status = (await fixture.db.execute(sql`SELECT status FROM factory_run_lifecycle WHERE tenant_id=${tenantId} AND run_id=${runId}`)).rows[0] as { status: string };
  expect(status.status).toBe("running");

  const refusal = await authorize(queued).then(() => null, (error: unknown) => error);
  expect(refusal).toMatchObject({ code: "factory_run_fence_changed" });
  expect(isFactoryAttemptNotLive(refusal)).toBe(true);
  // Only the epoch moved: an attempt holding the raised epoch still passes.
  await expect(authorize(authority(FACTORY_STOPPED_CANCELLATION_EPOCH))).resolves.toBeUndefined();
});
