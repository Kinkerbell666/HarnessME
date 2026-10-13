/**
 * Webhook registry + delivery-queue query helpers (Loops EZ Mode Phase 4).
 *
 * The route (accept path) and the delivery daemon (drain path) share these DB
 * primitives so the claim-before-dispatch contract is expressed once. All
 * timestamps are host-issued; the caller owns clock injection.
 */
import { getDb } from "../db/connection";
import { extensions, extensionWebhooks, webhookDeliveries, type ExtensionWebhook } from "../db/schema";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { nowMinusInterval } from "../db/queries/sql-interval";

/**
 * The ENABLED webhook registry row for `(extensionId, slug)`, or `null` when
 * absent, soft-disabled, or its extension is disabled (disable leaves a
 * user-created row enabled so re-enable restores it). A `null` result is the route's enumeration-safe
 * "unknown hook" — same shape whether the extension, the slug, or the grant is
 * missing (all three converge on no enabled row).
 */
export async function getEnabledWebhook(
  extensionId: string,
  slug: string,
): Promise<ExtensionWebhook | null> {
  const rows = await getDb().select().from(extensionWebhooks).where(and(
    eq(extensionWebhooks.extensionId, extensionId),
    eq(extensionWebhooks.slug, slug),
    eq(extensionWebhooks.enabled, true),
    inArray(
      extensionWebhooks.extensionId,
      getDb().select({ name: extensions.name }).from(extensions).where(eq(extensions.enabled, true)),
    ),
  ));
  return rows[0] ?? null;
}

export interface InsertDeliveryInput {
  webhookId: string;
  extensionId: string;
  slug: string;
  contentType: string | null;
  /** Size-capped raw request body (UTF-8). */
  body: string;
  receivedAt: Date;
  /** Drained-from-backlog marker (mirrors cron catch-up). Default false. */
  catchUp?: boolean;
}

/**
 * Persist an accepted delivery in `status: pending` (the durable queue). Returns
 * the new delivery id — the stable idempotency handle that becomes the loop
 * fire id. The row is written BEFORE any dispatch so a crash between accept and
 * dispatch is recoverable by the daemon's catch-up drain.
 */
export async function insertDelivery(
  input: InsertDeliveryInput,
): Promise<string> {
  const [row] = await getDb().insert(webhookDeliveries).values({
    webhookId: input.webhookId,
    extensionId: input.extensionId,
    slug: input.slug,
    status: "pending",
    contentType: input.contentType,
    body: input.body,
    receivedAt: input.receivedAt,
    catchUp: input.catchUp ?? false,
  }).returning();
  return row!.id;
}

/**
 * Count this HOOK's deliveries recorded at/after `since` (a UTC start-of-day
 * for the daily fire budget). Filtered by `(extensionId, slug)` so two hooks on
 * one extension have INDEPENDENT budgets — a flood on hook A cannot starve hook
 * B (the spec's per-hook budget). Counts ALL persisted deliveries (a row = an
 * accepted fire that consumes budget), so a leaked token cannot burn unbounded
 * spend even while the subprocess is down. Uses `COUNT(*)` (never loads rows) so
 * a hook near its cap doesn't pull a day's worth of bodies into memory per
 * request.
 */
export async function countDeliveriesSince(
  extensionId: string,
  slug: string,
  since: Date,
): Promise<number> {
  const rows = await getDb().select({ count: sql<number>`COUNT(*)`.as("count") })
    .from(webhookDeliveries)
    .where(and(
      eq(webhookDeliveries.extensionId, extensionId),
      eq(webhookDeliveries.slug, slug),
      gte(webhookDeliveries.receivedAt, since),
    ));
  // PGlite/Postgres return COUNT as a string/bigint — coerce to a JS number.
  return Number(rows[0]?.count ?? 0);
}

/** UTC start-of-day for `at` — the daily-budget window boundary. */
export function startOfUtcDay(at: Date): Date {
  const d = new Date(at);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Retention sweep: delete TERMINAL deliveries (`ok` / dead-lettered `error`)
 * received more than `retentionDays` ago. `pending` / `running` rows are NEVER
 * swept (a live delivery must survive). Mirrors `cleanupOldErrors` — the daemon
 * runs it on start so the durable queue doesn't grow without bound. Returns the
 * number of rows deleted.
 */
export async function cleanupOldWebhookDeliveries(retentionDays = 30): Promise<number> {
  const rows = await getDb().delete(webhookDeliveries)
    .where(and(
      inArray(webhookDeliveries.status, ["ok", "error"]),
      lt(webhookDeliveries.receivedAt, nowMinusInterval(retentionDays, "days")),
    ))
    .returning({ id: webhookDeliveries.id });
  return rows.length;
}
