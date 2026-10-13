import { test, expect, describe, beforeEach, afterAll } from "bun:test";
import { setupTestDb, closeTestDb, mockDbConnection } from "./helpers/test-pglite";

mockDbConnection();

const {
  getStorageValue,
  setStorageValue,
  deleteStorageValue,
  listStorageKeys,
  getStorageUsage,
  deleteExpiredStorage,
} = await import("../db/queries/extension-storage");
const { createExtension } = await import("../db/queries/extensions");

const EXT = "ext-test-id";

async function seedExtension(id = EXT, name = "ext-test") {
  await createExtension({
    id,
    name,
    version: "1.0.0",
    source: "local",
    manifest: { name, version: "1.0.0" } as any,
  } as any);
}

describe("extension-storage queries", () => {
  beforeEach(async () => {
    await setupTestDb();
    await seedExtension();
  });
  afterAll(async () => await closeTestDb());

  test("setStorageValue + getStorageValue round-trip (global scope, null scopeId)", async () => {
    await setStorageValue(EXT, "global", null, "k1", { foo: "bar" }, false, 12);
    const got = await getStorageValue(EXT, "global", null, "k1");
    expect(got).not.toBeNull();
    expect(got!.value).toEqual({ foo: "bar" });
    expect(got!.encrypted).toBe(false);
    expect(got!.sizeBytes).toBe(12);
  });

  test("setStorageValue upserts on (ext, scope, NULL scopeId, key) — no duplicate rows", async () => {
    // Regression for the bug where plain UNIQUE(…) treated NULL scope_id as
    // distinct, letting two calls with the same key silently insert two rows.
    // Post-fix: NULLS NOT DISTINCT makes them collide and the second wins.
    await setStorageValue(EXT, "global", null, "same-key", "first", false, 5);
    await setStorageValue(EXT, "global", null, "same-key", "second", false, 6);

    const got = await getStorageValue(EXT, "global", null, "same-key");
    expect(got!.value).toBe("second");
    expect(got!.sizeBytes).toBe(6);

    const keys = await listStorageKeys(EXT, "global", null);
    const hits = keys.filter((k) => k.key === "same-key");
    expect(hits.length).toBe(1);
  });

  test("getStorageValue returns null when key missing", async () => {
    const got = await getStorageValue(EXT, "global", null, "missing");
    expect(got).toBeNull();
  });

  test("setStorageValue persists with non-null scopeId and is retrievable", async () => {
    await setStorageValue(EXT, "user", "user-x", "k", "v1", false, 2);
    const got = await getStorageValue(EXT, "user", "user-x", "k");
    expect(got!.value).toBe("v1");
    expect(got!.sizeBytes).toBe(2);
  });

  test("scopeId isolates values across scopes", async () => {
    await setStorageValue(EXT, "user", "user-a", "key", "A", false, 1);
    await setStorageValue(EXT, "user", "user-b", "key", "B", false, 1);

    const a = await getStorageValue(EXT, "user", "user-a", "key");
    const b = await getStorageValue(EXT, "user", "user-b", "key");
    expect(a!.value).toBe("A");
    expect(b!.value).toBe("B");
  });

  test("getStorageValue lazily expires TTL'd rows", async () => {
    const past = new Date(Date.now() - 1000);
    await setStorageValue(EXT, "global", null, "ttl", "v", false, 1, past);

    const got = await getStorageValue(EXT, "global", null, "ttl");
    expect(got).toBeNull();
    // Confirm it was actually deleted by listing keys
    const keys = await listStorageKeys(EXT, "global", null);
    expect(keys.find((k) => k.key === "ttl")).toBeUndefined();
  });

  test("deleteStorageValue returns true when row removed, false when missing", async () => {
    await setStorageValue(EXT, "global", null, "del", "v", false, 1);
    expect(await deleteStorageValue(EXT, "global", null, "del")).toBe(true);
    expect(await deleteStorageValue(EXT, "global", null, "del")).toBe(false);
    expect(await getStorageValue(EXT, "global", null, "del")).toBeNull();
  });

  test("listStorageKeys filters by prefix", async () => {
    await setStorageValue(EXT, "global", null, "a:1", "x", false, 1);
    await setStorageValue(EXT, "global", null, "a:2", "x", false, 1);
    await setStorageValue(EXT, "global", null, "b:1", "x", false, 1);

    const all = await listStorageKeys(EXT, "global", null);
    expect(all.length).toBe(3);

    const aOnly = await listStorageKeys(EXT, "global", null, "a:");
    expect(aOnly.map((k) => k.key).sort()).toEqual(["a:1", "a:2"]);
  });

  test("listStorageKeys escapes LIKE wildcards in prefix", async () => {
    await setStorageValue(EXT, "global", null, "100%", "x", false, 1);
    await setStorageValue(EXT, "global", null, "abc", "x", false, 1);
    // The "%" in the prefix must be treated literally — should match only "100%"
    const matched = await listStorageKeys(EXT, "global", null, "100%");
    expect(matched.map((k) => k.key)).toEqual(["100%"]);
  });

  test("listStorageKeys treats a backslash in the prefix literally", async () => {
    await setStorageValue(EXT, "global", null, "a\\b", "x", false, 1);
    await setStorageValue(EXT, "global", null, "a%", "x", false, 1);
    const matched = await listStorageKeys(EXT, "global", null, "a\\");
    expect(matched.map((k) => k.key)).toEqual(["a\\b"]);
  });

  test("listStorageKeys skips expired rows, like getStorageValue", async () => {
    await setStorageValue(EXT, "global", null, "live", "x", false, 1);
    await setStorageValue(EXT, "global", null, "later", "x", false, 1, new Date(Date.now() + 60_000));
    await setStorageValue(EXT, "global", null, "gone", "x", false, 1, new Date(Date.now() - 1000));
    const keys = await listStorageKeys(EXT, "global", null);
    expect(keys.map((k) => k.key).sort()).toEqual(["later", "live"]);
  });

  test("getStorageUsage sums sizes and ignores expired rows", async () => {
    await setStorageValue(EXT, "global", null, "a", "x", false, 100);
    await setStorageValue(EXT, "global", null, "b", "x", false, 250);
    await setStorageValue(EXT, "global", null, "c", "x", false, 999, new Date(Date.now() - 1000));

    const usage = await getStorageUsage(EXT);
    expect(usage.totalBytes).toBe(350);
    expect(usage.keyCount).toBe(2);
  });

  test("deleteExpiredStorage purges only expired rows", async () => {
    await setStorageValue(EXT, "global", null, "stay", "x", false, 1);
    await setStorageValue(EXT, "global", null, "gone-1", "x", false, 1, new Date(Date.now() - 1000));
    await setStorageValue(EXT, "global", null, "gone-2", "x", false, 1, new Date(Date.now() - 2000));

    const deleted = await deleteExpiredStorage();
    expect(deleted).toBe(2);

    const keys = await listStorageKeys(EXT, "global", null);
    expect(keys.map((k) => k.key)).toEqual(["stay"]);
  });
});
