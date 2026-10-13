/**
 * B3 — fallback pending-permission tray e2e.
 *
 * An EXTENSION-initiated privileged tool call (ez-code-factory's init_gate
 * hitting fs.write / shell) fires `tool:permission_request` on a conversation
 * the streaming layer never registered a run for. Before this fix the handler
 * only warned + toasted, so NO approval card rendered and the backend gate hung
 * forever. The fix routes such prompts onto a global fallback tray so the user
 * can still approve/deny.
 *
 * This spec drives the run-less prompt over the real SSE runtime-events stream
 * (the store subscribes via EventSource on `/api/runtime-events`) and asserts:
 *   - the tray renders a PermissionGate card (the extension four-scope chooser)
 *   - approving POSTs the decision to /api/tool-calls/:id/permission
 *   - the card is removed from the tray after resolution
 *
 * The `@evidence`-tagged case satisfies the Visual evidence CI gate (this adds
 * a new layout-scope surface). `captureEvidence` is a hard no-op unless
 * `EZCORP_E2E_EVIDENCE=1`.
 */
import { test, expect, captureEvidence } from "./fixtures/test-base.js";
import type { Page } from "@playwright/test";
import { makeProject } from "./fixtures/data.js";
import { expectReadable, expectWarningTinted, useLightTheme } from "./fixtures/readable.js";

const PROMPT_ID = "prompt-init-gate-e2e";

const PERMISSION_EVENT = {
	type: "tool:permission_request",
	data: {
		conversationId: "conv-no-run-e2e",
		toolCallId: PROMPT_ID,
		toolName: "ez-code-factory__init_gate",
		input: { projectRoot: "/app/projects/ecf-demo" },
		extensionId: "ez-code-factory",
		capabilityKind: "shell",
	},
};

/** Capture the permission-decision POST so approve/deny resolves cleanly. */
async function installPermissionMock(page: Page) {
	const posts: unknown[] = [];
	await page.route("**/api/tool-calls/*/permission", (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		posts.push(route.request().postDataJSON());
		return route.fulfill({ json: { ok: true } });
	});
	return posts;
}

/** Wait until the store's SSE stream exists, then emit the run-less prompt. */
async function emitRunlessPrompt(
	page: Page,
	emitSse: (e: { type: string; data: unknown }, urlMatch?: string) => Promise<void>,
) {
	await page.waitForFunction(() => {
		const es = (window as unknown as { __fakeEventSources?: unknown[] }).__fakeEventSources;
		return Array.isArray(es) && es.length > 0;
	});
	await emitSse(PERMISSION_EVENT, "runtime-events");
}

test.describe("Fallback pending-permission tray", () => {
	const proj = makeProject({ id: "proj-1" });

	test("run-less permission prompt renders on the tray and approving clears it", async ({
		page,
		mockApi,
		emitSse,
	}) => {
		await mockApi({ projects: [proj] });
		const posts = await installPermissionMock(page);

		await page.goto("/extensions");
		await emitRunlessPrompt(page, emitSse);

		// The prompt renders on the global fallback tray (four-scope chooser
		// because it's an extension-scoped capability).
		const tray = page.getByTestId("pending-permission-tray");
		await expect(tray).toBeVisible();
		await expect(page.getByTestId("permission-extension-badge")).toHaveText("ez-code-factory");
		await expect(page.getByTestId("permission-allow-session")).toBeVisible();

		// Approve → POST the decision, then the card is removed.
		await page.getByTestId("permission-allow-session").click();
		await expect(tray).toHaveCount(0);
		expect(posts).toEqual([{ approved: true, scope: "session" }]);
	});

	test("renders the fallback tray and captures evidence @evidence", async ({
		page,
		mockApi,
		emitSse,
	}, testInfo) => {
		await mockApi({ projects: [proj] });
		await installPermissionMock(page);

		await page.goto("/extensions");
		await emitRunlessPrompt(page, emitSse);

		const tray = page.getByTestId("pending-permission-tray");
		await expect(tray).toBeVisible();
		await captureEvidence(page, testInfo, "pending-permission-tray");

		if (process.env.EZCORP_E2E_EVIDENCE === "1") {
			expect(
				testInfo.attachments.some(
					(a) => a.name === "pending-permission-tray" && a.contentType === "image/png",
				),
			).toBe(true);
		} else {
			expect(testInfo.attachments.some((a) => a.name === "pending-permission-tray")).toBe(false);
		}
	});

	/**
	 * The consent prompt's SECURITY NOTE has to be readable.
	 *
	 * `PermissionGate` is the per-tool-call consent prompt: the note under
	 * the tool name is the sentence telling the user what they are about to
	 * authorise ("This tool will run a shell command"). It was
	 * `text-amber-300/80` inside a `bg-amber-900/10` container — a pairing
	 * tuned for a dark surface. On the default light theme that renders pale
	 * amber at 80% opacity over a near-white wash, so the one line that makes
	 * the consent INFORMED was effectively invisible. An unreadable security
	 * note is precisely the failure mode this gate exists to prevent, which
	 * is why it is asserted numerically here rather than left to a reviewer
	 * noticing a washed-out screenshot.
	 */
	test("the consent prompt's security note is legible on the light theme @evidence", async ({
		page,
		mockApi,
		emitSse,
	}, testInfo) => {
		await useLightTheme(page);
		await mockApi({ projects: [proj] });
		await installPermissionMock(page);

		await page.goto("/extensions");
		await page.waitForFunction(() => {
			const es = (window as unknown as { __fakeEventSources?: unknown[] }).__fakeEventSources;
			return Array.isArray(es) && es.length > 0;
		});
		// `category: "execute"` is what makes `getSecurityNote` produce the
		// note; the tray's other cases don't need it, so it is set here
		// rather than on the shared event.
		await emitSse(
			{
				type: "tool:permission_request",
				data: { ...PERMISSION_EVENT.data, category: "execute" },
			},
			"runtime-events",
		);

		const card = page.getByTestId("tool-card-permission");
		await expect(card).toBeVisible({ timeout: 5000 });

		const note = card.getByText("This tool will run a shell command");
		await expect(note).toBeVisible();
		const m = await expectReadable(note, "PermissionGate security note");
		expect(m.dark, "the regression only shows on light surfaces").toBe(false);

		// The capability chip carries the same risk signal and had the same
		// amber-on-pale problem.
		await expectReadable(
			card.getByText("execute", { exact: true }),
			"PermissionGate category chip",
		);

		// The extension badge names who is asking; pale blue on a pale tint
		// made it unreadable on the light theme too.
		await expectReadable(card.getByTestId("permission-extension-badge"), "PermissionGate extension badge");

		// The card must still READ as a caution surface — legibility achieved
		// by deleting the tint would be a different bug with a green test.
		await expectWarningTinted(card, "PermissionGate container");

		await captureEvidence(page, testInfo, "permission-gate-security-note");
	});

	/**
	 * An extension install prompt names what it really asks for, and offers
	 * only a one-time allow: the server never persists install approvals, so
	 * a lasting scope ("Always allow") would be a promise it does not keep.
	 */
	test("an install prompt says what it installs and offers only this one time @evidence", async ({
		page,
		mockApi,
		emitSse,
	}, testInfo) => {
		await mockApi({ projects: [proj] });
		const posts = await installPermissionMock(page);

		await page.goto("/extensions");
		await page.waitForFunction(() => {
			const es = (window as unknown as { __fakeEventSources?: unknown[] }).__fakeEventSources;
			return Array.isArray(es) && es.length > 0;
		});
		await emitSse(
			{
				type: "tool:permission_request",
				data: {
					...PERMISSION_EVENT.data,
					toolCallId: "prompt-install-e2e",
					toolName: "ez-extension-builder__install",
					input: { name: "weather" },
					extensionId: "ez-extension-builder",
					capabilityKind: "ezcorp:extension:install",
				},
			},
			"runtime-events",
		);

		const tray = page.getByTestId("pending-permission-tray");
		await expect(tray).toBeVisible();
		await expect(page.getByTestId("permission-extension-description")).toContainText(
			"Install an extension and let it run with its declared permissions",
		);
		await expect(page.getByText("Write to filesystem")).toHaveCount(0);
		const chooser = page.getByTestId("permission-scope-chooser");
		await expect(chooser.getByTestId("permission-allow-once")).toHaveText("Allow this time");
		for (const lasting of ["session", "conversation", "project", "forever"]) {
			await expect(chooser.getByTestId(`permission-allow-${lasting}`)).toHaveCount(0);
		}
		await expect(chooser.getByText("Always allow")).toHaveCount(0);
		await captureEvidence(page, testInfo, "permission-gate-install-once");

		await chooser.getByTestId("permission-allow-once").click();
		await expect(tray).toHaveCount(0);
		expect(posts).toEqual([{ approved: true, scope: "session" }]);
	});
});
