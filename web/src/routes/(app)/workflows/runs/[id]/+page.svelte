<script lang="ts">
	import { reloadOn } from "$lib/reload-on.svelte.js";
	import { page } from "$app/stores";
	import { runErrorText, runOutput, statusColor } from "$lib/workflow-run-display";
	import RunPayload from "$lib/components/workflows/RunPayload.svelte";
	import { setBreadcrumbTail } from "$lib/breadcrumb-tail.svelte.js";
	import {
		canRetryFrom,
		COST_UNAVAILABLE_HINT,
		costCellHint,
		dagRanks,
		formatCost,
		formatDuration,
		formatTokens,
		isLiveRun,
		pauseNote,
		statusLabel,
		timelineBars,
		type RunTrace,
	} from "$lib/workflow-trace-logic";

	let trace = $state<RunTrace | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	/** Step names whose detail panel is open. */
	let expanded = $state<Record<string, boolean>>({});
	/** Step names whose iteration table is open. */
	let iterationsOpen = $state<Record<string, boolean>>({});
	let retrying = $state<string | null>(null);
	let retryOutcome = $state<{ tone: "ok" | "error"; text: string } | null>(null);

	const runId = $derived($page.params.id ?? "");

	// Name this run in the Command Deck breadcrumb strip by its workflow. The
	// route param is a uuid, which reads as noise in chrome.
	$effect(() => setBreadcrumbTail(trace?.run.workflowName));

	async function load(id = runId, isStale = () => false) {
		loading = true;
		loadError = null;
		try {
			const res = await fetch(`/api/workflows/runs/${id}`);
			if (isStale()) return;
			if (!res.ok) {
				// 404 covers both "no such run" and "not yours", deliberately —
				// the API does not distinguish them and neither does this.
				loadError =
					res.status === 404
						? "That run does not exist, or you do not have access to it."
						: `Could not load this run (${res.status})`;
				return;
			}
			const next = (await res.json()) as RunTrace;
			if (!isStale()) trace = next;
		} catch (err) {
			if (!isStale()) loadError = err instanceof Error ? err.message : String(err);
		} finally {
			if (!isStale()) loading = false;
		}
	}

	// A step can link to another run; the page is reused, so start clean.
	reloadOn(() => runId, (id, isStale) => {
		trace = null;
		expanded = {};
		iterationsOpen = {};
		retryOutcome = null;
		return load(id, isStale);
	});

	/**
	 * Continue the run.
	 *
	 * "Retry from here" resumes the RUN, which re-enters it at its cursor —
	 * the platform has no per-step re-entry, and inventing one in the UI
	 * would either re-run completed steps (duplicate side effects) or claim
	 * a precision the executor does not have. The button is only offered on
	 * steps the resume would actually reach; see `canRetryFrom`.
	 */
	async function retryFrom(stepName: string) {
		retrying = stepName;
		retryOutcome = null;
		try {
			const res = await fetch(`/api/workflows/runs/${runId}/resume`, { method: "POST" });
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				retryOutcome = { tone: "error", text: body.error ?? `Could not continue (${res.status})` };
				return;
			}
			retryOutcome = { tone: "ok", text: `Resumed from "${stepName}".` };
			await load();
		} finally {
			retrying = null;
		}
	}

	const bars = $derived(trace ? timelineBars(trace) : []);
	const ranks = $derived(trace ? dagRanks(trace.steps) : []);
</script>

<svelte:head><title>Run trace{trace ? ` · ${trace.run.workflowName}` : ""}</title></svelte:head>

<div class="space-y-6" data-testid="run-trace">
	{#if loading}
		<p class="text-[var(--color-text-muted)]" data-testid="trace-loading">Loading run…</p>
	{:else if loadError}
		<div
			class="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300"
			data-testid="trace-error"
		>
			{loadError}
		</div>
	{:else if trace}
		<!-- ── Header ─────────────────────────────────────────────── -->
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div class="space-y-1">
				<a
					href="/workflows/{trace.run.workflowName}"
					class="text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
					data-testid="trace-workflow-link">← {trace.run.workflowName}</a
				>
				<h2 class="text-2xl font-bold text-[var(--color-text-primary)]">Run trace</h2>
				<p class="font-mono text-xs text-[var(--color-text-muted)]" data-testid="trace-run-id">
					{trace.run.id}
				</p>
			</div>
			<div class="text-right">
				<p class="text-lg font-semibold {statusColor(trace.run.status)}" data-testid="trace-status">
					{statusLabel(trace.run.status)}
				</p>
				{#if pauseNote(trace.run)}
					<p class="text-xs text-[var(--color-text-muted)]" data-testid="trace-suspended-reason">
						{pauseNote(trace.run)}
					</p>
				{/if}
				{#if isLiveRun(trace.run.status)}
					<button
						type="button"
						onclick={() => load()}
						class="mt-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-text-muted)]"
						data-testid="trace-refresh">Refresh</button
					>
				{/if}
			</div>
		</div>

		<!-- ── Totals ─────────────────────────────────────────────── -->
		<dl
			class="grid grid-cols-2 gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-4"
			data-testid="trace-totals"
		>
			<div>
				<dt class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Steps</dt>
				<dd class="text-lg font-semibold text-[var(--color-text-primary)]">{trace.totals.steps}</dd>
			</div>
			<div>
				<dt class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Input tokens</dt>
				<dd
					class="text-lg font-semibold text-[var(--color-text-primary)]"
					data-testid="trace-total-input"
				>
					{formatTokens(trace.totals.inputTokens)}
				</dd>
			</div>
			<div>
				<dt class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Output tokens</dt>
				<dd
					class="text-lg font-semibold text-[var(--color-text-primary)]"
					data-testid="trace-total-output"
				>
					{formatTokens(trace.totals.outputTokens)}
				</dd>
			</div>
			<div>
				<dt class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Duration</dt>
				<dd
					class="text-lg font-semibold text-[var(--color-text-primary)]"
					data-testid="trace-total-duration"
				>
					{formatDuration(trace.totals.durationMs)}
				</dd>
			</div>
		</dl>

		<!-- ── Result ─────────────────────────────────────────────────
		     What the run PRODUCED, which this page fetched and then dropped
		     for its whole existence: `run.result` was in the payload and in
		     the type, and nothing rendered it. It goes above the graph
		     because it is the reason most people open a finished run — the
		     DAG and the timeline answer "how", and they are still one scroll
		     away.

		     Shown for every status, not just success. A failed run's message
		     is the most actionable string on the page, and a parked run
		     records the last successful result on purpose (the handoff
		     payload a human needs to act on), so gating this on `success`
		     would hide it from exactly the runs that need it. -->
		<section
			class="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
			data-testid="trace-result"
		>
			<h3 class="text-sm font-semibold text-[var(--color-text-secondary)]">Result</h3>
			{#if runErrorText(trace.run)}
				<p class="text-sm {statusColor(trace.run.status)}" data-testid="trace-error-text">
					{runErrorText(trace.run)}
				</p>
			{/if}
			<RunPayload label="Output" value={runOutput(trace.run.result)} testId="trace-output" />
		</section>

		<!-- ── DAG ────────────────────────────────────────────────── -->
		<section class="space-y-2" data-testid="trace-dag">
			<h3 class="text-sm font-semibold text-[var(--color-text-secondary)]">Graph</h3>
			<div class="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
				{#each ranks as rank, i (i)}
					{#if i > 0}
						<span aria-hidden="true" class="text-[var(--color-text-muted)]">→</span>
					{/if}
					<!-- Steps that started at the same instant ran concurrently,
					     so they stack rather than chaining. -->
					<div class="flex flex-col gap-1">
						{#each rank as step (step.stepName)}
							<span
								class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs {statusColor(
									step.status,
								)}"
								data-testid="dag-node">{step.stepName}</span
							>
						{/each}
					</div>
				{/each}
			</div>
		</section>

		<!-- ── Timeline ───────────────────────────────────────────── -->
		<section class="space-y-2" data-testid="trace-timeline">
			<h3 class="text-sm font-semibold text-[var(--color-text-secondary)]">Timeline</h3>
			<div class="space-y-1">
				{#each bars as bar (bar.stepName)}
					<div class="flex items-center gap-3">
						<span
							class="w-40 shrink-0 truncate font-mono text-xs text-[var(--color-text-muted)]"
							title={bar.stepName}>{bar.stepName}</span
						>
						<div class="h-3 flex-1 rounded-sm bg-[var(--color-bg)]">
							<div
								class="h-3 rounded-sm bg-current {statusColor(bar.status)}"
								style="margin-left: {bar.offsetPct}%; width: {bar.widthPct}%"
								data-testid="timeline-bar"
							></div>
						</div>
					</div>
				{/each}
			</div>
		</section>

		{#if retryOutcome}
			<p
				class="text-sm {retryOutcome.tone === 'ok' ? 'text-green-400' : 'text-red-400'}"
				data-testid="retry-outcome"
			>
				{retryOutcome.text}
			</p>
		{/if}

		<!-- ── Steps ──────────────────────────────────────────────── -->
		<section class="space-y-2">
			<h3 class="text-sm font-semibold text-[var(--color-text-secondary)]">Steps</h3>
			<div class="overflow-x-auto rounded-lg border border-[var(--color-border)]">
				<table class="w-full text-left text-sm">
					<thead class="bg-[var(--color-surface)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
						<tr>
							<th class="px-3 py-2">Step</th>
							<th class="px-3 py-2">Status</th>
							<th class="px-3 py-2">Model</th>
							<th class="px-3 py-2 text-right">In</th>
							<th class="px-3 py-2 text-right">Out</th>
							<th class="px-3 py-2 text-right" title={COST_UNAVAILABLE_HINT}>Cost</th>
							<th class="px-3 py-2 text-right">Duration</th>
							<th class="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody>
						{#each trace.steps as step (step.stepName)}
							<tr class="border-t border-[var(--color-border)]" data-testid="step-row">
								<td class="px-3 py-2 font-mono text-xs" data-testid="step-name">{step.stepName}</td>
								<td class="px-3 py-2 {statusColor(step.status)}" data-testid="step-status">
									{statusLabel(step.status)}
									{#if step.errorCode}
										<span class="block text-xs text-[var(--color-text-muted)]" data-testid="step-error-code"
											>{step.errorCode}</span
										>
									{/if}
									{#if step.skippedReason}
										<span class="block text-xs text-[var(--color-text-muted)]" data-testid="step-skipped"
											>skipped: {step.skippedReason}</span
										>
									{/if}
								</td>
								<td class="px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]" data-testid="step-model">
									{step.model ?? "—"}
								</td>
								<td class="px-3 py-2 text-right tabular-nums" data-testid="step-input-tokens"
									>{formatTokens(step.inputTokens)}</td
								>
								<td class="px-3 py-2 text-right tabular-nums" data-testid="step-output-tokens"
									>{formatTokens(step.outputTokens)}</td
								>
								<!-- Muted + hinted only when the cell is the dash: a real
								     measured cost is data and must not read as absent. -->
								<td
									class="px-3 py-2 text-right tabular-nums {costCellHint(step.costUsd)
										? 'text-[var(--color-text-muted)]'
										: ''}"
									title={costCellHint(step.costUsd)}
									data-testid="step-cost">{formatCost(step.costUsd)}</td
								>
								<td class="px-3 py-2 text-right tabular-nums" data-testid="step-duration"
									>{formatDuration(step.durationMs)}</td
								>
								<td class="px-3 py-2 text-right">
									<button
										type="button"
										onclick={() =>
											(expanded = { ...expanded, [step.stepName]: !expanded[step.stepName] })}
										class="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline"
										data-testid="step-toggle">{expanded[step.stepName] ? "Hide" : "Details"}</button
									>
								</td>
							</tr>
							{#if expanded[step.stepName]}
								<tr class="border-t border-[var(--color-border)] bg-[var(--color-bg)]">
									<td colspan="8" class="space-y-3 px-3 py-3" data-testid="step-detail">
										{#if step.runId}
											<a
												href="/runs/{step.runId}"
												class="inline-block text-xs text-[var(--color-accent)] underline-offset-2 hover:underline"
												data-testid="step-transcript-link">View agent transcript →</a
											>
										{/if}

										<RunPayload
											label="Resolved input"
											value={step.resolvedInput}
											testId="step-resolved-input"
										/>
										<RunPayload label="Output" value={step.output} testId="step-output" />

										{#if step.iterationRows.length > 0}
											<div>
												<button
													type="button"
													onclick={() =>
														(iterationsOpen = {
															...iterationsOpen,
															[step.stepName]: !iterationsOpen[step.stepName],
														})}
													class="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline"
													data-testid="iterations-toggle"
												>
													{iterationsOpen[step.stepName] ? "Hide" : "Show"}
													{step.iterationRows.length} loop iterations
												</button>
												{#if iterationsOpen[step.stepName]}
													<table class="mt-2 w-full text-left text-xs" data-testid="iterations-table">
														<thead class="text-[var(--color-text-muted)]">
															<tr>
																<th class="py-1 pr-3">#</th>
																<th class="py-1 pr-3">Status</th>
																<th class="py-1 pr-3">Model</th>
																<th class="py-1 pr-3 text-right">In</th>
																<th class="py-1 pr-3 text-right">Out</th>
																<th class="py-1 text-right">Duration</th>
															</tr>
														</thead>
														<tbody>
															{#each step.iterationRows as it (`${it.iteration}-${it.attempt}`)}
																<tr data-testid="iteration-row">
																	<td class="py-1 pr-3 tabular-nums">{it.iteration}</td>
																	<td class="py-1 pr-3 {statusColor(it.status)}"
																		>{statusLabel(it.status)}</td
																	>
																	<td class="py-1 pr-3 font-mono" data-testid="iteration-model"
																		>{it.model ?? "—"}</td
																	>
																	<td class="py-1 pr-3 text-right tabular-nums"
																		>{formatTokens(it.inputTokens)}</td
																	>
																	<td class="py-1 pr-3 text-right tabular-nums"
																		>{formatTokens(it.outputTokens)}</td
																	>
																	<td class="py-1 text-right tabular-nums"
																		>{formatDuration(it.durationMs)}</td
																	>
																</tr>
															{/each}
														</tbody>
													</table>
												{/if}
											</div>
										{/if}

										{#if canRetryFrom(trace.run, step)}
											<button
												type="button"
												disabled={retrying !== null}
												onclick={() => retryFrom(step.stepName)}
												class="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-text-muted)] disabled:opacity-50"
												data-testid="step-retry"
												>{retrying === step.stepName ? "Continuing…" : "Retry from here"}</button
											>
										{/if}
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>
