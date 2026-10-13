import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { searchMentions } = vi.hoisted(() => ({ searchMentions: vi.fn() }));

vi.mock("$lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/api")>()),
	searchMentions,
}));
vi.mock("$lib/stores.svelte", () => ({ store: { activeProjectId: "project-1" } }));

import PanelChatInput from "./PanelChatInput.svelte";

beforeEach(() => searchMentions.mockReset().mockResolvedValue([]));

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

async function chooseAgent(input: HTMLElement) {
	searchMentions.mockResolvedValueOnce([{ name: "Reviewer", kind: "agent" }]);
	await fireEvent.input(input, { target: { value: "!agent:rev" } });
	await vi.advanceTimersByTimeAsync(200);
	expect(screen.getByRole("option", { name: /Reviewer/ })).toBeVisible();
	await fireEvent.keyDown(input, { key: "Enter" });
	await vi.advanceTimersByTimeAsync(20);
	expect((input as HTMLTextAreaElement).value.trim()).toBe("!Reviewer");
}

describe("PanelChatInput", () => {
	test("preserves immediate text after a mention across the next Svelte update", async () => {
		vi.useFakeTimers();
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		const onsubmit = vi.fn(async () => {});
		render(PanelChatInput, { onsubmit });
		const input = screen.getByRole<HTMLTextAreaElement>("combobox");
		await chooseAgent(input);
		const cursor = input.selectionStart;
		const draft = `${input.value.slice(0, cursor)}r${input.value.slice(cursor)}`;
		await fireEvent.input(input, { target: { value: draft } });
		input.setSelectionRange(cursor + 1, cursor + 1);
		for (const frame of frames) frame(0);
		expect(input.selectionStart).toBe(cursor + 1);
		await fireEvent.input(input, { target: { value: `${draft.slice(0, input.selectionStart)}eview this${draft.slice(input.selectionStart)}` } });
		await fireEvent.keyDown(input, { key: "Enter" });
		expect(onsubmit).toHaveBeenCalledWith("![agent:Reviewer] review this");
	});

	test("submits trimmed text from the real composer and clears it after success", async () => {
		const onsubmit = vi.fn(async () => {});
		render(PanelChatInput, { onsubmit });
		const input = screen.getByRole("combobox");
		await fireEvent.input(input, { target: { value: "  Inspect the failure  " } });
		await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		await waitFor(() => expect(onsubmit).toHaveBeenCalledWith("Inspect the failure"));
		expect(input).toHaveValue("");
	});

	test("restores text and exposes the send error when the receiving panel rejects it", async () => {
		const onsubmit = vi.fn(async () => { throw new Error("Agent is unavailable"); });
		render(PanelChatInput, { onsubmit });
		const input = screen.getByRole("combobox");
		await fireEvent.input(input, { target: { value: "Retry this" } });
		await fireEvent.keyDown(input, { key: "Enter" });
		await screen.findByText("Agent is unavailable");
		expect(input).toHaveValue("Retry this");
		expect(onsubmit).toHaveBeenCalledTimes(1);
	});

	test("searches mentions after its debounce and inserts the chosen token through keyboard navigation", async () => {
		vi.useFakeTimers();
		searchMentions.mockResolvedValueOnce([
			{ name: "Reviewer", description: "Checks changes", kind: "agent" },
		]);
		const onsubmit = vi.fn(async () => {});
		render(PanelChatInput, { onsubmit });
		const input = screen.getByRole("combobox");
		await fireEvent.input(input, { target: { value: "!agent:rev" } });
		await vi.advanceTimersByTimeAsync(200);
		await screen.findByRole("option", { name: /Reviewer/ });
		expect(searchMentions).toHaveBeenCalledWith("rev", "agent", "project-1");
		await fireEvent.keyDown(input, { key: "Enter" });
		// The composer keeps tokens compact in the DOM while preserving the
		// structured wire value that is sent to the parent.
		expect((input as HTMLTextAreaElement).value.trim()).toBe("!Reviewer");
		await fireEvent.keyDown(input, { key: "Enter" });
		expect(onsubmit).toHaveBeenCalledWith("![agent:Reviewer]");
	});

	test("a slow, older mention search never replaces the results of the newer query", async () => {
		vi.useFakeTimers();
		let resolveOld: (items: unknown[]) => void = () => { throw new Error("Old search was not started"); };
		searchMentions
			.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
			.mockResolvedValueOnce([{ name: "Reviewer", kind: "agent" }]);
		render(PanelChatInput, { onsubmit: vi.fn(async () => {}) });
		const input = screen.getByRole("combobox");
		await fireEvent.input(input, { target: { value: "!r" } });
		await vi.advanceTimersByTimeAsync(200);
		await fireEvent.input(input, { target: { value: "!rev" } });
		await vi.advanceTimersByTimeAsync(200);
		await screen.findByRole("option", { name: /Reviewer/ });
		resolveOld([{ name: "Researcher", kind: "agent" }]);
		await vi.advanceTimersByTimeAsync(0);
		expect(screen.getByRole("option", { name: /Reviewer/ })).toBeVisible();
		expect(screen.queryByRole("option", { name: /Researcher/ })).toBeNull();
	});

	test("a search still pending when the picker closes does not reopen stale results later", async () => {
		vi.useFakeTimers();
		let resolveOld: (items: unknown[]) => void = () => { throw new Error("Search was not started"); };
		searchMentions.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
		render(PanelChatInput, { onsubmit: vi.fn(async () => {}) });
		const input = screen.getByRole("combobox");
		await fireEvent.input(input, { target: { value: "!r" } });
		await vi.advanceTimersByTimeAsync(200);
		await fireEvent.input(input, { target: { value: "plain text" } });
		resolveOld([{ name: "Researcher", kind: "agent" }]);
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.input(input, { target: { value: "plain text !q" } });
		expect(input).toHaveAttribute("aria-expanded", "true");
		expect(screen.queryByRole("option", { name: /Researcher/ })).toBeNull();
	});

	test("a built-in literal command such as /goal is inserted as plain text, as in the main composer", async () => {
		vi.useFakeTimers();
		searchMentions.mockResolvedValueOnce([
			{ name: "goal", description: "Set a goal", kind: "command", insertText: "/goal " },
		]);
		const onsubmit = vi.fn(async () => {});
		render(PanelChatInput, { onsubmit });
		const input = screen.getByRole<HTMLTextAreaElement>("combobox");
		await fireEvent.input(input, { target: { value: "/go" } });
		await vi.advanceTimersByTimeAsync(200);
		await screen.findByRole("option", { name: /goal/ });
		await fireEvent.keyDown(input, { key: "Enter" });
		// The wire text is the literal command, never a `/[cmd:goal]` token.
		await fireEvent.keyDown(input, { key: "Enter" });
		expect(onsubmit).toHaveBeenCalledWith("/goal");
	});

	test("descends into a folder mention, then commits the folder as a structured path token", async () => {
		vi.useFakeTimers();
		searchMentions
			.mockResolvedValueOnce([{ name: "src", description: "Source folder", kind: "dir" }])
			.mockResolvedValueOnce([]);
		const onsubmit = vi.fn(async () => {});
		render(PanelChatInput, { onsubmit });
		const input = screen.getByRole("combobox");
		await fireEvent.input(input, { target: { value: "@s" } });
		await vi.advanceTimersByTimeAsync(200);
		await screen.findByRole("option", { name: /src/ });
		await fireEvent.keyDown(input, { key: "Enter" });
		expect((input as HTMLTextAreaElement).value).toContain("@src/");
		await vi.advanceTimersByTimeAsync(200);
		await screen.findByRole("option", { name: /Use this folder as path/ });
		await fireEvent.keyDown(input, { key: "Enter" });
		await fireEvent.keyDown(input, { key: "Enter" });
		expect((input as HTMLTextAreaElement).value).toBe("");
		expect(onsubmit).toHaveBeenCalledWith("@[dir:src]");
	});

	test.each(["Backspace", "Delete"])("removes a complete mention with %s and submits the remaining text", async (key) => {
		vi.useFakeTimers();
		const onsubmit = vi.fn(async () => {});
		render(PanelChatInput, { onsubmit });
		const input = screen.getByRole<HTMLTextAreaElement>("combobox");
		await chooseAgent(input);
		input.setSelectionRange(key === "Backspace" ? 9 : 0, key === "Backspace" ? 9 : 0);
		await fireEvent.keyDown(input, { key });
		await vi.advanceTimersByTimeAsync(20);
		expect(input).toHaveValue(" ");
		expect(screen.queryByText("Reviewer")).toBeNull();
		await fireEvent.input(input, { target: { value: "Follow up" } });
		await fireEvent.keyDown(input, { key: "Enter" });
		expect(onsubmit).toHaveBeenCalledWith("Follow up");
	});

	test("keeps caret and edits outside mention chips, while preserving a selected text range", async () => {
		vi.useFakeTimers();
		render(PanelChatInput, { onsubmit: vi.fn(async () => {}) });
		const input = screen.getByRole<HTMLTextAreaElement>("combobox");
		await chooseAgent(input);
		input.setSelectionRange(2, 2);
		await fireEvent.click(input);
		expect(input.selectionStart).toBe(0);
		input.setSelectionRange(7, 7);
		await fireEvent.keyUp(input, { key: "ArrowLeft" });
		expect(input.selectionStart).toBe(13);
		input.setSelectionRange(2, 7);
		await fireEvent.keyUp(input, { key: "Shift" });
		expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
		const before = input.value;
		await fireEvent.input(input, { target: { value: before.replace("Reviewer", "ReXviewer") } });
		expect(input).toHaveValue(before);
	});

	test("waits for composition to finish, handles search failure, and dismisses the picker", async () => {
		vi.useFakeTimers();
		searchMentions.mockRejectedValueOnce(new Error("Search unavailable"));
		render(PanelChatInput, { onsubmit: vi.fn(async () => {}) });
		const input = screen.getByRole("combobox");
		await fireEvent.compositionStart(input);
		await fireEvent.input(input, { target: { value: "@src" } });
		await vi.advanceTimersByTimeAsync(200);
		expect(searchMentions).not.toHaveBeenCalled();
		await fireEvent.compositionEnd(input);
		await vi.advanceTimersByTimeAsync(200);
		expect(searchMentions).toHaveBeenCalledWith("src", "path", "project-1");
		expect(screen.queryByRole("option")).toBeNull();
		expect(input).toHaveAttribute("aria-expanded", "true");
		await fireEvent.keyDown(input, { key: "Escape" });
		expect(input).toHaveAttribute("aria-expanded", "false");
		await fireEvent.input(input, { target: { value: "@again" } });
		await vi.advanceTimersByTimeAsync(200);
		await fireEvent.input(input, { target: { value: "Plain text" } });
		expect(input).toHaveAttribute("aria-expanded", "false");
	});

	test("shows and clears the jump control from real observer notifications and disconnects on unmount", async () => {
		vi.useFakeTimers();
		let reportVisibility: (visible: boolean) => void = () => { throw new Error("Observer was not created"); };
		const observe = vi.fn();
		const disconnect = vi.fn();
		vi.stubGlobal("IntersectionObserver", class {
			constructor(callback: IntersectionObserverCallback) {
				reportVisibility = (isIntersecting) => callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
			}
			observe = observe;
			disconnect = disconnect;
		});
		const sentinel = document.createElement("div");
		sentinel.scrollIntoView = vi.fn();
		const container = document.createElement("div");
		const view = render(PanelChatInput, { onsubmit: vi.fn(async () => {}), scrollSentinel: sentinel, scrollContainer: container, processing: true, agentName: "Reviewer" });
		expect(observe).toHaveBeenCalledWith(sentinel);
		expect(screen.getByText("@Reviewer is processing")).toBeVisible();
		reportVisibility(false);
		await fireEvent.click(await screen.findByRole("button", { name: "Jump to bottom" }));
		await vi.advanceTimersByTimeAsync(20);
		expect(sentinel.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
		expect(screen.queryByRole("button", { name: "Jump to bottom" })).toBeNull();
		reportVisibility(true);
		view.unmount();
		expect(disconnect).toHaveBeenCalledOnce();
	});

	test("keeps the text overlay aligned while scrolling and shows a fallback for a non-Error rejection", async () => {
		const onsubmit = vi.fn(async () => { throw "offline"; });
		const { container } = render(PanelChatInput, { onsubmit });
		const input = screen.getByRole<HTMLTextAreaElement>("combobox");
		await fireEvent.input(input, { target: { value: "Keep this message" } });
		input.scrollTop = 32;
		await fireEvent.scroll(input);
		expect(container.querySelector(".panel-chat-textarea-overlay")?.scrollTop).toBe(32);
		await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		await screen.findByText("Failed to send");
		expect(input).toHaveValue("Keep this message");
	});

});
