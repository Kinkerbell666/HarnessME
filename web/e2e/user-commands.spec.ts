import { test, expect, captureEvidence } from "./fixtures/test-base.js";
import { clickInAppLink } from "./fixtures/client-nav.js";

/**
 * E2E coverage for the /commands authoring UI. Walks the full user
 * journey from the Verification section of the spec:
 *   1. Create a command via /commands/new → redirect to
 *      /commands/[savedName].
 *   2. Edit the body, save, verify the new value persists.
 *   3. Delete-with-confirm removes the row.
 *   4. Bad-slug input shows an inline validation error and never
 *      hits the API.
 *   5. Oversize body disables Save and shows the byte-counter error.
 *   6. Auto-suffix rename surfaces a toast (`Saved as "review-2"`).
 *
 * The chat-popover round-trip (steps 2/3 of the Verification list
 * — "Open any chat, type /myr, confirm /myreview appears in popover
 * with 'Saved' source badge" + sending and asserting the LLM-facing
 * expansion) is exercised in its own spec:
 * `user-commands-chat-popover.spec.ts`. The `data-source="user:db"`
 * attribute asserted on the CommandCard below is the same marker
 * the popover row renders, keeping the two specs aligned on a
 * single source-badge contract.
 */

test.describe("/commands authoring UI", () => {
	test("list page shows New Command CTA and empty state when no rows", async ({
		page,
		mockApi,
	}) => {
		await mockApi({ userCommands: [] });
		await page.goto("/commands");
		// `exact` because the accessible-name match is a case-insensitive
		// SUBSTRING: the empty state's own "No commands yet" heading also
		// matches "Commands", so the un-exact locator resolves to two
		// elements and trips strict mode. It passed only by racing — when
		// the assertion ran before the empty state mounted, one element
		// matched and it went green. Under load the h3 wins and it fails.
		await expect(page.getByRole("heading", { name: "Commands", exact: true })).toBeVisible();
		await expect(page.getByRole("link", { name: "+ New Command" })).toBeVisible();
		await expect(page.getByText("No commands yet")).toBeVisible();
	});

	test("list page renders one CommandCard per row with the Saved badge", async ({
		page,
		mockApi,
	}) => {
		await mockApi({
			userCommands: [
				{ name: "review", body: "Review: $ARGUMENTS", description: "Code review" },
				{ name: "audit", body: "Audit: $ARGUMENTS", description: "Audit logs" },
			],
		});
		await page.goto("/commands");
		await expect(page.getByText("/review")).toBeVisible();
		await expect(page.getByText("/audit")).toBeVisible();
		// Source badge is the same value the popover renders.
		const cards = page.locator('[data-testid="command-card"]');
		await expect(cards).toHaveCount(2);
		await expect(cards.first()).toHaveAttribute("data-source", "user:db");
		await expect(page.getByText("Saved").first()).toBeVisible();
	});

	test("create flow: form → POST → redirect to /commands/[savedName]", async ({
		page,
		mockApi,
	}) => {
		await mockApi({ userCommands: [] });
		await page.goto("/commands/new");
		await expect(page.getByRole("heading", { name: "New Command" })).toBeVisible();

		await page.getByTestId("command-form-name").fill("myreview");
		await page.getByTestId("command-form-description").fill("Review staged changes");
		await page.getByTestId("command-form-body").fill("Review: $ARGUMENTS");
		await page.getByTestId("command-form-submit").click();

		await expect(page).toHaveURL("/commands/myreview");
	});

	// Frontend-visual change (components/**): the advisory Model field's
	// placeholder was updated off the retired `claude-3-5-sonnet` id to a
	// current one. @evidence-tagged so the Visual evidence gate captures the
	// form and the maintainer can eyeball the placeholder in the PR.
	test("create form Model field shows the current model-id placeholder @evidence", async ({
		page,
		mockApi,
	}, testInfo) => {
		await mockApi({ userCommands: [] });
		await page.goto("/commands/new");
		await expect(page.getByRole("heading", { name: "New Command" })).toBeVisible();

		const modelInput = page.getByTestId("command-form-model");
		await expect(modelInput).toBeVisible();
		// A CURRENT pi-ai model id — the previous `claude-3-5-sonnet` placeholder
		// referenced a snapshot family pi-ai has since retired.
		await expect(modelInput).toHaveAttribute("placeholder", "claude-sonnet-4-5");

		await captureEvidence(page, testInfo, "command-form-model-placeholder");
	});

	test("bad slug shows inline error and never fires the API", async ({
		page,
		mockApi,
	}) => {
		// Capture POST attempts so we can prove none fired.
		const posts: string[] = [];
		await page.route("**/api/user-commands", async (route) => {
			if (route.request().method() === "POST") posts.push("post");
			await route.continue();
		});
		await mockApi({ userCommands: [] });
		await page.goto("/commands/new");

		await page.getByTestId("command-form-name").fill("My Review");
		await page.getByTestId("command-form-body").fill("body");
		await page.getByTestId("command-form-submit").click();

		await expect(page.getByTestId("command-form-name-error")).toBeVisible();
		await expect(page.getByTestId("command-form-name-error")).toContainText(
			/lowercase alphanumeric/i,
		);
		expect(posts).toHaveLength(0);
	});

	test("oversize body disables Save + shows the byte-counter error", async ({
		page,
		mockApi,
	}) => {
		await mockApi({ userCommands: [] });
		await page.goto("/commands/new");

		await page.getByTestId("command-form-name").fill("ok");
		// 64 KB + 1 — slightly over the cap. fill() bypasses keypress
		// throttling so this is fast.
		const oversize = "x".repeat(64 * 1024 + 1);
		await page.getByTestId("command-form-body").fill(oversize);

		const submit = page.getByTestId("command-form-submit");
		await expect(submit).toBeDisabled();
		await expect(page.getByTestId("command-form-body-bytes")).toContainText(
			/65537 \/ 65536/,
		);
	});

	test("auto-suffix rename surfaces a toast and persists the suffixed name", async ({
		page,
		mockApi,
	}) => {
		await mockApi({
			// Seed a row already named `review` so the next POST renames.
			userCommands: [{ name: "review", body: "first" }],
		});
		await page.goto("/commands/new");
		await page.getByTestId("command-form-name").fill("review");
		await page.getByTestId("command-form-body").fill("second");
		await page.getByTestId("command-form-submit").click();

		// Redirected to the SUFFIXED name, not the input.
		await expect(page).toHaveURL("/commands/review-2");
		// Toast surfaces the rename. Toast root lives at the layout
		// level; the message text is the assertion hook.
		await expect(page.getByText(/Saved as "review-2"/i)).toBeVisible();
	});

	test("edit flow: PATCH updates the body and redirects back to /commands", async ({
		page,
		mockApi,
	}) => {
		await mockApi({
			userCommands: [{ name: "myreview", body: "Review: $ARGUMENTS" }],
		});
		await page.goto("/commands/myreview");
		await expect(page.getByRole("heading", { name: "Edit /myreview" })).toBeVisible();

		// Name input must be disabled on edit mode.
		const nameInput = page.getByTestId("command-form-name");
		await expect(nameInput).toBeDisabled();
		await expect(nameInput).toHaveValue("myreview");

		const body = page.getByTestId("command-form-body");
		await body.fill("Audit: $ARGUMENTS");
		await page.getByTestId("command-form-submit").click();

		await expect(page).toHaveURL("/commands");
		// Card on the list reflects the row. Scope the assertion to a
		// CommandCard heading so the success toast (which also contains
		// "/myreview") doesn't double-match.
		const cards = page.locator('[data-testid="command-card"]');
		await expect(cards).toHaveCount(1);
		await expect(cards.first().getByRole("heading")).toHaveText("/myreview");
	});

	test("moving from one command's editor to another loads the second command @evidence", async ({
		page,
		mockApi,
	}, testInfo) => {
		await mockApi({
			userCommands: [
				{ name: "review", body: "Review: $ARGUMENTS" },
				{ name: "explain", body: "Explain: $ARGUMENTS" },
			],
		});
		await page.goto("/commands/review");
		await expect(page.getByTestId("command-form-body")).toHaveValue("Review: $ARGUMENTS");

		// Same route, new param: SvelteKit reuses the page, which must load
		// the new command rather than keep editing the old one.
		await clickInAppLink(page, "/commands/explain");
		await expect(page).toHaveURL("/commands/explain");
		await expect(page.getByRole("heading", { name: "Edit /explain" })).toBeVisible();
		await expect(page.getByTestId("command-form-name")).toHaveValue("explain");
		await expect(page.getByTestId("command-form-body")).toHaveValue("Explain: $ARGUMENTS");
		await captureEvidence(page, testInfo, "command-editor-second-command");
	});

	test("opening a command that does not exist shows the load error", async ({ page, mockApi }) => {
		await mockApi({ userCommands: [{ name: "review", body: "Review: $ARGUMENTS" }] });
		await page.goto("/commands/missing");
		await expect(page.getByTestId("commands-edit-load-error")).toBeVisible();
		await expect(page.getByTestId("command-form-body")).toHaveCount(0);
	});

	test("delete-with-confirm removes the row from /commands list page", async ({
		page,
		mockApi,
	}) => {
		await mockApi({
			userCommands: [{ name: "tobegone", body: "x" }],
		});
		// Auto-accept the browser confirm dialog.
		page.on("dialog", (d) => d.accept());

		await page.goto("/commands");
		await expect(page.getByText("/tobegone")).toBeVisible();
		await page.getByTestId("command-card-delete").click();
		// The card disappears; only the empty state is left. The toast
		// "Deleted /tobegone" also contains the slug, so we assert the
		// CommandCard count instead of the slug text.
		await expect(page.locator('[data-testid="command-card"]')).toHaveCount(0);
		await expect(page.getByText("No commands yet")).toBeVisible();
	});

	test("delete-cancel keeps the row in place", async ({ page, mockApi }) => {
		await mockApi({
			userCommands: [{ name: "stay", body: "x" }],
		});
		page.on("dialog", (d) => d.dismiss());

		await page.goto("/commands");
		await page.getByTestId("command-card-delete").click();
		// Still visible.
		await expect(page.getByText("/stay")).toBeVisible();
	});

	test("delete from edit page redirects to /commands", async ({ page, mockApi }) => {
		await mockApi({
			userCommands: [{ name: "doomed", body: "x" }],
		});
		page.on("dialog", (d) => d.accept());

		await page.goto("/commands/doomed");
		await expect(page.getByRole("heading", { name: "Edit /doomed" })).toBeVisible();
		await page.getByTestId("commands-edit-delete").click();
		await expect(page).toHaveURL("/commands");
		await expect(page.getByText("No commands yet")).toBeVisible();
	});

	// Sidebar navigation is split desktop/mobile because the (app)
	// layout hides the inline sidebar below `lg` (1024px) and shows a
	// hamburger drawer instead — see web/src/routes/(app)/+layout.svelte.
	// Running the unified test under `mobile-chromium` (Pixel 5) would
	// hit the hidden sidebar link and fail the visibility check, so
	// each viewport gets its own positive path.
	test("sidebar Commands link navigates to /commands (desktop)", async ({
		page,
		mockApi,
	}) => {
		await page.setViewportSize({ width: 1024, height: 768 });
		await mockApi({ userCommands: [] });
		await page.goto("/");
		// Sidebar shows the Build group with the new Commands entry.
		// Scope to the desktop sidebar so the (initially hidden) mobile
		// drawer's copy can't double-match.
		const link = page
			.getByTestId("desktop-sidebar")
			.getByRole("link", { name: "Commands", exact: true });
		await expect(link).toBeVisible();
		await link.click();
		await expect(page).toHaveURL("/commands");
	});

	test("sidebar Commands link navigates to /commands (mobile drawer)", async ({
		page,
		mockApi,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await mockApi({ userCommands: [] });
		// Use a non-chat route as the starting point — `/` redirects to
		// the active chat and the (app) layout hides the mobile header
		// on chat routes (see web/src/routes/(app)/+layout.svelte's
		// `isChatRoute` guard). `/agents` is the closest sibling that
		// keeps the mobile header visible.
		await page.goto("/agents");
		// Hamburger toggle is in the mobile header — open the drawer so
		// the SwipeDrawer-mounted nav becomes interactable.
		const toggle = page.getByTestId("mobile-menu-toggle");
		await expect(toggle).toBeVisible();
		await toggle.click();
		// The drawer renders the SAME navLinks list as desktop, including
		// the "Commands" entry; with the desktop sidebar still hidden at
		// this viewport, this getByRole resolves unambiguously.
		const link = page.getByRole("link", { name: "Commands", exact: true });
		await expect(link).toBeVisible();
		await link.click();
		await expect(page).toHaveURL("/commands");
	});
});
