# Hosted comparison for PR #337 (feat/factory-platform-followup-1 = f0cde0407), validator-8, 2026-10-12
Baselines: ci main 38284174059 (6ffd88784) and integ 38057213251 (512701105), each red only on the token precheck; nightly red
38238981958 (6eb1bbb33) and last green 38042900360 (e3309906d). Classes: A expected external (label, secret), B cascade, C repository
defect, D hosted-environment-only cause, E flake.

## ci 38312417583 — attempt 1 (58 jobs; red 5) and attempt 2 (failed jobs re-run once; red 1)
| Job | main | integ | attempt 1 | class | attempt 2 |
| --- | --- | --- | --- | --- | --- |
| Factory runner readiness precheck | failure | failure | failure | A (the token) | failure (A) |
| E2E (real auth + real DB) | success | success | failure | D: Docker Hub answered "502 Bad Gateway" to the pull of docker.io/oven/bun@sha256:9114c058… in setup-extension-runner-ci.sh --install (21:46:41Z), before any test | success |
| Browser route coverage | success | success | failure | B (cascade of the real-auth lane) | success |
| Per-file coverage gate | success | success | failure | B (cascade: coverage data incomplete) | success |
| E2E (mock, no Docker) | success | success | failure | B (aggregator: route_coverage=failure, every other input success) | success |
| Gate integrity | success | success | success: "Gate integrity PASSED", 0 findings, no label | — | success |
Every other job equals both baselines (53 same in attempt 1). No C or E. Attempt 2 is red on the token only, as expected.
(My first file ci-38312417583.md classed the 502 as A; the lead's and integrator-5's D is the right class: A is reserved for the label
and the secret. Corrected here.)

## Mutation (nightly, full suite) 38312450934 — SUCCESS (report-only)
| shard | score | zero-test survivors | load kills, reasons | resolution-reason kills | red 38238981958 | green 38042900360 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 48.72 | 0 | 0 | 0 | 48.72 / 0 zero-test | 6.03 / 1781 |
| 1 | 43.77 | 0 | 0 | 0 | 43.77 / 0 | 3.11 / 2289 |
| 2 | 61.48 | 0 | 0 | 0 | 61.48 / 0 | 2.04 / 1666 |
| 3 | 55.86 | 0 | 4: settings-nav.ts:134 (undefined[0]); panel-persistence.ts:64 x3 (null.open) | 0 | 55.79 / 1 | 3.59 / 2393 |
| 4 | 76.14 | 0 | 0 | 0 | 76.14 / 0 | 4.89 / 2132 |
| 5 | 50.20 | 0 | 6: relative-time.ts:81 x2 (Intl RangeErrors); chat-turn-collapse.ts:37/38/41/44 (TypeErrors) | 0 | 50.07 / 4 | 9.83 / 1511 |
Summary job, as printed: "Final mutation score 55.72% (threshold 80%): 11283 killed, 58 timed out, 3615 survived, 5396 no coverage";
"✗ Final mutation score 55.72% under breaking threshold 80%"; "(report-only: not failing the build; pass --enforce to gate on the merged
verdict)"; quality summary {"score":55.72,"threshold":80,"passed":false}.
The panel-persistence.ts:64 load kills (integrator-5 asked for a judgement): genuine. The three mutants (the guard
`if (!raw || typeof raw !== "object") return null` made false / `&&` / `raw`) drop the null branch, so the next line reads `o.open`
on null — the recorded reason. stores.svelte.ts:265 calls readTeamPanel() at module top level, so the store module throws on import and
the 37 component test files that import it fail to load: mutant-caused, a real detection. My local shard 3 at 614dafa9b recorded the
same four mutants as Timeout (detected; slower host), which is why they were not load kills there.
Reading: W4H-23 holds on hosted (0 zero-test survivors, 0 resolution-reason kills, every load kill mutant-caused). The merged 55.72%
is below 80%; the run is green only as report-only. That gap and the 5396 no-coverage mutants (33 files) are the maintainer decision B.
Files: ci-38312417583-jobs.json, ci-vs-main.md, ci-vs-integ.md, nightly-38312450934/ (shard reports, summary.log, judge.txt),
deps-audit-38312419961.md (green).
