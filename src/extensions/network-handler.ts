/**
 * Host-side `ezcorp/network.internal` reverse-RPC handler.
 *
 * The in-sandbox fetch wrapper (sandbox-preload.ts) routes requests to
 * `localhost`, RFC-1918, link-local, and other internal hosts here so
 * the host PDP can SSRF-gate them. The wrapper itself can't enforce on
 * internal hosts — its env-var allowlist is for external hosts; an
 * extension that smuggles `localhost:5432` past the wrapper would
 * otherwise reach the host's Postgres.
 *
 * Phase 2 contract:
 *   - PDP gate via `engine.authorize` with a `network` capability whose
 *     `value` is the lowercased hostname. Manifests must declare the
 *     specific internal host (e.g. `localhost`) to reach it.
 *   - Host performs the fetch. The body is base64-encoded, capped at
 *     10MB. Headers are flattened to `Record<string,string>`. Streaming
 *     is Phase 3 (chunked-frame transport in json-rpc.ts).
 *   - Errors are returned as JSON-RPC error envelopes with stable codes:
 *       -32602  invalid params (missing/invalid url)
 *       -32001  permission denied (PDP returned `deny`)
 *       -32000  upstream / size-cap / unexpected
 */

import type { JsonRpcRequest, JsonRpcResponse } from "./types";
import type { PermissionEngine } from "./permission-engine";
import type { ExtensionRegistry } from "./registry";
// Single source of truth for "internal host" — shared with the
// in-sandbox fetch wrapper. Pre-extraction drift bug (M1, reviewer C1):
// this module's lowercase-only normalization disagreed with the
// wrapper's bracket-strip on `[::1]`-shaped IPv6 inputs.
import { isInternalHost as _isInternalHost, normalizeHostname } from "./runtime/internal-host";

const TEN_MB = 10 * 1024 * 1024;
const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface NetworkInternalContext {
  extensionId: string;
  conversationId: string;
  userId: string;
  engine: PermissionEngine;
  registry: ExtensionRegistry;
}

/**
 * Test-only seam: the test file injects a stub fetch so we don't have
 * to spin a real localhost server for every assertion. Production
 * leaves this `undefined` and the handler uses the global `fetch`.
 */
export interface NetworkInternalDeps {
  fetchImpl?: typeof fetch;
}

interface InternalRpcParams {
  url?: unknown;
  init?: {
    method?: unknown;
    headers?: unknown;
    body?: unknown;
  };
}

interface InternalRpcResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export async function handleNetworkInternalRpc(
  req: JsonRpcRequest,
  ctx: NetworkInternalContext,
  deps: NetworkInternalDeps = {},
): Promise<JsonRpcResponse> {
  const params = (req.params ?? {}) as InternalRpcParams;

  if (typeof params.url !== "string") {
    return jsonRpcError(req.id, -32602, "Missing url");
  }

  let parsed: URL;
  try {
    parsed = new URL(params.url);
  } catch {
    return jsonRpcError(req.id, -32602, "Invalid url");
  }

  // Redirects are followed here, not by `fetch`, so the PDP gates every
  // hop: a granted host must not bounce the host-side fetch to a host
  // the extension holds no grant for.
  const fetchImpl = deps.fetchImpl ?? fetch;
  let url = parsed;
  let init = normalizeInit(params.init) ?? {};
  let resp: Response;
  for (let hop = 0; ; hop++) {
    // PDP gate. The wrapper-level call is currently `toolName: undefined`
    // (Phase 4 may revisit to attribute by tool). The engine reads the
    // extension's manifest network grant via `getGrantedPermissions`.
    const decision = await ctx.engine.authorize(
      {
        extensionId: ctx.extensionId,
        userId: ctx.userId,
        conversationId: ctx.conversationId,
      },
      // Use the SAME normalization the in-sandbox wrapper uses — strips
      // IPv6 `[...]` brackets that `URL.hostname` keeps. Pre-extraction
      // bug: PDP saw `[::1]` while the wrapper saw `::1`, so a manifest
      // declaring `network: ["::1"]` was denied at the host but allowed
      // at the wrapper level (which never reached this RPC because
      // wrapper-side classification matched and routed here). Keeping
      // both sides on the same value avoids the split-brain.
      [{ kind: "network", value: normalizeHostname(url.hostname) }],
    );

    if (decision.decision === "deny") {
      return jsonRpcError(
        req.id,
        -32001,
        `Network denied: ${decision.reason}`,
      );
    }

    // Perform fetch host-side.
    try {
      resp = await fetchImpl(hop === 0 ? params.url : url.href, { ...init, redirect: "manual" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonRpcError(req.id, -32000, `Upstream error: ${msg}`);
    }

    const location = REDIRECT_STATUSES.has(resp.status) ? resp.headers.get("location") : null;
    if (location === null) break;
    await resp.body?.cancel();
    if (hop === MAX_REDIRECTS) return jsonRpcError(req.id, -32000, "Upstream error: too many redirects");
    const next = URL.canParse(location, url.href) ? new URL(location, url) : null;
    if (!next || (next.protocol !== "http:" && next.protocol !== "https:")) {
      return jsonRpcError(req.id, -32000, "Upstream error: invalid redirect location");
    }
    init = redirectInit(init, resp.status, url, next);
    url = next;
  }

  // Read body up to the size cap. We materialize the full ArrayBuffer
  // here — Phase 3 will replace this with a chunked-frame transport so
  // a 10MB ceiling isn't a hard ceiling on response size.
  let buf: ArrayBuffer;
  try {
    buf = await resp.arrayBuffer();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonRpcError(req.id, -32000, `Body read error: ${msg}`);
  }

  if (buf.byteLength > TEN_MB) {
    return jsonRpcError(
      req.id,
      -32000,
      "Response exceeds 10MB internal-fetch cap",
    );
  }

  const headers: Record<string, string> = {};
  resp.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const result: InternalRpcResult = {
    status: resp.status,
    statusText: resp.statusText,
    headers,
    body: Buffer.from(buf).toString("base64"),
  };

  return { jsonrpc: "2.0", id: req.id, result };
}

/**
 * `isInternalHost(host)` — re-export of the canonical classifier from
 * `./runtime/internal-host.ts`. Same rule, same regex, same bracket
 * normalization as the in-sandbox wrapper. Pre-extraction this was a
 * local variant that did `.toLowerCase()` only — drift-prone. The
 * shared module guarantees both sides agree.
 *
 * Used for tests + future enforcement (an extension calling
 * `ezcorp/network.internal` for a non-internal host should be
 * rejected; Phase 2 leaves that to the PDP gate alone).
 */
export function isInternalHost(hostname: string): boolean {
  return _isInternalHost(hostname);
}

// ── Helpers ──────────────────────────────────────────────────────

function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * The wrapper sends a JSON-RPC-friendly `init` shape (string method,
 * plain-record headers, string body). Translate to a `RequestInit`
 * the host's `fetch` accepts. Anything we don't recognize is dropped.
 */
function normalizeInit(init: InternalRpcParams["init"]): RequestInit | undefined {
  if (!init || typeof init !== "object") return undefined;
  const out: RequestInit = {};
  if (typeof init.method === "string") out.method = init.method;
  if (init.headers && typeof init.headers === "object" && !Array.isArray(init.headers)) {
    out.headers = init.headers as Record<string, string>;
  }
  if (typeof init.body === "string") out.body = init.body;
  return out;
}

/**
 * The next hop's init, per the Fetch redirect rules: a 303 (or a 301/302
 * after a POST) becomes a body-less GET, and credentials are not sent to
 * a different origin.
 */
function redirectInit(init: RequestInit, status: number, from: URL, to: URL): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  const next: RequestInit = { ...init };
  if ((status === 303 && method !== "HEAD") || ((status === 301 || status === 302) && method === "POST")) {
    next.method = "GET";
    delete next.body;
  }
  if (from.origin !== to.origin && init.headers) {
    next.headers = Object.fromEntries(
      Object.entries(init.headers as Record<string, string>).filter(
        ([name]) => !["authorization", "cookie", "proxy-authorization"].includes(name.toLowerCase()),
      ),
    );
  }
  return next;
}
