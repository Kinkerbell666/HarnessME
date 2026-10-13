import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PayloadCodec } from "@temporalio/common";
import {
  factoryOrchestratorProductionDependencies,
  runFactoryOrchestratorProcess,
  type FactoryOrchestratorProcessDependencies,
  type FactoryOrchestratorProcessOptions,
  type FactoryTemporalConnection,
  type FactoryWorkerProcessHandle,
  type TemporalCredentials,
} from "../src/process.ts";
import { FACTORY_GATEWAY_REQUEST_TIMEOUT_MAX_MS, FACTORY_GATEWAY_REQUEST_TIMEOUT_MS } from "../src/contracts.ts";

const codec = { encode: async (values) => values, decode: async (values) => values } satisfies PayloadCodec;

function credentials(apiKey: string, tlsFingerprint = "tls-1"): TemporalCredentials {
  return { ca: Buffer.from("ca"), certificate: Buffer.from("cert"), privateKey: Buffer.from("key"), apiKey, tlsFingerprint };
}

function options(signal: AbortSignal, write: FactoryOrchestratorProcessOptions["readiness"]["write"], loadTemporalCredentials: () => Promise<TemporalCredentials>): FactoryOrchestratorProcessOptions {
  return {
    installationId: "installation-1", tenantId: "tenant-1", payloadCodec: codec, signal,
    temporal: {
      address: "temporal.internal:7233", namespace: "tenant-1", serverName: "temporal.internal",
      caPath: "/secrets/ca", certificatePath: "/secrets/cert", privateKeyPath: "/secrets/key", apiKeyPath: "/secrets/token",
      credentialRefreshMs: 1_000, pollingProbeTimeoutMs: 1_000,
    },
    gateway: { baseUrl: "https://factory.internal", tls: { caPath: "/gateway/ca", certificatePath: "/gateway/cert", privateKeyPath: "/gateway/key", serviceTokenPath: "/gateway/token" } },
    readiness: { write }, readinessHeartbeatMs: 1_000, dispatchEmptyDelayMs: 10, loadTemporalCredentials,
  };
}

function worker(): FactoryWorkerProcessHandle & { readonly shutdowns: number } {
  let state = "INITIALIZED";
  let finish: (() => void) | undefined;
  let shutdowns = 0;
  return {
    get shutdowns() { return shutdowns; },
    getState: () => state,
    run: () => { state = "RUNNING"; return new Promise<void>((resolve) => { finish = resolve; }); },
    shutdown: () => { shutdowns += 1; state = "STOPPED"; finish?.(); },
  };
}

function dependencies(values: TemporalCredentials[], observed: { connections: FactoryTemporalConnection[]; workers: FactoryWorkerProcessHandle[]; apiKeys: string[]; now: number }): FactoryOrchestratorProcessDependencies {
  return {
    now: () => observed.now,
    wait: async (milliseconds, signal) => {
      observed.now += milliseconds;
      await Promise.resolve();
      if (signal?.aborted) throw signal.reason;
    },
    connect: async () => {
      const connection: FactoryTemporalConnection = {
        workflowService: { describeTaskQueue: async (request) => ({ pollers: [{ identity: `${(request as { namespace: string }).namespace === "tenant-1" ? "installation-1" : "foreign"}:factory-orchestrator` }] }) },
        withDeadline: async (_deadline, operation) => operation(),
        setApiKey: async (value) => { observed.apiKeys.push(value); },
        close: async () => {},
      };
      observed.connections.push(connection);
      return connection;
    },
    createRuntime: async () => {
      const instance = worker();
      observed.workers.push(instance);
      return { worker: instance, dispatch: async () => "empty", probeGateway: async () => {} };
    },
  };
}

describe("production factory orchestrator process", () => {
  it("fails closed when the concrete Temporal connector cannot authenticate", async () => {
    await assert.rejects(factoryOrchestratorProductionDependencies.connect({
      address: "127.0.0.1:1", namespace: "tenant-1", serverName: "localhost",
      caPath: "/unused", certificatePath: "/unused", privateKeyPath: "/unused", apiKeyPath: "/unused",
    }, credentials("token")));
    await factoryOrchestratorProductionDependencies.wait(1);
    const controller = new AbortController();
    const pending = factoryOrchestratorProductionDependencies.wait(60_000, controller.signal);
    controller.abort(new Error("test stop"));
    await assert.rejects(pending, /test stop/);
    await assert.rejects(factoryOrchestratorProductionDependencies.wait(1, AbortSignal.abort()), /stopped|aborted/i);
  });

  it("reports ready only after real loop probes and revalidates a rotated API key", async () => {
    const controller = new AbortController();
    const states: Array<{ lifecycle: string; credentialGeneration: number; workerPolling: boolean; dispatcherLive: boolean }> = [];
    const observed = { connections: [] as FactoryTemporalConnection[], workers: [] as FactoryWorkerProcessHandle[], apiKeys: [] as string[], now: 0 };
    let loaded = 0;
    const values = [credentials("token-1"), credentials("token-2")];
    await runFactoryOrchestratorProcess(options(controller.signal, async (state) => {
      states.push(state);
      if (state.lifecycle === "ready" && state.credentialGeneration === 2) controller.abort(new Error("test complete"));
      return { schemaVersion: "factory.orchestrator-readiness.v1", installationId: "installation-1", tenantId: "tenant-1", namespace: "tenant-1", taskQueue: "factory-orchestrator", observedAtMs: observed.now, ...state };
    }, async () => values[Math.min(loaded++, values.length - 1)]!), dependencies(values, observed));

    assert.deepEqual(observed.apiKeys, ["token-2"]);
    assert.equal(observed.connections.length, 1);
    assert.deepEqual(states.map((state) => [state.lifecycle, state.credentialGeneration]), [["starting", 0], ["ready", 1], ["ready", 2], ["stopping", 2]]);
    assert.equal(states.filter((state) => state.lifecycle === "ready").every((state) => state.workerPolling && state.dispatcherLive), true);
  });

  it("withdraws readiness and recreates the worker when TLS credentials rotate", async () => {
    const controller = new AbortController();
    const states: string[] = [];
    const observed = { connections: [] as FactoryTemporalConnection[], workers: [] as FactoryWorkerProcessHandle[], apiKeys: [] as string[], now: 0 };
    let loaded = 0;
    const values = [credentials("token", "tls-1"), credentials("token", "tls-2"), credentials("token", "tls-2")];
    await runFactoryOrchestratorProcess(options(controller.signal, async (state) => {
      states.push(`${state.lifecycle}:${state.credentialGeneration}`);
      if (state.lifecycle === "ready" && state.credentialGeneration === 2) controller.abort(new Error("test complete"));
      return { schemaVersion: "factory.orchestrator-readiness.v1", installationId: "installation-1", tenantId: "tenant-1", namespace: "tenant-1", taskQueue: "factory-orchestrator", observedAtMs: observed.now, ...state };
    }, async () => values[Math.min(loaded++, values.length - 1)]!), dependencies(values, observed));

    assert.equal(observed.connections.length, 2);
    assert.deepEqual(states, ["starting:0", "ready:1", "starting:1", "ready:2", "stopping:2"]);
  });

  it("hands the runtime the ordered gateway bound and refuses one below it", async () => {
    const controller = new AbortController();
    const observed = { connections: [] as FactoryTemporalConnection[], workers: [] as FactoryWorkerProcessHandle[], apiKeys: [] as string[], now: 0 };
    const base = dependencies([credentials("token")], observed);
    const bounds: Array<number | undefined> = [];
    const deps: FactoryOrchestratorProcessDependencies = {
      ...base,
      createRuntime: async (runtime, connection, identity) => {
        bounds.push(runtime.gateway.requestTimeoutMs);
        return base.createRuntime(runtime, connection, identity);
      },
    };
    const ready = async (state: Parameters<FactoryOrchestratorProcessOptions["readiness"]["write"]>[0]) => {
      if (state.lifecycle === "ready") controller.abort(new Error("test complete"));
      return { schemaVersion: "factory.orchestrator-readiness.v1" as const, installationId: "installation-1", tenantId: "tenant-1", namespace: "tenant-1", taskQueue: "factory-orchestrator", observedAtMs: observed.now, ...state };
    };
    await runFactoryOrchestratorProcess(options(controller.signal, ready, async () => credentials("token")), deps);
    assert.deepEqual(bounds, [FACTORY_GATEWAY_REQUEST_TIMEOUT_MS]);
    for (const requestTimeoutMs of [30_000, FACTORY_GATEWAY_REQUEST_TIMEOUT_MS - 1, FACTORY_GATEWAY_REQUEST_TIMEOUT_MAX_MS + 1]) {
      const base = options(new AbortController().signal, ready, async () => credentials("token"));
      await assert.rejects(runFactoryOrchestratorProcess({ ...base, gateway: { ...base.gateway, requestTimeoutMs } }, deps), /gateway request timeout is invalid/);
    }
  });

  it("fails closed when the authenticated task queue does not list this worker", async () => {
    const controller = new AbortController();
    const states: string[] = [];
    const observed = { connections: [] as FactoryTemporalConnection[], workers: [] as FactoryWorkerProcessHandle[], apiKeys: [] as string[], now: 0 };
    const deps: FactoryOrchestratorProcessDependencies = {
      ...dependencies([credentials("token")], observed),
      connect: async () => ({
        workflowService: { describeTaskQueue: async () => ({ pollers: [{ identity: "another-worker" }] }) },
        withDeadline: async (_deadline, operation) => operation(), setApiKey: async () => {}, close: async () => {},
      }),
    };
    await assert.rejects(runFactoryOrchestratorProcess(options(controller.signal, async (state) => {
      states.push(state.lifecycle);
      return { schemaVersion: "factory.orchestrator-readiness.v1", installationId: "installation-1", tenantId: "tenant-1", namespace: "tenant-1", taskQueue: "factory-orchestrator", observedAtMs: observed.now, ...state };
    }, async () => credentials("token")), deps), /process failed/);
    assert.deepEqual(states, ["starting", "failed"]);
  });
});
