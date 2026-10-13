/**
 * `ezcorp/triggers` reverse-RPC handler (C2) — `ctx.triggers.{register,
 * unregister,list}`.
 *
 * Lets an extension create DYNAMIC cron and webhook triggers at runtime,
 * bounded by the `permissions.triggers` envelope its manifest declares and
 * the user approved at install. Manifest-declared crons and slugs are
 * untouched by this file; they keep flowing through `reconcileSchedules` /
 * `reconcileWebhooks` exactly as before.
 *
 * ── Enforcement ladder (strict order) ─────────────────────────────────
 *   0. Provenance — resolved by the CALLER (`handlePiTriggers` →
 *      `resolveReverseRpcMeta`) from the host-issued `_meta.ezCallId` the
 *      subprocess echoed back, NEVER the wire. That helper also refuses an
 *      OWNERLESS background fire (`-32106`), which is why registration is
 *      always attributable to a human.
 *   1. Kill switch — `EZCORP_DISABLE_CAPABILITY_TOOLS=1` (whole tier).
 *   1b. `EZCORP_DISABLE_DYNAMIC_TRIGGERS=1` — C2 alone, without taking
 *      down every capability tool with it.
 *   2. Structural grant check — `triggers` present with positive caps.
 *   3. Manifest re-read — the LIVE manifest must still declare `triggers`.
 *      Defense-in-depth copied from `workflows-handler.ts`: a grant that
 *      went stale against a narrowed manifest must not stay exploitable.
 *   4. Action + `key` shape.
 *   5. PDP `authorize` for `{kind:"ezcorp:triggers:register", value:<kind>}`
 *      — PER KIND, so cron and webhook are separately grantable.
 *   6. Kind-specific payload (`validateCron` for cron; nothing for webhook
 *      — the host mints everything).
 *   7. Cap — this kind's existing dynamic row count vs the envelope.
 *   8. Instantaneous rate limit (token bucket, 50 ops/s).
 *   9. Write the row, mint the slug + secret.
 *  10. Audit.
 *
 * Every outcome — accept AND reject — writes a `sdk_capability_calls` row
 * with a typed `errorCode`, and every MUTATION additionally writes an
 * `audit_log` row. Two destinations because they have different reach:
 * `sdk_capability_calls.on_behalf_of` is NOT NULL with an FK to `users`, so
 * it can only ever hold owner-scoped calls — while the uninstall and orphan
 * sweeps are ownerless, and those are precisely the events an operator most
 * needs a trail for. `audit_log.user_id` is nullable. Same split, same
 * reason, as the `-32106` rung in `workflows-handler.ts`.
 *
 * ── Why the extension never names its own slug ────────────────────────
 *
 * `register` carries a `key`, never a slug. The host derives the slug from
 * the manifest's declared prefix and the registry-resolved extension name
 * (see `triggers-store.mintWebhookSlug`), so there is no wire field in
 * which to name another extension's hook — forgery is inexpressible rather
 * than merely denied.
 */
import type {
  ExtensionManifestV2,
  ExtensionPermissions,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types";
import type { PermissionEngine } from "./permission-engine";
import { rpcError, rpcResult } from "./json-rpc";
import { capabilityToolsDisabled } from "./capability-flags";
import { createRateLimiter } from "./rate-limit";
import { recordCapabilityCall } from "./recordCapabilityCall";
import { insertAuditEntry } from "../db/queries/audit-log";
import { EXT_AUDIT_ACTIONS } from "./audit-actions";
import { validateCron, parseCron } from "./cron";
import { ensureWebhookSecret, deleteWebhookSecret } from "./webhook-secret";
import {
  TRIGGER_KEY_RE, mintWebhookSlug, isMintableSlug, defaultPerKeyCap,
  listDynamicCrons, listDynamicWebhooks,
  upsertDynamicCron, upsertDynamicWebhook,
  deleteDynamicCron, softDeleteDynamicWebhook,
  manifestSlugExists,
  type TriggerKind,
} from "./triggers-store";
import { extensionLogger } from "../logger";

const log = extensionLogger("triggers", "handler");

const MAX_OPS_PER_SECOND = 50;
const consumeTokens = createRateLimiter(MAX_OPS_PER_SECOND);

/** C2-only kill switch. Lets an operator stop dynamic registration without
 *  disabling every capability tool in the process — the blast radius of
 *  `EZCORP_DISABLE_CAPABILITY_TOOLS` is the entire tier. */
export function dynamicTriggersDisabled(): boolean {
  return process.env["EZCORP_DISABLE_DYNAMIC_TRIGGERS"] === "1";
}

/** Typed rejection reasons — the `errorCode` on the audit row, so analytics
 *  can tell "not granted" from "quota exhausted" from "bad cron". */
export type TriggerDenyReason =
  | "TRIGGERS_DISABLED"
  | "DYNAMIC_TRIGGERS_DISABLED"
  | "TRIGGERS_NOT_GRANTED"
  | "TRIGGERS_NOT_DECLARED"
  | "TRIGGERS_BAD_ACTION"
  | "TRIGGER_KEY_INVALID"
  | "TRIGGERS_PERM_DENIED"
  | "TRIGGER_CRON_INVALID"
  | "TRIGGER_BAD_PAYLOAD"
  | "TRIGGERS_QUOTA_EXCEEDED"
  | "TRIGGERS_RATE_LIMITED"
  | "TRIGGERS_WRITE_FAILED"
  | "TRIGGERS_SECRET_FAILED"
  | "TRIGGER_NOT_FOUND";

export interface TriggersHandlerContext {
  /** Manifest NAME, host-resolved from the registry — never the wire.
   *  Doubles as the webhook rows' FK and the slug-digest input. */
  extensionName: string;
  /** Registry extension id (UUID) — the schedule rows' FK and audit anchor. */
  extensionId: string;
  /** Acting user, from the host-issued provenance token. */
  userId: string;
  /** Calling conversation, or null for an owned but non-chat call. */
  conversationId: string | null;
  /** The INSTALLED grant. */
  grantedPermissions: ExtensionPermissions;
  /** The registry manifest — source of the defense-in-depth re-read. */
  manifest: ExtensionManifestV2;
  /** PDP. Optional only for pre-PDP unit contexts, matching every sibling
   *  handler; production always threads it. */
  engine?: PermissionEngine;
  /** Clock injection. Never wall-clock in the fire/quota path. */
  now?: () => Date;
}

/** Injectable seams so a unit test can exercise the safeguards without a
 *  contrived failure. Same rationale (and the same shape) as
 *  `reconcileWebhooks`'s injected `ensureSecret`:
 *
 *  - `recordCapabilityCall` never throws by contract, so its defensive
 *    catch is otherwise unreachable — and that catch is what guarantees an
 *    audit hiccup can never turn a successful registration into an RPC
 *    error.
 *  - the secret-store calls fail only on a broken AEAD store, which no
 *    fixture can produce; both failure paths have real behaviour (one
 *    refuses the registration, one shrugs) that must be pinned.
 *
 *  Production callers pass none of these. */
export interface TriggersHandlerDeps {
  recordCapabilityCall: typeof recordCapabilityCall;
  ensureWebhookSecret: typeof ensureWebhookSecret;
  deleteWebhookSecret: typeof deleteWebhookSecret;
}

/** Test-only: refill one extension's instantaneous token bucket. The bucket
 *  is module-level and shared across every call in a process, so without
 *  this a test that deliberately exhausts it would leak the empty bucket
 *  into whatever runs next. */
export function _resetTriggersRateLimitForTests(extensionId: string): void {
  consumeTokens.forget(extensionId);
}

export async function handleTriggersRpc(
  req: JsonRpcRequest,
  ctx: TriggersHandlerContext,
  // Built at call time — NOT hoisted to a module-scope const — so merely
  // importing this module never eagerly reads the `recordCapabilityCall`
  // binding, which would trip any test that mocks that module.
  deps: TriggersHandlerDeps = {
    recordCapabilityCall, ensureWebhookSecret, deleteWebhookSecret,
  },
): Promise<JsonRpcResponse> {
  const startedAt = Date.now();
  const now = ctx.now?.() ?? new Date();
  const params = (req.params ?? {}) as Record<string, unknown>;
  const action = typeof params.action === "string" ? params.action : "";

  const deny = async (
    reason: TriggerDenyReason,
    message: string,
    code = -32001,
    data?: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    await audit(ctx, startedAt, deps, action || "unknown", {
      success: false,
      errorCode: reason,
      errorMessage: message,
      ...(data ? { after: data } : {}),
    });
    // `reason` is spread LAST so the typed deny code always wins. A payload
    // field that shadowed it would leave the rejection unclassifiable in
    // analytics — which is exactly what a deny code is for.
    return rpcError(req.id, code, message, { ...(data ?? {}), reason });
  };

  // 1. Kill switch — the whole capability tier off.
  if (capabilityToolsDisabled()) {
    return deny("TRIGGERS_DISABLED", "triggers permission not granted");
  }

  // 1b. C2-only kill switch.
  if (dynamicTriggersDisabled()) {
    return deny("DYNAMIC_TRIGGERS_DISABLED", "dynamic triggers are disabled");
  }

  // 2. Structural grant check. An envelope with both caps at zero
  //    authorizes nothing; the clamp never produces one, so reaching here
  //    means a hand-edited or legacy row.
  const granted = ctx.grantedPermissions.triggers;
  if (
    !granted ||
    typeof granted.webhookPrefix !== "string" ||
    granted.webhookPrefix.length === 0 ||
    !Number.isFinite(granted.maxCron) ||
    !Number.isFinite(granted.maxWebhooks) ||
    (granted.maxCron <= 0 && granted.maxWebhooks <= 0)
  ) {
    return deny("TRIGGERS_NOT_GRANTED", "triggers permission not granted");
  }

  // 3. Manifest re-read. The stored grant is the primary gate, but a
  //    manifest that has since dropped `triggers` must win — a stale grant
  //    naming a capability the author removed is not exploitable.
  if (!ctx.manifest.permissions?.triggers) {
    return deny("TRIGGERS_NOT_DECLARED", "triggers-not-declared");
  }

  // 4. Action.
  if (action === "list") {
    return handleList(req, ctx, startedAt, deps);
  }
  if (action !== "register" && action !== "unregister") {
    return deny("TRIGGERS_BAD_ACTION", "unknown-action", -32601);
  }

  //    The key. Extension-scoped, never global — `job:42` under two
  //    extensions are two different triggers.
  const key = params.key;
  if (typeof key !== "string" || !TRIGGER_KEY_RE.test(key)) {
    return deny(
      "TRIGGER_KEY_INVALID",
      `'key' must match ${TRIGGER_KEY_RE.source}`,
      -32602,
    );
  }

  const kind = params.kind;
  if (kind !== "cron" && kind !== "webhook") {
    return deny("TRIGGER_BAD_PAYLOAD", "'kind' must be 'cron' or 'webhook'", -32602);
  }

  // 5. PDP — per KIND, so an install can grant schedules without also
  //    granting inbound HTTP hooks.
  if (ctx.engine) {
    const decision = await ctx.engine.authorize(
      {
        extensionId: ctx.extensionId,
        userId: ctx.userId || null,
        conversationId: ctx.conversationId,
        toolName: "ezcorp/triggers",
      },
      [{ kind: "ezcorp:triggers:register", value: kind }],
    );
    if (decision.decision === "deny") {
      return deny("TRIGGERS_PERM_DENIED", "triggers permission not granted");
    }
  }

  // 8. Instantaneous rate limit. Before any write, after every cheap check.
  if (!consumeTokens(ctx.extensionId, 1)) {
    return deny("TRIGGERS_RATE_LIMITED", "Rate limited", -32029);
  }

  if (action === "unregister") {
    return handleUnregister(req, ctx, startedAt, deps, kind, key, now, deny);
  }
  return handleRegister(req, ctx, startedAt, deps, kind, key, now, granted, deny);
}

type DenyFn = (
  reason: TriggerDenyReason,
  message: string,
  code?: number,
  data?: Record<string, unknown>,
) => Promise<JsonRpcResponse>;

async function handleRegister(
  req: JsonRpcRequest,
  ctx: TriggersHandlerContext,
  startedAt: number,
  deps: TriggersHandlerDeps,
  kind: TriggerKind,
  key: string,
  now: Date,
  granted: NonNullable<ExtensionPermissions["triggers"]>,
  deny: DenyFn,
): Promise<JsonRpcResponse> {
  const params = (req.params ?? {}) as Record<string, unknown>;

  if (kind === "cron") {
    if (granted.maxCron <= 0) {
      return deny("TRIGGERS_QUOTA_EXCEEDED", "cron triggers not granted", -32103, {
        kind, key, cap: granted.maxCron,
      });
    }

    // 6. Cron payload. The SAME rules as manifest crons — 5 fields, no
    //    shorthand, ≥5-minute interval. The floor is a spend bound, and
    //    relaxing it for user-created jobs would be exactly backwards.
    const expr = params.cron;
    if (typeof expr !== "string") {
      return deny("TRIGGER_BAD_PAYLOAD", "'cron' must be a string", -32602, { kind, key });
    }
    const check = validateCron(expr);
    if (!check.ok) {
      // The reason rides out VERBATIM under `cronReason`. Its audience is
      // an end user typing a cron into a job editor, not an author reading
      // an install-time warning — rewriting it host-side would fork the
      // vocabulary and let the two drift. It is deliberately NOT called
      // `reason`: that key carries the typed deny code on every handler in
      // this tier, and shadowing it would make the rejection
      // unclassifiable in analytics.
      return deny("TRIGGER_CRON_INVALID", `invalid cron: ${check.reason}`, -32602, {
        kind, key, cronReason: check.reason,
      });
    }

    const timezone = params.timezone;
    if (timezone !== undefined && typeof timezone !== "string") {
      return deny("TRIGGER_BAD_PAYLOAD", "'timezone' must be a string", -32602, { kind, key });
    }
    let nextFireAt: Date;
    try {
      nextFireAt = parseCron(expr, timezone).next(now);
    } catch (err) {
      // An unresolvable zone is the realistic case here; `validateCron`
      // already cleared the expression itself.
      return deny("TRIGGER_CRON_INVALID", `invalid cron: ${String(err)}`, -32602, {
        kind, key, cronReason: String(err),
      });
    }

    // 7. Cap — see `usedSlotsIfOverCap`.
    const cronUsed = usedSlotsIfOverCap(await listDynamicCrons(ctx.extensionId), key, granted.maxCron);
    if (cronUsed !== null) {
      return deny("TRIGGERS_QUOTA_EXCEEDED", "cron trigger quota exceeded", -32103, {
        kind, key, used: cronUsed, cap: granted.maxCron,
      });
    }

    // 9. Write.
    let row: Awaited<ReturnType<typeof upsertDynamicCron>>;
    try {
      row = await upsertDynamicCron({
        extensionId: ctx.extensionId,
        key,
        cron: expr,
        timezone: typeof timezone === "string" ? timezone : null,
        nextFireAt,
        // The per-key daily cap. `maxRunsPerDay` is an ENVELOPE, not an
        // allowance — without a per-key share, one busy job exhausts it and
        // starves every sibling.
        maxRunsPerDay: defaultPerKeyCap(granted.maxRunsPerDay, granted.maxCron),
        now,
      });
    } catch (err) {
      log.warn("cron register write failed", { key, error: String(err) });
      return deny("TRIGGERS_WRITE_FAILED", "failed to persist trigger", -32603, { kind, key });
    }

    await auditMutation(ctx, EXT_AUDIT_ACTIONS.SDK_TRIGGER_REGISTERED, {
      kind, key, cron: expr, scheduleId: row.id,
    });
    await audit(ctx, startedAt, deps, "register", {
      success: true, resourceId: key, after: { kind, key, cron: expr },
    });
    return rpcResult(req.id, {
      v: 1, key, kind, cron: expr, maxRunsPerDay: row.maxRunsPerDay,
    });
  }

  // ── webhook ──
  if (granted.maxWebhooks <= 0) {
    return deny("TRIGGERS_QUOTA_EXCEEDED", "webhook triggers not granted", -32103, {
      kind, key, cap: granted.maxWebhooks,
    });
  }

  const hookUsed = usedSlotsIfOverCap(await listDynamicWebhooks(ctx.extensionName), key, granted.maxWebhooks);
  if (hookUsed !== null) {
    return deny("TRIGGERS_QUOTA_EXCEEDED", "webhook trigger quota exceeded", -32103, {
      kind, key, used: hookUsed, cap: granted.maxWebhooks,
    });
  }

  // The host mints the slug. The extension supplied no slug and could not
  // have — there is no such wire field.
  const slug = mintWebhookSlug(granted.webhookPrefix, ctx.extensionName, key);
  // Defense-in-depth: the prefix clamp guarantees the head and the digest
  // the tail, so this can only fail on a bug — but a malformed slug must
  // never reach a registry row and thence the public route.
  if (!isMintableSlug(slug)) {
    return deny("TRIGGERS_WRITE_FAILED", "minted slug failed validation", -32603, { kind, key });
  }
  // A minted slug colliding with an author-DECLARED one would leave two
  // rows answering the same URL and the route picking arbitrarily.
  if (await manifestSlugExists(ctx.extensionName, slug)) {
    return deny("TRIGGERS_WRITE_FAILED", "slug collides with a manifest hook", -32603, {
      kind, key,
    });
  }

  let row: Awaited<ReturnType<typeof upsertDynamicWebhook>>;
  try {
    row = await upsertDynamicWebhook({
      extensionName: ctx.extensionName, key, slug, now,
    });
  } catch (err) {
    log.warn("webhook register write failed", { key, error: String(err) });
    return deny("TRIGGERS_WRITE_FAILED", "failed to persist trigger", -32603, { kind, key });
  }

  // Mint-if-absent, never rotate: a re-register must not silently
  // invalidate a token the user already wired into a third-party system.
  try {
    await deps.ensureWebhookSecret(ctx.extensionName, slug, ctx.userId);
  } catch (err) {
    // The row exists but has no secret. That is FAIL-CLOSED, not fail-open:
    // the public route rejects a secretless hook unconditionally. Report it
    // so the caller knows the hook is not yet usable.
    log.warn("webhook secret mint failed", { key, error: String(err) });
    return deny("TRIGGERS_SECRET_FAILED", "failed to mint hook secret", -32603, { kind, key });
  }

  await auditMutation(ctx, EXT_AUDIT_ACTIONS.SDK_TRIGGER_REGISTERED, {
    kind, key, slug, webhookId: row.id,
  });
  await audit(ctx, startedAt, deps, "register", {
    success: true, resourceId: key, after: { kind, key, slug },
  });
  // The URL, not the secret. The token is shown once through the existing
  // rotate route; echoing it here would put it in every audit and log sink
  // that sees an RPC result.
  return rpcResult(req.id, {
    v: 1, key, kind, slug, url: `/api/hooks/${ctx.extensionName}/${slug}`,
  });
}

async function handleUnregister(
  req: JsonRpcRequest,
  ctx: TriggersHandlerContext,
  startedAt: number,
  deps: TriggersHandlerDeps,
  kind: TriggerKind,
  key: string,
  now: Date,
  deny: DenyFn,
): Promise<JsonRpcResponse> {
  if (kind === "cron") {
    const removed = await deleteDynamicCron(ctx.extensionId, key);
    if (!removed) {
      return deny("TRIGGER_NOT_FOUND", "no such trigger", -32602, { kind, key });
    }
    await auditMutation(ctx, EXT_AUDIT_ACTIONS.SDK_TRIGGER_UNREGISTERED, { kind, key });
    await audit(ctx, startedAt, deps, "unregister", {
      success: true, resourceId: key, after: { kind, key },
    });
    return rpcResult(req.id, { v: 1, key, kind, removed: true });
  }

  const freedSlug = await softDeleteDynamicWebhook(ctx.extensionName, key, now);
  if (freedSlug === null) {
    return deny("TRIGGER_NOT_FOUND", "no such trigger", -32602, { kind, key });
  }
  // The secret does NOT survive the hook — a revoked hook's token must stop
  // authenticating immediately. The ROW survives (soft delete) so its
  // delivery history is not cascaded away.
  try {
    await deps.deleteWebhookSecret(ctx.extensionName, freedSlug);
  } catch (err) {
    // Best-effort: the row is already disabled, so the hook is dead either
    // way; a lingering secret row is inert without an enabled hook.
    log.warn("webhook secret delete failed", { key, error: String(err) });
  }
  await auditMutation(ctx, EXT_AUDIT_ACTIONS.SDK_TRIGGER_UNREGISTERED, {
    kind, key, slug: freedSlug,
  });
  await audit(ctx, startedAt, deps, "unregister", {
    success: true, resourceId: key, after: { kind, key, slug: freedSlug },
  });
  return rpcResult(req.id, { v: 1, key, kind, removed: true });
}

async function handleList(
  req: JsonRpcRequest,
  ctx: TriggersHandlerContext,
  startedAt: number,
  deps: TriggersHandlerDeps,
): Promise<JsonRpcResponse> {
  // Scoped to THIS extension by construction: both ids come from the
  // registry, never the wire, so cross-extension enumeration is
  // inexpressible rather than merely denied.
  const crons = await listDynamicCrons(ctx.extensionId);
  const hooks = await listDynamicWebhooks(ctx.extensionName);
  const triggers = [
    ...crons.map((r) => ({
      kind: "cron" as const,
      key: r.key as string,
      cron: r.cron,
      timezone: r.timezone,
      enabled: r.enabled,
      maxRunsPerDay: r.maxRunsPerDay,
      nextFireAt: r.nextFireAt.toISOString(),
    })),
    ...hooks.map((r) => ({
      kind: "webhook" as const,
      key: r.key as string,
      slug: r.slug,
      enabled: r.enabled,
      url: `/api/hooks/${ctx.extensionName}/${r.slug}`,
    })),
  ];
  await audit(ctx, startedAt, deps, "list", {
    success: true, after: { count: triggers.length },
  });
  return rpcResult(req.id, { v: 1, triggers });
}

/**
 * Per-kind cap over the rows that can fire: `enabled` ones. A row the
 * orphan sweep or a revoke soft-disabled holds no slot. Re-registering an
 * enabled key is an update and always passes (otherwise editing a job is
 * impossible exactly at the limit, or after the cap was narrowed); reviving
 * a disabled key re-enables it, so it needs a free slot like a new key.
 * Returns the used slot count when the register must be refused, else null.
 */
function usedSlotsIfOverCap(
  rows: ReadonlyArray<{ key: string | null; enabled: boolean }>,
  key: string,
  cap: number,
): number | null {
  if (rows.some((r) => r.key === key && r.enabled)) return null;
  const used = rows.filter((r) => r.enabled).length;
  return used >= cap ? used : null;
}

/** The `audit_log` half of the trail — the destination that can also hold
 *  the OWNERLESS sweeps (`audit_log.user_id` is nullable, unlike
 *  `sdk_capability_calls.on_behalf_of`). Mutations only; a rejection is
 *  covered by the capability row alone. */
async function auditMutation(
  ctx: TriggersHandlerContext,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  // No try/catch here on purpose: `insertAuditEntry` already wraps its own
  // insert, routes the failure to `persistError`, and returns "" rather
  // than throwing — so an audit hiccup cannot change this response.
  // Re-wrapping would duplicate that guarantee and add a branch no fixture
  // can reach.
  await insertAuditEntry(ctx.userId, action, ctx.extensionId, {
    capability: "triggers",
    oldValue: undefined,
    newValue: detail,
    actor: "extension",
    reason: `ctx.triggers ${action}`,
  });
}

/** Single `sdk_capability_calls` site for every outcome.
 *  `recordCapabilityCall` never throws by contract, but wrap anyway so an
 *  audit hiccup can never turn a successful registration into an RPC
 *  error. */
async function audit(
  ctx: TriggersHandlerContext,
  startedAt: number,
  deps: TriggersHandlerDeps,
  action: string,
  spec: {
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
    after?: Record<string, unknown>;
    resourceId?: string;
  },
): Promise<void> {
  try {
    await deps.recordCapabilityCall({
      ctx: {
        actorExtensionId: ctx.extensionId,
        onBehalfOf: ctx.userId,
        conversationId: ctx.conversationId,
        runId: null,
        parentCallId: null,
      },
      capability: "triggers",
      action,
      resourceType: "trigger",
      ...(spec.resourceId ? { resourceId: spec.resourceId } : {}),
      ...(spec.after ? { after: spec.after } : {}),
      durationMs: Date.now() - startedAt,
      success: spec.success,
      ...(spec.errorCode ? { errorCode: spec.errorCode } : {}),
      ...(spec.errorMessage ? { errorMessage: spec.errorMessage } : {}),
      // Mirrors schedule/workflows handlers: a pill only for a successful,
      // in-chat call. A rejection is audit-only — a denied capability
      // should not spam the conversation.
      insertChatPill: spec.success && ctx.conversationId !== null,
    });
  } catch (err) {
    log.warn("trigger capability audit failed (non-fatal)", { error: String(err) });
  }
}
