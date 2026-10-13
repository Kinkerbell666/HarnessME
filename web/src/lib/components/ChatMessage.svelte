<script lang="ts">
	import type { Message } from "$lib/api.js";
	import type { ToolCallState, AgentCallState, ContentBlock } from "$lib/stores.svelte.js";
	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import BranchNavigator from "./BranchNavigator.svelte";
	import MessageToolbar from "./MessageToolbar.svelte";
	import SkeletonLoader from "./SkeletonLoader.svelte";
	import ToolCallCard from "./ToolCallCard.svelte";
	import ThinkingCard from "./ThinkingCard.svelte";
	import MemoriesCard from "./MemoriesCard.svelte";
	import AgentChip from "./AgentChip.svelte";
	import MentionChip from "./MentionChip.svelte";
	import EzActionCard, { type EzActionCardResult } from "./EzActionCard.svelte";
	import ToolCardRouter from "./tool-cards/ToolCardRouter.svelte";
	import { parsePreprocessToolCall } from "./preprocess-result-logic.js";
	import { inferGoalKind } from "./goal-row-logic.js";
	import CapabilityEventPill, { parseCapabilityEventContent } from "./CapabilityEventPill.svelte";
	import ProviderIcon from "./ProviderIcon.svelte";
	import MessageAttachments from "./MessageAttachments.svelte";
	import TopicPills from "./chat/TopicPills.svelte";
	import type { Topic } from "$lib/topic-contexts-logic.js";
	import { getSegments } from "$lib/mention-logic.js";
	import { filterAvailable, groupModels, type ModelOptionLike } from "$lib/model-selector-logic.js";
	import { fmtTokens } from "$lib/context-usage-logic.js";
	import { formatMessageForCopy } from "$lib/message-copy.js";
	import { extensionToolbarStore } from "$lib/stores/extension-toolbar.svelte.js";
	import {
		buildExtensionEventPayload,
		buildExtensionEventUrl,
		captureSelection,
		postExtensionEvent,
		selectApplicableContributions,
		type ExtensionAction,
	} from "$lib/chat/extension-toolbar-action.js";
	import { userFetch } from "$lib/utils/fetch-policy.js";
	import { addToast } from "$lib/toast.svelte.js";
	import { longPress } from "$lib/actions/longPress.js";

	interface ProviderUnavailableError {
		type: "provider_unavailable";
		failedProvider: string;
		failedModel: string;
		suggestion: { provider: string; model: string; tier: string } | null;
		message: string;
		/** Set when the failure was a brief rate limit, not an outage. */
		reason?: "rate_limited";
		/** The company actually serving the model behind a gateway (e.g. "Poolside"). */
		upstreamProvider?: string;
	}

	let {
		message,
		streamingText,
		streamingStatus,
		streamingStartedAt,
		onretry,
		onedit,
		onregenerate,
		onabretry,
		onrerun,
		onfallback,
		onbranch,
		onrewind,
		onsavememory,
		onremovememory,
		savedAsMemory = false,
		siblings,
		onnavigate,
		abRetryEnabled = false,
		memoriesUsed,
		kbSourcesUsed,
		toolCalls,
		agentCalls,
		contentBlocks,
		inlineToolCalls,
		conversationId,
		onagentclick,
		onsendmessage,
		onopenobservability,
		selectable = false,
		selected = false,
		onselectionchange,
		onedittext,
		onexclude,
		pulse = false,
		topics,
		topicBusyId = null,
		onextracttopic,
	}: {
		message: Message;
		streamingText?: string;
		streamingStatus?: string;
		/** Wall-clock start of the current streaming run (ms since epoch). When provided,
		 *  the streaming status line gets an elapsed counter so users can see how long
		 *  the turn has actually been running. */
		streamingStartedAt?: number;
		onretry?: () => void;
		onedit?: (message: Message) => void;
		onregenerate?: (message: Message) => void;
		/** Sessions P5 clean A/B retry: fork a same-role assistant SIBLING from
		 *  this message's parent user turn via POST /retry (no duplicate user
		 *  row — distinct from `onregenerate`'s editOf fork). Drives the labeled
		 *  "Retry" A/B affordance; wired by ChatThread on assistant rows only. */
		/** `override` picks a DIFFERENT model for the sibling. Omitted ⇒ the
		 *  conversation's own model, i.e. the plain one-click Retry. */
		onabretry?: (message: Message, override?: { provider: string; model: string }) => void;
		/** Re-run this user message's prompt as a sibling fork — no edit
		 *  modal. Surfaces a circle-arrows affordance on the user-row
		 *  toolbar that mirrors the assistant-row regenerate button. */
		onrerun?: (message: Message) => void;
		onfallback?: (provider: string, model: string) => void;
		onbranch?: (message: Message) => void;
		/** Rewind/checkpoint to this turn (Sessions P4): moves the conversation's
		 *  durable leaf here so the next send continues from this point, with the
		 *  abandoned tail preserved as a switchable sibling. Wired by ChatThread
		 *  only when the `sessions:historyProducer` flag is on (else undefined →
		 *  the toolbar button is hidden). Assistant rows only. */
		onrewind?: (message: Message) => void;
		onsavememory?: (message: Message) => void;
		onremovememory?: (message: Message) => void;
		savedAsMemory?: boolean;
		siblings?: { id: string; createdAt: string }[];
		onnavigate?: (messageId: string) => void;
		/** Sessions P5 A/B retry: when true, surface a labeled "Retry" affordance
		 *  in the assistant-row A/B controls (next to the ‹n/m› switcher) that
		 *  fires `onabretry` to fork a same-role assistant sibling (the clean
		 *  /retry path — no duplicate user turn). Gated by ChatThread on the
		 *  `sessions:historyProducer` flag AND no active run (hidden off-flag and
		 *  while a turn streams). */
		abRetryEnabled?: boolean;
		memoriesUsed?: { id: string; content: string; category: string }[];
		kbSourcesUsed?: { id: string; filename: string; chunkIndex: number }[];
		toolCalls?: ToolCallState[];
		agentCalls?: AgentCallState[];
		contentBlocks?: ContentBlock[];
		inlineToolCalls?: Array<{ extensionName: string; toolName: string; input: Record<string, unknown> }>;
		conversationId?: string;
		onagentclick?: (agent: AgentCallState) => void;
		onsendmessage?: (message: string) => void;
		/** Opens the observability side panel — wired by the parent chat page. Used by the
		 *  sub-agent-failure summary so users can dive into `agent_error` rows. */
		onopenobservability?: () => void;
		/** Select-mode props (chat window's "fork selected turns" feature). When
		 *  `selectable` is true the message row renders a checkbox and swallows its
		 *  hover toolbar — clicking anywhere on the row toggles selection via
		 *  `onselectionchange`. System rows are still never selectable (they render
		 *  independently of this branch). */
		selectable?: boolean;
		selected?: boolean;
		onselectionchange?: (messageId: string, event?: MouseEvent | KeyboardEvent) => void;
		/** Content-only edit handler for cloned/seeded assistant turns. When
		 *  present, the message toolbar surfaces an "Edit text" affordance that
		 *  updates message content via PATCH (no regen, no branch). */
		onedittext?: (message: Message) => void;
		/** Toggle this message's `excluded` flag so load-history drops it from
		 *  the array sent to the LLM on subsequent turns. The row stays in the
		 *  transcript with a strike-through visual; toggling again re-includes
		 *  it. Wired by the chat page; works for user + assistant rows. */
		onexclude?: (message: Message) => void;
		/** Deep-link highlight pulse. When true, the message's bubble gets the
		 *  one-shot `.message-pulse` class (see app.css). Driven by ChatThread's
		 *  `pulseMessageId` after a `?m=` jump; cleared by a timer there. The
		 *  pulse self-clears visually via the one-shot animation and is disabled
		 *  under prefers-reduced-motion. */
		pulse?: boolean;
		/** Topic Contexts (WS4): topics anchored to THIS message. When
		 *  non-empty, a hover-revealed <TopicPills> overlay renders on the row;
		 *  clicking a pill fires `onextracttopic`. Wired by ChatThread only for
		 *  the page variant (undefined elsewhere → no pills). */
		topics?: Topic[];
		/** Topic id whose extract is in flight (drives the pill spinner + guard). */
		topicBusyId?: string | null;
		onextracttopic?: (topicId: string) => void;
	} = $props();

	// Elapsed counter for the main streaming turn. Reused pattern from AgentChip.svelte.
	// Starts ticking when streamingStartedAt is provided and the message is still streaming.
	let elapsedSec = $state(0);
	$effect(() => {
		if (!streamingStartedAt || !(streamingText !== undefined || streamingStatus !== undefined)) {
			elapsedSec = 0;
			return;
		}
		elapsedSec = Math.floor((Date.now() - streamingStartedAt) / 1000);
		const id = setInterval(() => {
			elapsedSec = Math.floor((Date.now() - streamingStartedAt!) / 1000);
		}, 1000);
		return () => clearInterval(id);
	});
	let elapsedText = $derived(
		elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}m${elapsedSec % 60}s`,
	);

	// Sub-agent failure rollup — surfaces a persistent red strip above the agent chips
	// whenever any sub-agent finished with status=error, so users don't have to scan the
	// pills to find the red one.
	let failedAgents = $derived((agentCalls ?? []).filter((a) => a.status === "error"));
	let hasFailedAgents = $derived(failedAgents.length > 0);
	let failedAgentsSummary = $derived(
		failedAgents.length === 1
			? `Agent "${failedAgents[0]!.agentName}" failed`
			: `${failedAgents.length} sub-agents failed`,
	);

	let showSources = $state(false);
	let mdContainer: HTMLDivElement | undefined = $state();

	let hasMemories = $derived(memoriesUsed && memoriesUsed.length > 0);
	// Popover now only shows KB sources — memories have their own collapsible card above the response.
	let hasKbSources = $derived(kbSourcesUsed && kbSourcesUsed.length > 0);
	let hasSources = $derived(hasKbSources);
	let sourceCount = $derived(kbSourcesUsed?.length ?? 0);


	let isError = $derived(
		message.role === "assistant" &&
			(message.content.startsWith("Error:") || message.content.startsWith("error:")),
	);

	/** Parse provider_unavailable error from message content */
	let providerError = $derived.by((): ProviderUnavailableError | null => {
		if (!isError) return null;
		try {
			// Error content may be "Error: {json}" or just "{json}"
			const raw = message.content.replace(/^[Ee]rror:\s*/, "");
			const parsed = JSON.parse(raw);
			if (parsed?.type === "provider_unavailable") return parsed as ProviderUnavailableError;
		} catch {
			// not JSON or not provider_unavailable
		}
		return null;
	});

	let displayContent = $derived(streamingText || message.content);

	let copyableContent = $derived(formatMessageForCopy(message.content, toolCalls));
	let isStreaming = $derived(streamingText !== undefined || streamingStatus !== undefined);

	let usageTitle = $derived(
		message.usage
			? `Input: ${message.usage.inputTokens} tokens | Output: ${message.usage.outputTokens} tokens`
			: undefined,
	);

	// WS0 prompt-cache meter — the hit-rate percent for THIS turn, or null when
	// there was no cache activity (fresh input only / non-caching provider), so
	// the pill stays silent rather than showing a noisy "0% cached" everywhere.
	// The rate itself is computed server-side (single source of the math) and
	// persisted on the message; here we only round it for display.
	let cacheHitPct = $derived(
		message.usage &&
			((message.usage.cacheReadTokens ?? 0) > 0 || (message.usage.cacheWriteTokens ?? 0) > 0)
			? Math.round((message.usage.cacheHitRate ?? 0) * 100)
			: null,
	);

	// Subset of this turn's cache writes stored with 1h retention — Anthropic
	// bills those at 2× the base input rate, so the pill surfaces the premium
	// (`· <tokens> @1h (2×)`) only when it was actually paid.
	let cacheWrite1hTokens = $derived(message.usage?.cacheWrite1hTokens ?? 0);

	// Routing provenance pills. `usage.requestedModel === null` is the
	// runtime's "no user pin — the router chose this turn's model" marker
	// (STRICT null: legacy rows without the provenance key stay silent), so
	// the footer badges the served model as auto-picked. `usage.failover`
	// marks a turn served by a fallback provider after the resolved one
	// failed pre-stream.
	let isAutoRouted = $derived(
		message.usage != null && message.usage.requestedModel === null && !!message.model,
	);
	let isFailover = $derived(message.usage?.failover === true);

	let hasSiblings = $derived(siblings && siblings.length > 1 && onnavigate);

	let userSegments = $derived(message.role === "user" ? getSegments(message.content) : []);
	let hasUserMentions = $derived(userSegments.some(s => s.type === "mention"));

	/**
	 * Click handler for the message row. Behavior depends on `selectable`:
	 *
	 *   - In select mode (`selectable=true`): every click on the row fires
	 *     `onselectionchange` so the parent can toggle / extend selection.
	 *   - Outside select mode: only fires on shift+click, so the parent can
	 *     auto-enter select mode and treat this row as the anchor. Plain
	 *     clicks fall through (preserves links, mentions, and the toolbar).
	 *
	 * Either way, clicks that originated on an interactive descendant
	 * (button, link, input) are ignored — those need to keep their normal
	 * behavior (e.g. clicking a markdown link, the message toolbar's Copy
	 * button, the BranchNavigator arrows). `closest()` on an Element-typed
	 * target catches both the element itself and any ancestor up to the row.
	 */
	function handleRowClick(
		e: MouseEvent,
		isSelectable: boolean,
		callback: ((id: string, ev?: MouseEvent | KeyboardEvent) => void) | undefined,
		messageId: string,
	) {
		if (!isSelectable && !e.shiftKey) return;
		if (isInteractiveDescendant(e.target)) return;
		callback?.(messageId, e);
	}

	// ── Mobile tap-to-reveal for the per-message toolbar ───────────────
	//
	// The shared MessageToolbar `variant='hover'` only fades in on
	// `group-hover` — which never fires on a coarse pointer (touch). So
	// the entire Copy / Regenerate / Edit / Branch / Exclude / Save-memory
	// action set was unreachable on phones across BOTH the main chat and
	// the agent sub-chat panel (both consume this component). A plain tap
	// on the message row now toggles `toolbarRevealed`; ChatMessage
	// mirrors it onto the `.group` row as `data-toolbar-revealed="true"`,
	// and MessageToolbar's hover class adds a
	// `group-data-[toolbar-revealed=true]:opacity-100` arbitrary variant
	// so the SAME toolbar shows on tap. Desktop hover is untouched.
	let toolbarRevealed = $state(false);

	/**
	 * Plain-tap handler for the message row. Toggles `toolbarRevealed`
	 * ONLY when:
	 *   (a) the pointer is coarse — `(hover: none)` — so desktop mouse
	 *       users keep the pure hover behavior (no force-reveal),
	 *   (b) NOT in select-mode (`!selectable`) — select-mode row clicks
	 *       belong to `handleRowClick` → `onselectionchange`,
	 *   (c) the tap did NOT land on an interactive descendant (link,
	 *       button, mention, input) — reuses the SAME guard the
	 *       `use:longPress` `shouldFire` and `handleRowClick` use, so
	 *       tapping a markdown link / toolbar button / mention chip keeps
	 *       its native behavior and never toggles the reveal.
	 *
	 * `longPress` already suppresses the synthetic post-touch click when
	 * it fired (capture-phase `stopImmediatePropagation`), so a
	 * long-press→select gesture never reaches this handler — only genuine
	 * short taps do.
	 */
	function isCoarsePointer(): boolean {
		return (
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function" &&
			window.matchMedia("(hover: none)").matches
		);
	}

	function handleRowTap(e: MouseEvent, isSelectable: boolean) {
		if (isSelectable) return;
		if (!isCoarsePointer()) return;
		if (isInteractiveDescendant(e.target)) return;
		toolbarRevealed = !toolbarRevealed;
	}

	// Shared descendant guard: a long-press or click that lands on a link,
	// button, input, or contenteditable inside the row should keep its
	// native behavior (navigate / submit / focus) rather than toggle
	// selection. Identical predicate as handleRowClick's `closest()` check.
	function isInteractiveDescendant(target: EventTarget | null): boolean {
		return (
			target instanceof Element &&
			target.closest('a, button, [role="button"], input, textarea, [contenteditable="true"]') !== null
		);
	}

	// Long-press → fire onselectionchange with a synthetic shiftKey:true
	// event so the existing toggleSelectedMessage handler treats it like
	// shift+click: auto-enters select mode outside it, range-extends from
	// the anchor inside it. Mobile-equivalent of desktop shift+click.
	function handleLongPress(
		e: PointerEvent,
		callback: ((id: string, ev?: MouseEvent | KeyboardEvent) => void) | undefined,
		messageId: string,
	) {
		const synthetic = new MouseEvent("click", {
			bubbles: false,
			cancelable: true,
			shiftKey: true,
			clientX: e.clientX,
			clientY: e.clientY,
		});
		callback?.(messageId, synthetic);
	}

	// ── Extension `messageToolbar[]` slot ─────────────────────────
	//
	// Lazy-fetch extension contributions for this conversation when the
	// row mounts. Gated behind a non-empty conversationId because the
	// store keys by it; the GET dedupes across rows so the worst-case
	// is one fetch per conversation, not per row.
	let messageRowEl = $state<HTMLDivElement | undefined>();
	$effect(() => {
		if (conversationId) void extensionToolbarStore.ensure(conversationId);
	});
	let toolbarItems = $derived(conversationId ? extensionToolbarStore.get(conversationId) : []);

	let extensionActions = $derived.by((): ExtensionAction[] => {
		// Skip system + extension rows — those don't render the user/
		// assistant toolbar at all (system rows are inert; extension
		// rows go through a different render path below).
		if (message.role !== "user" && message.role !== "assistant") return [];
		const role = message.role as "user" | "assistant";
		const applicable = selectApplicableContributions(toolbarItems, role);
		return applicable.map((item) => ({
			extName: item.extName,
			id: item.id,
			icon: item.icon,
			tooltip: item.tooltip,
			// `async` so MessageToolbar can `await` it and show a spinner
			// for the request duration. The eventual rendering of the new
			// excluded turn is what tells the user the subprocess work
			// completed — but until that arrives over SSE, the spinner +
			// toast are the only feedback that the click registered.
			onclick: async () => {
				const sel = typeof window !== "undefined" ? window.getSelection() : null;
				const selection = captureSelection(sel, messageRowEl ?? null);
				const payload = buildExtensionEventPayload({
					messageId: message.id,
					conversationId: conversationId ?? "",
					content: message.content,
					selection,
				});
				// Fire an immediate info toast so the user knows the click
				// registered, even after the toolbar collapses on
				// mouseout. Short duration — the new turn (or an error
				// toast from postExtensionEvent) takes over from here.
				addToast(
					{ type: "info", message: `${item.tooltip}…` },
					2500,
				);
				await postExtensionEvent(
					buildExtensionEventUrl(item.extName, item.event),
					payload,
					item.tooltip,
					{ fetcher: userFetch, addToast },
				);
			},
		}));
	});

	// "Excluded from chat context" pill: explicit signal that the row is
	// not in the LLM input. Only renders for extension-authored rows so
	// regular user/assistant rows that the user toggled off keep their
	// existing strikethrough-only treatment (the pill on every excluded
	// row would be visual clutter for the common case).
	let showExcludedPill = $derived(message.role === "extension" && message.excluded === true);

	// Extension-authored rows render ONLY their tool card(s) — no
	// markdown body. The `content` field on these rows is a synthetic
	// label (e.g. kokoro-tts uses `🔊 TTS of selection (N chars)`)
	// emitted server-side as a placeholder; the tool card itself
	// (audio player, chart, etc.) is the real payload. The excluded-
	// from-chat-context pill above gives the user the row-purpose cue
	// the label was previously serving, so we suppress the prose to
	// keep the row visually clean.
	let suppressExtensionBody = $derived(message.role === "extension");

	// Parse the JSON-encoded EzActionResult payload stored in
	// `message.content` for `role === "ez-action-result"` rows.
	// Returns null on malformed input so the renderer can fall back
	// to a minimal "unreadable" pill instead of surfacing a
	// server-side bug as a blank message row. The shape match is
	// intentionally lenient — we only require `card.title +
	// card.body + card.variant` to be present, since those drive the
	// visual; missing `kind`/`ref` are tolerated.
	function parseEzActionResult(raw: string): EzActionCardResult | null {
		try {
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== "object") return null;
			const c = (parsed as { card?: unknown }).card;
			if (!c || typeof c !== "object") return null;
			const card = c as { title?: unknown; body?: unknown; variant?: unknown };
			if (typeof card.title !== "string") return null;
			if (typeof card.body !== "string") return null;
			if (
				card.variant !== "success" &&
				card.variant !== "info" &&
				card.variant !== "warning" &&
				card.variant !== "error"
			) {
				return null;
			}
			return parsed as EzActionCardResult;
		} catch {
			return null;
		}
	}

	function tooltipForMention(mentionName: string): string | undefined {
		if (!inlineToolCalls?.length) return undefined;
		const matches = inlineToolCalls.filter(c => c.extensionName === mentionName);
		if (!matches.length) return undefined;
		return matches.map(c => {
			const inputs = Object.entries(c.input).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
			return `Tool: ${c.toolName}${inputs ? '\n' + inputs : ''}`;
		}).join('\n\n');
	}

	// ── "Retry with…" (WS7): pick the model the A/B sibling runs on ──
	// The /retry route already forks a same-role assistant sibling off ONE user
	// turn and already accepts a provider/model override, which makes it a
	// prompt-held-constant paired comparison — the single most informative
	// routing signal the product can produce. Only the affordance to choose the
	// other side of the comparison was missing.
	let retryPickerOpen = $state(false);
	let retryModels = $state<ModelOptionLike[]>([]);
	let retryModelsLoaded = $state(false);
	// Grouped through the SAME helpers the composer's model picker uses, so the
	// tier order and family sort never drift between the two surfaces.
	let retryGroups = $derived(groupModels(filterAvailable(retryModels)));

	/** Lazy: a thread renders many assistant rows, so the model list is fetched
	 *  on FIRST OPEN of this row's menu — never on mount, which would fire one
	 *  /api/models request per message. */
	async function openRetryPicker() {
		retryPickerOpen = !retryPickerOpen;
		if (!retryPickerOpen || retryModelsLoaded) return;
		try {
			const res = await userFetch("/api/models");
			const data = res.ok ? await res.json() : null;
			// Shape-guard the payload: a non-array (an error envelope, a proxy
			// interstitial) must degrade to "no models listed", never throw inside
			// the derived that renders the menu.
			if (Array.isArray(data)) retryModels = data;
			retryModelsLoaded = true;
		} catch {
			// Non-fatal: the menu still offers "Current chat model", which is the
			// plain retry. A failed list must not block retrying at all.
			retryModelsLoaded = true;
		}
	}

	function pickRetryModel(override?: { provider: string; model: string }) {
		retryPickerOpen = false;
		onabretry?.(message, override);
	}

	function onRetryPickerKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") retryPickerOpen = false;
	}
</script>

<svelte:window onkeydown={retryPickerOpen ? onRetryPickerKeydown : undefined} />

{#if message.role === "capability-event"}
	{@const capPayload = parseCapabilityEventContent(message.content)}
	{#if capPayload}
		<div class="px-4 py-1" data-message-id={message.id} data-testid="chat-capability-event">
			<CapabilityEventPill message={{ id: message.id, role: message.role, content: message.content }} />
		</div>
	{:else}
		<!-- Malformed payload — keep the row minimally observable so a
		     server-side bug doesn't render as a blank turn. The real
		     audit trail is still in the database; this is just the
		     pill renderer's fallback. -->
		<div class="flex justify-center py-2" data-message-id={message.id}>
			<span class="text-xs italic text-rose-400">Capability event unreadable.</span>
		</div>
	{/if}
{:else if message.role === "ez-action-result"}
	{@const ezResult = parseEzActionResult(message.content)}
	{#if ezResult}
		<!--
		  /goal Phase 2: persisted `ez-action-result` rows produced by
		  the goal-host (status / achieved / cleared / paused /
		  rejected) reuse this same render branch — Phase 1 writes
		  plain `EzActionResult` shapes so `EzActionCard` already
		  handles the visuals. We attach `data-goal-row` +
		  `data-goal-kind` only when `inferGoalKind` classifies the
		  payload as goal-shaped, giving Playwright a stable selector
		  hook without inventing five visually-duplicate components.
		  See `goal-row-logic.ts` for the title-prefix → kind table.
		-->
		{@const goalKind = inferGoalKind(ezResult)}
		<div
			class="px-4 py-2"
			data-message-id={message.id}
			data-goal-row={goalKind ? "true" : null}
			data-goal-kind={goalKind}
		>
			<EzActionCard result={ezResult} />
		</div>
	{:else}
		<!-- Malformed payload — surface a minimal error inline so the
		     row doesn't render as an empty void. The persisted JSON
		     is always written by the dispatcher / submit handler so
		     this branch is mostly defensive. -->
		<div class="flex justify-center py-2" data-message-id={message.id}>
			<span class="text-xs text-rose-400 italic">EZ action result unreadable.</span>
		</div>
	{/if}
{:else if message.role === "preprocess-result"}
	{@const preprocessCall = parsePreprocessToolCall(message.content)}
	{#if preprocessCall}
		<!--
		  Deterministic extension pre-processing: the host ran a declared
		  preprocessor tool on this turn's attachment(s) BEFORE the
		  assistant reply and persisted one row per invocation
		  (src/runtime/stream-chat/preprocess.ts). The JSON payload routes
		  through the tool-card router by cardType (grade-delta-chart →
		  GradeDeltaCard; none → DefaultCard). ok:false rows synthesize
		  status "error" with no cardType, so DefaultCard renders the
		  honest error state. Rows are stripped from LLM context by
		  load-history; this branch is their only consumer.
		-->
		<div
			class="px-4 py-2"
			data-message-id={message.id}
			data-testid="preprocess-result-row"
			data-preprocess-status={preprocessCall.status}
		>
			<ToolCardRouter toolCall={preprocessCall} {conversationId} messageId={message.id} />
		</div>
	{:else}
		<!-- Malformed payload — keep the row minimally observable (same
		     defensive shape as the ez-action-result fallback above). -->
		<div class="flex justify-center py-2" data-message-id={message.id}>
			<span class="text-xs text-rose-400 italic">Preprocess result unreadable.</span>
		</div>
	{/if}
{:else if message.role === "system"}
	<div class="flex justify-center py-2" data-message-id={message.id}>
		<span class="text-xs text-[var(--color-text-muted)] italic">{message.content}</span>
	</div>
{:else if message.role === "user"}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:this={messageRowEl}
		class="group relative flex gap-3 px-4 py-3 bg-[var(--color-surface-tertiary)]/50 rounded-lg hover:outline hover:outline-1 hover:outline-[var(--color-border)] {selectable ? 'cursor-pointer' : ''} {selectable && selected ? 'outline outline-2 outline-blue-500' : ''} {pulse ? 'message-pulse' : ''}"
		data-message-id={message.id}
		data-excluded={message.excluded ? 'true' : undefined}
		data-toolbar-revealed={toolbarRevealed ? 'true' : undefined}
		onclick={(e) => { handleRowClick(e, selectable, onselectionchange, message.id); handleRowTap(e, selectable); }}
		onkeydown={selectable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselectionchange?.(message.id, e); } } : undefined}
		use:longPress={{
			onLongPress: (e) => handleLongPress(e, onselectionchange, message.id),
			shouldFire: (t) => !isInteractiveDescendant(t),
		}}
		role={selectable ? 'checkbox' : undefined}
		aria-checked={selectable ? selected : undefined}
		tabindex={selectable ? 0 : undefined}
	>
		{#if selectable}
			<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--color-border)] {selected ? 'bg-blue-600' : 'bg-[var(--color-surface-primary)]'}" data-testid="select-checkbox-{message.id}">
				{#if selected}
					<svg class="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
				{/if}
			</div>
		{/if}
		<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-tertiary)]">
			<span class="text-xs font-medium text-[var(--color-text-primary)]">U</span>
		</div>
		<div class="min-w-0 flex-1">
			{#if hasSiblings}
				<div class="mb-1">
					<BranchNavigator siblings={siblings!} currentId={message.id} onnavigate={onnavigate!} />
				</div>
			{/if}
			<p class="excluded-prose text-sm text-[var(--color-text-primary)] whitespace-pre-wrap break-words"
			>{#if hasUserMentions}{#each userSegments as seg}{#if seg.type === "text"}{seg.text}{:else if seg.type === "mention"}<MentionChip name={seg.name} kind={seg.kind === 'ext' ? 'extension' : seg.kind === 'cmd' ? 'command' : seg.kind as 'agent' | 'team' | 'EZ' | 'workflow' | 'file' | 'dir' | 'feature' | 'lesson'} tooltip={tooltipForMention(seg.name)} />{/if}{/each}{:else}{message.content}{/if}</p>
			<MessageAttachments attachments={message.attachments} />
		</div>
		{#if topics && topics.length > 0 && !selectable && onextracttopic}
			<TopicPills {topics} busyId={topicBusyId} onextract={onextracttopic} />
		{/if}
		{#if !isStreaming && !selectable}
			<MessageToolbar
				role="user"
				{isError}
				content={message.content}
				onedit={onedit ? () => onedit!(message) : undefined}
				onrerun={onrerun ? () => onrerun!(message) : undefined}
				onbranch={onbranch ? () => onbranch!(message) : undefined}
				onsavememory={onsavememory ? () => onsavememory!(message) : undefined}
				onremovememory={onremovememory ? () => onremovememory!(message) : undefined}
				{savedAsMemory}
				onretry={onretry}
				onexclude={onexclude ? () => onexclude!(message) : undefined}
				excluded={message.excluded}
				{extensionActions}
			/>
		{/if}
	</div>
{:else}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:this={messageRowEl}
		class="group relative flex gap-3 px-4 py-3 rounded-lg hover:outline hover:outline-1 hover:outline-[var(--color-border)] {selectable ? 'cursor-pointer' : ''} {selectable && selected ? 'outline outline-2 outline-blue-500' : ''} {pulse ? 'message-pulse' : ''}"
		data-message-id={message.id}
		data-excluded={message.excluded ? 'true' : undefined}
		data-toolbar-revealed={toolbarRevealed ? 'true' : undefined}
		onclick={(e) => { handleRowClick(e, selectable, onselectionchange, message.id); handleRowTap(e, selectable); }}
		onkeydown={selectable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselectionchange?.(message.id, e); } } : undefined}
		use:longPress={{
			onLongPress: (e) => handleLongPress(e, onselectionchange, message.id),
			shouldFire: (t) => !isInteractiveDescendant(t),
		}}
		role={selectable ? 'checkbox' : undefined}
		aria-checked={selectable ? selected : undefined}
		tabindex={selectable ? 0 : undefined}
	>
		{#if selectable}
			<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--color-border)] {selected ? 'bg-blue-600' : 'bg-[var(--color-surface-primary)]'}" data-testid="select-checkbox-{message.id}">
				{#if selected}
					<svg class="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
				{/if}
			</div>
		{/if}
		{#if message.provider}
			<ProviderIcon provider={message.provider} size="md" />
		{:else}
			<div class="h-7 w-7 shrink-0" aria-hidden="true"></div>
		{/if}
		<div
			class="min-w-0 flex-1"
			title={usageTitle}
		>
			{#if hasSiblings || (abRetryEnabled && onabretry)}
				<div class="mb-1 flex items-center gap-2">
					{#if hasSiblings}
						<BranchNavigator siblings={siblings!} currentId={message.id} onnavigate={onnavigate!} />
					{/if}
					{#if abRetryEnabled && onabretry}
						<button
							onclick={() => onabretry!(message)}
							class="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
							data-testid="ab-retry-btn"
							title="Generate an alternative response (A/B)"
						>
							<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
								<path d="M1 4v6h6" /><path d="M23 20v-6h-6" />
								<path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
							</svg>
							Retry
						</button>
						<!-- "Retry with…" — same clean /retry fork, but against a model the
						     user picks. Kept as a SEPARATE caret so one-click Retry stays one
						     click; "Current chat model" in the menu is that same behaviour. -->
						<div class="relative">
							<button
								onclick={openRetryPicker}
								class="inline-flex items-center gap-0.5 rounded px-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] {retryPickerOpen ? 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-primary)]' : ''}"
								data-testid="ab-retry-with-btn"
								title="Retry with a different model"
								aria-label="Retry with a different model"
								aria-expanded={retryPickerOpen}
							>
								with&hellip;
								<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
							</button>
							{#if retryPickerOpen}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="fixed inset-0 z-40" onclick={() => (retryPickerOpen = false)} onkeydown={() => {}}></div>
								<div
									class="absolute left-0 top-full z-50 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] shadow-lg"
									data-testid="ab-retry-model-menu"
								>
									<button
										onclick={() => pickRetryModel()}
										class="flex w-full items-center px-3 py-2 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
										data-testid="ab-retry-model-current"
									>
										Current chat model
									</button>
									{#each retryGroups as group (group.tier)}
										<div class="border-t border-[var(--color-border)] px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{group.label}</div>
										{#each group.models as m (m.provider + m.model)}
											<button
												onclick={() => pickRetryModel({ provider: m.provider, model: m.model })}
												class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-tertiary)] transition-colors"
												data-testid="ab-retry-model-option"
											>
												<span class="truncate text-[var(--color-text-primary)]">{m.displayName ?? m.model}</span>
												{#if m.provider === message.provider && m.model === message.model}
													<span class="shrink-0 text-[10px] text-[var(--color-text-muted)]">served this turn</span>
												{/if}
											</button>
										{/each}
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
			{#if showExcludedPill}
				<div class="mb-2 flex items-center">
					<span
						class="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]"
						data-testid="excluded-from-chat-pill"
					>
						Excluded from chat context
					</span>
				</div>
			{/if}
			{#if hasMemories && !isStreaming}
				<div class="mb-2">
					<MemoriesCard memories={memoriesUsed!} />
				</div>
			{/if}
			<MessageAttachments attachments={message.attachments} />
			{#if isStreaming && !displayContent && !(contentBlocks && contentBlocks.length > 0) && !(toolCalls && toolCalls.length > 0)}
				<SkeletonLoader statusText={`${streamingStatus && streamingStatus !== 'memory_unavailable' ? streamingStatus : 'Thinking...'}${streamingStartedAt ? ` (${elapsedText})` : ''}`} />
			{:else if isError && !isStreaming}
				<!-- Tinted translucent surface + theme text tokens, the pattern the
				     memory-unavailable warning uses, so the card reads in BOTH themes.
				     The previous fixed dark-only palette measured 1.1:1 contrast in
				     light mode (WCAG AA needs 4.5:1). A rate limit is transient, so it
				     is amber like that warning. -->
				<div
					class="rounded-md border p-3 {providerError?.reason === 'rate_limited'
						? 'border-amber-500/50 bg-amber-500/10'
						: 'border-red-500/50 bg-red-500/10'}"
				>
					{#if providerError?.reason === "rate_limited"}
						<!-- A rate limit is brief and belongs to one model, usually imposed by
						     the company serving it behind the gateway. Saying "all providers are
						     unavailable" here sent people hunting for an outage that did not exist. -->
						<div data-testid="provider-rate-limited">
							<p class="text-sm text-[var(--color-text-primary)]">
								{providerError.upstreamProvider ??
									providerError.failedProvider.charAt(0).toUpperCase() + providerError.failedProvider.slice(1)}
								is rate-limiting <span class="font-mono">{providerError.failedModel}</span> right now.
							</p>
							<p class="mt-1 text-xs text-[var(--color-text-secondary)]">
								This is usually brief. Retry in a moment, or choose another model.
							</p>
							{#if onretry}
								<button
									onclick={onretry}
									class="mt-2 rounded-md bg-amber-700 px-3 py-1 text-xs text-white hover:bg-amber-600"
								>
									Retry
								</button>
							{/if}
						</div>
					{:else if providerError}
						<p class="text-sm text-[var(--color-text-primary)]">
							{providerError.failedProvider.charAt(0).toUpperCase() + providerError.failedProvider.slice(1)} is unavailable right now.
						</p>
						{#if providerError.suggestion && onfallback}
							<button
								onclick={() => onfallback!(providerError!.suggestion!.provider, providerError!.suggestion!.model)}
								class="mt-2 rounded-md bg-blue-700 px-3 py-1 text-xs text-white hover:bg-blue-600 transition-colors"
							>
								Try with {providerError.suggestion.provider} ({providerError.suggestion.model})?
							</button>
						{:else if !providerError.suggestion}
							<p class="mt-1 text-xs text-[var(--color-text-secondary)]">All providers are currently unavailable. Please try again later.</p>
						{/if}
						{#if onretry}
							<button
								onclick={onretry}
								class="mt-2 ml-2 rounded-md bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600"
							>
								Retry
							</button>
						{/if}
					{:else}
						<p class="text-sm text-[var(--color-text-primary)]">{message.content}</p>
						{#if onretry}
							<button
								onclick={onretry}
								class="mt-2 rounded-md bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600"
							>
								Retry
							</button>
						{/if}
					{/if}
				</div>
			{:else}
				{#if contentBlocks && contentBlocks.length > 0}
					<!-- Interleaved text and tool call rendering. The mdContainer
					     bind feeds the toolbar's "copy as rich HTML" — line-through
					     belongs on the prose blocks only, NOT on this wrapper, so
					     that ToolCallCards / ThinkingCards stay full-opacity (the
					     side-effects are worth keeping legible) and the copied HTML
					     doesn't carry the strikethrough into the user's clipboard. -->
					<div bind:this={mdContainer}>
						{#each contentBlocks as block, i (block.type === 'tool_ref' ? `tool-${block.toolIndex}` : block.type === 'agent_ref' ? `agent-${block.agentIndex}` : block.type === 'thinking' ? 'thinking' : `text-${i}`)}
							{#if block.type === 'thinking'}
								<div class="my-2">
									<ThinkingCard content={block.content} streaming={isStreaming} />
								</div>
							{:else if block.type === 'text'}
								{#if !suppressExtensionBody && ((block.content && block.content.trim().length > 0) || (isStreaming && i === contentBlocks.length - 1))}
									<div class="excluded-prose">
										<MarkdownRenderer content={block.content} streaming={isStreaming && i === contentBlocks.length - 1} />
									</div>
								{/if}
							{:else if block.type === 'tool_ref' && toolCalls?.[block.toolIndex]}
								<div
									class="my-2 flex flex-col gap-1.5"
									id={toolCalls[block.toolIndex]?.id ? `tool-call-${toolCalls[block.toolIndex]!.id}` : undefined}
								>
									<ToolCallCard toolCall={toolCalls[block.toolIndex]} {conversationId} {onsendmessage} />
								</div>
							{:else if block.type === 'agent_ref'}
								<!-- agent_ref handled by pinned section below -->
							{/if}
						{/each}
					</div>
				{:else}
					<!-- Fallback: flat text then tools (no block data available).
					     The outer bound div stays mounted so the toolbar's
					     `renderedHtml={mdContainer?.innerHTML}` always has a stable
					     reference; only the inner markdown wrapper is suppressed
					     when the message has nothing to render. Streaming bypasses
					     the guard so the live token target is always present. -->
					<div bind:this={mdContainer}>
						{#if !suppressExtensionBody && ((displayContent && displayContent.trim().length > 0) || isStreaming)}
							<div class="excluded-prose">
								<MarkdownRenderer content={displayContent} streaming={isStreaming} />
							</div>
						{/if}
					</div>
					{#if toolCalls && toolCalls.length > 0}
						<div class="my-2 flex flex-col gap-1.5">
							{#each toolCalls as tc, i (tc.id ?? `${tc.toolName}-${i}`)}
								<div id={tc.id ? `tool-call-${tc.id}` : undefined}>
									<ToolCallCard toolCall={tc} {conversationId} {onsendmessage} />
								</div>
							{/each}
						</div>
					{/if}
					{/if}
			{/if}
			<!-- Sub-agent failure rollup — red strip above the chips when any agent errored -->
			{#if hasFailedAgents}
				<button
					type="button"
					onclick={() => onopenobservability?.()}
					class="mt-3 flex w-full items-center gap-2 rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/15 transition-colors"
				>
					<svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
					</svg>
					<span class="min-w-0 flex-1 truncate">
						<span class="font-medium">{failedAgentsSummary}</span>
						{#if failedAgents.length === 1 && failedAgents[0]?.resultPreview}
							<span class="text-[var(--color-text-muted)]"> — {failedAgents[0].resultPreview}</span>
						{/if}
					</span>
					<span class="shrink-0 text-[var(--color-text-muted)]">View details →</span>
				</button>
			{/if}
			<!-- Agent chips pinned at bottom of assistant message -->
			{#if agentCalls && agentCalls.length > 0}
				<div class="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-tertiary)] px-3 py-2">
					<span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">Agents</span>
					{#each agentCalls as agent (agent.subConversationId)}
						<AgentChip {agent} onclick={() => onagentclick?.(agent)} />
					{/each}
					{#if agentCalls.length >= 2}
						{@const done = agentCalls.filter(a => a.status === 'complete').length}
						{@const total = agentCalls.length}
						<span class="ml-auto text-[10px] tabular-nums text-[var(--color-text-muted)]">{done}/{total} complete</span>
					{/if}
				</div>
			{/if}
			{#if isStreaming && streamingStatus && displayContent}
				<div class="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
					<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400"></span>
					{streamingStatus}{#if streamingStartedAt} <span class="tabular-nums">({elapsedText})</span>{/if}
				</div>
			{/if}
			<div class="mt-1 flex items-center gap-2">
				{#if message.model && !isStreaming}
					<span class="text-xs text-[var(--color-text-muted)]">{message.model}</span>
				{/if}
				{#if isAutoRouted && !isStreaming}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
						data-testid="auto-routed-pill"
						title="Auto (smart routing) — no model was pinned for this turn; the router served it with {message.provider}/{message.model}"
					>
						auto
					</span>
				{/if}
				{#if isFailover && !isStreaming}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400"
						data-testid="failover-pill"
						title="Provider failover — the originally resolved provider was unavailable; this turn was served by {message.provider}/{message.model}"
					>
						failover
					</span>
				{/if}
				{#if cacheHitPct !== null && !isStreaming}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--color-text-muted)]"
						data-testid="cache-stats-pill"
						title="Prompt cache this turn — {message.usage?.cacheReadTokens ?? 0} tokens served from cache, {message.usage?.cacheWriteTokens ?? 0} written{cacheWrite1hTokens > 0 ? ` (${cacheWrite1hTokens} with 1h retention — 1h cache writes bill at 2× the base input rate)` : ''}"
					>
						<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
						</svg>
						{cacheHitPct}% cached · {fmtTokens(message.usage?.cacheReadTokens ?? 0)}{#if cacheWrite1hTokens > 0} · {fmtTokens(cacheWrite1hTokens)} @1h (2×){/if}
					</span>
				{/if}
				{#if hasSources && !isStreaming}
					<div class="relative">
						<button
							onclick={() => showSources = !showSources}
							class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
							aria-label="Sources used"
							title="{sourceCount} {sourceCount === 1 ? 'source' : 'sources'} used"
						>
							<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z" />
								<path d="M9 21h6" /><path d="M10 17h4" />
							</svg>
						</button>
						{#if showSources}
							<div class="absolute bottom-full left-0 mb-1 z-10 w-80 max-h-56 overflow-y-auto bg-[var(--color-surface-tertiary)] rounded-lg p-2 text-xs text-[var(--color-text-muted)] shadow-lg border border-[var(--color-border)]">
								{#if hasKbSources}
									<div class="flex items-center gap-1.5 font-medium text-[var(--color-text-secondary)] mb-1">
										<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
											<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
										</svg>
										Knowledge Base
									</div>
									{#each kbSourcesUsed! as kbSource}
										<div class="py-0.5 border-b border-[var(--color-border)]/50 last:border-0 pl-4">
											{kbSource.filename} <span class="text-[var(--color-text-muted)]">[chunk {kbSource.chunkIndex}]</span>
										</div>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
		{#if topics && topics.length > 0 && !selectable && onextracttopic}
			<TopicPills {topics} busyId={topicBusyId} onextract={onextracttopic} />
		{/if}
		{#if !isStreaming && !selectable}
			<MessageToolbar
				role="assistant"
				{isError}
				content={copyableContent}
				renderedHtml={mdContainer?.innerHTML}
				onregenerate={onregenerate ? () => onregenerate!(message) : undefined}
				onbranch={onbranch ? () => onbranch!(message) : undefined}
				onrewind={onrewind ? () => onrewind!(message) : undefined}
				onsavememory={onsavememory ? () => onsavememory!(message) : undefined}
				onremovememory={onremovememory ? () => onremovememory!(message) : undefined}
				{savedAsMemory}
				onretry={onretry}
				onedittext={onedittext ? () => onedittext!(message) : undefined}
				onexclude={onexclude ? () => onexclude!(message) : undefined}
				excluded={message.excluded}
				{extensionActions}
			/>
		{/if}
	</div>
{/if}

<style>
	/* Strikethrough for excluded messages.
	   - Applied via a Svelte-scoped descendant rule so the visual styling
	     lives only in this component's CSS, NOT inline on the elements.
	   - The `excluded-prose` class on the children gets svelte-hashed; their
	     `class` attribute appears in `mdContainer.innerHTML` (which the
	     toolbar copies for shift-click rich-HTML), but the matching CSS rule
	     does not travel with the clipboard payload, so pasting an excluded
	     message into ANY destination — same app or foreign — never carries
	     the strikethrough. The original I1 fix used `class:line-through`
	     which baked Tailwind's `line-through` class into the copied HTML and
	     re-rendered the strike-through wherever Tailwind was loaded. */
	[data-excluded="true"] .excluded-prose {
		text-decoration: line-through;
		opacity: 0.6;
	}
</style>
