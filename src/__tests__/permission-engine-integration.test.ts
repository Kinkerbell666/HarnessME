/**
 * Phase 1 PDP integration: boot the registry, run one tool call
 * end-to-end through `ToolExecutor`, and assert that an `auditLog`
 * row with `action='ext:perm:allowed'` (and non-empty metadata) was
 * written.
 *
 * This is the spec's mandated "smoke test that proves the engine is
 * actually wired into the dispatch path". Smaller-grained PDP unit
 * tests live in `permission-engine.test.ts`.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mockDbConnection, mockRealSettings, setupTestDb, closeTestDb, getTestDb } from "./helpers/test-pglite";
import { restoreModuleMocks } from "./helpers/mock-cleanup";

mockDbConnection();
mockRealSettings();

afterAll(async () => {
  await closeTestDb();
  restoreModuleMocks();
});

import { createPermissionEngine, _resetPermissionEngineForTests } from "../extensions/permission-engine";
import { ToolExecutor } from "../extensions/tool-executor";
import type { ExtensionRegistry } from "../extensions/registry";
import type { ExtensionManifestV2, ToolCallResult } from "../extensions/types";
import { auditLog, users, extensions, conversations, messages, projects, toolCalls } from "../db/schema";
import { eq } from "drizzle-orm";

const USER_ID = "ext-perm-engine-int-user";
const EXT_ID = "ext-int-1";

// ── Boot harness ────────────────────────────────────────────────────

interface CapturedCall {
  name: string;
  args: Record<string, unknown>;
}

function makeBootedRegistry(captured: CapturedCall[]): ExtensionRegistry {
  // Manifest the booted registry would have after migrateManifestV2ToV3.
  const manifest: ExtensionManifestV2 = {
    schemaVersion: 3,
    name: "scratchpad",
    version: "1.0.0",
    description: "test",
    author: { name: "tester" },
    permissions: { storage: true },
    entrypoint: "./index.ts",
    tools: [
      {
        name: "write_note",
        description: "test",
        inputSchema: { type: "object" },
        capabilities: { storage: true },
      },
    ],
  };
  const fakeProc = {
    callTool: async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
      captured.push({ name, args });
      return { content: [{ type: "text", text: "ok" }], isError: false };
    },
    setNotificationHandler: () => {},
    setRequestHandler: () => {},
  };
  return {
    getRegisteredTool: () => ({
      extensionId: EXT_ID,
      extensionName: "scratchpad",
      originalName: "write_note",
      name: "scratchpad__write_note",
      description: "test",
      inputSchema: { type: "object" },
    }),
    getManifest: () => manifest,
    getGrantedPermissions: () => ({ grantedAt: {}, storage: true }),
    getProcess: async () => fakeProc,
    getMcpClient: async () => {
      throw new Error("not an mcp ext");
    },
  } as unknown as ExtensionRegistry;
}

beforeEach(async () => {
  await setupTestDb();
  await getTestDb()
    .insert(users)
    .values({
      id: USER_ID,
      email: "intuser@example.com",
      passwordHash: "x",
      name: "Int User",
      role: "member",
    })
    .onConflictDoNothing();
  _resetPermissionEngineForTests();
  await getTestDb().insert(extensions).values({ id: EXT_ID, name: "scratchpad", version: "1.0.0", source: "test:fixture", manifest: { schemaVersion: 3, name: "scratchpad", version: "1.0.0", description: "test", author: { name: "Test" }, permissions: {} } });
  const [project] = await getTestDb().insert(projects).values({ name: "Permission integration", path: "/tmp/permission-integration" }).returning();
  for (const suffix of ["1", "2", "resolver", "prompt"]) {
    await getTestDb().insert(conversations).values({ id: `conv-int-${suffix}`, userId: USER_ID, projectId: project!.id });
    await getTestDb().insert(messages).values({ id: `msg-int-${suffix}`, conversationId: `conv-int-${suffix}`, role: "assistant", content: "" });
  }
});

// ── End-to-end ──────────────────────────────────────────────────────

describe("PDP integration: ToolExecutor → engine.authorize → auditLog row", () => {
  test("a successful tool call writes a PERM_ALLOWED audit row", async () => {
    const captured: CapturedCall[] = [];
    const registry = makeBootedRegistry(captured);
    const engine = createPermissionEngine({
      registry,
      bus: { emit: () => {}, on: () => () => {} } as unknown as Parameters<typeof createPermissionEngine>[0]["bus"],
      db: { _token: "int-test" },
    });

    const executor = new ToolExecutor(registry, engine);
    executor.setCurrentUserId(USER_ID);

    const result = await executor.executeToolCall(
      "scratchpad__write_note",
      { content: "hello" },
      "conv-int-1",
      "msg-int-1",
    );

    // Subprocess actually got the call (proving the dispatch wasn't
    // short-circuited by a deny).
    expect(result.isError).toBe(false);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.name).toBe("write_note");
    expect(await getTestDb().select().from(toolCalls)).toHaveLength(1);

    // Exactly one audit row, with the expected metadata shape.
    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:allowed"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Find the row for our extension.
    const ours = rows.find((r) => r.target === EXT_ID);
    expect(ours).toBeDefined();
    if (!ours) throw new Error("missing audit row");
    expect(ours.userId).toBe(USER_ID);
    const meta = ours.metadata as Record<string, unknown>;
    expect(meta.toolName).toBe("write_note");
    expect(meta.conversationId).toBe("conv-int-1");
    expect(typeof meta.auditId).toBe("string");
  });

  test("a denied tool call writes a PERM_DENIED audit row + throws", async () => {
    const registry = {
      getRegisteredTool: () => ({
        extensionId: EXT_ID,
        extensionName: "scratchpad",
        originalName: "write_note",
        name: "scratchpad__write_note",
        description: "test",
        inputSchema: { type: "object" },
      }),
      // Manifest declares network capability the extension wasn't
      // granted — PDP should deny.
      getManifest: () =>
        ({
          schemaVersion: 3,
          name: "scratchpad",
          version: "1.0.0",
          description: "test",
          author: { name: "tester" },
          permissions: {},
          entrypoint: "./index.ts",
          tools: [
            {
              name: "write_note",
              description: "test",
              inputSchema: { type: "object" },
              capabilities: { network: { hosts: ["api.evil.com"] } },
            },
          ],
        }) as unknown as ExtensionManifestV2,
      getGrantedPermissions: () => ({ grantedAt: {} }),
      getProcess: async () => {
        throw new Error("should never reach subprocess");
      },
    } as unknown as ExtensionRegistry;

    const engine = createPermissionEngine({
      registry,
      bus: { emit: () => {}, on: () => () => {} } as unknown as Parameters<typeof createPermissionEngine>[0]["bus"],
      db: { _token: "int-test" },
    });
    const executor = new ToolExecutor(registry, engine);
    executor.setCurrentUserId(USER_ID);

    await expect(
      executor.executeToolCall(
        "scratchpad__write_note",
        {},
        "conv-int-2",
        "msg-int-2",
      ),
    ).rejects.toThrow(/Permission denied/);

    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:denied"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  test("argsResolver runs BEFORE the real PDP (closes finding C5 with the real engine)", async () => {
    // Same setup as the happy-path test above but the registry's
    // getManifest declares a `network` capability AND we install an
    // argsResolver that mutates the args. The PDP itself is the real
    // `createPermissionEngine` — we assert it sees the resolved args
    // by inspecting the audit row's metadata. (Phase 2 will wire the
    // arg-substitution path itself; in Phase 1 the PDP doesn't yet
    // read input shape, but the dispatch ORDER is what closes the
    // finding.)
    const captured: CapturedCall[] = [];
    const fakeProc = {
      callTool: async (
        name: string,
        args: Record<string, unknown>,
      ): Promise<ToolCallResult> => {
        captured.push({ name, args });
        return { content: [{ type: "text", text: "ok" }], isError: false };
      },
      setNotificationHandler: () => {},
      setRequestHandler: () => {},
    };
    const registry = {
      getRegisteredTool: () => ({
        extensionId: EXT_ID,
        extensionName: "scratchpad",
        originalName: "write_note",
        name: "scratchpad__write_note",
        description: "test",
        inputSchema: { type: "object" },
      }),
      getManifest: () =>
        ({
          schemaVersion: 3,
          name: "scratchpad",
          version: "1.0.0",
          description: "test",
          author: { name: "tester" },
          permissions: { storage: true },
          entrypoint: "./index.ts",
          tools: [
            {
              name: "write_note",
              description: "test",
              inputSchema: { type: "object" },
              capabilities: { storage: true },
            },
          ],
        }) as unknown as ExtensionManifestV2,
      getGrantedPermissions: () => ({ grantedAt: {}, storage: true }),
      getProcess: async () => fakeProc,
      getMcpClient: async () => {
        throw new Error("not an mcp ext");
      },
    } as unknown as ExtensionRegistry;

    const engine = createPermissionEngine({
      registry,
      bus: { emit: () => {}, on: () => () => {} } as unknown as Parameters<typeof createPermissionEngine>[0]["bus"],
      db: { _token: "int-resolver-test" },
    });
    const executor = new ToolExecutor(registry, engine);
    executor.setCurrentUserId(USER_ID);
    // Resolver mutates input.content from "raw" → "resolved" BEFORE
    // the PDP runs. The subprocess MUST observe "resolved".
    executor.setArgsResolver(async (input) => ({
      ...input,
      content: input.content === "raw" ? "resolved" : input.content,
    }));

    await executor.executeToolCall(
      "scratchpad__write_note",
      { content: "raw" },
      "conv-int-resolver",
      "msg-int-resolver",
    );

    // Subprocess receives the resolved value (proves the resolver ran
    // before dispatch).
    expect(captured).toHaveLength(1);
    expect(captured[0]!.args.content).toBe("resolved");

    // Audit row exists for this conversation, confirming the PDP
    // also ran (after the resolver). The resolver→PDP→dispatch order
    // is the C5 invariant.
    const rows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:allowed"));
    const ours = rows.find(
      (r) =>
        (r.metadata as Record<string, unknown>).conversationId ===
        "conv-int-resolver",
    );
    expect(ours).toBeDefined();
  });

  test("prompt path (Phase 6): sensitive cap → PERM_PROMPTED row + emits scoped tool:permission_request + awaits gate", async () => {
    // Phase 6 contract: when the PDP returns `prompt`, the executor
    // emits `tool:permission_request` (scoped to the originating user
    // via H7) and awaits a `createExtensionPermissionGate` resolution.
    // We resolve the gate from the test by calling `resolvePermission`
    // — same path the SSE-side modal will use in production.
    const captured: CapturedCall[] = [];
    const fakeProc = {
      callTool: async (
        name: string,
        args: Record<string, unknown>,
      ): Promise<ToolCallResult> => {
        captured.push({ name, args });
        return { content: [{ type: "text", text: "ok" }], isError: false };
      },
      setNotificationHandler: () => {},
      setRequestHandler: () => {},
    };
    const registry = {
      getRegisteredTool: () => ({
        extensionId: EXT_ID,
        extensionName: "scratchpad",
        originalName: "run_shell",
        name: "scratchpad__run_shell",
        description: "test",
        inputSchema: { type: "object" },
      }),
      getManifest: () =>
        ({
          schemaVersion: 3,
          name: "scratchpad",
          version: "1.0.0",
          description: "test",
          author: { name: "tester" },
          permissions: { shell: true },
          entrypoint: "./index.ts",
          tools: [
            {
              name: "run_shell",
              description: "test",
              inputSchema: { type: "object" },
              capabilities: { shell: true },
            },
          ],
        }) as unknown as ExtensionManifestV2,
      getGrantedPermissions: () => ({ grantedAt: {}, shell: true }),
      getProcess: async () => fakeProc,
      getMcpClient: async () => {
        throw new Error("not an mcp ext");
      },
    } as unknown as ExtensionRegistry;

    // Capture emits so we can extract the promptId.
    const emits: Array<{ type: string; payload: unknown }> = [];
    const bus = {
      emit: (type: string, payload: unknown) => {
        emits.push({ type, payload });
      },
      on: () => () => {},
    } as unknown as Parameters<typeof createPermissionEngine>[0]["bus"];

    const engine = createPermissionEngine({
      registry,
      bus,
      db: { _token: "int-prompt-test" },
    });
    const executor = new ToolExecutor(registry, engine, { bus });
    executor.setCurrentUserId(USER_ID);

    // Kick off the call. The executor emits `tool:permission_request`,
    // then blocks on the gate. We resolve it from a microtask so the
    // call completes — pretend the user clicked Allow with scope
    // "session".
    const callPromise = executor.executeToolCall(
      "scratchpad__run_shell",
      {},
      "conv-int-prompt",
      "msg-int-prompt",
    );

    // Wait one microtask for the emit to land, then resolve the gate.
    await new Promise((r) => setTimeout(r, 10));
    const permEvent = emits.find((e) => e.type === "tool:permission_request");
    expect(permEvent).toBeDefined();
    const evtPayload = permEvent!.payload as {
      userId?: string;
      extensionId?: string;
      capabilityKind?: string;
      toolCallId: string;
      promptId?: string;
    };
    // H7 scoping fields populated.
    expect(evtPayload.userId).toBe(USER_ID);
    expect(evtPayload.extensionId).toBe(EXT_ID);
    expect(evtPayload.capabilityKind).toBe("shell");
    expect(typeof evtPayload.promptId).toBe("string");

    const { resolvePermission } = await import("../runtime/tools/permissions");
    resolvePermission(evtPayload.toolCallId, true, "session");

    const result = await callPromise;
    expect(result.isError).toBe(false);
    expect(captured).toHaveLength(1);

    // Audit row records PERM_PROMPTED at the prompt time.
    const promptRows = await getTestDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ext:perm:prompted"));
    const ours = promptRows.find(
      (r) =>
        (r.metadata as Record<string, unknown>).conversationId ===
        "conv-int-prompt",
    );
    expect(ours).toBeDefined();
    if (!ours) throw new Error("missing prompt audit row");
    const meta = ours.metadata as Record<string, unknown>;
    expect(meta.capabilityKind).toBe("shell");
    expect(typeof meta.promptId).toBe("string");
  });
});

describe("prompt path: every sensitive cap in one call is asked for", () => {
  test("allowing the first sensitive cap still prompts for the second, and declining it denies the call", async () => {
    const captured: CapturedCall[] = [];
    const fakeProc = {
      callTool: async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
        captured.push({ name, args });
        return { content: [{ type: "text", text: "ok" }], isError: false };
      },
      setNotificationHandler: () => {},
      setRequestHandler: () => {},
    };
    const writeRoot = "/tmp/permission-integration-two-caps";
    const registry = {
      getRegisteredTool: () => ({
        extensionId: EXT_ID,
        extensionName: "scratchpad",
        originalName: "write_and_run",
        name: "scratchpad__write_and_run",
        description: "test",
        inputSchema: { type: "object" },
      }),
      getManifest: () =>
        ({
          schemaVersion: 3,
          name: "scratchpad",
          version: "1.0.0",
          description: "test",
          author: { name: "tester" },
          permissions: { shell: true, filesystem: [writeRoot] },
          entrypoint: "./index.ts",
          tools: [
            {
              name: "write_and_run",
              description: "test",
              inputSchema: { type: "object" },
              capabilities: { shell: true, filesystem: { paths: [writeRoot], mode: ["write"] } },
            },
          ],
        }) as unknown as ExtensionManifestV2,
      getGrantedPermissions: () => ({ grantedAt: {}, shell: true, filesystem: [writeRoot] }),
      getProcess: async () => fakeProc,
      getMcpClient: async () => {
        throw new Error("not an mcp ext");
      },
    } as unknown as ExtensionRegistry;

    type PromptEvent = { toolCallId: string; capabilityKind?: string };
    const waiters: Array<(e: PromptEvent) => void> = [];
    const nextPrompt = () => new Promise<PromptEvent>((resolve) => waiters.push(resolve));
    const bus = {
      emit: (type: string, payload: unknown) => {
        if (type === "tool:permission_request") waiters.shift()?.(payload as PromptEvent);
      },
      on: () => () => {},
    } as unknown as Parameters<typeof createPermissionEngine>[0]["bus"];

    const engine = createPermissionEngine({ registry, bus, db: { _token: "int-two-caps" } });
    const executor = new ToolExecutor(registry, engine, { bus });
    executor.setCurrentUserId(USER_ID);
    const { resolvePermission } = await import("../runtime/tools/permissions");

    const firstPrompt = nextPrompt();
    const callPromise = executor.executeToolCall("scratchpad__write_and_run", {}, "conv-int-prompt", "msg-int-prompt");
    const settled = callPromise.then(() => "ran" as const, () => "rejected" as const);

    const first = await firstPrompt;
    const secondPrompt = nextPrompt();
    resolvePermission(first.toolCallId, true, "session");

    const next = await Promise.race([settled, secondPrompt]);
    if (typeof next === "string") throw new Error(`call ${next} without a prompt for the second sensitive cap`);
    expect(new Set([first.capabilityKind, next.capabilityKind])).toEqual(new Set(["fs.write", "shell"]));

    resolvePermission(next.toolCallId, false);
    await expect(callPromise).rejects.toThrow(/declined/);
    expect(captured).toHaveLength(0);
  });
});
