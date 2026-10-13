<script lang="ts">
	import { goto } from "$app/navigation";
	import { store, setActiveProjectId } from "$lib/stores.svelte.js";
	import { unreadStore, formatBadgeCount } from "$lib/unread.js";
	import { isIconUrl } from "$lib/project-icon.js";
	import EzButton from "$lib/components/ez/EzButton.svelte";

	// Reactive unread tracking — bump revision on store changes so per-project
	// counts re-evaluate without us having to mirror the whole map into state.
	let unreadRev = $state(0);
	$effect(() => unreadStore.subscribe(() => { unreadRev++; }));

	function unreadFor(projectId: string): number {
		void unreadRev;
		return unreadStore.getUnreadCountByProject(projectId);
	}

	function homeUnread(): number {
		void unreadRev;
		return unreadStore.getUnreadCountByProject("global");
	}

	const BG_COLORS = [
		"bg-blue-600",
		"bg-green-600",
		"bg-purple-600",
		"bg-orange-600",
		"bg-pink-600",
		"bg-teal-600",
		"bg-indigo-600",
		"bg-red-600",
	];

	function hashColor(name: string): string {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = (hash * 31 + name.charCodeAt(i)) | 0;
		}
		return BG_COLORS[Math.abs(hash) % BG_COLORS.length]!;
	}

	let hoveredId = $state<string | null>(null);
	// Button rect for the currently hovered project — used to position the
	// tooltip with `position: fixed`, which escapes the `overflow-y-auto`
	// clipping on the scrollable project list container.
	let hoveredRect = $state<{ left: number; top: number; height: number } | null>(null);

	function selectProject(id: string) {
		setActiveProjectId(id);
		goto(`/project/${id}/chat`);
	}

	function onProjectEnter(id: string, e: MouseEvent) {
		hoveredId = id;
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		hoveredRect = { left: r.right, top: r.top, height: r.height };
	}

	function onProjectLeave() {
		hoveredId = null;
		hoveredRect = null;
	}
</script>

<div class="sticky top-0 self-start flex h-[100dvh] max-h-[100dvh] w-[60px] shrink-0 flex-col items-center border-r border-[var(--color-border)] bg-[var(--color-surface-secondary)] py-2.5">
	<!-- Home button -->
	<button
		class="group relative mb-1.5 flex cursor-pointer items-center"
		onclick={() => selectProject("global")}
		onmouseenter={() => (hoveredId = "__home__")}
		onmouseleave={() => (hoveredId = null)}
		aria-label="Home"
	>
		<!-- Active/hover marker -->
		<div
			class="absolute left-0 w-0.5 rounded-r-sm bg-[var(--color-accent)] transition-all duration-150 {store.activeProjectId === 'global'
				? 'h-8'
				: hoveredId === '__home__'
					? 'h-4'
					: 'h-0'}"
			style="top: 50%; transform: translateY(-50%);"
		></div>

		<div class="relative ml-2.5">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-md transition-all duration-150
					{store.activeProjectId === 'global'
					? 'bg-blue-600 text-white ring-1 ring-[var(--color-accent)]'
					: 'bg-[var(--color-surface-tertiary)] group-hover:bg-blue-600 group-hover:text-white'}"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
				</svg>
			</div>
			{#if homeUnread() > 0}
				<span
					data-testid="project-unread-badge-home"
					class="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-sm bg-red-500 px-1 font-mono text-[10px] font-bold leading-none text-white ring-2 ring-[var(--color-surface-secondary)]"
				>{formatBadgeCount(homeUnread())}</span>
			{/if}
		</div>

		<!-- Tooltip -->
		{#if hoveredId === "__home__"}
			<div class="absolute left-[60px] z-50 whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] shadow-lg">
				Home
			</div>
		{/if}
	</button>

	<!-- Divider -->
	<div class="mx-auto mb-1.5 h-px w-7 bg-[var(--color-border)]"></div>

	<!-- Project icons -->
	<div class="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto scrollbar-hide">
		{#each store.projects.filter(p => p.id !== "global") as project (project.id)}
			{@const isActive = store.activeProjectId === project.id}
			<button
				class="group relative flex cursor-pointer items-center"
				onclick={() => selectProject(project.id)}
				onmouseenter={(e) => onProjectEnter(project.id, e)}
				onmouseleave={onProjectLeave}
				aria-label={project.name}
			>
				<!-- Active/hover marker -->
				<div
					class="absolute left-0 w-0.5 rounded-r-sm bg-[var(--color-accent)] transition-all duration-150 {isActive
						? 'h-8'
						: hoveredId === project.id
							? 'h-4'
							: 'h-0'}"
					style="top: 50%; transform: translateY(-50%);"
				></div>

				<div class="relative ml-2.5">
					<div
						class="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md transition-all duration-150
							{isActive ? 'ring-1 ring-[var(--color-accent)]' : 'opacity-90 group-hover:opacity-100'} {isIconUrl(project.icon) ? '' : hashColor(project.name)}"
					>
						{#if isIconUrl(project.icon)}
							<img src={project.icon} alt={project.name} class="h-full w-full object-cover" />
						{:else}
							<span class="font-mono text-base font-semibold text-white">{project.name.charAt(0).toUpperCase()}</span>
						{/if}
					</div>
					{#if unreadFor(project.id) > 0}
						<span
							data-testid="project-unread-badge"
							data-project-id={project.id}
							class="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-sm bg-red-500 px-1 font-mono text-[10px] font-bold leading-none text-white ring-2 ring-[var(--color-surface-secondary)]"
						>{formatBadgeCount(unreadFor(project.id))}</span>
					{/if}
				</div>

			</button>
		{/each}
	</div>

	<!-- Ez assistant button (sits just above Add Project) -->
	<div class="mt-2">
		<EzButton />
	</div>

	<!-- Add project button -->
	<button
		class="group relative mt-1.5 flex cursor-pointer items-center"
		onclick={() => goto("/new-project")}
		onmouseenter={() => (hoveredId = "__add__")}
		onmouseleave={() => (hoveredId = null)}
		aria-label="Add project"
	>
		<div
			class="ml-2.5 flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-tertiary)] text-green-500 transition-all duration-150 group-hover:border-green-600 group-hover:bg-green-600 group-hover:text-white"
		>
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
			</svg>
		</div>

		{#if hoveredId === "__add__"}
			<div class="absolute left-[60px] z-50 whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] shadow-lg">
				Add Project
			</div>
		{/if}
	</button>
</div>

<!-- Project tooltip rendered with position:fixed so it escapes the
	 `overflow-y-auto` clip on the project-list container above. -->
{#if hoveredId && hoveredRect}
	{@const proj = store.projects.find((p) => p.id === hoveredId)}
	{#if proj}
		<div
			class="pointer-events-none fixed z-50 max-w-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left shadow-lg"
			style="left: {hoveredRect.left + 8}px; top: {hoveredRect.top + hoveredRect.height / 2}px; transform: translateY(-50%);"
		>
			<div class="truncate text-sm font-medium text-[var(--color-text-primary)]">{proj.name}</div>
			{#if proj.path}
				<div class="mt-0.5 truncate font-mono text-xs text-[var(--color-text-muted)]">{proj.path}</div>
			{/if}
		</div>
	{/if}
{/if}
