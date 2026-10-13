import { eq, inArray, not, like, sql, and, isNull } from "drizzle-orm";
import { getDb, type DbTransaction } from "../connection";
import { revokeAllUserSessions } from "./sessions";
import { users } from "../schema";
import type { User, NewUser } from "../schema";

export type { User, NewUser };

export async function createUser(data: NewUser): Promise<User> {
  const rows = await getDb().insert(users).values(data).returning();
  return rows[0]!;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const rows = await getDb().select().from(users).where(eq(users.email, email.toLowerCase()));
  return rows[0];
}

export async function getUserById(id: string): Promise<User | undefined> {
  const rows = await getDb().select().from(users).where(eq(users.id, id));
  return rows[0];
}

/**
 * Batched variant of {@link getUserById}. Returns a Map keyed by user
 * id. Missing users map to `null` so callers can branch identically to
 * the per-call form (which returns `undefined`). Internally dedupes
 * `ids` to keep the SQL `IN (...)` list tight; the returned Map is
 * always keyed by every input id, even duplicates.
 */
// fallow-ignore-next-line unused-export
export async function getUsersByIds(
  ids: string[],
): Promise<Map<string, User | null>> {
  const result = new Map<string, User | null>();
  if (ids.length === 0) return result;
  const uniqueIds = Array.from(new Set(ids));
  const rows = await getDb()
    .select()
    .from(users)
    .where(inArray(users.id, uniqueIds));
  const byId = new Map<string, User>();
  for (const row of rows) byId.set(row.id, row);
  for (const id of ids) {
    result.set(id, byId.get(id) ?? null);
  }
  return result;
}

export async function listUsers(): Promise<User[]> {
  return getDb().select().from(users);
}

export interface ListUsersPageOpts {
  limit: number;
  offset?: number;
  /** Case-insensitive name/email substring filter. */
  q?: string;
}

export interface ListUsersPageResult {
  users: User[];
  /** Total rows matching `q` (before limit/offset) — drives the pager. */
  total: number;
}

/**
 * Server-side paginated user listing (Settings v2). Returns one page of
 * users plus the total count for the (optionally `q`-filtered) set.
 *
 * `q` filters on name OR email, case-insensitively. `limit`/`offset` are
 * assumed pre-validated by the caller (the route clamps them); this
 * query trusts them. Ordered by name for a stable page sequence.
 */
/**
 * Escape LIKE metacharacters in user-supplied filter text so they match
 * literally. `%` (any run) and `_` (any single char) are SQL LIKE
 * wildcards; without escaping, a query like `a_b` would also match
 * `axb`. We escape the backslash first (it's our ESCAPE char) so a
 * literal `\` in the input can't smuggle past the other two.
 */
function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listUsersPage(opts: ListUsersPageOpts): Promise<ListUsersPageResult> {
  const db = getDb();
  const pattern = opts.q ? `%${escapeLikePattern(opts.q.toLowerCase())}%` : undefined;
  const where = pattern
    ? sql`(lower(${users.name}) LIKE ${pattern} ESCAPE '\\' OR lower(${users.email}) LIKE ${pattern} ESCAPE '\\')`
    : undefined;

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(where);
  const total = Number(countRows[0]?.count ?? 0);

  const page = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(users.name)
    .limit(opts.limit)
    .offset(opts.offset ?? 0);

  return { users: page, total };
}

export async function updateUserStatus(id: string, status: "active" | "inactive"): Promise<boolean> {
  const rows = await getDb().update(users).set({ status }).where(eq(users.id, id)).returning();
  return rows.length > 0;
}

export async function getUserCount(): Promise<number> {
  // Excludes synthetic system users (id `sys-*`) — extensions like ai-kit
  // seed those on boot for OBO/internal-auth. Real users get UUIDs, which
  // never start with "sys", so this prefix is a safe distinguisher. The
  // first-run gate (hooks.server.ts, /setup, /login, POST /api/auth/setup)
  // calls this to mean "has a human admin been registered?", not "is any
  // row present?" — without this filter, a freshly booted instance with
  // ai-kit installed appears already-set-up and routes to /login forever.
  //
  // A `count(*)` aggregate — NOT a full-row fetch. This runs on a
  // request-level hot path (every unauthenticated request hits the
  // first-run gate), so materializing every `users` row (password hashes
  // included) into app memory just to read `.length` is wasteful; the
  // aggregate lets Postgres answer without shipping any row bodies. Mirrors
  // the `count(*)::int` shape used by `listUsersPage` above.
  const rows = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(not(like(users.id, "sys-%")));
  return Number(rows[0]?.count ?? 0);
}

/**
 * Set a new password and revoke the user's sessions in one transaction, so a
 * stolen session cannot outlive the password it was opened with. A
 * self-service change passes `keepSessionId` to stay signed in on the tab
 * that made the change; a reset revokes every session.
 */
export async function updateUserPassword(
  id: string,
  passwordHash: string,
  opts: { keepSessionId?: string } = {},
): Promise<boolean> {
  return getDb().transaction(async (tx: DbTransaction) => {
    const rows = await tx.update(users).set({ passwordHash }).where(eq(users.id, id)).returning();
    if (rows.length === 0) return false;
    await revokeAllUserSessions(id, { keepSessionId: opts.keepSessionId, tx });
    return true;
  });
}

export async function updateUserEmail(id: string, email: string): Promise<boolean> {
  const rows = await getDb().update(users).set({ email: email.toLowerCase() }).where(eq(users.id, id)).returning();
  return rows.length > 0;
}

export async function updateUserName(id: string, name: string): Promise<boolean> {
  const rows = await getDb().update(users).set({ name }).where(eq(users.id, id)).returning();
  return rows.length > 0;
}

/**
 * First-write-wins. Returns true if this call set the timestamp;
 * false if the user was already onboarded (or doesn't exist). The
 * `WHERE onboarded_at IS NULL` clause keeps a re-POST race (e.g. two
 * tabs both finishing the wizard) from advancing the original stamp.
 */
export async function markUserOnboarded(id: string): Promise<boolean> {
  const rows = await getDb()
    .update(users)
    .set({ onboardedAt: sql`NOW()` })
    .where(and(eq(users.id, id), isNull(users.onboardedAt)))
    .returning();
  return rows.length > 0;
}
