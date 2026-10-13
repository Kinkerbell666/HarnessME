/**
 * Unit tests for `src/extensions/network-handler.ts` —
 *   - `handleNetworkInternalRpc` (the JSON-RPC handler) with all error
 *     branches + happy path + size cap
 *   - `isInternalHost` matrix (every documented internal pattern + a
 *     few public-IP rejections)
 *
 * Strategy: pass a stub `PermissionEngine` (allow / deny variants) and
 * a stub `fetchImpl` so we don't need a real localhost server or DB.
 * The PDP gate is exercised with both decisions; the upstream fetch is
 * exercised with a 200 OK, an error throw, and an oversized body.
 */

import { test, expect, describe, mock, afterAll } from "bun:test";
import { restoreModuleMocks } from "./helpers/mock-cleanup";

// Audit-log writes go through the DB layer; mock so we don't need a
// real connection. The PDP stub below short-circuits the audit path
// anyway, but the registry / db mocks keep the import graph satisfied.
mock.module("../db/queries/extensions", () => ({
  disableExtension: async () => {},
  listExtensions: async () => [],
  incrementFailures: async () => 0,
  resetFailures: async () => {},
}));
mock.module("../db/queries/settings", () => ({
  getSetting: async () => null,
  upsertSetting: async () => {},
  getAllSettings: async () => ({}),
  deleteSetting: async () => false,
  isListingInstalled: async () => false,
}));
mock.module("../db/connection", () => ({
  getDb: () => ({
    insert: () => ({ values: () => Promise.resolve() }),
  }),
}));
afterAll(() => restoreModuleMocks());

import {
  handleNetworkInternalRpc,
  isInternalHost,
  type NetworkInternalContext,
} from "../extensions/network-handler";
import type { JsonRpcRequest } from "../extensions/types";

// ── Stub builders ────────────────────────────────────────────────

function makeAllowEngine(): NetworkInternalContext["engine"] {
  return {
    authorize: async () => ({ decision: "allow", auditId: "stub-allow" }),
    resolvePrompt: async () => {},
    flushAudit: async () => {},
    _resetCacheForTests: () => {},
  };
}

function makeDenyEngine(reason = "no host capability"): NetworkInternalContext["engine"] {
  return {
    authorize: async () => ({ decision: "deny", reason, auditId: "stub-deny" }),
    resolvePrompt: async () => {},
    flushAudit: async () => {},
    _resetCacheForTests: () => {},
  };
}

function makeRegistryStub(): NetworkInternalContext["registry"] {
  // The handler doesn't touch the registry directly in Phase 2 — it's
  // reserved for future use (Phase 4 cross-ext attribution). A bare
  // object satisfies the type.
  return {} as NetworkInternalContext["registry"];
}

function makeCtx(overrides: Partial<NetworkInternalContext> = {}): NetworkInternalContext {
  return {
    extensionId: "ext-1",
    conversationId: "conv-1",
    userId: "user-1",
    engine: makeAllowEngine(),
    registry: makeRegistryStub(),
    ...overrides,
  };
}

function makeReq(params: Record<string, unknown> = {}): JsonRpcRequest {
  return { jsonrpc: "2.0", id: 42, method: "ezcorp/network.internal", params };
}

/** Allows only the listed hostnames, like a manifest network grant. */
function makeHostEngine(allowed: string[], seen: string[] = []): NetworkInternalContext["engine"] {
  return {
    authorize: async (_ctx, needed) => {
      const host = String(needed[0]?.value);
      seen.push(host);
      return allowed.includes(host)
        ? { decision: "allow", auditId: "stub-allow" }
        : { decision: "deny", reason: `no grant for ${host}`, auditId: "stub-deny" };
    },
    resolvePrompt: async () => {},
    flushAudit: async () => {},
    _resetCacheForTests: () => {},
  };
}

// ── handleNetworkInternalRpc — input validation ──────────────────

describe("handleNetworkInternalRpc — input validation", () => {
  test("missing url param → -32602 Missing url", async () => {
    const resp = await handleNetworkInternalRpc(makeReq(), makeCtx());
    expect(resp.error?.code).toBe(-32602);
    expect(resp.error?.message).toBe("Missing url");
  });

  test("non-string url param → -32602 Missing url", async () => {
    const resp = await handleNetworkInternalRpc(makeReq({ url: 42 }), makeCtx());
    expect(resp.error?.code).toBe(-32602);
  });

  test("malformed url string → -32602 Invalid url", async () => {
    const resp = await handleNetworkInternalRpc(
      makeReq({ url: "not a url" }),
      makeCtx(),
    );
    expect(resp.error?.code).toBe(-32602);
    expect(resp.error?.message).toBe("Invalid url");
  });

  test("response carries the request id (numeric)", async () => {
    const resp = await handleNetworkInternalRpc(
      { jsonrpc: "2.0", id: 99, method: "x" },
      makeCtx(),
    );
    expect(resp.id).toBe(99);
  });

  test("response carries the request id (string)", async () => {
    const resp = await handleNetworkInternalRpc(
      { jsonrpc: "2.0", id: "abc", method: "x" },
      makeCtx(),
    );
    expect(resp.id).toBe("abc");
  });
});

// ── handleNetworkInternalRpc — PDP gate ──────────────────────────

describe("handleNetworkInternalRpc — PDP gate", () => {
  test("PDP returns deny → -32001 Network denied with reason", async () => {
    const resp = await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost:5432/" }),
      makeCtx({ engine: makeDenyEngine("missing capability network (localhost)") }),
    );
    expect(resp.error?.code).toBe(-32001);
    expect(resp.error?.message).toContain("Network denied");
    expect(resp.error?.message).toContain("missing capability network");
  });

  test("PDP receives a {kind:'network', value: lowercased-host} capability tuple", async () => {
    // N3 (auditor nice-to-have): assert the capability KIND, not just
    // the value. A typo-induced kind drift (e.g. "net" instead of
    // "network") would silently cause the PDP to reject every tuple
    // — caught here.
    let captured: { kind?: string; value?: string } | undefined;
    const engine: NetworkInternalContext["engine"] = {
      authorize: async (_ctx, needed) => {
        captured = needed[0] as { kind?: string; value?: string } | undefined;
        return { decision: "allow", auditId: "x" };
      },
      resolvePrompt: async () => {},
      flushAudit: async () => {},
      _resetCacheForTests: () => {},
    };
    await handleNetworkInternalRpc(
      makeReq({ url: "http://LOCALHOST:5432/" }),
      makeCtx({
        engine,
        // stub fetch so we don't try to dial localhost
      }),
      {
        fetchImpl: (async () =>
          new Response("ok", { status: 200, statusText: "OK" })) as unknown as typeof fetch,
      },
    );
    expect(captured?.kind).toBe("network");
    expect(captured?.value).toBe("localhost");
  });

  test("PDP receives bracket-stripped value for IPv6 hosts (M1 regression guard)", async () => {
    // Pre-extraction the handler did `.toLowerCase()` only — the value
    // arriving at the PDP for `http://[::1]/` was `[::1]` (with
    // brackets), while the wrapper-side classification used `::1`
    // (bracket-stripped). The shared internal-host module fixes this:
    // both sides now share `normalizeHostname`. A regression that
    // dropped the strip would surface as `[::1]` here.
    let captured: { value?: string } | undefined;
    const engine: NetworkInternalContext["engine"] = {
      authorize: async (_ctx, needed) => {
        captured = needed[0] as { value?: string } | undefined;
        return { decision: "allow", auditId: "x" };
      },
      resolvePrompt: async () => {},
      flushAudit: async () => {},
      _resetCacheForTests: () => {},
    };
    await handleNetworkInternalRpc(
      makeReq({ url: "http://[::1]/healthz" }),
      makeCtx({ engine }),
      {
        fetchImpl: (async () =>
          new Response("ok", { status: 200, statusText: "OK" })) as unknown as typeof fetch,
      },
    );
    expect(captured?.value).toBe("::1");
  });

  test("PDP receives correct ctx fields", async () => {
    // Phase 6: AuthorizeContext.userId/conversationId widened to
    // `string | null`, so the captured fixture must accept null too.
    let capturedCtx: { extensionId?: string; userId?: string | null; conversationId?: string | null } | undefined;
    const engine: NetworkInternalContext["engine"] = {
      authorize: async (ctx) => {
        capturedCtx = ctx;
        return { decision: "allow", auditId: "x" };
      },
      resolvePrompt: async () => {},
      flushAudit: async () => {},
      _resetCacheForTests: () => {},
    };
    await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost/" }),
      makeCtx({
        engine,
        extensionId: "my-ext",
        userId: "alice",
        conversationId: "conv-9",
      }),
      {
        fetchImpl: (async () =>
          new Response("ok", { status: 200, statusText: "OK" })) as unknown as typeof fetch,
      },
    );
    expect(capturedCtx?.extensionId).toBe("my-ext");
    expect(capturedCtx?.userId).toBe("alice");
    expect(capturedCtx?.conversationId).toBe("conv-9");
  });
});

// ── handleNetworkInternalRpc — happy path ────────────────────────

describe("handleNetworkInternalRpc — happy path", () => {
  test("allow + 200 OK → result with status, statusText, headers, base64 body", async () => {
    const resp = await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost:3000/v1/healthz" }),
      makeCtx(),
      {
        fetchImpl: (async () =>
          new Response("hello", {
            status: 200,
            statusText: "OK",
            headers: { "x-trace": "abc", "content-type": "text/plain" },
          })) as unknown as typeof fetch,
      },
    );
    expect(resp.error).toBeUndefined();
    const result = resp.result as {
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(result.status).toBe(200);
    expect(result.statusText).toBe("OK");
    expect(result.headers["x-trace"]).toBe("abc");
    expect(result.headers["content-type"]).toBe("text/plain");
    // base64 of "hello" is "aGVsbG8="
    expect(result.body).toBe("aGVsbG8=");
  });

  test("response headers are lowercased on the wire (N4: Headers#forEach normalization)", async () => {
    // The handler iterates `resp.headers.forEach((v, k) => …)` to
    // flatten Headers into a Record. The Fetch spec mandates Headers
    // to lowercase keys on iteration — this test pins that contract.
    // A regression that switched to `Object.entries` on the underlying
    // map (or a non-lowercasing iterator) would surface here.
    const resp = await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost/" }),
      makeCtx(),
      {
        fetchImpl: (async () =>
          new Response("x", {
            status: 200,
            statusText: "OK",
            // Authored with mixed case — Headers spec normalizes on
            // store, forEach yields lowercase. The wrapper relies on
            // that for stable downstream lookups.
            headers: { "X-Custom-Header": "v1", "Content-Type": "application/json" },
          })) as unknown as typeof fetch,
      },
    );
    const result = resp.result as { headers: Record<string, string> };
    expect(result.headers["x-custom-header"]).toBe("v1");
    expect(result.headers["content-type"]).toBe("application/json");
    // Mixed-case keys MUST NOT be present (would indicate iterator
    // didn't normalize).
    expect(result.headers["X-Custom-Header"]).toBeUndefined();
    expect(result.headers["Content-Type"]).toBeUndefined();
  });

  test("non-200 status echoes through unchanged", async () => {
    const resp = await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost/broken" }),
      makeCtx(),
      {
        fetchImpl: (async () =>
          new Response("nope", { status: 500, statusText: "Internal Server Error" })) as unknown as typeof fetch,
      },
    );
    const result = resp.result as { status: number; statusText: string };
    expect(result.status).toBe(500);
    expect(result.statusText).toBe("Internal Server Error");
  });

  test("init params (method, headers, body) are forwarded to fetch", async () => {
    let captured: { url?: string; init?: RequestInit } | undefined;
    const fetchImpl: typeof fetch = (async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return new Response("", { status: 204, statusText: "No Content" });
    }) as unknown as typeof fetch;
    await handleNetworkInternalRpc(
      makeReq({
        url: "http://localhost/api",
        init: {
          method: "POST",
          headers: { "x-foo": "bar" },
          body: '{"k":"v"}',
        },
      }),
      makeCtx(),
      { fetchImpl },
    );
    expect(captured?.url).toBe("http://localhost/api");
    expect(captured?.init?.method).toBe("POST");
    expect(captured?.init?.headers).toMatchObject({ "x-foo": "bar" });
    expect(captured?.init?.body).toBe('{"k":"v"}');
  });

  test("init=undefined still works (no shape error)", async () => {
    const resp = await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost/" }),
      makeCtx(),
      {
        fetchImpl: (async () =>
          new Response("", { status: 200, statusText: "OK" })) as unknown as typeof fetch,
      },
    );
    expect(resp.error).toBeUndefined();
  });
});

// ── handleNetworkInternalRpc — error & cap branches ──────────────

describe("handleNetworkInternalRpc — error & cap branches", () => {
  test("upstream fetch throws → -32000 Upstream error: <message>", async () => {
    const resp = await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost:1/dead" }),
      makeCtx(),
      {
        fetchImpl: (async () => {
          throw new Error("ECONNREFUSED");
        }) as unknown as typeof fetch,
      },
    );
    expect(resp.error?.code).toBe(-32000);
    expect(resp.error?.message).toBe("Upstream error: ECONNREFUSED");
  });

  test("response > 10MB → -32000 Response exceeds 10MB internal-fetch cap", async () => {
    // Build a 10MB+1 byte body.
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const resp = await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost/big" }),
      makeCtx(),
      {
        fetchImpl: (async () =>
          new Response(big, { status: 200, statusText: "OK" })) as unknown as typeof fetch,
      },
    );
    expect(resp.error?.code).toBe(-32000);
    expect(resp.error?.message).toContain("10MB");
  });

  test("response exactly 10MB is allowed (boundary)", async () => {
    const exact = new Uint8Array(10 * 1024 * 1024);
    const resp = await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost/exact" }),
      makeCtx(),
      {
        fetchImpl: (async () =>
          new Response(exact, { status: 200, statusText: "OK" })) as unknown as typeof fetch,
      },
    );
    expect(resp.error).toBeUndefined();
  });

  test("body read failure → -32000 Body read error: <message>", async () => {
    // Mock a Response whose arrayBuffer() rejects.
    const badResponse = {
      arrayBuffer: () => Promise.reject(new Error("read failed")),
      status: 200,
      statusText: "OK",
      headers: { forEach: () => {} },
    };
    const resp = await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost/" }),
      makeCtx(),
      { fetchImpl: (async () => badResponse) as unknown as typeof fetch },
    );
    expect(resp.error?.code).toBe(-32000);
    expect(resp.error?.message).toBe("Body read error: read failed");
  });
});

// ── isInternalHost — matrix ─────────────────────────────────────

describe("isInternalHost", () => {
  test("matches every documented internal pattern", () => {
    const internal = [
      "localhost",
      "LOCALHOST",
      "127.0.0.1",
      "127.255.255.254",
      "::1",
      "10.0.0.1",
      "10.255.255.254",
      "192.168.1.1",
      "172.16.0.1",
      "172.31.255.254",
      "169.254.169.254",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      // 0.0.0.0/8 — `0.0.0.0` reaches loopback services on Linux.
      "0.0.0.0",
      "0.0.0.1",
      // CGNAT / RFC-6598 shared address space (100.64.0.0/10).
      "100.64.0.1",
      "100.100.0.1",
      "100.127.255.254",
    ];
    for (const h of internal) {
      expect(isInternalHost(h)).toBe(true);
    }
  });

  test("rejects public IPs", () => {
    const external = [
      "8.8.8.8",
      "1.1.1.1",
      "api.foo.com",
      "11.0.0.1",
      "172.15.0.1", // boundary (just outside RFC-1918 class B)
      "172.32.0.1", // boundary (just outside)
      "200.0.0.1",
      "100.63.0.1", // boundary (just below CGNAT 100.64/10)
      "100.128.0.1", // boundary (just above CGNAT 100.64/10)
      "1.0.0.1", // public — must NOT be confused with 0.0.0.0/8
    ];
    for (const h of external) {
      expect(isInternalHost(h)).toBe(false);
    }
  });

  test("case-insensitive match", () => {
    expect(isInternalHost("Fe80::1")).toBe(true);
    expect(isInternalHost("FC00::1")).toBe(true);
  });
});

// ── SEC-05: anchor `localhost` so attacker-controlled domains don't false-match ──
//
// Pre-fix: `INTERNAL_HOST_RE` matched `localhost` as an unanchored
// alternative — `localhost.evil.com` was therefore classified as
// internal and the host PDP / network-wrapper waved it through the
// internal lane. Post-fix: `localhost(?:$|:)` anchors the match to
// end-of-string OR the port-separator colon.

describe("isInternalHost — SEC-05 anchor for localhost", () => {
  test("rejects attacker-controlled localhost.* domains", () => {
    expect(isInternalHost("localhost.evil.com")).toBe(false);
    expect(isInternalHost("LocalHost.evil.com")).toBe(false);
    expect(isInternalHost("localhost.local")).toBe(false);
    expect(isInternalHost("localhost-attacker.com")).toBe(false);
  });

  test("port-suffixed localhost still matches", () => {
    expect(isInternalHost("localhost:8080")).toBe(true);
    expect(isInternalHost("localhost:3000")).toBe(true);
    expect(isInternalHost("LOCALHOST:9999")).toBe(true);
  });

  test("bare localhost still matches", () => {
    expect(isInternalHost("localhost")).toBe(true);
    expect(isInternalHost("LOCALHOST")).toBe(true);
  });
});

// ── IPv4-mapped IPv6 + alternate-encoding loopback bypasses ──────
//
// `::ffff:127.0.0.1` (and the hex form `::ffff:7f00:1` that
// `URL.hostname` normalizes it to) would slip past the IPv4 loopback
// patterns unless the embedded v4 is decoded and re-tested. `0.0.0.0`
// and CGNAT addresses are covered by the regex directly.

describe("isInternalHost — IPv4-mapped IPv6 loopback", () => {
  test("dotted-tail mapped loopback is internal", () => {
    expect(isInternalHost("::ffff:127.0.0.1")).toBe(true);
    expect(isInternalHost("[::ffff:127.0.0.1]")).toBe(true);
  });

  test("hex-tail mapped loopback (URL-normalized form) is internal", () => {
    // new URL("http://[::ffff:127.0.0.1]/").hostname === "[::ffff:7f00:1]"
    expect(isInternalHost("::ffff:7f00:1")).toBe(true);
    expect(isInternalHost("[::ffff:7f00:1]")).toBe(true);
  });

  test("mapped private-range addresses are internal", () => {
    expect(isInternalHost("::ffff:10.0.0.1")).toBe(true);
    expect(isInternalHost("::ffff:169.254.169.254")).toBe(true);
  });

  test("mapped PUBLIC addresses stay external", () => {
    expect(isInternalHost("::ffff:8.8.8.8")).toBe(false);
    expect(isInternalHost("::ffff:0808:0808")).toBe(false); // hex 8.8.8.8
  });

  test("malformed mapped forms don't throw and stay external", () => {
    expect(isInternalHost("::ffff:nothex:zz")).toBe(false);
    expect(isInternalHost("::ffff:")).toBe(false);
  });
});

// ── handleNetworkInternalRpc — redirects (real local servers) ────

describe("handleNetworkInternalRpc — every redirect hop is gated", () => {
  test("a granted host cannot redirect the host fetch to an ungranted host", async () => {
    const secret = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("internal secret") });
    const granted = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.redirect(`http://127.0.0.1:${secret.port}/admin`, 302),
    });
    try {
      const seen: string[] = [];
      const res = await handleNetworkInternalRpc(
        makeReq({ url: `http://localhost:${granted.port}/start` }),
        makeCtx({ engine: makeHostEngine(["localhost"], seen) }),
      );
      expect(res.result).toBeUndefined();
      expect(res.error?.code).toBe(-32001);
      expect(res.error?.message).toContain("127.0.0.1");
      expect(seen).toEqual(["localhost", "127.0.0.1"]);
    } finally {
      granted.stop(true);
      secret.stop(true);
    }
  });

  test("a redirect inside the grant is followed, and a 303 turns a POST into a GET without a body", async () => {
    const methods: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (req) => {
        methods.push(`${req.method}:${await req.text()}`);
        return new URL(req.url).pathname === "/start"
          ? new Response(null, { status: 303, headers: { location: "/done" } })
          : new Response("done");
      },
    });
    try {
      const res = await handleNetworkInternalRpc(
        makeReq({ url: `http://localhost:${server.port}/start`, init: { method: "POST", body: "x=1" } }),
        makeCtx({ engine: makeHostEngine(["localhost"]) }),
      );
      const result = res.result as { status: number; body: string };
      expect(result.status).toBe(200);
      expect(Buffer.from(result.body, "base64").toString()).toBe("done");
      expect(methods).toEqual(["POST:x=1", "GET:"]);
    } finally {
      server.stop(true);
    }
  });

  test("credentials are not sent to a different origin after a redirect", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
      return calls.length === 1
        ? new Response(null, { status: 307, headers: { location: "http://127.0.0.1:9/next" } })
        : new Response("ok");
    }) as unknown as typeof fetch;
    const res = await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost:9/start", init: { headers: { Authorization: "Bearer t", "x-trace": "1" } } }),
      makeCtx({ engine: makeHostEngine(["localhost", "127.0.0.1"]) }),
      { fetchImpl },
    );
    expect((res.result as { status: number }).status).toBe(200);
    expect(calls.map((c) => c.headers)).toEqual([{ Authorization: "Bearer t", "x-trace": "1" }, { "x-trace": "1" }]);
  });

  test.each([
    ["a redirect loop", "http://localhost:9/loop", "too many redirects"],
    ["a non-http location", "file:///etc/passwd", "invalid redirect location"],
  ])("%s → -32000", async (_name, location, message) => {
    const fetchImpl = (async () =>
      new Response(null, { status: 302, headers: { location } })) as unknown as typeof fetch;
    const res = await handleNetworkInternalRpc(
      makeReq({ url: "http://localhost:9/start" }),
      makeCtx({ engine: makeHostEngine(["localhost"]) }),
      { fetchImpl },
    );
    expect(res.error?.code).toBe(-32000);
    expect(res.error?.message).toContain(message);
  });
});
