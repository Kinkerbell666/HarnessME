import { test, expect, captureEvidence } from "./fixtures/test-base.js";
import { makeProject } from "./fixtures/data.js";
import { AA_NORMAL_TEXT, measureContrast, useDarkTheme, useLightTheme } from "./fixtures/readable.js";

test.describe("Projects", () => {
	test("new project form renders", async ({ page, mockApi }) => {
		await mockApi();
		await page.goto("/new-project");

		await expect(page.getByRole("heading", { name: "Create Project" })).toBeVisible();
		await expect(page.getByRole("textbox", { name: "Name" })).toBeVisible();
	});

	test("project rail shows projects", async ({ page, mockApi }) => {
		await mockApi({
			projects: [
				makeProject({ id: "p1", name: "Alpha", icon: null }),
				makeProject({ id: "p2", name: "Beta", icon: null }),
			],
		});
		await page.goto("/");

		await expect(page.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Beta", exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Beta", exact: true }).click();
		await expect(page).toHaveURL(/\/project\/p2\/chat/);
		await expect(page.getByTestId("active-context-name")).toHaveText("Beta");
	});

	test("project settings page loads", async ({ page, mockApi }) => {
		const proj = makeProject({ id: "proj-1", name: "Settings Project" });
		await mockApi({ projects: [proj] });
		await page.goto(`/project/${proj.id}/settings`);

		await expect(page.getByRole("heading", { name: "Settings Project", exact: true })).toBeVisible();
		await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Settings Project");
		await expect(page.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
	});

	test("project settings saves both instruction scopes and updates the project", async ({ page, mockApi }) => {
		const proj = makeProject({
			id: "proj-settings-actions",
			name: "Settings Project",
			icon: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
		});
		const projectPromptKey = `project:${proj.id}:systemPrompt`;
		const heldPuts = new Map<string, { wait: Promise<void>; release: () => void }>();
		await mockApi({
			projects: [proj],
			settings: {
				"global:systemPrompt": "Existing global instruction",
				[projectPromptKey]: "Existing project instruction",
			},
		});
		for (const path of [
			`/api/settings/${projectPromptKey}`,
			"/api/settings/global:systemPrompt",
			`/api/projects/${proj.id}`,
		]) {
			let release!: () => void;
			const wait = new Promise<void>((resolve) => { release = resolve; });
			heldPuts.set(path, { wait, release });
			await page.route(`**${path}`, async (route) => {
				if (route.request().method() !== "PUT") return route.fallback();
				await wait;
				return route.fallback();
			});
		}
		const projectSaveGate = heldPuts.get(`/api/settings/${projectPromptKey}`)!;
		const globalSaveGate = heldPuts.get("/api/settings/global:systemPrompt")!;
		const updateGate = heldPuts.get(`/api/projects/${proj.id}`)!;
		await page.route("**/api/integrations/github-projects/link**", (route) =>
			route.fulfill({ status: 404, json: { error: "No connected board" } }),
		);

		await page.goto(`/project/${proj.id}/settings`);
		await expect(page.getByRole("main").getByRole("img", { name: "Settings Project" })).toBeVisible();
		await expect(page.getByTestId("project-settings-gh-status")).toHaveText("Not connected");

		const projectInstructions = page.getByPlaceholder("e.g. You are a coding assistant for this project...");
		const projectSaveButton = projectInstructions.locator("xpath=following-sibling::div[1]//button");
		await projectInstructions.fill("Project instructions updated by the user");
		const projectSaveResponse = page.waitForResponse((response) =>
			new URL(response.url()).pathname === `/api/settings/project:${proj.id}:systemPrompt`
			&& response.request().method() === "PUT",
		);
		await projectSaveButton.click();
		try {
			await expect(projectSaveButton).toBeDisabled();
			await expect(projectSaveButton).toHaveText("Saving...");
		} finally {
			projectSaveGate.release();
		}
		const projectSave = await projectSaveResponse;
		expect(projectSave.status()).toBe(200);
		expect(projectSave.request().postDataJSON()).toEqual({ value: "Project instructions updated by the user" });
		await expect(projectSaveButton).toBeEnabled();
		await expect(projectSaveButton.locator("xpath=following-sibling::*[@data-testid='save-indicator-saved']")).toHaveText("Saved ✓");

		const globalInstructions = page.getByPlaceholder("e.g. You are a helpful AI assistant...");
		const globalSaveButton = globalInstructions.locator("xpath=following-sibling::div[1]//button");
		await globalInstructions.fill("Global instructions updated by the user");
		const globalSaveResponse = page.waitForResponse((response) =>
			new URL(response.url()).pathname === "/api/settings/global:systemPrompt"
			&& response.request().method() === "PUT",
		);
		await globalSaveButton.click();
		try {
			await expect(globalSaveButton).toBeDisabled();
			await expect(globalSaveButton).toHaveText("Saving...");
		} finally {
			globalSaveGate.release();
		}
		const globalSave = await globalSaveResponse;
		expect(globalSave.status()).toBe(200);
		expect(globalSave.request().postDataJSON()).toEqual({ value: "Global instructions updated by the user" });
		await expect(globalSaveButton).toBeEnabled();
		await expect(globalSaveButton.locator("xpath=following-sibling::*[@data-testid='save-indicator-saved']")).toHaveText("Saved ✓");

		const updateButton = page.locator("form button[type=submit]");
		await page.getByRole("textbox", { name: "Name", exact: true }).fill("Renamed Settings Project");
		const updateResponse = page.waitForResponse((response) =>
			new URL(response.url()).pathname === `/api/projects/${proj.id}` && response.request().method() === "PUT",
		);
		await updateButton.click();
		try {
			await expect(updateButton).toBeDisabled();
			await expect(updateButton).toHaveText("Saving...");
		} finally {
			updateGate.release();
		}
		const update = await updateResponse;
		expect(update.status()).toBe(200);
		expect(update.request().postDataJSON()).toMatchObject({ name: "Renamed Settings Project", path: proj.path });
		await expect(updateButton.locator("xpath=ancestor::form/following-sibling::*[1]//*[@data-testid='save-indicator-saved']")).toHaveText("Saved ✓");
		await page.reload();
		await expect(projectInstructions).toHaveValue("Project instructions updated by the user");
		await expect(globalInstructions).toHaveValue("Global instructions updated by the user");
		await expect(page.getByRole("heading", { name: "Renamed Settings Project", exact: true })).toBeVisible();
		await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Renamed Settings Project");
	});


	for (const theme of [
		{ name: "light", apply: useLightTheme },
		{ name: "dark", apply: useDarkTheme },
	] as const) {
		test(`${theme.name} save feedback is readable through a native retry @evidence`, async ({ page, mockApi }, testInfo) => {
			const proj = makeProject({ id: `proj-settings-retry-${theme.name}`, name: "Retry Settings Project" });
			let saves = 0;
			await theme.apply(page);
			await mockApi({ projects: [proj] });
			await page.route(`**/api/settings/project:${proj.id}:systemPrompt`, (route) => {
				if (route.request().method() !== "PUT") return route.fallback();
				saves += 1;
				if (saves === 1) return route.fulfill({ status: 500, json: { error: "Save refused" } });
				return route.fallback();
			});

			await page.goto(`/project/${proj.id}/settings`);
			const instructions = page.getByPlaceholder("e.g. You are a coding assistant for this project...");
			const saveButton = instructions.locator("xpath=following-sibling::div[1]//button");
			await instructions.fill("Retry this project instruction");
			await saveButton.click();
			const failure = page.getByTestId("save-indicator-error");
			await expect(failure).toHaveText("Save failed — try again");
			await expect(saveButton).toBeEnabled();
			const failureContrast = await measureContrast(failure);
			await captureEvidence(page, testInfo, `project-settings-save-error-${theme.name}`, { fullPage: true });

			const retried = page.waitForResponse((response) =>
				new URL(response.url()).pathname === `/api/settings/project:${proj.id}:systemPrompt`
				&& response.request().method() === "PUT" && response.status() === 200,
			);
			await saveButton.click();
			await retried;
			const saved = saveButton.locator("xpath=following-sibling::*[@data-testid='save-indicator-saved']");
			await expect(saved).toHaveText("Saved ✓");
			const savedContrast = await measureContrast(saved);
			await captureEvidence(page, testInfo, `project-settings-save-success-${theme.name}`, { fullPage: true });
			await page.reload();
			await expect(instructions).toHaveValue("Retry this project instruction");
			expect(saves).toBe(2);
			expect(failureContrast.dark, `${theme.name} theme should be active for the save failure`).toBe(theme.name === "dark");
			expect(savedContrast.dark, `${theme.name} theme should be active for the save confirmation`).toBe(theme.name === "dark");
			expect(
				Math.min(failureContrast.ratio, savedContrast.ratio),
				`${theme.name} save feedback: failure ${failureContrast.ratio.toFixed(2)}:1 (${failureContrast.color} on ${failureContrast.background}); ` +
					`success ${savedContrast.ratio.toFixed(2)}:1 (${savedContrast.color} on ${savedContrast.background})`,
			).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
		});
	}

	test("a plain project member sees no Delete control @evidence", async ({ page, mockApi }, testInfo) => {
		const proj = makeProject({ id: "proj-member-view", name: "Member View Project" });
		const memberMe = { user: { id: "e2e-member", email: "member@test.local", name: "E2E Member", role: "member" } };
		await mockApi({
			projects: [proj],
			routes: {
				"/api/auth/me": () => memberMe,
				[`/api/projects/${proj.id}/members`]: () => [
					{ userId: "e2e-member", role: "member" },
					{ userId: "e2e-owner", role: "owner" },
				],
			},
		});
		const membersLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/projects/${proj.id}/members`);

		await page.goto(`/project/${proj.id}/settings`);
		await membersLoaded;

		await expect(page.getByRole("heading", { name: "Member View Project", exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
		await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
		await captureEvidence(page, testInfo, "project-settings-member-no-delete");
	});

	test("keeps settings usable when the integration check fails and deletes the project", async ({ page, mockApi }) => {
		const proj = makeProject({ id: "proj-settings-delete", name: "Delete Settings Project" });
		await mockApi({ projects: [proj] });
		await page.route("**/api/integrations/github-projects/link**", (route) => route.abort("failed"));

		await page.goto(`/project/${proj.id}/settings`);
		await expect(page.getByTestId("project-settings-gh-status")).toHaveText("Not connected");
		page.once("dialog", (dialog) => dialog.accept());
		const [deleted] = await Promise.all([
			page.waitForResponse((response) =>
				new URL(response.url()).pathname === `/api/projects/${proj.id}` && response.request().method() === "DELETE",
			),
			page.getByRole("button", { name: "Delete", exact: true }).click(),
		]);
		expect(deleted.status()).toBe(200);
		await expect(page).toHaveURL(/\/project\/global\/chat$/);
		await expect(page.getByRole("button", { name: "Delete Settings Project", exact: true })).toHaveCount(0);
	});
});
