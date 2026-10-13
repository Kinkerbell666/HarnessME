/**
 * WebhookDeliveryDaemon — drains the durable `webhook_deliveries` queue onto
 * the loop fire path (Loops EZ Mode Phase 4).
 *
 * Mirrors ScheduleDaemon's claim-before-dispatch discipline but for
 * EXTERNALLY-triggered deliveries (there is no cron schedule — the public route
 * persists a `pending` row, this daemon dispatches it):
 *   - **Claim via CAS.** `UPDATE … SET status='running' WHERE id=? AND
 *     status='pending' RETURNING id` — only the winner of the atomic flip
 *     dispatches, so two daemon instances (or a route's best-effort drain
 *     racing the tick) never double-dispatch. No PID lockfile needed: the CAS
 *     is the guard.
 *   - **Catch-up.** A delivery persisted while the subprocess was down / the
 *     kill switch was engaged stays `pending` and is drained on the next tick
 *     (or `start()`), with `catchUp: true` when it waited past the threshold —
 *     the cron catch-up analogue, NOT the event dispatcher's fire-and-forget.
 *   - **Crash-reap.** A `running` row abandoned by a crashed daemon (older than
 *     `maxDeliveryDurationMs * 2`) reverts to `pending` and re-delivers. Safe:
 *     the SDK loop dedups by `deliveryId` (the fire id), so a rare double
 *     delivery maps to the same run.
 *   - **Kill-switch-gated.** When `loopsKillSwitchEngaged()`, the tick claims
 *     nothing — pending rows survive and drain the moment the switch lifts.
 *   - **Disabled extension → held.** Its deliveries stay `pending`, are never
 *     claimed, and drain after re-enable (the schedule daemon's rule).
 *   - **Subprocess down → no loss.** If the target process isn't running the
 *     claimed row reverts to `pending` (never marked delivered) so a later tick
 *     redelivers.
 *
 * `extension_id` on a delivery is the extension NAME (the registry FK); the
 * subprocess registry is keyed by the extensions-table UUID, so the daemon
 * resolves name→id before dispatch.
 */
import { logger } from "../logger";
import { getDb } from "../db/connection";
import { extensions, webhookDeliveries } from "../db/schema";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { ExtensionRegistry } from "./registry";
import { insertAuditEntry } from "../db/queries/audit-log";
import { EXT_AUDIT_ACTIONS } from "./audit-actions";
import { loopsKillSwitchEngaged } from "./loops-kill-switch";
import { cleanupOldWebhookDeliveries } from "./webhook-store";
import { registerFireCallProvenance, releaseCallProvenance } from "./call-provenance";

const log = logger.child("ext.webhook-delivery-daemon");

type DeliveryRow = typeof webhookDeliveries.$inferSelect;

/** The minimal registry surface the daemon consumes (Pick keeps the test
 *  stubs tiny). */
export type WebhookDaemonRegistry = Pick<ExtensionRegistry, "getProcessIfRunning">;

/** name→extensions.id resolver signature (injectable for tests). */
export type ExtensionIdResolver = (name: string) => Promise<string | null>;

interface DispatchConfig {
  registry?: WebhookDaemonRegistry;
  resolveExtensionId: ExtensionIdResolver;
  catchUpThresholdMs: number;
  maxAttempts: number;
}

const DEFAULT_WAKE_MS = 15_000;
const DEFAULT_MAX_PER_TICK = 30;
const DEFAULT_MAX_DURATION_MS = 300_000;
const DEFAULT_CATCHUP_MS = 60_000;
/** Poison-delivery bound: a delivery whose DISPATCH keeps throwing reverts to
 *  `pending` and re-tries up to this many times; the Nth failure dead-letters it
 *  to a terminal `error` (never an infinite retry loop). Subprocess-down /
 *  no-registry reverts are pure catch-up and do NOT consume an attempt. */
const DEFAULT_MAX_ATTEMPTS = 5;
/** Retention for terminal (`ok` / `error`) deliveries, swept on daemon start. */
const DEFAULT_RETENTION_DAYS = 30;
/** Cap on the persisted dispatch-error string (no unbounded attacker text). */
const MAX_ERROR_LEN = 500;

async function defaultResolveExtensionId(name: string): Promise<string | null> {
  const rows = await getDb().select({ id: extensions.id }).from(extensions).where(eq(extensions.name, name));
  return rows[0]?.id ?? null;
}

// ── Shared claim + dispatch primitives (daemon tick + route drain reuse) ─

/**
 * Deliveries of a disabled extension stay `pending` and are never claimed —
 * held until re-enable, like the schedule daemon's due rows. A delivery's
 * `extension_id` is the extension NAME.
 */
function ofEnabledExtension() {
  return inArray(
    webhookDeliveries.extensionId,
    getDb().select({ name: extensions.name }).from(extensions).where(eq(extensions.enabled, true)),
  );
}

/** CAS claim: flip pending→running. Returns true when THIS caller won. */
async function claimDelivery(id: string, now: Date): Promise<boolean> {
  const won = await getDb().update(webhookDeliveries)
    .set({ status: "running", claimedAt: now })
    .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.status, "pending"), ofEnabledExtension()))
    .returning({ id: webhookDeliveries.id });
  return won.length > 0;
}

async function revertToPending(id: string): Promise<void> {
  await getDb().update(webhookDeliveries)
    .set({ status: "pending", claimedAt: null })
    .where(eq(webhookDeliveries.id, id));
}

/**
 * A DISPATCH failure (the subprocess was present but `sendNotification` threw —
 * a genuinely bad / poison delivery, NOT transient downtime) increments the
 * attempt counter. Under the cap the row reverts to `pending` (retried next
 * tick, with the last error recorded); AT the cap it dead-letters to a terminal
 * `error` with the failure text so the daemon never retries a poison delivery
 * forever. Returns the terminal-ness so the caller can audit a dead-letter.
 */
async function recordDispatchFailure(
  row: DeliveryRow,
  now: Date,
  error: string,
  maxAttempts: number,
): Promise<boolean> {
  const attempts = row.attempts + 1;
  const errText = error.slice(0, MAX_ERROR_LEN);
  if (attempts >= maxAttempts) {
    await getDb().update(webhookDeliveries)
      .set({ status: "error", error: errText, attempts, deliveredAt: now, claimedAt: null })
      .where(eq(webhookDeliveries.id, row.id));
    log.warn("delivery-dead-lettered", { deliveryId: row.id, slug: row.slug, attempts, error: errText });
    return true;
  }
  await getDb().update(webhookDeliveries)
    .set({ status: "pending", claimedAt: null, attempts, error: errText })
    .where(eq(webhookDeliveries.id, row.id));
  return false;
}

/**
 * Dispatch a CLAIMED (running) delivery to its subprocess. On success →
 * `ok` + audit. When the subprocess isn't running (or no registry) → revert to
 * `pending` so a later tick redelivers (never lose the delivery). A dispatch
 * throw → revert too. Returns true only on a real dispatch.
 */
async function dispatchClaimedDelivery(row: DeliveryRow, now: Date, cfg: DispatchConfig): Promise<boolean> {
  if (!cfg.registry) {
    await revertToPending(row.id);
    return false;
  }
  let proc: ReturnType<WebhookDaemonRegistry["getProcessIfRunning"]> = null;
  let extensionId: string | null = null;
  try {
    extensionId = await cfg.resolveExtensionId(row.extensionId);
    proc = extensionId ? cfg.registry.getProcessIfRunning(extensionId) : null;
  } catch (err) {
    log.warn("resolve-process-failed", { deliveryId: row.id, error: String(err) });
  }
  if (!proc || !extensionId) {
    await revertToPending(row.id);
    return false;
  }
  const catchUp = row.catchUp || (now.getTime() - row.receivedAt.getTime() > cfg.catchUpThresholdMs);
  const ezCallId = registerFireCallProvenance({ actorExtensionId: extensionId, onBehalfOf: null, conversationId: null, runId: null, parentCallId: null, kind: "event", ownerless: true });
  try {
    await proc.sendNotification("ezcorp/webhook-fire", { ...buildFireContext(row, catchUp), _meta: { ezCallId, deliveryId: row.id } });
  } catch (err) {
    // The subprocess was present but the push failed — a poison signal, not
    // transient downtime. Bound the retries: increment attempts, dead-letter at
    // the cap (never an infinite redelivery loop).
    log.warn("dispatch-failed", { deliveryId: row.id, error: String(err) });
    await recordDispatchFailure(row, now, String(err), cfg.maxAttempts);
    return false;
  } finally {
    releaseCallProvenance(ezCallId);
  }
  await getDb().update(webhookDeliveries)
    .set({ status: "ok", deliveredAt: now, catchUp })
    .where(eq(webhookDeliveries.id, row.id));
  await insertAuditEntry(null, EXT_AUDIT_ACTIONS.SDK_WEBHOOK_DISPATCHED, row.extensionId, {
    slug: row.slug,
    deliveryId: row.id,
    catchUp,
  }).catch(() => {});
  return true;
}

export class WebhookDeliveryDaemon {
  private readonly opts: {
    wakeIntervalMs: number;
    now: () => Date;
    maxPerTick: number;
    maxDeliveryDurationMs: number;
    retentionDays: number;
    cfg: DispatchConfig;
  };
  private timer?: ReturnType<typeof setInterval>;

  constructor(options?: {
    wakeIntervalMs?: number;
    now?: () => Date;
    registry?: WebhookDaemonRegistry;
    maxPerTick?: number;
    maxDeliveryDurationMs?: number;
    catchUpThresholdMs?: number;
    maxAttempts?: number;
    retentionDays?: number;
    resolveExtensionId?: ExtensionIdResolver;
  }) {
    this.opts = {
      wakeIntervalMs: options?.wakeIntervalMs ?? DEFAULT_WAKE_MS,
      now: options?.now ?? (() => new Date()),
      maxPerTick: options?.maxPerTick ?? DEFAULT_MAX_PER_TICK,
      maxDeliveryDurationMs: options?.maxDeliveryDurationMs ?? DEFAULT_MAX_DURATION_MS,
      retentionDays: options?.retentionDays ?? DEFAULT_RETENTION_DAYS,
      cfg: {
        ...(options?.registry ? { registry: options.registry } : {}),
        resolveExtensionId: options?.resolveExtensionId ?? defaultResolveExtensionId,
        catchUpThresholdMs: options?.catchUpThresholdMs ?? DEFAULT_CATCHUP_MS,
        maxAttempts: options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      },
    };
  }

  /** Start: sweep old terminal rows + reap crashed rows, then install the wake
   *  loop. Returns true. */
  async start(): Promise<boolean> {
    if (this.timer) return true;
    try {
      await cleanupOldWebhookDeliveries(this.opts.retentionDays);
    } catch (err) {
      log.warn("retention-sweep-on-start-failed", { error: String(err) });
    }
    try {
      await this.reapCrashedDeliveries();
    } catch (err) {
      log.warn("reap-on-start-failed", { error: String(err) });
    }
    this.timer = setInterval(() => {
      void this.tick().catch((err) => log.warn("tick-failed", { error: String(err) }));
    }, this.opts.wakeIntervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as unknown as { unref: () => void }).unref();
    }
    return true;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One claim+dispatch pass over the pending queue. Public so tests drive it
   *  without waiting for the interval. */
  async tick(): Promise<{ claimed: number; dispatched: number }> {
    // Global kill switch: suspend the drain — pending rows are left untouched
    // (delivered when the switch lifts). Checked before any DB work.
    if (await loopsKillSwitchEngaged()) {
      return { claimed: 0, dispatched: 0 };
    }
    const now = this.opts.now();
    // Oldest-first (FIFO) so the drain order is deterministic + fair — a burst
    // never starves an earlier pending delivery (mirrors cron catch-up order).
    const pending = await getDb().select().from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.status, "pending"), ofEnabledExtension()))
      .orderBy(asc(webhookDeliveries.receivedAt))
      .limit(this.opts.maxPerTick);

    let claimed = 0;
    let dispatched = 0;
    for (const row of pending) {
      if (!(await claimDelivery(row.id, now))) continue; // lost the CAS.
      claimed++;
      if (await dispatchClaimedDelivery(row, now, this.opts.cfg)) dispatched++;
    }
    return { claimed, dispatched };
  }

  /** Revert `running` rows abandoned by a crashed daemon back to `pending`. */
  async reapCrashedDeliveries(): Promise<void> {
    const cutoff = new Date(this.opts.now().getTime() - this.opts.maxDeliveryDurationMs * 2);
    await getDb().update(webhookDeliveries)
      .set({ status: "pending", claimedAt: null })
      .where(and(
        eq(webhookDeliveries.status, "running"),
        lte(webhookDeliveries.claimedAt, cutoff),
      ));
  }
}

/**
 * Best-effort immediate drain of ONE delivery — called by the route right after
 * it persists an accepted delivery, to cut latency vs waiting for the next
 * tick. Never throws; a no-op leaves the row `pending` for the daemon to catch
 * up. `registry`/`resolveExtensionId` are injectable for tests; production
 * resolves the registry singleton lazily (imported inline to avoid a
 * route→registry module cycle at load).
 */
export async function drainDelivery(
  deliveryId: string,
  registry?: WebhookDaemonRegistry,
  now: () => Date = () => new Date(),
  resolveExtensionId: ExtensionIdResolver = defaultResolveExtensionId,
): Promise<void> {
  try {
    if (await loopsKillSwitchEngaged()) return;
    const rows = await getDb().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId));
    const row = rows[0];
    if (row?.status !== "pending") return;
    const reg = registry ?? (await import("./registry")).ExtensionRegistry.getInstance();
    const at = now();
    if (await claimDelivery(deliveryId, at)) {
      await dispatchClaimedDelivery(row, at, {
        registry: reg,
        resolveExtensionId,
        catchUpThresholdMs: DEFAULT_CATCHUP_MS,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
      });
    }
  } catch (err) {
    log.debug("drain-delivery-failed", { deliveryId, error: String(err) });
  }
}

/** Build the `ezcorp/webhook-fire` wire payload from a delivery row. Parses the
 *  body as JSON only when the content-type is JSON-ish and it parses cleanly —
 *  otherwise the loop works from the raw `body`. The whole wrapper is marked
 *  `untrusted` (always). */
export function buildFireContext(row: DeliveryRow, catchUp: boolean): Record<string, unknown> {
  const parsed = tryParseWebhookJson(row.body, row.contentType);
  return {
    slug: row.slug,
    deliveryId: row.id,
    receivedAt: row.receivedAt.toISOString(),
    catchUp,
    input: {
      kind: "webhook",
      slug: row.slug,
      untrusted: true,
      contentType: row.contentType,
      body: row.body,
      ...(parsed !== undefined ? { parsed } : {}),
      deliveryId: row.id,
      receivedAt: row.receivedAt.toISOString(),
    },
  };
}

/** Parse `body` as JSON when `contentType` is JSON-ish AND it parses; else
 *  undefined. Untrusted data — never trusted, just structurally surfaced. */
export function tryParseWebhookJson(body: string, contentType: string | null): unknown {
  if (!contentType) return undefined;
  const ct = contentType.toLowerCase();
  if (!(ct.includes("application/json") || ct.includes("+json") || ct.includes("text/json"))) {
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
