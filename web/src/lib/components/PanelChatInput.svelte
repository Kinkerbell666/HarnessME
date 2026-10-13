<script lang="ts">
	import { onDestroy, tick } from "svelte";
	import MentionPopover from "./MentionPopover.svelte";
	import MentionChip from "./MentionChip.svelte";
	import type { MentionItem } from "./MentionPopover.svelte";
	import { detectMentionTrigger, insertMentionToken, commitCommandLiteral, getSegments, descendIntoFolder } from "$lib/mention-logic";
	import { toDisplay, displayTokenText, applyDisplayEdit, displayPosToWire, wirePosToDisplay } from "$lib/mention-display";
	import { searchMentionItems } from "$lib/mention-search";
	import { createLatestSearch } from "$lib/latest-search";
	import { store } from "$lib/stores.svelte";
	import { setComposerDisplay } from "$lib/chat-input-logic";

	let {
		placeholder = "Send a message...",
		disabled = false,
		processing = false,
		agentName,
		agentColor,
		scrollSentinel,
		scrollContainer,
		onsubmit,
	}: {
		placeholder?: string;
		disabled?: boolean;
		processing?: boolean;
		agentName?: string;
		agentColor?: string;
		scrollSentinel?: HTMLElement;
		scrollContainer?: HTMLElement;
		onsubmit: (content: string) => Promise<void>;
	} = $props();

	// `value` is the WIRE string (full `![kind:name]` tokens); the textarea is
	// bound to a COMPACT projection (`displayValue`) so chips lay out tight
	// against their label with no blank gap. See `mention-display` for details.
	let value = $state("");
	let displayValue = $state("");
	let textarea: HTMLTextAreaElement | undefined = $state();
	let overlayEl: HTMLDivElement | undefined = $state();
	let sending = $state(false);
	let error = $state("");

	/** Commit a new wire string, refresh the compact display + map the caret. */
	function setWire(newWire: string, wireCursor: number) {
		value = newWire;
		const { display, spans } = toDisplay(newWire);
		displayValue = display;
		const dCursor = wirePosToDisplay(spans, wireCursor);
		setComposerDisplay(textarea, display, dCursor);
	}

	/** Current caret as a WIRE offset (textarea reports display space). */
	function wireCaret(): number {
		if (!textarea) return value.length;
		return displayPosToWire(toDisplay(value).spans, textarea.selectionStart);
	}

	// Scroll-to-bottom state (driven by parent's sentinel + container)
	let userScrolledUp = $state(false);

	$effect(() => {
		if (!scrollSentinel || !scrollContainer) return;
		const observer = new IntersectionObserver(
			([entry]) => { userScrolledUp = !entry!.isIntersecting; },
			{ root: scrollContainer, threshold: 0.1 },
		);
		observer.observe(scrollSentinel);
		return () => observer.disconnect();
	});

	function scrollToBottom() {
		userScrolledUp = false;
		tick().then(() => {
			requestAnimationFrame(() => {
				scrollSentinel?.scrollIntoView({ behavior: 'smooth' });
			});
		});
	}

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
	onDestroy(mentionSearch.cancel);
	// Latest trigger query — passed to the popover so it can decide whether
	// to inject the "use current folder as path" pseudo-entry at the top.
	let mentionTriggerQuery = $state("");

	// Segments for overlay rendering
	let segments = $derived(getSegments(value));

	async function submit() {
		const content = value.trim();
		if (!content || sending) return;
		sending = true;
		error = "";
		value = "";
		displayValue = "";
		closeMention();
		resetHeight();
		try {
			await onsubmit(content);
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to send";
			value = content;
			displayValue = toDisplay(content).display;
		}
		sending = false;
	}

	const MENU_NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']);

	function handleKeydown(e: KeyboardEvent) {
		// Delegate navigation keys to mention popover when open
		if (mentionOpen && popoverRef && MENU_NAV_KEYS.has(e.key)) {
			popoverRef.handleKeydown(e);
			return;
		}

		// Atomic backspace/delete on mention chips (display-space caret → wire token)
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
		if (textarea.selectionStart !== textarea.selectionEnd) return;
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

	function handleInput() {
		if (!textarea) return;

		// Project the compact-display edit back onto the wire string.
		const synced = applyDisplayEdit(value, displayValue);
		if (synced === null) {
			displayValue = toDisplay(value).display;
			return;
		}
		value = synced;
		const canonical = toDisplay(value).display;
		if (canonical !== displayValue) displayValue = canonical;

		textarea.style.height = "auto";
		textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
		syncScroll();

		if (isComposing) return;

		const trigger = detectMentionTrigger(displayValue, textarea.selectionStart);

		if (!trigger) {
			if (mentionOpen) {
				closeMention();
			}
			return;
		}

		mentionOpen = true;
		mentionTriggerQuery = trigger.query;

		// Debounced search. File searches need the active project so the API
		// can scope the listing to that project's path; the "global" sentinel
		// value is passed through as undefined so the API short-circuits to [].
		const projectId =
			store.activeProjectId && store.activeProjectId !== "global"
				? store.activeProjectId
				: undefined;
		mentionSearch.schedule(() => searchMentionItems(trigger.query, trigger.type, projectId));
	}

	function handleMentionSelect(item: MentionItem) {
		if (!textarea) return;

		// Folder entry: DESCEND instead of inserting a token. Rewrite the
		// current `@` trigger to `@<folder>/` so the next search walks into
		// that folder.
		if (item.kind === 'dir') {
			const descent = descendIntoFolder(value, wireCaret(), item.name);
			setWire(descent.text, descent.cursor);
			// Re-fire trigger detection now that the query changed.
			requestAnimationFrame(() => handleInput());
			return;
		}

		// Synthetic "Use this folder as path" entry: commit the current
		// descent as a @[dir:…] token.
		if (item.kind === 'dir-target') {
			const result = insertMentionToken(value, wireCaret(), {
				kind: 'dir',
				name: item.name,
			});
			setWire(result.text, result.cursor);
			closeMention();
			return;
		}

		// Built-in literal command (e.g. `/goal`): raw text, not a
		// `/[cmd:name]` token, exactly as the main composer commits it.
		if (item.insertText) {
			const result = commitCommandLiteral(value, wireCaret(), item.insertText);
			setWire(result.text, result.cursor);
			closeMention();
			return;
		}

		// Leaf selection (file / agent / ext / team / command) → insert
		// a structured token. API returns `extension` / `command` but
		// mention-logic uses shorter `ext` / `cmd` internally.
		const kind = item.kind === 'extension'
			? 'ext'
			: item.kind === 'command'
				? 'cmd'
				: item.kind;
		const result = insertMentionToken(value, wireCaret(), {
			kind: kind as 'agent' | 'ext' | 'team' | 'file' | 'dir' | 'cmd',
			name: item.name,
		});
		setWire(result.text, result.cursor);
		closeMention();
		if (textarea) {
			textarea.style.height = "auto";
			textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
		}
	}

	/** Close the mention popover and drop any search still pending for it. */
	function closeMention() {
		mentionOpen = false;
		mentionItems = [];
		mentionTriggerQuery = "";
		mentionSearch.cancel();
	}

	function syncScroll() {
		if (textarea && overlayEl) {
			overlayEl.scrollTop = textarea.scrollTop;
		}
	}

	function resetHeight() {
		if (!textarea) return;
		textarea.style.height = "auto";
	}
</script>

<div class="relative border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
	{#if userScrolledUp}
		<button
			class="jump-to-bottom"
			onclick={scrollToBottom}
			aria-label="Jump to bottom"
		>
			<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
			</svg>
		</button>
	{/if}
	{#if processing}
		<div class="flex items-center gap-2 mb-1.5 px-2">
			<span class="relative flex h-2 w-2">
				<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style:background-color={agentColor ?? 'var(--color-accent)'}></span>
				<span class="relative inline-flex h-2 w-2 rounded-full" style:background-color={agentColor ?? 'var(--color-accent)'}></span>
			</span>
			<span class="text-[11px] text-[var(--color-text-muted)]">
				{agentName ? `@${agentName} is processing` : 'Processing'}
				<span class="typing-dots"></span>
			</span>
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

		<div class="panel-chat-box">
			<div class="relative flex-1">
				<textarea
					bind:this={textarea}
					bind:value={displayValue}
					oninput={handleInput}
					onkeydown={handleKeydown}
					onkeyup={snapCursorOutOfMention}
					onclick={snapCursorOutOfMention}
					onscroll={syncScroll}
					oncompositionstart={() => (isComposing = true)}
					oncompositionend={() => { isComposing = false; handleInput(); }}
					rows={1}
					{placeholder}
					disabled={disabled || sending}
					role="combobox"
					aria-expanded={mentionOpen}
					aria-controls="mention-listbox"
					aria-autocomplete="list"
					aria-activedescendant={mentionOpen && popoverRef ? `mention-item-${popoverRef.getHighlightedIndex()}` : undefined}
					class="panel-chat-textarea"
				></textarea>

				<!-- Overlay for chip rendering -->
				<div
					bind:this={overlayEl}
					class="panel-chat-textarea-overlay pointer-events-none absolute inset-0 overflow-hidden text-[var(--color-text-primary)]"
					style="padding: 4px 0.75rem; word-wrap: break-word; white-space: pre-wrap; line-height: 1.75rem; font-family: inherit;"
					aria-hidden="true"
				>
					{#each segments as seg}
						{#if seg.type === 'text'}{seg.text}{:else if seg.type === 'mention'}<span class="relative inline"><span class="invisible">{displayTokenText(seg.kind, seg.name)}</span><span class="absolute inset-0 flex items-center"><MentionChip name={seg.name} kind={seg.kind === 'ext' ? 'extension' : seg.kind === 'cmd' ? 'command' : seg.kind as 'agent' | 'team' | 'workflow' | 'file' | 'dir' | 'feature'} /></span></span>{/if}
					{/each}
				</div>
			</div>

			<button
				onclick={submit}
				disabled={!value.trim() || sending}
				aria-label="Send message"
				class="panel-send-btn"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m0 0l-6 6m6-6l6 6" />
				</svg>
			</button>
		</div>
	</div>
	{#if error}
		<p class="mt-1 text-xs text-red-400">{error}</p>
	{/if}
</div>

<style>
	.panel-chat-box {
		display: flex;
		align-items: center;
		gap: 0;
		border: 1px solid var(--color-border);
		border-radius: 1.5rem;
		background: var(--color-surface-tertiary);
		padding: 2px 6px 2px 8px;
		transition: border-color 0.15s;
	}
	.panel-chat-box:focus-within {
		border-color: var(--color-accent);
	}

	.panel-chat-textarea {
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
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
	}
	.panel-chat-textarea::placeholder {
		color: var(--color-text-muted);
	}
	.panel-chat-textarea:disabled {
		opacity: 0.5;
	}
	.panel-chat-textarea:hover,
	.panel-chat-textarea:focus {
		scrollbar-color: var(--color-border) transparent;
	}
	.panel-chat-textarea-overlay {
		font-size: 0.875rem;
	}
	/* iOS Safari zooms when a focused input's font-size is < 16px.
	 * Bump both the textarea and its mirror overlay together so chip
	 * positions stay aligned. */
	@media (pointer: coarse) {
		.panel-chat-textarea,
		.panel-chat-textarea-overlay {
			font-size: 16px;
		}
	}

	.panel-send-btn {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
		background: var(--color-accent);
		color: white;
	}
	.panel-send-btn:hover:not(:disabled) {
		filter: brightness(1.15);
	}
	.panel-send-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.panel-send-btn:active {
		transform: scale(0.92);
	}

	.jump-to-bottom {
		position: absolute;
		bottom: 100%;
		left: 50%;
		transform: translateX(-50%);
		margin-bottom: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 9999px;
		background: var(--color-surface-tertiary);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
		box-shadow: 0 2px 8px rgba(0,0,0,0.3);
		z-index: 10;
	}
	.jump-to-bottom:hover {
		color: var(--color-text-primary);
		background: var(--color-border);
	}

	.typing-dots::after {
		content: '';
		animation: dots 1.4s steps(4, end) infinite;
	}
	@keyframes dots {
		0%   { content: ''; }
		25%  { content: '.'; }
		50%  { content: '..'; }
		75%  { content: '...'; }
		100% { content: ''; }
	}
</style>
