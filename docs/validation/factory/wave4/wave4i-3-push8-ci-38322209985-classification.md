# Hosted CI 38322209985 on 044253aa3 (feat/factory-platform-followup-1; PR 337, draft, no labels; the push7 receipts, docs-only): integrator-5, 2026-10-12T23:5xZ

Run: ci 38322209985, 23:27:18Z - 23:57:37Z, completed (failure); 58 jobs, one attempt, no re-run, no cancel; deps-audit 38322209969 success.
No nightly dispatch (docs-only delta; the coordinator's word).
- vs 38312417583 attempt 2 (f0cde0407): same 57, still red 1, no new red.
- vs 37138524741: red 20 -> 1, fixed 19.
Classes: A expected external condition; B aggregator/cascade; C repository defect; D hosted-environment-only; E flake/race.

| Job | 38312417583 a2 | 38322209985 | Class | Cause (logs under push8/ci-38322209985/) |
| --- | --- | --- | --- | --- |
| Factory runner readiness precheck | failure | failure | A | "FACTORY_RUNNER_READ_TOKEN is required" (the secret is unset) |

Gate integrity GREEN with NO label (GATE_CHANGE_APPROVED empty): "Gate integrity PASSED: no gate-weakening or test-cheating changes detected." (0 findings).
Per-file coverage gate GREEN: "Coverage gate PASSED: 2234 enforced file(s)"; new-file PASSED (no new source files in the PR diff); patch PASSED
(0 files); global line coverage 98.09% (213694/217855 lines, 2368 files), floor 90%. No Docker Hub error this time.
