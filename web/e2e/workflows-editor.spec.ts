import { test, expect } from "./fixtures/test-base.js";
import { makeAgent, makeWorkflow } from "./fixtures/data.js";
import { captureEvidence } from "./fixtures/evidence.js";

// /workflows/[name]/edit is the C6 editor: a form tab over the shared
// builder, a raw-YAML tab, a dry-run panel and the version history. The
// page loads through GET /api/workflows/[name], which since C6 returns
// the definition PLUS the caller's provenance — `canEdit` in particular
// is computed server-side from the one shared ladder and merely RENDERED
// here, never re-derived in the browser.

const WORKFLOW = makeWorkflow({
	name: "docs-factory",
	description: "writes the docs",
	steps: [
		{ name: "step-1", agent: "summarizer" },
		{ name: "summary", kind: "transform", output: { note: "$prev.output" } },
	],
});

async function openEditor(page: import("@playwright/test").Page) {
	await page.goto(`/workflows/${WORKFLOW.name}/edit`);
	await expect(page).toHaveURL(new RegExp(`/workflows/${WORKFLOW.name}/edit$`));
	await expect(page.getByTestId("workflow-editor")).toBeVisible({ timeout: 5000 });
}

test.describe("Workflow editor", () => {
	test.beforeEach(async ({ mockApi }) => {
		await mockApi({
			agents: [makeAgent({ name: "summarizer", description: "Summarises text" })],
			workflows: [WORKFLOW],
		});
	});

	test("@evidence loads the definition into the form tab with its provenance", async ({
		page,
	}, testInfo) => {
		await openEditor(page);

		await expect(page.getByRole("heading", { name: `Edit ${WORKFLOW.name}` })).toBeVisible();
		await expect(page.getByTestId("workflow-visibility")).toHaveText("project");
		await expect(page.getByTestId("workflow-version")).toHaveText("v1");

		// The form is populated from the saved definition, not blank.
		await expect(page.getByLabel("Workflow Name")).toHaveValue(WORKFLOW.name);
		await expect(page.getByLabel("Description")).toHaveValue(WORKFLOW.description);
		await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();

		await captureEvidence(page, testInfo, "workflow-editor-form-tab", { fullPage: true });
	});

	test("@evidence the YAML tab renders the definition as an editable document", async ({
		page,
	}, testInfo) => {
		await openEditor(page);
		await page.getByTestId("tab-yaml").click();

		const yaml = page.getByTestId("yaml-editor");
		await expect(yaml).toBeVisible();
		const text = await yaml.inputValue();
		expect(text).toContain(`name: ${WORKFLOW.name}`);
		expect(text).toContain("steps:");
		// Key order is human, not serialization order.
		expect(text.indexOf("name:")).toBeLessThan(text.indexOf("steps:"));

		await captureEvidence(page, testInfo, "workflow-editor-yaml-tab", { fullPage: true });
	});

	test("the YAML tab reports a parse error instead of saving a broken document", async ({
		page,
	}) => {
		await openEditor(page);
		await page.getByTestId("tab-yaml").click();
		await page.getByTestId("yaml-editor").fill("name: [unclosed\n");
		await page.getByTestId("save-yaml").click();

		await expect(page.getByTestId("editor-save-error")).toBeVisible({ timeout: 3000 });
	});

	test("a YAML document that is not a mapping is rejected with a useful message", async ({
		page,
	}) => {
		await openEditor(page);
		await page.getByTestId("tab-yaml").click();
		await page.getByTestId("yaml-editor").fill("- one\n- two\n");
		await page.getByTestId("save-yaml").click();

		await expect(page.getByTestId("editor-save-error")).toContainText("YAML mapping");
	});

	test("saving from the YAML tab PUTs the parsed definition", async ({ page }) => {
		await openEditor(page);
		await page.getByTestId("tab-yaml").click();

		let putBody: Record<string, unknown> | null = null;
		await page.route(`**/api/workflows/${WORKFLOW.name}`, (route) => {
			if (route.request().method() === "PUT") {
				putBody = route.request().postDataJSON() as Record<string, unknown>;
				return route.fulfill({ json: { id: "wf-1", name: WORKFLOW.name } });
			}
			return route.fallback();
		});

		await page
			.getByTestId("yaml-editor")
			.fill("name: docs-factory\ndescription: edited\nsteps:\n  - name: step-1\n    agent: summarizer\n");
		await page.getByTestId("save-yaml").click();

		await expect(page.getByTestId("editor-saved")).toBeVisible({ timeout: 3000 });
		expect(putBody).toMatchObject({ name: "docs-factory", description: "edited" });
		// The strict PUT schema rejects unknown fields, so the provenance the
		// GET returned must not be echoed back.
		expect(putBody).not.toHaveProperty("canEdit");
		expect(putBody).not.toHaveProperty("visibility");
	});

	test("@evidence a renamed workflow keeps its new name when saved again", async ({ page }, testInfo) => {
		// A stateful stand-in for the single-workflow route: PUT stores the
		// definition (a rename moves it), GET serves whatever is stored.
		let stored: Record<string, unknown> = { ...WORKFLOW };
		const puts: { path: string; body: Record<string, unknown> }[] = [];
		await page.route(/\/api\/workflows\/[^/?]+$/, (route) => {
			const req = route.request();
			const name = decodeURIComponent(new URL(req.url()).pathname.split("/").pop() ?? "");
			if (name === "runs") return route.fallback();
			if (req.method() === "PUT") {
				const body = req.postDataJSON() as Record<string, unknown>;
				puts.push({ path: name, body });
				stored = { ...stored, ...body };
				return route.fulfill({ json: { id: "wf-1", ...stored, version: puts.length + 1, versionMinted: true } });
			}
			if (req.method() === "GET") {
				if (name !== stored.name) return route.fulfill({ status: 404, json: { error: "Not found" } });
				return route.fulfill({
					json: { source: "db", visibility: "project", projectId: null, userId: "u1", forkedFrom: null, canEdit: true, ...stored },
				});
			}
			return route.fallback();
		});

		await openEditor(page);
		await page.getByTestId("tab-yaml").click();
		await page
			.getByTestId("yaml-editor")
			.fill("name: docs-guide\ndescription: writes the docs\nsteps:\n  - name: step-1\n    agent: summarizer\n");
		await page.getByTestId("save-yaml").click();

		// Save follows the new name; the reused page must load it.
		await expect(page).toHaveURL(/\/workflows\/docs-guide\/edit$/);
		await expect(page.getByRole("heading", { name: "Edit docs-guide" })).toBeVisible();

		// Second save, from the form: it must not write the old name back.
		await page.getByTestId("tab-form").click();
		await expect(page.getByLabel("Workflow Name")).toHaveValue("docs-guide");
		await page.getByRole("button", { name: "Save changes" }).click();
		await expect.poll(() => puts.length).toBe(2);
		expect(puts[0]).toMatchObject({ path: "docs-factory", body: { name: "docs-guide" } });
		expect(puts[1]).toMatchObject({ path: "docs-guide", body: { name: "docs-guide" } });
		await expect(page).toHaveURL(/\/workflows\/docs-guide\/edit$/);
		await captureEvidence(page, testInfo, "workflow-editor-renamed", { fullPage: true });
	});

	test("@evidence a dry run reports which steps were stubbed and which really ran", async ({
		page,
	}, testInfo) => {
		await openEditor(page);
		await page.getByTestId("dry-run-button").click();

		await expect(page.getByTestId("dry-run-report")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("dry-run-status")).toHaveText("success");
		// Green is reserved for a run with nothing left unenforced — this graph
		// has no gate at all. The `unverified` case below is the contrast.
		await expect(page.getByTestId("dry-run-status")).toHaveClass(/text-green-400/);
		// The agent step is stood in for; the transform is evaluated for real.
		await expect(page.getByTestId("dry-run-mode").first()).toHaveText("stubbed");
		await expect(page.getByTestId("dry-run-mode").nth(1)).toHaveText("evaluated");

		await captureEvidence(page, testInfo, "workflow-editor-dry-run", { fullPage: true });
	});

	test("@evidence a dry run whose gate ran on stub data is NOT reported as green", async ({
		page,
	}, testInfo) => {
		// The defect this replaces: the report said `success`, the badge was
		// green, and the only amber cue sat on the upstream agent step — while
		// the gate that decided on the fabricated value rendered teal. A stub
		// satisfies `truthy`, so that green meant nothing.
		await page.route(`**/api/workflows/${WORKFLOW.name}/dry-run`, (route) =>
			route.fulfill({
				json: {
					status: "unverified",
					stubbed: ["step-1"],
					steps: [
						{ name: "step-1", kind: "agent", mode: "stubbed", status: "success" },
						{ name: "check", kind: "gate", mode: "evaluated-on-stubs", status: "success" },
					],
					gatesOnStubs: [
						{
							name: "check",
							passed: true,
							reason: '$steps.step-1.output.ok (="«step-1.output.ok»") satisfies truthy',
						},
					],
				},
			}),
		);

		await openEditor(page);
		await page.getByTestId("dry-run-button").click();

		const status = page.getByTestId("dry-run-status");
		await expect(status).toHaveText("unverified");
		// Amber, never the green a real pass gets.
		await expect(status).toHaveClass(/text-amber-300/);
		await expect(status).not.toHaveClass(/text-green-400/);

		// The cue is on the GATE's row too, not only the stubbed agent above it.
		await expect(page.getByTestId("dry-run-mode").nth(1)).toHaveText("evaluated-on-stubs");
		await expect(page.getByTestId("dry-run-mode").nth(1)).toHaveClass(/text-amber-400/);

		// And the verdict is named, so the user knows WHICH gate was skipped.
		const unenforced = page.getByTestId("dry-run-unenforced-gates");
		await expect(unenforced).toContainText("not enforced");
		await expect(unenforced).toContainText("check");
		await expect(unenforced).toContainText("would have passed");

		await captureEvidence(page, testInfo, "workflow-editor-dry-run-unverified", {
			fullPage: true,
		});
	});

	test("a dry run with malformed JSON input reports it without calling the server", async ({
		page,
	}) => {
		await openEditor(page);

		let dryRunCalls = 0;
		await page.route(`**/api/workflows/${WORKFLOW.name}/dry-run`, (route) => {
			dryRunCalls += 1;
			return route.fallback();
		});

		await page.getByTestId("dry-run-input").fill("{ not json");
		await page.getByTestId("dry-run-button").click();

		await expect(page.getByTestId("dry-run-error")).toContainText("not valid JSON");
		expect(dryRunCalls).toBe(0);
	});

	test("the version history lists the recorded versions", async ({ page }) => {
		await openEditor(page);
		await expect(page.getByTestId("version-history")).toBeVisible();
		await expect(page.getByTestId("version-history")).toContainText("v1");
	});

	test("a workflow the caller cannot edit says so, rather than failing on save", async ({
		page,
	}) => {
		// `canEdit` is the server's answer. A `system` row the caller does
		// NOT own — every row that predates the ownership columns carries no
		// owner at all — is admin-only to edit, and the editor says so up
		// front instead of letting the user type and then 403 on save.
		await page.route(`**/api/workflows/${WORKFLOW.name}`, (route) => {
			if (route.request().method() === "GET") {
				return route.fulfill({
					json: {
						...WORKFLOW,
						source: "db",
						visibility: "system",
						userId: null,
						canEdit: false,
					},
				});
			}
			return route.fallback();
		});

		await openEditor(page);
		await expect(page.getByTestId("editor-readonly")).toBeVisible();
		// "duplicate it", not "fork it": the platform has ONE copy verb now,
		// and a banner that names a button which no longer exists is a
		// dead end dressed up as guidance.
		await expect(page.getByTestId("editor-readonly")).toContainText("duplicate it");
		// And the badge agrees with the banner: no owner on record, so an
		// admin is the only one who can change it. It must NOT read
		// `built-in` — nobody shipped this row, it is a legacy DB row.
		await expect(page.getByTestId("workflow-visibility")).toHaveText("unowned");
	});

	test("@evidence a `built-in` asset and a member's own `instance-wide` row are told apart", async ({
		page,
	}, testInfo) => {
		// Both rows are `visibility: "system"` on the wire, and the editor
		// used to render that word for both — so a workflow a member had
		// created thirty seconds earlier was labelled exactly like one that
		// ships with EZCorp. Same tier, different provenance, different
		// badge; captured side by side so the difference is visible and not
		// just asserted.
		const wire = (over: Record<string, unknown>) => ({
			...WORKFLOW,
			visibility: "system",
			canEdit: false,
			...over,
		});
		let payload: Record<string, unknown> = wire({ source: "yaml", userId: null });
		await page.route(`**/api/workflows/${WORKFLOW.name}`, (route) => {
			if (route.request().method() === "GET") return route.fulfill({ json: payload });
			return route.fallback();
		});

		// 1. Ships with the install: a file on disk, editable by nobody.
		await openEditor(page);
		await expect(page.getByRole("heading", { name: `Edit ${WORKFLOW.name}` })).toBeVisible();
		const badge = page.getByTestId("workflow-visibility");
		await expect(badge).toHaveText("built-in");
		await expect(badge).toHaveAttribute("title", /Ships with EZCorp/);
		await captureEvidence(page, testInfo, "workflow-editor-badge-built-in", { fullPage: true });

		// 2. Same tier, but somebody here made it and still owns it.
		payload = wire({ source: "db", userId: "the-caller", canEdit: true });
		await openEditor(page);
		await expect(page.getByRole("heading", { name: `Edit ${WORKFLOW.name}` })).toBeVisible();
		await expect(badge).toHaveText("instance-wide");
		await expect(badge).toHaveAttribute("title", /Made here/);
		// The distinction is not tooltip-only — the two pills differ on
		// sight, which is the half a screenshot can actually show.
		await expect(badge).not.toHaveClass(/text-teal-300/);
		await captureEvidence(page, testInfo, "workflow-editor-badge-instance-wide", {
			fullPage: true,
		});
	});

	test("@evidence the OWNER of a `system` workflow gets the editor, not the read-only banner", async ({
		page,
	}, testInfo) => {
		// The regression this guards. `POST /api/workflows` defaults
		// `visibility` to `system` and stamps the creator, and the ladder
		// used to refuse the tier before it consulted ownership — so the
		// author of a brand-new workflow landed on this page and was told
		// they could only fork their own work. Same tier as the case above;
		// the only difference is that the row has an owner and the server's
		// `canEdit` now says so.
		await page.route(`**/api/workflows/${WORKFLOW.name}`, (route) => {
			if (route.request().method() === "GET") {
				return route.fulfill({
					json: {
						...WORKFLOW,
						source: "db",
						visibility: "system",
						userId: "the-caller",
						canEdit: true,
					},
				});
			}
			return route.fallback();
		});

		await openEditor(page);
		// ORDER IS LOAD-BEARING. `data-testid="workflow-editor"` is the outer
		// shell and renders while the fetch is still in flight, so asserting
		// the banner's ABSENCE first would pass against a page that had not
		// rendered the workflow yet — and would pass just as happily if the
		// banner were about to appear. Wait for something inside the loaded
		// `{#if workflow}` block, which is the same block the banner lives
		// in, and only then assert the banner is not in it.
		await expect(page.getByRole("heading", { name: `Edit ${WORKFLOW.name}` })).toBeVisible();
		// `instance-wide`, not `system`: the tier on the wire is still
		// `system`, but the badge names the provenance the user needs.
		await expect(page.getByTestId("workflow-visibility")).toHaveText("instance-wide");
		await expect(page.getByTestId("editor-readonly")).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();

		await captureEvidence(page, testInfo, "workflow-editor-owned-system-editable", {
			fullPage: true,
		});
	});
});
