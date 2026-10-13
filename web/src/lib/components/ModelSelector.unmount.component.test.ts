/**
 * The picker retries /api/models with backoff when it fails. Once the picker
 * unmounts (the user left the page), the retries stop: no more requests, and
 * no "Failed to load models" toast on whatever page the user is on now.
 */
import { render } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("$lib/toast.svelte.js", () => ({ addToast }));

import ModelSelector from "./ModelSelector.svelte";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	addToast.mockClear();
});

describe("ModelSelector model-list retry", () => {
	test("stops retrying and never toasts after unmount", async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
		vi.stubGlobal("fetch", fetchMock);
		const view = render(ModelSelector, { selected: null, onselect: () => {} });
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		view.unmount();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(addToast).not.toHaveBeenCalled();
	});

	test("a last attempt that fails after unmount raises no toast", async () => {
		vi.useFakeTimers();
		let failLast: () => void = () => { throw new Error("Last attempt was not made"); };
		const fetchMock = vi.fn(async () => {
			if (fetchMock.mock.calls.length < 3) throw new TypeError("network down");
			return new Promise<Response>((_, reject) => { failLast = () => reject(new TypeError("network down")); });
		});
		vi.stubGlobal("fetch", fetchMock);
		const view = render(ModelSelector, { selected: null, onselect: () => {} });
		await vi.advanceTimersByTimeAsync(1000 + 2000);
		expect(fetchMock).toHaveBeenCalledTimes(3);

		view.unmount();
		failLast();
		await vi.advanceTimersByTimeAsync(0);
		expect(addToast).not.toHaveBeenCalled();
	});
});
