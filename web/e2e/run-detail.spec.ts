import { test, expect } from "./fixtures/test-base.js";
import { captureEvidence } from "./fixtures/evidence.js";
import { makeRun, makeProject } from "./fixtures/data.js";
import { clickInAppLink } from "./fixtures/client-nav.js";

test.describe("Run Detail", () => {
	test("shows run status, agent name, and run ID", async ({ page, mockApi }) => {
		await mockApi({
			runs: [
				makeRun({
					id: "run-abc123",
					agentName: "summarizer",
					status: "success",
				}),
			],
		});
		await page.goto("/runs/run-abc123");

		await expect(page.getByRole("heading", { name: "summarizer" })).toBeVisible();
		await expect(page.getByText("run-abc123")).toBeVisible();
	});

	test("shows started timestamp", async ({ page, mockApi }) => {
		await mockApi({
			runs: [
				makeRun({
					id: "run-1",
					startedAt: "2026-03-01T10:30:00.000Z",
				}),
			],
		});
		await page.goto("/runs/run-1");

		// `exact` — the substring form also matches the onboarding checklist's
		// "Get Started" button in the shell, which is a strict-mode violation
		// (2 elements) rather than a real absence. The timestamp label is its
		// own standalone <span>, so the exact match is the STRONGER assertion.
		await expect(page.getByText("Started", { exact: true })).toBeVisible();
	});

	test("shows finished timestamp and duration for completed runs", async ({ page, mockApi }) => {
		await mockApi({
			runs: [
				makeRun({
					id: "run-1",
					status: "success",
					startedAt: "2026-03-01T10:30:00.000Z",
					finishedAt: "2026-03-01T10:32:45.000Z",
				}),
			],
		});
		await page.goto("/runs/run-1");

		await expect(page.getByText("Finished")).toBeVisible();
		await expect(page.getByText("Duration")).toBeVisible();
		await expect(page.getByText("2m 45s", { exact: true })).toBeVisible();
	});

	test("shows logs section", async ({ page, mockApi }) => {
		await mockApi({
			runs: [
				makeRun({
					id: "run-1",
					logs: [
						{ timestamp: "2026-03-01T10:30:00.000Z", level: "info", message: "Starting summarization" },
						{ timestamp: "2026-03-01T10:30:01.000Z", level: "info", message: "Processing complete" },
					],
				}),
			],
		});
		await page.goto("/runs/run-1");

		await expect(page.getByText("Logs")).toBeVisible();
		await expect(page.getByText("Starting summarization")).toBeVisible();
		await expect(page.getByText("Processing complete")).toBeVisible();
	});

	test("surfaces a dropped reasoning effort as a WARN line", async ({ page, mockApi }) => {
		// This is the channel a workflow step's ignored `model: { effort }`
		// comes out of. `createPiLlmAdapter` reports the drop, `runAgent` writes
		// it into the run's own log at `warn`, and this page is where the person
		// who set the effort finds out it did nothing. Before this it was
		// silence — no error, no warning, no effect.
		const message =
			'Reasoning effort "high" was ignored: the bound model ollama/qwen3:1.7b ' +
			"does not accept a reasoning setting. Local and custom models never do.";
		await mockApi({
			runs: [
				makeRun({
					id: "run-effort",
					status: "success",
					logs: [
						{ timestamp: "2026-03-01T10:30:00.000Z", level: "info", message: "Starting step" },
						{ timestamp: "2026-03-01T10:30:01.000Z", level: "warn", message },
					],
				}),
			],
		});
		await page.goto("/runs/run-effort");

		await expect(page.getByText(message)).toBeVisible();
		// Rendered AS a warning, not as another info line — the level is the
		// only thing distinguishing it from the run's ordinary chatter.
		const row = page.locator("div.flex.gap-2", { hasText: "was ignored" });
		await expect(row).toHaveClass(/text-yellow-400/);
	});

	test("shows result section for completed runs", async ({ page, mockApi }) => {
		await mockApi({
			runs: [
				makeRun({
					id: "run-1",
					status: "success",
					result: { success: true, output: { summary: "A brief summary" } },
				}),
			],
		});
		await page.goto("/runs/run-1");

		await expect(page.getByText("Result")).toBeVisible();
		await expect(page.getByText("A brief summary")).toBeVisible();
	});

	test("moving from run A to run B in-app shows run B @evidence", async ({ page, mockApi }, testInfo) => {
		await mockApi({
			runs: [
				makeRun({ id: "run-a", agentName: "summarizer", status: "success" }),
				makeRun({ id: "run-b", agentName: "translator", status: "error" }),
			],
		});
		await page.goto("/runs/run-a");
		await expect(page.getByRole("heading", { name: "summarizer" })).toBeVisible();

		// Same route, new id: the page is reused and must load run B.
		await clickInAppLink(page, "/runs/run-b");
		await expect(page).toHaveURL("/runs/run-b");
		await expect(page.getByRole("heading", { name: "translator" })).toBeVisible();
		await expect(page.getByText("run-b")).toBeVisible();
		await expect(page.getByRole("heading", { name: "summarizer" })).toHaveCount(0);
		// A run left open for days reads in days and hours, not "410131m 29s".
		await expect(page.getByText(/^\d+d \d+h$/)).toBeVisible();
		await captureEvidence(page, testInfo, "run-detail-second-run");
	});

	test("missing run shows the error after the 404 response @evidence", async ({ page, mockApi }, testInfo) => {
		await mockApi({ runs: [] });
		const response = page.waitForResponse("**/api/runs/run-missing");
		await page.goto("/runs/run-missing");
		expect((await response).status()).toBe(404);
		await expect(page.getByRole("alert")).toContainText("Not found");
		await expect(page.getByText("Loading run...")).not.toBeVisible();
		await captureEvidence(page, testInfo, "missing-run-error");
	});

	test("back link returns to the run project without resuming the run again", async ({ page, mockApi }) => {
		await mockApi({
			projects: [makeProject({ id: "run-project", name: "Run Project" })],
			conversations: [],
			runs: [makeRun({ id: "run-1", projectId: "run-project" })],
		});
		await page.goto("/runs/run-1");
		await expect(page.getByRole("heading", { name: "test-agent", exact: true })).toBeVisible();
		await page.getByRole("link", { name: /Back/ }).click();
		await expect(page).toHaveURL("/project/run-project/chat");
		await expect(page.getByRole("heading", { name: "No conversations yet" })).toBeVisible();
	});
});
