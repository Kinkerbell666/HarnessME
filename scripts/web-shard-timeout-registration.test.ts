/**
 * The web Vitest shard job has a stated timeout margin and names a slow runner in its log (W4H-24).
 *
 * Main ci 38404984224 cancelled "Web tests shard 3" at its 10-minute cap after 619 s: every logged test passed, but the
 * hosted runner was 3 to 6 times slower than usual (per-file median 5.71x; setup 164 s against a 35 s median). A job
 * of about 4 minutes under a 10-minute cap dies at a 2.5x slowdown. The numbers below are the R1 measurement of the
 * last 50 completed ci runs (60 executions per shard, every attempt; /tmp/factory-platform-evidence/w4h-24/r1/).
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ghExpr, readWorkflows, type WorkflowJob, type WorkflowStep } from "./lib/ci-registration";

const REPO_ROOT = join(import.meta.dir, "..");
const WALL_TIME_SCRIPT = join(REPO_ROOT, "scripts/ci-wall-time.sh");

/** The largest per-shard p95 wall time of a successful shard job (shard 3; shards 1 and 2: 259 s and 257 s). */
const SHARD_P95_WALL_SECONDS = 265;
/** The slowdown the job must survive: the measured hosted runner was up to 6x slower (the brief's 3 to 6x band). */
const SLOWDOWN_MARGIN = 6;
/** The brief's floor: at least 3x the p95 wall time. */
const MINIMUM_MARGIN = 3;
/** Medians of the two phases over the same runs (n = 178): set up job + checkout + setup + setup-node, and the Vitest step. */
const INSTALL_MEDIAN_SECONDS = 35;
const VITEST_MEDIAN_SECONDS = 198;
/** The aggregator only fans in the shard results: its wall time was 2 to 5 s. */
const FAN_IN_MAX_SECONDS = 5;

const ci = readWorkflows(join(REPO_ROOT, ".github/workflows")).find((workflow) => workflow.file === "ci.yml");
if (!ci) throw new Error("ci.yml is missing");
const shardJob = ci.jobs["test-web-shard"] as WorkflowJob;
const aggregator = ci.jobs["test-web"] as WorkflowJob;
const steps = shardJob.steps ?? [];
const indexOf = (match: (step: WorkflowStep) => boolean) => steps.findIndex(match);

describe("Web tests shard: the timeout has a stated margin", () => {
  test("the timeout is the slowdown margin times the p95 wall time, rounded up to 5 minutes", () => {
    const expectedMinutes = Math.ceil((SLOWDOWN_MARGIN * SHARD_P95_WALL_SECONDS) / 60 / 5) * 5;
    expect(shardJob["timeout-minutes"]).toBe(expectedMinutes);
    expect(expectedMinutes * 60).toBeGreaterThanOrEqual(MINIMUM_MARGIN * SHARD_P95_WALL_SECONDS);
  });

  test("the aggregator's timeout still covers its fan-in", () => {
    expect(aggregator.needs).toEqual(["test-web-shard"]);
    expect((aggregator["timeout-minutes"] ?? 0) * 60).toBeGreaterThanOrEqual(MINIMUM_MARGIN * FAN_IN_MAX_SECONDS);
  });

  test("no retry hides the slowness, and the shard set is unchanged", () => {
    expect(steps.filter((step) => step["continue-on-error"] !== undefined || /retry/i.test(step.uses ?? ""))).toEqual([]);
    expect(shardJob.strategy?.matrix?.i).toEqual([1, 2, 3]);
  });
});

describe("Web tests shard: the log names a slow runner", () => {
  test("the clock starts in the first step, before checkout", () => {
    expect(steps[0]?.run).toBe('echo "WALL_TIME_START=$(date +%s)" >> "$GITHUB_ENV"');
    expect(indexOf((step) => step.uses?.startsWith("actions/checkout@") === true)).toBe(1);
  });

  test("checkout and install are reported after setup-node, right before Vitest starts", () => {
    const setupNode = indexOf((step) => step.uses?.startsWith("actions/setup-node@") === true);
    const vitest = indexOf((step) => step.id === "vitest");
    expect(setupNode).toBeGreaterThan(indexOf((step) => step.uses === "./.github/actions/setup"));
    expect(steps[setupNode + 1]?.run).toBe(`bash scripts/ci-wall-time.sh "checkout and install" ${INSTALL_MEDIAN_SECONDS}`);
    expect(vitest).toBe(setupNode + 2);
    expect(steps[vitest]?.run).toContain(`bash scripts/web-vitest-coverage.sh --output coverage-shard/web-vitest-${ghExpr("matrix.i")} --shard ${ghExpr("matrix.i")}/3`);
  });

  test("Vitest is reported right after it ends, also when it fails or is cancelled", () => {
    const report = steps[indexOf((step) => step.id === "vitest") + 1];
    expect(report?.run).toBe(`bash scripts/ci-wall-time.sh vitest ${VITEST_MEDIAN_SECONDS}`);
    expect(report?.if).toBe("always() && steps.vitest.outcome != 'skipped'");
  });
});

/** Runs a shell command with `date` fixed at `now` and a fresh $GITHUB_ENV file. */
function runAt(now: number, command: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ci-wall-time-"));
  const githubEnv = join(dir, "github-env");
  writeFileSync(githubEnv, "");
  writeFileSync(join(dir, "date"), `#!/bin/sh\necho ${now}\n`);
  chmodSync(join(dir, "date"), 0o755);
  const run = Bun.spawnSync(["bash", "-c", command], {
    env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_ENV: githubEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString(), githubEnv: readFileSync(githubEnv, "utf8") };
}

const report = (label: string, median: number | string) => `bash "${WALL_TIME_SCRIPT}" "${label}" ${median}`;

describe("ci-wall-time.sh", () => {
  test("the workflow's first step writes the start time to $GITHUB_ENV", () => {
    const result = runAt(1000, steps[0]?.run ?? "exit 9");
    expect(result.exitCode).toBe(0);
    expect(result.githubEnv).toBe("WALL_TIME_START=1000\n");
  });

  test("a phase at exactly 2x its median prints its wall time without a warning and starts the next phase", () => {
    const result = runAt(1200, report("vitest", 100), { WALL_TIME_START: "1000" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("vitest wall time: 200s (median 100s; warns above 200s)\n");
    expect(result.githubEnv).toBe("WALL_TIME_START=1200\n");
  });

  test("a phase above 2x its median warns and still exits 0", () => {
    const result = runAt(1201, report("vitest", 100), { WALL_TIME_START: "1000" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "::warning title=Slow runner::vitest took 201s, more than 2x its median of 100s. The hosted runner is slow; this is not a test failure.",
    );
    expect(result.githubEnv).toBe("WALL_TIME_START=1201\n");
  });

  test("the cancelled run's 164 s checkout and install would have warned before Vitest started", () => {
    const result = runAt(1164, report("checkout and install", INSTALL_MEDIAN_SECONDS), { WALL_TIME_START: "1000" });
    expect(result.stdout).toContain("::warning title=Slow runner::checkout and install took 164s");
  });

  test("a missing start time is a workflow error", () => {
    const result = runAt(1000, report("vitest", 100));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("WALL_TIME_START is not set");
    expect(result.githubEnv).toBe("");
  });

  test.each(["0", "abc", "-5"])("a median of %p is a workflow error", (median) => {
    const result = runAt(1000, report("vitest", median), { WALL_TIME_START: "900" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(`the median must be a positive integer of seconds (got '${median}')`);
  });

  test("a missing label or median prints the usage", () => {
    const result = runAt(1000, `bash "${WALL_TIME_SCRIPT}" vitest`, { WALL_TIME_START: "900" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("usage: ci-wall-time.sh <label> <median-seconds>");
  });
});
