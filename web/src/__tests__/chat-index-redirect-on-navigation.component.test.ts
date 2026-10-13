/**
 * The chat index (`/project/[id]/chat`) jumps to your last chat on desktop,
 * except on the all-chats page (`?all=1`). SvelteKit REUSES this page
 * component when only the query or the `[id]` param changes, so the redirect
 * must follow navigation, not run once on mount. Otherwise the sidebar's
 * "Chat" label, clicked from "All chats", lands on the empty state
 * ("No conversations yet") although the project has chats.
 */
import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as appState from "$app/state";

const { gotoMock, fetchConversations } = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	fetchConversations: vi.fn(),
}));

vi.mock("$app/state", async () => await import("./stubs/reactive-app-state.svelte.js"));
vi.mock("$app/navigation", () => ({ goto: gotoMock }));
vi.mock("$lib/api.js", () => ({
	createConversation: vi.fn(async () => ({ id: "new" })),
	fetchConversations,
	fetchConversation: vi.fn(async () => null),
}));
vi.mock("$lib/components/ConversationList.svelte", async () => {
	const stub = await import("./fixtures/ConversationListStub.svelte");
	return { default: stub.default };
});
vi.mock("$lib/components/EmptyState.svelte", async () => await import("./stubs/empty-component.js"));
vi.mock("$lib/components/chat/NoProviderBanner.svelte", async () => await import("./stubs/empty-component.js"));
vi.mock("$lib/components/ProjectRail.svelte", async () => await import("./stubs/empty-component.js"));

import ChatIndexPage from "../routes/(app)/project/[id]/chat/+page.svelte";

const { page, navigate } = appState as unknown as {
	page: { params: Record<string, string> };
	navigate(pathname: string): void;
};

beforeEach(() => {
	gotoMock.mockReset();
	localStorage.clear();
	fetchConversations.mockReset().mockImplementation(async (projectId: string) =>
		projectId === "p2" ? [{ id: "c2" }] : [{ id: "c1" }],
	);
	window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
});

describe("chat index redirect follows same-route navigation", () => {
	test("leaving All chats for plain /chat jumps to the most recent chat", async () => {
		page.params = { id: "p1" };
		navigate("/project/p1/chat?all=1");
		const view = render(ChatIndexPage);
		await view.findAllByTestId("conversation-list-stub");
		expect(gotoMock).not.toHaveBeenCalled();

		navigate("/project/p1/chat");
		await waitFor(() =>
			expect(gotoMock).toHaveBeenCalledWith("/project/p1/chat/c1", { replaceState: true }),
		);
	});

	test("switching project on the index looks up the NEW project's chats", async () => {
		fetchConversations.mockImplementation(async (projectId: string) =>
			projectId === "p2" ? [{ id: "c2" }] : [],
		);
		page.params = { id: "p1" };
		navigate("/project/p1/chat");
		render(ChatIndexPage);
		await waitFor(() => expect(fetchConversations).toHaveBeenCalledWith("p1", { limit: 1 }));
		expect(gotoMock).not.toHaveBeenCalled();

		page.params = { id: "p2" };
		navigate("/project/p2/chat");
		await waitFor(() =>
			expect(gotoMock).toHaveBeenCalledWith("/project/p2/chat/c2", { replaceState: true }),
		);
	});
});
