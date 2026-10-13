<script lang="ts">
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { reloadOn } from "$lib/reload-on.svelte.js";
	import { store, refreshWorkflows } from "$lib/stores.svelte.js";
	import {
		dryRunWorkflow,
		fetchWorkflow,
		fetchWorkflowVersions,
		updateWorkflow,
		type Workflow,
		type WorkflowDryRunReport,
		type WorkflowVersionSummary,
	} from "$lib/api.js";
	import { inputClass } from "$lib/styles.js";
	import WorkflowBuilder from "$lib/components/WorkflowBuilder.svelte";
	import {
		definitionFields,
		parseWorkflowYaml,
		workflowToYaml,
	} from "$lib/workflow-yaml.js";
	import { workflowProvenanceBadge } from "$lib/workflow-provenance.js";

	// `?? ""` because SvelteKit types every route param as `string |
	// undefined`, and the four call sites below all take a `string`. The
	// param is always present on this route — the fallback is a type-level
	// statement, not a behaviour. Same idiom as the sibling routes
	// (`commands/[name]`, `workflows/runs/[id]`).
	let workflowName = $derived(page.params.name ?? "");

	let workflow = $state<Workflow | null>(null);
	// Provenance, not the raw tier. `system` collapses three different
	// rows — an install-shipped file, an ownerless legacy row, and one a
	// member here created and still owns — and rendering the tier
	// verbatim told every reader the first thing about all three. The
	// wording and the colour live in `workflow-provenance.ts`; the markup
	// below only paints them. `?? {}` keeps this total while the fetch is
	// in flight; the badge is only rendered once `workflow` is loaded.
	let provenance = $derived(workflowProvenanceBadge(workflow ?? {}));
	let versions = $state<WorkflowVersionSummary[]>([]);
	let loading = $state(true);
	let loadError = $state("");

	let tab = $state<"form" | "yaml">(page.url.searchParams.get("tab") === "yaml" ? "yaml" : "form");
	let yamlText = $state("");
	let saving = $state(false);
	let saveError = $state("");
	let savedMsg = $state("");

	let dryRunning = $state(false);
	let dryRunInput = $state("{}");
	let dryRunReport = $state<WorkflowDryRunReport | null>(null);
	let dryRunError = $state("");

	// Save follows a rename with `goto`, which reuses this page: load the
	// renamed workflow, or the page keeps the old definition and its old
	// name, and the next Save renames it back.
	reloadOn(() => workflowName, (name, isStale) => {
		workflow = null;
		versions = [];
		return load(name, isStale);
	});

	async function load(name = workflowName, isStale = () => false) {
		loading = true;
		loadError = "";
		try {
			const loaded = await fetchWorkflow(name);
			if (isStale()) return;
			workflow = loaded;
			yamlText = workflowToYaml(definitionFields(loaded as unknown as Record<string, unknown>));
			const loadedVersions = await fetchWorkflowVersions(name);
			if (!isStale()) versions = loadedVersions;
		} catch (e) {
			if (!isStale()) loadError = e instanceof Error ? e.message : "Failed to load workflow";
		} finally {
			if (!isStale()) loading = false;
		}
	}

	/** The definition currently on screen, from whichever tab is active.
	 *  One reader so Save and Dry run can never disagree about what the
	 *  user is looking at. */
	function currentDefinition(): Record<string, unknown> | { error: string } {
		if (tab === "yaml") {
			const parsed = parseWorkflowYaml(yamlText);
			return parsed.ok ? parsed.value : { error: parsed.error };
		}
		// The form tab submits through WorkflowBuilder's own onsubmit, so
		// there is nothing to read here — Save is driven by the builder.
		return definitionFields((workflow ?? {}) as unknown as Record<string, unknown>);
	}

	async function save(data: Record<string, unknown>) {
		saving = true;
		saveError = "";
		savedMsg = "";
		try {
			const updated = await updateWorkflow(workflowName, data);
			savedMsg = "Saved";
			refreshWorkflows();
			// A rename changes the route, so follow it rather than leaving
			// the page pointed at a name that no longer resolves.
			const newName = (updated as { name?: string }).name;
			if (newName && newName !== workflowName) {
				await goto(`/workflows/${encodeURIComponent(newName)}/edit`);
				return;
			}
			await load();
		} catch (e) {
			saveError = e instanceof Error ? e.message : "Failed to save workflow";
		} finally {
			saving = false;
		}
	}

	function saveYaml() {
		const current = currentDefinition();
		if ("error" in current && typeof current.error === "string") {
			saveError = current.error;
			return;
		}
		void save(current as Record<string, unknown>);
	}

	async function runDry() {
		dryRunning = true;
		dryRunError = "";
		dryRunReport = null;
		try {
			let input: Record<string, unknown>;
			try {
				input = JSON.parse(dryRunInput || "{}") as Record<string, unknown>;
			} catch {
				dryRunError = "Input is not valid JSON";
				return;
			}
			const body: Parameters<typeof dryRunWorkflow>[1] = { input };
			// Dry-run what is ON SCREEN, not what is saved — the edit-check-edit
			// loop is the whole point of the feature.
			if (tab === "yaml") {
				const parsed = parseWorkflowYaml(yamlText);
				if (!parsed.ok) {
					dryRunError = parsed.error;
					return;
				}
				body.definition = parsed.value;
			}
			if (store.activeProjectId) body.projectId = store.activeProjectId;
			dryRunReport = await dryRunWorkflow(workflowName, body);
		} catch (e) {
			dryRunError = e instanceof Error ? e.message : "Dry run failed";
		} finally {
			dryRunning = false;
		}
	}

	/** Green ONLY for an unqualified pass. `unverified` means the run
	 *  completed while at least one gate was evaluated against stub data and
	 *  NOT enforced — painting that the same green as a real pass is the
	 *  false confidence the report's own status exists to prevent. */
	const dryRunStatusClass = (status: string) =>
		status === "success"
			? "text-green-400"
			: status === "unverified"
				? "text-amber-300"
				: "text-red-400";

	/** The amber cue belongs on every row whose value is fabricated — the
	 *  stubbed step AND the gate that decided on its output. */
	const dryRunModeClass = (mode: string) =>
		mode === "evaluated" ? "text-teal-300" : "text-amber-400";

	const tabClass = (active: boolean) =>
		`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
			active
				? "bg-[var(--color-surface-tertiary)] text-[var(--color-text-primary)]"
				: "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
		}`;
</script>

<div class="space-y-6" data-testid="workflow-editor">
	<div>
		<a
			href="/workflows/{workflowName}"
			class="text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
			>&larr; {workflowName}</a
		>
	</div>

	{#if loading}
		<p class="text-[var(--color-text-muted)]">Loading…</p>
	{:else if loadError}
		<p class="text-sm text-red-400" data-testid="editor-load-error">{loadError}</p>
	{:else if workflow}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h2 class="text-2xl font-bold text-[var(--color-text-primary)]">Edit {workflow.name}</h2>
				<div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
					<span
						class="rounded px-1.5 py-0.5 uppercase tracking-wide {provenance.className}"
						title={provenance.title}
						data-testid="workflow-visibility">{provenance.label}</span
					>
					{#if versions.length > 0}
						<span data-testid="workflow-version">v{versions[versions.length - 1].version}</span>
					{/if}
					{#if workflow.forkedFrom}
						<!-- "copied from", not "forked from": the platform has ONE copy
						     verb and it is called Duplicate. The COLUMN is still
						     `forked_from` — renaming a stored snapshot to match a
						     label is churn with a migration attached — so the wording
						     is the only thing that moved. -->
						<span data-testid="workflow-forked-from">copied from {workflow.forkedFrom}</span>
					{/if}
				</div>
			</div>
			<div class="flex gap-1" role="tablist">
				<button type="button" role="tab" aria-selected={tab === "form"} class={tabClass(tab === "form")} onclick={() => (tab = "form")} data-testid="tab-form">Form</button>
				<button type="button" role="tab" aria-selected={tab === "yaml"} class={tabClass(tab === "yaml")} onclick={() => (tab = "yaml")} data-testid="tab-yaml">YAML</button>
			</div>
		</div>

		{#if workflow.canEdit === false}
			<!-- The ladder's answer, rendered rather than re-derived: a
			     system-owned workflow is admin-only to edit, which is every row
			     that existed before ownership shipped. -->
			<p
				class="rounded-md border border-[var(--color-warning,#f59e0b)]/50 bg-[var(--color-warning,#f59e0b)]/10 p-3 text-sm text-[var(--color-text-secondary)]"
				data-testid="editor-readonly"
			>
				You can view this workflow but not change it. It is
				<strong>{workflow.visibility ?? "system"}</strong>-owned — duplicate it to get an editable
				copy of your own.
			</p>
		{/if}

		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
			{#if tab === "form"}
				<WorkflowBuilder
					initial={definitionFields(workflow as unknown as Record<string, unknown>)}
					agents={store.agents}
					onsubmit={save}
					onopenyaml={() => (tab = "yaml")}
					submitting={saving}
					submitLabel="Save changes"
				/>
			{:else}
				<label for="wf-yaml" class="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]"
					>Definition (YAML)</label
				>
				<textarea
					id="wf-yaml"
					bind:value={yamlText}
					rows="20"
					data-testid="yaml-editor"
					class="{inputClass} font-mono"
				></textarea>
				<button
					type="button"
					onclick={saveYaml}
					disabled={saving}
					data-testid="save-yaml"
					class="mt-3 rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
					style="min-height: 44px;"
				>
					{saving ? "Saving…" : "Save changes"}
				</button>
			{/if}

			{#if saveError}
				<p class="mt-3 text-sm text-red-400" data-testid="editor-save-error">{saveError}</p>
			{/if}
			{#if savedMsg}
				<p class="mt-3 text-sm text-green-400" data-testid="editor-saved">{savedMsg}</p>
			{/if}
		</div>

		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
			<h3 class="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">Dry run</h3>
			<p class="mb-3 text-xs text-[var(--color-text-muted)]">
				Runs the transform and gate steps for real and stands a stub in for every agent, tool and
				approval step — no LLM, no side effects, no run recorded. A gate whose operands come from a
				stub is evaluated but <strong>not enforced</strong>: the verdict is reported, the run
				carries on, and the result is <strong>unverified</strong> rather than a pass — a gate over
				data nobody produced proves nothing either way.
			</p>
			<label class="mb-1 block text-sm text-[var(--color-text-secondary)]" for="dry-run-input"
				>JSON input</label
			>
			<textarea
				id="dry-run-input"
				bind:value={dryRunInput}
				rows="3"
				data-testid="dry-run-input"
				class="{inputClass} mb-3 font-mono"
			></textarea>
			<button
				type="button"
				onclick={runDry}
				disabled={dryRunning}
				data-testid="dry-run-button"
				class="rounded-md bg-[var(--color-surface-tertiary)] px-4 py-3 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:opacity-90 disabled:opacity-50"
				style="min-height: 44px;"
			>
				{dryRunning ? "Simulating…" : "Dry run"}
			</button>

			{#if dryRunError}
				<p class="mt-3 text-sm text-red-400" data-testid="dry-run-error">{dryRunError}</p>
			{/if}

			{#if dryRunReport}
				<div class="mt-4 space-y-2" data-testid="dry-run-report">
					<div class="flex items-center gap-2 text-sm">
						<span class="text-[var(--color-text-secondary)]">Result:</span>
						<span
							class="rounded bg-[var(--color-surface-tertiary)] px-2 py-0.5 text-xs {dryRunStatusClass(
								dryRunReport.status,
							)}"
							data-testid="dry-run-status">{dryRunReport.status}</span
						>
					</div>
					{#if dryRunReport.error}
						<p class="text-xs text-red-400" data-testid="dry-run-report-error">{dryRunReport.error}</p>
					{/if}
					{#if dryRunReport.gatesOnStubs.length > 0}
						<div
							class="rounded-md border border-[var(--color-warning,#f59e0b)]/50 bg-[var(--color-warning,#f59e0b)]/10 p-3 text-xs text-[var(--color-text-secondary)]"
							data-testid="dry-run-unenforced-gates"
						>
							<p class="font-semibold text-[var(--color-text-primary)]">
								{dryRunReport.gatesOnStubs.length} gate{dryRunReport.gatesOnStubs.length === 1
									? ""
									: "s"} ran against stub data and {dryRunReport.gatesOnStubs.length === 1
									? "was"
									: "were"} not enforced.
							</p>
							<ul class="mt-1 space-y-1">
								{#each dryRunReport.gatesOnStubs as gate (gate.name)}
									<li>
										<strong>{gate.name}</strong> would have {gate.passed ? "passed" : "failed"}:
										{gate.reason}
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					<div class="space-y-1">
						{#each dryRunReport.steps as step}
							<div class="flex flex-wrap items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs">
								<span class="font-medium text-[var(--color-text-primary)]">{step.name}</span>
								<span class="rounded bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 uppercase tracking-wide text-[var(--color-text-muted)]">{step.kind}</span>
								<span class={dryRunModeClass(step.mode)} data-testid="dry-run-mode">{step.mode}</span>
								<span class="text-[var(--color-text-secondary)]">{step.status}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		{#if versions.length > 0}
			<section data-testid="version-history">
				<h3 class="mb-3 text-lg font-semibold text-[var(--color-text-primary)]">Version history</h3>
				<div class="space-y-2">
					{#each [...versions].reverse() as version (version.id)}
						<div class="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3 text-sm">
							<span class="font-medium text-[var(--color-text-primary)]">v{version.version}</span>
							<span class="text-[var(--color-text-secondary)]">{version.name}</span>
							<span class="text-xs text-[var(--color-text-muted)]">{version.stepCount} step{version.stepCount === 1 ? "" : "s"}</span>
							<span class="text-xs text-[var(--color-text-muted)]">{version.stepsHash.slice(0, 8)}</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>
