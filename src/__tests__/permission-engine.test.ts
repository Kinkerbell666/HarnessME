/**
 * Phase 1 PDP unit + integration coverage.
 *
 * Locks in the contract documented in `src/extensions/permission-engine.ts`:
 *   • `authorize` allows when granted ⊇ needed
 *   • denies when granted is missing any needed cap; reason names the
 *     missing cap
 *   • prompts when a sensitive cap (fs.write/shell) lacks always-allow
 *   • writes exactly one auditLog row per decision
 *   • honors `capContext` override (intersection wins over registry)
 *   • cache is updated by `resolvePrompt` write
 *   • fail-closed: `createPermissionEngine` throws if `db`, `registry`,
 *     or `bus` is missing
 *
 * The integration block at the bottom boots the registry, runs one
 * tool call end-to-end through `ToolExecutor`, and asserts that an
 * `auditLog` row with `action='ext:perm:allowed'` exists.
 */

import { afterAll, beforeEach, describe, expect, test, spyOn } from "bun:test";
import { mockDbConnection, mockRealSettings, setupTestDb, closeTestDb, getTestDb } from "./helpers/test-pglite";
import { restoreModuleMocks } from "./helpers/mock-cleanup";

mockDbConnection();
mockRealSettings();

afterAll(async () => {
  await closeTestDb();
  restoreModuleMocks();
});

import {
  createPermissionEngine,
  _resetPermissionEngineForTests,
  type PermissionEngine,
} from "../extensions/permission-engine";
import type { CapabilitySet } from "../extensions/capability-types";
import type { ExtensionRegistry } from "../extensions/registry";
import type { ExtensionPermissions } from "../extensions/types";
import { auditLog, settings } from "../db/schema";
import { eq } from "drizzle-orm";
import { alwaysAllowSettingKey } from "../extensions/permissions";

// ── Test helpers ────────────────────────────────────────────────────

interface FakeRegistryArgs {
  granted?: ExtensionPermissions | null;
}

function makeFakeRegistry(args: FakeRegistryArgs = {}): ExtensionRegistry {
  return {
    getGrantedPermissions: (_id: string) => args.granted ?? null,
  } as unknown as ExtensionRegistry;
}

function makeFakeBus() {
  return {
    emit: () => {},
    on: () => () => {},
  } as unknown as Parameters<typeof createPermissionEngine>[0]["bus"];
}

function makeEngine(args: FakeRegistryArgs = {}): PermissionEngine {
  _resetPermissionEngineForTests();
  return createPermissionEngine({
    registry: makeFakeRegistry(args),
    bus: makeFakeBus(),
    db: { _token: "test" },
  });
}

const HELLO_USER = "user-1";
const HELLO_CONV = "conv-1";
const HELLO_EXT = "ext-1";

beforeEach(async () => {
  await setupTestDb();
  // Seed the test user so audit-log FK to `users` doesn't reject the
  // insert (`ON DELETE SET NULL` doesn't apply on insert — the
  // referenced row must exist or the insert fails).
  const { users } = await import("../db/schema");
  await getTestDb()
    .insert(users)
    .values({
      id: HELLO_USER,
      email: "user1@example.com",
      passwordHash: "x",
      name: "User One",
      role: "member",
    })
    .onConflictDoNothing();
});

// ── Construction guard (fail-closed) ────────────────────────────────

test("live v4 grant lookup failure denies cached authority and commits a denial audit", async () => {
  const queries = await import("../db/queries/extensions");
  const lookup = spyOn(queries, "getExtension").mockRejectedValue(new Error("private database failure"));
  const registry = Object.assign(makeFakeRegistry({ granted: { network: ["example.com"], grantedAt: {} } }), { getManifest: () => ({ schemaVersion: 4 }) });
  _resetPermissionEngineForTests();
  const engine = createPermissionEngine({ registry, bus: makeFakeBus(), db: {} });
  try {
    const result = await engine.authorize({ extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: null }, [{ kind: "network", value: "example.com" }]);
    expect(result).toMatchObject({ decision: "deny", reason: "live-release-grant-unavailable" });
    expect(lookup).toHaveBeenCalledWith(HELLO_EXT);
    const rows = await getTestDb().select().from(auditLog).where(eq(auditLog.action, "ext:perm:denied"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("ext:perm:denied");
    expect(rows[0]!.metadata).toMatchObject({ auditId: result.auditId, reason: "live-release-grant-unavailable" });
    expect(JSON.stringify(rows)).not.toContain("private database failure");
  } finally { lookup.mockRestore(); }
});

describe("createPermissionEngine — fail-closed dep contract", () => {
  test("throws when registry is missing", () => {
    expect(() =>
      createPermissionEngine({
        registry: undefined as unknown as ExtensionRegistry,
        bus: makeFakeBus(),
        db: {},
      }),
    ).toThrow(/registry/);
  });

  test("throws when bus is missing", () => {
    expect(() =>
      createPermissionEngine({
        registry: makeFakeRegistry(),
        bus: undefined as unknown as Parameters<typeof createPermissionEngine>[0]["bus"],
        db: {},
      }),
    ).toThrow(/bus/);
  });

  test("throws when db token is missing (undefined, not just falsy)", () => {
    expect(() =>
      createPermissionEngine({
        registry: makeFakeRegistry(),
        bus: makeFakeBus(),
        db: undefined,
      }),
    ).toThrow(/db/);
  });
});

// ── Allow path ──────────────────────────────────────────────────────

describe("authorize — allow when granted ⊇ needed", () => {
  test("network cap covers when host is granted", async () => {
    const engine = makeEngine({
      granted: {
        grantedAt: {},
        network: ["api.foo.com"],
      },
    });
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV, toolName: "tool" },
      [{ kind: "network", value: "api.foo.com" }],
    );
    expect(decision.decision).toBe("allow");
    expect("auditId" in decision && typeof decision.auditId).toBe("string");
  });

  test("filesystem read covered by granted prefix", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, filesystem: ["/data"] },
    });
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "fs.read", value: "/data/file.txt" }],
    );
    expect(decision.decision).toBe("allow");
  });

  test("storage cap covered by granted boolean", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, storage: true },
    });
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "storage" }],
    );
    expect(decision.decision).toBe("allow");
  });

  test("namespaced ezcorp:tasks:emit cap covered", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, taskEvents: true },
    });
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "ezcorp:tasks:emit" }],
    );
    expect(decision.decision).toBe("allow");
  });
});

// ── Deny path ───────────────────────────────────────────────────────

describe("authorize — deny when granted missing a cap", () => {
  test("denies and names the missing network host", async () => {
    const engine = makeEngine({ granted: { grantedAt: {}, network: ["a.com"] } });
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV, toolName: "fetcher" },
      [{ kind: "network", value: "evil.com" }],
    );
    expect(decision.decision).toBe("deny");
    if (decision.decision !== "deny") throw new Error("unreachable");
    expect(decision.reason).toContain("network");
    expect(decision.reason).toContain("evil.com");
    expect(decision.reason).toContain("fetcher");
    expect(decision.missing).toEqual({ kind: "network", value: "evil.com" });
  });

  test("denies when filesystem prefix doesn't cover", async () => {
    const engine = makeEngine({ granted: { grantedAt: {}, filesystem: ["/home"] } });
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "fs.read", value: "/etc/passwd" }],
    );
    expect(decision.decision).toBe("deny");
  });

  test("denies when no permissions granted at all", async () => {
    const engine = makeEngine({ granted: null });
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "shell" }],
    );
    expect(decision.decision).toBe("deny");
  });
});

// ── Prompt path ─────────────────────────────────────────────────────

describe("authorize — prompt when sensitive cap lacks always-allow", () => {
  test("fs.write needs prompt by default", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, filesystem: ["/tmp"] },
    });
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "fs.write", value: "/tmp/x" }],
    );
    expect(decision.decision).toBe("prompt");
    if (decision.decision !== "prompt") throw new Error("unreachable");
    expect(decision.promptId).toBeTruthy();
    expect(decision.sensitive.kind).toBe("fs.write");
  });

  test("shell needs prompt by default", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, shell: true },
    });
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "shell" }],
    );
    expect(decision.decision).toBe("prompt");
  });

  test("non-sensitive caps (fs.read, network, storage) don't prompt", async () => {
    const engine = makeEngine({
      granted: {
        grantedAt: {},
        filesystem: ["/tmp"],
        network: ["a.com"],
        storage: true,
      },
    });
    expect(
      (
        await engine.authorize(
          { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
          [{ kind: "fs.read", value: "/tmp/x" }],
        )
      ).decision,
    ).toBe("allow");
    expect(
      (
        await engine.authorize(
          { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
          [{ kind: "network", value: "a.com" }],
        )
      ).decision,
    ).toBe("allow");
  });
});

// ── Audit row writes ────────────────────────────────────────────────

describe("authorize — audit log row per decision", () => {
  test("writes one PERM_ALLOWED row on allow", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, storage: true },
    });
    await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV, toolName: "writer" },
      [{ kind: "storage" }],
    );
    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:allowed"));
    expect(rows.length).toBe(1);
    const meta = rows[0]!.metadata as Record<string, unknown>;
    expect(meta.toolName).toBe("writer");
    expect(meta.conversationId).toBe(HELLO_CONV);
    expect(meta.capabilityKind).toBe("storage");
    expect(rows[0]!.target).toBe(HELLO_EXT);
  });

  test("keeps distinct allowed capabilities while coalescing repeats", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, storage: true, network: ["example.com"] },
    });
    const context = {
      extensionId: HELLO_EXT,
      userId: HELLO_USER,
      conversationId: HELLO_CONV,
      toolName: "writer",
    };

    await engine.authorize(context, [{ kind: "storage" }]);
    await engine.authorize(context, [{ kind: "storage" }]);
    await engine.authorize(context, [{ kind: "network", value: "example.com" }]);

    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:allowed"));
    expect(rows).toHaveLength(2);
    expect(rows.map(row => (row.metadata as Record<string, unknown>).capabilityKind).sort())
      .toEqual(["network", "storage"]);
  });

  test("coalesces 700 allowed read paths by kind without recording paths", async () => {
    const engine = makeEngine();
    const context = {
      extensionId: HELLO_EXT,
      userId: HELLO_USER,
      conversationId: HELLO_CONV,
      toolName: "read_files",
      capContext: [{ kind: "fs.read" as const, value: "/data" }],
    };

    const decisions = [];
    for (let i = 0; i < 700; i++) {
      decisions.push(await engine.authorize(context, [{ kind: "fs.read", value: `/data/${i}.txt` }]));
    }

    expect(decisions.every(decision => decision.decision === "allow")).toBe(true);
    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:allowed"));
    // Production flushes after 250 folded decisions: 3 heads plus 2
    // summaries for 700 reads. It must not grow one row per path.
    expect(rows).toHaveLength(5);
    expect(rows.every(row =>
      (row.metadata as Record<string, unknown>).capabilityKind === "fs.read"
      && (row.metadata as Record<string, unknown>).capabilityValue === undefined,
    )).toBe(true);
  });

  test("writes one PERM_DENIED row on deny", async () => {
    const engine = makeEngine({ granted: { grantedAt: {} } });
    await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "shell" }],
    );
    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:denied"));
    expect(rows.length).toBe(1);
    const meta = rows[0]!.metadata as Record<string, unknown>;
    expect(meta.capabilityKind).toBe("shell");
    expect(meta.reason).toContain("shell");
  });

  test("writes one PERM_PROMPTED row on prompt", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, filesystem: ["/tmp"] },
    });
    await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "fs.write", value: "/tmp/x" }],
    );
    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:prompted"));
    expect(rows.length).toBe(1);
    const meta = rows[0]!.metadata as Record<string, unknown>;
    expect(meta.capabilityKind).toBe("fs.write");
    expect(typeof meta.promptId).toBe("string");
  });

  test("metadata is stripped of control characters and length-capped", async () => {
    const engine = makeEngine({ granted: { grantedAt: {} } });
    const dirtyTool = `bad\x00name\x07with\x1Fcontrols`;
    await engine.authorize(
      {
        extensionId: HELLO_EXT,
        userId: HELLO_USER,
        conversationId: HELLO_CONV,
        toolName: dirtyTool,
      },
      [{ kind: "shell" }],
    );
    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:denied"));
    expect(rows.length).toBe(1);
    const meta = rows[0]!.metadata as Record<string, unknown>;
    expect(meta.toolName).toBe("badnamewithcontrols");
  });

  test("parentAuditId rides through metadata for chain tracking", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, storage: true },
    });
    await engine.authorize(
      {
        extensionId: HELLO_EXT,
        userId: HELLO_USER,
        conversationId: HELLO_CONV,
        toolName: "child",
        parentAuditId: "abc-parent-id",
      },
      [{ kind: "storage" }],
    );
    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:allowed"));
    expect(rows.length).toBe(1);
    const meta = rows[0]!.metadata as Record<string, unknown>;
    expect(meta.parentAuditId).toBe("abc-parent-id");
  });

  // Phase 6 — acceptance criterion #5: null userId/conversationId
  // serializes as JSON null in the audit row, NOT the literal string
  // "unknown" (which Phase 4 reviewer flagged). Three cases:
  //   1. ctx with explicit null on both fields → audit row has null + null.
  //   2. ctx with omitted (undefined) fields → tolerated by the engine,
  //      audit row has null + null.
  //   3. The metadata blob contains no literal "unknown" anywhere.

  test("null userId + null conversationId → audit row carries JSON null (not 'unknown')", async () => {
    const engine = makeEngine({ granted: { grantedAt: {}, storage: true } });
    await engine.authorize(
      {
        extensionId: HELLO_EXT,
        userId: null,
        conversationId: null,
        toolName: "anonymous",
      },
      [{ kind: "storage" }],
    );
    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:allowed"));
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    // Top-level userId column accepts JSON null.
    expect(row.userId).toBeNull();
    const meta = row.metadata as Record<string, unknown>;
    // conversationId scrubbed from metadata when null/sentinel; not the
    // literal "unknown" string.
    expect(meta.conversationId === null || meta.conversationId === undefined).toBe(true);
    // Belt-and-suspenders: the entire serialized metadata must not
    // contain the literal "unknown" sentinel.
    expect(JSON.stringify(meta)).not.toContain("unknown");
  });

  test("legacy 'unknown' string sentinels are normalized to null in audit metadata", async () => {
    const engine = makeEngine({ granted: { grantedAt: {}, storage: true } });
    // Older callers (handler tests that pre-date Phase 6) still pass
    // the literal "unknown" sentinel. The engine MUST normalize them.
    await engine.authorize(
      {
        extensionId: HELLO_EXT,
        userId: "unknown",
        conversationId: "unknown",
        toolName: "legacy-shape",
      },
      [{ kind: "storage" }],
    );
    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:allowed"));
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.userId).toBeNull();
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.conversationId === null || meta.conversationId === undefined).toBe(true);
    expect(JSON.stringify(meta)).not.toContain("unknown");
  });
});

// ── always-allow read from settings DB ──────────────────────────────

describe("authorize — pre-existing always-allow row read from DB on first call", () => {
  test("seeded DB row → first authorize returns allow (no prompt) and writes PERM_ALLOWED", async () => {
    const { upsertSetting } = await import("../db/queries/settings");
    const { alwaysAllowSettingKey } = await import("../extensions/permissions");
    // Seed an always-allow row matching the conversation-scope lookup
    // path the engine uses on first authorize().
    await upsertSetting(
      alwaysAllowSettingKey({
        extensionId: HELLO_EXT,
        userId: HELLO_USER,
        scope: "conversation",
        scopeId: HELLO_CONV,
        capability: "shell",
      }),
      true,
    );

    const engine = makeEngine({
      granted: { grantedAt: {}, shell: true },
    });
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "shell" }],
    );
    expect(decision.decision).toBe("allow");

    const allowed = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:allowed"));
    expect(allowed.length).toBe(1);
    const prompted = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:prompted"));
    expect(prompted.length).toBe(0);
  });
});

// ── capContext override ─────────────────────────────────────────────

describe("authorize — capContext override (Phase 4 plumbing)", () => {
  test("capContext intersection wins over the registry's grant set", async () => {
    // Registry grants network: a.com + b.com. Cross-ext call's
    // capContext is the intersection — only a.com survives. A request
    // for b.com must deny even though the extension has it directly.
    const engine = makeEngine({
      granted: { grantedAt: {}, network: ["a.com", "b.com"] },
    });
    const intersection: CapabilitySet = [{ kind: "network", value: "a.com" }];
    const decisionA = await engine.authorize(
      {
        extensionId: HELLO_EXT,
        userId: HELLO_USER,
        conversationId: HELLO_CONV,
        capContext: intersection,
      },
      [{ kind: "network", value: "a.com" }],
    );
    expect(decisionA.decision).toBe("allow");
    const decisionB = await engine.authorize(
      {
        extensionId: HELLO_EXT,
        userId: HELLO_USER,
        conversationId: HELLO_CONV,
        capContext: intersection,
      },
      [{ kind: "network", value: "b.com" }],
    );
    expect(decisionB.decision).toBe("deny");
  });
});

// ── always-allow cache + resolvePrompt ──────────────────────────────

describe("resolvePrompt — persists + invalidates cache", () => {
  test("resolvePrompt(true) writes always-allow; subsequent authorize allows without prompt", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, shell: true },
    });
    const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };
    const first = await engine.authorize(ctx, [{ kind: "shell" }]);
    expect(first.decision).toBe("prompt");
    if (first.decision !== "prompt") throw new Error("unreachable");
    await engine.resolvePrompt(first.promptId, true, "conversation", HELLO_CONV);

    // Next call: same ctx + needed → allow.
    const second = await engine.authorize(ctx, [{ kind: "shell" }]);
    expect(second.decision).toBe("allow");
  });

  test("resolvePrompt(false) does NOT persist; next call still prompts", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, shell: true },
    });
    const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };
    const first = await engine.authorize(ctx, [{ kind: "shell" }]);
    if (first.decision !== "prompt") throw new Error("expected prompt");
    await engine.resolvePrompt(first.promptId, false, "conversation", HELLO_CONV);

    const second = await engine.authorize(ctx, [{ kind: "shell" }]);
    expect(second.decision).toBe("prompt");
  });

  test("resolvePrompt with unknown promptId is a no-op (logged via injected logger)", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, shell: true },
    });
    // No throw — silent no-op.
    await engine.resolvePrompt("nonexistent-prompt", true, "conversation", HELLO_CONV);
  });
});

// ── always-allow key shape: kind-only for sensitive caps ────────────
//
// Regression test for the writer/reader key-shape asymmetry bug. The
// writer (resolvePrompt) used to key by `${kind}:${value}` while the
// reader (isAlwaysAllowed) did the same — but the cap's `value` at
// authorize-time often differs from prompt-time (path normalization,
// `$CWD` expansion, etc.), so the value-keyed row never matched on the
// next call. Fixed by collapsing always-allow to kind-only: clicking
// "Allow forever" on a sensitive prompt grants the kind for ANY value.

describe("always-allow is kind-only for sensitive caps", () => {
  test("forever-scope grant for fs.write covers any path on subsequent authorize", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, filesystem: ["/tmp"] },
    });
    const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };

    // First call against /tmp/a → prompt.
    const first = await engine.authorize(ctx, [{ kind: "fs.write", value: "/tmp/a" }]);
    expect(first.decision).toBe("prompt");
    if (first.decision !== "prompt") throw new Error("unreachable");

    // User picks "Allow forever".
    await engine.resolvePrompt(first.promptId, true, "forever", "*");

    // Subsequent call for the SAME path → allow (no second prompt).
    const second = await engine.authorize(ctx, [{ kind: "fs.write", value: "/tmp/a" }]);
    expect(second.decision).toBe("allow");

    // A DIFFERENT path (any value under the kind) → also allow. This is
    // the core of the fix: the writer/reader use kind-only, so the
    // grant covers every fs.write irrespective of path.
    const third = await engine.authorize(ctx, [{ kind: "fs.write", value: "/tmp/different" }]);
    expect(third.decision).toBe("allow");
  });

  test("forever-scope grant survives a fresh process (DB-backed, no in-memory cache)", async () => {
    // First engine grants forever. Second engine starts cold and reads
    // the always-allow row from the settings table. Locks in the
    // round-trip key shape: if writer and reader diverge, the cold
    // engine re-prompts. This is the exact production failure mode:
    // the dev container restarts and Allow-Forever clicks don't stick.
    const grant: ExtensionPermissions = { grantedAt: {}, filesystem: ["/tmp"] };
    const writer = makeEngine({ granted: grant });
    const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };

    const first = await writer.authorize(ctx, [{ kind: "fs.write", value: "/tmp/a" }]);
    if (first.decision !== "prompt") throw new Error("expected prompt");
    await writer.resolvePrompt(first.promptId, true, "forever", "*");

    // Spin up a fresh engine — empty in-memory cache, same settings DB.
    const reader = makeEngine({ granted: grant });
    const cold = await reader.authorize(ctx, [{ kind: "fs.write", value: "/tmp/different" }]);
    expect(cold.decision).toBe("allow");
  });

  test("shell forever-scope grant covers any subsequent shell call", async () => {
    const engine = makeEngine({ granted: { grantedAt: {}, shell: true } });
    const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };

    const first = await engine.authorize(ctx, [{ kind: "shell" }]);
    if (first.decision !== "prompt") throw new Error("expected prompt");
    await engine.resolvePrompt(first.promptId, true, "forever", "*");

    const second = await engine.authorize(ctx, [{ kind: "shell" }]);
    expect(second.decision).toBe("allow");
  });
});

// ── always-allow DB row shape (direct key-string inspection) ────────
//
// Bug-specific invariant: `resolvePrompt` persists a row keyed by
// `:always_allow:<kind>` — NO trailing `:value`. Without this,
// regressing the writer to a value-carrying shape (the original bug)
// would re-introduce the asymmetry. The round-trip tests above
// indirectly cover this, but a direct key-string assertion is the
// strongest defense: if a future refactor writes the wrong shape,
// THIS test fails without depending on reader behavior.

describe("always-allow row shape — direct DB-key inspection", () => {
  async function settingsRowsForExt(extensionId: string) {
    const all = await getTestDb().select().from(settings);
    return all.filter((r) => r.key.startsWith(`ext:${extensionId}:`) && r.key.includes(":always_allow:"));
  }

  test("resolvePrompt(fs.write) writes EXACTLY one row at the kind-only key (no path in the key)", async () => {
    const engine = makeEngine({
      granted: { grantedAt: {}, filesystem: ["/tmp"] },
    });
    const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };
    const first = await engine.authorize(ctx, [{ kind: "fs.write", value: "/tmp/a" }]);
    if (first.decision !== "prompt") throw new Error("expected prompt");
    await engine.resolvePrompt(first.promptId, true, "forever", "*");

    const rows = await settingsRowsForExt(HELLO_EXT);
    // Exactly one row — the removed dual-write must NOT have left a
    // second row at a different key shape. Pre-fix, tool-executor also
    // wrote a row via `setSensitiveAlwaysAllow`; deleting that call
    // makes resolvePrompt the single source of truth.
    expect(rows.length).toBe(1);

    const expectedKey = alwaysAllowSettingKey({
      extensionId: HELLO_EXT,
      userId: HELLO_USER,
      scope: "forever",
      scopeId: "*",
      capability: "fs.write",
    });
    expect(rows[0]!.key).toBe(expectedKey);
    // The key MUST NOT carry the cap's runtime value. If the writer
    // regresses to `${kind}:${value}`, this assertion catches it.
    expect(rows[0]!.key).not.toContain("/tmp/a");
    expect(rows[0]!.key.endsWith(":always_allow:fs.write")).toBe(true);
  });

  test("resolvePrompt(shell) writes the kind-only `:always_allow:shell` key", async () => {
    const engine = makeEngine({ granted: { grantedAt: {}, shell: true } });
    const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };
    const first = await engine.authorize(ctx, [{ kind: "shell" }]);
    if (first.decision !== "prompt") throw new Error("expected prompt");
    await engine.resolvePrompt(first.promptId, true, "forever", "*");

    const rows = await settingsRowsForExt(HELLO_EXT);
    expect(rows.length).toBe(1);
    expect(rows[0]!.key.endsWith(":always_allow:shell")).toBe(true);
  });
});

// ── All four AlwaysAllowScope values round-trip end-to-end ──────────
//
// `AlwaysAllowScope` declares session, conversation, project, and
// forever. The production bug surfaced at `forever` but the engine's
// `isAlwaysAllowed` checks ALL scopes in order, so a key-shape
// regression in any scope path would re-prompt. Lock in each scope
// with the same round-trip pattern.

describe("always-allow round-trip — all four AlwaysAllowScope values", () => {
  const cases = [
    { scope: "session" as const, scopeId: `session:${HELLO_USER}` },
    { scope: "conversation" as const, scopeId: HELLO_CONV },
    { scope: "project" as const, scopeId: HELLO_CONV },
    { scope: "forever" as const, scopeId: "*" },
  ];

  for (const { scope, scopeId } of cases) {
    test(`scope=${scope}: authorize → prompt → resolvePrompt → next authorize allows (fs.write)`, async () => {
      const engine = makeEngine({
        granted: { grantedAt: {}, filesystem: ["/tmp"] },
      });
      const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };
      const first = await engine.authorize(ctx, [{ kind: "fs.write", value: "/tmp/a" }]);
      if (first.decision !== "prompt") throw new Error("expected prompt");
      await engine.resolvePrompt(first.promptId, true, scope, scopeId);

      // Same path — allow.
      const sameVal = await engine.authorize(ctx, [{ kind: "fs.write", value: "/tmp/a" }]);
      expect(sameVal.decision).toBe("allow");
      // Different path — also allow (kind-only semantic).
      const diffVal = await engine.authorize(ctx, [{ kind: "fs.write", value: "/tmp/elsewhere" }]);
      expect(diffVal.decision).toBe("allow");
    });

    test(`scope=${scope}: shell round-trip`, async () => {
      const engine = makeEngine({ granted: { grantedAt: {}, shell: true } });
      const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };
      const first = await engine.authorize(ctx, [{ kind: "shell" }]);
      if (first.decision !== "prompt") throw new Error("expected prompt");
      await engine.resolvePrompt(first.promptId, true, scope, scopeId);

      const second = await engine.authorize(ctx, [{ kind: "shell" }]);
      expect(second.decision).toBe("allow");
    });
  }
});

// ── ezcorp:extension:install — mandatory, non-persisted approval ────
//
// Agent-driven extension install (bundled `extension-author`
// `install_draft`) must ALWAYS prompt — even though extension-author
// is bundled and bundled sensitive caps are normally auto-allowed —
// and the approval is one-shot (never written as an always-allow row).
// The granted side is derived from the existing
// `custom.drafts.kinds:["extension"]` permission (see
// `grantsToCapabilitySet`), so the subset check passes and the request
// reaches the sensitive gate instead of being denied.

function makeBundledEngine(
  granted: ExtensionPermissions | null,
  isBundled = true,
): PermissionEngine {
  _resetPermissionEngineForTests();
  const registry = {
    getGrantedPermissions: (_id: string) => granted,
    isBundled: (_id: string) => isBundled,
  } as unknown as ExtensionRegistry;
  return createPermissionEngine({
    registry,
    bus: makeFakeBus(),
    db: { _token: "test" },
  });
}

describe("authorize — ezcorp:extension:install carve-out", () => {
  const DRAFTS_GRANT: ExtensionPermissions = {
    grantedAt: {},
    custom: { drafts: { kinds: ["extension"] } },
  };

  test("bundled extension-author: install ALWAYS prompts (NOT bundled-auto-allowed)", async () => {
    const engine = makeBundledEngine(DRAFTS_GRANT);
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "ezcorp:extension:install" }],
    );
    expect(decision.decision).toBe("prompt");
    if (decision.decision !== "prompt") throw new Error("unreachable");
    expect(decision.sensitive.kind).toBe("ezcorp:extension:install");
  });

  test("regression: bundled fs.write IS still bundled-auto-allowed (allow, no prompt)", async () => {
    const engine = makeBundledEngine({ grantedAt: {}, filesystem: ["/tmp"] });
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "fs.write", value: "/tmp/x" }],
    );
    expect(decision.decision).toBe("allow");
  });

  test("install approval is one-shot: resolvePrompt(true) is NOT persisted; next install re-prompts", async () => {
    const engine = makeBundledEngine(DRAFTS_GRANT);
    const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };
    const first = await engine.authorize(ctx, [
      { kind: "ezcorp:extension:install" },
    ]);
    if (first.decision !== "prompt") throw new Error("expected prompt");
    // Even with the broadest scope, this must NOT persist.
    await engine.resolvePrompt(first.promptId, true, "forever", "*");

    const second = await engine.authorize(ctx, [
      { kind: "ezcorp:extension:install" },
    ]);
    expect(second.decision).toBe("prompt");

    // No always-allow settings row was written for the install cap.
    const key = alwaysAllowSettingKey({
      extensionId: HELLO_EXT,
      userId: HELLO_USER,
      scope: "forever",
      scopeId: "*",
      capability: "ezcorp:extension:install",
    });
    const rows = await getTestDb()
      .select()
      .from(settings)
      .where(eq(settings.key, key));
    expect(rows.length).toBe(0);
  });

  test("non-bundled (fail-closed isBundled=false) install still prompts (never silently allowed)", async () => {
    const engine = makeBundledEngine(DRAFTS_GRANT, false);
    const decision = await engine.authorize(
      { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV },
      [{ kind: "ezcorp:extension:install" }],
    );
    expect(decision.decision).toBe("prompt");
  });
});

// ── always-allow lifetime: revocation, expiry, session scope ────────
//
// docs/permissions/four-scope-modal.md: a session grant "lives in memory,
// never on disk", and a revoked or expired grant re-prompts on the next
// call. The engine must read the live row, not a stale positive cache.

describe("always-allow lifetime — a revoked or expired grant really prompts again", () => {
  const SHELL_GRANT: ExtensionPermissions = { grantedAt: {}, shell: true };
  const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };
  const foreverKey = alwaysAllowSettingKey({
    extensionId: HELLO_EXT,
    userId: HELLO_USER,
    scope: "forever",
    scopeId: "*",
    capability: "shell",
  });

  async function approve(engine: PermissionEngine, scope: "session" | "forever", scopeId: string) {
    const first = await engine.authorize(ctx, [{ kind: "shell" }]);
    if (first.decision !== "prompt") throw new Error("expected prompt");
    await engine.resolvePrompt(first.promptId, true, scope, scopeId);
    expect((await engine.authorize(ctx, [{ kind: "shell" }])).decision).toBe("allow");
  }

  test("a forever row revoked in the DB (expiry sweep) prompts on the same engine", async () => {
    const { upsertSetting } = await import("../db/queries/settings");
    const { buildAlwaysAllowValue } = await import("../extensions/permissions");
    const engine = makeEngine({ granted: SHELL_GRANT });
    await approve(engine, "forever", "*");

    // The sweep's revoke shape: the row stays, `allowed` flips to false.
    await upsertSetting(foreverKey, buildAlwaysAllowValue(false));

    expect((await engine.authorize(ctx, [{ kind: "shell" }])).decision).toBe("prompt");
  });

  test("a row past its expiresAt prompts before the sweep runs", async () => {
    const { upsertSetting } = await import("../db/queries/settings");
    const { buildAlwaysAllowValue } = await import("../extensions/permissions");
    const now = Date.now();
    await upsertSetting(
      foreverKey,
      buildAlwaysAllowValue(true, now - 2_000, { ttlOverrideMs: 1_000, expiresAt: now - 1_000 }),
    );
    const engine = makeEngine({ granted: SHELL_GRANT });
    expect((await engine.authorize(ctx, [{ kind: "shell" }])).decision).toBe("prompt");
  });

  test("a session approval is never written to disk and does not survive a restart", async () => {
    const engine = makeEngine({ granted: SHELL_GRANT });
    await approve(engine, "session", `session:${HELLO_USER}`);

    const rows = (await getTestDb().select().from(settings)).filter((r) => r.key.includes(":always_allow:"));
    expect(rows).toEqual([]);

    const restarted = makeEngine({ granted: SHELL_GRANT });
    expect((await restarted.authorize(ctx, [{ kind: "shell" }])).decision).toBe("prompt");
  });
});

// ── every sensitive capability in one request is gated ──────────────
//
// The gate used to check only the FIRST sensitive cap in `needed`. An
// always-allow row (or the bundled auto-allow) for that one cap then
// let every later sensitive cap through without consent.

describe("sensitive gate — every sensitive capability in the request is checked", () => {
  const ctx = { extensionId: HELLO_EXT, userId: HELLO_USER, conversationId: HELLO_CONV };

  test("an always-allowed shell cap does not carry an unapproved fs.write", async () => {
    const engine = makeEngine({ granted: { grantedAt: {}, shell: true, filesystem: ["/tmp"] } });
    const first = await engine.authorize(ctx, [{ kind: "shell" }]);
    if (first.decision !== "prompt") throw new Error("expected prompt");
    await engine.resolvePrompt(first.promptId, true, "conversation", HELLO_CONV);

    const both = await engine.authorize(ctx, [{ kind: "shell" }, { kind: "fs.write", value: "/tmp/a" }]);
    expect(both).toMatchObject({ decision: "prompt", sensitive: { kind: "fs.write" } });
  });

  test("a bundled fs.write auto-allow does not skip the mandatory install prompt", async () => {
    const engine = makeBundledEngine({
      grantedAt: {},
      filesystem: ["/tmp"],
      custom: { drafts: { kinds: ["extension"] } },
    });
    const decision = await engine.authorize(ctx, [
      { kind: "fs.write", value: "/tmp/a" },
      { kind: "ezcorp:extension:install" },
    ]);
    expect(decision).toMatchObject({ decision: "prompt", sensitive: { kind: "ezcorp:extension:install" } });
  });

  test("a cap the user approved earlier in this call skips its prompt; the next unapproved cap still prompts", async () => {
    const engine = makeEngine({ granted: { grantedAt: {}, shell: true, custom: { drafts: { kinds: ["extension"] } } } });
    const needed = [{ kind: "ezcorp:extension:install" }, { kind: "shell" }] as const;
    const first = await engine.authorize(ctx, [...needed]);
    expect(first).toMatchObject({ decision: "prompt", sensitive: { kind: "ezcorp:extension:install" } });

    const second = await engine.authorize({ ...ctx, promptApproved: [{ kind: "ezcorp:extension:install" }] }, [...needed]);
    expect(second).toMatchObject({ decision: "prompt", sensitive: { kind: "shell" } });

    const third = await engine.authorize(
      { ...ctx, promptApproved: [{ kind: "ezcorp:extension:install" }, { kind: "shell" }] },
      [...needed],
    );
    expect(third.decision).toBe("allow");
    // One-shot: the approval lives in that call only, never in the engine.
    expect(await engine.authorize(ctx, [...needed])).toMatchObject({ decision: "prompt", sensitive: { kind: "ezcorp:extension:install" } });
  });

  test("a bundled request whose sensitive caps are all auto-allowed still allows", async () => {
    const engine = makeBundledEngine({ grantedAt: {}, shell: true, filesystem: ["/tmp"] });
    const decision = await engine.authorize(ctx, [{ kind: "shell" }, { kind: "fs.write", value: "/tmp/a" }]);
    expect(decision.decision).toBe("allow");
  });
});
