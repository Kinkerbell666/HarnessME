/**
 * SvelteKit REUSES a page component when only its route param changes, so a
 * detail page that loads in `onMount` keeps showing the first subject after
 * an in-app navigation to another one. The workflow editor hits this on
 * every rename: Save follows the new name with `goto`, and the page went on
 * holding the old definition (and its old name, which a second Save wrote
 * back). Each page here must fetch again for the new param.
 */
import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Component } from "svelte";
import { writable } from "svelte/store";
import * as appState from "$app/state";

const { legacyPage } = vi.hoisted(() => ({ legacyPage: { set: (_v: unknown) => {} } }));

vi.mock("$app/state", async () => await import("./stubs/reactive-app-state.svelte.js"));
vi.mock("$app/stores", () => {
	const store = writable({ url: new URL("http://localhost/"), params: {} as Record<string, string> });
	legacyPage.set = store.set as (v: unknown) => void;
	return { page: store, navigating: writable(null), updated: writable(false) };
});
vi.mock("$lib/components/LogStream.svelte", async () => await import("./stubs/empty-component.js"));
vi.mock("$lib/components/WorkflowBuilder.svelte", async () => await import("./stubs/empty-component.js"));

import RunPage from "../routes/(app)/runs/[id]/+page.svelte";
import WorkflowRunPage from "../routes/(app)/workflows/runs/[id]/+page.svelte";
import CommandPage from "../routes/(app)/commands/[name]/+page.svelte";
import WorkflowEditPage from "../routes/(app)/workflows/[name]/edit/+page.svelte";

const { page, navigate } = appState as unknown as {
	page: { params: Record<string, string> };
	navigate(pathname: string): void;
};

const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
	new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } }),
);

function goTo(pathname: string, params: Record<string, string>) {
	page.params = params;
	navigate(pathname);
	legacyPage.set({ url: new URL(pathname, "http://localhost"), params });
}

function requested(): string[] {
	return fetchMock.mock.calls.map(([input]) => String(input));
}

beforeEach(() => {
	fetchMock.mockClear();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const cases: {
	name: string;
	component: Component<any>;
	param: string;
	path: (v: string) => string;
	url: (v: string) => string;
}[] = [
	{ name: "agent run", component: RunPage, param: "id", path: (v) => `/runs/${v}`, url: (v) => `/api/runs/${v}` },
	{
		name: "workflow run trace",
		component: WorkflowRunPage,
		param: "id",
		path: (v) => `/workflows/runs/${v}`,
		url: (v) => `/api/workflows/runs/${v}`,
	},
	{
		name: "command editor",
		component: CommandPage,
		param: "name",
		path: (v) => `/commands/${v}`,
		url: (v) => `/api/user-commands/${v}`,
	},
	{
		name: "workflow editor",
		component: WorkflowEditPage,
		param: "name",
		path: (v) => `/workflows/${v}/edit`,
		url: (v) => `/api/workflows/${v}`,
	},
];

describe("detail pages reload when the route param changes", () => {
	test.each(cases)("$name", async ({ component, param, path, url }) => {
		goTo(path("first"), { [param]: "first" });
		render(component);
		await waitFor(() => expect(requested()).toContain(url("first")));

		goTo(path("second"), { [param]: "second" });
		await waitFor(() => expect(requested()).toContain(url("second")));
	});
});
