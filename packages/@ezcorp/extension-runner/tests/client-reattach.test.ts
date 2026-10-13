import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { StartRequest } from "@ezcorp/extension-contract";
import { RunnerClient, executionLimits } from "../src";

/**
 * Losing the event stream is not losing the worker: the runner keeps it running
 * and keeps its queue. These cases drive the shipped client against a server
 * that reproduces the runner's exact refusal shapes, so the recovery is tested
 * without contorting the real service into evicting a host on demand.
 */
const TOKEN = "test-service-credential-32-bytes-minimum";

interface Answer { status: number; body: unknown }
interface Stub { socketPath: string; stop(): Promise<void> }

const REFUSED: Answer = { status: 400, body: { error: { code: "unknown_worker", message: "Worker event stream is unavailable or already attached" } } };

async function startStub(handle: (path: string) => Answer | Promise<Answer>): Promise<Stub> {
  const root = await mkdtemp("/tmp/ez-w01f-stub-");
  const socketPath = join(root, "runner.sock");
  const server = Bun.serve({
    unix: socketPath,
    async fetch(request) {
      await request.text();
      const answer = await handle(new URL(request.url).pathname);
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
    },
  });
  return { socketPath, stop: async () => { await server.stop(true); await rm(root, { recursive: true, force: true }); } };
}

function startBody(workerId: string): StartRequest {
  return { workerId, artifactDigest: "a".repeat(64), context: { workerId, invocationId: "invocation", releaseId: "release", principalId: "user", scopeId: "scope", token: "capability", deadline: Date.now() + 600_000 }, limits: executionLimits };
}

/** Await an observed state. The enclosing test budget is the only bound. */
async function until(observed: () => boolean): Promise<void> { while (!observed()) await Bun.sleep(1); }

test("a host takes its event stream back after a refusal it did not cause", async () => {
  const seen: string[] = [];
  let parked: (() => void) | undefined;
  const stub = await startStub(async path => {
    seen.push(path);
    if (path === "/v4/attach") return { status: 200, body: { workerId: "worker" } };
    if (path !== "/v4/events") return { status: 200, body: { result: null } };
    const polls = seen.filter(entry => entry === "/v4/events").length;
    if (polls === 1) return REFUSED;
    if (polls === 2) return { status: 200, body: { events: [{ method: "changed", params: { key: "value" } }] } };
    await new Promise<void>(resolve => { parked = resolve; });
    return { status: 200, body: { events: [] } };
  });
  try {
    const client = new RunnerClient({ socketPath: stub.socketPath, token: TOKEN });
    const execution = await client.attach(startBody("worker"), async () => null);
    const delivered = new Promise<unknown>(resolve => { execution.onNotification((method, params) => resolve({ method, params })); });

    // The first poll is refused. The client must re-attach and carry on, so the
    // notification the next poll carries still reaches this host.
    expect(await delivered).toEqual({ method: "changed", params: { key: "value" } });
    expect(seen.filter(entry => entry === "/v4/attach")).toHaveLength(2);
    expect(seen.slice(0, 4)).toEqual(["/v4/attach", "/v4/events", "/v4/attach", "/v4/events"]);

    // The session is still usable, which is the point of recovering at all.
    expect(await execution.request("anything", {})).toBe(null);
  } finally { parked?.(); await stub.stop(); }
}, 30_000);

test("a host stops polling when the worker itself is gone rather than retrying forever", async () => {
  const seen: string[] = [];
  const stub = await startStub(path => {
    seen.push(path);
    if (path === "/v4/attach" && seen.filter(entry => entry === "/v4/attach").length === 1) return { status: 200, body: { workerId: "worker" } };
    if (path === "/v4/request") return { status: 200, body: { result: null } };
    return REFUSED;
  });
  try {
    const client = new RunnerClient({ socketPath: stub.socketPath, token: TOKEN });
    const execution = await client.attach(startBody("worker"), async () => null);

    // One refused poll, one refused re-attach, and the loop ends: a worker the
    // service will not hand back is gone, and the host must not spin on it.
    await until(() => seen.filter(entry => entry === "/v4/attach").length === 2);
    await until(() => seen.filter(entry => entry === "/v4/events").length === 1);
    let closedMessage = "";
    await until(() => {
      void execution.request("anything", {}).then(() => {}, error => { closedMessage = error instanceof Error ? error.message : String(error); });
      return closedMessage.includes("Worker session closed");
    });
    expect(closedMessage).toContain("Worker session closed");
    expect(seen.filter(entry => entry === "/v4/events")).toHaveLength(1);
  } finally { await stub.stop(); }
}, 30_000);

test("a refused reply is sent once and does not close the session", async () => {
  // The runner refuses a reply whose reverse call already timed out. That is a
  // normal race, not a lost worker: the host must answer each call once and
  // keep its session, not send a second reply for the same id and close.
  const seen: string[] = [];
  let parked: (() => void) | undefined;
  const stub = await startStub(async path => {
    seen.push(path);
    if (path === "/v4/attach") return { status: 200, body: { workerId: "worker" } };
    if (path === "/v4/reply") return { status: 400, body: { error: { code: "unknown_request", message: "Host reply ID is stale or invalid" } } };
    if (path !== "/v4/events") return { status: 200, body: { result: "forward" } };
    if (seen.filter(entry => entry === "/v4/events").length === 1) return { status: 200, body: { events: [{ id: "reverse-1", method: "storage.get", params: {} }] } };
    await new Promise<void>(resolve => { parked = resolve; });
    return { status: 200, body: { events: [] } };
  });
  try {
    const client = new RunnerClient({ socketPath: stub.socketPath, token: TOKEN });
    const execution = await client.attach(startBody("worker"), async () => "late result");
    const count = (path: string) => seen.filter(entry => entry === path).length;
    await until(() => count("/v4/events") >= 2 || count("/v4/reply") >= 2);

    expect(count("/v4/reply")).toBe(1);
    expect(await execution.request("anything", {})).toBe("forward");
  } finally { parked?.(); await stub.stop(); }
}, 30_000);
