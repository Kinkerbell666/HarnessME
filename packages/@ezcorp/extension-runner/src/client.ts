import { request } from "node:http";
import type { BuildRequest, BuildResult, Runner, RunnerExecution, RunnerInspection, StartRequest, WorkspaceFiles } from "@ezcorp/extension-contract";
import { RunnerError, safeHostError } from "./core";
import type { ReverseRpc } from "./protocol";

/**
 * How many times in a row a host may take its own event stream back without a
 * poll succeeding in between. A worker that is really gone refuses the attach
 * and ends the loop on the first try; this bound only stops a service that
 * accepts an attach and then refuses every poll from spinning.
 */
const MAX_STREAM_RECOVERIES = 3;

export class RunnerClient implements Runner {
  constructor(private readonly options: { socketPath: string; token: string }) {}
  private call<Value>(method: string, data: unknown): Promise<Value> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(data);
      const outgoing = request({ socketPath: this.options.socketPath, path: `/v4/${method}`, method: "POST", headers: { authorization: `Bearer ${this.options.token}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) }, timeout: 360_000 }, incoming => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        incoming.on("data", (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes > 180 * 1024 ** 2) incoming.destroy(new RunnerError("response_limit", "Runner response exceeded policy")); else chunks.push(chunk); });
        incoming.on("error", reject);
        incoming.on("end", () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (incoming.statusCode !== 200 || result.error) reject(new RunnerError(result.error?.code ?? "runner_failed", result.error?.message ?? "Runner request failed", result.error?.stage, result.error?.retryable));
            else resolve(result);
          } catch { reject(new RunnerError("runner_protocol", "Runner returned invalid JSON")); }
        });
      });
      outgoing.on("error", reject);
      outgoing.on("timeout", () => outgoing.destroy(new RunnerError("runner_timeout", "Runner request timed out")));
      outgoing.end(body);
    });
  }
  build(input: BuildRequest): Promise<BuildResult> { return this.call("build", input); }
  inspect(id: string): Promise<RunnerInspection> { return this.call("inspect", { id }); }
  cancel(id: string): Promise<void> { return this.call("cancel", { id }); }
  async collectArtifacts(artifactDigest: string): Promise<WorkspaceFiles> { return (await this.call<{ files: WorkspaceFiles }>("artifacts", { artifactDigest })).files; }
  async start(input: StartRequest, reverseRpc: ReverseRpc): Promise<RunnerExecution> {
    await this.call("start", input);
    return this.attach(input, reverseRpc);
  }
  async attach(input: StartRequest, reverseRpc: ReverseRpc): Promise<RunnerExecution> {
    await this.call("attach", { workerId: input.workerId });
    let closed = false;
    const listeners = new Set<(method: string, params: unknown) => void>();
    let recoveries = 0;
    const poll = async () => {
      while (!closed) {
        let events: { id?: string; method: string; params: unknown }[];
        try {
          ({ events } = await this.call<{ events: { id?: string; method: string; params: unknown }[] }>("events", { workerId: input.workerId }));
          recoveries = 0;
        } catch (error) {
          // Losing the stream is not losing the worker. The worker keeps
          // running and keeps its queue, so take the stream back and carry on
          // rather than closing a session this host never asked to end. A
          // worker that is really gone refuses the attach and ends the loop.
          if (closed || recoveries >= MAX_STREAM_RECOVERIES) throw error;
          recoveries += 1;
          await this.call("attach", { workerId: input.workerId });
          continue;
        }
        for (const event of events) {
          if (closed) break;
          if (event.id) {
            let reply: { result: unknown } | { error: string };
            try { reply = { result: await reverseRpc(event.method, event.params) }; }
            catch (error) { reply = { error: safeHostError(error).code }; }
            // One reply per call. A refused reply (the call already timed out,
            // or its result broke policy) settles nothing the host can repair,
            // and the worker answers the caller on its own timeout, so it must
            // not close a session the worker still runs.
            await this.call("reply", { workerId: input.workerId, id: event.id, ...reply }).catch(() => {});
          } else for (const listener of listeners) listener(event.method, event.params);
        }
      }
    };
    // Losing a host connection does not cancel a real worker. A fresh client
    // can attach and resume its queued reverse calls.
    void poll().catch(() => { closed = true; });
    return {
      workerId: input.workerId,
      request: async (method, params) => { if (closed) throw new RunnerError("worker_closed", "Worker session closed"); return (await this.call<{ result: unknown }>("request", { workerId: input.workerId, method, params })).result; },
      close: async () => { closed = true; listeners.clear(); await this.cancel(input.workerId); },
      onNotification: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    };
  }
}
