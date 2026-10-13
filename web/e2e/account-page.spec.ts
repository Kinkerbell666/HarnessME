import { test, expect, captureEvidence } from "./fixtures/test-base.js";
import { makeProject } from "./fixtures/data.js";

test.describe("Account Page", () => {
	const proj = makeProject({ id: "proj-1", name: "Test Project" });

	const accountData = {
		id: "user-1",
		email: "user@test.local",
		name: "Test User",
		role: "member" as const,
		createdAt: "2026-01-15T00:00:00.000Z",
	};

	const meResponse = {
		user: { id: "user-1", email: "user@test.local", name: "Test User", role: "member" },
	};

	test("displays account information", async ({ page, mockApi }) => {
		await mockApi({
			projects: [proj],
			routes: {
				"/api/auth/me": () => meResponse,
				"/api/account": () => accountData,
			},
		});

		await page.goto("/account");

		await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible({ timeout: 5000 });
		await expect(page.getByRole("heading", { name: "Account Info" })).toBeVisible();
		await expect(page.getByText("Test User").first()).toBeVisible();
		await expect(page.getByText("user@test.local").first()).toBeVisible();
		await expect(page.getByText("member", { exact: true })).toBeVisible();
	});

	test("shows profile edit form with current values", async ({ page, mockApi }) => {
		await mockApi({
			projects: [proj],
			routes: {
				"/api/auth/me": () => meResponse,
				"/api/account": () => accountData,
			},
		});

		await page.goto("/account");

		const nameInput = page.locator("#account-name");
		await expect(nameInput).toHaveValue("Test User", { timeout: 5000 });

		const emailInput = page.locator("#account-email");
		await expect(emailInput).toHaveValue("user@test.local");
	});

	test("shows password requirement when email is changed", async ({ page, mockApi }) => {
		await mockApi({
			projects: [proj],
			routes: {
				"/api/auth/me": () => meResponse,
				"/api/account": () => accountData,
			},
		});

		await page.goto("/account");

		await expect(page.locator("#account-email")).toHaveValue("user@test.local", { timeout: 5000 });

		await page.locator("#account-email").fill("new@test.local");

		await expect(page.getByText("Email changes require your current password")).toBeVisible({ timeout: 3000 });
		await expect(page.getByPlaceholder("Current password")).toBeVisible();
	});

	test("change password section exists", async ({ page, mockApi }) => {
		await mockApi({
			projects: [proj],
			routes: {
				"/api/auth/me": () => meResponse,
				"/api/account": () => accountData,
			},
		});

		await page.goto("/account");

		await expect(page.getByRole("heading", { name: "Change Password" })).toBeVisible({ timeout: 5000 });
		await expect(page.locator("#current-pw")).toBeVisible();
		await expect(page.locator("#new-pw")).toBeVisible();
		await expect(page.locator("#confirm-pw")).toBeVisible();
		await expect(page.getByRole("button", { name: "Change Password" })).toBeVisible();
	});

	test("shows error for mismatched passwords", async ({ page, mockApi }) => {
		await mockApi({
			projects: [proj],
			routes: {
				"/api/auth/me": () => meResponse,
				"/api/account": () => accountData,
			},
		});

		await page.goto("/account");

		await expect(page.locator("#current-pw")).toBeVisible({ timeout: 5000 });

		await page.locator("#current-pw").fill("password123");
		await page.locator("#new-pw").fill("newpassword456");
		await page.locator("#confirm-pw").fill("different789");

		await page.getByRole("button", { name: "Change Password" }).click();

		await expect(page.getByText("Passwords do not match")).toBeVisible({ timeout: 3000 });
	});

	test("password change keeps the user on the account page @evidence", async ({ page, mockApi }, testInfo) => {
		await mockApi({
			projects: [proj],
			routes: {
				"/api/auth/me": () => meResponse,
				"/api/account": () => accountData,
			},
		});
		await page.route("**/api/account/password", (route) =>
			route.fulfill({ json: { success: true, message: "Password changed. Other sessions were signed out." } }),
		);

		await page.goto("/account");

		await expect(page.locator("#current-pw")).toBeVisible({ timeout: 5000 });
		await page.locator("#current-pw").fill("password123");
		await page.locator("#new-pw").fill("NewPass1!");
		await page.locator("#confirm-pw").fill("NewPass1!");
		await page.getByRole("button", { name: "Change Password" }).click();

		await expect(page.getByText("Password changed. Other sessions were signed out.")).toBeVisible({ timeout: 5000 });
		// The current session is kept, so the page stays put and clears the form.
		await expect(page).toHaveURL(/\/account$/);
		await expect(page.locator("#current-pw")).toHaveValue("");
		await expect(page.locator("#new-pw")).toHaveValue("");
		await expect(page.locator("#confirm-pw")).toHaveValue("");
		await captureEvidence(page, testInfo, "account-password-changed");
	});

	test("profile save success shows confirmation", async ({ page, mockApi }) => {
		await mockApi({
			projects: [proj],
			routes: {
				"/api/auth/me": () => meResponse,
				"/api/account": () => accountData,
			},
		});

		// Add a higher-priority route for PUT /api/account
		await page.route("**/api/account", (route) => {
			if (route.request().method() === "PUT") {
				return route.fulfill({ json: { ...accountData, name: "Updated Name" } });
			}
			// Let other methods fall through to the mockApi handler
			return route.fallback();
		});

		await page.goto("/account");

		await expect(page.locator("#account-name")).toHaveValue("Test User", { timeout: 5000 });

		await page.locator("#account-name").fill("Updated Name");
		await page.getByRole("button", { name: "Save Profile" }).click();

		await expect(page.getByText("Profile updated")).toBeVisible({ timeout: 5000 });
	});
});
