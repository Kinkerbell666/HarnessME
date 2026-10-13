import { workspaceText, type WorkspaceFiles } from "@ezcorp/extension-contract";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PodmanRunner, buildLimits, executionLimits, filesDigest, resolveDependencies } from "../src";
import { manifest, provision, source } from "./helpers";
import { command } from "../src/core";
import { scaffoldWorkspace } from "@ezcorp/sdk/scaffold";

let root: string;
let runner: PodmanRunner;
let artifactDigest: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ez-runner-test-"));
  runner = new PodmanRunner({ root, ...await provision() });
  await runner.initialize();
}, 60_000);
afterAll(async () => { await runner.close(); await rm(root, { recursive: true, force: true }); });

test("authoring scaffold builds with private service umask", async () => {
  const previous = process.umask(0o077);
  try {
    const files = scaffoldWorkspace({ name: "private-scaffold", description: "Public SDK workspace" }).files;
    files["src/union.ts"] = "type Outcome={ok:true;value:string}|{ok:false;error:string};export function read(outcome:Outcome){if(!outcome.ok)return outcome.error;return outcome.value}";
    files["src/import.ts"] = "import {read} from './union.ts'; export const value=read({ok:true,value:'typed-import'});";
    files["contract.test.ts"] = "import {test,expect} from 'bun:test';import {canonicalJson,validateManifest} from '@ezcorp/extension-contract';test('sealed contract runtime',()=>expect(canonicalJson({b:1,a:2})).toBe('{\"a\":2,\"b\":1}'));";
    const result = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
    expect(result.diagnostics).toEqual([]);
    expect(result.state).toBe("succeeded");
  } finally { process.umask(previous); }
}, 120_000);

test("real isolated build, typecheck, feature tests, discovery, invocation and restart", async () => {
  const files = source("async (input,ctx) => ({...(input as Record<string,unknown>), broker: await ctx.call('storage.get',{key:'fixture'})})");
  const build = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
  expect(build.diagnostics).toEqual([]);
  expect(build.state).toBe("succeeded");
  expect(build.evidence.tests.map(test => test.name)).toEqual(["typecheck", "compile", "feature:feature.test.ts", "metadata-discovery"]);
  artifactDigest = build.artifactDigest!;
  expect(filesDigest(await runner.collectArtifacts(artifactDigest))).toBe(artifactDigest);
  const workerId = randomUUID();
  const context = { workerId, invocationId: randomUUID(), releaseId: artifactDigest, principalId: "user-a", scopeId: "scope-a", token: "test-token", deadline: Date.now() + 30_000 };
  const worker = await runner.start({ workerId, artifactDigest, context, limits: executionLimits }, async (method, params) => { expect(method).toBe("storage.get"); expect(params).toEqual({ context, input: { key: "fixture" } }); return "value"; });
  try { expect(await worker.request("extension/invoke", { name: "echo", input: { text: "hello" }, context })).toEqual({ text: "hello", broker: "value" }); } finally { await worker.close(); }
  const restarted = new PodmanRunner({ root });
  expect(await restarted.collectArtifacts(artifactDigest)).toEqual(await runner.collectArtifacts(artifactDigest));
}, 120_000);

/** Observes the fail-closed kernel probe so a build or attach cannot silently skip it. */
class ProbeObservingRunner extends PodmanRunner {
  readonly sweeps: boolean[] = [];
  protected override async probeSecurity(cleanupOrphans = true): Promise<void> {
    this.sweeps.push(cleanupOrphans);
    await super.probeSecurity(cleanupOrphans);
  }
}

test("a first build on a fresh runner prepares its artifact store, probes kernel isolation, and sweeps nothing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ez-runner-first-build-"));
  const fresh = new ProbeObservingRunner({ root: directory, ...await provision() });
  try {
    const files = source("async input => input");
    const built = await fresh.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
    expect(built.diagnostics).toEqual([]);
    expect(built.state).toBe("succeeded");
    // The probe ran, so isolation is verified, but a lazy build never sweeps:
    // with detached execution a container may legitimately outlive its starter.
    expect(fresh.sweeps).toEqual([false]);
    expect((await lstat(join(directory, "artifacts"))).mode & 0o777).toBe(0o700);
    expect(await fresh.collectArtifacts(built.artifactDigest!)).toMatchObject({ "extension.ts": files["extension.ts"]! });
  } finally { await fresh.close(); await rm(directory, { recursive: true, force: true }); }
}, 120_000);

test("only explicit daemon startup sweeps orphaned containers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ez-runner-startup-"));
  const started = new ProbeObservingRunner({ root: directory, ...await provision() });
  try {
    await started.initialize();
    expect(started.sweeps).toEqual([true]);
    expect((await lstat(join(directory, "artifacts"))).mode & 0o777).toBe(0o700);
  } finally { await started.close(); await rm(directory, { recursive: true, force: true }); }
}, 120_000);

test("a SIGKILLed supervisor leaves one guest that a fresh supervisor attaches and cancels", async () => {
  const files = source("async input => input");
  const build = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
  expect(build.state).toBe("succeeded");
  await runner.close();
  const workerId = `recover-${randomUUID()}`;
  const context = { workerId, invocationId: randomUUID(), releaseId: build.artifactDigest!, principalId: "recovery", scopeId: "recovery", token: "recovery-token", deadline: Date.now() + 60_000 };
  const childCode = `import {PodmanRunner} from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).pathname)};const [root,workerId,artifact,context]=process.argv.slice(1);const runner=new PodmanRunner({root});await runner.start({workerId,artifactDigest:artifact,context:JSON.parse(context),limits:{memoryBytes:536870912,cpuMillis:1000,pids:64,tmpBytes:67108864,outputBytes:1048576,timeoutMs:60000}},async()=>null);console.log('READY');await new Promise(()=>{});`;
  const child = Bun.spawn([process.execPath, "-e", childCode, root, workerId, build.artifactDigest!, JSON.stringify(context)], { stdout: "pipe", stderr: "pipe" });
  try {
    const first = await child.stdout.getReader().read();
    const output = new TextDecoder().decode(first.value);
    if (!output.includes("READY")) throw new Error(`crashed supervisor did not start guest: ${await new Response(child.stderr).text()}`);
  } finally { child.kill("SIGKILL"); await child.exited; }
  const fresh = new ProbeObservingRunner({ root });
  try {
    // The kill and its pipe closure are observed facts, not elapsed time: the
    // child has exited above. The guest's stdin is a FIFO its in-guest shim
    // holds O_RDWR, so losing the supervisor cannot reach it as end-of-input.
    expect(await fresh.inspect(workerId)).toMatchObject({ state: "running" });
    const _attached = await fresh.attach({ workerId, artifactDigest: build.artifactDigest!, context, limits: executionLimits }, async () => { throw new Error("recovery must not repeat effects"); });
    // Recovery creates no container of its own: no probe, and so no sweep.
    expect(fresh.sweeps).toEqual([]);
    expect(await fresh.inspect(workerId)).toMatchObject({ state: "running" });
    await fresh.cancel(workerId);
    expect(await fresh.inspect(workerId)).toMatchObject({ state: "cancelled" });
    await expect(command("podman", ["inspect", `ez-v4-${createHash("sha256").update(`${root}:${workerId}`).digest("hex").slice(0, 32)}`])).rejects.toThrow();
  } finally { await fresh.close(); }
}, 120_000);

test("the superseded stdin channel is what used to kill the guest with its supervisor", async () => {
  // Controlled fault for the case above. It reproduces the previous transport
  // exactly: a detached container whose stdin is a `podman attach` stream held
  // by a supervisor process. Killing that supervisor closes the stream, podman
  // forwards the end-of-input, and the guest dies. Without the FIFO channel the
  // preceding test's `running` assertion is a race, not a property.
  // `--log-driver=none` is part of that transport, and it keeps the fault off
  // the host's default log driver: the CI's pinned conmon has no journald.
  const name = `ez-v4-stdin-fault-${randomUUID().slice(0, 12)}`;
  const guest = 'process.stdin.on("data",()=>{});process.stdin.on("end",()=>process.exit(7));setInterval(()=>{},1000)';
  await command("podman", ["run", "--detach", "-i", "--name", name, "--pull=never", "--network=none", "--log-driver=none", "--entrypoint=/usr/local/bin/bun", (await import("../src")).DEFAULT_IMAGE, "-e", guest]);
  try {
    const holder = `const a=Bun.spawn(["podman","attach",${JSON.stringify(name)}],{stdin:"pipe",stdout:"pipe",stderr:"pipe"});console.log("HELD");await new Promise(()=>{});`;
    const supervisor = Bun.spawn([process.execPath, "-e", holder], { stdout: "pipe", stderr: "pipe" });
    await supervisor.stdout.getReader().read();
    expect((await command("podman", ["inspect", "--format={{.State.Status}}", name])).trim()).toBe("running");
    supervisor.kill("SIGKILL");
    await supervisor.exited;
    // Poll the container's own state, not a clock, until it settles. Podman
    // reports "stopped" or "exited" depending on how far teardown has got; both
    // are terminal and neither is "running", which is the property under test.
    const settled = new Set(["stopped", "exited"]);
    let status = "";
    for (let attempt = 0; attempt < 120 && !settled.has(status); attempt++) {
      status = (await command("podman", ["inspect", "--format={{.State.Status}}", name])).trim();
    }
    expect(settled.has(status)).toBe(true);
    // Exit code 7 is the guest's own end-of-input handler, so this names the
    // cause precisely rather than observing that the container merely stopped.
    expect((await command("podman", ["inspect", "--format={{.State.ExitCode}}", name])).trim()).toBe("7");
  } finally { await command("podman", ["rm", "--force", "--time=0", "--ignore", name]); }
}, 120_000);

test("a sandboxed guest cannot unlink, rename, or symlink-swap a channel entry, and the host refuses a substituted one", async () => {
  const { runnerChannelMount, DEFAULT_IMAGE } = await import("../src/podman");
  const directory = await mkdtemp(join(tmpdir(), "ez-channel-attack-"));
  const name = `ez-v4-channel-attack-${randomUUID().slice(0, 12)}`;
  try {
    await chmod(directory, 0o755);
    await command("mkfifo", ["-m", "666", join(directory, "in")]);
    const created = await lstat(join(directory, "in"));
    expect(created.isFIFO()).toBe(true);

    // Exactly the production guest profile, with the production mount builder so
    // the test cannot drift from what podman.ts ships.
    const attack = `const fs=require("node:fs");const r={};
const t=(k,f)=>{try{f();r[k]="allowed"}catch(e){r[k]=e.code||"error"}};
t("openReadWrite",()=>{const fd=fs.openSync("/channel/in","r+");fs.closeSync(fd)});
t("unlink",()=>fs.unlinkSync("/channel/in"));
t("symlinkSwap",()=>fs.symlinkSync("/etc/passwd","/channel/evil"));
t("rename",()=>fs.renameSync("/channel/in","/channel/moved"));
t("createRegular",()=>fs.writeFileSync("/channel/planted","x"));
console.log(JSON.stringify(r));`;
    const output = await command("podman", ["run", "--rm", "--name", name, "--pull=never", "--network=none", "--read-only", "--read-only-tmpfs=false",
      "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=65534:65534", "--pid=private", "--ipc=private", "--no-hosts", "--log-driver=none",
      "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=16777216,mode=1777", ...runnerChannelMount(directory),
      "--entrypoint=/usr/local/bin/bun", DEFAULT_IMAGE, "-e", attack]);
    const result = JSON.parse(output) as Record<string, string>;

    // A read-only mount still permits opening the FIFO read-write, which is what
    // makes the hardened channel usable at all.
    expect(result.openReadWrite).toBe("allowed");
    // Every directory-entry mutation the validator's proof of concept relied on
    // is refused by the kernel, not by convention.
    for (const denied of ["unlink", "symlinkSwap", "rename", "createRegular"]) {
      expect(["EROFS", "EACCES", "EPERM"]).toContain(result[denied]!);
    }
    // The entry the host would open is still the FIFO it created.
    const after = await lstat(join(directory, "in"));
    expect(after.isFIFO()).toBe(true);
    expect(after.ino).toBe(created.ino);
  } finally {
    await command("podman", ["rm", "--force", "--time=0", "--ignore", name]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

test("a guest writes real bytes to its material mount and the host reads them back without following anything", async () => {
  const { listRunnerMaterials, openRunnerMaterial } = await import("../src/materials");
  const materials = await mkdtemp(join(tmpdir(), "ez-runner-materials-"));
  const files = source(`async () => {
    const fs = require("node:fs");
    // The guest source is type-checked by the build, so this is strict TypeScript.
    const step: Record<string, unknown> = {};
    const run = (name: string, action: () => unknown) => { try { step[name] = action(); } catch (error) { step[name] = String((error as { code?: string } | undefined)?.code ?? error); } };
    run("readInput", () => (JSON.parse(fs.readFileSync("/materials/input.json", "utf8")) as { seed: number }).seed);
    run("report", () => { fs.writeFileSync("/materials/report.json", JSON.stringify({ rows: step.readInput })); return "ok"; });
    run("partition", () => { fs.mkdirSync("/materials/partitions"); fs.writeFileSync("/materials/partitions/part-0.bin", "0123456789"); return "ok"; });
    // A guest CAN do this; the host's reader is what refuses to follow it. Every
    // step reports its outcome rather than throwing, so a failure names itself
    // instead of arriving as a generic handler error.
    run("planted", () => { fs.symlinkSync("/etc/passwd", "/materials/escape"); return "yes"; });
    return { complete: true, step };
  }`);
  try {
    // The caller creates the directory 0o700 and does nothing else to it. No
    // mode or ownership change happens on this side: the runner performs the
    // handover itself, which is the whole point of this case.
    await chmod(materials, 0o700);
    // An input the caller placed before the start must still be readable. The
    // mode is set explicitly after the write because a process umask silently
    // strips the mode argument, which is why the runner's own staging does the
    // same: measured here as the guest reading EACCES on a 0o600 file.
    await writeFile(join(materials, "input.json"), JSON.stringify({ seed: 7 }));
    await chmod(join(materials, "input.json"), 0o644);
    const build = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
    expect(build.state).toBe("succeeded");
    const workerId = `materials-${randomUUID()}`;
    const context = { workerId, invocationId: randomUUID(), releaseId: build.artifactDigest!, principalId: "owner", scopeId: "global", token: "materials-token", deadline: Date.now() + 60_000 };
    const worker = await runner.start({ workerId, artifactDigest: build.artifactDigest!, context, limits: executionLimits, materials }, async () => null);
    try {
      // The guest reports that it really could create the symlink, so the
      // host-side refusal below is a refusal of something that happened.
      expect(await worker.request("extension/invoke", { name: "echo", input: {}, context }))
        .toEqual({ complete: true, step: { readInput: 7, report: "ok", partition: "ok", planted: "yes" } });
    } finally { await worker.close(); }

    // The guest really planted the link, so the refusal below is not vacuous.
    expect((await lstat(join(materials, "escape"))).isSymbolicLink()).toBe(true);
    await expect(listRunnerMaterials(materials)).rejects.toThrow("symbolic link");

    // With the link removed, the ordinary files round-trip exactly.
    await rm(join(materials, "escape"));
    expect(await listRunnerMaterials(materials)).toEqual([
      { path: "input.json", bytes: 10 },
      { path: "partitions/part-0.bin", bytes: 10 },
      { path: "report.json", bytes: 10 },
    ]);
    const handle = await openRunnerMaterial(materials, "report.json");
    try { expect(JSON.parse((await handle.readFile()).toString())).toEqual({ rows: 7 }); }
    finally { await handle.close(); }
  } finally {
    // A guest's subdirectories belong to a mapped subuid, so the host cannot
    // write into them and an ordinary recursive remove fails with EACCES. The
    // removal runs inside the user namespace instead, and never throws from
    // here: cleanup must not mask the assertions above.
    await command("podman", ["unshare", "rm", "-rf", materials]).catch(() => undefined);
    await rm(materials, { recursive: true, force: true }).catch(() => undefined);
  }
}, 180_000);

test("the runner's material handover leaves the directory closed to everyone but the guest and itself", async () => {
  const { listRunnerMaterials } = await import("../src/materials");
  const materials = await mkdtemp(join(tmpdir(), "ez-runner-handover-"));
  const files = source(`async () => { require("node:fs").writeFileSync("/materials/ok.bin", "x"); return { complete: true }; }`);
  try {
    await chmod(materials, 0o700);
    const build = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
    expect(build.state).toBe("succeeded");
    const workerId = `handover-${randomUUID()}`;
    const context = { workerId, invocationId: randomUUID(), releaseId: build.artifactDigest!, principalId: "owner", scopeId: "global", token: "handover-token", deadline: Date.now() + 60_000 };
    const worker = await runner.start({ workerId, artifactDigest: build.artifactDigest!, context, limits: executionLimits, materials }, async () => null);
    try { expect(await worker.request("extension/invoke", { name: "echo", input: {}, context })).toEqual({ complete: true }); }
    finally { await worker.close(); }

    const handed = await lstat(materials);
    // Exactly 0o770: the guest owns it, the runner's group reaches it, and the
    // rest of the host gets nothing. Never 0o777, and never world-readable.
    expect(handed.mode & 0o777).toBe(0o770);
    expect(handed.mode & 0o007).toBe(0);
    // Ownership moved to the guest's mapped uid, away from the runner, while the
    // group stayed the runner's so it can still read the results back.
    expect(handed.uid).not.toBe(process.getuid?.());
    expect(handed.gid).toBe(process.getgid!());
    // And the runner really can still read what the guest wrote.
    expect(await listRunnerMaterials(materials)).toEqual([{ path: "ok.bin", bytes: 1 }]);
  } finally {
    await command("podman", ["unshare", "rm", "-rf", materials]).catch(() => undefined);
    await rm(materials, { recursive: true, force: true }).catch(() => undefined);
  }
}, 180_000);

test("a material directory the runner does not own refuses the start and launches nothing", async () => {
  const workerId = `refused-${randomUUID()}`;
  const context = { workerId, invocationId: randomUUID(), releaseId: artifactDigest, principalId: "owner", scopeId: "global", token: "refused-token", deadline: Date.now() + 60_000 };
  // `/` is owned by root on every host this runs on, and the runner is never
  // root, so the handover must refuse it rather than chmod the filesystem root.
  const refused = await runner.start({ workerId, artifactDigest, context, limits: executionLimits, materials: "/" }, async () => null)
    .then(() => undefined, (error: unknown) => error as { code?: string; message?: string });
  expect(refused?.code).toBe("material_directory_invalid");
  expect(refused?.message).toContain("is not owned by the runner");

  // Nothing was launched: no container carries this worker's name.
  const name = `ez-v4-${(await import("../src/core")).sha256(`${root}:${workerId}`).slice(0, 32)}`;
  expect(await command("podman", ["ps", "-a", "--filter", `name=${name}`, "--format={{.Names}}"])).toBe("");
  // And the filesystem root is untouched.
  expect((await lstat("/")).uid).toBe(0);
}, 120_000);

test("real isolated worker drains admitted host calls before invocation teardown", async () => {
  const files = source("(_input,ctx) => { void ctx.call('lifetime.probe',{}).catch(()=>undefined); return {complete:true}; }");
  const build = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
  expect(build.diagnostics).toEqual([]);
  expect(build.state).toBe("succeeded");
  const workerId = randomUUID();
  const context = { workerId, invocationId: randomUUID(), releaseId: build.artifactDigest!, principalId: "owner", scopeId: "global", token: "lifetime-test", deadline: Date.now() + 30_000 };
  const hostStarted = Promise.withResolvers<void>();
  const hostFinished = Promise.withResolvers<void>();
  const worker = await runner.start({ workerId, artifactDigest: build.artifactDigest!, context, limits: executionLimits }, async (method, params) => {
    expect(method).toBe("lifetime.probe");
    expect(params).toEqual({ context, input: {} });
    hostStarted.resolve();
    await hostFinished.promise;
    return null;
  });
  try {
    let settled = false;
    const invocation = worker.request("extension/invoke", { name: "echo", input: {}, context }).finally(() => { settled = true; });
    await hostStarted.promise;
    expect(await worker.request("extension/discover", {})).toMatchObject({ name: "runner-test" });
    expect(settled).toBe(false);
    hostFinished.resolve();
    expect(await invocation).toEqual({ complete: true });
  } finally {
    hostFinished.resolve();
    await worker.close();
  }
}, 120_000);

test("public SDK subpaths share runtime registration and ship checked declarations", async () => {
  const files = source();
  files["extension.ts"] = `import {serve} from '@ezcorp/sdk/v4'; import {createRuntimeExtension} from '@ezcorp/sdk/v4/runtime'; import {createToolDispatcher,toolResult} from '@ezcorp/sdk/runtime'; await serve(await createRuntimeExtension({manifest:${JSON.stringify(manifest)},register:()=>createToolDispatcher({echo:()=>toolResult('shared runtime')})}));`;
  const result = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
  expect(result.diagnostics).toEqual([]);
  expect(result.state).toBe("succeeded");
  const workerId = randomUUID();
  const context = { workerId, invocationId: randomUUID(), releaseId: result.artifactDigest!, principalId: "owner", scopeId: "global", token: "runtime-test", deadline: Date.now() + 30_000 };
  const execution = await runner.start({ workerId, artifactDigest: result.artifactDigest!, context, limits: executionLimits }, async () => { throw new Error("Unexpected reverse request"); });
  try { expect(await execution.request("extension/invoke", { name: "echo", input: {}, context })).toMatchObject({ content: [{ type: "text", text: "shared runtime" }] }); }
  finally { await execution.close(); }
}, 120_000);

test("same frozen input produces identical artifacts", async () => {
  const files = source();
  const first = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
  const second = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
  expect(first.diagnostics).toEqual([]);
  expect(second.diagnostics).toEqual([]);
  expect(first.artifactDigest).toBe(second.artifactDigest);
}, 120_000);

test("failed cleanup is reported and retained containers are retried at shutdown", async () => {
  class CleanupFailureRunner extends PodmanRunner {
    failWorker: string | undefined;
    protected override async remove(id: string): Promise<void> {
      if (id === this.failWorker) { this.failWorker = undefined; throw new Error("Injected cleanup failure"); }
      await super.remove(id);
    }
  }
  const directory = await mkdtemp(join(tmpdir(), "ez-runner-cleanup-"));
  const isolated = new CleanupFailureRunner({ root: directory, ...await provision() });
  try {
    const files = source("async () => { process.exit(0); }");
    const built = await isolated.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
    expect(built.diagnostics).toEqual([]);
    const workerId = randomUUID();
    const context = { workerId, invocationId: randomUUID(), releaseId: built.artifactDigest!, principalId: "owner", scopeId: "global", token: "cleanup-test", deadline: Date.now() + 30_000 };
    const worker = await isolated.start({ workerId, artifactDigest: built.artifactDigest!, context, limits: executionLimits }, async () => null);
    isolated.failWorker = workerId;
    const exited = worker.exited.then(code => code, error => error as Error);
    await expect(worker.request("extension/invoke", { name: "echo", input: {}, context })).rejects.toThrow();
    expect(await exited).toMatchObject({ message: "Injected cleanup failure" });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(await isolated.inspect(workerId)).toMatchObject({ state: "failed", diagnostics: [{ code: "cleanup_failed" }] });
    await isolated.close();
    const name = `ez-v4-${(await import("../src/core")).sha256(`${directory}:${workerId}`).slice(0, 32)}`;
    expect(await command("podman", ["ps", "-a", "--filter", `name=${name}`, "--format={{.Names}}"])).toBe("");
  } finally { await isolated.close(); await rm(directory, { recursive: true, force: true }); }
}, 120_000);

test("type errors, absent, skipped and failing tests cannot produce a release", async () => {
  const cases: WorkspaceFiles[] = [ { ...source(), "broken.ts": "const count:number='bad';" }, { "extension.ts": source()["extension.ts"]! }, { ...source(), "feature.test.ts": "import {test,expect} from 'bun:test';test('fail',()=>expect(1).toBe(2));" }, { ...source(), "feature.test.ts": "import {test} from 'bun:test';test.skip('skip',()=>{});" }, { ...source(), "feature.test.ts": "console.log('PASS');process.exit(0);" } ];
  for (const files of cases) {
    const result = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
    expect(result.state).toBe("failed");
    expect(result.artifactDigest).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  }
}, 120_000);

test("malicious build source cannot change a host file or obtain host environment", async () => {
  const files = source(`async () => {const fs=await import('node:fs');const host=fs.existsSync(${JSON.stringify(root)});let writable=true;try{fs.writeFileSync('/workspace/assets/greeting.txt','changed')}catch{writable=false};let network=true;try{await fetch('http://169.254.169.254/latest/meta-data/',{signal:AbortSignal.timeout(1000)})}catch{network=false};return {host,writable,network,uid:process.getuid!(),secret:process.env.EZ_RUNNER_HOST_SECRET??null}}`);
  process.env.EZ_RUNNER_HOST_SECRET = "not-for-extension";
  const result = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
  expect(result.diagnostics).toEqual([]);
  const workerId = randomUUID();
  const context = { workerId, invocationId: randomUUID(), releaseId: result.artifactDigest!, principalId: "user-a", scopeId: "scope-a", token: "test-token", deadline: Date.now() + 20_000 };
  const worker = await runner.start({ workerId, artifactDigest: result.artifactDigest!, context, limits: executionLimits }, async () => null);
  try { expect(await worker.request("extension/invoke", { name: "echo", input: {}, context })).toEqual({ host: false, writable: false, network: false, uid: 65534, secret: null }); } finally { delete process.env.EZ_RUNNER_HOST_SECRET; await worker.close(); }
}, 120_000);

test("runner rejects mutable image tags and never falls back", async () => {
  expect(() => new PodmanRunner({ root, image: "oven/bun:latest" })).toThrow("immutable");
  await expect(new PodmanRunner({ root, podman: "/no/such/podman" }).initialize()).rejects.toThrow("Another runner");
  const unavailableRoot = await mkdtemp(join(tmpdir(), "ez-no-podman-"));
  try { await expect(new PodmanRunner({ root: unavailableRoot, podman: "/no/such/podman" }).initialize()).rejects.toThrow(); } finally { await rm(unavailableRoot, { recursive: true, force: true }); }
});

test("locked dependency is bundled offline and retained in immutable release", async () => {
  const files = await resolveDependencies({ ...source("async input=>({numeric:(await import('is-number')).default((input as {value:unknown}).value)})"), "package.json": JSON.stringify({ dependencies: { "is-number": "7.0.0" } }) });
  const result = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
  expect(result.diagnostics).toEqual([]);
  const artifacts = await runner.collectArtifacts(result.artifactDigest!);
  expect(JSON.parse(workspaceText(artifacts[".runner/dependencies.json"], ".runner/dependencies.json"))["node_modules/is-number/index.js"]).toBeDefined();
}, 60_000);

test("kernel PID, temporary storage, memory and descendant cancellation limits hold", async () => {
  const files = source(`async (value) => {
    const input = value as {action:string};
    if(input.action==='oom'){const values:Uint8Array[]=[];while(true){values.push(new Uint8Array(8*1024*1024).fill(123));await Bun.sleep(1)}}
    if(input.action==='disk'){try{await Bun.write('/tmp/full',new Uint8Array(20*1024*1024));return {limited:false}}catch{return {limited:true}}}
    const children:{kill:()=>void}[]=[];let spawnFailure:string|null=null;try{for(let index=0;index<100;index++)children.push(Bun.spawn(['/bin/sleep','60'],{stdout:'ignore',stderr:'ignore'}))}catch(error){spawnFailure=String((error as NodeJS.ErrnoException).code)};
    if(input.action==='pids'){for(const child of children)child.kill();return {children:children.length,spawnFailure}}
    await new Promise(()=>{});return {};
  }`);
  const result = await runner.build({ operationId: randomUUID(), files, sourceDigest: filesDigest(files), entrypoint: "extension.ts", limits: buildLimits });
  expect(result.diagnostics).toEqual([]);
  for (const action of ["disk", "pids", "cancel", "oom"]) {
    const workerId = randomUUID();
    const context = { workerId, invocationId: randomUUID(), releaseId: result.artifactDigest!, principalId: "user-a", scopeId: "scope-a", token: "test-token", deadline: Date.now() + 20_000 };
    const limits = { ...executionLimits, memoryBytes: 128 * 1024 ** 2, pids: 32, tmpBytes: 8 * 1024 ** 2 };
    const worker = await runner.start({ workerId, artifactDigest: result.artifactDigest!, context, limits }, async () => null);
    const pending = worker.request("extension/invoke", { name: "echo", input: { action }, context });
    if (action === "disk") expect(await pending).toEqual({ limited: true });
    else if (action === "pids") { const output = await pending as { children: number; spawnFailure: string | null }; expect(output.children).toBeLessThan(32); expect(output.children).toBeGreaterThan(0); expect(output.spawnFailure).toBe("EAGAIN"); }
    else if (action === "cancel") { const rejected = expect(pending).rejects.toThrow(); await Bun.sleep(300); await runner.cancel(workerId); await rejected; }
    else { await expect(pending).rejects.toThrow(); await worker.exited; expect((await runner.inspect(workerId)).diagnostics.some(diagnostic => diagnostic.code === "memory_limit")).toBe(true); }
    await worker.close();
    expect(await command("podman", ["ps", "-a", "--filter", `name=ez-v4-${(await import('../src/core')).sha256(`${root}:${workerId}`).slice(0,32)}`, "--format={{.Names}}"])).toBe("");
  }
}, 120_000);
