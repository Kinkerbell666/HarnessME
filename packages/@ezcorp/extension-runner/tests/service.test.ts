import { expect, test } from "bun:test";
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner, RunnerExecution } from "@ezcorp/extension-contract";
import { startRunnerService } from "../src/service";
import { RunnerClient, executionLimits, buildLimits, filesDigest } from "../src";
import { command } from "../src/core";

test("Unix API checks peer UID and bearer and carries bidirectional RPC", async () => {
  // Use a controlled short public path. The inherited test TMPDIR can already
  // be nested; this keeps the public path valid while the former UUID child
  // still exceeds Linux's AF_UNIX byte limit.
  const temporaryRoot = await mkdtemp("/tmp/ez-runner-nested-");
  const nestedDirectory = await mkdtemp(join(temporaryRoot, "tmp."));
  const directory = await mkdtemp(join(nestedDirectory, "ez-runner-socket-"));
  const socketPath = join(directory, "runner.sock");
  expect(Buffer.byteLength(join(directory, `.private-${"x".repeat(36)}`, "runner.sock"))).toBeGreaterThan(107);
  await command("python3", ["-c", "import socket,sys; connection=socket.socket(socket.AF_UNIX); connection.bind(sys.argv[1]); connection.close()", socketPath]);
  const token = "test-service-credential-32-bytes-minimum";
  let closed = false;
  const runner: Runner = {
    build: async input => ({ operationId: input.operationId, sourceDigest: input.sourceDigest, state: "failed", imageDigest: "test", diagnostics: [], evidence: { protocolVersion: 4, validatorVersion: "test", tests: [], discoveryDigest: "" } }),
    start: async (input, reverseRpc) => {
      const listeners = new Set<(method: string, params: unknown) => void>();
      const execution: RunnerExecution = { workerId: input.workerId, request: async (method, params) => { if (method === "notify") { for (const listener of listeners) listener("changed", params); return null; } return reverseRpc(method, params); }, close: async () => { closed = true; }, onNotification: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
      return execution;
    },
    cancel: async () => {},
    inspect: async id => ({ id, state: "running", diagnostics: [] }),
    collectArtifacts: async () => ({ "extension.js": "export {};" }),
  };
  const server = await startRunnerService({ runner, socketPath, token, allowedUid: process.getuid!() });
  try {
    const client = new RunnerClient({ socketPath, token });
    await expect(new RunnerClient({ socketPath, token: "wrong" }).inspect("worker")).rejects.toThrow("authentication");
    expect((await client.inspect("worker")).state).toBe("running");
    await expect(client.inspect("../invalid")).rejects.toThrow("identifier");
    expect(await client.collectArtifacts("a".repeat(64))).toEqual({ "extension.js": "export {};" });
    const files = { "extension.ts": "export {};" };
    expect((await client.build({ operationId: "build", files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits })).state).toBe("failed");
    const context = { workerId: "worker", invocationId: "invocation", releaseId: "release", principalId: "user", scopeId: "scope", token: "capability", deadline: Date.now() + 30_000 };
    const execution = await client.start({ workerId: "worker", artifactDigest: "a".repeat(64), context, limits: executionLimits }, async (method, params) => {
      if (method === "conflict") throw Object.assign(new Error("private SQL details"), { code: "STATE_CONFLICT" });
      if (method === "denied") throw new Error("private token");
      return { method, params };
    });
    await expect(execution.request("conflict", {})).rejects.toMatchObject({ code: "STATE_CONFLICT", message: "STATE_CONFLICT: State changed; reload before retrying." });
    await expect(execution.request("denied", {})).rejects.toThrow("Host capability denied or failed");
    expect(await execution.request("storage.get", { key: "hello" })).toEqual({ method: "storage.get", params: { key: "hello" } });
    const notification = new Promise(resolve => { const unsubscribe = execution.onNotification((method, params) => { unsubscribe(); resolve({ method, params }); }); });
    await execution.request("notify", { key: "updated" });
    expect(await notification).toEqual({ method: "changed", params: { key: "updated" } });
    await expect(new RunnerClient({ socketPath, token }).attach({ workerId: "worker", artifactDigest: "a".repeat(64), context, limits: executionLimits }, async () => null)).rejects.toThrow("already attached");
    await execution.close();
    expect(closed).toBe(true);
  } finally { await server.close(); await rm(temporaryRoot, { recursive: true, force: true }); }
}, 15_000);

test("wrong OS peer UID cannot reach the private runner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ez-runner-peer-"));
  const token = "test-service-credential-32-bytes-minimum";
  const socketPath = join(directory, "runner.sock");
  const runner = { inspect: async () => { throw new Error("must never reach handler"); } } as unknown as Runner;
  const server = await startRunnerService({ runner, socketPath, token, allowedUid: process.getuid!() + 1 });
  try { await expect(new RunnerClient({ socketPath, token }).inspect("worker")).rejects.toThrow(); } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});

test("failed gateway startup removes owner-only private and public sockets", async () => {
  const directory = await mkdtemp("/tmp/ez-runner-gateway-");
  const socketPath = join(directory, "runner.sock");
  const wrapperPath = join(directory, "failed-gateway.py");
  const observationPath = join(directory, "failed-gateway.result");
  await writeFile(wrapperPath, `#!/usr/bin/env python3
from pathlib import Path
import sys
private_path = Path(sys.argv[3])
status = private_path.parent.stat()
Path(__file__).with_suffix(".result").write_text(f"{private_path}\\n{status.st_uid}\\n{status.st_mode & 0o777:o}\\n")
sys.exit(1)
`);
  await chmod(wrapperPath, 0o700);
  try {
    await expect(startRunnerService({
      runner: { inspect: async () => ({}) } as unknown as Runner,
      socketPath,
      token: "test-service-credential-32-bytes-minimum",
      allowedUid: process.getuid!(),
      python: wrapperPath,
    })).rejects.toThrow("Unix peer gateway exited");
    const observed = (await readFile(observationPath, "utf8")).trim().split("\n");
    expect(observed).toHaveLength(3);
    const [privatePath, owner, mode] = observed as [string, string, string];
    expect(owner).toBe(String(process.getuid!()));
    expect(mode).toBe("700");
    await expect(lstat(privatePath)).rejects.toThrow();
    await expect(lstat(socketPath)).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("concurrent services allocate separate private upstream sockets", async () => {
  const [firstDirectory, secondDirectory] = await Promise.all([
    mkdtemp(join(tmpdir(), "ez-runner-first-")),
    mkdtemp(join(tmpdir(), "ez-runner-second-")),
  ]);
  const token = "test-service-credential-32-bytes-minimum";
  const runner = { inspect: async (id: string) => ({ id, state: "running", diagnostics: [] }) } as unknown as Runner;
  const [first, second] = await Promise.all([
    startRunnerService({ runner, socketPath: join(firstDirectory, "runner.sock"), token, allowedUid: process.getuid!() }),
    startRunnerService({ runner, socketPath: join(secondDirectory, "runner.sock"), token, allowedUid: process.getuid!() }),
  ]);
  try {
    await expect(new RunnerClient({ socketPath: join(firstDirectory, "runner.sock"), token }).inspect("first")).resolves.toMatchObject({ id: "first" });
    await expect(new RunnerClient({ socketPath: join(secondDirectory, "runner.sock"), token }).inspect("second")).resolves.toMatchObject({ id: "second" });
  } finally {
    await Promise.all([first.close(), second.close()]);
    await Promise.all([rm(firstDirectory, { recursive: true, force: true }), rm(secondDirectory, { recursive: true, force: true })]);
  }
});

test("a rejected duplicate service preserves the active public socket", async () => {
  const directory = await mkdtemp("/tmp/ez-runner-active-");
  const socketPath = join(directory, "runner.sock");
  const token = "test-service-credential-32-bytes-minimum";
  const runner = { inspect: async (id: string) => ({ id, state: "running", diagnostics: [] }) } as unknown as Runner;
  const options = { runner, socketPath, token, allowedUid: process.getuid!() };
  const service = await startRunnerService(options);
  try {
    const before = await lstat(socketPath);
    await expect(startRunnerService(options)).rejects.toThrow("Unix peer gateway exited");
    expect((await lstat(socketPath)).ino).toBe(before.ino);
    await expect(new RunnerClient({ socketPath, token }).inspect("original")).resolves.toMatchObject({ id: "original" });
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
