/**
 * SSRF-guarded outbound fetch for the shared search host module.
 *
 * `read-url` and the search backends fetch user/agent-controllable URLs
 * HOST-side — outside the extension sandbox's `EZCORP_PERMITTED_HOSTS`
 * enforcement. That is a classic SSRF surface, so EVERY host-side search
 * fetch routes through `guardedFetch`.
 *
 * Two modes:
 *
 *   - `mode: "read"` (the `read-url` reader): the URL is fully
 *     attacker-controlled. Resolve the hostname to IP(s); REJECT if ANY
 *     resolved IP is loopback / private (RFC-1918) / link-local /
 *     unique-local / the cloud metadata address / 0.0.0.0 / unspecified /
 *     multicast / reserved / benchmark.
 *     Then connect to the VALIDATED IP (pin it) and re-validate after
 *     every redirect — this defeats both DNS-rebinding (hostname resolves
 *     public on the first lookup, private on the connect) and
 *     redirect-to-internal. Cap redirects (≤3), body size, and timeout.
 *     Block non-http(s) schemes.
 *
 *   - `mode: "backend"` (the search backends → SearXNG / DDG / BYOK): the
 *     target host is NOT attacker-controlled — it comes from the
 *     configured provider chain. Allowlist to the configured backend
 *     hosts only. The configured SearXNG instance is the ONE sanctioned
 *     internal target: an internal-host SearXNG URL is allowed *by exact
 *     configured host*, but is STILL IP-pinned (so a hostile DNS answer
 *     for `searxng` can't redirect the fetch elsewhere — the allow is on
 *     the host string, the connection is on the validated IP).
 *
 * Every block emits an audit signal via the injected `onBlocked`
 * callback (the handler wires `insertAuditEntry(... SDK_SEARCH_EGRESS_BLOCKED)`;
 * pure unit tests pass a spy). This module imports NO DB / SDK code so
 * its tests run over a mocked transport with zero live network and zero
 * PGlite.
 *
 * IP resolution uses `node:dns/promises` (vitest-bundleable — see the
 * landmine note in tasks/shared-search-capability.md §7) rather than a
 * bun builtin.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// ── Configuration / injection seams ─────────────────────────────────

export type EgressMode = "read" | "backend";

/** Reason a fetch was blocked — drives the audit metadata + the thrown
 *  error message. */
export type EgressBlockReason =
  | "scheme"
  | "private-ip"
  | "host-not-allowed"
  | "redirect-limit"
  | "body-too-large"
  | "timeout"
  | "no-address";

export class EgressBlockedError extends Error {
  readonly code = "EGRESS_BLOCKED";
  readonly reason: EgressBlockReason;
  /** The blocked target (URL or `host → ip`) for the audit row. */
  readonly target: string;
  constructor(reason: EgressBlockReason, target: string, message?: string) {
    super(message ?? `Egress blocked (${reason}): ${target}`);
    this.name = "EgressBlockedError";
    this.reason = reason;
    this.target = target;
  }
}

/** Signature of the low-level transport. Injected so tests can drive
 *  redirects / bodies without a live network. Defaults to global
 *  `fetch`. The guard always calls this with `redirect: "manual"`. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Signature of the DNS resolver. Injected so tests can simulate
 *  DNS-rebinding (different answer per call). Returns the list of
 *  resolved IP literals for a hostname. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

/** Fired (best-effort) on every block with the structured reason +
 *  target. The handler wires the audit write; unit tests pass a spy. */
export type OnBlocked = (info: {
  reason: EgressBlockReason;
  target: string;
  mode: EgressMode;
}) => void;

export interface GuardedFetchOptions {
  authorizeUrl?: (url: URL) => Promise<void>;
  retryConnectionFailures?: boolean;
  streamResponse?: boolean;
  mode: EgressMode;
  /** For `mode:"backend"`: the exact set of hostnames the configured
   *  provider chain may reach (SearXNG URL host ∪ DDG hosts ∪ selected
   *  BYOK provider host). Case-insensitive exact match. Ignored in
   *  `mode:"read"`. */
  allowedHosts?: readonly string[];
  /** Max redirects to follow before blocking. Default 3. */
  maxRedirects?: number;
  /** Max response body size in bytes. Default 5 MiB. */
  maxBodyBytes?: number;
  /** Overall timeout in ms. Default 15_000. */
  timeoutMs?: number;
  /** Injected transport (defaults to global fetch). */
  fetchImpl?: FetchLike;
  /** Injected DNS resolver (defaults to node:dns/promises lookup). */
  resolveHost?: ResolveHost;
  /** Block audit hook. */
  onBlocked?: OnBlocked;
}

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

// ── IP classification ───────────────────────────────────────────────

/** Parse a dotted-quad IPv4 into its four octets, or null if malformed.
 *
 *  Exported for `src/mcp/target-guard.ts`, which needs the same
 *  byte-level view of an address to evaluate CIDR allowlist entries.
 *  Re-implementing it there would give the MCP guard a second, drifting
 *  parser for the exact addresses this one classifies. */
export function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return octets as [number, number, number, number];
}

/**
 * Is this IP literal one we must NEVER connect to from the host? Covers
 * loopback, RFC-1918 private ranges, link-local (incl. the cloud
 * metadata address 169.254.169.254), unspecified (0.0.0.0 / ::),
 * carrier-grade NAT, benchmark (198.18.0.0/15), multicast (224.0.0.0/4,
 * ff00::/8), reserved (240.0.0.0/4 incl. broadcast), and IPv6 loopback /
 * unique-local (fc00::/7, which includes the `fd00:ec2::254` metadata
 * address) / link-local / IPv4-mapped forms of every blocked v4 range.
 */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isBlockedIpv4(ip);
  if (v === 6) return isBlockedIpv6(ip);
  // Not a parseable IP literal — fail closed.
  return true;
}

function isBlockedIpv4(ip: string): boolean {
  const o = parseIpv4(ip);
  if (!o) return true;
  const [a, b] = o;
  // 0.0.0.0/8 — "this network" / unspecified.
  if (a === 0) return true;
  // 10.0.0.0/8 — private.
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback.
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (incl. 169.254.169.254 metadata).
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — private.
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — private.
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 — carrier-grade NAT (RFC 6598).
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 198.18.0.0/15 — benchmark networks (RFC 2544).
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved (incl. the
  // 255.255.255.255 broadcast) — never a unicast web host.
  if (a >= 224) return true;
  return false;
}

/**
 * Parse an IPv6 literal (already lowercased + bracket-stripped, and known
 * valid per `node:net.isIP`) to its 16 bytes, or null if our parser can't
 * — callers fail CLOSED on null. Handles `::` zero-compression and an
 * embedded dotted-quad in the low 32 bits (e.g. `::ffff:127.0.0.1`).
 *
 * Exported for `src/mcp/target-guard.ts` — see `parseIpv4` above for why
 * the MCP guard borrows these primitives instead of growing its own.
 */
export function ipv6ToBytes(ip: string): number[] | null {
  let s = ip;
  let v4: number[] | null = null;
  const dot = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dot) {
    const o = dot[2]!.split(".").map(Number);
    if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    v4 = o;
    s = dot[1]!.replace(/:$/, ""); // drop the ':' before the embedded v4
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (g: string): number[] | null => {
    if (g === "") return [];
    const out: number[] = [];
    for (const h of g.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const head = groups(halves[0] ?? "");
  if (head === null) return null;
  let tail: number[] = [];
  if (halves.length === 2) {
    const t = groups(halves[1] ?? "");
    if (t === null) return null;
    tail = t;
  }
  const v4Hextets = v4 ? 2 : 0;
  const present = head.length + tail.length + v4Hextets;
  let hextets: number[];
  if (halves.length === 2) {
    const fill = 8 - present;
    if (fill < 1) return null;
    hextets = [...head, ...new Array(fill).fill(0), ...tail];
  } else {
    if (present !== 8) return null;
    hextets = [...head, ...tail];
  }
  const bytes: number[] = [];
  for (const g of hextets) bytes.push((g >> 8) & 0xff, g & 0xff);
  if (v4) bytes.push(...v4);
  return bytes.length === 16 ? bytes : null;
}

/**
 * Block an IPv6 literal that maps to a non-routable / internal target.
 * Beyond native IPv6 private ranges this also classifies the EMBEDDED v4
 * of every v4↔v6 transition encoding (v4-mapped `::ffff:x`, deprecated
 * v4-compatible `::x`, 6to4 `2002::/16`, NAT64 `64:ff9b::/96`) so a
 * loopback/metadata address can't be smuggled in as e.g. `::ffff:7f00:1`,
 * `2002:7f00:1::`, or `64:ff9b::7f00:1`. Transition forms wrapping a
 * PUBLIC v4 are left allowed (only the embedded-private case is blocked),
 * so no legitimate address is over-blocked. Fails CLOSED on parse failure.
 */
function isBlockedIpv6(ip: string): boolean {
  const b = ipv6ToBytes(ip.toLowerCase().replace(/^\[|\]$/g, ""));
  if (!b) return true;
  const v4 = (i: number) => `${b[i]}.${b[i + 1]}.${b[i + 2]}.${b[i + 3]}`;
  // :: unspecified and ::1 loopback.
  if (b.slice(0, 15).every((x) => x === 0) && (b[15] === 0 || b[15] === 1)) return true;
  // v4-mapped ::ffff:0:0/96 — classify the embedded v4.
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedIpv4(v4(12));
  }
  // v4-compatible ::/96 (deprecated, RFC 4291) — embedded v4.
  if (b.slice(0, 12).every((x) => x === 0)) return isBlockedIpv4(v4(12));
  // 6to4 2002::/16 — embedded v4 sits in bytes 2-5.
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedIpv4(v4(2));
  // NAT64 64:ff9b::/96 — embedded v4 in the low 32 bits.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return isBlockedIpv4(v4(12));
  }
  // fc00::/7 — unique-local (incl. fd00:ec2::254, the AWS IPv6 metadata addr).
  if ((b[0]! & 0xfe) === 0xfc) return true;
  // fe80::/10 — link-local.
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true;
  // fec0::/10 — deprecated site-local (RFC 3879).
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return true;
  // ff00::/8 — multicast.
  if (b[0] === 0xff) return true;
  return false;
}

// ── DNS resolution + pinning ────────────────────────────────────────

export const defaultResolveHost: ResolveHost = async (hostname) => {
  // If the host is already an IP literal, return it verbatim (no lookup).
  if (isIP(hostname) !== 0) return [hostname];
  const records = await dnsLookup(hostname, { all: true });
  return records.map((r) => r.address);
};

/**
 * Resolve `hostname` to IPs and ensure ALL of them are public. Returns
 * EVERY validated IP, in resolution order — the caller pins the first
 * and fails over to the rest (see `connectPinned`). Throws
 * `EgressBlockedError` (reason `private-ip` or `no-address`) otherwise.
 *
 * We require EVERY resolved address to be public (not just the one we
 * pin) so a hostname that resolves to a mix of public + private can't be
 * used to smuggle an internal target through round-robin DNS. That same
 * all-must-be-public rule is what makes failing over to a later address
 * safe: every candidate has already cleared the block-list.
 */
async function resolveAndValidate(
  hostname: string,
  resolve: ResolveHost,
): Promise<string[]> {
  let ips: string[];
  try {
    ips = await resolve(hostname);
  } catch {
    throw new EgressBlockedError("no-address", hostname, `DNS resolution failed for ${hostname}`);
  }
  if (ips.length === 0) {
    throw new EgressBlockedError("no-address", hostname, `No address for ${hostname}`);
  }
  for (const ip of ips) {
    if (isBlockedIp(ip)) {
      throw new EgressBlockedError("private-ip", `${hostname} → ${ip}`);
    }
  }
  return ips;
}

// ── Main guarded fetch ──────────────────────────────────────────────

function normalizeHost(h: string): string {
  return h.toLowerCase().replace(/^\[|\]$/g, "");
}

/**
 * SSRF-guarded fetch. Resolves + validates the host, pins the connection
 * to the validated IP, follows redirects manually (re-validating each
 * hop), and caps redirects / body / time. Returns a `Response` whose
 * body has already been validated to be within `maxBodyBytes`.
 */
export async function guardedFetch(
  rawUrl: string,
  init: RequestInit,
  opts: GuardedFetchOptions,
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  const resolveHost = opts.resolveHost ?? defaultResolveHost;
  const allowed = new Set((opts.allowedHosts ?? []).map(normalizeHost));

  const block = (reason: EgressBlockReason, target: string, message?: string): never => {
    opts.onBlocked?.({ reason, target, mode: opts.mode });
    throw new EgressBlockedError(reason, target, message);
  };

  const deadline = Date.now() + timeoutMs;
  let currentUrl = rawUrl;
  const resolve: ResolveHost = hostname => withinDeadline(resolveHost(hostname), deadline, () => block("timeout", currentUrl, "DNS resolution exceeded deadline"));

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return block("scheme", currentUrl, `Malformed URL: ${currentUrl}`);
    }

    // Scheme gate — only http(s). Blocks file:, data:, gopher:, ftp:, …
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return block("scheme", currentUrl, `Blocked scheme: ${parsed.protocol}`);
    }

    const host = normalizeHost(parsed.hostname);
    await withinDeadline(opts.authorizeUrl?.(parsed) ?? Promise.resolve(), deadline, () => block("timeout", currentUrl, "Network authorization exceeded deadline"));

    // `mode:"backend"` — allowlist the host. The configured SearXNG
    // internal host is sanctioned here (it's in `allowedHosts`), but the
    // connection below is still IP-pinned.
    if (opts.mode === "backend" && !allowed.has(host)) {
      return block("host-not-allowed", currentUrl, `Backend host not allowed: ${host}`);
    }

    // Resolve + validate, then pin the connection to the validated IP.
    // In `mode:"read"` this rejects any private/internal IP. In
    // `mode:"backend"` it ALSO IP-pins the sanctioned SearXNG host: the
    // allowlist authorized the host string, but a DNS answer that
    // resolves to an unexpected internal address is still rejected
    // UNLESS the configured host is itself an internal sidecar. For the
    // sanctioned-internal case the caller passes the SearXNG host in
    // `allowedHosts` AND we skip the private-IP rejection for backend
    // mode (the host string is the trust anchor); we still PIN so the
    // fetch can't be rebound away from the resolved address mid-flight.
    // Candidate addresses, in resolution order. We pin the first and fail
    // over to the rest if it won't connect — see `connectPinned`.
    let pinnedIps: string[];
    if (opts.mode === "read") {
      try {
        pinnedIps = await resolveAndValidate(host, resolve);
      } catch (err) {
        if (err instanceof EgressBlockedError) {
          return block(err.reason, err.target, err.message);
        }
        throw err;
      }
    } else {
      // backend: resolve (for pinning) but don't reject internal IPs —
      // the host allowlist is the security boundary here.
      let ips: string[];
      try {
        ips = await resolve(host);
      } catch {
        return block("no-address", host, `DNS resolution failed for ${host}`);
      }
      if (ips.length === 0) return block("no-address", host, `No address for ${host}`);
      pinnedIps = ips;
    }

    if (Date.now() >= deadline) {
      return block("timeout", currentUrl, `Egress timed out before connect`);
    }

    const headers = new Headers(init.headers ?? {});
    for (const key of headers.keys()) if (["host", "connection", "content-length", "transfer-encoding", "upgrade", "te", "trailer", "keep-alive", "proxy-authorization", "proxy-authenticate", "proxy-connection"].includes(key)) return block("host-not-allowed", currentUrl, "Transport headers must be managed by the host");
    headers.set("host", parsed.host);

    let res: Response;
    try {
      res = await connectPinned({
        parsed,
        pinnedIps,
        init,
        headers,
        fetchImpl,
        deadline,
        retryConnectionFailures: opts.retryConnectionFailures,
      });
    } catch (err) {
      if (err instanceof EgressTimeoutError) {
        return block("timeout", currentUrl, `Egress timed out`);
      }
      throw err;
    }

    // Redirect? Re-validate the next hop (defeats redirect-to-internal).
    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      if (hop >= maxRedirects) {
        return block("redirect-limit", currentUrl, `Redirect limit (${maxRedirects}) exceeded`);
      }
      const location = res.headers.get("location")!;
      currentUrl = new URL(location, currentUrl).toString();
      void res.body?.cancel().catch(() => {});
      continue;
    }

    // Terminal response — enforce body-size cap.
    const tooLarge = () => block("body-too-large", currentUrl, `Response body exceeds ${maxBodyBytes} bytes`);
    const tooSlow = () => block("timeout", currentUrl, "Response body exceeded deadline");
    if (opts.streamResponse) return boundedBodyStream(res, maxBodyBytes, deadline, tooLarge, tooSlow);
    return await enforceBodyCap(res, maxBodyBytes, tooLarge, deadline, tooSlow);
  }

  // Unreachable: the loop either returns or blocks on redirect-limit.
  return block("redirect-limit", currentUrl, `Redirect limit (${maxRedirects}) exceeded`);
}

/** Internal marker: the shared egress deadline elapsed mid-connect.
 *  Translated by the caller into a `timeout` block (which is what fires
 *  the `onBlocked` audit hook) — never escapes this module. */
class EgressTimeoutError extends Error {}

/**
 * Whether `init.body` can be re-sent on a failover attempt. Strings and
 * byte buffers can; a ReadableStream is consumed by the first attempt
 * and must not be retried. Search providers send JSON strings (or no
 * body at all), so failover is available on every real call path.
 */
function isReplayableBody(body: RequestInit["body"]): boolean {
  if (body === null || body === undefined) return true;
  return typeof body === "string" || ArrayBuffer.isView(body) || body instanceof ArrayBuffer;
}

/**
 * Connect to the first candidate address that accepts the connection,
 * preserving the Host header for virtual hosting and naming the original
 * hostname as the TLS server name, so the certificate is verified against the
 * hostname and never against the pinned IP. (Bun 1.3.14 took the server name
 * from the Host header; Bun 1.4 takes it from the URL, which is the IP here.)
 *
 * Why failover instead of pinning `ips[0]` only: `dnsLookup(…, {all:true})`
 * on a dual-stack host returns `::1` before `127.0.0.1` for `localhost`,
 * so a sidecar published on IPv4 only (the compose SearXNG service) was
 * unreachable — the guard pinned `[::1]`, got connection-refused, and the
 * caller silently fell back to its secondary provider. A plain `fetch`
 * hides this by happy-eyeballing to the next address; pinning removed
 * that, so we re-implement it explicitly over the SAME validated set.
 *
 * Security: every candidate came from `resolveAndValidate` (read mode —
 * all addresses proven public) or the allowlisted backend host, so trying
 * a later address can never reach a target the first one couldn't. The
 * connection is still pinned to a resolved IP, so DNS rebinding between
 * validation and connect remains impossible.
 *
 * Only CONNECTION failures advance to the next candidate. A timeout
 * (shared deadline) and any HTTP response — including 4xx/5xx — stop
 * immediately: those mean we reached the host.
 */
async function connectPinned(args: {
  parsed: URL;
  pinnedIps: string[];
  init: RequestInit;
  headers: Headers;
  fetchImpl: FetchLike;
  deadline: number;
  retryConnectionFailures?: boolean;
}): Promise<Response> {
  const { parsed, pinnedIps, init, headers, fetchImpl, deadline } = args;
  // Merged into any TLS options the caller set (a private CA, for instance); the hostname always wins.
  const callerTls = (init as RequestInit & { tls?: Record<string, unknown> }).tls;
  const tls = parsed.protocol === "https:" ? { tls: { ...callerTls, serverName: parsed.hostname } } : {};
  const candidates = args.retryConnectionFailures !== false && isReplayableBody(init.body)
    ? pinnedIps
    : pinnedIps.slice(0, 1);

  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const ip = candidates[i]!;
    const ipLiteral = isIP(ip) === 6 ? `[${ip}]` : ip;
    const pinnedUrl = new URL(parsed.toString());
    pinnedUrl.hostname = ipLiteral;

    const controller = new AbortController();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new EgressTimeoutError();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      return await fetchImpl(pinnedUrl.toString(), {
        ...init,
        ...tls,
        headers,
        redirect: "manual",
        signal: init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw new EgressTimeoutError();
      if (init.signal?.aborted) throw err;
      lastErr = err;
      // Connection failure — try the next resolved address, if any.
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Read the body with a hard byte cap. Prefers a streaming read (so a
 * huge body is aborted early); falls back to a buffered read +
 * length-check when the body isn't a readable stream (e.g. a mocked
 * Response in tests). Returns a fresh `Response` carrying the validated
 * bytes + original status/headers.
 */
async function enforceBodyCap(
  res: Response,
  maxBytes: number,
  onTooLarge: () => never,
  deadline: number,
  onTimeout: () => never,
): Promise<Response> {
  // Fast reject via Content-Length when present + trustworthy.
  const cl = res.headers.get("content-length");
  if (cl !== null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) onTooLarge();
  }

  const body = res.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      let next: Awaited<ReturnType<typeof reader.read>>;
      try { next = await withinDeadline(reader.read(), deadline, onTimeout); }
      catch (error) { void reader.cancel().catch(() => {}); throw error; }
      const { done, value } = next;
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          onTooLarge();
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.byteLength;
    }
    return new Response(merged, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  // No streamable body (mocked Response) — buffer + check.
  const buf = await withinDeadline(res.arrayBuffer(), deadline, onTimeout);
  if (buf.byteLength > maxBytes) onTooLarge();
  return new Response([101, 204, 205, 304].includes(res.status) ? null : buf, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

async function withinDeadline<Value>(pending: Promise<Value>, deadline: number, onTimeout: () => never): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { try { onTimeout(); } catch (error) { reject(error); } }, Math.max(1, deadline - Date.now())); })]);
  } finally { clearTimeout(timer); }
}

export function guardedStreamingFetch(rawUrl: string, init: RequestInit, options: GuardedFetchOptions): Promise<Response> {
  return guardedFetch(rawUrl, init, { ...options, streamResponse: true });
}

function boundedBodyStream(response: Response, maximumBytes: number, deadline: number, tooLarge: () => never, tooSlow: () => never): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  let total = 0;
  let timer: ReturnType<typeof setTimeout>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { timer = setTimeout(() => { try { tooSlow(); } catch (error) { controller.error(error); } void reader.cancel().catch(() => {}); }, Math.max(1, deadline - Date.now())); },
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { clearTimeout(timer); controller.close(); return; }
        total += next.value.byteLength;
        if (total > maximumBytes) tooLarge();
        controller.enqueue(next.value);
      } catch (error) { clearTimeout(timer); controller.error(error); await reader.cancel().catch(() => {}); }
    },
    async cancel(reason) { clearTimeout(timer); await reader.cancel(reason); },
  });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}
