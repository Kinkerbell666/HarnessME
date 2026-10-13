import { test, expect, captureEvidence } from "./fixtures/test-base.js";
import AxeBuilder from "@axe-core/playwright";
import { makeProject, makeConversation, makeMessage } from "./fixtures/data.js";

/**
 * Chat threads live in the sidebar's "Chat" section now — the separate 280px
 * conversation column is gone on desktop, so the conversation gets that width.
 *
 * Pins, in a real browser:
 *   - the section opens by itself in Chat, lists the recent threads, and
 *     highlights the open one — with NO desktop conversation column;
 *   - clicking a thread moves you and the highlight;
 *   - "All chats" lands on the full list at full width and does NOT get
 *     bounced by the index page's redirect to the last chat — and is offered
 *     even with only a few chats, since search, rename and delete live there;
 *   - plain /chat still redirects to your last chat (unchanged) — also when
 *     you come to it from "All chats", where SvelteKit reuses the page;
 *   - "+ New chat" creates one and it appears in the section;
 *   - collapsing is remembered across a reload.
 */

const proj = makeProject({ id: "proj-1", name: "Test Project" });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const conversations = [
	makeConversation({ id: "conv-1", projectId: "proj-1", title: "Is this program able to run local models?", updatedAt: minutesAgo(1), createdAt: minutesAgo(1) }),
	makeConversation({ id: "conv-2", projectId: "proj-1", title: "hello", updatedAt: minutesAgo(5), createdAt: minutesAgo(5) }),
	makeConversation({ id: "conv-3", projectId: "proj-1", title: "Planning the installer", updatedAt: minutesAgo(60 * 24 * 3), createdAt: minutesAgo(60 * 24 * 3) }),
];
const messages = [
	makeMessage({ id: "m1", conversationId: "conv-2", role: "user", content: "hello" }),
	makeMessage({ id: "m2", conversationId: "conv-2", role: "assistant", parentMessageId: "m1", content: "Hi! How can I help?" }),
];

function setup() {
	return { projects: [proj], conversations: conversations.map((c) => ({ ...c })), messages };
}

// Desktop only, by condition: this is the desktop sidebar, where the threads
// replaced a desktop-only column. On mobile the same section lives inside the
// closed-by-default nav drawer and the conversation list is unchanged (the
// chat page's own swipe-in drawer), covered by mobile-navigation.spec.ts.
test.skip(({ isMobile }) => isMobile, "desktop sidebar — mobile keeps its drawers");

const section = (page: import("@playwright/test").Page) => page.getByTestId("chat-nav-section").first();
const threadRow = (page: import("@playwright/test").Page, id: string) =>
	section(page).locator(`[data-testid="chat-nav-thread"][data-conversation-id="${id}"]`);

for (const colorScheme of ["light", "dark"] as const) {
	test(`threads live in the sidebar and the conversation gets the full width (${colorScheme}) @evidence`, async ({ page, mockApi }, testInfo) => {
		await mockApi(setup());
		await page.emulateMedia({ colorScheme });
		await page.goto("/project/proj-1/chat/conv-2");

		await expect(section(page).getByTestId("chat-nav-toggle")).toHaveAttribute("aria-expanded", "true");
		await expect(section(page).getByTestId("chat-nav-thread")).toHaveCount(3);
		await expect(threadRow(page, "conv-2")).toHaveAttribute("aria-current", "page");
		await expect(section(page).getByTestId("chat-nav-group")).toHaveText(["Today", "Previous 7 Days"]);

		// The old second column is gone on desktop.
		await expect(page.getByRole("navigation", { name: "Conversations" })).toBeHidden();
		await expect(page.getByText("Hi! How can I help?")).toBeVisible();

		const accessibility = await new AxeBuilder({ page }).include('[data-testid="chat-nav-section"]').analyze();
		expect(accessibility.violations).toEqual([]);
		await captureEvidence(page, testInfo, `chat-sidebar-threads-${colorScheme}`);
	});
}

test("clicking a thread in the sidebar opens it and moves the highlight", async ({ page, mockApi }) => {
	await mockApi(setup());
	await page.goto("/project/proj-1/chat/conv-2");
	await threadRow(page, "conv-1").click();
	await expect(page).toHaveURL(/\/project\/proj-1\/chat\/conv-1$/);
	await expect(threadRow(page, "conv-1")).toHaveAttribute("aria-current", "page");
	await expect(threadRow(page, "conv-2")).not.toHaveAttribute("aria-current", "page");
});

test("Show all opens the full list at full width, without being redirected @evidence", async ({ page, mockApi }, testInfo) => {
	// More than the sidebar shows, so "Show all" is offered.
	const many = Array.from({ length: 10 }, (_, i) =>
		makeConversation({ id: `many-${i}`, projectId: "proj-1", title: `Thread ${i}`, updatedAt: minutesAgo(i + 1), createdAt: minutesAgo(i + 1) }),
	);
	await mockApi({ projects: [proj], conversations: many, messages: [] });
	await page.goto("/project/proj-1/chat/many-0");

	await expect(section(page).getByTestId("chat-nav-thread")).toHaveCount(8);
	await section(page).getByTestId("chat-nav-show-all").click();

	await expect(page).toHaveURL(/\/project\/proj-1\/chat\?all=1$/);
	const list = page.getByRole("navigation", { name: "Conversations" });
	await expect(list).toBeVisible();
	await expect(list.getByText("Thread 9")).toBeVisible();
	// Full width, not the old 280px column.
	const box = await list.boundingBox();
	expect(box?.width ?? 0).toBeGreaterThan(500);
	await captureEvidence(page, testInfo, "chat-show-all");
});

test("with only a few chats, All chats is still reachable — it is where search, rename and delete live", async ({ page, mockApi }) => {
	await mockApi(setup());
	await page.goto("/project/proj-1/chat/conv-2");
	await expect(section(page).getByTestId("chat-nav-thread")).toHaveCount(3);
	await section(page).getByTestId("chat-nav-show-all").click();
	await expect(page).toHaveURL(/\/project\/proj-1\/chat\?all=1$/);
	await expect(page.getByRole("navigation", { name: "Conversations" }).getByTitle("Search conversations")).toBeVisible();
});

test("an empty project can still open All chats and create its first thread", async ({ page, mockApi }) => {
	await mockApi({ projects: [proj], conversations: [], messages: [] });
	await page.goto("/project/proj-1/chat");
	await expect(section(page).getByTestId("chat-nav-empty")).toBeVisible();
	await section(page).getByTestId("chat-nav-show-all").click();
	await expect(page).toHaveURL(/\/project\/proj-1\/chat\?all=1$/);
	await page.getByRole("navigation", { name: "Conversations" }).getByRole("button", { name: /New chat/i }).click();
	await expect(page).toHaveURL(/\/project\/proj-1\/chat\/new-conv$/);
	await expect(threadRow(page, "new-conv")).toHaveAttribute("aria-current", "page");
});

test("the full list creates a thread and refreshes the persistent sidebar", async ({ page, mockApi }) => {
	await mockApi(setup());
	await page.goto("/project/proj-1/chat/conv-2");
	await section(page).getByTestId("chat-nav-show-all").click();
	await expect(page).toHaveURL(/\/project\/proj-1\/chat\?all=1$/);
	await page.getByRole("navigation", { name: "Conversations" }).getByRole("button", { name: /New chat/i }).click();
	await expect(page).toHaveURL(/\/project\/proj-1\/chat\/new-conv$/);
	await expect(threadRow(page, "new-conv")).toHaveAttribute("aria-current", "page");
});

test("from All chats, the Chat label takes you back to your last chat @evidence", async ({ page, mockApi }, testInfo) => {
	await mockApi(setup());
	await page.goto("/project/proj-1/chat/conv-2");
	await section(page).getByTestId("chat-nav-show-all").click();
	await expect(page).toHaveURL(/\/project\/proj-1\/chat\?all=1$/);
	await expect(page.getByRole("navigation", { name: "Conversations" }).getByText("Planning the installer")).toBeVisible();

	// Same route, only `?all` changes: the page is reused, and it must decide
	// the redirect again rather than show "No conversations yet".
	await section(page).getByTestId("chat-nav-link").click();
	await expect(page).toHaveURL(/\/project\/proj-1\/chat\/conv-2$/);
	await expect(page.getByText("Hi! How can I help?")).toBeVisible();
	await expect(page.getByText("No conversations yet")).toBeHidden();
	await captureEvidence(page, testInfo, "chat-label-from-all-chats");
});

test("plain /chat still takes you to your most recent chat", async ({ page, mockApi }) => {
	await mockApi(setup());
	await page.goto("/project/proj-1/chat");
	await expect(page).toHaveURL(/\/project\/proj-1\/chat\/conv-1$/);
});

test("+ New chat creates a thread, opens it, and lists it", async ({ page, mockApi }) => {
	await mockApi(setup());
	await page.goto("/project/proj-1/chat/conv-2");
	await section(page).getByTestId("chat-nav-new").click();
	await expect(page).toHaveURL(/\/project\/proj-1\/chat\/new-conv/);
	const newId = page.url().split("/").pop()!;
	await expect(threadRow(page, newId)).toHaveAttribute("aria-current", "page");
	await expect(section(page).getByTestId("chat-nav-thread")).toHaveCount(4);
});

test("collapsing the section is remembered across a reload", async ({ page, mockApi }) => {
	await mockApi(setup());
	await page.goto("/project/proj-1/chat/conv-2");
	const toggle = section(page).getByTestId("chat-nav-toggle");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await expect(section(page).getByTestId("chat-nav-threads")).toHaveCount(0);
	await page.reload();
	await expect(section(page).getByTestId("chat-nav-toggle")).toHaveAttribute("aria-expanded", "false");
});
