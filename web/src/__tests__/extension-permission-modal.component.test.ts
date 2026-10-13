/**
 * Phase 6 — DOM tests for the extension-scoped permission modal.
 *
 * Covers:
 *   - Built-in tool gate (no `extensionId`) renders the legacy two-button
 *     Allow/Deny modal — no scope chooser visible.
 *   - Extension-scoped gate (`extensionId` set) renders the four-scope
 *     chooser with all four buttons + Deny.
 *   - Each scope button POSTs `/api/tool-calls/:id/permission` with the
 *     matching `scope` field.
 *   - Decline POSTs `{approved: false}` (no scope).
 *   - Loading state disables the buttons after a click.
 *   - The capability description renders for `shell` and `fs.write`.
 */
import "@testing-library/jest-dom/vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import PermissionGate from "$lib/components/tool-cards/PermissionGate.svelte";
import type { ToolCallState } from "$lib/stores.svelte.js";

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function makeBuiltinGate(): ToolCallState {
	return {
		id: "tc-builtin-1",
		toolName: "shell",
		status: "running",
		startedAt: Date.now(),
		permissionPending: true,
		category: "execute",
	};
}

function makeExtensionGate(
	overrides: Partial<ToolCallState> = {},
): ToolCallState {
	return {
		id: "prompt-ext-1",
		toolName: "scratchpad__run_shell",
		status: "running",
		startedAt: Date.now(),
		permissionPending: true,
		extensionId: "scratchpad",
		capabilityKind: "shell",
		...overrides,
	};
}

describe("PermissionGate — built-in tool gate (legacy)", () => {
	test("renders the two-button Allow / Deny modal, no scope chooser", () => {
		const { getByTestId, queryByTestId } = render(PermissionGate, {
			props: { toolCall: makeBuiltinGate() },
		});
		expect(getByTestId("permission-allow")).toBeInTheDocument();
		expect(getByTestId("permission-deny")).toBeInTheDocument();
		// No scope chooser, no extension badge.
		expect(queryByTestId("permission-scope-chooser")).toBeNull();
		expect(queryByTestId("permission-extension-badge")).toBeNull();
		expect(queryByTestId("permission-allow-session")).toBeNull();
	});

	test("Allow click POSTs without `scope` (built-in gate)", async () => {
		const { getByTestId } = render(PermissionGate, {
			props: { toolCall: makeBuiltinGate() },
		});
		await fireEvent.click(getByTestId("permission-allow"));
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tool-calls/tc-builtin-1/permission",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ approved: true }),
			}),
		);
	});

	test("Deny click POSTs `{approved: false}`", async () => {
		const { getByTestId } = render(PermissionGate, {
			props: { toolCall: makeBuiltinGate() },
		});
		await fireEvent.click(getByTestId("permission-deny"));
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tool-calls/tc-builtin-1/permission",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ approved: false }),
			}),
		);
	});
});

describe("PermissionGate — extension-scoped gate (Phase 6)", () => {
	test("renders the four-scope chooser + extension badge + capability description", () => {
		const { getByTestId } = render(PermissionGate, {
			props: { toolCall: makeExtensionGate() },
		});
		expect(getByTestId("permission-scope-chooser")).toBeInTheDocument();
		expect(getByTestId("permission-allow-session")).toBeInTheDocument();
		expect(getByTestId("permission-allow-conversation")).toBeInTheDocument();
		expect(getByTestId("permission-allow-project")).toBeInTheDocument();
		expect(getByTestId("permission-allow-forever")).toBeInTheDocument();
		expect(getByTestId("permission-deny")).toBeInTheDocument();
		expect(getByTestId("permission-extension-badge")).toHaveTextContent("scratchpad");
		expect(getByTestId("permission-extension-description")).toHaveTextContent(
			/Execute shell commands/i,
		);
	});

	test.each([
		["ezcorp:extension:install", /Install an extension/],
		["ezcorp:extension:modify", /Edit an installed extension/],
	] as const)("%s names the real capability and offers only a one-time allow", async (kind, description) => {
		const { getByTestId, queryByTestId } = render(PermissionGate, {
			props: { toolCall: makeExtensionGate({ capabilityKind: kind }) },
		});
		expect(getByTestId("permission-extension-description")).toHaveTextContent(description);
		// Never persisted server-side, so no lasting scope may be offered.
		expect(queryByTestId("permission-allow-forever")).toBeNull();
		expect(queryByTestId("permission-allow-project")).toBeNull();
		expect(queryByTestId("permission-allow-conversation")).toBeNull();
		expect(queryByTestId("permission-allow-session")).toBeNull();
		await fireEvent.click(getByTestId("permission-allow-once"));
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tool-calls/prompt-ext-1/permission",
			expect.objectContaining({ method: "POST" }),
		);
	});

	test("renders fs.write description with the requested path", () => {
		const { getByTestId } = render(PermissionGate, {
			props: {
				toolCall: makeExtensionGate({
					capabilityKind: "fs.write",
					capabilityValue: "/tmp/foo",
				}),
			},
		});
		expect(getByTestId("permission-extension-description")).toHaveTextContent(
			/Write to filesystem: \/tmp\/foo/,
		);
	});

	test("Allow until restart → POSTs scope='session'", async () => {
		const { getByTestId } = render(PermissionGate, {
			props: { toolCall: makeExtensionGate() },
		});
		await fireEvent.click(getByTestId("permission-allow-session"));
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tool-calls/prompt-ext-1/permission",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ approved: true, scope: "session" }),
			}),
		);
	});

	test("Allow for this conversation → POSTs scope='conversation'", async () => {
		const { getByTestId } = render(PermissionGate, {
			props: { toolCall: makeExtensionGate() },
		});
		await fireEvent.click(getByTestId("permission-allow-conversation"));
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tool-calls/prompt-ext-1/permission",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ approved: true, scope: "conversation" }),
			}),
		);
	});

	test("Allow for this project → POSTs scope='project'", async () => {
		const { getByTestId } = render(PermissionGate, {
			props: { toolCall: makeExtensionGate() },
		});
		await fireEvent.click(getByTestId("permission-allow-project"));
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tool-calls/prompt-ext-1/permission",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ approved: true, scope: "project" }),
			}),
		);
	});

	test("Always allow → POSTs scope='forever'", async () => {
		const { getByTestId } = render(PermissionGate, {
			props: { toolCall: makeExtensionGate() },
		});
		await fireEvent.click(getByTestId("permission-allow-forever"));
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tool-calls/prompt-ext-1/permission",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ approved: true, scope: "forever" }),
			}),
		);
	});

	test("Deny → POSTs `{approved: false}` (no scope)", async () => {
		const { getByTestId } = render(PermissionGate, {
			props: { toolCall: makeExtensionGate() },
		});
		await fireEvent.click(getByTestId("permission-deny"));
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tool-calls/prompt-ext-1/permission",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ approved: false }),
			}),
		);
	});

	test("buttons disable while the Allow request is in flight", async () => {
		// Use a deferred mock so we can assert the loading state mid-flight.
		// TS narrows the assignment-after-construct on resolveFetch; bind
		// via a wrapper so the type stays nullable but callable.
		const resolver: { fn: (() => void) | null } = { fn: null };
		fetchMock.mockReturnValueOnce(
			new Promise<Response>((r) => {
				resolver.fn = () => r({ ok: true, json: async () => ({ ok: true }) } as Response);
			}),
		);
		const { getByTestId } = render(PermissionGate, {
			props: { toolCall: makeExtensionGate() },
		});
		const sessionBtn = getByTestId("permission-allow-session") as HTMLButtonElement;
		fireEvent.click(sessionBtn);
		// Microtask flush so the `loading = true` rune update lands.
		await Promise.resolve();
		expect(sessionBtn).toBeDisabled();
		expect(getByTestId("permission-deny")).toBeDisabled();
		// Cleanup so the promise doesn't leak.
		resolver.fn?.();
	});
});
