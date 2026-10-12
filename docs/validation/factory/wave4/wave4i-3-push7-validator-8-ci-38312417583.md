# Hosted: ci 38312417583 on feat/factory-platform-followup-1 f0cde0407 (PR #337, draft, no labels, BLOCKED), validator-8
Compared job by job (validator-8/hosted-compare.py, a copy of w00/wave4i-2's) against the last main run 38284174059 (6ffd88784) and the
last integ run 38057213251 (512701105): both baselines red only on the token precheck. This run: 58 jobs; same 53, still red 1, NEW RED 4.

| Job | main 38284174059 | integ 38057213251 | this run | class | cause |
| --- | --- | --- | --- | --- | --- |
| Factory runner readiness precheck | failure | failure | failure | A | the expected token precheck (secret) |
| E2E (real auth + real DB) | success | success | failure | A | external registry: step "setup-extension-runner-ci.sh --install" pulling docker.io/oven/bun@sha256:9114c058… got "received unexpected HTTP status: 502 Bad Gateway" from Docker Hub (21:46:41Z); no test ran (steps 7-8 skipped); the upload step then found no fresh-setup files |
| Browser route coverage | success | success | failure | B | cascade: it requires every coverage producer, and the real-auth lane above failed |
| E2E (mock, no Docker) | success | success | failure | B | aggregator cascade: its own log reads mock=success mock_full=success evidence=success production=success engines=success route_coverage=failure |
| Per-file coverage gate | success | success | failure | B | cascade of the browser route coverage producer |

Green and as expected: Gate integrity (log: "Gate integrity PASSED: no gate-weakening or test-cheating changes detected", 0 findings,
GATE_CHANGE_APPROVED empty, no label on the PR); Factory Temporal integration (W4H-21); Typecheck; Production proof (content, resources,
delivery, recovery) (W4H-18, W4H-22); every other job equal to both baselines.
Verdict on the run: no class C, D or E red. The only non-expected red root is one Docker Hub 502 (class A, external, transient in kind);
its three followers are B. A re-run of the failed jobs (gh run rerun 38312417583 --failed) should turn them green; that decision is the
lead's / integrator's.
Files: ci-38312417583-jobs.json, ci-vs-main.md, ci-vs-integ.md, baseline-38284174059.tsv, baseline-38057213251.tsv.
