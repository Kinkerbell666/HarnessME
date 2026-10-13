import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
	page: { params: { id: "project-1" } },
	store: { projects: [] as Array<{ id: string; name: string; path: string; icon: null; variables: Record<string, unknown> }> },
	fetchSettings: vi.fn(),
	refreshProjects: vi.fn(),
	setActiveProjectId: vi.fn(),
	goto: vi.fn(),
}));

vi.mock("$app/state", () => ({ page: state.page }));
vi.mock("$app/navigation", () => ({ goto: state.goto }));
vi.mock("$lib/stores.svelte.js", () => ({
	store: state.store,
	refreshProjects: state.refreshProjects,
	setActiveProjectId: state.setActiveProjectId,
}));
vi.mock("$lib/api.js", () => ({
	fetchSettings: state.fetchSettings,
	updateProject: vi.fn(),
	deleteProject: vi.fn(),
	upsertSetting: vi.fn(),
}));
vi.mock("$lib/project-icon.js", () => ({ isIconUrl: () => false }));
vi.mock("$lib/components/ProjectForm.svelte", async () => ({ default: (await import("./ProjectFormStub.svelte")).default }));
vi.mock("$lib/components/FeatureIndex.svelte", async () => ({ default: (await import("./FeatureIndexStub.svelte")).default }));
vi.mock("$lib/components/ProjectSandboxPanel.svelte", async () => ({ default: (await import("./SandboxPanelStub.svelte")).default }));
vi.mock("$lib/components/InfoTooltip.svelte", async () => ({ default: (await import("./EmptyStub.svelte")).default }));
vi.mock("$lib/components/settings/ComposerSuggestSection.svelte", async () => ({ default: (await import("./EmptyStub.svelte")).default }));
vi.mock("$lib/components/settings/SaveIndicator.svelte", async () => ({ default: (await import("./EmptyStub.svelte")).default }));

import SettingsPage from "../+page.svelte";

const ordinary = { id: "project-1", name: "Project", path: "", icon: null, variables: {} };

function response(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
	state.page.params.id = ordinary.id;
	state.store.projects = [{ ...ordinary }];
	state.fetchSettings.mockReset().mockResolvedValue({});
	state.refreshProjects.mockReset();
	state.setActiveProjectId.mockReset();
	state.goto.mockReset();
	stubFetch({ id: "admin-1", role: "admin" }, []);
});

/** Local workspace, with the given caller and project membership rows. */
function stubFetch(user: { id: string; role: "admin" | "member" }, members: { userId: string; role: string }[]) {
	vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
		const url = String(input);
		if (url.endsWith(`/api/projects/${ordinary.id}/sandbox`)) return response({ code: "SANDBOX_NOT_CONFIGURED" }, 409);
		if (url === "/api/auth/me") return response({ user: { ...user, email: "u@test.local", name: "U" } });
		if (url.endsWith(`/api/projects/${ordinary.id}/members`)) return response(members);
		return response({ links: [] });
	}));
}

describe("project settings workspace binding", () => {
	test("keeps an ordinary path-empty project local when no persisted binding exists", async () => {
		const view = render(SettingsPage);
		await waitFor(() => expect(view.getByTestId("sandbox-panel-stub")).toHaveAttribute("data-sandbox", "false"));
		expect(view.getByTestId("project-form-stub")).toBeInTheDocument();
		expect(view.getByTestId("feature-index-stub")).toBeInTheDocument();
		expect(await view.findByRole("button", { name: "Delete" })).toBeInTheDocument();
	});

	test("shows Delete to the project owner", async () => {
		stubFetch({ id: "u-owner", role: "member" }, [{ userId: "u-owner", role: "owner" }]);
		const view = render(SettingsPage);
		expect(await view.findByRole("button", { name: "Delete" })).toBeInTheDocument();
	});

	test("hides Delete from a plain project member, whom the API would refuse", async () => {
		stubFetch({ id: "u-member", role: "member" }, [{ userId: "u-member", role: "member" }, { userId: "u-owner", role: "owner" }]);
		const view = render(SettingsPage);
		await waitFor(() => expect(view.getByTestId("project-form-stub")).toBeInTheDocument());
		await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(`/api/projects/${ordinary.id}/members`));
		expect(view.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
	});

	test("uses the persisted sandbox binding rather than an empty path", async () => {
		vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
			if (String(input).endsWith(`/api/projects/${ordinary.id}/sandbox`)) return response({ state: "stopped" });
			return response({ links: [] });
		}));
		const view = render(SettingsPage);
		await waitFor(() => expect(view.getByTestId("sandbox-panel-stub")).toHaveAttribute("data-sandbox", "true"));
		expect(view.queryByTestId("project-form-stub")).not.toBeInTheDocument();
		expect(view.queryByTestId("feature-index-stub")).not.toBeInTheDocument();
		expect(view.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
	});

	test("fails closed while the persisted workspace binding cannot be verified", async () => {
		vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
			if (String(input).endsWith(`/api/projects/${ordinary.id}/sandbox`)) return response({ error: "Sandbox service unavailable" }, 503);
			return response({ links: [] });
		}));
		const view = render(SettingsPage);
		await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent("Sandbox service unavailable"));
		expect(view.queryByTestId("sandbox-panel-stub")).not.toBeInTheDocument();
		expect(view.queryByTestId("project-form-stub")).not.toBeInTheDocument();
	});
});
