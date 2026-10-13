import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { after, before, describe, it } from "node:test";
import { MockActivityEnvironment, TestWorkflowEnvironment } from "@temporalio/testing";
import type { CommandExecution } from "../src/contracts.ts";
import { createGatewayFactoryActivities, createGatewayTransport, type GatewayTlsSecretPaths } from "../src/gateway-activities.ts";
import { createGatewayFactoryCommandQueue } from "../src/queue-client.ts";
import { factoryOrchestratorProductionDependencies, runFactoryOrchestratorProcess, type FactoryOrchestratorProcessOptions } from "../src/process.ts";
import { createGatewayTransport as createSharedTransport } from "../../factory-transport/src/index.ts";

const sha256 = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
let directory = "";
let origin = "";
let port = 0;
let server: Server;
let mode = "normal";
let expectedClientCn = "factory-orchestrator";
let expectedToken = "gateway-token";
let queueClaimBody: unknown;
let paths: GatewayTlsSecretPaths;
interface RecordedCall {
  readonly method: string | undefined;
  readonly path: string | undefined;
  readonly authorization: string | undefined;
  readonly version: string | string[] | undefined;
  readonly body: Buffer;
}
const calls: RecordedCall[] = [];
function lastCall(): RecordedCall {
  const call = calls.at(-1);
  assert.ok(call, "expected a recorded gateway call");
  return call;
}
function callBody(call: RecordedCall | undefined): unknown {
  assert.ok(call, "expected a recorded gateway call");
  return JSON.parse(call.body.toString("utf8"));
}
const definitionDigest = sha256("compiled-definition");
const definitionBody = Buffer.from(JSON.stringify({ digest: definitionDigest, partitions: [] }));
const definitionPage = { index: 0, objectId: "definition-page", digest: sha256(definitionBody), encodedBytes: definitionBody.byteLength };
const manifestBody = Buffer.from(JSON.stringify({ schemaVersion: "factory.manifest-page.v1", definitionDigest, definitionEncodedBytes: definitionBody.byteLength, pages: [definitionPage] }));
const manifest = { objectId: "manifest-page", digest: sha256(manifestBody), encodedBytes: manifestBody.byteLength };
const source = { definitionDigest, definitionEncodedBytes: definitionBody.byteLength, manifest };
const executionManifestBody = Buffer.from(JSON.stringify({ schemaVersion: "factory.execution-manifest.v1", factoryDigest: definitionDigest, inputPorts: {}, outputPorts: {}, bounds: { runDeadlineMs: 10, maxExpandedNodes: 10, maxScopeDepth: 2 }, outputs: {} }));
const executionManifest = { objectId: "execution-manifest", digest: sha256(executionManifestBody), encodedBytes: executionManifestBody.byteLength };
const partitionBody = Buffer.from(JSON.stringify({ schemaVersion: "factory.partition.v1", factoryDigest: definitionDigest, id: "partition-0", nodeIds: [], dependsOn: [], inbound: [], outbound: [], nodes: [] }));
const partition = { objectId: "partition-0", partitionId: "partition-0", digest: sha256(partitionBody), encodedBytes: partitionBody.byteLength };
const transitionPage = { index: 0, objectId: "transition-page", digest: sha256("page"), encodedBytes: 4 };
const transitionManifestValue = { schemaVersion: "factory.transition-manifest.v1", tenantId: "tenant", projectId: "project", logicalRunId: "run", interpreterId: "build", sourceSequence: 1, eventId: "start", eventHash: sha256("event"), encodedBytes: 4, pages: [transitionPage] };
const transitionManifestBody = Buffer.from(JSON.stringify(transitionManifestValue));
const finalizedTransition = { manifest: { objectId: "transition-manifest", digest: sha256(transitionManifestBody), encodedBytes: transitionManifestBody.byteLength }, eventHash: transitionManifestValue.eventHash };
const transitionManifest = { ...transitionManifestValue, self: finalizedTransition.manifest };
const loadedTransitionPage = { ...transitionPage, contentBase64: Buffer.from("page").toString("base64") };
const adversarialPageBody = Buffer.from(`${"\\\"".repeat(16_384)}`);
const adversarialPage = { index: 0, objectId: "adversarial-page", digest: sha256(adversarialPageBody), encodedBytes: adversarialPageBody.byteLength };

function openssl(...args: string[]) {
  execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
}

async function createPki() {
  directory = await mkdtemp(join(tmpdir(), "factory-mtls-"));
  await writeFile(join(directory, "server.ext"), "subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n");
  await writeFile(join(directory, "client.ext"), "extendedKeyUsage=clientAuth\n");
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-subj", "/CN=Factory Test CA", "-days", "1");
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=localhost");
  openssl("x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.pem", "-days", "1", "-extfile", "server.ext");
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "client.key", "-out", "client.csr", "-subj", "/CN=factory-orchestrator");
  openssl("x509", "-req", "-in", "client.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "client.pem", "-days", "1", "-extfile", "client.ext");
  await copyFile(join(directory, "client.key"), join(directory, "client-original.key"));
  await copyFile(join(directory, "client.pem"), join(directory, "client-original.pem"));
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "client-rotated.key", "-out", "client-rotated.csr", "-subj", "/CN=factory-orchestrator-rotated");
  openssl("x509", "-req", "-in", "client-rotated.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "client-rotated.pem", "-days", "1", "-extfile", "client.ext");
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "other-ca.key", "-out", "other-ca.pem", "-subj", "/CN=Other CA", "-days", "1");
  await writeFile(join(directory, "token"), "gateway-token\n", { mode: 0o600 });
  await writeFile(join(directory, "empty-token"), " \n", { mode: 0o600 });
  await writeFile(join(directory, "empty-cert"), "", { mode: 0o600 });
  paths = {
    caPath: join(directory, "ca.pem"), certificatePath: join(directory, "client.pem"),
    privateKeyPath: join(directory, "client.key"), serviceTokenPath: join(directory, "token"),
  };
}

async function readRequest(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

before(async () => {
  await createPki();
  server = createServer({
    key: await readFile(join(directory, "server.key")), cert: await readFile(join(directory, "server.pem")),
    ca: await readFile(join(directory, "ca.pem")), requestCert: true, rejectUnauthorized: true,
  }, async (request, response) => {
    const body = await readRequest(request);
    calls.push({ method: request.method, path: request.url, authorization: request.headers.authorization, version: request.headers["x-ezcorp-factory-version"], body });
    if (mode === "hang") return;
    if (mode === "drip") {
      response.writeHead(200);
      const interval = setInterval(() => response.write("x"), 5);
      response.once("close", () => clearInterval(interval));
      return;
    }
    if (mode === "http-error") { response.writeHead(503).end("unavailable"); return; }
    if (mode === "large") { response.writeHead(200).end("x".repeat(33 * 1024)); return; }
    if (mode === "invalid-json") { response.writeHead(200).end("not-json"); return; }
    const peer = (request.socket as TLSSocket).getPeerCertificate();
    if (peer.subject?.CN !== expectedClientCn) { response.writeHead(403).end(); return; }
    if (request.headers.authorization !== `Bearer ${expectedToken}`) { response.writeHead(401).end(); return; }
    if (request.url === "/internal/factory/v1/health") response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ schemaVersion: "factory.private-service.v1", tenantId: "tenant" }));
    else if (request.url === "/internal/factory/v1/outbox/claim") queueClaimBody === undefined ? response.writeHead(204).end() : response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(queueClaimBody));
    else if (request.url === "/internal/factory/v1/outbox/settle") response.writeHead(204).end();
    else if (request.url === "/internal/factory/v1/outbox/confirm-inbox") response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(mode !== "wrong-confirmation" ? true : "yes"));
    else if (request.url === "/internal/factory/v1/definitions/resolve") response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(mode === "wrong-resolve" ? { ...source, definitionDigest: sha256("wrong") } : source));
    else if (request.url === "/internal/factory/v1/definitions/manifest") response.writeHead(200, { "content-type": "application/json" }).end(manifestBody);
    else if (request.url === "/internal/factory/v1/definitions/page") response.writeHead(200, { "content-type": "application/octet-stream" }).end(mode === "adversarial-page" ? adversarialPageBody : definitionBody);
    else if (request.url === "/internal/factory/v1/definitions/execution-manifest") response.writeHead(200, { "content-type": "application/json" }).end(executionManifestBody);
    else if (request.url === "/internal/factory/v1/definitions/partition") response.writeHead(200, { "content-type": "application/json" }).end(partitionBody);
    else if (request.url === "/internal/factory/v1/transitions/1/pages/0") {
      const value = JSON.parse(body.toString("utf8"));
      const raw = Buffer.from(value.contentBase64, "base64");
      const page = { index: value.index, objectId: mode === "adversarial-page" ? "adversarial-page" : transitionPage.objectId, digest: sha256(raw), encodedBytes: raw.byteLength };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(mode === "wrong-transition-page" ? { ...page, index: 1 } : page));
    }
    else if (request.url === "/internal/factory/v1/transitions/1/finalize") response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(mode === "wrong-transition-finalize" ? { ...finalizedTransition, eventHash: "wrong" } : finalizedTransition));
    else if (request.url === "/internal/factory/v1/transitions/1/manifest") response.writeHead(200, { "content-type": "application/json" }).end(transitionManifestBody);
    else if (request.url === "/internal/factory/v1/transitions/1/page") response.writeHead(200, { "content-type": "application/octet-stream" }).end(mode === "adversarial-page" ? adversarialPageBody : "page");
    else if (request.url === "/internal/factory/v1/transitions") response.writeHead(204).end();
    else if (request.url?.includes("/cancel")) response.writeHead(204).end();
    else response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ kind: "admission-result", id: "event", atMs: 1, nodeId: "node", commandId: "command", candidateGeneration: 0, granted: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
  origin = `https://localhost:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

const identity = { tenantId: "tenant", projectId: "project", logicalRunId: "run", interpreterId: "build" };
const transition = { ...identity, sourceSequence: 1, eventId: "start", eventHash: finalizedTransition.eventHash, artifactManifest: finalizedTransition.manifest };
const activity = <P extends unknown[], R>(environment: MockActivityEnvironment, fn: (...args: P) => Promise<R>, ...args: P) => environment.run<P, R, typeof fn>(fn, ...args);

describe("authenticated factory gateway activities", () => {
  it("keeps production readiness closed when the real server cannot prove its task queue poller", { timeout: 30_000 }, async () => {
    mode = "normal";
    queueClaimBody = undefined;
    const temporal = await TestWorkflowEnvironment.createTimeSkipping({ server: { executable: {
      type: "existing-path",
      path: process.env.FACTORY_TEMPORAL_TEST_SERVER ?? "/tmp/factory-tools/temporal-test-server/temporal-test-server_1.38.0_linux_amd64/temporal-test-server",
    } } });
    const controller = new AbortController();
    const readiness: Parameters<FactoryOrchestratorProcessOptions["readiness"]["write"]>[0][] = [];
    const connection = Object.create(temporal.nativeConnection);
    Object.defineProperty(connection, "close", { value: async () => {} });
    try {
      await assert.rejects(runFactoryOrchestratorProcess({
        installationId: "installation", tenantId: "tenant", signal: controller.signal,
        temporal: {
          address: "unused", namespace: "default", serverName: "unused", caPath: "unused", certificatePath: "unused", privateKeyPath: "unused", apiKeyPath: "unused",
          credentialRefreshMs: 1_000, pollingProbeTimeoutMs: 1_000,
        },
        gateway: { baseUrl: origin, tls: paths, serverName: "localhost" },
        payloadCodec: { encode: async (values) => values, decode: async (values) => values },
        loadTemporalCredentials: async () => ({ ca: Buffer.from("ca"), certificate: Buffer.from("cert"), privateKey: Buffer.from("key"), apiKey: "token", tlsFingerprint: "tls" }),
        readiness: { write: async (state) => {
          readiness.push(state);
          return { schemaVersion: "factory.orchestrator-readiness.v1", installationId: "installation", tenantId: "tenant", namespace: "default", taskQueue: "factory-orchestrator", observedAtMs: Date.now(), ...state };
        } },
        readinessHeartbeatMs: 1_000,
      }, { ...factoryOrchestratorProductionDependencies, connect: async () => connection }), /process failed/);
      assert.deepEqual(readiness.map((state) => [state.lifecycle, state.workerPolling, state.dispatcherLive]), [
        ["starting", false, false], ["failed", false, false],
      ]);
      assert.equal(calls.some((call) => call.path === "/internal/factory/v1/health"), true);
    } finally {
      await temporal.teardown();
    }
  });

  it("shares a bounded credential-reloading HTTP transport without Temporal imports", async () => {
    mode = "normal";
    const options = { baseUrl: origin, tls: { ...paths }, requestTimeoutMs: 1000 };
    const opening = createSharedTransport(options);
    options.baseUrl = "https://untrusted.invalid";
    options.tls.serviceTokenPath = "missing";
    const transport = await opening;
    const body = { pinned: "original" };
    const sending = transport.request("POST", "/internal/factory/v1/commands/test", body);
    body.pinned = "changed";
    assert.equal((await sending).statusCode, 200);
    assert.deepEqual(callBody(calls.at(-1)), { pinned: "original" });
    assert.equal((await transport.request("GET", "/internal/factory/v1/outbox/claim")).statusCode, 204);
    for (const path of [`${origin}/x`, "//localhost/x", "/\\\\localhost/x", "/x#fragment", "/x y", "/x\r\nheader", "relative"]) {
      await assert.rejects(transport.request("GET", path), /path/);
    }
    for (const limit of [0, -1, 0.5, NaN, Infinity, 16 * 1024 * 1024 + 1]) {
      await assert.rejects(transport.request("GET", "/x", undefined, limit), /byte limit/);
    }
    await assert.rejects(transport.request("POST", "/x", { value: "large" }, 1), /request exceeds/);
    mode = "large";
    await assert.rejects(transport.request("GET", "/x", undefined, 10), /response exceeds/);
    mode = "http-error";
    await assert.rejects(transport.request("GET", "/x"), /HTTP 503/);
    mode = "normal";
    await assert.rejects(transport.request("GET", "/x", undefined, undefined, AbortSignal.abort(new Error("cancelled"))), /cancelled/);
    const short = await createSharedTransport({ baseUrl: origin, tls: paths, requestTimeoutMs: 30 });
    mode = "drip";
    await assert.rejects(short.request("GET", "/x"), /timed out/);
    mode = "hang";
    const controller = new AbortController();
    const pending = transport.request("GET", "/x", undefined, undefined, controller.signal);
    const abort = setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, /aborted/);
    clearTimeout(abort);
    mode = "normal";
    for (const baseUrl of ["http://localhost", `${origin}/path`, `${origin}?x=1`, `${origin}#x`, "https://user:pass@localhost"]) {
      await assert.rejects(createSharedTransport({ baseUrl, tls: paths }), /origin/);
    }
    for (const requestTimeoutMs of [0, -1, 0.5, NaN, Infinity, 300001]) {
      await assert.rejects(createSharedTransport({ baseUrl: origin, tls: paths, requestTimeoutMs }), /timeout/);
    }
    await assert.rejects(createSharedTransport({ baseUrl: origin, tls: { ...paths, serviceTokenPath: join(directory, "empty-token") } }), /empty/);
    try {
      await writeFile(paths.serviceTokenPath, "gateway-token-rotated\n", { mode: 0o600 });
      expectedToken = "gateway-token-rotated";
      assert.equal((await transport.request("GET", "/x")).statusCode, 200);
      await writeFile(paths.serviceTokenPath, "\n", { mode: 0o600 });
      await assert.rejects(transport.request("GET", "/x"), /empty/);
    } finally {
      expectedToken = "gateway-token";
      await writeFile(paths.serviceTokenPath, "gateway-token\n", { mode: 0o600 });
    }
    const defaults = await createSharedTransport({ baseUrl: origin, tls: paths, serverName: "localhost" });
    assert.equal((await defaults.request("GET", "/x")).statusCode, 200);
  });

  // The shared transport never sends an IP literal as the TLS server name (Bun 1.4 and Node refuse one; RFC 6066).
  // For the endpoint's own IP it sends none, and node:https verifies the certificate against that IP: this server's
  // certificate names only DNS:localhost, so the IP endpoint is refused by the certificate check, not by the name
  // rule. An explicit IP name that differs from the endpoint host would verify another identity, so it fails by name.
  it("an IP endpoint sends no IP server name and is verified against the IP; a different IP name fails by name", async () => {
    mode = "normal";
    const ipOrigin = `https://127.0.0.1:${port}`;
    const ownIp = await createSharedTransport({ baseUrl: ipOrigin, tls: paths });
    await assert.rejects(ownIp.request("GET", "/x"), (error: NodeJS.ErrnoException) => error.code === "ERR_TLS_CERT_ALTNAME_INVALID");
    await assert.rejects(
      createSharedTransport({ baseUrl: ipOrigin, tls: paths, serverName: "127.0.0.2" }),
      /factory_transport_server_name_ip_mismatch: server name 127\.0\.0\.2 is an IP address that is not the endpoint host 127\.0\.0\.1/,
    );
  });

  it("rejects caller URLs before sending private credentials", async () => {
    mode = "normal";
    const transport = await createGatewayTransport({ baseUrl: origin, tls: paths });
    const before = calls.length;
    await assert.rejects(transport.request("GET", `${origin}/internal/factory/v1/commands/x`), /path/);
    assert.equal(calls.length, before);
  });

  it("uses verified mutual TLS, scoped routes, and immutable page digests", async () => {
    mode = "normal";
    expectedClientCn = "factory-orchestrator";
    expectedToken = "gateway-token";
    calls.length = 0;
    const activities = await createGatewayFactoryActivities({ baseUrl: origin, tls: paths, requestTimeoutMs: 1_000 });
    const environment = new MockActivityEnvironment();
    assert.deepEqual(await activity(environment, activities.resolveFactory, { ...identity, commandId: "child-command", factory: { id: "child", version: "1", digest: definitionDigest } }), source);
    assert.deepEqual(await activity(environment, activities.loadManifestPage, { ...identity, definition: source, page: manifest }), { ...JSON.parse(manifestBody.toString("utf8")), self: manifest });
    assert.deepEqual(await activity(environment, activities.loadDefinitionPage, { ...identity, definitionDigest, page: definitionPage }), { index: 0, objectId: definitionPage.objectId, digest: definitionPage.digest, contentBase64: definitionBody.toString("base64") });
    assert.deepEqual(await activity(environment, activities.loadExecutionManifest, { ...identity, definitionDigest, manifest: executionManifest }), JSON.parse(executionManifestBody.toString("utf8")));
    assert.deepEqual(await activity(environment, activities.loadPartitionArtifact, { ...identity, definitionDigest, partition }), JSON.parse(partitionBody.toString("utf8")));
    assert.deepEqual(await activity(environment, activities.stageTransitionPage, { ...identity, sourceSequence: 1, index: 0, contentBase64: Buffer.from("page").toString("base64"), encodedBytes: 4 }), transitionPage);
    assert.deepEqual(await activity(environment, activities.finalizeTransitionArtifact, { ...identity, sourceSequence: 1, encodedBytes: 4, eventId: "start", pages: [transitionPage] }), finalizedTransition);
    assert.deepEqual(await activity(environment, activities.loadTransitionManifest, { ...identity, sourceSequence: 1, manifest: finalizedTransition.manifest }), transitionManifest);
    assert.deepEqual(await activity(environment, activities.loadTransitionPage, { ...identity, sourceSequence: 1, page: transitionPage }), loadedTransitionPage);
    assert.equal(await activity(environment, activities.recordTransition, transition), undefined);
    const admission: CommandExecution = { ...identity, command: { kind: "request-admission", id: "admit", nodeId: "node", candidateGeneration: 0, deadlineAtMs: 10 } };
    assert.equal((await activity(environment, activities.executeCommand, admission))?.kind, "admission-result");
    const dispatch: CommandExecution = { ...identity, command: { kind: "dispatch-node", id: "dispatch", nodeId: "node", candidateGeneration: 0, attempt: 1, input: {}, deadlineAtMs: 10, cancellationEpoch: 0 } };
    assert.equal((await activity(environment, activities.executeCommand, dispatch))?.kind, "admission-result");
    const cancel: CommandExecution = { ...identity, command: { kind: "cancel-node", id: "cancel", nodeId: "node", candidateGeneration: 0, attempt: 1, attemptCommandId: "dispatch", cancellationEpoch: 1 } };
    assert.equal(await activity(environment, activities.executeCommand, cancel), null);
    assert.deepEqual(calls.map((call) => [call.method, call.path]), [
      ["POST", "/internal/factory/v1/definitions/resolve"], ["POST", "/internal/factory/v1/definitions/manifest"],
      ["POST", "/internal/factory/v1/definitions/page"], ["POST", "/internal/factory/v1/definitions/execution-manifest"],
      ["POST", "/internal/factory/v1/definitions/partition"], ["PUT", "/internal/factory/v1/transitions/1/pages/0"],
      ["POST", "/internal/factory/v1/transitions/1/finalize"], ["POST", "/internal/factory/v1/transitions/1/manifest"],
      ["POST", "/internal/factory/v1/transitions/1/page"], ["POST", "/internal/factory/v1/transitions"],
      ["POST", "/internal/factory/v1/commands/admit"], ["PUT", "/internal/factory/v1/executions/dispatch"],
      ["POST", "/internal/factory/v1/executions/dispatch/cancel"],
    ]);
    assert.ok(calls.every((call) => call.authorization === "Bearer gateway-token" && call.version === "1"));
  });

  it("reloads the service token and client identity after credential rotation", async () => {
    mode = "normal";
    expectedClientCn = "factory-orchestrator";
    expectedToken = "gateway-token";
    const activities = await createGatewayFactoryActivities({ baseUrl: origin, tls: paths, requestTimeoutMs: 1_000 });
    const environment = new MockActivityEnvironment();
    const callCount = calls.length;
    await activity(environment, activities.recordTransition, transition);
    try {
      await copyFile(join(directory, "client-rotated.key"), paths.privateKeyPath);
      await copyFile(join(directory, "client-rotated.pem"), paths.certificatePath);
      await writeFile(paths.serviceTokenPath, "gateway-token-rotated\n", { mode: 0o600 });
      expectedClientCn = "factory-orchestrator-rotated";
      expectedToken = "gateway-token-rotated";
      await activity(environment, activities.recordTransition, transition);
    } finally {
      await copyFile(join(directory, "client-original.key"), paths.privateKeyPath);
      await copyFile(join(directory, "client-original.pem"), paths.certificatePath);
      await writeFile(paths.serviceTokenPath, "gateway-token\n", { mode: 0o600 });
      expectedClientCn = "factory-orchestrator";
      expectedToken = "gateway-token";
    }
    assert.equal(calls.length, callCount + 2);
    assert.equal(calls.at(-1)?.authorization, "Bearer gateway-token-rotated");
  });

  it("keeps a fully escaped 32 KiB page below the 64 KiB activity boundary", async () => {
    mode = "adversarial-page";
    const activities = await createGatewayFactoryActivities({ baseUrl: origin, tls: paths, requestTimeoutMs: 1_000 });
    const environment = new MockActivityEnvironment();
    const loaded = await activity(environment, activities.loadDefinitionPage, { ...identity, definitionDigest, page: adversarialPage });
    assert.deepEqual(Buffer.from(loaded.contentBase64, "base64"), adversarialPageBody);
    assert.ok(Buffer.byteLength(JSON.stringify(loaded)) < 64 * 1024);
    const request = { ...identity, sourceSequence: 1, index: 0, contentBase64: adversarialPageBody.toString("base64"), encodedBytes: adversarialPageBody.byteLength };
    assert.ok(Buffer.byteLength(JSON.stringify(request)) < 64 * 1024);
    assert.deepEqual(await activity(environment, activities.stageTransitionPage, request), adversarialPage);
    assert.deepEqual(await activity(environment, activities.loadTransitionPage, { ...identity, sourceSequence: 1, page: adversarialPage }), { ...adversarialPage, contentBase64: adversarialPageBody.toString("base64") });
    mode = "normal";
  });

  it("rejects no client certificate, an untrusted CA, and a hostname mismatch", async () => {
    mode = "normal";
    const environment = new MockActivityEnvironment();
    const noCertificate = await createGatewayFactoryActivities({ baseUrl: origin, tls: { ...paths, certificatePath: join(directory, "empty-cert") } });
    await assert.rejects(activity(environment, noCertificate.recordTransition, transition));
    const wrongCa = await createGatewayFactoryActivities({ baseUrl: origin, tls: { ...paths, caPath: join(directory, "other-ca.pem") } });
    await assert.rejects(activity(environment, wrongCa.recordTransition, transition));
    const wrongHost = await createGatewayFactoryActivities({ baseUrl: `https://127.0.0.1:${port}`, tls: paths });
    await assert.rejects(activity(environment, wrongHost.recordTransition, transition), /IP|altname|certificate/i);
  });

  it("fails closed on bad configuration, HTTP, JSON, digest, size, timeout, and cancellation", async () => {
    await assert.rejects(createGatewayFactoryActivities({ baseUrl: "http://localhost", tls: paths }), /private HTTPS/);
    await assert.rejects(createGatewayFactoryActivities({ baseUrl: `${origin}?secret=bad`, tls: paths }), /private HTTPS/);
    await assert.rejects(createGatewayFactoryActivities({ baseUrl: origin, tls: { ...paths, serviceTokenPath: join(directory, "empty-token") } }), /token is empty/);
    const activities = await createGatewayFactoryActivities({ baseUrl: origin, tls: paths, requestTimeoutMs: 20, heartbeatIntervalMs: 5 });

    mode = "http-error";
    await assert.rejects(activity(new MockActivityEnvironment(), activities.recordTransition, transition), /HTTP 503/);
    mode = "invalid-json";
    await assert.rejects(activity(new MockActivityEnvironment(), activities.resolveFactory, { ...identity, commandId: "child-command", factory: { id: "child", version: "1", digest: definitionDigest } }), /invalid JSON/);
    mode = "wrong-resolve";
    await assert.rejects(activity(new MockActivityEnvironment(), activities.resolveFactory, { ...identity, commandId: "child-command", factory: { id: "child", version: "1", digest: definitionDigest } }), /pinned child/);
    mode = "normal";
    await assert.rejects(activity(new MockActivityEnvironment(), activities.loadDefinitionPage, { ...identity, definitionDigest, page: { ...definitionPage, digest: sha256("wrong") } }), /immutable reference/);
    await assert.rejects(activity(new MockActivityEnvironment(), activities.loadExecutionManifest, { ...identity, definitionDigest, manifest: { ...executionManifest, digest: sha256("wrong") } }), /immutable reference/);
    await assert.rejects(activity(new MockActivityEnvironment(), activities.loadPartitionArtifact, { ...identity, definitionDigest, partition: { ...partition, digest: sha256("wrong") } }), /immutable reference/);
    mode = "wrong-transition-page";
    await assert.rejects(activity(new MockActivityEnvironment(), activities.stageTransitionPage, { ...identity, sourceSequence: 1, index: 0, contentBase64: Buffer.from("page").toString("base64"), encodedBytes: 4 }), /mismatched/);
    mode = "wrong-transition-finalize";
    await assert.rejects(activity(new MockActivityEnvironment(), activities.finalizeTransitionArtifact, { ...identity, sourceSequence: 1, encodedBytes: 4, eventId: "start", pages: [transitionPage] }), /event digest/);
    mode = "large";
    await assert.rejects(activity(new MockActivityEnvironment(), activities.loadDefinitionPage, { ...identity, definitionDigest, page: definitionPage }), /response exceeds/);
    mode = "normal";
    await assert.rejects(activity(new MockActivityEnvironment(), activities.recordTransition, { ...transition, artifactManifest: { ...transition.artifactManifest, objectId: "x".repeat(70_000) } }), /request exceeds/);
    mode = "hang";
    await assert.rejects(activity(new MockActivityEnvironment(), activities.recordTransition, transition), /timed out/);
    const cancelled = new MockActivityEnvironment();
    const pending = activity(cancelled, activities.recordTransition, transition);
    cancelled.cancel();
    await assert.rejects(pending, /abort|cancel/i);
    mode = "normal";
  });
});

describe("authenticated factory command queue", () => {
  const command = { commandId: "command", requestId: "command", tenantId: "tenant", projectId: "project", logicalRunId: "run", workflowId: "tenant/run", kind: "decision", interpreterId: "root", body: {} } as const;

  it("claims, settles, and confirms through the installation-scoped private routes", async () => {
    mode = "normal";
    expectedClientCn = "factory-orchestrator";
    expectedToken = "gateway-token";
    queueClaimBody = { claimToken: "claim-token", command };
    calls.length = 0;
    const queue = await createGatewayFactoryCommandQueue({ baseUrl: origin, tls: paths, requestTimeoutMs: 1_000 });
    const claim = await queue.claim();
    assert.deepEqual(claim, queueClaimBody);
    assert.ok(claim);
    await queue.settle(claim, "outcome_unknown", "TEMPORAL_UNAVAILABLE");
    assert.ok(queue.confirmInboxIdentity, "the gateway queue confirms inbox identities");
    assert.equal(await queue.confirmInboxIdentity(command), true);
    assert.deepEqual(calls.map((call) => call.path), [
      "/internal/factory/v1/outbox/claim", "/internal/factory/v1/outbox/settle", "/internal/factory/v1/outbox/confirm-inbox",
    ]);
    assert.deepEqual(callBody(calls[1]), { claim, outcome: "outcome_unknown", errorCode: "TEMPORAL_UNAVAILABLE" });
    await queue.settle(claim, "delivered");
    assert.deepEqual(callBody(calls.at(-1)), { claim, outcome: "delivered" });
  });

  it("carries a legal near-64 KiB command inside the larger private envelope", async () => {
    mode = "normal";
    const queue = await createGatewayFactoryCommandQueue({ baseUrl: origin, tls: paths, requestTimeoutMs: 1_000 });
    const fixedBytes = Buffer.byteLength(JSON.stringify({ ...command, body: { value: "" } }));
    const nearLimit = { ...command, body: { value: "x".repeat(64 * 1024 - fixedBytes) } };
    assert.equal(Buffer.byteLength(JSON.stringify(nearLimit)), 64 * 1024);
    queueClaimBody = { claimToken: "00000000-0000-4000-8000-000000000000", command: nearLimit };
    const claim = await queue.claim();
    assert.ok(claim);
    await queue.settle(claim, "delivered");
    assert.ok(Buffer.byteLength(lastCall().body) > 64 * 1024);
    queueClaimBody = undefined;
  });

  it("returns an empty claim and rejects malformed command or confirmation responses", async () => {
    mode = "normal";
    queueClaimBody = undefined;
    const queue = await createGatewayFactoryCommandQueue({ baseUrl: origin, tls: paths, requestTimeoutMs: 1_000 });
    assert.equal(await queue.claim(), null);
    queueClaimBody = null;
    assert.equal(await queue.claim(), null);
    const invalid = [{}, { claimToken: "", command }, { claimToken: "x".repeat(513), command }, { claimToken: "claim", command: null }, { claimToken: "claim", command: { ...command, commandId: "" } }, { claimToken: "claim", command: { ...command, kind: "wrong" } }, { claimToken: "claim", command: { ...command, interpreterId: "" } }, { claimToken: "claim", command: { ...command, body: undefined } }, { claimToken: "claim", command: { ...command, body: "x".repeat(65_536) } }];
    for (queueClaimBody of invalid) await assert.rejects(queue.claim(), /invalid|65536 bytes/);
    mode = "invalid-json";
    await assert.rejects(queue.claim(), /invalid factory claim JSON/);
    mode = "wrong-confirmation";
    assert.ok(queue.confirmInboxIdentity, "the gateway queue confirms inbox identities");
    await assert.rejects(queue.confirmInboxIdentity(command), /invalid inbox confirmation/);
    await assert.rejects(queue.settle({ claimToken: "x".repeat(4_000), command }, "outcome_unknown", "x".repeat(513)), /invalid factory settlement error code/);
    await assert.rejects(queue.settle({ claimToken: "\\".repeat(4_000), command: { ...command, body: { value: "x".repeat(64 * 1024) } } }, "outcome_unknown"), /settlement exceeds/);
    mode = "normal";
    queueClaimBody = undefined;
  });
});
