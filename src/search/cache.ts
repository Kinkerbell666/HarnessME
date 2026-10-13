// Host-side shared search cache.
//
// In-process TTL + LRU keyed `provider:kind:query`. Shared across every
// consumer of the host search module (the web-search extension's tools,
// other extensions via `ctx.search`, and future host-side callers like
// the briefing pipeline) — so ext-A and ext-B searching the same thing
// hit ONE cache.
//
// The provider name is part of the key (mirroring the extension's
// keying) so a fallback provider's results never poison the primary's
// namespace: a SearXNG outage that serves DuckDuckGo results caches under
// `duckduckgo:*`, and recovers cleanly when SearXNG returns.
//
// Disk persistence is optional and OUT OF SCOPE for Phase 1 — the host
// process is long-lived, so an in-process map is sufficient. (The
// extension's disk cache existed because each subprocess is ephemeral;
// the host is not.) The clock is injectable for deterministic tests.

export interface SearchCacheOptions {
  /** Maximum entries retained; oldest (LRU) are evicted first. */
  maxEntries?: number;
  /** Injectable clock for deterministic TTL tests. */
  now?: () => number;
}

interface Entry {
  value: string;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 500;

export class SearchCache {
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly map = new Map<string, Entry>();

  constructor(opts: SearchCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = opts.now ?? Date.now;
  }

  /** Build the canonical cache key: `provider:kind:query`. The query is
   *  trimmed; a search query is also lowercased so trivially-different
   *  queries share a slot. A read URL keeps its case — URL paths are
   *  case-sensitive. The `extra` segment carries result-count / char-cap
   *  so a maxResults change doesn't serve a stale-sized payload. */
  static key(provider: string, kind: "search" | "read", query: string, extra: string | number): string {
    const trimmed = query.trim();
    return `${provider}:${kind}:${kind === "search" ? trimmed.toLowerCase() : trimmed}:${extra}`;
  }

  get(key: string): string | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU position.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string, ttlMs: number): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /** Test/operability helper. */
  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** Process-wide singleton — the shared cache every consumer hits. */
let shared: SearchCache | undefined;

export function getSharedSearchCache(): SearchCache {
  if (!shared) shared = new SearchCache();
  return shared;
}

/** Test-only — reset the shared singleton. */
export function _resetSharedSearchCacheForTests(): void {
  shared = undefined;
}
