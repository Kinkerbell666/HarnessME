/**
 * Extension permission checking, runtime confirmation, and always-allow persistence.
 */

import type { ExtensionPermissions, ExtensionManifest } from "./types";
import { getSetting, upsertSetting } from "../db/queries/settings";
import { getProjectRoot } from "./bundled";
import { getDbMaskDirs } from "../db/connection";
import { realpath } from "node:fs/promises";
import { join, resolve as pathResolve } from "node:path";

/**
 * Resolve the base directory the `$CWD` grant token expands to: the
 * PROJECT ROOT, not the host process's `process.cwd()`.
 *
 * Why not `process.cwd()`: under the vite-SSR dev server the host
 * process runs with cwd `/app/web`, but bundled extensions resolve
 * their `.ezcorp/extension-data/<name>/` store relative to the project
 * root (`/app`, via `getProjectRoot()` — env → import-meta → git-walk →
 * cwd-fallback). When the WRITER (host events route + daemon) writes
 * under the project root but the subprocess's fs grant `$CWD` resolved
 * to `/app/web`, a host-mediated read of the writer's dir landed
 * OUTSIDE the grant → `denyAndDisable` disabled the extension. Anchoring
 * `$CWD` to the project root makes the grant cover exactly where bundled
 * extensions read/write. In production host cwd IS the project root
 * (`/app`), so `getProjectRoot() === process.cwd()` and this is a no-op
 * — the change only widens the dev-only `/app/web` cwd up to `/app`,
 * which can only PERMIT more, never less.
 *
 * `getProjectRoot` is imported STATICALLY: a lazy `require("./bundled")`
 * silently fails under the vite-SSR module transform (it threw, hit the
 * fallback, and the grant stayed at `/app/web` — the original bug
 * persisted). `bundled.ts`'s static import graph does not reach back to
 * `permissions.ts`, so there is no cycle (the same import `registry.ts`
 * already uses). `getProjectRoot()` caches after first call and never
 * throws, so this stays sync + cheap.
 */
function grantCwdBase(): string {
  return getProjectRoot();
}

/**
 * Expand the `$CWD` placeholder in a granted filesystem prefix. The
 * bundled extension declarations (and the test fixtures at
 * `src/__tests__/bundled-ceiling.test.ts:174`) use the literal `$CWD`
 * token to mean "the project root" — without this expansion,
 * `realpath("$CWD")` throws ENOENT and the prefix is silently skipped,
 * denying every legitimate write under the project root. Supports both
 * `$CWD` and `$CWD/<sub-path>` forms (the latter is used by
 * extension-author's narrower grant). Other strings pass through
 * unchanged. See {@link grantCwdBase} for why `$CWD` resolves to the
 * project root rather than the host process's cwd.
 *
 * Also expands `$USER` (a whole path segment) to `actingUserId` — see
 * {@link expandUserSegment}. Callers that hold the acting user MUST
 * pass it; a grant carrying `$USER` with no user supplied collapses to
 * {@link UNRESOLVED_USER_PREFIX}, which matches nothing.
 */
export function expandGrantPrefix(prefix: string, actingUserId?: string | null): string {
  let out = prefix;
  if (out === "$CWD") out = grantCwdBase();
  else if (out.startsWith("$CWD/")) out = pathResolve(grantCwdBase(), out.slice("$CWD/".length));
  return expandUserSegment(out, actingUserId);
}

/**
 * Sentinel a `$USER` prefix collapses to when there is no acting user.
 *
 * It contains a NUL byte, which no filesystem path may contain, so it
 * can never `===` or prefix-match a resolved path — every gate that
 * compares against it denies. That is deliberate: `$USER` is a
 * user-partitioned grant, and a call with no attributable user has no
 * partition to be inside of. Fail-closed by construction rather than by
 * every call site remembering to check.
 */
export const UNRESOLVED_USER_PREFIX = "/\u0000ezcorp-unresolved-user";

/**
 * Expand the `$USER` placeholder to the id of the user the call is
 * acting on behalf of.
 *
 * This is what lets a grant be narrowed to ONE user's subtree of a
 * shared, per-extension directory. `extension-author` is the motivating
 * case: a single subprocess serves every user, and its drafts live at
 * `.ezcorp/extension-data/extension-author/drafts/<userId>/<draftId>/`.
 * Granting the whole `extension-author` tree meant cross-user isolation
 * rested entirely on the extension VOLUNTARILY routing through the
 * host's owner-scoped `ezcorp/drafts.resolveDir` — a compromised or
 * merely buggy extension that guessed another user's path would have
 * been allowed by the host. With `drafts/$USER` the host denies it,
 * independent of what the extension does.
 *
 * Only a whole path SEGMENT is substituted (`.../drafts/$USER`), never
 * a substring, so a directory legitimately named `$USERdata` is left
 * alone. The id is used verbatim: ids that reach here are DB-generated
 * UUIDs, and a `..`/separator-bearing id would only ever narrow to a
 * path the caller could already reach through its own grant prefix.
 */
function expandUserSegment(prefix: string, actingUserId?: string | null): string {
  if (!prefix.split("/").includes("$USER")) return prefix;
  if (!actingUserId) return UNRESOLVED_USER_PREFIX;
  return prefix
    .split("/")
    .map((seg) => (seg === "$USER" ? actingUserId : seg))
    .join("/");
}

/**
 * Canonicalize a granted filesystem prefix for prefix-matching, WITHOUT
 * requiring the granted directory to physically exist yet.
 *
 *   • exists → `realpath(absPrefix)` (unchanged behavior; preserves the
 *     symlink-escape protection the gate has always had).
 *   • not created yet → realpath the lowest EXISTING ancestor and
 *     re-append the not-yet-existing tail. This is the bootstrap fix:
 *     a bundled extension granted `$CWD/.ezcorp/extension-data/<name>`
 *     on a fresh project (where `.ezcorp/` is gitignored/absent) used
 *     to have its ONLY grant silently voided — `realpath` threw ENOENT,
 *     the prefix was skipped, the first write was denied, and
 *     `denyAndDisable` disabled the extension. A path component that
 *     does not exist cannot contain a symlink, so resolving only the
 *     existing ancestor adds NO new symlink-escape surface vs. the
 *     all-exists `realpath`. The target path is resolved the same way
 *     by the fs-handler (`resolveLowestExistingAncestor`), so prefix
 *     and target are compared on the same canonical footing.
 *   • unresolvable even at `/` → `null` (caller skips this prefix).
 *
 * Returns an absolute, canonical (existing-portion-realpath'd) string.
 * Does NOT widen scope — the returned string is still rooted at the
 * exact granted subtree; a sibling outside it still fails the
 * caller's `startsWith(prefix + "/")` compare.
 */
export async function resolveGrantPrefixCanonical(
  absPrefix: string,
): Promise<string | null> {
  try {
    return await realpath(absPrefix);
  } catch {
    /* not created yet — resolve lowest existing ancestor + tail below */
  }
  const tail: string[] = [];
  let cur = absPrefix;
  for (let i = 0; i < 4096; i++) {
    try {
      const resolved = await realpath(cur);
      return tail.length === 0 ? resolved : join(resolved, tail.reverse().join("/"));
    } catch {
      const idx = cur.lastIndexOf("/");
      if (idx === -1) break;
      const base = cur.slice(idx + 1);
      const parent = idx === 0 ? "/" : cur.slice(0, idx);
      if (base) tail.push(base);
      cur = parent;
      if (cur === "/" || cur === "") break;
    }
  }
  try {
    const root = await realpath("/");
    return tail.length === 0 ? root : join(root, tail.reverse().join("/"));
  } catch {
    return null;
  }
}

// ── Reserved sensitive-path hard-deny (defense-in-depth) ───────────
//
// Grant-INDEPENDENT deny for the EZCorp database + secret directory.
// Even an extension with a covering filesystem grant (`$CWD` widened to
// the project root, or an explicit `/app` / `.ezcorp/data` grant) must
// NOT be able to host-mediated read/write the platform's own DB — which
// also holds the JWT/encryption secret in the `settings` table — or its
// pre-boot snapshots. Landlock is the in-kernel jail, but it is OFF in
// these containers (`EZCORP_PROJECT_ROOT` unset), so the GRANT is the
// only gate; this closes that gap with a software hard-deny in the host
// fs path. Wired BEFORE any allow in both host fs gates (read +
// write), so a reserved path is denied regardless of what the grant —
// or the implicit install-dir allow — would otherwise permit.
//
// Scope is deliberately NARROW: only `.ezcorp/data` (+ the resolved
// `EZCORP_DB_PATH` and its sibling `backups` dir) are reserved. The
// extension store at `.ezcorp/extension-data/<name>/` — where
// file-organizer / task-stack / auto-note legitimately read+write —
// stays fully allowed. Matching is SEGMENT-BOUNDED (`p === reserved ||
// p.startsWith(reserved + "/")`) so a sibling like `.ezcorp/data-export`
// is NOT swept up by `.ezcorp/data`.

/**
 * Resolve the set of reserved sensitive directories, canonicalized to
 * realpaths (tolerating non-existent dirs — the lowest existing
 * ancestor is resolved, so a symlinked reserved dir is still caught).
 * Computed fresh per check (cheap; `getProjectRoot()` caches and the
 * DB-mask dirs are derived from env): the comparison set must track the
 * same canonical footing the resolved target path is compared on.
 *
 * Sources:
 *   • `<getProjectRoot()>/.ezcorp/data` — the per-project DB + secret
 *     dir (and its `backups/` sibling) for the dev/host-process layout.
 *   • `getDbMaskDirs()` — `[EZCORP_DB_PATH, <dbDir>/backups]` for the
 *     active on-disk PGlite DB; returns `[]` for external Postgres /
 *     in-memory (nothing on disk to protect), so those modes reserve
 *     nothing extra. This is the SAME set the MCP sandbox masks.
 */
async function resolveReservedSensitiveDirs(): Promise<string[]> {
  const root = getProjectRoot();
  const configuredSecretsDir = process.env.EZCORP_SECRETS_DIR;
  const secretFiles = [
    join(root, ".pi-secret"),
    join(root, ".pi-salt"),
    join(root, ".env"),
    join(process.cwd(), ".pi-secret"),
    join(process.cwd(), ".pi-salt"),
    join(process.cwd(), ".env"),
  ];
  const raw = [
    join(root, ".ezcorp", "data"),
    join(root, ".ezcorp", "backups"),
    ...secretFiles,
    ...(configuredSecretsDir ? [configuredSecretsDir] : []),
    ...getDbMaskDirs(),
  ];
  const resolved = await Promise.all(
    raw.map((p) => resolveGrantPrefixCanonical(p)),
  );
  // Drop unresolvable (null) entries; de-dup canonical paths.
  return [...new Set(resolved.filter((p): p is string => p !== null))];
}

/**
 * True when `resolvedRealPath` IS, or is nested under, any reserved
 * sensitive dir. The argument MUST already be realpath-resolved (or
 * lowest-existing-ancestor-resolved, as both host fs gates produce) so
 * `..` / symlink / trailing-slash tricks are normalized away before the
 * compare — the reserved dirs are canonicalized the same way, so both
 * sides meet on identical canonical footing.
 *
 * Segment-bounded: `p === reserved || p.startsWith(reserved + "/")`.
 */
export async function isReservedSensitivePath(
  resolvedRealPath: string,
): Promise<boolean> {
  const reserved = await resolveReservedSensitiveDirs();
  return reserved.some(
    (r) => resolvedRealPath === r || resolvedRealPath.startsWith(r + "/"),
  );
}

// ── Secure Filesystem Permission Check (realpath-resolved) ─────────
//
// The Phase 1 `checkPermission` sync boolean helper was deleted in
// Phase 6. Production callers consult the PDP at
// `./permission-engine.ts` via `engine.authorize`; the deprecated
// boolean shape had no remaining production references, only legacy
// unit tests (since rolled into PDP coverage).

export type FilesystemMode = "read" | "write";

/**
 * WHY a filesystem gate refused. Three semantically different answers
 * that used to collapse into one `{allowed: false}`:
 *
 *   • `not-found`         — `realpath()` failed; nothing is at that
 *     path. A plain ENOENT with no security meaning.
 *   • `reserved-carveout` — the path IS covered by a granted prefix (or
 *     the implicit install-dir allow) but lands in a platform reserved
 *     dir: the PGlite datadir / JWT-secret store and its `backups`
 *     sibling (see {@link isReservedSensitivePath}). This is the
 *     sandbox working AS DESIGNED — the platform protecting its own
 *     state from code it otherwise trusts with the whole project root.
 *     It is NOT an escape attempt. Under the shipped Docker layout
 *     (`Dockerfile:253` — `EZCORP_DB_PATH=/app/data/ezcorp` with
 *     project root `/app`) the datadir sits INSIDE the project root, so
 *     ANY extension that walks the project (ez-factory's `read_files`,
 *     file-organizer, …) hits this on its first CORRECT run.
 *   • `out-of-grant`      — the path is outside every granted prefix
 *     AND outside the install dir. THIS is a grant escape.
 *
 * Ask "was this an escape?" via {@link isGrantEscape} — never by
 * comparing strings and never by `!allowed`.
 */
export type FilesystemDenialKind =
  | "not-found"
  | "reserved-carveout"
  | "out-of-grant";

/**
 * The single classification table for {@link FilesystemDenialKind}.
 *
 * `satisfies Record<FilesystemDenialKind, boolean>` is the guardrail:
 * adding a new denial kind without classifying it here is a COMPILE
 * error, so a future caller cannot silently fold a new refusal into the
 * deny-and-disable branch the way `reserved-carveout` was folded in.
 */
const GRANT_ESCAPE_BY_DENIAL = {
  "not-found": false,
  "reserved-carveout": false,
  "out-of-grant": true,
} as const satisfies Record<FilesystemDenialKind, boolean>;

/**
 * True when the denial means the extension reached OUTSIDE its grant —
 * the only condition that may trip `denyAndDisable`. False for the
 * platform's own reserved carve-out and for plain ENOENT: those are
 * ordinary denials the extension is expected to handle (ez-factory's
 * `read_files` reports them as `skipped[{reason:"unreadable"}]`).
 */
export function isGrantEscape(denial: FilesystemDenialKind): boolean {
  return GRANT_ESCAPE_BY_DENIAL[denial];
}

/**
 * Result of a filesystem permission check. Discriminated on `allowed`
 * (same shape family as the PDP's `Decision` union in
 * `./permission-engine.ts`): the `denial` field exists ONLY on the
 * refused arm, so a caller that wants to know why must narrow first.
 */
export type FilesystemPermissionResult =
  | {
      allowed: true;
      resolvedPath: string;
      /**
       * The mode the caller requested. Mirrors the input for callers
       * that persist the result and need a self-describing record (e.g.
       * audit). Phase 3: introduced alongside the explicit-mode
       * signature.
       */
      mode: FilesystemMode;
    }
  | {
      allowed: false;
      /** Why. See {@link FilesystemDenialKind} / {@link isGrantEscape}. */
      denial: FilesystemDenialKind;
      resolvedPath: string;
      mode: FilesystemMode;
    };

/**
 * Result of the write-side prefix check (`checkPrefixForWrite` in
 * `./fs-handler.ts`). Same discrimination as
 * {@link FilesystemPermissionResult} minus the resolved-path echo — the
 * caller already holds the resolved target. `not-found` never occurs
 * here: the caller resolves the lowest existing ancestor first, so a
 * not-yet-created target is a legitimate write.
 */
export type FilesystemPrefixCheck =
  | { allowed: true }
  | { allowed: false; denial: FilesystemDenialKind };

/**
 * Check filesystem access using realpath resolution to prevent traversal and symlink escapes.
 * Resolves both the requested path and granted prefixes via realpath before comparing.
 * Implicitly allows access to the extension's own install directory.
 *
 * Phase 3 — explicit `mode` parameter:
 *   - `mode: "read"`  (default, back-compat) — allow when the path is in
 *     the granted prefix tree.
 *   - `mode: "write"` — additionally requires that the matching tool's
 *     manifest declared `capabilities.filesystem.mode` includes `"write"`.
 *     The check itself only prefix-matches; the per-tool mode gate is
 *     enforced by the host fs handlers (`./fs-handler.ts`) via the PDP
 *     before this function is called. This signature retains the
 *     prefix check so the realpath resolution stays in one place.
 *
 * The `mode` field is mirrored back on the result so callers can audit
 * what was asked for.
 */
export async function checkFilesystemPermission(
  requestedPath: string,
  granted: ExtensionPermissions,
  extensionInstallDir: string,
  mode: FilesystemMode = "read",
  /** The user this call acts on behalf of. REQUIRED for a grant that
   *  carries `$USER`; without it such a prefix matches nothing (see
   *  {@link UNRESOLVED_USER_PREFIX}). Grants with no `$USER` segment are
   *  unaffected, so existing callers keep their behavior exactly. */
  actingUserId?: string | null,
): Promise<FilesystemPermissionResult> {
  // Resolve requested path via realpath
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(requestedPath);
  } catch {
    // Path doesn't exist -- deny. NOT a security event; the caller
    // surfaces a plain ENOENT.
    return { allowed: false, denial: "not-found", resolvedPath: requestedPath, mode };
  }

  // Hard-deny reserved sensitive paths (DB + secret dir) BEFORE any
  // allow — including the implicit install-dir allow below and every
  // granted prefix. Grant-independent defense-in-depth; see
  // `isReservedSensitivePath`. `resolvedPath` is already realpath'd, so
  // the segment-bounded compare can't be bypassed by `..` / symlink.
  //
  // Tagged `reserved-carveout`, NOT `out-of-grant`: the path is inside
  // what the user granted, and the platform is carving its own state
  // back out. Conflating the two bricked every project-root-walking
  // extension on its first correct run under the Docker layout.
  if (await isReservedSensitivePath(resolvedPath)) {
    return { allowed: false, denial: "reserved-carveout", resolvedPath, mode };
  }

  // Resolve install dir via realpath
  let resolvedInstallDir: string;
  try {
    resolvedInstallDir = await realpath(extensionInstallDir);
  } catch {
    resolvedInstallDir = extensionInstallDir;
  }

  // Implicit access: extension's own install directory
  if (resolvedPath === resolvedInstallDir || resolvedPath.startsWith(resolvedInstallDir + "/")) {
    return { allowed: true, resolvedPath, mode };
  }

  // Check granted filesystem prefixes
  const prefixes = granted.filesystem ?? [];
  for (const rawPrefix of prefixes) {
    const prefix = expandGrantPrefix(rawPrefix, actingUserId);
    // Relative paths resolve against installDir.
    const absolutePrefix = prefix.startsWith("/")
      ? prefix
      : pathResolve(extensionInstallDir, prefix);
    // Tolerate a granted dir that doesn't exist yet (bootstrap case)
    // — see resolveGrantPrefixCanonical. `null` ⇒ truly unresolvable.
    const resolvedPrefix = await resolveGrantPrefixCanonical(absolutePrefix);
    if (resolvedPrefix === null) continue;

    if (resolvedPath === resolvedPrefix || resolvedPath.startsWith(resolvedPrefix + "/")) {
      return { allowed: true, resolvedPath, mode };
    }
  }

  // Outside every grant AND the install dir — a genuine escape attempt.
  return { allowed: false, denial: "out-of-grant", resolvedPath, mode };
}

// ── Permission Display ──────────────────────────────────────────────

export interface PermissionItem {
  type: string;
  value: string | boolean;
  description: string;
}

const PERMISSION_DESCRIPTIONS: Record<string, (v: string | boolean) => string> = {
  network: (v) => `Network access to ${v}`,
  filesystem: (v) => `Filesystem access to ${v}`,
  shell: () => "Execute shell commands",
  env: (v) => `Read environment variable ${v}`,
  storage: () => "Persistent key-value storage",
};

export function getRequiredPermissions(manifest: ExtensionManifest): PermissionItem[] {
  const items: PermissionItem[] = [];
  const perms = manifest.permissions;

  if (perms.network) {
    for (const domain of perms.network) {
      items.push({ type: "network", value: domain, description: PERMISSION_DESCRIPTIONS.network!(domain) });
    }
  }
  if (perms.filesystem) {
    for (const path of perms.filesystem) {
      items.push({ type: "filesystem", value: path, description: PERMISSION_DESCRIPTIONS.filesystem!(path) });
    }
  }
  if (perms.shell) {
    items.push({ type: "shell", value: true, description: PERMISSION_DESCRIPTIONS.shell!(true) });
  }
  if (perms.env) {
    for (const varName of perms.env) {
      items.push({ type: "env", value: varName, description: PERMISSION_DESCRIPTIONS.env!(varName) });
    }
  }
  if (perms.storage) {
    items.push({ type: "storage", value: true, description: PERMISSION_DESCRIPTIONS.storage!(true) });
  }

  return items;
}

// ── Permission Diff ─────────────────────────────────────────────────

export function diffPermissions(
  requested: ExtensionPermissions,
  granted: ExtensionPermissions,
): ExtensionPermissions {
  const diff: ExtensionPermissions = { grantedAt: {} };

  if (requested.network) {
    const ungrantedDomains = requested.network.filter((d) => !granted.network?.includes(d));
    if (ungrantedDomains.length > 0) diff.network = ungrantedDomains;
  }

  if (requested.filesystem) {
    const ungrantedPaths = requested.filesystem.filter((p) => !granted.filesystem?.includes(p));
    if (ungrantedPaths.length > 0) diff.filesystem = ungrantedPaths;
  }

  if (requested.shell && !granted.shell) {
    diff.shell = true;
  }

  if (requested.env) {
    const ungrantedVars = requested.env.filter((v) => !granted.env?.includes(v));
    if (ungrantedVars.length > 0) diff.env = ungrantedVars;
  }

  if (requested.storage && !granted.storage) {
    diff.storage = true;
  }

  return diff;
}

// ── Sensitive Operations ────────────────────────────────────────────

export function isSensitiveOperation(_type: "shell" | "filesystem"): boolean {
  return true; // shell and filesystem are always sensitive
}

/**
 * Scope namespace for always-allow grants. Phase 1 ships with two
 * effective scopes (conversation + forever); session and project are
 * declared so Phase 6's UI scope chooser doesn't need a schema change.
 *   • `session`      — until the user logs out / restarts the server
 *   • `conversation` — until this conversation is deleted
 *   • `project`      — until the project is deleted
 *   • `forever`      — until manually revoked from the admin UI
 */
export type AlwaysAllowScope = "session" | "conversation" | "project" | "forever";

/**
 * Settings key for always-allow grants, scoped per (user, scope,
 * scopeId, capability). Closes finding H2 (multi-user collision):
 * before this commit, two users on the same extension shared a single
 * always-allow row.
 *
 * Migration note: existing rows use the legacy `ext:<id>:always_allow:
 * <op>` shape. Those rows become orphaned after this change — users
 * will be re-prompted on the next sensitive op. The orphans aren't
 * deleted; admin UI cleanup is deferred to Phase 6.
 */
export function alwaysAllowSettingKey(args: {
  extensionId: string;
  userId: string;
  scope: AlwaysAllowScope;
  scopeId: string;
  capability: string;
}): string {
  return `ext:${args.extensionId}:${args.userId}:${args.scope}:${args.scopeId}:always_allow:${args.capability}`;
}

/** @deprecated Phase 6 removal. Pre-PDP wrapper kept for legacy callers. */
function legacyAlwaysAllowKey(extensionId: string, operationType: string): string {
  return `ext:${extensionId}:always_allow:${operationType}`;
}

/**
 * Persisted always-allow row value shape.
 *
 * Phase 1 of the capability-expiry milestone widens the value from a
 * bare `boolean` to `{allowed, grantedAt}` so a future sweep (Phase 2)
 * can age out grants by their grant timestamp. Backwards compat:
 *
 *   • Legacy `true`  → treated as "allowed, never expires" (no
 *     `grantedAt` available, so the sweep skips it). NOT auto-rewritten
 *     on read — lazy upgrade per locked decision §A.2.
 *   • Legacy `false` → treated as "needs_confirmation". Same lazy
 *     posture — read-only, no rewrite.
 *   • New `{allowed: true,  grantedAt: <ms>}` → "allowed".
 *   • New `{allowed: false, grantedAt: <ms>}` → "needs_confirmation".
 *   • Anything else (malformed JSON, wrong types) → fail-closed to
 *     "needs_confirmation". The sweep ignores malformed rows; orphan
 *     cleanup is deferred to v1.5.
 *
 * The Phase 2 sweep will read `grantedAt` to compute age, compare
 * against the per-capability TTL from `./perm-expiry-config.ts`, and
 * write `false` (with a fresh `grantedAt`) on revoke. Phase 1 ships
 * only the value-shape change; no sweep yet.
 */
export interface AlwaysAllowRecord {
  allowed: boolean;
  /** Unix-ms timestamp at which the grant was last confirmed. */
  grantedAt: number;
  /**
   * Phase 56: per-grant TTL override (additive widening — back-compat).
   *   • `null`      — "Never" sentinel. The host-maintenance sweep
   *     evaluator skips this row entirely (see `perm-expiry-sweep.ts`
   *     runSweep loop). Persistent on disk; survives restarts.
   *   • `number`    — positive finite override (ms). Wins over BOTH
   *     `TTL_CONFIG[kind]` AND the env-driven `foreverTtlMs`, even when
   *     `scope === "forever"` (Pitfall 6 — override takes precedence).
   *   • `undefined` — field absent. Legacy rows and first-time grants
   *     that pre-date the UI. Sweep falls back to `TTL_CONFIG[kind]` /
   *     `foreverTtlMs` (the Phase 1/2 behavior).
   *
   * Parsing is centralized in {@link readTtlOverrideMs}; 0, negative,
   * NaN, and Infinity all coerce to `undefined` — `null` is the SOLE
   * Never sentinel.
   */
  ttlOverrideMs?: number | null;
  /**
   * Phase 56: materialized expiry timestamp paired with
   * `ttlOverrideMs`. Persisted alongside the override so admin UI and
   * audit consumers don't have to recompute `grantedAt + ttlOverrideMs`.
   *   • `null`      — pairs with `ttlOverrideMs: null` (Never).
   *   • `number`    — epoch ms; written by `buildAlwaysAllowValue` when
   *     the caller supplies it (typically `grantedAt + ttlOverrideMs`).
   *   • `undefined` — sweep derives expiry from `grantedAt + TTL_CONFIG
   *     [kind]` on demand (legacy + first-time grants).
   */
  expiresAt?: number | null;
}

/**
 * Parse a raw `settings` value into an effective allow/deny decision.
 * Pure: takes a value, returns a decision; no DB I/O. Exported so the
 * PDP (`permission-engine.ts`) can apply the same parsing logic to
 * values it reads directly via `getSetting`.
 *
 * Returns `"allowed"` for legacy `true` AND for new
 * `{allowed: true, grantedAt: <number>}`. Everything else (including
 * legacy `false`, new `{allowed: false}`, malformed objects, undefined,
 * arrays, strings) collapses to `"needs_confirmation"` — fail-closed.
 */
export function parseAlwaysAllowValue(
  value: unknown,
  /** When given, a row whose materialized `expiresAt` is at or before
   *  `now` reads as expired before the sweep has revoked it. */
  now?: number,
): "allowed" | "needs_confirmation" {
  // Legacy boolean shape — pre-Phase-1 rows that haven't been rewritten.
  if (value === true) return "allowed";
  if (value === false) return "needs_confirmation";

  // New shape — `{allowed: boolean, grantedAt: number}`. Reject any
  // value that doesn't match the contract exactly. `allowed` MUST be
  // a boolean (not "true"/"yes"/1) and `grantedAt` MUST be a number.
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const v = value as Record<string, unknown>;
    if (typeof v.allowed === "boolean" && typeof v.grantedAt === "number") {
      const expired = now !== undefined && typeof v.expiresAt === "number" && v.expiresAt <= now;
      return v.allowed && !expired ? "allowed" : "needs_confirmation";
    }
  }

  // Anything else (undefined, malformed shapes, wrong types) — fail
  // closed. Sweep rev'd the row to a bogus value? User re-prompts.
  return "needs_confirmation";
}

/**
 * Phase 56: read the per-row TTL override from a raw settings JSONB
 * value. Three-branch helper that the sweep evaluator consults BEFORE
 * the `TTL_CONFIG[kind]` / `foreverTtlMs` fallback.
 *
 * Returns:
 *   • `null`      — the user picked "Never". Sweep MUST skip this row
 *     entirely (no revocation, no audit, honest Never even when
 *     `scope === "forever"`).
 *   • positive finite `number` — valid override; sweep uses this ms
 *     value as the per-row TTL, winning over `TTL_CONFIG[kind]` and
 *     `foreverTtlMs`.
 *   • `undefined` — legacy row, absent field, or malformed value (0,
 *     negative, NaN, Infinity all collapse here per Pitfall 2). Sweep
 *     falls back to the existing `TTL_CONFIG[kind]` / `foreverTtlMs`
 *     logic (Phase 1/2 behavior).
 *
 * Defensive: accepts `unknown` so the sweep can call it directly on a
 * raw `row.value` from the settings table without pre-narrowing.
 */
export function readTtlOverrideMs(
  value: unknown,
): number | null | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const v = value as Record<string, unknown>;
  if (v.ttlOverrideMs === null) return null;
  if (
    typeof v.ttlOverrideMs === "number" &&
    Number.isFinite(v.ttlOverrideMs) &&
    v.ttlOverrideMs > 0
  ) {
    return v.ttlOverrideMs;
  }
  return undefined;
}

/**
 * Build the canonical new-shape value for a write. Always emits the
 * `{allowed, grantedAt}` form; legacy boolean is never written by new
 * code (Phase 1 contract). Exported so the PDP and other writers stay
 * consistent without re-implementing the shape.
 *
 * Phase 56: optional third `options` arg threads `ttlOverrideMs` and
 * `expiresAt` onto the row without breaking the 2-arg legacy
 * signature. Three rules:
 *   • No `options` arg                 → fields ABSENT (byte-identical
 *                                        to pre-Phase-56 output).
 *   • `options.ttlOverrideMs` is set   → field written (positive number
 *                                        or `null` for Never).
 *   • `options.ttlOverrideMs` omitted  → field stays absent (empty
 *     (or `undefined`)                   options ≠ explicit `null`).
 * Same rules apply independently to `options.expiresAt`.
 */
export function buildAlwaysAllowValue(
  allowed: boolean,
  now: number = Date.now(),
  options?: { ttlOverrideMs?: number | null; expiresAt?: number | null },
): AlwaysAllowRecord {
  const base: AlwaysAllowRecord = { allowed, grantedAt: now };
  if (options !== undefined) {
    if (options.ttlOverrideMs !== undefined) {
      base.ttlOverrideMs = options.ttlOverrideMs;
    }
    if (options.expiresAt !== undefined) {
      base.expiresAt = options.expiresAt;
    }
  }
  return base;
}

/**
 * Check if a sensitive operation has been granted always-allow for
 * the given scope tuple. Phase 1: callers are migrating to the
 * scoped key — pass `userId/scope/scopeId` to opt in. Legacy callers
 * that pass only `extensionId + operationType` get the unscoped
 * lookup against the legacy key (for back-compat with the dead
 * `setPermissionChecker` block in `setup-tools.ts`, which is
 * removed in the same Phase 1 commit series).
 *
 * Cap-expiry Phase 1: read accepts BOTH legacy `boolean` and new
 * `{allowed, grantedAt}` shapes via {@link parseAlwaysAllowValue}.
 */
export async function checkSensitiveConfirmation(
  extensionId: string,
  operationType: "shell" | "filesystem",
  scopeArgs?: {
    userId: string;
    scope: AlwaysAllowScope;
    scopeId: string;
  },
): Promise<"allowed" | "needs_confirmation"> {
  const key = scopeArgs
    ? alwaysAllowSettingKey({
        extensionId,
        userId: scopeArgs.userId,
        scope: scopeArgs.scope,
        scopeId: scopeArgs.scopeId,
        capability: operationType === "shell" ? "shell" : "fs.write",
      })
    : legacyAlwaysAllowKey(extensionId, operationType);
  const value = await getSetting(key);
  return parseAlwaysAllowValue(value);
}

/**
 * Persist an always-allow grant. Phase 1 callers (PDP) pass full
 * scope args; legacy callers fall back to the unscoped key.
 *
 * Cap-expiry Phase 1: writes the `{allowed, grantedAt}` shape every
 * time. Existing legacy-boolean rows are NOT rewritten unless they
 * pass through this function (lazy upgrade — locked decision §A.2).
 */
export async function setSensitiveAlwaysAllow(
  extensionId: string,
  operationType: "shell" | "filesystem",
  allowed: boolean,
  scopeArgs?: {
    userId: string;
    scope: AlwaysAllowScope;
    scopeId: string;
  },
): Promise<void> {
  const key = scopeArgs
    ? alwaysAllowSettingKey({
        extensionId,
        userId: scopeArgs.userId,
        scope: scopeArgs.scope,
        scopeId: scopeArgs.scopeId,
        capability: operationType === "shell" ? "shell" : "fs.write",
      })
    : legacyAlwaysAllowKey(extensionId, operationType);
  await upsertSetting(key, buildAlwaysAllowValue(allowed));
}
