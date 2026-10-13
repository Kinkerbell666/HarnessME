/**
 * Regression: an extension sensitive-cap PDP-prompt must register in the
 * executor's `pendingPermissions` map so the watchdog defers the idle
 * kill (exactly like the built-in tool path), instead of mis-reading the
 * user-wait as a hung in-flight tool and killing the run at the 90s
 * `callTimeoutMs` ceiling — the "stuck chat" defect on `![ext:…]`
 * conversations whose tool needs `fs.write`/`shell`.
 *
 * The watchdog SIDE of this contract (an entry in `pendingPermissions`
 * for the conversation defers the kill past 90s; clearing it lets the
 * next idle window kill) is already locked by
 * `executor-watchdog-inflight-tools.test.ts` (AC5). This file locks the
 * WIRING side: `ToolExecutor.executeToolCall`'s `prompt` branch
 * register()s BEFORE awaiting the gate and deregister()s on EVERY exit
 * (allow, deny, gate throw), keyed by `decision.promptId`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { restoreModuleMocks } from "./helpers/mock-cleanup";
import { mock } from "bun:test";

afterAll(() => restoreModuleMocks());

// recordToolCall() funnels through this helper on the error path; stub
// it so the test needs no DB.
const persisted: Array<Record<string, unknown>> = [];
mock.module("../db/queries/tool-calls", () => ({
  persistToolCall: async (row: Record<string, unknown>) => { persisted.push(row); },
  listToolCallOutputsForMessages: async () => [],
  getToolCallConversationById: async () => null,
}));
mock.module("../db/connection", () => ({
  getDb: () => ({ update: () => ({ set: () => ({ where: async () => {} }) }) }),
}));

const { ToolExecutor } = await import("../extensions/tool-executor");
// NOT mocked — the SUT and the test share this module singleton
// (`pendingApprovals`), the same pattern as permission-gate-integration.
import { resolvePermission } from "../runtime/tools/permissions";

import type { ExtensionRegistry } from "../extensions/registry";
import type { PermissionEngine } from "../extensions/permission-engine";
import type { EventBus } from "../runtime/events";
import type { AgentEvents } from "../types";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

const SENTINEL = "DISPATCH_REACHED_SENTINEL";

let promptSeq = 0;

/** Engine that returns a fresh `prompt` decision for a sensitive fs.write
 *  cap — the exact PDP shape `create_extension` produces — until the
 *  executor re-authorizes with that cap approved, like the real PDP. */
function makePromptEngine(
  sensitive: { kind: string; value?: string } = { kind: "fs.write", value: "/p" },
): { engine: PermissionEngine; lastPromptId: () => string } {
  let last = "";
  const engine = {
    async authorize(ctx: { promptApproved?: readonly unknown[] }) {
      if (ctx.promptApproved?.length) return { decision: "allow" as const, auditId: "audit-x" };
      last = `prompt-${++promptSeq}`;
      return {
        decision: "prompt" as const,
        promptId: last,
        auditId: "audit-x",
        sensitive,
      };
    },
    async resolvePrompt() { /* no-op */ },
    _resetCacheForTests() {},
  } as unknown as PermissionEngine;
  return { engine, lastPromptId: () => last };
}

/** Registry stub. `getProcess` throws a sentinel so the allow path's
 *  fall-through-to-dispatch is observable WITHOUT spawning a subprocess;
 *  reaching it proves the `finally` deregistered before dispatch. */
function makeRegistry(): ExtensionRegistry {
  return {
    getRegisteredTool: () => ({
      extensionId: "ext-1",
      originalName: "create_extension",
      inputSchema: { type: "object", properties: {} },
    }),
    getManifest: () => ({ tools: [{ name: "create_extension" }] }),
    getProcess: async () => { throw new Error(SENTINEL); },
  } as unknown as ExtensionRegistry;
}

function makeBus(): EventBus<AgentEvents> {
  return {
    emit: () => {},
    on: () => () => {},
    off: () => {},
  } as unknown as EventBus<AgentEvents>;
}

function makeExec() {
  const reg: string[] = [];
  const dereg: string[] = [];
  const { engine, lastPromptId } = makePromptEngine();
  const exec = new ToolExecutor(makeRegistry(), engine, { bus: makeBus() });
  exec.setPendingPermissionGate(
    (key: string) => { reg.push(key); },
    (key: string) => { dereg.push(key); },
  );
  return { exec, reg, dereg, lastPromptId };
}

describe("extension sensitive-cap prompt ↔ pendingPermissions wiring", () => {
  test("registers BEFORE the gate suspends, deregisters AFTER allow, then dispatch is reached", async () => {
    const { exec, reg, dereg, lastPromptId } = makeExec();

    const p = exec.executeToolCall("ext-1__create_extension", {}, "conv-allow", null);
    await tick();
    const promptId = lastPromptId();

    // Gate is suspended: registered, not yet deregistered.
    expect(reg).toEqual([promptId]);
    expect(dereg).toEqual([]);

    resolvePermission(promptId, true, "session");
    const res = await p;

    // finally → deregister ran, THEN fell through to dispatch (sentinel).
    expect(dereg).toEqual([promptId]);
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain(SENTINEL);
  });

  test("resolves with the 'project' scope (deferred project scopeId → conversationId)", async () => {
    // The project scope branch defers real project resolution and keys the
    // always-allow row by conversationId. Exercise it end-to-end so the
    // deferred-project arm of the scopeId ternary is covered.
    const { exec, reg, dereg, lastPromptId } = makeExec();

    const p = exec.executeToolCall("ext-1__create_extension", {}, "conv-project", null);
    await tick();
    const promptId = lastPromptId();
    expect(reg).toEqual([promptId]);

    resolvePermission(promptId, true, "project");
    const res = await p;

    expect(dereg).toEqual([promptId]);
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain(SENTINEL);
  });

  test("deregisters after the user DENIES (PermissionDeniedError propagates)", async () => {
    const { exec, reg, dereg, lastPromptId } = makeExec();

    const p = exec.executeToolCall("ext-1__create_extension", {}, "conv-deny", null);
    await tick();
    const promptId = lastPromptId();
    expect(reg).toEqual([promptId]);

    resolvePermission(promptId, false);

    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toMatch(/declined/i);
    // finally ran on the deny path too — the entry never leaks.
    expect(dereg).toEqual([promptId]);
  });

  test("an UNWIRED ToolExecutor (default no-op gate) still drives the prompt — non-streamChat callers unaffected", async () => {
    // The setter defaults to no-ops so orchestration-host / ask-user-host
    // / unit tests that never call setPendingPermissionGate keep working.
    // Prove the prompt branch still functions end-to-end without it.
    const { engine, lastPromptId } = makePromptEngine();
    const exec = new ToolExecutor(makeRegistry(), engine, { bus: makeBus() });
    // deliberately NOT calling exec.setPendingPermissionGate(...)

    const p = exec.executeToolCall("ext-1__create_extension", {}, "conv-unwired", null);
    await tick();
    const promptId = lastPromptId();

    resolvePermission(promptId, true, "session");
    const res = await p;

    // No throw from the undefined→no-op register/deregister; allow path
    // still falls through to dispatch (sentinel).
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain(SENTINEL);
  });

  test.each(["ezcorp:extension:install", "ezcorp:extension:modify", "shell", "fs.write"])(
    "the prompt event names the real capability (%s), so the user sees what they approve",
    async (kind) => {
      const { engine, lastPromptId } = makePromptEngine({ kind });
      const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const bus = {
        emit: (type: string, payload: Record<string, unknown>) => { events.push({ type, payload }); },
        on: () => () => {},
        off: () => {},
      } as unknown as EventBus<AgentEvents>;
      const exec = new ToolExecutor(makeRegistry(), engine, { bus });

      const p = exec.executeToolCall("ext-1__create_extension", {}, `conv-label-${kind}`, null);
      await tick();
      const prompt = events.find((e) => e.type === "tool:permission_request");
      expect(prompt?.payload.capabilityKind).toBe(kind);

      resolvePermission(lastPromptId(), false);
      await expect(p).rejects.toThrow(/declined/i);
    },
  );
});
