/**
 * An extension's message-toolbar button posts its event and leaves the
 * browser console alone: no debug trace of message ids, conversation ids,
 * or the extension's response body on every click.
 */
import { render, cleanup, fireEvent, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ChatMessage from "./ChatMessage.svelte";
import { extensionToolbarStore } from "$lib/stores/extension-toolbar.svelte.js";
import type { Message } from "$lib/api.js";

const toolbarItem = { extName: "tts", id: "speak", icon: "Volume2", tooltip: "Read aloud", event: "speak" };

const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
	const url = String(input);
	const body = url.endsWith("/extension-toolbar") ? { items: [toolbarItem] } : {};
	return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
});

beforeEach(() => {
	extensionToolbarStore.reset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	cleanup();
	fetchMock.mockClear();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const message: Message = {
	id: "msg-1",
	conversationId: "conv-1",
	role: "assistant",
	content: "Hello there",
	thinkingContent: null,
	model: null,
	provider: null,
	usage: null,
	runId: "run-1",
	parentMessageId: null,
	excluded: false,
	createdAt: "2026-05-04T00:00:00.000Z",
};

describe("ChatMessage extension toolbar action", () => {
	test("posts the event without writing to the console", async () => {
		const info = vi.spyOn(console, "info");
		const warn = vi.spyOn(console, "warn");
		const { findByTestId } = render(ChatMessage, { message, conversationId: "conv-1" });
		await fireEvent.click(await findByTestId("ext-action-tts-speak"));
		await waitFor(() =>
			expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain("/api/extensions/tts/events/speak"),
		);
		expect(info).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});
});
