import { test, expect, captureEvidence } from "./fixtures/test-base.js";
import AxeBuilder from "@axe-core/playwright";
import { sendComposerMessage } from "./fixtures/composer.js";
import { makeProject, makeConversation, makeMessage } from "./fixtures/data.js";

type Page = import("@playwright/test").Page;

/** The composer is enabled only after the live runtime event transport opens. */
async function waitForChatReady(page: Page) {
	await expect(page.locator("textarea")).toBeEnabled();
}

/**
 * Self-contained SSE outage harness.
 *
 * `ws.ts` talks to the runtime-events stream over EventSource. The shared
 * `setupWsMock` fake auto-opens every EventSource, so it cannot model a
 * *sustained* outage (each reconnect instantly succeeds). This installs a
 * controllable FakeEventSource driven by `__setSseDown`, plus a setTimeout
 * queue split into two lanes — the 5s connection grace
 * (CONNECTION_GRACE_MS in src/lib/connection-grace.ts) and the >=1s
 * reconnect backoff — so each can be advanced independently and
 * deterministically with no real waits.
 *
 * Registered AFTER `mockApi` so its `window.EventSource` / `setTimeout`
 * overrides win over `setupWsMock`'s.
 */
const GRACE_MS = 5000; // keep in sync with CONNECTION_GRACE_MS

async function installSseOutageHarness(page: Page) {
	await page.addInitScript((graceMs) => {
		const instances: any[] = [];
		let down = false;
		(window as any).__setSseDown = (v: boolean) => {
			down = v;
		};

		class FakeEventSource {
			onopen: ((e: Event) => void) | null = null;
			onmessage: ((e: MessageEvent) => void) | null = null;
			onerror: ((e: Event) => void) | null = null;
			readyState = 0;
			url: string;
			constructor(url: string) {
				this.url = url;
				instances.push(this);
				queueMicrotask(() => {
					if (down) {
						this.readyState = 2;
						this.onerror?.(new Event("error"));
					} else {
						this.readyState = 1;
						this.onopen?.(new Event("open"));
					}
				});
			}
			close() {
				this.readyState = 2;
			}
			addEventListener() {}
			removeEventListener() {}
		}
		(window as any).EventSource = FakeEventSource;
		(window as any).__fakeES = instances;

		// Two timer lanes. Each drains one FIFO snapshot per call, so
		// callbacks enqueued *while* flushing wait for the next pump.
		const realSetTimeout = window.setTimeout;
		const graceQ: Array<() => void> = [];
		const otherQ: Array<() => void> = [];
		const drain = (q: Array<() => void>) => {
			const n = q.length;
			for (let i = 0; i < n; i++) q.shift()!();
		};
		(window as any).__fireGrace = () => drain(graceQ);
		(window as any).__fireReconnect = () => drain(otherQ);
		(window as any).setTimeout = ((fn: TimerHandler, delay?: number, ...a: any[]) => {
			if (typeof fn === "function" && (delay ?? 0) >= 1000) {
				((delay ?? 0) === graceMs ? graceQ : otherQ).push(() => (fn as any)(...a));
				return 0 as any;
			}
			return realSetTimeout(fn as any, delay, ...a);
		}) as typeof window.setTimeout;
	}, GRACE_MS);
}

/** Drop the SSE stream and keep it down (reconnects also error). */
async function dropSse(page: Page) {
	await page.evaluate(() => {
		(window as any).__setSseDown(true);
		const list = (window as any).__fakeES as any[];
		const latest = list[list.length - 1];
		if (latest) {
			latest.readyState = 2;
			latest.onerror?.(new Event("error"));
		}
	});
}

/** Fire pending reconnect-backoff timers (each cycle re-errors while down). */
async function pumpReconnect(page: Page) {
	await page.evaluate(() => (window as any).__fireReconnect());
	await page.waitForTimeout(50);
}

/** Fire the 5s grace timer (surfaces the banner / disabled input). */
async function elapseGrace(page: Page) {
	await page.evaluate(() => (window as any).__fireGrace());
	await page.waitForTimeout(50);
}

/** Bring the SSE stream back; the next reconnect attempt succeeds. */
async function restoreSse(page: Page) {
	await page.evaluate(() => {
		(window as any).__setSseDown(false);
		(window as any).__fireReconnect();
	});
	await page.waitForTimeout(50);
}

function chatSetup() {
	const proj = makeProject({ id: "proj-1" });
	const conv = makeConversation({ id: "conv-1", projectId: "proj-1" });
	return { projects: [proj], conversations: [conv] };
}

// ---- Connection Banner + ChatInput grace window ----

test("connection UI stays hidden during the grace window, then surfaces", async ({
	page,
	mockApi,
}) => {
	await mockApi(chatSetup());
	await installSseOutageHarness(page);
	await page.goto("/project/proj-1/chat/conv-1");
	await waitForChatReady(page);

	await dropSse(page);
	// Still within the grace window — a reconnect cycle has already failed
	// but the user must see nothing: no banner, input fully usable.
	await pumpReconnect(page);
	await expect(page.getByText(/Connection lost/)).toHaveCount(0);
	const textarea = page.locator("textarea");
	await expect(textarea).toBeEnabled();
	await expect(textarea).toHaveAttribute("placeholder", "Send a message...");

	// Grace elapses with the connection still down → now it surfaces.
	await elapseGrace(page);
	await expect(page.getByText(/Connection lost\. Reconnecting/)).toBeVisible();
	await expect(textarea).toBeDisabled();
	await expect(textarea).toHaveAttribute("placeholder", "Reconnecting...");
});

test("a brief (sub-grace) connection blip never shows any UI", async ({ page, mockApi }) => {
	await mockApi(chatSetup());
	await installSseOutageHarness(page);
	await page.goto("/project/proj-1/chat/conv-1");
	await waitForChatReady(page);

	await dropSse(page);
	// Recover before the grace timer fires.
	await restoreSse(page);
	// A late grace timer must be a no-op (already recovered).
	await elapseGrace(page);

	await expect(page.getByText(/Connection lost/)).toHaveCount(0);
	// No green "Connected" flash either — nothing was ever disrupted.
	await expect(page.getByText("Connected")).toHaveCount(0);
	const textarea = page.locator("textarea");
	await expect(textarea).toBeEnabled();
	await expect(textarea).toHaveAttribute("placeholder", "Send a message...");
});

test("Connected flash + re-enabled input after a real (post-grace) outage", async ({
	page,
	mockApi,
}) => {
	await mockApi(chatSetup());
	await installSseOutageHarness(page);
	await page.goto("/project/proj-1/chat/conv-1");
	await waitForChatReady(page);

	await dropSse(page);
	await elapseGrace(page);
	await expect(page.getByText(/Connection lost/)).toBeVisible();

	await restoreSse(page);
	await expect(page.getByText("Connected")).toBeVisible();
	const textarea = page.locator("textarea");
	await expect(textarea).toBeEnabled();
	await expect(textarea).toHaveAttribute("placeholder", "Send a message...");
});

test("after moving between chats, the banner and composer still follow the connection @evidence", async ({
	page,
	mockApi,
}, testInfo) => {
	const proj = makeProject({ id: "proj-1" });
	const convs = [
		makeConversation({ id: "conv-1", projectId: "proj-1", title: "First chat" }),
		makeConversation({ id: "conv-2", projectId: "proj-1", title: "Second chat" }),
	];
	await mockApi({ projects: [proj], conversations: convs });
	await installSseOutageHarness(page);
	await page.goto("/project/proj-1/chat/conv-1");
	await waitForChatReady(page);

	// The composer and the banner subscribe on mount and unsubscribe on
	// unmount; a client-side move to another chat must leave exactly one
	// live subscription that still drives both.
	await page.locator('[data-testid="chat-nav-thread"][data-conversation-id="conv-2"]').first().click();
	await expect(page).toHaveURL(/\/chat\/conv-2$/);
	await waitForChatReady(page);

	await dropSse(page);
	await elapseGrace(page);
	await expect(page.getByText(/Connection lost\. Reconnecting/)).toBeVisible();
	const textarea = page.locator("textarea");
	await expect(textarea).toHaveAttribute("placeholder", "Reconnecting...");
	await captureEvidence(page, testInfo, "connection-banner-reconnecting");

	await restoreSse(page);
	await expect(page.getByText("Connected")).toBeVisible();
	await expect(textarea).toBeEnabled();
	await expect(textarea).toHaveAttribute("placeholder", "Send a message...");
});

test("connection banner shows Connection failed with Retry button", async ({ page, mockApi }) => {
	await mockApi(chatSetup());
	await installSseOutageHarness(page);
	await page.goto("/project/proj-1/chat/conv-1");
	await waitForChatReady(page);

	// Exhaust MAX_ATTEMPTS (10) reconnect cycles → terminal "failed"
	// (bypasses the grace window since it is unreachable before it).
	await dropSse(page);
	for (let i = 0; i < 14; i++) await pumpReconnect(page);

	await expect(page.getByText("Connection failed.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

// ---- Memory Unavailable ----

async function startMemoryRun(page: Page) {
	await page.goto("/project/proj-1/chat/conv-1");
	const posted = page.waitForResponse((response) => response.request().method() === "POST"
		&& new URL(response.url()).pathname === "/api/conversations/conv-1/messages");
	await sendComposerMessage(page, "Use my saved context");
	const response = await posted;
	expect(response.status()).toBe(200);
	expect(await response.json()).toMatchObject({ runId: "run-stream" });
	await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
}

for (const colorScheme of ["light", "dark"] as const) {
	test(`memory unavailable warning is readable in ${colorScheme} mode @evidence`, async ({ page, mockApi, emitSse }, testInfo) => {
		await mockApi(chatSetup());
		await page.emulateMedia({ colorScheme });
		await startMemoryRun(page);
		await emitSse({ type: "run:status", data: { runId: "run-stream", status: "memory_unavailable" } });
		await expect(page.getByTestId("memory-unavailable-warning")).toContainText("Memory is currently unavailable");
		await expect(page.getByText(/^Thinking\.\.\. \(\d+s\)$/)).toBeVisible();
		await expect(page.getByText(/memory_unavailable/)).toHaveCount(0);
		const accessibility = await new AxeBuilder({ page }).include('[data-testid="memory-unavailable-warning"]').analyze();
		expect(accessibility.violations).toEqual([]);
		await captureEvidence(page, testInfo, `memory-unavailable-warning-${colorScheme}`);
	});
}

// ---- Provider failure card: a rate limit is not an outage ----
//
// The payload is the one finalize.ts now writes for a rate-limited free model
// (reason + upstreamProvider). Before, the same failure rendered as "Kilo is
// unavailable right now. All providers are currently unavailable" — which sent
// a user looking for an outage that did not exist.

function failedTurnSetup(payload: Record<string, unknown>) {
	const base = chatSetup();
	return {
		...base,
		messages: [
			makeMessage({ id: "m-user", role: "user", content: "test" }),
			makeMessage({
				id: "m-err",
				role: "assistant",
				parentMessageId: "m-user",
				provider: "kilo",
				model: "poolside/laguna-s-2.1:free",
				content: `Error: ${JSON.stringify({ type: "provider_unavailable", failedProvider: "kilo", failedModel: "poolside/laguna-s-2.1:free", suggestion: null, message: "429", ...payload })}`,
			}),
		],
	};
}

for (const colorScheme of ["light", "dark"] as const) {
	test(`a rate-limited model says who is limiting it, not "all providers unavailable" (${colorScheme}) @evidence`, async ({ page, mockApi }, testInfo) => {
		await mockApi(failedTurnSetup({ reason: "rate_limited", upstreamProvider: "Poolside" }));
		await page.emulateMedia({ colorScheme });
		await page.goto("/project/proj-1/chat/conv-1");

		const card = page.getByTestId("provider-rate-limited");
		await expect(card).toBeVisible();
		await expect(card).toContainText("Poolside is rate-limiting");
		await expect(card).toContainText("poolside/laguna-s-2.1:free");
		await expect(card).toContainText("usually brief");
		await expect(card.getByRole("button", { name: "Retry" })).toBeVisible();
		await expect(page.getByText("All providers are currently unavailable")).toHaveCount(0);

		const accessibility = await new AxeBuilder({ page }).include('[data-testid="provider-rate-limited"]').analyze();
		expect(accessibility.violations).toEqual([]);
		await captureEvidence(page, testInfo, `provider-rate-limited-${colorScheme}`);
	});
}

test("without a named upstream, the rate-limit card names the provider", async ({ page, mockApi }) => {
	await mockApi(failedTurnSetup({ reason: "rate_limited" }));
	await page.goto("/project/proj-1/chat/conv-1");
	await expect(page.getByTestId("provider-rate-limited")).toContainText("Kilo is rate-limiting");
});

test("a genuine outage still renders the unavailable card", async ({ page, mockApi }) => {
	await mockApi(failedTurnSetup({}));
	await page.goto("/project/proj-1/chat/conv-1");
	await expect(page.getByText("Kilo is unavailable right now.")).toBeVisible();
	await expect(page.getByText("All providers are currently unavailable")).toBeVisible();
	await expect(page.getByTestId("provider-rate-limited")).toHaveCount(0);
});

test("memory warning does not repeat and clears when its run recovers", async ({ page, mockApi, emitSse }) => {
	await mockApi(chatSetup());
	await startMemoryRun(page);
	const warning = page.getByText(/Memory is currently unavailable/);
	await emitSse({ type: "run:status", data: { runId: "run-stream", status: "memory_unavailable" } });
	await expect(warning).toBeVisible();
	await emitSse({ type: "run:status", data: { runId: "run-stream", status: "memory_unavailable" } });
	await expect(warning).toHaveCount(1);
	await emitSse({ type: "run:status", data: { runId: "run-stream", status: "Memory recovered" } });
	await expect(warning).toHaveCount(0);
});

test("a memory warning for another run does not appear in this chat", async ({ page, mockApi, emitSse }) => {
	await mockApi(chatSetup());
	await startMemoryRun(page);
	await emitSse({ type: "run:status", data: { runId: "run-other", status: "memory_unavailable" } });
	await expect(page.getByText(/Memory is currently unavailable/)).toHaveCount(0);
});

// ---- SystemHealth ----

const settingsRoutes: Record<string, (url: URL) => unknown> = {
	"/api/auth/me": () => ({
		user: { id: "u-1", email: "admin@test.com", name: "Admin", role: "admin" },
	}),
	"/api/users": () => ({ users: [] }),
	"/api/teams": () => ({ teams: [] }),
	"/api/auth/invite": () => ({ invites: [] }),
	"/api/audit-log": () => ({ entries: [], total: 0 }),
	"/api/settings/developer/api-keys": () => ({ keys: [] }),
};

test("system health section visible on settings page", async ({ page, mockApi }) => {
	await mockApi({
		routes: {
			...settingsRoutes,
			"/api/health": (url: URL) => {
				if (url.searchParams.get("detail") === "true") {
					return {
						status: "healthy",
						db: { status: "up" },
						embeddings: { status: "ready" },
						providers: {
							anthropic: { status: "configured" },
							openai: { status: "not_configured" },
							google: { status: "not_configured" },
						},
					};
				}
				return { status: "healthy" };
			},
		},
	});
	await page.goto("/settings/admin");

	await expect(page.getByText("System Health")).toBeVisible();
	await expect(page.getByText("healthy").first()).toBeVisible();
	await expect(page.getByText("Database")).toBeVisible();
	await expect(page.getByText("Embeddings")).toBeVisible();
});

test("system health shows degraded state with db down", async ({ page, mockApi }) => {
	await mockApi({
		routes: {
			...settingsRoutes,
			"/api/health": () => ({
				status: "degraded",
				db: { status: "down" },
				embeddings: { status: "ready" },
				providers: {},
			}),
		},
	});
	await page.goto("/settings/admin");

	await expect(page.getByText("System Health")).toBeVisible();
	await expect(page.getByText("degraded")).toBeVisible();
	await expect(page.getByText("down")).toBeVisible();
});

test("system health handles error gracefully", async ({ page, mockApi }) => {
	await mockApi({ routes: settingsRoutes });

	await page.route("**/api/health**", (route) => {
		route.fulfill({ status: 401, json: { error: "Unauthorized" } });
	});

	await page.goto("/settings/admin");

	await expect(page.getByText("System Health")).toBeVisible();
	await expect(page.getByText("Unable to load health status.")).toBeVisible();
});
