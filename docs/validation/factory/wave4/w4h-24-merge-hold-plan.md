# W4H-24 merge: hold plan v2 (integrator-5, 2026-10-13; lock-free prep; nothing committed). v1 768ac9cdfd56b1a0 kept as .v1.

Merge: wp/w4h-24-web-shard-timeout d224026d8 (FROZEN; 4 archy commits on origin/main d3e6871e5; report.txt d9eb015eb104094b) onto integ/w00
53689bf60. Folder: /tmp/factory-platform-evidence/w00/w4h-merge/w4h-24-web-shard-timeout

## 1. Trial (prep.sh rc 0)
trial tree a290223138e41158f211afa2f86c3d5030eab7b6, clean; 7 files: .github/workflows/ci.yml (+22 -1: test-web-shard timeout 10 -> 30 with the
rule next to it, the clock step and two ci-wall-time steps), scripts/ci-wall-time.sh (+44), scripts/ci-wall-time.test.ts (+90),
scripts/lib/ci-registration.ts (+2 -2), scripts/web-shard-timeout-registration.test.ts (+76), tasks/factory/w4h-24-GATES.md (+60), tasks/todo.md (+10).
Hook maps 3: scripts/ci-wall-time.test.ts, scripts/lib/ci-registration.test.ts, scripts/web-shard-timeout-registration.test.ts.
NOTE: scripts/lib/ci-registration.ts is INSIDE SOURCE_GLOBS: the patch gate binds on its changed lines (not vacuous for that file).

## 2. Commit (on validator-8's ACCEPT and the coordinator's word)
commit.sh under the lock (commit-locked.sh form, TC_IN_LOCK=1); the hook runs the 3 suites. No manifest or patch change: no fresh install.

## 3. Hold: w4f-merge/hold-w4f.sh through gated-flock (exit file, timeout 7200, GATED_FLOCK_START_MEM_GIB=12), the TARGETED form
(a) unit.txt 0677abf2edec0049: 17 lcov legs = the 3 hook-mapped tests + the 15 ci.yml readers outside the guard set (one shared:
    ci-registration.test.ts). Their lcov joins the merge, so the patch gate reads scripts/lib/ci-registration.ts.
(b) extra-legs.sh 2d1cb799b6ee6ef7:
    - typecheck-all via tc_leg; actionlint-compare (BINDING 0 new over the base; the owner's actionlint 1.7.12 saw the same 3 label findings)
      plus hold-w4f's labelled actionlint leg.
    - web-shard-timeout (print) and BINDING 1 web-shard-timeout-rule: timeout-rule.sh 25e6aca6147c5db7, factor 6 (the ruling), input
      r1-p95-seconds.txt dd33ff22ea9abfa1 = 265 s from report line 13; the arithmetic printed; test-web (3) and web-bun-tests (15)
      must be UNCHANGED. Pre-check with d224026d8's ci.yml: "6 x p95 = 1590 s; rounded up to 5 min: 30 min; merged 30; rule MET; 3 -> 3; 15 -> 15".
    - BINDING 2 warn-and-timeout-cases: case-check.sh 10f2f113fdd698bb re-runs the hook-mapped root tests with bunfig-testfiles.toml
      (coverageSkipTestFiles = false) and a junit report, and binds:
      * warn-cases.txt dc3d898ad52b8a34: the 6 registration cases and the 11 ci-wall-time cases (7 named + '4x warns about the
        usage and exits 0' for the test.each table), each passing, none failing;
      * every instrumented changed line of the changed test files covered (lcov-changed-lines.py --include-tests);
      * every executable ADDED line of scripts/ci-wall-time.sh executed: a bash wrapper first on PATH (the test starts bash with a clean env
        and PATH) sets BASH_ENV=bash-trace-env.sh; bash-line-cover.py 00267ceaeb140715 reads the xtrace. Function definition lines,
        blank, comment and bare keyword lines do not count.
      Pre-check on an export of d224026d8 (git archive, the integ node_modules linked): 11/11 and 6/6 pass; all 14 case entries pass;
      ci-wall-time.sh "added 44, executable 21, executed 21, missed 0".
(c) standard legs: prune scan, attestation, guard set, builds, web-server-lcov, coverage-merge, web build, graph mock pass, CRAP vs the first parent.
(d) merge-commit-gates vs 53689bf60, BINDING: new-file (scripts/ci-wall-time.sh is .sh, tests excluded: vacuous expected); patch binds on
    scripts/lib/ci-registration.ts's changed lines (the 17 unit lcov legs feed it); CRAP over the touched functions.
(e) gate-integrity: base clean; origin/main = exactly 0 findings (the owner read 0 at both legs; a finding = STOP).
Not run: the full combined run and the web shards locally (a hosted timing change). Risk named in the receipts: one job's timeout, three
log steps and a WARN script that always exits 0; the proof is the hosted run on the branch (the shard under the new cap; the WARN lines).
