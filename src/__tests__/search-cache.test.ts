/** Host-side shared search cache — `src/search/cache.ts`. */
import { test, expect, describe } from "bun:test";
import {
  SearchCache,
  getSharedSearchCache,
  _resetSharedSearchCacheForTests,
} from "../search/cache";

describe("SearchCache.key", () => {
  test("embeds provider:kind:query:extra and normalizes the query", () => {
    expect(SearchCache.key("searxng", "search", "  Bun Runtime ", 5)).toBe("searxng:search:bun runtime:5");
    expect(SearchCache.key("duckduckgo", "search", "Bun Runtime", 5)).toBe("duckduckgo:search:bun runtime:5");
    expect(SearchCache.key("jina", "read", " https://X ", "raw")).toBe("jina:read:https://X:raw");
  });

  test("a read key keeps the URL's case — paths are case-sensitive", () => {
    // Lower-casing would serve /README.md's cached page for /readme.md.
    expect(SearchCache.key("jina", "read", " https://x.dev/README.md ", "raw")).toBe("jina:read:https://x.dev/README.md:raw");
    expect(SearchCache.key("jina", "read", "https://youtu.be/dQw4w9WgXcQ", "raw"))
      .not.toBe(SearchCache.key("jina", "read", "https://youtu.be/dqw4w9wgxcq", "raw"));
  });

  test("provider name in the key keeps fallback results in a SEPARATE namespace", () => {
    const a = SearchCache.key("searxng", "search", "q", 5);
    const b = SearchCache.key("duckduckgo", "search", "q", 5);
    expect(a).not.toBe(b);
  });
});

describe("SearchCache get/set", () => {
  test("stores and retrieves a value within TTL", () => {
    let t = 1000;
    const c = new SearchCache({ now: () => t });
    c.set("k", "v", 5000);
    expect(c.get("k")).toBe("v");
    t = 5999;
    expect(c.get("k")).toBe("v");
  });

  test("expires a value past its TTL", () => {
    let t = 1000;
    const c = new SearchCache({ now: () => t });
    c.set("k", "v", 5000);
    t = 6000;
    expect(c.get("k")).toBeUndefined();
    expect(c.size).toBe(0); // expired entry pruned
  });

  test("returns undefined for an unknown key", () => {
    expect(new SearchCache().get("missing")).toBeUndefined();
  });

  test("LRU eviction drops the oldest entry past maxEntries", () => {
    const c = new SearchCache({ maxEntries: 2 });
    c.set("a", "1", 10_000);
    c.set("b", "2", 10_000);
    c.set("c", "3", 10_000); // evicts "a"
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe("2");
    expect(c.get("c")).toBe("3");
  });

  test("a get refreshes LRU position (recently-read survives eviction)", () => {
    const c = new SearchCache({ maxEntries: 2 });
    c.set("a", "1", 10_000);
    c.set("b", "2", 10_000);
    expect(c.get("a")).toBe("1"); // touch "a" → "b" is now oldest
    c.set("c", "3", 10_000); // evicts "b"
    expect(c.get("a")).toBe("1");
    expect(c.get("b")).toBeUndefined();
  });

  test("re-setting a key refreshes its value + position", () => {
    const c = new SearchCache({ maxEntries: 2 });
    c.set("a", "1", 10_000);
    c.set("a", "1b", 10_000);
    expect(c.get("a")).toBe("1b");
    expect(c.size).toBe(1);
  });

  test("clear empties the cache", () => {
    const c = new SearchCache();
    c.set("a", "1", 10_000);
    c.clear();
    expect(c.size).toBe(0);
  });
});

describe("getSharedSearchCache", () => {
  test("returns a stable singleton across calls", () => {
    _resetSharedSearchCacheForTests();
    const a = getSharedSearchCache();
    const b = getSharedSearchCache();
    expect(a).toBe(b);
  });

  test("reset produces a fresh instance", () => {
    const a = getSharedSearchCache();
    _resetSharedSearchCacheForTests();
    const b = getSharedSearchCache();
    expect(a).not.toBe(b);
  });
});
