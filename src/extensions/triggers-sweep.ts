/**
 * Dynamic-trigger lifecycle sweeps (C2).
 *
 * The failure mode this file exists to prevent is an ORPHANED TRIGGER THAT
 * STILL FIRES — a cron row whose job the user deleted, waking a subprocess
 * every Monday forever to run nothing, or worse to run a stale definition.
 *
 * Unregistering is the extension's job (`ctx.triggers.unregister`), but a
 * design that depends on the extension behaving is not a design. So the
 * host runs its own reconciliation on extension start: it tells the
 * extension which keys it holds and asks which are still live.
 *
 * ── The fail-open rule (load-bearing) ─────────────────────────────────
 *
 * If the extension cannot answer — no `ezcorp/triggers-sync` handler
 * (`-32601`), a transport failure, a malformed reply — the sweep disables
 * NOTHING and says so.
 *
 * Reading "no handler" as "the extension claims zero live keys" would wipe
 * every user's triggers on any SDK or extension version skew: ship an
 * extension built against an older SDK, restart, and every job silently
 * stops firing. That is the same silent-kill class as the reconciler hazard
 * this phase already had to fix, just triggered by an upgrade instead of a
 * reconcile. An orphan that keeps firing is a bounded, visible waste; a
 * mass disable is unbounded and invisible.
 *
 * Sweeps are OWNERLESS (no user initiated them), so they audit to
 * `audit_log`, whose `user_id` is nullable — `sdk_capability_calls` has a
 * NOT NULL `on_behalf_of` and structurally cannot record them.
 *
 * ── Who calls this ───────────────────────────────────────────────────
 *
 * {@link sweepAllDynamicTriggers}, from `HostMaintenanceDaemon`'s hourly
 * tick — the daemon that exists for "host-scoped maintenance sweeps that
 * don't fit the per-extension `ScheduleDaemon` model", which this is.
 *
 * NOT "on extension start", which is how the C2 spec phrased it, and the
 * difference is forced by how extensions actually start. The one extension
 * that holds dynamic triggers today (`ez-factory`) has no `bootSpawn`
 * flag — its subprocess is spawned lazily by a page render, a tool call or
 * a fire — so a boot-time hook would have nothing running to ask. A
 * periodic sweep asks whatever is up at the time and fails open for the
 * rest, which is the same answer a start hook would give, minus the
 * pretence that boot is when it happens.
 */
import { insertAuditEntry } from "../db/queries/audit-log";
import { EXT_AUDIT_ACTIONS } from "./audit-actions";
import {
  listDynamicCrons, listDynamicWebhooks,
  disableDynamicCrons, disableDynamicWebhooks,
} from "./triggers-store";
import { registerFireCallProvenance } from "./call-provenance";
import { extensionLogger } from "../logger";

const log = extensionLogger("triggers", "sweep");

/** Minimal view of a live subprocess — just the host→extension request. */
export interface SyncTarget {
  call(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<{ result?: unknown; error?: { code: number; message: string } }>;
}

export interface SweepResult {
  /** How many rows were soft-disabled. */
  disabled: number;
  /** True when the sweep declined to act (see the fail-open rule). */
  skipped: boolean;
  /** Why it declined, for the operator. */
  reason?: string;
}

/** Parse the extension's reply into a claimed-key set, or `null` when the
 *  reply is not something we can safely act on. `null` means fail open. */
export function parseClaimedKeys(result: unknown): Set<string> | null {
  if (!result || typeof result !== "object") return null;
  const keys = (result as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) return null;
  if (!keys.every((k) => typeof k === "string")) return null;
  return new Set(keys as string[]);
}

/**
 * Reconcile the host's dynamic rows against the keys the extension still
 * claims. Soft-disables the difference; rows and history are preserved.
 */
export async function syncDynamicTriggers(
  extensionId: string,
  extensionName: string,
  proc: SyncTarget | null | undefined,
  now: Date = new Date(),
): Promise<SweepResult> {
  const crons = await listDynamicCrons(extensionId);
  const hooks = await listDynamicWebhooks(extensionName);
  const cronKeys = crons.filter((r) => r.enabled).map((r) => r.key as string);
  const hookKeys = hooks.filter((r) => r.enabled).map((r) => r.key as string);
  if (cronKeys.length === 0 && hookKeys.length === 0) {
    return { disabled: 0, skipped: false };
  }

  if (!proc) {
    return { disabled: 0, skipped: true, reason: "subprocess-not-running" };
  }

  // ── The frame carries a provenance token, and that is load-bearing ──
  //
  // An extension answers this by reading its OWN state, and every
  // host-mediated read it can make (`ezcorp/storage`, `ctx.triggers.list`)
  // resolves identity from the host-issued `_meta.ezCallId` the SDK echoes
  // back — the channel binds it for ANY inbound frame, request or
  // notification (`packages/@ezcorp/sdk/src/runtime/channel.ts`). With no
  // token the SDK sends none, `resolveStorageProvenance` fail-fasts
  // `-32602`, the extension's handler throws, and the response comes back
  // an error — so the sweep would fail OPEN on every single run. Wired,
  // and permanently inert. `ez-factory` says exactly this about its own
  // boot ordering (`extensions/ez-factory/index.ts`): its store is
  // unreachable outside an inbound frame that carries a token.
  //
  // OWNERLESS, like a cron fire: nobody asked for this sweep. That
  // resolves the install-wide `global` storage bucket and nothing else
  // (`storage-handler.ts` — `global` is deliberately owner-free), which is
  // precisely where a job console keeps jobs. `kind: "schedule"` because
  // the rows being reconciled ARE the schedule/webhook rows, and it buys
  // the same 10-minute registry backstop the daemon's own fires take.
  //
  // Not released here: the 2-minute auto-release IS the release path for
  // every fire-shaped token (`registerFireCallProvenance`), and it
  // comfortably outlives one request/reply.
  const ezCallId = registerFireCallProvenance({
    onBehalfOf: null,
    conversationId: null,
    runId: null,
    parentCallId: null,
    actorExtensionId: extensionId,
    kind: "schedule",
    ownerless: true,
  });

  let response: { result?: unknown; error?: { code: number; message: string } };
  try {
    response = await proc.call("ezcorp/triggers-sync", {
      v: 1,
      keys: [...cronKeys, ...hookKeys],
      _meta: { ezCallId },
    });
  } catch (err) {
    // Transport failure / timeout. Fail open.
    return { disabled: 0, skipped: true, reason: `call-failed: ${String(err)}` };
  }

  if (response.error) {
    // `-32601 Method not found` is the common case: the extension predates
    // `ctx.triggers` or has wired no handlers yet. NOT evidence that its
    // jobs are dead.
    return {
      disabled: 0,
      skipped: true,
      reason: `no-sync-handler: ${response.error.code}`,
    };
  }

  const claimed = parseClaimedKeys(response.result);
  if (claimed === null) {
    return { disabled: 0, skipped: true, reason: "malformed-reply" };
  }

  const orphanedCrons = cronKeys.filter((k) => !claimed.has(k));
  const orphanedHooks = hookKeys.filter((k) => !claimed.has(k));
  if (orphanedCrons.length === 0 && orphanedHooks.length === 0) {
    return { disabled: 0, skipped: false };
  }

  const disabled =
    (await disableDynamicCrons(extensionId, orphanedCrons, now)) +
    (await disableDynamicWebhooks(extensionName, orphanedHooks, now));

  // One audit row per key — an operator needs to know WHICH job stopped,
  // not just that some number of them did.
  for (const key of orphanedCrons) {
    await auditOrphan(extensionId, "cron", key);
  }
  for (const key of orphanedHooks) {
    await auditOrphan(extensionId, "webhook", key);
  }

  log.info("orphaned dynamic triggers disabled", {
    extensionId, disabled, cron: orphanedCrons.length, webhook: orphanedHooks.length,
  });
  return { disabled, skipped: false };
}

/**
 * The registry surface the host-wide sweep needs, and nothing else.
 *
 * Structural rather than `Pick<ExtensionRegistry, …>` for the same reason
 * {@link SyncTarget} is: this module must stay free of the registry's
 * import graph (subprocess spawn, sandbox, checksums), and a test has to
 * be able to hand it two objects and a map.
 */
export interface SweepRegistry {
  /** `[extensionId, manifest]` for every registered extension. */
  getAllManifests(): IterableIterator<[string, { name: string }]>;
  /** The live subprocess, or `null`. NEVER spawns one — a sweep that woke
   *  every extension hourly would be a worse bug than the orphan. */
  getProcessIfRunning(extensionId: string): SyncTarget | null;
}

/** What one host-wide pass did. */
export interface SweepAllResult {
  /** Extensions the sweep looked at. */
  scanned: number;
  /** Rows soft-disabled across all of them. */
  disabled: number;
  /** Extensions that declined to act — the fail-open branch, per extension. */
  skipped: number;
  /** Extensions whose sweep THREW. Fail-open too, but a bug rather than a
   *  policy: an orphan sweep is housekeeping and must never take the
   *  host's maintenance daemon down. */
  errored: number;
}

/**
 * Reconcile EVERY registered extension's dynamic rows against what its
 * subprocess still claims.
 *
 * The loop is deliberately unfiltered — no "does this manifest declare
 * `triggers`?" pre-check. The rows are the filter, and they are the honest
 * one: {@link syncDynamicTriggers} returns without asking anything when an
 * extension holds none, so an extension that never used the capability
 * costs two indexed SELECTs an hour, and one whose manifest DROPPED the
 * capability while rows survive is still reconciled instead of being
 * skipped by a declaration that no longer matches reality. (Total removal
 * of the capability is {@link revokeDynamicTriggers}'s job, on the
 * publish path (`publishExtensionGeneration`); this is not a second copy of
 * that policy.)
 *
 * Never throws FOR A PER-EXTENSION FAILURE — those are counted in
 * `errored` and the pass continues, because one extension's DB error must
 * not stop the next extension's orphan from being retired, and the
 * iteration order is the registry's insertion order, which nobody chose.
 * A registry whose ITERATOR throws is outside that guarantee and is the
 * caller's to absorb (the daemon's `try` does).
 */
export async function sweepAllDynamicTriggers(
  registry: SweepRegistry,
  now: Date = new Date(),
): Promise<SweepAllResult> {
  const result: SweepAllResult = { scanned: 0, disabled: 0, skipped: 0, errored: 0 };
  for (const [extensionId, manifest] of registry.getAllManifests()) {
    result.scanned++;
    try {
      const outcome = await syncDynamicTriggers(
        extensionId,
        manifest.name,
        registry.getProcessIfRunning(extensionId),
        now,
      );
      result.disabled += outcome.disabled;
      if (outcome.skipped) result.skipped++;
    } catch (err) {
      result.errored++;
      log.warn("dynamic-trigger sweep failed for one extension — continuing", {
        extensionId, error: String(err),
      });
    }
  }
  if (result.disabled > 0) {
    log.info("host-wide dynamic-trigger sweep retired orphans", { ...result });
  }
  return result;
}

/**
 * The `permissions.triggers` capability itself disappeared from the
 * manifest (§2.2 case 3). Soft-disable EVERY dynamic row.
 *
 * This is the one case where disabling a user-created trigger is correct —
 * the capability that authorized it is gone. It is an EXPLICIT sweep, never
 * a side effect of ordinary reconciliation: the reconcilers' `dynamic =
 * false` filter means they can no longer touch these rows at all, which is
 * exactly what makes an intentional revocation distinguishable from a
 * routine manifest edit.
 *
 * Narrowing a cap is NOT this. Lowering `maxCron` below the current row
 * count leaves existing rows running and refuses only NEW registrations —
 * never silently disable rows a user created under a larger cap.
 */
export async function revokeDynamicTriggers(
  extensionId: string,
  extensionName: string,
  now: Date = new Date(),
): Promise<{ disabled: number }> {
  const cronKeys = (await listDynamicCrons(extensionId))
    .filter((r) => r.enabled).map((r) => r.key as string);
  const hookKeys = (await listDynamicWebhooks(extensionName))
    .filter((r) => r.enabled).map((r) => r.key as string);
  if (cronKeys.length === 0 && hookKeys.length === 0) return { disabled: 0 };

  const disabled =
    (await disableDynamicCrons(extensionId, cronKeys, now)) +
    (await disableDynamicWebhooks(extensionName, hookKeys, now));

  for (const key of [...cronKeys, ...hookKeys]) {
    await insertAuditEntry(
      null,
      EXT_AUDIT_ACTIONS.SDK_TRIGGER_CAPABILITY_REVOKED,
      extensionId,
      {
        capability: "triggers",
        oldValue: { enabled: true },
        newValue: { enabled: false, key },
        actor: "system",
        reason: "permissions.triggers removed from the manifest",
      },
    );
  }
  log.info("dynamic triggers revoked with the capability", { extensionId, disabled });
  return { disabled };
}

async function auditOrphan(
  extensionId: string,
  kind: "cron" | "webhook",
  key: string,
): Promise<void> {
  await insertAuditEntry(
    null,
    EXT_AUDIT_ACTIONS.SDK_TRIGGER_ORPHANED,
    extensionId,
    {
      capability: "triggers",
      oldValue: { enabled: true },
      newValue: { enabled: false, kind, key },
      actor: "system",
      reason: "extension no longer claims this trigger key",
    },
  );
}
