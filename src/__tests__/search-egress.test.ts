/**
 * SSRF-guard unit tests — `src/search/egress.ts`.
 *
 * Every §4 case from tasks/shared-search-capability.md: metadata IP,
 * RFC-1918, loopback, link-local, unique-local, DNS-rebind (public→private
 * across two lookups, defeated by IP-pinning), redirect-to-internal,
 * non-http scheme, body cap, timeout, and the sanctioned searxng-internal
 * backend allow. No live network, no DB — the transport + resolver are
 * injected, except one case that terminates TLS on a loopback listener to
 * prove the pinned certificate check end to end.
 */
import { test, expect, describe } from "bun:test";
import { rmSync } from "node:fs";
import { certificates } from "./helpers/factory-certificates";
import {
  guardedFetch,
  isBlockedIp,
  defaultResolveHost,
  EgressBlockedError,
  type FetchLike,
  type ResolveHost,
  type EgressBlockReason,
} from "../search/egress";

// ── Helpers ─────────────────────────────────────────────────────────

function okResponse(body = "ok", headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** A resolver that returns a fixed map of hostname → IPs. */
function staticResolver(map: Record<string, string[]>): ResolveHost {
  return async (host) => {
    if (host in map) return map[host]!;
    // Default: a public IP.
    return ["93.184.216.34"];
  };
}

const PUBLIC_IP = "93.184.216.34";

// ── isBlockedIp matrix ──────────────────────────────────────────────

describe("isBlockedIp", () => {
  const blocked = [
    "127.0.0.1", "127.5.5.5",
    "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // AWS metadata
    "0.0.0.0",
    "100.64.0.1", // CGN
    "::1", // IPv6 loopback
    "::", // unspecified
    "fd00:ec2::254", // AWS IPv6 metadata (unique-local)
    "fc00::1", // unique-local
    "fe80::1", // link-local
    "::ffff:127.0.0.1", // IPv4-mapped loopback (dotted)
    "::ffff:10.0.0.1", // IPv4-mapped private (dotted)
    "::ffff:7f00:1", // IPv4-mapped loopback (hex-grouped, 127.0.0.1)
    "::ffff:a9fe:a9fe", // IPv4-mapped metadata (hex-grouped, 169.254.169.254)
    "0:0:0:0:0:ffff:7f00:1", // IPv4-mapped loopback (uncompressed hex)
    "fec0::1", // deprecated site-local (RFC 3879)
    "::7f00:1", // v4-compatible loopback (deprecated, 127.0.0.1)
    "::127.0.0.1", // v4-compatible loopback (dotted)
    "2002:7f00:1::", // 6to4 wrapping 127.0.0.1
    "2002:a9fe:a9fe::", // 6to4 wrapping 169.254.169.254 metadata
    "64:ff9b::7f00:1", // NAT64 wrapping 127.0.0.1
    "64:ff9b::a9fe:a9fe", // NAT64 wrapping metadata
    "0.1.2.3", // 0.0.0.0/8 "this network", not just 0.0.0.0
    "224.0.0.1", "239.255.255.250", // multicast 224.0.0.0/4 (SSDP)
    "240.0.0.1", "255.255.255.255", // reserved 240.0.0.0/4 incl. broadcast
    "198.18.0.1", "198.19.255.255", // benchmark 198.18.0.0/15
    "ff02::1", "ff05::c", // IPv6 multicast ff00::/8
    "::ffff:224.0.0.1", // IPv4-mapped multicast
    "::ffff:255.255.255.255", // IPv4-mapped broadcast
    "::ffff:c612:1", // IPv4-mapped benchmark (hex-grouped, 198.18.0.1)
    "not-an-ip", // fail closed
  ];
  for (const ip of blocked) {
    test(`blocks ${ip}`, () => {
      expect(isBlockedIp(ip)).toBe(true);
    });
  }

  const allowed = [
    "93.184.216.34", "8.8.8.8", "1.1.1.1",
    "172.32.0.1", // just outside RFC-1918
    "192.169.0.1", // just outside 192.168/16
    "100.63.255.255", "100.128.0.1", // just outside CGN
    "198.17.255.255", "198.20.0.1", // just outside benchmark 198.18/15
    "223.255.255.255", // just below multicast
    "2606:2800:220:1:248:1893:25c8:1946", // public IPv6
    "2001:db8:1:ffff:1:2:3:4", // public IPv6 containing ffff mid-address (NOT v4-mapped)
    "2002:0808:0808::", // 6to4 wrapping a PUBLIC v4 (8.8.8.8) — not over-blocked
    "64:ff9b::808:808", // NAT64 wrapping a PUBLIC v4 (8.8.8.8) — not over-blocked
    "::ffff:8.8.8.8", // v4-mapped PUBLIC — allowed
  ];
  for (const ip of allowed) {
    test(`allows ${ip}`, () => {
      expect(isBlockedIp(ip)).toBe(false);
    });
  }
});

// ── defaultResolveHost ──────────────────────────────────────────────

describe("defaultResolveHost", () => {
  test("returns an IP literal verbatim (no DNS lookup)", async () => {
    expect(await defaultResolveHost("93.184.216.34")).toEqual(["93.184.216.34"]);
    expect(await defaultResolveHost("::1")).toEqual(["::1"]);
  });

  test("resolves a hostname via the system resolver (localhost → loopback)", async () => {
    const ips = await defaultResolveHost("localhost");
    expect(ips.length).toBeGreaterThan(0);
    // localhost always resolves to a loopback address on any host.
    expect(ips.every((ip) => isBlockedIp(ip))).toBe(true);
  });
});

// ── mode:"read" — private/internal rejection ────────────────────────

describe("guardedFetch mode:read — private rejection", () => {
  async function expectBlocked(
    host: string,
    ip: string,
    reason: EgressBlockReason,
  ): Promise<void> {
    const fetchImpl: FetchLike = async () => okResponse();
    const blocks: { reason: EgressBlockReason }[] = [];
    let caught: unknown;
    try {
      await guardedFetch(`https://${host}/x`, {}, {
        mode: "read",
        resolveHost: staticResolver({ [host]: [ip] }),
        fetchImpl,
        onBlocked: (i) => blocks.push(i),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EgressBlockedError);
    expect((caught as EgressBlockedError).reason).toBe(reason);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.reason).toBe(reason);
  }

  test("rejects loopback", () => expectBlocked("evil.test", "127.0.0.1", "private-ip"));
  test("rejects RFC-1918 (10/8)", () => expectBlocked("evil.test", "10.1.2.3", "private-ip"));
  test("rejects RFC-1918 (172.16/12)", () => expectBlocked("evil.test", "172.16.9.9", "private-ip"));
  test("rejects RFC-1918 (192.168/16)", () => expectBlocked("evil.test", "192.168.0.5", "private-ip"));
  test("rejects link-local", () => expectBlocked("evil.test", "169.254.1.1", "private-ip"));
  test("rejects cloud metadata IP", () => expectBlocked("metadata.test", "169.254.169.254", "private-ip"));
  test("rejects IPv6 metadata (unique-local)", () => expectBlocked("meta6.test", "fd00:ec2::254", "private-ip"));
  test("rejects 0.0.0.0", () => expectBlocked("evil.test", "0.0.0.0", "private-ip"));

  test("rejects when a hostname resolves to a MIX of public + private", async () => {
    let caught: unknown;
    try {
      await guardedFetch("https://mixed.test/x", {}, {
        mode: "read",
        resolveHost: staticResolver({ "mixed.test": [PUBLIC_IP, "10.0.0.1"] }),
        fetchImpl: async () => okResponse(),
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as EgressBlockedError).reason).toBe("private-ip");
  });

  test("rejects no-address (empty DNS answer)", async () => {
    let caught: unknown;
    try {
      await guardedFetch("https://void.test/x", {}, {
        mode: "read",
        resolveHost: async () => [],
        fetchImpl: async () => okResponse(),
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as EgressBlockedError).reason).toBe("no-address");
  });

  test("rejects when DNS resolution throws", async () => {
    let caught: unknown;
    try {
      await guardedFetch("https://nxdomain.test/x", {}, {
        mode: "read",
        resolveHost: async () => { throw new Error("ENOTFOUND"); },
        fetchImpl: async () => okResponse(),
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as EgressBlockedError).reason).toBe("no-address");
  });
});

// ── Scheme gate ─────────────────────────────────────────────────────

describe("guardedFetch — scheme gate", () => {
  for (const url of ["file:///etc/passwd", "gopher://x", "ftp://x/y", "data:text/plain,hi"]) {
    test(`blocks ${url}`, async () => {
      let caught: unknown;
      try {
        await guardedFetch(url, {}, { mode: "read", fetchImpl: async () => okResponse() });
      } catch (err) {
        caught = err;
      }
      expect((caught as EgressBlockedError).reason).toBe("scheme");
    });
  }

  test("blocks malformed URL", async () => {
    let caught: unknown;
    try {
      await guardedFetch("ht!tp://[bad", {}, { mode: "read", fetchImpl: async () => okResponse() });
    } catch (err) {
      caught = err;
    }
    expect((caught as EgressBlockedError).reason).toBe("scheme");
  });
});

// ── IP-pinning + DNS-rebind defense ─────────────────────────────────

describe("guardedFetch — IP pinning + DNS rebind", () => {
  test("pins the connection to the validated IP (Host header preserved)", async () => {
    let calledUrl = "";
    let hostHeader = "";
    const fetchImpl: FetchLike = async (url, init) => {
      calledUrl = url;
      hostHeader = new Headers(init.headers).get("host") ?? "";
      return okResponse("body");
    };
    const res = await guardedFetch("https://example.test/path?q=1", {}, {
      mode: "read",
      resolveHost: staticResolver({ "example.test": [PUBLIC_IP] }),
      fetchImpl,
    });
    expect(await res.text()).toBe("body");
    // Connection went to the IP literal, not the hostname.
    expect(calledUrl).toContain(PUBLIC_IP);
    expect(calledUrl).not.toContain("example.test");
    // Host header preserves the original hostname for TLS SNI / vhosts.
    expect(hostHeader).toBe("example.test");
  });

  test("a pinned https request names the original hostname as the TLS server name; plain http carries none", async () => {
    type WithTls = RequestInit & { tls?: Record<string, unknown> };
    const seen: Array<{ url: string; tls: WithTls["tls"] }> = [];
    const opts = {
      mode: "read" as const,
      resolveHost: staticResolver({ "example.test": [PUBLIC_IP] }),
      fetchImpl: (async (url, init) => { seen.push({ url, tls: (init as WithTls).tls }); return okResponse(); }) as FetchLike,
    };
    await guardedFetch("https://example.test/a", {}, opts);
    await guardedFetch("http://example.test/b", {}, opts);
    // A caller's own TLS options are kept, and its server name cannot override the hostname.
    await guardedFetch("https://example.test/c", { tls: { ca: "private-ca", serverName: "other.test" } } as WithTls, opts);
    expect(seen).toEqual([
      { url: `https://${PUBLIC_IP}/a`, tls: { serverName: "example.test" } },
      { url: `http://${PUBLIC_IP}/b`, tls: undefined },
      { url: `https://${PUBLIC_IP}/c`, tls: { ca: "private-ca", serverName: "example.test" } },
    ]);
  });

  // Bun 1.4 checks a fetch's certificate against the URL's host, the pinned IP, not the Host header (1.3.14 used the
  // header). The listener's certificate names only the hostname, so without an explicit TLS server name the pinned
  // request fails ERR_TLS_CERT_ALTNAME_INVALID on 1.4.2; with it, the certificate is verified against the hostname.
  test("a pinned https request is verified against the hostname's certificate, end to end", async () => {
    const directories: string[] = [];
    try {
      const certs = await certificates(directories, "tenant-a", { serverAltNames: "DNS:localhost" });
      using server = Bun.serve({ hostname: "127.0.0.1", port: 0, tls: { cert: certs.serverCert, key: certs.serverKey }, fetch: () => new Response("pinned") });
      const trusting: FetchLike = (url, init) => fetch(url, { ...init, tls: { ...(init as RequestInit & { tls?: object }).tls, ca: certs.ca } } as RequestInit);
      const res = await guardedFetch(`https://localhost:${server.port}/x`, {}, {
        mode: "backend",
        allowedHosts: ["localhost"],
        resolveHost: staticResolver({ localhost: ["127.0.0.1"] }),
        fetchImpl: trusting,
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("pinned");
    } finally {
      for (const directory of directories) rmSync(directory, { recursive: true, force: true });
    }
  });

  test("DNS-rebind: public on first lookup, private on second — pinning means we validated then connected to the SAME public IP", async () => {
    // The guard resolves ONCE per hop and pins. A rebind that flips the
    // answer after validation cannot redirect the connection because the
    // pinned IP literal is what we dial. Simulate by returning a private
    // IP on the SECOND resolve call — it must never be reached for a
    // single-hop request.
    let calls = 0;
    const resolveHost: ResolveHost = async () => {
      calls += 1;
      return calls === 1 ? [PUBLIC_IP] : ["169.254.169.254"];
    };
    let dialedIp = "";
    const fetchImpl: FetchLike = async (url) => {
      dialedIp = new URL(url).hostname;
      return okResponse("safe");
    };
    const res = await guardedFetch("https://rebind.test/x", {}, {
      mode: "read",
      resolveHost,
      fetchImpl,
    });
    expect(await res.text()).toBe("safe");
    expect(dialedIp).toBe(PUBLIC_IP);
    expect(calls).toBe(1); // resolved exactly once for the single hop
  });
});

// ── Multi-address failover ──────────────────────────────────────────
//
// `dnsLookup(…, {all:true})` returns `::1` before `127.0.0.1` for
// `localhost` on a dual-stack host. Pinning ips[0] made a sidecar
// published on IPv4 only unreachable: the guard dialed `[::1]`, got
// connection-refused, and the caller silently fell back to its secondary
// provider (the compose SearXNG service was never used). A plain `fetch`
// hides this by happy-eyeballing; pinning removed that, so the guard
// re-implements it over the SAME validated address set.

describe("guardedFetch — resolved-address failover", () => {
  test("falls over to the next resolved address when the first refuses", async () => {
    const dialed: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      const h = new URL(url).hostname;
      dialed.push(h);
      if (h === "[::1]") throw new Error("ConnectionRefused: Unable to connect");
      return okResponse("searxng-json");
    };
    const res = await guardedFetch("http://localhost:8889/search?q=x", {}, {
      mode: "backend",
      allowedHosts: ["localhost"],
      resolveHost: staticResolver({ localhost: ["::1", "127.0.0.1"] }),
      fetchImpl,
    });
    expect(await res.text()).toBe("searxng-json");
    // Tried IPv6 first (resolution order preserved), then IPv4.
    expect(dialed).toEqual(["[::1]", "127.0.0.1"]);
  });

  test("read mode fails over too — every candidate was already proven public", async () => {
    const dialed: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      const h = new URL(url).hostname;
      dialed.push(h);
      if (h === PUBLIC_IP) throw new Error("ECONNREFUSED");
      return okResponse("second");
    };
    const res = await guardedFetch("https://dual.test/x", {}, {
      mode: "read",
      resolveHost: staticResolver({ "dual.test": [PUBLIC_IP, "8.8.8.8"] }),
      fetchImpl,
    });
    expect(await res.text()).toBe("second");
    expect(dialed).toEqual([PUBLIC_IP, "8.8.8.8"]);
  });

  test("failover NEVER reaches an address the block-list rejects", async () => {
    // A mixed public/private answer is refused wholesale BEFORE any
    // connect — failover must not become a way to dial the private one.
    const dialed: string[] = [];
    let caught: unknown;
    try {
      await guardedFetch("https://mixed.test/x", {}, {
        mode: "read",
        resolveHost: staticResolver({ "mixed.test": [PUBLIC_IP, "169.254.169.254"] }),
        fetchImpl: async (url) => {
          dialed.push(new URL(url).hostname);
          return okResponse();
        },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EgressBlockedError);
    expect((caught as EgressBlockedError).reason).toBe("private-ip");
    expect(dialed).toEqual([]);
  });

  test("an HTTP error response stops failover — the host was reached", async () => {
    const dialed: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      dialed.push(new URL(url).hostname);
      return new Response("nope", { status: 503 });
    };
    const res = await guardedFetch("https://dual.test/x", {}, {
      mode: "read",
      resolveHost: staticResolver({ "dual.test": [PUBLIC_IP, "8.8.8.8"] }),
      fetchImpl,
    });
    expect(res.status).toBe(503);
    expect(dialed).toEqual([PUBLIC_IP]);
  });

  test("rethrows the last connection error when every address fails", async () => {
    const dialed: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      dialed.push(new URL(url).hostname);
      throw new Error("ECONNREFUSED");
    };
    let caught: unknown;
    try {
      await guardedFetch("https://dual.test/x", {}, {
        mode: "read",
        resolveHost: staticResolver({ "dual.test": [PUBLIC_IP, "8.8.8.8"] }),
        fetchImpl,
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toContain("ECONNREFUSED");
    expect(dialed).toEqual([PUBLIC_IP, "8.8.8.8"]);
  });

  test("a streaming body is not replayed — only the first address is tried", async () => {
    const dialed: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      dialed.push(new URL(url).hostname);
      throw new Error("ECONNREFUSED");
    };
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x"));
        c.close();
      },
    });
    let caught: unknown;
    try {
      await guardedFetch("https://dual.test/x", { method: "POST", body }, {
        mode: "read",
        resolveHost: staticResolver({ "dual.test": [PUBLIC_IP, "8.8.8.8"] }),
        fetchImpl,
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toContain("ECONNREFUSED");
    expect(dialed).toEqual([PUBLIC_IP]);
  });

  test("a string body (the JSON POST providers send) IS replayed across addresses", async () => {
    const dialed: string[] = [];
    const seenBodies: unknown[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      dialed.push(new URL(url).hostname);
      seenBodies.push(init.body);
      if (dialed.length === 1) throw new Error("ECONNREFUSED");
      return okResponse("ok");
    };
    const res = await guardedFetch(
      "https://dual.test/search",
      { method: "POST", body: JSON.stringify({ query: "q" }) },
      {
        mode: "read",
        resolveHost: staticResolver({ "dual.test": [PUBLIC_IP, "8.8.8.8"] }),
        fetchImpl,
      },
    );
    expect(await res.text()).toBe("ok");
    expect(dialed).toEqual([PUBLIC_IP, "8.8.8.8"]);
    expect(seenBodies).toEqual([JSON.stringify({ query: "q" }), JSON.stringify({ query: "q" })]);
  });
});

// ── Redirect handling ───────────────────────────────────────────────

describe("guardedFetch — redirects", () => {
  test("follows a public→public redirect and re-validates", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("hop1")) return redirectTo("https://final.test/done");
      return okResponse("final");
    };
    const res = await guardedFetch("https://hop1.test/start", {}, {
      mode: "read",
      resolveHost: staticResolver({ "hop1.test": [PUBLIC_IP], "final.test": ["8.8.8.8"] }),
      fetchImpl,
    });
    expect(await res.text()).toBe("final");
  });

  test("BLOCKS redirect-to-internal (302 → 169.254.169.254)", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes(PUBLIC_IP)) return redirectTo("http://metadata.internal/latest/meta-data/");
      return okResponse("leaked");
    };
    const blocks: { reason: EgressBlockReason }[] = [];
    let caught: unknown;
    try {
      await guardedFetch("https://innocent.test/start", {}, {
        mode: "read",
        resolveHost: staticResolver({
          "innocent.test": [PUBLIC_IP],
          "metadata.internal": ["169.254.169.254"],
        }),
        fetchImpl,
        onBlocked: (i) => blocks.push(i),
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as EgressBlockedError).reason).toBe("private-ip");
    expect(blocks[0]!.reason).toBe("private-ip");
  });

  test("BLOCKS after exceeding the redirect cap", async () => {
    // Always redirect to a new public host → exhaust the cap.
    let n = 0;
    const fetchImpl: FetchLike = async () => {
      n += 1;
      return redirectTo(`https://hop${n}.test/next`);
    };
    let caught: unknown;
    try {
      await guardedFetch("https://hop0.test/start", {}, {
        mode: "read",
        maxRedirects: 2,
        resolveHost: async () => [PUBLIC_IP],
        fetchImpl,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as EgressBlockedError).reason).toBe("redirect-limit");
  });
});

// ── Body cap ────────────────────────────────────────────────────────

describe("guardedFetch — body cap", () => {
  test("rejects via Content-Length", async () => {
    const fetchImpl: FetchLike = async () =>
      okResponse("x", { "content-length": "999999999" });
    let caught: unknown;
    try {
      await guardedFetch("https://big.test/x", {}, {
        mode: "read",
        maxBodyBytes: 1000,
        resolveHost: async () => [PUBLIC_IP],
        fetchImpl,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as EgressBlockedError).reason).toBe("body-too-large");
  });

  test("rejects a streamed body that exceeds the cap", async () => {
    const big = new Uint8Array(5000);
    const fetchImpl: FetchLike = async () =>
      new Response(big, { status: 200 });
    let caught: unknown;
    try {
      await guardedFetch("https://big.test/x", {}, {
        mode: "read",
        maxBodyBytes: 1000,
        resolveHost: async () => [PUBLIC_IP],
        fetchImpl,
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as EgressBlockedError).reason).toBe("body-too-large");
  });

  test("passes a body within the cap", async () => {
    const fetchImpl: FetchLike = async () => new Response("small", { status: 200 });
    const res = await guardedFetch("https://ok.test/x", {}, {
      mode: "read",
      maxBodyBytes: 1000,
      resolveHost: async () => [PUBLIC_IP],
      fetchImpl,
    });
    expect(await res.text()).toBe("small");
  });
});

// ── mode:"backend" — host allowlist + sanctioned SearXNG ────────────

describe("guardedFetch mode:backend — allowlist", () => {
  test("allows an allowlisted public backend host", async () => {
    const fetchImpl: FetchLike = async () => okResponse("results");
    const res = await guardedFetch("https://api.tavily.com/search", {}, {
      mode: "backend",
      allowedHosts: ["api.tavily.com"],
      resolveHost: staticResolver({ "api.tavily.com": ["8.8.8.8"] }),
      fetchImpl,
    });
    expect(await res.text()).toBe("results");
  });

  test("BLOCKS a backend host NOT on the allowlist", async () => {
    const blocks: { reason: EgressBlockReason }[] = [];
    let caught: unknown;
    try {
      await guardedFetch("https://evil.test/steal", {}, {
        mode: "backend",
        allowedHosts: ["api.tavily.com"],
        fetchImpl: async () => okResponse(),
        onBlocked: (i) => blocks.push(i),
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as EgressBlockedError).reason).toBe("host-not-allowed");
    expect(blocks[0]!.reason).toBe("host-not-allowed");
  });

  test("SANCTIONED: allows the configured internal SearXNG host (allowlisted) even though it resolves to a private IP, but still IP-pins", async () => {
    let dialedIp = "";
    const fetchImpl: FetchLike = async (url) => {
      dialedIp = new URL(url).hostname;
      return okResponse("searxng-json");
    };
    const res = await guardedFetch("http://searxng:8080/search?q=x", {}, {
      mode: "backend",
      allowedHosts: ["searxng"],
      resolveHost: staticResolver({ searxng: ["10.0.7.7"] }),
      fetchImpl,
    });
    expect(await res.text()).toBe("searxng-json");
    // Pinned to the resolved IP (not the hostname) — rebind-proof.
    expect(dialedIp).toBe("10.0.7.7");
  });

  test("backend mode still blocks a non-http scheme", async () => {
    let caught: unknown;
    try {
      await guardedFetch("file:///etc/passwd", {}, {
        mode: "backend",
        allowedHosts: ["searxng"],
        fetchImpl: async () => okResponse(),
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as EgressBlockedError).reason).toBe("scheme");
  });

  test("backend mode blocks no-address for an allowlisted host", async () => {
    let caught: unknown;
    try {
      await guardedFetch("https://api.tavily.com/x", {}, {
        mode: "backend",
        allowedHosts: ["api.tavily.com"],
        resolveHost: async () => [],
        fetchImpl: async () => okResponse(),
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as EgressBlockedError).reason).toBe("no-address");
  });
});
