/**
 * INTEGRATION tests for the run, agent, workflow, connection and extension
 * handlers of the REAL `stores.svelte.ts` runtime-event subscriber, plus the
 * inline-invocation and permission-merge branches of the tool handlers.
 *
 * The subscriber dispatches through a table of named handlers (one per event
 * type). Tool and conversation handlers have their own suites; these cover
 * the rest, so each handler's branches are exercised the way the bus
 * delivers them. Same harness as stores-tree-changed.integration: the WS
 * client is mocked to capture the subscriber `initStores` registers.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Run } from "$lib/api";

let capturedSubscriber: ((evt: { type: string; data: unknown }) => void) | null = null;

vi.mock("$lib/ws", () => ({
	createWSClient: () => ({
		subscribe: (fn: (evt: { type: string; data: unknown }) => void) => {
			capturedSubscriber = fn;
			return () => {};
		},
		close: () => {},
		manualRetry: () => {},
	}),
}));

vi.mock("$lib/api", () => ({
	fetchAgents: () => Promise.resolve([]),
	fetchRuns: () => Promise.resolve([]),
	fetchProjects: () => Promise.resolve([]),
	fetchSettings: () => Promise.resolve({}),
	fetchAgentConfigs: () => Promise.resolve([]),
	fetchWorkflows: () => Promise.resolve([]),
}));

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("$lib/toast.svelte.js", () => ({ addToast }));

import { initStores, startStreaming, store } from "$lib/stores.svelte";
import { unreadStore } from "$lib/unread.js";
import { inlineToolStore } from "$lib/inline-tool-store.svelte.js";

function emit(type: string, data: unknown) {
	if (!capturedSubscriber) throw new Error("subscriber not captured — initStores not called?");
	capturedSubscriber({ type, data });
}

function run(id: string, extra: Partial<Run> = {}): Run {
	return { id, agentName: "a", status: "running", logs: [], projectId: "p1", ...extra } as unknown as Run;
}

/** Collect the `detail` of every window CustomEvent named `name` while `fn` runs. */
function windowEvents(name: string, fn: () => void): unknown[] {
	const seen: unknown[] = [];
	const listener = (e: Event) => seen.push((e as CustomEvent).detail);
	window.addEventListener(name, listener);
	try {
		fn();
	} finally {
		window.removeEventListener(name, listener);
	}
	return seen;
}

beforeEach(() => {
	capturedSubscriber = null;
	addToast.mockClear();
	localStorage.clear();
	unreadStore._reset();
	store.runs = [];
	store.streamingAgentCalls = {};
	store.streamingRunToConversation = {};
	store.completedBeforeStream = new Set();
	store.memoryUnavailableRunId = null;
	initStores();
});

afterEach(() => vi.restoreAllMocks());

describe("connection events", () => {
	test("ws:connected marks the store connected and counts the reconnect; ws:disconnected clears it", () => {
		const before = store.wsReconnectCount;
		emit("ws:connected", {});
		expect(store.connected).toBe(true);
		expect(store.wsReconnectCount).toBe(before + 1);
		emit("ws:disconnected", {});
		expect(store.connected).toBe(false);
	});
});

describe("run lifecycle", () => {
	test("run:start adds a new run first and replaces a known one in place", () => {
		store.runs = [run("old")];
		emit("run:start", { run: run("r1") });
		expect(store.runs.map((r) => r.id)).toEqual(["r1", "old"]);
		emit("run:start", { run: run("old", { status: "success" } as Partial<Run>) });
		expect(store.runs.map((r) => [r.id, r.status])).toEqual([["r1", "running"], ["old", "success"]]);
	});

	test("run:log appends to the matching run only", () => {
		store.runs = [run("r1"), run("r2")];
		emit("run:log", { runId: "r1", log: { level: "info", message: "hi" } });
		expect(store.runs[0]!.logs).toHaveLength(1);
		expect(store.runs[1]!.logs).toHaveLength(0);
	});

	test("run:status records the status, flags memory_unavailable, and clears it on recovery", () => {
		emit("run:status", { runId: "r1", status: "memory_unavailable" });
		expect(store.streamingStatus.r1).toBe("memory_unavailable");
		expect(store.memoryUnavailableRunId).toBe("r1");
		emit("run:status", { runId: "r1", status: "thinking" });
		expect(store.memoryUnavailableRunId).toBeNull();
		emit("run:status", { runId: "r1", status: "thinking" });
		expect(store.memoryUnavailableRunId).toBeNull();
	});

	test("run:usage stores the run's token usage", () => {
		emit("run:usage", { runId: "r1", usage: { inputTokens: 3, outputTokens: 4 } });
		expect(store.streamingUsage.r1).toEqual({ inputTokens: 3, outputTokens: 4 });
	});

	test("run:token buffers text and thinking separately until the next frame", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
			frames.push(cb);
			return frames.length;
		});
		try {
			startStreaming("r-tok", "c-tok");
			emit("run:token", { runId: "r-tok", token: "Hel" });
			emit("run:token", { runId: "r-tok", token: "hmm", kind: "thinking" });
			expect(store.streamingMessages["r-tok"]).toBe("");
			for (const frame of frames.splice(0)) frame(0);
			expect(store.streamingMessages["r-tok"]).toBe("Hel");
			expect(store.streamingThinking["r-tok"]).toBe("hmm");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	test("run:turn_text_reset clears the turn's buffers and keeps one agent ref per spawned agent", () => {
		startStreaming("r-reset", "c-reset");
		emit("agent:spawn", { runId: "r-reset", subConversationId: "s1", agentName: "x", agentConfigId: "cfg", task: "t", agentRunId: "ar1" });
		store.streamingMessages = { ...store.streamingMessages, "r-reset": "old text" };
		emit("run:turn_text_reset", { runId: "r-reset" });
		expect(store.streamingMessages["r-reset"]).toBe("");
		expect(store.streamingThinking["r-reset"]).toBe("");
		expect(store.streamingToolCalls["r-reset"]).toEqual([]);
		expect(store.streamingContentBlocks["r-reset"]).toHaveLength(1);

		// No builder (never streamed here): the blocks are simply emptied.
		emit("run:turn_text_reset", { runId: "r-unknown" });
		expect(store.streamingContentBlocks["r-unknown"]).toEqual([]);
	});

	test("run:turn_saved re-dispatches the saved turn as ez:turn_saved", () => {
		vi.spyOn(console, "info").mockImplementation(() => {});
		const data = { runId: "r1", conversationId: "c1", messageId: "m1", parentMessageId: null, content: "hi", thinkingContent: "t", final: true };
		expect(windowEvents("ez:turn_saved", () => emit("run:turn_saved", data))).toEqual([data]);
	});

	test("run:complete off-screen marks the conversation unread, finishes running agents, and toasts", () => {
		startStreaming("r-done", "c-done");
		emit("agent:spawn", { runId: "r-done", subConversationId: "s1", agentName: "x", agentConfigId: "cfg", task: "t", agentRunId: "ar1" });
		store.runs = [run("r-done")];
		emit("run:complete", { run: run("r-done", { status: "success" } as Partial<Run>) });
		expect(store.runs[0]!.status).toBe("success");
		expect(store.streamingRunToConversation["r-done"]).toBeUndefined();
		expect(unreadStore.isUnread("c-done")).toBe(true);
		expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success", message: "Run completed" }));
	});

	test("run:complete while viewing that conversation neither marks it unread nor toasts", () => {
		startStreaming("r-view", "c-view");
		window.history.pushState({}, "", "/project/p1/chat/c-view");
		try {
			emit("run:complete", { run: run("r-view", { status: "success" } as Partial<Run>) });
		} finally {
			window.history.pushState({}, "", "/");
		}
		expect(unreadStore.isUnread("c-view")).toBe(false);
		expect(addToast).not.toHaveBeenCalled();
	});

	test("a run that finishes before streaming starts is remembered, and the toast's View opens the run", () => {
		emit("run:complete", { run: run("r-early") });
		expect(store.completedBeforeStream.has("r-early")).toBe(true);
		const toast = addToast.mock.calls[0]![0] as { action: { onclick: () => void } };
		const assign = vi.fn();
		vi.stubGlobal("location", { ...window.location, pathname: "/", set href(v: string) { assign(v); } });
		try {
			toast.action.onclick();
		} finally {
			vi.unstubAllGlobals();
		}
		expect(assign).toHaveBeenCalledWith("/runs/r-early");
	});

	test("run:error cleans up the stream and toasts the failure with its message", () => {
		startStreaming("r-err", "c-err");
		emit("agent:spawn", { runId: "r-err", subConversationId: "s1", agentName: "x", agentConfigId: "cfg", task: "t", agentRunId: "ar1" });
		emit("run:error", { run: run("r-err", { error: "boom" } as Partial<Run>) });
		expect(store.streamingRunToConversation["r-err"]).toBeUndefined();
		expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error", message: "Run failed: boom" }));
		addToast.mockClear();
		emit("run:error", { run: run("r-err2") });
		expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: "Run failed: Unknown error" }));
		const toast = addToast.mock.calls[0]![0] as { action: { onclick: () => void } };
		const assign = vi.fn();
		vi.stubGlobal("location", { ...window.location, set href(v: string) { assign(v); } });
		try {
			toast.action.onclick();
		} finally {
			vi.unstubAllGlobals();
		}
		expect(assign).toHaveBeenCalledWith("/runs/r-err2");
	});

	test("run:cancel cleans up without a toast", () => {
		startStreaming("r-cancel", "c-cancel");
		emit("run:cancel", { run: run("r-cancel") });
		expect(store.streamingRunToConversation["r-cancel"]).toBeUndefined();
		expect(addToast).not.toHaveBeenCalled();
	});
});

describe("running agent pills when the parent run ends", () => {
	test("run:complete settles a running pill to complete; run:error to error with a reason", () => {
		for (const [type, status, preview] of [
			["run:complete", "complete", undefined],
			["run:error", "error", "Cancelled — parent run failed"],
		] as const) {
			const runId = `r-${type}`;
			store.streamingAgentCalls = {
				[runId]: [
					{ subConversationId: "s1", agentName: "x", agentConfigId: "cfg", task: "t", status: "running", agentRunId: "a1", startedAt: 0 },
					{ subConversationId: "s2", agentName: "y", agentConfigId: "cfg", task: "t", status: "complete", agentRunId: "a2", startedAt: 0 },
				],
			} as typeof store.streamingAgentCalls;
			emit(type, { run: run(runId) });
			const seen = store.streamingAgentCalls[runId]!.map((a) => [a.status, a.resultPreview]);
			expect(seen).toEqual([[status, preview], ["complete", undefined]]);
		}
	});
});

describe("agent events", () => {
	test("agent:spawn adds a pill once and re-invoking the same sub-conversation resets it to running", () => {
		startStreaming("r-ag", "c-ag");
		const spawn = { runId: "r-ag", subConversationId: "s1", agentName: "x", agentConfigId: "cfg", task: "t1", agentRunId: "ar1" };
		emit("agent:spawn", spawn);
		emit("agent:status", { runId: "r-ag", subConversationId: "s1", status: "reading files" });
		expect(store.streamingAgentCalls["r-ag"]![0]!.statusText).toBe("reading files");
		emit("agent:spawn", { ...spawn, task: "t2", agentRunId: "ar2" });
		const pills = store.streamingAgentCalls["r-ag"]!;
		expect(pills).toHaveLength(1);
		expect(pills[0]).toMatchObject({ status: "running", task: "t2", agentRunId: "ar2", statusText: undefined });
		expect(store.streamingContentBlocks["r-ag"]).toHaveLength(1);
	});

	test("agent:spawn without a stream adds the pill but no content block; agent:status for an unknown run is ignored", () => {
		emit("agent:spawn", { runId: "r-nostream", subConversationId: "s1", agentName: "x", agentConfigId: "cfg", task: "t", agentRunId: "ar1" });
		expect(store.streamingAgentCalls["r-nostream"]).toHaveLength(1);
		expect(store.streamingContentBlocks["r-nostream"]).toBeUndefined();
		const before = store.streamingAgentCalls;
		emit("agent:status", { runId: "r-none", subConversationId: "s1", status: "x" });
		expect(store.streamingAgentCalls).toBe(before);
	});

	test("agent:complete resolves the pill in any run bucket, notifies the chat, and toasts a failure", () => {
		startStreaming("r-spawn", "c-parent");
		emit("agent:spawn", { runId: "r-spawn", subConversationId: "s1", agentName: "Coder", agentConfigId: "cfg", task: "t", agentRunId: "ar1" });
		const notices = windowEvents("ez:agent_complete", () =>
			emit("agent:complete", { runId: "r-last-cycle", subConversationId: "s1", agentName: "Coder", success: false, resultPreview: "crashed", agentRunId: "ar1", parentConversationId: "c-parent" }),
		);
		expect(store.streamingAgentCalls["r-spawn"]![0]).toMatchObject({ status: "error", resultPreview: "crashed" });
		expect(notices).toEqual([{ parentConversationId: "c-parent", subConversationId: "s1" }]);
		expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error", message: 'Agent "Coder" failed: crashed' }));
	});

	test("agent:complete for an unknown pill changes nothing and a success raises no toast", () => {
		const before = store.streamingAgentCalls;
		const notices = windowEvents("ez:agent_complete", () =>
			emit("agent:complete", { runId: "r", subConversationId: "nobody", agentName: "x", success: true, resultPreview: "ok" }),
		);
		expect(store.streamingAgentCalls).toBe(before);
		expect(notices).toEqual([]);
		expect(addToast).not.toHaveBeenCalled();
	});

	test("a failed agent with no preview says Unknown error", () => {
		emit("agent:complete", { runId: "r", subConversationId: "nobody", agentName: "x", success: false });
		expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Agent "x" failed: Unknown error' }));
	});
});

describe("workflow and extension events", () => {
	test("workflow:start lists the run first and step/complete/error update it in place", () => {
		store.workflowRuns = [];
		emit("workflow:start", { workflowRun: { id: "w1", status: "running" } });
		for (const [type, status] of [["workflow:step", "running"], ["workflow:complete", "completed"], ["workflow:error", "failed"]] as const) {
			emit(type, { workflowRun: { id: "w1", status } });
			expect(store.workflowRuns).toEqual([{ id: "w1", status }]);
		}
	});

	test("ext:state stores the panel state; an event without an extension id is ignored", () => {
		emit("ext:state", { extensionId: "e1", extensionName: "Ext", state: { n: 1 } });
		expect(store.extensionPanelStates.e1).toEqual({ extensionName: "Ext", state: { n: 1 } });
		const before = store.extensionPanelStates;
		emit("ext:state", { extensionId: "", extensionName: "Ext", state: {} });
		expect(store.extensionPanelStates).toBe(before);
	});

	test("ez:client-tool and ext:page-state are re-dispatched as window events", () => {
		const tool = { tool: "navigate_to", input: { path: "/agents" } };
		expect(windowEvents("ez:client-tool", () => emit("ez:client-tool", tool))).toEqual([tool]);
		const page = { extensionId: "e1", extensionName: "Ext", pageId: "home" };
		expect(windowEvents("ext:page-state", () => emit("ext:page-state", page))).toEqual([page]);
	});

	test("an event type with no handler is ignored", () => {
		expect(() => emit("not:a-real-event", {})).not.toThrow();
	});
});

describe("tool events", () => {
	test("tool events from an inline invocation go to the inline tool store, not the run", () => {
		const update = vi.spyOn(inlineToolStore, "updateFromEvent").mockImplementation(() => {});
		const base = { conversationId: "c-inline", toolName: "t", source: "inline", invocationId: "inv-1" };
		emit("tool:start", { ...base, input: {}, timestamp: 5, cardType: "chart", cardLayout: "dock" });
		emit("tool:complete", { ...base, output: "ok", duration: 7, success: true, cardType: "chart", cardLayout: "inline" });
		emit("tool:complete", { ...base, output: "bad", duration: 8, success: false });
		emit("tool:error", { ...base, error: "boom", duration: 9, cardType: "chart", cardLayout: "dock" });
		expect(update.mock.calls).toEqual([
			["inv-1", "tool:start", { timestamp: 5, cardType: "chart", cardLayout: "dock" }],
			["inv-1", "tool:complete", { output: "ok", duration: 7, cardType: "chart", cardLayout: "inline" }],
			["inv-1", "tool:error", { error: "bad", duration: 8 }],
			["inv-1", "tool:error", { error: "boom", duration: 9, cardType: "chart", cardLayout: "dock" }],
		]);
		expect(store.streamingToolCalls["c-inline"]).toBeUndefined();
	});

	test("a permission request marks the matching running tool call instead of adding another", () => {
		startStreaming("r-perm", "c-perm");
		emit("tool:start", { conversationId: "c-perm", toolName: "bash", input: { cmd: "ls" }, timestamp: 1 });
		emit("tool:permission_request", {
			conversationId: "c-perm",
			toolCallId: "tc-9",
			toolName: "bash",
			input: { cmd: "ls" },
			cardLayout: "dock",
			category: "execute",
			extensionId: "ext-1",
			capabilityKind: "shell",
			capabilityValue: "ls",
		});
		const calls = store.streamingToolCalls["r-perm"]!;
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			id: "tc-9",
			toolName: "bash",
			status: "running",
			permissionPending: true,
			cardLayout: "dock",
			category: "execute",
			extensionId: "ext-1",
			capabilityKind: "shell",
			capabilityValue: "ls",
		});
	});
});
