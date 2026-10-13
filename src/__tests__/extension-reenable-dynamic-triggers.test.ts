// Disabling and re-enabling an extension must not silently kill the cron
// jobs or webhooks a user created through `ctx.triggers` (dynamic rows). The manifest
// reconciler only owns manifest rows, so whatever the disable path does to
// a dynamic row is never undone on re-enable. A row the daemon auto-disabled
// for repeated errors must stay disabled.

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { restoreModuleMocks } from "./helpers/mock-cleanup";
import { closeTestDb, getTestDb, mockDbConnection, mockRealSettings, setupTestDb } from "./helpers/test-pglite";

mockDbConnection();
mockRealSettings();

// `publishExtensionGeneration` reloads the registry, which imports the
// subprocess module. Nothing here spawns one.
mock.module("../extensions/subprocess", () => ({
  ExtensionProcess: class {
    isRunning = false;
    kill() {}
  },
  parseMemoryLimit: (_: string) => undefined,
}));

import { eq, sql } from "drizzle-orm";
import { validateManifest } from "@ezcorp/extension-contract";
import { extensions, extensionSchedules, extensionWebhooks, users } from "../db/schema";
import { DatabaseLifecycleRepository } from "../db/queries/extension-releases";
import { getExtensionLifecycle, publishExtensionGeneration } from "../extensions/extension-lifecycle-service";
import { requestedReleaseGrants } from "../extensions/extension-control";
import { ExtensionRegistry } from "../extensions/registry";
import { getEnabledWebhook } from "../extensions/webhook-store";
import { releaseRuntimeFixture } from "./helpers/release-runtime";
import type { InstallationRecord } from "../extensions/v4/types";

const OWNER = "dyn-cron-owner";

beforeAll(async () => {
  await setupTestDb();
  await getTestDb().insert(users).values({ id: OWNER, email: "dyn-cron@example.com", passwordHash: "h", name: "Owner", role: "admin" });
  await getExtensionLifecycle();
});

afterAll(async () => {
  ExtensionRegistry.resetInstance();
  restoreModuleMocks();
  await closeTestDb();
});

/** Flip the stored installation the way disable / activate do, then publish it. */
async function publishEnabled(installation: InstallationRecord, release: Parameters<typeof publishExtensionGeneration>[1], enabled: boolean) {
  const next: InstallationRecord = { ...installation, enabled, generation: installation.generation + 1 };
  await getTestDb().execute(sql`UPDATE extension_release_installations SET payload = ${JSON.stringify(next)} WHERE id = ${installation.id}`);
  await publishExtensionGeneration(next, release);
  return next;
}

const TRIGGERS = { maxCron: 3, maxWebhooks: 2, webhookPrefix: "user-", maxRunsPerDay: 90 };

/** Install and publish a fresh fixture extension named `name`. */
async function installFixture(name: string, permissions: Record<string, unknown> = { triggers: TRIGGERS }) {
  const manifest = validateManifest({
    schemaVersion: 4, name, version: "1.0.0", description: "fixture",
    author: { name: "test" }, entrypoint: "./index.js", tools: [], permissions,
  });
  const fixture = releaseRuntimeFixture(crypto.randomUUID(), manifest, { ownerId: OWNER });
  fixture.snapshot.installation.grants = requestedReleaseGrants(manifest);
  const { release, installation } = fixture.snapshot;
  await new DatabaseLifecycleRepository(getTestDb()).create({ installation, releases: { [release.id]: release }, revisions: {}, workspaces: {}, approvals: {}, operations: {} });
  await publishExtensionGeneration(installation, release);
  return { release, installation };
}

describe("dynamic cron triggers across extension disable / re-enable", () => {
  test("a user job runs again after re-enable; an error auto-disabled job stays disabled", async () => {
    const { release, installation: installed } = await installFixture("dyn-cron-ext");
    let installation = installed;

    const nextFireAt = new Date(Date.now() + 3_600_000);
    await getTestDb().insert(extensionSchedules).values([
      { extensionId: installation.id, cron: "0 9 * * *", nextFireAt, dynamic: true, key: "live-job", enabled: true },
      { extensionId: installation.id, cron: "0 10 * * *", nextFireAt, dynamic: true, key: "broken-job", enabled: false, consecutiveErrors: 5 },
    ]);

    installation = await publishEnabled(installation, release, false);
    installation = await publishEnabled(installation, release, true);

    const rows = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.extensionId, installation.id));
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
    expect(byKey).toEqual({ "live-job": true, "broken-job": false });
  });
});

describe("dynamic webhooks across extension disable / re-enable", () => {
  test("a user webhook is refused while the extension is disabled and accepts again after re-enable", async () => {
    const { release, installation: installed } = await installFixture("dyn-hook-ext");
    let installation = installed;
    await getTestDb().insert(extensionWebhooks).values({ extensionId: "dyn-hook-ext", slug: "user-hook", dynamic: true, key: "user-hook" });

    installation = await publishEnabled(installation, release, false);
    expect(await getEnabledWebhook("dyn-hook-ext", "user-hook")).toBeNull();

    installation = await publishEnabled(installation, release, true);
    expect((await getEnabledWebhook("dyn-hook-ext", "user-hook"))?.slug).toBe("user-hook");
  });
});

describe("dynamic triggers when the triggers capability is gone (C2 plan §2.2 case 3)", () => {
  test("publishing a release without permissions.triggers soft-disables every user cron and webhook", async () => {
    const { release, installation } = await installFixture("dyn-revoke-ext", {});
    await seedDynamicTriggers(installation.id, "dyn-revoke-ext");
    // The previously published generation granted triggers; this one does not.
    await getTestDb().update(extensions).set({ installedPermissions: { triggers: TRIGGERS } as never }).where(eq(extensions.id, installation.id));

    await publishEnabled(installation, release, true);

    const [cron] = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.extensionId, installation.id));
    const [hook] = await getTestDb().select().from(extensionWebhooks).where(eq(extensionWebhooks.extensionId, "dyn-revoke-ext"));
    expect({ cron: cron?.enabled, hook: hook?.enabled }).toEqual({ cron: false, hook: false });
  });

  test("a publish that never granted triggers leaves user rows alone (no revoke)", async () => {
    const { release, installation } = await installFixture("dyn-never-ext", {});
    await seedDynamicTriggers(installation.id, "dyn-never-ext");

    await publishEnabled(installation, release, true);

    const [cron] = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.extensionId, installation.id));
    const [hook] = await getTestDb().select().from(extensionWebhooks).where(eq(extensionWebhooks.extensionId, "dyn-never-ext"));
    expect({ cron: cron?.enabled, hook: hook?.enabled }).toEqual({ cron: true, hook: true });
  });
});

async function seedDynamicTriggers(installationId: string, name: string): Promise<void> {
  await getTestDb().insert(extensionSchedules).values({
    extensionId: installationId, cron: "0 9 * * *", nextFireAt: new Date(Date.now() + 3_600_000), dynamic: true, key: "job", enabled: true,
  });
  await getTestDb().insert(extensionWebhooks).values({ extensionId: name, slug: "user-hook", dynamic: true, key: "hook" });
}
