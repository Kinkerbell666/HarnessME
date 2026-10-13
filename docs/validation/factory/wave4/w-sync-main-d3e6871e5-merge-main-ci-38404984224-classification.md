# main's hosted ci 38404984224 on d3e6871e5 (the PR 337 merge; the tree of 044253aa3, which PR 337's run 38322209985 measured): integrator-5, 2026-10-13T14:0xZ

58 jobs, 13:26:37Z - ~14:04Z, completed (failure); deps-audit 38404982201 success. vs 38322209985 (the same tree): NEW RED 2, success -> cancelled 1, still red 1 (the token), same 54.
| Job | 38322209985 | 38404984224 | Class | Cause (main-ci-38404984224/) |
| --- | --- | --- | --- | --- |
| Factory runner readiness precheck | failure | failure | A | the FACTORY_RUNNER_READ_TOKEN secret is unset |
| Web tests shard 3 | success (219 s) | CANCELLED (619 s) | E | the job's 10-minute timeout (ci.yml timeout-minutes 10): every logged test passed, the last a CommandPalette projects suite; then nothing until "The operation was canceled". The shard took 219, 252 and 260 s on the three PR runs. A hang or a slow hosted runner, not a test failure. |
| Web tests (vitest) | success | failure | B | the aggregator of the three web shards (shard 3 cancelled) |
| Per-file coverage gate | success | failure | B | "coverage producers failed — coverage data is incomplete" (web shard 3 is a producer) |
No C: the code is byte-equal to the PR head that ran green apart from the token. Recovery: a single-job re-run of Web tests shard 3 on main (its two dependents re-evaluate) — the coordinator's call.
