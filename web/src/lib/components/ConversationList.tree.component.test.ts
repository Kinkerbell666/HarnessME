/**
 * Component-level DOM tests for ConversationList.svelte's fork-tree rendering.
 *
 * Covers what the pure-logic suite in
 * `web/src/lib/__tests__/conversation-grouping.test.ts` cannot:
 *   - the chevron renders only when a family has forks
 *   - clicking the chevron flips its accessible name (Expand ↔ Collapse) and
 *     hides/shows the indented fork rows
 *   - fork rows carry the deeper indent class (`pl-10`) past the parent's
 *     `pl-7` chevron-gutter baseline, and render the "↳" connector glyph
 *   - collapse state persists to localStorage under the documented key
 *   - an unread fork inside a collapsed family bubbles up as a badge on the
 *     parent row
 */

import "@testing-library/jest-dom/vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { tick } from "svelte";
import type { Conversation } from "$lib/api.js";

// Mock the API module BEFORE importing the component — fetchConversations runs
// in $effect on mount and would otherwise try to hit the network.
// vi.mock() is hoisted to the top of the file, so the spies must be
// pre-declared via vi.hoisted() to be visible inside the factory.
const apiMocks = vi.hoisted(() => ({
	fetchConversations: vi.fn(),
	deleteConversation: vi.fn(async () => {}),
	updateConversation: vi.fn(async () => ({}) as unknown),
	searchConversations: vi.fn(async () => []),
}));

vi.mock("$lib/api.js", () => apiMocks);

const { fetchConversations, deleteConversation, updateConversation, searchConversations } = apiMocks;

import ConversationList from "./ConversationList.svelte";
import { unreadStore } from "$lib/unread.js";
import { notifyConversationsChanged } from "$lib/stores.svelte.js";

const COLLAPSE_LS_KEY = "chatList.collapsedFamilies";
const UNREAD_LS_KEY = "ez-unread-conversations";

const NOW = Date.now();

function conv(over: Partial<Conversation> & { id: string }): Conversation {
	return {
		id: over.id,
		projectId: "p1",
		title: over.title ?? over.id,
		model: null,
		provider: null,
		systemPrompt: null,
		agentConfigId: null,
		modeId: null,
		test: null,
		parentConversationId: null,
		parentMessageId: null,
		forkedFromConversationId: over.forkedFromConversationId ?? null,
		forkedFromMessageId: over.forkedFromMessageId ?? null,
		createdAt: over.createdAt ?? new Date(NOW - 3_600_000).toISOString(),
		updatedAt: over.updatedAt ?? new Date(NOW - 3_600_000).toISOString(),
	};
}

function renderList(conversations: Conversation[]) {
	fetchConversations.mockResolvedValue(conversations);
	return render(ConversationList, {
		projectId: "p1",
		activeConversationId: undefined,
		oncreate: () => {},
		onselect: () => {},
	});
}

beforeEach(() => {
	localStorage.clear();
	unreadStore._reset();
	fetchConversations.mockReset();
	deleteConversation.mockReset();
	updateConversation.mockReset();
	searchConversations.mockReset();
});

afterEach(() => cleanup());

describe("ConversationList — fork tree rendering", () => {
	test("project-scoped changes refresh this list and unscoped changes refresh every list", async () => {
		const view = renderList([conv({ id: "chat", title: "Before rename" })]);
		await view.findByText("Before rename");
		const initialFetches = fetchConversations.mock.calls.length;

		// A change in another project must leave the open list untouched.
		notifyConversationsChanged("other-project");
		expect(fetchConversations).toHaveBeenCalledTimes(initialFetches);

		// The same event contract is used by the sidebar and full list. A
		// matching project refresh must show the new title without navigation.
		fetchConversations.mockResolvedValue([conv({ id: "chat", title: "After rename" })]);
		notifyConversationsChanged("p1");
		await view.findByText("After rename");
		expect(fetchConversations).toHaveBeenCalledTimes(initialFetches + 1);

		// An omitted project id announces a global change to every list.
		notifyConversationsChanged();
		await waitFor(() => expect(fetchConversations).toHaveBeenCalledTimes(initialFetches + 2));
	});

	test("a family with forks renders one chevron in its open state by default", async () => {
		const parent = conv({ id: "p", title: "Parent Chat", updatedAt: new Date(NOW - 5 * 3_600_000).toISOString() });
		const fork = conv({
			id: "f1",
			title: "Forked: a path",
			forkedFromConversationId: "p",
			updatedAt: new Date(NOW - 1 * 3_600_000).toISOString(),
		});
		const { findByRole, queryByRole } = renderList([parent, fork]);

		// Default state is expanded — chevron has the "Collapse forks" label.
		await findByRole("button", { name: "Collapse forks" });
		expect(queryByRole("button", { name: "Expand forks" })).toBeNull();
	});

	test("a family with no forks renders no chevron at all", async () => {
		const lone = conv({ id: "lone", title: "Lone Chat", updatedAt: new Date(NOW - 2 * 3_600_000).toISOString() });
		const { queryByRole, findByText } = renderList([lone]);

		await findByText("Lone Chat");
		expect(queryByRole("button", { name: /(Collapse|Expand) forks/ })).toBeNull();
	});

	test("root rows reserve a chevron gutter (pl-7); fork rows step in further (pl-10) plus the ↳ glyph", async () => {
		const parent = conv({ id: "p", title: "Parent Chat" });
		const fork = conv({ id: "f1", title: "Forked: a path", forkedFromConversationId: "p" });
		const { findByText, getAllByText } = renderList([parent, fork]);

		const forkRowText = await findByText("Forked: a path");
		// Walk up to the <button> the title sits inside.
		const forkButton = forkRowText.closest("button");
		expect(forkButton).not.toBeNull();
		// pl-10 takes precedence over pl-7 thanks to Tailwind's source order.
		expect(forkButton!.className).toMatch(/\bpl-10\b/);
		expect(forkButton!.className).toMatch(/\bpl-7\b/);

		const parentRowText = await findByText("Parent Chat");
		const parentButton = parentRowText.closest("button");
		expect(parentButton).not.toBeNull();
		// Root rows always reserve the chevron gutter — pl-7 yes, pl-10 no.
		expect(parentButton!.className).toMatch(/\bpl-7\b/);
		expect(parentButton!.className).not.toMatch(/\bpl-10\b/);

		// The ↳ glyph is present once per fork (here: 1).
		expect(getAllByText("↳")).toHaveLength(1);
	});

	test("clicking the chevron hides forks, flips its label, and persists collapsed-state to localStorage", async () => {
		const parent = conv({ id: "p", title: "Parent Chat" });
		const fork = conv({ id: "f1", title: "Forked: a path", forkedFromConversationId: "p" });
		const { findByRole, getByRole, queryByText, findByText } = renderList([parent, fork]);

		// Expanded by default — fork visible.
		await findByText("Forked: a path");

		// Toggle collapse.
		const chevron = await findByRole("button", { name: "Collapse forks" });
		await fireEvent.click(chevron);

		// Fork row gone; chevron now reads "Expand forks".
		await waitFor(() => {
			expect(queryByText("Forked: a path")).toBeNull();
		});
		getByRole("button", { name: "Expand forks" });

		// Collapse persisted under the documented key.
		const raw = localStorage.getItem(COLLAPSE_LS_KEY);
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw!)).toEqual(["p"]);
	});

	test("re-mounting the component picks up the persisted collapse-state", async () => {
		// Pre-seed collapsed-state for the family rooted at "p".
		localStorage.setItem(COLLAPSE_LS_KEY, JSON.stringify(["p"]));

		const parent = conv({ id: "p", title: "Parent Chat" });
		const fork = conv({ id: "f1", title: "Forked: a path", forkedFromConversationId: "p" });
		const { findByRole, queryByText, findByText } = renderList([parent, fork]);

		// Parent visible.
		await findByText("Parent Chat");

		// Chevron is in its closed state immediately, fork is not in the DOM.
		await findByRole("button", { name: "Expand forks" });
		expect(queryByText("Forked: a path")).toBeNull();
	});

	test("unread fork inside a collapsed family surfaces a count badge on the parent row", async () => {
		// Arrange: mark the fork unread BEFORE render so the store snapshot
		// the component reads at mount already includes it.
		unreadStore.markUnread("f1", "p1");

		// Pre-collapse so the badge logic kicks in (hidden forks bubble up).
		localStorage.setItem(COLLAPSE_LS_KEY, JSON.stringify(["p"]));

		const parent = conv({ id: "p", title: "Parent Chat" });
		const fork = conv({ id: "f1", title: "Forked: a path", forkedFromConversationId: "p" });
		const { findByText, findByTitle } = renderList([parent, fork]);

		await findByText("Parent Chat");

		// Badge title is "1 unread fork" (from the snippet's `unreadBadgeCount` template).
		const badge = await findByTitle("1 unread fork");
		expect(badge.textContent).toContain("1");

		// Cleanup: clear unread store so it doesn't leak into other tests.
		unreadStore.markRead("f1");
		localStorage.removeItem(UNREAD_LS_KEY);
	});

	test("expanded families do NOT show the unread roll-up badge (each fork shows its own dot instead)", async () => {
		unreadStore.markUnread("f1", "p1");

		const parent = conv({ id: "p", title: "Parent Chat" });
		const fork = conv({ id: "f1", title: "Forked: a path", forkedFromConversationId: "p" });
		const { findByText, queryByTitle } = renderList([parent, fork]);

		await findByText("Forked: a path");
		// No roll-up badge because the family is expanded.
		expect(queryByTitle(/unread fork/)).toBeNull();

		unreadStore.markRead("f1");
		localStorage.removeItem(UNREAD_LS_KEY);
	});

	test("parent rows with forks render a fork-count badge with the git-branch icon (visible regardless of collapse)", async () => {
		const parent = conv({ id: "p", title: "Parent Chat" });
		const f1 = conv({ id: "f1", title: "Forked: A", forkedFromConversationId: "p" });
		const f2 = conv({ id: "f2", title: "Forked: B", forkedFromConversationId: "p" });
		const { findByText, getByTestId, queryAllByTestId } = renderList([parent, f1, f2]);

		await findByText("Parent Chat");
		// Exactly one badge — on the parent row, not on either fork row.
		expect(queryAllByTestId("fork-count-badge")).toHaveLength(1);
		const badge = getByTestId("fork-count-badge");
		expect(badge.textContent).toContain("2");
		// Tooltip uses plural for >1 forks.
		expect(badge.getAttribute("title")).toBe("2 forks");
		expect(badge.getAttribute("aria-label")).toBe("2 forks");
	});

	test("fork-count badge stays visible when the family is collapsed (the whole point of the icon)", async () => {
		// Pre-collapse so we test the collapsed state.
		localStorage.setItem(COLLAPSE_LS_KEY, JSON.stringify(["p"]));

		const parent = conv({ id: "p", title: "Parent Chat" });
		const f1 = conv({ id: "f1", title: "Forked: A", forkedFromConversationId: "p" });
		const { findByText, getByTestId, queryByText } = renderList([parent, f1]);

		await findByText("Parent Chat");
		// Forks are hidden …
		expect(queryByText("Forked: A")).toBeNull();
		// … but the fork-count badge on the parent stays put so the user knows
		// this row has hidden descendants.
		const badge = getByTestId("fork-count-badge");
		expect(badge.textContent).toContain("1");
		expect(badge.getAttribute("title")).toBe("1 fork");
	});

	test("a chat with no forks renders no fork-count badge", async () => {
		const lone = conv({ id: "lone", title: "Lone Chat" });
		const { findByText, queryByTestId } = renderList([lone]);

		await findByText("Lone Chat");
		expect(queryByTestId("fork-count-badge")).toBeNull();
	});

	test("fork rows themselves do NOT render their own fork-count badge", async () => {
		// The badge belongs to the family root, not to forks. Even if a fork
		// could in theory have its own forks, this implementation flattens to
		// the ultimate root, so only the root row should ever show the badge.
		const parent = conv({ id: "p", title: "Parent Chat" });
		const fork = conv({ id: "f1", title: "Forked: a path", forkedFromConversationId: "p" });
		const { findByText, queryAllByTestId } = renderList([parent, fork]);

		await findByText("Forked: a path");
		// Only the parent row gets a badge — exactly one in the tree.
		expect(queryAllByTestId("fork-count-badge")).toHaveLength(1);
	});
});

describe("ConversationList — overlapping loads", () => {
	test("a slow load for the previous project never replaces the current project's list", async () => {
		let resolveOld: (rows: Conversation[]) => void = () => { throw new Error("Old load was not started"); };
		fetchConversations.mockImplementation((projectId: string) =>
			projectId === "p1"
				? new Promise<Conversation[]>((resolve) => { resolveOld = resolve; })
				: Promise.resolve([conv({ id: "b", title: "Project two chat" })]),
		);
		const view = render(ConversationList, { projectId: "p1", oncreate: () => {}, onselect: () => {} });
		await view.rerender({ projectId: "p2", oncreate: () => {}, onselect: () => {} });
		await view.findByText("Project two chat");

		resolveOld([conv({ id: "a", title: "Project one chat" })]);
		// The old load's continuation is queued first, so two ticks settle it.
		await tick();
		await tick();
		expect(view.queryByText("Project one chat")).toBeNull();
		expect(view.getByText("Project two chat")).toBeInTheDocument();
	});

	test("a next page still loading when the list reloads is dropped, not appended", async () => {
		let reportIntersecting: () => void = () => { throw new Error("Observer was not created"); };
		vi.stubGlobal("IntersectionObserver", class {
			constructor(callback: IntersectionObserverCallback) {
				reportIntersecting = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
			}
			observe() {}
			disconnect() {}
		});
		try {
			const firstPage = Array.from({ length: 30 }, (_, i) => conv({ id: `c${i}`, title: `Chat ${i}` }));
			let resolveNextPage: (rows: Conversation[]) => void = () => { throw new Error("Next page was not requested"); };
			fetchConversations.mockImplementation((_projectId: string, opts?: { offset?: number }) =>
				opts?.offset ? new Promise<Conversation[]>((resolve) => { resolveNextPage = resolve; }) : Promise.resolve(firstPage),
			);
			const view = render(ConversationList, { projectId: "p1", oncreate: () => {}, onselect: () => {} });
			await view.findByText("Chat 0");

			reportIntersecting();
			await waitFor(() => expect(fetchConversations).toHaveBeenCalledWith("p1", { limit: 30, offset: 30 }));
			notifyConversationsChanged("p1");
			await tick();

			resolveNextPage([conv({ id: "stale", title: "Stale next page" })]);
			await tick();
			await tick();
			expect(view.queryByText("Stale next page")).toBeNull();
			expect(view.getByText("Chat 0")).toBeInTheDocument();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
