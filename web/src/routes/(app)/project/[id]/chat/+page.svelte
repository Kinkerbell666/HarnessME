<script lang="ts">
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { createConversation, fetchConversations } from "$lib/api.js";
	import { store, refreshQuickstart, notifyConversationsChanged } from "$lib/stores.svelte.js";
	import ConversationList from "$lib/components/ConversationList.svelte";
	import EmptyState from "$lib/components/EmptyState.svelte";
	import NoProviderBanner from "$lib/components/chat/NoProviderBanner.svelte";
	import ProjectRail from "$lib/components/ProjectRail.svelte";

	let projectId = $derived(page.params.id!);
	let checked = $state(false);
	// `?all=1` is the sidebar's "Show all": the full list, never a redirect.
	// Plain /chat keeps jumping to the last-open thread, as the Chat label did.
	let showAll = $derived(page.url.searchParams.has("all"));

	// Redirect to last-opened chat, or most recent conversation.
	// On mobile we never auto-redirect — the chat index is the list view.
	// An effect, not onMount: SvelteKit reuses this page when only `?all` or
	// the project changes (the sidebar's Chat label from All chats, or a
	// project switch), and each of those must decide the redirect again.
	$effect(() => {
		const forProject = projectId;
		const showAllNow = showAll;
		checked = false;
		// `cancelled` guards the post-await redirects: if the user navigates
		// away while a conversation lookup is in flight, a late goto() would
		// yank them back to this chat-index shell. Same guard as the hub
		// redirect shells (src/routes/(app)/hub + project/[id]/hub).
		let cancelled = false;
		void (async () => {
			const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
			if (isMobile || showAllNow) {
				checked = true;
				return;
			}

			// 1. Try the last chat the user had open for this project
			const lastConvId = localStorage.getItem(`ezcorp-last-chat:${forProject}`);
			if (lastConvId) {
				try {
					const { fetchConversation } = await import("$lib/api.js");
					const conv = await fetchConversation(lastConvId);
					if (cancelled) return;
					if (conv && conv.projectId === forProject) {
						goto(`/project/${forProject}/chat/${lastConvId}`, { replaceState: true });
						return;
					}
				} catch { /* deleted or inaccessible — fall through */ }
			}

			// 2. Fall back to most recent conversation
			try {
				const convs = await fetchConversations(forProject, { limit: 1 });
				if (cancelled) return;
				if (convs.length > 0) {
					goto(`/project/${forProject}/chat/${convs[0].id}`, { replaceState: true });
					return;
				}
			} catch { /* fall through to empty state */ }
			if (cancelled) return;
			checked = true;
		})();
		return () => {
			cancelled = true;
		};
	});

	async function handleCreate() {
		try {
			const conv = await createConversation({ projectId });
			void refreshQuickstart();
			notifyConversationsChanged(projectId);
			goto(`/project/${projectId}/chat/${conv.id}`);
		} catch (err) {
			console.error("Failed to create conversation:", err);
		}
	}

	function handleSelect(id: string, messageId?: string) {
		// Sidebar search results forward the matched messageId so the thread
		// can deep-link (scroll + pulse) to it via `?m=`. A plain title-row
		// select passes no messageId → no stray `?m=` is appended.
		goto(messageId
			? `/project/${projectId}/chat/${id}?m=${encodeURIComponent(messageId)}`
			: `/project/${projectId}/chat/${id}`);
	}
</script>

{#if checked}
<div class="absolute inset-0 flex">
	<!-- Desktop: the all-chats page. The sidebar's Chat section shows only the
	     most recent threads; "Show all" and the Chat label land here, on the
	     full list (search, rename, delete, paging) at full width. -->
	{#if projectId && showAll}
		<div class="hidden md:flex flex-1 min-w-0 flex-col">
			<NoProviderBanner />
			<ConversationList
				{projectId}
				fill
				oncreate={handleCreate}
				onselect={handleSelect}
			/>
		</div>
	{/if}

	<!-- Desktop: empty state until the first conversation exists -->
	<div class="{showAll ? 'hidden' : 'hidden md:flex'} flex-1 flex-col items-center justify-center min-w-0">
		<NoProviderBanner />
		<EmptyState
			title="No conversations yet"
			description="Start your first conversation to begin chatting with AI."
			ctaLabel="New Conversation"
			ctaOnclick={handleCreate}
		>
			{#snippet icon()}
				<svg class="h-12 w-12 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
						d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
				</svg>
			{/snippet}
		</EmptyState>
	</div>

	<!-- Mobile: ProjectRail + ConversationList with a back button to the project menu -->
	<div class="flex md:hidden flex-1 min-w-0">
		<ProjectRail />
		<div class="flex flex-1 min-w-0 flex-col">
			<div class="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-2 py-2">
				<button
					onclick={() => (store.mobileMenuOpen = true)}
					class="flex items-center justify-center rounded-md p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-tertiary)] hover:text-[var(--color-text-primary)]"
					aria-label="Back to project menu"
					style="min-width: 44px; min-height: 44px;"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
					</svg>
				</button>
				<span class="text-sm font-medium text-[var(--color-text-secondary)]">Chats</span>
			</div>
			<NoProviderBanner />
			{#if projectId}
				<ConversationList
					{projectId}
					oncreate={handleCreate}
					onselect={handleSelect}
				/>
			{/if}
		</div>
	</div>
</div>
{/if}
