# Hosted CI 38057213251 on 512701105 (feat/composable-factory-platform; PR 318 with the gate-change-approved label; the sixth-push receipts): integrator-5, 2026-10-10T14:2xZ

Run: ci 38057213251, 13:49:32Z - 14:20:15Z, completed (failure); 58 jobs, one attempt, no re-run, no cancel, no timeout; deps-audit 38057212923 success.
- vs 38026634201 (c786088df): red 2 -> 1; fixed 1 (Gate integrity); same 56; still red 1; no new red.
- vs 37138524741 (52d8ba079): red 20 -> 1; fixed 19.
No Docker Hub 429 in any saved log. Secret check at 13:49:50Z (`gh secret list -R ezcorp-org/EZHarness`, rc 0): the list is empty;
FACTORY_RUNNER_READ_TOKEN is not set.
Classes: A expected external condition; B aggregator/cascade; C repository defect; D hosted-environment-only; E flake/race.

| Job | 38026634201 | 38057213251 | Class | Cause (logs under push6/ci-38057213251/) |
| --- | --- | --- | --- | --- |
| Factory runner readiness precheck | failure | failure | A | "FACTORY_RUNNER_READ_TOKEN is required" (the secret is unset at the run start; expected) |
| Gate integrity | failure | SUCCESS | fixed | the label works: env GATE_CHANGE_APPROVED: 1; "Gate integrity: 8 finding(s) BYPASSED via GATE_CHANGE_APPROVED (maintainer label)", the same 8 coverage-tool files |
Skipped as before (the readiness precheck is A): Factory isolation; Factory deployment and operations; Factory product and domain E2E.

Targets, first attempt, all GREEN:
- Factory Temporal integration, 13:49:35-13:53:23Z: 102 per-test lines; "ℹ tests 92 / ℹ pass 92 / ℹ fail 0 / ℹ cancelled 0", 175 s.
- Production proof (content), 13:54:48-14:17:33Z: "13 passed (8.0m)" including ":516 UI: a refused add surfaces a real error toast in the browser (3.8s)";
  LEGACY_MAIN_TO_V4_ADOPTION_VERIFIED.
- Per-file coverage gate, 14:17:27-14:18:08Z: "Coverage gate PASSED: 2234 enforced file(s)"; new-file PASSED (460); patch PASSED (518 files);
  global line coverage 98.09% (213687/217858 lines, 2368 files), floor 90%.
