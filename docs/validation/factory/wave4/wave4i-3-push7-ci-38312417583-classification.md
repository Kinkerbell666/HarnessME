# Hosted CI 38312417583 on f0cde0407 (feat/factory-platform-followup-1; PR 337, draft, no labels; the follow-up batch): integrator-5, 2026-10-12T22:2xZ

Run: ci 38312417583, 21:43:38Z - ~22:17Z, completed (failure); 58 jobs, one attempt, no re-run, no cancel; deps-audit 38312419961.
- vs 38057213251 (512701105, the last PR 318 run): red 1 -> 5; NEW RED 4 (all one Docker Hub 502 and its cascade); same 53.
- vs main 38284174059 (6ffd88784, the same code minus receipts and W4H-23): red 1 -> 5; NEW RED 4 (the same four).
- vs 37138524741: red 20 -> 5; fixed 15.
Classes: A expected external condition; B aggregator/cascade; C repository defect; D hosted-environment-only; E flake/race.

| Job | 38057213251 | 38312417583 | Class | Cause (logs under push7/ci-38312417583/) |
| --- | --- | --- | --- | --- |
| Factory runner readiness precheck | failure | failure | A | FACTORY_RUNNER_READ_TOKEN unset (expected) |
| E2E (real auth + real DB) | success | failure | D | step `bash scripts/setup-extension-runner-ci.sh --install`: "Trying to pull docker.io/oven/bun@sha256:9114c058…: reading manifest … received unexpected HTTP status: 502 Bad Gateway", exit 125, before any test ran (Docker Hub server error on the unauthenticated pinned guest image pull; the 429 family) |
| Browser route coverage | success | failure | B | "browser coverage producer failed: failure" (the real-auth lane is a producer); merged.json absent |
| Per-file coverage gate | success | failure | B | "coverage producers failed — coverage data is incomplete" at 'Require coverage producers to have succeeded'; never reached the merge |
| E2E (mock, no Docker) | success | failure | B | the aggregator: "mock=success mock_full=success evidence=success production=success engines=success route_coverage=failure" |

Gate integrity: GREEN with NO label: env GATE_CHANGE_APPROVED empty; "Gate integrity PASSED: no gate-weakening or test-cheating changes detected." (0 findings; main carries the gate tooling).
Everything else success or skipped as before (Factory isolation, deployment and operations, product and domain E2E: skipped behind A).
No repository defect (C) found. Recovery: a single-job re-run of E2E (real auth + real DB) re-runs the pull; its dependents (route coverage, per-file gate, the aggregator) re-evaluate after it. Not done: the coordinator's Docker Hub rule (record, no re-run without his word).

## Addendum (integrator-5, 2026-10-12T23:2xZ): attempt 2 and the nightly
- Attempt 2: the coordinator re-ran the failed jobs ONCE (`gh run rerun 38312417583 --failed`, ~22:2xZ). E2E (real auth + real DB) SUCCESS
  (the oven/bun pull went through); its dependents re-evaluated: Browser route coverage SUCCESS, Per-file coverage gate SUCCESS (coverage
  gate PASSED 2234 enforced files; new-file and patch PASSED; global 98.09%), E2E (mock, no Docker) SUCCESS. Final: red 1 = the token
  precheck (A). vs 38057213251 and vs main 38284174059: same 57, still red 1, no new red; vs 37138524741: 20 -> 1 (fixed 19). The
  attempt-1 D (Docker Hub 502) is therefore a hosted-environment failure, not reproducible on the second pull.
- Nightly 38312450934 (workflow_dispatch on the branch, report-only): SUCCESS, 8/8 jobs, 21:44:01-23:11:39Z. shard-check.py v2 on all six
  hosted reports: 0 zero-test survivors and 0 load kills with an import-resolution reason in every shard; load kills: shard 3 four
  (panel-persistence.ts:64 x3 "Cannot read properties of null (reading 'open')"; settings-nav.ts:134), shard 5 six (relative-time.ts:81 x2;
  chat-turn-collapse.ts:37/38/41/44), the others none. Scores 48.72 / 43.77 / 61.48 / 55.86 / 76.14 / 50.20; merged 55.72% over 6 of 6
  reports (11283 killed, 58 timeout, 3615 survived, 5396 no coverage); "Quality gates: FAIL" printed for the below-80 score, report-only by design.
