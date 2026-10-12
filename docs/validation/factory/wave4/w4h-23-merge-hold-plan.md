# W4H-23 merge: hold plan (integrator-5, 2026-10-12; lock-free prep; nothing committed)

Merge: wp/w4h-23-mutation-related 308d362e3 (FROZEN; 5 archy commits on origin/main 6eb1bbb33: ad88e73b3, 614dafa9b, the F1 fixes
54c5e493b and 28adbc34d, the R4 record 308d362e3; 614dafa9b was REJECTED by validator-8, F1) onto integ/w00 bfce8cd5d (the W-SYNC f430182c8
of the latest main 6ffd88784 + its receipts; before it the W-SYNC 94b17348f of 6eb1bbb33). Folder: /tmp/factory-platform-evidence/w00/w4h-merge/w4h-23-mutation-related

## 1. Trial (prep.sh rc 0)
trial tree 4cd3f41af7615c43fb5f9a73d48f77d0a26d7c16 (308d362e3 onto bfce8cd5d), clean (no conflict; tasks/todo.md merged cleanly); 6 files:
web/patches/@stryker-mutator%2Fvitest-runner@10.0.0.patch (patch sha256 3fd1f54ee3bbeb86), web/src/__tests__/stryker-vitest-runner-patch.unit.test.ts,
web/stryker.config.json (the comment), tasks/factory/w4h-23-GATES.md, tasks/lessons.md, tasks/todo.md (diff vs bfce8cd5d: +661 -8).
Hook maps 1: web/src/__tests__/stryker-vitest-runner-patch.unit.test.ts (vitest).
Readers of the changed files (git grep at the trial tree): scripts/mutation.ts, scripts/merge-mutation-reports.ts,
scripts/container-workspace-registration.test.ts (guard set), src/__tests__/mutation-nightly-workflow.test.ts,
src/__tests__/quality-report-fail-closed.test.ts, the pin test.

## 2. Commit (on validator-8's ACCEPT and the merge order)
commit.sh under the lock (commit-locked.sh form, TC_IN_LOCK=1). TOOL CHANGE: commit.sh's fresh frozen install now also triggers on a changed
patches/*.patch (697379d6eabd2d50; it was lockfile/package.json only), so the hook's pin test and the hold run the NEW patched runner; an
abort reinstalls for integ. The hook runs the pin test (vitest).

## 3. Hold: w4f-merge/hold-w4f.sh through gated-flock (exit file, timeout 14400, GATED_FLOCK_START_MEM_GIB=12)
(a) unit.txt 96e08b35e2c38048, 2 lcov legs: mutation-nightly-workflow.test.ts and quality-report-fail-closed.test.ts (readers of the
    workflow/config/report, not in the guard set; container-workspace-registration.test.ts runs in the guard set).
(b) extra-legs.sh cd57673e5f6c3ca3:
    - runner-patch-installed (BINDING): the patch sha, and in the INSTALLED dist/src/vitest-test-runner.js refs > 0 for each of
      killedByLoadFailure, readInitialLoadFailures (the initial-run seeding reader) and stryker-initial-load-failures.json (the seed file).
    - pin-test-lcov: the pin test with V8 lcov (w16/repro/web-vitest-lcov.sh); vitest reports no coverage for the patched file under
      node_modules (the owner's G8), so its lcov is the test's run, not the runner lines.
    - typecheck-all and web-check via tc_leg (in-lock 12 GiB).
    - mutation-shard-3 and mutation-shard-5 AS THE WORKFLOW RUNS THEM ('bun scripts/mutation.ts --full --shard I/6 --report-only', Node
      24.14.1 = .node-version; the workflow's setup-node is 22). BINDING: exit 0, and shard-check.py v2 0067da10203029ef: 0 zero-test survivors
      (Survived and testsCompleted 0, the survivorsWithoutTests rule)
      AND 0 load-failure kills with an import-resolution statusReason ('Failed to resolve import'; the coordinator's binding after F1);
      every load kill printed with file:line, reason and killers. Scores recorded (the owner's R3: shard 3 59.72, shard 5 50.42; hosted red
      55.79 and 50.07; the checker reproduces 50.42 from the owner's report). Owner's local times: 28 and 21 min.
    - mutation-merge: the workflow's merge step 'bun scripts/merge-mutation-reports.ts --shards 6' over shards 3 and 5 from this hold plus the
      hosted reports of shards 0, 1, 2, 4 of nightly 38238981958 (6eb1bbb33; downloaded lock-free with gh run download: sha 7c5941ca649e2de3,
      ae7e7fa3e1669aee, 68a04ece1a0303b4, e7e04d95e895bb76). BINDING: exit 0 with 6 of 6 reports. LIMITATION: four of six inputs predate
      the fix (they ran the previous patch); the merged score is recorded, not judged (report-only, 80 threshold not met: a maintainer
      decision). Then the quality summary (--expect mutation).
(c) standard legs: prune scan, attestation, guard set, builds, web-server-lcov, coverage-merge, web build, graph mock pass, CRAP vs the first parent.
(d) merge-commit-gates vs bfce8cd5d, BINDING. web/patches, web/stryker.config.json and the web test are outside SOURCE_GLOBS: new-file and
    patch read vacuous; the shards and the pin test are the proof.
(e) gate-integrity: base clean; origin/main = exactly 0 findings (the coordinator's ruling: the shared expected file is EMPTY since the
    sync; any finding = STOP; this folder's empty file says the same).
VITEST BUMP: the sync brought web vitest 5.0.2 -> 5.0.3 (#335); the owner measured on 5.0.2. The runner patch targets
@stryker-mutator/vitest-runner 10.0.0, unchanged (web/bun.lock patchedDependencies). The pin test and the two shards in this hold run on
5.0.3, so they are the check that the patch still holds; the hosted reports of shards 0, 1, 2, 4 ran 5.0.2.
Not run: the full combined run (lead's ruling); the other four shards locally. Risk named in the receipts: a dependency patch, its pin
test and a config comment; the hold runs the two red shards as the workflow does, the merge step, the readers, typecheck and the gates;
the final proof is one manual dispatch of the nightly workflow on the follow-up branch.
