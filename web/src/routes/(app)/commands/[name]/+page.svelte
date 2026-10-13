<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import {
		fetchUserCommand,
		updateUserCommand,
		deleteUserCommand as apiDeleteUserCommand,
		type UserCommand,
	} from "$lib/api.js";
	import { addToast } from "$lib/toast.svelte.js";
	import CommandForm, { type CommandFormInitial, type CommandFormPayload } from "$lib/components/CommandForm.svelte";
	import SkeletonLoader from "$lib/components/SkeletonLoader.svelte";
	import { reloadOn } from "$lib/reload-on.svelte.js";

	let commandName = $derived(page.params.name ?? "");

	let initial = $state<CommandFormInitial | null>(null);
	let loading = $state(true);
	let loadError = $state("");
	let submitting = $state(false);
	let errorMsg = $state("");
	let deleting = $state(false);

	reloadOn(() => commandName, async (name, isStale) => {
		initial = null;
		loading = true;
		loadError = "";
		try {
			const c: UserCommand = await fetchUserCommand(name);
			if (isStale()) return;
			initial = {
				name: c.name,
				description: c.description,
				body: c.body,
				frontmatter: {
					"argument-hint": c.frontmatter["argument-hint"] ?? "",
					agent: c.frontmatter.agent ?? "",
					model: c.frontmatter.model ?? "",
				},
			};
		} catch (e) {
			if (!isStale()) loadError = e instanceof Error ? e.message : "Failed to load command";
		} finally {
			if (!isStale()) loading = false;
		}
	});

	async function handleSubmit(payload: CommandFormPayload) {
		submitting = true;
		errorMsg = "";
		try {
			await updateUserCommand(commandName, {
				description: payload.description,
				body: payload.body,
				frontmatter: payload.frontmatter,
			});
			addToast({ type: "success", message: `Updated /${commandName}` });
			goto("/commands");
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : "Failed to save changes";
			addToast({ type: "error", message: errorMsg });
		} finally {
			submitting = false;
		}
	}

	async function handleDelete() {
		// Confirm dialog (browser-native). The e2e test stubs this.
		const ok = typeof window !== "undefined" ? window.confirm(`Delete /${commandName}?`) : false;
		if (!ok) return;
		deleting = true;
		try {
			await apiDeleteUserCommand(commandName);
			addToast({ type: "success", message: `Deleted /${commandName}` });
			goto("/commands");
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : "Failed to delete";
			addToast({ type: "error", message: errorMsg });
		} finally {
			deleting = false;
		}
	}

	function handleCancel() {
		goto("/commands");
	}
</script>

<div class="space-y-6">
	<div>
		<a href="/commands" class="text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]">
			&larr; Back to Commands
		</a>
	</div>

	<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
		<div class="mb-6 flex items-center justify-between">
			<h2 class="text-2xl font-bold text-[var(--color-text-primary)]">Edit /{commandName}</h2>
			{#if initial}
				<button
					type="button"
					onclick={handleDelete}
					disabled={deleting}
					data-testid="commands-edit-delete"
					class="rounded-md border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{#if deleting}
						Deleting…
					{:else}
						Delete
					{/if}
				</button>
			{/if}
		</div>

		{#if loading}
			<SkeletonLoader type="card-grid" count={1} />
		{:else if loadError}
			<p class="text-sm text-red-400" data-testid="commands-edit-load-error">{loadError}</p>
		{:else if initial}
			<CommandForm
				mode="edit"
				{initial}
				{submitting}
				onsubmit={handleSubmit}
				oncancel={handleCancel}
			/>
			{#if errorMsg}
				<p class="mt-3 text-sm text-red-400" data-testid="commands-edit-error">{errorMsg}</p>
			{/if}
		{/if}
	</div>
</div>
