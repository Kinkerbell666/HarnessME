/**
 * Phase 66-02 Task 2 — Component coverage for the sidebar search-mode surface
 * on ConversationList.svelte.
 *
 * Exercises the UI-01/UI-02/UI-04 contract end-to-end through the component:
 *  - 3-segment Hybrid/Keyword/Semantic toggle, Hybrid active by default (empty LS)
 *  - clicking a segment persists the GLOBAL localStorage key + moves the active
 *    state; a remount restores the persisted mode (UI-02)
 *  - <2-char queries do NOT call searchMessages; >=2 chars call it after the
 *    300ms debounce (UI-04 guard + debounce, asserted with fake timers)
 *  - a response with hits renders a grouped "Messages" section; lexical <mark>
 *    survives, semantic hits render plain (no injected mark)
 *  - a hostile <script> snippet is sanitized before {@html} (sanitizeSnippet wired)
 *  - degraded:true renders the inline non-blocking notice WITHOUT mutating the
 *    stored mode
 *  - empty hits render the single generic "No matching messages." state
 *  - title matches still render in the "Conversations" section instantly (UI-04)
 *  - clicking a message row calls onselect(conversationId, messageId)
 *
 * The `searchMessages` fetch seam is injected via vi.mock so no network is hit
 * (coverage-gate "inject the fetch seam" pattern). The global LS key is cleared
 * in beforeEach so it never collides with COLLAPSE_LS_KEY.
 */

import "@testing-library/jest-dom/vitest";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/svelte";
import ConversationList from "$lib/components/ConversationList.svelte";
import { SEARCH_MODE_LS_KEY } from "$lib/search/search-mode.js";
import type { MessageSearchHit, SearchMessagesResponse, Conversation } from "$lib/api.js";

// ── api.js fetch-seam mock ────────────────────────────────────────────────────
const searchMessagesMock = vi.fn<
	(projectId: string, query: string, opts?: { mode?: string }) => Promise<SearchMessagesResponse>
>();
const fetchConversationsMock = vi.fn<() => Promise<Conversation[]>>();

vi.mock("$lib/api.js", async (importOriginal) => {
	const orig = (await importOriginal()) as Record<string, unknown>;
	return {
		...orig,
		fetchConversations: (...args: unknown[]) => fetchConversationsMock(...(args as [])),
		searchMessages: (projectId: string, query: string, opts?: { mode?: string }) =>
			searchMessagesMock(projectId, query, opts),
	};
});

// ── fixtures ──────────────────────────────────────────────────────────────────
function makeConv(overrides: Partial<Conversation> & { id: string; title: string }): Conversation {
	return {
		projectId: "p-1",
		model: null,
		provider: null,
		systemPrompt: null,
		agentConfigId: null,
		modeId: null,
		test: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	} as Conversation;
}

function makeHit(overrides: Partial<MessageSearchHit> & { messageId: string }): MessageSearchHit {
	return {
		conversationId: "c-1",
		conversationTitle: "Conversation One",
		role: "user",
		createdAt: new Date().toISOString(),
		snippet: "a <mark>match</mark>",
		matchType: "lexical",
		rankLexical: 1,
		rankSemantic: null,
		score: 0.5,
		projectId: "proj-1",
		projectName: "Project One",
		...overrides,
	};
}

function resp(over: Partial<SearchMessagesResponse> = {}): SearchMessagesResponse {
	return {
		hits: [],
		degraded: false,
		requestedMode: "hybrid",
		servedMode: "hybrid",
		...over,
	};
}

const PROPS = {
	projectId: "p-1",
	oncreate: () => {},
	onselect: () => {},
};

beforeEach(() => {
	localStorage.clear();
	searchMessagesMock.mockReset();
	fetchConversationsMock.mockReset();
	fetchConversationsMock.mockResolvedValue([]);
	searchMessagesMock.mockResolvedValue(resp());
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

// Open the search box and type a query.
async function openAndType(getByTitle: (t: string) => HTMLElement, container: HTMLElement, query: string) {
	await fireEvent.click(getByTitle("Search conversations"));
	const input = container.querySelector('input[type="text"]') as HTMLInputElement;
	await fireEvent.input(input, { target: { value: query } });
	return input;
}

describe("ConversationList — search-mode toggle (UI-01/UI-02)", () => {
	test("renders exactly 3 segments; Hybrid active by default (empty LS)", async () => {
		const { getByTitle, getByText, getByTestId } = render(ConversationList, { props: PROPS });
		await fireEvent.click(getByTitle("Search conversations"));

		const toggle = getByTestId("search-mode-toggle");
		const segments = toggle.querySelectorAll("button");
		expect(segments).toHaveLength(3);
		expect(getByText("Hybrid")).toHaveAttribute("aria-pressed", "true");
		expect(getByText("Keyword")).toHaveAttribute("aria-pressed", "false");
		expect(getByText("Semantic")).toHaveAttribute("aria-pressed", "false");
	});

	test("clicking Keyword persists the global LS key and moves the active segment", async () => {
		const { getByTitle, getByText } = render(ConversationList, { props: PROPS });
		await fireEvent.click(getByTitle("Search conversations"));

		await fireEvent.click(getByText("Keyword"));
		expect(localStorage.getItem(SEARCH_MODE_LS_KEY)).toBe("keyword");
		expect(getByText("Keyword")).toHaveAttribute("aria-pressed", "true");
		expect(getByText("Hybrid")).toHaveAttribute("aria-pressed", "false");
	});

	test("remount reads the persisted mode (UI-02)", async () => {
		localStorage.setItem(SEARCH_MODE_LS_KEY, "semantic");
		const { getByTitle, getByText } = render(ConversationList, { props: PROPS });
		await fireEvent.click(getByTitle("Search conversations"));
		expect(getByText("Semantic")).toHaveAttribute("aria-pressed", "true");
		expect(getByText("Hybrid")).toHaveAttribute("aria-pressed", "false");
	});
});

describe("ConversationList — debounce + guard (UI-04)", () => {
	test("typing <2 chars does NOT call searchMessages", async () => {
		vi.useFakeTimers();
		const { getByTitle, container } = render(ConversationList, { props: PROPS });
		await openAndType(getByTitle, container, "a");
		vi.advanceTimersByTime(500);
		expect(searchMessagesMock).not.toHaveBeenCalled();
	});

	test("typing >=2 chars calls searchMessages after the 300ms debounce", async () => {
		vi.useFakeTimers();
		const { getByTitle, container } = render(ConversationList, { props: PROPS });
		await openAndType(getByTitle, container, "hello");
		// Before debounce elapses, no call.
		expect(searchMessagesMock).not.toHaveBeenCalled();
		vi.advanceTimersByTime(300);
		expect(searchMessagesMock).toHaveBeenCalledTimes(1);
		expect(searchMessagesMock).toHaveBeenCalledWith("p-1", "hello", { mode: "hybrid" });
	});
});

describe("ConversationList — overlapping searches", () => {
	test("a slow answer to an older query never replaces the newer query's hits", async () => {
		vi.useFakeTimers();
		let resolveOld: (r: SearchMessagesResponse) => void = () => { throw new Error("Old search was not started"); };
		searchMessagesMock
			.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
			.mockResolvedValueOnce(resp({ hits: [makeHit({ messageId: "new", snippet: "newer answer" })] }));
		const { getByTitle, container, findByText, queryByText } = render(ConversationList, { props: PROPS });
		const input = await openAndType(getByTitle, container, "dep");
		await vi.advanceTimersByTimeAsync(300);
		await fireEvent.input(input, { target: { value: "deploy" } });
		await vi.advanceTimersByTimeAsync(300);
		await findByText("newer answer");

		resolveOld(resp({ hits: [makeHit({ messageId: "old", snippet: "older answer" })] }));
		await vi.advanceTimersByTimeAsync(0);
		expect(queryByText("older answer")).toBeNull();
		expect(queryByText("newer answer")).toBeInTheDocument();
	});
});

describe("ConversationList — closing search", () => {
	test("a search still in flight when the box closes does not come back on reopen", async () => {
		vi.useFakeTimers();
		let resolveOld: (r: SearchMessagesResponse) => void = () => { throw new Error("Search was not started"); };
		searchMessagesMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
		const { getByTitle, container, queryByText, getByPlaceholderText } = render(ConversationList, { props: PROPS });
		const input = await openAndType(getByTitle, container, "deploy");
		await vi.advanceTimersByTimeAsync(300);
		await fireEvent.keyDown(input, { key: "Escape" });

		resolveOld(resp({ hits: [makeHit({ messageId: "old", snippet: "late answer" })] }));
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.click(getByTitle("Search conversations"));
		expect(queryByText("late answer")).toBeNull();
		expect(getByPlaceholderText(/search/i)).toHaveValue("");
	});
});

describe("ConversationList — two-section results", () => {
	test("hits render a grouped Messages section; lexical <mark> survives, semantic renders plain", async () => {
		searchMessagesMock.mockResolvedValue(
			resp({
				hits: [
					makeHit({ messageId: "m1", conversationId: "c-1", conversationTitle: "Alpha", snippet: "found <mark>kw</mark>", matchType: "lexical" }),
					makeHit({ messageId: "m2", conversationId: "c-1", conversationTitle: "Alpha", snippet: "semantic neighbour", matchType: "semantic" }),
				],
			}),
		);
		const { getByTitle, container, getByText, findByText } = render(ConversationList, { props: PROPS });
		await openAndType(getByTitle, container, "alpha-query");

		await findByText("Messages");
		expect(getByText("Alpha")).toBeInTheDocument();
		// lexical <mark> preserved
		expect(container.querySelector("mark")?.textContent).toBe("kw");
		// semantic hit plain text present, no extra injected mark for it
		expect(getByText("semantic neighbour")).toBeInTheDocument();
		expect(container.querySelectorAll("mark")).toHaveLength(1);
	});

	test("hostile <script> snippet is sanitized before {@html}", async () => {
		searchMessagesMock.mockResolvedValue(
			resp({
				hits: [
					makeHit({ messageId: "m1", snippet: 'safe <mark>hit</mark><script>window.__x=1</script>' }),
				],
			}),
		);
		const { getByTitle, container, findByText } = render(ConversationList, { props: PROPS });
		await openAndType(getByTitle, container, "danger");
		await findByText("Messages");
		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("mark")?.textContent).toBe("hit");
	});

	test("title matches render in the Conversations section instantly (UI-04 preserved)", async () => {
		fetchConversationsMock.mockResolvedValue([makeConv({ id: "t-1", title: "Alpha Project" })]);
		const { getByTitle, container, findByText, findAllByText } = render(ConversationList, { props: PROPS });
		// Wait for the initial conversations load to land.
		await waitFor(() => expect(fetchConversationsMock).toHaveBeenCalled());
		await openAndType(getByTitle, container, "alpha");
		// Title match renders instantly in the Conversations section (no debounce).
		await findByText("Alpha Project");
		// "Conversations" appears twice: the panel header + the results section header.
		const headers = await findAllByText("Conversations");
		expect(headers.length).toBeGreaterThanOrEqual(2);
	});

	test("clicking a message row calls onselect(conversationId, messageId)", async () => {
		const onselect = vi.fn();
		searchMessagesMock.mockResolvedValue(
			resp({ hits: [makeHit({ messageId: "m-42", conversationId: "c-9", conversationTitle: "Nine" })] }),
		);
		const { getByTitle, container, findByTestId } = render(ConversationList, {
			props: { ...PROPS, onselect },
		});
		await openAndType(getByTitle, container, "query");
		const row = await findByTestId("message-hit");
		await fireEvent.click(row);
		expect(onselect).toHaveBeenCalledWith("c-9", "m-42");
	});
});

describe("ConversationList — degraded + empty states", () => {
	test("degraded:true renders the inline notice WITHOUT mutating the stored mode", async () => {
		localStorage.setItem(SEARCH_MODE_LS_KEY, "semantic");
		searchMessagesMock.mockResolvedValue(
			resp({
				hits: [makeHit({ messageId: "m1" })],
				degraded: true,
				requestedMode: "semantic",
				servedMode: "keyword",
			}),
		);
		const { getByTitle, container, findByTestId } = render(ConversationList, { props: PROPS });
		await openAndType(getByTitle, container, "query");
		const notice = await findByTestId("search-degraded-notice");
		expect(notice).toHaveTextContent(/unavailable/i);
		// Stored preference is untouched (Pitfall 4).
		expect(localStorage.getItem(SEARCH_MODE_LS_KEY)).toBe("semantic");
	});

	test("empty hits render the single generic 'No matching messages.' state", async () => {
		searchMessagesMock.mockResolvedValue(resp({ hits: [] }));
		const { getByTitle, container, findByTestId } = render(ConversationList, { props: PROPS });
		await openAndType(getByTitle, container, "no-results-query");
		const empty = await findByTestId("search-empty");
		expect(empty).toHaveTextContent("No matching messages.");
	});
});
