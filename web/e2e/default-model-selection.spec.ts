import { test, expect, captureEvidence } from "./fixtures/test-base.js";
import { sendComposerMessage } from "./fixtures/composer.js";
import { makeProject, makeConversation, makeMessage } from "./fixtures/data.js";

/**
 * @evidence — the unset-user default is Auto (smart routing).
 *
 * Before this, a user with no saved selection was auto-pinned to `models[0]`,
 * and a pinned model is NEVER routed — which is why the routing engine sat
 * idle. The composer now defaults to the Auto sentinel, so the first turn of a
 * fresh thread is routed server-side.
 *
 * RENDER-level spec (mockApi; no Docker). Three properties:
 *
 * 1. Fresh conversation, no saved pick → the picker button reads
 *    "Auto (smart routing)" with no model auto-pinned over it, and the send
 *    wire carries the EXPLICIT `model: null, provider: null` sentinel.
 * 2. The operator revert — `provider:defaultSelection = "first"` — restores
 *    the pre-routing default (`models[0]` pinned, no Auto label).
 * 3. The cache invariant: a thread whose last turn was auto-routed
 *    (`usage.requestedModel === null`) stays on Auto in the picker but sends
 *    the SERVED pair, so turn 2 is not re-routed (route once per thread).
 *
 * `/api/models/default-selection` is registered AFTER `mockApi` so it takes
 * precedence over the fixture's generic catch-all.
 */

const proj = makeProject({ id: "p-def" });

/** The first entry of the api-mocks `/api/models` list — what the "first"
 *  mode pins, and what the pre-routing code pinned. */
const FIRST_MODEL_LABEL = "Claude Sonnet 4";

async function stubDefaultSelection(
	page: import("@playwright/test").Page,
	value: "auto" | "first",
) {
	await page.route("**/api/models/default-selection", (route) =>
		route.fulfill({ json: { value } }),
	);
}

/** Capture the send POST for a conversation and answer it with a minimal
 *  well-formed body. Returns a getter for the parsed request body. */
async function captureSend(page: import("@playwright/test").Page, convId: string) {
	const seen: { body: Record<string, unknown> | null } = { body: null };
	await page.route(`**/api/conversations/${convId}/messages`, (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		seen.body = route.request().postDataJSON() as Record<string, unknown>;
		return route.fulfill({
			json: {
				userMessage: {
					id: "sent-1",
					conversationId: convId,
					role: "user",
					content: (seen.body?.content as string) ?? "sent",
					thinkingContent: null,
					model: null,
					provider: null,
					usage: null,
					runId: null,
					parentMessageId: null,
					excluded: false,
					createdAt: new Date().toISOString(),
				},
				runId: "run-def-1",
				attachments: [],
				ezActionResults: [],
			},
		});
	});
	return seen;
}

test.describe("@evidence default model selection", () => {
	test("a fresh conversation defaults to Auto and routes turn 1", async ({
		page,
		mockApi,
	}, testInfo) => {
		const conv = makeConversation({ id: "D1", projectId: "p-def", title: "Fresh Chat" });
		await mockApi({ projects: [proj], conversations: [conv], messages: [] });
		await page.route("**/api/conversations/*/active-run", (route) =>
			route.fulfill({ json: { runId: null, status: "none" } }),
		);
		await stubDefaultSelection(page, "auto");
		const sent = await captureSend(page, "D1");

		await page.goto("/project/p-def/chat/D1", { waitUntil: "networkidle" });

		// The composer defaults to Auto — NOT the first model in the list.
		const selector = page.getByTestId("model-selector");
		await expect(selector).toContainText("Auto (smart routing)", { timeout: 5000 });
		await expect(selector).not.toContainText(FIRST_MODEL_LABEL);

		// Turn-1 attachments must still work. Auto has no concrete model, so the
		// server answers capabilities with the INTERSECTION of the tier ladder;
		// without that the paperclip would be hidden on EVERY new conversation
		// now that Auto is the default. This is the regression guard.
		await expect(page.getByTestId("attachment-button")).toBeVisible({ timeout: 5000 });

		await captureEvidence(page, testInfo, "default-model-selection-auto");

		// Turn 1 goes out with the explicit-null sentinel → the server routes it.
		await sendComposerMessage(page, "route my very first turn");

		await expect.poll(() => sent.body).not.toBeNull();
		expect(sent.body!.model).toBeNull();
		expect(sent.body!.provider).toBeNull();
		expect("model" in sent.body!).toBe(true);
		expect("provider" in sent.body!).toBe(true);
	});

	test('the "first" revert restores the pinned models[0] default', async ({
		page,
		mockApi,
	}, testInfo) => {
		const conv = makeConversation({ id: "D2", projectId: "p-def", title: "Reverted Chat" });
		await mockApi({ projects: [proj], conversations: [conv], messages: [] });
		await page.route("**/api/conversations/*/active-run", (route) =>
			route.fulfill({ json: { runId: null, status: "none" } }),
		);
		await stubDefaultSelection(page, "first");
		const sent = await captureSend(page, "D2");

		await page.goto("/project/p-def/chat/D2", { waitUntil: "networkidle" });

		// models[0] is pinned exactly as it was before routing shipped.
		const selector = page.getByTestId("model-selector");
		await expect(selector).toContainText(FIRST_MODEL_LABEL, { timeout: 5000 });
		await expect(selector).not.toContainText("Auto (smart routing)");

		await captureEvidence(page, testInfo, "default-model-selection-first");

		// …and the pinned pair rides the wire, so nothing is routed.
		await sendComposerMessage(page, "keep me pinned");

		await expect.poll(() => sent.body).not.toBeNull();
		expect(sent.body!.provider).toBe("anthropic");
		expect(sent.body!.model).toBe("claude-sonnet-4-20250514");
	});

	test("an already-routed thread stays on Auto but re-sends the SERVED model", async ({
		page,
		mockApi,
	}, testInfo) => {
		// The conversation row carries no model (the pin write is the server's
		// job and is irrelevant here) but its last assistant turn was routed —
		// `usage.requestedModel === null` is the provenance the runtime persists.
		const conv = makeConversation({ id: "D3", projectId: "p-def", title: "Routed Chat" });
		const messages = [
			makeMessage({
				id: "u1",
				conversationId: "D3",
				role: "user",
				content: "turn one",
				parentMessageId: null,
			}),
			makeMessage({
				id: "a1",
				conversationId: "D3",
				role: "assistant",
				content: "served by the router",
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				parentMessageId: "u1",
				usage: {
					inputTokens: 100,
					outputTokens: 20,
					requestedProvider: null,
					requestedModel: null,
					routedTier: "balanced",
				},
			}),
		];
		await mockApi({ projects: [proj], conversations: [conv], messages });
		await page.route("**/api/conversations/*/active-run", (route) =>
			route.fulfill({ json: { runId: "r-done", status: "completed" } }),
		);
		await stubDefaultSelection(page, "auto");
		const sent = await captureSend(page, "D3");

		await page.goto("/project/p-def/chat/D3", { waitUntil: "networkidle" });
		await expect(page.getByText("served by the router")).toBeVisible({ timeout: 5000 });

		// Still Auto — with the served model surfaced in the label.
		const selector = page.getByTestId("model-selector");
		await expect(selector).toContainText("Auto →", { timeout: 5000 });

		await captureEvidence(page, testInfo, "default-model-selection-auto-served");

		// Turn 2 carries the SERVED pair, not the null sentinel: the thread is
		// routed ONCE, so the warm prompt-cache prefix survives.
		await sendComposerMessage(page, "turn two");

		await expect.poll(() => sent.body).not.toBeNull();
		expect(sent.body!.provider).toBe("anthropic");
		expect(sent.body!.model).toBe("claude-sonnet-4-20250514");
	});

	test("a failed model list stops retrying once you leave the chat", async ({ page, mockApi }) => {
		const conv = makeConversation({ id: "D4", projectId: "p-def", title: "Models down" });
		await mockApi({ projects: [proj], conversations: [conv], messages: [] });
		await stubDefaultSelection(page, "auto");
		let modelRequests = 0;
		await page.route("**/api/models", (route) => {
			modelRequests++;
			return route.fulfill({ status: 503, body: "down" });
		});
		// Fast-forward the picker's 1s/2s backoff instead of sleeping through it.
		await page.clock.install();

		const firstFailure = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/models");
		await page.goto("/project/p-def/chat/D4");
		await firstFailure;
		const before = modelRequests;

		// Leave the chat in-app: the composer and its picker unmount.
		await page.getByRole("link", { name: "Memories" }).first().click();
		await expect(page).toHaveURL(/\/memories/);
		await page.clock.runFor(10_000);

		expect(modelRequests).toBe(before);
		await expect(page.getByText("Failed to load models")).toHaveCount(0);
	});
});
