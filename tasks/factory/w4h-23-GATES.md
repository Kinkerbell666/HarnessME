# W4H-23: the nightly mutation workflow on main is red since the merge of PR 318

Brief: /tmp/factory-platform-evidence/w00/briefs/w4h-23.md. Branch `wp/w4h-23-mutation-related` from origin/main 6eb1bbb33.
Code commit: ad88e73b3 (tree 9eeb06c48b97). Evidence: /tmp/factory-platform-evidence/w4h-23/ (paths below are relative to it).
Hosted red: run 38238981958 (jobs 114776612873 shard 5, 114776613002 shard 3; logs copied read-only). Hosted green: run
38042900360 on e3309906d. Pins: bun and bunx 1.4.2 (.bun-version), node 24.14.1. Scope ruling (lead): R2 = A + C; B (the 33
no-coverage files) is a leftover.

## Cause

The red is not a score and not the no-coverage list. PR 318 added the guard `survivorsWithoutTests` (7c1811611), which fails a
shard on any mutant that "survived" with 0 tests. Five STATIC mutants hit it: settings-nav.ts:134 and chat-turn-collapse.ts:37,
38, 41, 44. Each one throws while a test FILE loads: settings-nav.ts:162 runs `settingsDefaultRoute(false)` at module load, and
chat-turn-collapse.unit.test.ts:56 calls `buildTurnIndex` in a describe body. Stryker's vitest runner 10.0.0 builds a run's
result only from per-test results, and bail=1 cancels the other files, so the run read "complete, 0 tests". The tests had
detected the mutant (vitest exits 1).

The same 5 mutants were "Survived, 0 tests" on the green night too. That night 11772 of 18934 mutants ran 0 tests (the
Vitest 5 name-separator bug that PR 318's patch fixes), and the shard scores were 2 to 10 percent. The green nightly measured
almost nothing. The 33 no-coverage files are the same set at both commits; they only moved between shards, because the scope
grew from 190 to 200 files and the slicing is round-robin. Patch versus reshuffle, per file: r1b/attribution.txt.

## Fix

The runner patch (same file, same patchedDependencies entry; package.json and bun.lock unchanged) now lets a test file that
fails to load or collect kill a mutant, in a MUTANT run only, and only when the same file loads cleanly WITHOUT the mutant. The
check re-runs that file alone in dry-run mode, once per file per worker. The first design counted every failed file. It made
all six shard dry runs fail: 30 to 33 test files per shard already fail to load inside the Stryker sandbox (imports outside
web/, mostly `$server/...`), and they never ran on any night (r2/try1). The initial test run keeps the upstream behaviour and
names those files in a warning. No threshold, `related` or break setting changed. The new unit test pins the helper and the
runner's verdicts.

## Gates

- [x] G1: root cause before the fix. CHECK: hosted logs and artifacts of both nights; `bun scripts/mutation.ts --full --shard
  3/6|5/6 --dry-run-only --report-only` at 6eb1bbb33; a targeted Stryker run on the 5 ranges; hand-made mutants with `vitest
  related <file> --run --bail 1`. EXPECT: the failing guard named, the mechanism shown. RESULT: as in "Cause". The dry-run mode
  writes no report, so it cannot show no-coverage files or survivors. EVIDENCE: r1/R1-findings.txt (04092fb1fd253dc4),
  r1/diag-mutation.json, r1/manual-*.log.
- [x] G2: patch versus reshuffle, per file (lead order). CHECK: shard 5/6 and shard 3's three files at 6eb1bbb33 with the patch
  and with the registry 10.0.0 runner (sha512 equal to web/bun.lock), under the lock. EXPECT: each of the 9 files attributed.
  RESULT: no file depends on either; without the patch 2793 of 4740 shard-5 mutants run 0 tests. EVIDENCE: r1b/attribution.txt
  (880846fe1c086f87). The scratch worktree is removed.
- [x] G3: the test is red without the extension. CHECK: the committed (6eb1bbb33) patch reinstalled with `bun install
  --frozen-lockfile`, then `bunx vitest run src/__tests__/stryker-vitest-runner-patch.unit.test.ts`. EXPECT: red. RESULT: 9 of
  14 fail. Green with the extension: 14 of 14. EVIDENCE: r2/red-with-original-patch-14.log (189e54acf67c31b7),
  r2/green-14-cases.log (1875c37e73bce30c).
- [x] G4: the 5 mutants are Killed. CHECK: the R1 targeted Stryker command on settings-nav.ts:134-136 and
  chat-turn-collapse.ts:37-47. RESULT: settings-nav.ts:134 goes from Survived/0 to Killed (3 tests; killed by the three test
  files that fail to load under it); 0 zero-test survivors. On this host the four chat-turn-collapse mutants read Timeout under
  the default timeoutMS, as they did before the fix (R1 and both local shard-5 runs, with and without the patch). With
  timeoutMS 180000 (a diagnostic only, not committed) all four read Killed by chat-turn-collapse.unit.test.ts's load failure.
  On the hosted runner the same run returned in time as "Survived, 0 tests". EVIDENCE: r2/try2/diag-mutation.json
  (b7094b3763f594dd), r2/diag-timeout/diag-mutation.json (cbb38dcdff95753f), r2/R2-findings.txt.
- [x] G5: no shard's initial test run breaks. CHECK: `bun scripts/mutation.ts --full --shard I/6 --dry-run-only --report-only`
  for I = 0..5 with the final patch, under the lock. RESULT: all exit 0; 1462, 1052, 1746, 1460, 2132 and 1574 tests; each warns
  about 33, 32, 32, 31, 31 and 30 unloadable test files. EVIDENCE: r2/try2/heavy.log (a422664d02f158ac), r2/try2/dry0..5.log.
- [x] G6 (R3): the two red shards as the workflow runs them. CHECK: `bun scripts/mutation.ts --full --shard 3/6 --report-only`
  and `5/6`, under the lock, with the committed patch bytes (sha256 3ef5d4581cb2). RESULT: both exit 0; 0 zero-test survivors.
  Scores, local versus hosted red: shard 3 59.72 vs 55.79, shard 5 50.42 vs 50.07. The shard-3 difference is mostly host
  timeouts (168 local vs 9 hosted; a Timeout counts as detected), not the fix. Kills by a load failure: shard 3 one
  (settings-nav.ts:134), shard 5 two (utils/relative-time.ts:81, `new Intl.RelativeTimeFormat("")` and `{ numeric: "" }`
  throw at module load; both genuine). Merge: shards 3 and 5 local plus hosted shards 0, 1, 2, 4 of run 38238981958 (same
  commit, the previous patch): 56.36 percent (hosted merged: 55.68). Limitation: four of the six reports predate the fix.
  EVIDENCE: r3/heavy.log (07c96d03c4aefb56), r3/heavy.exit (0), r3/shard3-mutation.json, r3/shard5-mutation.json,
  r3/merge.log (60e361ccab760a95).
- [x] G7: the legs at ad88e73b3. CHECK: legs/final-legs.log (7f054f2982351c6d) and legs/heavy.log (da966517f3071c3c, under
  the lock). RESULT: lint 0 findings; boundaries and lanes pass; prune scan clean; gate-integrity, default base and
  BASE_REF=origin/main (the same commit here), both PASS; new-file and patch coverage PASS and vacuous (no file under
  SOURCE_GLOBS: web/patches, web/stryker.config.json, one test file, tasks docs); CRAP --changed 0 functions (the first try had
  no lcov file; the rerun used the workflow registration test's lcov, removed after: legs/final-crap-changed-lcov.log);
  typecheck exit 0 and svelte-check 620 files 0 errors under the tc rule (lowest MemAvailable 11.2 and 12.7 GiB:
  legs/tc-gate.log); guard set 41 files, 516 pass, 2 skip, 0 fail (legs/heavy-guard.log); the workflow registration test and
  the container registration test (it names the patch file) pass. actionlint: not run, no workflow changed.
- [x] G8: changed lines. The patch's new runner lines are outside SOURCE_GLOBS, and vitest reports no coverage for files under
  node_modules even with an explicit include (legs/cb6e98cf2/runner-coverage.log: 0 of 0). Each new line runs in a named
  case: failedFileTestResults (all branches, 5 helper cases); run() returning failedFiles and dryRun()'s warning (the
  initial-run case); mutantRun's early return for a hit-limit timeout, an error outside a test and a failed test (three
  cases); #killedByLoadFailure's baseline run, cache hit and kill/no-kill (three cases). The early return for "no failed
  file" has no unit case; it is the ordinary path of every real mutant run in G4 to G6 (7824 mutants in R3).
- [x] G9: hooks and identity. The code commit's hook mapped 1 suite (vitest: the new test file): 12 of 12 at c1144b3ac,
  12 of 12 at the cb6e98cf2 amend, 14 of 14 at the c65c314f8 amend; the ad88e73b3 amend changed only the message (tree
  9eeb06c48b97 equal to c65c314f8; the hook mapped 0). None of these SHAs was reported before the final one. Author and
  committer: archy, noreply address. EVIDENCE: commit-1.log, commit-1-amend2.log, commit-1-amend3.log.

## Leftovers (out of scope by the lead's ruling)

- B: 33 files are 100 percent NoCoverage in every night (5396 mutants). One named cause: 30 to 33 test files per shard cannot
  load in the Stryker sandbox, because they import code outside web/ (for example `$server/runtime/routing/default-selection`
  via src/lib/model-selector-logic.ts). The initial run now names them in a warning.
- The real merged score is about 55 to 56 percent against the 80 threshold: a maintainer decision, not a workflow fix.
- On this host the static re-run of chat-turn-collapse's related files exceeds the default per-mutant timeout (Timeout, which
  counts as detected). The hosted runner returned in time.
- The green commit e3309906d was not run locally: /tmp/factory-tools/bun-1.3.14/bun-linux-x64 is empty (accepted by the lead).
