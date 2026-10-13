/**
 * Host-side `ezcorp/fs.{read,write,list,stat,exists,mkdir,unlink}`
 * reverse-RPC handlers.
 *
 * The Phase 3 contract is: NOTHING in the extension subprocess touches
 * raw filesystem primitives. The sandbox-preload poisons `Bun.file`,
 * `Bun.write`, `Bun.glob`, `node:fs`, and `node:fs/promises`. Granted
 * filesystem access flows through these handlers, which:
 *
 *   1. Validate params (path, optional encoding, optional content,
 *      optional options).
 *   2. realpath BEFORE PDP authorize — so the cap value reflects the
 *      current resolution. If a symlink swaps to point at `/etc/passwd`
 *      between this realpath and the open(), we're reading what we
 *      authorized (the realpath'd string); if the swap happens BEFORE
 *      our realpath, the resolved path is `/etc/passwd` and authorize
 *      denies (the user's grant doesn't include it). Closes the TOCTOU
 *      window in the old `ezcorp/fs` path-check handler.
 *   3. PDP gate via `engine.authorize` with kind `fs.{read|write|list|stat}`,
 *      value = resolved-path. Audit row written by the engine.
 *   4. Host performs the IO using `node:fs/promises` (host doesn't run
 *      under sandbox-preload).
 *   5. For `read` results > STREAM_THRESHOLD: emit a chunked-frame
 *      response (256KB chunks, 100MB hard cap). For everything else:
 *      single-line JSON-RPC response.
 *
 * Path validation: prefix-match via `checkFilesystemPermission` is also
 * called as belt-and-braces because it owns the implicit "extension's
 * own install dir is allowed" rule. The authoritative gate, however,
 * is the PDP — if the manifest's per-tool `capabilities.filesystem.mode`
 * doesn't include the requested mode, the PDP denies even if the
 * prefix check would pass.
 *
 * Streaming format reuses the chunked-frame protocol added to
 * `./json-rpc.ts` in this same phase. The handler returns a
 * `StreamedResponse` envelope; `subprocess.ts:wireRequestHandler`
 * recognizes it and writes the frames verbatim.
 */

import { realpath, lstat } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import type { JsonRpcRequest, JsonRpcResponse } from "./types";
import type { PermissionEngine } from "./permission-engine";
import type { ExtensionRegistry } from "./registry";
import type { Capability } from "./capability-types";
import {
  checkFilesystemPermission,
  expandGrantPrefix,
  resolveGrantPrefixCanonical,
  isReservedSensitivePath,
  isGrantEscape,
  type FilesystemDenialKind,
  type FilesystemMode,
  type FilesystemPrefixCheck,
} from "./permissions";
import { denyAndDisable } from "./security";
import { AUDIT_PERM_DENIED } from "./audit-actions";
import { insertAuditEntry } from "../db/queries/audit-log";

// ── Constants (locked per spec) ────────────────────────────────────

/** Hard cap on a single fs operation's byte volume. */
export const MAX_BYTES_PER_OP = 100 * 1024 * 1024; // 100MB
/** Chunk size for streamed `read` responses. */
export const CHUNK_SIZE = 256 * 1024; // 256KB
/** Threshold above which a `read` result is streamed instead of single-line. */
export const STREAM_THRESHOLD = 1024 * 1024; // 1MB

// JSON-RPC error codes (consistent with network-handler.ts):
//   -32602  invalid params (missing/malformed)
//   -32001  permission denied (PDP returned `deny` OR prefix check failed
//                              OR per-tool manifest mode mismatch)
//   -32000  upstream error (filesystem I/O, size cap, etc.)
//   -32603  internal — registry-not-found / wiring failure

/**
 * Per-tool mode narrowing (M5).
 *
 * The SDK helpers (`@ezcorp/sdk/runtime/fs.fsRead/...`) forward the
 * active tool name from `getToolContext()` as `_toolName` in the RPC
 * params. The host looks up the manifest tool's
 * `capabilities.filesystem.mode` array and denies when the requested
 * mode (read for read/list/stat/exists; write for write/mkdir/unlink)
 * isn't declared.
 *
 * Resolution rules:
 *   • `_toolName` absent → no narrowing (legacy callers, raw RPC,
 *      or extensions that don't go through the SDK helper).
 *   • `_toolName` present + matching tool found:
 *       - tool has no `capabilities.filesystem` declaration → no
 *         narrowing (extension-wide grant applies).
 *       - tool's mode array includes requested mode → allow.
 *       - tool's mode array EXCLUDES requested mode → deny -32001
 *         with a "mode" reason.
 *   • `_toolName` present but no matching tool in manifest → no
 *     narrowing (defensive — bad ext-author input shouldn't crash).
 */
function checkToolMode(
  registry: ExtensionRegistry,
  extensionId: string,
  toolName: string | undefined,
  requested: FilesystemMode,
): { ok: true } | { ok: false; reason: string } {
  if (!toolName) return { ok: true };
  const manifest = registry.getManifest(extensionId);
  if (!manifest?.tools) return { ok: true };
  const tool = manifest.tools.find((t) => t.name === toolName);
  if (!tool) return { ok: true };
  const fsDecl = tool.capabilities?.filesystem;
  if (!fsDecl) return { ok: true };
  if (!fsDecl.mode.includes(requested)) {
    return {
      ok: false,
      reason: `tool "${toolName}" capabilities.filesystem.mode does not include "${requested}"`,
    };
  }
  return { ok: true };
}

// ── Types ──────────────────────────────────────────────────────────

export interface FsHandlerContext {
  serviceInvocation?: import("./service-invocation").ServiceInvocation;
  extensionId: string;
  conversationId: string;
  userId: string;
  engine: PermissionEngine;
  registry: ExtensionRegistry;
}

/**
 * Streamed response envelope. `wireRequestHandler` (in subprocess.ts)
 * recognizes this shape and writes the frames verbatim instead of
 * JSON-encoding them as a normal response. Frames already include
 * their `\n` terminator.
 */
export interface StreamedResponse {
  streamed: true;
  frames: readonly string[];
}

export type FsRpcResponse = JsonRpcResponse | StreamedResponse;

// ── Public handlers ────────────────────────────────────────────────

export async function handleFsReadRpc(
  req: JsonRpcRequest,
  ctx: FsHandlerContext,
): Promise<FsRpcResponse> {
  const params = (req.params ?? {}) as {
    path?: unknown;
    encoding?: unknown;
    _toolName?: unknown;
  };
  if (typeof params.path !== "string" || params.path.length === 0) {
    return rpcError(req.id, -32602, "Missing path");
  }
  const encoding =
    params.encoding === "binary" || params.encoding === "utf-8"
      ? params.encoding
      : "utf-8";
  const toolName = typeof params._toolName === "string" ? params._toolName : undefined;
  const modeCheck = checkToolMode(ctx.registry, ctx.extensionId, toolName, "read");
  if (!modeCheck.ok) {
    return rpcError(req.id, -32001, `Filesystem access denied: ${modeCheck.reason}`);
  }

  const gate = await gatePath(ctx, params.path, "read", "fs.read");
  if ("error" in gate) return jsonError(req.id, gate.error.code, gate.error.message);

  let bytes: Uint8Array;
  try {
    const buf = await fs.readFile(gate.resolvedPath);
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (e) {
    return jsonError(req.id, -32000, ioErrorMsg("read", e));
  }
  if (bytes.byteLength > MAX_BYTES_PER_OP) {
    return jsonError(
      req.id,
      -32000,
      `Read exceeds ${MAX_BYTES_PER_OP / (1024 * 1024)}MB cap (${bytes.byteLength} bytes)`,
    );
  }

  const body = Buffer.from(bytes).toString("base64");
  const result = {
    encoding,
    body,
    bytes: bytes.byteLength,
    resolvedPath: gate.resolvedPath,
  };

  // Small responses use the legacy single-line format. Streaming
  // applies only above STREAM_THRESHOLD.
  if (bytes.byteLength <= STREAM_THRESHOLD) {
    return rpcResult(req.id, result);
  }

  // Streaming: build the JSON wire string for the full response and
  // chunk it. Each chunk is base64-encoded (CHUNK_SIZE raw bytes →
  // ~CHUNK_SIZE * 4/3 base64 chars). The transport extension on the
  // SDK side reassembles + parses.
  const wire = JSON.stringify({ jsonrpc: "2.0", id: req.id, result });
  const frames = buildStreamingFrames(req.id, wire);
  return { streamed: true, frames };
}

export async function handleFsWriteRpc(
  req: JsonRpcRequest,
  ctx: FsHandlerContext,
): Promise<FsRpcResponse> {
  const params = (req.params ?? {}) as {
    path?: unknown;
    content?: unknown;
    encoding?: unknown;
    _toolName?: unknown;
  };
  if (typeof params.path !== "string" || params.path.length === 0) {
    return rpcError(req.id, -32602, "Missing path");
  }
  if (typeof params.content !== "string") {
    return rpcError(req.id, -32602, "Missing content (string)");
  }
  const encoding =
    params.encoding === "binary" || params.encoding === "utf-8"
      ? params.encoding
      : "utf-8";
  const toolName = typeof params._toolName === "string" ? params._toolName : undefined;
  const modeCheck = checkToolMode(ctx.registry, ctx.extensionId, toolName, "write");
  if (!modeCheck.ok) {
    return rpcError(req.id, -32001, `Filesystem access denied: ${modeCheck.reason}`);
  }

  // Decode the content to bytes for the size-cap check.
  let bytes: Uint8Array;
  try {
    if (encoding === "binary") {
      bytes = new Uint8Array(Buffer.from(params.content, "base64"));
    } else {
      bytes = new TextEncoder().encode(params.content);
    }
  } catch (e) {
    return rpcError(req.id, -32602, `Failed to decode content: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (bytes.byteLength > MAX_BYTES_PER_OP) {
    return rpcError(
      req.id,
      -32000,
      `Write exceeds ${MAX_BYTES_PER_OP / (1024 * 1024)}MB cap (${bytes.byteLength} bytes)`,
    );
  }

  // For writes, the path may not exist yet — `realpath` would throw.
  // We resolve the PARENT directory's realpath, append the basename,
  // and use that as the cap value. The handler then opens via the
  // resolved string, sidestepping the symlink swap window.
  const writeGate = await gateWritePath(ctx, params.path);
  if ("error" in writeGate) return jsonError(req.id, writeGate.error.code, writeGate.error.message);

  try {
    await fs.writeFile(writeGate.resolvedPath, bytes);
  } catch (e) {
    return jsonError(req.id, -32000, ioErrorMsg("write", e));
  }

  return rpcResult(req.id, {
    bytes: bytes.byteLength,
    resolvedPath: writeGate.resolvedPath,
  });
}

export async function handleFsListRpc(
  req: JsonRpcRequest,
  ctx: FsHandlerContext,
): Promise<FsRpcResponse> {
  const params = (req.params ?? {}) as { path?: unknown; _toolName?: unknown };
  if (typeof params.path !== "string" || params.path.length === 0) {
    return rpcError(req.id, -32602, "Missing path");
  }
  const toolName = typeof params._toolName === "string" ? params._toolName : undefined;
  const modeCheck = checkToolMode(ctx.registry, ctx.extensionId, toolName, "read");
  if (!modeCheck.ok) {
    return rpcError(req.id, -32001, `Filesystem access denied: ${modeCheck.reason}`);
  }
  const gate = await gatePath(ctx, params.path, "read", "fs.list");
  if ("error" in gate) return jsonError(req.id, gate.error.code, gate.error.message);

  let entries: Array<{ name: string; isFile: boolean; isDirectory: boolean }>;
  try {
    const dirents = await fs.readdir(gate.resolvedPath, { withFileTypes: true });
    entries = dirents.map((d) => ({
      name: d.name,
      isFile: d.isFile(),
      isDirectory: d.isDirectory(),
    }));
  } catch (e) {
    // ENOTDIR → caller passed a file. Surface as -32602.
    if (isNodeErrno(e) && (e as NodeJS.ErrnoException).code === "ENOTDIR") {
      return jsonError(req.id, -32602, `Path is not a directory: ${gate.resolvedPath}`);
    }
    return jsonError(req.id, -32000, ioErrorMsg("list", e));
  }

  return rpcResult(req.id, { entries, resolvedPath: gate.resolvedPath });
}

export async function handleFsStatRpc(
  req: JsonRpcRequest,
  ctx: FsHandlerContext,
): Promise<FsRpcResponse> {
  const params = (req.params ?? {}) as { path?: unknown; _toolName?: unknown };
  if (typeof params.path !== "string" || params.path.length === 0) {
    return rpcError(req.id, -32602, "Missing path");
  }
  const toolName = typeof params._toolName === "string" ? params._toolName : undefined;
  const modeCheck = checkToolMode(ctx.registry, ctx.extensionId, toolName, "read");
  if (!modeCheck.ok) {
    return rpcError(req.id, -32001, `Filesystem access denied: ${modeCheck.reason}`);
  }
  const gate = await gatePath(ctx, params.path, "read", "fs.stat");
  if ("error" in gate) return jsonError(req.id, gate.error.code, gate.error.message);

  try {
    const s = await fs.stat(gate.resolvedPath);
    return rpcResult(req.id, {
      size: s.size,
      mtimeMs: s.mtimeMs,
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
      resolvedPath: gate.resolvedPath,
    });
  } catch (e) {
    return jsonError(req.id, -32000, ioErrorMsg("stat", e));
  }
}

export async function handleFsExistsRpc(
  req: JsonRpcRequest,
  ctx: FsHandlerContext,
): Promise<FsRpcResponse> {
  const params = (req.params ?? {}) as { path?: unknown; _toolName?: unknown };
  if (typeof params.path !== "string" || params.path.length === 0) {
    return rpcError(req.id, -32602, "Missing path");
  }
  const toolName = typeof params._toolName === "string" ? params._toolName : undefined;
  const modeCheck = checkToolMode(ctx.registry, ctx.extensionId, toolName, "read");
  if (!modeCheck.ok) {
    return rpcError(req.id, -32001, `Filesystem access denied: ${modeCheck.reason}`);
  }
  // For `exists`, the path may not exist (that's the question). We
  // gate on the PARENT'S realpath so the cap value is meaningful even
  // when the target itself is absent. This is intentionally NOT a
  // permission leak: the caller still must hold a grant covering the
  // parent path.
  const gate = await gateExistsPath(ctx, params.path);
  if ("error" in gate) return jsonError(req.id, gate.error.code, gate.error.message);

  try {
    await fs.access(gate.targetPath);
    return rpcResult(req.id, { exists: true, resolvedPath: gate.resolvedParent });
  } catch {
    return rpcResult(req.id, { exists: false, resolvedPath: gate.resolvedParent });
  }
}

export async function handleFsMkdirRpc(
  req: JsonRpcRequest,
  ctx: FsHandlerContext,
): Promise<FsRpcResponse> {
  const params = (req.params ?? {}) as {
    path?: unknown;
    recursive?: unknown;
    _toolName?: unknown;
  };
  if (typeof params.path !== "string" || params.path.length === 0) {
    return rpcError(req.id, -32602, "Missing path");
  }
  const recursive = params.recursive === true;
  const toolName = typeof params._toolName === "string" ? params._toolName : undefined;
  const modeCheck = checkToolMode(ctx.registry, ctx.extensionId, toolName, "write");
  if (!modeCheck.ok) {
    return rpcError(req.id, -32001, `Filesystem access denied: ${modeCheck.reason}`);
  }

  const gate = await gateWritePath(ctx, params.path);
  if ("error" in gate) return jsonError(req.id, gate.error.code, gate.error.message);

  try {
    await fs.mkdir(gate.resolvedPath, { recursive });
    return rpcResult(req.id, { resolvedPath: gate.resolvedPath, created: true });
  } catch (e) {
    if (isNodeErrno(e) && (e as NodeJS.ErrnoException).code === "EEXIST" && !recursive) {
      return jsonError(req.id, -32000, `Directory already exists: ${gate.resolvedPath}`);
    }
    return jsonError(req.id, -32000, ioErrorMsg("mkdir", e));
  }
}

export async function handleFsUnlinkRpc(
  req: JsonRpcRequest,
  ctx: FsHandlerContext,
): Promise<FsRpcResponse> {
  const params = (req.params ?? {}) as { path?: unknown; _toolName?: unknown };
  if (typeof params.path !== "string" || params.path.length === 0) {
    return rpcError(req.id, -32602, "Missing path");
  }
  const toolName = typeof params._toolName === "string" ? params._toolName : undefined;
  const modeCheck = checkToolMode(ctx.registry, ctx.extensionId, toolName, "write");
  if (!modeCheck.ok) {
    return rpcError(req.id, -32001, `Filesystem access denied: ${modeCheck.reason}`);
  }

  // POSIX `unlink(2)` removes the link, not the target. We MUST NOT
  // realpath the leaf — that would resolve a symlink to its target and
  // unlink the target instead. Instead:
  //   1. lstat the leaf to confirm something exists at that path
  //      (without following symlinks).
  //   2. gateWritePath the PARENT (realpath the directory only) so the
  //      grant check is anchored to a canonical parent.
  //   3. fs.unlink(originalLeafPath) — operates on the link itself.
  //
  // This is the M1 fix (validator should-fix #1, lifted from
  // deferred-items into Phase 3). Pre-fix an extension calling
  // `fsUnlink("/grant/link")` where `/grant/link → /etc/critical`
  // (and `/etc/critical` happens to be in grant) would unlink
  // `/etc/critical` instead of the link.
  const requestedPath = params.path;
  const inputPath = requestedPath;

  // 1) Verify the leaf exists via lstat (NOT realpath).
  try {
    await lstat(inputPath);
  } catch {
    return jsonError(req.id, -32000, `ENOENT: no such file or directory: ${inputPath}`);
  }

  // 2) Gate on the parent directory's realpath. Build a synthetic
  //    "<resolvedParent>/<leaf-basename>" target so the grant prefix
  //    check is canonical without resolving the leaf symlink.
  const parentPath = dirname(inputPath);
  const leaf = basename(inputPath);
  let parentReal: string;
  try {
    parentReal = await realpath(parentPath);
  } catch {
    return jsonError(req.id, -32000, `ENOENT: parent does not exist: ${parentPath}`);
  }
  const linkTarget = join(parentReal, leaf);

  const granted = ctx.registry.getGrantedPermissions(ctx.extensionId);
  const installPath = ctx.registry.getInstallPath(ctx.extensionId);
  if (!granted || !installPath) {
    return jsonError(req.id, -32603, "Extension not found in registry");
  }
  const check = await checkPrefixForWrite(linkTarget, granted.filesystem ?? [], installPath, ctx.userId);
  if (!check.allowed) {
    const refusal = await refuseFs(ctx, check.denial, "unlink", requestedPath, linkTarget);
    return jsonError(req.id, refusal.error.code, refusal.error.message);
  }

  // PDP gate — kind=fs.write (unlink is a write-side op).
  const cap: Capability = { kind: "fs.write", value: linkTarget };
  const decision = await ctx.engine.authorize(
    {
      extensionId: ctx.extensionId,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
    },
    [cap],
  );
  if (decision.decision === "deny") {
    return jsonError(req.id, -32001, `Filesystem access denied: ${decision.reason}`);
  }

  // 3) Unlink the LINK (not the target). Pass the original input path
  //    so a symlink resolves to itself, not its target.
  try {
    await fs.unlink(inputPath);
    return rpcResult(req.id, { resolvedPath: linkTarget, removed: true });
  } catch (e) {
    return jsonError(req.id, -32000, ioErrorMsg("unlink", e));
  }
}

// ── Internal: path gating ───────────────────────────────────────────

/** JSON-RPC error envelope every gate returns on refusal. */
type GateError = { error: { code: number; message: string } };

/**
 * THE single place a filesystem refusal becomes a response — and the
 * ONLY place `denyAndDisable` is reachable from the fs gates.
 *
 * Routing is driven by {@link isGrantEscape}, never by `!allowed` and
 * never by matching on the message:
 *
 *   • `not-found`         → -32000 ENOENT. Not a security event.
 *   • `reserved-carveout` → -32001, extension STAYS ENABLED, one
 *     `ext:perm:denied` audit row with `reason: "reserved-path"`. The
 *     platform is carving its own DB/secret dir out of a grant the user
 *     legitimately gave; an extension walking the project root hits
 *     this on its first correct run under the Docker layout
 *     (`Dockerfile:253`). `read_files` already handles it — it reports
 *     `skipped[{reason:"unreadable"}]` and keeps walking.
 *   • `out-of-grant`      → -32001 + `denyAndDisable`. This is the
 *     escape the control exists for; unchanged.
 */
async function refuseFs(
  ctx: FsHandlerContext,
  denial: FilesystemDenialKind,
  /** Cap kind / op label for the audit + violation record. */
  opLabel: string,
  requestedPath: string,
  resolvedPath: string,
): Promise<GateError> {
  if (denial === "not-found") {
    return {
      error: {
        code: -32000,
        message: `ENOENT: no such file or directory: ${requestedPath}`,
      },
    };
  }

  if (isGrantEscape(denial)) {
    await denyAndDisable(
      ctx.extensionId,
      `Filesystem access denied: ${opLabel} on ${requestedPath} (resolved: ${resolvedPath})`,
      resolvedPath,
    );
    return {
      error: {
        code: -32001,
        message: `Filesystem access denied: ${requestedPath} is outside declared permission paths. Extension has been disabled.`,
      },
    };
  }

  await auditReservedDenial(ctx, opLabel, resolvedPath);
  return {
    error: {
      code: -32001,
      message:
        `Filesystem access denied: ${requestedPath} is reserved by the EZCorp platform ` +
        "(database / secret store) and is never readable or writable by an extension.",
    },
  };
}

/**
 * Keep a reserved-carve-out denial OBSERVABLE now that it no longer
 * writes a `SecurityViolation` via `denyAndDisable`. An extension must
 * not be able to probe the platform's DB dir with no trace.
 *
 * Reuses `ext:perm:denied` with a structured `metadata.reason` rather
 * than minting a new action code — the same taxonomy-preserving pattern
 * as the per-conversation call-depth cap
 * (`tool-executor/invoke.ts:71-88`) and the MCP DNS-rebind block
 * (`mcp-proxy.ts:325-331`). SIEM/audit consumers filter on
 * `metadata.reason`.
 *
 * Best-effort: an audit-write failure must never convert a denial into
 * an allow, and the denial itself is already decided by the caller.
 */
async function auditReservedDenial(
  ctx: FsHandlerContext,
  opLabel: string,
  resolvedPath: string,
): Promise<void> {
  await insertAuditEntry(
    ctx.userId && ctx.userId !== "unknown" ? ctx.userId : null,
    AUDIT_PERM_DENIED,
    ctx.extensionId,
    {
      reason: "reserved-path",
      capabilityKind: opLabel,
      capabilityValue: resolvedPath,
      conversationId:
        ctx.conversationId && ctx.conversationId !== "unknown"
          ? ctx.conversationId
          : null,
    },
  ).catch(() => {
    /* audit best-effort — never block or weaken the deny */
  });
}

/**
 * Gate for read-style ops where the path MUST exist (read/list/stat).
 * realpath BEFORE authorize so the cap value is the resolved-now path.
 */
async function gatePath(
  ctx: FsHandlerContext,
  requestedPath: string,
  mode: FilesystemMode,
  capKind: "fs.read" | "fs.list" | "fs.stat",
): Promise<
  | { resolvedPath: string }
  | { error: { code: number; message: string } }
> {
  const granted = ctx.registry.getGrantedPermissions(ctx.extensionId);
  const installPath = ctx.registry.getInstallPath(ctx.extensionId);
  if (!granted || !installPath) {
    return { error: { code: -32603, message: "Extension not found in registry" } };
  }

  // realpath the input. If the path doesn't exist, this fails — the
  // caller asked for a read/list/stat on a non-existent path, which is
  // a legitimate "no such file" error. We surface it as -32000 with the
  // node errno path, matching the behavior callers expect from
  // `node:fs/promises`.
  const result = await checkFilesystemPermission(
    requestedPath,
    granted,
    installPath,
    mode,
    // Acting user — resolves a `$USER` grant segment to the caller's own
    // subtree. `extension-author` relies on this for cross-user draft
    // isolation; grants without `$USER` ignore it.
    ctx.userId,
  );

  if (!result.allowed) {
    // `result.denial` already distinguishes "doesn't exist" from
    // "reserved carve-out" from "outside the grant". Before, all three
    // collapsed into `!allowed` and this block re-ran `realpath` to
    // recover the first case with a second syscall (and had no way at
    // all to recover the second) — so a denied read of the platform's
    // OWN DB dir tripped `denyAndDisable`.
    return refuseFs(ctx, result.denial, capKind, requestedPath, result.resolvedPath);
  }

  // PDP gate — kind matches the operation.
  const cap: Capability = { kind: capKind, value: result.resolvedPath };
  const decision = await ctx.engine.authorize(
    {
      extensionId: ctx.extensionId,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
    },
    [cap],
  );
  if (decision.decision === "deny") {
    return { error: { code: -32001, message: `Filesystem access denied: ${decision.reason}` } };
  }

  return { resolvedPath: result.resolvedPath };
}

/**
 * Gate for write-style ops (write/mkdir/unlink). The target may not
 * exist yet, so we realpath the PARENT and append the basename. The
 * cap value is the joined string — the user's grant must cover it via
 * prefix-match.
 */
async function gateWritePath(
  ctx: FsHandlerContext,
  requestedPath: string,
): Promise<
  | { resolvedPath: string }
  | { error: { code: number; message: string } }
> {
  const granted = ctx.registry.getGrantedPermissions(ctx.extensionId);
  const installPath = ctx.registry.getInstallPath(ctx.extensionId);
  if (!granted || !installPath) {
    return { error: { code: -32603, message: "Extension not found in registry" } };
  }

  // Try to resolve the path itself first. If it exists, the same gate
  // as read-side applies. If it doesn't exist, walk up to the lowest
  // existing ancestor + append the missing tail. This handles
  // recursive mkdir of multi-level paths like `/a/b/c` where neither
  // `b` nor `c` exists yet.
  let targetPath: string;
  try {
    targetPath = await realpath(requestedPath);
  } catch {
    const ancestor = await resolveLowestExistingAncestor(requestedPath);
    if (!ancestor) {
      return {
        error: {
          code: -32000,
          message: `ENOENT: no resolvable ancestor for: ${requestedPath}`,
        },
      };
    }
    targetPath = join(ancestor.resolvedAncestor, ancestor.tail);
  }

  // Run the same prefix-match against `targetPath` (mode "write").
  // For non-existent targets, we cannot use checkFilesystemPermission
  // directly (it realpaths internally and fails on missing paths), so
  // we re-implement the prefix check inline using the parent-resolved
  // path. Keeps the realpath+prefix check in one mental model.
  const check = await checkPrefixForWrite(
    targetPath,
    granted.filesystem ?? [],
    installPath,
    ctx.userId,
  );
  if (!check.allowed) {
    return refuseFs(ctx, check.denial, "write", requestedPath, targetPath);
  }

  // PDP gate — kind=fs.write.
  const cap: Capability = { kind: "fs.write", value: targetPath };
  const decision = await ctx.engine.authorize(
    {
      extensionId: ctx.extensionId,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
    },
    [cap],
  );
  if (decision.decision === "deny") {
    return { error: { code: -32001, message: `Filesystem access denied: ${decision.reason}` } };
  }

  return { resolvedPath: targetPath };
}

/**
 * Gate for `exists`: the target may or may not exist; the parent must
 * be inside the grant. Returns both the parent resolution (for the
 * audit value) and the to-check target path.
 */
async function gateExistsPath(
  ctx: FsHandlerContext,
  requestedPath: string,
): Promise<
  | { targetPath: string; resolvedParent: string }
  | { error: { code: number; message: string } }
> {
  // Same path resolution shape as gateWritePath, but the cap is
  // fs.read (existence is information disclosure, classed as read).
  const granted = ctx.registry.getGrantedPermissions(ctx.extensionId);
  const installPath = ctx.registry.getInstallPath(ctx.extensionId);
  if (!granted || !installPath) {
    return { error: { code: -32603, message: "Extension not found in registry" } };
  }

  let targetPath: string;
  let resolvedParent: string;
  try {
    targetPath = await realpath(requestedPath);
    resolvedParent = targetPath; // exists — parent gate equivalent
  } catch {
    // Walk up to the lowest existing ancestor (mirrors gateWritePath).
    const ancestor = await resolveLowestExistingAncestor(requestedPath);
    if (!ancestor) {
      // Per the spec, this is NOT a permission leak: the manifest
      // grant must still cover an ancestor, so we deny here.
      return {
        error: {
          code: -32001,
          message: `Cannot check existence: no resolvable ancestor for ${requestedPath}`,
        },
      };
    }
    targetPath = join(ancestor.resolvedAncestor, ancestor.tail);
    resolvedParent = ancestor.resolvedAncestor;
  }

  const check = await checkPrefixForWrite(
    targetPath,
    granted.filesystem ?? [],
    installPath,
    ctx.userId,
  );
  if (!check.allowed) {
    // M4: an OUT-OF-GRANT existence probe still trips denyAndDisable —
    // consistency with gatePath/gateWritePath. Repeated probes (a
    // common reconnaissance technique) disable the extension on the
    // same threshold as other ops. A reserved-carve-out probe does NOT:
    // a project-root walk legitimately calls `exists` on the DB dir.
    return refuseFs(ctx, check.denial, "exists", requestedPath, targetPath);
  }

  // PDP gate — kind=fs.read for existence.
  const cap: Capability = { kind: "fs.read", value: resolvedParent };
  const decision = await ctx.engine.authorize(
    {
      extensionId: ctx.extensionId,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
    },
    [cap],
  );
  if (decision.decision === "deny") {
    return { error: { code: -32001, message: `Filesystem access denied: ${decision.reason}` } };
  }

  return { targetPath, resolvedParent };
}

/**
 * Walk up from `requestedPath` to the lowest existing ancestor that
 * realpath() can resolve. Returns the resolved ancestor + the path
 * tail (relative segments below the ancestor). This handles
 * recursive mkdir of paths like `/a/b/c` where neither `b` nor `c`
 * exist yet — we resolve `/a` (or `/`, or `.`) and let the caller
 * `join(...)` to recover the canonical target.
 *
 * Returns `null` only when even the filesystem root fails to resolve
 * (which would indicate a deeply broken environment).
 */
async function resolveLowestExistingAncestor(
  requestedPath: string,
): Promise<{ resolvedAncestor: string; tail: string } | null> {
  const tail: string[] = [];
  let cur = requestedPath;
  // Bound iterations defensively.
  for (let i = 0; i < 4096; i++) {
    try {
      const resolved = await realpath(cur);
      return { resolvedAncestor: resolved, tail: tail.reverse().join("/") };
    } catch {
      const idx = cur.lastIndexOf("/");
      if (idx === -1) {
        // Relative bareword — try `.`.
        try {
          const resolved = await realpath(".");
          tail.push(cur);
          return { resolvedAncestor: resolved, tail: tail.reverse().join("/") };
        } catch {
          return null;
        }
      }
      const base = cur.slice(idx + 1);
      const parent = idx === 0 ? "/" : cur.slice(0, idx);
      tail.push(base);
      cur = parent;
      if (cur === "/" || cur === "") break;
    }
  }
  // Try root as a final fallback.
  try {
    const resolved = await realpath("/");
    return { resolvedAncestor: resolved, tail: tail.reverse().join("/") };
  } catch {
    return null;
  }
}

/**
 * Inline prefix check for the write-side path (which may not exist
 * yet). Resolves each granted prefix via realpath (skipping
 * unresolvable ones), and accepts when the targetPath is inside the
 * install dir or any granted prefix.
 *
 * Exported for tests so the reserved-sensitive-path hard-deny can be
 * proven on the WRITE gate directly (not just inferred from the shared
 * `isReservedSensitivePath` helper).
 */
export async function checkPrefixForWrite(
  targetPath: string,
  prefixes: string[],
  installDir: string,
  /** Acting user, for a `$USER` grant segment. Same contract as
   *  `checkFilesystemPermission`'s parameter: omit it and a `$USER`
   *  prefix matches nothing. */
  actingUserId?: string | null,
): Promise<FilesystemPrefixCheck> {
  // Hard-deny reserved sensitive paths (DB + secret dir) BEFORE any
  // allow — including the implicit install-dir allow below and every
  // granted prefix. Grant-independent defense-in-depth, mirrors the
  // read-side gate in `checkFilesystemPermission`. `targetPath` is
  // already realpath'd / lowest-existing-ancestor-resolved by the
  // caller, so the segment-bounded compare can't be bypassed by `..` /
  // symlink / trailing-slash.
  //
  // `reserved-carveout`, not `out-of-grant` — see the discussion on
  // `FilesystemDenialKind`. Still a hard DENY; only the deny-and-
  // disable escalation differs.
  if (await isReservedSensitivePath(targetPath)) {
    return { allowed: false, denial: "reserved-carveout" };
  }
  let resolvedInstall: string;
  try {
    resolvedInstall = await realpath(installDir);
  } catch {
    resolvedInstall = installDir;
  }
  if (
    targetPath === resolvedInstall ||
    targetPath.startsWith(resolvedInstall + "/")
  ) {
    return { allowed: true };
  }
  for (const rawPrefix of prefixes) {
    // Tolerate a granted dir that hasn't been created yet (the
    // bootstrap case — e.g. extension-author / scratchpad's first
    // write under a not-yet-existing `.ezcorp/extension-data/<name>`).
    // `null` ⇒ truly unresolvable; skip. No scope widening — the
    // resolved string is still rooted at the exact granted subtree.
    const resolvedPrefix = await resolveGrantPrefixCanonical(
      expandGrantPrefix(rawPrefix, actingUserId),
    );
    if (resolvedPrefix === null) continue;
    if (
      targetPath === resolvedPrefix ||
      targetPath.startsWith(resolvedPrefix + "/")
    ) {
      return { allowed: true };
    }
  }
  return { allowed: false, denial: "out-of-grant" };
}

// ── Streaming frame builders ───────────────────────────────────────

/**
 * Split a fully-formed JSON-RPC response wire string into chunked
 * frames. Output shape:
 *
 *   announce: \x02<id>:<total-chunks>\n
 *   chunk_i:  \x01<id>:<seq>:<base64>\n
 *
 * Each chunk's raw payload is at most CHUNK_SIZE bytes. The base64
 * encoding inflates ~33%, but the transport receiver caps on the
 * post-base64 length (CHUNK_MAX_BYTES * 4/3 + 4) which matches our
 * CHUNK_SIZE upper bound.
 */
function buildStreamingFrames(
  id: number | string,
  wire: string,
): string[] {
  // Chunks are Latin-1 bytes (receivers `atob` each one), so escape every
  // non-ASCII char as a JSON `\uXXXX` sequence. Otherwise a resolvedPath
  // above U+00FF is truncated to one byte and the JSON does not parse.
  const wireStr = wire.replace(
    /[\u0080-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const total = Math.ceil(wireStr.length / CHUNK_SIZE);
  const frames: string[] = [`\x02${id}:${total}\n`];
  for (let i = 0; i < total; i++) {
    const piece = wireStr.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const b64 = Buffer.from(piece, "binary").toString("base64");
    frames.push(`\x01${id}:${i}:${b64}\n`);
  }
  return frames;
}

// ── Helpers ────────────────────────────────────────────────────────

function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): JsonRpcResponse {
  return rpcError(id, code, message);
}

function isNodeErrno(e: unknown): e is NodeJS.ErrnoException {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof (e as { code: unknown }).code === "string"
  );
}

function ioErrorMsg(op: string, e: unknown): string {
  if (isNodeErrno(e)) {
    const errno = e as NodeJS.ErrnoException;
    return `${errno.code ?? "EIO"}: ${op} failed: ${errno.message}`;
  }
  return `${op} failed: ${e instanceof Error ? e.message : String(e)}`;
}
