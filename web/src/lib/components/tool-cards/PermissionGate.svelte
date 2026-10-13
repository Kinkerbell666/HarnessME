<script lang="ts">
	import type { ToolCallState } from "$lib/stores.svelte.js";
	import { sendToolPermissionResponse } from "$lib/stores.svelte.js";
	import { getSecurityNote, describeToolInput } from "./utils.js";
	import {
		expiryCopy,
		TTL_OPTIONS,
		DEFAULT_TTL_FIRST_USE_MS,
	} from "$lib/components/permissions/expiry-copy";

	/**
	 * Phase 4 (capability-expiry): the gate now has THREE rendering modes,
	 * picked top-down:
	 *   1. `expiredCapability` set       → "expired — re-approve" branch.
	 *      Fires after the sweep revoked a grant; the next tool-call hit
	 *      surfaces this branch instead of the install-time prompt.
	 *   2. `extensionId` set             → four-scope chooser (Phase 6).
	 *   3. neither set                   → legacy two-button Allow / Deny.
	 *
	 * The `expiredCapability` branch is purely additive — when undefined,
	 * the existing four-scope flow renders unchanged. The "Approve forever
	 * (admin only)" button is gated by the `isAdmin` prop AND defended in
	 * depth by `/api/tool-calls/:id/permission` (which rejects
	 * `scope: "forever"` from non-admin callers).
	 */
	let {
		toolCall,
		expiredCapability,
		isAdmin = false,
		onResolved,
	}: {
		toolCall: ToolCallState;
		/**
		 * Optional callback fired AFTER a permission decision is POSTed
		 * (allow/deny/re-approve). The chat-inline gate leaves this unset —
		 * the run's tool-call state clears the card on `tool:complete`. The
		 * fallback `PendingPermissionTray` (extension-initiated prompts with
		 * no run) passes it so the tray can drop the resolved card, which has
		 * no `tool:complete` render slot of its own.
		 */
		onResolved?: () => void;
		/**
		 * Phase 56: `initialTtlMs` accepts `number | null` (null = the
		 * picker's "Never" selection). The chat-side gate seeds the
		 * picker with this value; if absent the picker defaults to
		 * `DEFAULT_TTL_FIRST_USE_MS`. The producer of this prop (per
		 * RESEARCH Open Question 1) does not currently exist in
		 * production source — `expiredCapability` is consumed here and
		 * in test fixtures only. A future producer will receive this
		 * new shape automatically.
		 */
		expiredCapability?: {
			capability: string;
			ageMs: number;
			initialTtlMs?: number | null;
		};
		isAdmin?: boolean;
	} = $props();
	let loading = $state(false);

	// Phase 56: picker state mirrors the settings-side ExpiredReapproveModal.
	// Driven by bind:value on the <select>; changing it recomputes the
	// `expiredCopy` $derived (because the formatter consumes the
	// `selectedTtlMs` input), giving the Approve button label live
	// parity with the settings-side surface. Initializing from the
	// `expiredCapability.initialTtlMs` prop is intentional — the prop
	// is the SEED for the picker (sticky last-pick or first-use
	// fallback), not a live two-way binding.
	// svelte-ignore state_referenced_locally
	let selectedTtlMs = $state<number | null>(
		expiredCapability?.initialTtlMs ?? DEFAULT_TTL_FIRST_USE_MS,
	);

	let securityNote = $derived(getSecurityNote(toolCall.category));

	// `describeToolInput`, NOT `extractInputSummary`: a consent prompt that
	// renders no arguments is asking for uninformed consent. Caller-executed
	// tools declare arbitrary parameter names, so the header-summary allowlist
	// misses nearly all of them — see the helper's own note.
	let inputSummary = $derived(describeToolInput(toolCall.input) ?? '');

	// Phase 4: expired-capability branch overrides everything else when
	// set — the modal renders re-approve copy, not the install-time
	// chooser, so users can't be confused into thinking this is a fresh
	// grant for a capability they never approved before.
	let isExpiredRequest = $derived(expiredCapability !== undefined);

	// Phase 6: extension-scoped permission request? Routes the modal to
	// the four-scope chooser when extensionId is set. Built-in tool
	// gates (no extensionId) keep the legacy two-button Allow/Deny.
	let isExtensionRequest = $derived(toolCall.extensionId !== undefined && toolCall.extensionId.length > 0);

	// Human-readable description of what's being requested.
	let extensionRequestDescription = $derived.by(() => {
		if (!isExtensionRequest) return '';
		if (toolCall.capabilityKind === 'shell') {
			return 'Execute shell commands';
		}
		if (toolCall.capabilityKind === 'fs.write') {
			return toolCall.capabilityValue
				? `Write to filesystem: ${toolCall.capabilityValue}`
				: 'Write to filesystem';
		}
		if (toolCall.capabilityKind === 'ezcorp:extension:install') {
			return 'Install an extension and let it run with its declared permissions';
		}
		if (toolCall.capabilityKind === 'ezcorp:extension:modify') {
			return 'Edit an installed extension';
		}
		return `Use capability ${toolCall.capabilityKind ?? '(unknown)'}`;
	});

	// Install / modify approvals are never persisted server-side, so the
	// chooser offers no lasting scope for them — only this one call.
	let isOneShotRequest = $derived(
		toolCall.capabilityKind === 'ezcorp:extension:install' ||
			toolCall.capabilityKind === 'ezcorp:extension:modify',
	);

	// Phase 4 expired-branch derivations. Pulled from the shared
	// `expiry-copy.ts` module so chat-side and settings-side surfaces
	// render identical strings (design doc § 3.2 verbatim contract).
	let extensionDisplayName = $derived(toolCall.extensionId ?? 'extension');
	let expiredCopy = $derived(
		expiredCapability
			? expiryCopy(
					extensionDisplayName,
					expiredCapability.capability,
					expiredCapability.ageMs,
					// Phase 56: pass the picker's current value so the
					// approve button label updates live when the user
					// changes the TTL dropdown.
					selectedTtlMs,
				)
			: null,
	);

	type Scope = 'session' | 'conversation' | 'project' | 'forever';

	async function handleAllow(scope?: Scope) {
		if (!toolCall.id) return;
		loading = true;
		try {
			// Built-in tool gates ignore the scope arg server-side; only
			// extension-scoped gates honor it.
			await sendToolPermissionResponse(toolCall.id, true, scope);
			onResolved?.();
		} finally {
			loading = false;
		}
	}

	async function handleDeny() {
		if (!toolCall.id) return;
		await sendToolPermissionResponse(toolCall.id, false);
		onResolved?.();
	}

	// Phase 4 — re-approve handlers. The "Approve $newTtl" path posts
	// `{approved: true}` with no scope; the server resolves the actual
	// TTL on approve (mirrors the install-time flow). Admin "forever"
	// adds `scope: "forever"` AND expects the server-side guard to
	// confirm the caller's role.
	// Phase 56: the default approve path now also carries the picker's
	// `ttlOverrideMs` selection (number for 1h..90d, null for "Never").
	// Defense-in-depth on `scope=forever` is server-side; the picker
	// Never path (null on a non-forever scope) is allowed for any
	// authenticated user.
	async function handleReapproveDefault() {
		if (!toolCall.id) return;
		loading = true;
		try {
			await sendToolPermissionResponse(
				toolCall.id,
				true,
				undefined,
				selectedTtlMs,
			);
			onResolved?.();
		} finally {
			loading = false;
		}
	}

	async function handleReapproveForever() {
		if (!toolCall.id) return;
		loading = true;
		try {
			await sendToolPermissionResponse(toolCall.id, true, 'forever');
			onResolved?.();
		} finally {
			loading = false;
		}
	}

	async function handleReapproveCancel() {
		// Dismissal is non-authoritative per design doc § 3.3 — sweep
		// already revoked, the cancel just defers the next prompt. We
		// still POST `{approved: false}` so the gate resolves and the
		// pending state clears (otherwise the UI would hang on the
		// modal). Subsequent tool calls will re-prompt until the user
		// approves.
		if (!toolCall.id) return;
		await sendToolPermissionResponse(toolCall.id, false);
		onResolved?.();
	}
</script>

<div data-testid="tool-card-permission" class="rounded-md border border-[var(--color-warning,#f59e0b)]/50 bg-[var(--color-warning,#f59e0b)]/10 overflow-hidden">
	<div class="px-3 py-2">
		<div class="flex items-center gap-2 mb-2">
			<svg class="h-4 w-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
			</svg>
			{#if isExpiredRequest && expiredCopy}
				<!--
					Phase 4 expired branch — title from shared
					`expiry-copy.ts`. The settings-side
					ExpiredReapproveModal renders the SAME constant.
				-->
				<span
					class="text-sm font-medium text-[var(--color-text-primary)]"
					data-testid="permission-expired-title"
				>{expiredCopy.title}</span>
			{:else}
				<span class="text-sm font-medium text-[var(--color-text-primary)]">{toolCall.toolName}</span>
			{/if}
			{#if (isExtensionRequest || isExpiredRequest) && toolCall.extensionId}
				<span class="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-primary)]" data-testid="permission-extension-badge">{toolCall.extensionId}</span>
			{/if}
			{#if toolCall.category}
				<span class="rounded-full bg-[var(--color-warning,#f59e0b)]/20 px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-primary)]">{toolCall.category}</span>
			{/if}
		</div>

		{#if isExpiredRequest && expiredCopy}
			<!--
				Phase 4 body copy from shared `expiry-copy.ts` (design
				doc § 3.2 verbatim). Both surfaces render the same
				constant; component tests for either surface assert
				against this string independently.
			-->
			<p
				class="mb-2 text-sm text-[var(--color-text-primary)]"
				data-testid="permission-expired-body"
			>{expiredCopy.body}</p>
		{:else if isExtensionRequest}
			<p class="mb-2 text-sm text-[var(--color-text-primary)]" data-testid="permission-extension-description">
				This extension wants to: <span class="font-medium">{extensionRequestDescription}</span>
			</p>
		{/if}

		{#if inputSummary}
			<pre class="mb-2 rounded bg-[var(--color-surface-secondary)] p-2 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{inputSummary}</pre>
		{/if}

		{#if securityNote && !isExpiredRequest}
			<p class="mb-3 text-xs text-[var(--color-text-secondary)]">{securityNote}</p>
		{/if}

		{#if isExpiredRequest && expiredCopy}
			<!--
				Phase 4 expired-branch buttons. Labels come from shared
				`expiry-copy.ts` (design doc § 3.2 verbatim):
				  • copy.approveDefault   — "Approve $newTtl" — primary, all users
				  • copy.approveForever   — "Approve forever (admin only)" — admin-gated
				  • copy.cancel           — "Cancel" — closes modal, no POST scope
				The forever button is also defended server-side: the
				`/api/tool-calls/:id/permission` handler rejects
				`scope: "forever"` from non-admin callers (defense in
				depth, even if a tampered DOM bypasses the gate).
			-->
			<div class="flex flex-wrap items-center gap-2" data-testid="permission-expired-actions">
				<!--
					Phase 56 — TTL picker parity with the settings-side
					ExpiredReapproveModal. Same TTL_OPTIONS source, same
					data-testid, same $derived label wiring. The current
					selection drives both the Approve button label and the
					payload posted to /api/tool-calls/:id/permission.
				-->
				<select
					bind:value={selectedTtlMs}
					data-testid="expired-reapprove-ttl-picker"
					aria-label="Re-approval duration"
					class="rounded bg-[var(--color-surface-secondary)] px-2 py-1 text-xs text-[var(--color-text-primary)] disabled:opacity-50"
					disabled={loading}
				>
					{#each TTL_OPTIONS as opt}
						<option value={opt.value}>{opt.code}</option>
					{/each}
				</select>
				<button
					onclick={handleReapproveDefault}
					disabled={loading}
					data-testid="permission-expired-approve-default"
					class="rounded px-3 py-1.5 text-xs font-medium bg-green-700 hover:bg-green-600 text-white transition-colors disabled:opacity-50"
				>
					{loading ? 'Working...' : expiredCopy.approveDefault}
				</button>
				{#if isAdmin}
					<button
						onclick={handleReapproveForever}
						disabled={loading}
						data-testid="permission-expired-approve-forever"
						class="rounded px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
					>
						{expiredCopy.approveForever}
					</button>
				{/if}
				<button
					onclick={handleReapproveCancel}
					disabled={loading}
					data-testid="permission-expired-cancel"
					class="rounded px-3 py-1.5 text-xs font-medium bg-[var(--color-surface-tertiary)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
				>
					{expiredCopy.cancel}
				</button>
			</div>
		{:else if isExtensionRequest}
			<!--
				Phase 6: extension-scoped four-scope chooser. The default
				is "session" (least surprise — expires on conversation
				end / restart) per the spec lock-in. The UI must NOT
				default to "forever".
			-->
			<div class="flex flex-wrap gap-2" data-testid="permission-scope-chooser">
				{#if isOneShotRequest}
				<button
					onclick={() => handleAllow('session')}
					disabled={loading}
					data-testid="permission-allow-once"
					class="rounded px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50"
				>
					{loading ? 'Working...' : 'Allow this time'}
				</button>
				{:else}
				<button
					onclick={() => handleAllow('session')}
					disabled={loading}
					data-testid="permission-allow-session"
					class="rounded px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50"
				>
					{loading ? 'Working...' : 'Allow until restart'}
				</button>
				<button
					onclick={() => handleAllow('conversation')}
					disabled={loading}
					data-testid="permission-allow-conversation"
					class="rounded px-3 py-1.5 text-xs font-medium bg-green-700 hover:bg-green-600 text-white transition-colors disabled:opacity-50"
				>
					Allow for this conversation
				</button>
				<button
					onclick={() => handleAllow('project')}
					disabled={loading}
					data-testid="permission-allow-project"
					class="rounded px-3 py-1.5 text-xs font-medium bg-green-800 hover:bg-green-700 text-white transition-colors disabled:opacity-50"
				>
					Allow for this project
				</button>
				<button
					onclick={() => handleAllow('forever')}
					disabled={loading}
					data-testid="permission-allow-forever"
					class="rounded px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
				>
					Always allow
				</button>
				{/if}
				<button
					onclick={handleDeny}
					disabled={loading}
					data-testid="permission-deny"
					class="rounded px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
				>
					Deny
				</button>
			</div>
		{:else}
			<!-- Built-in tool gate: legacy two-button modal. -->
			<div class="flex gap-2">
				<button
					onclick={() => handleAllow()}
					disabled={loading}
					data-testid="permission-allow"
					class="rounded px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50"
				>
					{loading ? 'Allowing...' : 'Allow'}
				</button>
				<button
					onclick={handleDeny}
					disabled={loading}
					data-testid="permission-deny"
					class="rounded px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
				>
					Deny
				</button>
			</div>
		{/if}
	</div>
</div>
