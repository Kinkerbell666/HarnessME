// Coverage-focused tests for `src/extensions/storage-handler.ts`.
//
// sb1-storage-rpc-security.test.ts already locks in cross-extension isolation,
// scope isolation, quota, rate-limit, key validation, batch-over-100,
// batch-empty, and encryption round-trip. This file closes the remaining
// branches surfaced by the Task #20 coverage gap:
//
//   - permission denial / builtin bypass
//   - missing `action`, invalid `scope`, scope-unavailable guards
//   - extension-not-wired-to-conversation (-32001)
//   - unknown top-level action, unknown batch action
//   - handleGet: rate-limit, decrypt failure
//   - handleSet: value-too-large, ttlSeconds invalid/valid, rate-limit
//   - handleDelete: key-validation, rate-limit, hit+miss
//   - handleList: rate-limit, prefix/limit happy path
//   - handleBatch: mixed op types, scope-switch-mid-batch (outer scope wins)
//   - parseStorageQuota: KB / bad format / missing resources
//
// Approach mirrors sb1-storage-rpc-security.test.ts — real PGlite + drizzle,
// real encryption module, only `db/connection` mocked.

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mock } from "bun:test";
import { setupTestDb, closeTestDb, getTestPglite } from "./helpers/test-pglite";
import { restoreModuleMocks } from "./helpers/mock-cleanup";
import { withFrozenNow } from "./helpers/frozen-clock";

process.env.EZCORP_ENCRYPTION_SECRET ??= "0".repeat(64);
process.env.EZCORP_ENCRYPTION_SALT ??= "sh-cov-test-salt";

mock.module("../db/connection", () => ({
  getDb: () => {
    const pg = getTestPglite();
    if (!pg) throw new Error("Test DB not initialized — call setupTestDb() first");
    const { drizzle } = require("drizzle-orm/pglite");
    const schema = require("../db/schema");
    return drizzle(pg, { schema });
  },
  getPglite: () => getTestPglite(),
  getDbPath: () => ":memory:",
  initDb: async () => {},
  closeDb: async () => {},
}));

const { handleStorageRpc } = await import("../extensions/storage-handler");
const { getDb } = await import("../db/connection");
const {
  extensions,
  conversations,
  projects,
  extensionStorage,
  conversationExtensions,
} = await import("../db/schema");
const { eq, and } = await import("drizzle-orm");

import type { JsonRpcRequest } from "../extensions/types";
import type { StorageContext } from "../extensions/storage-handler";
import type { ExtensionManifestV2, ExtensionPermissions } from "../extensions/types";

// ── Fixtures ─────────────────────────────────────────────────────────

function makeManifest(name: string, quota?: string): ExtensionManifestV2 {
  return {
    schemaVersion: 2,
    name,
    version: "1.0.0",
    description: `cov manifest for ${name}`,
    author: { name: "cov" },
    ...(quota ? { resources: { storage: quota } } : {}),
  } as unknown as ExtensionManifestV2;
}

function makePerms(storage = true): ExtensionPermissions {
  return { storage, grantedAt: { storage: Date.now() } };
}

function makeCtx(
  manifest: ExtensionManifestV2,
  overrides: Partial<StorageContext> = {},
): StorageContext {
  return {
    conversationId: overrides.conversationId ?? "conv-cov",
    userId: overrides.userId ?? "user-cov",
    manifest: overrides.manifest ?? manifest,
    grantedPermissions: overrides.grantedPermissions ?? makePerms(true),
  };
}

let counter = 0;
function uniqueExtId(prefix = "ext"): string {
  counter += 1;
  return `${prefix}-${counter}-${crypto.randomUUID().slice(0, 8)}`;
}

async function insertExtension(id: string, manifest: ExtensionManifestV2): Promise<void> {
  await getDb().insert(extensions).values({
    id,
    name: id,
    version: manifest.version,
    description: manifest.description,
    manifest,
    source: `test:${id}`,
    installPath: `/tmp/${id}`,
    enabled: true,
    grantedPermissions: makePerms(true),
  } as any);
}

async function insertProject(id: string): Promise<void> {
  await getDb().insert(projects).values({ id, name: id, path: `/tmp/${id}` } as any);
}

async function insertConversation(id: string, projectId: string): Promise<void> {
  await getDb().insert(conversations).values({ id, projectId, title: "cov" } as any);
}

function rpcReq(params: Record<string, unknown>, id: number | string = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method: "ezcorp/storage", params };
}

function rpc(action: string, params: Record<string, unknown> = {}, id: number | string = 1): JsonRpcRequest {
  return rpcReq({ action, ...params }, id);
}

// Shared fixtures populated in beforeAll.
let extBase: string;
let manifestBase: ExtensionManifestV2;
let extWired: string;
let manifestWired: ExtensionManifestV2;
let extUnwired: string;
let manifestUnwired: ExtensionManifestV2;
let projId: string;
let convWired: string;
let convUnwired: string;

beforeAll(async () => {
  await setupTestDb();

  extBase = uniqueExtId("ext-base");
  manifestBase = makeManifest(extBase, "5MB");
  await insertExtension(extBase, manifestBase);

  extWired = uniqueExtId("ext-wired");
  manifestWired = makeManifest(extWired, "5MB");
  await insertExtension(extWired, manifestWired);

  extUnwired = uniqueExtId("ext-unwired");
  manifestUnwired = makeManifest(extUnwired, "5MB");
  await insertExtension(extUnwired, manifestUnwired);

  projId = uniqueExtId("proj-cov");
  await insertProject(projId);
  convWired = uniqueExtId("conv-wired");
  convUnwired = uniqueExtId("conv-unwired");
  await insertConversation(convWired, projId);
  await insertConversation(convUnwired, projId);

  await getDb().insert(conversationExtensions).values([
    { conversationId: convWired, extensionId: extWired },
  ] as any);

  // Migrations already seed the "builtin" extension row — no insert needed.
});

afterAll(async () => {
  await closeTestDb();
  restoreModuleMocks();
});

// ── Top-level gates ──────────────────────────────────────────────────

describe("storage-handler permission + action + scope gates", () => {
  test("non-builtin with storage permission denied → -32001", async () => {
    const ctx = makeCtx(manifestBase, { grantedPermissions: makePerms(false) });
    const resp = await handleStorageRpc(extBase, rpc("get", { key: "k" }), ctx);
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32001);
    expect(resp.error!.message).toMatch(/Storage permission/);
  });

  test("missing action param → -32602", async () => {
    const resp = await handleStorageRpc(extBase, rpcReq({}), makeCtx(manifestBase));
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
    expect(resp.error!.message).toMatch(/action/);
  });

  test("invalid scope value → -32602", async () => {
    const resp = await handleStorageRpc(
      extBase,
      rpc("get", { key: "k", scope: "bogus" }),
      makeCtx(manifestBase),
    );
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
    expect(resp.error!.message).toMatch(/scope/i);
  });

  test("conversation scope unavailable (conversationId=\"unknown\") → -32602", async () => {
    const resp = await handleStorageRpc(
      extBase,
      rpc("get", { key: "k", scope: "conversation" }),
      makeCtx(manifestBase, { conversationId: "unknown" }),
    );
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
    expect(resp.error!.message).toMatch(/Conversation scope unavailable/);
  });

  test("user scope unavailable (userId=\"unknown\") → -32602", async () => {
    const resp = await handleStorageRpc(
      extBase,
      rpc("get", { key: "k", scope: "user" }),
      makeCtx(manifestBase, { userId: "unknown" }),
    );
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
    expect(resp.error!.message).toMatch(/User scope unavailable/);
  });

  test("conversation scope but extension not wired to conversation → -32001", async () => {
    const resp = await handleStorageRpc(
      extUnwired,
      rpc("get", { key: "k", scope: "conversation" }),
      makeCtx(manifestUnwired, { conversationId: convUnwired }),
    );
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32001);
    expect(resp.error!.message).toMatch(/not wired/);
  });

  test("conversation scope happy path when extension IS wired", async () => {
    // Sanity: wiring lookup returns the extension for convWired.
    const setResp = await handleStorageRpc(
      extWired,
      rpc("set", { key: "wired-key", value: 42, scope: "conversation" }),
      makeCtx(manifestWired, { conversationId: convWired }),
    );
    expect(setResp.error).toBeUndefined();

    const getResp = await handleStorageRpc(
      extWired,
      rpc("get", { key: "wired-key", scope: "conversation" }),
      makeCtx(manifestWired, { conversationId: convWired }),
    );
    expect(getResp.error).toBeUndefined();
    expect((getResp.result as any).value).toBe(42);
  });

  test("unknown action → -32602", async () => {
    const resp = await handleStorageRpc(
      extBase,
      rpc("frobnicate", { key: "k" }),
      makeCtx(manifestBase),
    );
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
    expect(resp.error!.message).toMatch(/Unknown action/);
  });
});

// ── builtin bypass ──────────────────────────────────────────────────

describe("storage-handler builtin bypass", () => {
  test("builtin without grantedPermissions.storage still passes permission gate", async () => {
    const ctx = makeCtx(manifestBase, { grantedPermissions: makePerms(false) });
    const resp = await handleStorageRpc(
      "builtin",
      rpc("set", { key: "b-key", value: "v" }),
      ctx,
    );
    expect(resp.error).toBeUndefined();
  });

  test("builtin may use reserved-prefix keys (__internal, ezcorp/*)", async () => {
    const ctx = makeCtx(manifestBase);
    const a = await handleStorageRpc("builtin", rpc("set", { key: "__internal", value: 1 }), ctx);
    expect(a.error).toBeUndefined();
    const b = await handleStorageRpc("builtin", rpc("set", { key: "ezcorp/x", value: 2 }), ctx);
    expect(b.error).toBeUndefined();
  });

  test("builtin skips conversation-wiring check", async () => {
    // Use a conversation the caller would otherwise not be wired into.
    // builtin isn't in conversation_extensions anywhere; must still succeed.
    const resp = await handleStorageRpc(
      "builtin",
      rpc("set", { key: "b-conv", value: 7, scope: "conversation" }),
      makeCtx(manifestBase, { conversationId: convUnwired }),
    );
    expect(resp.error).toBeUndefined();
  });
});

// ── handleGet branches ──────────────────────────────────────────────

describe("storage-handler handleGet branches", () => {
  test("get with invalid key → -32602 via validateKey", async () => {
    const ext = uniqueExtId("ext-get-bk");
    await insertExtension(ext, makeManifest(ext, "1MB"));
    const resp = await handleStorageRpc(ext, rpc("get", { key: "has space" }), makeCtx(makeManifest(ext, "1MB")));
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
  });

  test("get rate-limited once bucket drains → -32004", async () => {
    const ext = uniqueExtId("ext-get-rl");
    const m = makeManifest(ext, "5MB");
    await insertExtension(ext, m);
    const ctx = makeCtx(m);
    // Clock frozen: 60 gets in one instant must overflow the 50-token
    // bucket — no wall-clock refill can mask the drain under CPU load.
    const limited = await withFrozenNow(async () => {
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const r = await handleStorageRpc(ext, rpc("get", { key: `nope-${i}` }), ctx);
        if (r.error?.code === -32004) n += 1;
      }
      return n;
    });
    expect(limited).toBeGreaterThan(0);
  });

  test("get on missing key returns {value:null, exists:false}", async () => {
    const ext = uniqueExtId("ext-get-miss");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(ext, rpc("get", { key: "never-written" }), makeCtx(m));
    expect(resp.error).toBeUndefined();
    expect((resp.result as any).exists).toBe(false);
    expect((resp.result as any).value).toBeNull();
  });

  test("get on row with encrypted:true but non-decryptable value → -32603", async () => {
    const ext = uniqueExtId("ext-dec-fail");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);

    // Bypass the handler and insert a row claiming encrypted:true with a
    // value the decrypt() path can't parse.
    await getDb().insert(extensionStorage).values({
      extensionId: ext,
      scope: "global",
      scopeId: null,
      key: "broken-cipher",
      value: "not-a-valid-ciphertext-blob",
      encrypted: true,
      sizeBytes: 28,
    } as any);

    const resp = await handleStorageRpc(ext, rpc("get", { key: "broken-cipher" }), makeCtx(m));
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32603);
    expect(resp.error!.message).toMatch(/decrypt/i);
  });
});

// ── handleSet branches ──────────────────────────────────────────────

describe("storage-handler handleSet branches", () => {
  test("set with invalid key → -32602", async () => {
    const ext = uniqueExtId("ext-set-bk");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(ext, rpc("set", { key: "", value: 1 }), makeCtx(m));
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
  });

  test("set rate-limited once bucket drains → -32004", async () => {
    const ext = uniqueExtId("ext-set-rl");
    const m = makeManifest(ext, "100MB");
    await insertExtension(ext, m);
    const ctx = makeCtx(m);
    const limited = await withFrozenNow(async () => {
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const r = await handleStorageRpc(ext, rpc("set", { key: `rl-${i}`, value: 1 }), ctx);
        if (r.error?.code === -32004) n += 1;
      }
      return n;
    });
    expect(limited).toBeGreaterThan(0);
  });

  test("set value > 1MB → -32602 (Value too large)", async () => {
    const ext = uniqueExtId("ext-set-big");
    const m = makeManifest(ext, "100MB");
    await insertExtension(ext, m);
    const huge = "x".repeat(1_100_000);
    const resp = await handleStorageRpc(ext, rpc("set", { key: "big", value: huge }), makeCtx(m));
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
    expect(resp.error!.message).toMatch(/Value too large/);
  });

  test("set with ttlSeconds=0 → -32602 (must be positive)", async () => {
    const ext = uniqueExtId("ext-ttl-0");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(
      ext,
      rpc("set", { key: "k", value: 1, ttlSeconds: 0 }),
      makeCtx(m),
    );
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
    expect(resp.error!.message).toMatch(/ttlSeconds/);
  });

  test("set with negative ttlSeconds → -32602", async () => {
    const ext = uniqueExtId("ext-ttl-neg");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(
      ext,
      rpc("set", { key: "k", value: 1, ttlSeconds: -5 }),
      makeCtx(m),
    );
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
  });

  test("set with ttlSeconds > 1yr → -32602", async () => {
    const ext = uniqueExtId("ext-ttl-big");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(
      ext,
      rpc("set", { key: "k", value: 1, ttlSeconds: 31_536_001 }),
      makeCtx(m),
    );
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
  });

  test("set with non-numeric ttlSeconds → -32602", async () => {
    const ext = uniqueExtId("ext-ttl-str");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(
      ext,
      rpc("set", { key: "k", value: 1, ttlSeconds: "later" }),
      makeCtx(m),
    );
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
  });

  test("set with valid ttlSeconds populates expiresAt", async () => {
    const ext = uniqueExtId("ext-ttl-ok");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const before = Date.now();
    const resp = await handleStorageRpc(
      ext,
      rpc("set", { key: "ephemeral", value: 1, ttlSeconds: 3600 }),
      makeCtx(m),
    );
    expect(resp.error).toBeUndefined();

    const rows = await getDb()
      .select()
      .from(extensionStorage)
      .where(and(eq(extensionStorage.extensionId, ext), eq(extensionStorage.key, "ephemeral")));
    expect(rows.length).toBe(1);
    const expiresAt = rows[0]!.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    const delta = expiresAt!.getTime() - before;
    // Roughly ~3600s from now — allow wide slack for test scheduling.
    expect(delta).toBeGreaterThan(3_000_000);
    expect(delta).toBeLessThan(5_000_000);
  });
});

// ── handleDelete branches ───────────────────────────────────────────

describe("storage-handler handleDelete branches", () => {
  test("delete with invalid key → -32602", async () => {
    const ext = uniqueExtId("ext-del-bk");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(ext, rpc("delete", { key: "has space" }), makeCtx(m));
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32602);
  });

  test("delete rate-limited once bucket drains → -32004", async () => {
    const ext = uniqueExtId("ext-del-rl");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const ctx = makeCtx(m);
    const limited = await withFrozenNow(async () => {
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const r = await handleStorageRpc(ext, rpc("delete", { key: `nope-${i}` }), ctx);
        if (r.error?.code === -32004) n += 1;
      }
      return n;
    });
    expect(limited).toBeGreaterThan(0);
  });

  test("delete of existing key returns {deleted:true}, missing key returns {deleted:false}", async () => {
    const ext = uniqueExtId("ext-del-hitmiss");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const ctx = makeCtx(m);

    // Seed one key.
    const setR = await handleStorageRpc(ext, rpc("set", { key: "present", value: 1 }), ctx);
    expect(setR.error).toBeUndefined();

    const hit = await handleStorageRpc(ext, rpc("delete", { key: "present" }), ctx);
    expect(hit.error).toBeUndefined();
    expect((hit.result as any).deleted).toBe(true);

    const miss = await handleStorageRpc(ext, rpc("delete", { key: "absent" }), ctx);
    expect(miss.error).toBeUndefined();
    expect((miss.result as any).deleted).toBe(false);
  });
});

// ── handleList branches ────────────────────────────────────────────

describe("storage-handler handleList branches", () => {
  test("list rate-limited once bucket drains → -32004", async () => {
    const ext = uniqueExtId("ext-list-rl");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const ctx = makeCtx(m);
    const limited = await withFrozenNow(async () => {
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const r = await handleStorageRpc(ext, rpc("list", {}), ctx);
        if (r.error?.code === -32004) n += 1;
      }
      return n;
    });
    expect(limited).toBeGreaterThan(0);
  });

  test("list with prefix and small limit returns matching keys", async () => {
    const ext = uniqueExtId("ext-list-ok");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const ctx = makeCtx(m);
    await handleStorageRpc(ext, rpc("set", { key: "alpha-1", value: 1 }), ctx);
    await handleStorageRpc(ext, rpc("set", { key: "alpha-2", value: 2 }), ctx);
    await handleStorageRpc(ext, rpc("set", { key: "beta-1", value: 3 }), ctx);

    const resp = await handleStorageRpc(ext, rpc("list", { prefix: "alpha-", limit: 10 }), ctx);
    expect(resp.error).toBeUndefined();
    const keys = (resp.result as any).keys.map((k: any) => k.key).sort();
    expect(keys).toEqual(["alpha-1", "alpha-2"]);
  });

  test.each([["abc"], [-1], [2.5]])("list with an invalid limit %p → -32602, not an unbounded or failed query", async (limit) => {
    const ext = uniqueExtId("ext-list-badlimit");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(ext, rpc("list", { limit }), makeCtx(m));
    expect(resp.error?.code).toBe(-32602);
  });

  test("list with a non-string prefix → -32602", async () => {
    const ext = uniqueExtId("ext-list-badprefix");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(ext, rpc("list", { prefix: 42 }), makeCtx(m));
    expect(resp.error?.code).toBe(-32602);
  });
});

// ── handleBatch branches ───────────────────────────────────────────

describe("storage-handler handleBatch branches", () => {
  test("mixed get/set/delete in one batch returns per-op results", async () => {
    const ext = uniqueExtId("ext-batch-mix");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const ctx = makeCtx(m);

    // Seed one row so the get+delete ops have something to hit.
    await handleStorageRpc(ext, rpc("set", { key: "seed", value: "initial" }), ctx);

    const resp = await handleStorageRpc(
      ext,
      rpc("batch", {
        operations: [
          { action: "set", key: "batch-k1", value: "v1" },
          { action: "get", key: "seed" },
          { action: "delete", key: "seed" },
          { action: "get", key: "batch-k1" },
        ],
      }),
      ctx,
    );
    expect(resp.error).toBeUndefined();
    const results = (resp.result as any).results;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(4);
    expect(results[0].ok).toBe(true);             // set
    expect(results[1].exists).toBe(true);          // get seed
    expect(results[1].value).toBe("initial");
    expect(results[2].deleted).toBe(true);         // delete seed
    expect(results[3].exists).toBe(true);          // get batch-k1 after set
    expect(results[3].value).toBe("v1");
  });

  test("unknown batch op action surfaces as -32602 inside results", async () => {
    const ext = uniqueExtId("ext-batch-unk");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(
      ext,
      rpc("batch", {
        operations: [
          { action: "set", key: "ok", value: 1 },
          { action: "frobnicate", key: "bad" },
        ],
      }),
      makeCtx(m),
    );
    expect(resp.error).toBeUndefined();
    const results = (resp.result as any).results;
    expect(results[0].ok).toBe(true);
    expect(results[1].code).toBe(-32602);
    expect(results[1].message).toMatch(/Unknown batch action/);
  });

  test("scope-switch-mid-batch: outer scope wins over per-op scope", async () => {
    // Outer call uses scope "global"; per-op carries scope:"conversation".
    // `handleBatch` spreads op then re-applies outer scope, so writes must
    // land in the global partition — not conversation.
    const ext = uniqueExtId("ext-batch-scope");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const ctx = makeCtx(m, { conversationId: convWired });

    const resp = await handleStorageRpc(
      ext,
      rpc("batch", {
        operations: [
          // per-op claims conversation, but outer scope is "global"
          { action: "set", key: "scoped-key", value: "g-only", scope: "conversation" },
        ],
      }),
      ctx,
    );
    expect(resp.error).toBeUndefined();
    expect((resp.result as any).results[0].ok).toBe(true);

    // Exists in global partition.
    const getG = await handleStorageRpc(ext, rpc("get", { key: "scoped-key" }), ctx);
    expect((getG.result as any).exists).toBe(true);
    expect((getG.result as any).value).toBe("g-only");

    // Absent from conversation partition — but we need wiring to avoid the
    // -32001 not-wired gate. Use a wired extension for that read.
    await getDb().insert(conversationExtensions).values([
      { conversationId: convWired, extensionId: ext },
    ] as any);
    const getC = await handleStorageRpc(
      ext,
      rpc("get", { key: "scoped-key", scope: "conversation" }),
      ctx,
    );
    expect((getC.result as any).exists).toBe(false);
  });

  test("batch rate-limit: drain token bucket then 10-op batch → -32004", async () => {
    // Drains the per-extension token bucket (MAX_OPS_PER_SECOND=50) with
    // 50 rapid set ops on a fresh extension, then issues a 10-op batch.
    // With remaining tokens < 10, handleBatch line 275 returns -32004.
    const ext = uniqueExtId("ext-batch-rl");
    const m = makeManifest(ext, "5MB");
    await insertExtension(ext, m);
    const ctx = makeCtx(m);

    // Clock frozen: the 50 drain sets empty the bucket in one instant, so
    // the following 10-op batch (needs 10 tokens, 0 available) is rejected —
    // no wall-clock refill can top the bucket back up under CPU load.
    const resp = await withFrozenNow(async () => {
      for (let i = 0; i < 50; i++) {
        await handleStorageRpc(ext, rpc("set", { key: `drain-${i}`, value: 1 }), ctx);
      }
      const ops = Array.from({ length: 10 }, (_, i) => ({
        action: "set", key: `post-${i}`, value: i,
      }));
      return handleStorageRpc(ext, rpc("batch", { operations: ops }), ctx);
    });
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32004);
    expect(resp.error!.message).toMatch(/Rate limited/);
  });
});

// ── Encrypted round-trip ───────────────────────────────────────────

describe("storage-handler encrypted round-trip", () => {
  test("set encrypted:true then get returns plaintext (try-success fall-through)", async () => {
    // Complements sb1-storage-rpc-security.test.ts's roundtrip by exercising
    // handleGet's JSON.parse(decrypt(...)) try-success path, falling through
    // past the catch-block closing brace on line 179.
    const ext = uniqueExtId("ext-enc-rt");
    const m = makeManifest(ext, "1MB");
    await insertExtension(ext, m);
    const ctx = makeCtx(m);

    // `user` scope: encrypted writes to the install-wide `global` scope are
    // rejected (locked in by sb1-storage-rpc-security.test.ts).
    const plaintext = "plaintext";
    const setResp = await handleStorageRpc(
      ext,
      rpc("set", { key: "secret", value: plaintext, encrypted: true, scope: "user" }),
      ctx,
    );
    expect(setResp.error).toBeUndefined();

    const getResp = await handleStorageRpc(ext, rpc("get", { key: "secret", scope: "user" }), ctx);
    expect(getResp.error).toBeUndefined();
    expect((getResp.result as any).exists).toBe(true);
    expect((getResp.result as any).value).toBe(plaintext);
  });
});

// ── parseStorageQuota exercised via handleSet ──────────────────────

describe("storage-handler parseStorageQuota branches", () => {
  test("manifest without resources.storage uses DEFAULT 5MB quota", async () => {
    const ext = uniqueExtId("ext-q-default");
    const m = makeManifest(ext); // no quota set
    await insertExtension(ext, m);
    // A modest write must succeed — i.e., default quota is large enough.
    const resp = await handleStorageRpc(
      ext,
      rpc("set", { key: "d", value: "x".repeat(500) }),
      makeCtx(m),
    );
    expect(resp.error).toBeUndefined();
  });

  test("manifest with malformed resources.storage falls back to default", async () => {
    const ext = uniqueExtId("ext-q-bad");
    const m = makeManifest(ext, "ten-megabytes");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(
      ext,
      rpc("set", { key: "d", value: "x".repeat(500) }),
      makeCtx(m),
    );
    // Malformed parses as default 5MB — write well under, so OK.
    expect(resp.error).toBeUndefined();
  });

  test("KB quota unit is parsed — exceeding it triggers -32002", async () => {
    const ext = uniqueExtId("ext-q-kb");
    const m = makeManifest(ext, "2KB");
    await insertExtension(ext, m);
    const ctx = makeCtx(m);
    // 2KB quota. Two 1500-byte writes → second must hit quota.
    const big = "x".repeat(1500);
    const r1 = await handleStorageRpc(ext, rpc("set", { key: "a", value: big }), ctx);
    const r2 = await handleStorageRpc(ext, rpc("set", { key: "b", value: big }), ctx);
    // One of them quota-errors.
    const errs = [r1, r2].filter((r) => r.error?.code === -32002);
    expect(errs.length).toBeGreaterThan(0);
  });

  test("GB quota unit is parsed — writes well within the cap succeed", async () => {
    const ext = uniqueExtId("ext-q-gb");
    // 1GB requested, capped at 100MB by the handler — still plenty of room.
    const m = makeManifest(ext, "1GB");
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(
      ext,
      rpc("set", { key: "big-ok", value: "x".repeat(10_000) }),
      makeCtx(m),
    );
    expect(resp.error).toBeUndefined();
  });
});

// ── Phase 6: PDP-deny path ──────────────────────────────────────────

describe("storage-handler — PDP-deny path (Phase 6)", () => {
  test("ctx.engine returns deny → -32001 'Storage permission not granted'", async () => {
    const { createStubPermissionEngine } = await import("./helpers/permission-engine-stub");
    const engine = createStubPermissionEngine("deny-all");
    const ext = uniqueExtId();
    const m = makeManifest(ext);
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(
      ext,
      rpc("get", { key: "k" }),
      // grantedPermissions still has storage:true; PDP path overrides.
      { ...makeCtx(m), engine },
    );
    expect(resp.error?.code).toBe(-32001);
    expect(resp.error?.message).toContain("Storage permission not granted");
    expect(engine.calls.length).toBe(1);
    expect(engine.calls[0]!.needed).toEqual([{ kind: "storage" }]);
  });

  test("ctx.engine returns allow + grantedPermissions empty → handler proceeds", async () => {
    const { createStubPermissionEngine } = await import("./helpers/permission-engine-stub");
    const engine = createStubPermissionEngine("allow-all");
    const ext = uniqueExtId();
    const m = makeManifest(ext);
    await insertExtension(ext, m);
    const resp = await handleStorageRpc(
      ext,
      rpc("get", { key: "k" }),
      { ...makeCtx(m), grantedPermissions: makePerms(false), engine },
    );
    // get on missing key returns success with value:null — no error.
    expect(resp.error).toBeUndefined();
    expect(engine.calls.length).toBe(1);
  });

  test("builtin extension bypasses the PDP (legacy bypass for host's own scope)", async () => {
    const { createStubPermissionEngine } = await import("./helpers/permission-engine-stub");
    const engine = createStubPermissionEngine("deny-all");
    const m = makeManifest("builtin");
    // Builtin extension may already be present from earlier tests in
    // the file; insert idempotently.
    await getDb()
      .insert(extensions)
      .values({
        id: "builtin",
        name: "builtin",
        version: m.version,
        description: m.description,
        manifest: m,
        source: "test:builtin",
        installPath: "/tmp/builtin",
        enabled: true,
        grantedPermissions: makePerms(true),
      } as never)
      .onConflictDoNothing();
    const resp = await handleStorageRpc(
      "builtin",
      rpc("get", { key: "k" }),
      { ...makeCtx(m), grantedPermissions: makePerms(false), engine },
    );
    // builtin → no engine.authorize call, handler proceeds.
    expect(resp.error).toBeUndefined();
    expect(engine.calls.length).toBe(0);
  });
});
