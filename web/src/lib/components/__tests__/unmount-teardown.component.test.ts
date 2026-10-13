/**
 * Work a component starts must end when it unmounts.
 *
 * Components that read a shared, app-lifetime store must drop their
 * subscription when they unmount. A subscription made at script top level
 * (outside `$effect` / `$store`) is never released: every mount adds one more
 * listener that keeps the dead component's state alive and keeps writing to it.
 *
 * Each case spies on the store's `subscribe`, mounts the real component,
 * unmounts it, and requires that every unsubscribe it was handed has run.
 */
import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Component } from "svelte";
import { SUGGEST_DEBOUNCE_MS } from "$lib/composer-suggest-logic";
import { unreadStore } from "$lib/unread.js";
import { connectionState } from "$lib/stores/connection";
import ProjectRail from "../ProjectRail.svelte";
import ConnectionBanner from "../chat/ConnectionBanner.svelte";
import ConversationList from "../ConversationList.svelte";
import ChatInput from "../ChatInput.svelte";

vi.mock("$lib/api.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/api.js")>()),
	fetchConversations: vi.fn(async () => []),
}));

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

type Subscribable = { subscribe: (...args: never[]) => () => unknown };

/** Wrap `subscribe` so each returned unsubscribe is a spy that still unsubscribes. */
function trackSubscriptions(target: Subscribable) {
	const original = target.subscribe.bind(target) as (...args: unknown[]) => () => unknown;
	const offs: ReturnType<typeof vi.fn>[] = [];
	vi.spyOn(target, "subscribe").mockImplementation(((...args: unknown[]) => {
		const off = vi.fn(original(...args));
		offs.push(off);
		return off;
	}) as never);
	return offs;
}

const cases: { name: string; store: Subscribable; component: Component<any>; props: Record<string, unknown> }[] = [
	{ name: "ProjectRail (unread store)", store: unreadStore, component: ProjectRail, props: {} },
	{
		name: "ConversationList (unread store)",
		store: unreadStore,
		component: ConversationList,
		props: { projectId: "p1", oncreate: () => {}, onselect: () => {} },
	},
	{ name: "ConnectionBanner (connection store)", store: connectionState, component: ConnectionBanner, props: {} },
	{ name: "ChatInput (connection store)", store: connectionState, component: ChatInput, props: { onsubmit: () => {} } },
];

describe("shared-store subscriptions end with the component", () => {
	test.each(cases)("$name", ({ store, component, props }) => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
		const offs = trackSubscriptions(store);
		const view = render(component, props);
		expect(offs.length).toBeGreaterThan(0);
		view.unmount();
		for (const off of offs) expect(off).toHaveBeenCalled();
	});
});

describe("ChatInput timers end with the component", () => {
	test("a suggestion fetch still debouncing at unmount never fires", async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response("[]", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const view = render(ChatInput, { onsubmit: () => {}, selectedModel: { provider: "p", model: "m" } });
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "Summarize the open pull requests" } });
		view.unmount();
		await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS * 2);
		const urls = fetchMock.mock.calls.map(([input]) => String(input));
		expect(urls).not.toContain("/api/composer/suggest");
	});
});
