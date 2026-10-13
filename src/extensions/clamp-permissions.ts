/**
 * Phase 51 — clamp helpers for the new capability-surface permissions
 * (`llm`, `memory`, `lessons`, `schedule`). Both the
 * `web/src/routes/api/extensions/[id]/permissions/+server.ts` and
 * `activate/+server.ts` routes can call these directly so the clamp
 * logic stays in one place per the sec-C4 convention.
 *
 * Why a shared module now (vs. the test-reimpl pattern from Phase 2):
 * the LLM clamp has nontrivial numeric clamps + glob validation that's
 * far too easy to drift between two route copies. The Phase 2c-style
 * "no shared helper" rule was for trivial intersections; LLM/memory/
 * lessons/schedule have real validation logic.
 *
 * The classic five (`network`, `filesystem`, `shell`, `env`, `storage`)
 * remain inline at the route level — no behavior change.
 */
import type { ExtensionManifestV2, ExtensionPermissions } from "./types";
import { validateCron } from "./cron";
import { capabilityToolsDisabled } from "./capability-flags";
import {
  DIRECT_CARRIER_EVENT_TYPES,
  SCOPED_RUNTIME_EVENT_TYPES,
} from "../runtime/sse-conversation-filter";
import { isValidWorkflowName } from "../runtime/workflow-name";
import { WEBHOOK_PREFIX_RE } from "./manifest";
import { isSensitiveEnvironmentEntry } from "./sensitive-environment";

/** Default cap per dynamic-trigger kind when neither side states one. Low
 *  on purpose — an author who wants more says so, and the install-time
 *  grant is where a user widens it. */
const MAX_DYNAMIC_TRIGGERS_DEFAULT = 10;

/** Default extension-wide daily fire envelope for dynamic triggers. */
const TRIGGER_RUNS_PER_DAY_DEFAULT = 100;

/** Pi-AI provider allowlist. Manifest cannot grant any provider not
 *  in this set; clamp drops unknown providers silently. */
export const KNOWN_LLM_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "mistral",
  "openrouter",
  "kilo",
] as const;

const KNOWN_PROVIDER_SET = new Set<string>(KNOWN_LLM_PROVIDERS);

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/** Validate a model glob: no `..`, no leading `/`. Empty / non-string
 *  globs are dropped silently. */
function isValidModelGlob(glob: unknown): glob is string {
  if (typeof glob !== "string") return false;
  if (glob.length === 0) return false;
  if (glob.startsWith("/")) return false;
  if (glob.includes("..")) return false;
  return true;
}

/**
 * Clamp an LLM permission grant to its manifest declaration. Returns
 * `undefined` if the manifest doesn't declare LLM (extension cannot
 * grant itself a permission the manifest didn't request).
 */
export function clampLlmPermission(
  submitted: NonNullable<ExtensionPermissions["llm"]> | undefined,
  manifest: NonNullable<ExtensionManifestV2["permissions"]["llm"]> | undefined,
): ExtensionPermissions["llm"] {
  if (!manifest) return undefined;
  // Treat the submitted grant as a fully-qualified ExtensionPermissions
  // shape — the optional fields default to undefined and the clamp
  // logic below reads them through `clampNumber` which already
  // handles undefined.
  const sub: NonNullable<ExtensionPermissions["llm"]> =
    submitted ?? { providers: [], maxCallsPerHour: 0, maxCallsPerDay: 0 };

  // Provider intersection: submitted ∩ manifest ∩ KNOWN_LLM_PROVIDERS.
  const manifestProviders = new Set(manifest.providers ?? []);
  const providers = (sub.providers ?? []).filter(
    (p) => typeof p === "string" && manifestProviders.has(p) && KNOWN_PROVIDER_SET.has(p),
  );
  if (providers.length === 0) return undefined;

  const out: NonNullable<ExtensionPermissions["llm"]> = {
    providers,
    maxCallsPerHour: Math.min(
      clampNumber(sub.maxCallsPerHour, 1, 1000, 60),
      clampNumber(manifest.maxCallsPerHour, 1, 1000, 60),
    ),
    maxCallsPerDay: Math.min(
      clampNumber(sub.maxCallsPerDay, 1, 5000, 500),
      clampNumber(manifest.maxCallsPerDay, 1, 5000, 500),
    ),
  };

  if (manifest.maxTokensPerCall !== undefined || sub.maxTokensPerCall !== undefined) {
    out.maxTokensPerCall = Math.min(
      clampNumber(sub.maxTokensPerCall, 1, 16384, 4096),
      clampNumber(manifest.maxTokensPerCall, 1, 16384, 4096),
    );
  }
  if (manifest.maxTokensPerDay !== undefined || sub.maxTokensPerDay !== undefined) {
    out.maxTokensPerDay = Math.min(
      clampNumber(sub.maxTokensPerDay, 1, Number.MAX_SAFE_INTEGER, 1_000_000),
      clampNumber(manifest.maxTokensPerDay, 1, Number.MAX_SAFE_INTEGER, 1_000_000),
    );
  }
  if (manifest.maxTimeoutMs !== undefined || sub.maxTimeoutMs !== undefined) {
    out.maxTimeoutMs = Math.min(
      clampNumber(sub.maxTimeoutMs, 1000, 300_000, 60_000),
      clampNumber(manifest.maxTimeoutMs, 1000, 300_000, 60_000),
    );
  }
  if (manifest.maxCostCentsPerDay !== undefined || sub.maxCostCentsPerDay !== undefined) {
    out.maxCostCentsPerDay = Math.min(
      clampNumber(sub.maxCostCentsPerDay, 1, Number.MAX_SAFE_INTEGER, 10_000),
      clampNumber(manifest.maxCostCentsPerDay, 1, Number.MAX_SAFE_INTEGER, 10_000),
    );
  }

  // allowedModels: manifest is source of truth. Drop entries outside
  // granted providers and entries with invalid globs.
  if (manifest.allowedModels) {
    const allowed: Record<string, string[]> = {};
    for (const provider of providers) {
      const globs = manifest.allowedModels[provider];
      if (!Array.isArray(globs)) continue;
      const valid = globs.filter(isValidModelGlob);
      if (valid.length > 0) allowed[provider] = valid;
    }
    if (Object.keys(allowed).length > 0) out.allowedModels = allowed;
  }

  return out;
}

export function clampMemoryPermission(
  submitted: ExtensionPermissions["memory"] | undefined,
  manifest: ExtensionManifestV2["permissions"]["memory"] | undefined,
): ExtensionPermissions["memory"] {
  if (!manifest) return undefined;
  const sub: NonNullable<ExtensionPermissions["memory"]> =
    submitted ?? { access: manifest.access, maxWritesPerDay: 0, selfOnly: true };

  // Access tier: write implies read. Submitted cannot exceed manifest.
  let access: "read" | "write" = "read";
  if (manifest.access === "write" && sub.access === "write") access = "write";

  const out: NonNullable<ExtensionPermissions["memory"]> = {
    access,
    maxWritesPerDay: Math.min(
      clampNumber(sub.maxWritesPerDay, 1, 1000, 100),
      clampNumber(manifest.maxWritesPerDay, 1, 1000, 100),
    ),
    // selfOnly default: TRUE (locked decision). Extension cannot
    // unilaterally weaken this — only the manifest declaring
    // `selfOnly: false` (a wider grant) lets the user opt in.
    selfOnly: !(manifest.selfOnly === false && sub.selfOnly === false),
  };

  if (Array.isArray(manifest.categories)) {
    const validCategories = new Set([
      "preferences", "biographical", "technical", "decisions_goals",
    ]);
    const fromManifest = manifest.categories.filter((c) => validCategories.has(c));
    const filtered = Array.isArray(sub.categories)
      ? sub.categories.filter((c) => fromManifest.includes(c))
      : fromManifest;
    if (filtered.length > 0) out.categories = filtered;
  }

  return out;
}

/** Known search providers. A grant cannot allowlist a provider outside
 *  this set; clamp drops unknown providers silently. Mirrors
 *  `KNOWN_LLM_PROVIDERS`. */
export const KNOWN_SEARCH_PROVIDERS = [
  "searxng",
  "duckduckgo",
  "tavily",
  "brave",
  "exa",
  "serpapi",
  "jina",
] as const;

const KNOWN_SEARCH_PROVIDER_SET = new Set<string>(KNOWN_SEARCH_PROVIDERS);

/**
 * Clamp a `search` permission grant to its manifest declaration.
 *
 * The grant is the §3.1 three-state shape (`"inherit" | {…} | false`):
 *   - `false` (disabled) and `"inherit"` (track instance defaults) pass
 *     through verbatim — neither can exceed any manifest bound, so
 *     there's nothing to clamp.
 *   - an object override is clamped: providers intersect with the
 *     manifest's declared providers ∩ the KNOWN set; numeric fields are
 *     clamped to `[manifest, hard-default]` minimums.
 *
 * Returns `undefined` when the manifest doesn't declare `search` — an
 * extension cannot grant itself a capability the manifest didn't request
 * (mirrors `clampLlmPermission`). The full instance↔extension field-level
 * RESOLVER lands in Phase 2; this is install/grant-time clamping only.
 */
export function clampSearchPermission(
  submitted: ExtensionPermissions["search"] | undefined,
  // Accepts EITHER the manifest declaration (object-only) OR a granted
  // `ExtensionPermissions["search"]` (the §3.1 three-state shape). The
  // reapprove/re-clamp path passes a prior GRANT as the ceiling, so the
  // param must tolerate `false` / `"inherit"`.
  manifest: ExtensionManifestV2["permissions"]["search"] | ExtensionPermissions["search"] | undefined,
): ExtensionPermissions["search"] {
  if (manifest === undefined) return undefined;
  // A `false` ceiling disables search regardless of what was submitted.
  if (manifest === false) return false;
  // Disabled / inherit are valid terminal states — nothing to clamp.
  if (submitted === false) return false;
  if (submitted === "inherit" || submitted === undefined) return "inherit";

  // Normalize an `"inherit"` ceiling to "no field bounds" (providers
  // unrestricted, numerics default-clamped).
  const manifestObj = manifest === "inherit" ? {} : manifest;

  const out: NonNullable<Exclude<ExtensionPermissions["search"], "inherit" | false>> = {};

  // Numeric ceilings: clamp to the narrower of submitted and manifest.
  if (manifestObj.quota !== undefined || submitted.quota !== undefined) {
    out.quota = Math.min(
      clampNumber(submitted.quota, 1, 100_000, 100),
      clampNumber(manifestObj.quota, 1, 100_000, 100),
    );
  }
  if (manifestObj.maxResults !== undefined || submitted.maxResults !== undefined) {
    out.maxResults = Math.min(
      clampNumber(submitted.maxResults, 1, 20, 5),
      clampNumber(manifestObj.maxResults, 1, 20, 5),
    );
  }

  // Providers: `"inherit"` passes through; an explicit list intersects
  // submitted ∩ manifest ∩ KNOWN. An empty intersection means "no
  // explicit provider allowlist" → omit (resolver falls back to default).
  const manifestProviders = manifestObj.providers;
  if (submitted.providers === "inherit") {
    out.providers = "inherit";
  } else if (Array.isArray(submitted.providers)) {
    const manifestSet =
      manifestProviders === "inherit" || manifestProviders === undefined
        ? KNOWN_SEARCH_PROVIDER_SET
        : new Set(manifestProviders);
    const providers = submitted.providers.filter(
      (p) => typeof p === "string" && manifestSet.has(p) && KNOWN_SEARCH_PROVIDER_SET.has(p),
    );
    if (providers.length > 0) out.providers = providers;
  }

  return out;
}

/** Default per-hour trigger budget when neither side names one, and the
 *  hard ceiling any grant is clamped to. A workflow run can fan out into
 *  `agent` steps that cost real LLM spend, so an extension-driven trigger
 *  is always rate-bounded even when the author forgot to say so. */
export const WORKFLOW_RUNS_PER_HOUR_DEFAULT = 20;
export const WORKFLOW_RUNS_PER_HOUR_CEILING = 500;

/**
 * Clamp a `workflows` trigger grant (W2) to its manifest declaration.
 *
 * Returns `undefined` when the manifest doesn't declare `workflows` (an
 * extension cannot grant itself a capability its author never requested —
 * mirrors `clampLlmPermission`), and also when the name intersection is
 * empty: a `{names: []}` husk would read as "granted" to any presence
 * check while authorizing nothing, so it is dropped outright.
 *
 * The manifest is the source of truth for `names` — a submitted grant can
 * only ever be a SUBSET. Each surviving name is re-checked against the
 * shared `WORKFLOW_NAME_RE`, so a name carrying the `:` namespace
 * separator can never reach the grant even if it somehow got past
 * `validatePermissionsBlock` (defense in depth: the handler namespaces
 * host-side, and a stale grant must not be exploitable).
 *
 * ── C3 / D-3 — the ONE case where an empty `names` survives ────────────
 *
 * `allowDelegated` opts the extension into `ctx.workflows.runFor`, which
 * fires a workflow the extension does NOT ship. A delegated-only
 * extension therefore has NOTHING to put in `names`, and before C3 all
 * three empty-name paths below collapsed the whole grant to `undefined`
 * — so `granted.workflows` was absent, rung 2 of the workflows handler
 * refused, and the feature was unreachable by construction.
 *
 * The fix is deliberately NARROW. Empty stays fail-closed everywhere; the
 * single case opened is "empty names AND the delegated bit survived on
 * BOTH sides". `allowDelegated` itself clamps like every other elevation
 * in this file: the manifest is the ceiling and an install can only ever
 * decline it, never introduce it. So an extension whose manifest is
 * silent about `allowDelegated` gets EXACTLY the pre-C3 result on every
 * path — the added condition reduces to `false` and each branch's
 * predicate is the original expression unchanged.
 */
export function clampWorkflowsPermission(
  submitted: ExtensionPermissions["workflows"] | undefined,
  manifest: ExtensionManifestV2["permissions"]["workflows"] | undefined,
): ExtensionPermissions["workflows"] {
  if (!manifest) return undefined;

  // The delegated bit, clamped first because all three empty-name branches
  // below consult it. Manifest is the ceiling (`=== true` required), and
  // the submitted side must also say yes — except when there is no
  // submitted grant at all, which by this file's standing convention means
  // "the admin approved the declaration as-is" (same as `submittedNames`
  // below and `clampSchedulePermission`). An extension can never turn this
  // on for itself: a manifest that omits it makes `allowDelegated` false
  // no matter what the install submits.
  const allowDelegated =
    manifest.allowDelegated === true &&
    (submitted === undefined || submitted.allowDelegated === true);

  // The rate ceiling is computed once and shared by every exit: it is a
  // pure function of the two inputs, and a delegated-only grant needs one
  // just as much as a named one — `intersectPermissions` does `Math.min`
  // over it, and rung 2 of the handler refuses a non-positive value.
  const maxRunsPerHour = Math.min(
    clampNumber(
      submitted?.maxRunsPerHour,
      1,
      WORKFLOW_RUNS_PER_HOUR_CEILING,
      WORKFLOW_RUNS_PER_HOUR_DEFAULT,
    ),
    clampNumber(
      manifest.maxRunsPerHour,
      1,
      WORKFLOW_RUNS_PER_HOUR_CEILING,
      WORKFLOW_RUNS_PER_HOUR_DEFAULT,
    ),
  );

  /** What an empty NAME set collapses to. `undefined` — the pre-C3
   *  fail-closed drop — unless the delegated bit survived, which is the
   *  only shape in which a name-less grant authorizes anything. */
  const withoutNames = (): ExtensionPermissions["workflows"] =>
    allowDelegated ? { names: [], maxRunsPerHour, allowDelegated: true } : undefined;

  // BRANCH 1 — the manifest declared `workflows` with no usable `names`
  // array at all. That is precisely a delegated-only declaration
  // (`{allowDelegated: true}`); for anyone else it is a malformed block.
  if (!Array.isArray(manifest.names)) return withoutNames();

  // BRANCH 2 — every declared name was malformed, or the list was empty.
  const manifestNames = manifest.names.filter(isValidWorkflowName);
  if (manifestNames.length === 0) return withoutNames();

  // No submitted grant → the admin approved the declaration as-is (same
  // convention as clampSchedulePermission).
  const submittedNames = Array.isArray(submitted?.names) ? submitted.names : manifestNames;
  const manifestSet = new Set(manifestNames);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const n of submittedNames) {
    if (!isValidWorkflowName(n) || !manifestSet.has(n) || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  // BRANCH 3 — the submitted ∩ manifest intersection came out empty.
  if (names.length === 0) return withoutNames();

  return {
    names,
    maxRunsPerHour,
    ...(allowDelegated ? { allowDelegated: true } : {}),
  };
}

export function clampLessonsPermission(
  submitted: ExtensionPermissions["lessons"] | undefined,
  manifest: ExtensionManifestV2["permissions"]["lessons"] | undefined,
): ExtensionPermissions["lessons"] {
  if (!manifest) return undefined;
  const sub: NonNullable<ExtensionPermissions["lessons"]> =
    submitted ?? { access: manifest.access, maxWritesPerDay: 0, maxVisibility: "user" };

  let access: "read" | "write" = "read";
  if (manifest.access === "write" && sub.access === "write") access = "write";

  // maxVisibility: clamp to user|project (no global). Locked decision.
  let maxVisibility: "user" | "project" = "user";
  if (manifest.maxVisibility === "project" && sub.maxVisibility === "project") {
    maxVisibility = "project";
  }

  return {
    access,
    maxWritesPerDay: Math.min(
      clampNumber(sub.maxWritesPerDay, 1, 500, 50),
      clampNumber(manifest.maxWritesPerDay, 1, 500, 50),
    ),
    maxVisibility,
  };
}

export function clampSchedulePermission(
  submitted: ExtensionPermissions["schedule"] | undefined,
  manifest: ExtensionManifestV2["permissions"]["schedule"] | undefined,
): ExtensionPermissions["schedule"] {
  if (!manifest) return undefined;
  // Use the submitted grant when present; otherwise default to the
  // manifest's own values so the clamp produces a coherent grant.
  const sub: NonNullable<ExtensionPermissions["schedule"]> = submitted ?? {
    crons: manifest.crons ?? [],
    maxRunsPerDay: manifest.maxRunsPerDay ?? 24,
    maxRunDurationMs: manifest.maxRunDurationMs ?? 300_000,
    missedRunPolicy: manifest.missedRunPolicy ?? "fire-once",
    maxRetries: manifest.maxRetries ?? 0,
  };

  // Manifest is source of truth for crons (extension cannot smuggle
  // in extra schedules at activate time).
  // Cap the candidate list BEFORE validation — its interval walk can be
  // expensive for impossible expressions (a 4-year no-match search), so
  // bound how many we evaluate rather than walking an unbounded array.
  const crons = (manifest.crons ?? [])
    .filter((c) => typeof c === "string")
    .slice(0, 8)
    .filter((c) => validateCron(c).ok);
  if (crons.length === 0) return undefined;

  const policyChoices = new Set(["skip", "fire-once", "fire-all"]);
  const policy = policyChoices.has(manifest.missedRunPolicy ?? "")
    ? (manifest.missedRunPolicy as "skip" | "fire-once" | "fire-all")
    : "fire-once";

  return {
    crons,
    maxRunsPerDay: Math.min(
      clampNumber(sub.maxRunsPerDay, 1, 288, 24),
      clampNumber(manifest.maxRunsPerDay, 1, 288, 24),
    ),
    maxRunDurationMs: Math.min(
      clampNumber(sub.maxRunDurationMs, 1000, 1_800_000, 300_000),
      clampNumber(manifest.maxRunDurationMs, 1000, 1_800_000, 300_000),
    ),
    missedRunPolicy: policy,
    maxRetries: clampNumber(manifest.maxRetries, 0, 10, 0),
  };
}

/**
 * Clamp the dynamic-trigger envelope (C2). Mirrors
 * `clampSchedulePermission`: the manifest is the ceiling, the submitted
 * grant can only narrow it.
 *
 * `webhookPrefix` is the exception to "intersect submitted with manifest" —
 * it is read from the MANIFEST ONLY and the submitted value is ignored
 * outright. The prefix is a namespace claim, and host-minted slugs derive
 * from it; letting an install-time grant widen or redirect it would let a
 * user hand one extension another extension's slug namespace. A manifest
 * whose prefix fails `WEBHOOK_PREFIX_RE` gets no grant at all rather than a
 * defaulted one — silently substituting a namespace is worse than refusing.
 *
 * Returns `undefined` when the manifest doesn't declare `triggers` (an
 * extension cannot grant itself a capability its author never requested),
 * and also when BOTH caps clamp to zero: an envelope authorizing zero
 * registrations is a husk that reads as "granted" to any presence check
 * while authorizing nothing. `clampWorkflowsPermission` sets that
 * drop-rather-than-store precedent.
 */
export function clampTriggersPermission(
  submitted: ExtensionPermissions["triggers"] | undefined,
  manifest: ExtensionManifestV2["permissions"]["triggers"] | undefined,
): ExtensionPermissions["triggers"] {
  if (!manifest) return undefined;

  // Manifest-only, never the submitted value. No default: an absent or
  // malformed prefix means the author never staked a namespace, so there is
  // nothing to mint under.
  const prefix = manifest.webhookPrefix;
  if (typeof prefix !== "string" || !WEBHOOK_PREFIX_RE.test(prefix)) return undefined;

  // No submitted grant → the admin approved the declaration as-is, so the
  // submitted side defaults to the manifest's own values (same convention
  // as clampSchedulePermission). Taking the shared fallback on both sides
  // instead would silently narrow every un-negotiated install to the
  // default rather than to what the author declared.
  const sub = submitted ?? {
    maxCron: manifest.maxCron,
    maxWebhooks: manifest.maxWebhooks,
    maxRunsPerDay: manifest.maxRunsPerDay,
  };

  const maxCron = Math.min(
    clampNumber(sub.maxCron, 0, 50, MAX_DYNAMIC_TRIGGERS_DEFAULT),
    clampNumber(manifest.maxCron, 0, 50, MAX_DYNAMIC_TRIGGERS_DEFAULT),
  );
  const maxWebhooks = Math.min(
    clampNumber(sub.maxWebhooks, 0, 50, MAX_DYNAMIC_TRIGGERS_DEFAULT),
    clampNumber(manifest.maxWebhooks, 0, 50, MAX_DYNAMIC_TRIGGERS_DEFAULT),
  );
  // Both caps zero ⇒ the envelope authorizes nothing. Drop it.
  if (maxCron === 0 && maxWebhooks === 0) return undefined;

  return {
    maxCron,
    maxWebhooks,
    webhookPrefix: prefix,
    maxRunsPerDay: Math.min(
      clampNumber(sub.maxRunsPerDay, 1, 2000, TRIGGER_RUNS_PER_DAY_DEFAULT),
      clampNumber(manifest.maxRunsPerDay, 1, 2000, TRIGGER_RUNS_PER_DAY_DEFAULT),
    ),
  };
}

// ── Env-key leak detection ──────────────────────────────────────

/** Returns the subset of `permissions.env` whose names look like
 *  credentials. Used by the installer to emit `ext:env-key-leak-warning`
 *  audit rows (governance, soft warning; hard error in v1.4). */
export function detectEnvKeyLeaks(envNames: string[] | undefined): string[] {
  if (!Array.isArray(envNames)) return [];
  return envNames.filter(
    (name) => typeof name === "string" && isSensitiveEnvironmentEntry(name, process.env[name]),
  );
}

/**
 * Emit a `ext:env-key-leak-warning` audit row for each
 * credential-shaped env var the manifest declared. Soft warning today;
 * hard error in v1.4. Migration path: ctx.llm (host-brokered).
 *
 * Wrapped in try/catch — audit-write failure is non-fatal (per Pitfall
 * #2). The caller never awaits this for ordering — it's
 * fire-and-forget.
 */
export async function emitEnvKeyLeakWarnings(
  extensionId: string,
  envNames: string[] | undefined,
): Promise<void> {
  const leaks = detectEnvKeyLeaks(envNames);
  if (leaks.length === 0) return;
  try {
    const { insertAuditEntry } = await import("../db/queries/audit-log");
    const { EXT_AUDIT_ACTIONS } = await import("./audit-actions");
    for (const name of leaks) {
      await insertAuditEntry(
        null,
        EXT_AUDIT_ACTIONS.ENV_KEY_LEAK_WARNING,
        extensionId,
        {
          permission: "env",
          oldValue: undefined,
          newValue: name,
          actor: "system",
          reason: "Credential-shaped env name. Migrate to ctx.llm (host-brokered) — hard error in v1.4.",
        },
      );
    }
  } catch {
    // Audit failure is non-fatal.
  }
}

/**
 * v1.4 — typed install-gate failure. Thrown by `installFromLocal`
 * when an extension's `permissions.env` declares credential-shaped
 * names AND the install isn't a bundled extension with the
 * `envEscapeHatch: true` opt-in. The caller surfaces the error to
 * the operator (admin UI or CLI); the audit row is written
 * separately so a forensic trail exists alongside the throw.
 *
 * Migration path stays `ctx.llm` for LLM creds (already shipped) and
 * future `ctx.secrets` for third-party API creds (v1.5+).
 */
export class EnvKeyLeakInstallError extends Error {
  /** Credential-shaped env names that tripped the gate. */
  readonly leakedNames: readonly string[];
  constructor(leakedNames: string[]) {
    super(
      `Install refused: extension manifest declares credential-shaped env name(s) ` +
        `[${leakedNames.join(", ")}]. The deprecation has been live since Phase 51; ` +
        `v1.4 is the cliff. Migrate LLM credentials to ctx.llm (host-brokered) and ` +
        `third-party API creds to the upcoming ctx.secrets surface (v1.5+).`,
    );
    this.name = "EnvKeyLeakInstallError";
    this.leakedNames = Object.freeze([...leakedNames]);
  }
}

/**
 * v1.4 — install-time gate. Returns `null` when the install may
 * proceed; otherwise writes audit rows AND returns the typed error
 * the caller should throw.
 *
 *   - **User-installed extension** (`isBundled=false`) with
 *     credential-shaped env names → `ENV_KEY_LEAK_INSTALL_BLOCKED`
 *     row per name; returns `EnvKeyLeakInstallError`.
 *   - **Bundled extension** (`isBundled=true`) WITHOUT the
 *     `envEscapeHatch` opt-in with credential-shaped env names →
 *     same as user-installed (fails closed).
 *   - **Bundled extension** (`isBundled=true`) WITH
 *     `envEscapeHatch=true` and credential-shaped env names →
 *     `ENV_KEY_LEAK_BUNDLED_ESCAPE_HATCH_USED` row per name;
 *     returns `null` (install proceeds). The flag is grep-able
 *     so the eventual ctx.secrets migration knows what to touch.
 *
 * Audit rows are NOT keyed on the eventual extension id (the row
 * doesn't exist yet) — the caller passes the manifest name as the
 * audit target so a forensic trail can correlate by name even when
 * the install aborts before persistence.
 */
export async function checkEnvKeyLeakInstallGate(
  extensionName: string,
  envNames: string[] | undefined,
  opts: { isBundled: boolean; envEscapeHatch: boolean },
): Promise<EnvKeyLeakInstallError | null> {
  const leaks = detectEnvKeyLeaks(envNames);
  if (leaks.length === 0) return null;

  const allowEscapeHatch = opts.isBundled && opts.envEscapeHatch === true;
  try {
    const { insertAuditEntry } = await import("../db/queries/audit-log");
    const { EXT_AUDIT_ACTIONS } = await import("./audit-actions");
    const action = allowEscapeHatch
      ? EXT_AUDIT_ACTIONS.ENV_KEY_LEAK_BUNDLED_ESCAPE_HATCH_USED
      : EXT_AUDIT_ACTIONS.ENV_KEY_LEAK_INSTALL_BLOCKED;
    const reason = allowEscapeHatch
      ? `Bundled extension '${extensionName}' opted into envEscapeHatch — credential-shaped env name allowed pending ctx.secrets (v1.5+).`
      : `Install refused for '${extensionName}': credential-shaped env name. Migrate to ctx.llm (LLM creds) or wait for ctx.secrets (v1.5+).`;
    for (const name of leaks) {
      await insertAuditEntry(null, action, extensionName, {
        permission: "env",
        oldValue: undefined,
        newValue: name,
        actor: "system",
        reason,
        extensionName,
      });
    }
  } catch {
    // Audit failure is non-fatal — the throw still happens (or doesn't)
    // based on the gate's allow/deny decision so the gate never silently
    // permits an install just because the audit table is unreachable.
  }
  return allowEscapeHatch ? null : new EnvKeyLeakInstallError(leaks);
}

// ── Full permission-set clamp (sec-C4) ───────────────────────────────
//
// MOVED here from `web/src/lib/server/extension-helpers.ts` (fix-wave B
// Phase 2) so the BACKEND installer can re-clamp stored grants against a
// NEW manifest on update / same-source refresh — the web tree can import
// backend modules via `$server/*`, but not vice versa. The web helper
// file re-exports these verbatim, so every existing route import keeps
// working; behavior is unchanged.
//
// Clamp a caller-submitted permission set to the intersection of what
// the extension's manifest actually requested. Anything beyond the
// manifest is dropped silently — an admin cannot elevate an extension
// past what its author declared. Anything less is allowed (admin can
// grant a subset).
//
// Shared between:
//   - PUT  /api/extensions/[id]/permissions  (sec-C4 main writer)
//   - POST /api/extensions/[id]/activate     (sec-C3 follow-up writer)
//   - updateExtension / installFromLocal same-source refresh (re-clamp)
// Keep the callers in sync — every clamping rule belongs here, not
// inline at any call site.
//
// ── Capability tier (Phase 2+): taskEvents / loopEvents / spawnAgents /
// agentConfig / eventSubscriptions ── Each field is clamped against the manifest
// declaration AND against the kill-switch env var. If
// EZCORP_DISABLE_CAPABILITY_TOOLS=1 is set, the fields behave as if the
// manifest never declared them — operators can disable the entire tier
// without touching schema or code.
//
// eventSubscriptions (Phase 2c): clamp to submitted ∩ manifest-declared,
// where each surviving name must ALSO be one the dispatcher will honor
// at runtime (`event-subscription-dispatcher.ts:registerExtension`):
// either a platform event from the direct-carrier allowlist, or the
// extension's OWN custom event (`<manifest.name>:<event>`, when the
// caller supplies `manifestTopLevel.name`). Anything else fails closed
// (no grant) rather than landing in a grant that can never be honored.
// Callers that omit `name` keep the strict carrier-only behavior — a
// custom event then survives nowhere, which is exactly the bug that
// broke `init_gate` ("missing ezcorp:events:subscribe") on the UI
// activate path, so grant-writing callers should always pass it.
// Phase 51.4 added the object form `{events, includeFullPayload?}`;
// both forms are normalized to the array form before the intersection
// (the dispatcher reads the includeFullPayload flag separately at
// install time).
//
// ── Phase 4 deputy / orchestration flags ──
// `acceptsCallerCaps` and `escalateChildCaps` are extension-level
// boolean elevations declared at the manifest's TOP LEVEL (not under
// `permissions`). The clamp respects the same rule: an admin can only
// grant what the manifest authored, and the user must explicitly
// consent — silent declines reset the field to false.

/** Normalize the manifest's `eventSubscriptions` to the canonical
 *  array-of-event-names form. Handles the Phase 51.4 object form
 *  `{events, includeFullPayload?}`. Returns `undefined` if the
 *  manifest didn't declare event subscriptions. */
function normalizeManifestEventSubscriptions(
  field: ExtensionManifestV2["permissions"]["eventSubscriptions"],
): string[] | undefined {
  if (Array.isArray(field)) return field;
  if (field && typeof field === "object" && Array.isArray(field.events)) return field.events;
  return undefined;
}

/** An extension's OWN custom event: `<ownName>:<event>` with non-empty
 *  halves, and NOT a platform event name. EXACT mirror of the dispatcher's
 *  Branch-2 acceptance parse (`event-subscription-dispatcher.ts:
 *  registerExtension` → `registerExtensionEvent`) — the clamp must never
 *  grant wider than the dispatcher will register, and after this fix it no
 *  longer grants NARROWER either.
 *
 *  The platform-set exclusion is the shadowing guard `registerExtensionEvent`
 *  already applies: an extension named `ez` or `run` would otherwise satisfy
 *  the own-namespace parse for `ez:client-tool` / `run:token` and be granted a
 *  subscription the dispatcher then refuses to wire — a grant row that reads
 *  like access to another user's tool arguments or raw token stream. */
function isOwnNamespaceEvent(eventType: string, ownName: string | undefined): boolean {
  if (!ownName) return false;
  const colon = eventType.indexOf(":");
  if (colon <= 0 || colon >= eventType.length - 1) return false;
  if (eventType.slice(0, colon) !== ownName) return false;
  return (
    !DIRECT_CARRIER_EVENT_TYPES.has(eventType as never)
    && !SCOPED_RUNTIME_EVENT_TYPES.has(eventType as never)
  );
}

/**
 * May this event name appear in a GRANT at all?
 *
 * The dispatcher's acceptance rule, stated once: a platform direct-carrier
 * event (its Branch 1), or the extension's own namespaced custom event (its
 * Branch 2, which `registerExtensionEvent` refuses for any platform name).
 * Anything else — another extension's namespace, a scoped runtime event like
 * `run:token` or `caller:tool-call` — is refused at registration, so granting
 * it writes a row that describes access the extension will never get.
 *
 * Exported because there are TWO grant writers and they must not disagree:
 * this clamp, and `install-grant.ts`'s auto-approve path, which re-attaches
 * the manifest's declared events after the clamp has run.
 */
export function isGrantableEventSubscription(
  eventType: string,
  ownName: string | undefined,
): boolean {
  return (
    DIRECT_CARRIER_EVENT_TYPES.has(eventType as never) || isOwnNamespaceEvent(eventType, ownName)
  );
}

/** Phase 51.4: detect whether a manifest's event-subscription grant
 *  asked for the full payload (no `tool:start`/`tool:complete` strip).
 *  The dispatcher reads this at install/registration time via
 *  `setIncludeFullPayload`. */
export function manifestEventsIncludeFullPayload(
  field: ExtensionManifestV2["permissions"]["eventSubscriptions"],
): boolean {
  if (field && typeof field === "object" && !Array.isArray(field) && field.includeFullPayload === true) {
    return true;
  }
  return false;
}

/** Top-level manifest fields the clamp consults beyond `permissions` —
 *  the flags plus `name`, which scopes OWN-namespace custom-event grants
 *  (`<name>:<event>`). Type-only: erased at runtime, so it carries no
 *  instrumentable lines (the multi-line inline form tripped the patch
 *  coverage gate on type-continuation lines two instrumenters disagree on). */
type ClampManifestTopLevel = Pick<
  ExtensionManifestV2,
  "acceptsCallerCaps" | "escalateChildCaps"
> & { name?: string };

export function clampExtensionPermissions(
  submitted: Partial<ExtensionPermissions>,
  // The ceiling. Normally the manifest declaration, but the
  // reapprove/re-clamp path passes a prior GRANT (or the bundled
  // ceiling) here — so `search` must tolerate the three-state grant
  // shape (`false | "inherit" | {…}`), which is a superset of the
  // manifest's object-only declaration. `clampSearchPermission` already
  // normalizes every state.
  manifest: Omit<ExtensionManifestV2["permissions"], "search"> & {
    search?: ExtensionManifestV2["permissions"]["search"] | ExtensionPermissions["search"];
  },
  manifestTopLevel?: ClampManifestTopLevel,
): ExtensionPermissions {
  const clamped: ExtensionPermissions = { grantedAt: {} };

  if (submitted.hostApi && manifest.hostApi) {
    const routes = Array.isArray(submitted.hostApi.routes) && Array.isArray(manifest.hostApi.routes)
      ? submitted.hostApi.routes.filter((route) => route && typeof route.method === "string" && typeof route.path === "string" && manifest.hostApi!.routes.some((declared) => declared.method === route.method && declared.path === route.path)).map((route) => ({ method: route.method, path: route.path }))
      : [];
    const events = submitted.hostApi.events === true && manifest.hostApi.events === true;
    if (routes.length || events) clamped.hostApi = { routes, events };
  }

  if (submitted.network && manifest.network) {
    const allowed = submitted.network.filter((d) => manifest.network!.includes(d));
    if (allowed.length > 0) clamped.network = allowed;
  }
  for (const field of ["networkTcp", "secretRead"] as const) {
    if (submitted[field] && manifest[field]) {
      const allowed = [...new Set(submitted[field])].filter(value => manifest[field]!.includes(value));
      if (allowed.length) clamped[field] = allowed;
    }
  }

  if (submitted.filesystem && manifest.filesystem) {
    const allowed = submitted.filesystem.filter((p) => manifest.filesystem!.includes(p));
    if (allowed.length > 0) clamped.filesystem = allowed;
  }

  if (submitted.shell === true && manifest.shell === true) {
    clamped.shell = true;
  }

  if (submitted.env && manifest.env) {
    const allowed = submitted.env.filter((v) => manifest.env!.includes(v));
    if (allowed.length > 0) clamped.env = allowed;
  }

  if (submitted.storage === true && manifest.storage === true) {
    clamped.storage = true;
  }

  // mcpInvoke — the `kind:"mcp"` dispatch sentinel. THREE-state on purpose:
  //
  //   manifest doesn't declare it  → never granted (every non-MCP row)
  //   submitted === false          → REVOKED (the explicit off switch)
  //   submitted === true OR ABSENT → granted, mirroring the ceiling
  //
  // Absent-means-granted is the one departure from the "omitted key revokes"
  // default, and it is deliberate. The extension detail page's Save button
  // posts a FIXED six-key body (`network`/`filesystem`/`shell`/`env` + the two
  // deputy flags) — it cannot express this field. Under the usual default, an
  // admin editing an unrelated host list would silently strip the sentinel and
  // brick every tool on that MCP server. `search` already resolves the same
  // tension the same way (`clampSearchPermission`: `undefined → "inherit"`,
  // only an explicit `false` disables).
  //
  // The clamp's actual invariant — `granted ⊆ manifest` — is untouched: the
  // fallback is the CEILING, never something the manifest didn't declare, and
  // an explicit `false` still revokes.
  //
  // Placed OUTSIDE the `capabilityToolsDisabled()` guard, unlike the
  // capability-TOOL tier below, and that placement is load-bearing: this cap
  // is on the NEEDED side of every MCP dispatch, so dropping it under the
  // kill-switch would not disable a feature — it would DENY every MCP tool
  // call on the instance. `mcpInvoke` is correspondingly absent from
  // `CAPABILITY_PERMISSION_FIELDS`.
  if (manifest.mcpInvoke === true && submitted.mcpInvoke !== false) {
    clamped.mcpInvoke = true;
  }

  if (!capabilityToolsDisabled()) {
    if (submitted.taskEvents === true && manifest.taskEvents === true) {
      clamped.taskEvents = true;
    }
    if (submitted.loopEvents === true && manifest.loopEvents === true) {
      clamped.loopEvents = true;
    }
    if (submitted.appendMessages && manifest.appendMessages && typeof manifest.appendMessages.excludedDefault === "boolean" && submitted.appendMessages.excludedDefault === manifest.appendMessages.excludedDefault) {
      clamped.appendMessages = { excludedDefault: manifest.appendMessages.excludedDefault };
    }
    if (submitted.spawnAgents && manifest.spawnAgents) {
      // spawnAgents is a structured permission — both maxPerHour and
      // maxConcurrent must be present at grant time. The grant cannot
      // exceed the manifest's declared caps; clamp numerically.
      const submittedMax = submitted.spawnAgents;
      const manifestMax = manifest.spawnAgents;
      const hourly = Math.min(submittedMax.maxPerHour, manifestMax.maxPerHour);
      const concurrent = Math.min(
        submittedMax.maxConcurrent ?? manifestMax.maxConcurrent ?? 3,
        manifestMax.maxConcurrent ?? 3,
      );
      if (hourly > 0 && concurrent > 0) {
        clamped.spawnAgents = { maxPerHour: hourly, maxConcurrent: concurrent };
      }
    }
    if (submitted.agentConfig === "read" && manifest.agentConfig === "read") {
      clamped.agentConfig = "read";
    }
    // eventSubscriptions: normalize both manifest object form and
    // submitted array form to a plain string[] before intersecting.
    const manifestEvents = normalizeManifestEventSubscriptions(manifest.eventSubscriptions);
    const submittedEvents = Array.isArray(submitted.eventSubscriptions)
      ? submitted.eventSubscriptions
      : (submitted.eventSubscriptions && typeof submitted.eventSubscriptions === "object"
          && Array.isArray((submitted.eventSubscriptions as { events?: unknown }).events)
            ? (submitted.eventSubscriptions as { events: string[] }).events
            : undefined);
    if (Array.isArray(submittedEvents) && Array.isArray(manifestEvents)) {
      const manifestSet = new Set(manifestEvents);
      const allowed = submittedEvents.filter(
        (e) => typeof e === "string"
          && manifestSet.has(e)
          && isGrantableEventSubscription(e, manifestTopLevel?.name),
      );
      if (allowed.length > 0) clamped.eventSubscriptions = allowed;
    }

    // webhooks (Loops EZ Mode Phase 4): plain string[] slug intersection —
    // submitted ∩ manifest-declared. No direct-carrier allowlist (slugs are
    // author-chosen, not a fixed vocabulary); a slug survives only when the
    // manifest declares it, so a submitted grant can never introduce a hook
    // the author didn't author. An undeclared slug is silently dropped
    // (mirrors cron/event — the grant is never widened).
    if (Array.isArray(submitted.webhooks) && Array.isArray(manifest.webhooks)) {
      const manifestSet = new Set(manifest.webhooks);
      const allowed = submitted.webhooks.filter(
        (s) => typeof s === "string" && manifestSet.has(s),
      );
      if (allowed.length > 0) clamped.webhooks = allowed;
    }

    // workflows (W2): trigger grants for the extension's OWN shipped
    // workflows. Delegated to the canonical clamp helper — `undefined`
    // means either "manifest didn't declare it" or "the intersection was
    // empty", and both must leave the grant absent.
    const workflows = clampWorkflowsPermission(submitted.workflows, manifest.workflows);
    if (workflows) clamped.workflows = workflows;

    // triggers (C2): the DYNAMIC cron/webhook envelope. Separate from
    // `webhooks` above — that one intersects fixed author-chosen slugs;
    // this one bounds how many triggers the extension may mint at runtime.
    // `undefined` means "manifest didn't declare it" OR "the envelope
    // authorized nothing", and both must leave the grant absent.
    const triggers = clampTriggersPermission(submitted.triggers, manifest.triggers);
    if (triggers) clamped.triggers = triggers;

    // ── Phase 51 capability surfaces ────────────────────────────────
    // Delegate to the canonical clamp helpers above. Each helper returns
    // `undefined` when the manifest didn't declare the surface OR
    // when the clamp produced a no-op grant; only attach when defined.
    const llm = clampLlmPermission(
      submitted.llm,
      manifest.llm,
    );
    if (llm) clamped.llm = llm;

    const memory = clampMemoryPermission(
      submitted.memory,
      manifest.memory,
    );
    if (memory) clamped.memory = memory;

    const lessons = clampLessonsPermission(
      submitted.lessons,
      manifest.lessons,
    );
    if (lessons) clamped.lessons = lessons;

    const schedule = clampSchedulePermission(
      submitted.schedule,
      manifest.schedule,
    );
    if (schedule) clamped.schedule = schedule;

    // ctx.search (Phase 1). Unlike the others, `false` (search disabled)
    // is a VALID grant state — only `undefined` means "not declared" —
    // so attach on `!== undefined`.
    const search = clampSearchPermission(
      submitted.search,
      manifest.search,
    );
    if (search !== undefined) clamped.search = search;
  }

  // Phase 4 deputy / orchestration flags. Both are top-level manifest
  // declarations gated on user consent: an admin can grant TRUE only
  // when the manifest declared TRUE. Submission omitting or setting
  // the field to false leaves the grant absent (treated as opted-out
  // at runtime).
  if (
    submitted.acceptsCallerCaps === true &&
    manifestTopLevel?.acceptsCallerCaps === true
  ) {
    clamped.acceptsCallerCaps = true;
  }
  if (
    submitted.escalateChildCaps === true &&
    manifestTopLevel?.escalateChildCaps === true
  ) {
    clamped.escalateChildCaps = true;
  }

  // Preserve any prior grantedAt timestamps the caller passed for permissions
  // that survived clamping; stamp new ones below in the handler.
  if (submitted.grantedAt && typeof submitted.grantedAt === "object") {
    for (const [k, v] of Object.entries(submitted.grantedAt)) {
      if (typeof v === "number") clamped.grantedAt[k] = v;
    }
  }

  return clamped;
}
