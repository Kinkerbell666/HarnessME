<script lang="ts">
	import { onMount } from "svelte";
	import { connectionState, type ConnectionInfo } from "$lib/stores/connection";
	import { wsManualRetry } from "$lib/stores.svelte.js";
	import { isBannerVisible, bannerColorClass } from "$lib/connection-banner-logic";

	let connStatus = $state<"connected" | "disconnected" | "reconnecting" | "failed">("connected");
	let attempt = $state(0);
	let maxAttempts = $state(10);
	let showConnected = $state(false);
	let wasDisconnected = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	// onMount runs untracked, so the store's immediate first call does not
	// make the reads below dependencies. Its cleanup ends the subscription.
	onMount(() => {
		const unsubscribe = connectionState.subscribe(onConnectionChange);
		return () => {
			unsubscribe();
			if (hideTimer) clearTimeout(hideTimer);
		};
	});

	function onConnectionChange(info: ConnectionInfo) {
		const prev = connStatus;
		connStatus = info.state;
		attempt = info.attempt;
		maxAttempts = info.maxAttempts;

		if (prev !== "connected" && info.state === "connected" && wasDisconnected) {
			showConnected = true;
			if (hideTimer) clearTimeout(hideTimer);
			hideTimer = setTimeout(() => {
				showConnected = false;
			}, 2500);
		}

		if (info.state !== "connected") {
			wasDisconnected = true;
		}
	}

	let visible = $derived(isBannerVisible(connStatus, showConnected));
</script>

{#if visible}
	<div class="fixed top-0 left-0 right-0 z-50 flex items-center justify-center px-4 py-0 pointer-events-none">
		<div
			class="mt-2 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg pointer-events-auto transition-all duration-300
				{bannerColorClass(connStatus, showConnected)}"
		>
			{#if showConnected && connStatus === "connected"}
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				Connected
			{:else if connStatus === "failed"}
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
				Connection failed.
				<button
					onclick={wsManualRetry}
					class="ml-2 rounded bg-white/20 px-2 py-0.5 text-xs font-semibold hover:bg-white/30 transition-colors"
				>
					Retry
				</button>
			{:else}
				<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
				</svg>
				Connection lost. Reconnecting... (attempt {attempt}/{maxAttempts})
			{/if}
		</div>
	</div>
{/if}
