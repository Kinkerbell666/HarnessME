/**
 * ScheduleDaemon — persistent cron daemon for `ctx.schedule`.
 *
 * Locked invariants:
 *   - **At-most-once delivery default.** `next_fire_at` IS the queue.
 *     Claim-before-dispatch: a compare-and-swap `UPDATE
 *     extension_schedules SET next_fire_at = <next> WHERE id = $1 AND
 *     next_fire_at = <the value this tick read> RETURNING id` claims the
 *     row — of N instances racing on one due row exactly one CAS matches
 *     (the losers match zero and skip). Only the winner then INSERTs into
 *     `extension_schedule_fires` (`status: running`) and dispatches. This
 *     CAS is the guard for the multi-instance / external-Postgres topology
 *     and works on BOTH drivers (no `FOR UPDATE SKIP LOCKED`, which PGlite
 *     doesn't honor identically). A crash between claim and dispatch is
 *     acceptable because the row already advanced to the next slot.
 *   - **At-least-once opt-in via `maxRetries > 0`.** A `running` row
 *     older than `maxRunDurationMs * 2` is reaped only if the
 *     extension's grant has `maxRetries > 0`.
 *   - **Single-process invariant.** PID lockfile at
 *     `.ezcorp/schedule-daemon.pid`. Distributed cron is out of
 *     scope.
 *   - **Concurrent-fire cap.** 5 per extension, 30 across host.
 *     Counters seeded from `running` rows on startup; decremented on
 *     every completion path (ok / error / timeout).
 *   - **Auto-disable after 5 consecutive errors.**
 *
 * Phase 51.5.5 / 51.5.6 hardening (this file ships the production-grade
 * pieces flagged by the validators):
 *   - PID lockfile sibling-prevention via `.ezcorp/schedule-daemon.pid`.
 *   - Jitter on catch-up fires (0-60s).
 *   - Missed-run policies actually applied (skip / fire-once / fire-all).
 *   - Crash-mid-fire reaping with `maxRetries`-gated retry.
 *   - `maxRunsPerDay` enforcement against `extension_schedule_fires`.
 *   - TZ-aware cron via `parseCron(expr, tz)`.
 *   - Per-extension grant caching (read once per tick from
 *     `getGrantedPermissions(extensionId).schedule`).
 */
import { logger } from "../logger";
import { getDb } from "../db/connection";
import {
  extensionSchedules, extensionScheduleFires, extensions,
} from "../db/schema";
import { eq, and, lte, gte, inArray } from "drizzle-orm";
import { parseCron } from "./cron";
import type { ExtensionRegistry } from "./registry";
import { insertAuditEntry } from "../db/queries/audit-log";
import { EXT_AUDIT_ACTIONS } from "./audit-actions";
import { registerFireCallProvenance } from "./call-provenance";
import { acquireLockfile, releaseLockfile, isProcessAlive } from "../startup/process-lockfile";
import { loopsKillSwitchEngaged } from "./loops-kill-switch";
import { todaysFireCountForSchedule } from "./triggers-store";

const log = logger.child("ext.schedule-daemon");

export interface ScheduleDaemonOptions {
  /** Wake interval (ms). Default 30s. Tests pass smaller. */
  wakeIntervalMs?: number;
  /** Max concurrent fires per extension. Default 5. */
  maxConcurrentPerExt?: number;
  /** Max concurrent fires host-wide. Default 30. */
  maxConcurrentHost?: number;
  /** Now-injection for clock-driven tests. Default
   *  `() => new Date()`. */
  now?: () => Date;
  /** Optional registry (for sending notifications). When unset,
   *  the daemon claims rows and writes audit but does NOT call
   *  the subprocess — useful for the "claim-before-dispatch"
   *  unit test. */
  registry?: Pick<ExtensionRegistry, "getProcessIfRunning"> & {
    getGrantedPermissions?: (extensionId: string) => unknown;
  };
  /** Disable the PID lockfile (test-only — multiple test daemons
   *  can run sequentially without colliding). */
  skipLockfile?: boolean;
  /** Override the lockfile path for tests (default
   *  `.ezcorp/schedule-daemon.pid`). */
  lockfilePath?: string;
  /** Jitter ceiling in ms for catch-up fires. Default 60_000.
   *  Tests pass 0 for determinism. */
  catchUpJitterMs?: number;
  /** Override `Math.random` for jitter determinism in tests. */
  random?: () => number;
}

const DEFAULT_WAKE_MS = 30_000;
const DEFAULT_MAX_PER_EXT = 5;
const DEFAULT_MAX_HOST = 30;
const AUTO_DISABLE_AFTER = 5; // consecutive errors

/**
 * Only an enabled extension's rows fire. Disabling an extension disables
 * its manifest rows but leaves user-created (dynamic) rows as they are, so
 * re-enabling restores them; this filter keeps them quiet meanwhile.
 */
function ofEnabledExtension() {
  return inArray(
    extensionSchedules.extensionId,
    getDb().select({ id: extensions.id }).from(extensions).where(eq(extensions.enabled, true)),
  );
}
const DEFAULT_CATCH_UP_JITTER_MS = 60_000;
const DEFAULT_LOCKFILE_PATH = ".ezcorp/schedule-daemon.pid";
const DEFAULT_MAX_RUN_DURATION_MS = 300_000; // 5 min
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_MAX_RUNS_PER_DAY = 24;
const DEFAULT_MISSED_RUN_POLICY: "skip" | "fire-once" | "fire-all" = "fire-once";

/** Per-extension grant slice consumed by the daemon. */
interface DaemonGrant {
  maxRetries: number;
  maxRunsPerDay: number;
  maxRunDurationMs: number;
  missedRunPolicy: "skip" | "fire-once" | "fire-all";
  tz?: string;
}

/**
 * The stored `granted_permissions` slice `readGrant` reads, from EITHER
 * source. Named rather than written inline at both call sites: the registry
 * read and the extensions-table read must agree on this shape by
 * construction — a `triggers` key added to one copy and not the other would
 * silently change which envelope the daemon enforces depending on whether a
 * registry happened to be wired.
 */
interface StoredScheduleGrant {
  schedule?: {
    maxRetries?: number;
    maxRunsPerDay?: number;
    maxRunDurationMs?: number;
    missedRunPolicy?: "skip" | "fire-once" | "fire-all";
    tz?: string;
  };
  triggers?: { maxRunsPerDay?: number };
}

/**
 * The IANA zone a row's cron is evaluated in. A DYNAMIC row carries its own
 * (the user picked it when creating the job); a manifest row reads the
 * grant's, exactly as before C2.
 */
function zoneFor(
  row: { dynamic: boolean; timezone: string | null },
  grant: DaemonGrant,
): string | undefined {
  if (row.dynamic && row.timezone) return row.timezone;
  return grant.tz;
}

/**
 * Resolve the effective daily envelope for an extension (C2).
 *
 * An extension may hold `permissions.triggers` WITHOUT holding
 * `permissions.schedule` — declaring an envelope for dynamic jobs while
 * declaring no manifest crons at all. `clampSchedulePermission` returns
 * `undefined` when the manifest lists no crons, so in that shape
 * `granted.schedule` is absent and the daemon would silently fall back to
 * `DEFAULT_MAX_RUNS_PER_DAY` — making `triggers.maxRunsPerDay` a number
 * nothing ever reads.
 *
 * `schedule` wins when both are present (it is the narrower, manifest-tier
 * bound); `triggers` fills in when it is the only envelope on offer.
 */
function envelopeFrom(
  schedule: { maxRunsPerDay?: number } | undefined,
  triggers: { maxRunsPerDay?: number } | undefined,
  fallback: number,
): number {
  if (typeof schedule?.maxRunsPerDay === "number") return schedule.maxRunsPerDay;
  if (typeof triggers?.maxRunsPerDay === "number") return triggers.maxRunsPerDay;
  return fallback;
}

export class ScheduleDaemon {
  private readonly opts: Required<Omit<ScheduleDaemonOptions, "registry" | "now" | "skipLockfile" | "lockfilePath" | "random">> & {
    now: () => Date;
    skipLockfile: boolean;
    lockfilePath: string;
    random: () => number;
    registry?: ScheduleDaemonOptions["registry"];
  };
  private timer?: ReturnType<typeof setInterval>;
  private readonly inFlight = new Map<string, number>(); // extensionId → count
  private inFlightHost = 0;
  private lockfileOwned = false;

  constructor(options?: ScheduleDaemonOptions) {
    this.opts = {
      wakeIntervalMs: options?.wakeIntervalMs ?? DEFAULT_WAKE_MS,
      maxConcurrentPerExt: options?.maxConcurrentPerExt ?? DEFAULT_MAX_PER_EXT,
      maxConcurrentHost: options?.maxConcurrentHost ?? DEFAULT_MAX_HOST,
      now: options?.now ?? (() => new Date()),
      catchUpJitterMs: options?.catchUpJitterMs ?? DEFAULT_CATCH_UP_JITTER_MS,
      skipLockfile: options?.skipLockfile ?? false,
      lockfilePath: options?.lockfilePath ?? DEFAULT_LOCKFILE_PATH,
      random: options?.random ?? Math.random,
      ...(options?.registry ? { registry: options.registry } : {}),
    };
  }

  /**
   * Start the daemon.
   *
   * Returns `true` on successful start, `false` when refused due to a
   * sibling daemon detected via the PID lockfile. Callers can log the
   * refusal and skip the wake-loop installation — production wires
   * this from `background-timers.ts`.
   *
   * Side-effects (in order):
   *   1. Acquire PID lockfile (refuse start if another daemon is alive).
   *   2. Reap crash-mid-fire `running` rows per the at-most-once invariant.
   *   3. Apply missed-run policy on schedules whose `next_fire_at` is
   *      already in the past (daemon just came up after offline).
   *   4. Seed `inFlight*` counters from any rows still `running`.
   *   5. Install the 30s wake interval.
   */
  async start(): Promise<boolean> {
    if (this.timer) return true;

    if (!this.opts.skipLockfile) {
      const acquired = await acquireLockfile(this.opts.lockfilePath);
      if (!acquired) {
        log.warn("schedule-daemon refused to start (sibling alive)", {
          lockfile: this.opts.lockfilePath,
        });
        return false;
      }
      this.lockfileOwned = true;
    }

    // Crash-mid-fire reaping. Done before we install the wake loop so
    // the at-most-once invariant holds across the daemon's restart.
    try {
      await this.reapCrashedFires();
    } catch (err) {
      log.warn("reap-on-start-failed", { error: String(err) });
    }

    // Missed-run policy on offline catch-up. Each schedule's grant
    // dictates skip / fire-once / fire-all behavior.
    try {
      await this.applyMissedRunPolicies();
    } catch (err) {
      log.warn("missed-run-policy-on-start-failed", { error: String(err) });
    }

    // Seed in-flight counters from any rows still `running` (defense
    // against a sibling daemon that exited mid-tick — those rows count
    // toward the cap until they get reaped on a later cycle).
    try {
      const live = await getDb().select({
        scheduleId: extensionScheduleFires.scheduleId,
      })
        .from(extensionScheduleFires)
        .where(eq(extensionScheduleFires.status, "running"));
      for (const row of live) {
        const sched = await getDb().select({ extensionId: extensionSchedules.extensionId })
          .from(extensionSchedules)
          .where(eq(extensionSchedules.id, row.scheduleId));
        const extId = sched[0]?.extensionId;
        if (extId) {
          this.inFlight.set(extId, (this.inFlight.get(extId) ?? 0) + 1);
          this.inFlightHost++;
        }
      }
    } catch (err) {
      log.debug("seed-counters-failed", { error: String(err) });
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
    if (this.lockfileOwned) {
      void releaseLockfile(this.opts.lockfilePath).catch(() => {});
      this.lockfileOwned = false;
    }
  }

  /** Single-pass claim + dispatch. Public so tests can drive it
   *  directly without a 30s wait. */
  async tick(): Promise<{ claimed: number; dispatched: number }> {
    // Global loops kill switch: suspend the cron claim path entirely. Rows
    // stay due (next_fire_at unchanged), so the daemon resumes cleanly the
    // moment the operator disengages the switch — no fires are lost, none
    // fire while suspended. Checked before any DB work.
    if (await loopsKillSwitchEngaged()) {
      return { claimed: 0, dispatched: 0 };
    }

    const db = getDb();
    const now = this.opts.now();

    // ── Claim phase ──────────────────────────────────────────────
    // Select rows that are due, then per row run a compare-and-swap on
    // next_fire_at to CLAIM it before inserting a fire + dispatching (see
    // the CAS below). The CAS is what makes the claim safe under multiple
    // instances sharing one external Postgres — it replaces `FOR UPDATE
    // SKIP LOCKED` (which PGlite doesn't honor identically) with a form
    // that is correct on both drivers.
    const due = await db.select().from(extensionSchedules).where(and(
      eq(extensionSchedules.enabled, true),
      lte(extensionSchedules.nextFireAt, now),
      ofEnabledExtension(),
    )).limit(100);

    let claimed = 0;
    let dispatched = 0;
    // Per-tick claim counters — independent of `inFlight*` so the cap
    // bites even when dispatch is synchronous (no-registry test mode
    // decrements `inFlight*` before the next loop iteration). The
    // inFlight* counters still gate across overlapping ticks.
    const tickClaimsByExt = new Map<string, number>();
    let tickClaimsHost = 0;

    for (const row of due) {
      // Concurrent-fire caps. Honor BOTH the live in-flight counters
      // (cross-tick) AND the per-tick claim counters (intra-tick).
      const liveHost = this.inFlightHost + tickClaimsHost;
      if (liveHost >= this.opts.maxConcurrentHost) break;
      const liveExt = (this.inFlight.get(row.extensionId) ?? 0)
        + (tickClaimsByExt.get(row.extensionId) ?? 0);
      if (liveExt >= this.opts.maxConcurrentPerExt) continue;

      const grant = await this.readGrant(row.extensionId);
      const tz = zoneFor(row, grant);

      // PER-KEY quota (C2) — checked BEFORE the extension-wide gate.
      //
      // `maxRunsPerDay` is an ENVELOPE, not a per-job allowance. With 25
      // dynamic crons under one install they all draw on one budget, so a
      // single job firing every 5 minutes exhausts it before lunch and
      // starves the other 24 — and the starved jobs' only signal would be a
      // quota audit row naming no job at all. The per-key cap is what makes
      // the envelope survivable; the extension-wide gate below remains the
      // spend bound.
      //
      // A quota denial deliberately does NOT touch `consecutive_errors`:
      // being rate-limited is not the extension misbehaving, and counting it
      // would let 5 quota-limited days auto-disable a perfectly healthy job.
      // Same distinction the daemon already draws for delivery misses.
      if (row.dynamic && row.key !== null && row.maxRunsPerDay !== null) {
        const keyCount = await todaysFireCountForSchedule(row.id, now);
        if (keyCount >= row.maxRunsPerDay) {
          await this.auditQuotaExceeded(
            row.extensionId, row.id, keyCount, row.maxRunsPerDay, row.key,
          );
          this.advancePastQuota(row, tz, now);
          continue;
        }
      }

      // maxRunsPerDay quota check (count today's `running` + completed
      // fires for this schedule's extension).
      const dailyCount = await this.todaysFireCount(row.extensionId);
      if (dailyCount >= grant.maxRunsPerDay) {
        // Name the KEY on a dynamic row, so the job that was refused is
        // identifiable rather than just "something under this extension".
        await this.auditQuotaExceeded(
          row.extensionId, row.id, dailyCount, grant.maxRunsPerDay, row.key,
        );
        this.advancePastQuota(row, tz, now);
        continue;
      }

      try {
        const nextNext = parseCron(row.cron, tz).next(now);
        // Determine catch-up (and apply jitter).
        const isCatchUp = row.nextFireAt.getTime() < now.getTime() - 60_000;
        const jitterMs = isCatchUp
          ? Math.floor(this.opts.random() * this.opts.catchUpJitterMs)
          : 0;
        const firedAt = jitterMs > 0 ? new Date(now.getTime() + jitterMs) : now;

        // Compare-and-swap claim (the multi-instance double-fire guard the
        // module header asserts). Advance next_fire_at CONDITIONALLY: the
        // WHERE still matches the value this tick read (`row.nextFireAt`), so
        // of N instances racing on the same due row exactly ONE update matches
        // (RETURNING a row) and the losers match zero and skip. This works on
        // BOTH drivers (no `FOR UPDATE SKIP LOCKED`, which PGlite doesn't honor
        // the same way) and is the claim boundary: only after winning do we
        // insert the fire row and dispatch, so a lost race never double-fires.
        const claimedRows = await db.update(extensionSchedules)
          .set({ nextFireAt: nextNext, updatedAt: now })
          .where(and(
            eq(extensionSchedules.id, row.id),
            eq(extensionSchedules.nextFireAt, row.nextFireAt),
          ))
          .returning({ id: extensionSchedules.id });
        if (claimedRows.length === 0) continue; // lost the race — another instance claimed it

        // Won the claim: record the fire row (status=running) + backfill the
        // schedule's last-fire pointer (next_fire_at already advanced above).
        const [fire] = await db.insert(extensionScheduleFires).values({
          scheduleId: row.id,
          scheduledAt: row.nextFireAt,
          firedAt,
          status: "running",
          catchUp: isCatchUp,
        }).returning();
        await db.update(extensionSchedules)
          .set({ lastFireAt: firedAt, lastFireId: fire!.id })
          .where(eq(extensionSchedules.id, row.id));
        claimed++;
        // Bump per-tick claims (gates further claims this tick) AND
        // in-flight (gates across overlapping ticks). dispatchFire's
        // completion path decrements only `inFlight*`; per-tick
        // counters remain elevated until tick() returns.
        tickClaimsHost++;
        tickClaimsByExt.set(row.extensionId, (tickClaimsByExt.get(row.extensionId) ?? 0) + 1);
        this.inFlightHost++;
        this.inFlight.set(row.extensionId, (this.inFlight.get(row.extensionId) ?? 0) + 1);

        // ── Dispatch phase ────────────────────────────────────────
        // Await the dispatch so error/completion paths (and their
        // counter decrements) finish in deterministic order. The
        // cap-enforcement invariant is preserved because every
        // claim within this tick has already incremented the
        // counter before the next loop iteration runs the cap check.
        // For the per-tick cap to bite, we additionally enforce
        // `claimed >= maxConcurrentPerExt` as a hard cap below.
        // `dispatched` counts only a REAL delivery — an undispatched fire
        // (no registry / asleep subprocess) returns false and is NOT counted.
        if (await this.dispatchFire(row, fire!.id, firedAt, isCatchUp, 0, grant.maxRunDurationMs)) {
          dispatched++;
        }
      } catch (err) {
        log.warn("claim-failed", { scheduleId: row.id, error: String(err) });
      }
    }

    return { claimed, dispatched };
  }

  /** Drive a `Schedule.fireNow()` from the host handler. Counts
   *  against `maxRunsPerDay`. Returns `{ ok, fireId? }` or
   *  `{ ok: false, reason }`. */
  async fireNow(extensionId: string, cron: string): Promise<{ ok: true; fireId: string } | { ok: false; reason: string }> {
    // Global loops kill switch: refuse manual cron-fire triggers too.
    if (await loopsKillSwitchEngaged()) {
      return { ok: false, reason: "loops-suspended" };
    }
    const db = getDb();
    const now = this.opts.now();
    // Manifest validation: cron must be in the extension's
    // `extension_schedules` registrations (the reconciler has
    // already pushed these from the manifest).
    const sched = await db.select().from(extensionSchedules).where(and(
      eq(extensionSchedules.extensionId, extensionId),
      eq(extensionSchedules.cron, cron),
    ));
    if (sched.length === 0) return { ok: false, reason: "cron-not-declared" };
    const row = sched[0]!;
    if (!row.enabled) return { ok: false, reason: "schedule-disabled" };

    const grant = await this.readGrant(extensionId);
    const dailyCount = await this.todaysFireCount(extensionId);
    if (dailyCount >= grant.maxRunsPerDay) {
      return { ok: false, reason: "max-runs-per-day-exceeded" };
    }

    // Insert pending fire row + dispatch immediately.
    const [fire] = await db.insert(extensionScheduleFires).values({
      scheduleId: row.id,
      scheduledAt: now,
      firedAt: now,
      status: "running",
      catchUp: false,
    }).returning();

    this.inFlightHost++;
    this.inFlight.set(extensionId, (this.inFlight.get(extensionId) ?? 0) + 1);

    await this.dispatchFire(row, fire!.id, now, false, 0, grant.maxRunDurationMs, /* fireNow */ true);
    return { ok: true, fireId: fire!.id };
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private async dispatchFire(
    schedule: typeof extensionSchedules.$inferSelect,
    fireId: string,
    firedAt: Date,
    catchUp: boolean,
    attempt: number,
    maxRunDurationMs: number,
    fireNow = false,
  ): Promise<boolean> {
    const proc = this.opts.registry?.getProcessIfRunning(schedule.extensionId);
    const completion = (status: "ok" | "error" | "timeout", error?: string): Promise<void> =>
      this.completeFire(schedule, fireId, firedAt, status, error);
    if (this.opts.registry && proc) {
      try {
        // Cron fires have NO conversation or user — they are ownerless.
        // We still mint a host-issued correlation token so a reverse-RPC
        // from the fire handler resolves to a CLEAN soft-fail (-32106 +
        // info log) for owner-scoped caps, and SUCCEEDS for the install-wide
        // global storage scope (the reconcile sweep's own reads/writes).
        // The token's lifetime is sized to the grant's `maxRunDurationMs`
        // (default 5 min) — a fire-and-forget dispatch has no completion
        // callback to release on, and the sweep's storage writes must still
        // resolve this token when they land (a 2-min window dropped them
        // mid-sweep as `-32602`). The bounded auto-release timer IS the
        // deterministic release; the TTL sweep (per-token `expiresAt`) is the
        // final backstop. We deliberately do NOT release in `completeFire`:
        // that runs immediately after this fire-and-forget send, so releasing
        // there would reap the token BEFORE the subprocess's reverse-RPC
        // arrives — re-introducing the exact `-32602` this phase fixes.
        const ezCallId = registerFireCallProvenance({
          onBehalfOf: null,
          conversationId: null,
          runId: null,
          parentCallId: null,
          actorExtensionId: schedule.extensionId,
          kind: "schedule",
          ownerless: true,
        }, { autoReleaseMs: maxRunDurationMs });
        log.info(
          "scheduled cron fire has no resolvable owner — owner-scoped capability calls will be skipped (clean soft-fail); global-scope storage still resolves",
          { extensionId: schedule.extensionId, cron: schedule.cron, fireId },
        );
        // ── The dispatch split (C2) ──────────────────────────────
        //
        // A DYNAMIC row goes out on `ezcorp/trigger-fire`, keyed on its
        // `key`. A MANIFEST row goes out on `ezcorp/schedule-fire` with a
        // byte-identical payload to before C2.
        //
        // They cannot share a notification: the SDK's `Schedule` receiver
        // resolves its handler with `handlers.get(ctx.cron)`, and
        // `ScheduleHandlerContext` carries no job identity at all. Two
        // dynamic jobs sharing `0 9 * * 1` would therefore land on the same
        // handler with no way to tell which fired — a system that STORES
        // them correctly and RUNS them identically, which is worse than the
        // unique-index violation it replaced because it fails silently.
        if (schedule.dynamic && schedule.key !== null) {
          await proc.sendNotification("ezcorp/trigger-fire", {
            v: 1,
            key: schedule.key,
            kind: "cron",
            cron: schedule.cron,
            firedAt: firedAt.toISOString(),
            fireId,
            catchUp,
            attempt,
            _meta: { ezCallId },
          });
        } else {
          await proc.sendNotification("ezcorp/schedule-fire", {
            cron: schedule.cron,
            scheduledAt: schedule.nextFireAt.toISOString(),
            firedAt: firedAt.toISOString(),
            fireId,
            catchUp,
            retry: attempt > 0,
            attempt,
            _meta: { ezCallId },
          });
        }
        if (fireNow) {
          await insertAuditEntry(
            null,
            EXT_AUDIT_ACTIONS.SDK_SCHEDULE_FIRE_NOW,
            schedule.extensionId,
            { capability: "schedule", oldValue: undefined, newValue: schedule.cron, actor: "system", reason: "fire-now invocation" },
          ).catch(() => {});
        }
        await completion("ok");
        return true;
      } catch (err) {
        await this.handleFireError(schedule, fireId, err, attempt);
        return false;
      }
    }
    // No registry, or the subprocess is not running: the fire could NOT be
    // delivered. This MUST NOT masquerade as success. A registry-less daemon
    // is the production misconfiguration this phase fixes (`new
    // ScheduleDaemon()` with no registry silently dropped EVERY fire behind a
    // false `completion("ok")`); an asleep subprocess likewise never received
    // the notification. Record the drop distinctly (status `error`,
    // `undispatched:` prefix) + WARN so it can never hide again.
    const reason = !this.opts.registry ? "no-registry" : "subprocess-not-running";
    await this.completeUndispatched(schedule, fireId, firedAt, reason);
    return false;
  }

  /**
   * A fire that could not be dispatched (no registry wired, or the target
   * subprocess is not running). Records a DISTINCT non-`ok` status + WARN so
   * the registry-less production bug can never again hide behind a false
   * `ok`. Deliberately does NOT bump `consecutiveErrors`: a delivery miss is
   * not the extension's fault, so it must not count toward the 5-error
   * auto-disable (which is reserved for handler-thrown errors).
   */
  private async completeUndispatched(
    schedule: typeof extensionSchedules.$inferSelect,
    fireId: string,
    firedAt: Date,
    reason: string,
  ): Promise<void> {
    log.warn(
      "schedule fire not dispatched — no live subprocess to deliver to; fire dropped (NOT completed ok)",
      { extensionId: schedule.extensionId, cron: schedule.cron, fireId, reason },
    );
    const db = getDb();
    const durationMs = this.opts.now().getTime() - firedAt.getTime();
    await db.update(extensionScheduleFires)
      .set({ status: "error", durationMs, error: `undispatched: ${reason}` })
      .where(eq(extensionScheduleFires.id, fireId));
    const cur = this.inFlight.get(schedule.extensionId) ?? 0;
    if (cur > 0) this.inFlight.set(schedule.extensionId, cur - 1);
    if (this.inFlightHost > 0) this.inFlightHost--;
  }

  private async completeFire(
    schedule: typeof extensionSchedules.$inferSelect,
    fireId: string,
    firedAt: Date,
    status: "ok" | "error" | "timeout",
    error?: string,
  ): Promise<void> {
    const db = getDb();
    const durationMs = this.opts.now().getTime() - firedAt.getTime();
    await db.update(extensionScheduleFires)
      .set({ status, durationMs, ...(error !== undefined ? { error } : {}) })
      .where(eq(extensionScheduleFires.id, fireId));
    if (status === "ok") {
      await db.update(extensionSchedules)
        .set({ lastFireStatus: "ok", consecutiveErrors: 0 })
        .where(eq(extensionSchedules.id, schedule.id));
    }
    // Decrement in-flight counters on every completion path.
    const cur = this.inFlight.get(schedule.extensionId) ?? 0;
    if (cur > 0) this.inFlight.set(schedule.extensionId, cur - 1);
    if (this.inFlightHost > 0) this.inFlightHost--;
  }

  private async handleFireError(
    schedule: typeof extensionSchedules.$inferSelect,
    fireId: string,
    err: unknown,
    attempt: number,
  ): Promise<void> {
    const db = getDb();
    const grant = await this.readGrant(schedule.extensionId);
    const errMsg = String((err as Error)?.message ?? err);

    if (attempt < grant.maxRetries) {
      // Schedule a retry — leave the existing fire as `error` and
      // synthesize a new attempt row.
      await db.update(extensionScheduleFires)
        .set({ status: "error", error: errMsg })
        .where(eq(extensionScheduleFires.id, fireId));
      // Decrement counters before the retry so the cap doesn't double-count.
      const cur = this.inFlight.get(schedule.extensionId) ?? 0;
      if (cur > 0) this.inFlight.set(schedule.extensionId, cur - 1);
      if (this.inFlightHost > 0) this.inFlightHost--;

      const retryFiredAt = this.opts.now();
      const [retryFire] = await db.insert(extensionScheduleFires).values({
        scheduleId: schedule.id,
        scheduledAt: schedule.nextFireAt,
        firedAt: retryFiredAt,
        status: "running",
        attempt: attempt + 1,
        catchUp: false,
      }).returning();
      this.inFlightHost++;
      this.inFlight.set(schedule.extensionId, (this.inFlight.get(schedule.extensionId) ?? 0) + 1);
      await this.dispatchFire(schedule, retryFire!.id, retryFiredAt, false, attempt + 1, grant.maxRunDurationMs);
      return;
    }

    // No more retries — mark error + bump consecutive count.
    await db.update(extensionScheduleFires)
      .set({ status: "error", error: errMsg })
      .where(eq(extensionScheduleFires.id, fireId));

    const cur = this.inFlight.get(schedule.extensionId) ?? 0;
    if (cur > 0) this.inFlight.set(schedule.extensionId, cur - 1);
    if (this.inFlightHost > 0) this.inFlightHost--;

    const newCount = (schedule.consecutiveErrors ?? 0) + 1;
    await db.update(extensionSchedules)
      .set({
        consecutiveErrors: newCount,
        lastFireStatus: "error",
        ...(newCount >= AUTO_DISABLE_AFTER ? { enabled: false } : {}),
      })
      .where(eq(extensionSchedules.id, schedule.id));

    if (newCount >= AUTO_DISABLE_AFTER) {
      await insertAuditEntry(
        null,
        EXT_AUDIT_ACTIONS.SDK_SCHEDULE_DISABLED,
        schedule.extensionId,
        {
          capability: "schedule",
          oldValue: { enabled: true },
          newValue: { enabled: false, consecutiveErrors: newCount },
          actor: "system",
          reason: `Auto-disabled after ${newCount} consecutive errors`,
        },
      ).catch(() => {});
    }
  }

  /** Read this extension's schedule grant from the registry. Falls back
   *  to the daemon defaults when the registry is missing or didn't
   *  return a grant. */
  private async readGrant(extensionId: string): Promise<DaemonGrant> {
    const fallback: DaemonGrant = {
      maxRetries: DEFAULT_MAX_RETRIES,
      maxRunsPerDay: DEFAULT_MAX_RUNS_PER_DAY,
      maxRunDurationMs: DEFAULT_MAX_RUN_DURATION_MS,
      missedRunPolicy: DEFAULT_MISSED_RUN_POLICY,
    };
    const reg = this.opts.registry;
    if (reg && typeof reg.getGrantedPermissions === "function") {
      const granted = reg.getGrantedPermissions(extensionId) as StoredScheduleGrant | undefined;
      const sched = granted?.schedule;
      if (sched || granted?.triggers) {
        return {
          maxRetries: sched?.maxRetries ?? fallback.maxRetries,
          maxRunsPerDay: envelopeFrom(sched, granted?.triggers, fallback.maxRunsPerDay),
          maxRunDurationMs: sched?.maxRunDurationMs ?? fallback.maxRunDurationMs,
          missedRunPolicy: sched?.missedRunPolicy ?? fallback.missedRunPolicy,
          ...(sched?.tz !== undefined ? { tz: sched.tz } : {}),
        };
      }
    }
    // Without registry, read directly from the extensions table so the
    // host can still enforce per-extension caps even in daemon-only
    // configurations (e.g. background reconciler).
    try {
      const rows = await getDb().select({ granted: extensions.grantedPermissions })
        .from(extensions)
        .where(eq(extensions.id, extensionId));
      const granted = rows[0]?.granted as StoredScheduleGrant | undefined;
      const sched = granted?.schedule;
      if (sched || granted?.triggers) {
        return {
          maxRetries: sched?.maxRetries ?? fallback.maxRetries,
          maxRunsPerDay: envelopeFrom(sched, granted?.triggers, fallback.maxRunsPerDay),
          maxRunDurationMs: sched?.maxRunDurationMs ?? fallback.maxRunDurationMs,
          missedRunPolicy: sched?.missedRunPolicy ?? fallback.missedRunPolicy,
          ...(sched?.tz !== undefined ? { tz: sched.tz } : {}),
        };
      }
    } catch {
      // Fall through to daemon defaults.
    }
    return fallback;
  }

  /** Count today's (UTC calendar day) fires for an extension across all
   *  its schedules. Used to enforce the extension-wide `maxRunsPerDay`.
   *
   *  The day boundary comes from the INJECTED clock, not the wall clock: a
   *  test driving `now` across a UTC midnight would otherwise count against
   *  the real today and flake. */
  private async todaysFireCount(extensionId: string): Promise<number> {
    const startOfDay = new Date(this.opts.now());
    startOfDay.setUTCHours(0, 0, 0, 0);
    const rows = await getDb().select({ id: extensionScheduleFires.id })
      .from(extensionScheduleFires)
      .innerJoin(extensionSchedules, eq(extensionScheduleFires.scheduleId, extensionSchedules.id))
      .where(and(
        eq(extensionSchedules.extensionId, extensionId),
        gte(extensionScheduleFires.firedAt, startOfDay),
      ));
    return rows.length;
  }

  private async auditQuotaExceeded(
    extensionId: string,
    scheduleId: string,
    used: number,
    cap: number,
    key?: string | null,
  ): Promise<void> {
    await insertAuditEntry(
      null,
      EXT_AUDIT_ACTIONS.SDK_SCHEDULE_QUOTA_EXCEEDED,
      extensionId,
      {
        capability: "schedule",
        oldValue: { used },
        // The KEY is what makes a starved dynamic job diagnosable — without
        // it the operator sees only that "something under this extension"
        // hit the cap.
        newValue: { cap, scheduleId, ...(key ? { key } : {}) },
        actor: "system",
        reason: `maxRunsPerDay exceeded (${used}/${cap})`,
      },
    ).catch(() => {});
  }

  /** Advance `next_fire_at` past a quota-refused slot so the row is not
   *  re-picked 30s later. Fire-and-forget: a failure here just means one
   *  wasted re-check on the next tick. */
  private advancePastQuota(
    row: typeof extensionSchedules.$inferSelect,
    tz: string | undefined,
    now: Date,
  ): void {
    try {
      const next = parseCron(row.cron, tz).next(now);
      void getDb().update(extensionSchedules)
        .set({ nextFireAt: next, updatedAt: now })
        .where(eq(extensionSchedules.id, row.id))
        .catch((err: unknown) => {
          log.warn("advance-after-quota-failed", { scheduleId: row.id, error: String(err) });
        });
    } catch (err) {
      log.warn("advance-after-quota-failed", { scheduleId: row.id, error: String(err) });
    }
  }

  /** Crash-mid-fire reaping. A `running` row older than
   *  `maxRunDurationMs * 2` was abandoned by a previous daemon
   *  process. If the schedule's `maxRetries > 0`, mark it `error` so
   *  the next tick can retry; otherwise leave it `running`
   *  indefinitely (preserves the at-most-once invariant). */
  private async reapCrashedFires(): Promise<void> {
    const db = getDb();
    const now = this.opts.now();
    const live = await db.select({
      fireId: extensionScheduleFires.id,
      scheduleId: extensionScheduleFires.scheduleId,
      firedAt: extensionScheduleFires.firedAt,
    })
      .from(extensionScheduleFires)
      .where(eq(extensionScheduleFires.status, "running"));

    for (const f of live) {
      const sched = await db.select().from(extensionSchedules)
        .where(eq(extensionSchedules.id, f.scheduleId));
      if (sched.length === 0) continue;
      const row = sched[0]!;
      const grant = await this.readGrant(row.extensionId);
      const ageMs = now.getTime() - f.firedAt.getTime();
      if (ageMs < grant.maxRunDurationMs * 2) continue; // Still might be live.

      if (grant.maxRetries > 0) {
        await db.update(extensionScheduleFires)
          .set({ status: "error", error: "reaped: crash mid-fire" })
          .where(eq(extensionScheduleFires.id, f.fireId));
        // Reset next_fire_at so the wake loop picks it back up.
        await db.update(extensionSchedules)
          .set({ nextFireAt: now, lastFireStatus: "error" })
          .where(eq(extensionSchedules.id, row.id));
        await insertAuditEntry(
          null,
          EXT_AUDIT_ACTIONS.SDK_SCHEDULE_REAPED,
          row.extensionId,
          {
            capability: "schedule",
            oldValue: { fireId: f.fireId, status: "running" },
            newValue: { status: "error", action: "retry-scheduled" },
            actor: "system",
            reason: `Reaped crashed fire (age=${ageMs}ms, maxRetries=${grant.maxRetries})`,
          },
        ).catch(() => {});
      } else {
        // At-most-once: leave status=running indefinitely. Audit the
        // observation so an admin can investigate.
        await insertAuditEntry(
          null,
          EXT_AUDIT_ACTIONS.SDK_SCHEDULE_REAPED,
          row.extensionId,
          {
            capability: "schedule",
            oldValue: { fireId: f.fireId, status: "running" },
            newValue: { status: "running", action: "left-as-is" },
            actor: "system",
            reason: `Detected stale running fire (age=${ageMs}ms, maxRetries=0 → at-most-once)`,
          },
        ).catch(() => {});
      }
    }
  }

  /** Apply missed-run policies on schedules whose `next_fire_at` is in
   *  the past — the daemon just came up after offline. */
  private async applyMissedRunPolicies(): Promise<void> {
    // Catch-up fires are an autonomous fire path too. While the kill switch
    // is engaged, leave the rows due: the first tick after disengage claims
    // them normally.
    if (await loopsKillSwitchEngaged()) return;
    const db = getDb();
    const now = this.opts.now();
    const overdue = await db.select().from(extensionSchedules).where(and(
      eq(extensionSchedules.enabled, true),
      lte(extensionSchedules.nextFireAt, now),
      ofEnabledExtension(),
    ));
    for (const row of overdue) {
      const grant = await this.readGrant(row.extensionId);
      // A dynamic row's own zone; a manifest row's grant zone (unchanged).
      const tz = zoneFor(row, grant);
      try {
        // Compare-and-swap claim, as in `tick()`: advance next_fire_at only
        // if it still holds the value read above. Of N instances starting
        // together on one shared database, exactly one wins the row; the
        // losers skip it, so a catch-up never fires twice.
        const next = parseCron(row.cron, tz).next(now);
        const claimedRows = await db.update(extensionSchedules)
          .set({
            nextFireAt: next,
            updatedAt: now,
            ...(grant.missedRunPolicy === "skip" ? { lastFireStatus: "ok" } : {}),
          })
          .where(and(
            eq(extensionSchedules.id, row.id),
            eq(extensionSchedules.nextFireAt, row.nextFireAt),
          ))
          .returning({ id: extensionSchedules.id });
        if (claimedRows.length === 0) continue;

        // "skip" is complete: the claim bumped next_fire_at to the next slot.
        if (grant.missedRunPolicy === "fire-all") {
          // Enumerate every missed slot from next_fire_at (the first slot
          // that never fired), capped at maxRunsPerDay (data-loss
          // invariant — see spec § Open questions). Each fire is
          // dispatched with `catchUp: true`. Cap retrieval reduces the
          // count by today's fires already recorded.
          const dailyUsed = await this.todaysFireCount(row.extensionId);
          let cursor = row.nextFireAt;
          let firedAny = false;
          let usedToday = dailyUsed;
          while (cursor.getTime() <= now.getTime() && usedToday < grant.maxRunsPerDay) {
            const jitterMs = Math.floor(this.opts.random() * this.opts.catchUpJitterMs);
            const fa = new Date(now.getTime() + jitterMs);
            const [fire] = await db.insert(extensionScheduleFires).values({
              scheduleId: row.id,
              scheduledAt: cursor,
              firedAt: fa,
              status: "running",
              catchUp: true,
            }).returning();
            this.inFlightHost++;
            this.inFlight.set(row.extensionId, (this.inFlight.get(row.extensionId) ?? 0) + 1);
            await this.dispatchFire(row, fire!.id, fa, true, 0, grant.maxRunDurationMs);
            firedAny = true;
            usedToday++;
            cursor = parseCron(row.cron, tz).next(cursor);
          }
          // next_fire_at already moved past all enumerated slots (claim).
          if (firedAny) {
            await db.update(extensionSchedules)
              .set({ lastFireAt: now })
              .where(eq(extensionSchedules.id, row.id));
          }
        } else if (grant.missedRunPolicy !== "skip") {
          // "fire-once" (default) — fire ONE catch-up.
          const jitterMs = Math.floor(this.opts.random() * this.opts.catchUpJitterMs);
          const fa = new Date(now.getTime() + jitterMs);
          const [fire] = await db.insert(extensionScheduleFires).values({
            scheduleId: row.id,
            scheduledAt: row.nextFireAt,
            firedAt: fa,
            status: "running",
            catchUp: true,
          }).returning();
          this.inFlightHost++;
          this.inFlight.set(row.extensionId, (this.inFlight.get(row.extensionId) ?? 0) + 1);
          await this.dispatchFire(row, fire!.id, fa, true, 0, grant.maxRunDurationMs);
          await db.update(extensionSchedules)
            .set({ lastFireAt: fa, lastFireId: fire!.id })
            .where(eq(extensionSchedules.id, row.id));
        }
      } catch (err) {
        log.warn("missed-run-policy-failed", { scheduleId: row.id, error: String(err) });
      }
    }
  }
}

// ── PID lockfile helpers ──────────────────────────────────────────
//
// Shared, PID-reuse-safe primitive — see src/startup/process-lockfile.ts
// for the boot-token / self-PID reclaim semantics that fix the
// cross-restart self-deadlock (a persisted `.pid` whose PID got reused on
// the next boot no longer wedges start).

/** Test-only export: lets tests inspect/own the lockfile helpers. */
export const _scheduleDaemonInternals = {
  acquireLockfile,
  releaseLockfile,
  isProcessAlive,
};
