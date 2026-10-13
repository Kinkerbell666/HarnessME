/**
 * E2E for the `![workflow:…]` composer flow.
 *
 * Covered behaviors:
 *   1. Typing `!workflow:` opens the mention popover showing ONLY the
 *      Workflows group.
 *   2. Typing a bare `!` also lists workflows, so the kind is reachable
 *      without knowing the prefix (the only other discovery path is the
 *      composer's `?` tooltip).
 *   3. Selecting an entry inserts the raw `![workflow:NAME] ` token and
 *      the composer paints a TEAL chip over it.
 *   4. Selecting a workflow opens NOTHING — no tool form, no picker, no
 *      run. The mention is a reference; execution is the `run_workflow`
 *      tool's job. A picker that fired a deploy on hover-and-click would
 *      be a real incident, so this is asserted rather than assumed.
 *   5. A persisted `![workflow:NAME]` token in chat history renders as
 *      the same teal chip.
 *   6. A slow answer to an older query never replaces the newer list, so
 *      Enter cannot pick an entry the user typed past.
 *
 * Server-side expansion (the system note describing the workflow) is
 * covered at the unit/integration level; this suite is the composer +
 * render surface only.
 *
 * `@evidence`-tagged: this ships a new pill colour, and the Visual
 * evidence CI gate attaches the screenshots to the PR.
 */
import { test, expect, captureEvidence } from "./fixtures/test-base.js";
import {
	makeProject,
	makeConversation,
	makeMessage,
	makeAgent,
	makeWorkflow,
} from "./fixtures/data.js";

const PROJECT_ID = "proj-workflow-mention";
const CONV_ID = "conv-workflow-mention";

const project = makeProject({ id: PROJECT_ID, name: "Workflow Mention Project" });
const conv = makeConversation({
	id: CONV_ID,
	projectId: PROJECT_ID,
	title: "Workflow mention chat",
});

const workflows = [
	makeWorkflow({ name: "deploy", description: "Build, test and ship to prod" }),
	makeWorkflow({ name: "nightly", description: "Run the nightly regression sweep" }),
];

/** Composer readiness + the WS-open race every other mention spec waits on. */
async function waitForComposer(page: any) {
	const textarea = page.locator("textarea").first();
	await expect(textarea).toBeVisible({ timeout: 5000 });
	await page.waitForFunction(
		() => {
			const w = window as any;
			const listeners = w.__fakeWsListeners;
			if (listeners?.open) {
				for (const fn of listeners.open) {
					// The predicate is polled, so one listener throwing must not
					// abort the whole wait. But swallowing it silently turns a real
					// wiring bug into an opaque 5s timeout — record instead, and
					// assert below so the failure names its own cause.
					try {
						fn(new Event("open"));
					} catch (err) {
						w.__wsOpenErrors = [...(w.__wsOpenErrors ?? []), String(err)];
					}
				}
			}
			const ta = document.querySelector("textarea");
			return ta && !(ta as HTMLTextAreaElement).disabled;
		},
		{ timeout: 5000 },
	);
	expect(await page.evaluate(() => (window as any).__wsOpenErrors ?? [])).toEqual([]);
	await expect(textarea).toBeEnabled({ timeout: 5000 });
	await textarea.click();
	return textarea;
}

test.describe("Workflow mention — composer flow", () => {
	test("type !workflow: → picker lists workflows → pick → teal chip @evidence", async ({
		page,
		mockApi,
	}, testInfo) => {
		await mockApi({
			projects: [project],
			conversations: [conv],
			messages: [],
			agents: [makeAgent({ name: "summarizer", description: "Summarizer agent" })],
			workflows,
		});

		await page.goto(`/project/${PROJECT_ID}/chat/${CONV_ID}`);
		const textarea = await waitForComposer(page);

		await textarea.focus();
		await textarea.pressSequentially("!workflow:", { delay: 40 });
		await page.waitForTimeout(350);

		const listbox = page.locator("#mention-listbox");
		await expect(listbox).toBeVisible({ timeout: 5000 });

		// The Workflows group renders, and ONLY it — the `!workflow:`
		// prefix is mutually exclusive with agents/extensions/teams.
		await expect(listbox.getByText("Workflows")).toBeVisible();
		await expect(listbox.getByText("Agents")).not.toBeVisible();

		const rows = listbox.locator('button[data-mention-kind="workflow"]');
		await expect(rows).toHaveCount(2);
		// Rows read `!name` — bare, matching the committed chip.
		await expect(rows.first()).toContainText("!deploy");
		await expect(rows.first()).toContainText("Build, test and ship to prod");

		await captureEvidence(page, testInfo, "workflow-mention-popover");

		await rows.first().click();

		// Popover closes; the WIRE value is the raw token but the composer
		// textarea lays out the COMPACT display string (`!deploy`).
		await expect(listbox).not.toBeVisible({ timeout: 2000 });
		await expect(textarea).toHaveValue(/^!deploy\s+$/);

		// Teal chip painted over the reserved span.
		const chip = page.locator('[data-mention-kind="workflow"][data-mention-name="deploy"]');
		await expect(chip.first()).toBeVisible();
		await expect(chip.first()).toHaveText("!deploy");
		await expect(chip.first()).toHaveClass(/text-teal-300/);
		await expect(chip.first()).toHaveClass(/bg-teal-500\/20/);

		// Reference-only: nothing opened. An inline tool form or picker
		// here would mean selecting a workflow can start doing work.
		await expect(page.locator("#tool-picker")).toHaveCount(0);
		await expect(page.getByRole("dialog")).toHaveCount(0);

		await captureEvidence(page, testInfo, "workflow-mention-chip");
	});

	test("bare `!` also surfaces workflows alongside agents", async ({ page, mockApi }) => {
		await mockApi({
			projects: [project],
			conversations: [conv],
			messages: [],
			agents: [makeAgent({ name: "summarizer", description: "Summarizer agent" })],
			workflows,
		});

		await page.goto(`/project/${PROJECT_ID}/chat/${CONV_ID}`);
		const textarea = await waitForComposer(page);

		await textarea.focus();
		await textarea.pressSequentially("!", { delay: 40 });
		await page.waitForTimeout(350);

		const listbox = page.locator("#mention-listbox");
		await expect(listbox).toBeVisible({ timeout: 5000 });
		// Both groups present — this is the discoverability path for a user
		// who doesn't know the `workflow:` prefix exists.
		await expect(listbox.getByText("Workflows")).toBeVisible();
		await expect(listbox.getByText("Agents")).toBeVisible();
		await expect(
			listbox.locator('button[data-mention-kind="workflow"]'),
		).toHaveCount(2);
	});

	test("a slow answer to an older query never replaces the newer list @evidence", async ({ page, mockApi }, testInfo) => {
		await mockApi({
			projects: [project],
			conversations: [conv],
			messages: [],
			agents: [],
			workflows,
		});
		// Hold the first (unfiltered) workflow search until the narrower one
		// has answered, so it lands last — the order a slow server produces.
		let releaseSlow: () => void = () => {};
		const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
		const isSlow = (u: string) => {
			const url = new URL(u);
			return url.pathname === "/api/mentions/search" && url.searchParams.get("type") === "workflow" && url.searchParams.get("q") === "";
		};
		await page.route("**/api/mentions/search**", async (route) => {
			if (isSlow(route.request().url())) await slowGate;
			await route.fallback();
		});

		await page.goto(`/project/${PROJECT_ID}/chat/${CONV_ID}`);
		const textarea = await waitForComposer(page);
		const slowRequest = page.waitForRequest((req) => isSlow(req.url()));
		await textarea.pressSequentially("!workflow:", { delay: 40 });
		await slowRequest;
		await textarea.pressSequentially("nig", { delay: 40 });

		const listbox = page.locator("#mention-listbox");
		const rows = listbox.locator('button[data-mention-kind="workflow"]');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("!nightly");

		const slowResponse = page.waitForResponse((res) => isSlow(res.url()));
		releaseSlow();
		await slowResponse;
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("!nightly");
		await captureEvidence(page, testInfo, "workflow-mention-latest-results");

		await textarea.press("Enter");
		await expect(textarea).toHaveValue(/^!nightly\s+$/);
	});

	test("typing the kind label (`!wo`) narrows to workflows", async ({ page, mockApi }) => {
		await mockApi({
			projects: [project],
			conversations: [conv],
			messages: [],
			agents: [makeAgent({ name: "summarizer", description: "Summarizer agent" })],
			workflows,
		});

		await page.goto(`/project/${PROJECT_ID}/chat/${CONV_ID}`);
		const textarea = await waitForComposer(page);

		await textarea.focus();
		await textarea.pressSequentially("!wo", { delay: 40 });
		await page.waitForTimeout(350);

		const listbox = page.locator("#mention-listbox");
		await expect(listbox).toBeVisible({ timeout: 5000 });
		await expect(
			listbox.locator('button[data-mention-kind="workflow"]'),
		).toHaveCount(2);
		// No agent matches "wo", so the Agents group is gone entirely.
		await expect(listbox.getByText("Agents")).not.toBeVisible();
	});
});

test.describe("Workflow mention — chat history", () => {
	test("a persisted ![workflow:…] token renders as a teal chip @evidence", async ({
		page,
		mockApi,
	}, testInfo) => {
		await mockApi({
			projects: [project],
			conversations: [conv],
			workflows,
			messages: [
				makeMessage({
					id: "msg-wf-1",
					conversationId: CONV_ID,
					role: "user",
					content: "Kick off ![workflow:deploy] when the suite is green.",
				}),
			],
		});

		await page.goto(`/project/${PROJECT_ID}/chat/${CONV_ID}`);
		await waitForComposer(page);

		const chip = page
			.locator('[data-mention-kind="workflow"][data-mention-name="deploy"]')
			.first();
		await expect(chip).toBeVisible({ timeout: 5000 });
		// Bare name under the `!` sigil — no `workflow:` prefix on screen.
		await expect(chip).toHaveText("!deploy");
		await expect(chip).toHaveClass(/text-teal-300/);
		// The raw token is what persisted; the reader sees the chip.
		await expect(page.getByText("![workflow:deploy]")).toHaveCount(0);

		await captureEvidence(page, testInfo, "workflow-mention-history-chip");
	});
});
