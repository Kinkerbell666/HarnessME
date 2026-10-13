# W4H-24: the web Vitest shard job dies at its 10-minute timeout on a slow hosted runner

Brief: /tmp/factory-platform-evidence/w00/briefs/w4h-24.md. Branch `wp/w4h-24-web-shard-timeout` from origin/main d3e6871e5.
Code commits: 10a1a93d8, then 15efed799 (the lead's ruling). Worktree: /home/dev/work/EZCorp/EZHarness/.worktrees/w4h-24 (a local hook allows `git worktree add`
only under ./.worktrees/; the W4H-20 to 23 precedent). Evidence: /tmp/factory-platform-evidence/w4h-24/ (paths below are
relative to it). Pins: bun and bunx 1.4.2, node 24.14.1.

## Cause

Main ci 38404984224 (attempt 1, job 115322141077) cancelled "Web tests shard 3" at `timeout-minutes: 10` after 619 s. Every
logged test passed. The hosted runner was uniformly slow: checkout and install took 164 s against a 35 s median, and the
per-file Vitest durations were 5.71x the green run (median; p90 6.91x). A job of about 4 minutes under a 10-minute cap dies
at a 2.5x slowdown. Class: environment. The job had no margin for it, and nothing in the log named the slow runner.

## Fix

- `test-web-shard` timeout: 10 -> 30 minutes (RULED by the lead). Rule: >= 6x the largest per-shard p95 wall time of the
  last 50 ci runs (265 s), rounded up to 5 minutes (26.5 -> 30; also >= 3x). 6x is the top of the measured 3 to 6x band;
  the brief's 3x floor (795 s -> 15 min) would not have saved run 38404984224 (164 s + 5.71 x 162 s = about 1090 s). The
  cap is a hang guard, not a performance budget: a correct result after 18 minutes beats a cancel plus a human re-run, and
  the WARN step names a slow runner. ci.yml states this next to the value.
- `scripts/ci-wall-time.sh <label> <median-s>`: prints a phase's wall time with its ratio to the median, and above 2x the
  median a plain `WARN:` line plus a `::warning title=Slow runner::` annotation that name the seconds, the median and the
  ratio. It always exits 0 (visibility only); a missing start time, median or $GITHUB_ENV is a loud WARN, not a failure. The job's first step starts the clock; one step reports checkout
  and install (median 35 s) right before Vitest, one reports Vitest (median 198 s) after it, `if: always()` while the Vitest
  step ran. The install warning comes before Vitest starts, so even a later cancel leaves the slow runner named.
- Unchanged: the aggregator (timeout 3; its fan-in took 2 to 5 s), the bun-leg orphans job, thresholds, coverage gates, the
  shard count (3), the test selection. No retry added.

## Gates

- [x] G1 (R1): measure before the fix. CHECK: `gh api` jobs of the last 50 completed ci runs, every attempt (60 executions per
  job), no logs. RESULT: wall s min / median / p95 / max (success): shard 1 153/235/259/260, shard 2 141/233/257/264, shard 3
  150/236/265/273; aggregator 2/3/4/5; bun-leg orphans 40/54/73/86. One cancellation at the cap (38404984224). Label
  ubuntu-latest only. Phases (n = 178): pre-Vitest median 35 p95 47; Vitest step median 198 p95 212. Green PR 337 shard 3:
  Duration 160.31 s (environment 39%, import 20%). EVIDENCE: r1/r1-table.txt, r1/analyze.ts, r1/jobs/.
- [x] G2: red first, both tests, in tree exports at 15efed799's files. Registration test with the base ci.yml: 4 of 6 fail
  ("Expected: 30, Received: 10" and the 3 missing step cases); with the new one: 6 of 6. Unit test
  `scripts/ci-wall-time.test.ts` with the 10a1a93d8 script: 10 of 11 fail (no ratio, no WARN line, exit 2 on a missing
  start); with the new script: 11 of 11. EVIDENCE: red-first/registration-on-base-ci.log, registration-on-new-ci.log,
  unit-test-on-10a1a93d8-script.log, unit-test-on-new-script.log (the 10a1a93d8 runs: at-head-ci-old.log, at-head-ci-new.log).
- [x] G3: every changed line runs in a test. The script's branches (fast, exactly 2x, one second above, the incident's 164 s
  install phase at 4.7x, missing start, bad or missing label and median, missing $GITHUB_ENV) run through bash with a fixed
  `date`; the workflow's clock step runs from the parsed YAML. Patch gate with a focused lcov of the two tests: PASS; CRAP:
  no touched function above 30. EVIDENCE: legs-final/final-patch-focused.log, legs-final/final-crap-changed-focused.log.
- [x] G4: workflow lint. actionlint 1.7.12 (with shellcheck 0.11.0): the same 3 findings on the base and the new ci.yml
  (unknown self-hosted labels factory-gpu and factory-real at the factory jobs); none in the changed job. shellcheck on the
  script: clean. EVIDENCE: legs/actionlint-old.log, legs-final/final-actionlint.log, legs-final/final-shellcheck.log.
- [x] G5: legs at 15efed799 (light, no lock; the first run at 10a1a93d8 is in legs/): gate-integrity PASS on both legs (default base and BASE_REF=origin/main, both
  d3e6871e5: 0 findings); lint 0; boundaries, check-boundaries, lanes clean; new-file vacuous PASS; prune scan clean.
  EVIDENCE: legs-final/final-legs.log.
- [x] G6: heavy legs at 15efed799 under the lock: typecheck 0 (tc-gate, in-lock); guard set 42 files, 522 pass, 0 fail
  (the 9 script cases left the registration test for the unit test); every test file that reads ci.yml, one process each,
  21 files, all pass (e2e-lanes 32 of 32). EVIDENCE: legs-final/heavy.log, legs-final/heavy-guard.log, legs-final/tc-gate.log.
  At 10a1a93d8 (legs/): guard 531 pass, 0 fail. Try 1's typecheck (1485 errors) and the e2e-lanes red (Playwright listed 0
  tests) were the install's --ignore-scripts: it skipped `build:packages`, so packages/@ezcorp/*/dist was missing; the same
  e2e-lanes red reproduced at d3e6871e5. Try 2, after `bun run build:packages` (as CI's install does): typecheck 0 (tc-gate,
  in-lock), e2e-lanes 32 of 32. EVIDENCE: legs/heavy.log, legs/heavy-guard.log, legs/heavy-typecheck-2.log,
  legs/heavy-e2e-lanes-2.log, legs/e2e-lanes-at-base.log, legs/tc-gate.log.
- [ ] G7 (R3, not the owner's): one hosted run on the branch after validator-8's ACCEPT and the integrator's merge.
