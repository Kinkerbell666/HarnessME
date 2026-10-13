import { eq, and, sql, lt, like } from "drizzle-orm";
import { getDb } from "../connection";
import { extensionStorage } from "../schema";

type Scope = "global" | "conversation" | "user";
export type StorageDatabase = Pick<ReturnType<typeof getDb>, "select" | "insert" | "delete" | "execute">;

// ── Read ─────────────────────────────────────────────────────────────

/** Rows past their TTL are invisible to every read, before the sweep deletes them. */
function notExpired() {
  return sql`(${extensionStorage.expiresAt} IS NULL OR ${extensionStorage.expiresAt} >= NOW())`;
}

export async function getStorageValue(
  extensionId: string,
  scope: Scope,
  scopeId: string | null,
  key: string,
  database?: StorageDatabase,
): Promise<{ value: unknown; encrypted: boolean; sizeBytes: number } | null> {
  const db = database ?? getDb();
  const rows = await db
    .select()
    .from(extensionStorage)
    .where(
      and(
        eq(extensionStorage.extensionId, extensionId),
        eq(extensionStorage.scope, scope),
        scopeId === null
          ? sql`${extensionStorage.scopeId} IS NULL`
          : eq(extensionStorage.scopeId, scopeId),
        eq(extensionStorage.key, key),
      ),
    );

  const row = rows[0];
  if (!row) return null;

  // Lazy TTL expiry
  if (row.expiresAt && row.expiresAt < new Date()) {
    await db.delete(extensionStorage).where(eq(extensionStorage.id, row.id));
    return null;
  }

  return { value: row.value, encrypted: row.encrypted, sizeBytes: row.sizeBytes };
}

// ── Write (upsert) ──────────────────────────────────────────────────

export async function setStorageValue(
  extensionId: string,
  scope: Scope,
  scopeId: string | null,
  key: string,
  value: unknown,
  encrypted: boolean,
  sizeBytes: number,
  expiresAt?: Date,
  database?: StorageDatabase,
): Promise<void> {
  const db = database ?? getDb();
  const now = new Date();

  await db
    .insert(extensionStorage)
    .values({
      extensionId,
      scope,
      scopeId,
      key,
      value,
      encrypted,
      sizeBytes,
      expiresAt: expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [extensionStorage.extensionId, extensionStorage.scope, extensionStorage.scopeId, extensionStorage.key],
      set: { value, encrypted, sizeBytes, expiresAt: expiresAt ?? null, updatedAt: now },
    });
}

// ── Delete ──────────────────────────────────────────────────────────

export async function deleteStorageValue(
  extensionId: string,
  scope: Scope,
  scopeId: string | null,
  key: string,
  database?: StorageDatabase,
): Promise<boolean> {
  const db = database ?? getDb();
  const result = await db
    .delete(extensionStorage)
    .where(
      and(
        eq(extensionStorage.extensionId, extensionId),
        eq(extensionStorage.scope, scope),
        scopeId === null
          ? sql`${extensionStorage.scopeId} IS NULL`
          : eq(extensionStorage.scopeId, scopeId),
        eq(extensionStorage.key, key),
      ),
    )
    .returning({ id: extensionStorage.id });
  return result.length > 0;
}

// ── List keys ───────────────────────────────────────────────────────

export async function listStorageKeys(
  extensionId: string,
  scope: Scope,
  scopeId: string | null,
  prefix?: string,
  limit = 100,
  database?: StorageDatabase,
): Promise<Array<{ key: string; sizeBytes: number; encrypted: boolean; expiresAt: Date | null }>> {
  const db = database ?? getDb();

  const conditions = [
    eq(extensionStorage.extensionId, extensionId),
    eq(extensionStorage.scope, scope),
    scopeId === null
      ? sql`${extensionStorage.scopeId} IS NULL`
      : eq(extensionStorage.scopeId, scopeId),
    notExpired(),
  ];

  if (prefix) {
    // Escape the LIKE escape char and both wildcards so the prefix matches literally
    const escaped = prefix.replace(/[\\%_]/g, "\\$&");
    conditions.push(like(extensionStorage.key, `${escaped}%`));
  }

  const rows = await db
    .select({
      key: extensionStorage.key,
      sizeBytes: extensionStorage.sizeBytes,
      encrypted: extensionStorage.encrypted,
      expiresAt: extensionStorage.expiresAt,
    })
    .from(extensionStorage)
    .where(and(...conditions))
    .limit(Math.min(limit, 1000));

  return rows;
}

// ── List rows for a key across every scope id ───────────────────────

/**
 * Return every non-expired storage row for a given (extensionId, scope, key)
 * across ALL scope ids, as `{ scopeId, value }` pairs. Unlike
 * {@link listStorageKeys} (metadata only) this materializes the stored
 * value, so a host-side reconciliation pass can inspect the JSON without an
 * N+1 per-scope read.
 *
 * Used by the boot reconciliation of interrupted sub-agent assignments
 * (`src/runtime/boot-reconcile-assignments.ts`): it enumerates every
 * conversation's persisted task snapshot for the task-tracking extension in
 * one query. Expired rows are filtered in SQL (task snapshots carry no TTL,
 * so this is a defensive no-op there).
 */
export async function listStorageRowsForKey(
  extensionId: string,
  scope: Scope,
  key: string,
  page?: { limit: number; afterScopeId: string },
): Promise<Array<{ scopeId: string | null; value: unknown }>> {
  const db = getDb();
  const rows = await db
    .select({ scopeId: extensionStorage.scopeId, value: extensionStorage.value })
    .from(extensionStorage)
    .where(
      and(
        eq(extensionStorage.extensionId, extensionId),
        eq(extensionStorage.scope, scope),
        eq(extensionStorage.key, key),
        page ? sql`${extensionStorage.scopeId} > ${page.afterScopeId}` : undefined,
        notExpired(),
      ),
    ).orderBy(extensionStorage.scopeId).limit(page ? Math.max(1, Math.min(500, Math.trunc(page.limit))) : 2147483647);
  return rows.map((r: { scopeId: string | null; value: unknown }) => ({
    scopeId: r.scopeId ?? null,
    value: r.value,
  }));
}

// ── Usage (for quota checks) ────────────────────────────────────────

export async function getStorageUsage(
  extensionId: string,
  database?: StorageDatabase,
): Promise<{ totalBytes: number; keyCount: number }> {
  const db = database ?? getDb();
  const [row] = await db
    .select({
      totalBytes: sql<number>`COALESCE(SUM(${extensionStorage.sizeBytes}), 0)::int`,
      keyCount: sql<number>`COUNT(*)::int`,
    })
    .from(extensionStorage)
    .where(
      and(
        eq(extensionStorage.extensionId, extensionId),
        notExpired(),
      ),
    );

  return { totalBytes: row?.totalBytes ?? 0, keyCount: row?.keyCount ?? 0 };
}

// ── TTL cleanup ─────────────────────────────────────────────────────

export async function deleteExpiredStorage(): Promise<number> {
  const db = getDb();
  const result = await db
    .delete(extensionStorage)
    .where(lt(extensionStorage.expiresAt, new Date()))
    .returning({ id: extensionStorage.id });
  return result.length;
}
