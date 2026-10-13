/**
 * Capability discriminated union — single source of truth for the runtime
 * capability shape consumed by the Policy Decision Point
 * (`./permission-engine.ts`).
 *
 * Each `Capability` is a `{kind, value?}` pair. Comparisons go through
 * `intersect` and `isSubset` so capability-comparison logic lives in
 * exactly one place.
 *
 * Per phase-1 spec:
 *   - `network`  — `value` = lowercase hostname
 *   - `fs.*`     — `value` = absolute path
 *   - `shell`    — `value` = undefined (boolean today; per-command-prefix
 *                   allowlists are deferred)
 *   - `env`      — `value` = env var name
 *   - `storage`  — `value` = undefined (boolean)
 *   - `ezcorp:*` — namespaced caps (chat, agent config, spawn, tasks,
 *                   events). `value` is undefined for the boolean variants.
 *
 * Phase 2 will extend `capabilityDeclarationToSet` to substitute runtime
 * values from the tool's actual call args (URL host, fs path, etc.). In
 * Phase 1 it produces caps from the static declaration only; the resolver
 * `_args` parameter is reserved for that future work.
 */

import type { CapabilityDeclaration, ExtensionPermissions } from "./types";
import { expandGrantPrefix } from "./permissions";

export type CapabilityKind =
  | "ezcorp:api:request"
  | "ezcorp:api:events"
  | "network"
  | "network.tcp"
  | "secret.read"
  | "fs.read"
  | "fs.write"
  | "fs.list"
  | "fs.stat"
  | "shell"
  | "env"
  | "storage"
  | "ezcorp:chat:append"
  | "ezcorp:agent:config"
  | "ezcorp:agent:spawn"
  | "ezcorp:tasks:emit"
  | "ezcorp:loops:emit"
  | "ezcorp:events:subscribe"
  // Receive inbound webhook deliveries for a manifest-declared slug
  // (Loops EZ Mode Phase 4). One cap per granted slug (value = slug),
  // mirroring `ezcorp:events:subscribe`. The host routes an authenticated
  // `POST /api/hooks/:extensionId/:slug` onto the delivery queue only for
  // slugs whose cap the extension holds; undeclared slugs are dropped.
  | "ezcorp:webhooks:receive"
  // Trigger a run of a workflow the extension SHIPS (W2). One cap per
  // granted BARE workflow name (value = the bare name), mirroring
  // `ezcorp:events:subscribe` / `ezcorp:webhooks:receive`. The host
  // namespaces the name to `<extensionName>:<name>` before resolving, so
  // the cap value can only ever address the extension's own asset.
  | "ezcorp:workflows:run"
  // Fire a workflow the extension does NOT ship, as the human who
  // delegated it (C3, `ctx.workflows.runFor`). A SEPARATE kind from
  // `ezcorp:workflows:run` on purpose: that one is clamped to an
  // admin-approved list of the extension's OWN assets, and reusing it
  // for a delegated fire would mean relaxing exactly the per-name clamp
  // it exists to enforce.
  //
  // KIND-ONLY — deliberately carries NO value. The thing a delegated fire
  // is bound by is a `workflow_delegations` row keyed by `job_ref`, and
  // job refs are minted AFTER install by a human consent action, so an
  // install-time grant cannot enumerate them — the same reason
  // `ezcorp:triggers:register` is valued by the trigger KIND and not by
  // the host-minted slug. The install grant therefore answers exactly one
  // question ("may this extension use delegated runs at all?") and the
  // per-job bound is the delegation row, re-read on every fire and
  // revocable independently of the grant.
  | "ezcorp:workflows:run-delegated"
  // Register a DYNAMIC cron or webhook trigger at runtime (C2). One cap
  // PER KIND (value = "cron" | "webhook"), so an install can grant an
  // extension the right to mint schedules without also granting it inbound
  // HTTP hooks — the two carry very different exposure. Unlike
  // `ezcorp:webhooks:receive`, the value is NOT a slug: dynamic slugs are
  // host-minted at registration time and cannot be enumerated at grant time.
  | "ezcorp:triggers:register"
  // Install an authored extension draft. Sensitive + ALWAYS prompts
  // (even for the bundled extension-author) and is NEVER persisted as
  // an always-allow grant — see the carve-outs in
  // `permission-engine.ts`. Granted only via the existing
  // `custom.drafts.kinds:["extension"]` permission (bundled-only).
  | "ezcorp:extension:install"
  // Re-open a user-owned, admin-`modifiable` installed extension as an
  // editable draft. Sensitive + ALWAYS prompts + NEVER persisted, same
  // as install — the "LLM can't silently rewrite my extension" consent
  // gate. The host `reopen` action separately enforces owner + flag +
  // not-bundled authorization (defense in depth).
  | "ezcorp:extension:modify"
  // Invoke a tool served by a `kind:"mcp"` extension. The SENTINEL that
  // keeps the PDP from going inert on an MCP dispatch.
  //
  // KIND-ONLY, like `ezcorp:workflows:run-delegated`: `validateMcpManifest`
  // admits exactly one `mcpServers` entry per manifest and the grant lives on
  // that extension's own row, so the extension id already scopes the decision
  // and a value would add no bound.
  //
  // Why it has to exist: an MCP tool's only other declared capability is
  // `network`, and `deriveCapsFromExtensionPerms` skips an EMPTY host array.
  // A stdio server whose command line names no host — the most common shape
  // — therefore declared `capabilities: {}`, which flattens to an EMPTY
  // needed set, and `firstMissingCapability([], granted)` is null for ANY
  // grant. An admin's revocation was a silent no-op. Every MCP tool now needs
  // this cap, hostless or not, so a revocation always bites.
  | "ezcorp:mcp:invoke";

export interface Capability {
  kind: CapabilityKind;
  value?: string;
}

export type CapabilitySet = readonly Capability[];

/**
 * Sensitive caps (Phase 1). When `needed` includes any of these AND
 * always-allow is not set for the (user, scope, scopeId, capability)
 * tuple, the engine returns `prompt`. Phase 6 will wire the UI; Phase 1
 * treats `prompt` as `allow` to avoid behavioral regression.
 */
export const SENSITIVE_KINDS: ReadonlySet<CapabilityKind> = new Set<SensitiveCapabilityKind>([
  "shell",
  "fs.write",
  // Installing model-authored code that then runs with its declared
  // permissions is the strongest trust boundary in the system — gate
  // it like the other sensitive caps so the engine returns `prompt`.
  "ezcorp:extension:install",
  // Same trust class as install: re-opening an installed extension for
  // edit is the entry point to rewriting model-authored code, so it
  // prompts every time and is never an always-allow grant.
  "ezcorp:extension:modify",
]);

/** A capability the PDP may `prompt` for; named as-is in the user's prompt. */
export type SensitiveCapabilityKind =
  | "shell"
  | "fs.write"
  | "ezcorp:extension:install"
  | "ezcorp:extension:modify";

// DELIBERATE OMISSION — `ezcorp:mcp:invoke` is NOT sensitive.
//
// A sensitive kind returns `prompt` (permission-engine.ts step 3), and
// `prompt` is unanswerable wherever nobody is present to answer it. MCP tools
// are dispatched from cron fires, webhook deliveries and workflow `tool`
// steps as readily as from chat, so marking this kind sensitive would park
// those runs at `awaiting_approval` forever — it would convert a governance
// gate into an availability bug. `shell` is the vocabulary's honest word for
// "the host runs an operator-supplied local binary", and it was rejected as
// the sentinel for exactly this reason.
//
// The consent that IS collected is per-install and admin-gated: the row is
// installed through an admin-only route, the grant is recorded in
// `installedPermissions`, and it is revocable at any time via
// `PUT /api/extensions/[id]/permissions`. A revocation denies every
// subsequent dispatch with a normal `ext:perm:denied` row — which is the
// whole point of the kind.
//
// WHAT WOULD REOPEN THIS: an MCP dispatch path that is reachable ONLY with a
// live human attached. There isn't one today, and adding a prompt would not
// bound anything the install grant doesn't already bound.

// DELIBERATE OMISSION — `ezcorp:workflows:run` is NOT sensitive.
//
// Three reasons, in decreasing order of weight:
//
//   1. It cannot launder a sensitive capability. A workflow run registers
//      its own non-interactive scope (`beginNonInteractiveScope` in
//      `workflow-executor.ts`), so any `tool` step inside it that needs
//      `shell` / `fs.write` / `ezcorp:extension:install` still hits the PDP
//      and still fails CLOSED — the run terminalizes `awaiting_approval`
//      rather than executing. Triggering a workflow therefore grants
//      strictly nothing the extension could not already reach; it only
//      sequences calls that are each independently gated.
//   2. Consent is already collected, per-name, at install. The grant is
//      `{names, maxRunsPerHour}` clamped to the manifest declaration, so an
//      admin approves a FIXED, reviewable list of workflows the extension
//      itself ships — not an open-ended "run anything" verb. `prompt` adds
//      no information a reviewer didn't already have.
//   3. Always-prompt would make the capability unusable for its only
//      purpose. The `ezcorp/workflows` handler refuses ownerless (cron /
//      webhook) fires outright, and the remaining in-chat path would gain a
//      modal per trigger for a call whose blast radius is already bounded by
//      (1) and (2).
//
// The bound that DOES exist is the per-hour rate limit on the grant, which
// caps LLM spend from `agent` steps. If a future step kind can reach a side
// effect that is NOT independently PDP-gated, revisit this decision first.
//
// ── P2 · C3 CHECKED THE REVISIT CONDITION ABOVE. The answer HELD. ──────
//
// C3 (delegated execution) adds `ezcorp:workflows:run-delegated`, which is
// ALSO deliberately absent from `SENSITIVE_KINDS`. That is a decision, not
// an oversight, and the standing instruction on the line above is what
// obliged this note. Recorded here so a future reader never has to
// re-derive it — and grep-tested, so the check cannot be quietly dropped.
//
// The trigger condition is "a step kind that reaches a side effect that is
// NOT independently PDP-gated". C3 introduces NO step kind at all. A
// delegated run is the same executor over the same step kinds; the only
// thing C3 changes is WHOSE identity the run carries. Reason 1 above is
// therefore untouched: the run still registers its own non-interactive
// scope, so a `tool` step inside it that needs `shell` / `fs.write` /
// `ezcorp:extension:install` still hits the PDP and still fails CLOSED.
//
// Reason 2 (consent collected per-name at install) does NOT survive
// unchanged — a delegated fire reaches a workflow the extension never
// shipped, so no manifest name list can bound it. It is REPLACED, and by
// something narrower on every axis that matters: one workflow rather than
// a list, pinned to a definition version, bound to a capability-set hash,
// revocable, and attached to a named human who consented. The install
// grant contributes only the boolean opt-in
// (`permissions.workflows.allowDelegated`); it authorizes no job by
// itself.
//
// Reason 3 (prompting is structurally impossible) is STRONGER here, not
// weaker: a delegated fire is a background cron/webhook tick by
// construction, so an always-prompt kind would be an unanswerable modal
// with nobody present to answer it.
//
// WHAT WOULD REOPEN THIS: a delegated run that does NOT register the
// non-interactive scope, or any path that lets a delegated run's `tool`
// step skip the PDP. Either one breaks reason 1, and reason 1 is the only
// thing holding this up.

/** Lowercase, trimmed key for set-keyed comparison. */
function keyOf(c: Capability): string {
  return `${c.kind}::${c.value ?? ""}`;
}

/**
 * Set intersection: caps present in BOTH a and b. Used by Phase 4's
 * cross-extension confused-deputy gate (`callerCaps ∩ calleeCaps`).
 *
 * Comparison is by `(kind, value)` exact match. Hostname normalization
 * (lowercase) and path normalization are the caller's responsibility.
 */
export function intersect(a: CapabilitySet, b: CapabilitySet): CapabilitySet {
  const seen = new Set(b.map(keyOf));
  const out: Capability[] = [];
  const dedup = new Set<string>();
  for (const c of a) {
    const k = keyOf(c);
    if (seen.has(k) && !dedup.has(k)) {
      dedup.add(k);
      out.push(c);
    }
  }
  return out;
}

/**
 * Subset check: every cap in `needed` is present in `granted`. The PDP
 * uses this to decide allow vs deny.
 *
 * Path-prefix semantics for fs.* caps: a granted cap with `value=/foo`
 * covers a needed cap with `value=/foo/bar`. Hostname matching for
 * `network` is exact (Phase 2 may relax to suffix-match).
 */
export function isSubset(needed: CapabilitySet, granted: CapabilitySet): boolean {
  for (const n of needed) {
    if (!granted.some((g) => capabilityCovers(g, n))) return false;
  }
  return true;
}

/**
 * Does granted-cap `g` cover required-cap `n`? Encapsulates the
 * per-kind matching semantics so `intersect`/`isSubset` stay simple.
 */
export function capabilityCovers(g: Capability, n: Capability): boolean {
  if (g.kind !== n.kind) return false;

  // Boolean caps (no value): kind match is enough.
  if (g.value === undefined && n.value === undefined) return true;
  if (g.value === undefined || n.value === undefined) return false;

  // Filesystem prefix-match: `/foo` covers `/foo` and `/foo/bar/baz` but
  // NOT `/foobar`. Mirrors `checkFilesystemPermission`'s prefix logic.
  if (g.kind === "fs.read" || g.kind === "fs.write" || g.kind === "fs.list" || g.kind === "fs.stat") {
    return n.value === g.value || n.value.startsWith(g.value + "/");
  }

  // Network / env / namespaced caps: exact value match.
  return g.value === n.value;
}

/**
 * Find the first needed-cap not covered by granted. Used by the engine
 * to produce a deny reason that names the missing cap.
 */
export function firstMissingCapability(
  needed: CapabilitySet,
  granted: CapabilitySet,
): Capability | null {
  for (const n of needed) {
    if (!granted.some((g) => capabilityCovers(g, n))) return n;
  }
  return null;
}

/**
 * Translate a tool's manifest-level `CapabilityDeclaration` (declared at
 * authoring time, structurally typed in `./types.ts`) plus the actual
 * call args into a flat `CapabilitySet`.
 *
 * Phase 1 only handles the static-declaration path — `_args` is unused
 * but reserved for Phase 2, which will substitute runtime values
 * (URL host extracted from a fetch arg, fs.path normalized to its
 * realpath, etc.).
 */
export function capabilityDeclarationToSet(
  decl: CapabilityDeclaration | undefined,
  _args: Record<string, unknown>,
  /** Acting user, for a `$USER` path segment. Load-bearing: a v2
   *  manifest's per-tool declaration is SYNTHESIZED from the
   *  extension-wide grant by `migrateManifestV2ToV3`, so a
   *  user-partitioned grant lands here too. Expand it with the same
   *  identity the granted side uses or the needed cap can never be
   *  covered and every call is denied. */
  actingUserId?: string | null,
): CapabilitySet {
  if (!decl) return [];
  const caps: Capability[] = [];

  if (decl.network?.hosts) {
    for (const host of decl.network.hosts) {
      caps.push({ kind: "network", value: host.toLowerCase() });
    }
  }

  if (decl.filesystem?.paths) {
    const modes = decl.filesystem.mode ?? [];
    const wantsRead = modes.includes("read");
    const wantsWrite = modes.includes("write");
    for (const path of decl.filesystem.paths) {
      // Same `$CWD` expansion as the granted-cap side above so the
      // PDP's needed↔granted comparison stays consistent. A tool that
      // declares `filesystem.paths: ["$CWD"]` for its required cap must
      // match a grant for the same logical root, not the literal string.
      const expanded = expandGrantPrefix(path, actingUserId);
      // Default to read+list+stat when no mode is set (most permissive
      // read-only), matching the migration's read-only default.
      if (wantsRead || modes.length === 0) {
        caps.push({ kind: "fs.read", value: expanded });
        caps.push({ kind: "fs.list", value: expanded });
        caps.push({ kind: "fs.stat", value: expanded });
      }
      if (wantsWrite) {
        caps.push({ kind: "fs.write", value: expanded });
      }
    }
  }

  if (decl.shell === true) {
    caps.push({ kind: "shell" });
  }

  if (decl.env) {
    for (const name of decl.env) {
      caps.push({ kind: "env", value: name });
    }
  }

  if (decl.storage === true) {
    caps.push({ kind: "storage" });
  }

  // Namespaced custom caps. Translate `appendMessages`/`agentConfig`/
  // `taskEvents`/`loopEvents`/`spawnAgents`/`eventSubscriptions` boolean
  // keys to their `ezcorp:*` form. Other keys are dropped (unknown —
  // Phase 6 will widen this).
  if (decl.custom) {
    for (const [key, val] of Object.entries(decl.custom)) {
      const kind = customToKind(key);
      if (!kind) continue;
      if (Array.isArray(val)) {
        for (const v of val) caps.push({ kind, value: v });
      } else if (val === true) {
        caps.push({ kind });
      }
    }
  }

  return caps;
}

/**
 * Intersect two `ExtensionPermissions` shapes (manifest-level), the way
 * Phase 4's spawn-assignment uses to clip a child conversation's grants
 * by the parent's effective grants. Mirrors the semantics of
 * `intersect(CapabilitySet)` but stays at the manifest-permissions
 * level so callers can persist the result back into
 * `conversation_extensions.effective_granted_permissions` without an
 * intermediate flatten/lift step.
 *
 * Per-field rules:
 *   • `network`     — array intersection, lowercased + deduped
 *   • `filesystem`  — path-prefix intersection: a path survives only
 *                     when it has a covering prefix in BOTH sides
 *                     (mirrors `capabilityCovers` for `fs.*`)
 *   • `shell`       — boolean AND
 *   • `env`         — array intersection
 *   • `storage`     — boolean AND
 *   • `taskEvents`  — boolean AND
 *   • `loopEvents`  — boolean AND
 *   • `agentConfig` — both sides "read" → "read", else absent
 *   • `spawnAgents` — min(maxPerHour) + min(maxConcurrent), absent if
 *                     either side absent (the more restrictive wins)
 *   • `appendMessages` — both sides present + AND on `excludedDefault`
 *   • `eventSubscriptions` — array intersection
 *   • `webhooks` — array intersection (hook slugs)
 *
 * `grantedAt` is rebuilt from the keys that survived intersection,
 * preferring the OLDER timestamp of either side so an audit trail
 * can't reset its issue date by intersection. The result has `grantedAt`
 * with only the keys that survived — empty `{}` when nothing did.
 */
export function intersectPermissions(
  a: ExtensionPermissions,
  b: ExtensionPermissions,
): ExtensionPermissions {
  const out: ExtensionPermissions = { grantedAt: {} };
  if (a.hostApi && b.hostApi) {
    const routes = a.hostApi.routes.filter((route) => b.hostApi!.routes.some((other) => route.method === other.method && route.path === other.path));
    const events = a.hostApi.events === true && b.hostApi.events === true;
    if (routes.length || events) out.hostApi = { routes, events };
  }

  // network — array intersection (lowercased)
  if (a.network && b.network) {
    const bSet = new Set(b.network.map((h) => h.toLowerCase()));
    const seen = new Set<string>();
    const list: string[] = [];
    for (const h of a.network) {
      const k = h.toLowerCase();
      if (bSet.has(k) && !seen.has(k)) {
        seen.add(k);
        list.push(k);
      }
    }
    if (list.length > 0) out.network = list;
  }

  if (a.networkTcp && b.networkTcp) {
    const allowed = new Set(b.networkTcp);
    const destinations = [...new Set(a.networkTcp)].filter(destination => allowed.has(destination));
    if (destinations.length) out.networkTcp = destinations;
  }
  if (a.secretRead && b.secretRead) {
    const names = [...new Set(a.secretRead)].filter(name => b.secretRead!.includes(name));
    if (names.length) out.secretRead = names;
  }

  // filesystem — path-prefix intersection (a path survives if it's in
  // BOTH allowlists' prefix-cover relations). The narrower of two
  // prefix-overlapping paths wins (e.g. `/foo` vs `/foo/bar` →
  // `/foo/bar`).
  if (a.filesystem && b.filesystem) {
    const survivors = new Set<string>();
    const covers = (g: string, n: string) =>
      g === n || n.startsWith(g + "/");
    for (const pa of a.filesystem) {
      for (const pb of b.filesystem) {
        if (covers(pa, pb)) survivors.add(pb);
        else if (covers(pb, pa)) survivors.add(pa);
      }
    }
    if (survivors.size > 0) out.filesystem = [...survivors];
  }

  // shell — boolean AND
  if (a.shell === true && b.shell === true) {
    out.shell = true;
  }

  // env — array intersection
  if (a.env && b.env) {
    const bSet = new Set(b.env);
    const seen = new Set<string>();
    const list: string[] = [];
    for (const e of a.env) {
      if (bSet.has(e) && !seen.has(e)) {
        seen.add(e);
        list.push(e);
      }
    }
    if (list.length > 0) out.env = list;
  }

  // storage — boolean AND
  if (a.storage === true && b.storage === true) {
    out.storage = true;
  }

  // mcpInvoke — boolean AND. A spawned child conversation whose parent lacks
  // the sentinel cannot reach the parent's MCP tools, which is the correct
  // clip: this is the cap the dispatch gate reads.
  if (a.mcpInvoke === true && b.mcpInvoke === true) {
    out.mcpInvoke = true;
  }

  // taskEvents — boolean AND
  if (a.taskEvents === true && b.taskEvents === true) {
    out.taskEvents = true;
  }

  // loopEvents — boolean AND
  if (a.loopEvents === true && b.loopEvents === true) {
    out.loopEvents = true;
  }

  // agentConfig — both must be "read" for "read" to survive
  if (a.agentConfig === "read" && b.agentConfig === "read") {
    out.agentConfig = "read";
  }

  // spawnAgents — both sides must declare; take the min of each
  // numeric ceiling so the more restrictive wins.
  if (a.spawnAgents && b.spawnAgents) {
    const hourly = Math.min(a.spawnAgents.maxPerHour, b.spawnAgents.maxPerHour);
    const concurrentA = a.spawnAgents.maxConcurrent;
    const concurrentB = b.spawnAgents.maxConcurrent;
    let concurrent: number | undefined;
    if (concurrentA !== undefined && concurrentB !== undefined) {
      concurrent = Math.min(concurrentA, concurrentB);
    } else if (concurrentA !== undefined) {
      concurrent = concurrentA;
    } else if (concurrentB !== undefined) {
      concurrent = concurrentB;
    }
    if (hourly > 0) {
      out.spawnAgents = concurrent !== undefined
        ? { maxPerHour: hourly, maxConcurrent: concurrent }
        : { maxPerHour: hourly };
    }
  }

  // appendMessages — both sides must declare; OR on `excludedDefault`
  // (force-exclude wins on either side). This is the correct CLIP
  // semantics for a "default exclude this turn from history" toggle:
  // intersection should never RELAX a restriction. If EITHER side
  // says "exclude by default", the result excludes; AND would have
  // let `false ∩ true → false` accidentally publish turns the more
  // restrictive side wanted to hide.
  if (a.appendMessages && b.appendMessages) {
    out.appendMessages = {
      excludedDefault:
        a.appendMessages.excludedDefault === true ||
        b.appendMessages.excludedDefault === true,
    };
  }

  // eventSubscriptions — array intersection (case-sensitive event names)
  if (a.eventSubscriptions && b.eventSubscriptions) {
    const bSet = new Set(b.eventSubscriptions);
    const seen = new Set<string>();
    const list: string[] = [];
    for (const e of a.eventSubscriptions) {
      if (bSet.has(e) && !seen.has(e)) {
        seen.add(e);
        list.push(e);
      }
    }
    if (list.length > 0) out.eventSubscriptions = list;
  }

  // webhooks — array intersection (case-sensitive hook slugs). Same clip
  // semantics as eventSubscriptions: a slug survives only when BOTH sides
  // declare it, so a child conversation can never receive a hook the parent
  // grant lacks.
  if (a.webhooks && b.webhooks) {
    const bSet = new Set(b.webhooks);
    const seen = new Set<string>();
    const list: string[] = [];
    for (const s of a.webhooks) {
      if (bSet.has(s) && !seen.has(s)) {
        seen.add(s);
        list.push(s);
      }
    }
    if (list.length > 0) out.webhooks = list;
  }

  // workflows (W2) — name-list intersection + the NARROWER rate ceiling.
  // Same clip semantics as eventSubscriptions/webhooks: a workflow name
  // survives only when BOTH sides declare it, so a child conversation (or a
  // bundled-ceiling clamp) can never introduce a trigger the other side
  // lacks. An empty intersection drops the grant entirely rather than
  // leaving a `{names: []}` husk that would read as "granted" to a
  // presence check. `maxRunsPerHour` is REQUIRED on both sides by the
  // granted type, so `Math.min` here can never see `undefined` — that is
  // exactly the `Math.min(NaN, …)` trap documented on `schedule` in
  // `bundled-ceiling.ts`, closed at the type level.
  if (a.workflows && b.workflows) {
    const bNames = new Set(b.workflows.names);
    const seen = new Set<string>();
    const names: string[] = [];
    for (const n of a.workflows.names) {
      if (bNames.has(n) && !seen.has(n)) {
        seen.add(n);
        names.push(n);
      }
    }
    // C3 — the delegated opt-in survives only when BOTH sides carry it,
    // exactly like every name above. It is what lets a NAME-LESS grant
    // survive the intersection: without this the empty-name drop below
    // would delete a delegated-only grant on every ceiling clamp and
    // every parent→child narrowing, which is the same D-3 defect the
    // clamp had.
    const allowDelegated =
      a.workflows.allowDelegated === true && b.workflows.allowDelegated === true;
    if (names.length > 0 || allowDelegated) {
      out.workflows = {
        names,
        maxRunsPerHour: Math.min(a.workflows.maxRunsPerHour, b.workflows.maxRunsPerHour),
        ...(allowDelegated ? { allowDelegated: true } : {}),
      };
    }
  }

  // triggers (C2) — the NARROWER of every bound. Survives only when both
  // sides declare it. `webhookPrefix` is NOT intersected or merged: it is a
  // namespace claim, so when the two sides disagree the grant is dropped
  // outright rather than picking a winner — silently minting future slugs
  // under the other side's namespace is the failure this avoids. Every
  // numeric field is REQUIRED on the granted type, so `Math.min` here can
  // never see `undefined` (the `Math.min(NaN, …)` trap documented on
  // `schedule` in `bundled-ceiling.ts`, closed at the type level).
  if (a.triggers && b.triggers && a.triggers.webhookPrefix === b.triggers.webhookPrefix) {
    out.triggers = {
      maxCron: Math.min(a.triggers.maxCron, b.triggers.maxCron),
      maxWebhooks: Math.min(a.triggers.maxWebhooks, b.triggers.maxWebhooks),
      webhookPrefix: a.triggers.webhookPrefix,
      maxRunsPerDay: Math.min(a.triggers.maxRunsPerDay, b.triggers.maxRunsPerDay),
    };
  }

  // ── Phase 53 capability tiers (`llm`, `memory`, `lessons`, `schedule`).
  // These survive when both sides declare them. Bundled extension
  // ceilings are written in `bundled-ceiling.ts` to mirror the install
  // grant verbatim, so the intersection should be a no-op for the
  // happy path. The intersection rule is "narrower of the two" on
  // each numeric ceiling and "intersection of provider/category lists"
  // on the array fields. Today only bundled extensions reach this
  // code path through `clampToBundledCeiling`, but the rule is
  // future-proof for user-installed exts that gain LLM access.
  if (a.llm && b.llm) {
    // Provider intersection — both sides always have `providers` (required
    // on the granted shape). Empty intersection is allowed (zero providers
    // means "no LLM access", a valid clamped state).
    const aProviders = new Set(a.llm.providers);
    const providers = b.llm.providers.filter((p) => aProviders.has(p));
    const llmOut: NonNullable<ExtensionPermissions["llm"]> = {
      providers,
      maxCallsPerHour: Math.min(a.llm.maxCallsPerHour, b.llm.maxCallsPerHour),
      maxCallsPerDay: Math.min(a.llm.maxCallsPerDay, b.llm.maxCallsPerDay),
    };
    // Optional numeric ceilings — narrower of the two when both present,
    // pass-through when only one side declares.
    const tokensPerCall =
      a.llm.maxTokensPerCall !== undefined && b.llm.maxTokensPerCall !== undefined
        ? Math.min(a.llm.maxTokensPerCall, b.llm.maxTokensPerCall)
        : (a.llm.maxTokensPerCall ?? b.llm.maxTokensPerCall);
    if (tokensPerCall !== undefined) llmOut.maxTokensPerCall = tokensPerCall;
    if (a.llm.allowedModels || b.llm.allowedModels) {
      llmOut.allowedModels = intersectAllowedModels(a.llm.allowedModels, b.llm.allowedModels);
    }
    out.llm = llmOut;
  }
  if (a.memory && b.memory) {
    out.memory = {
      access: a.memory.access === "write" && b.memory.access === "write" ? "write" : "read",
      maxWritesPerDay: Math.min(a.memory.maxWritesPerDay, b.memory.maxWritesPerDay),
      // selfOnly is OR — the more restrictive setting wins (false ∩
      // true → true, the safer default for any user-installed
      // extension reaching this path). Bundled-only `selfOnly: false`
      // is preserved when BOTH sides explicitly opt out (memory-extractor's
      // ceiling matches its declaration verbatim — see bundled-ceiling.ts).
      selfOnly: a.memory.selfOnly || b.memory.selfOnly,
      ...(a.memory.categories && b.memory.categories
        ? {
            categories: a.memory.categories.filter((c) => b.memory!.categories!.includes(c)),
          }
        : a.memory.categories
          ? { categories: a.memory.categories }
          : b.memory.categories
            ? { categories: b.memory.categories }
            : {}),
    };
  }
  if (a.lessons && b.lessons) {
    out.lessons = {
      access: a.lessons.access === "write" && b.lessons.access === "write" ? "write" : "read",
      maxWritesPerDay: Math.min(a.lessons.maxWritesPerDay, b.lessons.maxWritesPerDay),
      maxVisibility:
        a.lessons.maxVisibility === "project" && b.lessons.maxVisibility === "project"
          ? "project"
          : "user",
    };
  }
  if (a.schedule && b.schedule) {
    // Crons must be the same set (or a strict intersection); for a
    // bundled-ceiling clamp the ceiling mirrors the install verbatim,
    // so the intersection equals the input. For other callers we
    // intersect by exact-match.
    const crons = a.schedule.crons.filter((c) => b.schedule!.crons.includes(c));
    out.schedule = {
      crons,
      maxRunsPerDay: Math.min(a.schedule.maxRunsPerDay, b.schedule.maxRunsPerDay),
      maxRunDurationMs: Math.min(a.schedule.maxRunDurationMs, b.schedule.maxRunDurationMs),
      // Tighter missed-run policy wins: skip < fire-once < fire-all.
      missedRunPolicy: tighterMissedRunPolicy(a.schedule.missedRunPolicy, b.schedule.missedRunPolicy),
      maxRetries: Math.min(a.schedule.maxRetries, b.schedule.maxRetries),
    };
  }

  // search — the §3.1 three-state grant (`"inherit" | {…} | false`).
  // Intersection is "more restrictive wins": `false` on EITHER side
  // disables; `"inherit"` ∩ `"inherit"` stays `"inherit"`; an object on
  // either side narrows (numeric MIN, provider-list intersection,
  // `"inherit"` providers yield to an explicit list). For the bundled
  // web-search ceiling (`search: "inherit"`, the full grant) the
  // intersection is a no-op on the happy path.
  if (a.search !== undefined && b.search !== undefined) {
    out.search = intersectSearch(a.search, b.search);
  }

  // custom — namespaced capability bag. Today the only registered key
  // is `drafts: { kinds: string[] }` used by `extension-author`. The
  // intersection rule is: a `kinds` array survives only when BOTH sides
  // declare it, and the result is the array intersection. Unknown keys
  // pass through when both sides declare them (defensive default —
  // future custom capabilities will spell out their own clamp rules).
  if (a.custom && b.custom) {
    const customOut: NonNullable<ExtensionPermissions["custom"]> = {};
    if (a.custom.drafts && b.custom.drafts) {
      const aKinds = new Set(a.custom.drafts.kinds);
      const kinds = b.custom.drafts.kinds.filter((k) => aKinds.has(k));
      if (kinds.length > 0) customOut.drafts = { kinds };
    }
    if (Object.keys(customOut).length > 0) out.custom = customOut;
  }

  // grantedAt — keep keys whose corresponding permission survived;
  // prefer the older grant timestamp (more conservative audit trail).
  const aAt = a.grantedAt ?? {};
  const bAt = b.grantedAt ?? {};
  for (const key of Object.keys({ ...aAt, ...bAt })) {
    const survived =
      (key === "network" && out.network) ||
      (key === "networkTcp" && out.networkTcp) ||
      (key === "secretRead" && out.secretRead) ||
      (key === "filesystem" && out.filesystem) ||
      (key === "shell" && out.shell) ||
      (key === "env" && out.env) ||
      (key === "storage" && out.storage) ||
      (key === "mcpInvoke" && out.mcpInvoke) ||
      (key === "taskEvents" && out.taskEvents) ||
      (key === "loopEvents" && out.loopEvents) ||
      (key === "agentConfig" && out.agentConfig) ||
      (key === "spawnAgents" && out.spawnAgents) ||
      (key === "appendMessages" && out.appendMessages) ||
      (key === "eventSubscriptions" && out.eventSubscriptions) ||
      (key === "webhooks" && out.webhooks) ||
      (key === "workflows" && out.workflows) ||
      (key === "triggers" && out.triggers) ||
      (key === "llm" && out.llm) ||
      (key === "memory" && out.memory) ||
      (key === "lessons" && out.lessons) ||
      (key === "schedule" && out.schedule) ||
      (key === "search" && out.search !== undefined) ||
      (key === "custom" && out.custom);
    if (!survived) continue;
    const ta = typeof aAt[key] === "number" ? aAt[key] : undefined;
    const tb = typeof bAt[key] === "number" ? bAt[key] : undefined;
    if (ta !== undefined && tb !== undefined) {
      out.grantedAt[key] = Math.min(ta, tb);
    } else if (ta !== undefined) {
      out.grantedAt[key] = ta;
    } else if (tb !== undefined) {
      out.grantedAt[key] = tb;
    }
  }

  return out;
}

/**
 * Intersect two `search` grant states (the §3.1 `"inherit" | {…} |
 * false` shape). "More restrictive wins":
 *   - `false` on either side → `false` (disabled).
 *   - both `"inherit"` → `"inherit"` (track instance defaults).
 *   - any object present → object result with field-level MINs; an
 *     `"inherit"` provider list yields to the other side's explicit list,
 *     and two explicit lists intersect.
 */
function intersectSearch(
  a: NonNullable<ExtensionPermissions["search"]>,
  b: NonNullable<ExtensionPermissions["search"]>,
): ExtensionPermissions["search"] {
  if (a === false || b === false) return false;
  if (a === "inherit" && b === "inherit") return "inherit";

  const ao = a === "inherit" ? {} : a;
  const bo = b === "inherit" ? {} : b;
  const out: NonNullable<Exclude<ExtensionPermissions["search"], "inherit" | false>> = {};

  const quota = minDefined(ao.quota, bo.quota);
  if (quota !== undefined) out.quota = quota;
  const maxResults = minDefined(ao.maxResults, bo.maxResults);
  if (maxResults !== undefined) out.maxResults = maxResults;

  const providers = intersectSearchProviders(ao.providers, bo.providers);
  if (providers !== undefined) out.providers = providers;

  return out;
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a !== undefined && b !== undefined) return Math.min(a, b);
  return a ?? b;
}

function intersectSearchProviders(
  a: string[] | "inherit" | undefined,
  b: string[] | "inherit" | undefined,
): string[] | "inherit" | undefined {
  // Two explicit lists → intersection.
  if (Array.isArray(a) && Array.isArray(b)) {
    const bSet = new Set(b);
    return a.filter((p) => bSet.has(p));
  }
  // One explicit list, the other inherit/absent → the explicit list wins
  // (the narrower, concrete bound).
  if (Array.isArray(a)) return a;
  if (Array.isArray(b)) return b;
  // Neither explicit: `"inherit"` if either declared it, else undefined.
  if (a === "inherit" || b === "inherit") return "inherit";
  return undefined;
}

/**
 * Translate an `ExtensionPermissions` install-time GRANT blob into a
 * `CapabilitySet` for runtime intersection. Phase 4's `handlePiInvoke`
 * uses this on both caller and callee grants before computing
 * `intersect(callerCaps, calleeCaps)` so the PDP gates against what the
 * user actually authorized, not the manifest's declaration.
 *
 * Mirrors the semantics of `capabilityDeclarationToSet` but consumes
 * the `ExtensionPermissions` shape (flat arrays + booleans + structured
 * spawn fields) instead of `CapabilityDeclaration` (nested objects).
 *
 * Filesystem mode is treated as read+write at the runtime layer because
 * the v2 `permissions.filesystem` grant didn't separate modes — Phase 1
 * already encoded that as `["read","write"]` in
 * `migrateManifestV2ToV3`. v3 callers that want narrower modes pass
 * them via the per-tool `capabilities` declaration which the PDP
 * already enforces.
 */
export function hostApiRouteCapability(route: { method: string; path: string }): Capability {
  return { kind: "ezcorp:api:request", value: `${route.method} ${route.path}` };
}

export function grantsToCapabilitySet(
  grants: ExtensionPermissions | null,
  /** The user the authorization is for. A `$USER` grant segment expands
   *  to it (see `permissions.ts:expandGrantPrefix`); omitting it makes
   *  such a grant match nothing, so the PDP denies. Grants without
   *  `$USER` are unaffected. */
  actingUserId?: string | null,
): CapabilitySet {
  if (!grants) return [];
  const caps: Capability[] = [];
  if (grants.hostApi) {
    caps.push(...grants.hostApi.routes.map(hostApiRouteCapability));
    if (grants.hostApi.events) caps.push({ kind: "ezcorp:api:events" });
  }

  if (grants.network) {
    for (const host of grants.network) {
      caps.push({ kind: "network", value: host.toLowerCase() });
    }
  }

  for (const destination of grants.networkTcp ?? []) caps.push({ kind: "network.tcp", value: destination });
  for (const name of grants.secretRead ?? []) caps.push({ kind: "secret.read", value: name });

  if (grants.filesystem) {
    for (const path of grants.filesystem) {
      // Expand `$CWD` (and `$CWD/<sub>`) at grant→cap translation time.
      // The fs-handler authorizes against the realpath-resolved absolute
      // path (see `fs-handler.ts:549` — `value: result.resolvedPath`),
      // so a literal `$CWD` cap value never prefix-matches the resolved
      // absolute path and the PDP wrongly denies a write that the
      // fs-handler's own pre-PDP `checkFilesystemPermission` already
      // approved (which DOES expand `$CWD`). Expanding here closes the
      // mirror gap so the PDP and fs-handler agree on what `$CWD` means.
      const expanded = expandGrantPrefix(path, actingUserId);
      caps.push({ kind: "fs.read", value: expanded });
      caps.push({ kind: "fs.list", value: expanded });
      caps.push({ kind: "fs.stat", value: expanded });
      caps.push({ kind: "fs.write", value: expanded });
    }
  }

  if (grants.shell === true) {
    caps.push({ kind: "shell" });
  }

  if (grants.env) {
    for (const name of grants.env) {
      caps.push({ kind: "env", value: name });
    }
  }

  if (grants.storage === true) {
    caps.push({ kind: "storage" });
  }

  // The MCP dispatch sentinel. Emitted only on an explicit `=== true`, so
  // every grant blob written before this kind existed produces a
  // byte-identical capability set — and a legacy MCP row whose grant was
  // never healed fails CLOSED rather than inheriting the cap by omission.
  if (grants.mcpInvoke === true) {
    caps.push({ kind: "ezcorp:mcp:invoke" });
  }

  if (grants.taskEvents === true) {
    caps.push({ kind: "ezcorp:tasks:emit" });
  }

  if (grants.loopEvents === true) {
    caps.push({ kind: "ezcorp:loops:emit" });
  }

  if (grants.agentConfig === "read") {
    caps.push({ kind: "ezcorp:agent:config" });
  }

  if (grants.spawnAgents) {
    caps.push({ kind: "ezcorp:agent:spawn" });
  }

  if (grants.eventSubscriptions) {
    for (const eventName of grants.eventSubscriptions) {
      caps.push({ kind: "ezcorp:events:subscribe", value: eventName });
    }
  }

  if (grants.webhooks) {
    for (const slug of grants.webhooks) {
      caps.push({ kind: "ezcorp:webhooks:receive", value: slug });
    }
  }

  // One cap PER GRANTED WORKFLOW NAME — not a single boolean
  // `ezcorp:workflows:run`. A boolean would make the PDP's needed↔granted
  // subset check pass for ANY name once the extension held the capability at
  // all, which would defeat the point of clamping the grant to a specific,
  // admin-reviewed list. The value is the BARE name; the handler namespaces
  // it host-side before resolving.
  if (grants.workflows) {
    // `?? []` rather than a bare iteration: an empty `names` is now a LEGAL
    // grant shape (delegated-only, C3), so a hand-edited row that omits the
    // key entirely is a realistic input, and `for…of undefined` throws
    // inside the PDP's grant translation — which would turn a malformed row
    // into a 500 instead of a denial.
    for (const name of grants.workflows.names ?? []) {
      caps.push({ kind: "ezcorp:workflows:run", value: name });
    }
    // C3 — the delegated opt-in. Kind-only, no value (see the kind's
    // declaration for why job refs cannot be enumerated at grant time).
    // Emitted ONLY on an explicit `=== true`, so every grant written before
    // C3 produces a byte-identical capability set.
    if (grants.workflows.allowDelegated === true) {
      caps.push({ kind: "ezcorp:workflows:run-delegated" });
    }
  }

  // One cap PER TRIGGER KIND (C2), and only for a kind whose cap is
  // actually positive. A `maxCron: 0` envelope must not hand out
  // `{kind:"ezcorp:triggers:register", value:"cron"}` — the PDP would then
  // allow a registration that the handler's cap check would reject anyway,
  // splitting one decision across two layers that can disagree.
  if (grants.triggers) {
    if (grants.triggers.maxCron > 0) {
      caps.push({ kind: "ezcorp:triggers:register", value: "cron" });
    }
    if (grants.triggers.maxWebhooks > 0) {
      caps.push({ kind: "ezcorp:triggers:register", value: "webhook" });
    }
  }

  if (grants.appendMessages) {
    caps.push({ kind: "ezcorp:chat:append" });
  }

  // Derive the install + modify caps from the existing drafts grant —
  // an extension granted `custom.drafts.kinds:["extension"]`
  // (bundled-only: `extension-author`) may REQUEST an install or a
  // re-open-for-edit, but both ALWAYS go through a mandatory
  // user-approval prompt that is never persisted (see
  // `permission-engine.ts`), and `modify` is additionally gated
  // host-side by the `ezcorp/drafts.reopen` owner + admin-`modifiable`
  // + not-bundled check. Adding them here only lets the needed↔granted
  // subset check pass so the request reaches that prompt instead of
  // being denied as an ungranted capability. `install` and `modify`
  // share the SAME derivation gate — the WIP that introduced `modify`
  // wired the needed side (`tool-executor.ts`) + `SENSITIVE_KINDS` but
  // omitted this mirror, so `modify_extension` failed the PDP subset
  // check ("Missing capability ezcorp:extension:modify").
  if (grants.custom?.drafts?.kinds?.includes("extension")) {
    caps.push({ kind: "ezcorp:extension:install" });
    caps.push({ kind: "ezcorp:extension:modify" });
  }

  return caps;
}

// ── Phase 53 helpers for `intersectPermissions` ────────────────────

/** Intersect two `allowedModels` maps. The result keeps a provider
 *  only if BOTH sides list it; the per-provider model list is the
 *  set intersection. Used for LLM permission intersection. */
function intersectAllowedModels(
  a: Record<string, string[]> | undefined,
  b: Record<string, string[]> | undefined,
): Record<string, string[]> {
  if (!a || !b) return a ?? b ?? {};
  const out: Record<string, string[]> = {};
  for (const provider of Object.keys(a)) {
    const aModels = a[provider];
    const bModels = b[provider];
    if (!aModels || !bModels) continue;
    const intersection = aModels.filter((m) => bModels.includes(m));
    if (intersection.length > 0) out[provider] = intersection;
  }
  return out;
}

/** Tighter missed-run policy wins: `skip` ≺ `fire-once` ≺ `fire-all`.
 *  Used for schedule permission intersection. */
function tighterMissedRunPolicy(
  a: "skip" | "fire-once" | "fire-all",
  b: "skip" | "fire-once" | "fire-all",
): "skip" | "fire-once" | "fire-all" {
  const order: Record<string, number> = { skip: 0, "fire-once": 1, "fire-all": 2 };
  return order[a]! <= order[b]! ? a : b;
}

/** Map manifest-level custom keys to namespaced capability kinds. */
function customToKind(key: string): CapabilityKind | null {
  switch (key) {
    case "ezcorp:network:tcp":
      return "network.tcp";
    case "ezcorp:credentials:read":
      return "secret.read";
    case "appendMessages":
    case "ezcorp:chat:append":
      return "ezcorp:chat:append";
    case "agentConfig":
    case "ezcorp:agent:config":
      return "ezcorp:agent:config";
    case "spawnAgents":
    case "ezcorp:agent:spawn":
      return "ezcorp:agent:spawn";
    case "taskEvents":
    case "ezcorp:tasks:emit":
      return "ezcorp:tasks:emit";
    case "loopEvents":
    case "ezcorp:loops:emit":
      return "ezcorp:loops:emit";
    case "eventSubscriptions":
    case "ezcorp:events:subscribe":
      return "ezcorp:events:subscribe";
    case "webhooks":
    case "ezcorp:webhooks:receive":
      return "ezcorp:webhooks:receive";
    case "workflows":
    case "ezcorp:workflows:run":
      return "ezcorp:workflows:run";
    case "triggers":
    case "ezcorp:triggers:register":
      return "ezcorp:triggers:register";
    case "mcpInvoke":
    case "ezcorp:mcp:invoke":
      return "ezcorp:mcp:invoke";
    default:
      return null;
  }
}
