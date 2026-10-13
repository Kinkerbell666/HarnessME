<script lang="ts">
	import { onDestroy } from "svelte";
	import ModelSelector from "./ModelSelector.svelte";
	import ThinkingLevelSelector from "./ThinkingLevelSelector.svelte";
	import ModeSelector from "./ModeSelector.svelte";
	import ConversationToolsSelector from "./ConversationToolsSelector.svelte";
	import type { Mode } from "$lib/api";
	import type { ModelWindowLike } from "$lib/context-usage-logic";
	import MentionPopover from "./MentionPopover.svelte";
	import MentionChip from "./MentionChip.svelte";
	import InfoTooltip from "./InfoTooltip.svelte";
	import ToolPicker from "./ToolPicker.svelte";
	import InlineToolForm from "./InlineToolForm.svelte";
	import StagedAttachmentTray from "./StagedAttachmentTray.svelte";
	import SuggestionPopover from "./SuggestionPopover.svelte";
	import type { MentionItem } from "./MentionPopover.svelte";
	import {
		SUGGEST_DEBOUNCE_MS,
		suggestKey,
		isDraftEligible,
		isFresh,
		canApplyEnhancement,
		enhanceAllowed,
		nextEnhanceBackoff,
		popoverVisible,
		buildSuggestBody,
		appendExtensionMention,
		chooseInlineToolAction,
		type SuggestedTool,
		type SuggestedExtension,
		type Enhancement,
	} from "$lib/composer-suggest-logic";
	import type { ToolDefinition } from '../../../../src/extensions/types';
	import { connectionState } from "$lib/stores/connection";
	import { isChatDisabled, chatPlaceholder, setComposerDisplay } from "$lib/chat-input-logic";
	import { isNavBlockedByOverlay } from "$lib/chat-prompt-nav.js";
	import { detectMentionTrigger, insertMentionToken, commitCommandLiteral, getSegments, parseMentions, descendIntoFolder, MENTION_REGEX } from "$lib/mention-logic";
	import { toDisplay, displayTokenText, applyDisplayEdit, displayPosToWire, wirePosToDisplay } from "$lib/mention-display";
	import { searchMentionItems } from "$lib/mention-search";
	import { createLatestSearch } from "$lib/latest-search";
	import { inlineToolStore } from "$lib/inline-tool-store.svelte.js";
	import { subConversationStore } from "$lib/sub-conversation-store.svelte.js";
	import {
		getClientCapabilities,
		capabilityAcceptsFile,
		describeRejection,
		type ClientCapabilities,
	} from "$lib/chat/attachment-client";
	import {
		DEFAULT_SELECTION_FALLBACK,
		type DefaultSelectionMode,
		type ModelSelection,
	} from "$lib/model-selector-logic.js";

	// `$store` subscribes for the component's lifetime and unsubscribes on destroy.
	let connState = $derived($connectionState.state);

	interface StagedToolCall {
		extensionName: string;
		toolName: string;
		input: Record<string, unknown>;
	}

	let {
		onsubmit,
		onstop = () => {},
		streaming = false,
		selectedModel = null,
		onmodelchange = () => {},
		onautoselect,
		allowAuto = false,
		autoServed = null,
		defaultSelection = DEFAULT_SELECTION_FALLBACK,
		thinkingLevel = "medium",
		onthinkinglevelchange,
		modelSupportsReasoning = false,
		onreasoningchange,
		oncontextwindowchange,
		onmodelsloaded,
		conversationId = '',
		projectId,
		ontoolinvoke,
		sharedValues = {},
		selectedMode = null,
		modes = [],
		onmodechange,
		onmodecreate,
		toolbarPosition = "top",
		autofocus = false,
		initialValue = "",
		disabled = false,
		lockedMode,
		placeholder,
		conversationExtensionTools = null,
		orchestrationTools = [],
		onextensiontoolschange,
		onextensiontoolsreset,
	}: {
		onsubmit: (content: string, attachments?: File[]) => void;
		onstop?: () => void;
		streaming?: boolean;
		selectedModel?: { provider: string; model: string } | null;
		onmodelchange?: (provider: string, model: string) => void;
		onautoselect?: (provider: string, model: string) => void;
		/** Offer the "Auto (smart routing)" picker row (chat composer only). */
		allowAuto?: boolean;
		/** Served model of the last routed turn — picker shows "Auto → <model>". */
		autoServed?: ModelSelection | null;
		/** Instance default for an unset selection (`provider:defaultSelection`);
		 *  `null` while the parent is still fetching it. Forwarded verbatim to
		 *  <ModelSelector>. */
		defaultSelection?: DefaultSelectionMode | null;
		thinkingLevel?: string;
		onthinkinglevelchange?: (level: string) => void;
		modelSupportsReasoning?: boolean;
		onreasoningchange?: (reasoning: boolean) => void;
		oncontextwindowchange?: (contextWindow: number | null) => void;
		/** Relayed straight through from ModelSelector — see its prop docs. */
		onmodelsloaded?: (models: readonly ModelWindowLike[]) => void;
		conversationId?: string;
		/**
		 * Active project id from the URL (`page.params.id`). Required for
		 * `@[file:…]` mentions — the server-side file search short-circuits
		 * to `[]` when this is missing, so omitting it makes typing `@`
		 * silently show "No matches found".
		 */
		projectId?: string;
		ontoolinvoke?: (calls: StagedToolCall[]) => void;
		sharedValues?: Record<string, string>;
		selectedMode?: Mode | null;
		modes?: Mode[];
		onmodechange?: (mode: Mode | null) => void;
		onmodecreate?: () => void;
		toolbarPosition?: "top" | "hidden";
		autofocus?: boolean;
		/**
		 * Pre-fill the textarea on first mount. Re-applied on subsequent
		 * prop changes only if the textarea is currently empty (or holds
		 * the previously-applied prefill), so a queued prompt from the
		 * parent doesn't clobber text the user has been typing.
		 */
		initialValue?: string;
		/**
		 * External disabled override — additional to the streaming /
		 * reconnecting / sub-conversation gates the component already
		 * applies. Used by the Ez panel to keep the composer inert until
		 * `getOrCreateEzConversation` resolves.
		 */
		disabled?: boolean;
		/**
		 * Lock the composer's *mode* to a fixed value while keeping the
		 * Model and Thinking pickers fully functional. Used by the Ez
		 * slide-in panel: the Ez conversation's `modeId` is pinned
		 * server-side, but users still need to pick a model and tune
		 * thinking depth like any other chat. When set, the Mode column
		 * renders a disabled <ModeSelector> showing the locked mode's
		 * label, and the attachments paperclip stays hidden. Defaults
		 * to `undefined` (full picker UI, original behavior).
		 */
		lockedMode?: { modeSlug: string; label?: string };
		/**
		 * Override the textarea placeholder. Defaults to "Send a
		 * message..." when unset, matching the chat page's behavior.
		 */
		placeholder?: string;
		/**
		 * Per-conversation tool scoping (extension id → selected tool names),
		 * or null to inherit the active mode's tools. Drives the 🔧 Tools
		 * popover in the toolbar; the popover narrows within `selectedMode`'s
		 * attached extensions. Persisted by the parent via
		 * `onextensiontoolschange` / `onextensiontoolsreset`.
		 */
		conversationExtensionTools?: Record<string, string[]> | null;
		/** Namespaced names of the always-wired orchestration tools (from
		 *  /api/tools) — the Tools popover lists their extensions even when
		 *  a mode doesn't attach them. */
		orchestrationTools?: string[];
		onextensiontoolschange?: (map: Record<string, string[]>) => void;
		onextensiontoolsreset?: () => void;
	} = $props();

	let isLocked = $derived(!!lockedMode);
	let lockedLabel = $derived(
		lockedMode?.label ?? (lockedMode?.modeSlug === "ez" ? "Ez" : (lockedMode?.modeSlug ?? "")),
	);

	// When locked, synthesize a Mode-shaped object so we can render a
	// real (but disabled) <ModeSelector> in the toolbar. Reusing the
	// component — instead of emitting a bespoke chip — keeps the locked
	// composer visually aligned with the unlocked one (same height,
	// border radius, font sizing) and means future ModeSelector tweaks
	// land in both surfaces automatically. All required Mode fields get
	// sensible defaults; `slug` echoes `lockedMode.modeSlug` so any
	// downstream consumer that keys on slug (DOM data attrs, styling)
	// still has something to read.
	let lockedModeObject = $derived<Mode | null>(
		lockedMode
			? {
				id: `builtin-${lockedMode.modeSlug}`,
				name: lockedLabel,
				slug: lockedMode.modeSlug,
				icon: lockedMode.modeSlug === "ez" ? "⚡" : null,
				description: "",
				systemPromptInstruction: "",
				instructionPosition: "append",
				preferredModel: null,
				preferredProvider: null,
				preferredTier: null,
				preferredThinkingLevel: null,
				temperature: null,
				toolRestriction: "all",
				extensionIds: null,
				extensionTools: null,
				builtin: true,
			}
			: null,
	);

	// Track which `initialValue` we've already applied so re-renders with
	// the same prefill don't keep clobbering user-typed text. Mirrors the
	// pattern PanelChatInput uses; off by default (initialValue === "")
	// for the chat page's existing call site.
	let appliedInitialValue = $state<string | null>(null);
	$effect(() => {
		const next = initialValue;
		if (next === appliedInitialValue) return;
		const prevApplied = appliedInitialValue;
		if (value === "" || value === prevApplied) {
			value = next;
			displayValue = toDisplay(next).display;
			// Resize textarea to fit the new content on next paint.
			requestAnimationFrame(() => adjustHeight());
		}
		appliedInitialValue = next;
	});

	// `value` is the WIRE string — full `![kind:name]` tokens — and stays the
	// single source of truth for submit / parsing / overlay segments. The
	// textarea, however, is bound to `displayValue`: a COMPACT projection
	// (`!name`) so chips lay out tight against their label instead of leaving a
	// blank gap the width of the hidden `[kind:` … `]` characters. The two are
	// kept in sync through `mention-display`. See that module for the full
	// rationale.
	let value = $state("");
	let displayValue = $state("");
	let textarea: HTMLTextAreaElement | undefined = $state();
	let overlayEl: HTMLDivElement | undefined = $state();

	/**
	 * Commit a new WIRE string, refresh the compact `displayValue` the textarea
	 * renders, and place the caret at the display-space equivalent of
	 * `wireCursor`. Used by every handler that mutates `value` programmatically
	 * (mention insertion, folder descent, literal commands, atomic deletion).
	 */
	function setWire(newWire: string, wireCursor: number) {
		value = newWire;
		const { display, spans } = toDisplay(newWire);
		displayValue = display;
		const dCursor = wirePosToDisplay(spans, wireCursor);
		setComposerDisplay(textarea, display, dCursor);
	}

	// ── Attachment staging (multi-modal uploads) ────────────────────
	let capabilities = $state<ClientCapabilities | null>(null);
	let stagedFiles = $state<File[]>([]);
	let attachmentError = $state<string | null>(null);
	let isDragging = $state(false);
	let fileInputEl: HTMLInputElement | undefined = $state();

	// Names of `!ext:NAME` mentions in the current draft. Re-runs the
	// capabilities fetch so an extension that contributes new MIMEs (e.g.
	// excel → xlsx) widens the accept list as soon as it's drafted, before
	// the user sends. Without this, the picker rejects files for
	// extensions the user is about to wire.
	let pendingExtensionNames = $derived(
		parseMentions(value).filter((m) => m.kind === 'ext').map((m) => m.name),
	);

	// Fetch capabilities when the selected model OR the pending-ext set
	// changes. Non-fatal on error — if caps can't be loaded, the paperclip
	// stays hidden and the user falls back to text-only messaging.
	$effect(() => {
		const sel = selectedModel;
		// Auto (smart routing) has no concrete model until the first turn is
		// served, so the server answers with the INTERSECTION of every rung of
		// the tier ladder — what any model it could route to will accept. That
		// keeps the paperclip usable on turn 1 (it is the DEFAULT selection now,
		// so nulling here would hide attachments on every new conversation)
		// without ever over-promising a capability the served model lacks.
		// A no-selection state still resolves nothing.
		if (!sel) { capabilities = null; return; }
		// Re-read pendingExtensionNames inside the effect so Svelte tracks it.
		const extNames = pendingExtensionNames;
		let cancelled = false;
		getClientCapabilities(sel.provider, sel.model, fetch, conversationId || undefined, extNames)
			.then((caps) => { if (!cancelled) capabilities = caps; })
			.catch(() => { if (!cancelled) capabilities = null; });
		return () => { cancelled = true; };
	});

	// When caps change (model switched), drop any staged files the new model
	// can't accept and surface a brief message.
	$effect(() => {
		if (!capabilities) return;
		const keep: File[] = [];
		const dropped: string[] = [];
		for (const f of stagedFiles) {
			if (capabilityAcceptsFile(capabilities, f) && f.size <= capabilities.maxBytesPerFile) {
				keep.push(f);
			} else {
				dropped.push(f.name);
			}
		}
		if (dropped.length > 0) {
			stagedFiles = keep;
			attachmentError = `Dropped ${dropped.length} file(s) not supported by the new model: ${dropped.join(", ")}`;
		}
	});

	export function stageFiles(files: FileList | File[]) {
		if (!capabilities) {
			attachmentError = "No model selected — pick one before attaching files.";
			return;
		}
		const caps = capabilities;
		const accepted: File[] = [];
		const rejected: string[] = [];
		const remaining = Math.max(0, caps.maxFilesPerMessage - stagedFiles.length);
		for (const f of Array.from(files)) {
			if (accepted.length >= remaining) {
				rejected.push(`${f.name} (max ${caps.maxFilesPerMessage} files per message)`);
				continue;
			}
			if (f.size > caps.maxBytesPerFile || !capabilityAcceptsFile(caps, f)) {
				rejected.push(describeRejection(caps, f));
				continue;
			}
			accepted.push(f);
		}
		if (accepted.length > 0) stagedFiles = [...stagedFiles, ...accepted];
		attachmentError = rejected.length > 0 ? rejected.join(" ") : null;
	}

	function removeStagedFile(idx: number) {
		stagedFiles = stagedFiles.filter((_, i) => i !== idx);
	}

	function openFilePicker() { fileInputEl?.click(); }

	function onFileInputChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files) stageFiles(target.files);
		target.value = "";
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDragging = false;
		if (e.dataTransfer?.files?.length) stageFiles(e.dataTransfer.files);
	}
	function onDragOver(e: DragEvent) {
		if (!capabilities) return;
		e.preventDefault();
		e.stopPropagation();
		isDragging = true;
	}
	function onDragLeave() { isDragging = false; }

	function onPaste(e: ClipboardEvent) {
		if (!e.clipboardData?.files?.length || !capabilities) return;
		// Only intercept paste when it's actually a file (e.g. screenshot). Text
		// paste should still go to the textarea.
		const files = Array.from(e.clipboardData.files);
		if (files.length === 0) return;
		e.preventDefault();
		stageFiles(files);
	}

	// Derive a single accept-attr string for the hidden <input type="file">.
	let acceptAttr = $derived(
		capabilities && capabilities.acceptedMimeTypes.length > 0
			? capabilities.acceptedMimeTypes.join(",")
			: undefined,
	);
	// Attachments are suppressed entirely when the composer is in
	// locked-mode (Ez panel). Otherwise they show whenever the selected
	// model advertises non-text input kinds.
	let attachmentsSupported = $derived(
		!isLocked && !!capabilities && capabilities.kinds.length > 1,
	);

	// Mention state
	let mentionOpen = $state(false);
	let mentionItems = $state<MentionItem[]>([]);
	let mentionLoading = $state(false);
	let popoverRef = $state<MentionPopover | undefined>();
	let isComposing = $state(false);
	const mentionSearch = createLatestSearch<MentionItem[]>({
		delayMs: 200,
		fallback: [],
		onLoading: (loading) => { mentionLoading = loading; },
		onResult: (items) => { mentionItems = items; },
	});
	// Latest trigger query — drives the popover's "use current folder" entry.
	let mentionTriggerQuery = $state("");

	// Inline tool invocation state
	let activeExtension = $state<string | null>(null);
	let activeTools = $state<ToolDefinition[]>([]);
	let selectedTool = $state<ToolDefinition | null>(null);
	let showToolPicker = $state(false);
	let showToolForm = $state(false);
	let toolPickerRef = $state<ToolPicker | undefined>();
	let formInitialValues = $state<Record<string, unknown>>({});
	let stagedToolCalls = $state<StagedToolCall[]>([]);

	function getExtensionStatus(extName: string): 'pending' | 'running' | 'complete' | 'error' | undefined {
		const calls = inlineToolStore.calls.filter(c => c.extensionName === extName && c.conversationId === conversationId);
		if (calls.length === 0) return undefined;
		return calls[calls.length - 1]!.status;
	}

	// Fetch an extension's tools and open the inline-tool UI. `preselectToolName`
	// (set when a suggestion chip clicked a specific tool) jumps straight to the
	// form for that tool, skipping the picker; without it the shared
	// `chooseInlineToolAction` decision applies (1 tool → form, >1 → picker).
	async function openInlineToolUI(extName: string, preselectToolName?: string) {
		activeExtension = extName;
		formInitialValues = {};
		try {
			const res = await fetch(`/api/extensions/${encodeURIComponent(extName)}/tools`);
			if (!res.ok) return;
			const { tools }: { tools: ToolDefinition[] } = await res.json();
			activeTools = tools;
			const decision = chooseInlineToolAction(tools, preselectToolName);
			if (decision.action === "form") {
				selectedTool = decision.tool;
				showToolForm = true;
			} else if (decision.action === "picker") {
				showToolPicker = true;
			}
		} catch {
			resetInlineToolState();
		}
	}

	// Pill clicks + extension-mention auto-open enter the inline-tool UI with no
	// preselection (existing behavior — the picker/form choice is tool-count-driven).
	function handleChipClick(extName: string) {
		void openInlineToolUI(extName);
	}

	function handleToolSelect(tool: ToolDefinition) {
		selectedTool = tool;
		showToolPicker = false;
		showToolForm = true;
	}

	function handleFormConfirm(input: Record<string, unknown>) {
		if (!activeExtension || !selectedTool) return;
		// Execute immediately — no staging required
		ontoolinvoke?.([{
			extensionName: activeExtension,
			toolName: selectedTool.name,
			input,
		}]);
		resetInlineToolState();
	}

	function resetInlineToolState() {
		activeExtension = null;
		activeTools = [];
		selectedTool = null;
		showToolPicker = false;
		showToolForm = false;
		formInitialValues = {};
	}

	// ── Composer suggestions (tool chips + prompt enhancement) ──────
	// Decisions live in $lib/composer-suggest-logic; this block owns only
	// timers, fetches, and Svelte state. Debounced on typing PAUSE (600ms),
	// suppressed while mention/inline-tool UIs are open, and every response
	// is staleness-guarded by the normalized draft key.
	let suggestTools = $state<SuggestedTool[]>([]);
	let suggestExtensions = $state<SuggestedExtension[]>([]);
	let suggestEnhancement = $state<Enhancement | null>(null);
	let suggestEnhanceLoading = $state(false);
	let suggestApplied = $state(false);
	let suggestDismissed = $state(false); // per-draft-key dismiss (Esc / ×)
	let suggestMuted = $state(false); // session mute: server said disabled
	let suggestKeyCurrent = "";
	let suggestShownPosted = "";
	let suggestUndoWire: string | null = null;
	let suggestTimer: ReturnType<typeof setTimeout> | undefined;
	let suggestAbort: AbortController | null = null;
	let enhanceBackoffUntil = 0;
	onDestroy(() => {
		mentionSearch.cancel();
		clearTimeout(suggestTimer);
		suggestAbort?.abort();
	});
	let suggestOpen = $derived(
		!suggestDismissed &&
			!mentionOpen &&
			!showToolPicker &&
			!showToolForm &&
			popoverVisible({ tools: suggestTools, extensions: suggestExtensions, enhancement: suggestEnhancement }),
	);

	/** Fire-and-forget telemetry — content-free by contract (never draft text). */
	function postSuggestFeedback(
		kind: "tool" | "enhance" | "extension",
		action: "shown" | "accepted" | "dismissed",
		toolName?: string,
	) {
		fetch("/api/composer/suggest/feedback", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				kind,
				action,
				...(toolName ? { toolName } : {}),
				...(conversationId ? { conversationId } : {}),
			}),
		}).catch(() => {});
	}

	function clearSuggestions() {
		suggestTools = [];
		suggestExtensions = [];
		suggestEnhancement = null;
		suggestEnhanceLoading = false;
		suggestApplied = false;
		suggestUndoWire = null;
	}

	function dismissSuggest() {
		if (suggestTools.length > 0) postSuggestFeedback("tool", "dismissed");
		if (suggestExtensions.length > 0) postSuggestFeedback("extension", "dismissed");
		if (suggestEnhancement) postSuggestFeedback("enhance", "dismissed");
		suggestDismissed = true;
		clearSuggestions();
	}

	function scheduleSuggest() {
		clearTimeout(suggestTimer);
		const key = suggestKey(value);
		if (key !== suggestKeyCurrent) {
			// Draft changed: any in-flight/rendered suggestions are stale, and a
			// previous Esc-dismiss only covers the OLD draft.
			suggestKeyCurrent = key;
			suggestAbort?.abort();
			suggestDismissed = false;
			clearSuggestions();
		}
		if (
			!isDraftEligible(value, {
				mentionOpen,
				inlineToolOpen: showToolPicker || showToolForm,
				muted: suggestMuted || suggestDismissed,
			})
		) {
			return;
		}
		suggestTimer = setTimeout(fireSuggest, SUGGEST_DEBOUNCE_MS);
	}

	function fireSuggest() {
		const wire = value;
		if (
			!isDraftEligible(wire, {
				mentionOpen,
				inlineToolOpen: showToolPicker || showToolForm,
				muted: suggestMuted || suggestDismissed,
			})
		) {
			return;
		}
		const key = suggestKey(wire);
		suggestAbort?.abort();
		const ctrl = new AbortController();
		suggestAbort = ctrl;

		fetch("/api/composer/suggest", {
			method: "POST",
			headers: { "content-type": "application/json" },
			signal: ctrl.signal,
			body: buildSuggestBody({
				draft: wire,
				conversationId: conversationId || undefined,
				projectId: projectId || undefined,
				modeId: selectedMode?.id ?? null,
				include: ["tools", "extensions"],
			}),
		})
			.then((res) => (res.ok ? res.json() : null))
			.then((resp) => {
				if (!resp || !isFresh(key, suggestKeyCurrent)) return;
				if (resp.enabled === false) {
					suggestMuted = true;
					return;
				}
				suggestTools = resp.tools ?? [];
				suggestExtensions = resp.extensions ?? [];
				// One shown-impression per draft key, but a separate telemetry
				// event per non-empty list so tool vs extension acceptance rates
				// stay distinguishable.
				if (
					suggestShownPosted !== key &&
					(suggestTools.length > 0 || suggestExtensions.length > 0)
				) {
					suggestShownPosted = key;
					if (suggestTools.length > 0) postSuggestFeedback("tool", "shown");
					if (suggestExtensions.length > 0) postSuggestFeedback("extension", "shown");
				}
			})
			.catch(() => {});

		// The rewrite half rides the same pause but its own request, so tool
		// chips render immediately while the local model thinks. Skipped
		// entirely for drafts carrying mention chips (apply would clobber
		// them) and while the sidecar-unavailable backoff holds.
		if (enhanceAllowed(Date.now(), enhanceBackoffUntil) && canApplyEnhancement(wire)) {
			suggestEnhanceLoading = true;
			fetch("/api/composer/suggest", {
				method: "POST",
				headers: { "content-type": "application/json" },
				signal: ctrl.signal,
				body: buildSuggestBody({
					draft: wire,
					conversationId: conversationId || undefined,
					projectId: projectId || undefined,
					modeId: selectedMode?.id ?? null,
					include: ["enhance"],
				}),
			})
				.then((res) => (res.ok ? res.json() : null))
				.then((resp) => {
					if (!isFresh(key, suggestKeyCurrent)) return;
					suggestEnhanceLoading = false;
					if (!resp || resp.enabled === false) return;
					enhanceBackoffUntil = nextEnhanceBackoff(Date.now(), resp.llmAvailable !== false);
					suggestEnhancement = resp.enhancement ?? null;
					if (suggestEnhancement) postSuggestFeedback("enhance", "shown");
				})
				.catch(() => {
					if (isFresh(key, suggestKeyCurrent)) suggestEnhanceLoading = false;
				});
		}
	}

	function handleSuggestToolSelect(tool: SuggestedTool) {
		postSuggestFeedback("tool", "accepted", `${tool.extension}__${tool.name}`);
		const result = appendExtensionMention(value, tool.extension);
		setWire(result.wire, result.cursor);
		suggestDismissed = true;
		clearSuggestions();
		adjustHeight();
		// Converge onto the inline-tool flow, preselected to the clicked tool:
		// the pill renders + extension is wired above, then the form opens on
		// exactly this tool (skipping the picker even when the extension has more).
		void openInlineToolUI(tool.extension, tool.name);
	}

	function handleSuggestExtensionSelect(ext: SuggestedExtension) {
		postSuggestFeedback("extension", "accepted", ext.name);
		const result = appendExtensionMention(value, ext.name);
		setWire(result.wire, result.cursor);
		suggestDismissed = true;
		clearSuggestions();
		adjustHeight();
		// A whole-extension chip names no specific tool, so open the inline-tool
		// UI with NO preselect: 1 tool → form, >1 → picker, 0 tools → nothing
		// (the pill still wired the extension above).
		void openInlineToolUI(ext.name);
	}

	function applySuggestEnhancement() {
		if (!suggestEnhancement) return;
		postSuggestFeedback("enhance", "accepted");
		suggestUndoWire = value;
		setWire(suggestEnhancement.enhanced, suggestEnhancement.enhanced.length);
		suggestApplied = true;
		// The applied text IS the current suggestion — pin the key so the
		// rewrite itself doesn't immediately re-trigger a fetch cycle.
		suggestKeyCurrent = suggestKey(suggestEnhancement.enhanced);
		adjustHeight();
	}

	function undoSuggestEnhancement() {
		if (suggestUndoWire === null) return;
		const restored = suggestUndoWire;
		suggestUndoWire = null;
		suggestApplied = false;
		suggestKeyCurrent = suggestKey(restored);
		setWire(restored, restored.length);
		adjustHeight();
	}


	const MAX_ROWS = 6;
	const LINE_HEIGHT = 24;

	// Segments for overlay rendering
	let segments = $derived(getSegments(value));

	function adjustHeight() {
		if (!textarea) return;
		textarea.style.height = "auto";
		const maxHeight = LINE_HEIGHT * MAX_ROWS;
		textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + "px";
	}

	function syncScroll() {
		if (textarea && overlayEl) {
			overlayEl.scrollTop = textarea.scrollTop;
		}
	}

	const MENU_NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']);

	function handleKeydown(e: KeyboardEvent) {
		// Delegate navigation keys to whichever menu is open
		const activeMenu = mentionOpen ? popoverRef : showToolPicker ? toolPickerRef : null;
		if (activeMenu && MENU_NAV_KEYS.has(e.key)) {
			activeMenu.handleKeydown(e);
			return;
		}

		// Suggestions are non-modal: only Escape interacts with them, and
		// only when no menu consumed it above.
		if (e.key === "Escape" && suggestOpen) {
			e.preventDefault();
			dismissSuggest();
			return;
		}

		// Atomic backspace/delete on mention chips — remove the entire WIRE token
		// when the (display-space) caret is inside or at the chip's edge.
		if ((e.key === 'Backspace' || e.key === 'Delete') && textarea
			&& textarea.selectionStart === textarea.selectionEnd) {
			const pos = textarea.selectionStart;
			const { spans } = toDisplay(value);
			for (const m of spans) {
				const inside = e.key === 'Backspace'
					? (pos > m.dStart && pos <= m.dEnd)
					: (pos >= m.dStart && pos < m.dEnd);
				if (inside) {
					e.preventDefault();
					setWire(value.slice(0, m.wStart) + value.slice(m.wEnd), m.wStart);
					adjustHeight();
					// Refresh inline-tool + popover state after the deletion.
					requestAnimationFrame(() => handleInput());
					return;
				}
			}
		}

		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	/** Snap cursor out of mention chips — jump to nearest edge (display space) */
	function snapCursorOutOfMention() {
		if (!textarea) return;
		const pos = textarea.selectionStart;
		if (textarea.selectionStart !== textarea.selectionEnd) return; // selection range, don't snap
		const { spans } = toDisplay(value);
		for (const m of spans) {
			if (pos > m.dStart && pos < m.dEnd) {
				const mid = (m.dStart + m.dEnd) / 2;
				const target = pos <= mid ? m.dStart : m.dEnd;
				textarea.selectionStart = textarea.selectionEnd = target;
				return;
			}
		}
	}

	// Pre-warm embedding model on first keystroke so it's ready when user sends
	let warmupSent = false;
	function triggerWarmup() {
		if (warmupSent) return;
		warmupSent = true;
		fetch('/api/warmup', { method: 'POST' }).catch(() => {});
	}

	function handleInput() {
		triggerWarmup();

		// The textarea edits the COMPACT display string; project that change
		// back onto the wire string (`value`). The edit is always in plain text
		// between chips (tokens are atomic), so `applyDisplayEdit` splices it in
		// while preserving every wire token. `null` means the edit chewed into a
		// chip's interior — restore the consistent display and bail.
		const synced = applyDisplayEdit(value, displayValue);
		if (synced === null) {
			displayValue = toDisplay(value).display;
			return;
		}
		value = synced;

		// If the edit introduced raw mention syntax through the text path (e.g.
		// pasting `![agent:x]`), the textarea would still show that raw form.
		// Re-project so the textarea snaps to the compact label. For ordinary
		// typing the two are already equal, so this is a no-op and never
		// disturbs the caret.
		const canonical = toDisplay(value).display;
		if (canonical !== displayValue) displayValue = canonical;

		adjustHeight();
		syncScroll();

		if (isComposing) return;
		if (!textarea) return;

		// Debounced suggestions (tool chips + prompt enhancement). Scheduled
		// on every edit; eligibility is re-checked when the timer fires so a
		// mention popover that opened in the meantime suppresses it.
		scheduleSuggest();

		// Close tool form/picker if the associated mention chip was deleted
		if (activeExtension) {
			const mentions = parseMentions(value);
			if (!mentions.some(m => m.kind === 'ext' && m.name === activeExtension)) {
				resetInlineToolState();
			}
		}

		// Trigger detection runs against the display string — the in-progress
		// query (e.g. `!Code A`) is uncommitted plain text, identical in both
		// spaces, and the caret is a display-space offset.
		const trigger = detectMentionTrigger(displayValue, textarea.selectionStart);

		if (!trigger) {
			if (mentionOpen) {
				closeMention();
			}
			return;
		}

		mentionOpen = true;
		mentionTriggerQuery = trigger.query;

		// Debounced search. File searches REQUIRE `projectId`; without it the
		// server returns [] and the popover shows "No matches found".
		mentionSearch.schedule(() => searchMentionItems(trigger.query, trigger.type, projectId));
	}

	// Current caret as a WIRE offset. The textarea reports a display-space
	// offset; insertion helpers operate on the wire string, so map across the
	// committed chips that precede the caret.
	function wireCaret(): number {
		if (!textarea) return value.length;
		return displayPosToWire(toDisplay(value).spans, textarea.selectionStart);
	}

	function handleMentionSelect(item: MentionItem) {
		if (!textarea) return;

		// Folder entry → DESCEND (rewrite query to `@<path>/` and re-fire).
		if (item.kind === 'dir') {
			const descent = descendIntoFolder(value, wireCaret(), item.name);
			setWire(descent.text, descent.cursor);
			adjustHeight();
			// Re-run trigger detection inside the descended folder after the
			// caret lands (setWire schedules the caret in the prior rAF).
			requestAnimationFrame(() => handleInput());
			return;
		}

		// Synthetic "Use this folder as path" entry → commit as @[dir:…].
		if (item.kind === 'dir-target') {
			const result = insertMentionToken(value, wireCaret(), {
				kind: 'dir',
				name: item.name,
			});
			setWire(result.text, result.cursor);
			closeMention();
			adjustHeight();
			return;
		}

		// Built-in literal command (e.g. `/goal`): insert the raw text
		// verbatim instead of a `/[cmd:name]` token, so it reaches the
		// server-side interceptor as plain text (`isGoalCommand` matches on
		// `body.content`). Mirrors the `dir-target` commit epilogue above.
		if (item.insertText) {
			const result = commitCommandLiteral(value, wireCaret(), item.insertText);
			setWire(result.text, result.cursor);
			closeMention();
			adjustHeight();
			return;
		}

		// Leaf selection (file / agent / ext / team / command / EZ /
		// workflow). API returns `extension` / `command` but mention-logic
		// uses `ext` / `cmd`. `EZ` and `workflow` are `!`-sigil kinds that
		// keep their API/wire name unchanged.
		const kind = item.kind === 'extension'
			? 'ext'
			: item.kind === 'command'
				? 'cmd'
				: item.kind;
		const result = insertMentionToken(value, wireCaret(), {
			kind: kind as 'agent' | 'ext' | 'team' | 'EZ' | 'workflow' | 'file' | 'dir' | 'cmd',
			name: item.name,
		});
		setWire(result.text, result.cursor);
		closeMention();
		adjustHeight();

		// Auto-open tool form/picker for extension mentions. File mentions are
		// passive references — no auto-open. Workflow mentions are likewise
		// reference-only: the token expands to a system note describing the
		// workflow, and EXECUTION goes through the `run_workflow` tool, so
		// selecting one must never open or fire anything here.
		if (kind === 'ext') {
			handleChipClick(item.name);
		}
	}

	/** Close the mention popover and drop any search still pending for it. */
	function closeMention() {
		mentionOpen = false;
		mentionItems = [];
		mentionTriggerQuery = "";
		mentionSearch.cancel();
	}

	function submit() {
		const text = value.trim();
		if (streaming) return;
		// Block submit when no model is selected. Locked-mode surfaces (the
		// Ez panel) still need a real model — `lockedMode` only locks the
		// MODE picker (e.g. pinned to "Ez"); the user's model choice is
		// independent. Without this gate, sending before the picker's
		// async /api/models autoselect resolves leaks an empty
		// provider/model on the wire and the runtime falls back to its
		// default-tier resolution (resolveModel L3) — silent divergence
		// from the model the picker UI is showing.
		if (!selectedModel) return;
		if (disabled) return;
		// Allow empty text when attachments are staged (e.g. "summarize this image").
		if (!text && stagedFiles.length === 0) return;
		onsubmit(text, stagedFiles.length > 0 ? stagedFiles : undefined);
		if (stagedToolCalls.length > 0) {
			ontoolinvoke?.(stagedToolCalls);
			stagedToolCalls = [];
		}
		value = "";
		displayValue = "";
		stagedFiles = [];
		attachmentError = null;
		closeMention();
		resetInlineToolState();
		clearTimeout(suggestTimer);
		suggestAbort?.abort();
		suggestKeyCurrent = "";
		suggestDismissed = false;
		clearSuggestions();
		if (textarea) {
			textarea.style.height = "auto";
		}
	}

	export function focus() {
		textarea?.focus();
	}

	// Auto-focus the textarea when the parent flips `autofocus` true (e.g. on a
	// brand-new / empty conversation). rAF defers until after Svelte has painted
	// the textarea, matching the focus pattern used in mention-select handlers above.
	$effect(() => {
		if (!autofocus) return;
		if (disabled || isChatDisabled(streaming, connState)) return;
		const el = textarea;
		if (!el) return;
		requestAnimationFrame(() => {
			if (!isNavBlockedByOverlay(document)) el.focus();
		});
	});
</script>

<div class="chat-input-container border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 pt-2 pb-2 {subConversationStore.isInSubConversation ? 'opacity-50 pointer-events-none' : ''}">
	<div class="mx-auto flex max-w-3xl items-end gap-2">
		<!--
		 * Column is `relative` so the suggestions popover can anchor to its TOP
		 * edge — floating ABOVE the whole toolbar (Model / Thinking / Mode /
		 * Tools) rather than overlapping it. Keeping the model selector visible
		 * and clickable while suggestions show is the point: users must still be
		 * able to switch models mid-draft. `position:relative` with no z-index
		 * does NOT open a new stacking context, so every dropdown's z-index
		 * still competes globally as before.
		-->
		<div class="relative flex min-w-0 flex-1 flex-col gap-1">
			<!--
			 * Suggestions popover — hoisted OUT of the input-box `relative`
			 * wrapper below (where the mention / inline-tool popovers stay,
			 * correctly anchored to the textarea). Anchored to the COLUMN top so
			 * its `bottom-full` clears the toolbar entirely and nothing is
			 * covered. The mention popover (z-50) still wins when both could
			 * show, and the parent suppresses suggestions while any mention /
			 * inline-tool UI is open.
			-->
			<SuggestionPopover
				open={suggestOpen}
				tools={suggestTools}
				extensions={suggestExtensions}
				enhancement={suggestEnhancement}
				enhanceLoading={suggestEnhanceLoading}
				applied={suggestApplied}
				onselecttool={handleSuggestToolSelect}
				onselectextension={handleSuggestExtensionSelect}
				onapply={applySuggestEnhancement}
				onundo={undoSuggestEnhancement}
				ondismiss={dismissSuggest}
			/>
			{#if toolbarPosition !== "hidden"}
				<!--
				 * Toolbar — Model / Thinking / Mode columns + the amber
				 * "select a model" warning + mentions tooltip. Locked
				 * surfaces (the Ez panel today) keep all three columns:
				 * Model + Thinking work as usual; the Mode picker renders
				 * a disabled <ModeSelector> pinned to the synthesized
				 * `lockedModeObject` so users see *which* mode the
				 * conversation is fixed to without being able to change
				 * it. This replaces the old single "Ez" chip — Model and
				 * Thinking are now first-class citizens in locked mode.
				 -->
				<div class="flex min-w-0 flex-wrap items-center gap-3">
					<div class="flex flex-col">
						<span class="toolbar-label" data-tip="Choose which AI model powers this conversation">Model</span>
						<ModelSelector selected={selectedModel} onselect={onmodelchange} {onreasoningchange} {oncontextwindowchange} {onmodelsloaded} {onautoselect} {allowAuto} {autoServed} {defaultSelection} />
					</div>
					{#if modelSupportsReasoning && onthinkinglevelchange}
						<div class="flex flex-col">
							<span class="toolbar-label" data-tip="How long the model thinks before responding — higher means slower but smarter">Thinking</span>
							<ThinkingLevelSelector selected={thinkingLevel as any} onselect={onthinkinglevelchange} />
						</div>
					{/if}
					{#if isLocked && lockedModeObject}
						<div
							class="flex flex-col"
							data-testid="chat-input-locked-mode"
							data-mode-slug={lockedMode?.modeSlug}
						>
							<span class="toolbar-label" data-tip="This conversation is locked to a fixed mode">Mode</span>
							<ModeSelector
								selected={lockedModeObject}
								modes={[lockedModeObject]}
								onselect={() => {}}
								disabled
							/>
						</div>
					{:else if onmodechange}
						<div class="flex flex-col">
							<span class="toolbar-label" data-tip="Behavioral preset that controls system prompt, tool access, and AI behavior">Mode</span>
							<ModeSelector selected={selectedMode} {modes} onselect={onmodechange} oncreate={onmodecreate} />
						</div>
					{/if}
					{#if !isLocked && (onextensiontoolschange || onextensiontoolsreset)}
						<div class="flex flex-col">
							<span class="toolbar-label" data-tip="Scope which tools are active for this conversation">Tools</span>
							<ConversationToolsSelector
								selectedMode={selectedMode}
								value={conversationExtensionTools}
								{orchestrationTools}
								{conversationId}
								onchange={(map) => onextensiontoolschange?.(map)}
								onreset={() => onextensiontoolsreset?.()}
							/>
						</div>
					{/if}
					{#if !selectedModel}
						<span class="text-xs text-amber-400">Select a model to start chatting</span>
					{/if}
					<InfoTooltip key="chat.mentions" />
				</div>
			{/if}
			<div class="relative">
				<MentionPopover
					bind:this={popoverRef}
					items={mentionItems}
					open={mentionOpen}
					loading={mentionLoading}
					triggerQuery={mentionTriggerQuery}
					onselect={handleMentionSelect}
					ondismiss={closeMention}
				/>

				{#if showToolPicker && activeExtension}
					<ToolPicker
						bind:this={toolPickerRef}
						tools={activeTools}
						extensionName={activeExtension}
						onselect={handleToolSelect}
						onclose={resetInlineToolState}
					/>
				{/if}

				{#if showToolForm && selectedTool && activeExtension}
					<InlineToolForm
						tool={selectedTool}
						extensionName={activeExtension}
						initialValues={formInitialValues}
						{sharedValues}
						onconfirm={handleFormConfirm}
						onclose={resetInlineToolState}
					/>
				{/if}

				<!-- Staged attachments chip row + inline error -->
				<StagedAttachmentTray {stagedFiles} onremove={removeStagedFile} error={attachmentError} />

				<!-- Hidden file picker + ChatGPT/Claude-style input container -->
				<input
					bind:this={fileInputEl}
					type="file"
					multiple
					accept={acceptAttr}
					style="display:none"
					data-testid="attachment-file-input"
					onchange={onFileInputChange}
				/>
				<div
					class="chat-input-box {isDragging ? 'chat-input-box--dragging' : ''}"
					role="group"
					aria-label="Chat input with file drop zone"
					ondrop={onDrop}
					ondragover={onDragOver}
					ondragleave={onDragLeave}
				>
					{#if attachmentsSupported}
						<button
							type="button"
							class="attachment-btn"
							title="Attach files"
							aria-label="Attach files"
							data-testid="attachment-button"
							onclick={openFilePicker}
							disabled={streaming}
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
							</svg>
						</button>
					{/if}
					<div class="relative flex-1">
						<textarea
							bind:this={textarea}
							bind:value={displayValue}
							oninput={handleInput}
							onkeydown={handleKeydown}
							onkeyup={snapCursorOutOfMention}
							onclick={snapCursorOutOfMention}
							onscroll={syncScroll}
							onpaste={onPaste}
							oncompositionstart={() => (isComposing = true)}
							oncompositionend={() => { isComposing = false; handleInput(); }}
							rows={1}
							disabled={disabled || isChatDisabled(streaming, connState) || subConversationStore.isInSubConversation}
							role="combobox"
							aria-expanded={mentionOpen}
							aria-controls="mention-listbox"
							aria-autocomplete="list"
							aria-activedescendant={mentionOpen && popoverRef ? `mention-item-${popoverRef.getHighlightedIndex()}` : undefined}
							class="chat-textarea"
							placeholder={chatPlaceholder(connState, placeholder ?? 'Send a message...')}
						></textarea>

						<!-- Overlay for chip rendering -->
						<div
							bind:this={overlayEl}
							class="chat-textarea-overlay pointer-events-none absolute inset-0 overflow-hidden text-[var(--color-text-primary)]"
							style="padding: 4px 0.75rem; word-wrap: break-word; white-space: pre-wrap; line-height: 1.75rem; font-family: inherit;"
							aria-hidden="true"
						>
							{#each segments as seg}
								{#if seg.type === 'text'}{seg.text}{:else if seg.type === 'mention'}<span class="pointer-events-auto relative inline"><span class="invisible">{displayTokenText(seg.kind, seg.name)}</span><span class="absolute inset-0 flex items-center"><MentionChip name={seg.name} kind={seg.kind === 'ext' ? 'extension' : seg.kind === 'cmd' ? 'command' : seg.kind as 'agent' | 'team' | 'workflow' | 'file' | 'dir' | 'feature'} status={seg.kind === 'ext' ? getExtensionStatus(seg.name) : undefined} onclick={seg.kind === 'ext' ? () => handleChipClick(seg.name) : undefined} /></span></span>{/if}
							{/each}
						</div>
					</div>

					{#if streaming}
						<button
							onclick={onstop}
							class="send-btn send-btn--stop"
							title="Stop generating"
							aria-label="Stop generating"
						>
							<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
								<rect x="6" y="6" width="12" height="12" rx="2" />
							</svg>
						</button>
					{:else}
						<button
							onclick={submit}
							disabled={(!value.trim() && stagedFiles.length === 0) || !selectedModel || connState !== 'connected' || disabled}
							class="send-btn send-btn--send"
							title={!selectedModel ? "Select a model first" : "Send message"}
							aria-label="Send message"
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m0 0l-6 6m6-6l6 6" />
							</svg>
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	/* Container: rounded pill with border, holds textarea + send button */
	.chat-input-box {
		display: flex;
		align-items: center;
		gap: 0;
		border: 1px solid var(--color-border);
		border-radius: 1.5rem;
		background: var(--color-surface-tertiary);
		padding: 2px 6px 2px 8px;
		transition: border-color 0.15s;
	}
	.chat-input-box:focus-within {
		border-color: var(--color-accent);
	}

	/* Textarea: no border, transparent bg, sits inside the container */
	.chat-textarea {
		width: 100%;
		resize: none;
		border: none;
		outline: none;
		background: transparent;
		margin: 0;
		padding: 4px 0.75rem;
		font-size: 0.875rem;
		line-height: 1.75rem;
		color: transparent;
		caret-color: var(--color-text-primary);
		box-sizing: border-box;
	}
	.chat-textarea-overlay {
		font-size: 0.875rem;
	}
	.chat-textarea::placeholder {
		color: var(--color-text-muted);
	}
	.chat-textarea:disabled {
		opacity: 0.5;
	}
	/* iOS Safari zooms when a focused input's font-size is < 16px.
	 * Bump both the textarea and its mirror overlay together so chip
	 * positions stay aligned. */
	@media (pointer: coarse) {
		.chat-textarea,
		.chat-textarea-overlay {
			font-size: 16px;
		}
	}

	/* Send button — 2.5rem below md for the 40px mobile touch target,
	   2rem on desktop where pointer precision allows the compact pill. */
	.send-btn {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
	}
	@media (min-width: 768px) {
		.send-btn {
			width: 2rem;
			height: 2rem;
		}
	}
	.send-btn:active {
		transform: scale(0.92);
	}
	.send-btn--send {
		background: var(--color-accent);
		color: white;
	}
	.send-btn--send:hover:not(:disabled) {
		filter: brightness(1.15);
	}
	.send-btn--send:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.send-btn--stop {
		background: var(--color-accent);
		color: white;
	}
	.send-btn--stop:hover {
		background: #dc2626;
	}

	textarea {
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
	}
	textarea:hover,
	textarea:focus {
		scrollbar-color: var(--color-border) transparent;
	}
	/* Webkit browsers */
	textarea::-webkit-scrollbar {
		width: 6px;
	}
	textarea::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 3px;
	}
	textarea:hover::-webkit-scrollbar-thumb,
	textarea:focus::-webkit-scrollbar-thumb {
		background: var(--color-border);
	}
	/* Toolbar label tooltips */
	.toolbar-label {
		position: relative;
		font-size: 10px;
		line-height: 1;
		margin-bottom: 2px;
		color: var(--color-text-muted);
		cursor: help;
	}
	.toolbar-label::after {
		content: attr(data-tip);
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		white-space: normal;
		width: max-content;
		max-width: 220px;
		padding: 6px 10px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: var(--color-surface-secondary);
		color: var(--color-text-secondary);
		font-size: 11px;
		line-height: 1.4;
		box-shadow: 0 4px 12px rgba(0,0,0,0.3);
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.15s;
		z-index: 60;
	}
	.toolbar-label:hover::after {
		opacity: 1;
	}

	/* ── Attachment UI ──────────────────────────────────────────── */
	.chat-input-box--dragging {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-tertiary));
	}
	.attachment-btn {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}
	.attachment-btn:hover:not(:disabled) {
		background: var(--color-surface-secondary);
		color: var(--color-text-primary);
	}
	.attachment-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
