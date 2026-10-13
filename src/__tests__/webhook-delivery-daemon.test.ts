/**
 * Coverage for the WebhookDeliveryDaemon (Loops EZ Mode Phase 4): claim-before-
 * dispatch, subprocess-down revert, kill-switch gating, catch-up marking,
 * crash-reap, the CAS guard, drainDelivery, and the pure fire-context builder.
 *
 * DB-backed (PGlite snapshot). `loopsKillSwitchEngaged` reads a setting, so the
 * settings query is mocked to toggle it per-test.
 */
import { test, expect, describe, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import {
  setupTestDb, closeTestDb, mockDbConnection, getTestDb,
} from "./helpers/test-pglite";

let killSwitch = false;
mock.module("../db/queries/settings", () => ({
  async getSetting(key: string) {
    if (key === "loops:kill_switch") return killSwitch;
    return undefined;
  },
  async getAllSettings() { return {}; },
  async upsertSetting() {},
  async deleteSetting() { return false; },
}));

mockDbConnection();

import {
  WebhookDeliveryDaemon,
  drainDelivery,
  buildFireContext,
  tryParseWebhookJson,
  type WebhookDaemonRegistry,
} from "../extensions/webhook-delivery-daemon";
import { extensions, extensionWebhooks, webhookDeliveries, auditLog } from "../db/schema";
import { EXT_AUDIT_ACTIONS } from "../extensions/audit-actions";
import { and, eq } from "drizzle-orm";

const EXT_NAME = "wh-daemon-ext";
const EXT_ID = "ext-uuid-1";

// A stub subprocess capturing the webhook-fire notification.
interface Fire { method: string; params: Record<string, unknown> }
function makeRegistry(procUp: boolean, sink: Fire[]): WebhookDaemonRegistry {
  const proc = {
    sendNotification: (method: string, params?: Record<string, unknown>) => {
      sink.push({ method, params: params ?? {} });
    },
  };
  return { getProcessIfRunning: () => (procUp ? (proc as never) : null) };
}

// Inject a fixed name→id resolver so no extensions lookup is needed.
const resolveExtensionId = async () => EXT_ID;

let hookId: string;

async function seedHook(): Promise<void> {
  await getTestDb().insert(extensions).values({
    name: EXT_NAME, version: "0.0.1", description: "",
    manifest: { schemaVersion: 2, name: EXT_NAME, version: "0.0.1", description: "", author: { name: "t" }, permissions: {} } as never,
    source: "test", enabled: true, grantedPermissions: {} as never,
  });
  const [row] = await getTestDb().insert(extensionWebhooks).values({
    extensionId: EXT_NAME, slug: "tickets", enabled: true,
  }).returning({ id: extensionWebhooks.id });
  hookId = row!.id;
}

async function insertPending(opts: {
  body?: string; contentType?: string | null; receivedAt?: Date; status?: "pending" | "running"; catchUp?: boolean; claimedAt?: Date;
} = {}): Promise<string> {
  const [row] = await getTestDb().insert(webhookDeliveries).values({
    webhookId: hookId,
    extensionId: EXT_NAME,
    slug: "tickets",
    status: opts.status ?? "pending",
    contentType: opts.contentType ?? "application/json",
    body: opts.body ?? '{"n":1}',
    receivedAt: opts.receivedAt ?? new Date("2026-07-16T10:00:00.000Z"),
    ...(opts.catchUp !== undefined ? { catchUp: opts.catchUp } : {}),
    ...(opts.claimedAt ? { claimedAt: opts.claimedAt } : {}),
  }).returning({ id: webhookDeliveries.id });
  return row!.id;
}

async function statusOf(id: string): Promise<string> {
  const rows = await getTestDb().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id));
  return rows[0]!.status;
}

async function rowOf(id: string) {
  return (await getTestDb().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)))[0]!;
}

/** A registry whose subprocess is present but whose `sendNotification` always
 *  throws — a genuinely poison delivery (vs. a down subprocess). */
const throwingRegistry: WebhookDaemonRegistry = {
  getProcessIfRunning: () => ({ sendNotification: () => { throw new Error("pipe closed"); } } as never),
};

beforeAll(async () => {
  await setupTestDb();
  await seedHook();
});

beforeEach(async () => {
  killSwitch = false;
  await getTestDb().delete(webhookDeliveries);
});

afterAll(async () => {
  await closeTestDb();
});

describe("tick — dispatch", () => {
  test("pending → claimed → dispatched (fire has delimited untrusted input); row ok", async () => {
    const id = await insertPending({ body: '{"n":7}' });
    const sink: Fire[] = [];
    const daemon = new WebhookDeliveryDaemon({
      registry: makeRegistry(true, sink),
      resolveExtensionId,
      now: () => new Date("2026-07-16T10:00:10.000Z"),
    });
    const r = await daemon.tick();
    expect(r).toEqual({ claimed: 1, dispatched: 1 });
    expect(await statusOf(id)).toBe("ok");
    expect(sink).toHaveLength(1);
    expect(sink[0]!.method).toBe("ezcorp/webhook-fire");
    const input = (sink[0]!.params as { input: Record<string, unknown> }).input;
    expect(input.untrusted).toBe(true);
    expect(input.slug).toBe("tickets");
    expect(input.deliveryId).toBe(id);
    expect(input.parsed).toEqual({ n: 7 });
    // The delivered row records deliveredAt.
    const row = (await getTestDb().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)))[0]!;
    expect(row.deliveredAt).not.toBeNull();
    // A successful dispatch writes a SDK_WEBHOOK_DISPATCHED audit row (no secret).
    const audits = await getTestDb().select().from(auditLog).where(and(
      eq(auditLog.action, EXT_AUDIT_ACTIONS.SDK_WEBHOOK_DISPATCHED),
      eq(auditLog.target, EXT_NAME),
    ));
    const dispatched = audits.find((a) => (a.metadata as { deliveryId?: string })?.deliveryId === id);
    expect(dispatched).toBeTruthy();
    expect((dispatched!.metadata as { slug: string }).slug).toBe("tickets");
  });

  test("subprocess down → claimed then reverted to pending (never lost)", async () => {
    const id = await insertPending();
    const daemon = new WebhookDeliveryDaemon({ registry: makeRegistry(false, []), resolveExtensionId });
    const r = await daemon.tick();
    expect(r).toEqual({ claimed: 1, dispatched: 0 });
    expect(await statusOf(id)).toBe("pending");
  });

  test("no registry (claim-semantics mode) → claimed then reverted to pending", async () => {
    const id = await insertPending();
    const daemon = new WebhookDeliveryDaemon({ resolveExtensionId });
    const r = await daemon.tick();
    expect(r).toEqual({ claimed: 1, dispatched: 0 });
    expect(await statusOf(id)).toBe("pending");
  });

  test("sendNotification throws → reverted to pending (no loss)", async () => {
    const id = await insertPending();
    const throwingRegistry: WebhookDaemonRegistry = {
      getProcessIfRunning: () => ({ sendNotification: () => { throw new Error("pipe closed"); } } as never),
    };
    const daemon = new WebhookDeliveryDaemon({ registry: throwingRegistry, resolveExtensionId });
    const r = await daemon.tick();
    expect(r.dispatched).toBe(0);
    expect(await statusOf(id)).toBe("pending");
  });

  test("resolveExtensionId → null (unknown ext) → reverted to pending", async () => {
    const id = await insertPending();
    const daemon = new WebhookDeliveryDaemon({
      registry: makeRegistry(true, []),
      resolveExtensionId: async () => null,
    });
    const r = await daemon.tick();
    expect(r.dispatched).toBe(0);
    expect(await statusOf(id)).toBe("pending");
  });

  test("default resolver resolves the extension NAME to its id via the DB", async () => {
    // No injected resolver → the daemon's default `extensions.name → id` lookup
    // runs. The seeded extension resolves, so dispatch succeeds.
    const id = await insertPending();
    const sink: Fire[] = [];
    const daemon = new WebhookDeliveryDaemon({ registry: makeRegistry(true, sink) });
    const r = await daemon.tick();
    expect(r.dispatched).toBe(1);
    expect(await statusOf(id)).toBe("ok");
  });
});

describe("poison-delivery bound", () => {
  test("a repeatedly-failing dispatch increments attempts, then dead-letters at the cap", async () => {
    const id = await insertPending();
    const daemon = new WebhookDeliveryDaemon({
      registry: throwingRegistry,
      resolveExtensionId,
      maxAttempts: 3, // small cap for a fast test
    });
    // Attempt 1 → attempts:1, back to pending (under cap).
    await daemon.tick();
    let row = await rowOf(id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.error).toContain("pipe closed");
    // Attempt 2 → attempts:2, still pending.
    await daemon.tick();
    expect((await rowOf(id)).attempts).toBe(2);
    expect(await statusOf(id)).toBe("pending");
    // Attempt 3 → hits the cap → dead-letter (terminal `error`), no re-claim.
    await daemon.tick();
    row = await rowOf(id);
    expect(row.status).toBe("error");
    expect(row.attempts).toBe(3);
    expect(row.error).toContain("pipe closed");
    expect(row.deliveredAt).not.toBeNull();
    // A dead-lettered row is terminal — a further tick never re-claims it.
    const r = await daemon.tick();
    expect(r).toEqual({ claimed: 0, dispatched: 0 });
    expect(await statusOf(id)).toBe("error");
  });

  test("subprocess-DOWN reverts do NOT consume an attempt (pure catch-up)", async () => {
    const id = await insertPending();
    const daemon = new WebhookDeliveryDaemon({ registry: makeRegistry(false, []), resolveExtensionId, maxAttempts: 2 });
    await daemon.tick();
    await daemon.tick();
    await daemon.tick();
    // Three ticks with the subprocess down never dead-letter — attempts stays 0.
    const row = await rowOf(id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
  });

  test("a long dispatch error string is truncated in the persisted `error`", async () => {
    const id = await insertPending();
    const longErr = "E".repeat(2000);
    const bigThrow: WebhookDaemonRegistry = {
      getProcessIfRunning: () => ({ sendNotification: () => { throw new Error(longErr); } } as never),
    };
    const daemon = new WebhookDeliveryDaemon({ registry: bigThrow, resolveExtensionId, maxAttempts: 1 });
    await daemon.tick();
    const row = await rowOf(id);
    expect(row.status).toBe("error");
    expect(row.error!.length).toBeLessThanOrEqual(500);
  });
});

describe("deterministic drain order", () => {
  test("pending rows drain oldest-first (ORDER BY received_at), regardless of insert order", async () => {
    // Insert out of chronological order; capture the dispatch order.
    const idMid = await insertPending({ receivedAt: new Date("2026-07-16T10:00:02.000Z") });
    const idOld = await insertPending({ receivedAt: new Date("2026-07-16T10:00:01.000Z") });
    const idNew = await insertPending({ receivedAt: new Date("2026-07-16T10:00:03.000Z") });
    const sink: Fire[] = [];
    const daemon = new WebhookDeliveryDaemon({
      registry: makeRegistry(true, sink),
      resolveExtensionId,
      now: () => new Date("2026-07-16T10:00:10.000Z"),
    });
    const r = await daemon.tick();
    expect(r.dispatched).toBe(3);
    const orderedIds = sink.map((f) => (f.params as { deliveryId: string }).deliveryId);
    expect(orderedIds).toEqual([idOld, idMid, idNew]);
  });
});

describe("catch-up marking", () => {
  test("a delivery waiting past the threshold dispatches with catchUp:true", async () => {
    const id = await insertPending({ receivedAt: new Date("2026-07-16T10:00:00.000Z") });
    const sink: Fire[] = [];
    const daemon = new WebhookDeliveryDaemon({
      registry: makeRegistry(true, sink),
      resolveExtensionId,
      catchUpThresholdMs: 60_000,
      now: () => new Date("2026-07-16T10:05:00.000Z"), // 5 min later
    });
    await daemon.tick();
    expect((sink[0]!.params as { catchUp: boolean }).catchUp).toBe(true);
    const row = (await getTestDb().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)))[0]!;
    expect(row.catchUp).toBe(true);
  });

  test("a fresh delivery dispatches with catchUp:false", async () => {
    await insertPending({ receivedAt: new Date("2026-07-16T10:00:00.000Z") });
    const sink: Fire[] = [];
    const daemon = new WebhookDeliveryDaemon({
      registry: makeRegistry(true, sink),
      resolveExtensionId,
      now: () => new Date("2026-07-16T10:00:05.000Z"),
    });
    await daemon.tick();
    expect((sink[0]!.params as { catchUp: boolean }).catchUp).toBe(false);
  });
});

describe("kill switch", () => {
  test("engaged → tick claims nothing; pending row untouched", async () => {
    const id = await insertPending();
    killSwitch = true;
    const sink: Fire[] = [];
    const daemon = new WebhookDeliveryDaemon({ registry: makeRegistry(true, sink), resolveExtensionId });
    const r = await daemon.tick();
    expect(r).toEqual({ claimed: 0, dispatched: 0 });
    expect(sink).toHaveLength(0);
    expect(await statusOf(id)).toBe("pending");
  });
});

describe("disabled extension (held until re-enable, like the schedule daemon)", () => {
  async function setEnabled(name: string, enabled: boolean): Promise<void> {
    await getTestDb().update(extensions).set({ enabled }).where(eq(extensions.name, name));
  }

  test("a queued delivery is not claimed while disabled, does not starve other extensions, and drains on re-enable", async () => {
    const OTHER = "wh-daemon-other";
    await getTestDb().insert(extensions).values({
      name: OTHER, version: "0.0.1", description: "",
      manifest: { schemaVersion: 2, name: OTHER, version: "0.0.1", description: "", author: { name: "t" }, permissions: {} } as never,
      source: "test", enabled: true, grantedPermissions: {} as never,
    }).onConflictDoNothing();
    const [otherHook] = await getTestDb().insert(extensionWebhooks).values({ extensionId: OTHER, slug: "other", enabled: true })
      .onConflictDoNothing().returning({ id: extensionWebhooks.id });
    const held = await insertPending({ receivedAt: new Date("2026-07-16T09:00:00.000Z") });
    const [otherRow] = await getTestDb().insert(webhookDeliveries).values({
      webhookId: otherHook!.id, extensionId: OTHER, slug: "other", status: "pending",
      contentType: "application/json", body: "{}", receivedAt: new Date("2026-07-16T10:00:00.000Z"),
    }).returning({ id: webhookDeliveries.id });

    await setEnabled(EXT_NAME, false);
    try {
      const sink: Fire[] = [];
      const daemon = new WebhookDeliveryDaemon({ registry: makeRegistry(true, sink), resolveExtensionId, maxPerTick: 1 });
      expect(await daemon.tick()).toEqual({ claimed: 1, dispatched: 1 });
      expect(await statusOf(held)).toBe("pending");
      expect(await statusOf(otherRow!.id)).toBe("ok");
      expect(sink.map((f) => (f.params as { input: { slug: string } }).input.slug)).toEqual(["other"]);

      await drainDelivery(held, makeRegistry(true, sink), () => new Date(), resolveExtensionId);
      expect(await statusOf(held)).toBe("pending");

      await setEnabled(EXT_NAME, true);
      expect(await daemon.tick()).toEqual({ claimed: 1, dispatched: 1 });
      expect(await statusOf(held)).toBe("ok");
    } finally {
      await setEnabled(EXT_NAME, true);
    }
  });
});

describe("crash reap", () => {
  test("a stale running row (old claimedAt) reverts to pending on start()", async () => {
    const id = await insertPending({
      status: "running",
      claimedAt: new Date("2026-07-16T09:00:00.000Z"),
    });
    const daemon = new WebhookDeliveryDaemon({
      resolveExtensionId,
      maxDeliveryDurationMs: 60_000, // 2x = 2 min; row is an hour old
      now: () => new Date("2026-07-16T10:00:00.000Z"),
    });
    await daemon.reapCrashedDeliveries();
    expect(await statusOf(id)).toBe("pending");
  });

  test("a recent running row is NOT reaped", async () => {
    const id = await insertPending({
      status: "running",
      claimedAt: new Date("2026-07-16T09:59:50.000Z"),
    });
    const daemon = new WebhookDeliveryDaemon({
      resolveExtensionId,
      maxDeliveryDurationMs: 300_000,
      now: () => new Date("2026-07-16T10:00:00.000Z"),
    });
    await daemon.reapCrashedDeliveries();
    expect(await statusOf(id)).toBe("running");
  });
});

describe("start / stop lifecycle", () => {
  test("start returns true and installs a tick loop; stop clears it; double-start is a no-op", async () => {
    const daemon = new WebhookDeliveryDaemon({ wakeIntervalMs: 60_000, resolveExtensionId });
    expect(await daemon.start()).toBe(true);
    expect(await daemon.start()).toBe(true); // idempotent
    daemon.stop();
    daemon.stop(); // safe twice
  });

  test("start() runs the retention sweep — an old terminal delivery is trimmed", async () => {
    const [old] = await getTestDb().insert(webhookDeliveries).values({
      webhookId: hookId, extensionId: EXT_NAME, slug: "tickets", status: "ok",
      contentType: null, body: "x", receivedAt: new Date(Date.now() - 60 * 86_400_000),
    }).returning({ id: webhookDeliveries.id });
    const daemon = new WebhookDeliveryDaemon({ wakeIntervalMs: 60_000, resolveExtensionId });
    await daemon.start();
    daemon.stop();
    const rows = await getTestDb().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, old!.id));
    expect(rows).toHaveLength(0);
  });

  test("the wake loop fires tick automatically (drains a pending delivery)", async () => {
    const id = await insertPending();
    const sink: Fire[] = [];
    const daemon = new WebhookDeliveryDaemon({
      wakeIntervalMs: 5,
      registry: makeRegistry(true, sink),
      resolveExtensionId,
    });
    await daemon.start();
    // Generous margin (5ms interval) — one automatic tick must drain the row.
    await new Promise((r) => setTimeout(r, 60));
    daemon.stop();
    expect(await statusOf(id)).toBe("ok");
  });
});

describe("drainDelivery (route best-effort)", () => {
  test("pending + proc up → dispatched", async () => {
    const id = await insertPending();
    const sink: Fire[] = [];
    await drainDelivery(id, makeRegistry(true, sink), () => new Date("2026-07-16T10:00:01.000Z"), resolveExtensionId);
    expect(await statusOf(id)).toBe("ok");
    expect(sink).toHaveLength(1);
  });

  test("kill switch engaged → no-op (row stays pending)", async () => {
    const id = await insertPending();
    killSwitch = true;
    await drainDelivery(id, makeRegistry(true, []), () => new Date(), resolveExtensionId);
    expect(await statusOf(id)).toBe("pending");
  });

  test("already-running (non-pending) delivery → no-op", async () => {
    const id = await insertPending({ status: "running" });
    const sink: Fire[] = [];
    await drainDelivery(id, makeRegistry(true, sink), () => new Date(), resolveExtensionId);
    expect(sink).toHaveLength(0);
    expect(await statusOf(id)).toBe("running");
  });

  test("unknown delivery id → no-op (never throws)", async () => {
    await drainDelivery("no-such-id", makeRegistry(true, []), () => new Date(), resolveExtensionId);
  });
});

// ── pure helpers ────────────────────────────────────────────────────

describe("tryParseWebhookJson", () => {
  test("JSON content-type + valid body → parsed", () => {
    expect(tryParseWebhookJson('{"a":1}', "application/json")).toEqual({ a: 1 });
    expect(tryParseWebhookJson('{"a":1}', "application/vnd.github+json")).toEqual({ a: 1 });
    expect(tryParseWebhookJson("[1,2]", "text/json; charset=utf-8")).toEqual([1, 2]);
  });

  test("non-JSON content-type → undefined (work from raw)", () => {
    expect(tryParseWebhookJson('{"a":1}', "text/plain")).toBeUndefined();
    expect(tryParseWebhookJson('{"a":1}', null)).toBeUndefined();
  });

  test("malformed JSON body → undefined", () => {
    expect(tryParseWebhookJson("{not json", "application/json")).toBeUndefined();
  });
});

describe("buildFireContext", () => {
  test("non-JSON body → no parsed field; raw body preserved; untrusted always true", () => {
    const row = {
      id: "d1", slug: "tickets", body: "raw text", contentType: "text/plain",
      receivedAt: new Date("2026-07-16T10:00:00.000Z"),
    } as never;
    const ctx = buildFireContext(row, false);
    const input = ctx.input as Record<string, unknown>;
    expect(input.parsed).toBeUndefined();
    expect(input.body).toBe("raw text");
    expect(input.untrusted).toBe(true);
    expect(ctx.catchUp).toBe(false);
  });
});
