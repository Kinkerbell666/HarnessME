import {
	fetchAgents,
	fetchRuns,
	fetchProjects,
	fetchSettings,
	fetchAgentConfigs,
	fetchWorkflows,
	type Agent,
	type Run,
	type Project,
	type Settings,
	type AgentConfig,
	type Workflow,
	type WorkflowRun,
} from "./api.js";
import { createWSClient, type WSEvent } from "./ws.js";
import { addToast } from "./toast.svelte.js";
import { inlineToolStore } from "./inline-tool-store.svelte.js";
import { unreadStore } from "./unread.js";
import { ContentBlockBuilder, type ContentBlock } from "./content-blocks.js";
import { appendStreamingToolCall } from "./chat/streaming-tool-calls.js";
export type { ContentBlock } from "./content-blocks.js";
import {
	registerSpawn as routingRegisterSpawn,
	unregisterSpawn as routingUnregisterSpawn,
	resolveRunForConversation as routingResolveRunForConversation,
	getActiveRunIdForConversation as routingGetActiveRunIdForConversation,
	type RoutingState,
} from "./sub-agent-routing.js";
import { readTeamPanel, writeTeamPanel } from "./panel-persistence.js";
import type { PendingApprovalNotice } from "./workflow-approvals-logic.js";
import type { SensitiveCapabilityKind } from "$server/extensions/capability-types";
import {
	applyAssignmentUpdate as reduceAssignmentUpdate,
	applyHydratedSnapshot as reduceHydratedSnapshot,
	applyLiveSnapshot as reduceLiveSnapshot,
	seqFor as taskSeqFor,
	type TaskSnapshotState,
} from "./chat/task-snapshot-store.js";
import { extractToolOutput } from "./tool-output.js";

let _wsManualRetry: (() => void) | null = null;
export function wsManualRetry() { _wsManualRetry?.(); }

/**
 * Re-exported from `./tool-output.js`, which is now the single implementation
 * (issue #142). It used to be defined here and copied by hand into five other
 * places; `$lib/tool-output` is the one every caller — product and test —
 * imports. The re-export stays so existing `$lib/stores.svelte` importers keep
 * resolving, and the tool-event handlers below call the same function.
 */
export { extractToolOutput };

export interface ToolCallState {
	id?: string;
	toolName: string;
	status: 'running' | 'complete' | 'error';
	input?: unknown;
	output?: unknown;
	error?: string;
	startedAt: number;
	duration?: number;
	extensionId?: string;
	cardType?: string;
	/** "inline" (default) or "dock" — when "dock" + status="complete",
	 *  the chat UI renders a navigable pill in the message bubble and
	 *  mounts the routed card in the right-side `DockHost` panel. */
	cardLayout?: 'inline' | 'dock';
	category?: string;
	/** A client-owned inline call already carries its full event output. Its
	 * invocation id is not a persisted tool_calls row, so expanding its card
	 * must not request `/api/tool-calls/:id/output`. */
	source?: 'inline' | 'agent-run';
	permissionPending?: boolean;
	/** Phase 6: sensitive capability that triggered an extension-scoped
	 *  permission prompt. Routes the modal to the four-scope chooser
	 *  (session/conversation/project/forever) for `shell` and `fs.write`
	 *  ops on extensions. Built-in tool gates (read/write/execute) leave
	 *  this undefined and use the legacy two-button modal. */
	capabilityKind?: SensitiveCapabilityKind;
	capabilityValue?: string;
}

/**
 * Per-conversation dock slot state. `userOverrode` flips to true when the
 * user manually toggles the sidebar after `openDock` snapshotted the
 * previous state — sidebar restore-on-close skips when set, per plan §7.2.
 */
export interface DockSlot {
	toolCallId: string;
	previousSidebar: boolean;
	userOverrode: boolean;
}

export interface AgentCallState {
	subConversationId: string;
	agentName: string;
	agentConfigId: string;
	task: string;
	status: 'running' | 'complete' | 'error';
	statusText?: string;
	resultPreview?: string;
	agentRunId?: string;
	startedAt: number;
}

// ── Task tracking panel ──

export interface TaskPanelSubtask {
	id: string;
	title: string;
	completed: boolean;
	position: number;
}

export type AssignmentStatus = "assigned" | "running" | "completed" | "failed";

export interface TaskAssignment {
	id: string;
	agentConfigId: string;
	agentName: string;
	isTeam: boolean;
	status: AssignmentStatus;
	assignedAt: string;
	startedAt?: string;
	completedAt?: string;
	failedAt?: string;
	subConversationId?: string;
	agentRunId?: string;
	resultPreview?: string;
	/** Current autonomous self-continuation cycle (1-based) — present
	 *  only while an opted-in assignment is looping. */
	autonomousCycle?: number;
	/** Cycle cap for this assignment's autonomous continuation. */
	autonomousMaxCycles?: number;
	/**
	 * Structured-output schema failure (Phase B4). Captured from the
	 * terminal `task:assignment_update` event's top-level
	 * `structuredResultError` field (which the backend keeps OFF the
	 * assignment object) — true when the child finished but never produced
	 * schema-valid JSON. A validated-but-oversized result also carries
	 * `structuredResultError` but with `structuredResultOverCap=true`; that
	 * is NOT a schema failure, so it does NOT set this flag. Drives the
	 * amber "schema" chip on the completed pill so a schema-FAILED
	 * assignment isn't presented as a plain green success.
	 */
	schemaFailed?: boolean;
}

export interface TaskPanelTask {
	id: string;
	title: string;
	description: string;
	status: "pending" | "active" | "completed" | "failed";
	agentId?: string;
	agentName?: string;
	subtasks: TaskPanelSubtask[];
	assignments: TaskAssignment[];
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
	failedAt?: string;
	failureReason?: string;
	completionSummary?: string;
	priority: number;
	/**
	 * Prerequisite task IDs. When any entry refers to a task that isn't
	 * `completed`, this task is "blocked" — the TaskPanel shows a "Waiting
	 * for: X, Y" badge and the AssignmentPill start button is disabled.
	 * See backend `TrackedTask.dependsOn` for the contract.
	 */
	dependsOn?: string[];
}

export interface TaskSnapshot {
	conversationId: string;
	tasks: TaskPanelTask[];
	activeTaskId?: string;
}

export interface QuickstartSteps {
	provider: boolean;
	usableProvider?: boolean;
	chat: boolean;
	extension: boolean;
	agent: boolean;
}

class AppStore {
	agents = $state<Agent[]>([]);
	runs = $state<Run[]>([]);
	connected = $state(false);
	projects = $state<Project[]>([]);
	activeProjectId = $state<string>(
		typeof localStorage !== "undefined" ? (localStorage.getItem("activeProjectId") ?? "global") : "global",
	);
	settings = $state<Settings>({});
	agentConfigs = $state<AgentConfig[]>([]);
	workflows = $state<Workflow[]>([]);
	workflowRuns = $state<WorkflowRun[]>([]);
	// Shared server-owned completion state for the persistent checklist and
	// the chat provider guard. Mutations refresh this resource in place.
	quickstartSteps = $state<QuickstartSteps | null>(null);

	// Theme and layout state
	theme = $state<"dark" | "light" | "system">(
		typeof localStorage !== "undefined"
			? ((localStorage.getItem("ezcorp-theme") as "dark" | "light") ?? "system")
			: "system",
	);
	sidebarCollapsed = $state<boolean>(
		typeof localStorage !== "undefined" ? localStorage.getItem("pi-sidebar-collapsed") === "true" : false,
	);
	mobileMenuOpen = $state<boolean>(false);

	// Chat streaming state
	streamingMessages = $state<Record<string, string>>({});
	streamingThinking = $state<Record<string, string>>({});
	streamingRunToConversation = $state<Record<string, string>>({});
	streamingUsage = $state<Record<string, { inputTokens: number; outputTokens: number }>>({});
	streamingStatus = $state<Record<string, string>>({});
	// Tool call progress per run: runId -> array of tool calls
	streamingToolCalls = $state<Record<string, ToolCallState[]>>({});
	// Ordered content blocks per run for interleaved text/tool rendering
	streamingContentBlocks = $state<Record<string, ContentBlock[]>>({});
	// Agent sub-conversation tracking per run
	streamingAgentCalls = $state<Record<string, AgentCallState[]>>({});
	// Maps sub-conversation IDs and agent runIds to their root (user-visible)
	// runId so that events fired on sub-conversations (tool permissions etc.)
	// can be routed back to the parent conversation the user is watching.
	subConvToRootRun = $state<Record<string, string>>({});
	agentRunToRootRun = $state<Record<string, string>>({});
	// Tracks the run ID that triggered a memory_unavailable event (null = recovered)
	memoryUnavailableRunId = $state<string | null>(null);
	// Track runs that completed before startStreaming was called (race condition)
	completedBeforeStream = $state<Set<string>>(new Set());
	// Task panel snapshots per conversation. Written by the `task:snapshot` /
	// `task:assignment_update` bus events AND by the cold-start hydrate that
	// `$lib/chat/page-handlers/task-hydrate.svelte.ts` fires on mount,
	// conversation switch and SSE reconnect. All three go through the reducer
	// in `$lib/chat/task-snapshot-store.ts`, which owns the ordering rules.
	taskSnapshots = $state<Record<string, TaskSnapshot>>({});
	// Per-conversation live-event counter backing the reducer's staleness
	// check. Not rendered, so deliberately not reactive.
	taskSeq: Record<string, number> = {};
	// Bumped when an assignment delta arrives for a conversation with no
	// loaded snapshot; the hydration effect watches it and resyncs.
	taskHydrationRequests = $state(0);
	// Bumped on each WS reconnect so $effects can re-fetch stale state
	wsReconnectCount = $state(0);
	// Server-reported staleness for the active run of each conversation. Populated by the
	// chat page's zombie-timer $effect from the /active-run GET response (stalenessMs field).
	// Drives the StuckRunBanner so users can see when the backend is silent.
	runStaleness = $state<Record<string, { stalenessMs: number; startedAt: number }>>({});
	// Extension panel states (updated via ext:state WS events from sandboxed extensions)
	extensionPanelStates = $state<Record<string, { extensionName: string; state: Record<string, unknown> }>>({});
	// Team panel state for viewing agent team details. Restored from
	// localStorage on app load so the panel reopens to its prior state
	// after a refresh; persisted on every mutation via the helpers below.
	teamPanel = $state<{
		open: boolean;
		agentConfigId: string | null;
		teamName: string | null;
		conversationId: string | null;
		drillDownAgent: { subConversationId: string; agentName: string; turnIndex?: number } | null;
	}>(readTeamPanel() ?? { open: false, agentConfigId: null, teamName: null, conversationId: null, drillDownAgent: null });

	// ── Canvas Dock SDK ──
	// Per-conversation dock slot — null when no dock is open in that
	// conversation. Cleared by `closeDock`. See `openDock` for snapshot
	// semantics. Mounted by `DockHost.svelte` at app-layout level.
	dockState = $state<Record<string, DockSlot>>({});

	// Dock width in pixels. Drag-handle on `DockHost` writes here via
	// `setDockSize`; clamped to [320, viewportWidth*0.8] and persisted
	// to localStorage("ezcorp-dock-size-px"). Default = 50% of viewport
	// when no prior value exists.
	dockSizePx = $state<number>(_initDockSizePx());

	// Per-conversation set of toolCallIds the user explicitly dismissed
	// (closed the dock). The auto-open `$effect` in InlineToolCard /
	// ToolCallCard checks this set and skips scheduling `openDock` for
	// dismissed ids — without it, `closeDock` triggers an immediate
	// re-open loop because `routeToDock` is still true. A manual reopen
	// via `DockOpenPill` (or any direct `openDock` call) clears the entry
	// for that toolCallId. New tool calls from the agent are unaffected.
	dismissedDocks = $state<Record<string, Record<string, true>>>({});

	// ── Fallback pending-permission tray ──
	// Permission prompts whose conversation maps to NO active run (e.g. an
	// extension-initiated privileged tool call — ez-code-factory's init_gate
	// hitting fs.write/shell — fires `tool:permission_request` on a
	// conversation the streaming layer never registered a run for). Without a
	// run, the chat-inline PermissionGate has nowhere to mount, so the
	// approval card would never render and the backend gate hangs forever.
	// These entries drive a global `PendingPermissionTray` overlay so the
	// user can still approve/deny. Keyed by toolCallId (the promptId the
	// backend gate resolves via POST /api/tool-calls/:id/permission).
	pendingPermissions = $state<ToolCallState[]>([]);

	// ── Pending workflow approvals ──
	// A workflow run that parked on an `approval` step. Same problem shape
	// as the tray above and solved the same way: the decision arrives
	// asynchronously — routinely minutes after whatever tool call started
	// the run — on no conversation the client can map, so there is no
	// inline slot to mount it in. A durable run also outlives the tab, so
	// "render it where the request came from" is not a thing that exists.
	// Keyed by approvalId; answering POSTs to
	// /api/workflows/approvals/:id, which is the same `answerApproval`
	// chokepoint the inbox and the Hub action clear.
	pendingApprovals = $state<PendingApprovalNotice[]>([]);
}

function _initDockSizePx(): number {
	if (typeof window === 'undefined') return 640;
	try {
		const stored = localStorage.getItem('ezcorp-dock-size-px');
		const parsed = stored ? parseInt(stored, 10) : NaN;
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	} catch { /* SSR / private mode */ }
	return Math.round(window.innerWidth * 0.5);
}

export const store = new AppStore();

export function setActiveProjectId(id: string | null) {
	store.activeProjectId = id ?? "global";
	if (typeof localStorage !== "undefined") {
		localStorage.setItem("activeProjectId", store.activeProjectId);
	}
}

export async function refreshProjects(): Promise<boolean> {
	try {
		store.projects = await fetchProjects();
		return true;
	} catch {
		// Keep the last known project list when refresh fails.
		return false;
	}
}

function refreshSettings() {
	fetchSettings()
		.then((data) => {
			store.settings = data;
		})
		.catch(() => {});
}

export function refreshAgentConfigs() {
	fetchAgentConfigs()
		.then((data) => {
			store.agentConfigs = data;
		})
		.catch(() => {});
}

/**
 * A conversation list somewhere is out of date: one was created, renamed,
 * deleted, or a title was generated. Every list listens — the sidebar's chat
 * section, the all-chats page, the mobile drawer — so none of them needs a
 * reference to another. `projectId` scopes it; omitted, every list refreshes.
 *
 * Before the chat threads moved into the sidebar there was exactly one list
 * on screen and the conversation page refreshed it through a bound component
 * ref. With two lists mounted at once, a ref reaches only one of them.
 */
export const CONVERSATIONS_CHANGED = "conversations:changed";

export function notifyConversationsChanged(projectId?: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent(CONVERSATIONS_CHANGED, { detail: { projectId } }));
}

let quickstartRequest = 0;

/** Reload completion state after a provider, conversation, or extension mutation. */
export async function refreshQuickstart(): Promise<void> {
	const request = ++quickstartRequest;
	try {
		const response = await fetch("/api/quickstart");
		if (!response.ok || request !== quickstartRequest) return;
		const data = (await response.json()) as { steps?: Partial<QuickstartSteps> };
		if (!data.steps || request !== quickstartRequest) return;
		store.quickstartSteps = {
			provider: data.steps.provider === true,
			usableProvider: data.steps.usableProvider ?? data.steps.provider === true,
			chat: data.steps.chat === true,
			extension: data.steps.extension === true,
			agent: data.steps.agent === true,
		};
	} catch {
		// Existing state remains useful if a refresh races a transient failure.
	}
}

/** Reload the workflow list into the store.
 *
 *  Returns the promise (existing fire-and-forget callers are unaffected) so
 *  a caller that must act on the FRESH list can await it — the rename path
 *  on `/workflows/[name]` navigates to the new name and would otherwise
 *  race the refetch and land on "not found". Always resolves; a failed
 *  refresh leaves the previous list in place. */
export function refreshWorkflows(): Promise<void> {
	return fetchWorkflows()
		.then((data) => {
			store.workflows = data;
		})
		.catch(() => {});
}

// ── Chat streaming helpers ──────────────────────────────────────────

/** Content block builders per run (imperative, not reactive — snapshots are pushed to store) */
const blockBuilders = new Map<string, ContentBlockBuilder>();

/** Token buffer for requestAnimationFrame batching */
let tokenBuffer: Record<string, string> = {};
let thinkingTokenBuffer: Record<string, string> = {};
let rafPending = false;

/** Flush buffered tokens for a single run. Called before tool_ref insertion to preserve ordering. */
function flushTokensForRun(runId: string) {
	const tokens = tokenBuffer[runId];
	if (!tokens) return;
	delete tokenBuffer[runId];
	if (store.streamingRunToConversation[runId] !== undefined || store.streamingMessages[runId] !== undefined) {
		const current = store.streamingMessages[runId] ?? "";
		store.streamingMessages = { ...store.streamingMessages, [runId]: current + tokens };
		const builder = blockBuilders.get(runId);
		if (builder) {
			builder.appendText(tokens);
			store.streamingContentBlocks = { ...store.streamingContentBlocks, [runId]: builder.snapshot() };
		}
	}
}

function flushTokenBuffer() {
	rafPending = false;
	// Flush thinking tokens
	for (const [runId, tokens] of Object.entries(thinkingTokenBuffer)) {
		if (store.streamingRunToConversation[runId] !== undefined || store.streamingThinking[runId] !== undefined) {
			const current = store.streamingThinking[runId] ?? "";
			store.streamingThinking = { ...store.streamingThinking, [runId]: current + tokens };
			const builder = blockBuilders.get(runId);
			if (builder) {
				builder.appendThinking(tokens);
				store.streamingContentBlocks = { ...store.streamingContentBlocks, [runId]: builder.snapshot() };
			}
		}
	}
	thinkingTokenBuffer = {};
	// Flush text tokens
	for (const [runId, tokens] of Object.entries(tokenBuffer)) {
		// Only flush if still actively streaming (not yet stopped)
		if (store.streamingRunToConversation[runId] !== undefined || store.streamingMessages[runId] !== undefined) {
			const current = store.streamingMessages[runId] ?? "";
			store.streamingMessages = {
				...store.streamingMessages,
				[runId]: current + tokens,
			};
			// Also append to content block builder and push snapshot
			const builder = blockBuilders.get(runId);
			if (builder) {
				builder.appendText(tokens);
				store.streamingContentBlocks = {
					...store.streamingContentBlocks,
					[runId]: builder.snapshot(),
				};
			}
		}
	}
	tokenBuffer = {};
}

function scheduleFlush() {
	if (!rafPending && typeof requestAnimationFrame !== "undefined") {
		rafPending = true;
		requestAnimationFrame(flushTokenBuffer);
	} else if (typeof requestAnimationFrame === "undefined") {
		flushTokenBuffer();
	}
}

function bufferToken(runId: string, token: string) {
	tokenBuffer[runId] = (tokenBuffer[runId] ?? "") + token;
	scheduleFlush();
}

function bufferThinkingToken(runId: string, token: string) {
	thinkingTokenBuffer[runId] = (thinkingTokenBuffer[runId] ?? "") + token;
	scheduleFlush();
}

/** Returns false if the run already completed/errored before streaming could start */
export function startStreaming(runId: string, conversationId: string): boolean {
	// If the run already completed/errored before we got here, don't start streaming
	if (store.completedBeforeStream.has(runId)) {
		store.completedBeforeStream = new Set([...store.completedBeforeStream].filter(id => id !== runId));
		return false;
	}
	// Re-attach: the runId is already streaming (EventSource + store survived a
	// SPA navigation, and the chat page's convId effect re-fired on return).
	// Preserve all accumulated tokens, thinking, content blocks, agent pills,
	// and the ContentBlockBuilder — only (re-)assert the conversation mapping.
	if (store.streamingRunToConversation[runId] !== undefined && blockBuilders.has(runId)) {
		if (store.streamingRunToConversation[runId] !== conversationId) {
			store.streamingRunToConversation = { ...store.streamingRunToConversation, [runId]: conversationId };
		}
		return true;
	}
	const existing = store.streamingMessages[runId] ?? "";
	store.streamingMessages = { ...store.streamingMessages, [runId]: existing };
	store.streamingThinking = { ...store.streamingThinking, [runId]: "" };
	store.streamingRunToConversation = { ...store.streamingRunToConversation, [runId]: conversationId };
	blockBuilders.set(runId, new ContentBlockBuilder());
	store.streamingContentBlocks = { ...store.streamingContentBlocks, [runId]: [] };
	store.streamingAgentCalls = { ...store.streamingAgentCalls, [runId]: [] };
	return true;
}

export function stopStreaming(runId: string) {
	const { [runId]: _, ...rest } = store.streamingMessages;
	store.streamingMessages = rest;
	const { [runId]: _t, ...restThinking } = store.streamingThinking;
	store.streamingThinking = restThinking;
	const { [runId]: __, ...restConv } = store.streamingRunToConversation;
	store.streamingRunToConversation = restConv;
	const { [runId]: ___, ...restStatus } = store.streamingStatus;
	store.streamingStatus = restStatus;
	const { [runId]: ____, ...restTools } = store.streamingToolCalls;
	store.streamingToolCalls = restTools;
	blockBuilders.delete(runId);
	const { [runId]: _____, ...restBlocks } = store.streamingContentBlocks;
	store.streamingContentBlocks = restBlocks;
	const { [runId]: ______, ...restAgents } = store.streamingAgentCalls;
	store.streamingAgentCalls = restAgents;
}

/** Build a snapshot of the store's routing state for the pure routing module. */
function routingSnapshot(): RoutingState {
	return {
		streamingRunToConversation: store.streamingRunToConversation,
		subConvToRootRun: store.subConvToRootRun,
		agentRunToRootRun: store.agentRunToRootRun,
	};
}

/** Apply a new routing state to the store, writing back only the maps that changed. */
function applyRoutingState(next: RoutingState): void {
	if (next.streamingRunToConversation !== store.streamingRunToConversation) {
		store.streamingRunToConversation = next.streamingRunToConversation;
	}
	if (next.subConvToRootRun !== store.subConvToRootRun) {
		store.subConvToRootRun = next.subConvToRootRun;
	}
	if (next.agentRunToRootRun !== store.agentRunToRootRun) {
		store.agentRunToRootRun = next.agentRunToRootRun;
	}
}

export function getActiveRunIdForConversation(conversationId: string): string | undefined {
	return routingGetActiveRunIdForConversation(routingSnapshot(), conversationId);
}

/**
 * Resolve an event's conversationId to the root (user-visible) runId.
 * Handles both root conversations and sub-conversations spawned by agents,
 * so events fired by sub-agents reach the UI the user is watching.
 */
function resolveRunForConversation(conversationId: string): string | undefined {
	return routingResolveRunForConversation(routingSnapshot(), conversationId);
}

/** Send permission response (allow/deny) for a pending tool call.
 *  Phase 6: extension-scoped requests pass the optional `scope` arg
 *  naming the user-chosen always-allow scope. Built-in tool gates omit
 *  it (the server route ignores the field on built-in gates).
 *  Phase 56: optional `ttlOverrideMs` carries the picker's per-row TTL
 *  selection. `number` for a positive override; `null` for "Never"
 *  (sweep skips the row). `undefined`/omitted → legacy path (server
 *  falls back to TTL_CONFIG[kind]). */
export async function sendToolPermissionResponse(
	toolCallId: string,
	approved: boolean,
	scope?: 'session' | 'conversation' | 'project' | 'forever',
	ttlOverrideMs?: number | null,
): Promise<void> {
	const body: Record<string, unknown> = { approved };
	if (scope !== undefined) body.scope = scope;
	if (ttlOverrideMs !== undefined) body.ttlOverrideMs = ttlOverrideMs;
	await fetch(`/api/tool-calls/${toolCallId}/permission`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

/** Register a permission prompt on the fallback tray (see
 *  `store.pendingPermissions`). Idempotent by `toolCall.id` — a duplicate
 *  `tool:permission_request` (SSE resume / reconnect replay) updates the
 *  existing entry instead of stacking a second card. Entries with no id are
 *  ignored (the backend gate is keyed by the tool-call/prompt id, so a
 *  card with no id could never be resolved). */
export function registerPendingPermission(toolCall: ToolCallState): void {
	if (!toolCall.id) return;
	const idx = store.pendingPermissions.findIndex((p) => p.id === toolCall.id);
	if (idx >= 0) {
		const next = [...store.pendingPermissions];
		next[idx] = toolCall;
		store.pendingPermissions = next;
	} else {
		store.pendingPermissions = [...store.pendingPermissions, toolCall];
	}
}

/** Remove a resolved (or superseded) prompt from the fallback tray. */
export function dismissPendingPermission(toolCallId: string): void {
	store.pendingPermissions = store.pendingPermissions.filter((p) => p.id !== toolCallId);
}

/** Put a parked approval on the pending-decisions tray. Idempotent by
 *  `approvalId` — a duplicate `workflow:approval_request` (SSE resume
 *  replays every buffered event after the cursor) REPLACES the entry
 *  rather than stacking a second card for one decision. An entry with no
 *  id is ignored: the answer route is keyed by it, so a card without one
 *  could never be resolved. */
export function registerPendingApproval(notice: PendingApprovalNotice): void {
	if (!notice.approvalId) return;
	const idx = store.pendingApprovals.findIndex((a) => a.approvalId === notice.approvalId);
	if (idx >= 0) {
		const next = [...store.pendingApprovals];
		next[idx] = notice;
		store.pendingApprovals = next;
	} else {
		store.pendingApprovals = [...store.pendingApprovals, notice];
	}
}

/** Remove an answered (or otherwise resolved) approval from the tray. */
export function dismissPendingApproval(approvalId: string): void {
	store.pendingApprovals = store.pendingApprovals.filter((a) => a.approvalId !== approvalId);
}

/** Send kill signal for a running tool call */
export function sendToolKill(toolCallId: string): void {
	fetch(`/api/tool-calls/${toolCallId}/kill`, { method: 'POST' }).catch(() => {});
}

export function getStreamingToolCalls(runId: string): ToolCallState[] {
	return store.streamingToolCalls[runId] ?? [];
}

export function getStreamingContentBlocks(runId: string): ContentBlock[] {
	return store.streamingContentBlocks[runId] ?? [];
}

export function getStreamingAgentCalls(runId: string): AgentCallState[] {
	return store.streamingAgentCalls[runId] ?? [];
}

export function getTaskSnapshot(conversationId: string): TaskSnapshot | undefined {
	return store.taskSnapshots[conversationId];
}

export function getWsReconnectCount(): number {
	return store.wsReconnectCount;
}

export function setTaskSnapshot(snapshot: TaskSnapshot): void {
	commitTaskState(reduceLiveSnapshot(readTaskState(), snapshot));
}

// ── Task-snapshot reducer glue ──
//
// The reducer (`$lib/chat/task-snapshot-store.ts`) is a plain module so it
// can be unit-tested; these three functions are the only bridge between it
// and the rune store.

/** Read the store's two task fields as one reducer state object. */
function readTaskState(): TaskSnapshotState {
	return { snapshots: store.taskSnapshots, seq: store.taskSeq };
}

/**
 * Write a reducer result back. Skips the reactive assignment when the reducer
 * returned the state unchanged, and raises a hydration request when a delta
 * arrived for a conversation we have no snapshot for.
 */
function commitTaskState(result: ReturnType<typeof reduceLiveSnapshot>): void {
	if (result.state.snapshots !== store.taskSnapshots) {
		store.taskSnapshots = result.state.snapshots;
		store.taskSeq = result.state.seq;
	}
	if (result.hydrateNeeded) store.taskHydrationRequests++;
}

/** Reactive counter the hydration effect watches for resync requests. */
export function taskHydrationRequests(): number {
	return store.taskHydrationRequests;
}

/**
 * Live-event count for a conversation. The hydration effect snapshots this
 * BEFORE issuing its fetch and hands it back on apply, so a response that was
 * overtaken by a newer bus event is discarded instead of rolling the panel
 * back.
 */
export function getTaskSeq(conversationId: string): number {
	return taskSeqFor(readTaskState(), conversationId);
}

/**
 * Apply a cold-start `GET /api/conversations/:id/tasks` response. Dropped by
 * the reducer when a live event overtook it mid-flight.
 */
export function hydrateTaskSnapshotInto(
	conversationId: string,
	payload: { tasks?: unknown; activeTaskId?: string } | null | undefined,
	seqAtFetchStart: number,
): void {
	const next = reduceHydratedSnapshot(readTaskState(), conversationId, payload, seqAtFetchStart);
	if (next.snapshots !== store.taskSnapshots) store.taskSnapshots = next.snapshots;
}

// ── Canvas Dock helpers ──
//
// Four-method API:
//   - openDock(convId, toolCallId): snapshot sidebar, force-collapse it,
//     persist the dock-state to localStorage. Idempotent on a no-op same-id
//     call. Replacing the toolCallId leaves `previousSidebar` snapshot intact
//     so close still restores the user's pre-dock state.
//   - closeDock(convId): clear the slot, remember an explicit user dismissal,
//     and restore previousSidebar unless the user manually changed it.
//   - clearStaleDock(convId): clear an unresolvable slot without treating it
//     as a user dismissal, so later authoritative history may reopen it.
//   - setDockSize(px): clamp + persist.
//
// Per-conversation reload restore is keyed on `ezcorp-dock-state-<convId>`
// in localStorage; `DockHost` reads this on mount via `_readDockSlot`.

const DOCK_SIZE_KEY = 'ezcorp-dock-size-px';

function _dockStateKey(conversationId: string): string {
	return `ezcorp-dock-state-${conversationId}`;
}

/**
 * Persist a dock slot to localStorage so a hard reload reopens the dock at
 * the same toolCallId. Stores `{toolCallId, lastOpenedAt}` only — `previousSidebar`
 * doesn't need to round-trip because on reload we're starting fresh and the
 * sidebar's stored value is the user's current preference anyway. Best-effort:
 * any storage exception (private-mode, quota) is silently swallowed.
 */
function _writeDockSlotLS(conversationId: string, slot: { toolCallId: string }): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(
			_dockStateKey(conversationId),
			JSON.stringify({ toolCallId: slot.toolCallId, lastOpenedAt: Date.now() }),
		);
	} catch { /* private mode / quota */ }
}

function _clearDockSlotLS(conversationId: string): void {
	if (typeof localStorage === 'undefined') return;
	try { localStorage.removeItem(_dockStateKey(conversationId)); } catch {}
}

/**
 * Read the persisted dock slot for a conversation. Used by DockHost on mount
 * to rehydrate the prior session's open dock — if the toolCallId is no longer
 * known to inlineToolStore (history was purged), the caller silently bails.
 */
export function readPersistedDockSlot(conversationId: string): { toolCallId: string; lastOpenedAt: number } | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(_dockStateKey(conversationId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { toolCallId?: unknown; lastOpenedAt?: unknown };
		if (typeof parsed?.toolCallId !== 'string') return null;
		return {
			toolCallId: parsed.toolCallId,
			lastOpenedAt: typeof parsed.lastOpenedAt === 'number' ? parsed.lastOpenedAt : Date.now(),
		};
	} catch { return null; }
}

/**
 * Open the dock for `conversationId` showing `toolCallId`. Snapshots the
 * current `sidebarCollapsed` only on the FIRST open (per replace-without-resnapshot
 * rule, plan §5 unit-test #2), then forces the sidebar collapsed.
 *
 * Re-calling with the SAME toolCallId is a no-op — useful so $effects in
 * `InlineToolCard` / `ChatMessage` can fire freely without double-opening.
 */
export function openDock(conversationId: string, toolCallId: string): void {
	// Manual / auto open clears the user-dismissed flag for this toolCallId.
	// Without this, clicking the chat-history "Canvas open ↗" pill after a
	// previous close would no-op forever because the auto-open effect would
	// still skip the dismissed id.
	const dismissed = store.dismissedDocks[conversationId];
	if (dismissed?.[toolCallId]) {
		const { [toolCallId]: _drop, ...remaining } = dismissed;
		store.dismissedDocks = {
			...store.dismissedDocks,
			[conversationId]: remaining,
		};
	}
	const existing = store.dockState[conversationId];
	if (existing && existing.toolCallId === toolCallId) {
		// Already open with this id — make sure the sidebar is still collapsed
		// (the user may have re-expanded it; we don't override that here, the
		// auto-replace path is for swapping toolCallId only).
		_writeDockSlotLS(conversationId, { toolCallId });
		return;
	}
	const previousSidebar = existing?.previousSidebar ?? store.sidebarCollapsed;
	const userOverrode = existing?.userOverrode ?? false;
	store.dockState = {
		...store.dockState,
		[conversationId]: { toolCallId, previousSidebar, userOverrode },
	};
	if (!store.sidebarCollapsed) {
		store.sidebarCollapsed = true;
		if (typeof localStorage !== 'undefined') {
			try { localStorage.setItem('pi-sidebar-collapsed', 'true'); } catch {}
		}
	}
	_writeDockSlotLS(conversationId, { toolCallId });
}

/**
 * Remove an open dock slot. Restore the sidebar to its `previousSidebar`
 * snapshot unless `userOverrode` is set after the auto-collapse.
 *
 * An explicit user close records a dismissal. An authoritative removal does
 * not, so a later authoritative tool call can open the dock again.
 */
function clearDockSlot(conversationId: string, userDismissed: boolean): void {
	const slot = store.dockState[conversationId];
	if (!slot) return;
	const { [conversationId]: _removed, ...rest } = store.dockState;
	store.dockState = rest;
	if (userDismissed) {
		// An explicit close must stop this still-complete card from reopening.
		const prevDismissed = store.dismissedDocks[conversationId] ?? {};
		store.dismissedDocks = {
			...store.dismissedDocks,
			[conversationId]: { ...prevDismissed, [slot.toolCallId]: true },
		};
	}
	if (!slot.userOverrode && store.sidebarCollapsed !== slot.previousSidebar) {
		store.sidebarCollapsed = slot.previousSidebar;
		if (typeof localStorage !== 'undefined') {
			try { localStorage.setItem('pi-sidebar-collapsed', String(slot.previousSidebar)); } catch {}
		}
	}
	_clearDockSlotLS(conversationId);
}

/** Close a dock the user explicitly dismissed. */
export function closeDock(conversationId: string): void {
	clearDockSlot(conversationId, true);
}

/** Clear a dock whose tool call is absent from authoritative history. */
export function clearStaleDock(conversationId: string): void {
	clearDockSlot(conversationId, false);
}

/**
 * Mark that the user manually changed `sidebarCollapsed` after `openDock`.
 * Called by the layout's toggle handler — the layout already owns sidebar
 * mutations, so this is the cheap centralized signal. Closes flip to "user
 * wins": restore-on-close becomes a no-op for this dock instance.
 *
 * Idempotent — flips the flag for whichever conversation currently has a
 * dock open. (Realistically only one is "active" in the UI at a time, but
 * we keep the contract per-conversation for future multi-pane layouts.)
 */
export function noteSidebarUserOverride(): void {
	const next: Record<string, DockSlot> = {};
	let mutated = false;
	for (const [convId, slot] of Object.entries(store.dockState)) {
		if (!slot.userOverrode) {
			next[convId] = { ...slot, userOverrode: true };
			mutated = true;
		} else {
			next[convId] = slot;
		}
	}
	if (mutated) store.dockState = next;
}

/**
 * Set the dock width in pixels, clamping to a sane range. Persists to
 * localStorage on every successful set so reload picks up the user's last
 * size. Caller is responsible for reading from `store.dockSizePx` to drive
 * the CSS `width` property.
 */
export function setDockSize(px: number): void {
	if (!Number.isFinite(px)) return;
	const min = 320;
	const max = typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.8) : 1600;
	const clamped = Math.max(min, Math.min(max, Math.round(px)));
	store.dockSizePx = clamped;
	if (typeof localStorage !== 'undefined') {
		try { localStorage.setItem(DOCK_SIZE_KEY, String(clamped)); } catch {}
	}
}

// ── Team panel helpers ──

export function openTeamPanel(conversationId: string, agentConfigId: string, teamName: string): void {
	store.teamPanel = {
		open: true, agentConfigId, teamName, conversationId, drillDownAgent: null,
	};
	writeTeamPanel(store.teamPanel);
}

export function closeTeamPanel(): void {
	store.teamPanel = {
		open: false, agentConfigId: null, teamName: null, conversationId: null, drillDownAgent: null,
	};
	writeTeamPanel(store.teamPanel);
}

export function openTeamDrillDown(subConversationId: string, agentName: string, turnIndex?: number): void {
	store.teamPanel = { ...store.teamPanel, drillDownAgent: { subConversationId, agentName, turnIndex } };
	writeTeamPanel(store.teamPanel);
}

export function closeTeamDrillDown(): void {
	store.teamPanel = { ...store.teamPanel, drillDownAgent: null };
	writeTeamPanel(store.teamPanel);
}

export function initStores() {
	fetchAgents()
		.then((data) => {
			store.agents = data;
		})
		.catch(() => {});

	fetchRuns()
		.then((data) => {
			store.runs = data;
		})
		.catch(() => {});

	refreshProjects();
	refreshSettings();
	refreshAgentConfigs();
	refreshWorkflows();
	void refreshQuickstart();

	const client = createWSClient();
	_wsManualRetry = client.manualRetry;

	// One handler per runtime event, looked up by `event.type`. Each was a
	// `case` of a single switch; `return` here is that case's `break`.

	function onWsConnected(): void {
		store.connected = true;
		store.wsReconnectCount++;
	}

	function onWsDisconnected(): void {
		store.connected = false;
	}

	function onRunStart(event: WSEvent): void {
		const { run } = event.data as { run: Run };
		const idx = store.runs.findIndex((r) => r.id === run.id);
		if (idx >= 0) {
			store.runs[idx] = run;
		} else {
			store.runs = [run, ...store.runs];
		}
	}

	function onRunLog(event: WSEvent): void {
		const { runId, log } = event.data as { runId: string; log: unknown };
		store.runs = store.runs.map((r) => {
			if (r.id === runId) {
				return { ...r, logs: [...r.logs, log as Run["logs"][number]] };
			}
			return r;
		});
	}

	function onRunStatus(event: WSEvent): void {
		const { runId, status } = event.data as { runId: string; status: string };
		store.streamingStatus = { ...store.streamingStatus, [runId]: status };
		if (status === "memory_unavailable") {
			store.memoryUnavailableRunId = runId;
		} else if (store.memoryUnavailableRunId !== null) {
			// Recovery: a non-memory_unavailable status clears the flag
			store.memoryUnavailableRunId = null;
		}
	}

	function onRunToken(event: WSEvent): void {
		const { runId, token, kind } = event.data as { runId: string; token: string; kind?: string };
		if (kind === "thinking") {
			bufferThinkingToken(runId, token);
		} else {
			bufferToken(runId, token);
		}
	}

	function onRunUsage(event: WSEvent): void {
		const { runId, usage } = event.data as {
			runId: string;
			usage: { inputTokens: number; outputTokens: number };
		};
		store.streamingUsage = { ...store.streamingUsage, [runId]: usage };
	}

	function onRunTurnTextReset(event: WSEvent): void {
		const { runId } = event.data as { runId: string };
		// Reset streaming text and thinking buffers — next turn's tokens start from empty
		store.streamingMessages = { ...store.streamingMessages, [runId]: "" };
		store.streamingThinking = { ...store.streamingThinking, [runId]: "" };
		// Clear streaming tool calls — they're now persisted in DB
		store.streamingToolCalls = { ...store.streamingToolCalls, [runId]: [] };
		// DON'T reset streamingAgentCalls — agents persist across turns
		// (they were spawned in turn 1, synthesized in turn 2)
		// Reset content block builder for next turn, but re-inject agent refs
		const resetBuilder = blockBuilders.get(runId);
		if (resetBuilder) {
			resetBuilder.reset();
			// Re-inject agent_ref blocks for agents spawned in previous turns
			const existingAgents = store.streamingAgentCalls[runId] ?? [];
			for (let i = 0; i < existingAgents.length; i++) {
				resetBuilder.pushAgentRef();
			}
			store.streamingContentBlocks = { ...store.streamingContentBlocks, [runId]: resetBuilder.snapshot() };
		} else {
			store.streamingContentBlocks = { ...store.streamingContentBlocks, [runId]: [] };
		}
	}

	function onRunTurnSaved(event: WSEvent): void {
		const { runId, conversationId, messageId, parentMessageId, content, thinkingContent, final } = event.data as {
			runId: string; conversationId: string; messageId: string; parentMessageId: string | null; content: string; thinkingContent?: string; final: boolean;
		};
		console.info("[kokoro-tts-flow][store] run:turn_saved received", {
			runId, conversationId, messageId, parentMessageId, final, isExtension: runId.startsWith("ext:"),
		});
		// Dispatch DOM event for chat page to handle message list update
		if (typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("ez:turn_saved", {
				detail: { runId, conversationId, messageId, parentMessageId, content, thinkingContent, final },
			}));
		}
	}

	function onRunFinished(event: WSEvent): void {
		const { run: updated } = event.data as { run: Run };
		const conversationId = store.streamingRunToConversation[updated.id];
		store.runs = store.runs.map((r) => (r.id === updated.id ? updated : r));
		// Mark any still-running agent pills as cancelled/error before cleanup
		const pendingAgents = store.streamingAgentCalls[updated.id];
		if (pendingAgents?.some(a => a.status === "running")) {
			const finalStatus = event.type === "run:complete" ? "complete" as const : "error" as const;
			store.streamingAgentCalls = {
				...store.streamingAgentCalls,
				[updated.id]: pendingAgents.map(a => a.status === "running"
					? { ...a, status: finalStatus, resultPreview: event.type === "run:error" ? "Cancelled — parent run failed" : undefined }
					: a),
			};
		}
		// Clean up streaming state for completed runs
		if (conversationId !== undefined) {
			stopStreaming(updated.id);
		} else {
			// Run completed before startStreaming was called — track it
			store.completedBeforeStream = new Set([...store.completedBeforeStream, updated.id]);
		}
		// Toast notifications for completion/error (not cancel)
		if (event.type === "run:complete") {
			const viewingConv = conversationId && typeof window !== "undefined"
				&& window.location.pathname.includes(conversationId);
			if (!viewingConv) {
				if (conversationId) unreadStore.markUnread(conversationId, updated.projectId ?? null);
				addToast({
					type: "success",
					message: "Run completed",
					action: { label: "View", onclick: () => { window.location.href = `/runs/${updated.id}`; } },
				});
			}
		} else if (event.type === "run:error") {
			addToast({
				type: "error",
				// biome-ignore lint/suspicious/noExplicitAny: the run-update payload arrives over the websocket and only SOME run states carry `error`; the union has no discriminant for it here.
				message: `Run failed: ${(updated as any).error || "Unknown error"}`,
				action: { label: "View", onclick: () => { window.location.href = `/runs/${updated.id}`; } },
			});
		}
	}

	function onWorkflowStart(event: WSEvent): void {
		const { workflowRun } = event.data as { workflowRun: WorkflowRun };
		store.workflowRuns = [workflowRun, ...store.workflowRuns];
	}

	function onWorkflowProgress(event: WSEvent): void {
		const { workflowRun } = event.data as { workflowRun: WorkflowRun };
		store.workflowRuns = store.workflowRuns.map((r) => (r.id === workflowRun.id ? workflowRun : r));
	}

	function onWorkflowApprovalRequest(event: WSEvent): void {
		// The server filter already scoped this to the run's owner and
		// drops it outright when the run has none, so anything that
		// arrives here is this user's to answer.
		registerPendingApproval(event.data as unknown as PendingApprovalNotice);
	}

	function onToolStart(event: WSEvent): void {
		const { conversationId, toolName, input, timestamp, extensionId, source, invocationId, cardType, cardLayout, category } = event.data as {
			conversationId: string; toolName: string; input: unknown; timestamp: number; extensionId?: string; source?: string; invocationId?: string; cardType?: string; cardLayout?: string; category?: string;
		};
		const safeLayout = cardLayout === 'dock' ? 'dock' as const : cardLayout === 'inline' ? 'inline' as const : undefined;
		if (source === 'inline' && invocationId) {
			inlineToolStore.updateFromEvent(invocationId, 'tool:start', { timestamp, ...(cardType ? { cardType } : {}), ...(safeLayout ? { cardLayout: safeLayout } : {}) });
			return;
		}
		// Live Diff Summary panel: upsert non-inline tool calls into the
		// inline store keyed by invocationId. This is the push path that
		// replaces the previous DOM-event + full-refetch hack — when a
		// sub-agent edits a file, its tool:complete arrives here directly
		// and the panel updates within the same tick.
		if (invocationId) {
			inlineToolStore.upsertStreaming({
				id: invocationId,
				conversationId,
				extensionName: extensionId ?? 'builtin',
				toolName,
				input: (input ?? {}) as Record<string, unknown>,
				status: 'running',
				startedAt: timestamp,
				...(cardType ? { cardType } : {}),
				...(safeLayout ? { cardLayout: safeLayout } : {}),
			});
		}
		// Find runId from conversationId
		const runId = Object.entries(store.streamingRunToConversation)
			.find(([, cId]) => cId === conversationId)?.[0];
		if (runId) {
			const existing = store.streamingToolCalls[runId] ?? [];
			const entry: ToolCallState = { ...(invocationId ? { id: invocationId } : {}), toolName, status: 'running', input, startedAt: timestamp, extensionId, cardType, cardLayout: safeLayout, category };
			// Dedup by id (symmetric with the resume guard in
			// stream-resume.svelte.ts): the resume/active-run path may have
			// already injected a synthetic card for this tool call
			// (pendingAskUser / pendingPermissions) before the live
			// tool:start arrives — typically on a WS reconnect while an
			// ask_user_question gate is open. A blind append would render
			// the same question card twice. When the id is already present
			// this is a no-op (and we skip the paired tool_ref push below).
			const { calls, added } = appendStreamingToolCall(existing, entry);
			if (added) {
				// Flush any buffered tokens BEFORE inserting tool_ref to preserve text/tool ordering
				flushTokensForRun(runId);
				store.streamingToolCalls = {
					...store.streamingToolCalls,
					[runId]: calls,
				};
				// Insert tool_ref into content blocks
				const tcBuilder = blockBuilders.get(runId);
				if (tcBuilder) {
					tcBuilder.pushToolRef();
					store.streamingContentBlocks = {
						...store.streamingContentBlocks,
						[runId]: tcBuilder.snapshot(),
					};
				}
			}
		}
	}

	function onToolComplete(event: WSEvent): void {
		const { conversationId, toolName, output, duration, success: completeSuccess, source: completeSource, invocationId: completeInvId, cardType: completeCardType, cardLayout: completeCardLayout } = event.data as {
			conversationId: string; toolName: string; output: unknown; duration: number; success?: boolean; source?: string; invocationId?: string; cardType?: string; cardLayout?: string;
		};
		const safeCompleteLayout = completeCardLayout === 'dock' ? 'dock' as const : completeCardLayout === 'inline' ? 'inline' as const : undefined;
		if (completeSource === 'inline' && completeInvId) {
			if (completeSuccess === false) {
				inlineToolStore.updateFromEvent(completeInvId, 'tool:error', { error: output, duration });
			} else {
				inlineToolStore.updateFromEvent(completeInvId, 'tool:complete', { output, duration, ...(completeCardType ? { cardType: completeCardType } : {}), ...(safeCompleteLayout ? { cardLayout: safeCompleteLayout } : {}) });
			}
			return;
		}
		// Live Diff Summary panel: finalize the streaming entry in the
		// inline store. Matches the tool:start upsert above. `input`
		// is intentionally omitted so the entry's original input from
		// tool:start is preserved — the panel's diff aggregator keys
		// off `input.file_path` / `input.path`.
		if (completeInvId) {
			const extracted = extractToolOutput(output);
			const outputText = typeof extracted === 'string' ? extracted : JSON.stringify(extracted);
			const existingStreaming = inlineToolStore.getById(completeInvId);
			inlineToolStore.upsertStreaming({
				id: completeInvId,
				conversationId,
				extensionName: existingStreaming?.extensionName ?? 'builtin',
				toolName,
				status: completeSuccess === false ? 'error' : 'complete',
				output: outputText,
				duration,
				...(completeCardType ? { cardType: completeCardType } : {}),
				...(safeCompleteLayout ? { cardLayout: safeCompleteLayout } : {}),
			});
		}
		const runId = Object.entries(store.streamingRunToConversation)
			.find(([, cId]) => cId === conversationId)?.[0];
		if (runId) {
			const calls = store.streamingToolCalls[runId] ?? [];
			// Find the latest running call with matching toolName
			const idx = calls.findLastIndex((tc) => tc.toolName === toolName && tc.status === 'running');
			if (idx >= 0) {
				const updated = [...calls];
				const extractedOutput = extractToolOutput(output);
				if (completeSuccess === false) {
					const errText = typeof extractedOutput === 'string' ? extractedOutput : JSON.stringify(extractedOutput);
					updated[idx] = { ...updated[idx]!, status: 'error', error: errText, output: extractedOutput, duration, permissionPending: false, ...(completeCardType ? { cardType: completeCardType } : {}), ...(safeCompleteLayout ? { cardLayout: safeCompleteLayout } : {}) };
				} else {
					updated[idx] = { ...updated[idx]!, status: 'complete', output: extractedOutput, duration, permissionPending: false, ...(completeCardType ? { cardType: completeCardType } : {}), ...(safeCompleteLayout ? { cardLayout: safeCompleteLayout } : {}) };
				}
				store.streamingToolCalls = { ...store.streamingToolCalls, [runId]: updated };
			}
		}
	}

	function onToolError(event: WSEvent): void {
		const { conversationId, toolName, error: toolError, duration, source: errorSource, invocationId: errorInvId, cardType: errorCardType, cardLayout: errorCardLayout } = event.data as {
			conversationId: string; toolName: string; error: string; duration: number; source?: string; invocationId?: string; cardType?: string; cardLayout?: string;
		};
		const safeErrorLayout = errorCardLayout === 'dock' ? 'dock' as const : errorCardLayout === 'inline' ? 'inline' as const : undefined;
		if (errorSource === 'inline' && errorInvId) {
			inlineToolStore.updateFromEvent(errorInvId, 'tool:error', { error: toolError, duration, ...(errorCardType ? { cardType: errorCardType } : {}), ...(safeErrorLayout ? { cardLayout: safeErrorLayout } : {}) });
			return;
		}
		// Live Diff Summary panel: mark the streaming entry as errored.
		// `input` omitted on purpose (see tool:complete above).
		if (errorInvId) {
			const existingStreaming = inlineToolStore.getById(errorInvId);
			inlineToolStore.upsertStreaming({
				id: errorInvId,
				conversationId,
				extensionName: existingStreaming?.extensionName ?? 'builtin',
				toolName,
				status: 'error',
				error: toolError,
				duration,
				...(errorCardType ? { cardType: errorCardType } : {}),
				...(safeErrorLayout ? { cardLayout: safeErrorLayout } : {}),
			});
		}
		const runId = Object.entries(store.streamingRunToConversation)
			.find(([, cId]) => cId === conversationId)?.[0];
		if (runId) {
			const calls = store.streamingToolCalls[runId] ?? [];
			const idx = calls.findLastIndex((tc) => tc.toolName === toolName && tc.status === 'running');
			if (idx >= 0) {
				const updated = [...calls];
				updated[idx] = { ...updated[idx]!, status: 'error', error: toolError, duration };
				store.streamingToolCalls = { ...store.streamingToolCalls, [runId]: updated };
			}
		}
		addToast({ type: "warning", message: `Tool "${toolName}" failed` });
	}

	function onToolPermissionRequest(event: WSEvent): void {
		const {
			conversationId,
			toolCallId,
			toolName: permToolName,
			input: permInput,
			cardType: permCardType,
			cardLayout: permCardLayout,
			category: permCategory,
			// Phase 6: extension-scoped fields. When `extensionId` is
			// set, the modal renders the four-scope chooser and uses
			// `capabilityKind`/`capabilityValue` to describe the
			// requested operation. Built-in tool gates leave them
			// undefined and use the legacy two-button modal.
			extensionId: permExtensionId,
			capabilityKind: permCapabilityKind,
			capabilityValue: permCapabilityValue,
		} = event.data as {
			conversationId: string;
			toolCallId: string;
			toolName: string;
			input: unknown;
			cardType?: string;
			cardLayout?: string;
			category?: string;
			extensionId?: string;
			capabilityKind?: SensitiveCapabilityKind;
			capabilityValue?: string;
		};
		const safePermLayout = permCardLayout === 'dock' ? 'dock' as const : permCardLayout === 'inline' ? 'inline' as const : undefined;
		// Resolve root run — handles both root conversations and sub-agent conversations
		const runId = resolveRunForConversation(conversationId);
		if (runId) {
			const calls = store.streamingToolCalls[runId] ?? [];
			// Find existing tool call or create one
			const idx = calls.findLastIndex((tc) => tc.toolName === permToolName && tc.status === 'running');
			if (idx >= 0) {
				const updated = [...calls];
				updated[idx] = {
					...updated[idx]!,
					id: toolCallId,
					permissionPending: true,
					cardType: permCardType,
					cardLayout: safePermLayout,
					category: permCategory,
					extensionId: permExtensionId,
					capabilityKind: permCapabilityKind,
					capabilityValue: permCapabilityValue,
				};
				store.streamingToolCalls = { ...store.streamingToolCalls, [runId]: updated };
			} else {
				store.streamingToolCalls = {
					...store.streamingToolCalls,
					[runId]: [
						...calls,
						{
							id: toolCallId,
							toolName: permToolName,
							status: 'running',
							input: permInput,
							startedAt: Date.now(),
							permissionPending: true,
							cardType: permCardType,
							cardLayout: safePermLayout,
							category: permCategory,
							extensionId: permExtensionId,
							capabilityKind: permCapabilityKind,
							capabilityValue: permCapabilityValue,
						},
					],
				};
			}
		} else {
			// No root run maps to this conversation. This is the normal
			// case for an EXTENSION-initiated privileged tool call (e.g.
			// ez-code-factory's init_gate hitting fs.write/shell): the
			// prompt fires on a conversation the streaming layer never
			// registered a run for, so there's no chat-inline card slot.
			// Render the prompt on the global fallback tray instead —
			// otherwise the backend gate (which DOES work) would hang
			// forever with no UI to approve it. Fail-closed: we only add
			// a render surface; the approve/deny decision still goes
			// through the same POST /api/tool-calls/:id/permission gate.
			// browser-side store: keep console.* — server-side $server/logger writes to
			// process.stderr, which doesn't exist in the browser bundle.
			console.warn("[permission] No active run for conversation", conversationId, "— routing tool", permToolName, "to the fallback permission tray");
			registerPendingPermission({
				id: toolCallId,
				toolName: permToolName,
				status: 'running',
				input: permInput,
				startedAt: Date.now(),
				permissionPending: true,
				cardType: permCardType,
				cardLayout: safePermLayout,
				category: permCategory,
				extensionId: permExtensionId,
				capabilityKind: permCapabilityKind,
				capabilityValue: permCapabilityValue,
			});
		}
	}

	// ── Multi-Agent Orchestration Events ──
	function onAgentSpawn(event: WSEvent): void {
		const { runId, subConversationId, agentName, agentConfigId, task, agentRunId } = event.data as {
			runId: string; subConversationId: string; agentName: string; agentConfigId: string; task: string; agentRunId: string;
		};
		// Register sub-conversation → root run mapping so events fired by
		// the sub-agent (tool permissions etc.) reach the UI. Nested
		// spawns inherit the root via agentRunToRootRun, handled by
		// the pure routing module.
		applyRoutingState(routingRegisterSpawn(routingSnapshot(), { runId, agentRunId, subConversationId }));
		// Flush buffered tokens to preserve text/agent ordering
		flushTokensForRun(runId);
		const existing = store.streamingAgentCalls[runId] ?? [];
		// Deduplicate: if this agent already has a pill (persistent sub-conversation), update it
		const existingIdx = existing.findIndex(a => a.subConversationId === subConversationId);
		if (existingIdx >= 0) {
			const updated = [...existing];
			updated[existingIdx] = { ...updated[existingIdx]!, status: 'running', statusText: undefined, resultPreview: undefined, task, agentRunId, startedAt: Date.now() };
			store.streamingAgentCalls = { ...store.streamingAgentCalls, [runId]: updated };
			return;
		}
		store.streamingAgentCalls = {
			...store.streamingAgentCalls,
			[runId]: [...existing, { subConversationId, agentName, agentConfigId, task, status: 'running', agentRunId, startedAt: Date.now() }],
		};
		// Insert agent_ref into content blocks (only for new agents, not re-invocations)
		const agentBuilder = blockBuilders.get(runId);
		if (agentBuilder) {
			agentBuilder.pushAgentRef();
			store.streamingContentBlocks = { ...store.streamingContentBlocks, [runId]: agentBuilder.snapshot() };
		}
	}

	function onAgentStatus(event: WSEvent): void {
		const { runId, subConversationId, status: agentStatus } = event.data as {
			runId: string; subConversationId: string; status: string;
		};
		const agents = store.streamingAgentCalls[runId];
		if (agents) {
			store.streamingAgentCalls = {
				...store.streamingAgentCalls,
				[runId]: agents.map(a => a.subConversationId === subConversationId ? { ...a, statusText: agentStatus } : a),
			};
		}
	}

	function onAgentComplete(event: WSEvent): void {
		const { subConversationId, agentName: completeAgentName, success: agentSuccess, resultPreview, agentRunId: completeAgentRunId } = event.data as {
			runId: string; subConversationId: string; agentName: string; success: boolean; resultPreview: string; agentRunId?: string; parentConversationId?: string;
		};
		// Resolve the chip by its stable `subConversationId`, scanning every
		// run bucket — NOT just `streamingAgentCalls[runId]`. The terminal
		// `agent:complete` now fires for tool-spawned / background agents
		// too, and for one that auto-continued (auto-continue / autonomous /
		// schema-retry cycle) the terminal `runId` is the LAST cycle's run
		// id, which differs from the initial spawn run id that keyed the
		// chip. Keying strictly on `runId` would leave such an agent stuck
		// "running"; matching on `subConversationId` (constant across all
		// cycles) resolves it to complete/error.
		let matchedAgentCall = false;
		const nextAgentCalls: Record<string, AgentCallState[]> = {};
		for (const [bucketRunId, calls] of Object.entries(store.streamingAgentCalls)) {
			nextAgentCalls[bucketRunId] = calls.map(a => {
				if (a.subConversationId !== subConversationId) return a;
				matchedAgentCall = true;
				return { ...a, status: agentSuccess ? 'complete' as const : 'error' as const, resultPreview };
			});
		}
		if (matchedAgentCall) {
			store.streamingAgentCalls = nextAgentCalls;
		}
		// Top-level signal for sub-agent failures. The red AgentChip is easy to miss;
		// a toast makes sure users notice even if the panel is collapsed or the failing
		// chip is buried among others.
		if (!agentSuccess) {
			addToast({
				type: "error",
				message: `Agent "${completeAgentName}" failed: ${resultPreview ?? "Unknown error"}`,
			});
		}
		// NOTE: live updates to the parent's Diff Summary panel are now
		// driven directly from tool:complete events (see above). No
		// DOM custom event / refetch hack is needed here — by the time
		// this agent:complete fires, every sub-agent tool call has
		// already arrived on the bus and been upserted into the inline
		// tool store.
		// Notify the chat page so it can re-hydrate sub-conversation data
		const parentConvId = (event.data as Record<string, unknown>).parentConversationId as string | undefined;
		if (parentConvId && typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("ez:agent_complete", {
				detail: { parentConversationId: parentConvId, subConversationId },
			}));
		}
		// Clean up sub-conversation → root run mappings via the pure routing module
		applyRoutingState(routingUnregisterSpawn(routingSnapshot(), { subConversationId, agentRunId: completeAgentRunId }));
	}

	function onTaskSnapshot(event: WSEvent): void {
		commitTaskState(
			reduceLiveSnapshot(readTaskState(), event.data as unknown as TaskSnapshot),
		);
	}

	function onTaskAssignmentUpdate(event: WSEvent): void {
		commitTaskState(
			reduceAssignmentUpdate(
				readTaskState(),
				event.data as unknown as Parameters<typeof reduceAssignmentUpdate>[1],
				new Date().toISOString(),
			),
		);
	}

	function onEzClientTool(event: WSEvent): void {
		// Forward Ez client-side tool invocations (`fill_form` /
		// `navigate_to`) to whatever surface is listening — today
		// that's only EzPanel.svelte. Mirrors the `ez:turn_saved`
		// pattern: route the bus event into a DOM custom event so
		// the panel doesn't need a second EventSource of its own.
		if (typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("ez:client-tool", {
				detail: event.data,
			}));
		}
	}

	function onExtState(event: WSEvent): void {
		const { extensionId, extensionName, state } = event.data as {
			extensionId: string; extensionName: string; state: Record<string, unknown>;
		};
		if (extensionId) {
			store.extensionPanelStates = {
				...store.extensionPanelStates,
				[extensionId]: { extensionName, state },
			};
		}
	}

	function onExtPageState(event: WSEvent): void {
		// Extension Pages Hub: content-free invalidation signal.
		// Re-dispatch as a window CustomEvent so the Hub page
		// ((app)/hub/[pageId]) can re-pull its render endpoint
		// without owning a second EventSource — same pattern as
		// `extensions:installed` below. The payload carries only
		// {extensionId, extensionName, pageId}; the actual tree is
		// fetched per-session from the authed render route.
		if (typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("ext:page-state", {
				detail: event.data,
			}));
		}
	}

	function onExtensionsInstalled(event: WSEvent): void {
		// agent-install-ux-polish Phase 2 (D4): re-dispatch the
		// user-scoped install signal as a DOM CustomEvent so the
		// Extensions Library page can trigger its existing
		// cache-bypassing `loadExtensions()` without standing up a
		// second EventSource. Mirrors the `ez:client-tool` /
		// `ez:turn_saved` re-dispatch pattern. Server-side
		// `shouldDeliverEvent` already scoped this to the
		// installing user's session; the page just needs to know
		// "refresh now".
		void refreshQuickstart();
		if (typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("extensions:installed", {
				detail: event.data,
			}));
		}
	}

	function onConversationCreated(event: WSEvent): void {
		// Daily Briefing Phase 2 (spec §5.3): a server-initiated
		// conversation (briefing pipeline today; any future
		// server-side creator via `source`) landed for THIS user —
		// the SSE filter is fail-closed per-user, so no ownership
		// re-check is needed here. Mark it unread (lights the
		// sidebar dot, project-rail badge, and favicon badge) and
		// re-dispatch as a window CustomEvent so ConversationList
		// can refetch the affected project's list without owning a
		// second EventSource (same pattern as `extensions:installed`).
		const { conversationId, projectId } = event.data as {
			conversationId?: string;
			projectId?: string | null;
		};
		if (!conversationId) return;
		void refreshQuickstart();
		unreadStore.markUnread(conversationId, projectId ?? null);
		if (typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("conversation:created", {
				detail: event.data,
			}));
		}
	}

	function onConversationTreeChanged(event: WSEvent): void {
		// Sessions P4 rewind/checkpoint: a rewind moved this
		// conversation's durable leaf. The SSE filter already scoped
		// delivery to the owner (conversation-scoped, like goal:update),
		// so re-dispatch as a window CustomEvent — ChatThread guards on
		// its own conversationId and re-pulls the tree + messages (same
		// pattern as `conversation:created` / `ext:page-state`).
		if (typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("conversation:tree-changed", {
				detail: event.data,
			}));
		}
	}

	const wsEventHandlers: Partial<Record<WSEvent["type"], (event: WSEvent) => void>> = {
		"ws:connected": onWsConnected,
		"ws:disconnected": onWsDisconnected,
		"run:start": onRunStart,
		"run:log": onRunLog,
		"run:status": onRunStatus,
		"run:token": onRunToken,
		"run:usage": onRunUsage,
		"run:turn_text_reset": onRunTurnTextReset,
		"run:turn_saved": onRunTurnSaved,
		"run:complete": onRunFinished,
		"run:error": onRunFinished,
		"run:cancel": onRunFinished,
		"workflow:start": onWorkflowStart,
		"workflow:step": onWorkflowProgress,
		"workflow:complete": onWorkflowProgress,
		"workflow:error": onWorkflowProgress,
		"workflow:approval_request": onWorkflowApprovalRequest,
		"tool:start": onToolStart,
		"tool:complete": onToolComplete,
		"tool:error": onToolError,
		"tool:permission_request": onToolPermissionRequest,
		"agent:spawn": onAgentSpawn,
		"agent:status": onAgentStatus,
		"agent:complete": onAgentComplete,
		"task:snapshot": onTaskSnapshot,
		"task:assignment_update": onTaskAssignmentUpdate,
		"ez:client-tool": onEzClientTool,
		"ext:state": onExtState,
		"ext:page-state": onExtPageState,
		"extensions:installed": onExtensionsInstalled,
		"conversation:created": onConversationCreated,
		"conversation:tree-changed": onConversationTreeChanged,
	};

	const unsub = client.subscribe((event: WSEvent) => {
		wsEventHandlers[event.type]?.(event);
	});

	return () => {
		unsub();
		client.close();
	};
}
