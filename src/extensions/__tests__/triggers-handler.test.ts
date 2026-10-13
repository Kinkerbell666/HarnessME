/**
 * `triggers-handler.ts` (C2 build-order step 5) — the `ezcorp/triggers`
 * enforcement ladder.
 *
 * Every rung gets a test, and each asserts the TYPED DENY CODE and the
 * AUDIT DESTINATION, not merely that the call was rejected. A test that
 * only checks "it failed" passes just as happily when the handler rejects
 * for the wrong reason, which is the failure mode that matters when the
 * ladder is reordered.
 *
 * The two audit destinations are asserted separately because they have
 * different reach: `sdk_capability_calls.on_behalf_of` is NOT NULL with an
 * FK to `users` and so can only hold owner-scoped calls, while `audit_log`
 * takes a nullable user and is the only place the ownerless sweeps can be
 * recorded.
 */
import { test, expect, describe, beforeAll, beforeEach, afterAll, mock, spyOn } from "bun:test";
import { restoreModuleMocks } from "../../__tests__/helpers/mock-cleanup";
import {
  setupTestDb, closeTestDb, mockDbConnection, getTestDb,
} from "../../__tests__/helpers/test-pglite";

mock.module("../../db/queries/settings", () => ({
  async getAllSettings() { return {}; },
  async getSetting() { return undefined; },
  async upsertSetting() {},
  async deleteSetting() { return false; },
  async isListingInstalled() { return false; },
}));

mockDbConnection();

import {
  handleTriggersRpc, dynamicTriggersDisabled,
  _resetTriggersRateLimitForTests,
  type TriggersHandlerContext,
} from "../triggers-handler";
import { mintWebhookSlug } from "../triggers-store";
import {
  getWebhookSecret, ensureWebhookSecret, deleteWebhookSecret,
} from "../webhook-secret";
import {
  extensionSchedules, extensionWebhooks, extensions, auditLog, users,
} from "../../db/schema";
import { eq, and } from "drizzle-orm";
import type {
  ExtensionManifestV2, ExtensionPermissions, JsonRpcRequest, JsonRpcResponse,
} from "../types";

const EXT_NAME = "trig-handler-ext";
let extId: string;
let userId: string;

const NOW = new Date("2026-07-29T12:00:00.000Z");

const GRANT: NonNullable<ExtensionPermissions["triggers"]> = {
  maxCron: 3, maxWebhooks: 2, webhookPrefix: "factory-", maxRunsPerDay: 90,
};

/** Captured `recordCapabilityCall` rows — the `sdk_capability_calls` half
 *  of the trail, injected so the assertions do not depend on the DB write
 *  path (which is separately covered). */
type Captured = {
  capability: string; action: string; success: boolean;
  errorCode?: string; resourceId?: string;
  after?: Record<string, unknown>;
};
let captured: Captured[] = [];

const deps = {
  ensureWebhookSecret,
  deleteWebhookSecret,
  recordCapabilityCall: (async (spec: Record<string, unknown>) => {
    captured.push({
      capability: spec.capability as string,
      action: spec.action as string,
      success: spec.success as boolean,
      ...(spec.errorCode ? { errorCode: spec.errorCode as string } : {}),
      ...(spec.resourceId ? { resourceId: spec.resourceId as string } : {}),
      ...(spec.after ? { after: spec.after as Record<string, unknown> } : {}),
    });
    return { sdkCapabilityCallId: "cap-1" };
  }) as unknown as TriggersHandlerDepsRecord,
};
type TriggersHandlerDepsRecord = Parameters<typeof handleTriggersRpc>[2] extends
  { recordCapabilityCall: infer R } ? R : never;

function manifestWith(triggers: unknown): ExtensionManifestV2 {
  return {
    schemaVersion: 2, name: EXT_NAME, version: "1.0.0", description: "d",
    author: { name: "a" }, entrypoint: "./index.ts",
    permissions: triggers === undefined ? {} : { triggers },
  } as unknown as ExtensionManifestV2;
}

function ctxWith(over: Partial<TriggersHandlerContext> = {}): TriggersHandlerContext {
  return {
    extensionName: EXT_NAME,
    extensionId: extId,
    userId,
    conversationId: null,
    grantedPermissions: { triggers: GRANT, grantedAt: {} },
    manifest: manifestWith({ webhookPrefix: "factory-" }),
    now: () => NOW,
    ...over,
  };
}

function req(params: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: "2.0", id: 1, method: "ezcorp/triggers", params };
}

function call(
  params: Record<string, unknown>,
  over: Partial<TriggersHandlerContext> = {},
): Promise<JsonRpcResponse> {
  return handleTriggersRpc(req(params), ctxWith(over), deps as never);
}

function errOf(res: JsonRpcResponse): { code: number; reason: string; data: Record<string, unknown> } {
  const e = (res as { error?: { code: number; data?: Record<string, unknown> } }).error;
  return {
    code: e!.code,
    reason: (e!.data?.reason as string) ?? "",
    data: e!.data ?? {},
  };
}

/** The typed deny `reason` of a response, or `undefined` when it succeeded. */
function reasonOf(res: JsonRpcResponse): string | undefined {
  return (res as { error?: { data?: { reason?: string } } }).error?.data?.reason;
}

async function auditRows(action: string) {
  return getTestDb().select().from(auditLog).where(eq(auditLog.action, action));
}

beforeAll(async () => {
  await setupTestDb();
  const [u] = await getTestDb().insert(users).values({
    email: "trig@example.com", name: "Trig", passwordHash: "x", role: "admin",
  }).returning({ id: users.id });
  userId = u!.id;
  const [row] = await getTestDb().insert(extensions).values({
    name: EXT_NAME, version: "1.0.0", description: "",
    manifest: manifestWith({ webhookPrefix: "factory-" }) as never,
    source: "test", enabled: true, grantedPermissions: {} as never,
  }).returning({ id: extensions.id });
  extId = row!.id;
});

beforeEach(async () => {
  captured = [];
  await getTestDb().delete(extensionSchedules);
  await getTestDb().delete(extensionWebhooks);
  await getTestDb().delete(auditLog);
  _resetTriggersRateLimitForTests(extId);
  delete process.env["EZCORP_DISABLE_CAPABILITY_TOOLS"];
  delete process.env["EZCORP_DISABLE_DYNAMIC_TRIGGERS"];
});

afterAll(async () => {
  restoreModuleMocks();
  await closeTestDb();
});

// ── Rungs 1, 1b: kill switches ────────────────────────────────────────

describe("rung 1 — kill switches", () => {
  test("EZCORP_DISABLE_CAPABILITY_TOOLS denies TRIGGERS_DISABLED + audits", async () => {
    process.env["EZCORP_DISABLE_CAPABILITY_TOOLS"] = "1";
    const res = await call({ action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" });
    expect(errOf(res).reason).toBe("TRIGGERS_DISABLED");
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      capability: "triggers", success: false, errorCode: "TRIGGERS_DISABLED",
    });
  });

  test("EZCORP_DISABLE_DYNAMIC_TRIGGERS denies C2 alone", async () => {
    // The point of the second switch: stop dynamic registration WITHOUT
    // taking every capability tool down with it.
    expect(dynamicTriggersDisabled()).toBe(false);
    process.env["EZCORP_DISABLE_DYNAMIC_TRIGGERS"] = "1";
    expect(dynamicTriggersDisabled()).toBe(true);
    const res = await call({ action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" });
    expect(errOf(res).reason).toBe("DYNAMIC_TRIGGERS_DISABLED");
    expect(captured[0]?.errorCode).toBe("DYNAMIC_TRIGGERS_DISABLED");
  });

  test("a non-'1' value does NOT disable", async () => {
    process.env["EZCORP_DISABLE_DYNAMIC_TRIGGERS"] = "true";
    expect(dynamicTriggersDisabled()).toBe(false);
  });
});

// ── Rung 2: structural grant ──────────────────────────────────────────

describe("rung 2 — structural grant check", () => {
  test("no triggers grant ⇒ TRIGGERS_NOT_GRANTED", async () => {
    const res = await call(
      { action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" },
      { grantedPermissions: { grantedAt: {} } },
    );
    expect(errOf(res).reason).toBe("TRIGGERS_NOT_GRANTED");
    expect(captured[0]?.errorCode).toBe("TRIGGERS_NOT_GRANTED");
  });

  test("a both-caps-zero husk grant authorizes nothing", async () => {
    const res = await call(
      { action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" },
      {
        grantedPermissions: {
          triggers: { ...GRANT, maxCron: 0, maxWebhooks: 0 }, grantedAt: {},
        },
      },
    );
    expect(errOf(res).reason).toBe("TRIGGERS_NOT_GRANTED");
  });

  test("a grant with no webhookPrefix is refused", async () => {
    const res = await call(
      { action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" },
      {
        grantedPermissions: {
          triggers: { ...GRANT, webhookPrefix: "" }, grantedAt: {},
        },
      },
    );
    expect(errOf(res).reason).toBe("TRIGGERS_NOT_GRANTED");
  });
});

// ── Rung 3: manifest re-read ──────────────────────────────────────────

describe("rung 3 — manifest re-read (defense in depth)", () => {
  test("a stale grant against a narrowed manifest is NOT exploitable", async () => {
    const res = await call(
      { action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" },
      { manifest: manifestWith(undefined) },
    );
    expect(errOf(res).reason).toBe("TRIGGERS_NOT_DECLARED");
    expect(captured[0]?.errorCode).toBe("TRIGGERS_NOT_DECLARED");
  });
});

// ── Rung 4: action + key shape ────────────────────────────────────────

describe("rung 4 — action and key", () => {
  test("an unknown action is -32601 TRIGGERS_BAD_ACTION", async () => {
    const res = await call({ action: "obliterate", kind: "cron", key: "job:1" });
    expect(errOf(res).code).toBe(-32601);
    expect(errOf(res).reason).toBe("TRIGGERS_BAD_ACTION");
  });

  test("a malformed key is TRIGGER_KEY_INVALID", async () => {
    for (const bad of ["", ":lead", "Caps", "has space", "a".repeat(65), 42]) {
      captured = [];
      const res = await call({ action: "register", kind: "cron", key: bad, cron: "0 9 * * 1" });
      expect(errOf(res).reason).toBe("TRIGGER_KEY_INVALID");
      expect(errOf(res).code).toBe(-32602);
      expect(captured[0]?.errorCode).toBe("TRIGGER_KEY_INVALID");
    }
  });

  test("a bad kind is TRIGGER_BAD_PAYLOAD", async () => {
    const res = await call({ action: "register", kind: "carrier-pigeon", key: "job:1" });
    expect(errOf(res).reason).toBe("TRIGGER_BAD_PAYLOAD");
  });
});

// ── Rung 5: PDP ───────────────────────────────────────────────────────

describe("rung 5 — PDP authorize, per kind", () => {
  function engineDenying(denyKind: string) {
    return {
      authorize: async (_s: unknown, caps: { kind: string; value?: string }[]) => ({
        decision: caps.some((c) => c.value === denyKind) ? "deny" : "allow",
      }),
    } as unknown as NonNullable<TriggersHandlerContext["engine"]>;
  }

  test("a denied cron registration is TRIGGERS_PERM_DENIED", async () => {
    const res = await call(
      { action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" },
      { engine: engineDenying("cron") },
    );
    expect(errOf(res).reason).toBe("TRIGGERS_PERM_DENIED");
    expect(captured[0]?.errorCode).toBe("TRIGGERS_PERM_DENIED");
  });

  test("cron and webhook are SEPARATELY grantable", async () => {
    // Denying "webhook" must leave cron registration working — the whole
    // reason the capability carries a per-kind value.
    const engine = engineDenying("webhook");
    const ok = await call(
      { action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" },
      { engine },
    );
    expect((ok as { result?: unknown }).result).toBeDefined();

    captured = [];
    const denied = await call(
      { action: "register", kind: "webhook", key: "job:2" },
      { engine },
    );
    expect(errOf(denied).reason).toBe("TRIGGERS_PERM_DENIED");
  });
});

// ── Rung 6: cron payload ──────────────────────────────────────────────

describe("rung 6 — cron validation, and the reason reaching the caller", () => {
  test("each validateCron reason surfaces VERBATIM in data.reason", async () => {
    // The audience here is an end user typing a cron into a job editor,
    // not an author reading an install log — so the reason must not be
    // rewritten host-side, or the two vocabularies drift.
    const cases: [string, string][] = [
      ["", "empty"],
      ["@hourly", "shorthand-not-supported (use 5-field expression)"],
      ["0 9 * *", "expected 5 fields, got 4"],
      ["* * * * *", "min-5-min-interval-required"],
    ];
    for (const [expr, reason] of cases) {
      captured = [];
      const res = await call({ action: "register", kind: "cron", key: "job:1", cron: expr });
      expect(errOf(res).reason).toBe("TRIGGER_CRON_INVALID");
      expect(errOf(res).data.cronReason).toBe(reason);
      expect(errOf(res).code).toBe(-32602);
      expect(captured[0]?.errorCode).toBe("TRIGGER_CRON_INVALID");
    }
  });

  test("a parse-error reason also surfaces verbatim", async () => {
    const res = await call({ action: "register", kind: "cron", key: "job:1", cron: "99 9 * * 1" });
    expect(errOf(res).reason).toBe("TRIGGER_CRON_INVALID");
    expect(String(errOf(res).data.cronReason)).toStartWith("parse-error:");
  });

  test("a non-string cron is TRIGGER_BAD_PAYLOAD", async () => {
    const res = await call({ action: "register", kind: "cron", key: "job:1", cron: 900 });
    expect(errOf(res).reason).toBe("TRIGGER_BAD_PAYLOAD");
  });

  test("a non-string timezone is TRIGGER_BAD_PAYLOAD", async () => {
    const res = await call({
      action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1", timezone: 5,
    });
    expect(errOf(res).reason).toBe("TRIGGER_BAD_PAYLOAD");
  });

  test("an unresolvable timezone is TRIGGER_CRON_INVALID", async () => {
    const res = await call({
      action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1",
      timezone: "Mars/Olympus_Mons",
    });
    expect(errOf(res).reason).toBe("TRIGGER_CRON_INVALID");
  });

  test("the ≥5-minute floor is NOT relaxed for user-created jobs", async () => {
    // Relaxing the spend bound for the tier that can create the most jobs
    // would be exactly backwards.
    const res = await call({
      action: "register", kind: "cron", key: "job:1", cron: "*/1 * * * *",
    });
    expect(errOf(res).data.cronReason).toBe("min-5-min-interval-required");
  });
});

// ── Rung 7: caps ──────────────────────────────────────────────────────

describe("rung 7 — per-kind caps", () => {
  test("cron registrations beyond maxCron are TRIGGERS_QUOTA_EXCEEDED", async () => {
    for (let i = 0; i < GRANT.maxCron; i++) {
      const res = await call({
        action: "register", kind: "cron", key: `job:${i}`, cron: "0 9 * * 1",
      });
      expect((res as { result?: unknown }).result).toBeDefined();
    }
    captured = [];
    const over = await call({
      action: "register", kind: "cron", key: "job:over", cron: "0 9 * * 1",
    });
    expect(errOf(over).reason).toBe("TRIGGERS_QUOTA_EXCEEDED");
    expect(errOf(over).code).toBe(-32103);
    expect(errOf(over).data).toMatchObject({ used: GRANT.maxCron, cap: GRANT.maxCron });
    // The denial NAMES THE KEY, so the starved job is diagnosable.
    expect(errOf(over).data.key).toBe("job:over");
    expect(captured[0]?.errorCode).toBe("TRIGGERS_QUOTA_EXCEEDED");
  });

  test("re-registering an EXISTING key at the cap is allowed (it is an update)", async () => {
    // Otherwise editing a job becomes impossible exactly when the user is
    // at their limit — the worst possible moment for it to break.
    for (let i = 0; i < GRANT.maxCron; i++) {
      await call({ action: "register", kind: "cron", key: `job:${i}`, cron: "0 9 * * 1" });
    }
    const res = await call({
      action: "register", kind: "cron", key: "job:0", cron: "0 10 * * 2",
    });
    expect((res as { result?: unknown }).result).toBeDefined();
    const rows = await getTestDb().select().from(extensionSchedules)
      .where(eq(extensionSchedules.extensionId, extId));
    expect(rows).toHaveLength(GRANT.maxCron);
  });

  test("a zero cron cap refuses cron while webhooks still work", async () => {
    const over = { grantedPermissions: { triggers: { ...GRANT, maxCron: 0 }, grantedAt: {} } };
    const denied = await call(
      { action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" }, over,
    );
    expect(errOf(denied).reason).toBe("TRIGGERS_QUOTA_EXCEEDED");
    const ok = await call({ action: "register", kind: "webhook", key: "job:2" }, over);
    expect((ok as { result?: unknown }).result).toBeDefined();
  });

  test("webhook registrations beyond maxWebhooks are refused", async () => {
    for (let i = 0; i < GRANT.maxWebhooks; i++) {
      await call({ action: "register", kind: "webhook", key: `hook:${i}` });
    }
    const over = await call({ action: "register", kind: "webhook", key: "hook:over" });
    expect(errOf(over).reason).toBe("TRIGGERS_QUOTA_EXCEEDED");
  });

  test("a disabled cron row frees its slot; reviving it at the cap is refused", async () => {
    for (let i = 0; i < GRANT.maxCron; i++) {
      await call({ action: "register", kind: "cron", key: `job:${i}`, cron: "0 9 * * 1" });
    }
    // The orphan sweep (or capability revoke) soft-disables a row; it no
    // longer fires, so it must not hold a slot.
    await getTestDb().update(extensionSchedules).set({ enabled: false })
      .where(and(eq(extensionSchedules.extensionId, extId), eq(extensionSchedules.key, "job:0")));
    const fresh = await call({ action: "register", kind: "cron", key: "job:new", cron: "0 9 * * 1" });
    expect((fresh as { result?: unknown }).result).toBeDefined();
    // Re-registering the disabled key would re-enable it: that is a new
    // slot, and the enabled rows are at the cap again.
    const revive = await call({ action: "register", kind: "cron", key: "job:0", cron: "0 9 * * 1" });
    expect(errOf(revive).reason).toBe("TRIGGERS_QUOTA_EXCEEDED");
    expect(errOf(revive).data).toMatchObject({ used: GRANT.maxCron, cap: GRANT.maxCron });
  });

  test("a disabled webhook row frees its slot", async () => {
    for (let i = 0; i < GRANT.maxWebhooks; i++) {
      await call({ action: "register", kind: "webhook", key: `hook:${i}` });
    }
    await getTestDb().update(extensionWebhooks).set({ enabled: false })
      .where(and(eq(extensionWebhooks.extensionId, EXT_NAME), eq(extensionWebhooks.key, "hook:0")));
    const fresh = await call({ action: "register", kind: "webhook", key: "hook:new" });
    expect((fresh as { result?: unknown }).result).toBeDefined();
  });

  test("a zero webhook cap refuses webhooks while cron still works", async () => {
    const over = { grantedPermissions: { triggers: { ...GRANT, maxWebhooks: 0 }, grantedAt: {} } };
    const denied = await call({ action: "register", kind: "webhook", key: "hook:1" }, over);
    expect(errOf(denied).reason).toBe("TRIGGERS_QUOTA_EXCEEDED");
    const ok = await call(
      { action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" }, over,
    );
    expect((ok as { result?: unknown }).result).toBeDefined();
  });
});

// ── Rung 8: rate limit ────────────────────────────────────────────────

/** The handler's instantaneous bucket size (`MAX_OPS_PER_SECOND`). */
const BUCKET_TOKENS = 50;

/**
 * Run `fn` with `Date.now()` frozen.
 *
 * The limiter refills by WALL-CLOCK elapsed time (`src/extensions/rate-limit.ts`
 * computes `tokens + elapsed * maxOpsPerSecond`), which makes any "drain it and
 * watch it refuse" assertion a race between the drain and the refill — and the
 * drain's speed is a property of the HOST, not of the code under test. This
 * test lost that race for real: under a coverage-instrumented shard on a CI
 * runner each awaited `register` cost >20ms, so the 50 ops/s bucket refilled a
 * token per call and the 60-iteration loop never reached a refusal (CI run
 * 31046221239 — the shard tolerated it as a contention flake on the isolated
 * re-run, but the FAILING run's lcov is the one that ships, so the coverage
 * gate saw `triggers-handler.ts:262` as dead).
 *
 * Freezing deletes the refill term, so the drain is exactly BUCKET_TOKENS
 * accepted calls followed by a refusal and every assertion below is an
 * equality rather than "at least one of sixty". Nothing is loosened — this is
 * the strict form of the same claim. Same defect and same fix as
 * `workflows-handler.test.ts`'s `withFrozenClock`.
 */
async function withFrozenClock<T>(fn: () => Promise<T>): Promise<T> {
  const clock = spyOn(Date, "now").mockReturnValue(Date.now());
  try {
    return await fn();
  } finally {
    clock.mockRestore();
  }
}

describe("rung 8 — instantaneous rate limit", () => {
  test("exhausting the bucket yields TRIGGERS_RATE_LIMITED (-32029)", async () => {
    // `list` short-circuits BEFORE the limiter, so it must never be charged —
    // and `register` must be. Both halves are asserted.
    const reads = await withFrozenClock(async () => {
      const out: JsonRpcResponse[] = [];
      for (let i = 0; i < 60; i++) out.push(await call({ action: "list", key: `job:${i}` }));
      return out;
    });
    expect(reads.filter((r) => reasonOf(r) === "TRIGGERS_RATE_LIMITED")).toEqual([]);

    // The registrations themselves fail on quota, which is fine — the bucket
    // is consumed before the cap check, so every one of them charges a token.
    const writes = await withFrozenClock(async () => {
      const out: JsonRpcResponse[] = [];
      for (let i = 0; i < 60; i++) {
        out.push(await call({ action: "register", kind: "cron", key: `job:${i}`, cron: "0 9 * * 1" }));
      }
      return out;
    });
    const shed = writes.filter((r) => reasonOf(r) === "TRIGGERS_RATE_LIMITED");

    // Exactly one token per write: 50 pass the rung, the remaining 10 are shed.
    expect(shed).toHaveLength(60 - BUCKET_TOKENS);
    expect(writes.slice(0, BUCKET_TOKENS).some((r) => reasonOf(r) === "TRIGGERS_RATE_LIMITED")).toBe(
      false,
    );
    expect(errOf(shed[0] as JsonRpcResponse).code).toBe(-32029);
  });
});

// ── Register: the happy paths ─────────────────────────────────────────

describe("register — cron", () => {
  test("writes a dynamic row with a per-key cap and audits BOTH destinations", async () => {
    const res = await call({
      action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1",
      timezone: "America/New_York",
    });
    expect((res as { result: Record<string, unknown> }).result).toMatchObject({
      v: 1, key: "job:1", kind: "cron", cron: "0 9 * * 1",
    });

    const rows = await getTestDb().select().from(extensionSchedules)
      .where(eq(extensionSchedules.extensionId, extId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dynamic: true, key: "job:1", cron: "0 9 * * 1",
      timezone: "America/New_York", enabled: true,
    });
    // floor(90 / 3) — an equal share of the envelope, not the envelope.
    expect(rows[0]!.maxRunsPerDay).toBe(30);

    // Destination 1: sdk_capability_calls.
    expect(captured).toContainEqual(expect.objectContaining({
      capability: "triggers", action: "register", success: true, resourceId: "job:1",
    }));
    // Destination 2: audit_log.
    const audits = await auditRows("ext:sdk-trigger-registered");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.userId).toBe(userId);
  });

  test("two keys may share one cron expression", async () => {
    await call({ action: "register", kind: "cron", key: "job:a", cron: "0 9 * * 1" });
    await call({ action: "register", kind: "cron", key: "job:b", cron: "0 9 * * 1" });
    const rows = await getTestDb().select().from(extensionSchedules)
      .where(eq(extensionSchedules.extensionId, extId));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key))).toEqual(new Set(["job:a", "job:b"]));
  });
});

describe("register — webhook", () => {
  test("mints the slug host-side, returns the URL, never the secret", async () => {
    const res = await call({ action: "register", kind: "webhook", key: "job:1" });
    const result = (res as { result: Record<string, unknown> }).result;
    const expected = mintWebhookSlug("factory-", EXT_NAME, "job:1");
    expect(result).toMatchObject({
      v: 1, key: "job:1", kind: "webhook", slug: expected,
      url: `/api/hooks/${EXT_NAME}/${expected}`,
    });
    // The token is shown once via the existing rotate route; echoing it in
    // an RPC result would put it in every log and audit sink downstream.
    expect(JSON.stringify(result)).not.toContain("ezhook_");
    // ...but a secret WAS minted, so the hook is usable immediately.
    expect(await getWebhookSecret(EXT_NAME, expected)).toBeTruthy();
  });

  test("a slug supplied on the wire is IGNORED — the host mints its own", async () => {
    const res = await call({
      action: "register", kind: "webhook", key: "job:1", slug: "victim-hook",
    });
    const result = (res as { result: Record<string, string> }).result;
    expect(result.slug).toBe(mintWebhookSlug("factory-", EXT_NAME, "job:1"));
    expect(result.slug).not.toBe("victim-hook");
  });

  test("audits both destinations", async () => {
    await call({ action: "register", kind: "webhook", key: "job:1" });
    expect(captured).toContainEqual(expect.objectContaining({
      capability: "triggers", action: "register", success: true,
    }));
    expect(await auditRows("ext:sdk-trigger-registered")).toHaveLength(1);
  });

  test("refuses when the minted slug collides with a MANIFEST hook", async () => {
    const slug = mintWebhookSlug("factory-", EXT_NAME, "job:1");
    await getTestDb().insert(extensionWebhooks).values({ extensionId: EXT_NAME, slug });
    const res = await call({ action: "register", kind: "webhook", key: "job:1" });
    expect(errOf(res).reason).toBe("TRIGGERS_WRITE_FAILED");
  });
});

// ── T4: idempotency ───────────────────────────────────────────────────

describe("T4 — idempotent registration", () => {
  test("registering a cron twice yields ONE row", async () => {
    await call({ action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" });
    await call({ action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" });
    const rows = await getTestDb().select().from(extensionSchedules)
      .where(eq(extensionSchedules.extensionId, extId));
    expect(rows).toHaveLength(1);
  });

  test("registering a webhook twice yields one row, SAME slug and SAME secret", async () => {
    // A job editor saving twice is the normal case. Rotating the secret
    // would silently invalidate a token the user already wired into a
    // third-party system.
    const first = await call({ action: "register", kind: "webhook", key: "job:1" });
    const slug = (first as { result: { slug: string } }).result.slug;
    const secret = await getWebhookSecret(EXT_NAME, slug);

    const second = await call({ action: "register", kind: "webhook", key: "job:1" });
    expect((second as { result: { slug: string } }).result.slug).toBe(slug);

    const rows = await getTestDb().select().from(extensionWebhooks)
      .where(eq(extensionWebhooks.extensionId, EXT_NAME));
    expect(rows).toHaveLength(1);
    expect(await getWebhookSecret(EXT_NAME, slug)).toBe(secret!);
  });
});

// ── Unregister ────────────────────────────────────────────────────────

describe("unregister", () => {
  test("a cron row is removed and audited to both destinations", async () => {
    await call({ action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" });
    captured = [];
    const res = await call({ action: "unregister", kind: "cron", key: "job:1" });
    expect((res as { result: Record<string, unknown> }).result)
      .toMatchObject({ key: "job:1", removed: true });
    expect(await getTestDb().select().from(extensionSchedules)
      .where(eq(extensionSchedules.extensionId, extId))).toHaveLength(0);
    expect(captured[0]).toMatchObject({ action: "unregister", success: true });
    expect(await auditRows("ext:sdk-trigger-unregistered")).toHaveLength(1);
  });

  test("a webhook is SOFT-deleted and its secret is destroyed", async () => {
    const reg = await call({ action: "register", kind: "webhook", key: "job:1" });
    const slug = (reg as { result: { slug: string } }).result.slug;
    expect(await getWebhookSecret(EXT_NAME, slug)).toBeTruthy();

    await call({ action: "unregister", kind: "webhook", key: "job:1" });

    // The ROW survives (its delivery history would CASCADE on a hard
    // delete) but is disabled and its key freed.
    const rows = await getTestDb().select().from(extensionWebhooks)
      .where(eq(extensionWebhooks.extensionId, EXT_NAME));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ enabled: false, key: null });
    // The SECRET does not survive — a revoked hook's token must stop
    // authenticating immediately.
    expect(await getWebhookSecret(EXT_NAME, slug)).toBeNull();
  });

  test("unregistering an unknown key is TRIGGER_NOT_FOUND", async () => {
    for (const kind of ["cron", "webhook"]) {
      captured = [];
      const res = await call({ action: "unregister", kind, key: "job:ghost" });
      expect(errOf(res).reason).toBe("TRIGGER_NOT_FOUND");
      expect(captured[0]?.errorCode).toBe("TRIGGER_NOT_FOUND");
    }
  });
});

// ── List ──────────────────────────────────────────────────────────────

describe("list", () => {
  test("returns this extension's crons and hooks, and audits", async () => {
    await call({ action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" });
    await call({ action: "register", kind: "webhook", key: "hook:1" });
    captured = [];

    const res = await call({ action: "list" });
    const triggers = (res as { result: { triggers: Record<string, unknown>[] } })
      .result.triggers;
    expect(triggers).toHaveLength(2);
    expect(triggers.find((t) => t.kind === "cron")).toMatchObject({
      key: "job:1", cron: "0 9 * * 1", enabled: true,
    });
    expect(triggers.find((t) => t.kind === "webhook")).toMatchObject({
      key: "hook:1", enabled: true,
    });
    expect(captured[0]).toMatchObject({ action: "list", success: true });
  });

  test("cross-extension enumeration is inexpressible", async () => {
    // Both ids come from the registry, never the wire — there is no param
    // that could name another extension.
    await call({ action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" });
    const other = await ensureOtherExtension();
    await getTestDb().insert(extensionSchedules).values({
      extensionId: other, cron: "0 9 * * 1", nextFireAt: NOW,
      dynamic: true, key: "job:secret",
    });

    const res = await call({ action: "list", extensionId: other, extensionName: "other-ext" });
    const triggers = (res as { result: { triggers: { key: string }[] } }).result.triggers;
    expect(triggers.map((t) => t.key)).toEqual(["job:1"]);
  });

  test("excludes soft-deleted webhook tombstones", async () => {
    await call({ action: "register", kind: "webhook", key: "hook:1" });
    await call({ action: "unregister", kind: "webhook", key: "hook:1" });
    const res = await call({ action: "list" });
    expect((res as { result: { triggers: unknown[] } }).result.triggers).toHaveLength(0);
  });
});

let otherExtId: string | undefined;
async function ensureOtherExtension(): Promise<string> {
  if (otherExtId) return otherExtId;
  const [row] = await getTestDb().insert(extensions).values({
    name: "trig-other-ext", version: "1.0.0", description: "",
    manifest: manifestWith({ webhookPrefix: "other-" }) as never,
    source: "test", enabled: true, grantedPermissions: {} as never,
  }).returning({ id: extensions.id });
  otherExtId = row!.id;
  return otherExtId;
}

// ── Audit resilience ──────────────────────────────────────────────────

// ── Safeguards ────────────────────────────────────────────────────────

describe("write and secret safeguards", () => {
  const MISSING_EXT = "00000000-0000-0000-0000-000000000000";

  test("a cron row write failure is TRIGGERS_WRITE_FAILED, not a crash", async () => {
    // A vanished extension row makes the FK reject the insert — the
    // realistic shape of this failure (uninstall racing a registration).
    const res = await call(
      { action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" },
      { extensionId: MISSING_EXT },
    );
    expect(errOf(res).reason).toBe("TRIGGERS_WRITE_FAILED");
    expect(errOf(res).code).toBe(-32603);
    expect(captured[0]?.errorCode).toBe("TRIGGERS_WRITE_FAILED");
  });

  test("a webhook row write failure is TRIGGERS_WRITE_FAILED", async () => {
    const res = await call(
      { action: "register", kind: "webhook", key: "job:1" },
      { extensionName: "no-such-extension" },
    );
    expect(errOf(res).reason).toBe("TRIGGERS_WRITE_FAILED");
  });

  test("a minted slug that fails WEBHOOK_SLUG_RE is refused", async () => {
    // Only reachable from a hand-edited grant row: the clamp cannot
    // produce a prefix like this. That is exactly why the handler
    // re-validates rather than trusting the grant.
    const res = await call(
      { action: "register", kind: "webhook", key: "job:1" },
      {
        grantedPermissions: {
          triggers: { ...GRANT, webhookPrefix: "BAD_PREFIX!" }, grantedAt: {},
        },
      },
    );
    expect(errOf(res).reason).toBe("TRIGGERS_WRITE_FAILED");
    // Nothing was written.
    expect(await getTestDb().select().from(extensionWebhooks)
      .where(eq(extensionWebhooks.extensionId, EXT_NAME))).toHaveLength(0);
  });

  test("a secret-mint failure REFUSES the registration (fail-closed)", async () => {
    const failing = {
      ...deps,
      ensureWebhookSecret: async () => { throw new Error("AEAD store down"); },
    };
    const res = await handleTriggersRpc(
      req({ action: "register", kind: "webhook", key: "job:1" }),
      ctxWith(),
      failing as never,
    );
    expect(errOf(res).reason).toBe("TRIGGERS_SECRET_FAILED");
    // A secretless hook is un-authenticatable — the public route rejects
    // it unconditionally — so reporting failure is the honest answer.
    expect(captured.at(-1)?.errorCode).toBe("TRIGGERS_SECRET_FAILED");
  });

  test("a secret-DELETE failure still completes the unregister", async () => {
    // Asymmetric on purpose: the row is already disabled, so the hook is
    // dead either way and a lingering secret row is inert.
    await call({ action: "register", kind: "webhook", key: "job:1" });
    const failing = {
      ...deps,
      deleteWebhookSecret: async () => { throw new Error("AEAD store down"); },
    };
    const res = await handleTriggersRpc(
      req({ action: "unregister", kind: "webhook", key: "job:1" }),
      ctxWith(),
      failing as never,
    );
    expect((res as { result: Record<string, unknown> }).result)
      .toMatchObject({ removed: true });
    const rows = await getTestDb().select().from(extensionWebhooks)
      .where(eq(extensionWebhooks.extensionId, EXT_NAME));
    expect(rows[0]).toMatchObject({ enabled: false, key: null });
  });

  test("an audit_log write failure never fails the registration", async () => {
    // A userId with no `users` row makes the FK reject the audit insert.
    const res = await call(
      { action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" },
      { userId: MISSING_EXT },
    );
    expect((res as { result?: unknown }).result).toBeDefined();
    expect(await getTestDb().select().from(extensionSchedules)
      .where(eq(extensionSchedules.extensionId, extId))).toHaveLength(1);
  });
});

describe("audit resilience", () => {
  test("an audit failure never turns a successful register into an error", async () => {
    const throwing = {
      ...deps,
      recordCapabilityCall: async () => { throw new Error("audit sink down"); },
    };
    const res = await handleTriggersRpc(
      req({ action: "register", kind: "cron", key: "job:1", cron: "0 9 * * 1" }),
      ctxWith(),
      throwing as never,
    );
    expect((res as { result?: unknown }).result).toBeDefined();
    // The row still landed.
    expect(await getTestDb().select().from(extensionSchedules)
      .where(and(
        eq(extensionSchedules.extensionId, extId),
        eq(extensionSchedules.key, "job:1"),
      ))).toHaveLength(1);
  });
});
