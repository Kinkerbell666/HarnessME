/**
 * Coverage for `ScheduleDaemon` + reconciler (Phase 51.5).
 */
import { test, expect, describe, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import { restoreModuleMocks } from "../../__tests__/helpers/mock-cleanup";
import {
  setupTestDb, closeTestDb, mockDbConnection, getTestDb,
} from "../../__tests__/helpers/test-pglite";

// The loops kill switch is the only setting the daemon reads.
let killSwitchSetting: unknown;

mock.module("../../db/queries/settings", () => ({
  async getAllSettings() { return {}; },
  async getSetting() { return killSwitchSetting; },
  async upsertSetting() {},
  async deleteSetting() { return false; },
  async isListingInstalled() { return false; },
}));

mockDbConnection();

import { reconcileSchedules, _wipeSchedulesForTests } from "../schedule-reconcile";
import { ScheduleDaemon, _scheduleDaemonInternals } from "../schedule-daemon";
import {
  resolveCallProvenance,
  _resetCallProvenanceForTests,
} from "../call-provenance";
import { readProcStartTime } from "../../startup/process-lockfile";
import { extensionSchedules, extensionScheduleFires, extensions, auditLog } from "../../db/schema";
import { eq } from "drizzle-orm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

let extId: string;
let extId2: string;

async function ensureExtension(name: string): Promise<string> {
  const [row] = await getTestDb().insert(extensions).values({
    name, version: "0.0.1", description: "",
    manifest: { schemaVersion: 2, name, version: "0.0.1", description: "", author: { name: "t" }, permissions: {} } as any,
    source: "test", enabled: true, grantedPermissions: {} as any,
  }).returning({ id: extensions.id });
  return row!.id;
}

beforeAll(async () => {
  await setupTestDb();
  extId = await ensureExtension("sched-ext-1");
  extId2 = await ensureExtension("sched-ext-2");
});

beforeEach(async () => {
  killSwitchSetting = undefined;
  await getTestDb().delete(extensionScheduleFires);
  await _wipeSchedulesForTests(extId);
  await _wipeSchedulesForTests(extId2);
  await getTestDb().delete(auditLog);
});

afterAll(async () => {
  restoreModuleMocks();
  await closeTestDb();
});

describe("reconcileSchedules", () => {
  test("first install adds new rows", async () => {
    const r = await reconcileSchedules(extId, ["0 * * * *", "*/15 * * * *"]);
    expect(r.added).toBe(2);
    const rows = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.extensionId, extId));
    expect(rows.length).toBe(2);
  });

  test("second pass with same crons preserves rows + history", async () => {
    await reconcileSchedules(extId, ["0 * * * *"]);
    const before = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.extensionId, extId));
    const r = await reconcileSchedules(extId, ["0 * * * *"]);
    expect(r.added).toBe(0);
    expect(r.preserved).toBe(1);
    const after = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.extensionId, extId));
    expect(after[0]!.id).toBe(before[0]!.id);
  });

  test("removed crons soft-disabled (not deleted)", async () => {
    await reconcileSchedules(extId, ["0 * * * *", "*/15 * * * *"]);
    await reconcileSchedules(extId, ["0 * * * *"]);
    const rows = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.extensionId, extId));
    expect(rows.length).toBe(2);
    const enabled = rows.filter((r) => r.enabled);
    const disabled = rows.filter((r) => !r.enabled);
    expect(enabled.length).toBe(1);
    expect(disabled.length).toBe(1);
    expect(disabled[0]!.cron).toBe("*/15 * * * *");
  });

  test("invalid crons silently dropped (max 8)", async () => {
    const crons = [
      "0 * * * *",
      "* * * * *",  // sub-5-min — drop
      "@hourly",     // shorthand — drop
      "0 9 * * 1-5",
    ];
    const r = await reconcileSchedules(extId, crons);
    expect(r.added).toBe(2);
  });
});

describe("ScheduleDaemon — claim-before-dispatch", () => {
  test("tick claims due rows, advances next_fire_at, writes fire history", async () => {
    // Schedule a row whose next_fire_at is already in the past.
    const past = new Date(Date.now() - 60_000);
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: true,
    }).returning();

    // Wired registry so the fire genuinely dispatches (status "ok"). A
    // registry-less daemon would now record the fire as undispatched — that
    // corrected contract is pinned by the Phase 1 repro test below.
    const daemon = new ScheduleDaemon({
      wakeIntervalMs: 60_000,
      registry: {
        getProcessIfRunning() {
          return { isRunning: true, sendNotification() {} } as never;
        },
      },
    });
    const result = await daemon.tick();
    expect(result.claimed).toBe(1);

    // next_fire_at advanced.
    const [advanced] = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.id, sched!.id));
    expect(advanced!.nextFireAt.getTime()).toBeGreaterThan(past.getTime());

    // Fire row written.
    const fires = await getTestDb().select().from(extensionScheduleFires).where(eq(extensionScheduleFires.scheduleId, sched!.id));
    expect(fires.length).toBe(1);
    expect(fires[0]!.status).toBe("ok");
    daemon.stop();
  });

  test("tick is idempotent for not-yet-due schedules", async () => {
    const future = new Date(Date.now() + 60 * 60_000);
    await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: future, enabled: true,
    });
    const daemon = new ScheduleDaemon();
    const result = await daemon.tick();
    expect(result.claimed).toBe(0);
    daemon.stop();
  });

  test("disabled schedules never fire", async () => {
    const past = new Date(Date.now() - 60_000);
    await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: false,
    });
    const daemon = new ScheduleDaemon();
    const result = await daemon.tick();
    expect(result.claimed).toBe(0);
    daemon.stop();
  });

  test("a disabled extension's enabled rows neither fire nor catch up", async () => {
    // Disabling an extension leaves its user-created (dynamic) rows enabled
    // so re-enabling it restores them; the daemon must skip them meanwhile.
    const offExt = await ensureExtension(`sched-ext-off-${crypto.randomUUID()}`);
    await getTestDb().update(extensions).set({ enabled: false }).where(eq(extensions.id, offExt));
    await getTestDb().insert(extensionSchedules).values({
      extensionId: offExt, cron: "0 * * * *", nextFireAt: new Date(Date.now() - 10 * 60_000),
      enabled: true, dynamic: true, key: "user-job",
    });
    const daemon = new ScheduleDaemon({
      skipLockfile: true,
      registry: {
        getProcessIfRunning() { return null; },
        getGrantedPermissions() {
          return { schedule: { maxRetries: 0, maxRunsPerDay: 24, maxRunDurationMs: 1000, missedRunPolicy: "fire-once" } };
        },
      } as any,
    });
    await daemon.start();
    expect((await daemon.tick()).claimed).toBe(0);
    daemon.stop();
    expect(await getTestDb().select().from(extensionScheduleFires)).toHaveLength(0);
  });

  // ── Phase 1 repro: registry-less dispatch must NOT masquerade as success ──
  //
  // Production constructed `new ScheduleDaemon()` with NO registry
  // (background-timers.ts:223), so `dispatchFire` took the else-branch and
  // completed EVERY fire "ok" WITHOUT ever calling `proc.sendNotification` —
  // fires were silently dropped host-side and nothing (no test, no log)
  // caught it. This repro pins the corrected contract: a registry-less fire
  // is recorded DISTINCTLY (status "error", `undispatched:` prefix), never a
  // false "ok".
  test("registry-less fire is recorded as undispatched, NOT a false 'ok' (Phase 1 repro)", async () => {
    const past = new Date(Date.now() - 60_000);
    await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: true,
    });
    // Constructed EXACTLY as the old production site did — no registry.
    const daemon = new ScheduleDaemon();
    const result = await daemon.tick();
    // The row was still CLAIMED (next_fire_at advanced) but NOT dispatched.
    expect(result.claimed).toBe(1);
    expect(result.dispatched).toBe(0);
    const fires = await getTestDb().select().from(extensionScheduleFires);
    expect(fires.length).toBe(1);
    expect(fires[0]!.status).toBe("error");
    expect(fires[0]!.error).toContain("undispatched");
    expect(fires[0]!.error).toContain("no-registry");
    // A delivery miss must NOT bump consecutiveErrors (not the ext's fault).
    const sched = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.extensionId, extId));
    expect(sched[0]!.consecutiveErrors).toBe(0);
    daemon.stop();
  });

  // Registry present but the subprocess is asleep — same discipline: the fire
  // is undispatched, never a false "ok" (mirrors the WebhookDeliveryDaemon,
  // which reverts an undeliverable delivery rather than marking it ok).
  test("no-proc fire (registry present, subprocess asleep) is undispatched, not 'ok'", async () => {
    const past = new Date(Date.now() - 60_000);
    await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: true,
    });
    const daemon = new ScheduleDaemon({
      registry: { getProcessIfRunning() { return null; } } as never,
    });
    const result = await daemon.tick();
    expect(result.claimed).toBe(1);
    expect(result.dispatched).toBe(0);
    const fires = await getTestDb().select().from(extensionScheduleFires);
    expect(fires[0]!.status).toBe("error");
    expect(fires[0]!.error).toContain("subprocess-not-running");
    daemon.stop();
  });

  // The GREEN side of the fix: WITH a wired registry the fire is delivered
  // end-to-end (sendNotification called) AND the reverse-RPC provenance token
  // it minted is STILL RESOLVABLE after the tick returns — proving the token
  // outlives the fire-and-forget `completeFire("ok")` so the subprocess's
  // sweep storage writes (which echo this ezCallId) resolve provenance
  // instead of failing `-32602`. This is the token-lifetime regression guard.
  test("wired-registry fire dispatches AND leaves a resolvable token (lifetime fix)", async () => {
    _resetCallProvenanceForTests();
    const past = new Date(Date.now() - 60_000);
    await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: true,
    });
    let captured: { method: string; params: Record<string, unknown> } | null = null;
    const daemon = new ScheduleDaemon({
      registry: {
        getProcessIfRunning() {
          return {
            isRunning: true,
            sendNotification(method: string, params?: Record<string, unknown>) {
              captured = { method, params: params ?? {} };
            },
          } as never;
        },
      },
    });
    const result = await daemon.tick();
    expect(result.dispatched).toBe(1);
    expect(captured).not.toBeNull();
    expect(captured!.method).toBe("ezcorp/schedule-fire");
    const meta = (captured!.params as { _meta?: { ezCallId?: string } })._meta;
    const prov = resolveCallProvenance(meta!.ezCallId!);
    // Token still alive after the immediate completeFire("ok") — NOT released.
    expect(prov).toBeDefined();
    expect(prov!.ownerless).toBe(true);
    daemon.stop();
    _resetCallProvenanceForTests();
  });
});

describe("ScheduleDaemon — error path", () => {
  test("subprocess sendNotification failure → fire status 'error', consecutiveErrors increments", async () => {
    const past = new Date(Date.now() - 60_000);
    await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: true,
    });
    const daemon = new ScheduleDaemon({
      registry: {
        getProcessIfRunning() {
          return {
            isRunning: true,
            sendNotification() {
              throw new Error("subprocess kaput");
            },
          } as any;
        },
      },
    });
    await daemon.tick();
    const sched = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.extensionId, extId));
    expect(sched[0]!.consecutiveErrors).toBe(1);
    expect(sched[0]!.lastFireStatus).toBe("error");
    daemon.stop();
  });

  test("5 consecutive errors → schedule auto-disabled + audit row", async () => {
    // Manually seed a schedule with 4 errors.
    const past = new Date(Date.now() - 60_000);
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: true, consecutiveErrors: 4,
    }).returning();
    const daemon = new ScheduleDaemon({
      registry: {
        getProcessIfRunning() {
          return {
            isRunning: true,
            sendNotification() { throw new Error("boom"); },
          } as any;
        },
      },
    });
    await daemon.tick();
    const advanced = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.id, sched!.id));
    expect(advanced[0]!.enabled).toBe(false);
    expect(advanced[0]!.consecutiveErrors).toBe(5);

    const audits = await getTestDb().select().from(auditLog).where(eq(auditLog.action, "ext:sdk-schedule-disabled"));
    expect(audits.length).toBe(1);
    daemon.stop();
  });
});

describe("ScheduleDaemon — hardening (Phase 51.5.5/51.5.6)", () => {
  test("jitter applied on catch-up fires (10 schedules → fired_at spread > 0)", async () => {
    // 10 schedules, all due > 60s ago (catchUp = true). Use a fixed
    // PRNG so the test is deterministic.
    const past = new Date(Date.now() - 5 * 60_000);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const extName = `jitter-ext-${i}`;
      const [ext] = await getTestDb().insert(extensions).values({
        name: extName, version: "0.0.1", description: "",
        manifest: { schemaVersion: 2, name: extName, version: "0.0.1", description: "", author: { name: "t" }, permissions: {} } as any,
        source: "test", enabled: true, grantedPermissions: {} as any,
      }).returning({ id: extensions.id });
      const [s] = await getTestDb().insert(extensionSchedules).values({
        extensionId: ext!.id, cron: "0 * * * *",
        nextFireAt: past, enabled: true,
      }).returning();
      ids.push(s!.id);
    }
    let prng = 0;
    const daemon = new ScheduleDaemon({
      catchUpJitterMs: 60_000,
      // Produce 10 distinct increasing values.
      random: () => { prng += 0.05; return prng % 1; },
      skipLockfile: true,
    });
    await daemon.tick();
    const fires = await getTestDb().select().from(extensionScheduleFires);
    const subset = fires.filter((f) => ids.includes(f.scheduleId));
    expect(subset.length).toBe(10);
    const stamps = new Set(subset.map((f) => f.firedAt.getTime()));
    expect(stamps.size).toBeGreaterThan(1);
    daemon.stop();
  });

  test("concurrent-fire cap honored: 6 due schedules for one ext, only 5 fire (cap=5)", async () => {
    // Seed 6 schedules for the same extension.
    const past = new Date(Date.now() - 60_000);
    for (let i = 0; i < 6; i++) {
      await getTestDb().insert(extensionSchedules).values({
        extensionId: extId, cron: `${i * 10} * * * *`,
        nextFireAt: past, enabled: true,
      });
    }
    const daemon = new ScheduleDaemon({ skipLockfile: true });
    const r = await daemon.tick();
    expect(r.claimed).toBe(5);
    daemon.stop();
  });

  test("crash-mid-fire reaping with maxRetries > 0 → row marked error + retry scheduled", async () => {
    // Insert a stale `running` row.
    const longAgo = new Date(Date.now() - 30 * 60_000);
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId2, cron: "0 * * * *",
      nextFireAt: new Date(Date.now() + 60_000), enabled: true,
    }).returning();
    const [stale] = await getTestDb().insert(extensionScheduleFires).values({
      scheduleId: sched!.id, scheduledAt: longAgo, firedAt: longAgo,
      status: "running",
    }).returning();
    // Build a registry that returns `maxRetries: 1` for this extension.
    const daemon = new ScheduleDaemon({
      skipLockfile: true,
      registry: {
        getProcessIfRunning() { return null; },
        getGrantedPermissions() {
          return { schedule: { maxRetries: 1, maxRunsPerDay: 24, maxRunDurationMs: 1000, missedRunPolicy: "skip" } };
        },
      } as any,
    });
    await daemon.start();
    const reaped = await getTestDb().select().from(extensionScheduleFires).where(eq(extensionScheduleFires.id, stale!.id));
    expect(reaped[0]!.status).toBe("error");
    expect(reaped[0]!.error).toContain("reaped");
    const audits = await getTestDb().select().from(auditLog).where(eq(auditLog.action, "ext:sdk-schedule-reaped"));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    daemon.stop();
  });

  test("crash-mid-fire WITHOUT maxRetries → row left as `running` (at-most-once)", async () => {
    const longAgo = new Date(Date.now() - 30 * 60_000);
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId2, cron: "0 * * * *",
      nextFireAt: new Date(Date.now() + 60_000), enabled: true,
    }).returning();
    const [stale] = await getTestDb().insert(extensionScheduleFires).values({
      scheduleId: sched!.id, scheduledAt: longAgo, firedAt: longAgo,
      status: "running",
    }).returning();
    const daemon = new ScheduleDaemon({
      skipLockfile: true,
      registry: {
        getProcessIfRunning() { return null; },
        getGrantedPermissions() {
          return { schedule: { maxRetries: 0, maxRunsPerDay: 24, maxRunDurationMs: 1000, missedRunPolicy: "skip" } };
        },
      } as any,
    });
    await daemon.start();
    const after = await getTestDb().select().from(extensionScheduleFires).where(eq(extensionScheduleFires.id, stale!.id));
    expect(after[0]!.status).toBe("running");
    daemon.stop();
  });

  test("PID lockfile sibling-prevention: second daemon refuses start", async () => {
    const lockPath = join(tmpdir(), `ezcorp-test-lock-${Date.now()}.pid`);
    // A genuine live sibling: a foreign live PID whose identity token still
    // matches. PID 1 is always alive on Linux; stamp its real /proc
    // start-time so the recompute matches → refuse. (A bare-own-PID lockfile
    // is now treated as a reusable stale lock — see the reclaim test below.)
    await Bun.write(lockPath, `1 ${readProcStartTime(1)}`);
    const second = new ScheduleDaemon({ lockfilePath: lockPath });
    const ok = await second.start();
    expect(ok).toBe(false);
    second.stop();
    await unlink(lockPath).catch(() => {});
  });

  test("PID lockfile: reused-own-PID lock from a prior boot is reclaimed (restart fix)", async () => {
    const lockPath = join(tmpdir(), `ezcorp-test-lock-reused-${Date.now()}.pid`);
    // A `.pid` left by a prior boot whose PID got reused as ours used to
    // self-deadlock ("sibling alive"). It must now be reclaimed.
    await Bun.write(lockPath, `${process.pid} prior-boot-token`);
    const daemon = new ScheduleDaemon({ lockfilePath: lockPath });
    const ok = await daemon.start();
    expect(ok).toBe(true);
    daemon.stop();
    await unlink(lockPath).catch(() => {});
  });

  test("PID lockfile: stale PID gets overwritten, daemon starts", async () => {
    const lockPath = join(tmpdir(), `ezcorp-test-lock-stale-${Date.now()}.pid`);
    // A dead PID well above the typical ceiling → stale → reclaim.
    await Bun.write(lockPath, "999999999 dead-token");
    const daemon = new ScheduleDaemon({ lockfilePath: lockPath });
    const ok = await daemon.start();
    expect(ok).toBe(true);
    daemon.stop();
  });

  test("missed-run policy: skip — no fire, advance next_fire_at", async () => {
    const past = new Date(Date.now() - 10 * 60_000);
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: true,
    }).returning();
    const daemon = new ScheduleDaemon({
      skipLockfile: true,
      registry: {
        getProcessIfRunning() { return null; },
        getGrantedPermissions() {
          return { schedule: { maxRetries: 0, maxRunsPerDay: 24, maxRunDurationMs: 1000, missedRunPolicy: "skip" } };
        },
      } as any,
    });
    await daemon.start();
    const fires = await getTestDb().select().from(extensionScheduleFires).where(eq(extensionScheduleFires.scheduleId, sched!.id));
    expect(fires.length).toBe(0);
    const after = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.id, sched!.id));
    expect(after[0]!.nextFireAt.getTime()).toBeGreaterThan(Date.now());
    daemon.stop();
  });

  test("missed-run policy: fire-once → exactly one catch-up fire", async () => {
    const past = new Date(Date.now() - 10 * 60_000);
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: true,
    }).returning();
    const daemon = new ScheduleDaemon({
      skipLockfile: true,
      registry: {
        getProcessIfRunning() { return null; },
        getGrantedPermissions() {
          return { schedule: { maxRetries: 0, maxRunsPerDay: 24, maxRunDurationMs: 1000, missedRunPolicy: "fire-once" } };
        },
      } as any,
    });
    await daemon.start();
    const fires = await getTestDb().select().from(extensionScheduleFires).where(eq(extensionScheduleFires.scheduleId, sched!.id));
    expect(fires.length).toBe(1);
    expect(fires[0]!.catchUp).toBe(true);
    daemon.stop();
  });

  test("missed-run policy: kill switch engaged at start → no catch-up fire, row stays due", async () => {
    killSwitchSetting = true;
    const past = new Date(Date.now() - 10 * 60_000);
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: true,
    }).returning();
    const daemon = new ScheduleDaemon({
      skipLockfile: true,
      registry: {
        getProcessIfRunning() { return null; },
        getGrantedPermissions() {
          return { schedule: { maxRetries: 0, maxRunsPerDay: 24, maxRunDurationMs: 1000, missedRunPolicy: "fire-all" } };
        },
      } as any,
    });
    await daemon.start();
    const fires = await getTestDb().select().from(extensionScheduleFires).where(eq(extensionScheduleFires.scheduleId, sched!.id));
    expect(fires.length).toBe(0);
    const [row] = await getTestDb().select().from(extensionSchedules).where(eq(extensionSchedules.id, sched!.id));
    expect(row!.nextFireAt.getTime()).toBe(past.getTime());
    daemon.stop();
  });

  test("missed-run policy: two instances starting together fire one catch-up, not two", async () => {
    const past = new Date(Date.now() - 10 * 60_000);
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: true,
    }).returning();
    const registry = {
      getProcessIfRunning() { return null; },
      getGrantedPermissions() {
        return { schedule: { maxRetries: 0, maxRunsPerDay: 24, maxRunDurationMs: 1000, missedRunPolicy: "fire-once" } };
      },
    } as any;
    const a = new ScheduleDaemon({ skipLockfile: true, registry });
    const b = new ScheduleDaemon({ skipLockfile: true, registry });
    await Promise.all([a.start(), b.start()]);
    const fires = await getTestDb().select().from(extensionScheduleFires).where(eq(extensionScheduleFires.scheduleId, sched!.id));
    expect(fires.length).toBe(1);
    a.stop();
    b.stop();
  });

  test("missed-run policy: fire-all fires every missed slot, starting at next_fire_at", async () => {
    const now = new Date("2026-01-01T12:30:00Z");
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: new Date("2026-01-01T10:00:00Z"), enabled: true,
    }).returning();
    const daemon = new ScheduleDaemon({
      skipLockfile: true,
      now: () => now,
      registry: {
        getProcessIfRunning() { return null; },
        getGrantedPermissions() {
          return { schedule: { maxRetries: 0, maxRunsPerDay: 24, maxRunDurationMs: 1000, missedRunPolicy: "fire-all" } };
        },
      } as any,
    });
    await daemon.start();
    const fires = await getTestDb().select().from(extensionScheduleFires).where(eq(extensionScheduleFires.scheduleId, sched!.id));
    expect(fires.map((f) => f.scheduledAt.toISOString()).sort()).toEqual([
      "2026-01-01T10:00:00.000Z",
      "2026-01-01T11:00:00.000Z",
      "2026-01-01T12:00:00.000Z",
    ]);
    daemon.stop();
  });

  test("missed-run policy: fire-all caps at maxRunsPerDay", async () => {
    // Use a cron that fires every hour, last_fire_at 5 hours ago, cap=3.
    const past = new Date(Date.now() - 6 * 60 * 60_000);
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, lastFireAt: past, enabled: true,
    }).returning();
    const daemon = new ScheduleDaemon({
      skipLockfile: true,
      catchUpJitterMs: 0,
      registry: {
        getProcessIfRunning() { return null; },
        getGrantedPermissions() {
          return { schedule: { maxRetries: 0, maxRunsPerDay: 3, maxRunDurationMs: 1000, missedRunPolicy: "fire-all" } };
        },
      } as any,
    });
    await daemon.start();
    const fires = await getTestDb().select().from(extensionScheduleFires).where(eq(extensionScheduleFires.scheduleId, sched!.id));
    expect(fires.length).toBe(3); // capped at maxRunsPerDay
    daemon.stop();
  });

  test("retry on error: handler throws twice, third attempt succeeds (maxRetries=2)", async () => {
    const past = new Date(Date.now() - 60_000);
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: past, enabled: true,
    }).returning();
    let n = 0;
    const daemon = new ScheduleDaemon({
      skipLockfile: true,
      registry: {
        getProcessIfRunning() {
          return {
            isRunning: true,
            sendNotification() {
              n++;
              if (n < 3) throw new Error("transient");
            },
          } as any;
        },
        getGrantedPermissions() {
          return { schedule: { maxRetries: 2, maxRunsPerDay: 24, maxRunDurationMs: 1000, missedRunPolicy: "skip" } };
        },
      } as any,
    });
    await daemon.tick();
    const fires = await getTestDb().select().from(extensionScheduleFires).where(eq(extensionScheduleFires.scheduleId, sched!.id));
    // 3 attempts: 2 errored, 1 succeeded.
    expect(fires.length).toBe(3);
    expect(fires.filter((f) => f.status === "error").length).toBe(2);
    expect(fires.filter((f) => f.status === "ok").length).toBe(1);
    daemon.stop();
  });

  test("maxRunsPerDay enforcement: 4th fire skipped + audited (cap=3)", async () => {
    // Seed 3 prior fires today.
    const [sched] = await getTestDb().insert(extensionSchedules).values({
      extensionId: extId, cron: "0 * * * *",
      nextFireAt: new Date(Date.now() - 60_000), enabled: true,
    }).returning();
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    for (let i = 0; i < 3; i++) {
      await getTestDb().insert(extensionScheduleFires).values({
        scheduleId: sched!.id, scheduledAt: today, firedAt: today, status: "ok",
      });
    }
    const daemon = new ScheduleDaemon({
      skipLockfile: true,
      registry: {
        getProcessIfRunning() { return null; },
        getGrantedPermissions() {
          return { schedule: { maxRetries: 0, maxRunsPerDay: 3, maxRunDurationMs: 1000, missedRunPolicy: "skip" } };
        },
      } as any,
    });
    const r = await daemon.tick();
    expect(r.claimed).toBe(0); // capped — no new claim
    const audits = await getTestDb().select().from(auditLog).where(eq(auditLog.action, "ext:sdk-schedule-quota-exceeded"));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    daemon.stop();
  });

  test("fireNow: not-declared cron → ok=false reason cron-not-declared", async () => {
    const daemon = new ScheduleDaemon({ skipLockfile: true });
    const r = await daemon.fireNow(extId, "*/15 * * * *");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("cron-not-declared");
    daemon.stop();
  });

  test("fireNow: declared cron → inserts fire row + ok=true", async () => {
    await reconcileSchedules(extId, ["*/30 * * * *"]);
    const daemon = new ScheduleDaemon({
      skipLockfile: true,
      registry: {
        getProcessIfRunning() { return null; },
        getGrantedPermissions() {
          return { schedule: { maxRetries: 0, maxRunsPerDay: 24, maxRunDurationMs: 1000, missedRunPolicy: "skip" } };
        },
      } as any,
    });
    const r = await daemon.fireNow(extId, "*/30 * * * *");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fireId).toBeTruthy();
    const fires = await getTestDb().select().from(extensionScheduleFires);
    expect(fires.length).toBe(1);
    daemon.stop();
  });
});

describe("PID lockfile helpers", () => {
  test("isProcessAlive: own PID is alive", () => {
    expect(_scheduleDaemonInternals.isProcessAlive(process.pid)).toBe(true);
  });
  test("isProcessAlive: bogus PID is not alive", () => {
    expect(_scheduleDaemonInternals.isProcessAlive(999_999_999)).toBe(false);
  });
  test("isProcessAlive: zero/negative is not alive", () => {
    expect(_scheduleDaemonInternals.isProcessAlive(0)).toBe(false);
    expect(_scheduleDaemonInternals.isProcessAlive(-1)).toBe(false);
  });
});
