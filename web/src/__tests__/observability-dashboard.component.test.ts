/**
 * The /observability dashboard shows whose usage it is. GET /api/observability
 * returns every user's totals to an admin (`scope: "all"`) and only the
 * caller's own conversations to anyone else (`scope: "own"`), so the page
 * must say which, or a member reads their own numbers as the instance's.
 * It also loads once on mount, not twice.
 */
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import DashboardPage from "../routes/(app)/observability/+page.svelte";

function stats(scope: "all" | "own") {
	return {
		totalInputTokens: 10,
		totalOutputTokens: 20,
		totalToolCalls: 1,
		totalTurnCount: 1,
		avgResponseMs: 100,
		tokensByDay: [],
		topExtensions: [],
		scope,
	};
}

function stubStats(scope: "all" | "own") {
	const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(stats(scope)), { status: 200 }));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("observability dashboard scope", () => {
	test("a member is told the totals are their own conversations", async () => {
		const fetchMock = stubStats("own");
		const { findByTestId } = render(DashboardPage);
		expect(await findByTestId("analytics-scope")).toHaveTextContent("Your conversations");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("an admin is told the totals cover all users", async () => {
		stubStats("all");
		const { findByTestId } = render(DashboardPage);
		expect(await findByTestId("analytics-scope")).toHaveTextContent("All users");
	});
});
