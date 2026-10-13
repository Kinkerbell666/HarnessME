<script lang="ts">
	import EmptyState from "$lib/components/EmptyState.svelte";
	import { store } from "$lib/stores.svelte.js";

	interface GlobalStats {
		totalInputTokens: number;
		totalOutputTokens: number;
		totalToolCalls: number;
		totalTurnCount: number;
		avgResponseMs: number;
		tokensByDay: { date: string; input: number; output: number }[];
		topExtensions: { extensionId: string; callCount: number; successRate: number; avgDurationMs: number }[];
		/** "all": every user's totals (admins); "own": the caller's conversations. */
		scope: "all" | "own";
	}

	let stats = $state<GlobalStats | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let selectedRange = $state(30);

	const RANGES = [
		{ label: "7d", days: 7 },
		{ label: "30d", days: 30 },
		{ label: "90d", days: 90 },
	];

	async function loadStats() {
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/observability?days=${selectedRange}`);
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
			stats = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : "Failed to load stats";
		} finally {
			loading = false;
		}
	}

	// Runs on mount too: an onMount load as well fetched everything twice.
	$effect(() => {
		void selectedRange;
		loadStats();
	});

	function formatTokens(n: number): string {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
		if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
		return String(n);
	}

	function formatMs(ms: number): string {
		if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
		return ms + "ms";
	}

	// Compute max for bar chart scaling
	let maxDayTokens = $derived(
		stats?.tokensByDay.reduce((max, d) => Math.max(max, d.input + d.output), 0) ?? 0,
	);
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-[var(--color-text-primary)]">Analytics</h1>
			{#if stats}
				<p class="text-xs text-[var(--color-text-muted)]" data-testid="analytics-scope">
					{stats.scope === "all" ? "All users" : "Your conversations"}
				</p>
			{/if}
		</div>
		<div class="flex gap-1">
			{#each RANGES as range}
				<button
					onclick={() => { selectedRange = range.days; }}
					class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors
						{selectedRange === range.days
							? 'bg-blue-600 text-white'
							: 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-primary)]'}"
				>
					{range.label}
				</button>
			{/each}
		</div>
	</div>

	{#if loading && !stats}
		<p class="text-sm text-[var(--color-text-secondary)]">Loading...</p>
	{:else if error}
		<div class="rounded-md border border-red-800 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
	{:else if stats}
		<!-- Summary Cards -->
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
				<p class="text-xs text-[var(--color-text-secondary)]">Total Tokens</p>
				<p class="mt-1 text-2xl font-bold text-[var(--color-text-primary)]">{formatTokens(stats.totalInputTokens + stats.totalOutputTokens)}</p>
				<p class="mt-0.5 text-xs text-[var(--color-text-muted)]">
					{formatTokens(stats.totalInputTokens)} in / {formatTokens(stats.totalOutputTokens)} out
				</p>
			</div>
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
				<p class="text-xs text-[var(--color-text-secondary)]">Tool Calls</p>
				<p class="mt-1 text-2xl font-bold text-[var(--color-text-primary)]">{stats.totalToolCalls}</p>
			</div>
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
				<p class="text-xs text-[var(--color-text-secondary)]">Turns</p>
				<p class="mt-1 text-2xl font-bold text-[var(--color-text-primary)]">{stats.totalTurnCount}</p>
			</div>
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
				<p class="text-xs text-[var(--color-text-secondary)]">Avg Response</p>
				<p class="mt-1 text-2xl font-bold text-[var(--color-text-primary)]">{formatMs(stats.avgResponseMs)}</p>
			</div>
		</div>

		<!-- Token Usage Chart -->
		{#if stats.tokensByDay.length > 0}
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
				<h2 class="mb-3 text-sm font-semibold text-[var(--color-text-secondary)]">Token Usage by Day</h2>
				<div class="flex items-end gap-1" style="height: 120px;">
					{#each stats.tokensByDay as day}
						{@const total = day.input + day.output}
						{@const height = maxDayTokens > 0 ? (total / maxDayTokens) * 100 : 0}
						{@const inputPct = total > 0 ? (day.input / total) * 100 : 50}
						<div class="group relative flex flex-1 flex-col justify-end" style="height: 100%;">
							<div
								class="w-full rounded-t"
								style="height: {height}%; min-height: 2px; background: linear-gradient(to top, #3b82f6 {inputPct}%, #60a5fa {inputPct}%);"
							></div>
							<div class="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-secondary)] shadow-lg group-hover:block">
								{day.date}<br />{formatTokens(day.input)} in / {formatTokens(day.output)} out
							</div>
						</div>
					{/each}
				</div>
				<div class="mt-2 flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
					<span class="flex items-center gap-1"><span class="inline-block h-2 w-2 rounded bg-blue-500"></span> Input</span>
					<span class="flex items-center gap-1"><span class="inline-block h-2 w-2 rounded bg-blue-400"></span> Output</span>
				</div>
			</div>
		{/if}

		<!-- Top Extensions -->
		{#if stats.topExtensions.length > 0}
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
				<h2 class="mb-3 text-sm font-semibold text-[var(--color-text-secondary)]">Top Extensions</h2>
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-secondary)]">
							<th class="pb-2">Extension</th>
							<th class="pb-2 text-right">Calls</th>
							<th class="pb-2 text-right">Success Rate</th>
							<th class="pb-2 text-right">Avg Duration</th>
						</tr>
					</thead>
					<tbody>
						{#each stats.topExtensions as ext}
							<tr class="border-b border-[var(--color-border)]/50">
								<td class="py-2 text-[var(--color-text-secondary)]">{ext.extensionId}</td>
								<td class="py-2 text-right text-[var(--color-text-secondary)]">{ext.callCount}</td>
								<td class="py-2 text-right text-[var(--color-text-secondary)]">{ext.successRate}%</td>
								<td class="py-2 text-right text-[var(--color-text-secondary)]">{formatMs(ext.avgDurationMs)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<!-- Empty state -->
		{#if stats.totalTurnCount === 0 && stats.totalToolCalls === 0}
			<EmptyState
				title="No observability data yet"
				description="Data is collected automatically as agents use tools. Start a conversation with an agent to see traces."
				ctaLabel="Go to Chat"
				ctaHref={store.activeProjectId !== "global" ? `/project/${store.activeProjectId}/chat` : "/"}
			>
				{#snippet icon()}
					<svg class="h-12 w-12 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
					</svg>
				{/snippet}
			</EmptyState>
		{/if}
	{/if}
</div>
