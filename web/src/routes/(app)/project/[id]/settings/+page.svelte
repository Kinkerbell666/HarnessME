<script lang="ts">
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { store, refreshProjects, setActiveProjectId } from "$lib/stores.svelte.js";
	import { updateProject, deleteProject as apiDeleteProject, fetchSettings, upsertSetting } from "$lib/api.js";
	import { isIconUrl } from "$lib/project-icon.js";
	import ProjectForm from "$lib/components/ProjectForm.svelte";
	import InfoTooltip from "$lib/components/InfoTooltip.svelte";
	import FeatureIndex from "$lib/components/FeatureIndex.svelte";
	import ComposerSuggestSection from "$lib/components/settings/ComposerSuggestSection.svelte";
	import SaveIndicator from "$lib/components/settings/SaveIndicator.svelte";
	import ProjectSandboxPanel from "$lib/components/ProjectSandboxPanel.svelte";
	import { createSaveFlash } from "$lib/save-flash.svelte.js";
	import { resolveWorkspaceBinding, type WorkspaceKind } from "$lib/workspace-binding";
	import { canDeleteProject } from "$lib/admin-guard.js";

	let globalPrompt = $state("");
	let projectPrompt = $state("");
	let projectSuggestEnabled = $state(true);
	const globalPromptFlash = createSaveFlash();
	const projectPromptFlash = createSaveFlash();
	const projectUpdateFlash = createSaveFlash();

	// ── GitHub Projects integration summary ────────────────────────────────
	// One-line connected/paused status for the Integrations section. The full
	// connect/disconnect UI lives at the per-project integrations sub-route;
	// here we only show a discoverable link + a status summary. A 404 (no link)
	// is the expected "Not connected" case, not an error.
	// A project can connect to MANY boards; we summarise them here (the full
	// per-board UI lives at the integrations sub-route).
	let ghLinks = $state<{ boardTitle: string; enabled: boolean }[]>([]);
	let ghLinkLoaded = $state(false);

	async function loadGithubProjectsLink() {
		if (!projectId) return;
		ghLinkLoaded = false;
		try {
			const res = await fetch(
				`/api/integrations/github-projects/link?projectId=${encodeURIComponent(projectId)}`,
			);
			if (res.ok) {
				const data = (await res.json()) as { links: { boardTitle: string; enabled: boolean }[] };
				ghLinks = data.links ?? [];
			} else {
				ghLinks = []; // 404 / error → "Not connected"
			}
		} catch {
			ghLinks = [];
		} finally {
			ghLinkLoaded = true;
		}
	}

	async function loadInstructions() {
		try {
			const settings = await fetchSettings();
			globalPrompt = (settings["global:systemPrompt"] as string) ?? "";
			if (projectId) {
				projectPrompt = (settings[`project:${projectId}:systemPrompt`] as string) ?? "";
				// Default ON — mirrors isSuggestEnabledForProject's server read.
				projectSuggestEnabled = settings[`project:${projectId}:suggest:enabled`] !== false;
			}
		} catch {
			// silent
		}
	}

	$effect(() => {
		if (projectId) {
			loadInstructions();
		}
		if (projectId && workspaceKind === "local") {
			loadGithubProjectsLink();
		}
	});

	async function saveGlobalPrompt() {
		await globalPromptFlash.run(() => upsertSetting("global:systemPrompt", globalPrompt));
	}

	async function saveProjectPrompt() {
		if (!projectId) return;
		await projectPromptFlash.run(() => upsertSetting(`project:${projectId}:systemPrompt`, projectPrompt));
	}

	$effect(() => {
		setActiveProjectId(page.params.id ?? null);
	});

	let projectId = $derived(page.params.id);
	let project = $derived(store.projects.find((p) => p.id === projectId));
	let workspaceKind = $state<WorkspaceKind | "loading">("loading");
	let workspaceError = $state("");
	let workspaceRequest = 0;
	let sandbox = $derived(workspaceKind === "sandbox");
	let workspaceResolved = $derived(workspaceKind === "local" || workspaceKind === "sandbox");

	async function loadWorkspaceKind(id: string, path: string) {
		const request = ++workspaceRequest;
		workspaceError = "";
		workspaceKind = "loading";
		const resolution = await resolveWorkspaceBinding(id, path);
		if (request !== workspaceRequest) return;
		workspaceKind = resolution.kind;
		workspaceError = resolution.error ?? "";
	}

	$effect(() => {
		if (projectId && project) void loadWorkspaceKind(projectId, project.path);
	});

	// Delete needs the project owner role or an instance admin; hide it otherwise.
	let canDelete = $state(false);
	$effect(() => {
		const id = projectId;
		canDelete = false;
		if (!id) return;
		void canDeleteProject(id).then((allowed) => {
			if (id === projectId) canDelete = allowed;
		});
	});

	async function handleUpdate(data: { name: string; path: string; icon?: string | null; variables: Record<string, unknown> }) {
		if (!projectId) return;
		const updated = await projectUpdateFlash.run(() => updateProject(projectId, data));
		if (updated) refreshProjects();
	}

	async function handleDelete() {
		if (!projectId || !confirm("Delete this project? Existing runs will keep their data.")) return;
		await apiDeleteProject(projectId);
		refreshProjects();
		setActiveProjectId(null);
		goto("/");
	}
</script>

<div class="space-y-6">
	{#if project}
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
			<div class="mb-4 flex items-center justify-between">
				<div class="flex items-center gap-3">
					{#if isIconUrl(project.icon)}
						<img src={project.icon} alt={project.name} class="h-10 w-10 rounded-xl object-cover" />
					{/if}
					<h2 class="text-2xl font-bold text-[var(--color-text-primary)]">{project.name}</h2>
				</div>
				{#if workspaceResolved && !sandbox && canDelete}
					<button
						onclick={handleDelete}
						class="rounded-md px-3 py-1.5 text-sm text-red-400 hover:bg-[var(--color-surface-tertiary)] hover:text-red-300"
					>
						Delete
					</button>
				{/if}
			</div>
			{#if workspaceResolved && !sandbox}
				<ProjectForm {project} onsubmit={handleUpdate} submitting={projectUpdateFlash.saving} />
				<div class="mt-2"><SaveIndicator saved={projectUpdateFlash.saved} error={projectUpdateFlash.error} /></div>
			{/if}
		</div>
		{#if workspaceKind === "unavailable"}
			<p class="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300" role="alert">{workspaceError}</p>
		{:else if workspaceResolved}
			<ProjectSandboxPanel projectId={project.id} {sandbox} />
		{/if}
		{#if workspaceResolved && !sandbox}
			<!-- Feature Index -->
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
				<p class="mb-3 text-xs text-[var(--color-text-secondary)]">
					Buckets of related files. Mention them in chat with <code>$[feature:name]</code> — the assistant
					gets a system note listing the feature's files. Run <strong>Scan features</strong> to auto-populate
					from this project's source roots; user-pinned files survive every rescan.
				</p>
				<FeatureIndex projectId={project.id} />
			</div>

			<!-- Integrations -->
			<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6" data-testid="project-settings-integrations">
			<h3 class="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">Integrations</h3>
			<p class="mb-3 text-xs text-[var(--color-text-secondary)]">
				Connect this project to external services. Moving a card on a connected GitHub Projects
				board can propose (or auto-spawn) an AI agent run.
			</p>
			<div class="flex flex-col items-start gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
				<div class="min-w-0">
					<p class="text-sm font-medium text-[var(--color-text-primary)]">GitHub Projects</p>
					<p class="text-xs text-[var(--color-text-muted)]" data-testid="project-settings-gh-status">
						{#if !ghLinkLoaded}
							Checking…
						{:else if ghLinks.length === 1}
							Connected: {ghLinks[0].boardTitle}{ghLinks[0].enabled ? "" : " (paused)"}
						{:else if ghLinks.length > 1}
							Connected: {ghLinks.length} boards
						{:else}
							Not connected
						{/if}
					</p>
				</div>
				<a
					href={`/project/${projectId}/integrations/github-projects`}
					data-testid="project-settings-gh-link"
					class="w-full rounded-md border border-[var(--color-border)] px-3 py-1.5 text-center text-sm text-[var(--color-accent)] hover:bg-[var(--color-surface-tertiary)] sm:w-auto sm:shrink-0"
				>
					Connect a GitHub Projects board →
				</a>
			</div>
			</div>
		{/if}

		<!-- Composer suggestions (per-project toggle; global override lives
		     under Settings → Personalization) -->
		{#if projectId}
			<ComposerSuggestSection {projectId} bind:suggestEnabled={projectSuggestEnabled} />
		{/if}

		<!-- Project Custom Instructions -->
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
			<h3 class="mb-1 text-lg font-semibold text-[var(--color-text-primary)] flex items-center gap-2">Project Custom Instructions <InfoTooltip text="A system prompt applied to every conversation within this project. Overrides global custom instructions. Can itself be overridden by conversation-level instructions set on individual chats. Priority: conversation > project > global." /></h3>
			<p class="mb-3 text-xs text-[var(--color-text-secondary)]">System prompt applied to all conversations in this project. Overrides global instructions.</p>
			<textarea
				bind:value={projectPrompt}
				rows={4}
				class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none resize-y"
				placeholder="e.g. You are a coding assistant for this project..."
			></textarea>
			<div class="mt-2 flex items-center gap-3">
				<button
					onclick={saveProjectPrompt}
					disabled={projectPromptFlash.saving}
					class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
				>
					{projectPromptFlash.saving ? "Saving..." : "Save Project Instructions"}
				</button>
				<SaveIndicator saved={projectPromptFlash.saved} error={projectPromptFlash.error} />
			</div>
		</div>

		<!-- Global Custom Instructions -->
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
			<h3 class="mb-1 text-lg font-semibold text-[var(--color-text-primary)] flex items-center gap-2">Global Custom Instructions <InfoTooltip text="A system prompt prepended to every conversation across all projects. This is the lowest priority instruction level. Overridden by project-level instructions, which are in turn overridden by conversation-level instructions." /></h3>
			<p class="mb-3 text-xs text-[var(--color-text-secondary)]">Default system prompt for all conversations across all projects. Lowest priority.</p>
			<textarea
				bind:value={globalPrompt}
				rows={4}
				class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none resize-y"
				placeholder="e.g. You are a helpful AI assistant..."
			></textarea>
			<div class="mt-2 flex items-center gap-3">
				<button
					onclick={saveGlobalPrompt}
					disabled={globalPromptFlash.saving}
					class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
				>
					{globalPromptFlash.saving ? "Saving..." : "Save Global Instructions"}
				</button>
				<SaveIndicator saved={globalPromptFlash.saved} error={globalPromptFlash.error} />
			</div>
		</div>
	{:else}
		<p class="text-[var(--color-text-muted)]">Project not found.</p>
	{/if}
</div>
