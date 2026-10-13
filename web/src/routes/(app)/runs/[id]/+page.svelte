<script lang="ts">
	import { page } from "$app/state";
	import { store } from "$lib/stores.svelte.js";
	import { fetchRun, type Run } from "$lib/api.js";
	import { setBreadcrumbTail } from "$lib/breadcrumb-tail.svelte.js";
	import { reloadOn } from "$lib/reload-on.svelte.js";
	import { formatDuration } from "$lib/format-duration.js";
	import StatusBadge from "$lib/components/StatusBadge.svelte";
	import LogStream from "$lib/components/LogStream.svelte";

	let run: Run | null = $state<Run | null>(null);
	let errorMessage = $state("");
	let runId = $derived(page.params.id);

	// Keep in sync with store updates (from WS)
	let storeRun = $derived(store.runs.find((r) => r.id === runId) ?? null);

	$effect(() => {
		if (storeRun) {
			run = storeRun;
		}
	});

	reloadOn(() => runId, async (id, isStale) => {
		run = null;
		errorMessage = "";
		if (!id) return;
		try {
			const data = await fetchRun(id);
			if (!isStale()) run = data;
		} catch (error) {
			if (!isStale()) errorMessage = error instanceof Error ? error.message : "Could not load this run";
		}
	});

	// Shared formatter: a long run reads "6d 4h", not "8880m 0s".
	let duration = $derived.by(() => {
		if (!run?.startedAt) return null;
		const start = new Date(run.startedAt).getTime();
		const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
		return formatDuration(end - start);
	});

	let resultJson = $derived(run?.result ? JSON.stringify(run.result, null, 2) : null);

	// Name this run in the Command Deck breadcrumb strip by the agent that
	// produced it. The route param is a uuid, which reads as noise in chrome.
	$effect(() => setBreadcrumbTail(run?.agentName));
</script>

<div class="space-y-6">
	<div>
		<a href={`/project/${run?.projectId ?? store.activeProjectId ?? "global"}/chat`} class="text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]">&larr; Back to chat</a>
	</div>

	{#if run}
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
			<div class="mb-4 flex items-center gap-4">
				<StatusBadge status={run.status} />
				<h2 class="text-xl font-bold text-[var(--color-text-primary)]">{run.agentName}</h2>
				<span class="text-sm text-[var(--color-text-muted)]">{run.id}</span>
			</div>

			<div class="grid gap-4 text-sm sm:grid-cols-3">
				<div>
					<span class="text-[var(--color-text-muted)]">Started</span>
					<p class="text-[var(--color-text-primary)]">{new Date(run.startedAt).toLocaleString()}</p>
				</div>
				{#if run.finishedAt}
					<div>
						<span class="text-[var(--color-text-muted)]">Finished</span>
						<p class="text-[var(--color-text-primary)]">{new Date(run.finishedAt).toLocaleString()}</p>
					</div>
				{/if}
				{#if duration}
					<div>
						<span class="text-[var(--color-text-muted)]">Duration</span>
						<p class="text-[var(--color-text-primary)]">{duration}</p>
					</div>
				{/if}
			</div>
		</div>

		<section>
			<h3 class="mb-3 text-lg font-semibold text-[var(--color-text-primary)]">Logs</h3>
			<LogStream logs={run.logs} />
		</section>

		{#if resultJson}
			<section>
				<h3 class="mb-3 text-lg font-semibold text-[var(--color-text-primary)]">Result</h3>
				<pre class="overflow-x-auto rounded-lg bg-[var(--color-surface-secondary)] p-4 font-mono text-sm text-green-400">{resultJson}</pre>
			</section>
		{/if}
	{:else if errorMessage}
		<p role="alert" class="text-red-700 dark:text-red-400">Could not load run: {errorMessage}</p>
	{:else}
		<p class="text-[var(--color-text-muted)]">Loading run...</p>
	{/if}
</div>
