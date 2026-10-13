<script lang="ts">
	import { onMount } from "svelte";
	import SkeletonLoader from "$lib/components/SkeletonLoader.svelte";
	import MobileCardStack from "$lib/components/MobileCardStack.svelte";

	type AccountData = {
		id: string;
		email: string;
		name: string;
		role: "admin" | "member";
		createdAt: string;
	};

	let account = $state<AccountData | null>(null);
	let loading = $state(true);

	// Profile form
	let editName = $state("");
	let editEmail = $state("");
	let emailPassword = $state("");
	let originalEmail = $state("");
	let savingProfile = $state(false);
	let profileMessage = $state<{ type: "success" | "error"; text: string } | null>(null);

	// Password form
	let currentPassword = $state("");
	let newPassword = $state("");
	let confirmPassword = $state("");
	let savingPassword = $state(false);
	let passwordMessage = $state<{ type: "success" | "error"; text: string } | null>(null);

	// Login History
	type LoginHistoryEntry = {
		id: string;
		action: string;
		metadata: Record<string, unknown> | null;
		createdAt: string;
	};
	let loginHistory = $state<LoginHistoryEntry[]>([]);
	let loadingHistory = $state(true);

	// Sessions
	type SessionEntry = {
		id: string;
		userAgent: string | null;
		ipAddress: string | null;
		lastActiveAt: string | null;
		createdAt: string;
		isCurrent: boolean;
	};
	let sessions = $state<SessionEntry[]>([]);
	let loadingSessions = $state(true);
	let sessionMessage = $state<{ type: "success" | "error"; text: string } | null>(null);
	let revokingId = $state<string | null>(null);

	let emailChanged = $derived(editEmail !== originalEmail);

	// MobileCardStack data for sessions
	let sessionRows = $derived(
		sessions.map((s) => ({
			id: s.id,
			device: truncateUA(s.userAgent),
			ip: s.ipAddress ?? "Unknown",
			active: timeAgo(s.lastActiveAt),
			current: s.isCurrent ? "Yes" : "",
			_isCurrent: s.isCurrent,
		}))
	);
	const sessionColumns = [
		{ key: "device", label: "Device" },
		{ key: "ip", label: "IP" },
		{ key: "active", label: "Last Active" },
	];

	// MobileCardStack data for login history
	let loginHistoryRows = $derived(
		loginHistory.map((e) => ({
			id: e.id,
			time: formatDateTime(e.createdAt),
			ip: (e.metadata?.ip as string) ?? "Unknown",
			device: truncateUA((e.metadata?.userAgent as string) ?? null),
		}))
	);
	const loginHistoryColumns = [
		{ key: "time", label: "Time" },
		{ key: "ip", label: "IP" },
		{ key: "device", label: "Device" },
	];

	onMount(async () => {
		try {
			const res = await fetch("/api/account");
			if (res.ok) {
				const data: AccountData = await res.json();
				account = data;
				editName = data.name;
				editEmail = data.email;
				originalEmail = data.email;
			}
		} catch {
			// ignore
		} finally {
			loading = false;
		}
		loadSessions();
		loadLoginHistory();
	});

	async function loadSessions() {
		loadingSessions = true;
		try {
			const res = await fetch("/api/account/sessions");
			if (res.ok) {
				const data = await res.json();
				sessions = data.sessions;
			}
		} catch { /* silent */ }
		loadingSessions = false;
	}

	async function loadLoginHistory() {
		loadingHistory = true;
		try {
			const res = await fetch("/api/account/login-history");
			if (res.ok) {
				const data = await res.json();
				loginHistory = data.entries;
			}
		} catch { /* silent */ }
		loadingHistory = false;
	}

	async function revokeSession(sessionId: string) {
		revokingId = sessionId;
		sessionMessage = null;
		try {
			const res = await fetch("/api/account/sessions", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId }),
			});
			if (res.ok) {
				sessions = sessions.filter((s) => s.id !== sessionId);
				sessionMessage = { type: "success", text: "Session revoked." };
			} else {
				const data = await res.json();
				sessionMessage = { type: "error", text: data.error || "Failed to revoke session." };
			}
		} catch {
			sessionMessage = { type: "error", text: "Network error." };
		} finally {
			revokingId = null;
		}
	}

	async function saveProfile() {
		profileMessage = null;
		savingProfile = true;
		try {
			const body: Record<string, string> = {};
			if (editName !== account?.name) body.name = editName;
			if (emailChanged) {
				body.email = editEmail;
				body.currentPassword = emailPassword;
			}
			if (Object.keys(body).length === 0) {
				profileMessage = { type: "error", text: "No changes to save." };
				return;
			}
			const res = await fetch("/api/account", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (res.ok) {
				account = data;
				originalEmail = data.email;
				editName = data.name;
				editEmail = data.email;
				emailPassword = "";
				profileMessage = { type: "success", text: "Profile updated." };
			} else {
				profileMessage = { type: "error", text: data.error || "Failed to update profile." };
			}
		} catch {
			profileMessage = { type: "error", text: "Network error." };
		} finally {
			savingProfile = false;
		}
	}

	async function changePassword() {
		passwordMessage = null;
		if (newPassword !== confirmPassword) {
			passwordMessage = { type: "error", text: "Passwords do not match." };
			return;
		}
		savingPassword = true;
		try {
			const res = await fetch("/api/account/password", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ currentPassword, newPassword }),
			});
			const data = await res.json();
			if (res.ok) {
				passwordMessage = { type: "success", text: data.message };
				currentPassword = "";
				newPassword = "";
				confirmPassword = "";
			} else {
				passwordMessage = { type: "error", text: data.error || "Failed to change password." };
			}
		} catch {
			passwordMessage = { type: "error", text: "Network error." };
		} finally {
			savingPassword = false;
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			year: "numeric",
			month: "long",
			day: "numeric",
		});
	}

	function formatDateTime(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		}) + " " + d.toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	function timeAgo(iso: string | null): string {
		if (!iso) return "Never";
		const diff = Date.now() - new Date(iso).getTime();
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return "Just now";
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function truncateUA(ua: string | null): string {
		if (!ua) return "Unknown device";
		if (ua.length <= 60) return ua;
		return ua.slice(0, 57) + "...";
	}
</script>

{#snippet sessionCards()}
	<div class="space-y-3">
		{#each sessions as session}
			<div class="rounded-lg border p-3 {session.isCurrent ? 'border-blue-600' : 'border-[var(--color-border)]'}">
				<div class="flex justify-between py-1 text-sm">
					<span class="text-[var(--color-text-muted)]">Device</span>
					<span class="text-right text-xs">{truncateUA(session.userAgent)}</span>
				</div>
				<div class="flex justify-between py-1 text-sm">
					<span class="text-[var(--color-text-muted)]">IP</span>
					<span>{session.ipAddress ?? "Unknown"}</span>
				</div>
				<div class="flex justify-between py-1 text-sm">
					<span class="text-[var(--color-text-muted)]">Last Active</span>
					<span>{timeAgo(session.lastActiveAt)}</span>
				</div>
				{#if session.isCurrent}
					<div class="mt-2 border-t border-[var(--color-border)] pt-2">
						<span class="inline-flex items-center rounded-full bg-blue-900 px-2 py-0.5 text-xs text-blue-300">Current session</span>
					</div>
				{:else}
					<div class="mt-2 border-t border-[var(--color-border)] pt-2">
						<button
							onclick={() => revokeSession(session.id)}
							disabled={revokingId === session.id}
							class="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
						>
							{revokingId === session.id ? "Revoking..." : "Revoke"}
						</button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/snippet}

<div class="mx-auto max-w-3xl space-y-6">
	<h1 class="text-2xl font-bold text-[var(--color-text-primary)]">Account</h1>

	{#if loading}
		<SkeletonLoader type="form" />
	{:else if account}
		<!-- Account Info (read-only) -->
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
			<h2 class="mb-4 text-lg font-semibold text-[var(--color-text-primary)]">Account Info</h2>
			<div class="flex items-center gap-4">
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">
					{account.name.charAt(0).toUpperCase()}
				</div>
				<div>
					<p class="text-sm text-[var(--color-text-primary)]">{account.name}</p>
					<p class="text-xs text-[var(--color-text-secondary)]">{account.email}</p>
				</div>
				<span class="ml-auto text-xs px-2 py-0.5 rounded-full {account.role === 'admin' ? 'bg-purple-900 text-purple-300' : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)]'}">
					{account.role}
				</span>
			</div>
			<p class="mt-3 text-xs text-[var(--color-text-muted)]">Member since {formatDate(account.createdAt)}</p>
		</div>

		<!-- Profile (editable) -->
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
			<h2 class="mb-4 text-lg font-semibold text-[var(--color-text-primary)]">Profile</h2>
			<div class="space-y-4">
				<div>
					<label for="account-name" class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Display Name</label>
					<input
						id="account-name"
						type="text"
						autocomplete="name"
						bind:value={editName}
						class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
				</div>
				<div>
					<label for="account-email" class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Email</label>
					<input
						id="account-email"
						type="email"
						autocomplete="email"
						bind:value={editEmail}
						class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
					{#if emailChanged}
						<p class="mt-1 text-xs text-yellow-400">Email changes require your current password.</p>
						<input
							type="password"
							autocomplete="current-password"
							bind:value={emailPassword}
							placeholder="Current password"
							class="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
						/>
					{/if}
				</div>
				{#if profileMessage}
					<p class="text-xs {profileMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}">{profileMessage.text}</p>
				{/if}
				<button
					onclick={saveProfile}
					disabled={savingProfile}
					class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
				>
					{savingProfile ? "Saving..." : "Save Profile"}
				</button>
			</div>
		</div>

		<!-- Change Password -->
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
			<h2 class="mb-4 text-lg font-semibold text-[var(--color-text-primary)]">Change Password</h2>
			<div class="space-y-4">
				<div>
					<label for="current-pw" class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Current Password</label>
					<input
						id="current-pw"
						type="password"
						autocomplete="current-password"
						bind:value={currentPassword}
						class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
				</div>
				<div>
					<label for="new-pw" class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">New Password</label>
					<input
						id="new-pw"
						type="password"
						autocomplete="new-password"
						bind:value={newPassword}
						class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
				</div>
				<div>
					<label for="confirm-pw" class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Confirm New Password</label>
					<input
						id="confirm-pw"
						type="password"
						autocomplete="new-password"
						bind:value={confirmPassword}
						class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
					/>
				</div>
				{#if passwordMessage}
					<p class="text-xs {passwordMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}">{passwordMessage.text}</p>
				{/if}
				<button
					onclick={changePassword}
					disabled={savingPassword}
					class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors disabled:opacity-50"
				>
					{savingPassword ? "Changing..." : "Change Password"}
				</button>
			</div>
		</div>
		<!-- Active Sessions -->
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
			<h2 class="mb-4 text-lg font-semibold text-[var(--color-text-primary)]">Active Sessions</h2>
			<p class="mb-4 text-xs text-[var(--color-text-secondary)]">Manage your active sessions across devices. Each session represents a login.</p>
			{#if loadingSessions}
				<SkeletonLoader type="list" />
			{:else if sessions.length === 0}
				<p class="text-sm text-[var(--color-text-secondary)]">No active sessions.</p>
			{:else}
				{#if sessionMessage}
					<p class="mb-3 text-xs {sessionMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}">{sessionMessage.text}</p>
				{/if}
				<div class="hidden md:block space-y-2">
					{#each sessions as session}
						<div class="flex items-center gap-3 rounded-md border px-4 py-3 {session.isCurrent ? 'border-blue-600 bg-[var(--color-surface)]' : 'border-[var(--color-border)] bg-[var(--color-surface)]'}">
							<div class="flex-1 min-w-0">
								<p class="text-sm text-[var(--color-text-primary)] truncate">
									{truncateUA(session.userAgent)}
									{#if session.isCurrent}
										<span class="ml-2 inline-flex items-center rounded-full bg-blue-900 px-2 py-0.5 text-xs text-blue-300">(current session)</span>
									{/if}
								</p>
								<div class="mt-1 flex gap-4 text-xs text-[var(--color-text-secondary)]">
									<span>IP: {session.ipAddress ?? "Unknown"}</span>
									<span>Active: {timeAgo(session.lastActiveAt)}</span>
									<span>Created: {formatDate(session.createdAt)}</span>
								</div>
							</div>
							{#if !session.isCurrent}
								<button
									onclick={() => revokeSession(session.id)}
									disabled={revokingId === session.id}
									class="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
								>
									{revokingId === session.id ? "Revoking..." : "Revoke"}
								</button>
							{/if}
						</div>
					{/each}
				</div>
				<div class="md:hidden">
					{@render sessionCards()}
				</div>
			{/if}
		</div>
		<!-- Login History -->
		<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
			<h2 class="mb-4 text-lg font-semibold text-[var(--color-text-primary)]">Login History</h2>
			<p class="mb-4 text-xs text-[var(--color-text-secondary)]">Your most recent login events.</p>
			{#if loadingHistory}
				<SkeletonLoader type="list" />
			{:else if loginHistory.length === 0}
				<p class="text-sm text-[var(--color-text-secondary)]">No login history available.</p>
			{:else}
				<div class="hidden md:block space-y-2">
					{#each loginHistory as entry}
						<div class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
							<p class="text-sm text-[var(--color-text-primary)]">{formatDateTime(entry.createdAt)}</p>
							<div class="mt-1 flex gap-4 text-xs text-[var(--color-text-secondary)]">
								<span>IP: {(entry.metadata?.ip as string) ?? "Unknown"}</span>
								<span>{truncateUA((entry.metadata?.userAgent as string) ?? null)}</span>
							</div>
						</div>
					{/each}
				</div>
				<div class="md:hidden">
					<MobileCardStack columns={loginHistoryColumns} rows={loginHistoryRows} keyField="id" />
				</div>
			{/if}
		</div>
	{:else}
		<p class="text-sm text-red-400">Failed to load account data.</p>
	{/if}
</div>
