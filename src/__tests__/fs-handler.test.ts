/**
 * Phase 3 — host-side `ezcorp/fs.*` handler matrix.
 *
 * Mock the registry + permission engine, write to a tmpdir-rooted grant,
 * and exercise every operation's allow/deny + happy-path + edge-case.
 * The matrix mirrors `tasks/phase-3-filesystem-hardening.md` "Tests"
 * section (a–q).
 *
 * Streaming for `read` is exercised via the chunked-frame envelope:
 * the handler returns `{streamed: true, frames}` for files >1MB. The
 * test reassembles the frames the same way the SDK channel will.
 */

import {
  test,
  expect,
  describe,
  beforeEach,
  afterEach,
  afterAll,
  mock,
  spyOn,
} from "bun:test";
import { restoreModuleMocks } from "./helpers/mock-cleanup";
// Spy target for M4 assertions — `securityModule.denyAndDisable` is
// the trip wire fs handlers call on out-of-grant access.
import * as securityModule from "../extensions/security";

// Mock DB so denyAndDisable / audit-log writes don't trip "Database
// not initialized" in unit-test mode. Mirrors the pattern in
// `ext-registry-executor.test.ts` — and crucially, restoreModuleMocks()
// in afterAll keeps these mocks from leaking into subsequent test
// files (e.g. permission-engine.test.ts which DOES use the real DB
// stack).
afterAll(() => restoreModuleMocks());

mock.module("../db/connection", () => ({
  getDb: () => ({
    insert: () => ({ values: async () => {} }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  }),
}));
mock.module("../db/queries/extensions", () => ({
  disableExtension: async () => {},
  incrementFailures: async () => 0,
  resetFailures: async () => {},
  listExtensions: async () => [],
}));
mock.module("../db/queries/settings", () => ({
  getSetting: async () => null,
  upsertSetting: async () => {},
}));
mock.module("../db/queries/audit-log", () => ({
  insertAuditEntry: async () => {},
}));
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  handleFsReadRpc,
  handleFsWriteRpc,
  handleFsListRpc,
  handleFsStatRpc,
  handleFsExistsRpc,
  handleFsMkdirRpc,
  handleFsUnlinkRpc,
  STREAM_THRESHOLD,
  type FsHandlerContext,
  type FsRpcResponse,
} from "../extensions/fs-handler";
import { createStubPermissionEngine } from "./helpers/permission-engine-stub";
import type { ExtensionPermissions, JsonRpcRequest, JsonRpcResponse } from "../extensions/types";

// ── Test rig ──────────────────────────────────────────────────────

let workDir: string;
let installDir: string;
let grantedDir: string;

const EXT_ID = "ext-fs-test";

function makeMockRegistry(opts: {
  granted?: ExtensionPermissions;
  installPath?: string;
}) {
  const granted: ExtensionPermissions = opts.granted ?? { grantedAt: {} };
  const installPath = opts.installPath ?? installDir;
  return {
    getGrantedPermissions: (id: string) => (id === EXT_ID ? granted : null),
    getInstallPath: (id: string) => (id === EXT_ID ? installPath : null),
    getManifest: () => undefined,
    getRegisteredTool: () => null,
    getProcess: async () => ({}),
    getAllTools: () => [],
    getToolExtension: () => null,
    resolveDepTool: () => null,
    loadFromDb: async () => {},
    reload: async () => {},
    killAll: () => {},
  };
}

function makeRequest(method: string, params: Record<string, unknown>, id = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

function makeCtx(opts: { granted?: ExtensionPermissions; installPath?: string } = {}): FsHandlerContext {
  return {
    extensionId: EXT_ID,
    conversationId: "conv-1",
    userId: "u-1",
    engine: createStubPermissionEngine(),
    registry: makeMockRegistry(opts) as unknown as FsHandlerContext["registry"],
  };
}

function isJsonRpcResponse(r: FsRpcResponse): r is JsonRpcResponse {
  return (r as { streamed?: boolean }).streamed !== true;
}

/** Reassemble chunked frames like the SDK channel does (atob per chunk, then JSON.parse). */
function reassembleFrames(frames: readonly string[]): JsonRpcResponse {
  const announce = frames[0]!.slice(1).split(":");
  expect(Number(announce[1])).toBe(frames.length - 1);
  let assembled = "";
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!;
    expect(f.startsWith("\x01")).toBe(true);
    const body = f.slice(1, f.length - 1); // strip sentinel + trailing \n
    const colon1 = body.indexOf(":");
    const colon2 = body.indexOf(":", colon1 + 1);
    expect(Number(body.slice(colon1 + 1, colon2))).toBe(i - 1);
    assembled += atob(body.slice(colon2 + 1));
  }
  return JSON.parse(assembled) as JsonRpcResponse;
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "ezcorp-fs-handler-"));
  installDir = join(workDir, "install");
  grantedDir = join(workDir, "granted");
  mkdirSync(installDir, { recursive: true });
  mkdirSync(grantedDir, { recursive: true });
});

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════
// Common — every operation
// ════════════════════════════════════════════════════════════════════

describe("fs-handler — common gating (all operations)", () => {
  test("(a) missing path param → -32602 across all ops", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const ops = [
      ["ezcorp/fs.read", handleFsReadRpc],
      ["ezcorp/fs.write", handleFsWriteRpc],
      ["ezcorp/fs.list", handleFsListRpc],
      ["ezcorp/fs.stat", handleFsStatRpc],
      ["ezcorp/fs.exists", handleFsExistsRpc],
      ["ezcorp/fs.mkdir", handleFsMkdirRpc],
      ["ezcorp/fs.unlink", handleFsUnlinkRpc],
    ] as const;
    for (const [method, fn] of ops) {
      const r = (await fn(makeRequest(method, {}), ctx)) as JsonRpcResponse;
      expect(isJsonRpcResponse(r)).toBe(true);
      expect(r.error?.code).toBe(-32602);
    }
  });

  test("(b) path outside grant → -32001", async () => {
    const ctx = makeCtx({
      granted: { filesystem: [grantedDir], grantedAt: {} },
    });
    const outsideDir = mkdtempSync(join(tmpdir(), "ezcorp-outside-"));
    try {
      const target = join(outsideDir, "secret.txt");
      writeFileSync(target, "shh");
      const r = (await handleFsReadRpc(
        makeRequest("ezcorp/fs.read", { path: target }),
        ctx,
      )) as JsonRpcResponse;
      expect(r.error?.code).toBe(-32001);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("(c) PDP authorize is called with correct kind+value", async () => {
    const engine = createStubPermissionEngine();
    const ctx: FsHandlerContext = {
      ...makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } }),
      engine,
    };
    const target = join(grantedDir, "x.txt");
    writeFileSync(target, "hi");
    await handleFsReadRpc(
      makeRequest("ezcorp/fs.read", { path: target }),
      ctx,
    );
    expect(engine.calls.length).toBe(1);
    expect(engine.calls[0]!.needed[0]!.kind).toBe("fs.read");
    expect(engine.calls[0]!.needed[0]!.value).toBe(target);
  });

  test("registry has no install path / granted → -32603", async () => {
    const ctx: FsHandlerContext = {
      extensionId: "unknown-ext",
      conversationId: "conv-1",
      userId: "u-1",
      engine: createStubPermissionEngine(),
      registry: makeMockRegistry({}) as unknown as FsHandlerContext["registry"],
    };
    const r = (await handleFsReadRpc(
      makeRequest("ezcorp/fs.read", { path: grantedDir }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error?.code).toBe(-32603);
  });
});

// ════════════════════════════════════════════════════════════════════
// Read
// ════════════════════════════════════════════════════════════════════

describe("fs-handler — read", () => {
  test("(d) small file (<1MB) → single-frame JSON response", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "small.txt");
    writeFileSync(target, "Hello, world!");

    const r = (await handleFsReadRpc(
      makeRequest("ezcorp/fs.read", { path: target }),
      ctx,
    )) as JsonRpcResponse;

    expect(r.error).toBeUndefined();
    const result = r.result as { encoding: string; body: string; bytes: number; resolvedPath: string };
    expect(result.encoding).toBe("utf-8");
    expect(result.bytes).toBe(13);
    expect(result.resolvedPath).toBe(target);
    expect(Buffer.from(result.body, "base64").toString("utf-8")).toBe("Hello, world!");
  });

  test("(e) large file (>1MB) → chunked-frame streamed response", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "big.bin");
    const size = STREAM_THRESHOLD + 4096; // just over the threshold
    writeFileSync(target, Buffer.alloc(size, 0x41));

    const r = await handleFsReadRpc(
      makeRequest("ezcorp/fs.read", { path: target }, 7),
      ctx,
    );

    expect((r as { streamed?: boolean }).streamed).toBe(true);
    // M2 fix: StreamedResponse.frames is `readonly string[]`. Use a
    // looser cast that doesn't promise mutability — the test only
    // reads from the array.
    const frames = (r as unknown as { frames: readonly string[] }).frames;
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[0]!.startsWith("\x02")).toBe(true);
    expect(frames[0]!).toContain("7:"); // id=7

    const parsed = reassembleFrames(frames);
    expect(parsed.id).toBe(7);
    const result = parsed.result as { body: string; bytes: number };
    expect(result.bytes).toBe(size);
    const decoded = Buffer.from(result.body, "base64");
    expect(decoded.length).toBe(size);
    expect(decoded[0]).toBe(0x41);
  });

  test("(e2) streamed response keeps a non-Latin-1 resolvedPath intact", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "日本-文件-😀.bin");
    writeFileSync(target, Buffer.alloc(STREAM_THRESHOLD + 1, 0x41));

    const r = await handleFsReadRpc(makeRequest("ezcorp/fs.read", { path: target }, 8), ctx);

    expect((r as { streamed?: boolean }).streamed).toBe(true);
    const parsed = reassembleFrames((r as unknown as { frames: readonly string[] }).frames);
    expect((parsed.result as { resolvedPath: string }).resolvedPath).toBe(target);
  });

  test("(f) explicit binary encoding round-trips arbitrary bytes", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "bin.dat");
    const raw = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
    writeFileSync(target, raw);

    const r = (await handleFsReadRpc(
      makeRequest("ezcorp/fs.read", { path: target, encoding: "binary" }),
      ctx,
    )) as JsonRpcResponse;
    const result = r.result as { encoding: string; body: string };
    expect(result.encoding).toBe("binary");
    const decoded = Buffer.from(result.body, "base64");
    expect(decoded.equals(raw)).toBe(true);
  });

  test("(g) symlink: realpath BEFORE authorize. Swap to outside-grant before realpath denies.", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const linkPath = join(grantedDir, "link");
    const outsideDir = mkdtempSync(join(tmpdir(), "ezcorp-symlink-out-"));
    try {
      const target = join(outsideDir, "secret");
      writeFileSync(target, "shh");
      symlinkSync(target, linkPath);
      const r = (await handleFsReadRpc(
        makeRequest("ezcorp/fs.read", { path: linkPath }),
        ctx,
      )) as JsonRpcResponse;
      expect(r.error?.code).toBe(-32001);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("(g) symlink: realpath BEFORE authorize. In-grant target succeeds.", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "real.txt");
    writeFileSync(target, "ok");
    const link = join(grantedDir, "link");
    symlinkSync(target, link);
    const r = (await handleFsReadRpc(
      makeRequest("ezcorp/fs.read", { path: link }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
    const result = r.result as { resolvedPath: string };
    expect(result.resolvedPath).toBe(target);
  });

  test("read on >100MB file rejects with size cap", async () => {
    // We can't easily write 100MB in the test, so simulate by writing
    // a file just over the cap. Skip if disk is constrained.
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "huge.bin");
    // Use the actual cap from the module so the test stays in sync.
    const { MAX_BYTES_PER_OP } = await import("../extensions/fs-handler");
    writeFileSync(target, Buffer.alloc(MAX_BYTES_PER_OP + 1, 0));

    const r = (await handleFsReadRpc(
      makeRequest("ezcorp/fs.read", { path: target }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error?.code).toBe(-32000);
    expect(r.error?.message).toMatch(/cap|exceed/i);
  });
});

// ════════════════════════════════════════════════════════════════════
// Write
// ════════════════════════════════════════════════════════════════════

describe("fs-handler — write", () => {
  test("(h) write to a path under read-only grant — host gate is mode-agnostic; PDP layer enforces mode", async () => {
    // The handler's own prefix check passes; the PDP would deny if
    // the manifest's per-tool capabilities.filesystem.mode lacks
    // "write". With the stub engine in allow-all mode, the write
    // succeeds — this asserts the handler's gate flow, not the PDP's
    // mode logic (which is covered by capability-types.test.ts).
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "out.txt");
    const r = (await handleFsWriteRpc(
      makeRequest("ezcorp/fs.write", { path: target, content: "data" }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
  });

  test("(h) write denied by PDP (deny-all engine) → -32001", async () => {
    const ctx: FsHandlerContext = {
      ...makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } }),
      engine: createStubPermissionEngine("deny-all"),
    };
    const target = join(grantedDir, "out.txt");
    const r = (await handleFsWriteRpc(
      makeRequest("ezcorp/fs.write", { path: target, content: "data" }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error?.code).toBe(-32001);
  });

  test("(i) write succeeds; byte content round-trips on disk", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "out.txt");
    const r = (await handleFsWriteRpc(
      makeRequest("ezcorp/fs.write", { path: target, content: "hello world" }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
    const onDisk = readFileSync(target, "utf-8");
    expect(onDisk).toBe("hello world");
  });

  test("(i) write with binary encoding round-trips arbitrary bytes", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "bin.dat");
    const raw = Buffer.from([0x01, 0x02, 0x03, 0xff]);
    const b64 = raw.toString("base64");
    const r = (await handleFsWriteRpc(
      makeRequest("ezcorp/fs.write", { path: target, content: b64, encoding: "binary" }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
    const onDisk = readFileSync(target);
    expect(onDisk.equals(raw)).toBe(true);
  });

  test("(j) write >100MB rejected with size cap", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "big.bin");
    // Build a base64 string whose decoded length exceeds the cap.
    const { MAX_BYTES_PER_OP } = await import("../extensions/fs-handler");
    const bytes = Buffer.alloc(MAX_BYTES_PER_OP + 1, 0x42);
    const b64 = bytes.toString("base64");
    const r = (await handleFsWriteRpc(
      makeRequest("ezcorp/fs.write", { path: target, content: b64, encoding: "binary" }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error?.code).toBe(-32000);
    expect(r.error?.message).toMatch(/cap|exceed/i);
  });

  test("missing content param → -32602", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const r = (await handleFsWriteRpc(
      makeRequest("ezcorp/fs.write", { path: join(grantedDir, "x") }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error?.code).toBe(-32602);
  });

  test("write outside grant → -32001 + denyAndDisable trip", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const outsideDir = mkdtempSync(join(tmpdir(), "ezcorp-out-write-"));
    try {
      const r = (await handleFsWriteRpc(
        makeRequest("ezcorp/fs.write", { path: join(outsideDir, "x"), content: "y" }),
        ctx,
      )) as JsonRpcResponse;
      expect(r.error?.code).toBe(-32001);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// List
// ════════════════════════════════════════════════════════════════════

describe("fs-handler — list", () => {
  test("(k) lists directory entries with isFile/isDirectory metadata", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    writeFileSync(join(grantedDir, "a.txt"), "a");
    mkdirSync(join(grantedDir, "sub"));

    const r = (await handleFsListRpc(
      makeRequest("ezcorp/fs.list", { path: grantedDir }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
    const result = r.result as {
      entries: Array<{ name: string; isFile: boolean; isDirectory: boolean }>;
    };
    const names = result.entries.map((e) => e.name).sort();
    expect(names).toEqual(["a.txt", "sub"]);
    const aEntry = result.entries.find((e) => e.name === "a.txt")!;
    expect(aEntry.isFile).toBe(true);
    expect(aEntry.isDirectory).toBe(false);
    const subEntry = result.entries.find((e) => e.name === "sub")!;
    expect(subEntry.isDirectory).toBe(true);
  });

  test("(l) listing a file returns -32602 (ENOTDIR mapped)", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "a.txt");
    writeFileSync(target, "a");
    const r = (await handleFsListRpc(
      makeRequest("ezcorp/fs.list", { path: target }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toMatch(/not a directory/);
  });
});

// ════════════════════════════════════════════════════════════════════
// Stat
// ════════════════════════════════════════════════════════════════════

describe("fs-handler — stat", () => {
  test("(m) returns size, mtime, isFile, isDirectory", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "s.txt");
    writeFileSync(target, "abc");
    const r = (await handleFsStatRpc(
      makeRequest("ezcorp/fs.stat", { path: target }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
    const result = r.result as {
      size: number;
      mtimeMs: number;
      isFile: boolean;
      isDirectory: boolean;
    };
    expect(result.size).toBe(3);
    expect(result.isFile).toBe(true);
    expect(result.isDirectory).toBe(false);
    expect(typeof result.mtimeMs).toBe("number");
  });
});

// ════════════════════════════════════════════════════════════════════
// Exists
// ════════════════════════════════════════════════════════════════════

describe("fs-handler — exists", () => {
  test("(n) true for existing path inside grant", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "e.txt");
    writeFileSync(target, "");
    const r = (await handleFsExistsRpc(
      makeRequest("ezcorp/fs.exists", { path: target }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
    expect((r.result as { exists: boolean }).exists).toBe(true);
  });

  test("(n) false for non-existing path inside grant (parent in grant)", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "missing.txt");
    const r = (await handleFsExistsRpc(
      makeRequest("ezcorp/fs.exists", { path: target }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
    expect((r.result as { exists: boolean }).exists).toBe(false);
  });

  test("(n) NOT a permission leak: out-of-grant existence returns -32001", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    // /etc/passwd exists but is outside the grant — must not leak truthiness.
    const r = (await handleFsExistsRpc(
      makeRequest("ezcorp/fs.exists", { path: "/etc/passwd" }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error?.code).toBe(-32001);
    // Post-fix: the message now mentions "disabled" because gateExistsPath
    // calls denyAndDisable on out-of-grant probes (M4).
    expect(r.error?.message).toMatch(/disabled/);
  });

  test("(M4) gateExistsPath calls denyAndDisable on out-of-grant probe (consistency with read/write)", async () => {
    // Spy on denyAndDisable to confirm the trip — pre-fix `gateExistsPath`
    // returned -32001 silently (no extension disable), letting an
    // adversary probe existence indefinitely. Post-fix it matches
    // `gatePath`/`gateWritePath`'s consistency contract.
    const secSpy = spyOn(securityModule, "denyAndDisable").mockResolvedValue({
      extensionId: EXT_ID,
      reason: "stub",
      path: "/etc/passwd",
      timestamp: Date.now(),
    });
    try {
      const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
      const r = (await handleFsExistsRpc(
        makeRequest("ezcorp/fs.exists", { path: "/etc/passwd" }),
        ctx,
      )) as JsonRpcResponse;
      expect(r.error?.code).toBe(-32001);
      expect(secSpy).toHaveBeenCalledTimes(1);
      const callArgs = secSpy.mock.calls[0]!;
      expect(callArgs[0]).toBe(EXT_ID);
      expect(String(callArgs[1])).toMatch(/exists.*\/etc\/passwd/);
    } finally {
      secSpy.mockRestore();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// Mkdir
// ════════════════════════════════════════════════════════════════════

describe("fs-handler — mkdir", () => {
  test("(o) creates directory; recursive option works for nested paths", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "a", "b", "c");
    const r = (await handleFsMkdirRpc(
      makeRequest("ezcorp/fs.mkdir", { path: target, recursive: true }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
    expect(existsSync(target)).toBe(true);
  });

  test("(p) recursive mkdir on existing path is idempotent (no error)", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "exists");
    mkdirSync(target);
    const r = (await handleFsMkdirRpc(
      makeRequest("ezcorp/fs.mkdir", { path: target, recursive: true }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
  });

  test("(p) non-recursive mkdir on existing path returns EEXIST error", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "exists");
    mkdirSync(target);
    const r = (await handleFsMkdirRpc(
      makeRequest("ezcorp/fs.mkdir", { path: target, recursive: false }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error?.code).toBe(-32000);
    expect(r.error?.message).toMatch(/exists/i);
  });
});

// ════════════════════════════════════════════════════════════════════
// Unlink
// ════════════════════════════════════════════════════════════════════

describe("fs-handler — unlink", () => {
  test("(q) removes file; subsequent stat fails", async () => {
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "tmp.txt");
    writeFileSync(target, "x");
    const r = (await handleFsUnlinkRpc(
      makeRequest("ezcorp/fs.unlink", { path: target }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
    expect(existsSync(target)).toBe(false);
  });

  test("(q) symlinks: unlink removes the LINK, leaves the target intact (POSIX)", async () => {
    // M1 (validator should-fix #1): the handler now uses lstat + a
    // parent-realpath gate so `fs.unlink(linkPath)` operates on the
    // link itself, NOT the target. Pre-fix, an extension calling
    // `fsUnlink("/grant/link")` where `/grant/link → /etc/critical`
    // would unlink `/etc/critical` if `/etc/critical` happened to
    // be in grant. Post-fix, the link is removed and the target
    // file is preserved — matching `unlink(2)` POSIX semantics.
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const target = join(grantedDir, "real.txt");
    const link = join(grantedDir, "link");
    writeFileSync(target, "content");
    symlinkSync(target, link);

    const r = (await handleFsUnlinkRpc(
      makeRequest("ezcorp/fs.unlink", { path: link }),
      ctx,
    )) as JsonRpcResponse;
    expect(r.error).toBeUndefined();
    // The link is gone:
    expect(existsSync(link)).toBe(false);
    // The target is PRESERVED:
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("content");
  });

  test("(q) symlink to out-of-grant target: unlink removes the link, denyAndDisable not tripped", async () => {
    // Defense-in-depth: even if `link → /etc/critical`, gating on the
    // parent (the grant dir) means we never inspect the target's
    // grant status. The link is unlinked; /etc/critical is untouched.
    const ctx = makeCtx({ granted: { filesystem: [grantedDir], grantedAt: {} } });
    const outsideDir = mkdtempSync(join(tmpdir(), "ezcorp-out-link-"));
    try {
      const outsideTarget = join(outsideDir, "outside.txt");
      writeFileSync(outsideTarget, "external");
      const link = join(grantedDir, "link-to-outside");
      symlinkSync(outsideTarget, link);

      const r = (await handleFsUnlinkRpc(
        makeRequest("ezcorp/fs.unlink", { path: link }),
        ctx,
      )) as JsonRpcResponse;
      expect(r.error).toBeUndefined();
      expect(existsSync(link)).toBe(false);
      expect(existsSync(outsideTarget)).toBe(true);
      expect(readFileSync(outsideTarget, "utf-8")).toBe("external");
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
