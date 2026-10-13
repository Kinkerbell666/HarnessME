import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHarnessEnv, gitInDirectory, makeFsRpcHandler, wireFsHandler, installFsChannelStub } from "../src/test/filesystem";
import { getChannel } from "../src/runtime";
import type { JsonRpcRequest, JsonRpcResponse } from "../src/types";

const roots: string[] = [];
const priorGrant = process.env.EZCORP_FS_ALLOWED;
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("filesystem harness preserves validation, containment and file operation envelopes", () => {
  const root = mkdtempSync(join(tmpdir(), "sdk-filesystem-"));
  roots.push(root);
  const handler = makeFsRpcHandler(root);
  const call = (op: string, params?: Record<string, unknown>) => handler({ jsonrpc: "2.0", id: "call", method: `ezcorp/fs.${op}`, params });
  expect(call("read")?.error?.code).toBe(-32602);
  expect(call("read", { path: `${root}-outside` })?.error?.code).toBe(-32001);
  expect(call("write", { path: join(root, "file") })?.error?.code).toBe(-32602);
  expect(call("write", { path: join(root, "file"), content: "data" })?.result).toMatchObject({ bytes: 4 });
  expect(call("read", { path: join(root, "file") })?.result).toMatchObject({ encoding: "utf-8", body: Buffer.from("data").toString("base64"), bytes: 4 });
  expect(call("write", { path: join(root, "binary"), content: "AAE=", encoding: "binary" })?.result).toMatchObject({ bytes: 2 });
  expect(call("read", { path: join(root, "binary"), encoding: "binary" })?.result).toMatchObject({ encoding: "binary", body: "AAE=" });
  expect(call("mkdir", { path: join(root, "directory"), recursive: true })?.result).toEqual({ resolvedPath: join(root, "directory") });
  expect(call("list", { path: root })?.result).toMatchObject({ entries: expect.arrayContaining([{ name: "file", isFile: true, isDirectory: false }, { name: "directory", isFile: false, isDirectory: true }]) });
  expect(call("stat", { path: join(root, "file") })?.result).toMatchObject({ size: 4, isFile: true, isDirectory: false });
  expect(call("unlink", { path: join(root, "file") })?.result).toEqual({ resolvedPath: join(root, "file") });
  expect(call("read", { path: join(root, "file") })?.error?.code).toBe(-32000);
  expect(call("unsupported", { path: root })?.error?.code).toBe(-32601);
});

test("custom filesystem wiring can answer or fall through without losing request identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "sdk-filesystem-"));
  roots.push(root);
  let dispatch!: (request: JsonRpcRequest) => Promise<JsonRpcResponse>;
  wireFsHandler({ setRequestHandler: handler => { dispatch = handler; } }, { fsRoot: root, onRequest: request => request.method === "custom" ? { jsonrpc: "2.0", id: request.id, result: "custom result" } : undefined });
  expect(await dispatch({ jsonrpc: "2.0", id: "custom-id", method: "custom" })).toMatchObject({ id: "custom-id", result: "custom result" });
  expect(await dispatch({ jsonrpc: "2.0", id: "exists", method: "ezcorp/fs.exists", params: { path: root } })).toMatchObject({ id: "exists", result: { exists: true } });
  expect(await dispatch({ jsonrpc: "2.0", id: "unknown", method: "unhandled" })).toMatchObject({ id: "unknown", error: { code: -32601 } });
});

test("in-process filesystem stub rejects unrelated host calls", async () => {
  installFsChannelStub(tmpdir());
  const request = getChannel().request;
  try {
    await expect(request("ezcorp/network.fetch", {})).rejects.toThrow("unexpected RPC method");
    expect(await request<{ exists: boolean }>("ezcorp/fs.exists", { path: tmpdir() })).toEqual({ exists: true });
    await expect(request("ezcorp/fs.read", {})).rejects.toMatchObject({ code: -32602 });
  } finally {
    (request as typeof request & { mockRestore(): void }).mockRestore();
  }
});

// The in-process stub's grant lasted past its test: installFsChannelStub set EZCORP_FS_ALLOWED=1 and nothing
// cleared it, so in a pooled bun process every later file ran with a filesystem grant it never asked for. The
// docs-updater integration test then sent its run-log mkdir to a host that did not exist and timed out at 30 s
// (W18c measurement at dc3b64234; reproduced with auto-note/index.test.ts before it in one process).
describe("installFsChannelStub grants for the calling test only", () => {
  test("the grant holds while the test runs", () => {
    installFsChannelStub(tmpdir());
    expect(process.env.EZCORP_FS_ALLOWED).toBe("1");
  });
  test("the next test sees the grant the process had before", () => {
    expect(process.env.EZCORP_FS_ALLOWED).toBe(priorGrant);
  });
  test("a grant value the process already had is put back, not deleted", () => {
    process.env.EZCORP_FS_ALLOWED = "host-set";
    installFsChannelStub(tmpdir());
    expect(process.env.EZCORP_FS_ALLOWED).toBe("1");
  });
  test("after that test the earlier value is back", () => {
    expect(process.env.EZCORP_FS_ALLOWED).toBe("host-set");
    if (priorGrant === undefined) delete process.env.EZCORP_FS_ALLOWED;
    else process.env.EZCORP_FS_ALLOWED = priorGrant;
  });
});

test("filesystem harness environment grants are explicit and overridable", () => {
  const extensionId = `sdk-harness-${crypto.randomUUID()}`;
  const environment = buildHarnessEnv(extensionId, { filesystem: true, shell: true, network: true, permittedHosts: "example.com", projectRoot: "/project", env: { CUSTOM: "value" } });
  roots.push(environment.TMPDIR!);
  expect(environment).toMatchObject({ EZCORP_FS_ALLOWED: "1", EZCORP_SHELL_ALLOWED: "1", EZCORP_NETWORK_ALLOWED: "1", EZCORP_PERMITTED_HOSTS: "example.com", EZCORP_PROJECT_ROOT: "/project", CUSTOM: "value" });
  const restricted = buildHarnessEnv(extensionId);
  expect(restricted.EZCORP_FS_ALLOWED).toBeUndefined();
});

// L2, W18 hygiene item C: gitInDirectory()'s own default `home` (when the
// caller passes none) used to be created via a default-parameter
// `mkdtempSync(...)` and never removed — one leaked directory under
// `os.tmpdir()` per call. Fixed to clean up only the directory IT created;
// a caller-supplied `home` is left alone (the caller may still need it).
test("gitInDirectory() removes its own scratch home, but not a caller-supplied one", () => {
  const before = readdirSync(tmpdir()).filter((n) => n.startsWith("gitInDirectory-"));

  const dir = mkdtempSync(join(tmpdir(), "sdk-git-in-dir-"));
  roots.push(dir);
  gitInDirectory(dir, ["rev-parse", "--is-inside-work-tree"]);

  const after = readdirSync(tmpdir()).filter((n) => n.startsWith("gitInDirectory-"));
  expect(after).toEqual(before);

  const suppliedHome = mkdtempSync(join(tmpdir(), "sdk-git-in-dir-supplied-home-"));
  roots.push(suppliedHome);
  gitInDirectory(dir, ["rev-parse", "--is-inside-work-tree"], suppliedHome);
  expect(existsSync(suppliedHome)).toBe(true);
});
