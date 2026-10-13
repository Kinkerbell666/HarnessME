/**
 * scripts/ci-wall-time.sh names a slow CI phase in the log and never fails the job (W4H-24).
 * Each case runs the script through bash with `date` fixed, so the elapsed seconds and the ratio are exact.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkflows } from "./lib/ci-registration";

const REPO_ROOT = join(import.meta.dir, "..");
const SCRIPT = join(REPO_ROOT, "scripts/ci-wall-time.sh");

/** Runs a bash command with `date` fixed at `now` and a fresh $GITHUB_ENV file (none when `githubEnv` is false). */
function runAt(now: number, command: string, env: Record<string, string> = {}, githubEnv = true) {
  const dir = mkdtempSync(join(tmpdir(), "ci-wall-time-"));
  const envFile = join(dir, "github-env");
  writeFileSync(envFile, "");
  writeFileSync(join(dir, "date"), `#!/bin/sh\necho ${now}\n`);
  chmodSync(join(dir, "date"), 0o755);
  const run = Bun.spawnSync(["bash", "-c", command], {
    env: { PATH: `${dir}:${process.env.PATH}`, ...(githubEnv ? { GITHUB_ENV: envFile } : {}), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), githubEnv: readFileSync(envFile, "utf8") };
}

const phase = (label: string, median: number | string) => `bash "${SCRIPT}" "${label}" ${median}`;

describe("ci-wall-time.sh", () => {
  test("the workflow's clock step writes the start time to $GITHUB_ENV", () => {
    const ci = readWorkflows(join(REPO_ROOT, ".github/workflows")).find((workflow) => workflow.file === "ci.yml");
    const result = runAt(1000, ci?.jobs["test-web-shard"]?.steps?.[0]?.run ?? "exit 9");
    expect(result.exitCode).toBe(0);
    expect(result.githubEnv).toBe("WALL_TIME_START=1000\n");
  });

  test("a fast phase prints its wall time and ratio, no WARN, and starts the next phase", () => {
    const result = runAt(1030, phase("checkout and install", 35), { WALL_TIME_START: "1000" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("checkout and install wall time: 30s (median 35s, 0.9x; warns above 2x = 70s)\n");
    expect(result.githubEnv).toBe("WALL_TIME_START=1030\n");
  });

  test("a phase at exactly 2x its median prints no WARN", () => {
    const result = runAt(1200, phase("vitest", 100), { WALL_TIME_START: "1000" });
    expect(result.stdout).toBe("vitest wall time: 200s (median 100s, 2.0x; warns above 2x = 200s)\n");
  });

  test("a slow phase prints a WARN line and an annotation with the seconds, the median and the ratio, and exits 0", () => {
    // The cancelled run 38404984224: checkout and install took 164 s against a 35 s median.
    const result = runAt(1164, phase("checkout and install", 35), { WALL_TIME_START: "1000" });
    const text = "checkout and install took 164s, 4.7x its median of 35s (warns above 2x). The hosted runner is slow; this is not a test failure.";
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `checkout and install wall time: 164s (median 35s, 4.7x; warns above 2x = 70s)\nWARN: ${text}\n::warning title=Slow runner::${text}\n`,
    );
    expect(result.githubEnv).toBe("WALL_TIME_START=1164\n");
  });

  test("one second above 2x warns", () => {
    expect(runAt(1201, phase("vitest", 100), { WALL_TIME_START: "1000" }).stdout).toContain("WARN: vitest took 201s, 2.0x its median of 100s");
  });

  test("a missing start time fails loudly with a WARN, exits 0, and starts the next phase", () => {
    const result = runAt(1000, phase("vitest", 198));
    const text = "vitest: WALL_TIME_START is not set; an earlier step must write it to $GITHUB_ENV";
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`WARN: ${text}\n::warning title=Wall time not measured::${text}\n`);
    expect(result.githubEnv).toBe("WALL_TIME_START=1000\n");
  });

  test.each([
    ["vitest", "0"],
    ["vitest", "abc"],
    ["vitest", ""],
    ["", "198"],
  ])("label %p with median %p warns about the usage and exits 0", (label, median) => {
    const result = runAt(1000, `bash "${SCRIPT}" "${label}" "${median}"`, { WALL_TIME_START: "900" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`WARN: ci-wall-time.sh needs <label> <median-seconds> (got label '${label}', median '${median}')`);
  });

  test("a missing $GITHUB_ENV warns and exits 0", () => {
    const result = runAt(1100, phase("vitest", 100), { WALL_TIME_START: "1000" }, false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WARN: GITHUB_ENV is not set; the next phase has no start time");
  });
});
