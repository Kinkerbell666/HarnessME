/**
 * The patched Stryker Vitest runner (web/patches/@stryker-mutator%2Fvitest-runner@10.0.0.patch):
 * a test FILE that fails to load or collect must count as a failed run.
 *
 * Runner 10.0.0 builds a run's result only from per-test results. A mutant that
 * throws while a test file is imported (settings-nav.ts runs
 * `settingsDefaultRoute(false)` at module load) or while a `describe` body runs
 * (chat-turn-collapse.unit.test.ts calls `buildTurnIndex` there) leaves that
 * file with NO test results, and bail=1 cancels every other file. The run was
 * "complete, 0 tests", so Stryker recorded the mutant as Survived with
 * testsCompleted 0, although the tests had detected it, and the nightly's
 * survivorsWithoutTests guard (scripts/mutation.ts) failed the run on it.
 *
 * These cases pin the patch's file-failure results and the verdict Stryker
 * derives from them. Without the patch's extension the import below has no
 * `failedFileTestResults`, and every case here fails.
 */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StrykerOptions } from "@stryker-mutator/api/core";
import type { Logger } from "@stryker-mutator/api/logging";
import {
	DryRunStatus,
	type MutantRunOptions,
	MutantRunStatus,
	TestStatus,
	toMutantRunResult,
} from "@stryker-mutator/api/test-runner";
import { failedFileTestResults } from "../../node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-helpers.js";
import { VitestTestRunner } from "../../node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js";

const SEPARATOR = " > ";
const IMPORT_ERROR = "Cannot read properties of undefined (reading '0')";

type Task = {
	type: "suite" | "test";
	name: string;
	mode: "run" | "skip";
	result?: { state: string; errors?: { message: string }[] };
	tasks?: Task[];
	suite?: Task;
	file?: { filepath: string };
	filepath?: string;
};
/** A file task always has a path, as a Vitest file task does. */
type FileTask = Task & { filepath: string };

/** A Vitest file task with the given result and child tasks. */
function file(name: string, result: Task["result"], tasks: Task[] = []): FileTask {
	const f: FileTask = { type: "suite", name, mode: "run", filepath: `/repo/web/${name}`, result, tasks };
	for (const t of tasks) {
		t.file = { filepath: f.filepath };
		t.suite = f;
	}
	return f;
}

function testTask(name: string, state: string): Task {
	return { type: "test", name, mode: "run", result: { state } };
}

describe("failedFileTestResults", () => {
	it("reports a file that failed to load as one failed result carrying the load error", () => {
		const broken = file("src/lib/settings-nav.unit.test.ts", { state: "fail", errors: [{ message: IMPORT_ERROR }] });
		const results = failedFileTestResults([broken], [], SEPARATOR);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			status: TestStatus.Failed,
			failureMessage: IMPORT_ERROR,
			fileName: resolve("/repo/web/src/lib/settings-nav.unit.test.ts"),
		});
		expect(results[0].id).toContain("src/lib/settings-nav.unit.test.ts#");
	});

	it("gives a failed file without a recorded error a named fallback message", () => {
		const broken = file("src/a.unit.test.ts", { state: "fail" });
		const [result] = failedFileTestResults([broken], [], SEPARATOR);
		expect(result).toMatchObject({
			status: TestStatus.Failed,
			failureMessage: expect.stringMatching(/failed to load or collect/),
		});
	});

	it("adds nothing for a failed file whose own failed test already reports the failure", () => {
		const failing = testTask("adds", "fail");
		const f = file("src/b.unit.test.ts", { state: "fail" }, [failing]);
		const existing = [
			{ id: "src/b.unit.test.ts#adds", name: "adds", status: TestStatus.Failed, failureMessage: "x", timeSpentMs: 0, fileName: resolve("/repo/web/src/b.unit.test.ts") },
		];
		expect(failedFileTestResults([f], existing, SEPARATOR)).toEqual([]);
	});

	it("adds nothing for a passing file or a file bail cancelled before it ran", () => {
		const passing = file("src/c.unit.test.ts", { state: "pass" }, [testTask("ok", "pass")]);
		const cancelled = file("src/d.unit.test.ts", { state: "skip" });
		const neverStarted = file("src/e.unit.test.ts", undefined);
		expect(failedFileTestResults([passing, cancelled, neverStarted], [], SEPARATOR)).toEqual([]);
	});

	it("reports every failed file when several fail to load", () => {
		const a = file("src/f.unit.test.ts", { state: "fail", errors: [{ message: "a" }] });
		const b = file("src/g.unit.test.ts", { state: "fail", errors: [{ message: "b" }] });
		const messages = failedFileTestResults([a, b], [], SEPARATOR).map((r) =>
			r.status === TestStatus.Failed ? r.failureMessage : undefined,
		);
		expect(messages).toEqual(["a", "b"]);
	});
});

describe("the mutant verdict Stryker derives from a run", () => {
	it("is Survived with 0 tests when a file failed to load and the runner reports no result (the defect)", () => {
		const verdict = toMutantRunResult({ status: DryRunStatus.Complete, tests: [] });
		expect(verdict).toMatchObject({ status: MutantRunStatus.Survived, nrOfTests: 0 });
	});

	it("is Killed by the failed file once the patch reports it", () => {
		const broken = file("src/lib/chat-turn-collapse.unit.test.ts", { state: "fail", errors: [{ message: IMPORT_ERROR }] });
		const tests = failedFileTestResults([broken], [], SEPARATOR);
		const verdict = toMutantRunResult({ status: DryRunStatus.Complete, tests });
		expect(verdict).toMatchObject({ status: MutantRunStatus.Killed, failureMessage: IMPORT_ERROR, nrOfTests: 1 });
		expect(verdict.status === MutantRunStatus.Killed && verdict.killedBy).toEqual([tests[0].id]);
	});
});

// ── The runner: a load failure kills a mutant only when the mutant caused it ──

const A = "/repo/web/src/lib/settings-nav.unit.test.ts";
const B = "/repo/web/src/lib/model-selector-logic.unit.test.ts";
const C = "/repo/web/src/lib/chat-turn-collapse.unit.test.ts";
const UNRESOLVED = 'Failed to resolve import "$server/runtime/routing/default-selection"';

/**
 * Where each phase fails to load: the initial run, a mutant run, and a file run alone without a mutant.
 * `cancelled` files come back from the alone run with no result (a late bail cancels the run);
 * `missing` files are not reported by the alone run at all.
 */
type LoadFails = { initial?: string[]; mutant?: string[]; alone?: string[]; cancelled?: string[]; missing?: string[] };

/**
 * A runner over a fake Vitest context. `start(undefined)` runs the related set
 * [A, B, C]; `start(files)` runs exactly those files (the alone check). A file
 * named for the phase fails to load with `messages["<phase>:<file>"]`, else
 * `messages[file]`, else `cannot load <file>`; a file in `testFails` runs one failing test; every
 * other file runs one passing test. `record` is the initial-run record file
 * (a fresh temporary path unless a test shares one between two runners).
 */
function fakeRunner(
	fails: LoadFails,
	opts: {
		testFails?: string[];
		messages?: Record<string, string>;
		hitCount?: number;
		unhandled?: Error[];
		record?: string;
	} = {},
) {
	const provided: Record<string, unknown> = {};
	const starts: { mode: string; files: string[] | undefined }[] = [];
	let files: FileTask[] = [];
	const ctx = {
		config: {},
		projects: [],
		provide: (key: string, value: unknown) => {
			provided[key] = value;
		},
		state: { filesMap: new Map(), errorsSet: new Set(opts.unhandled ?? []), getFiles: () => files },
		start: async (requested?: string[]) => {
			const mode = provided.mode as string;
			starts.push({ mode, files: requested });
			const phase = mode === "mutant" ? "mutant" : requested ? "alone" : "initial";
			const reported = (requested ?? [A, B, C]).filter((path) => phase !== "alone" || !(fails.missing ?? []).includes(path));
			files = reported.map((path) => {
				if (phase === "alone" && (fails.cancelled ?? []).includes(path)) {
					return { ...file(path.slice("/repo/web/".length), undefined), meta: {} };
				}
				if ((fails[phase] ?? []).includes(path)) {
					const message = opts.messages?.[`${phase}:${path}`] ?? opts.messages?.[path] ?? `cannot load ${path}`;
					const failed = file(path.slice("/repo/web/".length), { state: "fail", errors: [{ message }] });
					return { ...failed, meta: { hitCount: opts.hitCount } };
				}
				const state = opts.testFails?.includes(path) ? "fail" : "pass";
				return { ...file(path.slice("/repo/web/".length), { state }, [testTask("works", state)]), meta: {} };
			});
		},
	};
	const warnings: string[] = [];
	const log = { warn: (m: string) => warnings.push(m), debug: () => {}, isDebugEnabled: () => false } as unknown as Logger;
	const runner = new VitestTestRunner({ vitest: { related: true } } as unknown as StrykerOptions, log, "__stryker__");
	const record = opts.record ?? join(mkdtempSync(join(tmpdir(), "w4h23-pin-")), "initial-load-failures.json");
	Object.assign(runner, { ctx, initialLoadFailuresFile: record });
	return { runner, starts, warnings, record };
}

const STATIC_MUTANT = {
	activeMutant: { id: "1" },
	mutantActivation: "static",
	sandboxFileName: "/repo/web/src/lib/settings-nav.ts",
	testFilter: undefined,
	hitLimit: undefined,
} as unknown as MutantRunOptions;
const INITIAL_RUN = { files: [], coverageAnalysis: "perTest", disableBail: false, timeout: 1000 } as never;
const aloneRuns = (starts: { mode: string; files: string[] | undefined }[]) =>
	starts.filter((s) => s.mode === "dry-run" && s.files !== undefined);

describe("VitestTestRunner with the patch", () => {
	it("kills a mutant whose file fails to load with it, was not in the initial run's list, and loads alone", async () => {
		const { runner, starts } = fakeRunner({ mutant: [A] });
		await runner.dryRun(INITIAL_RUN);
		const verdict = await runner.mutantRun(STATIC_MUTANT);
		expect(verdict).toMatchObject({ status: MutantRunStatus.Killed, failureMessage: `cannot load ${A}` });
		expect(verdict.status === MutantRunStatus.Killed && verdict.killedBy).toEqual([
			expect.stringContaining("settings-nav.unit.test.ts#StrykerJS: test file failed to load or collect"),
		]);
		expect(starts).toEqual([
			{ mode: "dry-run", files: undefined },
			{ mode: "mutant", files: undefined },
			{ mode: "dry-run", files: [resolve(A)] },
		]);
	});

	it("never kills on a file the initial run listed, even when it loads alone later", async () => {
		// A different message under the mutant: only the initial run's list can refuse this kill.
		const { runner, starts } = fakeRunner({ initial: [B], mutant: [B] }, { messages: { [`mutant:${B}`]: `TypeError in ${B}` } });
		await runner.dryRun(INITIAL_RUN);
		const verdict = await runner.mutantRun(STATIC_MUTANT);
		expect(verdict).toMatchObject({ status: MutantRunStatus.Survived, nrOfTests: 2 });
		expect(aloneRuns(starts)).toEqual([]);
	});

	it("never kills on a failure whose message equals an initial-run failure message", async () => {
		const messages = { [B]: UNRESOLVED, [C]: UNRESOLVED };
		const { runner, starts } = fakeRunner({ initial: [B], mutant: [C] }, { messages });
		await runner.dryRun(INITIAL_RUN);
		const verdict = await runner.mutantRun(STATIC_MUTANT);
		expect(verdict).toMatchObject({ status: MutantRunStatus.Survived, nrOfTests: 2 });
		expect(aloneRuns(starts)).toEqual([]);
	});

	it("reads the initial run's list in another worker through the record file", async () => {
		const first = fakeRunner({ initial: [B] });
		await first.runner.dryRun(INITIAL_RUN);
		const second = fakeRunner({ mutant: [B] }, { record: first.record });
		const verdict = await second.runner.mutantRun(STATIC_MUTANT);
		expect(verdict).toMatchObject({ status: MutantRunStatus.Survived });
		expect(aloneRuns(second.starts)).toEqual([]);
		expect(JSON.parse(readFileSync(first.record, "utf8"))).toEqual({
			files: [{ fileName: resolve(B), failureMessage: `cannot load ${B}` }],
		});
	});

	it("never kills by a load failure when no initial-run record exists", async () => {
		const { runner, starts } = fakeRunner({ mutant: [A] });
		const verdict = await runner.mutantRun(STATIC_MUTANT);
		expect(verdict).toMatchObject({ status: MutantRunStatus.Survived, nrOfTests: 2 });
		expect(aloneRuns(starts)).toEqual([]);
	});

	it("never kills on a file that also fails alone, and checks it alone once per runner", async () => {
		const { runner, starts } = fakeRunner({ mutant: [B], alone: [B] });
		await runner.dryRun(INITIAL_RUN);
		const first = await runner.mutantRun(STATIC_MUTANT);
		await runner.mutantRun(STATIC_MUTANT);
		expect(first).toMatchObject({ status: MutantRunStatus.Survived, nrOfTests: 2 });
		expect(aloneRuns(starts)).toEqual([{ mode: "dry-run", files: [resolve(B)] }]);
	});

	it("never kills when the alone run cancels the file before it reports a result", async () => {
		const { runner, starts } = fakeRunner({ mutant: [A], cancelled: [A] });
		await runner.dryRun(INITIAL_RUN);
		const verdict = await runner.mutantRun(STATIC_MUTANT);
		expect(verdict).toMatchObject({ status: MutantRunStatus.Survived, nrOfTests: 2 });
		expect(aloneRuns(starts)).toEqual([{ mode: "dry-run", files: [resolve(A)] }]);
	});

	it("never kills when the alone run does not report the file at all", async () => {
		const { runner } = fakeRunner({ mutant: [A], missing: [A] });
		await runner.dryRun(INITIAL_RUN);
		const verdict = await runner.mutantRun(STATIC_MUTANT);
		expect(verdict).toMatchObject({ status: MutantRunStatus.Survived, nrOfTests: 2 });
	});

	it("needs no baseline when a test already failed: the failed test kills the mutant", async () => {
		const { runner, starts } = fakeRunner({ mutant: [A] }, { testFails: [C] });
		await runner.dryRun(INITIAL_RUN);
		const verdict = await runner.mutantRun(STATIC_MUTANT);
		expect(verdict).toMatchObject({ status: MutantRunStatus.Killed });
		expect(verdict.status === MutantRunStatus.Killed && verdict.killedBy).toEqual([
			expect.stringMatching(/chat-turn-collapse\.unit\.test\.ts#.*works$/),
		]);
		expect(aloneRuns(starts)).toEqual([]);
	});

	it("reports a hit-limit timeout before any baseline, as the unpatched runner does", async () => {
		const { runner, starts } = fakeRunner({ mutant: [A] }, { hitCount: 10 });
		await runner.dryRun(INITIAL_RUN);
		const verdict = await runner.mutantRun({ ...STATIC_MUTANT, hitLimit: 5 });
		expect(verdict.status).toBe(MutantRunStatus.Timeout);
		expect(aloneRuns(starts)).toEqual([]);
	});

	it("reports an error outside any test as an error, with no baseline", async () => {
		const { runner, starts } = fakeRunner({ mutant: [A] }, { unhandled: [new Error("worker crashed")] });
		const verdict = await runner.mutantRun(STATIC_MUTANT);
		expect(verdict).toMatchObject({ status: MutantRunStatus.Error, errorMessage: expect.stringContaining("worker crashed") });
		expect(aloneRuns(starts)).toEqual([]);
	});

	it("keeps an initial test run with an unloadable file complete, names the file in a warning, and records it", async () => {
		const { runner, warnings, record } = fakeRunner({ initial: [B] });
		const result = await runner.dryRun(INITIAL_RUN);
		expect(result.status).toBe(DryRunStatus.Complete);
		expect(result.status === DryRunStatus.Complete && result.tests.map((t) => t.status)).toEqual([
			TestStatus.Success,
			TestStatus.Success,
		]);
		expect(warnings).toEqual([expect.stringContaining("1 test file(s) failed to load or collect")]);
		expect(warnings[0]).toContain(`${resolve(B)}: cannot load ${B}`);
		expect(JSON.parse(readFileSync(record, "utf8")).files.map((f: { fileName: string }) => f.fileName)).toEqual([resolve(B)]);
	});
});
