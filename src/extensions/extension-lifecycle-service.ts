import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { canonicalJson, compileValueSchema, validateManifest, type CandidateVerificationReport, type InstallationRecord, type ReleaseRecord, type ReverseRpc, type Runner, type RunnerExecution, type WorkspaceFiles } from "@ezcorp/extension-contract";
import { buildLimits, DEFAULT_IMAGE, executionLimits, resolveDependencies, trustedLocalImage } from "@ezcorp/extension-runner";
import { createLazyExtensionRunner } from "./runner-connection";
import { getExtensionRunnerMode, ISOLATED_PROFILE, TRUSTED_LOCAL_PROFILE, trustedLocalBunDigest } from "./runner-mode";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseLifecycleRepository, releaseRows } from "../db/queries/extension-releases";
import { extensionLogger } from "../logger";
import { ExtensionControl } from "./extension-control";
import { ExtensionLifecycle, FileBlobStore, LifecycleError, type InstallationState, type LifecycleActor, type LifecycleDependencies, type LifecycleRelease } from "./v4";
import { ExtensionDataMigrations, type StorageMigrationInput } from "./v4/data-migrations";
import { ExtensionDeliveryQueue } from "./v4/deliveries";
import { createCandidateVerificationBroker, type CandidateFixtures } from "./candidate-verification-broker";
import { auditReleaseBlobStorage, boundedReleaseBlobAuditSample, getFiles, type ReleaseBlobDigests } from "./v4/blobs";
import { hasExactReleaseGrants } from "./bundled-drift-reapprove";
import { createLifecycleRecoveryScheduler } from "./lifecycle-recovery-scheduler";

const log = extensionLogger("author", "lifecycle");

interface PolicyUser { id: string; role: "admin" | "member"; status: "active" | "inactive" }
interface PolicyProjection { id: string; name: string; creatorUserId: string | null; modifiable: boolean }

export interface LifecyclePolicyLookup {
  user(id: string): Promise<PolicyUser | undefined>;
  installation(id: string): Promise<InstallationRecord | null>;
  projectionById(id: string): Promise<PolicyProjection | null>;
  projectionByName(name: string): Promise<PolicyProjection | null>;
  projectMember(userId: string, projectId: string): Promise<boolean>;
}

export function createLifecycleAuthorization(lookup: LifecyclePolicyLookup): Pick<LifecycleDependencies, "authorize" | "authorizeAccess"> {
  async function activeUser(principalId: string) {
    const user = await lookup.user(principalId);
    if (user?.status !== "active") throw new LifecycleError("unauthorized", "An active user is required.");
    return user;
  }
  async function scopeAccess(actor: LifecycleActor, user: PolicyUser): Promise<void> {
    if (actor.scope === "global") return;
    if (!actor.scope.startsWith("project:") || !actor.scope.slice(8)) throw new LifecycleError("invalid_scope", "Use a host-resolved global or project scope.");
    if (user.role !== "admin" && !(await lookup.projectMember(user.id, actor.scope.slice(8)))) throw new LifecycleError("forbidden", "Project membership is required.");
  }
  return {
    async authorizeAccess(actor, installation) {
      const user = await activeUser(actor.principalId);
      if (user.role !== "admin" && (installation.ownerId !== user.id || installation.scope !== actor.scope)) throw new LifecycleError("not_found", "Installation not found.");
      await scopeAccess(actor, user);
    },
    async authorize(actor, action, release, grants) {
      const user = await activeUser(actor.principalId);
      await scopeAccess(actor, user);
      if (action === "approve" && (actor.kind !== "human" || user.role !== "admin")) throw new LifecycleError("human_admin_required", "An administrator must approve the release in a human session.");
      if (!release) return;
      validateManifest(release.manifest);
      const installation = await lookup.installation(release.installationId);
      if (!installation) throw new LifecycleError("not_found", "Installation not found.");
      const owner = await activeUser(installation.ownerId);
      await scopeAccess({ principalId: owner.id, scope: installation.scope, kind: "service" }, owner);
      if (user.id !== owner.id && user.role !== "admin") throw new LifecycleError("not_found", "Installation not found.");
      if (grants && !hasExactReleaseGrants(release.manifest, grants)) throw new LifecycleError("grant_mismatch", "Approval must match the exact declared permissions.");
      const existing = await lookup.projectionById(installation.id);
      if (existing && existing.name !== release.manifest.name) throw new LifecycleError("extension_name_changed", "A release cannot rename its installation or data namespace.");
      if (existing?.creatorUserId && existing.creatorUserId !== owner.id) throw new LifecycleError("ownership_mismatch", "Installed source ownership does not match its release installation.");
      const named = await lookup.projectionByName(release.manifest.name);
      if (named && named.id !== installation.id) throw new LifecycleError("extension_name_in_use", "Another installation owns this extension name.");
    },
  };
}

export async function verifyExtensionCandidate(runner: Runner, release: ReleaseRecord, reverseRpc?: ReverseRpc, fixtures?: CandidateFixtures): Promise<CandidateVerificationReport> {
  const workerId = randomUUID();
  const scopeId = `verification:${randomUUID()}`;
  const context = { invocationId: randomUUID(), workerId, releaseId: release.id, principalId: "extension-verification", scopeId, token: randomUUID(), deadline: Date.now() + executionLimits.timeoutMs, metadata: { ezConversationId: scopeId } };
  const broker = await createCandidateVerificationBroker(release, context, fixtures);
  let worker: RunnerExecution | undefined;
  try {
    worker = await runner.start({ workerId, artifactDigest: release.artifactDigest, context, limits: executionLimits }, reverseRpc ?? broker.reverseRpc);
    const discovered = validateManifest(await worker.request("extension/discover", {}));
    if (canonicalJson(discovered) !== canonicalJson(release.manifest)) throw new LifecycleError("runtime_catalog_mismatch", "Runtime metadata changed after verification.");
    if (discovered.smokeTest) {
      const smoke = discovered.smokeTest;
      const tool = discovered.tools?.find((candidate) => candidate.name === smoke.tool);
      if (!tool) throw new LifecycleError("missing_test_tool", "Smoke test references an undeclared tool.");
      compileValueSchema(tool.inputSchema)(smoke.input);
      broker.begin(smoke.tool);
      const result = await worker.request("extension/invoke", { name: smoke.tool, input: smoke.input, context });
      compileValueSchema(tool.outputSchema)(result);
      const expected = smoke.expect;
      const output = result && typeof result === "object" ? result as Record<string, unknown> : undefined;
      const text = Array.isArray(output?.content) ? output.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n") : typeof output?.text === "string" ? output.text : typeof result === "string" ? result : canonicalJson(result);
      if (expected?.textIncludes !== undefined && !text.includes(expected.textIncludes)) throw new LifecycleError("smoke_assertion_failed", "Smoke test output did not match the expected text.");
      if (expected?.isError !== undefined && (output?.isError === true) !== expected.isError) throw new LifecycleError("smoke_assertion_failed", "Smoke test error status did not match the expected status.");
    }
    const report: CandidateVerificationReport = { catalog: "verified", smoke: discovered.smokeTest ? "passed" : "not_declared", capabilities: broker.coverage() };
    if (report.capabilities.some((entry) => entry.state === "denied")) throw Object.assign(new LifecycleError("candidate_capability_blocked", "Candidate attempted a denied capability; supply an isolated fixture or fix its declaration."), { verification: report });
    return report;
  } catch (error) {
    if (error && typeof error === "object") Object.assign(error, { capabilities: broker.coverage() });
    throw error;
  } finally { try { await worker?.close(); } finally { await broker.close(); } }
}

export async function runStorageMigration(runner: Runner, input: StorageMigrationInput): Promise<unknown> {
  const method = input.release.manifest.methods?.find((candidate) => candidate.name === input.method);
  if (!method) throw new LifecycleError("migration_method_missing", "Storage migration method is not declared.");
  const workerId = randomUUID();
  const context = { invocationId: randomUUID(), workerId, releaseId: input.release.id, principalId: input.principalId, scopeId: `data-migration:${input.scope}`, token: randomUUID(), deadline: Date.now() + executionLimits.timeoutMs };
  const worker = await runner.start({ workerId, artifactDigest: input.release.artifactDigest, context, limits: executionLimits }, async () => { throw new LifecycleError("migration_effect_denied", "Storage migrations cannot access host capabilities."); });
  try {
    const payload = { fromVersion: input.fromVersion, toVersion: input.toVersion, values: input.values };
    compileValueSchema(method.inputSchema)(payload);
    const result = await worker.request("extension/dispatch", { method: input.method, input: payload, context });
    compileValueSchema(method.outputSchema)(result);
    return result;
  } finally { await worker.close(); }
}

export async function resolveExtensionReleaseSnapshot(repository: DatabaseLifecycleRepository, migrations: ExtensionDataMigrations, id: string, database?: import("../db/migrations/types").MigrationDb) {
  if (database) await database.execute(sql`LOCK TABLE extension_storage IN ROW EXCLUSIVE MODE`);
  const state = await repository.read(id, database);
  if (!state?.installation.activeReleaseId || !state.installation.enabled || state.installation.uninstalled || await migrations.isPaused(id, database)) return null;
  const release = state.releases[state.installation.activeReleaseId];
  return release ? { release, installation: state.installation, limits: executionLimits } : null;
}

interface LifecycleServices { lifecycle: ExtensionLifecycle; control: ExtensionControl; runner: Runner; repository: DatabaseLifecycleRepository; deliveries: ExtensionDeliveryQueue; migrations: ExtensionDataMigrations; blobs: FileBlobStore }
export interface RecoveryServices { lifecycle: Pick<ExtensionLifecycle, "recover" | "reconcile">; repository: Pick<DatabaseLifecycleRepository, "read">; migrations: Pick<ExtensionDataMigrations, "recover"> }
let services: Promise<LifecycleServices> | undefined;
const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
let recoveryCapacityAvailable = false;

/** Historical release blobs are diagnostic only: cap startup filesystem work. */
export const RELEASE_BLOB_AUDIT_RELEASE_LIMIT = 128;

async function initialize(): Promise<LifecycleServices> {
  // In trusted-local mode the in-process runner needs its approval store and
  // audit sink before its first use. Both live in `db/`, which this function
  // loads lazily (like every other `db/` module below) so that
  // `runner-connection.ts` keeps no static path into `db/connection`.
  const trustedLocal = getExtensionRunnerMode() === "trusted-local";
  if (trustedLocal) {
    const { createTrustedLocalHooks } = await import("./trusted-local-hooks");
    const { configureTrustedLocalRunner } = await import("./trusted-local-runner");
    configureTrustedLocalRunner(createTrustedLocalHooks());
  }
  const runner = createLazyExtensionRunner();
  const { getDb } = await import("../db/connection");
  const { getUserById } = await import("../db/queries/users");
  const { getExtension, getExtensionByName } = await import("../db/queries/extensions");
  const { getProjectMembership } = await import("../db/queries/project-members");
  const repository = new DatabaseLifecycleRepository(getDb());
  const migrations = new ExtensionDataMigrations(getDb(), (input) => runStorageMigration(runner, input));
  const deliveries = new ExtensionDeliveryQueue(getDb());
  const { configureReleaseRuntime } = await import("./release-process");
  configureReleaseRuntime({
    runner: async () => runner,
    dispatchNotification: async (extensionId, method, params) => {
      const { enqueueExtensionNotification } = await import("./delivery-runtime");
      await enqueueExtensionNotification(extensionId, method, params ?? {});
    },
    resolve: (id, database) => resolveExtensionReleaseSnapshot(repository, migrations, id, database),
  });
  const { getProjectRoot } = await import("./project-root");
  const blobs = new FileBlobStore(process.env.EZCORP_EXTENSION_BLOB_ROOT ?? join(getProjectRoot(), ".ezcorp", "extension-releases"));
  const authorization = createLifecycleAuthorization({ user: getUserById, installation: async (id) => (await repository.read(id))?.installation ?? null, projectionById: getExtension, projectionByName: getExtensionByName, projectMember: async (userId, projectId) => Boolean(await getProjectMembership(userId, projectId)) });
  // Profile and image are stamped on every release and approval and
  // rechecked at activation (`checkApproval` → `stale_approval`,
  // `verification_failed`). Deriving both from the mode means switching a
  // host between isolated and trusted-local invalidates every existing
  // approval and forces re-approval under the new terms — the behaviour a
  // downgrade needs, and it costs nothing. The image is the runner's own
  // `trustedLocalImage()` so the lifecycle's expectation cannot drift from
  // what the runner stamps.
  const { recordTrustedLocalApproval, recordTrustedLocalVerificationApproval, revokeTrustedLocalApprovals } = await import("../db/queries/extension-trusted-local-approvals");
  const lifecycle = new ExtensionLifecycle({
    repository,
    blobs,
    runner, resolveDependencies,
    runnerProfile: trustedLocal ? TRUSTED_LOCAL_PROFILE : ISOLATED_PROFILE,
    runnerImageDigest: trustedLocal ? trustedLocalImage(await trustedLocalBunDigest()) : (process.env.EZCORP_EXTENSION_RUNNER_IMAGE ?? DEFAULT_IMAGE),
    validatorVersion: "runner-v4.1", buildLimits,
    ...(trustedLocal ? { trustedLocal: {
      recordApproval: async (input: { phase: "build" | "execute"; digest: string; installationId: string; approvedBy: string }) => { await recordTrustedLocalApproval(input); },
      recordVerificationApproval: async (input: { installationId: string; sourceDigest: string; artifactDigest: string }) => { await recordTrustedLocalVerificationApproval(input); },
      revokeApprovals: async (installationId: string, digest?: string) => { await revokeTrustedLocalApprovals(installationId, digest); },
    } } : {}),
    ...authorization,
    verifyCandidate: (release) => verifyExtensionCandidate(runner, release),
    prepareActivation: (installation, previous, release, operation) => migrations.prepare(installation, previous, release, operation),
    abortActivation: (installationId, operation) => migrations.abort(installationId, operation.id, operation.lease?.fence),
    publish: async (installation, release) => { await migrations.finalize(installation.id); await publishExtensionGeneration(installation, release, release ? await getFiles(blobs, release.artifactDigest, "artifact") : undefined); },
    onBuildSettled: deferredByRunner => { recoveryCapacityAvailable ||= !deferredByRunner; lifecycleRecovery.request({ followUp: !deferredByRunner }); },
  });
  return { lifecycle, control: new ExtensionControl(lifecycle), runner, repository, deliveries, migrations, blobs };
}

/**
 * Forget the initialised services and everything `initialize()` leaves behind.
 * The application builds them once per process and keeps them, so nothing in
 * production calls this. A suite that initialises them against its own
 * database calls it after closing that database: the repository, delivery
 * queue and migrations here all hold that connection, and the next suite in a
 * pooled `bun test` process would otherwise inherit them and read "PGlite is
 * closed" — or, worse, never re-run the initialisation whose effects it is
 * asserting. Pending recovery timers go with them, for the same reason.
 */
export function resetExtensionServices(): void {
  services = undefined;
  recoveryCapacityAvailable = false;
  for (const timer of recoveryTimers.values()) clearTimeout(timer);
  recoveryTimers.clear();
}

function getServices(): Promise<LifecycleServices> {
  services ??= initialize().catch((error) => { services = undefined; throw error; });
  return services;
}

export async function getExtensionLifecycle(): Promise<ExtensionLifecycle> { return (await getServices()).lifecycle; }
export async function getExtensionControl(): Promise<ExtensionControl> { return (await getServices()).control; }
export async function getExtensionRunner(): Promise<Runner> { return (await getServices()).runner; }
export async function getExtensionDeliveryQueue(): Promise<ExtensionDeliveryQueue> { return (await getServices()).deliveries; }
export async function getExtensionInstallationState(installationId: string) { return (await getServices()).repository.read(installationId); }

export async function getExtensionReleaseArtifacts(installationId: string, releaseId: string): Promise<WorkspaceFiles> {
  const { repository, blobs } = await getServices();
  const state = await repository.read(installationId);
  if (!state?.installation.enabled || state.installation.uninstalled || state.installation.activeReleaseId !== releaseId || !Object.hasOwn(state.releases, releaseId)) throw new LifecycleError("release_not_active", "The requested release is not the enabled installation release.");
  const release = state.releases[releaseId]!;
  if (release.id !== releaseId || release.installationId !== installationId) throw new LifecycleError("release_not_active", "The requested release does not belong to this installation.");
  return getFiles(blobs, release.artifactDigest, "artifact");
}

export async function publishExtensionGeneration(installation: InstallationRecord, release: LifecycleRelease | null, sourceFiles?: WorkspaceFiles): Promise<void> {
  const { prepareEzFactoryAgents, publishEzFactoryAgents } = await import("./ez-factory-release-agents");
  let factoryAgents: import("../types").AgentDefinition[] | undefined;
  let triggersRevokedFor: string | undefined;
  const { getDb } = await import("../db/connection");
  const { extensions, extensionWebhooks, extensionSchedules } = await import("../db/schema");
  const { serializeJsonbFields } = await import("../db/queries/extensions");
  const { buildFullGrantFromManifest } = await import("./install-grant");
  const { ExtensionRegistry } = await import("./registry");
  const { runEntitySeed } = await import("./entities/seed");
  const { reconcileWebhooks } = await import("./webhook-reconcile");
  const { reconcileSchedules } = await import("./schedule-reconcile");
  const { ensureWebhookSecret } = await import("./webhook-secret");
  await getDb().transaction(async (transaction: import("../db/connection").DbTransaction) => {
    if (release?.manifest.entities?.length) await transaction.execute(sql`LOCK TABLE extension_storage IN SHARE ROW EXCLUSIVE MODE`);
    // The joined installed_permissions is the last published grant (a disable
    // keeps it), so the publish below can tell when triggers were dropped.
    const result = await transaction.execute(sql`SELECT i.payload, e.installed_permissions FROM extension_release_installations i LEFT JOIN extensions e ON e.id = i.id WHERE i.id = ${installation.id} FOR UPDATE OF i`);
    const rows = releaseRows<{ payload: string; installed_permissions?: unknown }>(result);
    const current: InstallationRecord | undefined = rows[0] ? JSON.parse(rows[0].payload) : undefined;
    const previousRaw = rows[0]?.installed_permissions;
    const previousGrant = (typeof previousRaw === "string" ? JSON.parse(previousRaw) : previousRaw) as { triggers?: unknown } | null | undefined;
    if (!current || current.generation !== installation.generation || current.activeReleaseId !== installation.activeReleaseId || current.enabled !== installation.enabled) throw new LifecycleError("generation_superseded", "A newer activation replaced this catalog update.");
    if (release && installation.enabled && (release.id !== current.activeReleaseId || release.installationId !== current.id || !hasExactReleaseGrants(release.manifest, current.grants))) throw new LifecycleError("grant_mismatch", "Publication requires the exact approved release permission set.");
    if (!release || !installation.enabled) {
      await transaction.update(extensions).set(serializeJsonbFields({ enabled: false, disabledByUser: true, grantedPermissions: {}, updatedAt: new Date() })).where(eq(extensions.id, installation.id));
      const [projection] = await transaction.select({ name: extensions.name }).from(extensions).where(eq(extensions.id, installation.id));
      if (projection) {
        if (projection.name === "ez-factory") factoryAgents = [];
        // Manifest rows only: the reconcilers re-enable those, but never
        // touch user-created (dynamic) rows, so disabling them here would be
        // permanent. The schedule daemon and getEnabledWebhook skip a
        // disabled extension's rows instead.
        await transaction.update(extensionWebhooks).set({ enabled: false, updatedAt: new Date() }).where(and(eq(extensionWebhooks.extensionId, projection.name), eq(extensionWebhooks.dynamic, false)));
        await transaction.update(extensionSchedules).set({ enabled: false, updatedAt: new Date() }).where(and(eq(extensionSchedules.extensionId, installation.id), eq(extensionSchedules.dynamic, false)));
      }
      return;
    }
    const manifest = release.manifest as unknown as import("./types").ExtensionManifestV2;
    if (manifest.name === "ez-factory") factoryAgents = await prepareEzFactoryAgents(installation, release, transaction);
    const granted = buildFullGrantFromManifest(manifest);
    const values = serializeJsonbFields({ id: installation.id, name: release.manifest.name, version: release.manifest.version, description: release.manifest.description, manifest, source: "release-v4", installPath: null, enabled: true, grantedPermissions: granted, installedPermissions: granted, checksumVerified: true, isBundled: false, disabledByUser: false, creatorUserId: installation.ownerId, updatedAt: new Date() });
    await transaction.insert(extensions).values(values).onConflictDoUpdate({ target: extensions.id, set: values });
    await reconcileWebhooks(manifest.name, granted.webhooks ?? [], () => new Date(), (name, slug) => ensureWebhookSecret(name, slug, installation.ownerId, transaction), transaction);
    await reconcileSchedules(installation.id, granted.schedule && typeof granted.schedule === "object" ? granted.schedule.crons ?? [] : [], () => new Date(), transaction);
    if (!granted.triggers && previousGrant?.triggers) triggersRevokedFor = manifest.name;
    if (manifest.entities?.length) {
      if (!sourceFiles) throw new LifecycleError("seed_source_missing", "Entity seeds require the verified immutable release files.");
      await runEntitySeed({ extensionId: installation.id, entities: manifest.entities, sourceDir: "", sourceFiles, userId: installation.ownerId, database: transaction });
    }
  });
  const { getPageCache } = await import("./page-cache");
  getPageCache().invalidateExtension(installation.id);
  // This generation dropped the triggers capability, so the user-created
  // rows it authorized are soft-disabled.
  if (triggersRevokedFor !== undefined) {
    const { revokeDynamicTriggers } = await import("./triggers-sweep");
    await revokeDynamicTriggers(installation.id, triggersRevokedFor);
  }
  await ExtensionRegistry.getInstance().reload();
  // A bundled extension that subscribes to conversation events is dead on
  // every conversation created while it was disabled — the dispatcher gates
  // delivery on a `conversation_extensions` row and the create-time hook has
  // already been and gone. Reconcile the moment activation enables it so the
  // operator does not have to restart the host. The helper never throws.
  if (release && installation.enabled) {
    const { AUTO_WIRE_BUNDLED_EXTENSION_NAMES, reconcileBundledConversationWiring } = await import("./auto-wire-bundled");
    if (AUTO_WIRE_BUNDLED_EXTENSION_NAMES.includes(release.manifest.name)) await reconcileBundledConversationWiring();
  }
  if (factoryAgents) {
    await getDb().transaction(async (transaction: import("../db/connection").DbTransaction) => {
      const result = await transaction.execute(sql`SELECT payload FROM extension_release_installations WHERE id = ${installation.id} FOR UPDATE`);
      const rows = releaseRows<{ payload: string }>(result);
      const current: InstallationRecord | undefined = rows[0] ? JSON.parse(rows[0].payload) : undefined;
      if (current?.generation === installation.generation && current.activeReleaseId === installation.activeReleaseId && current.enabled === installation.enabled) publishEzFactoryAgents(factoryAgents!);
    });
  }
}

export function recoveryDeadline(state: InstallationState, now = Date.now()): number | undefined {
  if (state.installation.uninstalled) return undefined;
  return Object.values(state.operations)
    .filter((operation) => (operation.kind === "build" && ["queued", "building", "verifying"].includes(operation.state)) || (operation.kind === "activate" && ["awaiting_approval", "activating"].includes(operation.state)))
    .map((operation) => operation.lease?.until)
    .filter((until): until is number => typeof until === "number" && until > now)
    .sort((left, right) => left - right)[0];
}

function clearRecoveryTimer(installationId: string): void {
  const timer = recoveryTimers.get(installationId);
  if (timer) clearTimeout(timer);
  recoveryTimers.delete(installationId);
}

export async function recoverInstallation(services: RecoveryServices, installationId: string): Promise<void> {
  const snapshot = await services.repository.read(installationId);
  if (!snapshot || snapshot.installation.uninstalled) { clearRecoveryTimer(installationId); return; }
  const { installation } = snapshot;
  try {
    await services.migrations.recover(installation.id);
    await services.lifecycle.recover({ principalId: installation.ownerId, scope: installation.scope, kind: "service" }, installation.id);
  } catch (error) {
    log.error("Extension recovery requires attention", { installationId: installation.id, code: error instanceof LifecycleError ? error.code : "recovery_failed" });
    throw error;
  }
  const recovered = await services.repository.read(installationId);
  const deadline = recovered ? recoveryDeadline(recovered) : undefined;
  clearRecoveryTimer(installationId);
  if (deadline === undefined) return;
  const delay = Math.min(Math.max(0, deadline - Date.now()) + 1, 2_147_483_647);
  const timer = setTimeout(async () => {
    recoveryTimers.delete(installationId);
    try {
      await recoverInstallation(services, installationId);
    } catch (error) {
      log.error("Deferred extension recovery requires attention", { installationId, code: error instanceof LifecycleError ? error.code : "recovery_failed" });
    }
  }, delay);
  timer.unref?.();
  recoveryTimers.set(installationId, timer);
}

export async function recoverExtensionLifecycle(): Promise<void> {
  lifecycleRecovery.request();
  await lifecycleRecovery.drain();
}

function recoveryRank(state: InstallationState | undefined, now: number): number {
  const operations = Object.values(state?.operations ?? {});
  if (operations.some(operation => operation.kind === "build" && ["building", "verifying"].includes(operation.state) && (!operation.lease || operation.lease.until <= now))) return 0;
  if (operations.some(operation => operation.kind === "build" && operation.state === "queued")) return 1;
  return 2;
}

export async function recoverInstallations(services: RecoveryServices, installations: readonly InstallationRecord[], capacityAvailable = false): Promise<number | undefined> {
  const ordered = [...installations].sort((left, right) => left.id.localeCompare(right.id));
  const reconciled = await reconcileInstallations(services, ordered);
  const snapshots: { installation: InstallationRecord; state: InstallationState | null }[] = [];
  for (const installation of ordered) if (reconciled.has(installation.id)) snapshots.push({ installation, state: await services.repository.read(installation.id) });
  snapshots.sort((left, right) => recoveryRank(left.state ?? undefined, Date.now()) - recoveryRank(right.state ?? undefined, Date.now()) || left.installation.id.localeCompare(right.installation.id));
  let earliest: number | undefined;
  for (const { installation } of snapshots) {
    try {
      await services.lifecycle.recover({ principalId: installation.ownerId, scope: installation.scope, kind: "service" }, installation.id, { capacityAvailable });
    } catch (error) {
      log.error("Extension recovery requires attention", { installationId: installation.id, code: error instanceof LifecycleError ? error.code : "recovery_failed" });
      continue;
    }
    const state = await services.repository.read(installation.id);
    const deadline = state ? recoveryDeadline(state) : undefined;
    if (deadline !== undefined) earliest = Math.min(earliest ?? deadline, deadline);
  }
  return earliest;
}

/**
 * Visits installations ONE AT A TIME. Never fan this out with `Promise.all`.
 *
 * Each step opens a database transaction and takes FURTHER pool connections
 * while holding it, so a sweep wider than the pool deadlocks it: every
 * connection sits in an open transaction waiting for one that can never come
 * free. The pool is 20 by default (`DB_POOL_MAX`, src/db/connection.ts) while a
 * stock install stages one installation per bundled extension — 28 here — so
 * the fan-out form wedged boot on an ORDINARY install, not an extreme one.
 * `ensureInitialized` awaits this sweep, so the server accepted connections and
 * answered nothing, with no error on any log to say why.
 *
 * The recover loop below is sequential for the same reason. Serialising at the
 * call site is what the pool comment in src/db/connection.ts prescribes for
 * this exact failure; widening the pool only moves the cliff.
 */
export async function reconcileInstallations(services: RecoveryServices, installations: readonly InstallationRecord[]): Promise<Set<string>> {
  const reconciled = new Set<string>();
  for (const installation of installations) {
    try {
      await services.migrations.recover(installation.id);
      await services.lifecycle.reconcile({ principalId: installation.ownerId, scope: installation.scope, kind: "service" }, installation.id);
      reconciled.add(installation.id);
    } catch (error) {
      log.error("Extension recovery requires attention", { installationId: installation.id, code: error instanceof LifecycleError ? error.code : "recovery_failed" });
    }
  }
  return reconciled;
}

async function recoverAllInstallations(): Promise<number | undefined> {
  const capacityAvailable = recoveryCapacityAvailable;
  recoveryCapacityAvailable = false;
  const services = await getServices();
  const { getDb } = await import("../db/connection");
  const result = await getDb().execute(sql`SELECT payload FROM extension_release_installations ORDER BY id`);
  const rows = releaseRows<{ payload: string }>(result);
  return recoverInstallations(services, rows.map(row => JSON.parse(row.payload) as InstallationRecord), capacityAvailable);
}

export async function reconcileExtensionLifecycle(): Promise<void> {
  const services = await getServices();
  const { getDb } = await import("../db/connection");
  const result = await getDb().execute(sql`SELECT payload FROM extension_release_installations ORDER BY id`);
  void auditHistoricalReleaseBlobStorage(services.blobs).catch((error) => {
    log.warn("Extension release blob storage audit unavailable; lifecycle recovery continues.", { code: error instanceof LifecycleError ? error.code : "release_blob_audit_failed" });
  });
  await reconcileInstallations(services, releaseRows<{ payload: string }>(result).map(row => JSON.parse(row.payload) as InstallationRecord));
}

export async function auditHistoricalReleaseBlobStorage(blobs: FileBlobStore): Promise<void> {
  const { getDb } = await import("../db/connection");
  const releaseResult = await getDb().execute(sql`SELECT payload FROM extension_release_records WHERE kind = 'releases' ORDER BY installation_id, id LIMIT ${RELEASE_BLOB_AUDIT_RELEASE_LIMIT + 1}`);
  const sample = boundedReleaseBlobAuditSample(releaseRows<{ payload: string }>(releaseResult), RELEASE_BLOB_AUDIT_RELEASE_LIMIT);
  const releases = sample.records.map((row) => JSON.parse(row.payload) as ReleaseBlobDigests);
  await auditReleaseBlobStorage(blobs, releases, (message, details) => log.warn(message, { ...details }), { partial: sample.partial });
}

const lifecycleRecovery = createLifecycleRecoveryScheduler(
  recoverAllInstallations,
  error => log.error("Extension recovery requires attention", { code: error instanceof LifecycleError ? error.code : "recovery_failed" }),
);
