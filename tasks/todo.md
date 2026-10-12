# Extension v4 independent validation

## Factory completion plan — 2026-09-13

- [x] Audit the original platform plan and all thirteen launch contracts against current source and evidence.
- [x] Collect Sol and Terra checkpoint and gap reviews without treating unmerged work as integrated.
- [x] Write a dependency-ordered completion plan with owners, test criteria, and the authorized ten-installation milestone.
- [x] Review hidden gaps and validate requirement coverage, local links, and dependency order.
- [x] Record the plan review and leave platform launch gates unchanged.

Plan review: This turn produces a plan. It does not start a new feature implementation leaf or claim launch readiness. The existing worktree remains the integration target; active agents report their current checkpoints and remaining gaps.

Review: The [completion plan](../docs/plans/2026-09-13-composable-factory-platform-completion.md) contains 22 work packages and maps all thirteen contract/proof pairs and eleven platform gates. Four workstream audits distinguish integrated, unmerged, dirty, unproven, and missing work. Independent Sol and Terra review corrections include early archive readiness, component versus deployment certification, live cancellation and usage reconciliation, exact package identity, package lifecycle/API ownership, pool fairness, outbound notifications, and backup/key requirements. Both reviewers report their findings resolved. Document checks pass: 27 local links, complete mappings, acyclic dependencies, archive-before-publication, deployed restore/final CI prerequisites, and unchanged platform gates. The checksummed record is `docs/validation/factory/completion-plan/structure.json`. This task changes documentation only; no product test or launch completion is claimed.

## Trusted factory command lookup — Terra

- [x] Reproduce rejection for an uncommitted or foreign command reference.
- [x] Add a scoped command index with its audit foreign key and migration parity.
- [x] Commit command indexing with transition audit and inbox receipt.
- [x] Verify index, audit, manifest, pages, and command digest before return.
- [x] Prove PGlite and PostgreSQL/S3 retries, rollback, and corruption denials.
- [x] Run coverage, four typecheck legs, and lint; record review.

Review: public page-stage/finalize/record/load tests reject uncommitted and foreign references, duplicate IDs, changed IDs, tampered indexes, audit payloads, and page blobs. They also prove retry convergence and one transaction for audit, index, and inbox receipt. Focused Bun coverage reports 125/125 executable lines for `transition-artifacts.ts`, 334/334 for `factory-schema.ts`, and 4/4 for the new migration at `/tmp/factory-platform-evidence/terra-c02-command-coverage.lcov`. The real PostgreSQL/S3 proof passes seven cases at `/tmp/factory-platform-evidence/terra-c02-command-postgres-s3.log`. Four typecheck legs and lint pass with zero errors and eight existing infos at `/tmp/factory-platform-evidence/terra-c02-command-types-lint.log`.

## Factory transition status projector — Terra

- [x] Reproduce a public started run that stays queued after a committed terminal transition.
- [x] Add bounded audit projection cursor and atomic lifecycle read-model apply methods.
- [x] Verify committed transition artifacts before deriving terminal status.
- [x] Add a fair indexed installation drain that does not let a corrupt run starve later runs.
- [x] Prove cursor recovery, ordering, cancellation, transaction rollback, scope denials, and drain fairness on PGlite and PostgreSQL/S3.
- [x] Run coverage, four typecheck legs, and lint; record review.

Review: A public started run remains `queued` until its verified committed root transition is projected. The projector checks the canonical audit and immutable page bytes before its cursor and lifecycle update commit in one transaction. `lag` is the committed audit maximum sequence minus the durable consumer cursor. `projectPending({ runs, batchesPerRun })` uses the scoped audit and projection indexes, orders by the oldest unprojected sequence, and records a corrupt run error while it continues with later runs. PGlite passes 17 cases/130 assertions at `/tmp/factory-platform-evidence/terra-run-projection-pglite.log`; real PostgreSQL/S3 passes the same suite at `/tmp/factory-platform-evidence/terra-run-projection-postgres-s3.log`. Focused artifact integration passes 12 cases/54 assertions at `/tmp/factory-platform-evidence/terra-run-projection-artifacts.log`. The new projector measures 64/64 executable lines in `/tmp/factory-platform-evidence/terra-run-projection-coverage.lcov`; all four typecheck legs and lint pass at `/tmp/factory-platform-evidence/terra-run-projection-final-types-lint.log` (eight existing lint infos).

### Projector fairness follow-up

- [x] Reproduce fixed-page starvation with a corrupt oldest run and `runs: 1`.
- [x] Persist attempts and select untouched work before least-recently-attempted retries.
- [x] Prove PGlite and PostgreSQL/S3 recovery, coverage, typechecks, and lint.

Review: `factory_run_projection_attempts` stores each scheduler attempt and its visible error code without changing the audit cursor. The indexed drain selects every never-attempted run before the least-recently-attempted retry. The `runs: 1` test first returns the corrupt oldest run, then projects the healthy later run, and after restart returns the corrupt retry with attempt count two. PGlite passes 20 cases/140 assertions at `/tmp/factory-platform-evidence/terra-projection-fairness-pglite.log`; real PostgreSQL/S3 plus schema parity passes 19 cases/1,388 assertions at `/tmp/factory-platform-evidence/terra-projection-fairness-postgres-schema.log`. Coverage measures the new migration 6/6, Drizzle schema 347/347, and projector 68/68 lines at `/tmp/factory-platform-evidence/terra-projection-fairness-final-coverage.lcov`; all four typecheck legs and lint pass at `/tmp/factory-platform-evidence/terra-projection-fairness-final-types-lint.log` with eight existing infos.

## Factory assurance integrity — 2026-09-13
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

Note (W00 audit 2026-09-13): the three checked items below cite no receipt. Their proof items remain unchecked. Do not rely on the checkbox state without a receipt.

- [x] Bind every persisted contract field and the approving authority into a canonical protected snapshot.
- [x] Revalidate that snapshot and current gateway evidence at acceptance and release consumption.
- [x] Write approval request, decision, and consumption audit facts in their owning transactions.
- [ ] Prove direct pre-accept and post-approval tampering, plus audit write faults, fail closed on PGlite and PostgreSQL.
- [ ] Run static checks, coverage, and real PostgreSQL proof; record the review.

## C02 isolated attempt runtime — Terra
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Persist the canonical launch intent and exact held lease before a guest start.
- [x] Implement inspect-first stable-worker open, recovery, result wait, and physical-stop receipt.
- [ ] Bind the Python C02 wire bridge into the production guest path alongside Bun.
- [x] Prove the five-second renewal and lease-revoked stop path.
- [x] Prove fresh Bun/Python/Podman GPU execution, response-loss recovery, and no duplicate start.
- [ ] Run PGlite, PostgreSQL/S3, type, lint, coverage, and gates; record review.

Checkpoint review: `attempt-runtime.integration.test.ts` passes five PGlite/real-Podman cases and 24 assertions. It persists a token-free request and prepared receipt before start, reattaches after a lost start response, rejects terminal and uncertain recovery execution, renews every five seconds and physically stops on loss, uses only the provider broker reverse capability, and verifies an RSA-SHA256 host stop proof over canonical unsigned receipt bytes. Focused coverage is 177/177 executable lines in `attempt-runtime.ts` and 9/9 in `add-factory-attempt-launches.ts` at `/tmp/factory-platform-evidence/terra-c02-attempt-runtime-coverage/lcov.info`. Full PostgreSQL schema conformance reaches this migration but currently fails the known pre-import C05 three-FK mismatch for `factory_runner_package_bindings`; root's `310534627` correction resolves that during integration. Python needs its separate pinned guest recipe before this leaf is complete.
## Factory continuation reader leaf — Terra

- [x] Load scoped transition manifests and pages through immutable artifact references.
- [x] Validate canonical manifest identity, source sequence, page order, digest, page limits, and aggregate bytes.
- [x] Prove a Node-saved paged transition restores from PGlite and PostgreSQL/S3, while foreign, replayed, and corrupt references fail.
- [x] Run focused and full required static validation; record receipts.

Review: PGlite restored the exact 40 KiB Node-produced transition through two bounded pages. The PostgreSQL/S3 proof repeated the same producer-to-reader round trip. Both reject foreign identity, a replayed source sequence, changed references, and corrupt content; the existing failed inbox admission test proves the audit transaction rolls back. Focused coverage reports 100% executable lines for the three owned source files. The post-codec protobuf boundary test uses installed Temporal 1.23 proto encoding at exactly 64 KiB and rejects one byte more.

## Factory C06 encryption leaf — Terra

- [x] Read keys through descriptor-anchored private paths with bounded reads.
- [x] Make concurrent different-master rotations report persisted versions only.
- [x] Bind Temporal payloads from SDK serialization context with a bounded digest.
- [x] Prove local PostgreSQL/S3 behavior and static checks; record receipts.

Review: descriptor tests reject an actual FIFO and a symlinked parent. The real PostgreSQL race persists distinct-master versions before either caller reports success, then restarts with `second-master`. Real local S3 preserves the versioned ciphertext object through rotation. Focused Bun source coverage has 100% lines for `encryption.ts` and `private-files.ts`; the real PostgreSQL producer has 100% lines for `encryption-key-wrap-store.ts`. Four typecheck legs, lint, and the Node 24 Temporal codec contract pass. Production worker wiring remains with the verification leaf.

## Factory C06 readonly Node key loader — Terra

- [x] Add strict descriptor-read wrapped-key file schema and readonly store.
- [x] Load an existing installation key without DB, key creation, or rotation.
- [x] Prove Node 24 Temporal codec success and all key-file readiness denials.
- [x] Recheck encrypted definition/application composition and required validation.

Review: `src/factory/file-key-wraps.ts` reads only private descriptor-anchored files, accepts only `factory.key-wraps.v1`, has no data-key creation or rotation path, and returns only the Node-compatible history codec. The Node 24 test covers the workflow context round trip plus missing, empty, foreign, malformed, corrupt, wrong-master, mode, and grantable-root denials. Canonical Node coverage records 101/101 lines for this source at `/tmp/factory-platform-evidence/terra-c06-node-coverage/lcov.info`. The real PostgreSQL and local S3 proof publishes and reads an encrypted definition through `createFactoryApplication` at `/tmp/factory-platform-evidence/terra-c06-definitions-postgres-s3.log`. Four type legs and lint complete at `/tmp/factory-platform-evidence/terra-c06-types-lint.log`; lint has zero errors and eight existing infos.

## Backend regression repairs — Terra

- [x] Preserve the terminal human-review error after a rejection.
- [x] Permit bounded canonical bundled host-API grant records through approval.
- [x] Align the C02 request fixture cursor with the checkpoint protocol.
- [x] Run focused tests, required static checks, and changed-source coverage.

Review: full affected test files pass independently: 3 event-subscription cases, 7 grant-reconciliation cases, and 3 real-Python C02 conformance cases. The focused canonical Bun coverage receipt at `/tmp/factory-platform-evidence/terra-backend-regression-coverage.log` covers the changed lifecycle lines (310–311) and approval-context limit (32). The four canonical typecheck legs and lint pass at `/tmp/factory-platform-evidence/terra-backend-regression-types-lint.log`; lint reports zero errors and eight existing infos.

Note (W00 audit 2026-09-13): terra-backend-regression-coverage.log contains no Python conformance run; the three real-Python cases have no located receipt. W02 must produce one.

- [x] Fetch PR and latest main; preserve original worktrees.
- [x] Read handoff, repository rules, and lessons; assign four Sol worktrees.
- [x] Complete clean/reused installs, package suites, backend, web, static, and coverage runs.
- [x] Reproduce and repair SDK, browser, provider, memory, File Organizer, runner, and compiler defects.
- [x] Verify all50 lifecycle records and all117 capability categories.
- [x] Review all84 migration findings and six pending product decisions.
- [x] Verify actual PostgreSQL fences, final image, full browser runs, screenshots, and parent regressions.
- [x] Independently replay all1,556 coverage producers through the12-group CI merge.
- [x] Verify final-image syscall effects and record the external kernel-audit blocker.
- [x] Close seven preview Docker opt-ins and exact PostgreSQL migration assertions.
- [x] Repair and verify AI-kit readiness false passes and outdated Price Chart E2E fixtures.
- [x] Reconcile final named skips, hooks, retired tests, and precise external blockers.
- [x] Recheck changed-source coverage/static checks and final evidence hashes.
- [x] Finish tracked report and preserve worktree states.
- [x] Commit the final report and receipts with normal hooks (`de0bcb58`).

## Review

Full checks and parent coverage replay pass. Gate integrity remains84 findings/exit1 without override. Six product decisions, provider inputs, and a suitable Linux security runner remain external inputs. No push, approval label, PR-ready change, or merge is authorized. Completion requires all remaining local test defects to be repaired or precisely classified; no skipped or vacuous case counts as a pass.


Final review: completed independent Sol audit and parent verification. The final12-group coverage replay passes1,246/131/378 gates; exact final image passes8 verifier checks and12 browser cases; fresh installs and final static checks pass. Parent source and raw-evidence reviews caught and corrected overstated claims, outdated fixtures, unsafe assumptions about skipped checks, missing archive receipts, and client response defects. Report: `docs/extension-v4-independent-validation-report.md`. Remaining human, provider, and platform inputs are explicit; no approval labels, push, ready change, or PR merge occurred.

## Authorized push — 2026-09-06

The user authorized the push after the audit. The earlier restriction describes the audit period.

- [x] Confirm the remote PR branch and latest main; push `cd047112` with normal hooks.
- [x] Confirm PR #246 has the pushed commit and inspect its hosted jobs.
- [x] Reproduce the hosted secret-scan finding with the pinned scanner and redacted output.
- [x] Rename the ambiguous commit-hash field and update its evidence checksum.
- [x] Verify the corrected evidence and secret scan.
- [x] Push the evidence correction with normal hooks.
- [x] Inspect all hosted results on the final pushed commit; record policy approval separately.

Review before the correction push: the pinned scanner reproduces one finding for a Git SHA in `final-ref-review.json`. Renaming its field to `live_pr_base_commit_sha` clears the finding without a scanner exception. The full evidence verifier and all54 parent checksums pass. Production code and tests are unchanged. The first hosted run passes dependency audit, PostgreSQL, type checks, web tests, and the completed backend lanes; remaining lanes are still running. Gate integrity still requires maintainer approval.

Push result: `2fea009e` is on PR #246. All32 technical checks pass; Gate integrity alone fails with84 findings that require maintainer review.

## Extension install, use, and removal — Terra team

- [x] Map the current user paths and assign separate Terra worktrees.
- [x] Test new extension creation/import, approval, and installation through the real UI.
- [x] Use installed extensions and verify their actual output and stored state.
- [x] Test conversation tool selection, disable/enable, uninstall, reserved-name denial, fresh distinct-name installation, and failed updates.
- [x] Check desktop/mobile screens, browser errors, server errors, and cleanup.
- [x] Reproduce and repair defects; add tests that fail without the repair.
- [x] Review each agent's evidence and independently repeat the complete final flow.
- [x] Run the checks needed for changed files and record exact results and limits.

Plan review: use owned local projects, files, and databases. Exercise current v4 approval and release paths. Existing audit results are context; this task needs fresh proof that a new extension can be installed, used, removed, and installed again.

Scope review: conversation tool selection can hide tools, but there is no conversation detach operation. Uninstall retains the installation history, data, and name reservation. A new installation must use a distinct name and fresh approval. The tests verify these current rules; they do not claim same-name restoration.

Review: the parent repeated all 57 real-auth browser cases, the exact mock lane (210 pass; 13 Docker-only skips), and all 7,050 component tests. The final committed-source image at `717e6fed` passed its eight runtime checks and all 13 real File Organizer cases. Fresh source imports, actual tool output, storage isolation, disable/reapproval, uninstall, 320/390 px controls, and 720 px desktop scrolling are verified. Coverage gates pass for 1,247 file thresholds, 131 new files, and 381 changed files. Report: `docs/extension-v4-flow-validation-report.md`. Expected denial responses and pre-existing mock/model warnings are recorded separately.

- [x] Verify final evidence checksums and scan the staged source and expanded flow logs for secrets.

Publication and hosted checks are recorded in the final response after this review is committed. Policy approval remains separate; no approval label or merge is authorized.

## Hosted browser follow-up — 2026-09-06

Hosted run `34047007752` passed 30 technical checks. Two browser checks failed: the real event stream closed during an idle period, and the observability visual test still mocked the old settings endpoint. Gate integrity retains its 84 policy findings.

- [x] Reproduce the idle event-stream failure; repair its cause and keep strict browser error checks.
- [x] Reproduce and update the observability fixture to the current batch settings contract.
- [x] Independently verify the team changes and run the complete diff-selected visual capture and affected real-auth flows.
- [x] Run source checks and production image verification required by the final changes.
- [x] Update evidence, review results, checksums, and the secret scan.

Publication follows this committed review: push with normal hooks, inspect every hosted check on the new commit, and report the actual remote result in the final response.

Plan review: use the CI traces to identify failed requests, reproduce each failure before editing, and retain zero retries and strict error assertions. No gate exceptions or policy approvals are part of this repair.

Review: parent replays passed all 179 mock evidence cases, nine real evidence cases, 57 full real-auth cases, 38 corrected mock cases, 12 route unit cases, and both canonical Bun route-producer cases. The final image at `39d181a8` passed its eight checks, three authenticated heartbeats over 45 seconds, and all 13 File Organizer cases. A focused real lifecycle also verifies the final status-label contrast. Main remains `537f074e`; no gate override or merge approval was applied.

## Canvas history race — hosted follow-up

Hosted run `34050069966` passed 31 technical checks. Visual evidence exposed a mock persistence defect: a later refresh returns only the original messages and removes the live preview. A separate controlled pre-event request tests the production hydration race. Gate integrity has the same 84 findings as the prior run.

- [x] Reproduce the delayed history response after live completion in the browser.
- [x] Repair mock persistence and the reproduced stale-response race; preserve later authoritative history and conversation isolation.
- [x] Independently review the repair and verify strict browser, store, and loader regressions.
- [x] Repeat the complete canonical visual capture and real-auth extension flows.
- [x] Build and use the updated production image; verify output, stream health, and cleanup.
- [x] Update evidence, checksums, secret scan, and review results.

Plan review: keep the actual live event flow and strict assertions. Do not compare server timestamps with the browser clock. A pending history response must not erase a newer live update, and a later authoritative response must still remove an absent entry. Publish with normal hooks and inspect every hosted check on the final commit.

Review: all 7,099 component tests, 4,079 web Bun tests, 180 mock evidence cases, nine real evidence cases, 57 full real-auth cases, and 210 shared mock cases pass. The image from `26541024` passes eight container checks, three stream heartbeats over 45 seconds, and all 13 File Organizer cases. Parent repeated the final canvas test after the E2E-only marker refinement. Both controlled production faults fail at their intended assertions and restore source bytes. The final staged scan and evidence checksums are checked before commit; publication and hosted results follow without a policy override.

## Shipping confidence — test gap review

- [x] Compare current tests with recovery, upgrade, authority, and browser risks.
- [x] Have Terra agents check separate areas; verify each proposed gap against existing tests.
- [x] Rank useful additions by release risk and define observable pass criteria.
- [x] Record what can run locally and what requires a product decision or external runner.

Plan review: inspect the pushed `232cad4a` source. Existing normal flows and all 32 technical CI checks pass. Propose tests at the already used browser, public API, and production container boundaries. Do not treat coverage percentages as proof of crash recovery or replace missing live checks with mock results. Implementation scope is pending the user's optional preference; complete the ranked review regardless.

Review: four Terra reviews and parent source checks identify real-version upgrade, app/runner process death, revocation during a paused invocation, and stale browser state as the strongest additions. Current upgrade smoke builds one source twice; current PR CI omits the production-image File Organizer cases. Parent corrected proposed legacy migration assertions: explicit adoption retains identity/data, clears grants, and requires fresh approval; it must not silently preserve legacy execution. Ranked plan: `docs/plans/extension-v4-shipping-test-gaps.md`. This turn adds a test plan only; no new product test pass is claimed.

## Shipping confidence implementation — fresh Terra team

- [x] Implement real-version upgrade and restore proof; enforce production-image suite in CI.
- [x] Implement actual app/worker crash, in-flight revocation, and measured lifecycle resource checks.
- [x] Implement stale-tab, pending-build reload, visible error recovery, and browser-engine checks.
- [x] Implement interrupted source acquisition/retry and owner-deactivation integration.
- [x] Replace Stage2 TODOs with real checks; verify kernel/provider prerequisites and available cases.
- [x] Integrate and independently review/replay team changes; repair observed failures.
- [x] Verify complete relevant regressions, final image, screenshots/logs, coverage, secret scan and evidence.
- [x] Push with normal hooks and inspect all hosted jobs; report remaining external decisions precisely.

Plan review: the user approved all ranked additions. Work continues through the gates in gates/shipping-root.md and each shipping leaf; no permission request is needed for the agreed browser/API/container tests. Existing 84 policy findings require maintainer review independently.

Parent review in progress: import whole-file replay passes 11 cases. A live socket regression reproduced a new gateway-listener shutdown leak; synchronous listener transitions fix it, with all 31 proxy cases passing. The gateway-bind failure case also verifies veth slot, filter descriptor and proxy cleanup. Remaining shipping gates stay open.

Final proof update: the 29eefc05 product image is built and transferred with matching engine IDs. Parent focused replays and 1,249/131/385 coverage gates pass. Full browser regression is 59 real-auth, 210 mock, and 180+10 visual cases at the exact recorded source. Final Chromium and Firefox lifecycle cases pass; WebKit and parent production-suite/legacy/container replays remain in progress. Static checks and the runner probe pass at 9b541ff5. Older post-restart bootstrap errors remain under diagnosis until the new image supplies attributable evidence.

Parent adversarial review found a false pass in the production File Organizer move case. The current 29eefc05 run reports 13 passes, but the observed owned proposal ended in `failed` state. The assertion only required a non-pending state. That run is not proof of a successful file move.

- [x] Reproduce the failed File Organizer effect with retained response/journal evidence, repair its cause, and verify exact destination contents plus source removal with a fault-sensitive E2E assertion.

- [x] Repair the reproduced restart contention: transient runner_busy retains queued operations. The strict image60a3421b R1 replay verifies all 28 bundled builds and recovers the same target operation without implicit activation.

Current repair review: product source60a3421b builds successfully and transfers with identical image ID5c4ccd4383d56cfe605003a39bc48ae9ce0267bbb80d76064fab87685bcfb9e9. Parent focused File Organizer and recovery/configuration replays pass. Source890df540 adds only recovery tests. The strict production suite, full backend/web/browser regressions, final independent checks, and 30-minute resource run are active or queued. All shipping final gates remain pending their actual results.

New production finding: image60a3421b still blocks File Organizer quarantine because its host path does not match the approved virtual /data grant. Actual R1 recovery now verifies all28 bundles. Full backend/web/final-independent/soak waiters were verified and cancelled before execution; no lane pass or failure is inferred from those cancellations. The production suite continues collecting independent core recovery proof while the permission boundary is repaired.

## Intermediate image repair — 2026-09-07

- [x] Complete File Organizer host-action authorization with real v4 permission checks and explicit project write scope; prove successful move/quarantine and denial outside scope.
- [x] Retain R2 bootstrap state on timeout, reproduce the failure, and repair its observed cause.
- [x] Review both repairs independently and repeat their production cases before final regression runs.
- [x] Run the final full regressions, candidate suite, independent browser/image checks, and 30-minute resource check; record exact sources and exits.

Plan review: the user authorized all shipping gap fixes. Terra owns the two independent repairs; the parent reviews source and runtime receipts. The completed 60a3421b suite exits 1: File Organizer and R2 fail; R1, R3, R4, historical upgrade/restore, and legacy adoption pass. Owned cleanup passes. Queued full regressions were cancelled before start, so they provide no test result. No passing shipping candidate is claimed.

R2 root-cause evidence: the canonical unchanged-image replay at source65486295 exits 1 with cleanup 0. At 02:24:13.744Z, 27 bundles are verified and the last has reached verifying after its six-minute lease expired. The 360-second observer expires during that final verification; a bounded R2-specific allowance and regression are in progress. This receipt distinguishes a test deadline defect from a stranded build queue.

R2 review: source26f8acf3 with a bounded 480-second observer passes all six worker-death checks against unchanged image60a3421b; all 28 bundles verify in 360,631ms, command0 and cleanup0. Parent source783ab8d9 passes the pinned six observer and 36 lifecycle tests. Parent verified curated checksums and terminal snapshot. File Organizer remains under repair: direct real-PDP tests also reproduced a prior always-allow setting bypassing a consumed action; the permission path must deny that replay before the image freeze.

File Organizer source freeze: commit6c05453edbb4148d53cbc37b67d05907b5459c67 includes finite live action permissions, private grant enforcement, batch/collision/cleanup fixes and the visible path to human folder approval. Parent directPDP23/23, realroute18/18, components84/84 and all four integrated type-check sections pass. Focused merged backend coverage is 100% for helper, applier, state and events. The production E2E now uses the visible folder approval controls and checks the returned exact scope; its image run and full final regressions remain pending.

Production repair review: image6c05453e has exact matching engine IDf46201b8f779745e5fa927d780cd7976c85ae8031e63ae584e68ac93e81aeea5. All13 File Organizer cases pass, zero retries, source/destination/applied-state assertions intact. UI approves exact folder scopes with the human checkbox; parent inspected both screenshots. Three event-stream heartbeats arrive across45,007ms. Command and ownedcleanup exits are0. The complete backend suite is running; fullweb/static/browser and finalproduction/independent/engines/30minsoak lanes are queued on the shared lock. Source remains6c05453e; no final shipping success is claimed yet.

## Final regression follow-up — 2026-09-07

- [x] Preserve the full backend failure and diagnose both failing legs.
- [x] Preserve and rename credential-shaped browser summary metadata; keep mask assertions unchanged.
- [x] Preserve the absent journal response as plain text so lint can parse the evidence tree.
- [x] Repair the older File Organizer route fixture and independently repeat its checks, full Vitest and static checks.
- [x] Reproduce the SDK tarball timeout in the complete-run trigger, repair its owned package-install fixture, and pass the complete canonical backend run at `156fd9a4`.
- [x] Verify the production embedding function after discovering browser-target code in the final server bundle; repair and repeat if it fails.
- [x] Complete the final image suite, independent image checks, three browser engines and 30-minute resource check.

Plan review: the full backend run at6c05453e exits1 (mask metadata names and SDK120s hook timeout), despite passing residual and coverage thresholds. Full Vitest found two stale route-fixture failures; lint found an evidence extension mismatch. Browser lanes continue collecting their exact results. The queued image controller was cancelled before start only to move the SDK diagnostic and the bounded production embedding probe ahead of the long image run. Cancellation is not a test result. Product source remains6c05453e while the test fixture is repaired.

Embedding repair review: old image6c05453e fails the actual compiled public embedding function with `InferenceSession.create` undefined; its source function returns384 finite, normalized values in8504ms. The production adapter bundled the browser dependency because Transformers was absent from the web runtime manifest. Explicit web dependency4.2.0 preserves the native server import. The new required shipping check creates a real memory over HTTP, waits for the stored vector and ready health state, validates dimensions/normalization, and removes the owned record.

Source freeze is nowadbba8a693cdcd4410c51023dfca93517f9db1e8 (repairdc4d6b55 plus executable wrapper mode). Parent full Vitest passes7109 tests/544files, four type-check sections pass, lint/boundaries pass, frozen web lock install passes, and shipping suite wiring passes. SDK full leg passes1028 with1skip/0fail; its test now removes all owned cache directories and uses the pinned executable. The earlier120s full-lane timeout remains unreproduced, and the complete backend run must still pass. Canonical old-image HTTP red, new image build, full final lanes and resource duration remain pending.

Final imageadbba8a6 builds and transfers with matching rootfulDocker/nativePodman ID3800bd95cd2e106d1d3b9fb304cddce94db5872006f5a4b782d673e01a601b8f. Parent independently verified both fullrevisionlabels. The canonical old HTTP case fails at the expected missing-vector assertion and records the actual inference-session error (command1,cleanup0). The new HTTP case stores384 finite, normalized values in8242ms over33polls and asserts ready health (command0,log0,cleanup0). Full backend is nowrunning; fullweb/browser and eight-leaf production/independent/engines/30minresource chain are queued. Source staysadbba8a6.

- [x] Correct the audit allowlist's dependency-path description for the added web runtime dependency, without changing matches, dates or policy; repeat the audit with final metadata.

Final backend `adbba8a6` repeats the SDK tarball hook timeout at120002.80ms; coverage1, residual/new/patch0, LCOV not published. Two Terra agents are tracing the complete-lane environment against the passing isolated SDK run. Final web static checks found that a retained container-only probe `.ts` was included by host TypeScript; its bytes are now preserved as `.ts.txt`, with a focused typecheck follow-up required.

The full-environment isolated SDK replay passes all1029 tests with the Podman case enabled in9.07s; the flag difference alone does not cause the timeout. A concurrent canonical-leg replay is queued after the active image chain. Coverage config now excludes generated `.svelte-kit` copies, preserving real routes. Its preliminary concurrent diagnostic is explicitly non-final; full serialized coverage remains required. Audit dependency-path text now names the direct web Transformers dependency; matches, severity, expiry dates and policy are unchanged, with final audit pending.

All8 production-image leaves pass atadbba8a6, with owned cleanup0. Parent inspected all11 app logs and retained structured summaries; no current-candidate error-level records occur. The historical-main seed logs its existing GitHub Stats credential-manifest refusal, separate from the passing owned legacy seed/adoption. Independent container8 andChrome3 pass. Firefox3 pass; WebKit2pass/1fail due a cancelled control POST in the reload case. Terra is tracing the exact request before repair. Root imagechain exits1 before soak; it supplies no duration result. The SDK concurrent canonical Bun-run legs+security also pass; a monitored full host-pool reproduction is next.

Current integration review: parent source checks confirm exact historical upgrade and separate restore assertions, plus PR/release suite wiring. Parent opened all12 independent lifecycle screenshots; no visible clipping or readability defect was found. Complete monitored backend still fails at the SDK fixture package-install transport boundary; canonical Vitest coverage exits0 after generated-file exclusion. SDK now has a proposed offline dependency fixture; its tests are pending. Parent Chrome/Firefox, current-image revocation sensitivity and30-minute resource work are active. WebKit controlled red/green is queued; new diagnostic code is not accepted yet.

The first actual30-minute resource attempt exits1 after27 completed cycles; cycle28 exceeds the app FD warm baseline355. The preceding per-class, unique-relation-inode, and delta-accounting assertions pass. Terra is recording the failing descriptor identities before deciding whether the cause is a leak or expected database growth. The duration gate remains open. Parent current-image R3 controlled omission fails the intended disable-denial predicate, cleanup0, with byte-verified red receipts.


## Final test-driver repair — 2026-09-07

- [x] Reproduce the SDK package-install timeout in the complete coverage environment and repair its owned consumer fixture.
- [x] Verify all 1,029 SDK cases, including actual packed public imports with a closed loopback registry.
- [x] Reproduce the resource descriptor failure; account for live database relation files and reject duplicate, deleted, missing, mismatched, and escaped handles.
- [x] Commit the independent accepted test-driver fixes with normal hooks (`156fd9a4`).
- [x] Complete final canonical backend coverage: 25,975 passes, zero failures; all five command exits are zero.
- [x] Complete the real 1,800-second resource run after memory diagnosis.
- [x] Repair and verify strict WebKit reload diagnostics; all three engines pass 3/3 and the full typecheck passes. Parent reviewed all 12 final WebKit images and committed source `7f9a7035` with normal hooks.
- [x] Finish evidence review, final static checks, expanded secret scan, normal push, and every hosted technical check.

Plan review: the current candidate app image remains byte-identical to `adbba8a6`. The resource run used committed test-driver `156fd9a4` and failed the unchanged memory limit at cycle 36 after 190,920 ms. Backend coverage now passes at `156fd9a4`, including the repaired SDK fixture and new accounting controls. The next resource diagnostic will record memory from the exact app process and container. Browser tests remain under repair in a separate source file. A passing focused WebKit control did not prove the complete lane: its later failure belongs to a different request, so a proposed duplicate-event exception was rejected.

## Resource diagnosis and launcher repair — 2026-09-07

- [x] Preserve the failed private observation with explicit duration checks, unchanged 64 MiB limit, absent snapshot result, and exact source limits; complete diagnosis through the real HTTP reproduction. The canonical repaired-image run supplies the full duration.
- [x] Diagnose memory retention from the observed trend, private heap graph, and real HTTP reproduction; implement and independently verify the supported repair.
- [x] Reproduce and repair the production launcher's long private Unix socket path; verify authenticated readiness with a long persistent-state path.
- [x] Pass the final production resource duration check, then finish static, evidence, secret-scan, push, and hosted checks.

Plan review: the user authorized the Terra team and complete validation. The parent accepted the private observation driver only as diagnosis: it records all memory-limit breaches and must exit nonzero when any occur. The first short run was invalid duration evidence. Two later launches failed before app startup because their private socket paths exceeded the Linux limit. The next launch uses a short owned path and a frozen launcher while a separate Terra agent repairs the canonical launcher. No full-duration pass is claimed.

Review: committed `cbe76b84` with normal hooks. Parent independently passed four launcher cases (28 assertions), 13 resource fixture cases (458 assertions), and verified test selection: launcher integration runs in residual pass/fail; four shipping fixture files run in both pass/fail and coverage. The first parent selector wrapper exited 127 after its passing tests due an incorrect function name; the corrected selector-only follow-up passes. The 1,800-second observation accepted 100 cycles in 543,922 ms, then hit the unchanged 100-call conversation-turn guard. It recorded 59 memory-limit breaches and did not create a post-duration snapshot. The fixture now creates, wires, invokes once, deletes, and verifies absence of one owned conversation per cycle.

A separate pinned Bun HTTP reproduction isolates retained request contexts when the bounded body is rebuilt as an ArrayBuffer and read again. Under the actual adapter clone and async context, 500 requests retain 1,000 Request objects and 2,000 streams after collection. A one-chunk JavaScript stream removes the Request growth while preserving bounded input. The production payload repair and its regression are in progress.

Source freeze: `9ca275838faf30666da5dba1c0eba141dd053050` contains the request-body repair and permanent fault-sensitive HTTP regression. Parent normal10/10 and controlled-native fault1 pass the expected outcomes. The first full typecheck found a broad subprocess-pipe type in the new launcher test; it is fixed, its integration test passes again, and all four typecheck sections pass. Normal commit hooks pass. The new archived image build is active; canonical 30-minute R4 runs first, then the production, browser, full backend, and full web regressions repeat on this source.

Image review: the `9ca27583` archived build and transfer exit 0. Parent independently checked both engine JSONs for matching image ID `0f64f92d69ca2c38512f6a0f202c2027494166a250d82a7cd9621c10b42f63c0` and exact full revision. The unchanged canonical duration driver started at 07:59:25 UTC with hashes recorded before startup. Its terminal result remains pending.

## Body-format regression follow-up — 2026-09-07

- [x] Verify actual multipart form fields, uploaded file bytes and metadata, boundary/header preservation, and a body-bearing zero-byte POST through the repaired Bun HTTP admission path.
- [x] Integrate the test-only addition after the active resource run and pass focused proof (`d4ffe706`). The final complete web lane is queued.

Plan review: the repaired global hook serves both JSON and multipart routes. The existing repair proof covers JSON and context retention. Terra is drafting a real HTTP multipart check outside the frozen source tree while the resource run continues. No defect or passing multipart result is inferred from code review.

Parent terminal resource review: canonical image `9ca27583` passes 317 cycles and 3,170 reconnects in 1,800,154 ms. Driver, duration guard, launcher, app log and owned cleanup exits are 0. Parent verifies all sequential samples and all recorded pre-launch hashes. Max post-warm growth is 27,472,691 bytes against the unchanged 67,108,864-byte limit; no owned worker remains and runner descriptors stay at 24. The private failed observation is retained as diagnosis and does not require a replacement diagnostic snapshot now that the original canonical path passes. Multipart test integration and full final lanes follow.

Final test source is `d4ffe706c86049ee15515c79377234765ee86208`; only payload.test.ts differs from image source `9ca27583`. Parent 13/13 (27 assertions), Terra bounded-JSON 3/3, and parent full root typecheck follow-up pass. The original typecheck failure from executable evidence filenames and the separate Svelte check remain correctly labeled. Canonical production/independent/three-engine chain is active; complete backend then web/browser controllers are queued under the shared lock. Fresh main remains `537f074e`; remote feature head remains `86784b67`.

## R1 launcher-consumer regression — 2026-09-07

- [x] Repair R1 inspection to use the launcher's exported runner socket and token paths; cover the actual inspection consumer with the real long-state launcher integration.
- [x] Ensure inspection failure retains evidence and attempts to unpause the exact owned worker; preserve strict state checks and retain primary and cleanup failures.
- [x] Pass actual app-crash recovery and the complete production suite on the unchanged product image.
- [x] Complete the final backend and web regression lanes, evidence/secret checks, and authorized push with hosted CI review.

Plan review: current canonical source `d4ffe706` passes File Organizer and embeddings, but R1 exits 1 before app death because its inspection code reconstructs the former socket location. Owned app cleanup exits 0. The new launcher exports a short transport path separately from persistent state; only the R1 child still reconstructs it. The remaining canonical leaves continue without source changes. Backend and full web waiters were confirmed idle and cancelled before starting; neither provides a test result.

Review: final verifier-only commit `d2222840cf3d2b4963075ffc0f5cf0bdec5ef621` uses the exported transport, the existing wire validator, an abortable five-second request, and exact operation identity. Parent controlled old-path test fails with ENOENT; restored real-consumer test passes 1 case and 13 assertions, including the external state-root export. All four canonical typecheck sections pass. The first normal commit hook rejected a cleanup throw in `finally`; the repair now retains all failures and throws only after cleanup and evidence attempts. Final normal hooks pass without warnings. Product image/source remain `9ca27583`; the complete production and regression lanes follow on `d2222840`.

Parent production review at `d2222840`: all eight canonical leaves, the independent image verifier, and Chromium/Firefox/WebKit lifecycle cases pass. All eleven phase command, app-log, and cleanup exits are zero. Parent reads all app logs, opens all 36 lifecycle screenshots, and independently compares every PNG to both the raw attachment and curated copy. Parent terminal review corrects the earlier backend status: the original full run completed at 09:53 UTC with all five exits and overall exit 0. It reports 25,980 passes, zero failures, 1,558 shards, 179 residual passes, and passing threshold/new-file/patch gates. The agent had misread process state and nonterminal output; the terminal files establish the result. The extra rerun is cancelled as redundant. The first queued web controller was cancelled before lock acquisition and provides no test result; its replacement runs on the same frozen source.

Current full web controller at `d2222840` exits 0 with all 12 lane exits 0: all four type-check sections, Svelte (0 errors/13 warnings), 7,109 Vitest cases, 4,084 Bun web cases, lint/boundaries, manifest, 210 mock cases, 59 authenticated cases, and canonical visual 180 mock plus 10 authenticated cases. Parent parses every raw browser result: zero retries/errors, with 13 production-only mock skips separately covered by the passing image suite. The 294 PNG attachments are being checked against safe curated copies; eight selected full-auth images have been opened in addition to all 36 separate lifecycle-engine images. Fresh main stays 537f074e and remote feature head stays 86784b67; source is 0 commits behind each.

## Mock review-navigation evidence — 2026-09-07

- [x] Reproduce the four mock review tests accepting an error page after checking only its URL.
- [x] Repair their shared mock navigation boundary without weakening click, target, or destination assertions; retain real-auth destination coverage.
- [x] Independently review the patch and run the affected complete mock and visual cases.
- [x] Finish the final staged secret scan, normal push, and hosted checks.

Plan review: all initialized production and authenticated checks pass. Mock Playwright deliberately runs without database initialization, so server-side API loads have no authenticated principal and log 500 responses. Four visual tests also click into an authenticated author page and accept its URL despite an error page. This is a mock-evidence defect. Terra will reproduce and repair these four tests in an isolated worktree; the parent retains the successful d222 checkpoint and checks the final source. Production source and image remain unchanged.

## Evidence credential removal — 2026-09-07

- [x] Preserve exact raw browser artifacts privately, remove them from published evidence, and repair checksum membership and references.
- [x] Verify the test-token scope from source without publishing tokens or signing material.
- [x] Run the unchanged recursive archive secret scan against the final staged tree, then commit and push normally.

Plan review: the expanded staged scan fails on JWTs inside historical browser traces. Seven flagged raw archives already exist on the remote feature branch. Current-tree deletion cannot erase Git history. The parent will preserve private originals, publish safe identity metadata, and verify the fixture key lifecycle before stating the credential scope. No scanner exception or history rewrite is authorized.

## Real-auth fixture cleanup — 2026-09-07

- [x] Reproduce retained default database roots after an actual passing authenticated Playwright run.
- [x] Create and remove the default database and encryption-key root in the server wrapper, after the server exits; preserve caller-supplied data.
- [x] Prove success, failure, ownership rejection, and actual browser shutdown; integrate with normal hooks.
- [x] Repeat the final combined authenticated and mock browser checks.
- [x] Finish safe evidence checks and hosted results.

Plan review: default config loading creates more than one temporary database directory, and global teardown does not receive that path. Installed Playwright also runs global teardown before server shutdown. The repair assigns the default directory to the server process wrapper, which can remove it after child shutdown. External database paths remain caller-owned. The product image is unchanged.

Review at `b5d2d691`: parent integrated the shared review fixture and all four complete specs into blocking mock CI. The focused report has 10 passes and nine PNG attachments; parent independently matches every attachment byte and opens all five unique images. Shared callers pass 2 plus 1. The new full mock gate passes 220 cases. The cleanup reproduction passes a browser case while leaving two default roots; its repaired replay passes and leaves zero. Parent reproduces all 11 sanitized outputs and verifies four committed source blobs. The first final combined typecheck finds TS2339 only in the new test environment map; a type-only follow-up is ready in isolation. The controller continues on frozen `b5d2d691` and is not reported as an overall pass.


Final local review at `825dc780`: b5 finishes with thirteen successful lanes and its original typecheck exit 1 retained. The one-line type annotation correction passes all four typecheck sections, all four cleanup cases, and all three lifecycle cases in Firefox and WebKit. The complete b5 browser results are 220 mock, 59 authenticated, and 181 plus 10 visual passes. Parent verifies all 308 attachment bytes, fourteen logs and ten source inputs; the engine follow-up adds 24 byte-verified PNGs, of which ten selected images were opened. All default fixture roots and runner auth-state files created by these runs are removed. Fresh main remains `537f074e`, remote feature remains `86784b67`; current source is zero commits behind both. Final staged scan, documentation commit, normal push, and new-head hosted checks remain open.


Evidence review: parent independently compares every logical member of the two sanitized historical coverage archives and permits only one incidental extension UUID field replacement per archive. All other test and coverage bytes remain unchanged. The complete recursive staged scan then exits 0 with zero findings and cleanup 0. The sixteen archive controls pass; original raw browser archives remain privately preserved with historical publication disclosed. The final index scan, normal commit/push hooks, and new-head hosted checks follow this recorded snapshot.


## Hosted follow-up at 0728184b — 2026-09-07

- [x] Commit the exact scanned index and push normally; all commit/push hooks pass.
- [x] Compare hosted Gate integrity findings with the local source checkpoint: the same 84 ordered findings remain.
- [x] Reproduce and repair browser setup when only Firefox or WebKit is installed; verify both full lifecycle suites without Chromium.
- [x] Reproduce and repair the Stage 2 proof container launch with the hosted conmon configuration; retain every network and kernel audit assertion.
- [x] Independently verify both repairs and all affected authenticated/visual consumers.
- [x] Scan the final changes, push normally, and check every repaired-head hosted technical job.

Plan review: hosted Firefox and WebKit stop in global setup because it launches Chromium, which the selected-engine jobs do not install. The Stage 2 job builds and loads its candidate and passes kernel journal access, then fails container creation because its conmon cannot use the default journald log driver. Neither failure reaches the claimed browser or namespace assertions. Terra owns separate worktrees for these two fixes; the parent verifies exact results and monitors all other jobs.


Parent review at `0aa3567e`: the exact integrated controller exits 0. TCP and IPv6 positive/fault controls pass independently, all four type-check sections pass, all 59 authenticated cases and 10 authenticated visual cases pass with zero retries or reporter errors. Default fixture-root and saved-auth cleanup pass after each browser run and at controller exit. Parent verifies all eleven frozen inputs against committed source and opens eight selected visual images. No visibly clipped or unreadable control appears in those images. Safe evidence and final publication checks follow; earlier pending entries describe their recorded historical checkpoints.


## Hosted embedding cache permissions — 2026-09-07

- [x] Retain the final 8a47c37e CI result: every browser/static/backend check passes; production passes seven of eight leaves and fails the real persisted-embedding assertion.
- [x] Identify the actual app error: EACCES creating the Transformers cache under packaged node_modules while running as UID 1001.
- [x] Reproduce with the hosted runtime identity against the equivalent production image; independently confirm EACCES, the unchanged three-minute assertion, command exit 1 and successful owned cleanup.
- [x] Repair the writable cache location and add meaningful regressions.
- [x] Independently check source, focused tests, built-server persisted vectors, app logs and owned cleanup; run affected complete checks.
- [x] Build and validate the repaired candidate, scan final evidence, push normally and check the resulting hosted jobs.

Plan review: the three-minute assertion is valid. Dockerfile owns application files as the bun image user, but supported runtime execution can use the host UID for runner-socket access. A package-relative model cache therefore depends on installation-directory ownership. Terra owns the embedding repair and reproduction in isolation, with a separate read-only review of the pinned library options and existing cache-path contracts. Parent verifies the other seven hosted leaves and checks the final fix. No timeout relaxation or broad image permission change is planned.

Parent review: the shared path helper removes a duplicated database default. Review adds relative-path, absent-HOME and external-Postgres boundaries, plus an explicit 100% coverage threshold for the new helper. The built-server proof must run as UID/GID 1001:1001 and retain cache bytes across a second server start. Controller review found and rejected a mode-sensitive comparison and a non-gating file-writability check before execution.


## Merge latest main — 2026-09-07

- [x] Fetch origin/main and the feature branch; main advanced from 537f074e to bd736438 (#248).
- [x] Start the merge and preserve existing cache commits, private evidence and uncommitted report/task updates.
- [x] Resolve all 39 conflicts by preserving v4 contracts and compatible main fixes; independently review automatic merges.
- [x] Regenerate the manifest lock, run focused checks and typechecks, then complete the merge normally.
- [x] Freeze merged source and repeat complete backend, browser and production-image validation; finish the UID 1001 cache proof.
- [x] Scan reviewed evidence, push normally and verify hosted results at the merged head.

Plan review: main's new commit changes 143 files across legacy extension types, memory queries, SDK scaffolds, browser fixtures and product UI. The pre-merge image build and complete backend run have not started. Four Terra owners resolve disjoint files in the shared merge checkout; the parent owns the merge index, lockfile, remaining conflicts and final validation. Existing passing receipts remain tied to their old source identities.

Premerge review at index `048cfb25`: 36 focused files report 654 passes and one setup-cleanup failure. SDK build, lint/boundaries and regenerated source lock pass. All four typecheck sections expose a shared host-manifest type that lost version 4. The parent rejects this checkpoint, requests explicit host-v4 parity coverage, and requires setup cleanup to run even when terminal persistence fails. No merge commit or production build is claimed yet.

Merge review: commit `aa248563` has parents `86017768` and latest main `bd736438`. Its tree exactly matches the passing second premerge index `aa18ac61`: 657 tests in 36 isolated files, all four typecheck sections, SDK build, lint/boundaries and source lock pass. Normal commit hooks pass with no source changes. Parent compares all existing lane memberships (none lost) and all 27 top-level host grant fields (none lost), then adds explicit compiled host-v4 parity assertions. Complete merged-source checks and the new production image remain pending.

Full merged backend review: `aa248563` reports 26,028 passes and one failure across 1,563 shards. The isolated rerun also fails: the memory list omits a row owned through its conversation. Coverage thresholds, the 179-test residual set, new-file coverage and patch coverage pass, but the complete controller exits 1. Terra will restore the shared ownership predicate in the generic memory queries and verify direct-owner precedence, derived ownership, orphan denial and the admin view before the full rerun. This is a failed checkpoint, not a complete backend pass.

The parent passes the initial query repair and all four typecheck sections. A separate Terra review finds that single-memory GET, PUT, PATCH and DELETE still reject a valid conversation-derived owner. The same owner must be able to use a listed memory. The next repair will apply the shared query predicate to item authorization and prove actual persisted changes and denied effects through real routes and PGlite before source freeze.

Follow-up `da6bc4db` restores one ownership rule for list, search and item access. The parent verifies 45 backend cases (8 real PGlite integration cases and 37 H3 cases), 17 PATCH route cases and all four typecheck sections. Denied item requests preserve exact stored rows. Three authenticated browser cases pass with actual memory edit, exclusion, deletion and member denial; a first locator failure is retained. Parent screenshot review also finds and fixes pale memory badges in light mode, then opens the corrected light and dark images. A type-only `baseURL` annotation follows that focused browser run. The final ten-file static check passes types, lint/boundaries, manifest lock and whitespace; normal commit hooks pass. Complete backend validation now runs on the frozen committed source.

Backend review at `da6bc4db`: parent verifies all 19 frozen inputs, 1,412 retained LCOV records, 26,034 coverage passes with no failures, 1,260 thresholds, 134 new-file checks and 394 patch-file checks. The separate residual run has 178 passes and one 20-second launcher timeout. Isolated, full residual and six concurrent replays all pass. The cause is not established. Commit `480f7c71` adds launcher failure logs without changing the timeout or launch behavior; the focused test (13 assertions), all 179 residual cases, all four typecheck sections and file lint pass. Full web/browser validation now follows on frozen `480f7c71`.

## Final browser review and launcher cancellation — 2026-09-07

- [x] Verify the full merged web/browser checkpoint and inspect its actual attachments and cleanup.
- [x] Correct the observed light-theme extension header badge contrast; verify all three badge states in both themes through the existing browser fixture.
- [x] Reproduce cancellation after an observed live verifier boundary; if it leaves owned children, repair launcher cleanup and prove actual process exit.
- [x] Integrate reviewed changes, run affected browser/residual/static checks, then build the final image and complete production validation.

Plan review: the complete web run stays frozen at `480f7c71`. The parent opened the actual deep-link screenshot and found pale Verified text. Separate source review found that launcher cancellation does not explicitly stop its verifier process. Two Terra agents prepare bounded changes in isolated worktrees; cancellation is not identified as the cause of the earlier 20-second timeout. No deadline or coverage assertion is relaxed.

Browser cleanup review at `480f7c71`: all 62 authenticated Chromium cases, 251 blocking mock cases, three fresh-setup cases and the visual selections pass without retries. Firefox passes all three lifecycle cases but leaves one new fixture-owned database root. Parent source comparison finds that the merge dropped the prior explicit `gracefulShutdown` setting, so Playwright kills the direct fixture wrapper before its EXIT cleanup. The full controller remains failed. Restore graceful termination and repeat the direct Firefox/WebKit paths, retaining the original failure and checking exact owned-path absence.

Parent engine review at `d92a9463`: both direct lifecycle suites pass three cases with zero retries and zero reporter errors. All six controller rows and final source guard exit 0. Parent verifies seven committed inputs, both raw blobs and all 24 PNG attachment bytes, and opens four mobile/uninstall images. Each engine leaves no new default root, sidecar or saved auth file. The two known failed-run roots were separately recorded and removed after no-live-user checks.

Parent final source review: launcher cancellation now stops its owned verifier group before runner and compose cleanup. The live cancellation and pre-ready cancellation controls pass, including a TERM-ignoring descendant, drained streams, and preserved verifier/tee failure exits. All 182 residual cases pass. The original 20-second timeout remains unexplained. Parent matches both final source hashes before integration. The extension header and warning repair passes 16 desktop/mobile cases; all four desktop theme images were opened. Combined static validation and a fresh production image follow.

Final source freeze: `79108f9d` contains both reviewed UI files and both launcher files unchanged from their green receipts. The parent combined controller passes all eight rows, including all four typecheck sections. Normal commit hooks pass. Main remains `bd736438`, and the final ordered gate-integrity findings remain exactly 83. The new image build and UID 1001 cache proof now start against this committed source.


## Final image app-log failure — 2026-09-07

- [x] Build 79108f9d once and verify matching Docker/Podman image ID 4da2058f, UID 1001 stored vectors, read-only cache reuse and owned cleanup.
- [x] Independently inspect actual app logs and reject the checkpoint's remaining package-cache EACCES warning.
- [x] Attribute the unoptioned metadata request, repair its durable cache path, and verify the real library behavior.
- [x] Add a permanent embedding app-log guard that fails on the retained error and preserves runtime failures.
- [x] Integrate reviewed repairs, validate affected code, rebuild, then finish production, resource and hosted checks.

Plan review: the 79108f9d cache controller exits 0 and both stored-vector assertions pass (7,371 ms cold; 284 ms on the read-only cache). Each actual compose log still has one cache EACCES warning. The `app_log_exit` field proves log collection, not clean logs. Transformers' warning says “browser cache” for all cache backends; this image has browser caching disabled. The likely source is the library's preflight metadata request, which omits the per-call cache option. Two Terra agents independently check the library path and repair it; a third owns a permanent log guard. Historical image transfer passes independently and all images are retained. No full production run has started on the rejected image.

Final repair review: `49e0a0be` integrates the metadata-cache and log-guard repair; `2c542bac` removes unnecessary shell fixture fallbacks without changing product behavior. Parent resolves the new test timer type and preserves primary/cleanup errors. Final state tests pass 14/35 expectations, embedding tests 14/806, token-cap tests 6/12, and log-guard tests 5/22. Helper coverage is exactly 33/33 lines and 8/8 functions. All four types, lint, boundaries, manifest and shell checks pass. Normal hooks pass. Parent verifies all seven committed source copies and rejects both real retained EACCES logs with the new guard. The new v4 image/cache controller adds a separate app_health_exit, and now builds the frozen 2c542bac source.

Rebuilt image review: cache controller v4 passes on `2c542bac`, Docker/native Podman ID `c0941c22a713f343eee54e846c01fe630fe6ac7f8831b58afc3fd4155508fa95`. Parent verifies all 19 frozen inputs, both stored 384-value vectors, four unchanged cache files, eight read-only ownership rows and exact zero exit fields. Both actual app logs have zero error/fatal/EACCES matches; the first retains one expected model-init warning. All created state is absent. The canonical production wrapper starts at 18:14:50 UTC in the receipt whose historical name ends 1750Z; its actual provenance timestamp is authoritative.

Parent in-progress production review: File Organizer passes all 13 ordered Chromium cases and all four launcher exit fields. Parent verifies eight raw file identities, three safe raw copies and three committed inputs. The immutable receipt has no screenshot or reporter archive, so no retry count or PNG result is claimed. Embeddings and R1 app-death recovery also exit 0; the same interrupted build reaches verified after its six-minute lease. Other production leaves and the independent/30-minute checks continue.

## Local resource-observer identity — 2026-09-07

- [x] Preserve the first final production result: seven leaves pass; resource inspection fails before cycle zero; every owned cleanup passes; independent and soak are not run.
- [x] Prove the local reader/app group mismatch against the same live owned container; keep strict descriptor checks.
- [x] Create separate private controller versions using the verifier primary group, as CI does; keep source and image unchanged.
- [x] Pass the focused 10-cycle resource path, then repeat the full canonical/independent/30-minute chain.
- [x] Complete reviewed evidence, exact-index expanded scan, normal push and final-head hosted checks.

Plan review: parent actual readlink receives EACCES at UID1001/GID100 and reads the same descriptor at UID1001/GID1001. The old private controller hard-coded app GID1001. CI and the standard runtime wrapper select id -g. New private v2 controllers use local GID100 and record it. No product change, permissive descriptor catch, or deadline increase is needed. The separate two-start cache proof remains scoped to UID/GID1001:1001.

Focused resource repair review: all 10 cycles and 100 reconnects pass in 65,213 ms, with all four launcher fields 0. Parent verifies eleven exact raw copies, seven committed source inputs, all eleven full sample-to-summary mappings, worker and SSE cleanup, and memory growth 14,365,491 bytes below the unchanged 64 MiB bound. The complete v2 wrapper starts at 18:40:24 UTC in final-production-v2-2c542bac-20260907T184024Z; it records observer/app UID 1001 and primary GID 100. Source remains 2c542bac and image c0941c22.

Canonical v2 parent review: all eight leaves pass by 19:03:05 UTC. Parent verifies all eleven launcher quartets, exact-once embedding runtime/log-guard zero fields, 39 frozen committed inputs, 13 ordered File Organizer outcomes, nine current-image app logs without error/fatal records, and 3,672 relation descriptor rows across all eleven short resource samples. The short canonical result is 10 cycles/100 reconnects in 65,599 ms with 10,066,329 bytes of maximum post-warm growth. Independent image verification then passes all eight checks and its no-new-residue comparison. The full 1800-second duration stage is active on the same source/image.


Final local production review at `2c542bac`: the v2 outer chain completes at 19:33:39 UTC with all three command exits zero and all three owned-boundary comparisons equal. The complete 30-minute resource file contains 273 samples from 272 cycles and 2,720 reconnects. Parent checks all 100,350 relation descriptor rows, fixed runner FD count 24, zero retained workers/connections and maximum post-warm growth 52,848,230 bytes below 67,108,864. The full-file elapsed time is 1,803,347 ms. The console header says 1,803,391 ms but its line stops at 65,536 JSON bytes plus LF. Parent retains that incomplete copy, compares its exact prefix, and relies on the independently validated complete sample file. Eight reviewer controls pass; corruptions beyond the printed prefix are rejected. Replays do not establish a truncation cause. All 299 app-log lines are reviewed; one expected initialization warning remains, with no error/fatal record.

## Final publication and hosted verification — 2026-09-07

- [x] Verify the completed canonical, independent and 30-minute chain against the exact frozen source and image.
- [x] Recheck remote refs; main is still bd736438 and the remote feature is still 8a47c37e.
- [x] Finish evidence membership, checksum, local-link and mode review.
- [x] Scan the exact staged snapshot and all expanded archives with the pinned scanner; record every exit.
- [x] Commit the scanned index and push normally, with all hooks enabled.
- [x] Verify every hosted technical job against the published 8ae7f086 head and retain safe results; its discovered auth log defect is handled below.

Plan review: local product checks are complete. The next change publishes reviewed records and the existing source commits. The remote branch will receive a normal fast-forward push. The 83 migration-policy findings remain a maintainer decision; no policy exception or shipping approval is applied.


Publication preflight review: all 28 new evidence folders have complete local checksum membership. The parent preserves two absolute historical hash receipts as inert text and normalizes inert file modes without changing their bytes. The private scanner is repaired to recognize neutral archive names from bounded headers. All 16 existing and six new classification controls pass; an actual pinned scan detects its synthetic positive only in the expanded member and accepts the clean control. The complete staged snapshot then passes with zero findings, scanner/controller/cleanup exits 0 and 7,445,289,360 expanded bytes across 15,943 payload members. The source and authored records have no whitespace errors; exact retained tool logs preserve 613 whitespace findings across 28 receipt files. Final receipt publication is followed by an exact updated-index scan, a normal commit and a normal push. Hosted results remain open.


## Hosted closeout at 2bdf4708 — 2026-09-07

- [x] Scan the exact updated index, commit it unchanged, pass normal hooks and push normally.
- [x] Verify remote head 2bdf4708594db3e27e25269e7c4fbb7cf0dc87f7 and a clean worktree after publication.
- [x] Compare all 83 hosted migration-policy findings with the exact local ordered list; no difference or policy label change.
- [x] Reproduce the authenticated-browser prerequisite failure: CI invokes a deleted legacy sandbox probe after current v4 runner setup passes.
- [x] Integrate and independently verify removal of both stale invocations, keep the real kernel-control check, and guard CI/local file references against recurrence.
- [x] Repair the observed test readiness/cleanup defects, retain first-failure output, and verify all three affected files pass on their first hosted coverage run; keep the original missing assertions explicit.
- [x] Finish current hosted production and visual results, scan/commit/push reviewed repairs, then verify all technical jobs on 8ae7f086.

Plan review: normal publication succeeds with all four typecheck sections and Svelte errors zero. Hosted real-auth fails before tests because `_sandbox-spawn-probe.bun.ts` was deliberately deleted as obsolete but remained referenced in CI and ci-local. Independent review confirms that current mandatory `PodmanRunner.initialize()` executes the supported isolation checks. Parent repeats that real native runner probe successfully with no new roots. Terra prepares a five-file workflow/local/test/documentation repair in isolation. Hosted backend and coverage jobs succeed, but three raw first passes need the existing retry sweep: chat-tools-integration, db-live-holder-guard and auto-note legacy-subprocess. Two Terra owners now inspect the actual failures and reproduce their process/API boundaries before any fixes. No timeout, coverage threshold or failure tolerance is weakened. Hosted production and visual work continues on the published head.


Hosted repair review: `153e74d8` removes the stale CI/local probe invocations and adds the real module-reference regression. Parent observes its original failure and repaired 12-case pass, repeats the supported kernel probe, and verifies all five committed inputs. `a28bba35` then makes the three affected tests wait for child identity, event delivery, persisted data and actual child closure. The coverage wrapper now prints its first failure before recovery or retry. Parent reproduces both the missing-output failure and premature child close against the former behavior. The repaired wrapper passes 41 cases, the holder suites pass 14 and 11, and chat/Auto Note pass 3 and 14 with coverage in separate processes. The first combined type check finds TS2352 in the new chat test; a narrow typed API result fixes it. All four types, lint, boundaries, Svelte, manifest, shell and source guards pass on the final five-file commit. Its normal hook passes. All 83 main-relative policy findings remain exactly unchanged. The original three hosted assertions were discarded by the former wrapper, so their exact causes remain unknown. The next hosted run must verify the repaired source.

Hosted production finishes at 20:45:50 UTC with all eight proof exits and all eleven launcher quartets zero. Parent checks all 85 private artifact identities, the embedding runtime/log guard, nine current app logs, and all 11 short resource samples with 3,675 descriptor rows. The GitHub merge checkout 00e2b3ea has parents bd736438 and 2bdf4708, and its tree equals the published head exactly. Current workflow failures remain the repaired real-auth prerequisite and unchanged policy review. The follow-up publication now receives its exact-index scan and normal push.

Normal follow-up publication at `8ae7f086` passes the exact-index expanded scan and all hooks, and its remote ref matches. Hosted run 34161268825 passes all twelve coverage shards on the first attempt without a retry sweep or pooled failure. Critical 659, residual 182 and extras 1,435 cases pass; coverage gates verify 1,260 threshold files, 134 new files and 394 patch files. Postgres passes 24 cases. Parent independently checks raw logs and all four hosted static jobs. The policy failure still matches the exact 83 reviewed findings. Browser and production jobs continue.


## Extension authentication response boundary — 2026-09-07

- [x] Reproduce the current served mock-preview GET /api/extensions denial and attribute every actual browser error record.
- [x] Return the intended 401 through one shared authentication response adapter; preserve thrown helper behavior, role checks, API-key scopes and non-Response errors.
- [x] Replace the web test helper that hides thrown responses with actual returned-response assertions; prove denied requests do not reach extension data or writes.
- [x] Verify the compiled browser path and affected complete checks, then publish and validate the repaired production candidate.

Plan review: the 8ae7f086 hosted backend and browser jobs pass, but the mock browser log retains 105 structured hooks.server 500 records. Prior exact-source browser diagnostics link an unauthenticated server-side layout fetch to /api/extensions. Current middleware documentation explicitly identifies SvelteKit converting a thrown Response to500; the extension API still calls that throwing helper. The read-scoped API-key contract must remain valid. Two Terra agents separately reproduce the current served path and prepare a shared returning guard plus strict route regression. Fresh worktree dependency preparation failures are retained separately and do not count as an E2E reproduction. Root integration waits for the baseline browser failure. No mock user is invented and no error log is suppressed.


Auth response review: the fresh 8ae7f086 browser case renders successfully but records the real GET /api/extensions status500. Both stricter old-route denial tests then fail. The repaired full mock selection passes 255 cases with 13 intentional production-only skips and no structured server errors; the visual mock selection passes 191 with no500 and one deliberate missing-page404. An incorrectly selected 2,108-case diagnostic was stopped and its owned processes removed; it is not lane evidence. The temporary hook is restored exactly before the final browser proof. Parent integrates the six frozen files, independently repeats the old-route failure and repaired 48 auth, 15 route, 45 API and one real browser cases. All four types, lint, boundaries, Svelte, manifest and source guards pass. Normal publication and repaired-head hosted checks follow.


Historical task review: the parent checks the remaining earlier umbrella items against their recorded source checkpoints and the complete 8ae7f086 technical CI results. Those items are now marked complete for their historical scope. The current auth-source hosted check remains open: 0733ca51 passes backend/coverage/static/mock/Firefox/WebKit checks, but Chromium crashes during context creation before the fresh-setup case 3 body. The unchanged local canonical three-case replay passes with owned cleanup. This does not establish the native crash cause. The original hosted failure and source-matched local receipt remain evidence; a targeted hosted rerun is pending until GitHub permits it. Production is still active.


Production at 0733ca51 completes successfully at 22:37:38 UTC. Parent independently checks 81 raw artifact identities and complete membership, 8 proof outcomes, 11 cleanup quartets, 9 current app logs, the embedding guard, and all 11 resource samples with 3,675 descriptor rows. Synthetic merge f4bc16e4 has the exact 0733ca51 tree. GitHub then accepts the targeted unchanged-source real-auth job rerun; its fresh-setup prerequisite passes and the authenticated suite runs. The original native crash remains unexplained.


## Repeated native Chromium context crash — 2026-09-07

- [x] Preserve both hosted failures and compare the native crash signature and trace phase.
- [x] Compare the exact failing browser binary and launch options with the passing mock/visual lanes; check why each setting exists.
- [x] Run bounded repeated-context diagnostics on local and hosted Linux; retain both original failures and passing controls without claiming a reproduced native cause.
- [x] Validate the supported Playwright dependency update, preserving browser assertions, coverage, deadlines and retry policy; retain that neither diagnostic pair reproduces the native crash.
- [x] Verify the updated full authenticated/browser lanes, source checks and normal publication at d5. Track the subsequent grep/event repairs in final-source validation below.

Plan review: targeted hosted attempt 2 passes fresh setup 3/3 and 61 authenticated cases, but Chromium again exits with SEGV_MAPERR 0x1b0 while creating the context for auth-fixture.spec.ts:26, before that test body. The failure matches the first attempt's native signature. The source has not changed. Three Terra tasks now compare actual launch settings, run a bounded context-creation reproduction and inspect the exact binary for symbols. A different failing test location is not evidence of a different cause. No further blind hosted rerun or permanent browser setting change is made.


Native-crash diagnosis review: both hosted attempts use full Chromium revision 1234 with the same 45 launch flags after normalizing only the temporary profile path. The historical switch from headless shell was a mitigation and does not prevent this failure. Exact binary disassembly places both faults at chrome+0x46c991d: a read at 0x108 from register value 0xa8 reaches address 0x1b0. Function identity is still unproved. Attempt 2 crashes about 15 ms after the ninth test (provider checklist) completes its page context; the tenth API-only test then passes and test 11 detects the closed browser. The final 61-pass count includes later tests. One hundred fresh browser/context cycles pass locally, but each cycle starts a new browser and therefore does not cover this teardown sequence. The next controlled run reuses a browser across real pages. Parent independently verifies the repeated-failure artifact bytes, trace phase, and five curated screenshot copies; its visual inspection covers only the three actually opened images. Main remains bd736438 and the remote feature remains 0733ca51.


Hosted diagnostic plan: the final local control passes 40 hydrated localhost setup contexts, alternating browser constraints and real client-invalid form submissions, under Node22 with CPU affinity to cores0–3. This is affinity, not a CPU quota or a matching hosted OS. Actual final input bytes are retained separately. A branch-only diagnostic now prepares the same locked browser on GitHub ubuntu-latest with one reused browser, 20 contexts, executable/host identity, retained first failure, and no shipping-gate change. Its initial pipeline recorder fails a parent negative control because separate PIPESTATUS reads erase the second status; the corrected wrapper must snapshot the entire array and pass all four producer/collector controls. A separate isolated worktree prepares the supported Playwright1.63.0 candidate; no release note establishes a fix for this crash, so this remains a paired experiment. No candidate package change is in the feature branch yet.


User speed correction: stop low-yield native-symbol investigation and repeated broad checks. Finish the active local diagnostic once, compare the locked and supported updated Playwright pair on hosted runners, then run only affected browser checks. Reuse independently verified production/backend evidence for unchanged product source. Keep first failures and material limits, but stop expanding evidence curation.


## Final source validation and delivery — 2026-09-08

- [x] Run the remaining failed policy check locally and compare its findings with the hosted result; reuse the completed 53-case local repair proof.
- [x] Run paired hosted Playwright checks; preserve both successful controls and the lack of a causal crash fix.
- [x] Pin Playwright 1.63.0, verify exact installed packages, and publish source d5e70867 through the expanded scan and normal hooks.
- [x] Complete ordinary CI 34173371290 at bb80bd21 and independently review browser, backend, and production results.
- [x] Finish the current-source report, check safe evidence, and publish the documentation through normal hooks.

Plan review: run independent Terra reviews in parallel. Browser, backend/static, production, and report reviews have separate owners. Heavy browser and production tests run on GitHub. Local builds, scans, and test processes use one shared heavy-job lock. Do not rerun unchanged whole suites or restart native-symbol analysis. The old and new browser pairs each pass one loop test, three setup cases, and 62 authenticated cases; neither reproduces the failure. The dependency update is a validated candidate, not a demonstrated causal fix. The new ordinary CI run is required before closing validation.


Two first-pass failures at d5 remain open despite passing retries: task-event <200ms receives220ms, and real grep output loses its truncation marker at a4KB read boundary. Plan: independently fix the event test with a causal assertion and reproduce/fix bounded real grep output. Preserve existing deadlines, output limit and coverage selection. No broad suite starts before the affected regressions pass.


Follow-up review: parent integrates and checks the actual task-event mutant failure and exact-source green. The search failure is reproduced with a real GNU grep child and controlled stdout chunks; the child and exit stay real. The repaired reader passes overflow, exact EOF and UTF-8 boundary cases. Parent runs all17 grep,35 argument and1 event cases with coverage. The merged search record is189/189 measured lines. A test type error is fixed with a real stream type guard; repeated cap cleanup moves to existing afterEach. All four typecheck sections and lint now pass. The initial private coverage merge found no input through a hidden-path glob; explicit owned temporary input copies merge successfully with no source or coverage-rule change. Normal source publication follows.

Normal source push `bb80bd21` completes with all hooks and expanded scan at zero. The remote head and scanned tree match. GitHub cancels superseded d5 production; its successful browser results retain their source scope. New CI34173371290 now runs on the three-file repair.

Local-first review: the remaining Gate integrity failure reproduces in 4.26 seconds at bb80bd21. All 83 ordered findings exactly match the hosted log. No approval flag is set. The 53 affected regression cases already pass locally with coverage, and all current hosted coverage shards pass on their first attempt. Further failure diagnosis starts with a matching local check before a source push.

Final source review: all 34 technical CI jobs at bb80bd21 pass, as do Postgres and dependency audit. Parent and Terra independently verify the actual eight production proofs, eleven cleanup records, nine current application logs, source/tree/image identity, and the complete short resource series. Gate integrity alone fails with the unchanged 83 unapproved findings. Final documentation publication is complete only when its exact-index scan, normal hooks, source-equivalence check and remote verification all succeed; the task must stay active until those terminal receipts exist. No new source-equivalent full-suite wait is required for the report-only commit.


## Watch PR 246 and leave draft when ready — 2026-09-08

- [x] Watch every CI job on 93742772 to completion; retain actual results without another evidence-only push.
- [x] Review current failures and use local reproduction for new technical failures; none occurred in this run.
- [ ] Require a passing Gate integrity result and all other CI before changing draft state; verify the current head again at that step.
- [ ] Mark PR 246 ready for review when those conditions hold, and verify GitHub records the change.

Plan review: the user authorizes the draft-state change once ready. Continue current hosted jobs with a lightweight poller. The failed policy check has already been reproduced locally; its protected migration dispositions need maintainer review. The existing code and test sources are unchanged from the fully passing technical run at bb80bd21. Human review approval is required to merge, not to request review. No merge or automatic policy approval is authorized.

Watch review: CI34176057760 finishes on 93742772 with all 34 technical jobs successful. External Postgres and dependency audit also pass. Parent verifies all twelve raw coverage first-pass summaries with no retry or failed case; corrected private hash metadata now matches all twelve raw logs. Gate integrity alone fails with the exact same 83 ordered findings already reproduced locally. The PR stays draft because the user requires all CI to pass first. A maintainer approval question remains unanswered, and no approval label, draft-state change or merge is applied. The watch is complete; the requested draft transition remains blocked on that external decision. This local status note is not pushed, so it does not restart CI.


## Repair Gate integrity without an override — 2026-09-08

- [x] Reproduce all 83 current findings locally and map each to a concrete repair.
- [x] Restore protected test coverage and discovery at the affected paths, keeping shared fixtures and current v4 security behavior.
- [x] Restore the missing coverage obligation with live, fully tested source ownership.
- [ ] Verify every affected test locally, all static checks, unchanged gate rejection controls, and a zero-finding gate run.
- [ ] Integrate independently reviewed Terra changes, push normally, watch CI, and mark PR 246 ready when all CI passes.

Plan review: the user explicitly asks to fix the failure. Investigate real test/coverage repairs before treating findings as an approval-only outcome. Keep the gate implementation, thresholds and discovery protections intact. Do not add approval flags, empty compatibility tests, duplicate test bodies or unrelated retired product behavior. Four isolated Terra analyses cover disjoint categories while the parent checks the overall repair design and local gate reproduction. Heavy test/build work remains serial under the shared lock.

Repair review in progress: root rejects literal refusal/constant-return and per-capability preference padding in three proposed batches. Restored28 moved test paths pass explicit local preview; original source snapshot locks remain unchanged for that slice. Root restores grant normalization as a shared live module at the protected coverage path (6/6 measured lines,20 tests), with independent Terra production review finding no weakened approval condition. Root moves32of36 actual durable lifecycle test bodies into12protectedpaths, preserves all36 original cases and adds4 distinct rejection/grant-validation/disable cases; all13individual Bun processes pass. Root rebuilds author import, permission and drift tests preserving meaningful current route cases; browser batches77and29 pass. Remaining integration includes8installerpaths,20backendpaths (4stillbeingfilled), finalownwebcases,types/lint/fullgate,andallCI. No approvaloverride,commit,push,orPRstatechange yet.

Integration review: all82protected test paths clear the unchanged working-tree checks. Restored host tests remain in normal pass/fail and coverage discovery. The three SDK-only example suites remain portable; author portable assertions move into its canonical extension.test.ts. Four source snapshot digests change for those portable test updates. Parent preserves the original private-source HTTP secrecy tests after detecting an accidental omission in a team patch. The exact full gate still requires a normal local commit.

Repair validation: normal commits7edeed20f and71ebd0301 both pass the full unchanged Gate integrity CLI without an override. The complete move inventory preserves100original PR-new test blocks; missed project binding/control branches and the original SDK development refusal are restored. All1565host coverage producers pass first attempt; Vitest4714/290 and all package/security legs pass. A measured4-case SDK-dev supplement closes the sole missing record; final coverage gates pass1265thresholds/134new/398patch files. The first plain backend run exposes four failures: stale coverage paths, private review files outside the existing mask, a missing local Postgres image, and an actual empty-cmdline race. Focused checks pass after list/environment repairs and the conservative guard fix; the new guard test fails on old source and all15pass on repaired source. Four changed portable candidates pass real container builds. Plain web/build/publication/current-head CI remain in progress.

## Extension enable HTTP 500 — 2026-09-08

- [x] Reproduce City Conditions enable/review failure against the local app.
- [x] Identify and prove the cause of the missing immutable source file.
- [x] Add a failing regression and fix storage/recovery without changing approval rules.
- [x] Verify the original browser journey, affected tests, types, and deployment persistence.
- [ ] Publish tested repair and verify the local app on the repaired main.

Plan review: reproduce locally first; preserve database and existing extension data. Use one browser/heavy test process at a time.

Review in progress: restored28 checksum-matching current source blobs, persisted them in ezharness_extension-releases, and verified all29 source/artifact blobs after building City Conditions. A fresh dev image exposed missing compiled package exports; Dockerfile.dev now force-builds trusted SDK/contract and harness-client exports. Recreated app with persistent releases and the isolated runner socket/secret; ready200 and realPlaywright City Conditions Enable pass. Realbuild7144cab5-be01-4f56-96a8-e759e14b4232 verified with no diagnostics; releasecf6b0388-d2ad-4270-935a-d57ce535242c is pending human approval. EZFactory historicalsource9d8fc932 remains unavailable from44Gitversions; preserve history and add explicit recoveryUI instead of raw500.

Repair review: all 28 live review pages return HTTP 200. City Conditions passes the real Enable journey and isolated build. EZ Factory shows the missing-source recovery view; selecting an available workspace opens the editor. Parent checks pass: 43 deployment/config cases, 5 real file-store cases, 42 web cases, and 10 Playwright cases on desktop and mobile. All 25 measured changed source lines have coverage. The original corruption and symlink checks remain intact. Gate integrity passes without an override. Final publication hooks and hosted CI remain pending.

Final local review: the Terra review identified an enabled new-approval request on the missing-source page. Its two failing assertions now pass, with all 27 component checks. Existing approved-release activation still uses the exact backend approval policy. The normal push check caught two empty-page fixture type errors; a shared typed empty-page fixture fixes both. All four typecheck sections pass, and Svelte reports zero errors. The committed changed-file secret scan reports no leaks.

Hosted follow-up: visual evidence initially failed because the new screenshot spec lacked its author-page mapping; the mapping now passes the unchanged local gate and all 10 Playwright cases. Firefox initially failed on a Docker Hub Postgres-download HTTP 502, then passed on the next source run. The actual hosted coverage merge reproduces one uncovered catch line (author loader line 26), despite all 1265 file thresholds and the focused V8 checks passing. A producer-specific regression is in progress; no coverage threshold or rule changes are allowed.

Coverage repair review: added one regression to the existing Bun installer/author-loader suite. It creates and reads a real workspace, removes its digest-named blob, then verifies retained history, empty source, and disabled approval. All 15 cases pass; the previously missed loader line now has 23 hits. Parent merges this source-matched result with all 18 downloaded CI LCOV files. The unchanged gates pass: 1265 file thresholds, no new source files, and all four changed source files.

## Test infrastructure review — 2026-09-09

## Expanded mock browser repairs — 2026-09-09

- [ ] Reproduce and repair the inline tool, custom-card, and file-mention browser specs on a fresh mock app.
- [ ] Reproduce and repair streaming toolbar and team orchestration browser specs without weakening their UI or transport assertions.
- [ ] Verify actual mocked HTTP/SSE request contracts and meaningful completed UI state for every repaired flow.
- [ ] Run the five owned specs with one worker on private port 4291; commit each independent green repair chunk.

Plan review: preserve the existing mock transport fixtures and only change application behavior when the current contract proves a defect. Use the focused browser lock and a fresh build; do not force clicks, skip cases, relax timeouts, or add conditional success assertions.

## Provider-error composer recovery and context compaction — 2026-09-09

- [x] Reproduce the isolated real-auth mock-provider overflow in a browser and retain the captured provider request.
- [x] Trace the terminal run state to find why the next send loses the seeded `ezcorp-mock` pin or remains disabled.
- [x] Add a regression that proves the original provider error remains visible, the composer recovers, and a second mock turn succeeds with no external transport.
- [x] Verify the production isolation flag remains opt-in and normal provider routing is unchanged when it is off.
- [x] Run the focused backend, web, and real-auth browser checks; record exact results below.
- [ ] Add direct bridge coverage for the terminal provider-error event; keep the isolation transport probe fail-closed.

Plan review: use the existing real-auth browser and in-process mock HTTP endpoint. Do not add browser route stubs, force clicks, or synthetic event streams. Keep `PI_E2E_ISOLATE_PROVIDERS=1` as a test-only outbound boundary.

Review: a terminal provider error could end an empty turn without populating `agent.state.errorMessage`; the bridge now retains its original error for failover classification. The real-auth run passes both context-compaction cases through the local HTTP provider, including a visible 400 and a successful second submitted message. Focused backend tests pass with isolation transport and test-surface-off routing assertions.

Scope: EZHarness current origin/main, a1837d51181ae0b2d1093483166f7d50d1fbc134, in an isolated checkout. Keep existing checkout edits intact.

- [x] Read project rules and lessons; inspect the test entry points and CI jobs.
- [x] Check in with the review plan before implementation.
- [x] Install locked root and web dependencies with the pinned Bun runtime.
- [x] Verify test discovery, runner isolation, failure propagation, and CI coverage.
- [x] Run backend, web Bun, Node Vitest, coverage, types, lint, and build checks.
- [x] Run the mock browser gate, fresh setup, and real-auth browser tests; inspect UI evidence.
- [x] Repair the two confirmed infrastructure gaps; verify each repair and record the unreproduced Postgres CI timeout.
- [x] Record results, limits, and the final review.

Plan review: compare local commands with CI, test failure handling as well as successful runs, and keep complete logs. Use private test databases and unused browser ports. Do not weaken checks.
# PR #308 review fixes

- [x] Reproduce the review findings and assign isolated Sol worktrees.
- [x] Fix OAuth session revocation and refresh recovery; integrate focused tests.
- [x] Add migration upgrade, idempotency, and foreign-key tests.
- [x] Fix real filesystem import and publication recovery; remove repeated identity and limits.
- [x] Fix GitHub setup, base selection, empty-change feedback, and diff drawer state.
- [x] Diagnose and fix hosted launcher cancellation failure.

Final verification and PR check results are tracked in `tasks/pr308-fix-plan.md`.
Keep the source commit fixed while collecting browser coverage receipts.

Review findings and detailed execution notes: `tasks/pr308-review.md` and `tasks/pr308-fix-plan.md`.
Work is isolated on `fix/pr308-review-findings` and four Sol agent worktrees.

---

# Wire `trusted-local` — the explicit, per-release-approved unsandboxed extension mode

Branch: `feat/trusted-local-runner` (worktree `worktrees/trusted-local`, from `main` @ 2588c9f19).
Decision record: `docs/decisions/2026-09-12-extension-runner-install-burden.md` (Finding 3 + Proposal).

Contract: `TrustedLocalRunner` (built, tested, never wired) enforces per-(phase, digest) admin
approval with approver + expiry + acknowledged omitted controls, then audits. This work only
supplies the ignition: a fail-closed two-key operator gate, the approval store, the two human
acknowledgement points (Build, Approve exact release), and the loud signals (boot log, banner,
health). No bypass of `authorize()`. `runnerProfile` flips to `trusted-local-v4` so every existing
approval goes stale and must be re-approved under the new terms (free, via `checkApproval`).

## Backend — all implemented; see Review for verification

- [x] `packages/@ezcorp/extension-runner/src/trusted-local.ts`: export `trustedLocalImage(bunDigest)`
      (single definition of the `localhost/trusted-local@sha256:` format) and use it in the ctor.
- [ ] `src/extensions/runner-mode.ts` (new): `getExtensionRunnerMode()` — `isolated` | `trusted-local`;
      fail-closed on `EZCORP_EXTENSION_RUNNER` unknown value, on `trusted-local` without
      `EZCORP_EXTENSIONS_UNSANDBOXED_ACK` === exact sentence, and on `trusted-local` + isolated
      socket vars both set. `TRUSTED_LOCAL_PROFILE = "trusted-local-v4"`, `trustedLocalBunDigest()`
      memoized sha256 of `process.execPath`.
- [ ] `src/db/migrations/add-extension-trusted-local-approvals.ts` (new) + `src/db/migrate.ts` call +
      `src/db/schema.ts` table: `extension_trusted_local_approvals (installation_id FK cascade,
      phase, digest, approved_by, expires_at, omitted_controls JSON text, created_at)`
      PK `(installation_id, phase, digest)`, index `(phase, digest)`.
- [ ] `src/db/queries/extension-trusted-local-approvals.ts` (new): `recordTrustedLocalApproval`,
      `findTrustedLocalApproval(phase, digest)` (live rows only), `revokeTrustedLocalApprovals`
      (by installation, optionally by digest). TTL 180 days.
- [ ] `src/extensions/trusted-local-runner.ts` (new): `createTrustedLocalRunner(): Runner` — lazy
      async init (bunDigest, `provisionToolchain` with explicit sdkEntrypoint, `initialize()`),
      `approvalFor` → query module, `audit` → `insertAuditEntry`. Root
      `<projectRoot>/.ezcorp/extension-trusted-local`.
- [ ] `src/extensions/runner-connection.ts`: select by mode; return type `Runner`.
- [ ] `src/extensions/v4/types.ts`: optional `LifecycleDependencies.trustedLocal`
      `{ recordApproval(phase, digest, installationId, actor); revoke(installationId, digest?) }`.
- [ ] `src/extensions/v4/lifecycle.ts`: `build()` takes `acknowledgeUnsandboxed?`; when
      `trustedLocal` set → require it (`unsandboxed_acknowledgement_required`) and record
      `(build, sourceDigest)`. `approve()` takes options `{ acknowledgeUnsandboxed? }`; on
      approve when `trustedLocal` set → require it and record `(execute, artifactDigest)`.
      `revokeApproval()` and `stop()` → revoke rows.
- [ ] `src/extensions/extension-lifecycle-service.ts`: profile/image/dependency by mode.
- [ ] `src/extensions/extension-control.ts`: `extensions_build` schema + handler pass
      `acknowledgeUnsandboxed` (additionalProperties:false makes this mandatory).
- [ ] `web/src/routes/api/extensions/releases/[installationId]/approve/+server.ts`: accept
      optional boolean `acknowledgeUnsandboxed`.
- [x] `src/env-validation.ts`: call `getExtensionRunnerMode()` (boot fails closed on misconfig) and
      log error-level when trusted-local. (`context.ts` untouched — it already calls `validateEnv()`
      and has no logger of its own.)
- [ ] `src/health.ts`: detail gains `extensions: { runner: mode }`.
- [ ] `web/src/routes/api/auth/me/+server.ts`: add `extensionRunner: mode` (session-authenticated,
      no anonymous leak — the app shell already fetches this).

## Web

- [ ] `web/src/routes/(app)/extensions/author/+page.server.ts`: expose `extensionRunnerMode`.
- [ ] `web/src/routes/(app)/extensions/author/+page.svelte`: Build — unsandboxed note listing the
      seven omitted controls + required checkbox → `acknowledgeUnsandboxed: true`. Approval card —
      when `approval.runnerProfile === "trusted-local-v4"`, note + second required checkbox →
      approve body `acknowledgeUnsandboxed: true`. Header copy reflects the mode.
- [ ] `web/src/lib/components/UnsandboxedExtensionsBanner.svelte` (+ `.helpers.ts`, bun-tested):
      persistent, non-dismissable, mounted in `(app)/+layout.svelte` from the `/api/auth/me` fetch.

## Tests / gates

- [ ] `src/extensions/runner-mode.test.ts` — every fail-closed branch + both valid modes.
- [ ] `src/extensions/runner-connection.test.ts` — trusted-local selection returns a Runner that is
      not a `RunnerClient`; isolated path unchanged.
- [ ] `src/__tests__/extension-trusted-local-approvals.test.ts` — record/find/expiry/revoke (PGlite).
- [ ] `src/__tests__/lifecycle-trusted-local-ack.test.ts` — build/approve require ack when the
      dependency is set; record + revoke hooks called with exact digests; no-op when unset.
- [ ] Integration: `src/__tests__/trusted-local-runner-in-process.integration.test.ts` — the REAL
      `TrustedLocalRunner` through `createTrustedLocalRunner()` against PGlite approvals: build
      refused without row, allowed with row, execute likewise, audit rows written.
- [ ] `web/src/lib/components/UnsandboxedExtensionsBanner.helpers.test.ts`.
- [ ] e2e (real tier, own lane): `web/e2e/extension-author-trusted-local.spec.ts` `@evidence` —
      preview started by new `scripts/start-trusted-local-preview.sh`; workspace → build (ack) →
      approve (ack) → activate → banner visible → `captureEvidence`. Config
      `web/playwright.trusted-local.config.ts`. CI lane wiring is a CODEOWNERS change — note in PR.
- [ ] `scripts/coverage-thresholds.json` keys for every new source file (100).
- [ ] `docs/extensions/security.md` + `deploy/extension-runner/README.md`: document the mode.
- [ ] `bun run typecheck && bun run lint`; targeted suites; full pool vs. baseline (box is flaky).

## Review

**What the production-build lane found that source-mode tests could not** (all fixed, all now
covered by that lane — `web/playwright.trusted-local.config.ts`):

1. `seccomp.json` resolved via `import.meta.url` into `web/build/server/` — passed explicitly.
2. The trusted toolchain resolved from the bundle's location: `web/node_modules` (TypeScript 6, no
   `@types/bun`) instead of the pinned root closure — `provisionToolchain` gained `toolchainRoot`;
   also a correctness fix for "only from the installed trusted release".
3. Candidate verification (`verifyExtensionCandidate` → `runner.start`) is an `execute` of an artifact
   that has no release approval yet — refused by the runner. Fixed by deriving a fifteen-minute
   execute window from the build acknowledgement (`recordTrustedLocalVerificationApproval`), recorded
   in `runBuild` before verification. The build note on the author page names the verification run.

**Layering correction on the way:** `runner-connection.ts` must stay free of `db/` imports (a static
path into `db/connection` joins the repo's known import cycle and the server bundle then defers
module evaluation). The DB-backed hooks are built by `trusted-local-hooks.ts` and injected by the
lifecycle service (`configureTrustedLocalRunner`), which already loads `db/` lazily.

**Diagnostics closed:** the lifecycle's generic `operation_failed` branch now logs the unclassified
error with stack (it used to point at host diagnostics that did not exist); `trusted_approval_required`
is mapped to a legible operation diagnostic; the host's `approvalFor` warns with phase + digest when no
live acknowledgement exists.

**Behaviour to know:** in trusted-local mode the bundled first-party extensions are NOT auto-built at
boot — each build needs a human acknowledgement (twelve `Bundled source staging requires attention`
lines per boot; consistent with "bundled status does not imply trust"). The CLI's offline verify
cannot build in this mode (no acknowledgement to record) and says so.

**Box note:** one lane attempt (rerun 8) never started — Bun 1.3.9 segfaulted during the SvelteKit
build (`panic(main thread): Segmentation fault … a bug in Bun`), the same panic class the backend pool
showed on unmodified `main` earlier the same evening. Re-run after the pool finished.

**Merge with `main` (PR #269 conflicts):** eleven commits landed on `main` after the branch point;
nine files conflicted, all "both sides added". Resolved as the union in every case — #262's
`isExtensionRunnerConfigured()` beside the async-capable lazy wrapper (it now answers true in
trusted-local mode, without socket settings), #260/#265's named heading and installation rows beside
the unsandboxed acknowledgement UI, both JSON manifests merged, and the e2e fixture's shared
`BuildDeadline` kept positional with `extra` moved last (two of `main`'s callers pass the deadline
third). Re-verified: typecheck, lint, svelte-check, runner-connection 7/7 (incl. #262's probe),
bundled-v4-bootstrap 59/59, e2e-lanes 21/21, visual-evidence 7/7, vitest author-page/server-load/
routes 58/58, and the trusted-local production-build lane.

**CI round on PR #269 (two Opus agents in isolated worktrees):**
- Web shards 2/3: two pre-existing vitest files asserted the approve route's old four-argument
  `lifecycle.approve` call; now assert the exact fifth argument `{ acknowledgeUnsandboxed: undefined }`
  (`51e524124`).
- Coverage shard 0: a genuine regression of this PR. Keying the provisioning memo on
  `toolchainRoot` rebuilt the identical SDK bundle once per root, and a second `Bun.build()` in one
  `bun test` process trips a Bun file-descriptor reuse defect (`EISDIR` on regular files under the
  isolated `node_modules/.bun` store; reproduced standalone; `main`'s shard 0 is green). Fixed by
  caching the SDK bundle per entrypoint and the toolchain per root, sequentially; the new test counts
  real builds with a call-through spy (`78629cbf3`). CI-equivalent shard 0 run: 1902 pass / 0 fail.
- Also merged `main`'s #268 (repairs the #267 quality gates the first run used) — `3d94146e6`.
- Note for future agent runs: the harness cut both agent worktrees from `main`, not from the PR
  branch; both agents had to re-base onto the PR head themselves (`git switch -c`, since
  `git reset --hard` is blocked for them). Cherry-picked their commits onto the PR branch.

**CI round 2 — Per-file coverage gate** (`extension-lifecycle-service.ts` 99.02%, `runner-mode.ts`
90.63%, `trusted-local-runner.ts` 42.42%): the proof for all three lived in `*integration*` suites,
which the residual job runs WITHOUT coverage. Duplicated the proof outside it:
- `src/__tests__/trusted-local-runner-wiring.test.ts` — the host wiring with the runner PACKAGE
  stubbed: every option handed to the runner, the two hooks, unconfigured refusal, forget-on-failure,
  memoisation, and the SDK-entry override.
- `src/__tests__/extension-lifecycle-service-trusted-local.test.ts` — the SERVICE in trusted-local
  mode on real PGlite with the runner MODULE stubbed: hooks installed once and real (audit row +
  store), build refused without / recorded with the acknowledgement, `runBuild` records the
  fifteen-minute verification grant (shorter than the build row, same omitted controls), disable
  revokes.
- `trustedLocalBunDigest()` lost its catch-reset: the binary does not change while the process runs,
  so the memo now holds the failure too (three fewer lines to prove, and a clearer contract).
- **Bun coverage trap, measured:** bun keeps ONE lcov record per source path and the module copy
  loaded LAST owns it. A `?fresh=<uuid>` copy per test therefore reports any line only an earlier
  copy executed as a miss (8 missed lines with copies, 0 without, same assertions). The wiring test
  walks the module lifecycle in file order on the canonical instance instead.

**CI round 3 — Coverage shard 7:** `mock-cleanup-coverage.test.ts` (meta-test) flagged the service
test's `mock.module("../extensions/trusted-local-runner")` as unsnapshotted. Added the path to
`MODULE_PATHS` in `src/__tests__/helpers/mock-cleanup.ts` (cheap import graph, no db/daemon) so
`restoreModuleMocks()` can undo the stub. Every other check in that run was green; production
proofs were still pending.

**Verification results (final):**
- `bun run typecheck` ✓ (0 errors) · `bun run lint` ✓ (8 pre-existing infos, none in touched files).
- Unit/integration (one process per file): runner-mode 11/11 · runner-connection 6/6 ·
  trusted-local approvals 13/13 · lifecycle acknowledgement 12/12 · env-validation 14/14 ·
  health 9/9 · e2e-lanes 21/21 · hydration gate 6/6 · migrate idempotency 6/6 ·
  visual-evidence covers 7/7 (after adding the manifest entry) · runner package trusted-local 1/1 ·
  **real in-process runner integration 3/3**.
- Vitest: banner (component + unit) 7/7 · author page 7/7 · control/approve routes 9/9.
- Playwright: `extension-author-trusted-local.spec.ts` under the **trusted-local production build:
  1/1** (rerun 10; reruns 8–9 were killed by the box, not by code) and under the ordinary
  **isolated** real-auth server: 1/1.
- Full pool `PARALLEL=3`: 25590 pass / 12 fail in 9 files — eight green when run alone (box load;
  baseline `main` failed 14 in 8 files the same evening, disjoint sets), one real: the
  evidence-covers manifest, fixed above.

## PR #277 dependency validation

- [x] Review every changed dependency manifest and both Bun lockfiles against current `main`.
- [x] Keep `@types/bun` aligned with the repository's Bun 1.3.14 runtime pin.
- [x] Hold AI-kit Zod at 4.5.4 so its manifest, override, isolated npm lock, and root Bun lock agree.
- [x] Verify both frozen Bun locks and rerun the sole failed full-suite test.
- [x] Record the final dependency review and validation results.

### Review

- The original full suite reported 25,827 passes and one failed file. The only failure was the
  bundled-source lock mismatch caused by AI-kit declaring Zod 4.6.4 while its approved source lock
  still represented 4.5.4.
- Zod 4.6.4 resolved through the production extension-runner, but it produced MCP schema type errors
  in AI-kit's production source. AI-kit remains on 4.5.4. The web app keeps its independent 4.6.4
  upgrade.
- Root and web frozen installs pass with Bun 1.3.14. The production extension resolver fetched the
  AI-kit closure and confirmed Zod 4.5.4. The manifest freshness check passes, and the formerly
  failing bundled-source test now passes 2/2.

## PR #279 — agent instructions and complete Podman runbook

- [x] Confirm the PR branch, base, review state, existing instruction-file references, and current Podman docs.
- [x] Rename the root `CLAUDE.md` to the standard root `AGENTS.md` without changing its existing rules.
- [x] Add concise, complete development and production Podman run instructions to `AGENTS.md` and link to detailed deployment guidance instead of duplicating it.
- [x] Audit every Podman statement and command against the repository configuration, rendered Compose output, executable tests, and current primary Podman/Compose documentation.
- [x] Close documentation and test gaps found in the full PR diff while keeping the change focused.
- [x] Run focused tests, formatting/lint checks, and repository-level checks that cover all changed files.
- [x] Merge the current PR base if needed, commit, push to the PR branch, and watch all reported checks.

Plan review: preserve the original Podman fix, use `AGENTS.md` because that is the supported agent-instruction filename, keep one canonical detailed runbook, and prove commands before describing them as supported.

### Review

- Hosted artifact `10156093032` from run `34486963513` lacks `.svelte-kit/output/server` and fails the helper with exit 1. The current payload round-trip starts preview from the restored artifact and serves an immutable client entry plus rendered `/login` with pinned Bun 1.3.14.

## PR256 hosted mouse chip reorder

- [x] Inspect the saved CI trace and identify the failed drag state before Save.
- [x] Split native drag activation from destination movement and wait for the actual drag ghost.
- [x] Retain and rerun live-order, PUT, database, reload, touch, keyboard, and axe contracts.

### Review

- Hosted real-auth run `34486963513` failed only the mouse journey: the drag ghost appeared, but the rapid single movement crossed the destination before the visible `consider` order was established. The repaired native gesture passes the complete chip suite (5/5, 13.0s) and six consecutive mouse repetitions (6/6, 20.0s) on the existing mapped build.

## PR256 hosted chat pagination

- [x] Preserve the hosted mock-full failure artifact and identify the observer/click race.
- [x] Cover manual Load-older when automatic observer callbacks do not fire.
- [x] Cover normal automatic loading with a native wheel scroll.
- [x] Verify the focused suite through the coverage-enabled mock configuration.

### Review

- Hosted mock-full run `34490303620` has two red Load-older cases: Playwright scrolling the off-screen button into the 200px observer margin expands the window before pointer delivery, so message `m-34` intercepts and the button detaches. The red control is retained in `tasks/pr-submit/second-mock-full-ci.log` and the downloaded trace/PNG artifact under `/tmp/ezh-pr256-mockfull-pagination/`. The repaired five-case suite passes via the existing adapter server in 4.2s and via the coverage-enabled CI configuration in 6.8s, with no retry or timeout change.

## PR256 CI repair verification

- [x] Gate parser: locked one-package install; isolated Git fixture verifies missing-parser rejection, asserted-test success, and vacuous-test rejection.
- [x] Portable coverage: shared LCOV predicates run without rg; valid and invalid receipt controls exercise the production helper.
- [x] Async picker tests: deferred HTTP responses reproduce both early assertions; all 5 component tests pass with V8 coverage.
- [x] Cross-engine reuse: existing production adapter serves the already-built app; WebKit 19/19 and isolated Firefox 19/19 pass. Compression is not established as the cause of the earlier aborted responses.
- [x] Independent Terra review found no remaining repair blocker; combined gate/coverage/lane controls passed 267 tests, 891 assertions. Later lane contract passed 19 tests, 241 assertions.
- [ ] Run normal commit/push hooks and validate all hosted checks on the updated head before merge.

Review: the strict plain suite at ea63de53b passed 25,630 tests in 1,629 files. PR #256 is open. First hosted run exposed missing parser setup, partial browser transfer, undeclared rg dependencies, two component timing faults, native drag timing, and WebKit asset transport failures. Repairs retain coverage limits, strict failures, and browser persistence assertions. Full hosted validation and the required non-author review remain pending.

## PR256 second CI repair verification

- [x] Add `.github` to canonical lint scope; both lint commands cover 4540 files and the existing runtime guard passes all four tests.
- [x] Move all three deterministic CLI cases to the runner-ready real-auth lane; actual isolated build, own-test rejection, and unattended-approval rejection pass (46.3s).
- [x] Keep manual and automatic pagination coverage separate; all five cases pass with browser coverage (6.8s).
- [x] Isolate the diff parser and prove both coverage commands reject missing measurements and invalid base refs without installed dependencies.
- [ ] Independently review, run normal hooks, push, and verify all hosted checks on the final revision.

Review: second hosted run `34490303620` passed 101 real-auth cases, 7 fresh setup cases, both focused browser engines, and all web shards. It exposed lint scope drift and a broad mock run with 1416 passed, 4 failed, and 1 not run. The CI dependency guard correctly rejected incomplete coverage; no failed producer was treated as passing.

Final second-repair preflight: independent Terra review is clear; combined gate, lane, LCOV, and lint controls pass 273 tests and 933 assertions (9.16s). Pinned Bun reached the old patch gate without installed TypeScript, so that import was not a reproduced CI blocker. The confirmed gate defect was invalid base refs passing as empty diffs. All coverage thresholds remain unchanged.

## PR256 hosted mobile drawer backdrop

- [x] Preserve and inspect the hosted failure screenshot and trace from run `34494839199`.
- [x] Replace the forced centre click with a verified native click on exposed backdrop space.
- [x] Repair the same centre-click path in the mobile theme sidebar test through one shared helper.
- [x] Run both complete mobile suites and repeat both formerly affected cases under browser coverage.

### Review

- The hosted failure clicked the full-screen backdrop's centre with `force: true`. At 375px wide, that point is behind the left drawer panel, whose click handler correctly stops propagation. `clickExposedSwipeDrawerBackdrop` verifies the target through `elementFromPoint` and then uses a normal native Playwright click. The coverage-enabled mobile and theme suites pass 20/20 in 17.6s; both repaired cases pass six consecutive runs each (12/12 in 22.7s).

## PR256 reliability and native UI repairs

- [x] Audit raw hosted backend logs: identify docs-updater production-stdout use hidden by an isolated retry.
- [x] Share a test-only dashboard recorder between docs-updater and SEO-watcher; retain registration/publish assertions. Both suites pass under coverage; twelve four-worker-wave docs runs are clean.
- [x] Fix both drawer tests through one exposed, hit-tested backdrop helper; 20 focused cases and 12 repeated repaired cases pass.
- [x] Keep the desktop agent picker in the viewport by measuring the menu and opening above when required. Real browser checks cover above at 720px and below at 1600px, both with native selection.
- [x] Use normal tools/user-menu actions; put the active tools trigger above its backdrop and below modal dialogs. Hit-target and modal-priority assertions pass.
- [x] Final mapped browser run: 59/59 pass, 29.6s; changed executable picker lines have Chromium LCOV hits. Node component tests remain a separate behavior check, since this source uses canonical browser coverage.
- [x] Independent reliability and UI reviews found no remaining blocker.
- [ ] Commit, run normal push hooks, and validate all hosted jobs and first-attempt logs on the next revision.
- [ ] Obtain the required non-author approval and merge the verified head without bypassing protection.

Review: run 34494839199 passed the full production image lifecycle, including historical upgrade and legacy adoption. Its broad mock lane failed two native-action cases and its backend retry hid two first-attempt fixture failures; that run is not a clean final validation. The new repairs preserve coverage floors, real integration actions, and native browser interactions.

## PR256 shared picker viewport repair

- [x] Preserve the fourth hosted failure and reproduce the native extension-option click at the viewport edge.
- [x] Share viewport placement across all five desktop search pickers; native tick-only control passes 55/55 without the extra frame wait.
- [x] Retain native selection and pill assertions; all 55 picker/team browser cases pass, including constrained filtering and reopening.
- [x] Focused mapped browser checks pass (55 picker/team plus 23 mobile/preferences cases); parent reviewed the final repair after Terra reached its usage limit. Full type/lint/Svelte checks run in the normal push hook.
- [x] Diagnostic merged coverage passes all 1,625 source floors, 11 new-source gates, and all changed executable lines. Final hosted validation remains tracked below.

Review: fourth run `34500430524` passed all 12 backend shards on the first attempt (24,999 pass, zero retries), all web unit shards, both focused browser engines, real-auth, and visual evidence. The broad mock suite passed 1,419 cases and failed the native extension option click in `picker-pills.spec.ts:326`, because the option remained outside the viewport. The failed lane cannot certify the final coverage gate.

## PR256 local AI-kit deployment validation

- [x] Run the real self-contained MCP subprocess/OBO path: four cases pass with pinned Bun and owned temporary data.
- [x] Run public doctor, internal-auth, and user OBO checks against an isolated real local server: seven cases pass.
- [x] Add those public checks and the four real subprocess cases to the standard real-auth lane; both browser wrappers pass locally in 8.2s, including unconditional persisted-owner assertions and key revocation.
- [x] Preserve first-boot and second-boot controls for missing bundled AI-kit installation; distinguish pending human approval from active releases.
- [x] Retry bundled staging after first-admin creation; isolated setup returns 201 in 753ms, creates a pending workspace/build, and leaves activation disabled.
- [x] Validate the local bundled endpoint after a real test-admin approval lifecycle: verified build, exact approved activation, and 3/3 endpoint cases pass at c1c02f8a6; model-stream completion remains outside this deployed-service contract.
- [x] Parent-reviewed setup change: direct V8 covers all 31 lines, fresh setup passes 7/7, and the complete real-auth lane passes 106/106.

Review: on an empty database, initial boot defers bundled source staging until an administrator exists. The local first-admin setup currently does not reschedule that work. A second boot stages the source but correctly holds activation for release approval. The optional bundled E2E test requires a prepared and approved local installation; its missing-extension failure does not justify automatic activation or weaker approval rules.

## PR256 fifth repair verification

- [x] Retain the fourth hosted raw coverage diagnostic: toast resume and message-route refusal now have direct tests; Node owns the message route's executable map.
- [x] Reproduce AI-kit approval through the real local runner: its canonical host API grant exceeds the old 1,000-character limit.
- [x] Test the actual bundled manifest through approval/activation; retain human review and exact grants, and reject oversized whole UTF-8 JSON payloads with the shared contract limit (7/7 lifecycle cases).
- [x] Approved AI-kit endpoint flow passes 3/3; the permanent wrapper passes 7 public and 4 real subprocess package cases inside the 106-test real-auth run.
- [x] Constrained list reproduction extends 43 pixels off-screen; reset natural sizing before each measurement. Native browser and component regressions pass.
- [x] Review final changes and inspect fresh mapped hits; 163 focused Node tests pass in 7.91s. New model-picker keyboard contracts close the final measured gap; the diagnostic source/new-file/patch gates all pass.
- [ ] Commit and push through normal hooks; require the complete hosted run and all coverage gates to pass.
- [ ] Merge only after required non-author approval; do not bypass repository protection.

Review: Terra agents reached their usage limit after saving their work. The parent continues the remaining review and verification locally. Fourth hosted production lifecycle passed all eight proofs; the fourth CI run still failed its broad mock producer and dependent gates. No failed or cancelled run counts as final validation.

Fifth-repair review at c1c02f8a6: build passes; direct Node/V8 passes 161 tests in 14 files (7.30s), with helper 11/11, setup 31/31 and messages 170/170 measured lines. All 55 native picker/team cases pass (48.4s); 7 fresh setup and 106 real-auth cases pass (8.8m for real-auth), with no retries. The real approved AI-kit endpoint flow passes all 3 cases using pinned Bun and an isolated database. Twelve separate lifecycle coverage files pass 37 tests. Gate/lane/producer controls pass 135 tests and 799 assertions. Normal commit hooks pass. Only AI-kit changes in the regenerated first-party source lock. Final coverage diagnostic, normal push hooks, complete hosted CI and non-author approval remain required.

Final local fifth-repair diagnostic: remove every shifted source map before combining fresh measurements with unchanged fourth-run source records. All 1,625 source floors pass; 11 new source files are gated; the patch gate covers 97 changed sources. Desktop and mobile picker verification passes 78 cases in two runs (55 + 23); all changed picker executable lines have real Chromium hits. The new model keyboard suite covers bounded ArrowUp/ArrowDown, Enter selection and Escape without selection. These local combined measurements are a diagnostic; final CI must regenerate every producer on the submitted revision.

## PR256 sixth hosted repair

- [x] Reproduce and fix the saved-search layout assertion race: control preference arrival and wait for both placement and list size after each render.
- [x] Replay the exact failing Node shard: 194 files and 2,393 tests pass in 106.39s; the focused 163-test suite also passes.
- [x] Scope lifecycle state and operation ID reads to their shared heading, since runner diagnostics also contain bold text and code.
- [x] Run all three real WebKit lifecycle cases with the corrected selector: 3/3 pass in 4.3m.
- [x] WebKit bottom-sheet suite passes 19/19 in 25.4s against the lifecycle build.
- [ ] Commit and push through normal hooks.
- [ ] Require all checks and coverage gates to pass on the submitted head, then merge after the required non-author approval.

Review: fifth hosted run `34510858830` passed all 12 backend shards on the first attempt (25,000 tests, no retry/crash markers), real-auth, Firefox and visual evidence. It exposed two test defects: a component assertion read an intermediate render, and a lifecycle locator also matched a runner-busy diagnostic. No product behavior, timeout, retry count or coverage threshold changes in this repair. Local WebKit setup first failed because the Nix browser wrapper replaced the library path, then because Chromium-only coverage was enabled. A task-owned browser copy and the actual WebKit CI configuration resolved those invocation errors; they are not product failures.

## PR256 direct assertion check

- [x] Preserve the sixth hosted integrity rejection: the new local assertion helper was not followed by the AST check.
- [x] Assert the loaded saved-search button is visible in the test body, while retaining both layout checks and the shared helper.
- [x] Focused component suite passes 5/5 in 1.14s; gate integrity passes.
- [ ] Push through normal hooks and require a complete green hosted run.

Review: this adds a meaningful visibility assertion; it does not alter the integrity parser or use an override label.

## PR256 standard setup coverage producer

- [x] Preserve the seventh hosted patch-gate failure: setup staging line 79 has no positive hit in the actual submitted coverage.
- [x] Identify the mismatch: focused diagnostics included the setup route, but the standard Node include manifest did not. Existing direct success and staging-failure tests already exercise it.
- [x] Register setup in the canonical Node producer, require 100% of its measured lines, and add a registry-to-manifest completeness regression.
- [x] Actual full Node launcher passes 582 files / 7,379 tests in 279.29s and retains 516 configured source records. The fresh setup source measures 31/31 lines.
- [x] Merge standard Node output with unchanged seventh hosted producers and freshly measured configuration: all 1,625 source floors, 11 new sources and 97 changed sources pass. Gate controls pass 296 tests / 865 assertions; integrity passes.
- [ ] Run normal integrity and push hooks, then validate a complete fresh hosted run before merge.

Review: the seventh run passed 25,000 backend tests, 7,379 Node tests, 2,170 canonical browser tests, both browser engines, all 1,625 source floors and all 11 new-source checks. Its changed-line gate correctly rejected one unmeasured added line. The run is not green.

## PR256 production startup boundary

- [x] Preserve the eighth hosted failure: all coverage and browser gates pass; R1 exhausts 120 container probes before the owned build container exists, and R4 samples one active bootstrap container.
- [x] Reuse verified bundled-bootstrap observation before R1 and R4. Run that observation in a child process so its HTTP pool cannot contaminate the R4 socket baseline. Preserve all zero-resource and recovery assertions.
- [x] Pace R1's existing bounded polling loop at 250ms after the first observation.
- [x] Build the exact submitted application image from the archived commit; Docker and Podman IDs both match `6679c82c36b1e0fc687de2d8c0d89c57136f6404604a5fb2d18eb5a96a07f5d3`.
- [x] Add real subprocess controls for verified and failed startup. All 16 focused bootstrap/resource controls pass (57 assertions); lint and gate integrity pass.
- [x] Replay R1 locally: all 28 bootstrap builds verify; the target container pauses on probe 2; real SIGKILL recovers one candidate after the six-minute lease; old release remains active until explicit approval. App logs and owned cleanup all exit 0.
- [x] Replay all 10 R4 resource cycles and 100 SSE reconnects in 61.03s after verified startup. All 11 samples have zero runner containers; initial app TCP connections are zero. Memory, descriptor, SSE cleanup and owned cleanup checks pass. Both proof receipts pass `tasks/pr-submit/audit-ninth-production.py`.
- [ ] Run relevant controls, integrity, normal hooks and complete fresh hosted CI before merge.

Review: the production suite retained all eight proof results. File Organizer (13 cases), embeddings, delivery, revocation, historical upgrade and legacy adoption passed. Startup now correctly stages bundled sources after first-admin setup; the two failed verifiers began before that background work settled. The required proof job failed correctly.

## PR256 database shutdown test ownership

- [x] Preserve ninth hosted first-attempt failure: database shutdown Path A never signals READY within the test's 10s startup timer; an isolated plain rerun hides the failure in a passing shard.
- [x] Reproduce the real child/database flow: four coverage workers on one CPU fail all eight signal cases at the unchanged 10s readiness limit. Two-CPU controls pass; raw logs and exact CPU sets are retained.
- [x] Build one closed empty catalog and privately copy it for each signal path. Seed-only control passes all eight previously failing cases. Shared child handling drains both streams, uses the current Bun executable, bounds readiness and exit separately, and always kills/reaps the owned child. Production shutdown behavior and data-survival assertions are unchanged.
- [x] Final suite passes 24/24 cases and 84 assertions on one CPU, then 24/24 and 84 assertions on two CPUs. New controls verify readiness timeout, post-signal timeout, early-exit diagnostics and 1 MiB stderr backpressure. Lint and integrity pass.
- [ ] Run normal commit/push hooks and require fresh hosted checks without hidden first failures.

Review: the current helper applies its only 10s guard before the signal, leaves post-signal exit unbounded, drains stderr only after exit, and does not kill/reap the child if readiness fails. The repair must address those lifecycle defects, not accept the existing retry as success.

Performance review: the final four-worker, two-CPU run completes all six cases per worker in at most 15.98s, versus 18.59s for the original two-case suite in the same local setup. These are local single-run controls, not an overall CI speedup claim. The one-CPU red/green controls are retained under `tasks/pr-submit/tenth-shutdown-*`.

## Production CI performance

- [x] Measure the 58m35s baseline and identify independent proof groups.
- [x] Review a Terra plan for image build/transfer and isolated proof shards.
- [x] Implement bounded parallel jobs with one candidate image and strict receipt aggregation.
- [x] Review image ownership cost; retain the existing Dockerfile because removing the traversal would change runtime permissions or add build complexity.
- [x] Add failure controls for missing, duplicate, stale or failed shard evidence.
- [x] Run focused checks, real image transfer and required local checks.
- [ ] Submit a PR and measure a full hosted run against the baseline; require all existing proofs and coverage to pass.

Review target: reduce production wall time from 58m35s to below 30 minutes on hosted CI without dropping a proof, shortening real recovery leases, adding retries, or running resource baselines beside competing proofs on one host. Report total runner time and transfer cost as well as wall time.

Implementation review: five isolated proof groups share one attested image; the protected result validates all nine proof records, all eleven launcher cleanup records, exact candidate identity, and all four namespace cases. Local sequential callers keep the original eight proofs. Parent's real 4.4 GB image transfer produced a 1.496 GB archive in 30.69s, loaded both engines in 18.33s, and peaked at 129,392 KiB child RSS. No Dockerfile, coverage floor, recovery lease, or retry policy change.

Local review: 25,660 backend tests, 3,624 orphan web tests, 7,379 Node tests and 2,170 Chromium cases pass. Full coverage reports 26,466 passes, zero failures and all 1,625 source floors satisfied. All 39 focused infrastructure tests pass with 431 assertions. Terra reviewed six fresh UI screenshots and independently audited the raw logs. The first browser attempt correctly refused another project's occupied port; a fresh complete run on a private port passed. Terra caught a readonly matcher type error; the final annotation passes full typecheck and preserves identical emitted JavaScript. Hosted CI must run all gates on the final PR source and establish the measured performance result.


## Composable factory platform — 2026-09-12
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

Plan: `tasks/factory/PLAN.md`. Acceptance ledger: `tasks/factory/GATES.md`.

- [ ] S1: Kernel/compiler/simulator and golden domain definitions satisfy F07/F10/F13; SDK build and coverage registered.
- [ ] S2a: Base hardening and token/flag/toolchain proofs pass.
- [ ] S2b: Real Temporal, durable storage, outbox, projections and continuation proofs pass.
- [ ] S2c: Real native/Python bridge, recovery and isolation proofs pass.
- [ ] S2d: Tenant installations, scoped reads, budgets/fencing, pool fairness and GPU allocation proofs pass.
- [ ] S3: Assurance, release authority/reconciliation and delivered notification proofs pass.
- [ ] S4: All package preparation/execution/revocation CPU/GPU isolation proofs pass.
- [ ] S5: Console and all three production domain journeys/composition pass with actual remote receipts.
- [ ] S6: Hosted/self-hosted deployment, restore/load/soak/fault/alerts and provisioning proofs pass.
- [ ] REG: Full application build, lint, types, backend/web/browser regressions and measured coverage pass.
- [ ] AUDIT: All F01–F13 evidence is tied to the final revision and independent review finds no unresolved defect.

### Review

Implementation continues across all six stages. Local storage/GPU checks and the compiler, kernel, product grant/budget stores, journal, pool and Temporal foundations have measured component proofs. Full application routes, protected assurance/release, package lifecycle, console/domain packs, deployment/restore and the ten-installation soak remain incomplete. Final application regression and full coverage must run after integration.

### Local factory test campaign (user update)
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Run local S3 services in Docker Compose and prove storage conformance for all 10 tenant identities.
- [x] Prove actual AMD GPU computation: 10 seeded GPU matrix workloads pass; the same workload without devices fails with GPU_REQUIRED.
- [ ] Prove strict single-device isolation. ROCm initializes only when both host render devices are mapped; ROCR_VISIBLE_DEVICES selects the RX7900XTX but is not an isolation boundary.
- [ ] Provision 10 tenant installations and run integration/load tests at that scale.
- [ ] Record exact scale, duration, hardware and remaining launch evidence.

Local test review: SeaweedFS ordinary and archive services run with separate file mounts and volumes, loopback-only ports, bounded resources, and 10 credential identities each. All 20 identity round trips and cross-tenant read/write/delete denials pass, as do conditional single/multipart races, version reads and restart persistence. Initial 20-volume capacity failed on the fourth tenant; the corrected 100-volume profile passes. GPU: RX7900XTX, 25,753,026,560 bytes VRAM, ROCm7.14.60850/PyTorch2.12.0. GPU workloads are trusted local fixtures, not ten provisioned tenant installations or the F05 package-isolation proof.
## Factory stage 2b — legacy workflow reconciliation

- [x] Add failing end-to-end reproductions for caller retry dedupe, changed-input conflict, crash retry, and non-unique persistence failure.
- [x] Share the v4 bounded idempotency-key and canonical digest rules; add the `factory:` caller namespace at the public start route.
- [x] Resolve exact retries before dispatch and classify only a real unique violation as an idempotency race.
- [x] Add the existing orphan recovery sweep to each host-maintenance tick and prove boundary and in-batch runs resolve without restart.
- [x] Run focused tests, changed-source 100% coverage, lint, and typecheck; review the final diff for the exact three C10 changes.

### Review

The public route now stores `Idempotency-Key` as a bounded `factory:` key. The executor compares a canonical input and authority digest before dispatch, returns the existing durable run for an exact retry, and returns a typed conflict for changed input. A keyed async 202 waits only for durable creation or lookup and returns that run's actual ID. The host daemon runs the existing orphan classifier each tick with the boot cutoff and current lease time. Focused backend, route, v4, daemon, type, lint, and 100% new-source/route coverage checks pass.

## Factory SDK artifact and runner wire validation

- [x] Add generated JSON Schemas for `CompiledFactory`, partition artifacts, execution manifests, `FactoryRunnerRequest`, and `FactoryRunnerResult` from the SDK type source.
- [x] Add Temporal-safe structural validators with I-JSON, limit, index, partition, page, and exact cross-partition edge checks.
- [x] Add a Node compiler verifier that recompiles the embedded definition and compares every canonical IR field and fetched page bytes.
- [x] Add canonical C02 request/result types and pure validators for identities, fences, deadlines, pins, refs, usage, and 64 KiB wire bounds.
- [x] Export pure and Node entry points without pulling compiler crypto/YAML into the validation subpath.
- [x] Add adversarial tests and prove 100% owned-source coverage, build, typecheck, lint, and native Node imports.

### Review

The compiler now emits immutable root-node partitions with exact node-level inbound and outbound edges. It splits partitions by the 128-node cap and the canonical 32 KiB artifact size, rejects an unsplittable node with a located diagnostic, and keeps nested control bodies only inside their owning node. A separate bounded execution manifest carries the root ports, bounds, and output bindings needed by a partition-local kernel. Both payloads have generated schemas, byte and digest descriptors, pure validators, and Node construction helpers. The C02 runner types and validators enforce stable cursor, operation, authority, resource, usage, and terminal evidence rules. The final SDK run passed 87 tests and all compiler-owned measured lines.

## Factory Stage2c durable execution gateway
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Define idempotent attempt admission, operation journal, checkpoints, status, and cancellation records with tenant/project/run keys.
- [x] Add idempotent real-Postgres migration and one ordered `migrate.ts` call.
- [x] Bind signed attempt claims and peer tenant identity at the HTTPS gateway before durable admission or effects.
- [ ] Prove real HTTPS, PostgreSQL, response loss/recovery, conflict, cancellation, stale callback, and reattach behavior.
- [ ] Run changed-line and new-source coverage, typecheck, lint, and focused real-Postgres tests.

## Factory product budget store
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Persist hierarchical budget limits, exact decimal charges and unknown holds with atomic audit and compute outbox.
- [x] Share budget conformance across PGlite and real PostgreSQL; race reservations and settlements, retain overspend, and prove rollback.
- [x] Parent product coverage producer:57 pass /0 fail /10 files; new product stores/journal/pool/gateway/supervisor source lines100%.
- [ ] Wire all store authority into application routes and each real runner effect, then complete full platform proofs.

Review: tasks/factory/budgets.md has store evidence; tasks/factory/GATES.md remains the full-scope ledger.

# Factory application composition
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Add shared durable mutation receipts with current authority checks and exact payload identity.
- [x] Add revisioned draft CRUD and immutable published versions with the SDK compiler and shared blob store.
- [x] Prove concurrent save/publish, repeated keys, revoked access, corruption and transaction rollback on PGlite and PostgreSQL.
- [x] Add canonical coverage entries; run types, lint, tests and measured source coverage.
- [ ] Integrate into the application route/bootstrap layer with shared SDK API schemas and browser proof.

Review: This is a component leaf of the complete platform plan. The root integration worktree remains fixed for its active application regression run. All work here is owned by the root, on a separate branch.

Component review: canonical types pass in all four sections. Nine conformance cases cover saves/publish races, JSON/YAML round trips, archive, current access, corruption and rollback. PGlite source coverage: definitions150/150, mutation receipts34/34, additive migration8/8. Real PostgreSQL also runs the shared suite. API routes and real browser proof remain unchecked.
## Factory SDK product API contracts

- [x] Define strict request types for draft, version, run, approval, and grant surfaces with trusted path identity outside bodies.
- [x] Require canonical payload digests, bounded idempotency keys, and safe expected revisions on every mutation.
- [x] Define strict resource, page, export, validation, durable receipt, and error responses with pinned version artifact references.
- [x] Generate request and response JSON Schemas from the authoritative SDK type source and export pure predicates and validators.
- [x] Test every request and response variant plus unknown properties, tenancy injection, mismatched identity, unsafe bounds, invalid digests, and oversized values.
- [x] Prove package build, lint, native Node ESM imports, schema regeneration, and 100% measured owned-source lines.

### Review

The API envelope separates trusted route identity and header-derived preconditions from strict bodies. Tenant identity is absent. Draft definitions can be structurally valid while compiler diagnostics still report incomplete graph semantics. Published resources pin definition and compiled IR with the durable store's exact metadata names. Run start and repair/replan accept typed inline or immutable artifact parameters and stay under the durable 64 KiB command limit. The pure API entry point derives and verifies the canonical mutation digest while excluding only the caller key and digest claim. The canonical SDK run passed 96 tests and 798 assertions with 100% measured lines in the API, canonical, compiler, schema, types, and validation sources.

## Factory durable inbox and applied receipts

- [x] Add bounded per-interpreter durable inbox sequences and exact immutable event identities.
- [x] Commit decision outbox and inbox together; commit applied receipts with verified transition audit.
- [x] Connect transport claims and lease settlement without trusting caller command bytes.
- [x] Prove races, wrong-event high-water rejection, rollback, corrupt records, scope and capacity on PGlite and PostgreSQL.
- [x] Run measured coverage, SDK build, type checks and lint; review integration boundaries.

Review: This leaf supports complete platform recovery. Queued intention alone is never proof that an event was applied.

Component review: 29 targeted tests pass (203 assertions); actual PostgreSQL 8 cases pass (66 assertions). Measured lines: inbox89/89, transport queue26/26, outbox145/145, records138/138, additive inbox migration7/7. All four typecheck sections pass; focused Biome passes after import cleanup. Evidence is under /tmp/factory-platform-evidence/inbox-*. The pure transport type import will move to the SDK when the current orchestrator branch is integrated. Full platform gates remain pending.

Additional integration check: model every new factory database table in schema.ts as required by the database instructions; current raw SQL modules alone do not satisfy that contract.

## Factory atomic run lifecycle

- [x] Expose shared budget transaction methods and prove composition rollback.
- [x] Start pinned runs with current grants, installation epoch, immutable definition, root budget and outbox in one transaction.
- [x] Persist run revision and cancellation epoch; reject stale effects immediately after cancel or deadline.
- [x] Prove run reads, idempotency, cancellation races, budgets and scope through actual PostgreSQL and PGlite.
- [x] Validate full types, lint and measured coverage before application wiring.

Component review: 51 PGlite/store tests pass with 380 assertions. The same actual PostgreSQL suites pass 44 tests with 334 assertions. Run lifecycle104/104, locks7/7, budgets172/172, records140/140, mutations34/34, transport26/26 and the additive migration5/5 measured lines pass. All four type sections and focused lint pass. The canonical factory test set passes137/137; the real Temporal producer passes with all11 orchestrator sources at100%. This proves the component revision, not application boot, browser integration, GPU isolation or the full platform.

## Factory integrated storage and runner review
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Integrate definition/grant API, runner authority, product models, C12 provisioning, pool service and credential refresher commits.
- [x] Fix schema parity and shared transaction lock order; prove against real PostgreSQL.
- [x] Fix the native journal cursor defect with one scoped durable snapshot.
- [ ] Connect actual runtime services and run routes; finish artifact staging/receipt seams and protected assurance review fixes.
- [ ] Verify empty-operation cancelled/failed runner outputs, local provisioning/pool canonical producers, full app regression and coverage after composition.

Review: integration source and focused tests/types/lint pass; full platform gates remain open. The source worktree was frozen for every producer. Existing application data and original worktree remain untouched.
# Factory definition and grant HTTP API — 2026-09-13
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [ ] Confirm the small application registry contract with the root integrator.
- [ ] Compose the real definition/grant stores and trusted resource inventory.
- [ ] Add scoped grant listing and definition availability metadata.
- [ ] Build one shared SDK-validated factory HTTP handler.
- [ ] Add draft, immutable version, and grant routes with exact C01/C09 gates.
- [ ] Register every route and update OpenAPI/client/session parity.
- [ ] Add store, route, and real-auth journey tests.
- [ ] Run frozen installs, SDK build, focused checks, all four typecheck legs, lint, full tests, and coverage.
- [ ] Record final review and immutable commit proofs.

Plan review: Root owns application boot and service probes. This leaf owns only the small configured registry and definition/grant HTTP surface. The routes use SDK request/response types, schemas, and canonical digest helpers. They use the real stores and current authenticated identity. Feature-off returns 404 before application lookup; feature-on without a configured application returns 503.

## Review

Pending.

# Factory grant input snapshots — 2026-09-13

- [x] Reproduce caller mutation while grant authorization is waiting.
- [x] Snapshot principals, keys, updates, and list options before the first await.
- [x] Hide the trusted resource inventory behind a runtime-immutable ReadonlySet.
- [x] Run focused store tests, typecheck, lint, and measured coverage.
- [x] Commit the bounded correction separately for integration.

## Review

Grant operations now freeze flat copies of every caller-owned authority and target before any database or authorization wait. The race test mutates the actor, target, action, read key, and list filter while authorization is held, and proves that the checked and written coordinates remain the originals. The application exposes an encapsulated ReadonlySet with the complete current Set read API and no mutation methods. Four-leg typecheck, focused lint, 14 tests with 100 assertions, and 100 percent line coverage for grants (156/156) and application (67/67) pass.

# Factory authoring console — 2026-09-13
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Pin Svelte Flow and ELK and enforce their factory-only import boundary.
- [x] Add one strict SDK-backed browser client for draft list, create, import, export, save, validate, and publish.
- [x] Add pure graph projection/editing and deterministic ELK layout wrappers.
- [x] Build the responsive `/factories` authoring console and navigation entry.
- [x] Cover validation diagnostics, revision conflicts, keyboard editing, and immutable version publication.
- [x] Add component, route, manifest, and Playwright evidence tests for wide, narrow, light, dark, reduced-motion, and long-label states.
- [x] Inspect captured evidence and fix visible defects.
- [x] Run frozen installs, SDK build, typechecks, lint, focused tests, browser checks, and 100 percent owned-source coverage.
- [x] Record the final review and immutable commit proofs.
- [ ] Parent runs the canonical full regression under the shared heavy-validation lock.

## Review

The console uses the current membership project and the shared factory SDK contracts. Svelte Flow and ELK load only in the browser boundary. Draft writes use revision and idempotency preconditions. Publication compares the exact requested immutable source and explains that it does not activate a runner or package. Mock browser evidence covers the graph editor and narrow publication review. The real authenticated journey remains pending until the root-owned live factory boot is available.

Frozen root and web installs, the SDK build, all four typecheck legs, and lint pass. The final focused suite passes 20 tests. The registration repair passes 22 tests with 218 assertions; the route, evidence, lane, and boundary gates pass 231 tests with 803 assertions. Chromium passes all five authoring scenarios. The ten new measured sources each have 100 percent line coverage. An earlier full run passed 25,966 tests and found four missing coverage registrations; those exact failures pass after the repair. A second full run was cancelled when the shared heavy-validation lock was found in use, so the parent owns the final canonical regression.

## Native terminal and canonical service producers

- [x] Reproduce cancellation before the first operation without measured usage.
- [x] Preserve cancelled/failed terminal results without an invented zero charge; reject successful results with no measured usage.
- [x] Remove the machine-specific Bun path from the pool coverage producer and use the repository's targeted hook budget.
- [x] Run the actual PostgreSQL pool/provisioning producers, native adapter coverage, all four typecheck legs and lint on frozen source.

Review: `/tmp/factory-platform-evidence/terminal-pool-provisioning-results.json` records every exit as zero. Native adapter, pool service/token/HTTPS server and local provisioner have full measured line coverage. These component receipts do not complete application wiring or the full platform gates.
## Factory artifact transaction and paged-transition seams

- [x] Add transaction-aware artifact and definition staging with one durable run transaction.
- [x] Bound paged transition artifacts by the C08 aggregate command limit while retaining 32 KiB pages and manifests.
- [x] Commit transition audit and an exact inbox receipt in one transaction.
- [x] Prove rollback, corruption and receipt denial on PGlite and real PostgreSQL/S3; run required checks.

### Review

`stageInTransaction` and `stageDefinitionInTransaction` preserve the factory-run foreign key without an inner commit. A 576 KiB C08 transition cap now contains one command batch plus one state payload, while every page and manifest remains at most 32 KiB. Transition recording delegates to `FactoryInbox.commitTransitionInTransaction`, so the audit and exact inbox receipt either commit together or both roll back. PGlite and PostgreSQL/S3 proofs cover forced outer rollback, 40 KiB activity-produced transitions, corruption, index/length/identity/event-digest denial, wrong inbox identity, and concurrent retries. Typecheck, lint, package Node tests, and focused measured coverage pass.

## Run lifecycle and immutable artifact composition

- [x] Reproduce the real PostgreSQL artifact/run foreign-key failure and run-initiator cancellation denial.
- [x] Stage the immutable definition after run creation in the same transaction, preserving all rollback semantics.
- [x] Allow current initiators or operators to cancel; prove revoked grants, expired service accounts, foreign initiators and storage failure denials.
- [x] Model the artifact/run foreign key and compare exact modeled FK columns and delete rules against PostgreSQL.
- [x] Exercise the complete lifecycle conformance suite with PostgreSQL and local S3.
- [x] Run combined artifact/inbox/lifecycle coverage, all four typecheck legs and full lint on frozen source.

Review: `/tmp/factory-platform-evidence/lifecycle-artifacts-results.json` records all eight checks at exit zero. The component suite passes 25 cases; PostgreSQL suites pass 36 cases, including 10 full lifecycle cases using local S3. Measured executable lines are complete for lifecycle121/121, artifacts72/72, definition artifacts72/72, transition artifacts49/49, activities10/10, inbox90/90 and both new artifact migrations. All application database model lines are covered. Full platform boot, run routes, runtime effect composition and overall acceptance gates remain pending.


## Factory assurance integration — model parity

- [x] Reproduce the missing Drizzle assurance foreign keys against real PostgreSQL.
- [x] Match model references and delete behavior to the additive migrations.
- [x] Verify sealed contracts, evidence, approvals, audit faults, and current authority after integration.

Review: integration head `3dffb7418` plus this model fix passes the 21 focused cases, PostgreSQL schema (2 cases, 895 assertions), and PostgreSQL assurance (13 cases, 38 assertions). All four type checks and lint pass. Owned measured lines are assurance 130/130, assurance migration 10/10, and shared approval context 19/19. Receipts: `/tmp/factory-platform-evidence/assurance-integrated-results.json` and `assurance-integrated-coverage/lcov.info`. These are component proofs; application boot, release dispatch, production journeys, and the 10-tenant soak remain open.


## Factory run API — durable requests and reads
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Return the original committed command receipt from run start and cancellation.
- [x] Add scoped command status and bounded, filtered run summaries.
- [x] Register routes and harness client methods with exact read/chat scopes.
- [x] Verify retries, failed/unknown dispatch, cancellation races, rollback, missing receipts, membership, and actual PostgreSQL/S3 composition.
- [ ] Connect bounded repair/replan to real kernel replacement semantics.
- [ ] Complete factory-enabled application boot, service-principal HTTP authentication, and real browser/run execution.

Review: `/tmp/factory-platform-evidence/run-api-results.json` has six successful producers: 167 focused tests, 10 route tests, 13 PostgreSQL lifecycle tests, 13 PostgreSQL/S3 lifecycle tests, all four type checks, and lint. LCOV measures run lifecycle149/149, outbox155/155, application77/77, harness client453/453, shared route142/142, and every new route2/2 lines. Input revision0 now matches creation of a new logical run; stale nonzero start revisions return412. Accepted requests return202 and a real stored command status URL. An unknown dispatch remains visible as unknown and does not become run completion. Repair/replan currently fail unavailable and are not a completed surface. Full-platform gates remain open.


## Factory project creation and audit JSON

- [x] Reproduce orphan projects, absent factory owner grants, and encoded audit metadata on real PostgreSQL.
- [x] Commit project, owner membership, four non-consent grants, and audit in one transaction.
- [x] Repair only historical encoded audit objects and preserve all fact identities and non-object values.
- [x] Prove rollback, denied/repeated initialization, flag-off compatibility, and upgrade idempotence on both database engines.
- [x] Run affected tests, measured coverage, all four type checks and lint; record review.

Plan review: reuse the existing member upsert and grant mutation path. Register factory initialization at application composition. New projects receive author, publish, run and operate only; human consent and trust remain explicit.

Review: `/tmp/factory-platform-evidence/project-creation-results.json` records all four producers at exit0. The focused PGlite/application/regression cases and real PostgreSQL cases pass, including the historical audit upgrade. All four type-check legs and lint pass. Every changed executable line is measured; complete owned files include grants166/166, application79/79, member queries65/65 and the new migration4/4. Existing project queries and audit redaction cases also pass. This closes the project-creation transaction leaf, not factory-enabled production startup or the full platform gates.
### Follow-up: collision-free partition slots
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [ ] Reproduce PostgreSQL signed-index overflow and a deterministic partition-ID hash collision.
- [ ] Replace the hash-derived SQL page index with a collision-free scoped partition identity, model the additive schema, and cover migration.
- [ ] Prove concurrent PostgreSQL staging, foreign scope denial, typecheck, lint, and coverage.

### CI storage producer leaf
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [ ] Provision the ordinary Compose-backed store with generated job-local credentials in `db-postgres.yml`.
- [ ] Run required factory artifact/lifecycle PostgreSQL producer under its explicit S3 and Postgres references.
- [ ] Prove workflow syntax and local Compose startup/test command shape.

### CI storage producer leaf review

- [x] Provision the ordinary Compose-backed store with generated job-local credentials in `db-postgres.yml`.
- [x] Run required factory artifact/lifecycle PostgreSQL producer under its explicit S3 and Postgres references.
- [x] Prove workflow syntax and local Compose startup/test command shape.

Review: `71700a687` reuses the strict local storage provisioner in the required external PostgreSQL job. It runs explicit artifact and lifecycle test files under coverage and always removes the Compose profile. `actionlint` passes. The lifecycle filename is supplied by root commit `e577b7778`; this CI commit must follow that integration.

Note (W00 audit 2026-09-13): commit 71700a687 is not an ancestor of the integration branch (it lives on feat/factory-artifacts). The integrated db-postgres.yml diverged from it. Treat this item as integrated only through the current workflow file, which W00's staging PostgreSQL/S3 producer exercised (w00-staging-postgres.log, exit 0).
## Private factory HTTPS transport
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Prove the C02 private Node-to-Bun mTLS request boundary through actual sockets.
- [x] Reuse bounded framing for the attempt gateway and orchestration service, with exact response bytes and peer identity.
- [x] Reject malformed, oversized, duplicate, unauthenticated and stalled requests; drain/close owned sockets.
- [x] Add purpose-scoped service authentication, queue and stored artifact routes.
- [ ] Verify real Node/PostgreSQL/S3 composition, coverage, types, lint and production boot.

Plan review: the accepted C02 contract specifies the private HTTPS boundary under test. Existing runner-attempt authorization remains in its handler. The shared transport supplies only the verified certificate and bounded bytes, and cannot derive authority from a request body.

Transport review: seven socket tests and 70 assertions pass, including a real Node client, mTLS denial, exact 64 KiB response bytes, fragmented framing, extra-request termination and bounded failures. Shared transport and attempt gateway measure 70/70 and36/36 executable lines. All four type checks and lint pass after installing both root and web locked dependencies. Receipts are `/tmp/factory-platform-evidence/private-https-final-focused.log`, `private-https-final-coverage/lcov.info`, `private-https-types-with-web.log`, and `private-https-lint-corrected.log`. Purpose-scoped orchestration routes and full production startup remain open.


## Assembled factory component validation
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Integrate protected map release facts, encrypted versioned artifacts, Node continuation readers, controlled release protocol and shared private HTTPS.
- [x] Preserve all scoped database foreign keys and the approval generation index across integration.
- [x] Run gate integrity, SDK build, real PostgreSQL/S3, canonical Node coverage, four type checks and lint together on frozen source.
- [ ] Run full application regression and complete production service composition.

Review: `/tmp/factory-platform-evidence/assembled-platform-results.json` records seven successful producers at8a21a81d9. The combined component suite passes50 cases/274 assertions. Actual PostgreSQL/S3 passes23 cases/1,349 assertions including exact schema references and complete run-lifecycle storage composition. The canonical Node producer passes and all11 registered orchestrator sources have complete measured lines. These receipts remain component proofs, not production startup, full regression, independent archive durability or a10-tenant soak.


## Full backend regression after component integration
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Run the canonical backend suite at `3eeee3259`.
- [ ] Fix five SDK expansion/repair regressions and verify every SDK test file.
- [ ] Fix two bundled grant review failures and the Bun/Node/Python golden fixture failure.
- [ ] Repeat the canonical backend suite on the integrated corrections.

Review: `/tmp/factory-platform-evidence/assembled-backend-3eeee3259.log` reports 26,078 passing tests and eight failures across five files. Focused component receipts did not cover those failures. Sol owns SDK corrections; Terra owns the bundled-review and Python corrections. Full regression remains open.


## Trusted factory command lookup
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [ ] Reproduce command execution without a committed transition and reject it through the stored-command boundary.
- [ ] Add a scoped immutable index from command ID to its committed canonical transition audit.
- [ ] Commit index and audit together, preserve duplicate identities, and reject conflicting command bytes.
- [ ] Resolve and verify exact stored transition bytes before using a command to construct runner authority.
- [ ] Prove rollback, retries, corrupted index/artifact denial and tenant/project/interpreter separation on PGlite and PostgreSQL/S3.

Plan review: C02 accepts only authenticated command references from the Node worker. Product code must resolve the command from committed canonical audit. The new table is a bounded lookup index over that audit, with scoped foreign keys. It supplies no independent release authority and cannot accept a caller's runner, input, or grants. Existing journal admission, run fences and budget admission remain the effect gates.


## Encrypted definition and private key integration review

- [x] Integrate immutable C06 definition, private-file and readonly Node key-wrap changes.
- [x] Run root and web frozen installs and rebuild the factory SDK.
- [x] Re-run real PostgreSQL/S3 definition and provisioning proofs plus Node key-file coverage.
- [x] Run all four typecheck legs and lint on the integrated source.

Review: `/tmp/factory-platform-evidence/root-c06-results.json` records five successful producers at `c82b1b05b`. PostgreSQL/S3 and provisioning pass 16 cases/110 assertions. The actual Node key-file producer measures 101/101 lines. Root and web frozen installs, SDK build, all four typecheck legs and lint pass. These are component integration proofs; full application startup and recovery remain open.

## Backend correction integration review
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Integrate `433c1469c` as `cc9bb59ff`.
- [x] Independently rerun both bundled review files and the complete Bun/Node/Python golden fixture file.
- [ ] Integrate and verify the five SDK expansion/repair corrections.
- [ ] Rerun the complete canonical backend suite.

Review: `/tmp/factory-platform-evidence/root-backend-corrections.log` records all three complete focused files passing. A rejected review preserves its terminal human decision. Canonical bundled host-API grants retain the existing aggregate JSON size bound. An initial runner request starts its operation cursor at zero when no checkpoint exists.

## Private service integration review
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Authenticate every private route with the bound client certificate and separate RS256 issuer, audience, subject and orchestration scope.
- [x] Claim installation commands across project queues and retain stored-byte and lease checks.
- [x] Serve exact immutable definition/transition bytes; carry page bytes safely through bounded activity DTOs.
- [x] Forward only scoped command references to the trusted product policy.
- [x] Reproduce and fix a legal 64 KiB command's HTTP envelope failure, route aliases and internal error-code disclosure.
- [x] Run the production Node queue client against Bun/PostgreSQL/S3 and fix empty-queue and inbox-confirmation mismatches.
- [x] Measure the changed server and Node sources, and run all four type checks, lint and gate integrity.
- [ ] Connect the concrete committed-command policy and production startup.

Review: `/tmp/factory-platform-evidence/private-service-final-results.json` records all seven successful producers. The combined component suite passes 52 cases/409 assertions. PostgreSQL/S3 passes 20 cases/180 assertions. Every measured line is hit for private service94/94, HTTPS70/70, outbox173/173, queue adapter26/26, artifact store81/81, definition store73/73 and transition store79/79. The actual Node producer measures queue client67/67, gateway236/236 and both paged readers completely. This closes the private transport and storage composition leaf; its injected command executor is still awaiting the concrete committed-command policy, and full platform readiness remains open.

## Root private service integration checks

- [x] Run the exact expanded CI command against PostgreSQL and Compose S3 on the integrated source.
- [x] Verify complete schema references and the production Node queue client within that lane.
- [x] Repair both newly merged command-index fixtures to use canonical base64 page DTOs.
- [x] Run the complete artifact test file and all four type checks, lint and gate integrity.

Review: `root-private-integration-results.json` records the SDK build, 48 PostgreSQL/S3 cases (348 assertions), and two schema cases (1,231 assertions) passing at `1e9aea5a7`. Its type check correctly rejected two stale test fixtures. The correction is `5b982efde`; `root-private-page-fixtures.log` records all 12 artifact cases passing. `root-private-static-results.json` records all four type checks, lint and gate integrity passing at that correction. Receipts are in `/tmp/factory-platform-evidence`. These checks do not prove concrete command execution or production readiness.

## Factory C01 HTTP service principals

- [x] Add a dedicated installation-bound service credential token that cannot validate as a user session.
- [x] Persist project-scoped credential revisions, expiry, revocation, and transactional audit without storing token bytes.
- [x] Add strict SDK issue/revoke contracts and human-session tenant-admin routes with idempotency and revision checks.
- [x] Authenticate the exact registered factory read/write/chat route and stamp only a factory service principal.
- [x] Recheck the exact service credential, account, project, scope, and factory grant inside each product transaction.
- [x] Prove invalid, foreign, expired, disabled, revoked, stale, wrong-route, wrong-scope, and wait-race denials.
- [x] Preserve all legacy session, API-key, internal-auth, and non-factory behavior.
- [x] Run schema generation, frozen build, focused PostgreSQL/HTTP tests, all four type checks, lint, and measured coverage.
- [x] Record review and an immutable commit for parent integration.

Plan review: The parent accepted the dedicated `ezkfsvc_` contract. The signed claims and durable row bind the installation, project, service account, credential, revision, flat HTTP scopes, issue time, and expiry. The SvelteKit hook uses its exact route id and never creates a user. Factory grant authorization reloads credential authority in the same transaction as reads and mutation receipt checks. The parent owns the unrelated harness-client clean-install fix and the canonical full regression.

Review: Root and web frozen installs, the SDK build, the production web build, all four type-check legs, lint, and gate integrity pass. Focused coverage passes 55 backend tests, 49 bearer tests, 17 route/client tests, 29 route-contract tests, and all 143 SDK tests. New runtime files have complete line coverage: token 80/80, route policy 23/23, credential store 138/138, migration 8/8, bearer router 92/92, shared handler 161/161, client 58/58, each route 1/1, run lifecycle 149/149, preview token 63/63, and SDK validation 668/668. Real PostgreSQL passes five credential cases, fourteen lifecycle cases, and two schema cases with 958 schema/credential assertions and 109 lifecycle assertions. The strict session verifier intentionally exposes the old C02 gateway fixture as unauthorized because that fixture adds attempt claims to a user session; the parent owns its agreed migration to the distinct factory-attempt codec. The parent also owns the final live-boot HTTP journey and full regression pool.

## C02 attempt token purpose

- [x] Reproduce a user-shaped token being accepted through the real mTLS execution gateway.
- [x] Sign and verify exact attempt claims with the shared installation HMAC envelope and a separate token purpose.
- [x] Reject user, public service, preview, malformed, foreign, expired and path-mismatched credentials before admission.
- [x] Preserve deadline-fenced effects and authenticated status/cancel after an attempt deadline.
- [x] Verify the actual Node client, measured gateway/token coverage, existing authentication regressions, all four type checks and lint.

Plan review: the accepted C02 HTTPS operations are the test boundary. The token binds every existing journal authority coordinate and canonical request digest. It carries no user role or email. A short-lived control token may inspect or cancel an expired attempt; the journal continues to deny new effects and terminal advancement. Reuse the C01 HMAC envelope and the existing Node HTTPS fixture.


Review: `attempt-token-purpose-red.log` retains the real Node-to-Bun mTLS reproduction: a user-shaped credential admitted work with HTTP 201. The dedicated attempt codec rejects that credential. `root-auth-integration-results.json` records eight successful producers at `d84359f84`, including root/web frozen installs, SDK build, 58 real PostgreSQL/S3 cases with 1,745 assertions, 24 authentication/schema cases, all four type checks, lint and gate integrity. The gateway also proves signed conflicting submissions return 409 and that expired attempts retain authenticated status/cancellation while new admission fails. Both the token codec and gateway have complete measured lines (31/31 and 28/28). These are private authentication and database integration proofs; concrete execution composition and production readiness remain open.

## Production orchestration readiness reader
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [ ] Read only an owned private bounded readiness file and bind it to the configured installation, tenant, namespace and task queue.
- [ ] Require a fresh ready heartbeat, confirmed worker polling, a live dispatcher and a loaded credential generation.
- [ ] Reject missing, stale, future, malformed, foreign, unsafe and failed state files without exposing their contents.
- [ ] Prove the private-file boundary and measured coverage; integrate the actual production Node writer when available.

Plan review: the Node bootstrap owner and root agreed the versioned private readiness-file contract. This reader uses the existing descriptor-based private-file module. The Node writer must verify authenticated namespace/task-queue polling before it can report ready. The reader alone is not a production boot proof.
## Factory journal service-credential propagation

- [x] Reproduce effect dispatch after durable service-credential revocation.
- [x] Preserve the complete durable credential when the journal reconstructs its run principal.
- [x] Prove the fix with PGlite, PostgreSQL, focused coverage, type checks, lint, and gate integrity.
- [x] Record the review and immutable follow-up commit.

Review: The run-grant adapter now snapshots its five used authority fields before any database wait and passes the exact durable service credential into `FactoryGrants`. PGlite and PostgreSQL each pass 12 cases with 70 assertions, including revoked-credential effect denial and a caller-mutation race. Focused LCOV measures all 19 run-grant lines and all seven functions. The SDK build, all four type-check legs, lint, and gate integrity pass. The canonical parent regression remains parent-owned under the shared heavy-validation lock.

## Factory release trust and control HTTP API

- [x] Add strict SDK request and response contracts for trust publication, trust revocation, and release control.
- [x] Register three session-only routes and expose them through the shared factory handler.
- [x] Add typed browser-client methods without making the routes API-key controllable.
- [x] Prove session-only authority, preconditions, idempotency, error mapping, schemas, registry/OpenAPI parity, and source coverage.
- [x] Run the SDK build before all four type-check legs, lint, factory boundaries, and gate integrity.
- [x] Record review and an immutable commit for parent integration.

Plan review: Reuse the authority store's durable `FactoryMutations` receipts. `If-Match` is the trust revision or release-control epoch. The HTTP body can supply only the exact package/validator trust lock or the enabled boolean. Candidate, material, completion, claim, and dispatch facts remain private.

Review: Three registered session-only routes now call the real release authority store through the shared factory handler. Strict SDK schemas and validation reject mutable runner pins and caller-supplied protected facts. The browser client sends canonical payload digests, idempotency keys, and exact trust revision or control epoch preconditions. Focused root, SDK, and web suites pass 14/155/21 tests with 81/1,129/route assertions; changed lines are fully covered in `/tmp/factory-c04-api-root-cov-20260913a`, `/tmp/factory-c04-api-sdk-cov-20260913a`, and `/tmp/factory-c04-api-web-cov-20260913a`. Registry, OpenAPI, session-scope, coverage registration, factory boundaries, the production web build, four type-check legs, lint, and gate integrity pass. Parent owns the combined PostgreSQL regression and live boot journey from the integrated base.
## Factory durable release authority facts

- [x] Define exact terminal, candidate output, trust, release-control, history, and current-pointer records.
- [x] Bind terminal completion to the admitted request, journal evidence, measured usage, and verified output bytes.
- [x] Bind candidate artifact admission to exact node instance and generation, independent of interpreter identity.
- [x] Enforce human trust, current grants, explicit enable epochs, lifecycle fences, and pointer CAS.
- [x] Pass PGlite/PostgreSQL, coverage, type, lint, boundary, and gate checks; record review.

Review: the release authority store now derives a per-node current candidate only from an authenticated completed attempt, an exact settled operation journal, measured usage, and a verified immutable candidate-output object. Human trust binds the exact runner package and validator under a live `factory.trust` grant. Release control defaults to disabled and advances an explicit epoch. Candidate history is immutable, and its current pointer advances with a lifecycle-locked generation compare-and-swap. The shared PGlite suite passes 11 cases; the isolated PostgreSQL authority and schema run passes 13 cases with 1,486 assertions. Combined coverage passes 20 cases and measures release authority 169/169, its migration 24/24, artifacts 95/95, executions 224/224, and schema 1249/1249 executable lines. SDK builds, all four typecheck legs, lint, factory boundaries, and gate integrity pass. Evidence is under `/tmp/factory-platform-evidence/release-authority-*` and `tasks/factory/release-authority-GATES.md`.

## Factory artifact access and deferred run parameters — Terra
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Inspect existing immutable artifact and workflow input contracts; send ownership and revised bounded contract.
- [x] Add specific human cross-project artifact read grants and transactional opaque resolution.
- [ ] Preserve oversized parameter maps as verified opaque handles through durable start and activity consumption.
- [x] Prove PGlite and PostgreSQL/S3 scope, revocation, corruption, media/version, and bounded artifact bytes.
- [x] Run coverage, typechecks, and lint; record review.

Review: `FactoryArtifactAccess` grants only a human session's exact source artifact to one target project. The protected fact seals digest, byte count, kind, media type, storage version and issuer grant revision. Reads lock and compare the host row, call `FactoryArtifacts.loadInTransaction`, and return only opaque denials. `FactoryArtifacts.load` snapshots public authority before its transaction starts. `/tmp/factory-platform-evidence/terra-artifact-access-coverage.log` records 31 passing PGlite cases and 123 assertions, with artifact access 98/98, migration 6/6 and artifacts 99/99 measured lines. `/tmp/factory-platform-evidence/terra-artifact-access-postgres-s3.log` records the isolated PostgreSQL/S3 case passing. `/tmp/factory-platform-evidence/terra-artifact-access-types-lint.log` records root/web frozen installs, SDK build, all canonical typecheck legs and lint passing (eight pre-existing infos). The remaining large-input work needs a bounded lazy activity contract; this access leaf does not expand an artifact into a run request or Temporal history.
## Factory release and assurance idempotency

- [x] Route public human release and assurance mutations through shared durable receipts.
- [x] Reject reused keys with different canonical payloads before product mutation.
- [x] Reauthorize cached retries and return the original stable resource without duplicate facts or notifications.
- [x] Prove PGlite/PostgreSQL behavior, rollback, coverage, types, lint, boundaries, and gate integrity.

Review: required bounded idempotency keys now protect release preparation, approval requests, policy creation and revocation, reconciliation, assurance contract approval, and approval decisions. Preparation stores a stable locator in the shared receipt before archive publication, so a failed archive can resume without changing operation identity. Reconciliation runs its provider proof, immutable archive, product transition, audit, and cached response under one receipt transaction. Cached responses recheck current grants and do not repeat notifications, archives, provider absence checks, or product facts. PGlite and isolated PostgreSQL each pass 26 cases with 115 assertions. Focused LCOV measures releases 305/305, assurance 151/151, and shared mutations 39/39 executable lines. SDK and transport builds, all four typechecks, lint, factory boundaries, and gate integrity pass. The gate ledger is `tasks/factory/release-idempotency-GATES.md`.

## Combined projection and backend review
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Verify the combined SDK expansion, repair and projection changes.
- [x] Run all four type checks, lint and gate integrity after the readonly fixture correction.
- [x] Run the full backend pool and reproduce its remaining deterministic-validator boundary failure.
- [x] Replace the service token regular expression with bounded character checks and retain malformed-token rejection.
- [ ] Verify the new authority and credential fixes on PostgreSQL/S3, then repeat full regression.

Review: `root-projection-integration-results.json` records 155 SDK tests (1,101 assertions) and 20 PostgreSQL/S3 lifecycle/schema tests (1,431 assertions) passing at `55232b905`. It stopped on a readonly fixture type error. At corrected `618560260`, `root-projection-regression-results.json` records all four type checks, lint and gate integrity passing; the full backend pool reported 26,127 passes and one failure across 1,708 files. The actual module-graph CLI found a forbidden regular expression in service credential validation. `root-validator-boundary-green.log` records the replacement passing all 29 boundary and API schema cases, including malformed segments and non-base64url characters. Receipts are under `/tmp/factory-platform-evidence`. Full regression remains open until a complete passing run.

## Application restart integration
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Reproduce the release-table migration failure through the real PGlite close/reopen path.
- [x] Preserve an already scoped artifact primary key and all dependent foreign keys.
- [x] Make older artifact index migrations retain newer partition and candidate identity dimensions.
- [x] Add shared PGlite/PostgreSQL repeated-boot tests with 96 KiB artifacts, multiple nodes/generations and legacy key upgrade.
- [ ] Re-run every failed backend file, PostgreSQL schema/restart and all static checks.
- [ ] Repeat the complete backend pool after the correction.

Review: `root-authority-integration-results.json` passes SDK build, 155 SDK tests (1,112 assertions), 85 PostgreSQL/S3 tests (2,148 assertions), all four type checks, lint and gate integrity at `647e63a53`. Its full backend pool fails 64 tests across 34 files, mostly repeat-migration checks. `root-authority-restart-red.log` reproduces the referenced-primary-key drop through actual database reopen and rollback. `root-migration-restart-focused.log` passes 17 restart/migration/maintenance cases. The initial scoped-key correction also passes ten real-init and idempotent migration cases, including a five-boot cycle. Full regression remains open.
## Shared private client and pool admission

- [x] Reproduce private HTTP transport accepting a caller-supplied absolute URL.
- [x] Extract the existing TLS client into one Temporal-free transport package; preserve worker exports.
- [x] Bind requests to one configured origin, snapshot configuration, and bound deadlines and bytes.
- [x] Add the Bun pool client against real PostgreSQL and mTLS, including foreign credentials and cancellation.
- [x] Register shared-source coverage and prove actual Node and Bun consumers, builds, types and lint.

Plan review: reuse the existing worker transport and pool service routes. The new package owns HTTP only and cannot import the Temporal SDK. The root owns this extraction and pool client; the Node bootstrap owner keeps its stable gateway imports. `transport-path-red.log` records the real Node client accepting an absolute URL before the correction. No private credentials leave the local test server.

Shared client review: `shared-transport-final-integration-results.json` records ten passing producers against the source manifest `shared-transport-source-manifest.json`: root/web frozen installs, shared transport/orchestrator builds, actual Node gateway tests, actual Bun mTLS client, PostgreSQL/S3 private service, all four type checks, lint, gate integrity and factory boundaries. The real PostgreSQL/private Node queue proof passes five cases (74 assertions); the Bun client passes one case (11 assertions). Direct Node coverage measures the shared transport completely at 121/121 lines. A request cannot replace the configured origin; options and body are captured before credential reads; credentials reload on each request; a slowly streaming response cannot extend the total network deadline. This closes transport extraction; the pool client and concrete product command policy remain open.

## Factory bounded lazy input — Terra

- [x] Trace FactoryTransportValue, ValueSource, expressions/map, durable run/start and activity seams.
- [x] Propose bounded reference/page protocol and ownership.
- [x] Implement host authorization, immutable paging and conformance tests.
- [x] Validate coverage, types and lint.

### Review — host lazy input closed
- PostgreSQL/S3 conformance: `tests/postgres/factory-lazy-input.test.ts` passed 3/3, including shared and same-project immutable reads plus live credential/grant revocation.
- Static gate: SDK build, four typecheck legs, lint (8 existing infos), and integrity gate passed in `/tmp/factory-platform-evidence/terra-lazy-input-types-lint-gate.log`.
- Owned source LCOV: `src/factory/lazy-input.ts` 144/144 lines in `/tmp/factory-platform-evidence/terra-lazy-input-owned-coverage.log`.


Restart fixture review: the combined 12-file PostgreSQL producer at `49a6ad119` passed 88 cases and failed the new repeated-migration case because it supplied raw Bun SQL rows to a migration that uses the production normalized adapter. The fixture now repeats the same locked migration entrypoint used on startup; PGlite retains its own native adapter. Actual logs and the failed receipt remain under `root-restart-integration-*`. Regression is still open.

## Integrated regression receipt

The current platform regression passes at `7ea6e4bd9171460a7ef5a3de9d46203faf2049a8`: canonical `bun run test` reports **26,152 pass, 0 fail, 1,714 files**. All four type checks, lint, gate integrity, factory boundaries and actionlint pass. `/tmp/factory-platform-evidence/root-authority-static-backend-integration-results.json` records exact commands and exits. At the preceding `176f6871f`, the corrected combined PostgreSQL/S3 lane passes **89 tests / 2,231 assertions** across its 12 CI files; the PGlite restart lane and actual Node gateway transport pass. The remaining overall platform gates stay open; later source changes need their affected checks.

## Current committed command authority — root

- [x] Prove a committed kernel admission command resolves only against the live run and exact published definition.
- [x] Reuse kernel expanded-node resolution and reject stale generations, commands and run fences.
- [x] Bind immutable transition reads to the same locked database head before product admission.
- [x] Prove PostgreSQL/S3, revocation, cancellation and mutable input cases; run static checks and coverage.

Plan review: the next private command policy uses product records, exact stored transition artifacts and current grants. The transport supplies only a scoped command reference. The shared run-lifecycle conformance suite is the approved test boundary; no user authority is supplied by the Node worker.

Review: `FactoryCommandAuthority` loads an indexed immutable task command, the latest verified interpreter transition and the exact published plan. It then locks the live run, rechecks grants and epochs, compares the same audit head, and admits only the current task attempt. The shared conformance suite proves delayed-command rejection, concurrent transition rejection, configuration scope, caller input snapshots, expiry and cancellation. PGlite and actual PostgreSQL/S3 each pass 19 tests with 147 assertions. Measured coverage is command authority 39/39 lines and 8/8 functions, plus lifecycle 172/172 lines and 46/46 functions. SDK build, all four type checks, lint, boundaries and gate integrity pass. Exact source hashes are in `/tmp/factory-platform-evidence/root-command-authority-complete-source.json`; producer commands/exits are in `root-command-authority-complete-integration-results.json`. This is the task authorization step; pool reservation/dispatch, child creation and lazy read dispatch remain pending.

## Atomic compute allocation recording — root

- [x] Prove budget allocation and a following admission event roll back together.
- [x] Snapshot public allocation scope before waiting for a transaction.
- [x] Reuse one transaction method for direct and dispatcher callers.
- [x] Verify PGlite/PostgreSQL conformance and static checks before integrating the pool dispatcher.

Plan review: retain the existing budget store, run locks and audit helper. The pool dispatcher must commit the verified compute allocation and its inbox event together. A lost or failed event write cannot leave work marked running. Tests use the existing database-backed budget conformance seam.

Review: both rollback and caller-mutation failures were reproduced before the correction. Direct allocation and dispatcher composition now share `markRunningInTransaction`; the allocation and its event can commit or roll back together. PGlite and actual PostgreSQL each pass nine cases with 53 assertions. Focused LCOV measures budgets at 174/174 lines and 52/52 functions. SDK build, all four type checks, lint, gate integrity and factory boundaries pass. Exact source hashes and command exits are in `/tmp/factory-platform-evidence/root-budget-allocation-source.json` and `root-budget-allocation-integration-results.json`.
# C04 release and assurance session API (2026-09-13)

- [x] Seal the public endpoint, request, response, and application composition contract.
- [x] Enforce operation generation and version preconditions inside release and assurance store transactions.
- [x] Add SDK schemas and validators for public release and assurance resources.
- [x] Add the strict store-backed application adapter and shared session handler dispatch.
- [x] Add route files, API registry entries, and browser client methods.
- [x] Prove store conformance, route auth/body handling, response redaction, client behavior, and API documentation registration.
- [x] Run focused coverage, builds, all four typechecks, lint, boundaries, and patch coverage.
- [x] Commit one immutable API checkpoint and record proof paths.

## Review

- The public API exposes assurance contracts, release preparation and reads, approval requests and decisions, automatic policies, and human reconciliation through the real stores. C01 scopes are exact: prepare/read use chat, reconciliation uses write plus a store-level human-session check, and contract/approval/policy mutations remain session-only. Every mutation uses canonical idempotency and exact generation/revision preconditions. Public resources omit raw requests, evidence, archive coordinates, sender tokens, and dispatch controls; provider selection uses only the persisted operation through a snapshotted resolver.
- Focused backend coverage passes 38 tests with 206 assertions, and the final S3 adapter passes 3 tests with 26 assertions. SDK validation covers every added executable line. Final web coverage passes 27 tests with the shared handler at 214/214, browser client at 80/80, and each new route at 100%. Route, OpenAPI, and scope suites pass 50 tests with 115 assertions. SDK, harness-client, and transport builds, all four typechecks, the production web build, lint, factory boundaries, gate integrity, and diff checks pass. Proof paths are recorded in `tasks/factory/release-api-GATES.md`.
## Factory pool admission HTTP boundary

- [x] Extract one bounded authenticated pool route handler shared by Node and Bun TLS wrappers.
- [x] Preserve the Node HTTPS entry point and add the Bun private-HTTPS entry point.
- [x] Add a strict tenant pool client over the shared factory transport without automatic mutation retries.
- [x] Correct unknown status responses, canonical reservation paths, lease Date conversion, and response correlation.
- [x] Prove request recovery, status, start, renew, cancel, stale fences, malformed replies, and foreign credentials.
- [x] Run an actual Bun mTLS client/server journey against an isolated PostgreSQL pool service.
- [x] Register full source coverage and pass builds, types, lint, boundary, and gate checks.
- [x] Record review and create an immutable checkpoint.

Plan review: One transport call owns each client operation. A status response contains no allocation token, so only a repeated byte-equivalent admission request can recover a lost token-bearing lease response. Both TLS servers adapt into one handler that derives tenant authority from the certificate and signed token.

Review: the shared handler drives both Node and Bun TLS entry points, and the client exposes only the five fixed tenant operations. Request validation runs before durable grant writes; concurrent identical requests converge through conflict-safe insertion and exact reread. The final producer passes 53 tests and 238 assertions across PGlite, isolated PostgreSQL, Bun mTLS, and Node mTLS. All eight pool source records are at 100% line coverage in `/tmp/factory-pool-http-final6-cov-20260913/lcov.info`. The transport and SDK builds, all four type-check legs, lint, factory boundary CLI plus 24 tests, and the three factory CI registration tests pass. Full backend regression remains owned by the parent integration branch.

## Production orchestration integration

Review: the production process is integrated at `8d83911c23e64007a9a50c76e10dac34c0f231a2`. Frozen root/web installs, SDK/orchestrator builds, all four type checks, lint, gate integrity, boundaries, coverage registration/converter tests and the canonical Node coverage producer pass. The runtime producer reports 73 tests, zero failures and 107.943 seconds; exact commands/exits are in `/tmp/factory-platform-evidence/root-production-orchestrator-integration-results.json`. The real tenant-01 proof also reached ready with both authenticated worker polling and a live dispatcher. Full platform boot remains pending.

## Factory database and service startup phases — root

- [x] Reproduce the startup dependency loop through real PostgreSQL and a fresh process.
- [x] Keep installation, database and isolated-secret checks before opening the database.
- [x] Keep factory service readiness closed until actual post-database probes pass.
- [x] Verify feature-off startup and flag-on PGlite rejection remain correct.

Plan review: database initialization is a prerequisite of the private gateway and worker. Split configuration checks from service readiness. The application must remain unready during that interval; callers cannot open factory admission with a configuration check alone.

Review: a fresh flag-on Bun process against isolated PostgreSQL reproduced the premature service-readiness failure. Configuration checks now run before driver startup; database initialization leaves factory readiness at `booting / factory-services-pending`. Full service readiness still requires all seven probes. The focused boot/real-init/PostgreSQL-adapter suite passes 34 tests with 85 assertions; actual PostgreSQL startup/restart passes three tests with 21 assertions. Boot source coverage is 77/77 lines and 7/7 functions. SDK build, all four types, lint, gate integrity and boundaries pass. Proof commands/exits and exact source hashes are in `/tmp/factory-platform-evidence/root-boot-phases-integration-results.json` and `root-boot-phases-source.json`. The actual post-database service composition remains a separate open platform gate.

## Committed task budget and compute request — root

- [x] Derive a stable reservation from the current committed task attempt.
- [x] Apply configured resource profiles and task limits before reserving money, tokens and compute.
- [x] Write the exact pool request in the existing compute outbox within the budget transaction.
- [x] Prove duplicate calls, stale authority, bounded requests and transaction rollback through the lifecycle conformance suite.

Plan review: the private worker supplies only the committed command reference. The host chooses a configured resource profile; node limits can reduce its budget. Pool delivery and later capacity polling remain separate. An acknowledged queued request does not admit runner execution.

Review: current task admission derives one reservation identity shared by admission and dispatch, snapshots configured resource profiles, applies task budget/memory limits, and commits its budget hold with the exact existing compute outbox request. Repeated calls reuse the hold and delivery; missing outbox storage rolls everything back. An identity-only service guard supports recovery of an already committed receipt without re-admitting a superseded command. The combined focused run passes 25 tests with 187 assertions; all 15 current factory PostgreSQL/S3 CI files pass 102 tests with 2,322 assertions. Task admission coverage is 41/41 lines and 9/9 functions; authority is 43/43 and 9/9. Frozen installs, SDK build, all four type checks, lint, gate integrity and boundaries pass. Exact source hashes and exits are in `/tmp/factory-platform-evidence/root-task-admission-complete-source.json` and `root-task-admission-complete-integration-results.json`. A prior gate failure detected an imported assertion helper without a visible wrapper assertion; its PostgreSQL test now explicitly asserts successful completion of the real conformance helper. Durable pool polling and execution dispatch remain separate open work.
## C07 deterministic SDK/kernel lazy input — Terra
- [x] Preserve legacy inline workflow input and add an explicit durable artifact descriptor.
- [x] Add deterministic read-value/read-page commands, bounded caches, stale-result denial, and artifact path/map handling.
- [x] Wire orchestration activity contracts and workflow correlation, including command ID child resolution.
- [x] Preserve descriptor at lifecycle start and prove field, paged map, replay, child, and corrupt-result cases.
- [x] Run PostgreSQL/S3 conformance, owned coverage, SDK build, all types, lint, and integrity checks.

Review: `FactoryWorkflowInput.durableInput` is an explicit `factory.lazy-input.v1` descriptor, separate from legacy `input` JSON. The kernel records only selected `(name,path)` values and a current map page. It emits `read-input-value` and `read-input-page` commands through the existing generic command activity, matches returned events to command/node/generation/cancellation/ref/path/page fences, pins storage version, and rejects substituted or stale values. Lazy maps keep their current window with absolute indices, then request the next cursor and terminate on an empty final page. Child descriptors use `factoryChildRunId` and pass the parent `run-child` command ID to the authoritative child resolver. A continuation must carry the exact same descriptor.

Validation: locked Node Temporal replay passes 18/18 at `/tmp/factory-platform-evidence/terra-lazy-temporal-replay-passing.log`; it includes field hydration through recorded generic commands, a tagged child workflow, descriptor substitution denial, and existing replay/continuation cases. SDK source coverage passes 159/159 with `kernel.ts` 1151/1151 lines at `/tmp/factory-platform-evidence/terra-lazy-sdk-coverage-final.log`. The real PostgreSQL/S3 private-service conformance passes 5/5 at `/tmp/factory-platform-evidence/terra-lazy-private-resolve-postgres-s3.log`; it rejects missing/invalid resolve `commandId`. Its PGlite coverage has `private-service.ts` 97/97 lines at `/tmp/factory-platform-evidence/terra-lazy-private-resolve-coverage.log`. Root and web frozen installs complete, then SDK build, all canonical typecheck legs, and lint pass at `/tmp/factory-platform-evidence/terra-lazy-final-types-lint.log` (eight existing lint infos).

## Committed subfactory command authority — root

- [x] Prove only the current committed run-child command resolves a child definition.
- [x] Share run/head/fence validation with task admission and compare the exact compiled child reference.
- [x] Reject stale, cancelled, wrong-kind and caller-mutated child requests.
- [x] Verify shared PGlite/PostgreSQL tests, coverage and static checks.

Plan review: the child resolver receives an opaque command ID. It must authorize the committed parent attempt before it creates a separate child run and budget delegation. This leaf establishes that authority; durable child creation follows it.

Review: only the current committed run-child attempt can resolve its exact compiled child factory id, version and digest. Task and child checks share the run/head/fence transaction. Real published parent/child definitions prove valid resolution, caller mutation capture, wrong command kind, substituted factory digest, deadline expiry and cancelled parent denial. PGlite and PostgreSQL/S3 each pass 21 tests / 174 assertions. Authority coverage is 59/59 lines and 16/16 functions. SDK build, all four type checks, lint, gate integrity and boundaries pass. Exact source and check receipts are `/tmp/factory-platform-evidence/root-child-authority-source.json` and `root-child-authority-integration-results.json`. Durable child creation and budget delegation remain open.

## Committed lazy-input authority — root
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [ ] Test an actual published lazy input command through the current run and immutable transition store.
- [ ] Share the committed-state transaction and compare every pending input coordinate.
- [ ] Reject stale, cancelled, foreign, wrong-kind and substituted pending reads.
- [ ] Verify PGlite, PostgreSQL/S3, coverage and all static checks before integration.

Plan review: a private command ID is the only request authority; the reader validates the durable artifact binding within the same run transaction.

# Factory release notification delivery (2026-09-13)

- [x] Reproduce the durable notification's absence from the in-app factory console.
- [x] Add a delivery adapter that reuses the existing durable queue and exposes only delivered actionable items.
- [x] Recheck current human grants and underlying approval/operation state in scoped release queries.
- [x] Add the session-only SDK/API/browser read path and route decisions through the existing assurance endpoint.
- [x] Add the factory console inbox with duplicate-safe approval and uncertain-release rendering.
- [x] Prove delivery, restart deduplication, foreign/revoked denial, real assurance decisions, and UI behavior.
- [x] Pass focused coverage, e2e, builds, all four typechecks, lint, boundaries, and patch coverage.
- [x] Commit an immutable notification-delivery checkpoint and record proof paths.

## Review

- Factory approval, uncertain-release, and settled-release notifications now use the existing durable release queue as the in-app inbox. Delivery is one atomic queued-to-delivered transaction. Reads authorize the current session user and load a bounded current-state projection in one transaction. Pending and uncertain items disappear when they stop being actionable; settled items remain completion receipts for principals with `factory.release`.
- The factory page shows the inbox and sends approval decisions through the existing assurance API. It exposes no archive, sender, provider-evidence, or pinned-material details. Restart delivery and browser merging retain one item per durable notification identity.
- PGlite passes 19 cases with 120 assertions, and isolated PostgreSQL passes 14 cases with 92 assertions. Focused SDK, web, OpenAPI, route, browser evidence, coverage, builds, all four type checks, lint, boundaries, patch coverage, and gate integrity pass. Proof paths and exact measured-line counts are in `tasks/factory/release-notification-delivery-GATES.md`.

## Committed human approval authority — root
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [ ] Prove exact current approval scope, choices, attempt, deadline and durable initiator through published lifecycle records.
- [ ] Provide the same current check inside the caller's decision transaction.
- [ ] Expose the verified compiled plan and durable initiator for runner policy without a second lookup.
- [ ] Verify PGlite/PostgreSQL, coverage and static checks.

Plan review: request authority comes from the committed interpreter. A later human decision separately requires current explicit factory.approve and the declared actor scope; its store writes the correlated event through the existing inbox in the same transaction.

# Factory assurance command dispatch (2026-09-13)

- [x] Inspect committed kernel command shapes, current C04 stores, transition indexing, run lifecycle, and root command authority.
- [x] Send the exact proposed adapter and required authority context to root before source edits.
- [x] Persist the exact current generic approval command and protected human context.
- [x] Return `null` for a pending human wait and one stable correlated event for the durable answer.
- [x] Extend the existing notification inbox, session API, SDK, browser client, and UI with exact declared choices.
- [x] Prove operator, owner, tenant administrator, foreign, revoked, tampered, rollback, duplicate, and replay behavior in PGlite.
- [x] Pass PostgreSQL, focused coverage, SDK build, all four type checks, lint, boundaries, patch coverage, browser evidence, and gate integrity.
- [x] Commit an immutable generic approval checkpoint with its integration contract and evidence.

## Plan review

- The first bounded leaf uses `FactoryCommandAuthority.withCurrentApproval` and the dormant C13 API contract. The store accepts only the trusted service and stored command reference. It locks current run authority before the approval row, stores the exact choices and review context, and writes the decision plus the existing interpreter inbox event in one transaction.
- A generic workflow approval is separate from C04 release consent. Acceptance and release commands remain later leaves because their committed command shapes do not yet identify an exact producer candidate and prepared release operation.

## Review

- A current generic approval command now creates one protected pending decision. The store obtains its command, node, attempt, fence, choices, actor scope, context, and initiator from `FactoryCommandAuthority`; it accepts no caller evidence. A pending execution returns `null`.
- A current human with explicit `factory.approve` can choose only a declared answer. Owner review also requires the durable run initiator. Tenant-contract-admin review also requires current `factory.trust`. The decision transaction locks run authority before the approval and inbox rows, then commits one audited decision and one stable `approval-decided` event. Exact retries reuse that row and event after current reviewer authorization.
- The existing factory inbox and session API expose the generic request beside release notifications. Foreign and revoked principals cannot read or decide it. Release approval remains a separate C04 consent path.
- PGlite and isolated PostgreSQL each pass 26 lifecycle cases with 248 assertions. Focused SDK, migration, release, API, web, Chromium, coverage, build, all typecheck legs, lint, boundaries, patch coverage, and gate integrity pass. Exact commands, logs, measured lines, and source hashes are in `tasks/factory/generic-command-approval-GATES.md`.

## Atomic terminal budget receipts — root

- [x] Prove settlement and envelope closure roll back with their enclosing receipt transaction.
- [x] Reuse the existing budget settlement and closure logic through transaction-scoped entry points.
- [x] Snapshot caller scope and usage before asynchronous transaction admission.
- [x] Verify PGlite/PostgreSQL, exact coverage and static checks.

Plan review: terminal journal and child completion must commit measured usage, release the hold and publish the completion receipt together. These entry points preserve existing trusted-receipt and unknown-hold rules.

Review: settlement and envelope closure now accept the caller transaction, while public calls reuse those same implementations and capture caller-owned scope/usage before awaiting. A failed terminal receipt rolls both settlement and child-to-parent spent transfer back; exact retry settles once after revocation, and unresolved usage retains its hold. PGlite and PostgreSQL each pass 11 tests / 64 assertions. Budget coverage is 178/178 lines and 54/54 functions. SDK build, all four type checks, lint, gate integrity and boundaries pass. Exact source and exits: `/tmp/factory-platform-evidence/root-terminal-budget-source.json` and `root-terminal-budget-integration-results.json`.
## Factory product compute-admission dispatcher

- [x] Add canonical, scoped compute-admission persistence and migration/schema parity.
- [x] Enlist the exact request inside the task budget transaction through a stable public seam.
- [x] Claim fair due work without holding product locks during pool HTTPS calls.
- [x] Recover queued and lost responses only by replaying the exact original pool request.
- [x] Commit a confirmed allocation, running budget, stable admission event, and inbox delivery atomically.
- [x] Cancel remote allocations after authority loss while retaining the product budget hold.
- [x] Prove terminal receipt replay, competing polls, corruption fences, and foreign service denial.
- [x] Run actual PostgreSQL and pool HTTPS recovery tests, coverage, schema parity, builds, types, lint, boundaries, and gate integrity.
- [x] Record review and create an immutable checkpoint.

Plan review: the product row is enlisted with the held budget before the pool command becomes visible. A short committed poll lease protects fair selection, but every HTTP call runs without a database lock. Only an exact request replay can recover an admitted token. The first admitted commit uses command authority, then locks budget, compute state, and inbox in that order. A stored terminal receipt needs only the trusted installation service check because the kernel is expected to advance after admission.

Review: `FactoryComputeAdmissions` now records one canonical request beside the held product budget, drains the installation pool outbox into a fair durable poll queue, and replays only that exact request to recover a token-bearing lease. The admitted commit rechecks the current command, marks the budget running, stores stable response/event bytes, and enqueues the inbox decision in one transaction. Authority loss cancels known remote allocations while retaining the hold; uncertain cancellation remains recoverable. The transaction-bound admitted reader locks budget before compute state and verifies the stored token and generation before runner admission. The final producer passes 33 tests with 231 assertions across focused PGlite, isolated PostgreSQL, actual Bun mTLS, and actual command authority. Owned coverage is 306/306 lines; the dispatcher also measures 68/68 functions. PostgreSQL schema parity passes two tests with 1,638 assertions. All four typecheck legs, lint, boundaries, gate integrity, and registration tests pass. Coverage is at `/tmp/factory-compute-admissions-final/lcov.info`.

## Task-to-compute transaction wiring — root
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [ ] Prove task admission can be dispatched without a separate manual enlist transaction.
- [ ] Require the concrete compute admission store in task admission and enlist before outbox enqueue.
- [ ] Prove outbox/enlist failures roll back the budget and all compute facts.
- [ ] Validate the combined approval, attempt queue, compute, notification and repaired Node changes.

Plan review: there must be no configuration path that creates a held task budget and pool outbox entry without its recoverable compute row.

## C07 authoritative lazy command execution — Terra
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Validate durable artifact descriptors and inline values separately, so required artifact ports do not need placeholder JSON in lifecycle or kernel state.
- [x] Define the authority callback contract and match a stored lazy command to the current committed pending state.
- [x] Add a DB-transactional `lazy-commands.ts` adapter that maps only verified reader output to bounded kernel events.
- [x] Prove PGlite, PostgreSQL/S3, and private HTTPS generic-command behavior including stale, cancelled, substituted, version, and oversized denials.
- [ ] Run owned coverage, SDK build, all canonical typechecks, lint, and integrity checks.

Review: the lazy command adapter accepts only an opaque trusted command reference. It loads the exact current pending command within command authority's lifecycle transaction, reads the pinned durable artifact through the grant-aware reader, and emits one bounded canonical kernel event. The lifecycle and kernel now validate artifact descriptor facts separately from strict inline values, so a required large artifact can start without a placeholder. Final evidence: PGlite command/lifecycle suites, PostgreSQL/S3 command conformance, SDK build, all four typecheck legs, lint, adapter coverage, and the locked repair replay test are recorded in `/tmp/factory-platform-evidence/terra-lazy-commands-*`.

## C07 durable child runs and delegated budgets — Terra
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Inspect C03/F03 and the current command, lifecycle, and same-run budget models.
- [ ] Add an immutable parent-command to child-run binding with scoped foreign keys and migration parity.
- [ ] Create the pinned child run, lifecycle, root outbox, and bounded delegated budget in the parent command authority transaction.
- [ ] Settle child spending into the reserved parent sub-envelope only after all child holds resolve.
- [ ] Prove retries, restart, concurrent exhaustion, cancellation, repair, deadline, wrong definitions, PGlite, PostgreSQL/S3, coverage, types, and lint.

Plan review: the parent command ID remains the only child-start authority. A child owns a separate logical run and root envelope, while the parent reserves exactly that envelope through a same-run child sub-envelope. Settlement transfers only verified child spending and returns unused allowance; no child receives fresh parent limits.
## Terminal invalid-input startup — root
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [ ] Turn initial kernel input validation failure into a non-retryable workflow failure.
- [ ] Prove undeclared durable input creates no transition or effect through actual Temporal.
- [ ] Re-run the full canonical Node coverage lane, web checks and static checks.

Review in progress: current-root canonical Node run exposed a lazy-parent fixture with an undeclared data port. Kernel initialization threw outside the workflow error boundary, so Temporal retried workflow tasks indefinitely. The original logs and verified producer interruption are retained under `/tmp/factory-platform-evidence/root-compute-lazy-approval-fixed-node-*`. The fixture now declares its port and production startup converts invalid kernel input to `FACTORY_INPUT_INVALID`.

## Production factory pool process

- [x] Define the strict reference-only process configuration and startup contract.
- [x] Validate private database, TLS, token, identity, and static resource configuration before bind.
- [x] Bind the configured installation and pool to the durable database and reject unsafe restart changes.
- [x] Publish honest atomic readiness and stop on database, listener, or shutdown failure.
- [x] Reuse the existing Bun mTLS pool server and normalized Bun PostgreSQL adapter.
- [x] Prove fresh subprocess startup, exact request recovery, restart fences, bad material, bad tokens, and shutdown against PostgreSQL.
- [x] Document the exact launch and private file requirements.
- [x] Run focused coverage, schema/static gates, and create an immutable checkpoint.

Plan review: use one strict private config that contains only identities, static resources, and file references. Verify every referenced secret and the exact PostgreSQL database and role before the listener binds. Persist the installation and pool identity in the pool database, retain all durable allocations on restart, and reject resource removal. Publish readiness only after schema setup, resource checks, and the real mTLS listener succeed.

Review: the Bun pool process reads one strict private config, verifies the exact PostgreSQL database and role, validates its TLS and RSA trust material, binds the database to one installation and pool, applies the existing pool schema and explicit resource inventory, and then starts the existing mTLS handler. Restart preserves durable allocations and rejects resource or host removal. An atomic readiness file becomes ready only after the database, schema and listener are live; heartbeat, listener-close and database-close failures degrade and exit nonzero. The canonical pool producer passes 65 tests with 430 assertions across PGlite, isolated PostgreSQL, Bun mTLS, Node mTLS and the fresh subprocess. All ten pool source records are at 100% line coverage in `/tmp/factory-pool-process-final/lcov.info`. Frozen installs, builds, all four type checks, lint, boundaries, registration, required-check tests and gate integrity pass.

## Host input resolution for application boot — root

- [x] Prove the application can start a run with required large artifact input through its concrete default resolver.
- [x] Share the immutable input loader between admission and later lazy reads.
- [x] Validate real artifact bytes against the published port schema while keeping only descriptors in workflow input.
- [x] Reject foreign, revoked, corrupt and noncanonical inputs before any run or budget is committed.
- [x] Verify PGlite, PostgreSQL/S3, measured coverage, all four type checks and static gates.

Plan review: the application must construct a real input resolver from its scoped artifact and grant stores. The host checks full immutable bytes once at admission; the workflow receives bounded inline values and exact artifact descriptors. Existing low-level lifecycle resolver seams remain available for controlled store tests.

Review: application composition now provides a concrete host input resolver. Admission and later lazy reads share one exact local/shared immutable artifact loader. Actual canonical I-JSON bytes satisfy the published port schema; only inline values and descriptors enter the durable start. Foreign or revoked shares, altered digest/storage, wrong ports and malformed JSON fail before a run is committed. PGlite integration passes 47 tests / 317 assertions; PostgreSQL and real ordinary S3 pass 39 tests / 262 assertions. Input loader coverage is 39/39 lines and 7/7 functions; run resolver is 25/25 and 4/4; shared lazy reader is 122/122 and 25/25. Application composition is 99/99 lines and 24/25 functions. SDK build, all four types, lint, gate integrity and boundaries pass. Exact source and exits: `/tmp/factory-platform-evidence/root-run-inputs-source.json` and `root-run-inputs-integration-results.json`. Full production startup remains open.

## Parent integration proof — input resolver and task admission

- [x] Verify current merged source `106371c8ce53651e398614e1bcd11d7aa1d865cc` with focused PGlite and all 18 canonical factory PostgreSQL/S3 files.
- [x] Verify SDK build, all four typechecks, lint, gate integrity, boundaries, and actionlint.
- [x] Verify 33 focused web cases, the real Chromium release-inbox interaction, and inspect its captured image.
- [x] Run the full canonical backend suite.

Review: focused PGlite 41 passed / 369 assertions; PostgreSQL/S3 120 passed / 2,587 assertions. Static checks passed. Chromium passed 1 case after selecting unused port 19873; the first attempt failed because port 4173 was occupied. The preserved PNG is `/tmp/factory-platform-evidence/root-release-inbox-authorized.png`. Backend passed 26,231 tests with zero failures across 1,727 files. Receipts: `root-input-execution-combined-integration-results.json` and `root-input-execution-remainder-integration-results.json` under `/tmp/factory-platform-evidence`. These proofs close this integration batch, not the full feature or its open launch gates. The new successful task-completion leaf is still under test in the side worktree.

## C07 durable child runs and delegated budgets — final review

- [x] Persist and seal each child inherited start clock; reject legacy rows without an explicit backfill.
- [x] Verify sealed ancestor source heads before child task authority.
- [x] Prove nested child clocks, parent supersession, deadline denial, unknown-hold denial, sibling held/retry progress, and nonzero settlement.
- [x] Run PGlite, PostgreSQL/S3, migration restart, changed-source LCOV, SDK build, all canonical typechecks, and lint.

Review: final source coverage is 100% for `child-runs.ts`, `command-authority.ts`, `run-lifecycle.ts`, `factory-schema.ts`, and the child start-clock migration. The registration lines in `migrate.ts` are exercised by the full migration restart test; its whole-file aggregate is 95.93% because the module has unrelated historical branches.

## C07 durable child review corrections

- [x] Keep a child attempt live across unrelated parent audit-head advances.
- [x] Reject the child after an actual repair replaces its sealed parent attempt.
- [x] Make concurrent terminal settlement converge on one stored receipt.
- [x] Register 100% coverage thresholds for child binding and all three migrations.

Review: ancestor validation loads the stored sealed `run-child` command, reads the latest verified parent transition, and applies the same attempt checks used by command authority. This permits harmless parent progress but rejects replaced, stopped, cancelled, expired, or mismatched attempts.
## Durable successful task completion — root

Plan review: test the public completion boundary with a published factory, admitted task, real durable journal, immutable output, budget ledger, and inbox. A retry must return the saved event after the interpreter advances. The completion transaction must roll back every product fact on failure. Runner launch and failed/uncertain terminal recovery remain separate open leaves.

- [x] Reproduce a successful admitted task that has no durable completion adapter.
- [x] Commit exact terminal evidence, measured spend, bounded workflow result, and sealed retry receipt in one transaction.
- [x] Prove retry, corruption, cancellation, output limits, and write-fault rollback with PGlite and PostgreSQL/S3.
- [x] Verify changed-source coverage, all four typechecks, lint, gate registration, and integration.
- [x] Record exact evidence and review the completed leaf.

Validation checkpoint: full SDK 160 passed / 1,192 assertions; focused product and registration 47 passed / 421 assertions; PostgreSQL/S3 plus schema parity 46 passed / 2,090 assertions. SDK build, all four typechecks, lint (zero errors / eight existing infos), gate integrity, and boundaries passed. Both database producers report task-completions 79/79 lines and 18/18 functions, migration 4/4 and 2/2; shared command authority 88/88 and 26/26, artifacts 106/106 and 28/28, input artifacts 39/39 and 7/7. Source snapshot and exact results: `/tmp/factory-platform-evidence/root-task-completion-final-source.json` and `root-task-completion-final-integration-results.json`. Committed patch/new-file coverage and parent integration remain pending.

Committed review: `a7dae2809` passed merged new-file and patch coverage gates (`root-task-completion-committed-coverage-results.json`). Its clean committed source is recorded in `root-task-completion-final-source.json`; the earlier broad log records its pre-commit base separately. Parent integration with child runs, native policy, and generic approvals is documented below. Full launch and non-success terminal handling remain open.

## Parent integration — native policy, child runs, successful completion
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Preserve the first combined-suite failure and reproduce it in the lifecycle lane.
- [x] Use the concrete native policy in the shared completion fixture.
- [ ] Finish combined PostgreSQL/S3, types, static checks, Node orchestration, and coverage.

Review checkpoint: combined source `965deee9e` failed because the completion fixture omitted the now-required native resource resolution. This also left an unprojected fixture run before the fairness test. The corrected fixture uses `FactoryNativeRunnerPolicy`; the lifecycle lane passes 30 tests / 323 assertions with no failures. Both logs are retained under `/tmp/factory-platform-evidence/root-child-completion-*`.

# Factory assurance command dispatch (2026-09-13)

- [x] Inspect committed kernel command shapes, current C04 stores, transition indexing, run lifecycle, and root command authority.
- [x] Send the exact proposed adapter and required authority context to root before source edits.
- [x] Persist the exact current generic approval command and protected human context.
- [x] Return `null` for a pending human wait and one stable correlated event for the durable answer.
- [x] Extend the existing notification inbox, session API, SDK, browser client, and UI with exact declared choices.
- [x] Prove operator, owner, tenant administrator, foreign, revoked, tampered, rollback, duplicate, and replay behavior in PGlite.
- [x] Pass PostgreSQL, focused coverage, SDK build, all four type checks, lint, boundaries, patch coverage, browser evidence, and gate integrity.
- [x] Commit an immutable generic approval checkpoint with its integration contract and evidence.

## Plan review

- The first bounded leaf uses `FactoryCommandAuthority.withCurrentApproval` and the dormant C13 API contract. The store accepts only the trusted service and stored command reference. It locks current run authority before the approval row, stores the exact choices and review context, and writes the decision plus the existing interpreter inbox event in one transaction.
- A generic workflow approval is separate from C04 release consent. Acceptance and release commands remain later leaves because their committed command shapes do not yet identify an exact producer candidate and prepared release operation.

## Review

- A current generic approval command now creates one protected pending decision. The store obtains its command, node, attempt, fence, choices, actor scope, context, and initiator from `FactoryCommandAuthority`; it accepts no caller evidence. A pending execution returns `null`.
- A current human with explicit `factory.approve` can choose only a declared answer. Owner review also requires the durable run initiator. Tenant-contract-admin review also requires current `factory.trust`. The decision transaction locks run authority before the approval and inbox rows, then commits one audited decision and one stable `approval-decided` event. Exact retries reuse that row and event after current reviewer authorization.
- The existing factory inbox and session API expose the generic request beside release notifications. Foreign and revoked principals cannot read or decide it. Release approval remains a separate C04 consent path.
- PGlite and isolated PostgreSQL each pass 26 lifecycle cases with 248 assertions. Focused SDK, migration, release, API, web, Chromium, coverage, build, all typecheck legs, lint, boundaries, patch coverage, and gate integrity pass. Exact commands, logs, measured lines, and source hashes are in `tasks/factory/generic-command-approval-GATES.md`.

## Parent integration — generic approvals and child completion

- [x] Merge the Sol generic approval and Terra child bindings with root task completion.
- [x] Preserve and repair combined fixture and database model defects.
- [x] Pass SDK, product, PostgreSQL schema, all four types, lint, boundary and Node checks.
- [x] Pass web components, route registry, Playwright Chromium, and inspect the captured image.

Review: focused product source `d19468631` passed 67 tests / 579 assertions. All 18 canonical PostgreSQL/S3 files ran: 128 tests passed; one schema assertion exposed the child definition default mismatch. Correction `fa766f7e8` passed both canonical schema tests, all four typechecks, lint, gate integrity, boundaries, orchestrator build, and all 77 Node tests. The original failed log remains available. Web component/API selection passed 35 tests across four files. The separate Bun route registry passed; it is not part of the Vitest selection. The Chromium approval inbox passed and its image was inspected at `/tmp/factory-platform-evidence/root-generic-approval-parent-inbox.png`. No clipped controls or overlap was seen. The generic context is displayed as compact JSON; review its readability in the final UI pass.

Receipts: `/tmp/factory-platform-evidence/root-product-command-merge-combined-integration-results.json`, `root-product-command-merge-remainder-integration-results.json`, `root-generic-approval-parent-remainder-integration-results.json`, and `root-generic-approval-parent-route-registry.log`. This integration proof does not close the platform launch gates or the new private runtime dispatch leaf.

## Private GitHub publication environment
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Create a private disposable publication-test repository as authorized by the user.
- [x] Verify actual private visibility and the default branch through the GitHub API.
- [x] Record repository and existing credential references without secret values.
- [ ] Prove the real protected release-adapter path against the new repository.

Review: `ezcorp-org/factory-platform-publication-tests` is private with default branch `main`. Existing GitHub CLI credentials are referenced by `/home/dev/.config/gh/hosts.yml`. No publication-test PR has been created yet.
## Factory trusted validator materials — 2026-09-13

- [x] Reproduce that callback-supplied validator JSON can currently become acceptance evidence without a concrete trusted attempt.
- [x] Add immutable compiled validator materials, admitted-attempt assignments, and terminal-derived validator results.
- [x] Bind human contract approval to exact registered compiled material and active release trust.
- [x] Prove current candidate, runner, environment, configuration, artifact, measured terminal, grant, freshness, and retry fences.
- [x] Prove migration parity and real PostgreSQL/S3 behavior.
- [x] Run focused coverage, all four typecheck legs, lint, gate, and module-boundary checks; record the review.

Plan review: use the published compiled acceptance contract and constructor-owned trusted runtime inventory. The candidate artifact comes from the current sealed release candidate. The validator result comes from an assigned admitted attempt's measured terminal. Release enable remains a dispatch fence and does not block validation. Root task completion and boot remain unchanged.

Review: a contract can now be approved only when it matches immutable material rebuilt from the exact published compiled factory. The gateway assigns one exact current candidate and protected claim to an admitted validator request with a constructor-owned runner/runtime lock. It then derives evidence only from the journal's verified measured completion and the immutable host artifact, and seals the first database issuance time for stable retries. PGlite focused integration passes 35 tests / 190 assertions; isolated PostgreSQL and ordinary S3 pass 4 tests / 20 assertions; PostgreSQL schema parity passes 2 tests / 1,897 assertions. Focused LCOV measures validator materials 243/243 lines, its migration 8/8, and release authority 202/202. All four type checks, lint, registration, factory boundaries, and gate integrity pass. Root production composition and the full C04 release journey remain separate work.
## Private command dispatch composition — root

Plan review: the private gateway routes only a stored command reference. Test its public execution boundary against the existing published lifecycle, committed transition, task admission, lazy input, child, and approval stores. The constructor requires explicit handlers for cancellation, protected assurance/release, and partition delivery; it must never accept a missing effect handler or dispatch an orchestration-local command. The root runtime will provide those concrete effect bindings in its following composition leaf.

- [x] Add a scoped immutable command router over existing product handlers.
- [x] Prove actual durable task admission, generic approval, lazy input, and child resolution through the router.
- [x] Reject missing handlers, foreign service/scope, wrong command class, and mutable references.
- [x] Verify PostgreSQL/S3, measured coverage, SDK build, all four types, lint, and parent integration.

Private dispatch validation: PGlite 40/506 assertions; PostgreSQL/S3 40/2,380; router 46/46 lines and 13/13 functions. SDK build, all four types, lint, boundaries, and gate integrity passed. The first type failure was a unit fixture missing the complete child source envelope; the corrected replay passed. Exact receipts are recorded in tasks/factory/private-command-dispatch-GATES.md. Parent integration remains open.

## Parent integration — command routing, validator evidence, and attempt dispatch

- [x] Merge immutable Sol validator and dispatcher leaves, current-approval correction, and root private command routing.
- [x] Preserve all concurrent fixture and task changes while resolving integration conflicts.
- [x] Pass product/database integration, both builds, four type checks, static checks, real Node orchestration, and committed patch/new-file coverage.

Review: source ac656591e passed 124 product tests / 1,171 assertions and 142 PostgreSQL/S3 tests / 3,410 assertions across all 19 registered PostgreSQL files. SDK and orchestrator builds, all four type checks, lint, boundaries, and gate integrity passed. Node passed 77 tests with zero failures in 110,428 ms. Patch/new-file coverage passed against fe7be0bbe. Receipts: /tmp/factory-platform-evidence/root-private-validator-dispatch-merge-combined-integration-results.json and root-private-validator-dispatch-merge-coverage-results.json. These results close this integration batch. The subsequent real partition-start test exposed a command-count defect now being fixed in the root side worktree; full startup, end-to-end journeys, soak, and all platform launch gates remain open.
## Durable partition command delivery — root
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

Plan review: send only exact committed partition notifications and invalidations through the existing transactional inbox/outbox. Keep the source event clock stable across retries; accept a completed source only for its still-current compiled edge and terminal generation. The destination can be unstarted. Reuse the shared command authority reader; the Sol control leaf owns that reader extension.

- [x] Reproduce the missing product notification boundary with published partitioned plans.
- [x] Add the bounded effect adapter over current command authority and the existing inbox.
- [x] Prove duplicate/harmless-progress delivery, completed-source delivery, repair invalidation, foreign scope, tamper, and rollback.
- [ ] Pass PGlite, real PostgreSQL/S3, Node transport, changed-source coverage, types, lint, and parent integration.

Partition delivery reproduction exposed a prior integration defect: the product command index rejected a valid published partition start because its batch contained more than 32 commands. C08 limits simultaneous activities to 32 and the whole batch to 512 KiB. The root correction preserves byte limits and unique bounded command identities; validation is pending. The original failed receipt is /tmp/factory-platform-evidence/root-partition-delivery-red.log.

Partition batch correction review: 60 focused product/artifact/private-service tests passed with 744 assertions. PostgreSQL/S3 plus schema passed 49 tests / 2,769 assertions. SDK build, all four type checks, lint, boundaries, and gate integrity passed. Exact source snapshot and receipts are /tmp/factory-platform-evidence/root-partition-batch-correction-source.json and root-partition-batch-correction-integration-results.json. This corrects command persistence only; the original partition effect test is retained separately for the following adapter leaf.

## Parent validation — partition authority and batch correction

- [x] Integrate the partition authority reader with verified stored command coordinates and live child ancestry.
- [x] Prove valid batches above 32 commands through published partition storage.
- [x] Pass product/artifact/private-service and PostgreSQL/S3 checks, then repair the single inferred fixture-port type and replay all four type checks.
- [x] Pass static and committed patch/new-file coverage gates.

Review: source 0c7219dca passed 61 product tests / 750 assertions and 50 PostgreSQL/S3/schema tests / 2,775 assertions. Type checks found only an inferred optional undefined output port in the new authority fixture. Correction cf4984b49 passed all four type legs, lint, boundaries, and gate integrity. Merged patch/new-file coverage against fa47daaaf passed. Receipts: /tmp/factory-platform-evidence/root-partition-authority-parent-integration-results.json, root-partition-authority-types-remainder-integration-results.json, and root-partition-authority-parent-coverage-results.json. The new end-to-end partition delivery adapter is still under test; its repair trace exposed a separate kernel generation notification defect.
## C05 factory v4 package preparation — Terra
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Include the complete canonical runner reference in every preparation identity and prove independent configuration revocation.
- [x] Replace C04 release trust and local readiness with tuple-scoped runner trust and durable receipt facts.
- [x] Seal durable build intents before external work; recover the same build identity after restart.
- [x] Prove independent runner-tuple revocation and all required storage/runner gates.
- [x] Define the scoped immutable v4 release mapping and sealed receipt schema.
- [x] Add a production catalog adapter that reads the existing v4 repository and blob store without copying release storage.
- [x] Create a two-phase preparation flow: durable intent, out-of-transaction RunnerClient build/collect, then revalidated receipt commit.
- [ ] Wrap the existing trusted runner so dispatch requires a matching current prepared receipt and cannot run after trust or grant revocation.
- [ ] Prove PGlite, PostgreSQL/S3, real Podman preparation/recovery, revocation, coverage, SDK build, type checks, and lint.

Plan review: v4 source and artifacts remain in the established immutable repository. Factory state records only the scoped source mapping, the exact trust revision, and the verified local build receipt. No runner build or blob read occurs under a product transaction.

Correction review: `FactoryPackageTrusts` stores a sealed revision and current pointer for each complete runner tuple. It uses the existing factory mutation, audit, human tenant-administrator, and `factory.trust` grant rules; C04 release trust remains unchanged. A receipt is now the only readiness fact. Before any external build, preparation commits one sealed intent containing the exact binding authority plus release, source, artifact, image, manifest, evidence, trust, entrypoint, and build facts. A restart uses that same build identity; receipt insertion and intent completion are one transaction. The focused PGlite migration/flow proof passes 3 cases and 27 assertions, PostgreSQL plus ordinary S3 passes 2 cases and 26 assertions, and real Podman passes 1 case. The PGlite proof simulates a process crash after intent persistence, checks restart identity, prepares two tuple exports concurrently, and revokes only the first while the second remains ready. Focused coverage is 84/84 package-preparation and 14/14 migration executable lines at `/tmp/factory-platform-evidence/terra-c05-package-trust-coverage/lcov.info`. All four typecheck legs, lint, factory boundaries, and gate integrity pass; lint reports eight existing infos.

Full-reference correction: every package preparation primary key and foreign key now includes the canonical reference digest, and bindings preserve canonical reference JSON for validation. The PGlite and PostgreSQL/S3 flows use the same package/export with a different model and configuration digest, prepare both concurrently, then revoke one while the other remains ready. Final coverage is 87/87 package-preparation and 14/14 migration executable lines at `/tmp/factory-platform-evidence/terra-c05-package-trust-full-reference-coverage/lcov.info`.

## C02 fresh Bun/Python launcher — Terra
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [ ] Map the native runner, Python process, V4 package receipt, pool, task completion, and dispatcher seams.
- [ ] Agree the trusted run request, result, artifact, usage, checkpoint, reattach, and pool lifecycle contract.
- [ ] Implement one fresh isolated Bun/Python attempt launcher with receipt readiness and broker-only effects.
- [ ] Prove real CPU no-GPU fail-closed, Podman/Python execution and recovery, then supported AMD GPU execution for the first ten local installations.
- [ ] Run focused coverage, PostgreSQL/S3, canonical static checks, and lint.

## C05 parent review — dispatch readiness

- [x] Reproduce revoked-trust resurrection through the real dispatch-readiness method.
- [x] Reject a current pointer that does not name the latest immutable trust revision.
- [x] Prove receipt rollback, live authority revocation, independent model/configuration identity, and damaged seals on PGlite and PostgreSQL/S3.
- [x] Register preparation in the required PostgreSQL coverage job and verify combined source types, lint, migrations, and coverage.

Plan review: reuse the existing package fixture and transaction boundary. Preserve failed evidence and keep overall C05 readiness open until the combined checks pass.

Parent review: dispatch now rejects a rolled-back trust pointer unless it names the latest immutable revision for the complete runner reference. The catalog checks the installation project on bind and reuse. Concurrent workers return one committed receipt, and receipt reuse verifies the current release evidence. Shared fixtures cover transaction rollback, trust/grant/admin revocation during hydration, independent model and configuration identity, and damaged trust/intent/receipt seals. PostgreSQL exposed three missing modeled foreign keys; schema now records them and the existing v4 installation table. The required PostgreSQL/S3 job includes preparation.

Validation: 17 focused checks / 62 assertions and 16 PostgreSQL/schema checks / 2,419 assertions pass. Package preparation measures 95/95 lines and 70/70 functions; the migration measures 14/14 lines and 2/2 functions. SDK build, all four type checks, lint, gate integrity, and boundaries pass. Source snapshots and raw results: /tmp/factory-platform-evidence/root-package-scope-concurrency-parent-source.json and root-package-scope-concurrency-parent-integration-results.json. Original red receipts remain under root-package-trust-pointer-red, root-package-scope-concurrency-red, and root-package-receipt-reuse-red. Parent combined SDK/Node replay and full runtime composition remain open.
Partition delivery adapter review: 68 product/artifact/private-service/registration tests pass with 817 assertions; 53 PostgreSQL/S3 tests pass with 754 assertions. Six focused paths cross the actual private Node TLS connection where applicable; forged payload values do not replace stored commands, and inbox confirmation remains false until the successor transition records the exact event. Immediate recomputation after repair emits a new generation notification, and failed source notification is retained. Adapter coverage is 23/23 lines and 4/4 functions. All four type checks, lint, boundaries, and gate integrity pass after narrowing the test connection helper to its actual artifact dependency. Raw evidence: /tmp/factory-platform-evidence/root-partition-delivery-full-integration-results.json and root-partition-delivery-types-remainder-integration-results.json. Parent integration and committed patch/new-file coverage are the next checks; overall runtime boot remains open.
# Protected acceptance and release commands — Sol

- [x] Merge the immutable integrated base and map the exact protected command, terminal, assurance, and release contracts.
- [x] Add current-command authority for acceptance and release without trusting command payloads as authority.
- [x] Implement durable, idempotent acceptance and release effects from protected candidate and policy facts.
- [x] Prove replay, stale command, foreign service, candidate/source mismatch, validator trust, and no-publication behavior.
- [x] Run PGlite, PostgreSQL/S3, owned coverage, builds, all four type checks, lint, boundaries, and gate integrity.

Plan review: acceptance returns a node result only after the exact current candidate satisfies the approved compiled contract with pinned trusted validator material. Release prepares the protected operation and returns no node result until a later trusted publication result exists. Both handlers derive identity from the stored command reference and current interpreter state.

Review: the private effects now derive the current producer from compiled value sources and the sealed interpreter attempt, verify its immutable task completion, advance the release candidate with the verified journal result, and accept only against the current approved protected contract. Release preparation re-derives the exact acceptance receipt and pinned material, then uses a constructor-owned adapter profile for its action, destination request, and bounded cost. Durable receipts preserve exact replay after harmless source-head progress. No provider dispatch or release result is fabricated. Optional protected quorum claims remain registered and evaluated, and a rolled-back mutable trust pointer fails closed unless it names the latest immutable revision.

PGlite integration passes 81 tests / 785 assertions. The focused LCOV run measures the protected command effects at 139/139 lines and 31/31 functions, provenance at 72/72 and 9/9, the migration at 4/4 and 2/2, task completions at 82/82 and 20/20, validator materials at 242/242 and 55/55, and release authority at 206/206 and 45/45. The clean PostgreSQL/S3/schema replay passes 79 tests / 2,891 assertions. The SDK build, all four typecheck lanes, lint, boundaries, schema import test, registration test, and gate integrity pass.

## Parent integration — package, outcome, partition, and protected effects
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Merge package authority corrections, non-success task outcomes, durable partition effects, and protected acceptance/release commands.
- [x] Validate the merged product, PostgreSQL/S3, all four type checks, lint, builds, and boundary checks.
- [ ] Close committed patch coverage after the uncovered authority/input paths and structural type-only gate correction.

Review: source 57751b80b passed 165 SDK tests, 161 product tests, 164 PostgreSQL/S3/schema tests, one real Podman package test, and 78 real Node tests, with both builds, all types, lint, boundaries, and gate integrity. Source 84cfd2a99 then integrated protected commands and passed 172 product tests / 1,462 assertions and 166 PostgreSQL/S3/schema tests / 3,984 assertions, SDK build, all types, lint, boundaries, and integrity. Existing SDK and Node reports are reused only for files whose source bytes match the producing revision.

Committed new-file coverage passes. Patch coverage against 644987ada found an untested protected-input exception, an uncalled acceptance authority wrapper, and an existing gate inconsistency for the declaration-only kernel types file. Sol owns the behavior tests and reuse of the gate's existing structural declaration check; no exclusion or synthetic coverage is permitted. Evidence: /tmp/factory-platform-evidence/root-package-outcome-partition-merge-combined-integration-results.json, root-protected-effects-parent-combined-integration-results.json, and root-protected-effects-parent-coverage-results.json. All platform launch gates remain open.

## Provider receipt verification and GitHub publication — root
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

Plan review: reuse the existing release store, broker credential/egress boundary, and provider adapters. The user authorized private GitHub publication tests and local S3. Test the existing public release application/store seam, then the actual provider boundary. No additional approval is needed for these tests.

- [x] Reproduce an unverified attached receipt through the release reconciliation path.
- [x] Require bounded provider verification before accepting a receipt; prove uncertainty, tamper, timeout, and exact version checks with real S3.
- [ ] Extend the v4 GitHub broker with immutable candidate, branch, tested-base, draft PR, and lost-response contracts.
- [ ] Prove disposable publication against the private test repository and record provider receipts.
- [ ] Pass focused and PostgreSQL/S3 coverage, all type checks, lint, and parent integration.

Review: pending.

Receipt verification review: the original reconciliation test resolved a fabricated receipt as success. The store now requires bounded provider confirmation before any archive or success mutation. S3 derives the expected receipt from the exact returned object version, digest, and media type, then compares all receipt fields. Uncertainty survives rejection and timeout. The focused store/adapter/application run passes 24 tests / 161 assertions; PostgreSQL passes 15 tests / 99 assertions; all four type checks, lint, boundaries, and gate integrity pass. Live S3 uses all ten tenant identities: ten publications, ten archived receipts, ten verified receipts, forty rejected altered receipts, and three foreign-access denials. A subsequent adapter test also proves the old exact version remains verifiable after the current object changes and that a media-type mismatch fails. Adapter coverage is 101/101 lines and 28/28 functions. Raw results: /tmp/factory-platform-evidence/root-provider-receipt-final-combined-integration-results.json, root-provider-receipt-version-final.log, and root-provider-receipt-s3-live.json. Final committed patch checks and parent integration remain pending.

## Shared GitHub publication transport — root
Absorbed by the 2026-09-13 completion plan; status tracked under 'Leftover after wave 4' below (audit 2026-10-03).

- [x] Extract the existing project broker's host credential, authorization, bounded egress, and no-retry behavior into one shared transport.
- [x] Prove request capture, foreign-path denial, credential/error containment, and all prior pull-request decision behavior.
- [x] Pass four type checks, lint, gate integrity, and factory boundaries.
- [ ] Pass committed patch/new-file coverage and merged parent tests.

Review: eleven existing/new broker transport tests pass with 71 assertions. The shared transport measures 18/18 lines and 5/5 functions; its explicit floor is 100. Test evidence: /tmp/factory-platform-evidence/root-github-transport-red.log, root-github-transport-green.log, root-github-transport-coverage/lcov.info, and root-github-transport-final-combined-integration-results.json. The GitHub immutable branch/PR provider, async manifest resolver, and real publication proof remain the next leaf.


# Authorized run repair and replan controls (2026-09-13)

- [x] Reproduce the current repair request returning 503 through the shared session HTTP handler.
- [x] Inspect C07/C09, public run-control types, kernel events, lifecycle locks, mutation receipts, transition state, inbox, and outbox.
- [x] Send the exact authority, revision, event identity, and transaction proposal before source edits.
- [x] Resolve the missing parameterized-repair and validated-replan kernel contracts without fabricating behavior.
- [x] Add one strict current-node authority reader over committed transition artifacts.
- [x] Commit an authorized control request, lifecycle revision, audit entry, inbox event, and durable command receipt atomically.
- [x] Expose repair and replan through the existing API and browser client without new privileged tools.
- [x] Prove current authority, idempotent replay, revision races, cancellation, revocation, protected effects, foreign nodes, bounds, tampering, and rollback in PGlite and PostgreSQL.
- [x] Pass SDK build, all four type checks, lint, boundaries, focused and patch coverage, route contracts, and browser evidence.
- [x] Record final proof and create an immutable checkpoint.

## Plan review

- A run control is an ordered kernel event, not a direct product-state transition. The product transaction rechecks both the pinned run initiator and the current requester, pins the latest committed node state, advances the human-visible lifecycle revision, and enqueues the exact event through `FactoryInbox`.
- The current SDK can apply only a parameterless `repair` event. It has no `replan` event or validated replacement-plan reference. The implementation must first close these SDK contracts; it must not discard public parameters or encode replan as repair.

## Review

- Repair resolves and seals the exact full node input. Only published `repairableInputs` can differ. Parameterless repair remains valid.
- Replan is limited to a published revision of the same child factory. It preserves interpreter compatibility, the protected acceptance contract, port schemas, effects, capabilities, deadline, expansion, and depth bounds.
- The product transaction locks current run and transition authority, rechecks both the durable initiator and requester, advances one lifecycle revision, writes one audit entry, and enqueues one stable inbox event. Cached receipts reauthorize before reuse.
- PGlite passed 44 lifecycle tests and 644 assertions. The earlier unchanged product slice passed 43 PostgreSQL/S3 tests and 635 assertions. SDK control tests passed 4/17, web route and client tests passed 30, the production web build passed, all four type checks passed, and lint passed with eight existing information findings. Exact receipts are in `tasks/factory/run-controls-GATES.md`.
# Generic approval progress regression (2026-09-13)

- [x] Reproduce a delivered approval disappearing after harmless committed interpreter progress.
- [x] Reuse the current approval command authority in the notification read transaction.
- [x] Keep lifecycle, attempt, session grant, scope, expiry, and protected seal checks.
- [x] Prove PGlite lifecycle behavior, typecheck, lint, and diff hygiene.

## Review

- The stored source transition remains part of the protected approval seal. Inbox visibility now validates the exact command against the latest committed waiting attempt, so unrelated head progress does not hide it.
- PGlite lifecycle conformance passes 26 tests and 249 assertions. All four TypeScript lanes and repository lint pass.

# Factory completion plan execution — coordinator (2026-09-13)

Team: coordinator (this session), Opus implementation workers, Sonnet validators. Every worker runs in its own `.worktrees/<pkg>` worktree branched from `integ/w00`; the coordinator integrates into `feat/composable-factory-platform`.

## W00 — Reconcile the integration baseline

- [x] Preserve worktrees, branch heads, dirty diffs, and stashes: ten factory stashes pinned to `preserve/stash-*` branches; no active producer in any factory worktree.
- [x] Baseline checks on `33cab8657`: GitHub transport tests, SDK build, typecheck, lint, boundaries, gate integrity all exit 0 (`/tmp/factory-platform-evidence/w00/baseline-results.jsonl`).
- [x] Integrate `a83f91556`, `3a84d4867`, then `b6cfa4798` (Sol run controls) into `integ/w00` as `bd2cedcc9`; task notes union-merged.
- [x] Commit Terra's exact dirty recovery fix on `feat/factory-lazy-input` as `28bc2bfc3`; retest: 11 pass / 1 fail (fresh-runner artifact directory regression, W01 owns). Staging baseline Podman suite: 11/11.
- [x] Combined controls checks and coverage-gap recheck on `bd2cedcc9`/`425c1bfde` (`w00-staging*` receipts): all producers exit 0; 644987ada new-file/patch gates pass; 2588c9f19 gates fail (W18 backlog).
- [x] Requirement/evidence index for C01–C13, F01–F13, and eleven gates (`docs/validation/factory/w00/requirement-index.md`): 201 rows, 22 discrepancies routed.
- [x] Shared interface freeze with single writers (`docs/plans/2026-09-13-composable-factory-platform-interfaces.md`).
- [x] Redacted evidence summaries and checksums copied into `docs/validation/factory/w00/`.
- [x] Correct overstated task notes with appended notes, without deleting history (eight files; four understated gate files also annotated).
- [x] Fast-forward `feat/composable-factory-platform` to the finished `integ/w00` (c6ac529d2, then each wave-1 merge).

Review (W00): the integration revision is clean and every imported change has a source/test record in `tasks/factory/w00-GATES.md`. Two regressions surfaced and one was fixed here: the canonical web pool failed two session-refresh cases because the branch's JWT verifier now requires installation-bound claims (fixed in `425c1bfde`); Terra's runtime branch fails one Podman cleanup case on a fresh runner (routed to W01). Routed defects from the audit: pool 200-instead-of-429 and reservation vocabulary (W03); `factory_disabled` reason string, API scope mismatches, missing package install/quarantine route (W09/W14); five unregistered PostgreSQL suites and a runner precheck with no consuming job (W18); unimplemented workspace checkpoints (W04 with a W01 seam); Python validator equivalence (W02); provider I/O inside the release transaction (W07).

## Wave 1 — W01, W04, W18 (parallel) then W04a

- [x] W01 durable execution and recovery: 34 commits merged as `88effb159`; validation ACCEPT-WITH-FIXES → REJECT (0o777 rw channel directory, live PoC) → ACCEPT-WITH-FIXES → typed-refusal fix `61fcba297`; full Podman suites green in the combined run.
- [x] W04 artifact materials and checkpoints: 11 commits merged as `4c4e1421e`; validation ACCEPT at a07a637a2.
- [x] W18 coverage/CI framework and registration: 16 commits merged as `c3e6d479a`; validation ACCEPT; final seven-lane enforcement gate (G16–G18) follows W13–W17.
- [x] W04a independent archive writer: 10 commits merged as `e4cb1c369`; validation ACCEPT; deployed-independent failure domain explicitly unmet on this host.
- [x] Sonnet validation of each package before integration; combined-integration run on `88effb159` passes every producer (61 focused files, canonical web pool, 24 PostgreSQL/S3 producers, types, lint, gates, boundaries, node coverage, four Podman suites) and both coverage gate bases (`docs/validation/factory/wave1/`).

## W18 wave 1 — coverage and CI framework (branch `wp/w18-ci-coverage`)

Scope is the FRAMEWORK AND REGISTRATION half. The final seven-lane enforcement
gate runs after W13-W17 and is not claimed. Gates and receipts:
`tasks/factory/w18-GATES.md`, `/tmp/factory-platform-evidence/w18/`.

- [x] Inventory the seven exact C11 lanes against `ci.yml` and `db-postgres.yml`; add the four missing lane skeletons as real jobs whose producers fail closed.
- [x] Make the inventory executable: `scripts/check-factory-lanes.ts` enforces job, exact check name, producers with comments stripped, artifacts, `if-no-files-found: error`, `needs:` edges, runner labels, and no `continue-on-error`.
- [x] Register the five PostgreSQL suites the W00 audit found in no producer, and derive the requirement from the suites on disk so the next one fails closed (discrepancy 12).
- [x] Give both guarded runner labels a consuming job that cannot queue behind an absent runner (discrepancy 17).
- [x] Wire strict Python lint, strict types, standard-library test discovery, and coverage.py LCOV from the repository pins, in one script CI and local runs share.
- [x] Register Python source in the coverage gates with its own producer tag, so no Bun leg can stand in for it.
- [x] Add the `schema:generate` drift check (freeze open question 32).
- [x] Complete the C13 reuse inventory: 46 real edges, 12 declared, 34 un-gated. The inventory now re-derives itself.
- [x] Prove the boundary checker rejects deliberate violations of real declarations.
- [x] Prove the type-only LCOV correction end to end, and that an enum, a value export, and a class still fail without coverage.
- [x] Register the `factory-services` browser lane in every canonical consumer, retaining existing lane ownership and legacy coverage.
- [x] Refresh the read-only GitHub inspection and prepare, without applying, the runner labels, secret names, and branch-protection change.
- [x] Reproduce the full feature-diff coverage gaps with the canonical pipeline and record them as backlog, not as exclusions.
- [ ] Hosted enforcement, a deliberate lane failure blocking the candidate, and a green full feature diff. Deferred to the final gate after W13-W17.

Review (W18 wave 1): every added producer runs locally and is named in a
workflow file, and every deliberate violation is rejected. Three findings are
recorded rather than worked around. The C13 inventory was 26% complete, so 34
reuse relationships could have been dropped without any check noticing. A
malformed generated schema crashes the Python runner instead of returning its
rejection envelope, because `jsonschema.exceptions.SchemaError` is not a
`ValueError`; that is W02's source and W18 did not add a test asserting the
defect. The W00 recheck logs overstated the coverage gap because they came from
focused producers: a canonical merge of the full host pool, all nine legs, and
the new Python producer cuts 41 new-file and 75 patch violations to 21 and 17,
and 11 of the remaining 21 are missing-producer rather than missing-coverage.
All results here are LOCAL. No required check is registered, no runner exists,
and no secret is provisioned, so the three labelled lanes are expected to be
RED. That is the designed fail-closed state.

Integration defects found only on the combined tree (wave 1): an unregistered PostgreSQL suite caught by W18's gate; W01 rows requiring a shared module absent from the inventory; two restart-conformance cases inserting the same attempt id into one fixture. Each fixed in the merge commit with a test rerun.

## Later waves

- [x] Wave 2 (part 1): W03 merged as `fdad73e4b` (validation ACCEPT-WITH-FIXES, low fixes landed), W02 merged as `4acc452ea` (ACCEPT-WITH-FIXES → fixes → ACCEPT); combined run on `4acc452ea` passes every producer, four Podman suites, and both gate bases with the canonical pool/compute/provisioning/Python coverage producers (`docs/validation/factory/wave2/`).
- [x] Wave 2 (part 2): W05 merged as `1dc9a0226` after resolving its merge onto W03 (validation ACCEPT-WITH-FIXES, fixes landed); combined run on `1dc9a0226` passes every producer, four Podman suites, and both gate bases (`docs/validation/factory/wave2/wave2c-*`). Integration fix: the schema-drift test now derives the generated schema count instead of pinning eight.
- [x] Wave 2 (part 3): W08 merged as `6c3991b4d` (ACCEPT), W06 as `9768f2a5b` (ACCEPT-WITH-FIXES → ACCEPT), W07 as `b90dbb60d` (ACCEPT-WITH-FIXES twice, all findings fixed and verified; a window-based storage prune run against the shared store was replaced by manifest-only cleanup). Combined run on `b90dbb60d` passes every producer, four Podman suites, and both gate bases (`docs/validation/factory/wave2/wave2d-*`). Infrastructure: the local SeaweedFS volume cap raised to 400 after the ordinary store exhausted 100 volumes.
- [x] Wave 2 (part 4): W09 rejected twice (composition root never invoked; Podman probe not reentrant-safe), fixed, third independent validation pending. — closed: W09b and W13 merged, base `260855e57` (todo.md:3618) (audit 2026-10-03).
- [ ] Wave 3: W10–W12, W13, W14, W15–W17. Note (2026-10-03): wave 3 roll-up: see Leftover after wave 4; W17 not started.
- [ ] Wave 4: W19 campaign on a frozen build, W20 audit. Note (2026-10-03): wave 4 roll-up: W19 campaign and W20 audit not started.

# W04 — Artifact materials and workspace checkpoint transport (2026-09-13)

Worktree `.worktrees/w04-artifacts`, branch `wp/w04-artifact-materials`, from `integ/w00` at `c6ac529d2`.
Owned surface: interface freeze section 7. Gates and receipts: `tasks/factory/w04-GATES.md`.

## Wave-A type checkpoint — `8b486382a`

- [x] `src/factory/artifact-materials.ts` with the frozen limits, types, service and reader
      interfaces, and one `assertFactoryArtifactReference`.
- [x] The three duplicate reference validators in `artifacts.ts`, `artifact-access.ts` and
      `input-artifacts.ts` now call it (freeze correction 7).
- [x] Migration 37 `add-factory-artifact-materials`, both tables, the `'material'` kind, the
      `material_key` admission dimension, Drizzle models, and a restart-conformance case.
- [x] `REQUIRED_SHARED_IMPORTS` row for `src/extensions/v4/blobs.ts`.

## Service, gateway, journal — `1813bd4f8`, `b5e7e8794`

- [x] `FactoryAttemptMaterials`: begin, writeChunk, seal, list, plus chunks and readChunk for
      recovery, over the encrypted bound blob store.
- [x] Two additive journal seams so the material path takes the same live fence as every effect.
- [x] Gateway material routes with a chunk-sized private envelope and per-route byte bounds.
- [x] `FactoryScopedMaterials`: read and readChunk, with every denial funneled to `unavailable()`.

## Recovery and rejection

- [x] Partial upload and workspace checkpoint recovery by identity, proven across a real restart.
- [x] Rejects changed bytes, tampered chunk rows, tampered manifests, cross-scope reads, late
      writes, stale epoch and reservation, duplicate names, missing versions, and unsafe paths.

## Workspace checkpoints (C02.11)

- [x] `FactoryWorkspaceCheckpoints` implements W01's widened seam structurally, storing each
      checkpoint as one immutable material version under the reserved prefix.
- [x] The returned cursor equals the operation index, which is what the SDK validator enforces.
- [x] A replay returns the identical handle; changed bytes for the same operation are refused.

## Proof — `4841bcfb4`

- [x] Real PostgreSQL 16.14 and S3: 26 pass, 205 assertions, including two restart proofs.
- [x] C08 64 KiB protobuf boundary stays green with the material-reference case added.
- [x] Typecheck, lint, boundaries, gate integrity, new-file and patch coverage all exit 0.

## Review

The material service is one immutable record family beside the terminal candidate artifact, bound
to tenant, project, run, attempt, operation, object name, and version. `begin` commits that row
before any upload, so a crash mid-upload recovers by identity rather than by local state, and
`chunks` tells a restarted writer exactly what landed. `seal` reads every chunk back, verifies
each stored digest and the assembled digest, and only then stages one bounded chunk manifest as
an ordinary artifact and issues its reference. There is no second manifest format and no
unverified loader: seal and read share the same assemble-and-verify path.

Three things were harder than the sketch suggested. A material fills none of the artifact
admission index's identity slots, so it needed its own bounded dimension. The frozen `begin`
signature receives no digest while the material row's digest column is NOT NULL, so an unsealed
material carries a reserved value that seal replaces and a sealed row can never hold. Honouring
both "the shared validator lives in the new leaf" and "material denials reuse `unavailable()`"
required moving the denial funnel into that leaf and re-exporting it, because the alternative was
a runtime import cycle.

Two defects outside the sketch surfaced and were fixed. An earlier migration re-added its
narrower artifact-kind check on every boot, so the second boot after a material row existed
failed; the restart suite now reproduces that and proves the fix. The private transport rejoined
its whole connection buffer on every packet, which is a quadratic copy at a chunk-sized envelope;
it now joins the bounded header prefix and the body once.

The shared proof PostgreSQL container died mid-package and was restored by its owner. The failing
run is preserved in the receipts rather than deleted.

# W04a — Independent archive writer and publication readiness

Branch `wp/w04a-archive-writer` from `integ/w00` at `37f2ed3f9`. Surface owned: the archive-writer
role, its readiness result, the archive prerequisite before a dispatch claim, and the
receipt-before-settlement recovery. Evidence: `/tmp/factory-platform-evidence/w04a/`.

- [x] Type and role checkpoint: `src/factory/archive-writer.ts` carries the archive-writer role,
      the readiness result, the failure-domain evidence record, the member manifest, and the
      archive inventory. Unit tests cover every branch.
- [x] Compose the existing immutable archive adapter as the gateway's archive-writer role. It
      holds the `archive.json` credential set only and records the failure domain honestly.
- [x] Before a dispatch claim, archive the recovery intent plus every candidate, evidence, and
      request object the material references, read through W04's `FactoryScopedArtifactReader`,
      and verify each archived member reads back byte for byte.
- [x] Publication stays pending when any member is unavailable or corrupt. Test each separately.
- [x] After a confirmed provider effect, archive the receipt before product settlement; recover
      the same operation by identity from the archive without a second dispatch.
- [x] Crash at each boundary: after the intent write, after a member write, after the material
      write, after the claim, after the provider effect, and after the receipt archive.
- [x] Access restrictions on the real local SeaweedFS services for all ten tenant identities:
      product and restore credentials cannot read, overwrite, or delete an archive object.
- [x] The archive stays readable while the ordinary store is down, and product settlement stays
      blocked until it returns.
- [x] Register `tests/postgres/factory-archive-writer.test.ts` in `.github/workflows/db-postgres.yml`
      in the same change; W18's registration gate fails closed otherwise.
- [x] Record the deployed-independence requirement as an explicit unmet criterion in
      `tasks/factory/w04a-GATES.md`. Same-host volumes prove credential separation only.
- [x] Full verification per `common.md`, then the Review paragraph and the lessons entry.

## Review — W04a

The archive-writer role is the existing immutable archive adapter plus three things the plan
asked for and the adapter did not have: the archive credential set as its own gateway role, a
readiness result that separates operational readiness from publication grade, and a
failure-domain record that cannot be argued into claiming more than the deployment proves.

The archive prerequisite before a dispatch claim needed no change to the shared release store.
`FactoryReleases` already takes a `FactoryReleaseArchive` and already archives the intent and the
material before it sets `archive_ready`, and already refuses a claim without it. The role became
that interface, so the material write now also resolves the pinned candidate, request, and
evidence objects, reads each through W04's scoped reader, writes and re-reads every member, and
writes the manifest that names them. The material object is written last. A missing, unreadable,
or corrupt member therefore leaves `archive_ready` false and publication pending, and W07's file
is untouched.

The crash-boundary cases count objects rather than describing them. Five attempts put exactly 1,
4, 5, 6, and 6 objects in the archive: the intent alone, the intent with three members, plus the
manifest, plus the material, and then the identical set on the retry that commits. That last
equality is the idempotence proof; an earlier fixture that handed out a new object version per
write broke it, and the fixture was what was wrong.

The receipt-before-settlement half is proved by making the settlement fail. The provider effect is
confirmed, the receipt reaches the archive, the product transaction dies, and the operation is
left uncertain with no receipt in the database and the receipt already in the archive. Recovery
then settles the same operation by identity, using the provider only to verify that the archived
receipt still describes the live object, and the publish count stays at one throughout. With the
ordinary store unreachable the recovery refuses and the operation waits.

On the real services all ten tenant identities pass, and every product and restore attempt to
read, overwrite, or delete an archive object is refused with HTTP 403 — 130 refusals in total.
This profile mints no separate restore identity, so the restore probe uses the product credential
set and the receipt says so rather than implying a proof it did not run.

What this does not show is an independent failure domain. Both services are on this host.
`deployed-independent-failure-domain` is recorded as an unmet criterion in
`tasks/factory/w04a-GATES.md`, in every readiness result, and in the real-services receipt, and
the classifier will not return the independent verdict without an operator's replication
statement that nothing here writes.
## W01 — Durable Bun execution and recovery (Terra runtime, `wp/w01-durable-runtime`)

Gates and receipts: `tasks/factory/w01-GATES.md`, `/tmp/factory-platform-evidence/w01/`. All fifteen gates pass.

Step 0:
- [x] Merge `feat/factory-lazy-input` (`28bc2bfc3`) as `0df2f128d`; `tasks/lessons.md` and `tasks/todo.md` resolved by union.
- [x] Reproduce the fresh-runner regression exactly: 11 pass / 1 fail, `ENOENT ... rename 'artifact-<uuid>' -> 'artifacts/<digest>'` (`logs/step0-repro-podman.json`).
- [x] Root cause: `6c500113a` changed `PodmanRunner.build()` from `initialize()` to `acquireLease()`, dropping store preparation and the fail-closed kernel isolation probe from every build.
- [x] Fix at the source; full shared Podman suite 14 pass / 0 fail (`logs/final-podman-suite.json`).
- [x] Verify real PostgreSQL schema conformance on the merged tree: 28 pass / 0 fail, 2794 assertions (`logs/final-postgres-producers.json`). Terra's reported pre-import three-foreign-key mismatch for `factory_runner_package_bindings` does not reproduce here.

Type checkpoint (`ea1bd94de`, reported to the coordinator, never amended):
- [x] `FactoryAttemptDeviceGrant`, `factoryAttemptDeviceGrant`, `FactoryGuestControlFrame`, `FactoryHostLaunchProtocol`, `invocationId` on `FactoryAttemptOpen`, optional `StartRequest.devices`.
- [x] `factoryAttemptInvocationId`, durable and reproducible, replacing the ephemeral `${workerId}:run`.
- [x] Migration columns and the freeze's `package_receipt_json` `SET NOT NULL` correction; `factoryMigrationRestartConformance` case; freeze correction 9.

Behavior, every plan bullet:
- [x] Launch intent committed before the guest starts; one concurrent claimant launches one physical attempt.
- [x] The intent binds request digest, identity tuple, worker and invocation IDs, lease fence, and the full package receipt; readiness is revalidated after the claim and immediately before the token mint.
- [x] Bounded authenticated reconnectable guest-control channel with frames bound to worker, invocation, and attempt. Losing the controlling attachment neither terminates the guest nor authorizes another effect; a fresh attach creates no container, skips orphan cleanup, and issues no second invocation.
- [x] Terminal results durable before acknowledgement; a fresh gateway reads the same result with no second `extension/invoke`.
- [x] Recovery of transcript, cursor, tool results, and pinned model and provider configuration from durable records, on a supervisor that does not hold the original local directory. Workspace bytes stay behind the existing artifact-store seam for W04.
- [x] The shared executor's broker transport and journal hooks preserved; one real model and tool operation through Node, the Bun gateway, and an isolated guest. No authority check removed.
- [x] Crash matrix across the gateway, guest, and supervisor around each journal and result boundary; a reattach or a confirmed stop precedes any replacement, and an API failure never proves physical absence.
- [x] Both recovery topologies, including the signed physical-stop receipt verified against the canonical unsigned facts.
- [x] The real subprocess test with a genuine SIGKILLed child, one labelled container, attach without cleanup, and removal of every owned resource.
- [x] C05 re-run across PGlite, real PostgreSQL and S3, real Podman preparation, and schema and foreign-key parity; two model and configuration tuples sharing one package and export with only one revoked.

Review (W01): the recorded C02 gap is closed. `wait()` after a recovery boundary no longer refuses; one canonical terminal result is digest-sealed into the launch row before the runtime acknowledges it, and `open()` replays it without touching the runner, so a fresh gateway returns the identical result after exactly one start and one invocation. Six defects surfaced and were fixed rather than routed. The merged branch had silently removed the kernel isolation probe from every build, which is a C05 control and not merely the `ENOENT` symptom that exposed it. The isolated runtime accepted any reverse envelope with an `input` key, so a broker frame was bound to nothing even though the v4 guest already sends the exact invocation context. A readiness denial after the durable claim stranded the attempt in `launching` forever. My own first fix then introduced two more, both caught only by the real container suite: probing the kernel on `attach()` cost about four seconds and the guest whose control pipe died did not survive that window, and sweeping orphans on the lazy build and execution paths would destroy another attempt's surviving guest now that execution is detached. Finally, real PostgreSQL parity rejected a plain object as a jsonb column default. One deviation from the freeze for the coordinator to confirm: the durable terminal result lives in two columns on `factory_attempt_launches` rather than in `factory_execution_terminals`, because that table requires verified candidate output bytes and measured usage and so cannot hold a failed, cancelled, or uncertain runner result. It is still no new table.

## W09 — Complete application and service startup (wp/w09-startup)

Owner: coordinator-owned package, delegated. Evidence: `/tmp/factory-platform-evidence/w09/`.
Gates: `tasks/factory/w09-GATES.md`.

- [x] W09.1 Validated startup configuration. `src/factory/startup-config.ts` parses one factory
      runtime configuration document strictly and fails by the exact name of each missing required
      dependency. No composition reads `process.env` a second time.
- [x] W09.2 Real service probes. `src/factory/service-probes.ts` probes each of the seven
      `FACTORY_REQUIRED_SERVICES` for real and returns the available set plus a named failure per
      unavailable service. Admission stays closed until every probe passes.
- [x] W09.3 Stop-aware bounded workers. `src/factory/background-workers.ts` gives one worker
      shape: bounded batch, single-flight, own `AbortController`, abort-aware idle wait, stop that
      awaits the in-flight step. One registry starts in order and stops in reverse.
- [x] W09.4 Composition root. `src/factory/runtime-composition.ts` composes harness/API stores,
      Bun gateway roles (execution, materials, archive writer), host supervisor with W01's launch
      protocol, pool client, encrypted stores, controls, and the archive writer as
      `FactoryReleases`' `archive`. Registers the eight workers: compute polling, attempts,
      command/inbox delivery, child settlement, projections, release outcomes, usage
      reconciliation, notifications.
- [x] W09.5 Typed seams, not fake success. W03 (stop worker, usage reconciler), W05 (validators),
      W07/W08 (release profiles), W17 (notification sender) each get a typed seam that refuses
      when absent. No seam returns a fabricated success.
- [x] W09.6 Startup race. Reproduce `web/src/lib/server/context.ts` simultaneous initialization and
      failed-start retry through the real server, then fix at the source.
- [x] W09.7 Disabled reason string. `factory_disabled` becomes the contract's `factory-disabled`
      (requirement index discrepancy 9, row C09.7).
- [x] W09.8 API scopes. Align `src/api-registry.ts` with the C01 authority table (discrepancy 10):
      version publish becomes `write`, grant management becomes `admin`. Record the package
      install/quarantine row, which has no lifecycle to register against until W02 lands.
- [x] W09.9 Process boundaries. An executable test proves only Node links `@temporalio/*`, Node
      holds no product database, object-store, or provider credential, the supervisor holds only
      host identity, and runners hold attempt-scoped authority.
- [x] W09.10 Behaviour tests: shutdown order, credential expiry and refresh, dependency loss,
      restart, queue backpressure, safe re-drive, simultaneous initialization, failed-start retry.
- [x] W09.11 Full verification per `common.md` with receipts under the evidence directory.
- [x] W09.12 Wire the composition root into `ensureInitialized`, with a real-server proof that
      `/api/ready` reaches `ready`, the registered roles run, and shutdown leaks nothing.
- [x] W09.13 One registration rule for every role, and the host supervisor readiness the
      seventh probe reads.
- [x] W09.14 Register attempt-dispatch. W01b publishes `createFactoryAttemptDispatchDriver` and the — closed: W09b attempt-dispatch role (todo.md:2957) and G14 green (todo.md:3170) (audit 2026-10-03).
      host launch transport; this installation still needs `hostLaunch.{baseUrl,serverName,tls.*}`
      and `attemptTokenSecretPath` in the startup document. W01b also corrected the old reason:
      `assertDispatchReady` is a database read, so no container runner is needed in this process.
- [x] W09.17 Enumerate a tenant's projects as a composition-owned read, bounded, oldest-first, and
      proved on both engines; register notification-inbox-delivery on top of it.
- [x] W09.25 Build the four role drivers in src/factory/dispatch-composition.ts, each covered to
      100%: stop settlement, usage reconciliation, the release provider resolver, release outcome.
- [x] W09.26 Assemble them in installationCollaborators. No external blocker: FactoryTaskStops is — closed: W09b "one construction of every durable store" (todo.md:2955) (audit 2026-10-03).
      the one FactoryUsageSettlementAuthority and all fourteen of its arguments are reachable.
- [x] W09.18 Register release-outcome. Needs a production `FactoryReleaseProviderResolver`; the — closed: W09b release-outcome composed and running (todo.md:2965 to 2975) (audit 2026-10-03).
      claimable scan, the enumerator, and all three providers already exist.
- [x] W09.19 Construct the pinned model broker from validated configuration, with a missing
      credential as a named readiness row and never a substitute (W10 Q2).
- [x] W09.20 Hand the broker to a runner. Blocked on a contract, not a wiring: the runtime wants — closed: W01e guest model-broker frame merged `71e8cc9ed` (todo.md:3155) (audit 2026-10-03).
      `invoke(request, input)`, the broker offers `stream(request)`, and the host launch supervisor
      wants a third shape. Nothing defines what a guest sends to request a model stream.
- [x] W09.24 Build the dispatch preflight over W03's recorded allocation (reservation from the
      queue's own record, lease from readRetainedAdmittedInTransaction, one transaction, GPU with
      no pinned host refused).
- [x] W09.21 Register attempt-dispatch and prove G14 with a real guest. The configuration landed — closed: W09b attempt-dispatch role (todo.md:2957) and G14 green (todo.md:3170) (audit 2026-10-03).
      (`hostLaunch.*`, `attemptTokenSecretPath`, `hostStopKeys`). One collaborator remains: a
      production `FactoryIsolatedRunnerPreflight`. `preparedPackage` is `assertDispatchReady`;
      `lease(request)` needs the durable record a claimed attempt reads its held allocation back
      from, which is a compute-admission decision rather than a wiring choice.
- [x] W09.22 Register stop-settlement. Needs a `FactoryPoolStopAcknowledger` client over the — closed: W09b stop-settlement role (todo.md:2961) (audit 2026-10-03).
      existing `confirmStopped` route, and a startup-document field for the host PUBLIC keys.
      Scoped at the integration merge: `IsolatedFactoryAttemptRuntime` needs a launch store, the
      pool admission client, the gateway-owned provider broker, and `signStopReceipt`, which takes
      the host private key. C01/C02 keep that key out of the product process, and the host
      supervisor deliberately links no tenant store, so this is a third process with its own
      readiness and credentials rather than a seam on either existing one.
- [x] W09.15 Merge `integ/w00` (1d3edf5b0) and compose the collaborators it brought: the
      composition-owned release fence reader, and child settlement from W06's scan and settle.
- [x] W09.23 Correct the store-outage diagnosis: W09 caused it by running
      scripts/verify-factory-storage.ts, whose durability check recreates the ordinary service from
      the repository compose file, which on this branch still said mem_limit: 768m. The proof now
      checks the stores read-only and nothing under repro/ invokes compose or docker.
- [x] W09.16 Bind the installation row at startup. Found by the real-server proof: the foreign key
      from `factory_projects` made the first project creation on a flag-on installation answer 500.

### Review

**The first submission was rejected, and the finding was correct.** I built the
factory composition root and never called it. `startFactoryRuntime` composed,
probed, and opened admission, and no production code path invoked it, so a
flag-on installation sat at `booting / factory-services-pending` for the process
lifetime and every factory route answered 503. My own gate file then presented
that 503-forever as evidence of fail-closed design and blamed the remaining gaps
on other packages, which was an overstatement.

`ensureInitialized` now composes the factory after the database opens. The proof
is a real built server against real PostgreSQL, real S3, a real pool admission
process, and a real host supervisor process: `/api/ready` answers `200 ready`
and carries the running and held role lists, and a SIGTERM tears down
`factory-runtime` second of fourteen, right after the pre-existing
`background-timers`, with exit 0 and no surviving process. One
input in that run is simulated and labelled in the receipt — the orchestration
readiness record — because the pinned Temporal test server is plaintext while
C01 requires an authenticated namespace, and I would rather label the gap than
relax the requirement to produce a green light.

Fixing the wiring exposed two more defects of mine. The three seam-driven roles
could never register: `hold()` had no `define()` counterpart, so supplying a seam
removed the hold and registered nothing, and my test asserted only absence from
the held list. And the projection driver was typed against an `applied` count
that `projectPending` does not return, so that role would have spun at its batch
bound forever. Every role now follows one rule — register when the driver exists,
hold by name when it does not — and registered plus held always equals the role
count.

The pass sentence is still open, and the missing half is mine rather than
another package's. `FactoryAttemptDispatcher` needs a trusted runner and
`FactoryPackagePreparations`, whose constructor requires a container runner the
product process does not hold, so the role holds there and registers unchanged in
a process that does. Composing that process is the remaining work.

**The second submission was rejected too, and that finding was also correct.**
The host supervisor's container-runner probe was not safe to repeat.
`PodmanRunner.prepareStore` ends in an exclusive `flock --nonblock` child held
for the instance's life, and the probe built a new runner per call, so the second
probe on one root failed `runner_store_busy` and every successful one leaked a
lease child. My three passing runs each sampled `/api/ready` the moment it turned
green and shut down, so none of them could ever have seen a second probe. The
supervisor now holds one runner for its lifetime and closes it in the run's
`finally`, and a new test exercises the real `PodmanRunner` across repeated
probes on one root. The full-stack proof now also holds the supervisor through
five consecutive `ready` heartbeats and counts its lease children, so a repeat
failure would fail the proof rather than go unobserved.

**A third defect was in my evidence rather than the product.** The proof harness
wrote its record with an unimported `writeFileSync`, so every run threw after its
work was done, exited 1 with an empty log, and left the previous run's record on
disk for the driver to copy — three receipts described a run older than the
commit they named. Receipts now carry `recordFresh`, computed from the record's
own timestamps against the run window. Two other evidence scripts piped test
output through `tail` inside a loop and recorded `tail`'s exit code; one postgres
producer was failing on a missing environment variable and read as green. Both
now accumulate per-file exit codes.

## W03 — Physical stop, cancellation, and budget settlement

Branch `wp/w03-stop-settlement`, base `integ/w00` at `88effb159`. Gates and receipts:
`tasks/factory/w03-GATES.md`, `/tmp/factory-platform-evidence/w03/`.

- [x] Type checkpoint: share journal fact validation (freeze section 8).
- [x] Type checkpoint: type live stop authority (freeze section 3, migration + Drizzle coherence).
- [x] Type checkpoint: type usage settlement (freeze section 4, migration + inbox co-enqueue proof).
- [x] Finish the Phase B stop service on the exact attempt, reservation, worker, host, generation,
      request, and cancellation command.
- [x] Cancel a still-running attempt with no terminal result, from the sealed admission plus the
      launch record. No fabricated outcome.
- [x] Host identity and key wiring: only the supervisor signs a physical fact.
- [x] Concrete authenticated host stop transport over the real private mTLS service, with key
      rotation and reload, unknown-key rejection, and the retained-trust policy for an old key.
- [x] Abort, at most ten seconds of cleanup, then whole-sandbox termination confirmed from the
      runtime. Proven against real rootless Podman.
- [x] Bounded stop timeout leaves durable uncertainty and holds; a later valid receipt reconciles
      without replacement work and without rewriting a prior outcome.
- [x] Receipts verified before pool release and before atomic journal, budget, and inbox
      settlement. Unknown provider cost is never settled as zero.
- [x] Trusted later usage reconciliation with one idempotent usage-settled event, concurrent
      stop and confirm, corruption rejection, and pool-ack-then-product-failure recovery.
- [x] Cancellation during admission, lost acknowledgements, ledger loss, and partitioned
      survivors. See the gate file for what the stop path proves and what is routed elsewhere.
- [x] C03 fairness and limits: round-robin service, the thirty-second oldest-first lane, reserved
      minima, atomic whole-vector admission, infeasible rejection, the outstanding limits with
      HTTP 429, the reservation vocabulary, the allocation-trace audit, and the skewed workload.

- [x] Unblock W05: admit a protected-validator origin through the acceptance command, key it with
      `factoryReservationIdForOrigin`, and emit no `admission-result`. Commit `97fb7ab16`.
- [x] Root-cause and guard the pool suite spin that held the shared heavy lock. Commit `c2d6f27d1`.

### Review

The package landed three type checkpoints, the stop service, the C02.14 sandbox termination, the
authenticated host stop transport, and the C03 scheduling work. Six real defects were found by
running the contracts rather than reading them: a pool round that never ended and starved every
tenant but the lexicographically smallest; a guest shim that discarded every graceful stop because
a container's PID 1 has no default signal action; a launch reader that only decoded `jsonb` in its
PGlite form; a run authorizer that made a cancelling run unstoppable; an assertion against an undriven lazy
`SQLQuery` that busy-spun a core and held the shared heavy lock for fifty minutes; and a durable
constraint that made a validator admission impossible to settle. Each is described in its own
commit with the measurement that found it.
## W02 — Isolated Python and per-attempt CPU/GPU allocation (Terra runtime, `wp/w02-python-isolation`)

Gates and receipts: `tasks/factory/w02-GATES.md`, `/tmp/factory-platform-evidence/w02/`.

Per-attempt device authority:
- [x] A factory execution start names exactly the devices its held pool allocation authorized; a CPU start names none. `configuredDevices` stays only for a v4 caller that names no field at all, and a build or discovery guest is denied a device whatever the host configures.
- [x] `factoryHeldAllocationDevices` derives the authorization from the lease's own resource vector and the registered profile of the host that actually holds it.
- [x] Unapproved, stale and overlapping grants are all refused: no `gpu-host` in the vector, a node outside the shared allowlist, a second `prepare` under a different lease, and a second live attempt on the same host holding a node this grant names, fenced durably under a host-scoped transaction lock.
- [x] A real Podman proof that a CPU guest sees no GPU device on a host runner configured with three.

Isolated Python guest:
- [x] Digest-pinned CPython 3.13.12 guest through the shared recipe machinery, extending `PodmanRunner` rather than forking it.
- [x] The FIFO shim contract: the in-guest shim holds `/channel/{in,out,err}` `O_RDWR` for the guest's whole life, so no host process's exit reaches the guest as end-of-input.
- [x] The framed request and result bridge, answering `extension/discover`, `extension/invoke` and `extension/cancel` over the same frame policy the Bun guest uses.
- [x] The immutable dependency and model closure: interpreter pin, committed `uv.lock` by digest, importable distribution closure, model closure and resource class, all sealed into `.runner/recipe.json` and compared with the running guest at build time.

Python-native validator equivalence (C07.8, discrepancy 20):
- [x] `c02_runner.py` no longer shells out to the Node bridge. `factory_ijson`, `factory_schema` and `factory_validation` are the Python counterpart of the SDK's canonical, schema and validation modules.
- [x] The shared generated schemas and their negative fixtures run under real isolated Bun and Python guests and are compared issue code by issue code.
- [x] Host-Python conformance stays as a separate, narrower entry point.
- [x] W18's Python lanes pass with 100% line and branch coverage, and the three rule families W18 deferred (`I`, `S`, `E5`) are now enforced.

Package states on the shared v4 fence:
- [x] `quarantined` beside `revoked`, with every revision recording the v4 installation generation it was decided against.
- [x] A decision the installation has outrun no longer authorizes dispatch; a blocking transition fences live attempts through a seam inside its own commit; every earlier decision is preserved.

Applied controls and hardening:
- [x] Every applied control read from the container runtime while the guest runs, and compared with the guest's own report, for both pinned guest languages.
- [x] The guest environment is exactly the three declared variables plus the two the OCI runtime injects with fixed values. The image's own `ENV` no longer reaches any guest.
- [x] The base-hardening regressions re-run on the final code.

GPU:
- [x] Real AMD ROCm computation in ten fresh containers with a missing-device control, under the user-scoped GPU lock.
- [x] The per-attempt grant proved through the factory's own launch path, one verdict per rule.
- [x] The supported local profile recorded, and every production criterion written as an explicit unmet row with its own measured verdict.

Review (W02): the two headline gaps are closed. Device authority is now a property of the held allocation rather than of the host, fenced durably so two live attempts cannot share a node, and the Python runtime has a validator of its own instead of a subprocess call into Node. Three defects surfaced while verifying rather than while writing. Every guest, in both languages, was receiving the container image's own environment, including `PATH` and the interpreter's build metadata, although C05 names exactly three variables and the requirement index recorded that row as closed; `--unsetenv-all` removes it and the two the OCI runtime still injects are pinned to fixed, tenant-independent values. A grant naming CDI devices would have launched an attempt with no device at all, because the shared runner injects raw nodes only; it is now refused at start. The ROCm fixture could not be read by the container's mapped user in a worktree made with a restrictive umask, which would have failed the GPU proof for a reason that has nothing to do with the GPU. One deviation for the coordinator: `FactoryAttemptRuntimeError` gains a `device_conflict` code, and `FactoryPackageTrusts` gains an optional fence seam whose implementation is W03's stop path.

## W05 — protected validators and child provenance

- [x] One strict validator report for PASS, FAIL, INCONCLUSIVE, and VALIDATOR_ERROR, in the SDK and
      consumed by the product. A clean process exit is not a verdict.
- [x] Multi-claim result key migration, populated-schema backfill, repeat migration, and real
      PostgreSQL parity between the fresh and the upgraded catalog.
- [x] Resolve the exact compiled evidence source and stopped task, verify its journal request and
      candidate binding, and bind claims only to their pinned runner, model, and configuration.
- [x] Schedule missing protected validators through durable admission, pool allocation, the attempt — closed: W05 final addendum, every W05 checklist row closed (todo.md:2578 to 2590) (audit 2026-10-03).
      dispatcher, and isolated execution. Blocked on W01; the typed origin and its migration landed.
- [x] Typed validator origin in shared admission, where ordinary admission still requires a
      dispatch-node command, with one reservation per validator identity.
- [x] Verify required and quorum claims, freshness, issuer grants, complete report fields, current
      trust, and the latest immutable trust revision.
- [x] Bind a child's accepted artifact alias to the exact parent attempt, child binding, child
      decision, artifact, and live ancestry fences, with parent acceptance kept separate.

### Review

Eight commits land five frozen type checkpoints plus the two behaviors those types exist for. The
SDK now owns the only validator-report parser, so the product's hand-rolled boolean parser is gone
and a claim's verdict is the only acceptance input: INCONCLUSIVE and VALIDATOR_ERROR are stored,
counted, and refused rather than collapsed into FAIL. A failing required claim stopped being a
thrown activity error and became a durable rejection receipt plus one `node-failed` event, which is
what lets a bounded repair ever run.

Three things were harder than the sketch. The freeze's branch field name `decision` was already
taken by the acceptance decision object, so renaming it would have invalidated every stored receipt
digest; the branch is `outcome` and the column keeps the frozen name. The freeze's release-profile
CHECK cannot be installed before a writer exists, because the landed release path would fail every
dispatch closed. And moving evidence claims from `passed` to `verdict` makes any evidence row
written before the change unverifiable, which is the safe direction: rewriting those digests would
be forging sealed evidence.

Two findings went to other packages rather than being fixed here. The kernel still answers an
acceptance rejection with a `cancel-node` for a node that has no physical attempt, which the plan
forbids and W06 owns; the exact command is pinned in a test so the fix flips an assertion. The
release provider's `publish` gained the missing `AbortSignal` and the request-byte bound became an
export, so W07 and W08 implement `resolve` only.

### W05 addendum after W01 integration

- [x] Widen `FactoryTrustedValidatorGateway` with both binders, so the scheduler and the acceptance
      path bind through one seam (freeze section 2, open question 7).
- [x] Schedule missing protected validators from the acceptance command through durable admission,
      with exactly one budget reservation and one compute admission per validator identity and the
      typed origin sealed on both rows.
- [x] Pool allocation, the attempt dispatcher leg, and a real isolated guest. Blocked on one change — closed: W05 final addendum, every W05 checklist row closed (todo.md:2578 to 2590) (audit 2026-10-03).
      in W03's admission core: a validator admission's reference is the acceptance command, which
      `withCurrent` does not admit and `assertContext` re-keys with the task reservation rule. The
      change also has to suppress the `admission-result` kernel event, because a validator has no
      kernel node to receive one, so it carries its own lost-response and cancellation matrix.

The scheduler stops exactly where it can still be proven. Everything it writes is durable, keyed by
the typed origin, and converges under repeat, concurrency, and restart; nothing downstream of the
pool poll was written unproven.

### W05 second addendum

- [x] The evidence-reference scope check: a claim may cite only auxiliary materials its own attempt
      wrote, so a report cannot make a repair read another attempt's findings.
- [x] The attempt-dispatcher leg: a protected validator reuses the whole shared dispatch path and
      settles through the journal, writing no kernel completion row and no inbox event.
- [x] The real Podman isolated-validator proof. Only the in-process runner differs now; it still — closed: W05 final addendum, every W05 checklist row closed (todo.md:2578 to 2590) (audit 2026-10-03).
      waits on the admission change, because the scheduler cannot produce a queue row until an
      admission reaches `admitted`.

W03 had not landed the validator-origin admission change at `a8c3e0fca`: `wp/w03-stop-settlement`
is at `1d591eeaa` and none of its commits since the W01 merge touch the admission core. Nothing was
cherry-picked, and nothing downstream of that point was written unproven.

### W05 final addendum

- [x] Cherry-picked W03's `97fb7ab16` so a validator admission authorizes through the acceptance
      path, and applied `310d3da5f`'s shared-root-envelope correction by hand.
- [x] The whole scheduling chain: plan, reserve, pool admission with no kernel event, one durable
      attempt, one dispatch through W01's shared dispatcher, evidence resolved, and no further
      schedule needed. A repeat, concurrency, a restart, and a cancellation all converge.
- [x] A real isolated Podman guest runs one protected validator through W01's runtime and returns a
      report the SDK validator accepts, with no grants, no tools, and a freshly minted token.
- [x] The evidence-reference scope check.

Every W05 checklist row is now closed. One defect this package introduced was caught by W18's
derived C13 inventory in the final sweep and fixed in `b100258c0`: two new modules imported a shared
module without declaring it, which the boundary script alone does not detect.

## W08 — S3 manifest publication and reconciliation (`wp/w08-s3-publication`)

Owner: free Terra worker. Base `integ/w00` at `1dc9a0226`. Evidence
`/tmp/factory-platform-evidence/w08/`. Gates `tasks/factory/w08-GATES.md`.

- [x] Type the S3 publication set: the frozen request, the published manifest, and the
      verified receipt that names every file key, digest, media type, and object version,
      plus the final manifest digest. Never an ETag as a content digest.
- [x] Publish an approved set of exact files under one operation directory with the
      configured destination credentials only. Stage each member conditionally and
      privately, verify SHA-256, media type, and object version, then write `manifest.json`
      last. Partial staging is never published.
- [x] Export a 256 MiB material through W04's chunks as a real S3 multipart upload.
- [x] Reconcile an interrupted staging only under the same authorized identity. Refuse
      conflicting content, a missing version, changed media, a manifest race, and any
      second confirmed publication.
- [x] Supply the S3 publication-set scope resolver for `factoryArchivePublicationSet`. Read
      the attempt id from the verified protected command provenance, never from caller
      input. Feed W04a's archive-before-claim and keep receipt-before-settlement.
- [x] Implement the shared asynchronous release profile (`resolve`) for the S3 adapter.
- [x] Prove all ten tenant credentials enforce isolation with measured cross-tenant denials.
- [x] Full verification: focused suites with coverage, the PostgreSQL producers, typecheck,
      lint, boundaries, gate integrity, and `BASE_REF=integ/w00` new-file and patch coverage.

### Review — W08

Every checklist item above is complete and has a receipt in
`/tmp/factory-platform-evidence/w08/receipts.jsonl`. Gates are in
`tasks/factory/w08-GATES.md`.

The publication is the manifest. Members are staged conditionally and privately under one
operation directory, each is verified by reading it back at its exact object version and
recomputing its SHA-256 and media type, and `manifest.json` is written last. A reader that
follows the manifest therefore never sees a partial set, and a directory with no manifest has
published nothing. The receipt names every file key, digest, media type, and object version and
carries the manifest digest as the one confirmed effect. No ETag reaches it: a probe of the real
service recorded a composite ETag and no `ChecksumSHA256` at all for a multipart object, so
neither could serve as a content digest.

Two new files carry the work and `src/factory/releases.ts` is untouched.
`release-s3-publication.ts` is the provider; `release-s3-scope.ts` is W04a's publication-set
scope resolver and W05's asynchronous profile for S3. The attempt id comes only from the stored
protected command trail and must agree with `factory_executions`, so a request can never widen
the scope it is read under.

The one open engineering point is stated in the gate file rather than hidden: a published member
may be 256 MiB and the archive's per-member ceiling is 16 MiB, so member bytes are not archive
members. The archived recovery intent already carries the whole frozen request, so every member's
key, media type, and SHA-256 survives in the archive without them, which is what reconciliation
needs.

`deployed-independent-failure-domain` stays unmet on this host, exactly as W04a recorded. This
package does not soften that verdict anywhere.
## W06 — rejection, repair, and replan (Sol controls)

Worktree `.worktrees/w06-remediation`, branch `wp/w06-remediation`, from `integ/w00` at `1dc9a0226`.

- [x] 1. Kernel remediation wait. A `node-failed` with `failureKind: "acceptance_rejected"` enters a
      bounded remediation wait instead of `stopFailedAttempt`. No `cancel-node` for a virtual node.
- [x] 2. Bound consumption. `AcceptanceNode.maxRepairs` is the declared bound; the kernel holds an
      absolute ceiling of three candidate generations. An exhausted bound fails with `bound_exhausted`.
- [x] 3. Repair targets the producer, never the acceptance node itself; a repair must produce a new
      candidate, not re-ask the same contract.
- [x] 4. Reference remediation. `reference.code.v1` decides after the protected checks: generate →
      freeze → checks → acceptance → bounded repair → new candidate → freeze → checks → new decision.
- [x] 5. Replan authority. Equality of the protected contract, and denial of every widening of
      grants, effects, resource limits, deadline, and parent budget, each tested separately.
- [x] 6. Settleable-child scan. `FactoryChildRuns.listSettleableInTransaction`, bounded, oldest-first,
      with empty, paged, and concurrent tests. Hands W09 its worker enumeration.
- [x] 7. Production wiring. `runControls` composed by default; run read and repair/replan controls in
      the browser client and a user control component.
- [x] 8. Verification. PGlite, real PostgreSQL, the Node Temporal replay producer, kernel golden
      traces, coverage, lint, typecheck, boundaries, gate integrity, BASE_REF=integ/w00 gates.

### Review

Six commits from `1dc9a0226`. The kernel now answers a protected rejection with a bounded
remediation wait instead of a stop command naming a task that never existed, consuming the
acceptance contract's declared `maxRepairs` under an absolute ceiling of three candidate
generations. `reference.code.v1` decides after its protected checks, so a rejection produces a new
candidate, a new freeze, every check again, and a new decision, which is the graph C10 specifies and
the defect the plan named. A replan is bounded by the authority the run already holds along sixteen
dimensions, each denied on its own. `FactoryChildRuns.listSettleableInTransaction` unblocks W09.
The production application composes the controls by default and an operator can drive them from the
browser.

Two bugs the tests found and one defect measured outside the checklist. The browser control cleared
the banner that reported its own outcome, twice. Cancelling a run with an in-flight acceptance, or
its deadline expiring, emitted a stop command the gateway cannot answer and that kills the whole
workflow; that is fixed for acceptance and filed for approval and release, whose cancellation
semantics this package does not own.

Full gate table, deviations, and receipts: `tasks/factory/w06-GATES.md`.

## W07 — GitHub publication and reconciliation

Branch `wp/w07-github-publication` from `integ/w00` at `1dc9a0226`. Evidence
`/tmp/factory-platform-evidence/w07/`. Gate file `tasks/factory/w07-GATES.md`.

- [x] 1. `feat(factory): encode operation ids in git refs` — freeze section 11. New
      `src/factory/release-git-refs.ts` with the reversible suffix, the `ezcorp-factory/`
      namespace, round-trip and conflict tests, a `git check-ref-format` conformance test, the
      `ref`/`branch` receipt fields, the `destination_ref`/`destination_branch` binding on the
      operation row, and the unvalidated head-branch interpolation in
      `src/extensions/project-open-pr.ts` fixed through one shared ref grammar.
- [x] 2. `fix(factory): move release reconciliation proofs out of the transaction` — freeze
      correction 1. Provider proofs and archive writes happen outside; authority is re-derived
      inside one transaction.
- [x] 3. `feat(factory): seal the resolved release profile into the claim` — resolve outside
      transactions under an abortable deadline, revalidate the exact input inside, install the
      release-profile completeness CHECK W05 left, add `listClaimableInTransaction`, the
      publication-set scope resolver reading the attempt id from verified protected command
      provenance, and production `FactoryDestinationReservationReader` / `FactorySenderFence`.
- [x] 4. `feat(factory): publish accepted candidates as draft pull requests` — the GitHub
      provider over the shared broker transport: immutable Git objects, the exact unique branch,
      one draft PR, returned-identity verification, never force-update or merge, complete tree,
      base parent, protected assets, paths, lock, and the submodule/LFS/link/network-install
      rejections.
- [x] 5. Archive-before-claim and receipt-before-settlement through W04a's writer; dropped
      responses after each external and archive write recovered by identity; reconciliation by
      exact ref/SHA and PR marker with the F04 matrix.
- [x] 6. Real tests against `ezcorp-org/factory-platform-publication-tests` with remote content
      verification, retained receipts, and cleanup of disposable resources only after evidence
      capture; the selected-repository App and broker-only namespace verification, with
      CLI-credential runs labelled as the narrower smoke test.
- [x] 7. Full verification per common.md and the `BASE_REF=integ/w00` gates; registered
      `tests/postgres` suites; restart-conformance cases for the migration change.

### W07 review

Every checklist row is closed except the two that are not code. The selected-repository GitHub App
and the broker-only ref namespace are unverified, because the runs use the local GitHub CLI
credential; the evidence says so in `credentialScope`, `selectedRepositoryAppVerified`, and
`brokerOnlyNamespaceVerified` rather than implying otherwise. And the archive-writer and
child-artifact PostgreSQL producers are blocked by the shared "ordinary" SeaweedFS store running out
of writable volumes for the `tenant-01` collection, which the repository's own unchanged
`verify-factory-storage.ts` reproduces; that receipt is kept as a failure, not counted as a pass.

What landed. One git branch grammar shared by the factory encoder and the v4 project path, so
"the branch is a valid ref" became an executable fact and the unvalidated head-branch interpolation
is fixed by construction. Local git object identity measured against real git, which turns every
SHA GitHub returns into a comparison rather than a claim. The reconciliation proofs and archive
writes moved out of the product transaction, with a test that counts transaction depth at every
external call and goes red when the old shape is put back. The asynchronous release profile sealed
into every preparation and revalidated against the pinned decision and material under a lock, which
let W05's deferred claim CHECK be installed. The GitHub adapter itself: one complete immutable tree,
one unique branch, one draft pull request, no force-update and no merge, and a real pull request
published to the private repository with its content read back byte for byte.

The one thing I would flag hardest for the coordinator is not a defect in this package: W08 and W07
each built a publication-scope resolver that reads the verified attempt id, by two different durable
paths. Both are correct and neither takes caller input, but one concept with two implementations is
what C13 forbids, and collapsing them crosses both packages' files.

## W10 — real code reference pack (Sol domain)

Branch `wp/w10-code-pack` from `integ/w00` at `1d3edf5b0`. Gate file:
`tasks/factory/w10-GATES.md`. Evidence: `/tmp/factory-platform-evidence/w10/`.

- [x] Pinned repository snapshot over real git, refusing symlinks, submodules, branch names, and
      short prefixes by name.
- [x] Native generator with the contract's twelve-iteration bound enforced in the runner.
- [x] Complete-tree freeze producing exactly the request W07's adapter validates, with the pinned
      base as the candidate commit's only parent, checked against real git.
- [x] Dependency, build, type, and test checks against the real Bun and TypeScript toolchain, on a
      disposable copy whose input tree digest is verified.
- [x] Pinned advisory and secret scans, reporting findings without quoting the credential found.
- [x] Path and protected-asset checks, reported as their own claims.
- [x] Separate supervised review in a toolless validator context, strict about its rubric.
- [x] The reference code validator as a real isolated attempt in a Podman guest.
- [x] The valid slugify fixture and every protected negative fixture.
- [x] Repair through W06: three real candidate generations, each remeasured, bounded at three.
- [x] Publication through W07 to the real private repository, with the remote tree and parent read
      back and compared.
- [ ] Actual provider usage for the generator and the reviewer. Blocked: this deployment holds no
      Anthropic credential. Recorded as a readiness failure, never substituted.
- [ ] End-to-end through the real started application. Blocked: W09 has not landed on `integ/w00`.

Review. The deterministic half of C10's reference code factory is complete and proven against real
systems rather than against a description of them: real git agrees with every object identity the
freeze derives, the real toolchain decides the build, typecheck, and test claims, a real Podman
guest reports the static claims from inside the sandbox, and the real private repository holds a
draft pull request whose tree and parent were read back and compared blob by blob.

The two model-backed legs are built and tested against every failure a real model cannot be asked to
produce on demand, but they did not reach the real provider, because no credential resolves here.
That is written down as a readiness failure with a receipt, and nothing anywhere substitutes a
canned answer for it. What it costs is the tenth mandatory claim, and the consequence is the one the
contract promises: the journey reaches the publication step against the real repository and refuses
to take it, naming `supervised-review` as the reason.

Two shared modules were split on the way, and both are improvements rather than accommodations. The
v4 byte digest no longer sits behind an S3 client, so hashing bytes does not require a storage
client and a JSON-schema validator; and the four claims that read only a candidate's bytes no longer
sit beside the five that need a workspace and a subprocess. Together they are what let the isolated
guest ship the product's own validator instead of a second copy written for the sandbox. Both are
declared as C13 rows, so the reuse is gated rather than assumed.

## Coordinator log — wave 2 tail and wave 3 entry (2026-09-14)

Decisions and routed interface questions, recorded so no package waits on an answer that already exists.

- [x] Discrepancy 10 (C01 scopes): version publish keeps the C01 `write` scope plus the `factory.publish` grant; grant management is `admin` plus the tenant-admin role; the package install/quarantine route has no handler and belongs to W14 (W09 landed the scope fixes).
- [x] W09 Q1 (settleable-child scan) closed by W06 at `a558a01d8`; W09 Q2 (claimable-release scan) closed by W07; W03's stop-settlement and usage-reconciliation scans closed at `688d48f4d`.
- [x] W10 Q3 (unused model pin in `references.ts` protectedChecks) routed to the SDK owner (Sol controls, W06); W10 Q4 (titleBodyDigest marker) routed to W07.
- [ ] W10 Q1: `FactoryRunnerRequest` does not carry the node's `maxIterations`, so the generator enforces C10's twelve itself. Decision: an optional additive `maxIterations` on the request, set by the dispatcher from the definition, lands with W13 composition; until then the generator's own bound stands and is tested.
- [x] W10 Q2: `createFactoryProviderBroker({ pin })` must be constructed and handed to the runner by W09's composition root; goes into W09's wiring round with W01b. — closed: W01e guest model-broker frame merged `71e8cc9ed` (todo.md:3155) (audit 2026-10-03).
- [x] W02b (manifest name): the v4 manifest grammar stays the shared contract; `RunnerReference.manifestName` is required and validated against it; the scoped identity stays in `package`; no deployed environment holds a bound package, so no re-issue is needed; the SDK crossing is disclosed and confirmed. W10, W11, W12 migrate per freeze section 17 once `wp/w02b-manifest-name` lands.
- [x] W01: the durable terminal result lives in two columns on `factory_attempt_launches` (freeze section 16); `FactoryHostLaunchProtocol.stop` keeps `FactoryPhysicalStopRequest` and W03 landed a parallel `FactoryPhysicalStopper` rather than reconciling it (superseded, recorded); the workspace-specifier resolver in `check-factory-boundaries.ts` is kept.
- [x] W04: the C02.11 checkpoint implementer landed on W04's branch and merged at integration; the two additive journal seams in `executions.ts` stay with W04; the section 7 deviations carry a dated note.
- [x] W07: the window-scoped S3 prune script was replaced by manifest-only cleanup (`4f4f76a29`); the rule is in `tasks/lessons.md` and the workers' common brief.
- [x] W01c: the guest material mount is landed by its owner (Terra runtime) with the review's corrections (`rw,noexec,nosuid,nodev`, no 0o777, typed refusal of any non-regular entry); W12 consumes `listRunnerMaterials`/`openRunnerMaterial` and a `REQUIRED_SHARED_IMPORTS` row enforces it.
- [x] WREG: `PATH` is the fourth declared guest variable (the pinned image's own directory list, per-image override for the Python guest); the contracts plan wording is corrected at integration; the two disclosures (`--unsetenv-all` collateral, `launchDetached` as the protected execution seam) go to Terra runtime.
- [x] Shared stores: the ordinary SeaweedFS tier hit the 100-volume cap (`b18b080fa`, now 400) and was then OOM-killed by its 768 MiB container limit (`c054c6430`, now 2 GiB). Both recorded in `/tmp/factory-platform-evidence/w00/shared-store-incidents.jsonl`. Two orphaned spinning `bun test` processes were killed and recorded in `orphan-process-cleanup.jsonl`; W05 could not reproduce the spin in twenty-eight bounded runs and now bounds every invocation.
- [x] Wave 3 merge order: WREG, W01c, W02b, W01b, W12, W11, W09; then the full combined run with the Podman suites, receipts under `docs/validation/factory/wave3/`, and the integration branch fast-forwarded before W13 starts. — closed: combined run wave3f green (todo.md:3155) (audit 2026-10-03).
## WREG — inherited backend-pool regressions (wp/wreg-backend-failures)

- [x] Reproduce all seven failures with the exact targeted commands, container-backed ones under the shared heavy lock.
- [x] Regenerate `wire-schema.json` so the wire validator accepts `StartRequest.devices` (freeze section 6).
- [x] Restore the v4 guest's `PATH` as a declared runner variable, with a per-image override for the Python guest.
- [x] Give detached execution a protected launch seam so `TrustedLocalRunner` runs its own local guest again, and make it refuse a device grant it cannot confine.
- [x] Keep the full shared Podman suite and every declared-environment suite green.
- [x] Canonical backend pool at 0 fail.
- [x] Typecheck, lint, factory boundaries, gate integrity, and the `BASE_REF=integ/w00` new-file and patch coverage gates.

Review. Seven failures, three root causes, and only one of them was the generated artifact it looked
like. The other two were product regressions the wave-1 runtime introduced in paths its own suites
could not see: `--unsetenv-all` removed the guest's `PATH` along with the image metadata it was
aimed at, and a private `launchDetached` replaced the one overridable method the trusted-local
runner depended on. Both fixes keep the property wave 1 wanted — a declared, tenant-independent
guest environment, and a guest whose lifetime outlives its supervisor — while restoring the v4
behavior that was lost. Nothing was skipped, relaxed, or excluded; the two closure tests still read
`RUNNER_GUEST_ENVIRONMENT` and so still assert the exact declared set, and the trusted-local test
kept every assertion and gained one. Full detail and receipts: `tasks/factory/wreg-GATES.md`.
## W11 — Real image reference pack (Terra domain)

Branch `wp/w11-image-pack` from `integ/w00` at `1d3edf5b0`. Evidence
`/tmp/factory-platform-evidence/w11/`. Gate file `tasks/factory/w11-GATES.md`.

- [x] Lock the SDXL revision, every weight digest, the runtime image, the
      interpreter, the generation settings, the normalization, the OCR
      configuration and threshold, and the evaluation configuration in one
      committed document with one digest.
- [x] Fetch the weight closure with every byte bound to a digest the lock
      declared first; seal it read-only and record source and digest.
- [x] Build the pinned guest image from the ROCm base plus the pinned wheels and
      the sealed weights; record its digest.
- [x] Pure-stdlib PNG structure, normalization, and OCR interpretation in the
      locked Python project, so the deterministic claims need no heavy
      dependency and stay fully measured.
- [x] The SDXL generation adapter with an injected pipeline, so the torch call
      site is exercised rather than excluded.
- [x] Seal the image guest through the shared Python recipe machinery with the
      observed distribution closure and the model pins.
- [x] Execute seeds 11, 23, 37, and 53 with the C10 settings under the GPU lock
      through W02's per-attempt device grant.
- [x] Ordered collect semantics: a dense input-ordered outcome per seed, failed
      variants visible, first accepted in input order selected.
- [x] Three strict protected semantic evaluations with the quorum and error
      rules; a missing or error result never counts as a pass. The rules are
      implemented and covered; the live provider leg is blocked on a credential.
- [x] The wrong-size and SALE-caption fixtures, with a blank control.
- [ ] The car and retained tree fixtures: their defects are semantic, so both
      wait on the evaluator.
- [ ] Publish the accepted variant through W08 with exact verified bytes. The
      mapping is implemented and covered; the end-to-end leg is blocked because
      a variant larger than one mebibyte cannot leave an isolated guest.
- [x] Report AMD execution separately from production GPU isolation, which stays
      unmet.

### Review

The pack is real where the platform allows it to be. One committed lock pins the
SDXL revision, all eighteen files, both images, the interpreter, the C10
settings, the normalization, the OCR threshold and the evaluation configuration,
and its digest moves when any of them does. The 6.94 GB weight closure was
fetched with every byte bound to a digest the lock declared first, and the guest
image was built from it and sealed at its own digest.

All four recorded seeds generated real 1,024-pixel variants on this host's AMD
card, each in its own isolated attempt through W02's grant path, and the device
contract held inside this pack rather than only in W02's probe. The byte-level
claims and the OCR threshold are measured by the pack's own standard-library
reader inside the guest that holds the bytes. The OCR claim discriminated on
real output without being tuned to: it rejected three variants for marks the
model painted and accepted the fourth, with a blank control scoring nothing.

Three things are open and none of them is a shortcut. A variant larger than one
mebibyte cannot leave an isolated guest at all, because the shared runner's
control-output budget is a per-worker lifetime limit; that blocks publication of
the accepted bytes and the semantic evaluation equally. There is no Anthropic
credential on this host. And `broker.invoke` has no production implementation,
so a guest-initiated model call has nowhere to land. Each is recorded as an
unmet row with its own verdict rather than folded into a summary.
## W12 — real data reference pack (Sol domain)

- [x] 1. Immutable CSV snapshot, strict parse, ordered 10,000-row partitions, pinned
      Python/PyArrow transform, ordered reduction, Parquet and manifest output.
- [x] 2. Independently recompute every row, ID, count, sum, schema, and partition invariant from
      input and exported data, against BOTH the immutable input and the manifest.
- [x] 3. Signed-64-bit boundaries and accounting overflow, in both runtimes and through the whole
      journey.
- [x] 4. The golden three-row input, and duplicate, missing-partition, changed-value, overflow,
      malformed, maximum-row, and 256 MiB boundary cases.
- [x] 5. Repair a defective transform only through a new pinned package revision; correcting the
      input requires a new snapshot and run.
- [x] 6. Publish through W08, and read the published bytes back from a real object store.
- [x] 7. Full verification per common.md, with every producer recorded from a clean committed tree.

### W12 review

The pass criterion held: the real exported Parquet and its manifest reconcile exactly with the
immutable source, including order, and publish through W08 to a real object store that hands the
same bytes back.

**On the order of events, because the first version of this paragraph got it wrong.** It declared
every row closed at a commit whose timestamp preceded the only then-current passing receipt for the
real-services leg, which is a claim the evidence did not support when it was written. What actually
happened: the embedded-database journey passed first; the real-PostgreSQL and S3 leg passed next,
including the W08 publication and the 256 MiB boundary; the maximum-row boundary was added after
that and passed on its own; and a faithful full-file rerun then FAILED it with
`factory_material_operation_full`, because a hundred partitions left too thin a margin against
W04's frozen per-operation object cap. That is fixed by folding the hundred per-partition summaries
into one material, and the case is now declared last so a full-file run is what proves it. The
receipts in `tasks/factory/w12-GATES.md` name the commit for each.

The package began with a wall, not with code. The isolated guest had no byte path out above one
mebibyte for its whole lifetime, so no domain pack could return a real Parquet partition, a real
PNG, or a real candidate tree. That was measured rather than inferred, raised with the coordinator
before anything was written, and fixed as one additive field: `StartRequest.materials`, a
per-attempt directory bind-mounted read-write, absent by default and with every C05 control
untouched. W01's and W02's own Podman suites still pass unchanged.

What landed. PyArrow in the committed lock and an image built from that lock, hash-verified, with
its closure read back out of a live guest before any artifact is sealed. The strict grammar written
once per runtime and held equal by committed vectors, so every shape `BigInt` and `int` would have
quietly accepted is a refusal with a name. An independent Parquet reader that shares no code with
the writer, because a validator that decodes with the encoder cannot catch a serialisation defect.
And a reconciliation that compares the export with the immutable input as well as the manifest,
which is the one comparison a defective transform cannot satisfy by also lying in its manifest.

Four defects the real runs found, each fixed rather than worked around: a staged input created 0600
under this host's umask and unreadable by the guest's uid; a reduction that took its results inline
where a hundred partitions would not fit a 64 KiB request; a seal that wrote one chunk per incoming
block and ran a 256 MiB material past its own plan; and a quadratic line split that would have
turned a 256 MiB parse into hundreds of gigabytes of copying.

What I would flag hardest is not a defect in this package. Two landed rules cannot both hold: a v4
manifest name must match `^[a-z][a-z0-9-]{0,63}$`, and `FactoryPackagePreparations.releaseFacts`
requires that name to equal a runner reference's package, which the compiled definition writes as
`@ezcorp/reference-data`. Every domain pack hits it.

## W09b — assemble the four held roles and prove G14

Branch `wp/w09b-assembly` from `wp/w09-startup` at `7af8579fd`. Gate file
`tasks/factory/w09b-GATES.md`; evidence `/tmp/factory-platform-evidence/w09b/`.

W09 left four roles held with every design question settled. This package is the
composition volume, the host services the supervisor must carry, and the
end-to-end proof that a submitted run reaches a real guest.

- [x] One construction of every durable store the roles share (`installation-stores.ts`).
- [x] `attempt-dispatch`: the preflight, `FactoryRemoteAttemptRuntime` over the
      host launch client, `FactoryPackagePreparations` over the shared v4 runner
      client, and W01b's dispatch driver.
- [x] `stop-settlement`: `FactoryTaskStops` over the host stop transport, the
      configured host public keys, and `PoolAdmissionClient.confirmStopped`.
- [x] `usage-reconciliation`: the page driver over the uncertain-hold scan,
      settling only on `resolve` → `resolved`.
- [x] `release-outcome`: composed, tested, and wired to W07b's consent reader.
      The driver reads the one consent the operation already has through
      `FactoryReleases.readConsentInTransaction` and claims as the run's own
      live initiator; the injected-consent parameter is gone. A typed absence
      leaves the operation untouched and is named.
- [x] `release-outcome` composes from the startup document and runs. The
      coordinator ruled the document is W09's own surface, so it gained a
      `release` section: named destinations (S3 and GitHub, credentials by path
      only) and the profiles that point at them. `release-declaration.ts` turns
      that into the provider resolver and the `FactoryReleaseCommandProfile`
      set; the startup suite proves the role registers and runs from the
      document alone, with nothing supplied by the caller. Grep and full reasoning in the gate file.
- [x] The supervisor process hosts W01b's host launch service and W03's host
      stop service, owns the one `PodmanRunner`, and holds the host key. One
      listener, one runner, one key — no third process.
- [x] The product process starts the private service the Node orchestrator calls.
      It had no production caller at all, which is why a submitted run had no
      path off `queued` however well the roles were composed.
- [x] G11: a run submitted over public HTTP executes a real guest, three
      consecutive clean passes on fresh product databases. Measured at
      `ca101ff19`; receipts in the gate file.
- [x] W13 follow-on: the `FactoryLegacyEngine` adapter, over `runWorkflow`,
      `findWorkflowRunByIdempotencyKey` and `getWorkflowRunRow`, with
      `FactoryLegacyWorkflows` and `FactoryLegacyImports` in the store set.
      Landed with the `integ/w00` merge, which is what unblocked it.
- [x] W13 follow-on: C11's thirty-second orphan detection bound is a declared
      factory readiness setting (`orphanSweepIntervalMs`), checked against the
      daemon's own reader by `assertFactoryOrphanDetectionBound` on `boot.ts`'s
      readiness surface, next to the C09 required-service list. A longer
      interval is a named readiness failure, never a silent pass.
- [x] G14: 100% line coverage on every new file and both `BASE_REF=integ/w00`
      gates. "New-file coverage gate PASSED: 23 new source file(s) gated." and
      "Patch coverage gate PASSED: all changed executable lines covered
      (40 file(s))." No `EXCLUDES`, no lowered threshold, no skip. Nine of the
      red receipt's fourteen findings were missing coverage LEGS rather than
      untested code; the leg set now mirrors `combined-integration.py`.
- [x] The full sweep at the final head with a clean tree: typecheck, lint,
      boundaries, gate integrity, schema drift, the focused suites, the Podman
      suites, and both coverage gates.
- [x] The `tests/postgres/factory-*` producers and the `postgres` and `pool`
      coverage legs, rerun once the stores came back: 6 files, 29 pass, 0 fail,
      and all seven coverage legs exit 0 for the first time.
- [x] G10b, G11 and G12 refreshed against the live stores, and the harness's
      startup document now declares an S3 destination: `/api/ready` reports
      ALL FOUR roles W09 held running, with only `notification-send` (W17)
      held. Three consecutive passes, each on a fresh product database.
- [x] G17: the declared destination reaches the real S3 store with the
      credentials it points at, a wrong secret is refused by the store, and an
      undeclared account is refused by name. Nothing written to the store.
- [x] The blockers for a PUBLISHED release are measured, verified and owned. A
      guest cannot stage an output artifact by any route — `NativeFactoryArtifacts`
      has no production implementation, the broker frame set has no staging
      frame, and a fabricated reference fails because
      `FactoryTaskCompletions` loads the artifact back. The release profile's
      `materials` collaborator is attempt-bound. Parked by the coordinator into
      **W01g** (staging frames) and **W08b** (profile lists under the accepted
      attempt's authority); W09b does not reattempt it. The empty profile set
      with a prepare-time refusal is the right state until W08b lands.

### W09b review

The four roles: three run, one is composed and holds. `attempt-dispatch`,
`stop-settlement` and `usage-reconciliation` register and run in the real
started application, over the real pool, the real host transports, and one
shared store set. `release-outcome` is now built end to end — it reads W07b's
consent and claims as the run's own live initiator — and holds on a declaration
rather than on code: no production code builds a `FactoryReleaseProvider`
because the startup document names no release destination. The startup suite
proves both halves, registering and running the role the moment a resolver is
supplied.

The real-guest run ends `failed`, and that is recorded as **notProven for the
COMPLETED path**. The minimal guest returns the canonical `cancelled` runner
result, which `FactoryTaskOutcomes` maps to `node-failed`, so the kernel stops
the attempt and fails the run. Everything up to the verdict is real — admission
against the live pool, dispatch through the preflight and the remote runtime, a
real guest in a real container, a durable terminal result, a physically
confirmed stop signed by the host, a settled budget hold, a projected terminal
status — but a guest that reaches `succeeded` has not been run, and no gate here
claims one has.

Rounds 3 and 4 finished the role. The startup document gained a `release`
section — named destinations with credentials by reference, and the profiles
that point at them — and `release-outcome` composes from it and RUNS: nine
roles running on the real started application, one held, and the one held is
W17's as planned. The declared destination is proved to reach the live S3 store
with the credentials it names, a wrong secret refused by the store, and nothing
written to it.

Round 4 found two blockers rather than shipping a proof, and both are now
owned. A guest cannot stage an output artifact by any route, and a fabricated
reference fails because the platform loads the artifact back; that is W01g's.
The release profile's material lister is attempt-bound; that is W08b's. The
declaration therefore composes providers and no profile, so `requestRelease`
refuses at prepare time instead of leaving a claimed operation that can never
publish.

One correction belongs in this review rather than only in the gate file. I
reported a typecheck red as inherited from staging on the strength of an empty
tree diff. It was a stale `zod@4.5.2` in this worktree's Bun store. A tree diff
proves the source is identical and says nothing about the installed graph.

Round 2's sharpest finding was not in the product. G14's red receipt was
measuring nine files whose coverage LEG had never been run, and that gap was
also hiding a live regression: this branch made a dispatch result carry the
refused commit's cause, and the only suite asserting that result was off the leg
list and red. Both gates now pass over a leg set that mirrors
`combined-integration.py`.

Three things were found by doing rather than by reading. The private worker API
had no production caller at all, so a submitted run had no path off `queued`
however well the roles were composed. The two readiness gates that the
orchestrator and the product hold over each other could never converge, because
the failure path closed the listener the other side needed. And hosting the two
host routes in the supervisor pulled the product database into a process C01
says holds only host identity — caught by the boundary test, fixed by splitting
the attempt wire out of the launch store.
### Coordinator log — wave 3 progress (2026-09-20)

- [x] Merged in order: WREG (e659795eb), W02b (a8eff0bfa), W01b (dfe3091f8), W11 (f45a94148), the release-authority manifestName fix (559db1d3e), W10 (b0a2ca872), W01c mount (f30da62fa), W12 (f1af41c16), W03c (8810d6eae), W01d (7d99dc75b). Combined run wave3c green at b0a2ca872; receipts in `docs/validation/factory/wave3/`; `feat/composable-factory-platform` fast-forwarded to 1784ab76c.
- [x] In flight: W09 composition round (preflight built over W03's retained admission; four roles to assemble; G14 real-guest proof), W11b (GPU journey rerun on the runner-owned handover), W12 follow-up (drop the caller-side handover), W01e (guest model-broker frame contract and adapter), W13 (composition and legacy adapter, started 2026-09-20 from f1af41c16). — closed: W01e merged (todo.md:3155); W09b merged (todo.md:3618) (audit 2026-10-03).
- [x] Next: validate and merge W11b, W12 follow-up, W01e, W09; full combined run with `--podman`; receipts under `docs/validation/factory/wave3/`; fast-forward feat; then W14 (after W09 and W13), W15 and W16 (after W09), W17 (after W09, W15, W16), W18 final gate, W19 campaign, W20 audit. — closed: W01e merged (todo.md:3155); W09b merged (todo.md:3618) (audit 2026-10-03).
- Decisions this session: the dispatch preflight reads the held allocation from `FactoryComputeAdmissions.readRetainedAdmittedInTransaction` and never derives or assembles a lease; the release-outcome resolver selects among the three providers by destination kind with GitHub lifted through `factorySynchronousReleaseProfile`; the guest model-broker payload is undefined and is Terra runtime's to define (W01e) before any adapter is written; the model-backed legs stay explicit readiness rows on this host.
## W13 — Composition and legacy adapter (Sol lifecycle)

Branch `wp/w13-composition`, cut from `integ/w00` and fast-forwarded to `8810d6eae` before any
work. Gate file: `tasks/factory/w13-GATES.md`. Receipts: `/tmp/factory-platform-evidence/w13/`.

- [x] Run `reference.catalog.v1` with data and image children in typed acceptance-only mode, with
      no child release operation created.
- [x] Embed their actual accepted bytes in the code candidate and perform the parent's own
      protected checks and acceptance.
- [x] Preserve child budgets, exact aliases, pinned revisions, parent authority, cancellation, and
      output schema boundaries. Child acceptance never grants parent acceptance. The alias is
      proven directly: the acceptance-only receipt's decision binds through
      `FactoryChildArtifacts.bind` to the exact parent attempt, and a decision the child never
      took is refused. Only the PRODUCTION composition that calls it from the child-completion
      path is outstanding, and that is W09b's wiring round.
- [x] Complete the allowlisted and administrator-attested legacy adapters on the existing executor:
      `factory:` start identity, journal-before-start, lookup after crash, unique-conflict
      classification, and the periodic orphan sweep as a host-maintenance-daemon sub-tick.
- [x] Exercise every C10 legacy status row, including terminal uncertainty for `awaiting_approval`,
      authority loss, expired lease, resumable suspension, and nonresumable failure.
- [x] Import legacy output only by a recorded digest-verified copy, and exclude the ownerless
      ez-factory job store.
- [x] Keep existing workflows, approvals, and ez-factory behavior outside factories working.
- [ ] The real `reference.catalog.v1` pull request containing actual child bytes. Open: the image
      child cannot reach acceptance without a model credential, and no Anthropic credential
      resolves on this host. Named readiness failure, not a substitute response.

### Review

Two halves, and they failed in opposite directions before anything was written.

The composition half looked finished and was inert. `SubfactoryNode.releaseMode` existed as a type,
a wire schema, five generated JSON Schemas, and three literals, and no runtime code read any of
them — so a child declared `none` would still have run its own release node and created a release
operation, which is the one thing C10 says it must not do. The catalog could not have run at all:
its three children declared output ports (`artifact`, `evidence`, `candidate`) that no child
definition produces, because every child's graph output is its release receipt.

Both are now one decision rather than two. The ancestry walk that already proves every parent
attempt is still current reports the inherited release mode on its way back up, so the authority
and the liveness answer come from one walk of one chain and cannot disagree. A `none` child's
release node completes with a typed acceptance-only receipt naming the accepted bytes and the
sealed decision that accepted them — no operation row, no profile call, no effect claim, no
approval consumed. The catalog declares that receipt as each child's output port, which makes the
boundary run in both directions: a publishing child's provider receipt cannot satisfy it, and a
composed child cannot be quietly promoted to publishing.

A cached copy of the mode beside the binding would have been cheaper and wrong. The freeze's own
lesson from the assurance review is that a sealed historical revision does not prove current
authority; re-deriving the node from the parent's compiled definition at its pinned digest is what
survives a repair.

The legacy half was the reverse: the contract described three stage-2b changes as outstanding and
two of them had already landed. The third had not, quite. The unique-key discrimination was gated
on the `factory:` prefix and could not see through `persistCritical`'s own envelope, so a `nested:`
conflict still reported `run-persistence-failed` — a message that says the durable row was not
confirmed when a row with that exact key demonstrably exists. Reverting the two-line fix turns two
of the four new cases red, which is the only way to know the fix was load-bearing.

What I would flag hardest is the detection bound. C10 says an orphaned legacy run reaches a
terminal or resumable state within the C11 bound, and C11 sets that at thirty seconds. The sweep
is a sub-tick of the host maintenance daemon, on every tick, which is correct; the daemon's default
wake interval is one hour. The factory side does not wait for it — an expired lease maps to
uncertain immediately, so a wrapped task never reads a lost run as alive — but the legacy row's own
resolution is bounded by a deployment setting rather than by anything this package can assert. It
is in the gate file as an interface question rather than as a second timer, because C10 says the
sweep is a sub-tick and not new infrastructure.

### Coordinator log — wave 3, third integration run (2026-09-21)

- [x] Merged: W01e (71e8cc9ed). Combined run wave3f green at 3d7fed172 on every producer, the four Podman suites, and both coverage gates; the wave3d patch-gate miss and the runner fixes are recorded in `docs/validation/factory/wave3/README.md`.
- [x] In flight: W09b (four roles assembled, legacy engine adapter landed, G11 real-guest proof, G12, G14, the sweep). — closed: W09b merged (todo.md:3618); W14, W15, W16 landed (todo.md:3684, 3947, 3584) (audit 2026-10-03).
- [x] Next: validate and merge W09b; combined run; fast-forward feat; W14, W15, W16, W17, W18 final gate, W19, W20. — closed: W09b merged (todo.md:3618); W14, W15, W16 landed (todo.md:3684, 3947, 3584) (audit 2026-10-03).
- Renamed the root instruction file to `AGENTS.md` and updated all live root-file references. Nested, scope-specific `CLAUDE.md` files remain unchanged.
- Added tested rootless Podman commands for the Linux development stack and the Linux/macOS production stack. Renamed the production override to `compose.podman-prod.yml`.
- Proved the uid/gid and bind-mount contract with executable tests, rendered Compose output, the production image user, and real rootless Podman write tests.
- Merged the current `main` and the concurrent PR-head merge without conflicts. The merged source tree is identical to the fully validated tree.
- Verification passed: lint, typecheck, production build, focused tests, 2,185 browser tests, 26,602 coverage tests, and all 1,631 enforced coverage files.

### Coordinator log — host reboot, main merge, quality gates (2026-09-21)

- [x] Host reboot at 03:40 local took every shared store down. Repair on podman: the existing `factory-platform-proof-postgres` container (pgvector/pgvector:pg16, data volume kept) was started; the two SeaweedFS stores were recreated through the rootless podman compose socket with a fresh credential directory (`/run/user/1001/ezcorp-factory-storage.0yXaRPtQ`), 2 GiB limits honoured, conformance passed. The old Docker-daemon containers remain exited and unused. Logs: `/tmp/factory-platform-evidence/w00/proof-postgres-start-reboot.log`, `storage-recreate-podman.log`.
- [x] `origin/main` merged into `integ/w00` (user instruction "use podman, pull the latest main"): b43558b34 (podman default entry point, CI quality gates, pi 0.85.1) at 53346001b, 0f949c307 (container-engine helper) at bf010dece, bd6fd9714 (Dependabot bump) at f50b041c3. Conflicts: both lockfiles (main's file, then `bun install`, verified additive), package.json (both sides), tasks/todo.md (union), web graph layout header, ci.yml node pin (main's literal `node-version: "22"` replaced by `node-version-file: .node-version`, which our pin test demands). Full backend pool 27576 pass, 0 fail at f50b041c3. Receipts: `/tmp/factory-platform-evidence/w00/main-merge*/`.
- Main's new gates, measured: `bun run test:coverage` cannot produce `coverage/lcov.info` on this host because the browser-route coverage receipt is CI-only (main's own tree fails identically), so the global floor and CRAP gates are measured here only over the combined runner's merged lcov. In CI both sit inside the required check "Per-file coverage gate" and BLOCK; "Mutation (changed files)" is report-only.
- Rulings: (1) compiled workspace output (`packages/**/dist/**`) leaves the lcov through the vitest leg's product-source filter, never through EXCLUDES; (2) the 38 functions above complexity 30 on the feature diff are split with no behaviour change under W18a (w18a-sdk: 20 in factory-sdk, factory-orchestrator, extension-runner; w18a-app: 12 in src/factory, src/runtime, web/src plus the dist filter and the floor measurement; 6 in five W09b-owned files wait for W09b); (3) the combined runner records the floor and CRAP results on every run (`--quality-blocking` folds them into the exit code once W18a lands); (4) W09b declares release destinations and profiles in the startup document (W09's own surface; plan W09 line 270) with credentials by reference, and the release-outcome worker claims as the run's live initiator, reading the consent and claiming in two transactions because `claim` re-validates the consent in its own.
- [x] In flight: W09b round 3 (release destinations, running release-outcome role, real-store producers, G14 already green at 214d7251e), w18a-sdk, w18a-app. Next: validate and merge W09b; combined run with `--podman`; second W18a pass on the W09b files; W14, W15, W16 in parallel; W17; W18 final gate; W19; W20. — closed: W09b merged (todo.md:3618); W14, W15, W16 landed (todo.md:3684, 3947, 3584) (audit 2026-10-03).

## W18a-sdk — split the twenty high-complexity workspace functions (2026-09-21)

Branch `wp/w18a-sdk` from `integ/w00` at `bf010dece`, merged `integ/w00` again at `c1377122b`.
Scope: reduce cyclomatic complexity below the new CRAP gate's ceiling of 30 in
`packages/@ezcorp/factory-sdk`, `packages/@ezcorp/factory-orchestrator`, and
`packages/@ezcorp/extension-runner`, with no behavior change.

- [x] `factory-sdk/src/validation.ts` — 8 functions split into per-responsibility validators.
- [x] `factory-sdk/src/compiler.ts` — the two graph passes, `compileFactory`, and `inferExpressionSchema`.
- [x] `factory-sdk/src/schema.ts` — the generated-schema matcher, one matcher per JSON value kind.
- [x] `factory-sdk/src/kernel.ts` — `applyRepair` phases and the `advanceKernel` reducer table.
- [x] `factory-sdk/src/expressions.ts` — `evaluate` and `inspect`, one unit per expression family.
- [x] `factory-orchestrator/src/workflow.ts` — `factoryWorkflow` phases (deterministic, no new imports).
- [x] `extension-runner/src/service.ts` — the HTTP dispatcher and three endpoint handlers.
- [x] `extension-runner/src/podman.ts` — `build` assertions, compile, and feature tests.
- [x] No test changed. No threshold changed. No new file, so no new coverage-thresholds key.
- [x] Gates: typecheck, lint, factory boundaries, gate integrity, schema-generate drift.

### Review

Every one of the twenty functions was over the CRAP gate's ceiling because it carried a whole
subsystem's decision table in one body, not because any single decision was complicated. So the
split is by responsibility and never by line count: one validator per schema keyword family, one
per JSON value kind, one per compiled node kind, one per API resource family, one reducer per
kernel event kind, one phase per workflow stage, one handler per runner endpoint. Each parent is
now a short sequence that reads as the list of things the subsystem checks, in the order it checks
them.

The binding constraint was that the existing tests had to pass unchanged, which they do: the SDK's
196 tests, the orchestrator's 48 Node tests, and the runner's suites are byte-identical to what
they were. That is only safe because every split preserves the order of checks, the error codes,
the messages, the paths, and the thrown types exactly. Two places needed care. In
`validateSchemaNode` the `$ref` arm must fall back to the caller rather than return, because a
reference node still owes its own `$defs` walk; returning early would silently drop that
validation. In `advanceKernel` the reducer table is typed over `DispatchedEvent`, the event union
minus the two kinds the caller answers before the table, so the switch stays exhaustive without a
`default` branch that no run could ever reach and no test could ever cover.

The other thing worth naming is what the split does NOT do. `validateCompiledFactory` used to
thread four accumulators through one 110-line pass; the phases now rebuild each index from the
graph the previous phase proved canonical, which is the same values by construction and makes each
phase independently readable. `repair` and `replan` became one fall-through case because both
already called the same reducer. Neither is a behavior change, and both are the kind of duplication
the gate was pointing at.


## W01f — the event-stream detach leak

Branch `wp/w01f-detach`, cut from `wp/w18a-sdk` at `9e7866e2b`. One product defect in
`packages/@ezcorp/extension-runner/src/service.ts`, reported by W18a-sdk as OPEN 2. Gate file:
`tasks/factory/w01f-GATES.md`. Receipts: `/tmp/factory-platform-evidence/w01f/`.

- [x] Reproduce end to end against the real service before touching any code, all four client
      close forms, with the reproduction recorded.
- [x] Measure which disconnect signal Bun 1.3.14 actually delivers, with a negative result for
      every candidate that does not work, including a heartbeat write.
- [x] Serve the private Unix socket with `Bun.serve` and release the attachment from
      `Request.signal`.
- [x] Bound the one disconnect the runtime reports nothing for with an attachment lease that every
      request from the holding host renews, and that re-arms while the host still owes a reply;
      declare the poll window and the lease as options with defaults and named refusals.
- [x] Keep a released attachment's whole queue for the replacement host, reverse calls and
      notifications alike.
- [x] Move `maxHeaderSize` into the handler rather than dropping it; record where the other
      `node:http` bounds already live.
- [x] Tests: each of the four disconnect forms, reattach after release, another worker's
      attachment untouched, many disconnects leaving none held, the queue surviving, both declared
      refusals, and the header, absent-body and unknown-endpoint paths.
- [x] `service.ts` at 183/183 lines, including the six lines that were unreachable before.
- [x] Static gates: typecheck, lint, factory boundaries, gate integrity.
- [x] Real-Podman producers under the shared heavy lock, in two batches, all exit 0: the two the
      brief named, the production service end to end, the factory supervisor, and six further
      runner integration suites.
- [x] `BASE_REF=wp/w18a-sdk` new-file and patch coverage over the merged LCOV.
- [x] After `wp/w18a-sdk` merged, take `integ/w00` at `850ffaa54`, rebuild the workspace packages,
      and re-run every gate on the merge, with both coverage gates at `BASE_REF=integ/w00` and all
      ten heavy producers in one lock acquisition under `flock --close`.
- [x] Validator round, ACCEPT-WITH-FIXES: hold the lease off for a host busy inside a forward call
      and let the shipped client take its stream back (F1); restrict renewal to the two requests
      that prove ownership (F2); correct the wire-behaviour, lease, `headersTimeout` and
      `CLAUDE.md` claims in the record (F3, F4, F6). Each fix pinned by a controlled revert.
- [x] Diagnose and remove the one observed test failure's dependence on host timing, rather than
      retrying it.

### Review

The six-line detach handler was not dead code written carelessly; it was correct Node code on a
runtime that does not implement the events it waits for. So the first hour went entirely into
measurement, and the measurement is the finding: on Bun 1.3.14 a `node:http` server raises no
`close` on the response, no `aborted` or `close` on the request, and no event on the socket — not
even the one `server.on("connection")` hands out — when a client drops a parked exchange. It goes
further than silence: with the headers flushed and the body streaming, five writes totalling
320 KiB into the dead connection all returned `true`. That last result is what closed off the
cheap fix, because a heartbeat whose write can never fail is a heartbeat that can never detect
anything. `request.socket` turns out to be Bun's synthesized `Symbol(fakeSocket)` with no handle
behind it, which explains all of it at once.

`Bun.serve` does deliver the disconnect, as `Request.signal`, within about ten milliseconds of a
host process being SIGKILLed. That made the fix a transport change rather than a handler change,
which is more than I wanted to touch in a defect package, so the test for it was whether every
existing assertion survives untouched: all five `service.test.ts` cases and every runner suite do,
because the wire protocol is byte-identical and only the plumbing under it moved. The repository
already required this direction — `Bun.serve()` over `node:http` is a standing rule in
`CLAUDE.md` — so the migration also removes a deviation rather than creating one.

One disconnect form stays invisible to the runtime: a client that half-closes its socket and keeps
reading. That is not really a disconnect — such a client can still receive its answer — but a host
that stops collecting its stream for any reason is a real leak, so the attachment became a lease
that every request from the holding host renews. It is not a timer guessing at a disconnect: the
renewal is an observed protocol event, the signal still releases immediately where it is delivered,
and the lease only bounds the case where nothing is delivered. Making the lease and the poll window
declared options that are validated against each other also made the whole thing testable in under
a second instead of in twenty-one.

The first version of that lease was wrong and I caught it by reading the client rather than the
service. `RunnerClient` collects an event, runs the host's reverse call, and only then polls again,
so the legitimate gap between two host requests is as long as the reverse call takes — up to the
sixty-second host timeout. A lease that counted that gap as silence would have evicted a host in
the middle of its work. The lease now re-arms while the host still owes a reply, which costs one
line and needs no second constant, because the outstanding call already carries its own timeout and
removes itself when it expires. Removing that one line turns the new busy-host case red, which is
how I know it is load-bearing.

Two things fell out of making the detach path reachable for the first time. The old code fell
through after detaching and spliced the queued notifications out to a client that had already
gone, so those events were lost to the replacement host; a released attachment now answers nothing
and keeps the whole queue. And `node:http`'s `maxHeaderSize` had no `Bun.serve` equivalent, so
rather than let a declared control disappear in a refactor it became an explicit check in the
handler with its own test.
## W18a-app — complexity of the application half of the feature diff (branch `wp/w18a-app`)

Worktree `.worktrees/w18a-app` from `integ/w00` at `bf010dece`. Gate file
`tasks/factory/w18a-app-GATES.md`, receipts `/tmp/factory-platform-evidence/w18a-app/`.

- [x] Split all twelve application functions the coordinator measured above CRAP 30, with no behaviour change: `assertReferenceImageLock` 92→5, the `listDeliveredNotifications` transaction 80→8, `handleApp` 80→14, `executeFrom` 47→23, `reconcileReferenceData` 46→13, the execution-gateway handler 43→17, `assertFactoryGitHubPublicationRequest` 43→1, the provisioning transaction 42→14, `stageInTransaction` 38→9, `assertReferenceDataManifest` 36→7, the pool admission handler 31→7, `finalizeTransitionArtifact` 31→6. Worst function anywhere in those twelve files is now cc 29 (`runWorkflow`, untouched).
- [x] Proved each split with the EXISTING tests, unmodified. No test file was edited. Ten of the twelve files read exactly 100% line coverage on the merged lcov; the two remainders are pre-existing uncovered lines the patch gate confirms are not this branch's.
- [x] Added one test file, for branches the split gave names to: five untested security controls in `web/src/hooks.server.ts` (legacy `pi_session` on both sides of its sec-M4 expiry, the fail-closed 503, the unjudgeable-cookie pass-through, the peer-address fallback, HSTS). Measured against `integ/w00`'s own web lcov, those lines were already at zero hits before the split.
- [x] Compiled workspace output no longer reaches the merged lcov. `BASE_REF=integ/w00` new-file and patch gates both pass.
- [x] Recorded the global floor and the mutation status rather than chasing them.

Review (W18a-app): the twelve splits are extractions by responsibility, and the
shape of each was decided by the code rather than by the score — one assertion
per locked section, one parse step per manifest section, one phase per claim
dependency, one handler per route family, one unit per notification kind, one
named terminal per exception class. Three of them removed real duplication on
the way: the artifact staging path wrote its seventeen-column locked SELECT
twice and its conflict comparison twice, the release projection re-read the
same nullable join columns in three places, and the gateway reduced five route
matches through a `??` chain that the material handler then could not ask about.
Two things are worth flagging to the coordinator rather than burying.

The first is that the dist ruling's diagnosis was wrong in a way that matters
for where the fix belongs. The ruling says compiled output "leaves the lcov
through the vitest leg's product-source filter". It does not: that leg already
pipes its lcov through `scripts/filter-web-vitest-lcov.ts`, whose allowlist
drops every record that is not a configured web product source, and measured
here it emits zero dist records. The fifteen that DO appear come from the Bun
SDK leg, because `packages/@ezcorp/factory-sdk/src/guest-model-exports.test.ts`
imports the BUILT barrel deliberately, to prove the compiled package re-exports
its guest-model bounds as values and not as a type-only re-export. That test is
correct and must keep doing it. So the rule went where every leg passes through
— `scripts/merge-lcov.ts`, which `scripts/test-coverage.sh` delegates to for
both the shard pre-merge and the host merge, and which the CI coverage job uses
to build `coverage/lcov.info` — and not into one leg's filter, which would have
fixed the one leg that never had the problem. It is not an `EXCLUDES` entry
either, for the reason the ruling gives: `dist` is not un-gated source, it is
not source at all.

The second is that the global floor cannot be honestly measured on this host.
It reads 67.37% (74496/110570 lines, 1299 files) against a 90% floor over the
fullest local merge the combined runner's leg list can build, and that number is
not the CI number and should not be quoted as one. The leg list has no producer
for `src/extensions/**`, `src/runtime/**`, `src/db/**` or
`packages/@ezcorp/sdk/**` — their producer is the sharded backend pool, which
`tasks/lessons.md` already records as CI-only — and the browser-route receipt
cannot be produced locally at all. Every one of the fifteen files owing the most
lines is pre-existing main code this branch does not touch, led by
`src/extensions/manifest.ts` (860 lines owed at 6.8%). The same leg-list gap is
why `check-coverage.ts` reports 932 files under threshold locally while the
diff-scoped gates both pass: the local merge is a factory-surface merge, not a
product merge. The floor is therefore reported, not fixed, and the twelve
functions' own contribution to it is the ten files now at exactly 100%.

## W08b — S3 manifest release profile over the attempt's own authority (branch `wp/w08b-profile`)

Worktree `.worktrees/w08b-profile` from `integ/w00` at `850ffaa54`. Gate file
`tasks/factory/w08b-GATES.md`, receipts `/tmp/factory-platform-evidence/w08b/`.

- [x] Added `FactoryVerifiedAttemptMaterials` to `src/factory/release-s3-scope.ts` (W08's file):
      attempt-agnostic at construction, re-derives the named attempt's own current
      `FactoryAttemptAuthority` fresh via `FactoryExecutionJournal.readAuthorityInTransaction` on
      every call, then delegates the actual listing to W04's `FactoryAttemptMaterials` under that
      authority. No new query, no widened authority, no standing grant.
- [x] Rewired the shared S3 publication conformance suite
      (`src/__tests__/helpers/factory-s3-publication-suite.ts`) to build `S3FactoryManifestReleaseProfile`
      with the new attempt-agnostic reader instead of the fixture-only attempt-bound
      `FactoryAttemptMaterials`, so every existing resolve/prepare/claim/dispatch/reconcile case --
      across the memory, PGlite, and real-Postgres-and-S3 producers -- now proves the
      production-composable path.
- [x] Added direct tests: exact listing for the named attempt; refusal by name of an unknown
      attempt and of any mismatched tenant/project/run; no standing grant across a second,
      independently constructed instance; cancellation honored before any database round trip; an
      unsealed material listed but never accepted by the profile; a lost materials response safe to
      retry; `prepare()` revalidating the exact resolved input in its own final transaction (freeze
      section 5).
- [x] Typecheck, lint (zero warnings after one `import type` fix), `check-factory-boundaries.ts`,
      `gate-integrity.ts` all green. Patch-coverage gate passes for the one changed source file
      (`release-s3-scope.ts`, 136/136 new lines from the focused suites alone); no new source file
      in this diff.
- [x] Nine neighbouring unit/PGlite suites that share `artifact-materials.ts`, the release store, or
      the release adapters re-run clean (133 pass, 0 fail across 10 files).
- [ ] Real-S3-and-Postgres leg (`tests/postgres/factory-s3-publication.test.ts`, includes the 256
      MiB multipart export) queued behind the shared heavy lock; see the gate file's addendum for
      the result once it lands.

Review (W08b): the whole package is one seam. `S3FactoryManifestReleaseProfile` already existed and
already declared exactly the capability it needed --
`Pick<FactoryMaterialService, "list">` -- so the fix was never to touch the profile, W04's reader, or
W09b's declaration; it was to notice that the only thing standing between "declared" and "buildable"
was an attempt-agnostic implementation of that one method. `FactoryAttemptMaterials` binds its
authority at construction because every one of its OTHER methods (`begin`, `writeChunk`, `seal`)
needs a live, deadline-checked authority to authorize a write; `list` does not carry that same
requirement (`authorizeMaterialReadInTransaction` stays available after the deadline), which is
exactly the seam `FactoryVerifiedAttemptMaterials` sits in -- construct the one write-shaped
collaborator fresh, per call, from an authority that is itself re-derived fresh, and reuse it for
exactly one read. Nothing here is a new authorization rule; it is the existing rule, invoked at a
different point in time than its one prior caller (the gateway, which always has a live token)
ever needed to invoke it from.

The choice to swap the shared conformance suite's own profile construction, rather than adding a
second parallel test file, was deliberate and is the reason thirteen pre-existing cases (resolve,
malformed schema, archive-before-claim, receipt-before-settlement, interrupted staging, foreign
object conflict, exclusive publication, the 256 MiB multipart leg) now prove the production-composable
claim for free, including on the real store, without a second copy of that fixture to keep in sync.
The four new tests earn their place by testing a property the swap could not: that the new reader
actually refuses a name it was never given, that it holds no state across calls, that it is safe to
retry, and that a change made after resolve cannot ride the frozen result into a commit.

### Focused-batch cross-file isolation — wave4a (2026-09-21)

Nine failures in the combined run's `focused` check, which puts 222 files in ONE `bun test`
process. All nine pass alone. Gates: `tasks/factory/focused-batch-isolation-GATES.md`. Receipts:
`/tmp/factory-platform-evidence/w00-focused-triage/`.

- [x] Reproduced the batch at `c1377122b`: 2723 pass, 9 fail, 222 files, 599s.
- [x] Bisected each victim against the files before it. Four leaks, each reproduced in two files.
- [x] `src/__tests__/bundled-v4-bootstrap.test.ts` — `afterAll(() => mock.restore())` cannot undo
      `mock.module()`. Its stub `DatabaseLifecycleRepository` persisted, so
      `bundled-wiring-activation.test.ts` wrote no installation row and `publishExtensionGeneration`
      refused with `generation_superseded` (3 tests). Now also calls `restoreModuleMocks()`.
- [x] `src/__tests__/trusted-local-runner-in-process.integration.test.ts` — left the module-level
      `hooks` and memoised `runner` of `src/extensions/trusted-local-runner.ts` set, so
      `trusted-local-runner-wiring.test.ts` never saw the unconfigured start it walks from
      (4 tests). Added `resetTrustedLocalRunner()` beside `configureTrustedLocalRunner`; the
      integration suite calls it in `afterAll`, the wiring suite in its own `beforeAll`.
- [x] `packages/@ezcorp/extension-runner/tests/provision.integration.test.ts` — asserted it owned the
      process's first SDK bundle, which the podman suites build first through `tests/helpers.ts`
      (1 test). The cache cannot be emptied to force ownership: a second `Bun.build()` in one
      process really does read the wrong files, measured as `EISDIR` on four packages. The suite now
      settles the owed build outside the spy and requires its three toolchain roots to add none.
- [x] `src/__tests__/executor-slash-command-expansion-e2e.test.ts` plus the two shared test helpers
      — a `mock.module("$server/…")` is permanent and freezes the specifier, so a partial factory
      deletes the other exports for good. `installer-idempotent-local.test.ts` could not link
      `checkProjectRole` and its whole file was lost (1 unhandled error, 16 tests never run). The
      suite now spreads the real middleware and reverts its one override; `mock-request.ts` no
      longer registers `$server/db/connection`; `mock-cleanup.ts` no longer re-registers `$server/*`
      aliases, which its own SERVER_ALIAS_PREFIXES comment already says it should not.
- [x] `src/__tests__/bundled-wiring-activation.test.ts` — a FIFTH leak, which the first one had been
      hiding: its `beforeAll` initialises the `services` singleton of
      `src/extensions/extension-lifecycle-service.ts` against its own PGlite and its `afterAll`
      closes that PGlite. While `bundled-v4-bootstrap.test.ts` still leaked a stub over
      `getExtensionLifecycle`, that call never reached the real initialisation, so the singleton
      stayed empty and `extension-lifecycle-service-trusted-local.test.ts` built its own. Repairing
      the stub exposed the real dependency: 4 tests failed with "PGlite is closed" and with the
      trusted-local hooks never installed. Added `resetExtensionServices()`, which also clears the
      recovery timers; both suites call it.
- [x] Verified: batch green in one process (2747 pass, 0 fail, 222 files, at 78c27fec0); every
      changed file green alone; typecheck, lint, gate-integrity and factory boundaries green.
- [x] Sweep (coordinator's follow-up): the four other suites that register `$server/db/connection`
      themselves, fixed the same way and each proved against `installer-idempotent-local.test.ts`,
      the victim that reaches the alias through a web route. `phase-2b-e2e` cost it two tests;
      `mentions-search-workflow-branch` and `mentions-search-symlink-integration` cost it its whole
      file twice over, first on `checkProjectRole` and then on `listProjects` — each repair exposed
      the next partial alias in the same block. `scratchpad-e2e` broke no victim and is still
      changed, because its export set was frozen at `getDb` either way. Two pure pass-throughs were
      deleted outright; the two genuine stubs moved onto relative paths that `restoreModuleMocks()`
      can restore, and the middleware stub takes the spread-and-revert pattern. No assertion
      changed. Pairs now 24 / 34 / 29 / 21 pass, 0 fail.
- [x] Round 3, after the validator rejected the sweep and was right. The sweep moved three stubs
      off `$server/*` aliases onto relative paths; that only works while NOTHING claims the alias,
      and a dozen suites claim `$server/db/queries/projects`, `mockServerAlias()` included. The two
      mentions suites now claim it again, spread and reverted, and DROP their `$server/db/schema`
      stub outright — a route module is linked once per process, so re-registering an alias cannot
      rebind an import already resolved, and an empty table reached a later suite's real drizzle
      query as `Object.entries(undefined)`. Added `serverContextStub()` so a partial
      `$lib/server/context` factory can no longer delete `getGoalHost` for whoever follows.
      Verification replaced: every ORDERED pair among the twelve touched files, 129 of 132 green,
      and the three red ones measured identical at the merge base c1377122b. Batch 226 files,
      2791 pass, 0 fail.
- [ ] Three ordered pairs stay red and are not this branch's: `scratchpad-e2e` before either
      mentions suite, and `trusted-local-runner-wiring` before the in-process integration. They are
      link-order conflicts between suites that share one route module or one package mock, they
      fail identically at the merge base, and the runner's order never takes those directions.
      Fixing them means redesigning a suite; the obvious shortcut, a private module copy, is the
      coverage trap that the workflow-branch suite exists to avoid.
- [x] The per-file pool is NOT green on this host, and not because of this branch. Two runs, two — closed: later full pools green, wave4f runner 37 legs (todo.md:5523) and wave4h run 3 (audit 2026-10-03).
      different untouched real-subprocess suites: `sample-loop/index.integration.test.ts` (1 test)
      then `production-image-lifecycle-launch.integration.test.ts` (3 tests), each passing alone at
      the same load, on a box carrying several other agents' pools at load 21 and 36. Left as
      found: raising a timeout to make a saturated machine green is the gate-weakening CLAUDE.md
      names. The pool still shows 27575 and 27573 passes over 1860 files with no failure in any
      file this branch touches, and the two source files changed by addition only.

Review. The five leaks are one shape: process-global state that a test file sets and does not put
back. Two of them were stacked — the module stub that broke the activation suite was also
suppressing a lifecycle singleton the trusted-local service suite depends on, so the batch had to be
re-run after each repair rather than once at the end. Two are module variables (a bun module-mock registry entry, a memoised runner), one is a
process-wide build cache that is correct in production and only wrong as a test premise, and one is
bun's alias-mock registry, which has no unregister at all — so the only safe alias mock is one whose
export set is complete and whose behaviour reverts. The provision suite is the one place a premise,
not a leak, had to change: its assertion moved from "this process built once" to "these three
toolchain roots built none", with a new assertion that the bundle really was bundled, because
forcing the build it assumed is a measured crash. Main's `bun run test` and `test-coverage.sh` host
pool both run one file per process, so none of these four pairs can share a process in CI today;
the repair protects the combined runner now and CI against any future grouping.

### Coordinator handoff (2026-09-22 01:10 UTC)
See `docs/validation/factory/wave4/HANDOFF-2026-09-22.md` for branch heads, in-flight packages (W09b ready for validation; W07c and W01f awaiting verdicts; W01g and W08b in progress; wave4b combined run in progress), rulings, the ordered remaining work (W09b, W01g, W08b, W09c, second W18a pass, W14–W17, W18, W19, W20), and the environment facts.
### W07c — the release declare race (2026-09-21)

Branch `wp/w07c-declare-race`, cut from `integ/w00` at `bbcb2e34f`. Gates:
`tasks/factory/w07c-GATES.md`. Evidence: `/tmp/factory-platform-evidence/w07c/`.

- [x] Reproduce the C04 archive-writer concurrency case against the real proof PostgreSQL, before
      any code change, and capture the failing statement verbatim.
- [x] Find the cause in the declare path and write it in the gate file.
- [x] Fix at the root, with no new identity and no widened acceptance.
- [x] Drive the race instead of waiting for it, and prove the producer red before the fix.
- [x] Keep the refusal-by-name behaviour for a declaration that is genuinely different.
- [x] Pin the primary-key collision with a case that has no timing dependence.
- [x] Sweep: typecheck, lint, factory boundaries, gate integrity, schema drift, the release
      suites, the real-PostgreSQL producers, and both coverage gates.

**Review.** The C04 archive-writer concurrency case failed with 23505 on
`factory_release_operations_pkey` since 2026-09-14 in the w07, w08, w10 and wave4a runs. The declare
statement listed the nine-column identity index as its only `ON CONFLICT` target. PostgreSQL
arbitrates only the index a conflict target names, and the operation id is a digest of a strict
superset of those nine columns, so two identical declarations always collide on the primary key as
well; whichever declaration lost the microsecond race between the arbiter pre-check and the index
write hit the primary key first and raised. The fix removes the conflict target, which makes every
unique index arbitrate. That widens what converges, not what is accepted: the exact durable reread
after the insert already decided identity and still does, so a declaration that shares the nine
identity columns under a different id is refused as `factory_release_conflict` and a primary key
that collides without a matching identity is refused as `factory_release_corrupt`. Both of those
cases pass against the unfixed code as well, which is the evidence that the arbiter widened and the
contract did not. Reproduction went from 1 failure in 20 ambient runs to 17 in 20 once a
`BEFORE INSERT` trigger parked both declarations ahead of the arbiter pre-check; after the fix the
driven producer is green and the original case runs fifty times clean. The one structural change is
that the C04 world moved out of the conformance closure so the new producer reuses it rather than
building a second one; the conformance's own behaviour is unchanged.

**W07c validation round (2026-09-21).** ACCEPT-WITH-FIXES on `acb49f2b6`; the production fix needed
nothing. Three fixes applied on `f2ed5c118` and this commit. F1, the only blocking one, was a defect
in my own producer rather than in the fix: `parked()` counted `pg_locks` without filtering by
database, and since `pg_locks` is cluster-wide while an advisory locktag is per-database, two
parallel copies of the file counted each other's waiters and the readiness check failed its exact
match about fifteen percent of the time at width 3. It was a false red and could never have hidden a
regression, but it would have made CI flaky. Filtering by database makes the blocking set and the
counted set agree; twenty runs at width 3 and twenty at width 2 are now clean, with the barrier
message in none of the forty logs. F2 reran every producer at the final source head, because two
receipts named a commit that an amend had removed. F3 corrected the name of the nine-column arbiter:
it is declared in `schema.ts` as `idx_factory_release_operations_identity` but the migration creates
it as an inline UNIQUE, so the database calls it
`factory_release_operations_tenant_id_project_id_run_id_node_key`. A live probe confirms two unique
arbiters and only two.

## W16 — Complete provisioner and deployment profiles (Terra deployment, branch `wp/w16-provisioning`)

Evidence: `/tmp/factory-platform-evidence/w16/`. Gate file: `tasks/factory/w16-GATES.md`.
Base: `260855e57` (W09b merged). Assumptions are stated in the gate file.

- [x] P1 Phase model and step ledger: resources prepared, deployment ready, invitation issued, human bootstrap complete; seven ordered C12 steps with explicit owner, attempt, and failure record per step. Extends `src/factory/provisioning/local.ts`; no second workflow.
- [x] P2 Step 2: product and independent archive storage credentials written per installation at 0600, prefix scope verified read-only (inside 404, outside 403, foreign 403).
- [x] P3 Step 3: Temporal namespace with a namespace-scoped client certificate and token; the local gateway refuses a foreign namespace.
- [x] P4 Step 4: JWT and encryption secrets plus a wrapped data key under an operator master key held outside every grantable root; format, mode, and owner verified; a base64 application secret is refused as a master key.
- [x] P5 Step 5: per-installation harness, orchestrator, and gateway deployment bundle (startup document, process configs, secret delivery), wrapped key and master key only to the orchestrator.
- [x] P6 Step 6: trusted hostname ingress bound to the installation ID; the harness refuses a foreign or missing host; a partial tenant serves no traffic.
- [x] P7 Step 7 and bootstrap: first-admin invitation gates first-run setup; explicit bootstrap consent writes trust grants and the bootstrap record with a transactional audit entry.
- [x] P8 Fault every step; recover or tear down only owned resources; credential rotation and revocation; rerun idempotence.
- [x] P9 Operator-only control plane and tenant directory (routing, membership, resource references only; no tenant route, no product authority).
- [x] P10 Compose self-hosted profile (pinned images, secrets by file, health checks, bounded resources, loopback-only networking) and Kubernetes hosted manifests (validated; kind/k3d smoke only if tools exist).
- [x] P11 Supervisors outside harnesses: ONE shared host systemd unit per fleet (Compose profile, coordinator ruling 2026-09-22) and a privileged DaemonSet (Kubernetes); only they hold runtime access and host identity; separation tested in both profiles.
- [x] P12 Fleet upgrades: canary first, C12 order, old build retention, failure-stopped waves, reverse-order additive rollback; teardown keeps the release archive; human-admin purge after active and uncertain work closes.
- [x] P13 GPU host profile registration in a new file; production GPU criteria stay a named readiness row.
- [x] P14 Ten local installations through the Compose profile on rootless Podman with distinct identities and credentials.
- [x] P15 Operator documentation: prerequisites, image and runtime locks, secret references, recovery, drain, upgrades, rollback, CPU-only availability.
- [x] P16 Sweep per common.md after `git merge --no-edit integ/w00`.
- [x] P17 Review-1 fixes (H1-H4, M1-M9, L1-L11), the static live-path review's defects, W15's namespace settings and restore scope, and no fleet role residue on the cluster.
- [x] P18 Shared pool and supervisor per the ruling: readiness keyed on the service's own identity (product side) and the fleet host (provisioner side).
- [x] P19 Merge integ/w00 2b2e12550 (70def1355): both sides kept in migrate.ts and todo.md; W01g's supervisor fixture by ruling; W15/W15c items recorded in the gate file.
- [x] P20 Gateway probe accepts the execution gateway's own route-less 401 (a1ba5d95b), found by the live fleet; the test runs the real gateway.
- [x] P21 Final hold f3 at a1ba5d95b: PostgreSQL producers first, Podman suites, route proof, live Compose fleet and lifecycle, Kubernetes, boundary suites, coverage vs 2b2e12550; all 32 legs exit 0 (G15).
- [x] P22 Render W01g's guestBroker route for every installation (ruled a defect): installation side at d77d70cc8 (G16 unit proof; live pending).
- [x] P22b The host side of the guest-broker route: W16b (keyed services.guestBrokers) merged; the supervisor renders one entry per admitted installation.
- [x] P23 Final hold at the head that renders guestBroker, short form by ruling: r5c and r5d at cb2680fbe green (live fleet 51/51 and 27/27 with the W01i peer checks, Kubernetes, runbook mock pass, factory-services lane 12/12). The Podman suites, route proof, coverage and static set run in validator-2's hold.
- [ ] P24 Disclosed follow-up owned by W16: the restore-to-checkpoint lifecycle step.
- [x] P25 Merge integ/w00 97423ce17 (41d67cc48), c3da32784 (4785687be, peerTenants renderer; 123 suites plus the orchestrator package, the 124th, all run outside the hook), c9b7bab5b (e1d118c7c) and d65886b9a (2fa3443fa, hook 10/10 green).
- [x] P26 Every pool config writer drops installationId (317a0d622): the runbook stack and the factory-services e2e stack; a test parses each runbook process document with its process's parser.
- [x] P27 A pool that cannot start prints why (cb2680fbe).
- [x] P28 Holds r5, r5b, r5c and r5d recorded in the gate file with every refusal and red named.
- [ ] L1 (low, evidence script, owner W16): the self-hosted proof's peer-tenant probe reads the CA, certificate and key from the harness delivery directory.
- [x] Landed 2026-09-28: merge `bc22c62b0` (wp/w16-provisioning `0bf2fcaa2`), receipts `42ed49318`. P24 and L1 stay open under W16.

### Review

W16 lands the C12 provisioner in seven owned steps and four phases. The fleet
host runs one pool and one host supervisor that every installation shares
(coordinator ruling 2026-09-22): readiness keys on the shared service's own
identity, and tenant scoping stays in the pool's certificate map. Around them
are the Compose profile on rootless Podman, the Kubernetes manifests, fleet
upgrades, session-issued purge approval, and operator documentation. Live
evidence on this host, at head db8acda26 in one heavy-lock hold: ten
installations, one shared pool and supervisor, 36 of 36 self-hosted checks;
23 of 23 lifecycle checks (rotation, canary waves with walk-back and additive
rollback, teardown, purge); the Kubernetes manifests schema-valid and admitted
by a local kind cluster (labelled, not a hosted pass); and the common.md sweep
all green. The live runs found and fixed real defects the unit tests could not
see: Bun's JSON and array binding, a precedence bug, a gateway probe that
treated 404 as down, unbounded product database pools, unreadable image files
under a private umask, Envoy's user, the unconfigured extensions, and daemons
failing on the read-only root. After the 2b2e12550 merge the final hold at a1ba5d95b
passed every leg (self-hosted 42/42, lifecycle 27/27), after a live run
exposed a gateway probe that accepted only a 404 the real gateway never sends.
Open: the host side of the guestBroker route (a defect, blocked on a design
ruling) and the restore-to-checkpoint lifecycle step (disclosed follow-up).

2026-09-28: W16's product code was green through r5 except for integ's own C13 row, which W01j fixed. The first
live runbook pass (r5b) found a real W16 defect: the stricter pool config broke two harness writers that no test tied
to the parser. The fix and a guard test landed red-first, and the pool now says why it fails. r5c and r5d then passed
every short-form step at cb2680fbe, including the first live run of the W01i cross-tenant checks. That run also needed
two fixes outside the product: the proof read the host CA from the wrong directory, and W18c's lane race was avoided
with the lane's external mode. Open: P24 (restore lifecycle step) and G15's Podman, route, coverage and static parts
in validator-2's hold.

## W14 — Live console, scoped API, and browser journeys (Sol product, branch `wp/w14-console`)

Base `260855e57` (W09b and W13 merged). Evidence: `/tmp/factory-platform-evidence/w14/`. Gate file:
`tasks/factory/w14-GATES.md`. Files in flight elsewhere are consumed, not edited: `_shared.ts`,
`private-service.ts`, `task-stops.ts`, `orchestration-process.ts`, `pool/process.ts` (W18a-2);
`release-declaration.ts` and the profile composition in `installation-startup.ts` (W09c); the guest
broker, guest SDK, and runner result path (W01g).

- [x] Mutation baseline for `web/src/lib/factory/*` and `web/src/lib/graph/layout.ts`; kill survivors with assertions; record before/after.
- [x] Run inspection read model: nested runs, attempts, blockers, costs, artifacts, acceptance reasons, releases (new `src/factory/run-inspection.ts`, one scoped read, bounded pages).
- [x] Snapshot plus contiguous SSE cursor: signed cursor, duplicate/gap handling, 410 on expiry, authority recheck per batch, revocation closes the stream, bounded pages; client state machine with visible lag/disconnect.
- [x] Package admin routes over W02's `FactoryPackageTrusts`: list, install (bind + publish), quarantine, revoke, affected-run preview; human session plus tenant administrator; audited queued result.
- [x] Grant administration panel over the existing grant routes (admin scope plus administrator role).
- [ ] Administrator purge request: human administrator session, preconditions evaluated, audit that will be lost recorded; no destructive action (W19). (Waiting, item 13: the W15 and W16 purge preconditions; the request itself is proven.)
- [x] Artifact downloads and previews: scoped short-lived ticket, `nosniff` plus attachment, escaped text, no executable SVG/HTML at the origin.
- [ ] Console UI: run inspector, live stream states, repair/replan, approvals and uncertain release (existing components), packages, grants, purge. (Waiting, items 1 and 2: the approval decision and uncertain release need W09c's web composition, repair and replan need W01g; they are proven in components and the mock tier only.)
- [x] JSON/YAML/SDK/editor digest parity for every construct; unknown versions read-only and exportable; save/publish race; repeated idempotency keys.
- [ ] Two installations with overlapping IDs: users, restricted API keys, service principals, expiry, revocation, transactional audit failure; read-sharing grants expose only named bytes. (Waiting, item 9: proven at the service level on two isolated databases only; two HTTP installations need W16.)
- [x] `factory-services` lane: Playwright config, real-stack boot, specs through the real authenticated application; register lanes, route manifest, evidence surfaces.
- [x] Inspect real captures at 1440 and 390 pixels, long labels, large maps, light/dark, keyboard-only, reduced motion; fix defects and console errors.
- [x] Final sweep per common.md plus web check, web Vitest pool, factory Playwright lanes, mutation after; report.

Review (W14): the console is proven through the real authenticated application. The seven
`factory-services` journeys pass on the real stack at `74ce48d06`: trust grant, bind and trust a
built guest, publish, a save racing a publish plus idempotency replay, a run started from the
version list and watched to its terminal status, the scoped API, and a quarantine preview plus
purge request. Real captures found four defects that mocks had hidden, and all four are fixed:
a stale "queued" row next to a failed run, a "not yet" acceptance note on a finished run,
cramped 390 px run cards, and a spaced-out purge count. Mutation on the console library rose
from 79.74% to 93.30%. The lane needs the Temporal CLI dev server, because the Java test server
cannot report task-queue pollers; CI now asks for `FACTORY_TEMPORAL_CLI`. Open: package
preparation has no product route, quarantine fences nothing live (W02), purge preconditions
exclude W15/W16, and two installations are proven at the service level only. Gate file:
`tasks/factory/w14-GATES.md`.

Review update (W14, after the coordinator's rulings): the console answers through the shared route
boundary (W18a-2's route kit plus one additive error-family hook), the raw stream and bytes routes
are pinned to the principal-and-scope call pair, and W09d's validator-material read and typed
contract refusal are in. W15 restore signing is deferred until W15 lands; the branch holds no W15
commits. The real lane passes 7 of 7 at `096fa0944`; mutation is 93.62%; no W14 line is uncovered.

Review update (W14, round 2, head `28a720913` on `d6f143ccb`): the static-review fixes (H1, M1, M2,
L1 to L3, L5, L7) and the thirteen proof-map items are done or recorded as waiting, each with its
spec named in `tasks/factory/w14-GATES.md`. The real lane passes 11 of 11 at a clean head
(`journeys-11`). New through the real application: both fixed save/publish orders, catch-up and 410
on the event cursor, validator-material reads, no release authority through a share, grant expiry
and a ticket recheck, a live approval blocker with mid-stream revocation, a read-only future draft
that still exports, and long labels with a 40-node map at 1440 and 390 px in light and dark. Real
captures found four more defects, all fixed: the 390 px tab rail, a lone run card, the purge caption
casing, and an unbounded evidence wait. Mutation is 95.60%; no W14 line is uncovered. Waiting: W15
(restore, L4, M3), W02c (fence and quarantine commit), W09c (web inbox composition), W01g (a real
candidate), W16 (two HTTP installations).

Review update (W14, round 3 part 1, head `754d7b29b`): the validator's four findings are fixed. The graph
canvas follows the app theme and opens at a readable zoom; the real lane checks theme and label size at 1440
and 390 px in light and dark, and the mock tier proves the check fails on the old canvas. Waiting items are
unchecked. `run-format.ts` mutants now die by assertion (91.86% to 97.98%, 60 timeouts to 0). The selected
run scrolls into the narrow strip. Real lane 11 of 11 and sweep green at the clean head. The restore port,
W02c, W09c, W01g, and W16 items wait for their integ/w00 hashes.

### Round 3, part 2 (worker w14-continue, from `46237000f`)

- [x] Read the lane and sweep queued at `46237000f`: `journeys-14` 12 of 12, `sweep-11` every leg exit 0.
- [x] Author check: every branch commit is archy's; `754d7b29b` (fixture identity) was rewritten to `5ea00bea8` (same tree) by the 04:02 reset-author rebase.
- [x] Merge integ/w00 `2b2e12550` (W02c, W01g, W09c, W09d-2, W04b, W12c, W15, W15c).
- [x] W02c: the console builds its trusts with `createFactoryPackageTrusts`; the preview counts live attempts with the fence's own query; the console shows the affected-run record; the real lane commits a quarantine and lifts it.
- [x] W04b: the grants panel names each grantee by display name.
- [x] W09c: the web process composes command approvals beside release operations; the installation's release store can list an approval node's request; the real lane approves a release and denies an approval node in the inbox.
- [x] W01g: the lane guest stages its output and completes; with W09d's declared validator the run is accepted, released, and `succeeded`.
- [x] `run-stream.ts`: strict harness and exact assertions. The score is not measurable on the Vitest 5 toolchain (finding in the gate file).
- [x] Final passes at `4b96f6f77`, one receipt per leg; gate file and review.
- W16 items (two HTTP installations, W16 purge preconditions) wait until W16 lands.
- Follow-ups, disclosed: repair, replan, and a real uncertain release need a rejected candidate or an uncertain provider outcome, which the lane cannot produce; they stay proven in components and the mock tier. Findings for other owners: the mutation tooling since Vitest 5 (main), a denied approval that never ends its run (W03 stop path), and the quarantined live attempt that stays cancelling (W02c/W03, known).

Review update (W14, round 3 part 2, code head `4b96f6f77`): the items that waited on W02c, W04b, W09c and W01g are done through the real application. The real lane passes 12 of 12 (`journeys-26`). A run now completes, is accepted by the declared validator, is approved in the console inbox, and is published by the running release-outcome role. A quarantine is committed under a live attempt, and the console shows what the fence stopped. Two product defects surfaced on the real stack and are fixed: the web process composed no command approvals, and one approval-node notification made the whole inbox refuse. Every final leg exits 0 at a clean head, with 100 percent of changed lines covered against `2b2e12550`. The mutation score is not measurable on the current toolchain; that is reported, not fixed here.

## W09c — compose the release profile set from the declaration (branch `wp/w09c-profiles`)

Worktree `.worktrees/w09c-profiles` from `integ/w00` at `260855e57`. Gate file
`tasks/factory/w09c-GATES.md`, receipts `/tmp/factory-platform-evidence/w09c/`.

- [x] Reproduced at the base. With only the new lifecycle cases added, the declared S3 profile
      composed to `[]` and `requestRelease` refused with `factory_protected_effect_untrusted`
      (0 pass, 3 fail).
- [x] Each declared profile is built over its destination. An `s3` destination gets
      `S3FactoryManifestReleaseProfile` over `FactoryVerifiedAttemptMaterials` at the declared
      cost. A `github` destination gets a W07 publication request lifted through
      `factorySynchronousReleaseProfile`. Any other kind is refused with
      `factory_release_profile_unbuildable`.
- [x] The composed set reaches `FactoryProtectedCommandEffects` through the existing startup path,
      and the startup composition now hands it the verified materials reader.
- [x] Proof in the lifecycle suite on PGlite and on real PostgreSQL with the real ordinary store.
      `requestRelease` prepares an operation. The running `release-outcome` role claims it on an
      approval written through W05's writers, and the attempt's sealed members publish.
- [x] Negative controls. A foreign account is refused at prepare with no operation. A revoked
      policy fails the claim with reason `policy_revoked`. A rejected approval fails it with
      reason `approval_not_approved`.
- [x] Coverage, typecheck, lint, boundaries, and gate integrity are green, with no new source file.
- [x] A published release through the real started application. Blocked upstream, see Review. — closed: W14 real lane, run accepted, approved, released, `succeeded` (todo.md:3683 to 3684) (audit 2026-10-03).

Review (W09c): the composition itself was small. W08b had already made the S3 profile buildable,
and W09b had already routed the profile set to the private service. The work was mostly proof.
The real application cannot yet reach a release node, for two reasons, and both were reported to
the coordinator. First, acceptance is not composed: no validator runtime, no material
registration, and no validator scheduler. W09d now owns that. Second, nothing delivers a settled
release back to orchestration. So the end-to-end publishing proof runs in the lifecycle suite
against real PostgreSQL and the real object store, and the three real-application passes record
where the run stops. The S3 profile could not be lifted through `factorySynchronousReleaseProfile`,
because listing sealed materials is I/O. It keeps W08's `resolve`, and its required `build`
refuses by name. That is recorded as an interface note rather than changed.
## W01g — guest material staging over the broker (Terra runtime)

Branch `wp/w01g-staging` from `integ/w00` at `850ffaa54`. Gate file:
`tasks/factory/w01g-GATES.md`. Evidence: `/tmp/factory-platform-evidence/w01g/`.

- [x] Reproduce the failure first: a real run at the base ends `failed` because the guest returns
      `cancelled` and has no staging path.
- [x] Frame contract: `FactoryGuestMaterialBegin/Chunk/Seal` plus an `Output` promotion frame and
      one typed response union, in the SDK beside the model frames, with generated JSON schemas
      and Bun/Python parity over the shared conformance fixtures.
- [x] Host adapter: every frame forwarded to `FactoryAttemptMaterials` under the attempt's
      verified authority; durable idempotency for a repeated frame; cancellation and the deadline
      honoured mid-upload; every refusal named.
- [x] Guest SDK, Bun and Python: `stageOutput(name, bytes | stream)` chunks, seals, and returns
      the sealed material; `stageResult` and `stageCheckpoint` build what a COMPLETED result
      carries.
- [x] Runner result path: the promotion stages the attempt's candidate output through W04's own
      writer, so the completed result is validated, recorded and projected by the existing path;
      `NativeFactoryArtifacts` gets its production implementation over the same two writers.
- [x] Proof on the real started application: a real sandboxed guest stages one output and the run
      reaches terminal `succeeded` through the completed path.
- [x] Three consecutive clean passes and the negative control, from this branch at `179674cbf`
      on a clean tree (`proof-1.json` to `proof-3.json`, `negative-control.json`).
- [x] The host mounts the route from `services.guestBroker` in its own configuration document
      (`994deebe8`); the proof-only commit and the file-beside-the-key client are gone.
- [x] The product runtime binds the route itself from `guestBroker` in its startup document
      (G14, delegated by the coordinator); the harness only observes.
- [x] Final sweep on a clean tree after `git merge integ/w00`.

### Review

The gap W09b recorded was not one missing function but a missing route. A guest runs on
`--network=none`, so W04's material service — which is HTTPS — is unreachable from inside it, and
the reverse control frame is the only byte path it has. That frame carried exactly one payload,
the model request. So the work was: define the staging frames, answer them on the host under the
attempt's own authority, and carry them from the host process that runs the container to the
product process that holds the tenant database, because W09b's own comment recorded that no route
between those two existed and that a guest's broker call therefore refused by name.

Three things the first end-to-end run taught, each of which had passed a unit test:

A sealed material has TWO digests. The handle covers the chunk manifest the scoped reader
resolves; the content digest covers the bytes. Confusing them is silent — both are `sha256:` and
64 hex — so `stageOutput` now returns both rather than the handle alone, and a promotion names the
content.

A COMPLETED result cannot name a material. `verifyCompletedEvidence` loads the output as kind
`candidate_output`, bound to the attempt's own node instance and generation, and re-parses it as
canonical I-JSON. So the promotion reads the sealed bytes back through the scoped reader and
stages them through W04's `stageCandidateOutputInTransaction`, whose coordinate makes a repeat
after a lost response return the same reference and different bytes conflict. Nothing in W03's
verifier changed.

A completed result also needs a workspace checkpoint whose cursor equals its own, and an attempt
that settled no operation has cursor -1 — which W04's checkpoint writer refuses, because its names
are operation indexes. The guest names that one `workspace/attempt.json` and stages a real sealed
material, so the reference points at bytes rather than at nothing.

Round 2 (2026-09-22). The branch had merged `integ/w00` at `bcd97df48`, not at the W09b merge,
so W09b's supervisor was not yet on it; the merge at `5c9729734` brought it. The host half of the
mount is now product code: an optional `services.guestBroker` section in the supervisor document,
in the pool section's exact shape and validated by the same function. The host builds the client
before its listener binds, and a model request keeps `factory_host_broker_unavailable`. The
declared client that read a file beside the host key is removed, and the SDK now owns the
"is this a staging frame" predicate, so a runner host routes a frame without loading product
modules. The three passes ran from this worktree, with the section written into W09b's unedited
harness document by a pass-through bun wrapper. The product half, the listener in the product
runtime, is still bound by the harness process and stays open as G14 for the coordinator.

Round 3 (2026-09-22). The coordinator delegated the product mount. The startup document has an
optional `guestBroker` section, and `installation-startup.ts` binds the route in its own W01g
region beside the private service. Readiness carries `guestBroker` as bound, unconfigured, or
unavailable with a code. The three passes ran with the web server binding the route and the
harness only observing.

## W09d — compose validators into the installation (branch `wp/w09d-validators`)

Brief: `/tmp/factory-platform-evidence/w00/briefs/w09d.md`. Evidence: `/tmp/factory-platform-evidence/w09d/`. Gates: `tasks/factory/w09d-GATES.md`. Report: `/tmp/factory-platform-evidence/w09d/report.txt`.

- [x] Reproduce at the base: a run whose graph carries an acceptance node reaches no validator attempt (`reproduction.json`).
- [x] Startup document `validators.runtimes[]` by reference; every refusal named; nothing declared holds both roles with a reason readiness shows.
- [x] `FactoryTrustedValidators` from the declaration, shared by assurance, the scheduler, and the validator settlement.
- [x] Material registration once per published version per process; idempotent across restarts; a changed runtime refuses by name.
- [x] `validator-scheduling` role over W05's scheduler; the one attempt dispatcher settles validator attempts, routed by the durable assignment.
- [x] Rulings: `recordCurrentCandidate` and `decideAcceptance` (decision and inbox event in one transaction); typed rejection for a failed or uncertain validator; immediate named refusal when nothing is composed; the release-authority candidate fix with injected-clock tests; the release operations supplier left to W09c.
- [x] O1: the validator reservation is settled on its terminal (idempotent), or held uncertain under the typed reason.
- [x] O5: a refused effect fails the run through a recorded `command-failed` kernel event and a projected `fail-run`.
- [x] Orchestrator side on the Temporal test server (84 of 84 in the package's node leg).
- [x] Proof: three passes and two controls on fresh databases, from this branch plus wp/w01g-staging only.
- [x] Tests per common.md; coverage of new files and changed lines; PostgreSQL producers; gate file.
- [x] Round 3 (validator ACCEPT-WITH-FIXES at `d1a0f31e0`):
  - [x] F1: the REQUIRED_SHARED_IMPORTS row for `validator-declaration.ts`; the C13 inventory test passes.
  - [x] F2: a crashed, timed-out, or uncertain validator is a typed `execution` failure, not a rejection: no repair round, and the typed reason is the projected run error (kernel, unit, and Temporal tests at maxRepairs 0 and 2).
  - [x] F3: every claim is visited on every pass; the failure waits until every claim is terminal and holds each failed claim uncertain; the envelope closes only after reconciliation (two-claim unit tests, PostgreSQL envelope test).
  - [x] F4: one `factoryCommandFailedEvent` builder; a named refusal of an effect answers it with the name; the workflow takes the activity's cause message (unit and Temporal tests).
  - [x] F5: the lifecycle-suite additions disclosed with the ruling sentence.
  - [x] F6: foreign-tenant, foreign-run, and foreign-service refusals asserted by name.
  - [x] F7: `plain-values.ts` holds the one record guard and the one error-code reader.
  - [x] Heavy legs and three passes at the final code; the judge requires the named refusal in the projected reason.

### Review

The package composes W05's validator pieces from a startup declaration, and the coordinator's rulings closed the gaps the real application exposed. The base reproduction showed no material, no contract route, and an acceptance command refusing `factory_assurance_not_found`. At the final code the started application registers the material, admits the validator through the pool, runs it in Podman through the one attempt dispatcher, records a strict PASS, decides `accepted`, and delivers the event in the decision's transaction. It then settles the validator's reservation, and when the release effect refuses (no profile yet, W09c) the run ends `failed` with a projected typed reason instead of hanging in `running`. Three passes did that on fresh databases, both controls refused by name, and the orchestrator's Temporal leg passes 84 of 84. Two defects only real timing showed are fixed at their roots with tests: the candidate re-derivation that required a live lease, and a failed effect on an acceptance or release node that left a cancel nothing could answer. Open, each with its owner: the public lock read and the contract route's opaque 500 (W14), and the release operations supplier and profiles (W09c). Round 3 changed three behaviors. A crashed or uncertain validator now fails the acceptance node with its typed reason and starts no repair round, because it judged nothing. Every claim is settled or held on every pass, so one failed claim cannot strand another claim's reservation. A refused effect now projects the refusal's name, for example `factory_protected_effect_untrusted`, instead of "Activity task failed". Three passes and both controls confirm the named reasons on the started application at `ceada04f5`.
## W15 — Retention, compatible backups, and restore (branch `wp/w15-retention`)

Evidence: `/tmp/factory-platform-evidence/w15/`. Gate file: `tasks/factory/w15-GATES.md`.
Base: `260855e57` (W09b merged). Consumed, not edited: the W18a-2 files, W09c release
declaration and profile composition, W01g guest broker/SDK, W14 console, W16 provisioning.

Plan (plan section 5 W15, C06, C12):

- [x] One additive migration `add-factory-recovery.ts`: retention ledger, checkpoint barriers
  and policy, restore epochs and recovery reports; a statement-level barrier gate on every
  `factory_*` product table; an effect-claim gate (release claim, attempt launch claim) that
  closes on a stale checkpoint or an open restore epoch; a restore gate on run admission.
  Mirror in `schema.ts`, PGlite test, PostgreSQL parity.
- [x] `retention.ts`: the C06 classes (30/90/365 days), release extension that cannot shorten,
  tombstone before collect, reference-aware GC, archive-before-expiry that stops cleanup on
  failure, prior key-wrap retention.
- [x] `recovery-archive.ts`: immutable recovery objects (audit streams, checkpoint manifests,
  recovery reports) in the independent archive, sharing the release archive's S3 write path.
- [x] Projection rebuild by replay from the database or from the archive; stop on gaps and
  conflicting digests.
- [x] Key wrapping: a KMS wrap port for hosted cloud KMS and the self-hosted external KMS,
  beside the operator master key; rotation rewraps, keeps old wraps, never rewrites objects.
- [x] `checkpoint-barrier.ts`: per-tenant coordinator (pause, drain/fence, reconcile, quiesce,
  record product/pool/Temporal positions and object versions, seal in the archive, resume);
  2 s target, 10 s maximum, abort claims nothing; scheduler with at most 16 in flight;
  15-minute freshness gate. Bounds measured on real PostgreSQL.
- [x] Pool checkpoint source: tenant ledger snapshot and restore import as `uncertain`.
- [x] Temporal: namespace retention and history archival configuration, HTTP position reader,
  proof against the pinned Temporal CLI dev server.
- [x] WAL: readiness over `archive_mode`/`pg_stat_archiver`, and a PITR proof to a barrier LSN
  on a private PostgreSQL instance.
- [x] `restore.ts`: restore epoch, fencing, key/version/object checks, compatibility,
  projection rebuild, archive import of release facts, provider reconciliation, pre-epoch
  worker reconciliation with the original supervisor, tenant versus cluster mode, human
  signature before enable.
- [x] Worker roles `retention-gc` and `checkpoint-barrier` through W09b's worker shape.
- [x] Tests: expired history, deleted projections, conflicting/gapped audit, missing
  keys/versions, incompatible backups, lost pool ledger, releases after the checkpoint,
  restored gateway DB with a surviving guest, old-epoch broker token, post-checkpoint
  guest/release. PostgreSQL suites registered in `db-postgres.yml`.
- [x] Gate file, evidence receipts, sweep, report.

Review (W15, head after `daf0bb043`): all fifteen gates in `tasks/factory/w15-GATES.md` pass. The
final heavy batch ran at `daf0bb043` under the shared lock: 181 unit and 40 PostgreSQL tests pass on
the shared stores; barrier p95 1103 ms under four writers (write pause p95 78 ms); an abort at its
maximum claims nothing; 100 tenants sealed in 1043 ms with 16 in flight; PITR to a barrier LSN
reproduces the sealed state; the real application runs both roles and seals a checkpoint. The batch
found and fixed three defects: Temporal's describe route cannot address a slash workflow id (now the
visibility list), a PITR replica needs the primary's `max_connections`, and the full-stack check
counted the intentionally ungated ledger tables. Open: real cloud KMS and Temporal archival are not
proven on this host, the shared PostgreSQL does not archive WAL, and deployed restore, provisioner
namespace settings, and failure-domain independence wait for W16. C09 purge, C08.14 inbox
tombstones, and a signing surface are not built.

### W15 round 2 (validator ACCEPT-WITH-FIXES at 0fe67b822)

- [x] H1 freshness fails closed: no policy row means enforce at 900 s; a held `checkpoint-barrier` role makes readiness `degraded`. Tests for both.
- [x] H2 an archived release intent that cannot be read or matched is a tenant-blocking finding. PostgreSQL test.
- [x] H3 the startup document names the Temporal HTTP endpoint; the barrier records positions in every checkpoint; a tenant restore with no reader blocks as `temporal_unverified`. Full-stack manifest shows `captured: true`.
- [x] M1 the pool service enforces at most sixteen barriers in flight across installations (checkpoint slots); the production barrier takes a slot or defers. PostgreSQL test and 100-tenant proof through slots.
- [x] M2 enroll debug_log, accepted_evidence, approval, and receipt with their periods; tests.
- [x] M3 production callers: key wrapper selected by the startup document (operator master key file, cloud KMS, transit KMS); restore reachable through a private operator command; tests through the installation composition.
- [x] L1 disclose the pool ledger and release-adapter extractions with the coordinator ruling. M4 correct the pool-failure attribution.
- [x] Low: L2 one archive S3 client construction; L5 keep the unwrap cause; L6 name the incompatible-schema branch in a test; L4 write the one-tenant-per-database rule at the gate.
- [x] Sweep after `git merge --no-edit integ/w00`; private legs before the private container is removed; remove `w15-private-postgres` and note it in report.txt.

Review (W15 round 2, source head `34f282f8a`): every validator finding is fixed and its gate
passes. Freshness fails closed, and a held barrier role never reports ready. An unreadable
release intent or receipt blocks the tenant. Every checkpoint records Temporal positions, and a
restore without them blocks. The pool enforces sixteen barrier slots across tenants: 100 tenants
started at once sealed in 1232 ms with at most 16 in flight. Evidence, approvals, and receipts
enroll for 365 days. The startup document selects the key wrapper, and an operator command
reaches restore through the installation's own composition. The run found three more tests that
had relied on open claims, and a pool router that the new routes had pushed past the CRAP
threshold; all are fixed. A broad `pkill` during the run escaped the lock and may have left one
temporary database on the shared PostgreSQL that cannot be attributed (see lessons). Open: W16
deployment items, W14 signing surface, real KMS and Temporal archival, C09 purge, a debug-log store.

### Integration rulings (coordinator, 2026-09-23)
- R1: the runtime codec ignores `keyManagement` and fails closed with `factory_key_missing`. It lands disclosed and is owned by W15b (branch `wp/w15b-runtime-kms`, brief `/tmp/factory-platform-evidence/w00/briefs/w15b.md`).
- R2: the kind CHECK sits inside `CREATE TABLE IF NOT EXISTS`. Owned by W15b.
- R3: the effect-claims comment. Owned by W15b.
- R4: fencing is an operator attestation. It stays by design.

## W18b — six pre-existing backend pool failures (branch `wp/w18b-pool-fixes`)

Base `integ/w00` `94fb95b6a`. Receipts: `/tmp/factory-platform-evidence/w18b/`. Gates: `tasks/factory/w18b-GATES.md`.

- [x] Reproduce each failure alone at base and record the assertion and the cause.
- [x] Project root: the SDK walk accepts only a real git marker (a `.git` directory with `HEAD`, or a `.git` file naming `gitdir:`); every example copy routes through the SDK; tests pin a stray empty `.git` above the start.
- [x] pi_session: remove the expired migration bridge and its calendar literal; the legacy cookie is always purged, never promoted; tests and docs follow.
- [x] Launcher readiness: the runner probe reuses `inspectProductionRunner` and waits inside the launcher's readiness budget (one constant, `readiness_seconds=120`, used for the socket wait, the probe, and the health wait), not a separate one-second deadline; a test pins a slow runner inspect.
- [x] The five files alone, the full backend pool, typecheck, lint, both boundary checks, gate-integrity, both coverage gates.
- [x] Gate file `tasks/factory/w18b-GATES.md`, report, review paragraph.

**Review.** The six failures had three causes, and W15's labels were wrong for two of them. First,
three tests reported `/tmp` because every `.git` walk accepted any `.git` entry, and this host has an
empty `/tmp/.git` that git itself rejects. The SDK walk now accepts only a real repository marker, the
five example copies route through it, and the standalone ai-kit CLI asks git. The same cause also
failed the SDK and ai-kit legs, which are fixed too. Second, the pi_session tests failed because their
regexes matched indentation that a hook refactor changed. The 2026-06-01 literal was still a live
product defect, so the expired bridge is retired: no date in code decides what the hook accepts.
Third, the "Unix socket path limit" failure was a one-second readiness probe that timed out under pool
load; the socket paths were already short. Each cause is pinned by a test that fails on the unfixed
code. At `2d33f46d7` the full backend pool reports 0 fail, and every static and coverage gate passes.
Two findings are left open outside scope: the ai-kit installer ignores its postinstall exit code, and
`inspectProductionRunner` keeps a fixed 5-second default for verification commands.

## W15b — Runtime key management and migration follow-ups (branch `wp/w15b-runtime-kms`)

Brief: `/tmp/factory-platform-evidence/w00/briefs/w15b.md`. Gate file: `tasks/factory/w15b-GATES.md`.

- [x] R1 one key-service unit for the orchestrator codec and the restore; each non-file kind proven at runtime (Node launcher and full stack); mismatches refuse typed; the manifest names the kind.
- [x] R2 the retention kind constraint is replaced by name; proven on the old table shape under PGlite and PostgreSQL.
- [x] R3 the effect-claims comment corrected.
- [x] R4 unchanged by design.
- [x] Gates, receipts, report.
- [x] Round 2: the pool bundles for Node again (checkpoint limits in a leaf); gate integrity green against `integ/w00` (key service back in `key-composition.ts`); final legs rerun at `5f341bf01`.
- [x] Round 3 (post-W15c): merged `integ/w00` `b9de6910c`; one copy of the C12 block, the coverage key, and the lesson; N1 gate text; N5 an aborted restore stops without a pool finding; all legs rerun at `9f1391d18`.
- [ ] Follow-up N2 (owner W15): the checkpoint manifest does not tie the checkpoint to its key wrap (`keys.service` echoes config; the wrap fields are null).
- [ ] Follow-up N3 (hygiene): skip the retention kind constraint change when `pg_constraint` already holds the same definition.
- [ ] Follow-up N4 (defence in depth): a keyed report digest, so an edit that also rewrites `report_digest` is caught.

Review (W15b): The orchestrator's payload codec and the restore now open the data key through one unit,
so a startup document that selects a cloud KMS or a transit engine works at runtime, not only in the
restore. The Node process may link the KMS client, and the boundary test says exactly that. A wrap
made under another service, or a service that cannot open it, refuses with `FactoryEncryptionError`.
The retention kind constraint is replaced by name on every boot. The first backend-pool run failed
because the batch leaked the PostgreSQL environment into it; the batch now uses subshells.
Round 2: the W15 merge made the pool service import the checkpoint barrier, which links the Bun
database driver, so the Node pool bundle failed. The limits now live in a leaf module the barrier
re-exports. Gate integrity had refused round 1's move of `key-composition.ts`; the selection is back
in that file. Every final leg exits 0 at `5f341bf01`, including the backend pool.
Round 3: W15c's gate replaced W15b's copy of the pool checks. A restore cancelled during a pool call
now stops with its abort and records nothing for that call; before, it recorded a pool refusal first.

### W18 hygiene backlog: load-sensitive suites outside W15b (recorded by W15b, 2026-09-24)

- [ ] `src/__tests__/production-image-lifecycle-launch.integration.test.ts`: under the full backend pool
  on the shared host, "launcher cancellation reaps its verifier and runner before streams drain" failed
  (5517 ms); alone it passes 5/0. Evidence: `/tmp/factory-platform-evidence/w15b/logs/pool-flake-alone.log`.
- [ ] `src/__tests__/substack-pilot-installer.test.ts`: under the full pool, "Substack source seals settings
  and checksums, then publishes only its exact human-approved release" hit its 120 s timeout and two
  credential-broker cases failed after it; alone it passes 3/0. Evidence: `.../w15b/logs/pool-flake-alone-2.log`.

## W18a-2 — second complexity pass and the three coverage-key gaps (branch `wp/w18a2-quality`)

Brief: `/tmp/factory-platform-evidence/w00/briefs/w18a2.md`. Gates: `tasks/factory/w18a2-GATES.md`.
Receipts: `/tmp/factory-platform-evidence/w18a2/`.

- [x] Split `mappedError` (92) and `dispatchFactoryRequest` (43) in `web/src/routes/api/factories/_shared.ts`. The result is one answer table per error class and six owner groups.
- [x] Split `handle` (59) in `src/factory/private-service.ts` into authentication plus four route groups, in the same order.
- [x] Split `readSealed` (54) in `src/factory/task-stops.ts` into scope, request, authority, and event checks, in the same order.
- [x] Split `parseFactoryOrchestratorProcessConfig` (37) and `parseFactoryPoolProcessConfig` (44) into one predicate per section.
- [x] Split `parseFactoryStartupConfig` (65). This function was not on the brief, because W09b took it above 30 after wave4c.
- [x] Add threshold keys at 100 for `private-files.ts` and the two migrations. Add `src/factory/private-files.test.ts`, because the file was a real gap.
- [x] Re-measure `private-files.ts`, `boot.ts`, and `factory-service-token.ts` on the fullest local lcov, and name the covering leg for each.
- [x] Run the CRAP gate against origin/main over the fullest lcov: exit 0. Fix the two real gaps it showed (`loadExisting`, `initPglite`).
- [x] Run the common sweep at `868d8c853`, the head after the `integ/w00` merge.

### Review

Seven functions went from complexity 37–92 to 3–7. Each split kept its check or route order. The worst function in
the six files is now `wellFormed` at 24, which this package did not change. The existing suites passed unchanged,
and every combined-runner producer exited 0. Old-versus-new runs agreed on 840 error inputs, 10871 process configs,
and 11727 startup documents, error lists included. The three coverage-key files are gated at 100 and measure 100.

The whole-diff CRAP gate exits 0 on the fullest local merged lcov. That is the runner's legs plus seventeen
single-suite legs. Over the runner's own lcov, six functions still read red. Each one is a leg-list gap, and one
named suite covers it at 100 percent. The coordinator is asked to add four bun suites and one web bun suite to the
runner. Two gaps were real and are fixed. `InstallationDataKey.loadExisting` had no bun caller and now has a direct
test. `initPglite` carried a changed line whose factory branch cannot run, and that line now matches origin/main.

The global floor (73.88 percent), the per-file thresholds, and the origin/main new-file gate stay red. The cause is
files that only CI's repository-wide shards or the browser receipt measure. None of those files is one this
package changed.
## W18b — six pre-existing backend pool failures (branch `wp/w18b-pool-fixes`)

## W18a-3 — hook context, initPglite/loadExisting, compute-admissions order, test-path imports, main-origin leaks

Package branch: `wp/w18a3-quality-r2` (all items; the leak commits were cherry-picked from `wp/w18a3-leaks` after the merge of integ/w00 7a87aed5e).
Gates: `tasks/factory/w18a3-GATES.md`. Receipts: `/tmp/factory-platform-evidence/w18a3/` and its `continue/`.

- [x] Re-author the three fixture-authored commits as archy, trees unchanged (new branch; see Review).
- [x] The hook runs staged tests without GIT_* (48da9c886); scratch repositories in gate-scripts and git-hooks use
  no caller git context and a scratch HOME, with a guard test (d2c025a29).
- [x] initPglite: the gap was a staged-merge artifact (G1). loadExisting: shares one wrap opener with loadOrCreate (G2).
- [x] compute-admissions order dependence fixed on one test clock (d6914c53b, G3).
- [x] check-boundaries: a non-test file may not import a test path (48ad53775, G4).
- [x] Leaks: workflow-branch then symlink, and four suites then h1 or cross-tenant (2c03e3625, 17e2e8a63, G7).
- [x] umask 077: setup-podman, dev-image-provenance, local-sandbox-startup x2 (9e14d178c, 0ae26f4b0, G8).
- [x] podman-compose-wrapper 10 of 63 "dirty" (0ae26f4b0, G9).
- [x] Consolidate on -r2: merge integ/w00 7a87aed5e, cherry-pick the leak commits, rerun the matrices and static gates (G7–G10).
- [x] A Playwright `.pw.` spec counts as a test path (380588398, G11); scratch repositories set GIT_CONFIG_NOSYSTEM=1 (9dc2ba9fb).
- [x] Final gates green over the fullest lcov at the merge of integ/w00 15410e421 (G6): 17 producers, backend pool 28983/0 at umask 022, CRAP and integ coverage gates exit 0.
- [x] ~~Move the pool-service import walker into the boundary script (G12)~~: withdrawn; W15c carries the rule.
- [x] The hook runs staged factory-orchestrator files through the package's node test script (7f4d27042, G13).

### Review

The re-author kept every tree byte-identical (commit-tree, same parents). The coordinator made `wp/w18a3-quality-r2`
the package branch; `wp/w18a3-quality` stays at f7d79e629, and `backup/w18a3-quality-fixture-authored` keeps it until
the merge lands.

Every leak was a fixture fault, not a product fault. Two mock-lifetime rules explain the ordered leaks: a
`$server/*` alias registration cannot reach a route that another suite linked first, and a partial `$lib/*`
factory freezes the module's export names for the rest of the process. The umask and wrapper faults were fixture
files whose modes followed the runner's umask or the checkout's own modes; the resolver is right to count a
permission change as a Docker build-context change. 60 more suites still register a partial api-keys module, and 27
test files run a bare `git init`; both are disclosed follow-ups F1 and F2 in the gates file (owner W18 hygiene).

At the final head, every producer except pool-coverage exits 0. pool-coverage fails on the W15 bundle defect
(the node bundle reaches the "bun" builtin), so the CRAP gate reads 7 pool functions as uncovered. No red gate names a
file this package changed. G6 is rerun after W15b lands.

## Product rules (coordinator)

- Every startup document declares the recovery sections; an installation without them stays degraded (factory-checkpoint-barrier-held) and never reports ready.

**Review.** The six failures had three causes, and W15's labels were wrong for two of them. First,
three tests reported `/tmp` because every `.git` walk accepted any `.git` entry, and this host has an
empty `/tmp/.git` that git itself rejects. The SDK walk now accepts only a real repository marker, the
five example copies route through it, and the standalone ai-kit CLI asks git. The same cause also
failed the SDK and ai-kit legs, which are fixed too. Second, the pi_session tests failed because their
regexes matched indentation that a hook refactor changed. The 2026-06-01 literal was still a live
product defect, so the expired bridge is retired: no date in code decides what the hook accepts.
Third, the "Unix socket path limit" failure was a one-second readiness probe that timed out under pool
load; the socket paths were already short. Each cause is pinned by a test that fails on the unfixed
code. At `2d33f46d7` the full backend pool reports 0 fail, and every static and coverage gate passes.
Two findings are left open outside scope: the ai-kit installer ignores its postinstall exit code, and
`inspectProductionRunner` keeps a fixed 5-second default for verification commands.
## W15f — Stale execution epoch hold (branch `wp/w15f-stale-epoch`)

Gate file: `tasks/factory/w15f-GATES.md`. Evidence: `/tmp/factory-platform-evidence/w15f/`.

- [x] Reproduce from W01i's lane (15 `usage-reconciliation:fault` reports of one hold) with a lifecycle suite; red at 4 reports in 4 passes.
- [x] Mark the hold once with both epochs, report once, skip until the epoch moves; the hold stays uncertain.
- [x] PGlite and PostgreSQL suites for the fence, budgets, task stops, restore, checkpoint, schema; coverage gates.
- [x] Round 2: a signed restore supersedes the old epoch's live attempts (status `superseded`, record with the signed digest and the kernel event); the scan skips a marked hold only while its attempt is live; W05b's clear falls back to the supersession; names and migration order agreed with W03f.
- [x] Joint test with W03f (a marked hold settles at the reserved bound after a signed restore): on whichever branch merges second. Done on wp/w03f-provider-settle (red then green 41/2 -> 43/0, `tasks/factory/w03f-GATES.md`); landed with W03f, merge `ee9117e0a`.

Review (W15f): The fault was usage reconciliation meeting a run fence that a restore had moved:
the old attempt's authority can never name the new epoch, so every pass failed the same hold. The
role now marks the hold once, names both epochs, and stops retrying until the epoch changes. The
real PostgreSQL run caught a mark PGlite accepted but the scan could not read; the mark is now a
typed object and an unreadable one is retried and reported, never hidden.

## W15d — Store memory and capacity (branch `wp/w15d-store-memory`)

Gate file: `tasks/factory/w15d-GATES.md`. Evidence: `/tmp/factory-platform-evidence/w15d/`.

- [x] Measure both stores under the killing load: ordinary 1263 MiB peak (739 MiB anonymous), archive 247 MiB; no container OOM; 2 GiB stays.
- [x] Name the cause: both past kills were host-wide OOMs; the stores were chosen for `oom_score_adj` 200 from `podman.service`.
- [x] Document the basis in the compose file and the setup docs; fix the stale 768 MiB line.
- [x] Census of the ordinary store: 16.95 GiB, all live proof-run objects; publication suites hold 16.6 GB.
- [x] Proof runs remove every version they wrote (`close()` in the storage helper); tested against the real store.
- [x] Ordinary `-volume.max` 600 with its disk basis; leftovers only through the manifest prune.
- [ ] Rerun the load without an OOM after the coordinator recreates the stores.
- [ ] Host-side protection (`podman.service` `OOMScoreAdjust=100`): the host owner's decision.

Review (W15d): The stores did not die of their 2 GiB limits; the host ran out of memory and the
kernel chose them because the Podman socket gives every container it creates an OOM adjustment of
200. The ordinary store was filling because no proof run removed its versioned objects; each run
now removes its own prefixes on close. The volume cap rises to 600 with room above the disk floor.

## W15c — Pool service leaf (branch `wp/w15c-pool-leaf`)

Gate file: `tasks/factory/w15c-GATES.md`. Evidence: `/tmp/factory-platform-evidence/w15c/`.

- [x] The checkpoint limits and pool-facing types move to the leaf `checkpoint-limits.ts`; the barrier re-exports them.
- [x] The Node build of the pool service passes with no `bun` import; the pool mTLS suite passes under PostgreSQL.
- [x] `check-factory-boundaries.ts` rejects a pool service graph that reaches `src/db/connection.ts`; a deliberate violation is tested.
- [x] Backend pool: 3 Podman guest suites fail because the host lost their pinned images at about 16:50Z. — likely closed: later combined runs pass the four Podman suites (todo.md:5523, wave4h run 3); not checked per suite (audit 2026-10-03).

Review (W15c): The W15 merge put the checkpoint barrier into the pool service's import graph, and the
barrier reaches the Bun SQL driver, so the pool could not bundle for Node. The pool now reads a leaf
module. The factory boundary checker owns the runtime import walker and fails the build if the pool
graph reaches the database connection again. Every gate passes except the backend pool, which fails
only in three guest suites whose images were removed from the host.

## W18 test-hygiene backlog (coordinator)

- compose.factory-storage.local.yml: declare restart: on-failure for both SeaweedFS services and the proof PostgreSQL so a recreated store keeps the policy the coordinator set by hand on 2026-09-23 after the OOM kill; document it in docs/factory-local-storage.md.

## W19a — graph proof: deterministic tasks and a model task, end to end (branch `wp/w19a-graph-proof`)

Brief: `/tmp/factory-platform-evidence/w00/briefs/w19a-graph-proof.md`. Gates: `tasks/factory/w19a-GATES.md`.
Receipts: `/tmp/factory-platform-evidence/w19a/`. Base: `integ/w00` at `6c8ec29c5`, plus `wp/w01g-staging` at `f0aafe3a0`.

Finding before the plan: at the base a guest's model call cannot reach a model in the real application. The host
refuses it with `factory_host_broker_unavailable`, the product guest-broker route serves staging frames only, and the
product composes its provider broker for readiness and never calls it. The runner profiles in the startup document
cannot declare a model pin, and the provider broker resolves an Ollama model without its registered base URL.

- [x] Host: forward a guest model request over the existing guest-broker route (one broker, one channel).
- [x] Product: answer a model request on that route through `createFactoryGuestModelBroker`, the durable journal,
      W04's workspace checkpoints, and the installation's pinned provider, resolved per call.
- [x] Provider: resolve a pinned model the way the chat router does (catalog, discovered, registered custom model,
      the test-surface mock); readiness accepts a registered local model; temperature and seed reach the request.
- [x] Startup document: a runner profile may declare a model pin; boot refuses a pin that disagrees with its runner
      or with the installation's `modelProvider`.
- [x] Mock provider for CI: a prompt-digest mode in the in-process mock LLM (fixed answer per prompt digest).
- [x] Harness in `scripts/factory-graph-proof/`: the W09b/W01g/W15b real-server stack, a three-export guest, the graph
      A prepare -> B infer -> C combine, modes (a) Ollama and (b) mock, and four negative controls.
- [x] Proofs: three passes per mode on fresh databases, controls refused by name, determinism recorded.
- [x] Runbook `docs/factory-graph-proof.md`, followed literally.
- [x] Gates: coverage of new files and changed lines, PostgreSQL suites registered, typecheck, lint, boundaries,
      gate-integrity, no credential value, dangling images pruned.

### Review

The graph works end to end on the real application in both modes, three of three each, on fresh
databases, at `452f0bc62`. A deterministic task feeds a model task, whose answer and the first task's
count feed a third deterministic task. Each node reads its inputs from the store under the scope that
sealed them, and the model task's journal holds exactly one completed model operation with the pinned
provider, model and measured tokens. It did not work at the base: the host refused every model call,
the product route served staging frames only, and nothing called the provider. This package wired
that path without a new channel or a contract change, proved the guest's journal mirroring in-process
on PGlite and PostgreSQL, and added a prompt-digest mock so CI needs no Ollama. The campaigns found
two defects outside this package's files, both fixed with a test that fails on the old code: a
gateway timeout that never settled under Bun, and a 500 in place of a named 422. They also found one
contract gap that needs a ruling: a provider error leaves the run held forever on an unknown cost.
Gates, receipts and findings: `tasks/factory/w19a-GATES.md`.
- W09b harness: an empty EZCORP_FACTORY_STORAGE_SECRETS_DIR resolves to a relative 'ordinary.json' and fails with ENOENT deep in setup. Refuse at start with a typed message that names the variable.
- W09b harness: a run that fails before cleanup leaves ~/.w09b-stack-<id> with test keys and tokens (one from 2026-09-22 exists). Make cleanup unconditional (finally).
- Pre-commit hook: it skips its PostgreSQL and staged suites when more than 12 test files map to the commit (36 at the W15 merge, 74 at the origin/main 96e7ee58c merge 9ba704f4f). A gate must not skip silently: run all, or fail and name the cap.
- Main-origin, owner W18a-3 (F3 of the 96e7ee58c merge): four tests fail at umask 077, which the heavy runner uses: setup-podman 1, dev-image-provenance 1, local-sandbox-startup 2. Make the tests set explicit file modes.
- Main-origin, owner W18a-3 (F4 of the 96e7ee58c merge): podman-compose-wrapper fails 10 of 63 with "dirty" on pure main 96e7ee58c, at umask 022 and 077 and with an empty HOME.
- Main-origin ordered leak, owner W18a-3 (ruling 2026-09-24): src/__tests__/security/h1-local-provider-ssrf.test.ts passes alone (148/0) but fails with "Export named 'requireAdmin' not found in module '$lib/server/security/api-keys'" when it runs after security/cross-tenant-deletion-projects-kb-modes.test.ts or after mentions-search-symlink-integration.test.ts. Reproduced on pure main 96e7ee58c and on integ 6c8ec29c5. Cause: both earlier files mock the api-keys alias with only requireScope. Fix: spread the real module into those partial mocks. Prove with the pair matrix.
- Main-origin ordered leak, owner W18a-3 (ruling 2026-09-24): mentions-search-workflow-branch then mentions-search-symlink-integration gives 25 pass 6 fail (reverse order 31/0), on pure main 96e7ee58c too. main's mentions route imports $server/runtime/workspace/target and only the symlink test mocks it. Fix: mock it in workflow-branch too, or use claim-and-revert. Prove with the pair matrix.
- BLOCKER for the wave4f combined run: (1) pool-coverage is red since the W15 merge (the node bundle of src/factory/pool/service-server.ts pulls drizzle-orm/bun-sql through checkpoint-barrier -> db/queries/extension-releases -> db/connection); W15b (wp/w15b-runtime-kms c39c039b9) fixes it. (2) the W18a-3 fixes for F3, F4 and the two ordered leaks above.
- OPEN, W18 hygiene item C, required (coordinator ruling 2026-09-25 at the W18a-3 merge; item C is accepted only with the focused producer green): (1) src/__tests__/extensions-patch-route.test.ts leaves state that fails src/__tests__/phase-2b-e2e.test.ts 6/6 when it runs first in one process; (2) src/__tests__/extensions-delete-route-policy.test.ts fails phase-2b-e2e 5 the same way, and the same new-file set fails src/__tests__/installer-idempotent-local.test.ts 3; both reproduce with their pre-hygiene versions from 2b2e12550, so they are pre-existing ordered leaks; (3) src/__tests__/workflow-run-persistence.test.ts "terminalizeOrphanedWorkflowRuns sweeps rows a dead process left running" drained 0 (line 720) once in three focused runs of the same tree and order, passes alone 3/3: make the liveness window deterministic by injecting the clock or threshold, never by widening a timeout. Evidence: docs/validation/factory/wave4/w18a3-merge.json.
- W01g follow-ups from its round-4 validation (coordinator ruling 2026-09-24; hygiene backlog, N3 also for W19 measurement): N1 src/factory/executions.ts:186, the class doc comment ("Durable C02 journal; ...") sits above the new type's doc comment and no longer documents the class; N2 the W01g harness observer (repro/guest-broker-observer.ts) stops polling silently on any query failure after one good poll, which could hide a real mid-run fault; N3 readFactoryAttemptLaunchFacts takes FOR UPDATE on the launch row for every guest frame (attempt-runtime.ts:181), contending with the dispatcher, and a corrupt row throws launch_corrupt without a named route status.
- Flake, owner W18a-3 (seen at the W01g merge attempt, 2026-09-24): src/factory/runner/supervisor-process.test.ts "runConfiguredFactorySupervisor > bounds the probe and names a timeout as its own failure" failed once in 14 runs (5/5 pass in staging and 8/8 at W01g f0aafe3a0 afterwards). Make the probe-timeout test await the observed operation instead of a timer turn.
- Pre-commit hook, owner W18a-3 (coordinator ruling 2026-09-24): scripts/lib/hook-lib.sh run_staged_tests runs every staged backend test with `bun test`, including packages/@ezcorp/factory-orchestrator/test/*.test.ts, which must run only through that package's own node --test script. At the W09d-2 merge it ran temporal-replay.test.ts under Bun: 12 pass, 15 fail (Temporal workflow timeouts), while `bun run test` in the package passed 88/88. Route those files to the package script.
- Renamed the root instruction file to `AGENTS.md` and updated all live root-file references. Nested, scope-specific `CLAUDE.md` files remain unchanged.
- Added tested rootless Podman commands for the Linux development stack and the Linux/macOS production stack. Renamed the production override to `compose.podman-prod.yml`.
- Proved the uid/gid and bind-mount contract with executable tests, rendered Compose output, the production image user, and real rootless Podman write tests.
- Merged the current `main` and the concurrent PR-head merge without conflicts. The merged source tree is identical to the fully validated tree.
- Verification passed: lint, typecheck, production build, focused tests, 2,185 browser tests, 26,602 coverage tests, and all 1,631 enforced coverage files.

## Repair PR #284 against current main — 2026-09-21

- [x] Confirm the exact PR head and current `origin/main` in an isolated worktree.
- [x] Run the focused wrapper test on the PR head as a baseline.
- [x] Merge `origin/main` and resolve the wrapper and test conflicts as a semantic union.
- [x] Add or adjust regression coverage for the combined behavior.
- [x] Run focused tests, shell syntax, typecheck, lint, and Svelte checks.
- [x] Review and commit the repair without pushing.

Plan review: preserve PR #284 release diagnostics, provenance reporting, and cache reuse while
retaining `main`/#286's default wrapper behavior. Compare the base and both parents for each
conflict, and do not change behavior outside the conflict repair unless a regression test exposes a
required correction.

Review: merged PR head `47aa41a25` with `origin/main` `b43558b34`. The wrapper now exports PR
#284's checkout revision before it executes #286's selected Compose client with the selected stack's
environment-file arguments. The merged test keeps the PR's isolated Git fixture and adds positive
proof that the revision reaches both the standalone Compose client and the production stack.

Verification: under pinned Bun 1.3.14, the PR-head baseline passed 28 tests and 64 assertions. The
merged focused set passed 45 tests and 135 assertions, including image provenance, bounded
release-blob diagnostics, both wrapper stacks, and the macOS trusted-local documentation contract.
A real Podman-socket-backed Compose render listed all development and production services after
explicit test-only runner inputs; missing inputs failed at the intended preflight guards. `bash -n`,
full typecheck, lint over
4,609 files, and Svelte check passed with zero errors. No blocker remains.

## Repair PR #284 provenance audit findings — 2026-09-21

- [x] Merge `origin/main` at `0f949c307` and preserve the semantic union.
- [x] Add red regression coverage for non-build wrapper commands outside a Git checkout.
- [x] Add red regression coverage for a dirty image build followed by a clean checkout.
- [x] Make Git-derived build identity optional while preserving explicit `EZCORP_BUILD_COMMIT`.
- [x] Record and diagnose a reproducible build-time dirty/content marker.
- [x] Run focused tests, Compose renders, shell syntax, lint, type checks, and Svelte checks.
- [x] Review and commit the repair without pushing.

Plan review: keep provenance useful but recoverable. Commands that do not build must work without
Git metadata. Image provenance must retain whether image-backed tracked files were dirty at build
time, even if the working tree is clean when diagnostics later run.

Review: merged `origin/main` `0f949c307` without conflicts. Git lookup failures now produce the
recoverable `unknown` revision and source state, so development and production `logs`, `down`,
`ps`, and `config` still reach Compose. The wrapper records tracked build input state as the
bounded `clean`/`dirty`/`unknown` enum; Dockerfile.dev stores it in an OCI label and runtime env,
and the startup diagnostic warns when a dirty image meets a later-clean checkout.

Verification: the new tests failed before the implementation and now pass. Focused provenance
tests passed 41/41; the wider static Compose set passed 107/107. Real Podman-backed Compose
renders passed for both stacks, and the rendered dev build carried the explicit revision and
`dirty` marker. `bash -n`, `sh -n`, `git diff --check`, lint over 4,610 files, full typecheck, and
Svelte check all passed with zero errors.

## Repair PR #284 final provenance audit findings — 2026-09-21

- [x] Detect every untracked, non-gitignored Docker build-context input without generated noise.
- [x] Preserve explicit provenance from shell, `.env`, `--env-file`, and `--env-file=value`.
- [x] Preserve recoverable `unknown` provenance outside Git without overriding explicit dotenv values.
- [x] Inspect the actual built dev image OCI labels and runtime environment.
- [x] Keep #286 wrapper and #291 container-engine behavior intact.
- [x] Run pinned focused tests, real Compose/image checks, lint, typecheck, Svelte check, shell syntax, and diff checks.
- [x] Review and commit the repair without pushing.

Plan review: keep Compose as the only dotenv parser. Derive provenance into separate fallback
variables consumed by nested Compose defaults, so shell, the repository `.env`, and caller env files
keep their native Compose semantics. Source-state detection must compare tracked content and
enumerate only untracked files that Git does not ignore and Docker can send. The final test must
inspect container-engine image metadata, not source strings.

Review: Git-derived provenance now lives in separate fallback variables, so Compose remains the
only parser for explicit shell, `.env`, and caller env-file values. Dirty detection combines the
tracked diff with untracked files filtered by Git's standard ignores and the active dev
`.dockerignore`. The regression covers a build-relevant untracked file, ignored/generated noise,
root-only Docker ignore semantics, cleanup back to a clean checkout, quoted duplicate dotenv
values, both env-file spellings, and a no-Git archive. A new CI job builds `Dockerfile.dev` through the existing Buildx GHA cache and the
shared engine verifier inspects the loaded image's OCI labels and runtime environment. A real
two-build Podman check exposed stale label and environment metadata when only late build arguments
changed. The Dockerfile now materializes those arguments in a small layer before metadata is set,
so provenance refreshes while the dependency and workspace layers remain cached.

Verification: merged current `origin/main` `bd6fd9714` (#277 dependency updates) without conflict,
then refreshed both lockfile installs under pinned Bun 1.3.14. The real Podman dev build completed
and inspected the requested revision plus source-state `dirty` in both OCI labels and runtime env.
An immediate cached rebuild with a different revision and `clean` state also inspected the new
values in both channels, with the heavy build layers cached.
Eight focused files passed in isolated processes: 103 tests and
309 assertions. Full typecheck, lint over 4,610 files, Svelte check (0 errors, 0 warnings), gate
integrity, `bash -n`, `sh -n`, and `git diff --check` passed.

## Repair PR #284 final provenance review — 2026-09-21

- [x] Add a red wrapper regression for a Git-ignored file that Docker includes.
- [x] Detect every untracked Docker-context input without treating Git ignore as Docker ignore.
- [x] Add a red rendered-command regression for Docker rebuild source-state provenance.
- [x] Print a truthful Docker rebuild command that records commit and source state.
- [x] Preserve Compose precedence, no-Git recovery, and cached metadata refresh behavior.
- [x] Run focused tests and the full static verification gates.
- [x] Review and commit the repair without pushing.

Plan review: test the public seams already confirmed by the final review: the real Podman wrapper's
environment handed to Compose, and the recovery command rendered by the startup warning. Use
Docker's ignore contract as the source of truth for build-context inputs; Git ignore must not erase
files that Docker sends.

Review: extracted one source-state resolver shared by the Podman wrapper and the direct-Docker
recovery command. It enumerates all untracked worktree files, including Git-ignored files, then
applies the active Docker exclusions with root-only, recursive, and negation behavior covered by
the wrapper suite. The recovery command now supplies both the checkout revision and the resolver's
truthful source state; a real Compose render proves that clean and dirty values reach build args.

Verification: both regressions failed before the repair and passed after it. Six focused files pass
89 tests under Bun 1.3.14. Full typecheck and lint over 4,610 files pass. Svelte check reports zero
errors and warnings. Gate integrity, Bash/sh syntax, and `git diff --check` pass.

## Repair PR #284 final independent audit — 2026-09-21

- [x] Reproduce the runtime false negative for a Git-ignored Docker input.
- [x] Reproduce the false dirty stamp for a tracked Docker-excluded file.
- [x] Apply one Docker-context resolver to tracked and untracked changes.
- [x] Make the startup warning use that shared resolver.
- [x] Add regressions for both reproduced failures.
- [x] Run focused tests and the full relevant static gates.
- [x] Review and commit the repair locally without pushing.

Plan review: keep one source of truth for Docker build-context state. Filter tracked and untracked
changes through the same ordered `.dockerignore` matcher, then use the resolver for both image
build stamps and startup comparison. Preserve Compose precedence, safe recovery commands, and the
recoverable `unknown` result when Git metadata cannot be read.

Review: the resolver now enumerates tracked changes, deletions, both sides of renames, and every
untracked Docker input, including files hidden by Git ignore rules. It filters all candidates with
one ordered matcher derived from the active Dockerfile-specific or root ignore file. The startup
warning calls that resolver instead of `git status`, prints one rebuild command for current context
drift, and stamps a truthful `unknown` revision when Git metadata is unavailable. The resolver also
removes inherited repository/index overrides before it reads the checkout or creates its private
matcher.

Verification: both new regressions failed before the repair and now pass. The focused provenance,
wrapper, engine, and release-blob set passes 85 tests across five files. Full typecheck, lint over
4,610 files, Svelte check, the production build, gate integrity, Bash/sh syntax, and
`git diff --check` pass. A focused regression also proves inherited Git overrides cannot change the
checkout's `core.bare=false` setting. The production build needed the Nix store's `libstdc++.so.6` on
`LD_LIBRARY_PATH`; after that environment correction it completed successfully.

## Repair PR #284 publication-gate findings — 2026-09-21

- [x] Reproduce hidden-index false-clean results for included Docker-context paths.
- [x] Compare included assume-unchanged and skip-worktree paths with `HEAD` independently of index hints.
- [x] Keep unchanged and Docker-excluded hidden-index paths clean.
- [x] Classify exactly half missing release blobs as partially missing.
- [x] Run focused tests and full static gates.
- [x] Review and commit the repair locally without pushing.

Plan review: keep the existing ordered Docker-ignore matcher as the single inclusion authority.
Audit only tracked paths whose index flags can suppress the normal `git diff HEAD` result, and
compare included regular-file bytes, presence, and executable mode directly with the `HEAD` tree.
Treat unsupported hidden entry types conservatively as dirty. Keep release diagnostics precise by
reserving `mostly_missing` for a strict majority.

Review: the shared resolver now enumerates the index entries whose assume-unchanged or
skip-worktree hints can suppress `git diff HEAD`. It applies the existing ordered Docker-context
matcher first, then compares each included regular file's raw object hash, presence, and executable
mode directly with the `HEAD` tree. Unchanged and Docker-excluded entries stay clean; unsupported
hidden entry types fail safely as dirty. The blob audit now uses a strict majority for
`mostly_missing`, so an exact half receives the partial-loss recovery guidance.

Verification: all three new regressions failed before the repair and pass after it. Real sparse
checkout and assume-unchanged fixtures now report `dirty`. Five focused files pass 90 tests and 254
assertions. The complete backend pool passes 25,891 tests across 1,655 files with zero failures.
Typecheck, lint over 4,610 files, Svelte check, production build, gate integrity, Bash/sh syntax,
ShellCheck, and `git diff --check` pass.

Post-merge verification: merged `origin/main` `d81f98387` (#290) and preserved both task histories;
there were no product-code conflicts. The combined #284/#290 focused set passes 107 tests with one
intentional container-only skip and 338 assertions. Typecheck, lint over 4,613 files, Svelte check,
production build, gate integrity, shell syntax, and the staged diff check pass.

## Repair PR #284 publication-gate context truth — 2026-09-21

- [x] Reproduce Docker's parent-exclusion and negated-child behavior against a real image build.
- [x] Replace Git-ignore translation with a pinned Docker-compatible matcher.
- [x] Compare every included tracked path directly with the `HEAD` blob, type, and executable mode.
- [x] Detect context changes hidden by Git stat shortcuts, `core.symlinks`, index hints, and Git ignores.
- [x] Preserve excluded tracked, untracked, empty-directory, and nested-test controls.
- [x] Run focused tests, full static gates, the production build, and a real dev-image metadata proof.
- [x] Review and commit the repair locally without pushing.

Plan review: use Docker's matcher for Docker rules and the `HEAD` tree for committed truth. Do not
infer build inputs from Git ignore or index state. Walk excluded directories only when a scoped
negation can restore a descendant; return `unknown` when safe pruning cannot be proved.

Review: the resolver now delegates ordered ignore and negation semantics to
`@balena/dockerignore`. It walks the real context for untracked files and empty directories, then
hashes included regular files and symlink targets directly against `HEAD` with executable-mode
checks. Sanitized Git is used only to identify the repository, revision, object format, and tree;
index flags, stat caches, replacement objects, inherited Git variables, and host configuration
cannot produce a false `clean`. The shell entry point still degrades to `unknown` without Bun or
Git. The image-provenance CI timeout is 40 minutes because a lockfile change invalidates both
frozen installs and the existing image-wide ownership layer; cached runs remain fast.

Verification: adversarial fixtures reproduced both publication-gate failures before the repair.
The parent-excluded negated child was present in an actual Docker image while the old resolver said
`clean`; same-size content with a restored mtime and a symlink replaced under `core.symlinks=false`
also returned false `clean`. The focused provenance suite now passes 60 tests and 192 assertions;
release-blob diagnostics pass 6 tests and 29 assertions. Full typecheck, lint over 4,614 files,
Svelte check, production build, gate integrity, shell syntax, and `git diff --check` pass. A cold
real Docker build installed the new dependency and verified the requested revision and `dirty`
state in both OCI labels and runtime environment.

## PR #292 — full review and CI repair

### Final lifecycle journal recovery repair

- [x] Add restart regressions for interrupted and durable-unknown start and stop operations.
- [x] Reconcile start and stop from authoritative container identity and state without blind duplicate effects.
- [x] Keep ambiguous state fenced and reject wrong identity without effects while allowing verified completion to terminalize the original operation.
- [x] Run focused lifecycle, journal, controller, type, lint, build, gate, and diff checks.
- [x] Record exact verification and commit locally without pushing.

Plan review: reuse the original durable call and exact owned-container identity. Recovery may complete only after authoritative inspection proves the requested state. A still-ambiguous result remains unknown and blocks later lifecycle work. The same idempotency key must never create a second effect.

Repair review: start and stop now retain unknown journal entries for authoritative retry, inspect the exact owned container before another idempotent state command, and terminalize only the matching durable unknown receipt. Recovery preserves a committed boot generation and creates one when Podman started before metadata commit. Ambiguous confinement remains unknown without a second start; wrong container identity remains a terminal no-effect failure. Same-binding transition retries share one in-process queue, so concurrent calls cannot pass authoritative inspection together or duplicate the Podman command. The controller can retry the same durable operation after restart and then admit later lifecycle work. Verification passed on pinned Bun 1.3.14: 124 focused lifecycle/controller/journal/supervisor tests, contract build and schema parity, sandbox tool and supervisor builds, full typecheck, lint over 4,668 files, gate integrity against `bd6fd97143b66c524e28b7896309fe6fd24d4261`, focused Biome, and diff checks. Post-commit patch coverage reports 100% on both changed source files, and all touched functions pass the CRAP 30 gate. The real lifecycle test received a 15-second per-test budget after its prior 5-second default reproduced a load-sensitive timeout; its assertions are unchanged.

### Final process-start recovery repair

- [x] Reproduce retained `running` and `succeeded` process-start lifecycle wedges with controller regressions.
- [x] Reconcile every retained process-start writer before lifecycle admission without duplicating a live process.
- [x] Release failed and terminal-process leases while keeping a verified live process fenced.
- [x] Run focused tests, lint, typecheck, sandbox builds, gate integrity, and diff checks.
- [x] Record exact verification and commit without pushing.

Plan review: recover unsettled starts through their durable provider call, inspect persisted successful processes through their exact identity, and preserve the binding-row admission fence. A verified live helper must continue to block lifecycle changes; only failed or terminal work may release its writer lease.

Repair review: lifecycle admission now resumes retained admitted, running, and unknown process starts through their original durable call. It removes stale failed leases, inspects the exact process created by a succeeded start, and releases that exact lease on a verified terminal process even while the sandbox resource remains running. Fresh in-process admissions remain fenced until their authorized caller starts execution, and verified live or ambiguous processes keep the lifecycle blocked. Pinned Bun 1.3.14 verification passed: 81 focused tests, contract build and schema parity, sandbox supervisor and native-tools builds, lint over 4,668 files, full typecheck, gate integrity against `bd6fd97143b66c524e28b7896309fe6fd24d4261`, and diff checks.

### Post-audit transient process-inspection recovery

- [x] Add a public-controller regression for an unknown process inspection followed by a terminal authoritative inspection.
- [x] Prove repeated ambiguous and live inspections keep lifecycle changes fenced.
- [x] Reconcile historical unknown process-inspect operations after later terminal proof without weakening other active-method fences.
- [x] Run focused controller tests, lint, typecheck, and diff checks.
- [x] Record verification and commit locally without pushing.

Plan review: exercise recovery through `requestSandboxAction`, the public lifecycle-admission seam. A later terminal inspection may clear only historical unknown inspections for the exact retained process; ambiguous and live results must keep both the writer lease and lifecycle fence.

Repair review: lifecycle admission now keeps historical unknown inspection receipts for audit but stops treating them as active after a later successful inspection proves the same process identity terminal. Provider exceptions and unknown receipts recover on the next terminal proof. Repeated ambiguous and live inspections remain fenced. Pinned Bun 1.3.14 verification passed: controller tests 42/42, lint over 4,668 files, full typecheck, gate integrity against `bd6fd97143b66c524e28b7896309fe6fd24d4261`, focused Biome, and diff checks.

### Final non-writer recovery repair

- [x] Add restart regressions for every non-writer provider method and each retained operation state.
- [x] Close abandoned read-only admissions without replaying their provider calls.
- [x] Reconcile interrupted cancel operations only through exact process identity and terminal evidence.
- [x] Preserve current-call, live-process, ambiguous-process, authorization, and lifecycle serialization fences.
- [x] Run focused controller tests, lint, typecheck, gate integrity, and diff checks.
- [x] Record exact verification and commit locally without pushing.

Plan review: classify provider methods once. A restarted controller may fail an observation that never completed, but it must not replay it. A completed unknown observation remains an audit record and no longer acts like live work. Cancel is different: an admitted cancel is known not to have run, while a claimed cancel stays ambiguous until an exact-identity inspection proves the process terminal. Fresh and currently executing calls remain fenced.

Repair review: the controller now classifies every supported provider method once. Fresh, reclaimed, and executing methods have explicit in-memory fences. After restart, orphaned admitted/running observations become failed without provider replay, while completed unknown observations remain durable audit records but no longer impersonate live work. An admitted cancel is safely failed before dispatch; a claimed cancel becomes unknown and stays fenced until the exact process identity is terminal. Live, ambiguous, and wrong-identity evidence remains blocked. Generic method admission now rejects lifecycle effects. Pinned Bun 1.3.14 verification passed: 71 controller tests with 230 assertions; 44 driver/journal/supervisor tests; 5 provider-invoker tests; focused controller coverage reported 96.30% functions and 98.24% lines; lint checked 4,668 files; full typecheck, gate integrity against `bd6fd97143b66c524e28b7896309fe6fd24d4261`, focused Biome, and diff checks passed. The changed-function CRAP command could not run without the repository's full `coverage/lcov.info`; no gate was weakened.

### Final audit repairs

- [x] Add red restart tests for ambiguous and failed file-mutation recovery.
- [x] Make mutation recovery prove a recorded filesystem state transition and terminalize verified aborts.
- [x] Add red supervisor/controller tests for an unlaunched persisted process start and disposal recovery.
- [x] Reconcile unverified starts to a terminal state without blind success replay.
- [x] Add red UTF-8/base64 gap cursor tests and enforce the decoded-byte lower bound.
- [x] Run focused tests, contract/schema/build, lint, typecheck, gate integrity, and diff checks.
- [x] Recheck `origin/main`, merge it if needed, commit without pushing, and record the exact verification result.

Plan review: use the provider validator, real journal restart, supervisor status artifact, and public controller lifecycle as the test seams. Preserve the shared binding-row serialization invariant. Keep unknown outcomes conservative, but provide a verified terminal path that releases the writer lease and allows explicit disposal.

Repair review: file mutation journals now record the full prior stat and recover only after a proved revision transition or removal. Missing paths are distinct from other stat errors. Ambiguous write, mkdir, chmod, and remove outcomes become durable `interrupted_mutation_aborted` failures, and controller reconciliation releases their leases. Persisted process starts return success only for an accepted in-memory launch or a live helper; restart recovery verifies stop, persists failure, releases the lease, and admits disposal. Process-output validation uses decoded bytes: gap-free responses advance exactly, while gap responses advance by at least the returned byte count. After merging `origin/main` at `bd6fd9714`, pinned Bun 1.3.14 verification passed: 88 focused tests, contract build, schema test, compiled supervisor build, dependency audit for both lockfiles, lint over 4,668 files, full typecheck, gate integrity, and diff checks.

### Independent audit repair

- [x] Reproduce lifecycle admission during active file/process methods and add one binding-level serialization invariant.
- [x] Recover interrupted local file mutations by verifying their filesystem effect, terminalizing the journal, and releasing the controller lease.
- [x] Treat a failed process start without an identity as terminal: do not persist a process row and release its writer lease.
- [x] Require exact process-output cursor advancement when `gap` is false.
- [x] Run focused contract, controller, journal, and driver tests; then lint, typecheck, and relevant build checks.
- [x] Record verification and commit the repair without pushing.

Repair review: binding-row admission now fences every start, stop, and destroy against active methods and retained process leases. Local file journals preserve the pre-effect revision, verify write/mkdir/remove/chmod postconditions after restart, terminalize absent effects, and are retried before later lifecycle/native work. Failed process starts release their lease without a process row; unknown starts retain only an unknown lease. Gap-free process output now advances by exactly the decoded byte count. Focused tests passed 68/68, including simulated filesystem effects before journal completion. Lint, typecheck, contract build/schema, sandbox supervisor build, and gate integrity passed.

- [x] Confirm the PR head, base, worktree, review state, and failing checks.
- [x] Reproduce and diagnose each failing CI check from its complete log.
- [x] Review the full diff against repository standards and the infrastructure plan with separate Standards and Spec reviewers.
- [x] Fix every confirmed defect with focused regression coverage and no gate weakening.
- [x] Run focused checks, then repository-level lint, type checks, tests, build, coverage, and visual verification as applicable.
- [x] Commit and push the repair, watch every PR check to completion, and resolve only review threads addressed by the repair.
- [x] Record the final review findings, exact verification evidence, and remaining human decisions.
- [x] Reduce every remaining touched-function CRAP violation reported by the hosted aggregate without changing behavior.
- [ ] Re-run focused tests, lint, type checks, the changed-function CRAP gate, then push and watch all checks green.
- [x] Cover every newly extracted executable branch reported by the hosted patch-coverage gate.

Plan review: use the existing clean PR worktree at the exact GitHub head. Treat the four red jobs as independent signals until their logs prove a shared cause. Preserve the sandbox security model and keep all repairs on the PR branch. Do not weaken coverage, visual-evidence, or test gates.

### Review

- Reproduced the red coverage shard on Bun 1.3.14. Test helpers used a machine-local Bun path. They now use the active runtime executable. The exact failed supervisor file passes 9/9 on the pinned runtime.
- Added transactional disposal fencing. A destroy request and new sandbox access cannot both be admitted. Active writers and methods block disposal. Pending disposal blocks new access.
- Added effective container confinement checks. Running containers must report seccomp filter mode and no-new-privileges through `/proc/<pid>/status`. Unverified containers are stopped, or return an unknown outcome if stop cannot be proved.
- Closed two standards-review gaps: bounded Podman output drains queued chunks before reader cancellation, and failed process stops escalate, persist `unknown`, and terminate the local helper.
- The first hosted rerun exposed one more inherited-pipe hang under coverage. The supervisor now bounds its own final output drain and cancels readers after container stop; the exact isolated coverage reproduction passes 10/10 tests.
- The next hosted aggregate passed every coverage gate but caught a CRAP regression in `LocalPodmanDriver.verify`. Split identity, host-profile, and process-confinement checks remove that new complexity regression while preserving 100% coverage.
- The following aggregate confirmed all coverage thresholds, then reported nine older high-complexity functions elsewhere in this PR's diff. These are now a required part of the repair; the gate remains unchanged.
- Split the nine reported functions into focused, reusable helpers. The highest resulting complexity in the seven affected files is 24, below the gate limit of 30; every originally reported function is now below the limit.
- Post-refactor verification: typecheck, lint, and diff checks pass. Focused contract tests pass 12/12; delegated focused suites pass 198 tests. A monolithic local Bun pool showed 10 cross-file mock-pollution failures and then stalled, but all affected files pass in isolated pinned-runtime processes: tokenizer 6/6, hub render 27/27, and phase 2b 8/8.
- Hosted CI then passed all 47 producer and quality checks, including the CRAP gate, but the final patch-coverage aggregate found 24 newly extracted branch lines without direct execution. Focused branch tests are required before the final rerun.
- Added focused tests for all 24 lines. Pinned Bun coverage records setup-tools line 1701 and subscribe-bridge line 442; V8 coverage records every route body branch, including the feature sort comparator. The new suites pass 9/9 backend and 8/8 web tests; final typecheck, lint, and diff checks pass.
- Expanded real qualification coverage for dispose-while-running and browser reconnect cancellation. Added mapped mobile visual evidence and fixed the Feature Index search row and project favicon controls at 390 px.
- Verification: pinned focused tests 64/64; pinned full suite 25,950/25,950 across 1,665 files; coverage producers 26,756/26,756 across 1,623 shards; typecheck and lint clean; production build passes; mobile/desktop evidence 4/4. The local coverage aggregate correctly refused to run without CI's separate browser-coverage receipt. The hosted per-file gate supplies that artifact and is the final aggregate proof.

### Publication-gate recovery repairs

- [x] Reproduce API/UI recovery of an unknown start or stop with a new idempotency key.
- [x] Reuse only the exact pending same-actor, same-action lifecycle operation and reject conflicts.
- [x] Reproduce reviewed-call abort while a raw observation still runs and preserve the lifecycle fence until authoritative completion.
- [x] Reproduce concurrent start/stop recovery through two driver instances sharing one state root.
- [x] Add a crash-recoverable cross-process transition lock without weakening identity or ambiguity checks.
- [x] Merge current `origin/main` and preserve the sandbox recovery and runner-image changes.
- [x] Run focused tests, patch coverage, CRAP, lint, typecheck, builds, gate integrity, and diff checks.
- [x] Commit locally without pushing and record the exact verification result.

Plan review: test the public lifecycle controller and UI seams, the reviewed-to-raw provider invocation seam, and two real driver instances sharing one durable state root. Recovery may reuse only existing authority. A lifecycle transition must wait for authoritative raw completion, and transition serialization must survive process replacement.

Repair review: normal API retries with a fresh key now recover only a pending same-actor, same-action start or stop and retain the original durable call; conflicting actions and actors remain blocked. A module-wide raw-operation fence survives controller replacement until provider completion is authoritative. Local transition recovery now combines the in-process queue with a binding-scoped durable `flock`, so separate driver instances and processes cannot duplicate a Podman effect; process death releases the lock for recovery. Merged `origin/main` at `d81f98387` and preserved the runner-profile repair. Pinned Bun 1.3.14 verification passed: focused integrated tests 131/131; controller coverage tests 77/77; extension-contract tests 26/26; the canonical coverage suite 26,869/26,869 across 1,627 shards; full lint and typecheck; contract, sandbox-tools, and sandbox-supervisor builds; gate integrity; patch coverage for all 53 changed source files; changed-function CRAP; and diff checks. The local coverage wrapper's tests were green but its aggregate required the CI-only browser-route receipt, so the final coverage gates used the green PR run's browser and shard artifacts plus the new local repair coverage.

### Final claim-takeover audit repair

- [x] Use PostgreSQL time for every claim lease and heartbeat.
- [x] Bind terminalization to one exact execution attempt.
- [x] Keep an expired process-start takeover ambiguous while its durable start lock is held.
- [x] Bind shared raw execution promises to the admitted actor and reviewed call.
- [x] Add clock-skew, stale-executor, lock-contention, authorization, and recovery regressions.
- [x] Run focused tests and static checks, record evidence, and commit locally without pushing.

Plan review: database time is the sole claim clock. A reclaimed execution receives a fresh attempt token, and an older executor cannot terminalize it. Durable provider lock contention is an unknown outcome, not proof that no process effect occurred. Shared in-memory execution may be joined only by the same reviewed principal.

Repair review: claim acquisition and heartbeat expiry now use PostgreSQL time, and every execution attempt has an exact terminalization token. A competing process start reports an unknown retryable outcome and retains its writer lease until the durable supervisor state gives an authoritative result. Raw host callbacks now revalidate the actor, project membership, binding, release, and provider installation before joining one retained provider promise, so an unauthorized request cannot join, poison, or redispatch the effect. The broker test now restores its module mock, which also removes its cross-file test pollution. Verification passed: the combined focused backend gate 168/168, web route/transport 24/24, full typecheck, lint across 4,671 files, both sandbox builds, and diff checks.
## Nightly mutation workflow — three faults (handoff 2026-09-20)

Branch `ci/nightly-mutation-fixes`, worktree `.worktrees/nightly-mutation`, base origin/main 550b7c67e.

- [x] Fault 3 first: `scripts/quality-report.ts` — mandatory `--expect <gate,...>`; an expected gate with no report is `status: "fail"` with a finding naming the gate; summary records `expected` + `missing`; mutation gate satisfied by `mutation.json` or a skipped `mutation-summary.json`; pure `buildSummary()` exported + unit tests; ci.yml callers pass `--expect`.
- [x] Fault 1a: `web/stryker.config.json` `dryRunTimeoutMinutes: 30` (Stryker default 5; measured 5m21s kill on the runner).
- [x] Fault 1b: `scripts/mutation.ts` — delete a stale `mutation.json` before the run; no report after the run is an infrastructure failure and fails regardless of `--report-only`; pure `mutationExitCode()` exported + unit tests.
- [x] Fault 2: nightly drops the coverage rebuild + CRAP + floor steps; full-repo CRAP ratchet moves to ci.yml's coverage job on `main` pushes (the one place a merged lcov exists).
- [x] Fix the stale `vitest.related: false` claim in `web/vitest.stryker.config.ts`.
- [x] Docs: `docs/development-lifecycle.md` gate table; `docs/features/platform/dev-lifecycle-and-gates.md` runbook + files list.
- [x] `actionlint` both workflows; lint; typecheck.
- [x] Verify locally: 23 unit tests green; fault-3 acceptance (report present → PASS, deleted → FAIL); fault-1b via a fake `npx` (infra exit + report-only → 1 and stale report cleared; low score + report-only → 0; low score → 1; clean → 0); `--full --dry-run-only` green in 3m42s / 3560 tests on 32 cores (182s of it Stryker overhead); full-repo ratchet on a live CI lcov (SF re-rooted, 3 /tmp fixtures left absolute): 82 ≤ 83; floor 96.32%; lint, typecheck, actionlint all 0.
- [x] Pushed; PR #275 (draft); dispatched run 35523464554: initial test run succeeded in 6m38s on the runner (5-minute default could never fit); summary read FAIL / MISSING REPORT: mutation when the job hit the 6h cap — fail-closed proven in CI. PR CI green (48 checks): coverage job summary expected coverage+crap and found both; full-repo ratchet step skipped on the PR as designed; mutation job summary accepted the skipped-diff receipt.
- [x] Finding: one job cannot finish — 18797 mutants reached 99.4% at 5h52m, cap is 360 min. Stryker: 1028 static mutants (5%) take ~93% of the time (`ignoreStatic` is a maintainer decision, left out).
- [x] Shard the nightly: `mutation.ts --full --shard I/N` (round-robin over the sorted scope, exact partition), 6-job matrix always `--report-only`, new `scripts/merge-mutation-reports.ts` requires exactly N reports and applies the threshold once on the merged score (`--enforce`); `mutationTotals` shared with the reporter; 32 unit tests; lint/typecheck/actionlint 0.
- [x] Sharded nightly run 35542869144: green end to end in 1h16m (shards 25/46/51/59/63/76 min); merge found 6/6 reports, 182 files, `Final mutation score 52.10%` (9737 killed, 49 timed out, 3597 survived, 5401 no coverage), 34 files 100% NoCoverage listed; summary.json status fail, expected [mutation], missing [], 8998 findings quoting code. Report-only, so the run is green; `--enforce` would fail it.
- [x] Merged origin/main into the branch (5 PRs landed; `tasks/todo.md` conflicted — both sections kept; reinstalled deps for the pi 0.85.1 bump). PR CI green on the merged head (48 checks).

### Review
- Fault 3 (fail-open summary): fixed and proven in CI — the cancelled single-job run reported FAIL / MISSING REPORT: mutation; the PR runs show `expected: coverage, crap` and `expected: mutation` with the skipped-diff receipt.
- Fault 1 (dry-run timeout + report-only over-suppression): fixed — 30-minute dry-run budget (initial run took 6m38s unsharded, 2m13s in a shard); a report-less Stryker exit fails regardless of --report-only (unit + fake-npx tests).
- Fault 2 (coverage rebuild): the nightly is mutation-only; the full-repo CRAP ratchet is a main-push-only step in the coverage job (82 ≤ 83 on a live lcov). First real verdict on main comes after merge.
- New: sharded nightly (6-way matrix + fail-closed merge with the threshold applied once). Follow-ups for maintainers: calibrate the 34 NoCoverage files; decide on Stryker `ignoreStatic` (1028 static mutants ≈ 93% of run time); ratchet `crap.maxFullRepoViolations` to the first main-push count.

## PR #288 repair — Podman setup safety and timeout accuracy

- [x] Reproduce each audit finding with focused setup-script tests.
- [x] Make trusted-local configuration an atomic, concurrency-safe rewrite that preserves every existing byte and secret.
- [x] Require the exact trusted-local Compose path and acknowledgement when detecting configured state.
- [x] Reject unsafe existing environment-file permissions without changing the file.
- [x] Probe the Linux Compose command with the same semantics as the wrapper.
- [x] Bound readiness work by an elapsed deadline, including curl and sleep time.
- [x] Add the strongest available portability check without claiming unavailable Bash 3.2 runtime coverage.
- [x] Run syntax, focused tests, lint/type checks as relevant, and inspect the final diff.
- [x] Commit the repair without pushing.

Plan review: keep the setup script dependency-free and Bash 3.2-compatible. Use private sibling files plus atomic rename for an accepted trusted-local update, while refusing concurrent drift. Preserve existing files byte-for-byte except for the approved runner block. Test observable subprocess behavior with stubs and controlled time sources; do not use real wall-clock thresholds.

### Review

- The accepted trusted-local choice now uses a private sibling file, a serialized re-check, and an atomic rename. Existing bytes and secrets remain intact; a failed rename and eight concurrent runs are covered.
- Trusted-local is configured only when both the exact Compose path and exact acknowledgement are the effective values. Linux isolated-runner detection remains unchanged.
- Existing environment files with any group/other permissions fail before file or data-directory changes. The operator gets the exact `chmod 600` repair.
- Linux executes `docker compose version` and falls back only when `docker-compose version` succeeds, matching the production wrapper.
- Readiness uses one epoch deadline. Curl and sleep each receive the remaining-time cap; deterministic clock stubs prove both bounds without wall-clock assertions.
- CI now runs the full 30-test behavior suite on macOS with `/bin/bash` and first verifies that it is real Bash 3.2. The job feeds the existing required Backend tests aggregate.
- Verification: focused suite 30/30; `bash -n`; ShellCheck 0.11.0; Biome full lint; full typecheck; workflow YAML parse; gate integrity; `git diff --check`.

## PR #288 final audit repair

- [x] Keep generated secrets out of child arguments and logs, with a regression probe.
- [x] Make runner detection reject conflicting trusted-local state on Linux.
- [x] Detect external environment-file drift before atomic publication.
- [x] Replace the stale mkdir lock with a PID-owned, crash-recoverable protocol.
- [x] Derive readiness from `EZCORP_PORT_HOST` and use a clock-independent strict budget.
- [x] Correct the Linux installation claim in the README.
- [x] Run focused tests, Bash syntax, ShellCheck, lint, typecheck, workflow parsing, gate integrity, and diff checks.
- [x] Merge a newer `origin/main` if present, then commit without pushing.

Plan review: keep the implementation dependency-free and compatible with Apple Bash 3.2. Store generated secrets only in private files, use fixed child arguments, and use portable `cmp` for the final drift check. A PID-named lock owner lets concurrent stale-lock cleanup remove only the dead owner's marker. Since portable shell has no compare-and-swap rename, perform the drift check immediately before the atomic rename and document the remaining instruction-level race. Account the maximum curl and sleep allocations against one integer budget so wall-clock changes cannot extend readiness.

### Review

- Generated secrets now flow from OpenSSL into a mode-600 data file and through fixed AWK arguments. The regression stubs every prior/current text processor and proves the known generated value appears in the env file but not child argv or output.
- Runner detection stops on any non-empty, non-exact Compose override. A Linux regression combines a wrong trusted-local acknowledgement with stale isolated values and proves it is refused.
- Trusted-local publication snapshots the source, compares it immediately before rename, and leaves an injected external edit intact. Portable shell cannot close the final `cmp`-to-`mv` instruction interval; the source documents that limit.
- Lock ownership is a PID-named marker. Dead owners are recovered without deleting a later owner's marker; both a single recovery and eight concurrent recoveries pass.
- Readiness derives the documented host port, honors an explicit URL override, and charges maximum curl and sleep allocations to one clock-independent budget.
- Verification passed: focused suite 37/37; Bash syntax; ShellCheck; full Biome lint; full backend, web, and backend-test typecheck; workflow YAML parse; gate integrity; and `git diff --check`. `origin/main` remained at `0f949c307` after a fresh fetch, so no merge was needed.

## PR #288 final race-free repair

- [x] Add failing tests for immutable existing env files, unsafe concurrent creation, full readiness duration, public admin URL, and fresh/stopped macOS engine paths.
- [x] Refactor setup so a fresh private candidate receives the complete runner choice before one atomic no-clobber publication.
- [x] Never rewrite an existing env file; print exact manual trusted-local settings and stop when its runner state is incomplete.
- [x] Remove the runner-update lock and all stale/PID ownership machinery.
- [x] Replace double-counted readiness accounting with a Bash 3.2/BSD-portable watchdog that enforces the complete timeout.
- [x] Use `EZCORP_PUBLIC_URL` for the printed admin URL while keeping the readiness probe on the explicit URL or host port.
- [x] Correct the README claims.
- [x] Run focused tests, Bash syntax, ShellCheck, workflow syntax, lint, typecheck, gate integrity, and diff checks.
- [x] Challenge the final state machine for unnecessary states or duplicated parsing, then commit without pushing.

Plan review: existing operator files are immutable. Only a private fresh candidate can be changed, and it is published once with `ln` after all choices and validation. A losing concurrent creator must discard its candidate and restart the full existing-file validation path. Readiness uses one relative `read -t` watchdog rather than wall-clock arithmetic.

### Review

- Merged `bd6fd971` before implementation. The dependency-only change had no setup-code overlap.
- Reduced environment handling to two states: validate an immutable existing file, or finish and validate one private fresh candidate before a single no-clobber hard-link publication. Concurrent losers restart existing-file permission and runner validation. No update lock or PID state remains.
- Existing incomplete files now stop with exact manual runner settings and remain byte-for-byte unchanged. Fresh rejected choices publish nothing.
- Readiness uses a private FIFO plus Bash 3.2 `read -t` as one relative watchdog. Fast failures no longer spend synthetic time, active curl/sleep children are stopped at timeout, the probe honors the explicit URL or host port, and the completion message uses `EZCORP_PUBLIC_URL`.
- Added fresh macOS install, stopped-machine, new-machine, unsafe publication race, immutable file, full-duration retry, watchdog, and public-URL regressions.
- Verification passed with Bun 1.3.14: focused suite 37/37 and 134 assertions; Bash syntax; ShellCheck; full lint; all backend, web, backend-test, and web-E2E typecheck legs; workflow YAML parse; gate integrity; and `git diff --check`.

## PR #288 independent final-audit repair

- [x] Add failing regressions for placeholder production secrets, Compose environment precedence, macOS Compose probing, and false isolated-runner provisioning.
- [x] Preserve existing environment files while rejecting unsafe or incomplete effective production configuration with exact manual fixes.
- [x] Use Compose precedence for readiness and admin URLs.
- [x] Share functional Compose probing across macOS and Linux, and require Homebrew only when installation is necessary.
- [x] Require a numeric isolated-runner GID, a live Unix socket, and a non-empty token file.
- [x] Make `--check --accept-unsandboxed-extensions` report the accepted path accurately.
- [x] Run focused tests, syntax/static checks, repository gates, and inspect the final diff.
- [x] Commit the repair locally without pushing.

Plan review: keep existing operator files immutable. Validate the values Compose will actually use, with shell overrides taking precedence over the environment file. Reuse one Compose capability probe on both operating systems. Keep every check compatible with Apple Bash 3.2 and avoid printing or passing secret values to child-process arguments.

### Review

- Existing files remain immutable, but setup now stops before data-directory or stack changes when required production values are missing, too short, or still use the public example placeholders. The error names only variable names and exact generation commands; it never prints a secret.
- Readiness and the printed admin URL now use exported shell values before parsed env-file values, matching Compose. Quoted scalar and inline-comment cases are covered.
- macOS accepts either working Compose spelling, installs standalone Compose only when needed, verifies the installed command, and no longer requires Homebrew on a fully provisioned host.
- Linux isolated mode now requires a numeric container GID, a real Unix socket, and a non-empty credential file. The positive test uses a live Unix socket instead of placeholder paths.
- Verification passed: 80 focused setup/wrapper tests with 250 assertions; full lint over 4,608 files; full typecheck including backend tests and web E2E; Bash syntax; ShellCheck 0.11; workflow YAML parse; gate integrity; real Linux `--check` with no filesystem changes; `git diff --check`; and Bash 3.2 syntax plus indirect-expansion behavior in the official `bash:3.2` image.

## PR #288 final credential and dry-run repair

- [x] Add failing end-to-end script regressions for invalid runner credentials, blocked check mode, and malformed public URLs.
- [x] Match the production runner credential contract without exposing credential contents.
- [x] Stop `--check` at unresolved runner decisions without claiming downstream work.
- [x] Require a parseable HTTP(S) public URL under Compose precedence.
- [x] Run focused tests, Bash 3.2/static checks, repository gates, and inspect the final diff.
- [x] Commit the repair locally without pushing.

Plan review: keep one Bash 3.2-compatible validation path for effective environment values. Validate credential metadata and content without putting values in argv or logs. Represent an unresolved check-mode runner decision as a blocked result so later steps cannot be reported. Preserve immutable existing environment files and atomic fresh publication.

### Review

- Isolated-runner setup now mirrors the production credential reader: absolute regular non-symlink files, bounded size, safe write permissions, and trimmed 32-character-or-longer values without whitespace, controls, or NUL bytes. Tests cover directory, short, writable, symlink, oversized, whitespace, NUL, and relative-path failures with a real Unix socket.
- Check mode now returns exit 2 at unresolved existing or fresh runner decisions and does not claim that bind-directory or stack work would follow.
- Effective public URLs must be parseable HTTP(S) values with a host and valid optional port before setup proceeds. Existing files stay byte-for-byte unchanged on rejection.
- Verification passed: 88 setup/wrapper tests with 305 assertions; 18 production runner contract tests with 92 assertions; full lint; full backend, web, backend-test, and web-E2E typecheck; ShellCheck; Bash syntax; gate integrity; `git diff --check`; and direct credential/URL behavior under the official Bash 3.2 image.

## PR #288 publication-gate repair

- [x] Replace local env-file parsing with the selected Compose client's resolved environment.
- [x] Require `EZCORP_PUBLIC_URL` to be one canonical HTTP(S) origin, including strict IPv4 and IPv6 validation.
- [x] Run all non-mutating template, effective-env, port, and timeout validation before `--check` can succeed.
- [x] Restrict installer-approved runner credentials to portable printable ASCII and cover Unicode whitespace.
- [x] Use `PODMAN_SOCKET` consistently from engine validation through wrapper launch.
- [x] Run focused tests, Bash syntax, ShellCheck, lint, typecheck, workflow parsing, gate integrity, and diff checks.
- [x] Review the complete change for secret exposure, temporary artifacts, duplication, and Bash 3.2 compatibility.
- [x] Commit the repair locally without pushing.

Plan review: use Compose as the single source of truth for quoting, interpolation,
comments, and exported-shell precedence. Keep its resolved output private and
read only a fixed whitelist. Keep URL and credential validation conservative,
portable, and independent of JavaScript tooling.

### Review

- The installer now reads its fixed effective-environment whitelist from the selected Compose client's `config --environment` output. Private sibling temporary files contain resolver output and errors, and traps remove them.
- Public URLs must be exact canonical HTTP(S) origins. Curl supplies maintained URL parsing without a network request; installer checks reject userinfo, paths, query strings, fragments, malformed IP literals, and invalid ports.
- `--check` validates template shape, actual Compose resolution, effective values, runner credentials, ports, and readiness limits without generating or writing real secrets.
- Installer-approved runner tokens use a documented portable printable-ASCII subset. Regression tests cover NBSP and BOM input.
- `PODMAN_SOCKET` is used consistently for engine checks and wrapper launch.
- Merged current `origin/main` at `d81f98387f7636603edb4f30aede740922fff700` after the repair. Verification passed: 88 focused tests with 358 assertions; 25,946 backend tests across 1,655 files; lint across 4,611 files; all backend, web, backend-test, and web-E2E typecheck legs; ShellCheck; workflow YAML parsing; gate integrity; Bash syntax; and `git diff --check`.

## PR #288 final publication gate

- [x] Reject effective Compose values that cannot be represented by the line-oriented resolver output.
- [x] Publish a fresh environment file to the exact target without following a directory or symlink race.
- [x] Reject stale runner sockets, URL forms that the application runtime cannot parse, and bind-source conflicts during `--check`.
- [x] Add end-to-end regressions for every publication-gate finding.
- [x] Run focused tests, Bash 3.2/static checks, lint, typecheck, workflow parsing, gate integrity, and diff checks.
- [x] Review the final diff, document verification, and commit locally without pushing.

Plan review: keep Compose as the source of truth for dotenv semantics, but reject
control or multiline values before line-oriented extraction can truncate them.
Use the POSIX `link` utility for an exact no-clobber hard link, then require the
published path to be the same regular non-symlink inode as the private candidate.
Keep every new validation read-only in `--check` and compatible with Apple Bash
3.2.

### Review

- Effective exported values now reject control characters before Compose runs.
  Dotenv double-quoted control escapes and physical multiline quotes fail before
  resolution; ambiguous multiline or duplicate resolved output fails afterward.
  Exact shell, quoted-newline, and interpolated-newline regressions do not print
  their values.
- Fresh publication now uses the POSIX `link` utility, which targets one exact
  pathname instead of treating a directory as a destination. Existing
  directories and symlinks fail closed, directory races cannot receive a nested
  secret, and success requires the exact target to be the same regular inode as
  the private candidate.
- Linux isolated-runner validation now requires an answering HTTP Unix socket,
  not only a socket inode. URL validation rejects IPv6 zone identifiers that
  curl accepts but Bun's WHATWG parser rejects. `--check` rejects bind sources
  that exist as non-directories.
- Verification passed on the exact tree: setup and wrapper tests 118/118 with
  412 assertions; full backend pool 25,955/25,955 across 1,655 files; lint over
  4,611 files; full typecheck; Bash syntax; ShellCheck; official Bash 3.2
  syntax/indirect-control/`-ef`/`link` behavior; workflow YAML parsing; gate
  integrity; real Compose adversarial probes; and `git diff --check`.
## PR #290 CI failure diagnosis

- [x] Capture the completed run and raw failed-job logs for run 35631461630.
- [x] Build and run the smallest end-user-aligned real-auth web-search E2E reproduction.
- [x] Compare the failure with main/PR #291 and classify it as product defect, test defect, or infrastructure flake.
- [x] Inspect every production-proof failure and separate root failures from downstream failures.
- [x] If a defect exists, add regression evidence, implement the smallest root-cause fix, and verify it. Otherwise, make no source edit.
- [x] Record the final evidence, commit any fix, and confirm clean worktree status.
- [x] Merge current `origin/main` (including merged PR #291), rerun focused checks, and leave a push-ready commit without pushing.

Plan review: preserve the PR's multi-architecture runner-image change. Diagnose the first causal failure before downstream coverage consumers. Do not add retries or waits without a reproduced product defect.

### Review

- Run 35631461630 had two independent producer failures. Real-auth passed 104 tests before one tools-endpoint GET ended with `socket hang up`; recovery passed R1, then the archived-image seed rejected missing or stale build evidence. Browser coverage, per-file coverage, production lifecycle, and aggregate E2E failures were downstream.
- Both signatures were transient. PR #291 passed the same three web-search tests and used the same archived source successfully. Among the latest 30 CI runs, PR #290 was the only completed real-auth failure and the only recovery failure; recovery was 15 passes to one failure.
- The exact real-auth web-search Playwright spec passed 3/3 on the original PR head and 3/3 after merging main. No source or test workaround was added.
- Merged `origin/main` at `0f949c307`; focused checks passed: runner image pin 3/3, container engine 26/26, lifecycle launch 4/4, lint, and typecheck.

## PR #290 runner-profile upgrade repair

- [x] Reproduce and classify the repeated historical-upgrade failure from both CI attempts.
- [x] Run the archived app with the archived runner image profile, then switch to the candidate profile.
- [x] Prove that an old release is refused after the profile change and must be rebuilt and reapproved.
- [x] Add focused regression tests for the profile transition without weakening strict digest checks.
- [x] Run focused tests and the closest practical production-upgrade proof with Bun 1.3.14.
- [x] Run relevant full gates, review the diff, and commit the repair without pushing.

Plan review: keep exact runner-image equality. The proof must model the real service upgrade instead of making OCI index and child digests interchangeable. Preserve installation identity, conversation wiring, stored extension data, and human approval semantics through the required rebuild.

### Review

- Both attempts of CI run 35638868572 failed only after the archived app was paired with the candidate runner profile. PR #291 passed the same archived source with the old profile.
- The proof now derives both runner images from their immutable source revisions. It seeds with the archived profile, restarts with the candidate profile, proves the old release cannot execute, then rebuilds and reapproves it under the new profile.
- The production lifecycle's exact image comparison remains unchanged. Installation identity, owner, scope, grants, workspace, old release and approval records, conversation wiring, and extension storage are verified across both the live upgrade and backup restore.
- Real rootless-Podman semantic upgrade passed end to end: archived seed, candidate rebuild, independent restore rebuild, and clean cleanup. Focused tests passed 44/44. Bun 1.3.14 lint and typecheck passed.

## PR #290 final proof hardening

- [x] Add negative regressions that reject unrelated old-release failures.
- [x] Require the precise runtime-profile mismatch refusal.
- [x] Compare the complete pre-rebuild installation snapshot with the seeded receipt.
- [x] Run focused tests and the real semantic upgrade when the local engines permit it.
- [x] Run pinned Bun lint and typecheck, review the diff, and commit locally without pushing.

Plan review: change only the historical-upgrade proof. Keep the production runner's strict image equality and the existing post-rebuild identity checks unchanged.

### Review

- The old-profile assertion now accepts only the stable API message produced by `runtime_profile_changed`. Explicit negative tests prove that a successful invocation, an unrelated runner failure, and a missing error cannot satisfy the gate.
- The candidate phase compares the complete installation record with the archived receipt before it attempts the old release or starts a rebuild. The existing post-rebuild identity, approval, wiring, and storage checks remain in place.
- The exact current candidate passed the real rootless-Podman semantic upgrade and independent restore. Both phases rebuilt and reapproved the archived release under the multi-architecture index profile; cleanup passed.
- Focused tests passed 10/10. Full Bun 1.3.14 lint checked 4,610 files, and full typecheck passed all backend, web, backend-test, and web-e2e surfaces.

## PR #290 final audit repair

- [x] Move the runner-profile transition regression suite into the default backend test gate.
- [x] Assert the rebuilt release keeps the archived installation, workspace, revision, and source contract.
- [x] Add negative regressions for each rebuilt-release provenance field.
- [x] Run default discovery, focused tests, pinned lint, typecheck, and the real semantic upgrade when available.
- [x] Review the exact diff and commit locally without pushing.

Plan review: keep the runtime's exact image equality unchanged. Reuse one assertion helper so the unit proof and real historical-upgrade proof cannot drift.

### Review

- The transition suite now runs under the configured `src/__tests__` root. Default discovery passed 4 tests with 15 assertions; the combined focused set passed 11 tests with 59 assertions.
- One shared assertion now binds rebuilt releases to the archived installation ID, workspace ID, workspace revision, and source digest. Negative cases reject drift in each field.
- The real rootless-Podman proof passed the live candidate rebuild and the independent restore rebuild. Both retained the old stored value and produced clean command and cleanup exits.
- Bun 1.3.14 full lint checked 4,610 files, full typecheck passed all surfaces, and the backend pool passed 25,866 tests across 1,654 files with no failures.

## Repair PR #284 CI bootstrap and file-mode provenance — 2026-09-21

- [x] Reproduce the fresh-runner bootstrap failure and local file-mode false-clean result.
- [x] Install pinned Bun and frozen root dependencies before the CI source-state probe.
- [x] Compare complete regular-file permission bits with the canonical `HEAD` tree mode.
- [x] Add workflow-order and non-executable mode regressions.
- [x] Run focused tests, workflow validation, static gates, and review the exact diff.
- [x] Commit the publication-gate repair locally without pushing.

Plan review: reuse the repository's composite setup action so Bun pinning, dependency caching, and
the frozen root install keep one source of truth. Keep the source-state comparison direct: Git tree
mode `100644` maps to local `0644`, and `100755` maps to local `0755`; any other permission bits
change the local Docker context because Docker preserves local `COPY` permissions.

Review: the dev-image job now completes the shared setup action before it invokes the source-state
resolver. That action installs the exact `.bun-version`, restores the shared package cache, and runs
the frozen root install that supplies `@balena/dockerignore`. A workflow regression pins both the job
ordering and the composite action's pinned-runtime/frozen-install contract. The resolver now compares
all regular-file permission bits with Git's canonical `0644` or `0755` mode, so local modes such as
`0600`, `0700`, or `0775` cannot be mislabeled clean.

Verification: the focused CI/provenance set passes 93 tests and 235 assertions. Actionlint, Bash/sh
syntax, `git diff --check`, gate integrity, full lint over 4,614 files, full typecheck, Svelte check
(0 errors and 0 warnings), and the production build pass. The canonical backend pool passes 25,903
tests across 1,657 files with zero failures. The production build required the known Nix host
`libstdc++.so.6` library-path correction and then completed successfully.

## Refresh PR #284 after PR #288 — 2026-09-21

- [x] Verify the exact clean PR head and exact incoming `origin/main` revision.
- [x] Merge `origin/main` with a normal merge commit and preserve both feature sets.
- [x] Resolve the CI aggregation, wrapper-test, and task-history conflicts as a semantic union.
- [x] Run the combined focused tests, shell checks, lint, typecheck, and diff checks.
- [x] Review the integration against both parents and push the exact merge commit.

Review: the merge keeps PR #284's complete Docker-context provenance behavior unchanged and adds
PR #288's setup script, portable runner-group resolution, Apple Bash job, and required-check
aggregation. The two test conflicts retain both contracts and their fixtures; both task histories
remain intact. The combined focused set passed 230 tests with 0 failures. Bash syntax, ShellCheck,
workflow parsing, lint over 4,615 files, full typecheck, and `git diff --check` passed.

## PR #292 current-main conflict resolution

- [x] Reproduce the GitHub conflict locally against the current `origin/main`.
- [x] Trace every conflict to both parent commits and preserve both intended behaviors.
- [x] Review the merged architecture for ownership, dependency direction, security, and DRY reuse.
- [x] Run focused regressions for the resolved files, then lint, typecheck, build, and required gates.
- [x] Inspect the full merge diff, record exact results here, commit, push the PR branch, and verify hosted CI.

Plan review: work in the clean dedicated PR #292 worktree so unrelated local changes remain untouched. Merge the current base into the PR branch, keep the established pluggable-provider boundaries, and add no new behavior unless a conflict exposes a verified integration defect.

Review: merged `origin/main` at `906a1eb82`. The only conflicts were append-only task journals; the resolution contains every nonempty line from both parents and no conflict markers. Product files merged without intervention. The architecture remains layered: the extension contract owns canonical schemas and receipt validation, the reviewed extension owns provider declaration and forwarding, the host invoker rechecks membership/release/grants and receipt identity, the controller owns authorization and durable lifecycle serialization, and workspace routing has no host-path fallback. Focused contract/provider/controller/journal/workspace suites passed 225 tests in their required process isolation. Full typecheck, lint over 4,676 files, production build, and the backend pool (26,236 tests across 1,673 files) passed on Bun 1.3.14. The Playwright sandbox-panel journey first exposed a mobile-only assertion that bypassed the existing responsive picker helper; the test now reuses that helper. All 6 Chromium and Pixel 5 journeys pass, the 4 evidence journeys pass, and the inspected desktop/mobile captures show no clipping or horizontal overflow. The tested head `2f09d4432` was mergeable and all 49 hosted checks passed, including coverage, mutation, real-auth/mock E2E, visual evidence, both browser engines, external PostgreSQL, the production candidate image, and all production proofs.

## Refresh PR #284 against current main — 2026-09-22

- [x] Reproduce the hosted merge conflict against the current `origin/main`.
- [x] Trace every conflict to both parent changes and preserve both intended contracts.
- [x] Run focused conflict tests and the repository's required checks.
- [x] Review the exact merge against both parents and prepare the merge commit.
- [ ] Commit and push the exact merge to the PR branch.
- [ ] Watch hosted CI and verify mergeability, review state, and open review threads.

Plan review: use a normal merge commit because the PR is already under review. Keep the user's
dirty primary worktree untouched. Resolve each conflict as a semantic union and do not add new
product behavior.

Local review: merged `origin/main` at `d37fdac07`. The only merge conflicts were append-only task
journals; the resolution retains every nonempty line from both parents. The full backend pool first
found a current-main bug that normalized a relative local-sandbox state root into the checkout's
absolute `/tmp` path. The production configuration-loader regression failed before the repair and
passes after validation checks the original path before normalization. The PR warning script also
uses explicit portable empty-variable syntax and preserves its literal rebuild command. Focused PR
tests pass 132 tests and 315 assertions. The repaired full backend pool passes 26,273 tests across
1,676 files. Lint over 4,680 files, full typecheck, Svelte check, dependency boundaries, gate
integrity, Actionlint, Bash syntax, ShellCheck, the production build, and `git diff --check` pass.

## Review PR #308 — 2026-09-23

- [x] Read PR history, description, review findings, failing CI, and linked design.
- [x] Reproduce OAuth session-revocation and read-only PR recovery gaps in focused tests.
- [x] Fix both gaps, including row-locked final session validation.
- [x] Run broker, device-flow, and PR-service suites; typecheck and lint.
- [x] Run launcher integration suite locally under CI settings.
- [ ] Push fix commit and inspect new hosted CI.
- [ ] Record final review and blockers.

Plan review: Keep this work on the PR #308 branch and change only the credential broker, PR recovery call, and focused tests. Do not weaken the launcher test while its hosted failure remains unexplained.

Review: The two source findings failed before the fix and pass after it. Focused broker, device, and PR-service suites pass 31 tests and 222 assertions. Full typecheck and lint over 4,740 files pass. The launcher integration suite passes 4 tests and 43 assertions locally with CI environment flags. Hosted residual integration failed twice at its 20-second watchdog on the old head; a fresh run on the repair commit is pending. Human non-author and CODEOWNERS review remain required.

## PR #315 keyless credential review — 2026-09-23

- [x] Read PR intent, changed files, review state, and failed CI log.
- [x] Reproduce the failing quality gate and inspect the real HTTP behavior.
- [x] Refactor the extension LLM mediator so changed functions meet the quality gate.
- [x] Run focused tests and relevant local checks, then commit and push to the PR head if safe.
- [x] Recheck hosted CI and record a final review below.

Plan review: Keep the token suppression rule and the audited credential boundary intact. Extract cohesive stages from the existing extension LLM handler, preserve its error codes and audit behavior, and test the same request path before and after the change.

Local review: The PR wire test proves that the raw keyless placeholder reaches a local server as a bearer, while both repaired pi-ai paths send no Authorization header and real keys remain intact. The hosted quality log reports CRAP 50 for `handlePiLlmComplete` at 98% coverage. Extracting grant validation, quota reservation, and successful-response recording reduces source complexity to 24, 8, 8, and 15 respectively. The extension handler suite passes 19/19; keyless wire and credential-boundary suites pass 12/12; pinned-Bun typecheck passes; lint checks 4,686 files. The full local coverage test pool passes 27,200 tests with zero failures, including 595 Vitest files / 7,482 tests. Its wrapper exits 1 before LCOV merge because the direct invocation lacks the browser-coverage receipts that `scripts/ci-local.sh` supplies. Hosted CI must confirm patch coverage and the merged CRAP gate.

Hosted follow-up: Commit `811f564a5` passed 45 source/coverage producer checks, but the per-file coverage gate stopped at patch lines 225 and 228 in the permission-denied return. The new absent-grant regression exercises that complete reverse-RPC response, proves model resolution does not run, and checks that no audit row is written. Pinned Bun targeted LCOV records `DA:225,14` and `DA:228,16`; the focused suite passes 20/20. Typecheck and lint pass. The next hosted run must still confirm the aggregate patch and CRAP gates.

Hosted verdict: Commit `e38879396` passed all 50 checks. The per-file gate covered every changed executable line, checked 1,665 enforced files, and scored 18 touched functions with zero CRAP violations (limit 30). The PR still needs a non-author review and a current-base CI run after the ordered merges.

Final base refresh: #309 and #314 are in `origin/main` at `cc0a3b9a3`. The only merge conflict was this append-only task journal; both parents' entries are retained, with #315's hosted-CI checklist marked complete. Five isolated auth, Kilo, agent, and extension suites pass 69/69. Pinned Bun typecheck and lint over 4,686 files pass. The full local gate is waiting for the concurrent #317 browser/coverage run to release host memory.

## PR #314 review — 2026-09-23

- [x] Read PR scope, history, review state, and current CI.
- [x] Review the arm64 job and sandbox suite for real coverage and gate safety.
- [x] Reproduce the PR-owned gate gap; make and verify a focused repair.
- [x] Run each arm64 sandbox file in its own Bun process; verify the exact job lane.
- [ ] Merge current main after #309; preserve the arm64 job and required aggregator.
- [ ] Run exact focused lane, Actionlint, lint, typecheck, full backend, and coverage gate.
- [ ] Push normal merge history and confirm hosted CI at the exact head.
- [ ] Recheck current CI, document findings, and hand off merge status.

Plan review: PR #314 is stacked on #309. Review its final CI commit against its parent and keep #309's product changes with their own review. The arm64 job passed on GitHub. Inspect the three failed jobs to separate runner or base failures from PR-owned failures before changing code.

Review: The live GitHub arm64 job passed 48 tests, with one expected conditional skip. Its deny and allow child containment tests both executed. The applied branch protection requires `Backend tests`, but does not require `Sandbox (arm64)` and no required check depended on it. Add that result to the required backend aggregator so a regression blocks merge. The three failed checks on the original run came from a production candidate runner's `actions/checkout` TLS CA error and its dependent jobs; no PR source executed there. Actionlint and `git diff --check` pass after the aggregator edit. PR #309 remains open and needs its own review; PR #314 needs CODEOWNERS approval.

Follow-up plan: The job's one `bun test` invocation with four files violates the root testing rule and can share `mock.module()` state. Keep its Landlock guard, run the same four files one at a time with Bun's 30-second per-test budget, check the exact loop, and commit locally. Hold the push until #309 merges and the base is updated.

Follow-up review: The workflow now loops over the same four files, runs each in its own `bun test --timeout 30000` process, and uses `set -e` for fail-fast. Extracting and running the exact YAML step on the Linux host passed 33 + 11 + 3 + 1 tests with one expected skip and zero failures. Actionlint and `git diff --check` passed. This local run is on x86_64; the previous hosted arm64 job passed before the process-isolation edit. Commit locally and hold push as requested.

Integration plan: #309 landed on main at 3b5095303. Merge that exact base into this branch without force-pushing, resolve any overlapping task journal as a union, then verify the arm64 CI job and required aggregator survived. Run the full local quality line and an appropriate browser receipt before pushing because the base changed. Recheck the remote head before push.

## PR #314 residual CI follow-up — 2026-09-24

- [x] Read the failed hosted job log and reproduce its two failing cases locally.
- [x] Replace the test fixture's 5-second file-readiness deadlines with producer-liveness checks.
- [x] Run the focused lifecycle suite and relevant static checks.
- [x] Review the exact diff with the lead agent before pushing.

Plan review: Both failures stopped after about five seconds while waiting for a startup file. The PR does not change the launcher. Wait for an observable process state instead of measuring host scheduling time; keep the test's overall timeout as the deadlock guard.

Review: The helper now reads nonempty readiness content until it appears or the producer exits. One new test proves that a producer exit fails immediately. The exact lifecycle suite passed 5/5 on pinned Bun 1.3.14; Biome and full typecheck passed. The failed hosted job cannot be rerun while its workflow is active (GitHub HTTP 403), so the change needs a new CI run after push.

## PR #308 remaining dependency advisories — 2026-09-24

## PR #308 conflict resolution and merge — 2026-10-03

- [x] Merge current main into PR #308, preserving both branches' behavior.
- [x] Independently review conflict resolution and security invariants with Sol agents.
- [x] Fix the fresh October 3 root, web, and Excel dependency advisories and verify zero audit findings.
- [ ] Run fresh installs, static checks, full tests, build, browser lanes, coverage, and audits.
- [ ] Push the tested head and verify required hosted CI and review requirements.
- [ ] Squash-merge when GitHub requirements pass; record the final result.

Plan reviewed: user authorizes conflict resolution, validation, push, and merge when ready. Use isolated worktrees. Keep all gates and required approvals intact. Record final evidence in ignored `tasks/pr308-merge-oct3-results.md` so tracked source remains frozen during browser attestation.

Merge review: The only textual conflict was this append-only task journal. Both PR #308 and main's #319/#320 entries are retained. The auto-merged sidebar, watchdog, and isolation changes remain in place; focused integration checks follow below.

Pre-validation review: Independent Sol review accepted the merged product tree and narrow dependency lock updates. Root and Excel caller regressions cover URI normalization, cross-family subnet rejection, bounded brace parsing, and workbook compatibility. Web tests resolve patched packages through their actual parents. The Excel source digest is refreshed. Complete final test and audit results will be recorded in the ignored report above; keep tracked source frozen while collecting browser receipts.

### Previous dependency task

- [x] Resolve root esbuild and uuid advisories with compatibility tests (Sol root dependency agent).
- [x] Resolve web qs and cookie advisories with compatibility tests (Sol web dependency agent).
- [x] Independently verify fixed versions, installed resolution paths, and security regression tests.
- [x] Integrate changes; require zero advisory records with no allowlist additions.
- [ ] Run complete local quality checks, build, browser lanes, coverage, and dependency audit on final source.
- [ ] Push to PR #308, verify hosted checks, and record final evidence.

Plan review: The user requests all six remaining lower-severity advisory records fixed, validated, and pushed. Include current main through `8aa507304` before the changes. Separate root and web manifests/locks between isolated Sol worktrees. Prefer supported parent updates; use narrowly justified dependency overrides only with real caller compatibility proof. Do not suppress advisories, weaken gates, or change test deadlines. Final results go in `tasks/pr308-dependency-results.md` so tracked source stays frozen during coverage attestation.

Review before final validation: Independent clean-install checks report zero advisories in root, web, and the Excel example. Pinned Bun 1.3.14 ignores parent-scoped overrides, so tested exact global pins are required. The extension resolver now honors exact global overrides, rejects unsupported forms and stale locks, and checks package declarations against the lock. Regression tests cover real dependency callers, malicious inputs, and the author save/resolve/reload flow. Git test fixtures now share an isolated environment so hooks cannot change the caller's repository identity. Run final checks and record their results in the ignored report before pushing.

## PR #319 review and repair

- [x] Read hosted browser failures and inspect the chat sidebar change.
- [x] Fix stale project rows, missing new-chat refresh, empty All chats access, and fork/agent markers.
- [x] Update old browser journeys to use the new Chat section.
- [x] Complete focused browser, type, lint, and coverage checks.
- [x] Commit the reviewed changes and report exact results.

Review: Hosted full mock browser lane failed 16 journeys; browser route coverage and per-file coverage then lacked a required producer. All 117 affected Chromium journeys pass after the fixes. Component checks pass 31/31 and show 100% line and branch coverage for ChatNavSection. Web production build, full typecheck, lint, and whitespace check pass. The hosted full browser and coverage lanes still need a new run after the branch is pushed by the parent agent.

### Hosted CI follow-up at `12f9bb64b`

- [x] Reproduce the two mobile drawer failures with Chromium Playwright.
- [x] Scope the Chat link assertions to the exact navigation item.
- [x] Run the affected browser test and exact `mock-full` CI lane.
- [x] Commit the follow-up fix and report the result.

Review: The hosted full mock lane reported two strict selector collisions in `mobile-tab-bar.spec.ts`: both the Chat nav link and All chats link matched the broad `Chat` locator. Downstream browser route coverage and per-file coverage gates failed because their browser producer failed. The two affected Chromium journeys failed before the fix and passed 2/2 after it. The full lane is pending.

### Hosted patch coverage follow-up at `444e4b488`

- [x] Reproduce hosted patch-coverage misses locally at the exact head.
- [x] Add a list/store integration test for scoped and unscoped refresh events.
- [x] Add a layout integration test for the mobile Chat section path.
- [x] Run focused tests, local coverage, typecheck, and lint.
- [x] Commit the coverage repair and report the result.

Review: Hosted global and new-file coverage passed. Patch coverage missed `ConversationList.svelte:237`, `stores.svelte.ts:372`, and `(app)/+layout.svelte:609`. The new integration tests pass 20/20. Targeted V8 coverage now records 3, 3, and 1 hit on those lines. Full typecheck and lint pass. The exact-head browser receipt and full coverage gate remain to run after the other agent's shared test slot clears. No gate configuration changed.

### Merged-layout coverage follow-up at `9c8aaa303`

- [x] Compare targeted and merged LCOV for layout line 609.
- [x] Trace the canonical Vitest source include and browser ownership filter.
- [x] Add narrow dual measurement for the app layout and guard it with a test.
- [ ] Run focused, full, patch, new-file, and gate-integrity checks at the new head.

Review: The exact-head browser lanes and full host coverage passed, but the separate patch gate found layout line 609 at zero hits. Browser V8 source maps leave that prop line at zero; targeted Node V8 measured the mounted mobile drawer test at one hit. The canonical Node producer did not include the layout and its filter excluded scripted routes. Exactly this layout is now dual-measured: the sanctioned Vitest leg passed 596 files and 7,517 tests, retained layout line 609 with one hit, and its LCOV merged with the browser receipt covers 205/219 layout lines (93.61%, above 80%). The guard suite, lint, typecheck, and gate-integrity checks pass. Exact-head full receipt and coverage checks remain. No threshold or exclusion changed.
## PR #320 watchdog sleep reason review — 2026-09-24

- [x] Read the PR, runtime contract, relevant lessons, and failed hosted job.
- [x] Reproduce the first-tick sleep failure through the watchdog and persisted error path.
- [x] Fix first-tick detection, progress-before-tick attribution, and the code quality complexity failure.
- [x] Run focused watchdog tests, typecheck, lint, and browser SSE/reload proof.
- [ ] Verify the CRAP quality gate on merged coverage, then push and review hosted CI.

Plan review: The hosted Per-file coverage job passed line coverage but failed the touched-function CRAP limit: tick() scored 31 over its limit of 30. The PR also missed a sleep before the first tick and progress just before a delayed tick. Keep kill thresholds unchanged. Move sleep accounting and reason text into small helpers, and prove visible and persisted wording through browser SSE and reload.

Review: A new frozen-clock test failed at the original head when the host slept before the first timer callback. The fix initializes observation time on start and resets it on real progress. A tool timeout that expired during sleep also lost the sleep note; the selected tool reason now keeps precedence and gains the note. The text says sleep *may* have happened, since timer delay alone cannot prove it. Six focused suspension tests, the watchdog file suite, typecheck, lint, and six Chromium browser cases passed. Browser cases show both sleep error forms after SSE and page reload. Exact quality gate and hosted CI remain for the integrating agent.

## W02c — the package quarantine fence (branch `wp/w02c-quarantine`)

Base `integ/w00` `578692e8a`; merged `943b9fa0c` at `43d224900` and `8cea0f638` at `3695f8351`. Passes at `1d06a7394`, sweep at `3695f8351`. Receipts: `/tmp/factory-platform-evidence/w02c/`. Gates: `tasks/factory/w02c-GATES.md`.

- [x] Reproduce at base in the real application (W09b's stack, a guest that waits): quarantine mid-attempt, then start a second run.
- [x] Typed refusal: `factory_package_quarantined` / `factory_package_revoked` carry the trust revision that set the state and the installation generation it was decided against.
- [x] Admission fence: the production runner policy reads current trust before it admits an attempt.
- [x] Preflight and launch fences: the existing readiness reads refuse with the typed error; the dispatcher records the typed code.
- [x] Live work: a production `FactoryPackageQuarantineFence` cancels every run with a live attempt on the package, with the typed reason, through the ordinary kernel cancel and so through W03's stop path; one shared in-transaction cancel for operator and fence.
- [x] Affected-run record: a sealed table written in the quarantine transaction, idempotent; a scoped reader for W14 and a preview that uses the same query.
- [x] Fail closed: quarantine and revoke refuse by name when no fence is composed.
- [x] Lift: a later publish re-admits new attempts only; stopped runs stay cancelled with their reason.
- [x] Tests: success, concurrent quarantine and admission or launch (one winner), lost response, crash mid-fence and mid-stop, stale revision and generation, cross-tenant, corruption, fail-closed; restart suite; PostgreSQL parity and suite registration.
- [x] Real-server proof, three passes (9/9 each, `proof/receipt-v2-pass-*.json`). Two blockers outside W02c are reported in the gate file's Open section.
- [x] Gate file, review, sweep.

**Review.** The fence existed as a seam with nothing behind it. The real application quarantined a package
and kept running its attempt, admitted new attempts, and kept no record. The base run measured all of that.
W02c puts a production fence behind the seam. In the decision's own transaction it cancels each affected run
through the operator's cancel, which W03's stop path then settles unchanged. It writes one sealed record per
attempt and refuses admission, preflight and launch with a typed error naming the generation. The real server
shows the fence's own promises holding in three passes: the guest was stopped mid-attempt, the stop survived a
killed product server, the run was recorded, a new run was refused by name, and a run after the lift launched.
Two things the fence consumes still stop a run from ending. W03's usage reconciliation leaves a stopped
zero-operation attempt's hold unresolved, so run A stays `cancelling`. The orchestrator runs each effect once,
so a refused admission kills the run's workflow. Both are reported as interface questions, not worked around.

## W09d-2 — named refusals on the executions route (branch `wp/w09d2-named-refusals`)

Base `wp/w02c-quarantine` `daf5203cc`. Evidence: `/tmp/factory-platform-evidence/w09d2/`. Gates: `tasks/factory/w09d2-GATES.md`.

- [x] Reproduce at the base: W02c's run B stays `running` (red).
- [x] One named-refusal answer in the router, on the executions route and the effects; the W09d wrapper is moved, not copied.
- [x] Measure that the name alone does not end run B, and find why (cancel refused as stale, run held in `stopping`).
- [x] Atomic "nothing queued" in `FactoryTaskExecutionAdmission.dispatch` (savepoint, same locked transaction), per the coordinator's safety condition.
- [x] The kernel ends a running task node in place on `admission_denied`; every other dispatch failure keeps the cancel.
- [x] Real server at the head: run B ends `failed` with `factory_package_quarantined` (10/10).
- [x] Unit, route, real-store, kernel, and Temporal replay tests; W09d and W02c suites; coverage and static gates.
- [x] Measure and disclose the leftover compute lease and budget hold (W02, W03).

### Review

The executions route now answers a typed refusal by name, from the same one place as the effects. That was not enough. The kernel answers a failed dispatch with a cancel, the stop path refused that cancel because nothing was ever queued, and the run waited in `stopping` for ever. The product now decides "refused, and nothing queued" inside the refusal's own locked transaction under a savepoint. Only then does it tell the kernel `admission_denied`, and the kernel fails the task node in place with the refusal's name. Every uncertain case keeps the cancel. On the real server, run B went from `running` at the base to `failed` with `factory_package_quarantined` at the head. One gap is left, measured and assigned: the admitted compute lease and budget hold of a refused dispatch are released by nothing (W02, W03).

## W04b — re-grant after revoke, and grantee display names (branch `wp/w04b-regrant`)

Base `integ/w00` `d5ee52309`. Receipts: `/tmp/factory-platform-evidence/w04b/`. Gates: `tasks/factory/w04b-GATES.md`.

- [x] Reproduce at base: grant, revoke, grant again fails with `factory_artifact_grant_conflict`.
- [x] One row per grant (`grant_revision`); the revoked row stays; the new grant is a new active row; a partial unique index covers active grants only; an active grant still conflicts.
- [x] Migration proven on the old shape holding a revoked row, rerunnable with unchanged oids; restart case; parity index.
- [x] Grant records and the grant API name the grantee (`displayName`), with the placeholder `Unnamed principal` for no name.
- [x] Tests on PGlite, real PostgreSQL, and Vitest; sweep green.

**Review.** The share table was keyed by the share, so its first row, even once revoked, owned the key forever.
Numbering grants turns revoke-then-grant into history rather than a conflict. A partial index keeps the rule
that matters: one active grant per target. First grants keep their old seal, so every existing row still
verifies. The display name is read from the user or service-account record only. It is resolved outside the
authorization path, and it can never fall back to the raw id.

## W18 hygiene — 60 partial api-keys mocks, hook cap, 27 bare git-init tests (branch `wp/w18-hygiene`)

Base `integ/w00` `2b2e12550`. Receipts: `/tmp/factory-platform-evidence/w18-hygiene/receipts/`. Gates:
`tasks/factory/w18-hygiene-GATES.md`. Item lists (F1 = 60 files, F2 = 27 files) are W18a-3's, copied
verbatim from `tasks/factory/w18a3-GATES.md`.

### Item A — F1

- [x] Add `webLibModule()` to `src/__tests__/helpers/mock-cleanup.ts`, identical to W18a-3's (found on
  their unmerged branch `wp/w18a3-quality-r2`; not yet on this package's base).
- [x] Convert all 60 listed suites' partial `$lib/server/security/api-keys` mock to `webLibModule(...)`.
- [x] Find and fix a self-recursion hazard: the 14 dual-specifier files (`$lib/...` + the resolved
  relative path, same factory) and, separately, ALL 24 web-side files (because `web/`'s generated
  tsconfig maps `$lib/*` to a really-resolvable path, unlike the virtual-only repo root) drop every
  export but the override if `webLibModule()` is called lazily inside a factory also registered for the
  same resolved module. Fixed by computing the merged object once, before either registration.
- [x] Verify all 60 pass at their REAL invocation (some web files are only correctly gated from the repo
  root, per `scripts/lib/test-file-sets.sh`'s `passfail_files`, not from `web/`).
- [x] Add a guard test rejecting a partial `$lib/*` factory (general detector, pinned by fixtures;
  enforced repo-wide for the api-keys module this item completed, with four named exemptions for files
  W18a-3 is fixing on its own unmerged branch).
- [x] typecheck, lint, boundaries, gate-integrity, `factory-process-boundaries.test.ts` all green.

**Review.** The 60 suites' mocks were correct for the ONE key each test used, and silently wrong for
every OTHER key any later test in the same process needed — a raw object literal freezes Bun's
mock.module() export list forever, and neither a second registration nor restoreModuleMocks() can add a
name back. Reproduced the base failure directly: running the 36 src-side files together in one batch
(the F1 disclosure's own words — "any of them run before a route that imports requireAdmin fails to
link") throws exactly that SyntaxError on the base, and the api-keys-specific instances of it are gone
after the fix (unrelated pre-existing pollution from OTHER $lib modules, present on the base too, is
disclosed and left alone — out of scope for this item). The harder finding was that `webLibModule()`
itself needs to run BEFORE its own mock.module() registration when the specifier it targets and the
plain relative path to the real file can resolve to the same module record — proven with a standalone
repro, and this affects every web-side file, not only the already-known dual-specifier ones, because
`$lib` genuinely resolves there.

### Item B — pre-commit hook cap

- [x] `run_staged_tests()` names every staged test file above the cap and, by default, exits non-zero
  (blocks the commit) instead of skipping silently.
- [x] `EZ_SKIP_HOOK_TESTS=1` moved from a pre-filter in `.githooks/pre-commit` into `run_staged_tests()`
  itself, so it is honoured — visibly — for both the over-cap and the pre-existing under-cap skip.
- [x] Four tests in `src/__tests__/git-hooks.test.ts` (a new `repoWithHookLib()` fixture): blocked over
  cap, skipped-and-visible over cap with the env var, unaffected at the cap, and (validator-3 L1, added
  in the fix round) skipped-and-visible AT the cap with the env var — the fourth combination, which
  before this item never even reached `run_staged_tests()` (the caller pre-filtered the env var), so it
  was silent too.
- [x] typecheck, lint, boundaries, gate-integrity, `factory-process-boundaries.test.ts`,
  `gate-scripts.test.ts` all green.

**Review.** Reproduced the bug directly, twice, on this package's own commits: staging the 36-file and
then the 24-file api-keys conversion each hit the cap and the hook printed one line ("N test files map
to this commit (cap 12) — skipping.") and exited 0 — the commit landed with zero tests run and no file
named. That is the same shape as the coordinator's 74-file main-merge incident. The fix does not lower
the bar (a wide commit still does not run its tests locally — CI does), it makes the decision to skip an
ACT the developer takes knowingly, every time, with the exact file list in front of them, rather than
something that happens to them silently past a threshold they may not know exists.

**Validator-3 fix round (M1, L1).** M1: the receipts had no producing commit, exit code, or timestamp
named, and three files were missing from `SHA256SUMS.txt`. Added `receipts/MANIFEST.json` and cited
every commit in the gates file; evidence-only, no code change. One correction surfaced while building
it: `f1-src-batch.log`'s exit code is 1 (the four-module pollution item D closes), not 0 as the gates
file previously implied by omission. L1: added the missing fourth test above. New head `344b11efc`. L2
(the withheld-factory-orchestrator name; the empty-list guard for an orchestrator-only stage; removing
the F1-guard's W18a-3 exemption once those files land) is item C's scope on `wp/w18-hygiene-2`.

### Item D — the other pre-existing partial-mock pollution (coordinator ruling on finding 2, branch
`wp/w18-hygiene-2` from `b7349ba8c`)

- [x] Reproduced on the base before fixing anything: the 36 F1 files run together throw "Export named
  X not found" for `$lib/server/context`, `$server/db/queries/extensions`, `$server/providers/
  local-model-check`, `$lib/server/security/resource-quotas` — exactly the class F1 predicted, for
  the modules F1 didn't touch.
- [x] Found and converted every file (26, repo-wide) that partially mocks one of the four modules.
- [x] Three of the four (`db/queries/extensions`, `local-model-check`, `resource-quotas`) use the same
  `serverModule()`/`webLibModule()` pattern as F1.
- [x] `$lib/server/context` needed a different fix: it's the app's central wiring module, and spreading
  it for real cascades through an unbounded chain of the SAME test files' own unrelated partial mocks
  of its transitive dependencies (agent-configs, conversations, user-commands, db/connection,
  pending-messages — each layer found by direct reproduction, one at a time). Built
  `completeFactory()`/`contextModule()`: a facade with the real export surface always present,
  throwing stubs where not overridden, never requiring the real module.
- [x] Found and fixed a companion false positive this surfaced in the "mock.module target is
  snapshotted or exempt" meta-test: it didn't recognize a `serverModule()`/`webLibModule()`-bound
  const as a valid `$server/*` shim.
- [x] Bonus: a partial `$server/auth/middleware` mock in `extension-event-end-to-end.test.ts`, found
  while chasing a residual failure.
- [x] All 26 files pass individually at their real invocation; typecheck, lint, boundaries,
  gate-integrity, `factory-process-boundaries.test.ts` all green.
- [x] Coordinator-ruled fix: the residual pollution turned out to be THREE more partial mocks, not one
  — `db/queries/conversations` and `db/queries/tool-calls` (same fix as the rest of item D), and a
  THIRD, different bug class: `$lib/server/http-errors` had the right export name but a narrower
  hand-rolled body that dropped the real signature's `details` param, which the guard test cannot
  catch (it only checks for a missing export, not a behaviorally-incomplete one). A near-identical
  instance was independently found in a second file while re-verifying against the full batch.
  Reproduction batch now 682 pass / 0 fail (was 677/5).
- [x] Validator-3 pre-review fixes P1 (completeFactory() has its own tests), P2 (CONTEXT_EXPORT_NAMES
  pinned against context.ts's real export list, parsed from source, never imported), P3 (fixed a
  companion classification bug the P1/GD5 meta-test fix introduced: an override-bearing
  serverModule()/webLibModule() binding was wrongly treated as an unconditional shim; now only an
  EMPTY-overrides binding is, and a non-empty one correctly falls through to the served/skipped check
  instead of getting a free pass).
- [x] Two much larger surveys (83 files still partially mock `db/queries/extensions` elsewhere in the
  tree; ~39 partially mock `auth/middleware`) become item E, a later package on its own branch after
  item C, per the coordinator's ruling — not undertaken here.

**Review.** The three "shallow" modules confirmed F1's method generalizes cleanly. `$lib/server/context`
did not: it's the one module in this set whose real implementation IS the app boot sequence, so
"spread the real module" — the exact fix that worked everywhere else — recursively demands every OTHER
module its own callers have their own reasons to stub. The right fix turned out to be narrower than F1's:
guarantee the export NAMES (so a route's static import always links, which is the actual bug), and let a
genuine behavioral gap fail loud and local instead of masquerading as every OTHER test's problem. The
residual pollution taught the same lesson twice over: completing an export LIST is not the same
guarantee as matching the real BEHAVIOR of an export that's already present, and the guard test that
catches the first kind cannot see the second — a narrower reimplementation with the right name sails
through silently until two files' tests happen to run in the same process and one needs the part the
other dropped.

### Item C — F2 (27 bare git-init tests) plus the leak-fix, offender conversions, workflow-run-persistence,
### L2, and GC5 (branch `wp/w18-hygiene-3`, from `integ/w00` `6cea43e67`)

Gates: `tasks/factory/w18-hygiene-GATES.md` (GC1 through GC10). Worktree:
`/home/dev/work/EZCorp/EZHarness/.worktrees/w18-hygiene-3`.

- [x] Git-init conversions: all 27 disclosed bare git-init test files (17 Group 1, 2 Group 2, 8 Group 3)
  converted to `scratch-git.ts`'s helpers; `gitInDirectory()` hardened in the SDK
  (`packages/@ezcorp/sdk/src/test/filesystem.ts`, new exported `isolatedGitEnv()`), with
  `scratchGitEnv()` delegating to it. Full poisoned-env proof. Committed (`d296f0b91`, `873c433a7`,
  `eaad4abee`).
- [x] `workflow-run-persistence.test.ts` flake: module-level fixed clock (`BOOT`/`NOW`), no wall-clock
  reads, duplicate describe-scoped constant removed. Committed (`a20ddb723`).
- [x] L2 hook fix: `scripts/lib/hook-lib.sh`'s `run_staged_tests()` count-miscounting and silent
  orchestrator-withholding both fixed; two new tests in `git-hooks.test.ts`. Committed (`e6ee00ad5`).
- [x] The two leak-fix route files (`extensions-patch-route.test.ts`,
  `extensions-delete-route-policy.test.ts`): fixed against both `phase-2b-e2e.test.ts` and
  `installer-idempotent-local.test.ts`, both orders, per GC9 — adopted W18c's alias-withdrawal pattern
  (relative-path-only mock for lifecycle-service/registry, claim-and-revert for
  `db/queries/extensions`) over this item's own superseded GC6 Proxy approach. F1 guard extended to
  reject partial `extension-lifecycle-service`/`registry` mocks repo-wide.
- [x] The six further offenders GC9's extended guard found, each converted as its own fix (GC10):
  `hub-render-pull.test.ts`, `phase-2b-e2e.test.ts`, `extension-events-hub-branch.test.ts`,
  `web/.../commit.test.ts`, `web/.../extensions-api.test.ts`, `web/.../extensions-events-route.test.ts`.
  `PENDING_ELSEWHERE` exemption removed entirely — zero offenders repo-wide, no by-name exemption
  list remains. A separate, pre-existing, out-of-scope (item E) `$server/auth/middleware`
  partial-mock collision between `extensions-api.test.ts` and `extensions-events-route.test.ts` was
  found and reported, not fixed here.
  EVIDENCE: typecheck, lint, gate-integrity, both boundary checks, full backend per-file-isolated pool,
  full web bun-leg pool (3630/0 across 194 files) all clean. Details in GATES.md GC10.
- [x] GC5 (production git wrappers): moved to item C2 (branch `wp/w18-hygiene-c2`, from item C's head)
  per the coordinator's re-sequencing — not on this branch. See `tasks/factory/w18-hygiene-GATES.md`
  GC11-15 on the C2 branch for the full write-up.
- [x] Validator-3 fix round on item C (medium F1, medium F2, lows L1-L3):
  - F1 (identity): all nine commits from `d296f0b91` through the cherry-picked gate-integrity flake fix
    were authored with a personal address copied from the worktree's inherited git config (the
    coordinator's own finding; never write that address itself — referred to here only by its config
    file path, `/home/dev/.config/git/local`). Fixed: set `git config --worktree user.name`/`user.email`
    explicitly to the project's noreply identity, then `git filter-branch --env-filter` over
    `6cea43e67..HEAD` to re-author all nine commits, verified by comparing each commit's tree hash
    before and after (identical for all nine) and `git log --format='%an <%ae> / %cn <%ce>'
    6cea43e67..HEAD` (noreply identity throughout, both author and committer).
  - F2 (GC5 disclosure incomplete): the fix itself and its corrected write-up are on the C2 branch,
    since that is where GC5's code now lives — see that branch's GATES.md entry for the four named
    wrapper sites, the poison recipe, and the matching counts.
  - L1: `src/__tests__/git-hooks.test.ts`'s existing "only orchestrator files staged" test gained an
    assertion that the line right after "skipping the 0 staged test file(s)" is the orchestrator line,
    not a blank/whitespace-only one — the `count -gt 0` guard around that `printf` was previously
    unpinned. Verified by removing the guard and confirming the new assertion fails with exactly a
    four-space blank line, then restoring it.
  - L2: `packages/@ezcorp/sdk/src/test/filesystem.ts`'s `gitInDirectory()` used to default `home` to a
    fresh `mkdtempSync(...)` per call and never remove it — one leaked directory under `os.tmpdir()`
    per caller that didn't supply its own `home`. Fixed to clean up only the directory it created
    itself (a caller-supplied `home` is left alone). New test in
    `packages/@ezcorp/sdk/test/filesystem-harness.test.ts`; verified by reverting the fix and confirming
    the test catches the leaked directory, then restoring it.
  - L3: the GC9 gates-doc entry's "353/0" citation for the 25-file-sample-plus-four-files run stated a
    pass/fail count with no separate load-error count, which is not the same claim as "nothing failed
    to link." Rewritten to require pass/fail/error counts together going forward, and replaced with a
    fresh 2026-09-27 re-run of the identical file set: 413 pass, 0 fail, 0 errors across 29 files,
    confirmed by grepping the run's full output for load-error signatures (none found). The originally-
    reported pre-existing `auth/middleware` collision did not reproduce in this specific re-run — noted
    as evidence multi-file `bun test` load order is not fully pinned by argument order, not as evidence
    the underlying bug is fixed (it isn't on this branch; C2 owns that fix).
  Re-authored head before this fix round's own commit: `a9f46fbb3`. Full details: `tasks/factory/w18-hygiene-GATES.md` (GC9 entry, updated).

### Item C2 (branch `wp/w18-hygiene-c2`, from item C's accepted head)

- [x] GC12: `$server/auth/middleware` added to the F1 walker's guarded modules; every partial mock
  converted (38 files, found via the real walker, not the 2 originally named); 10 of those also had a
  second, relative-path "dual-specifier" registration, fixed identically. Walker itself extended to
  recognize the beforeAll + precomputed-`serverModule()`-variable shape (a gap every prior TARGET had
  never exercised, since GC9's fix for extension-lifecycle-service/registry drops the alias entirely
  instead of keeping and completing it). Zero offenders, no exemption list. Files that mock ONLY a
  relative path (never the alias) are outside the walker's stated target and were not chased — reported,
  not expanded into.
- [x] GC13: `docs/extensions/examples/repo-activity-notify/index.ts` — the fourth weak-pattern instance
  found during GC5 — now delegates to `withoutGitContext()`. One pre-existing, unrelated test failure
  (`extension.test.ts`'s `ContractError`) confirmed present on the unmodified file, reported not fixed.
- [x] GC14: new repo-wide guard (`src/__tests__/git-spawn-context-guard.test.ts`) that every production
  `git` subprocess spawn goes through `withoutGitContext()`. Found and fixed 8 further real instances
  beyond the four named wrappers: six `scripts/*.ts` gate/coverage scripts, and
  `packages/@ezcorp/ai-kit/src/cli/install.ts`'s `gitProjectRoot()` (a third independent reimplementation
  of the same GIT_*-strip filter, now delegating to the canonical helper via ai-kit's already-declared
  `@ezcorp/sdk` peer dependency). Guard-with-control: reverted one fix, confirmed the guard fails
  naming the exact offender, restored it.
- [x] GC15: validator-3 found the regression GC14's first draft introduced — the six gate/coverage
  scripts needed the invoking git context KEPT (a pre-commit hook's staged view, a checkout's own
  state), not stripped; converting them to `withoutGitContext()` broke ten tests. Fixed with a second
  named class, `currentRepositoryGitContext()`, and reverted all six to it; three of them also needed a
  local, non-imported copy of that function since they're each copied into a bare, `node_modules`-free
  test fixture where a workspace-package import cannot resolve (found while fixing the first issue).
  All ten originally-regressed tests green, plus the visual-evidence suite (broken the same way, not
  previously reported) and the extended guard itself.
  Full details, evidence, the poison recipe and matching counts for GC5's corrected four-site
  disclosure (validator-3's other finding, folded into GC11 above): `tasks/factory/w18-hygiene-GATES.md`
  GC11 (correction), GC12-15.

## W12d — reproducible data image build (branch `wp/w12d-reproducible-image`)

Base `wp/w12c-data-image-repin` `7821e5d7c`, merged with `integ/w00` `2b2e12550`. Receipts:
`/tmp/factory-platform-evidence/w12d/`. Gates: `tasks/factory/w12d-GATES.md`.

- [x] Find the cause: the import check wrote `.pyc` files that differ between builds; the timestamp was also unfixed.
- [x] Fix: no bytecode in the build step; `--no-cache --timestamp 0 --identity-label=false`; the script checks the pin and fails without `--repin`.
- [x] A failed check removes only its candidate tag; the pinned image is never touched (control cases A and B).
- [x] Binding proof: a rebuild after removal gives the pin (build 3, clean at `55f58739f`).
- [x] Guest unit, three Podman guest suites, boundary and closure suites, static gates, coverage gates at `0c62f68e8`.

**Review.** Two clean builds differed only in eight `.pyc` files that the import check wrote. With
bytecode off, every timestamp fixed and no build cache, the build reproduces the pin on this host's
Podman version. Other Podman versions are not proven. The script now refuses a pin it does not
reproduce and removes what it built. A deliberate change needs `--repin`.
## W19b — the graph proof keeps a failed pass's diagnostics (branch `wp/w19b-harness-logs`)

Gates: `tasks/factory/w19b-GATES.md`. Receipts: `/tmp/factory-platform-evidence/w19b/`.

- [x] Stream the pool, supervisor, Temporal, TLS terminator, gateway stub, web and orchestrator logs to the pass output directory.
- [x] On a failed pass, copy the stack's readiness files and logs out before the stack is deleted; never copy `secrets/`.
- [x] Scan before copy and redact streamed logs; record refusals and redactions.
- [x] Forced-failure control in mock mode, with `verify-diagnostics.ts`, in `run.sh all` and the summary.
- [x] Runbook says where the files are.

### Review

A failed pass now leaves every process's own output and the pool's and supervisor's readiness files,
and nothing it leaves carries a credential. The first campaign showed that treating every string in a
configuration document as a secret refuses exactly the files a reader needs; only credentials are
secrets now. The proof itself is unchanged: both modes passed three of three, and every control passed.

### Fix round (validator-3's three low notes)

- [x] L1: the secret rule fails closed. Every string in a JSON file under `secrets/` is a secret except
  the values of `CONFIGURATION_KEYS`. The stack's documents come from `stack-documents.ts`, and a test
  classifies every string leaf of every one, so a new field fails until it is classified.
- [x] L2: a binary file under `secrets/` yields its hex and base64 forms; each form planted in a stack
  file is refused and redacted.
- [x] L3: streamed logs are redacted every 2 seconds while the pass runs, not only at the end; the
  runbook states the window left when the harness itself dies.
- [x] Heavy leg: the mock forced-failure control alone, under the lock, timeout 1800.

### Second fix round (validator-3's F1 to F3)

- [x] F1: the inline-document guard reads each `privateWrite(...)` call whole, marks anything but a named builder `"inline"`, compares with `toStrictEqual`, and is tested on fixtures, one line and split.
- [x] F2: `receipt.sh` names every log and receipt per attempt; the first heavy attempt's receipt points at its preserved log and says the original was overwritten.
- [x] F3: a URL's password is collected from every JSON string, whatever its key.
## W16b — tenant-keyed guest-broker routes (branch `wp/w16b-guest-brokers-keyed`)

Coordinator ruling 2026-09-25 (option A). Gate file `tasks/factory/w16b-GATES.md`,
evidence `/tmp/factory-platform-evidence/w16b/`.

- [x] services.guestBroker becomes services.guestBrokers (tenant to endpoint); the parser refuses the old form and malformed maps.
- [x] The host picks the attempt's own tenant's route; an unknown tenant is refused by name before any byte leaves the host.
- [x] Producers updated: supervisor tests, W01g transport suite, W19a graph-proof stack.
- [x] Hold b1 at 61bc3428b: every leg exit 0.
- [x] W01 owner review (w01g-fix) at 61bc3428b; the audience change sent for the same review.
- [x] The route accepts only the contract's audience; a pool token is refused by name (ca92306c5). Hold b2 at fb3a990ee: every leg exit 0.
- [x] Validation (validator-2), then merge before W16 and W01h. Landed: merge `a7962f8e0` (before W01h `a8b467b2c` and W16 `bc22c62b0`); verdict `docs/validation/factory/wave4/w16b-validation.txt`.

### Review

A fleet host serves every installation, so it now holds one guest-broker route
per tenant and forwards each guest frame only to its own attempt's tenant.
There is no fallback: an unknown tenant is refused by name. The lease carries
no tenant, so the tenant comes from the launch intent, and the chosen route's
attempt-token check still stops a launch that names the wrong tenant.

## W03e — settle a stopped attempt that has no usage operations (branch `wp/w03e-usage-settle`)

Base `integ/w00` `39a7189e0`. Receipts: `/tmp/factory-platform-evidence/w03e/`. Gates: `tasks/factory/w03e-GATES.md`.

- [x] Reproduce on the real application with W02c's harness: a stopped attempt with no operations stays `cancelling` (fence stop and operator cancel).
- [x] Root fix: a signed stop of an attempt whose journal is empty settles a typed `no-operations` zero in the stop transaction, with one `usage-settled` event and a settled budget; any journaled operation keeps the uncertain-hold path.
- [x] A certain stop after a durable `stop-uncertain` event carries `uncertain: false`, so the kernel folds it.
- [x] Migration `add-factory-usage-no-operations` (source, `stop_receipt_digest`, exact-shape CHECKs), schema mirror, restart case, threshold.
- [x] Tests: success with a kernel fold to `cancelled`, journaled operation stays uncertain, concurrent stops, lost receipt, crash and restart, stale epoch, cross-tenant denial, corrupt certainty; each fails on the unfixed store.
- [x] Real-application proof: run A (fence) and run O (operator cancel) reach a settled terminal, three passes.
- [x] Sweep after `git merge --no-edit integ/w00`: typecheck, lint, boundaries, gate integrity, PostgreSQL producers, backend pool, both coverage gates.
- [x] Gate file, report, review paragraph.

- [x] Rulings (lead, 2026-09-24): (1) a no-operations stop settles compute at its reserved bound, the bound the tenant accepted at admission, and the settlement record names the basis "no-operations: compute at reserved bound" (`7ad032681`); (2) packages do not edit freeze section 4, so the additive change is a dated disclosure in `tasks/factory/w03e-GATES.md` for W20 to fold into the plan; (3) the W02c conflict resolution in the report is for the integrator, who merges W03e after W02c; (4) stops sealed by pre-W03e code stay readable with no back-fill (`33ef581f2`).
- [x] Interface-freeze disclosure (2026-09-24), freeze section 4: `FactoryUsageSettlementSource` gains `"no-operations"`; `FactoryUsageSettlement` gains `stopReceiptDigest` and `basis` (both present exactly on `no-operations`); `factory_usage_settlements` gains `stop_receipt_digest` and `basis`; a certain stop after `stop-uncertain` carries `uncertain: false`. Consumer: W14's cost views.
- [x] Follow-up package (owner: the run kernel's owner, W05/W09): a run whose uncertain operation is later settled by reconciliation stays `cancelling`, because `FactoryUsageReconciliation.reconcile` records the settlement and the budget but never tells the kernel the attempt is no longer uncertain. Exact change: after `reconcile` records a reconciliation settlement for a reservation, enqueue in the same transaction the sealed stop's `attempt-stopped` event with `uncertain: false` (id `${cancelCommandId}:usage-resolved`, the stop's node, attempt command, candidate generation and attempt number, read through `readSettlementScopeInTransaction`); let the stop store's re-derivation accept it; prove it with a stop suite case that folds the events through the real kernel to `cancelled`, and a real run whose model call is lost and later reconciled. Done by W05b (reconciliation clears the kernel's uncertain attempt), merge `37511b1ac`.
- [ ] Disclosed gap (owner: W03): a reservation whose reserved cost is zero is never listed by `listUncertainWithCostInTransaction`, so it can never be reconciled.

**Review.** An attempt stopped before its first operation stayed `cancelling` forever. The stop saw no terminal usage and held the budget as uncertain, and reconciliation refused the hold with `no-operation-receipt`, because there was nothing to reconcile. The base run at W02c's head showed this for the package fence's run A and an operator-cancelled run O. C02 journals every operation before its effect, and an accepted cancel can prepare no more, so an empty journal after a signed stop proves zero provider cost. The stop now settles that zero in its own transaction as a typed `no-operations` settlement bound to the stop receipt, with one `usage-settled` event. Compute is charged at its reserved bound because nothing measured it. A second defect sat under it: the kernel only clears an uncertain attempt when a later stop says `uncertain: false`, which nothing emitted. The real stops went through exactly that path. Three passes at the merged head bring both runs to `cancelled`, run A with its typed reason, and the pool, PostgreSQL, coverage and complexity gates are green. Open: a hold that reconciliation later resolves from a provider receipt still never clears the kernel's uncertainty.

## W05b — a reconciled hold lets the cancelled run end (branch `wp/w05b-reconcile-clear`)

Base `wp/w03e-usage-settle` `c6dbc321c`. Receipts: `/tmp/factory-platform-evidence/w05b/`. Gates: `tasks/factory/w05b-GATES.md`.

- [x] Reproduce on the real application with W03e's harness: run U (one uncertain operation, cancelled, reconciled) stays `cancelling` at base.
- [x] Tests red at base, green at head, including the reverse order (reconciliation before the stop confirms).
- [x] Fix: reconciliation clears the kernel's uncertain attempt through the sealed stop, exactly once; an unconfirmed stop or an unknown usage is not cleared; a stop confirmed after reconciliation settles as certain.
- [x] Kernel replay test; `kernel.ts` unchanged.
- [x] Real-server proof, three passes, both orders; sweep; gate file; report.
- [x] Validator-3 L1 delta: `clearResolvedStopInTransaction` is a required member; the doubles implement it; a composition test proves the production wiring; a race test proves one clearing event (G6).

**Review.** Reconciliation settled the cost but never told the kernel. The kernel kept the attempt
stopped-and-uncertain, so a cancelled run never ended. The fix sends the sealed stop's event again with
`uncertain: false`, from the reconciliation's own transaction, and only when the physical stop is
confirmed. The real server then showed the reverse order, and it was not rare: reconciliation settled
first, and the confirming stop failed stale. That stop now treats the settled cost as certain and clears
the uncertainty itself. Either way the kernel is cleared exactly once, and the run ends `cancelled` with
its reason.

## W03f — a typed provider error settles, so the run ends failed with its reason (branch `wp/w03f-provider-settle`)

Base `integ/w00` `d2bc674c7`. Gates: `tasks/factory/w03f-GATES.md`. Receipts: `/tmp/factory-platform-evidence/w03f/`.

- [x] M1: say which path W14's quarantine-under-live-attempt hold takes on this base (W03e no-operations stop, or a W02 dispatch refusal with a held lease), from a run on this base.
- [x] SDK: `provider_auth_failed` and `provider_rate_limited` beside `provider_unavailable`; the refused response may carry the settled `operation`; generated schema and Python validator follow.
- [x] Provider: an error answer becomes a typed failure carrying the measured usage from the provider's message; an unclassifiable error maps to `provider_unavailable`.
- [x] Broker and journal: the failed operation carries the typed code and measured usage; the refusal carries that operation verbatim.
- [x] Stop: for a non-completed outcome, settle from the journal. Zero operations keeps W03e's rule; all operations terminal with measured usage settles the measured model usage with compute at the reserved bound and a named basis; anything else keeps the hold.
- [x] Migration: widen the settlement source and basis CHECKs; schema test for the widened values; PostgreSQL parity.
- [x] Lifecycle cases per error class (unavailable, pin mismatch, auth, rate limit), each with a negative control on today's behaviour; partial consumption settles the measured usage, never zero.
- [x] Graph proof: the guest mirrors the refusal's operation; `control-missing-model` ends failed; runbook and summary criteria follow; eb7b8b8c5's guest-claimed zero recorded as superseded. — closed: W03f landed, merge `ee9117e0a` (todo.md:5554) (audit 2026-10-03).
- [x] Coverage, boundaries, static checks, gates against `d2bc674c7`; receipts at the M1 standard. — closed: W03f landed, merge `ee9117e0a` (todo.md:5554) (audit 2026-10-03).
- [x] Finding (a): the kernel does not retry `provider_auth_failed`; red first (`retry-red.attempt-1`).
- [x] Finding (b): a hold names its unsettled operations; a late answer after a cancel parks its evidence for reconciliation; red first (`hold-red.attempt-1/2`).
- [x] Condition: a guest that rebuilds or alters the settled operation is refused by the journal.

## W14b — graph-proof guest package derives its SDK module closure (branch `wp/w14b-guest-closure`)

Base integ/w00 `146a94829`. Gate file: `tasks/factory/w14b-GATES.md`. Evidence: `/tmp/factory-platform-evidence/w14b/`.

- [x] Reproduce through the runbook's mock pass under the lock: the guest build fails with TS2307 on `./console-types.ts`.
- [x] Root fix: one shared helper (`src/factory/guest-sdk-closure.ts`) derives the SDK files from the guest's own imports; the graph guest, the W14 lane guest and the reference-code validator guest all use it; the fixed module and schema lists are gone.
- [x] Second site: the reference-code guest's four failing tests (`guest.test.ts` 3, `pack.test.ts` 1) are green.
- [x] Structural guard: every packager that copies SDK sources must use the helper or be a named schemas-only Python packager.
- [x] Guard tests, red on the base package, green at the head; they run in the CI pool.
- [x] Runbook mock pass at the head under the lock; graph-proof suites; builds; typecheck, lint, boundaries, gate integrity.

Review (W14b): the graph guest listed its SDK modules by hand, so the first new module an SDK file imported broke every build of it. The package now stages exactly what its own files reach, found by following imports, and a missing module is refused by name. The guard compares every staged import against the staged files, for both guests on the real SDK.
## W09f: run-projection prepared-statement mismatch (branch `wp/w09f-run-projection`)

Base `integ/w00` `b10b7ea1a`. Receipts: `/tmp/factory-platform-evidence/w09f/`. Gates: `tasks/factory/w09f-GATES.md`.

- [x] Reproduce on real PostgreSQL with product queries. Bun 1.3.14 stalls and contaminates transactions; Bun 1.4.2 is clean.
- [x] The role's report names the database error (`ef9ba50f5`).
- [x] A desynchronized pool is replaced under the live Drizzle handle (`c4a5cc1f0`, `488b51458`).
- [x] Fix the poisoned PGlite snapshot cache found by the sweep (`af673760e`).
- [x] Final sweep green at `af673760e`.
- [x] The Bun upgrade and its regression suite: W12e, pending the user's decision. The user decided "upgrade it" (2026-09-28); W12e landed: merge `e6cdcf02a`, receipts `0a6b3ef06`.

**Review.** The run-projection error came from Bun 1.3.14's Postgres request queue, not from our
queries: one query's Bind reached another query's statement on the same connection. The same component
stalls and mixes transactions on this host, with our own queries, and Bun 1.4.2 is clean. Until the
upgrade, the process names the database error in its logs and replaces a desynchronized pool instead of
retrying on it.


## W01h — runner_outcome_unknown leaves a run stuck (branch `wp/w01h-runner-outcome`)

Gate file `tasks/factory/w01h-GATES.md`; evidence `/tmp/factory-platform-evidence/w01h/`.

- [x] Reproduce first: unit reproduction of three mechanisms on the base; the incident reproduced on W19a's harness (`proof/w01h-base-fault`)
- [x] Transport settles under Bun (deadline, abort, early close, oversize) — `1812495b6`
- [x] Host keeps answers until collected, typed refusals, every refusal in the supervisor log — `760cf1810`
- [x] Every lost answer ends in a typed failed terminal row; dispatcher keeps the cause — `4cd3f76b4`, `41b1d8a02`
- [x] Kernel retries or fails the run on the typed failure (lifecycle case) and the Podman fault-injection case — `4dbe4a1b2`
- [x] W19a runbook green with the fix (`proof/w01h-fix-w19a`)
- [x] The incident path itself (guest dies AT its 30 s attempt deadline) ends the run — blocked on a coordinator ruling (C02 fence refuses any report after the deadline; patch proposed). Ruled into W01h as defect 3 (`0d7c01694`) and option 2 (`a00430bb5`, `961059571`); landed with W01h, merge `a8b467b2c`, receipts `326e5e725` (`tasks/factory/w01h-GATES.md`).
- [x] Run-deadline stop refused `factory_command_stale` (kernel epoch moves, durable fence does not) — reported, owner ruling pending. Ruled into W01h as defect 2 (`982f9cb6d`); landed with W01h, merge `a8b467b2c`.

### Review

The run hung because nothing ever wrote what happened to an attempt whose guest answer was lost: the host dropped
the answer, the product swallowed the error, and the kernel heard nothing until its own 10-minute deadline, whose
stop was then refused as stale. W01h makes every lost answer a durable, typed failure the kernel acts on, and gives
both processes a log line that names it. Two causes remain outside this package: the 30 s sealed attempt deadline
(pool lease, never renewed by the remote runtime), after which C02 refuses any report, and the run-deadline epoch.

## W09e follow-ups (recorded by name, not in W09e)

- [ ] **release spend into the budget ledger**: a ledger entry kind for releases, so a release reserves its signed
      estimated spend at claim and a stopped one settles through the usage settlement (coordinator ruling, W09e
      cost). Until then a stopped release's cost lives on its stop outcome (`stop_cost_micros`, `stop_cost_source`,
      `stop_cost_basis`) and the run inspection adds it to the run's figures.
- [x] **Bun 1.4.2 preview-server crash (for the W12e upgrade decision)**: under the system Bun 1.4.2 the vite preview
      died with ERR_STREAM_WRITE_AFTER_END in node:_http_server advanceResponsePipeline in 2 of 4 repeat runs of
      factory-live-console.spec.ts; under the pin 1.3.14 it did not reproduce (66 of 66). Evidence:
      /tmp/factory-platform-evidence/w09e/logs/head/e2e-repeat3.log, e2e-measure-fe2199392-bun142.log, e2e-measure.log.
      Done: W12e G2 reproduced it (oven-sh/bun#40350) and worked around it in vite preview, red first; landed with W12e (`e6cdcf02a`).

## W02d — the GPU lease consumer (branch `wp/w02d-gpu-lease`; gates `tasks/factory/w02d-GATES.md`)

- [x] R1 startup refuses a runner profile whose gpu-host is not one whole host (a2b7b408d).
- [x] R2 the pool grants a GPU host only with its registered profile; the lease carries the profile (d8a20ba03).
- [x] R3 the dispatch preflight grants a held GPU lease its recorded devices, or refuses it by name (4f347dc14).
- [x] R4 the host refuses a granted device it lacks before any container (0f8bdd8c1); the refused worker is first-hand
      absent, so its stop is signed (4d95d9158).
- [x] R5 a GPU lease renews through W01h's loop unchanged (d7b3ae94b).
- [x] R6 measured red (P2); one fenced renewal at claim (e970fe1e9, b2de395af); a reclaimed lease ends the attempt
      failed by name (6cab80e44).
- [x] R7 a supervisor-confirmed GPU stop confirms and settles; the host stays held for its reimage (3428eba36).
- [x] R7b a trusted-local host is reused by its one bound tenant without a reimage (2a3b7c215).
- [x] Host tombstone (ruling (A)): a never-seen worker is tombstoned, signed absent and refused (f01dc399c); restart
      (a0c96ae8c); negative controls (8d3ed5eb5); retention 31 days, proposed with its reason in the gates file.
- [x] R8 the refused dispatch releases its lease and hold on W09h's basis (26951f125, from 92bdc1f22).
- [x] R9 a class the pool cannot serve fails its run by name and releases the unused hold (1f7d56010); on W09h's
      basis (31bee42a9).
- [x] Merge of integ/w00 e92d34d45 (bfa01a41a) with all 74 withheld suites green.
- [x] Merge of integ/w00 ad22592da (7a499e4e1) with all 89 withheld suites green.
- [x] Merge of integ/w00 e0e2a23c9 (9c11cea96, committed by the user) with all 14 withheld suites green.
- [x] task-stops.ts attestation re-proved at the merge (3fd496578, line 336).
- [x] The authoritative two-stage head run (P1, P5, P2 with the post-R8 expectation) at the final head. w16-2's authoritative run at `069cb8c2b` (P1 5/5 x4, P5 4/4 x4, P2 9/9 x4), receipts verified by validator-6; carried to `edc8a93d7` under the carry-over ruling.
- [x] Coverage gates at the final head. At the merge commit `381449a85` (`docs/validation/factory/wave4/w02d-merge.json`).
- [x] Landed: merge `381449a85` (wp/w02d-gpu-lease `edc8a93d7`), receipts `0c66519a0`; validator-6 REJECT at `069cb8c2b`, then ACCEPT at `edc8a93d7`. Owner after W16: w16-2.
- [ ] Follow-up (W02d R6, owner W02d, not this wave): a 30 s GPU lease against a queue wait that can exceed it (P2 measured 45 s) ends in the named failure `lease_revoked`; a queued attempt should re-admit at claim instead.
- [ ] Follow-up (coordinator ruling): the stop settlement role retries `factory_task_stop_pool_mismatch` on every pass with no bound (1912 and 1929 retries in the two P2 passes); it needs a bounded back-off.

### Review

The base reproductions were red as briefed. The head runs found two defects the unit suites had not: a worker the
host refused before creating it could never be stopped (R4), and a lease reclaimed before claim left the attempt
"outcome unknown" (R6). Both are fixed red-first, and three harness defects the runs exposed (a hidden refusal, a
port collision, a crashing comparison) are fixed in W19a's harness with tests. The re-judged interim verdicts hold
for P1, P2 (pre-R8) and P5; the evidence of record is one run at the final head after R8. R8 needed a host that can
sign a never-seen worker's absence, so the host now tombstones it (ruling (A)). Open: the attestation refresh, the
head run, and R6's release basis. P3 is not run live: the user decided (b).

## W09h — a stop during compute admission settles in place (branch `wp/w09h-admission-stop`)

Gate file `tasks/factory/w09h-GATES.md`; evidence `/tmp/factory-platform-evidence/w09h/`.

- [x] R1 reproduce first: a cancel while a node waits for admission leaves the run `stopping` and the hold `held` (real PostgreSQL, red on `a24a619ad` and `ef0868738`)
- [x] R2 the stop settles the reserved attempt in place, records the stop on the admission row, kernel `stoppedBefore: "admission"`; the old pin replaced red first — `b109144fa`
- [x] R3 a late grant is refused `factory_compute_admission_attempt_stopped` and released through the worker's authority-loss cancel — `6350b62b3`
- [x] R4 the hold settles all zero under "no-operations: nothing launched, all zero" (additive CHECK migration, clause-removed test) — `bbf02876a`, corrected by `5d6d398f9`
- [x] R5 lock order: both contenders take the run lock before the admission row, both orders on real PostgreSQL — `f70c06fbe`
- [x] Legs, coverage gates and the graph-proof runbook at the `wp/w09h-admission-stop` head `ef3f64457` (rebased onto `e92d34d45`); validator-5 M1 fixed in `ef3f64457`
- [x] W02d follow-up (not in W09h): R8 and R9 moved to the shared basis (26951f125, 31bee42a9); the queued-host case is not rerun (P3 not run under the user's decision (b); P5 has no GPU host)
- [x] Landed: merge `08ad04148` (wp/w09h-admission-stop `3d2d03cc8`). Owner: w09h-2 (replacement, 2026-09-28).

### Review

A run cancelled while a node waited for compute admission never ended: the cancel named the request-admission
command, the task stop found no queued attempt and refused it stale. W09h settles that attempt in the stop's own
transaction (no claim, no capacity), records the stop on the admission row, releases the unused hold at zero under a
true basis, and refuses a late grant by name. The first R4 form charged compute at the reserved bound, a false basis
for an attempt that never ran; it is corrected, not amended, so the reported SHAs stay valid.
## W12e — Bun 1.4.2 upgrade (w12e-2, 2026-09-28)

Gates: tasks/factory/w12e-GATES.md. Evidence: /tmp/factory-platform-evidence/w12e-2/.

- [x] Re-apply 2aa24b5b3 on the current integ head; resolve the two config conflicts (workflow, moved compose file).
- [x] Update every pin consumer the first commit missed (G5), and fix the pinned-bun helper's zsh defect red-first (F1).
- [x] G1 acceptance red on 1.3.14, green on 1.4.2. Red on 1.3.14 at `d503d22c8`; green on 1.4.2 in the product's configuration (flag at start).
- [x] G2 the 1.4.2 preview-server crash reproduced (oven-sh/bun#40350) and worked around in vite preview, red first.
- [x] G3 the full runner and the browser set green under 1.4.2. wave4f at `baeade976`: runner 37 legs, browser lanes all green; receipts `700e54461`.
- [x] G4 the task-stops.ts attestation re-proved under 1.4.2 (DA 336 = 0 on both engines; throw 37/52) and refreshed.
- [x] Rebased onto integ 0c66519a0 after W02d landed (journal conflicts only, kept both sides).
- [x] Four Bun 1.4.2 behaviour changes fixed red-first: the pinned fetch TLS name, IP server names, the settle test's
      runtime-leak assertion, and the Bun.SQL pipelining defect (a fail-closed guard; flag at process start).
- [x] G1 green in the product's configuration at the final head. wave4f `postgres-bun-sql-request-queue` leg exit 0 at `baeade976` (flag=1).
- [x] G3 at the final head: the full backend pool under 1.4.2 (wave4f machinery) and the browser lanes. wave4f at `baeade976`, receipts `700e54461`.
- [x] Landed: merge `e6cdcf02a` (wp/w12e-scratch `4d0c708c5`), receipts `0a6b3ef06`; validator-6 ACCEPT at `8676d8757` and `4d0c708c5` (delta). Merge run 1 at `db5b53012` was red on the patch leg (two producer gaps) and never published.
- [ ] Follow-up (owner: the runtime pin's owner): remove the Bun.SQL pipelining guard, its version list and every flag setting at the first Bun release carrying oven-sh/bun#32088 and #43187, with a 3000-trial harness record under docs/validation/factory/ (the guard's test refuses an unlisted version without one).

Review: Bun 1.4.2 landed last, after the user's decision. Nine behaviour changes are recorded in tasks/factory/w12e-GATES.md; the Postgres
client mix-up is mitigated by a fail-closed startup guard. The wave's final run (wave4f) is green on 1.4.2.

## W4F-1 and W4F-2 (landing records)

- [x] W4F-1: merge `c46a1d10e` (wp/w4f-1-w12e-coverage `5576263ae`), receipts `ffe6ea507`: the preview guard's vitest coverage; the task-stops.ts attestation entry removed under w00/w4f-merge/gate-change-decision.txt.
- [x] W4F-2: merge `9fe4056f0` (wp/w4f-2-crap-provisioning-kernel `b6aa5204f`), receipts `79791f76c`: four splits, CRAP max 12.

## W4F-3 — CRAP splits for settlement and inbox-event validation (branch `wp/w4f-3-crap-settlement-validation`; gates `tasks/factory/w4f-GATES.md`)

- [x] Red recorded: buildFactoryUsageSettlement 39, validateInboxEvent 35 (w12e-fix-final/crap-changed-origin_main.log).
- [x] Split buildFactoryUsageSettlement into field, proof and amount/basis guards plus a seal helper (b9a711809).
- [x] Split validateInboxEvent into attempt-stopped, run-control and replan-replacement helpers (bdc9484b6).
- [x] Every function in both files <= 13 at 100% coverage; suites, patch gate, boundaries, typecheck, lint green at the rebased head.
- [x] Landed: merge `ca4027e2a` (`6d8151b4e`), receipts `1957da56d`, verdict addendum `baeade976`. wave4f ran at `baeade976`: every final gate green, crap-changed vs origin/main "no touched function exceeds CRAP 30" (receipts `700e54461`).

Review: both functions were long guard chains, so each split moves ordered guards into named helpers without changing any check,
order, error code or message. The existing suites cover every changed line, so no test was added or changed. Receipts:
/tmp/factory-platform-evidence/w4f/w4f-3/report.txt.

## W-SYNC — origin/main into integ/w00 (landing record)

- [x] Landed: merge `787f8676c` (origin/main `31052930d` into integ/w00 `6fe920150`; owner w-sync; committed by the user by hand
      under the hook ruling), validator-6 ACCEPT; published by compare-and-swap 2026-10-01 17:57Z; gates doc `19dbd60fd`
      (tasks/factory/w-sync-GATES.md only, fast-forward).
- [x] wave4g at `19dbd60fd`: runner 38 legs, after-runner and browser lanes green, every final gate green, gate-integrity vs
      origin/main equal to the 8-line expected set; receipts `2fd05e200`. The patch-base ruling's carve-out
      (w00/w-sync-merge/ruling-patch-base-after-sync.txt) and the check-web-vitest-coverage.ts decision
      (w00/w-sync-merge/gate-change-decision.txt) were both unused.
- [x] PR #318 reads BLOCKED and MERGEABLE at `2fd05e200` (it was DIRTY before the sync).
- [x] Post-merge main syncs (W-SYNC-4 and W-SYNC-5): origin/main 6eb1bbb33 (the PR 318 merge) merged at 94b17348f (0 files, ancestry only; main leg 0
      findings under the new binding; receipts 25a22ac3f); origin/main 6ffd88784 (Pi 0.99.2 #333 and the four web bumps #335) merged at f430182c8
      (the 4 manifest and lock files equal main's blobs; root and web frozen installs; hold status 0: lockfiles byte-identical after the installs, Pi 0.99.2 installed, 9 manifest and Pi suites, typecheck and svelte-check 0, deps-audit clean, the whole web vitest pool 7952/7952, guard 516/0, main leg 0 findings; receipts bfce8cd5d).

## Wave 4 close (2026-10-01): follow-ups and standing user items

wave4f ran at `baeade976` (receipts `700e54461`): runner 37 legs, after-runner green (guard set 60/0, graph mock pass,
W09e console spec 22 passed, W03f journey 11/0), browser lanes green, final gates green (global floor margin 8.05,
per-file thresholds 2191 files, new-file and patch on origin/main and c1377122b, CRAP changed vs origin/main clean).
gate-integrity vs origin/main equals the 8-line expected set.

- [x] The 138 web files covered only by the browser lanes: judged by wave4f's final gates with the browser producer;
      per-file thresholds PASS.
- [ ] Hygiene: `.gitignore` line 8 ignores `tasks` while the files under tasks/ are tracked, so every package force-adds
      its GATES.md and todo.md changes. Replace the blanket rule with explicit exceptions so `git add` needs no -f.
- [ ] Nit (validator-6, W4F-2): control-plane.ts's handler doc comment now sits above the new type alias; move it the
      next time the file changes.
- [ ] Upstream reports to consider (the user's call): TLS socket.end() half-closes on Bun 1.4 (#31155); terminate()
      sends RST without close_notify (#39632); the Postgres response mix-up (#32088/#43187, fixed after 1.4.2, no
      release yet).
- [ ] The wave4f driver prints the pin and runtime flag in its own log (its receipts cite the pin from the after-runner
      log and the pin helper's assertion).
- [ ] build-pi-agent.ts: add a test that drives the factory branch (`factoryRuntime ? resolved.piModel : …`) with an OAuth or keyless host
      credential and asserts the gateway-approved model is kept verbatim. validator-6's mutant that disabled the branch survived the
      plain-key integration suite (w-sync-validation/verdict-validator-6-wsync.txt). Gap dates from wave commit 190ad3afa; not a merge defect.

Standing user items (decisions only the user makes):

- [ ] Disk: the dangling podman images (still present at 2026-10-01 01:30Z) and `reclaim-worktrees.sh`.
- [ ] Branches and worktrees after landing: wp/w02d-gpu-lease, wp/w12e-scratch, wp/w4f-1/2/3 (the receipts cite proof
      refs, so they stay until the user decides); 99 dirty worktrees kept (w00/worktree-kept-dirty-2026-10-01.txt).
- [ ] PR labels, including `gate-change-approved` for the wave's coverage-tool changes.
- [ ] Reference-data image publication.
- [ ] The personal email in a git config.
- [ ] Coordinator kill permission.
- [ ] PostgreSQL password rotation.
- [ ] Host-side protection (`OOMScoreAdjust`) and the store load rerun (W15d items above).
- [x] W03f option A or hold: W03f landed (merge `ee9117e0a`); the decision is no longer open.

## W4G-1 — container files put every frozen-install input on disk (branch `wp/w4g-1`; gates `tasks/factory/w4g-1-GATES.md`)

- [x] Red with podman at 842ad9fe1: builder, full, dev and test images fail at the root frozen install (hosted message).
- [x] Fix: the three missing workspace manifests and web/patches copied before every frozen install (94d23c2a7).
- [x] Guard test scripts/container-workspace-registration.test.ts derives the inputs from bun.lock and package.json; red at 842ad9fe1.
- [x] Green: full, dev and test images built to the end with digests; dev provenance check; boot health 200; podman leg 4/4 suites.

Review: the wave added three workspaces and a web patch file, and no container file followed. The guard now reads the lock and the
manifest, so the next added workspace or patch fails a fast unit test, not a hosted image job. Receipts:
/tmp/factory-platform-evidence/w4g-1/report.txt.

## W4H-1 — the bundled ai-kit bootstrap verifies inside the production image (branch `wp/w4h-1`; gates `tasks/factory/w4h-1-GATES.md`)

- [x] Red from a clean `git archive` image of 52d8ba079: ai-kit's isolated build fails "Executable not found in $PATH: git"; the runner image has no git.
- [x] Fix: the ai-kit installer uses the SDK's `findProjectRoot` walk; the tests build their repository with `markGitRepository` (2f2d689d7).
- [x] Red-first test: the install works with only bun on PATH (fails on the old installer with the hosted ENOENT).
- [x] The bundled bootstrap verifies 28/28 builds, ai-kit included (delivery and runtime proofs, exit 0).
- [ ] runtime-resources: three local tries timed out at the 6-minute bootstrap deadline under host load (no failed build); the hosted rerun proves it.

Review: the cause was a host tool, not a missing `.git`. The installer and its test both ran git, and the pinned Bun runner image
ships none. The installer now reads the filesystem through the SDK's one repository rule, so it needs no git anywhere. Receipts:
/tmp/factory-platform-evidence/w4h-1/report.txt.

## W4H-9 — the extension runner stays compatible with pre-attach hosts (branch `wp/w4h-9`; gates `tasks/factory/w4h-9-GATES.md`)

- [x] Red first: a host that never attaches gets unknown_worker; the frozen 3ec53eaa RunnerClient loses its worker; it answers one reverse call 6 times.
- [x] Fix 1 (0498c0a52): the host that starts a worker owns it (an unclaimed start claim; attach stays required after a release).
- [x] Fix 2 (02c53fb7a): each reverse call reaches an attachment once; a release hands every unanswered call to the next holder.
- [x] Green: 14/14 detach, 45/0 unit, 31/0 podman integration, the E2E upgrade (semantic only) exit 0.
- [ ] The full historical-upgrade lane locally: starved by host load; the hosted recovery proof is its proof of record.

Review: 11b9f72b9 changed the runner protocol twice in ways only an older host notices, and the old app hides every runner error as
operation_failed. A request log in a scratch copy named each break in turn. Receipts: /tmp/factory-platform-evidence/w4h-9/report.txt.

## W4G — hosted CI pre-flight packages (landing records)

- [x] First hosted CI run of the branch (2fd05e200) failed 14 jobs, the second (842ad9fe1) 26; eleven wave-side causes hidden by the local host.
      Packages W4G-1..11; the private-files rule change (option A) was the user's decision on 2026-10-01: a root-owned sticky ancestor (/tmp) is
      accepted; tests build private trees under a 0700 mkdtemp in os.tmpdir(), never $HOME.
- [x] W4G-2 553cbe633 / W4G-3 7e2752288 / W4G-6 218b98f09 / W4G-5 01328c1ab / W4G-7 57453bb5e / W4G-9 0f9f538c8 / W4G-8 9e5065ebf /
      W4G-11 bb581dfe5 / W4G-10 1476bf463 / W4G-1 4ae2f1658 / W4G-4 0293a32eb / W4G-12 ef05b446b / W4G-13 8c7f7bc00 / W4G-14 a3964cfb6;
      gate files tasks/factory/w4g-<n>-GATES.md; verdicts under docs/validation/factory/wave4/ (prefix w4g-<n>-merge). The private-files rule
      change (option A) was the user's decision on 2026-10-01 23:15Z.
- [x] W4G-13 and W4G-14 were found by wave4h runs 1 and 2: W4G-13 corrected the dev-image-ownership test's step matcher after Dockerfile.dev
      gained `bun run build:packages` (merge 8c7f7bc00, receipts a6bc6eeab); W4G-14 made file-organizer-applier-reserved-dirs reset the
      process-wide project-root cache after pinning its root (merge a3964cfb6, receipts 1992630f3). wave4h run 3 at 1992630f3 is green
      (receipts b73b13be4).
- [ ] Open follow-ups: cookie (needs @sveltejs/kit 3), uuid (exceljs), esbuild (drizzle-kit), qs (@stryker-mutator); the E2E real-auth 3 specs
      (re-read at the next hosted run); the build-pi-agent.ts keyless factory-branch test; the four hosted jobs that need runner labels/secrets.

## Leftover after wave 4 — 2026-10-03

From the read-only plan audit (w00/wave4h/leftover-audit-plan.md, section D, deduplicated) and the todo audit
(w00/wave4h/leftover-audit-todo.md, section A.1).

- [ ] W17: build factory metrics, C11 alerts with a real evaluator, the outbound webhook/SMTP sender, its boot role and receiving-service
      proof; this also closes W09 L270/L271. Not deferred.
- [ ] W19: freeze the workload; run the capacity experiment, the 26.5 h local campaign, the fault matrix, and 1 and 10 concurrent
      10,000-node runs. Not deferred.
- [ ] W10/W11/W13: provision the model provider credential; run the real generator, supervised review, image semantic quorum and actual Note (wave4i): the credential and the pin landed with W10c (openai gpt-6-luna, OAuth; merge 49dbcc562); still open: W10 G27, G8c and G8d.
      usage. Not deferred (recorded readiness failure).
- [ ] W10/W13: real code and catalog journeys through the started app to a draft PR with actual child bytes (W10 G27). Not deferred.
- [ ] W20: freeze the candidate, run full regression at the final head, area-separated review, F01–F13 evidence manifest, close
      GATES.md, handoff. Not deferred.
- [ ] W18: hosted enforcement: runners, secrets, branch protection, five-minute no-runner failure, deliberate lane failure, CODEOWNER
      review. Deferred by: tasks/todo.md (W18 wave 1, final gate).
- [ ] W04a/W15/W16: deploy and certify an independent archive failure domain with a distinct restore identity; blocks production
      publication claims. Not deferred (plan section 6 makes it full-launch).
- [ ] W07: install and verify the selected-repository GitHub App and the broker-only branch ruleset. Not deferred.
- [ ] W14: HTTP journeys across two provisioned installations; W16 purge preconditions; real-stack repair/replan/uncertain release;
      keyboard-only journey. Partly deferred: "by ruling until W16" (W14 Decisions), never closed.
- [ ] W15: real cloud KMS, Temporal archival, shared-PostgreSQL WAL archiving, cluster-wide Temporal restore, real fencing; missing
      restore tests (expired history, deleted projections, old-epoch token). Not deferred.
- [ ] W01: cross-host recovery and replacement on a real second host; inspect-failure/timeout and Node-kill cases. Not deferred.
- [ ] W02: hostile fetch/unpack/build/import/test and asset-mutation fixtures; fetch proxy role; fence acceptance/release for
      quarantined packages. Not deferred.
- [ ] W03: nested cancellation, losing join branches, one-slot parent/child tests; Retry-After header on 429; zero-cost reservation
      reconciliation. Not deferred.
- [ ] W16: hosted Kubernetes profile with DaemonSet supervisor separation. Not deferred.
- [ ] W02/W16/W19: production GPU profile (CDI, dedicated host, NVIDIA pair, reset, reimage); repeat isolation proofs on both profiles.
      Deferred by: W02d ruling (b)/A5; the plan assigns W19.
- [ ] W05: freshness and issuer-grant rejection proofs; negative matrix on actual isolated validators. Not deferred.
- [ ] W11: human review of the car and tree verdicts; publish an accepted variant with measured quorum. Not deferred.
- [ ] W11/W12: bound guest material-mount bytes at mount time, not only at read-back. Not deferred.
- [ ] W18: reference-data image producer in CI; recheck coverage against 2588c9f19. Deferred by: W18c follow-up (user decision) for
      the producer; not deferred for the recheck.
- [ ] W06/W09: a failed Release node still emits a cancel-node. Deferred by: coordinator ruling 2026-09-23 (W09c Open 2, 4).
- [ ] W02d: bounded back-off for the stop pool-mismatch retry; claim-time fact on the launch row. Deferred by: W02d Open; PR #318
      body follow-ups.
- [ ] W09d2: M1: a lost response on an empty dispatch can wedge the run in stopping. Deferred by: owner W03 per ruling 2026-09-24
      (W09d2 M1).
- [ ] W14/W03: a denied approval leaves the run in "running" because the control-node stop never settles. Not deferred.
- [ ] W15: manifest key binding (N2), keyed report digest (N4), constraint re-add (N3); C09 purge, inbox tombstones, debug-log store
      not built. Partly deferred: W15b "Disclosed follow-ups".
- [ ] W13: orphaned legacy run detection within 30 s (the wake interval defaults to one hour). Not deferred.
- [ ] W00: move large raw evidence from /tmp to durable storage with checksums. Not deferred.
- [ ] REG/W18: gate-change label for the eight standing coverage-tool findings; follow-ups (authoring-flow 404, complexity 38, keyless
      test, four low advisories); remove the Bun guards. Deferred by: ruling-origin-main-gate-leg item 5; PR #318 body follow-ups. (The
      combined run at 1992630f3 is receipted: b73b13be4; W12e G5 is ticked in this commit.)

Open factory items elsewhere in this file (class (a) of the todo audit, 41 boxes; not repeated here): see lines 2127, 2152, 2153, 2804, 2806, 2835, 2892, 2894, 3145, 3420, 3508, 3614, 3619, 3666, 3668, 3670, 3985, 3986, 3987, 4004, 4007, 4123, 4124, 5349, 5442, 5476, 5477, 5525, 5567, 5569, 5571, 5574, 5576, 5582, 5583, 5585, 5586, 5587, 5588, 5589, 5590.

## W4H-2 — pinned uv for the hosted test jobs (branch `wp/w4h-2`; gates `tasks/factory/w4h-2-GATES.md`)
- [x] Red in a runner-shaped container without uv: 5 fail, each UvUnavailableError (the hosted shards 3 and 6 set)
- [x] One pin (`.uv-version`), one action (`setup-python-toolchain`) in every job that runs the uv-dependent suites
- [x] One shared "action before the step" check in scripts/lib/ci-registration.ts, used by the W4G-6 and W4H-2 tests
- [x] A unit test pins the action to `.uv-version` and refuses a second uv literal or another uv install
- [x] Green in the same container with uv installed by the action's own steps: 10 pass, 0 fail
- [x] Coverage, lint, typecheck, boundaries, actionlint, guard set; hook count 4
- [ ] Hosted run green for the six jobs (after the coordinator's push)

Review: the cause was a missing step, not a resolver defect. The pin and the action existed, but only three jobs used
the action. The fix adds the action to the five backend-pool jobs in ci.yml and to the release job, and a test now fails
on any job that runs the uv suites without the action first. The release job also lacked the W4G-6 parser action. The
shared check found that gap after `bun run test` and `bun run test:coverage` were counted as pool runners.
## W4H-5 — run lifecycle 'publication' credential set on the hosted runner (wp/w4h-5)

- [x] Red in a runner-shaped container at 52d8ba079: coverage shard shape and external-postgres shape, 80 pass / 12 fail each.
- [x] Root cause with a control leg: the set was written under the 0755 `$HOME`; a 0700 home is green with no credential dir or S3.
- [x] Fix: the suite takes its root from `makeFactoryTempPrivateRoot` (e4059c18f).
- [x] Guard `scripts/factory-private-root-registration.test.ts`: red at the base, green at the head, in the guard set by name.
- [x] Green in the same container, both shapes, 92 pass / 0 fail; coverage gates, lint, typecheck, boundaries, gate-integrity, guard set green.

- [x] Widening: one composite action for the three storage start copies, stop only after a start that ran (R10), pin test red then green (1fa4a5354).

Review: the brief named a missing S3 service and credential set as the cause. The evidence shows the W4G-4 class
instead (a private file under the hosted runner's owned 0755 home). No workflow change was needed. Gates and receipts:
tasks/factory/w4h-5-GATES.md.
## W4H-3 — pinned Python base for the hosted shards (branch `wp/w4h-3`; gates `tasks/factory/w4h-3-GATES.md`)

- [x] Red in a runner-shaped container at 52d8ba079: python-guest, applied-controls and the journey fail "image not known" as hosted.
- [x] One pin source: the step reads DEFAULT_PYTHON_IMAGE; a unit test pins it, the data recipe's FROM and pinned.json's base together.
- [x] Shared step `.github/actions/factory-python-base` in cov-shard after the podman setup; the test pins its place (8c93335e5).
- [x] Green at 8c93335e5: step 4 s; applied-controls 5 pass; python-guest 12 pass.
- [x] Data image: podman 4.9.3 builds e64f66da…, not the pinned f9cc7477… (podman 5.8.2); umask ruled out. The journey runs in the
      factory-real lane (W4H-4). A registry for the data image stays the user's decision.
- [x] Hook noise: run_staged_tests no longer prints "Broken pipe" (491b7cc22).
- [x] Coverage: scripts/setup-factory-python-base.ts 18 of 18 lines (E/coverage-new-file.txt).

Review: the hosted shards had no step that put the Python images on the runner, and three files spelled the base digest with nothing
tying them. The base is now pulled from the one value the suites read, and a test holds the three spellings and the step's place.
The data image cannot be rebuilt by digest on the hosted podman, so it is not faked: the build script refuses, and the journey stays in
the lane that holds the image. Receipts: /tmp/factory-platform-evidence/w4h-3/.
## W10c — Codex provider pin revision (branch `wp/w10c-codex-pin`; gates `tasks/factory/w10c-GATES.md`)

- [x] R1 red first: base probe and pin-only probe logs (both `provider_not_configured`); the "unavailable model" red was withdrawn by the coordinator.
- [x] R2 registry: the pin is `gpt-6-luna` (user amendment 16:00Z). pi-ai 0.85.1 does not ship it, so one `LOCAL_OAUTH_OVERRIDES` entry, red first (`model_not_available` before it); misspelt id refused by name.
- [x] R3 re-pin every factory pin to `openai` / `gpt-6-luna` (one SDK constant); `cache-proof-live.ts` left as an Anthropic cache proof.
- [x] R4 routing proof: OAuth login reaches the subscription endpoint; regression pair on gpt-5.5; misspelt, api-key-only under a login, and subscription-only under a key are `model_not_available`.
- [x] Ruling (a): the probe names its store (`store_not_named`, `store_unavailable`, store kind and opened), never writes to HOME or the checkout.
- [x] R5 digests recorded for haiku, gpt-5.6-luna and gpt-6-luna: code, image and image lock change; data and catalog do not.
- [x] R6 W11 evaluator pin re-pinned; SDXL model and image pins unchanged.
- [x] R7 `/tmp/factory-platform-evidence/w10c/SIGN-IN.md` written.
- [ ] R8 real legs: wait for the coordinator (wave4h push, the user's sign-in, the heavy lock).

Review: the brief assumed the id was missing from the registry; for the first pick it was not, and the real defects were
elsewhere. The probe and the code journey never opened the configuration store, and with none named the probe would have
created one under HOME. The broker sent an OAuth login to the api-key endpoint, and an API key alone made a
subscription-only pin read ready. All are fixed red first inside the probe and factory-broker.ts. One question stays open
for R8: the proof stack makes a new database and encryption secret per start, so the sign-in must happen inside the R8
hold or the stack needs a fixed-database option.

## W4H-3c — scripts tests typechecked (branch `wp/w4h-3c`; gates `tasks/factory/w4h-3c-GATES.md`)

- [x] Red at edd373c59: a type-only mutant (WorkflowStep.shell dropped) leaves `bun run typecheck` at 0.
- [x] tsconfig.tests.json includes scripts/**/*.test.ts (46 files); 8 errors in 2 files fixed at the root (eedfeab4a).
- [x] Green: the mutant fails typecheck; typecheck, lint, guard set and gate integrity green; both changed modules at 100 percent.

Review: the scripts tests were typechecked by no program, so a test that relied on a removed type still passed the gate. They now
join the backend test program. The two errors that surfaced were real type gaps: an untyped JS module and an over-claimed matcher type.
Receipts: /tmp/factory-platform-evidence/w4h-3/w4h-3c/.
## W4H-6 — three hosted timing failures, root cause each (branch `wp/w4h-6`; gates `tasks/factory/w4h-6-GATES.md`)

- [x] Runner-shaped container (Ubuntu 24.04, systemd, the repo's runner setup script, podman 4.9.3, 4 CPUs, 16 GiB, Bun 1.4.2).
- [x] Red at 52d8ba079: workspace budget test (30 s timeout, dash), supervisor attach (Worker closed, 73.8 s), auto-note concurrent captures.
- [x] Cause 1 fixed in the product: the reference-code budget kills the command's process group (1b4954ce2).
- [x] Cause 2 fixed in the product: worker channel FIFO reads leave the fs thread pool (e090a379f, 1be3d0ac5, 0d71cf09f).
- [x] Cause 3 fixed in the test: the attach test uses the supervisor's own worker id and refuses `start` (8a4cf8b04).
- [x] Green at the head in the container: each file alone and the hosted shard lists 0, 2 and 7 (gates G1-G4).

Review: the two "Worker closed" failures were one product defect that only a host with few CPUs shows: each live worker held two
fs-pool threads in blocking FIFO reads, so two live workers on 4 vCPUs stopped every file operation in the process. A local host
with 32 CPUs needs 16. The supervisor test hid a second defect: it never attached at all. Receipts:
/tmp/factory-platform-evidence/w4h-6/report.txt.
## W4H-7 — "concurrent task_add loses an update" (R8) is the FIFO-pool stall, not a race (branch `wp/w4h-7b` from integ/w00 87e1e197c; gates `tasks/factory/w4h-7-GATES.md`)

- [x] Reproduce red in the unit lane on 4 CPUs: red at run 1 (probe) and run 3 (trace), base 52d8ba079.
- [x] Trace the failure: B's committed write is not answered until the deadline closes both workers; A's lock retry never reaches the host.
- [x] Root cause: W4H-6's channel FIFO reads on the fs thread pool (coordinator ruling 2026-10-03 23:21Z withdraws the race guess).
- [x] E2E real-auth task-panel-durability: red at base (:107 60 s timeout), green at the fix (2 of 2 runs, 3 passed).
- [x] Regression pair with no new test: the unchanged suite with UV_THREADPOOL_SIZE=2, red at base, 10 of 10 green at the fix.
- [x] Runner-shaped container (4 CPUs): red at run 1 at 52d8ba079; 20 of 20 green with the runner diff. Host: 20 of 20 green at the fix.
- [x] At the merged fix (87e1e197c): E2E 2 of 2, the unchanged suite 10 of 10 (gates G4).
- [x] E2E at this branch head 2e529f1bb on 6ac2458c7: 2 of 2 runs, 3 passed (gates G4b; W4H-9 changed the runner service).

Review: W4H-7 changes no product or test file. The write path was already serialised (host row lock through withLock, FOR UPDATE and a
revision check). The two red lanes are the worker-channel stall that W4H-6 fixes, so W4H-7 merges after W4H-6 and carries only its
evidence and gates.

## W4H-12 — factory-host-launch rejects in the hosted external-postgres job (branch `wp/w4h-12-factory-host-launch`; gates `tasks/factory/w4h-12-GATES.md`)

- [x] R1: red reproduced in a runner-shaped Ubuntu 24.04 container with a fresh pgvector:pg15; rejection made visible: "image not known".
- [x] R2: cause named with its lines: the job never ran the extension runner setup, guests start with --pull=never, and the test hid
  the value. My fourth point (the storage action's XDG_RUNTIME_DIR export) was disproved by leg r6-xdg.
- [x] R3: the job runs the runner setup; the runner refuses a missing image by name (`image_unavailable`); a guard holds Podman-guest
  steps to the setup (e18becde4, 44e2121e9, f0cf1e8f7, e423c827b); the action change reverted (ac20f1a8a); twins assert again and
  the unproven ordering rule dropped (643f12dd5).
- [x] R4: tests red without the fix (runner precondition 0/4, guard 1 fail on the base workflow), green with it.
- [x] R5: the storage step green in the hosted shape (r5-green, and r6-xdg for the head's exact job shape); r5-named red by name.
- [x] Control: wave4i-2's 56-file postgres list, 629 pass / 0 fail (the first run void by a host OOM storm).
- [x] Final light legs at 643f12dd5 green (gate-integrity: integ/w00 PASSED, origin/main the 8 expected); r7-order inconclusive, so
  the ordering rule was dropped.

Review: the hosted red was not in the test or the product dispatch path. The external-postgres job ran a real Podman guest on a runner
that nobody had provisioned, and the test's `.resolves.toBeUndefined()` hid podman's "image not known". One of my four causes was
wrong; the leg built to prove it disproved it, and the change it motivated was reverted. Receipts:
/tmp/factory-platform-evidence/w4h-12/report.txt (written once, at the end).

## W4H — hosted CI 37138524741 follow-up packages (landing records)

- [x] Hosted CI 37138524741 at 52d8ba079 failed 20 jobs against the baseline's 26; the causes were routed to W4H-1..9.
- [x] Landings (merge / receipts; verdicts under docs/validation/factory/wave4/, prefix <pkg>-merge):
      W4H-2 66decce3e / b296e70ab; W4H-5 a9088b2c6 / 3a7aad76c; W4H-3 5f7722ae1 / edd373c59; W10c 49dbcc562 / 2510fa836;
      W4H-1 daf2aa776 / 36ece5b99 (side finding 2 -> W4H-9; amendment 96c96029e); W4H-3b 536b8ae42 / a5b0866e0; W4H-3c 392dac7dd / 104cb2237;
      W4H-6 463837a12 / 798c2935e (amendment 87e1e197c); W4H-8 5b8d5556f / 9ede86fd1 (amendments 60f8fcaa9, e87f3804e);
      W4H-4 20c3f0641 / 645406221 (red merge hold f38f3db4e, fix 5bdbecd3c); W4H-7 8221bec84 / f07f1ed63 (docs only);
      W4H-9 (side finding 2: runner pre-attach compatibility) 4550c2f66 / 2808ff324 (amendments da78aab05, a5c5afebe:
      R3d closed locally by validator-6; the hosted historical-upgrade lane is still expected green).
- [x] W10c: the C10 contract revision by the user's decision (2026-10-03): factory pin claude-haiku-4-5-20251001 -> openai gpt-6-luna under the
      Codex OAuth credential; R8 journey receipt 1b15abdcad386e5a...; W10 G27, G8c and G8d stay open.
- [x] wave4i combined run at 98c59f562: green (runner 38 legs, 48893 tests; after-runner and browser part green; final gates vs origin/main green, gate-integrity = the 8 expected lines; extra pass vs 1992630f3 green); receipts f1bee005a.
- [x] W4H-10 main sync (W-SYNC form): origin/main beaff68c8 merged into the wave head at e6a3a70f2 (9 conflicts resolved at the root; Pi 0.87.1
      catalog carries gpt-6-luna, the W10c override removed as dead code); validator-5 ACCEPT 6c93600351782b0c; merge 198f5fcac / receipts 1c84df6d5
      (hook: list-bound ruling 45ba088481f9e09f for the merge commit; EZ_PRECOMMIT_TEST_MAX=62 under the lock; nothing skipped).
- [x] wave4i-2 combined run at 1c84df6d5 (binding coverage judgement vs beaff68c8): runner part green except gate-integrity (the 8 expected lines);
      standalone coverage producers shard 30068/0 and extras 1454/0; after-runner re-run green (browser lanes mock-full 1466, evidence 394,
      fresh-setup 7, real-auth 108, factory-services 13); merged lcov of the final gates f73fe033c1d5cee4 over 2383 files (runner interim merge 0ab908e0f9d79cde over 2297, before the browser lcov joined); final gates green on both passes (vs origin/main: gates.txt 5546a3218bef5bf1, new-file 460 files, patch 517 files, global floor margin 8.08, gate-integrity = the 8 expected lines, findings-match PASS; vs 1992630f3: gates.txt 14d9cb03a1819cda, gate-integrity PASSED); receipts 71838dfa3 (81 receipt files; SHA256SUMS 1995→2076, append-only).
- [x] W4H-13 (hook git-env e2e case; the fix 48da9c886 was already on integ): validator-6 ACCEPT fccacb8fa83f69d5 at 196552004; merge fb2813ce4 / receipts
      ae697c49d. main hotfix PR #326 (fc495fd2b + 61ac99c27) by session ezharness-dc.
- [x] W4H-12 (external-postgres runner setup; image_unavailable; visible twins): validator-5 ACCEPT a4d1f5c98e0342f5 at d364e11ad; merge 738de9d0b /
      receipts 0363f883a. Reverted on evidence: the storage-action XDG change (r6-xdg) and the setup-before-storage rule (r7-order inconclusive).
- [x] W4H-11 (bundled bootstrap progress deadline; a second flat waiter found by the recovery proof and fixed in 88de7acce): validator-7 ACCEPT 04d728012e109874 at 16f1228db; merge 000f75d10 / receipts 3c6e53340.
- [x] W4H-14 main sync (W-SYNC-3): origin/main e3309906d merged at de8fa57ec (5 conflicts per the accepted table; locks byte-unchanged under the pinned
      install; no pin lowered); validator-8 ACCEPT 0e4af9601ee44974 at 00c979687 (append-only carry from 600685b24); merge 05af60ade / receipts 6b9ff91ac.
- [x] wave4i-3 combined run at 6b9ff91ac (binding coverage judgement vs origin/main e3309906d): runner 39/39 legs, 49468 tests, both coverage
      producers in-run (cov-shard 30103/0 over 2023 files); gate-integrity = the 8 expected lines; after-runner and the six browser lanes green;
      final gates green (merged lcov dc11870132ec7aee over 2384 files; new-file 460, patch 518, per-file 2233, floor margin 8.08; gates.txt
      3817700c7ff8c68a); second pass vs 1c84df6d5 green (11aafe3390b821d7); receipts ec87d22e4.
- [x] W4H-15 (hosted per-file coverage gate: seven lcov-cov-* producers shared the file name lcov.info; unique names + a registration test):
      validator-8 ACCEPT at f1774df59 carried to f1b9efe1b; merge cf9f5927e / receipts 2737e385d. Hosted run 37743486763 at 1b96d2730: red 20 → 3
      (Gate integrity label; FACTORY_RUNNER_READ_TOKEN; the coverage gate — now this fix plus 4 files measured only by the reference-data leg and the
      uv probe step, pending the data-image publication decision).
- [x] W4H-16 (hosted coverage for pack.ts, materials.ts, publication.ts and uv-command.ts lines 20-21 without the data image; two red-first fixes:
      the attempt-directory leak on six refusal paths and the uv probe spawning the which() path): validator-8 ACCEPT 7e7407341887f7f7 at f80fcda35;
      merge a214eda2b / receipts 9556a2911. Hosted run 37960843272 at 3897fe923: red 3 → 2 plus one cancelled job (0 green→red; vs the first run 20 → 2): FACTORY_RUNNER_READ_TOKEN (secret); Gate integrity cancelled at its timeout with no log, re-run as a single job = exactly the 8 (label); Per-file coverage gate — W4H-15 confirmed (every producer's records present), one new line: FactoryConsole.svelte 199, a browser-lane race in the import success case → W4H-17.
- [x] W4H-17 (the FactoryConsole import race in the browser coverage lane: the success case ended on the mocked request, before the component
      settled; the case now holds the mocked /import, asserts the draft absent, releases it, and waits for the listed row, the opened heading and the
      cleared file input — the race is forced on every run): validator-8 ACCEPT 6d0a2b02ef4183e7 at bdafcbbfe; merge 8fc75ee6d / receipts 6d426363f.
      Hosted run after this landing: recorded in the push receipts (wave4i-3-push3) and the PR body.
- [x] W4H-18 (the production resources proof compared the extension runner's descriptor count strictly with no settle; #329's settle covers the
      app's connections only; a descriptor the runner closes after the sample failed R4 cycle 1 on hosted run 37986983940): settleRunnerFds in the
      accounting lib waits for equality, bounded (150 x 100 ms), the strict check unchanged after the bound; the runner's descriptors are snapshotted
      at baseline and the failure receipt names each extra one's kind: validator-8 ACCEPT 87217593bd63f7e6 at 99c5bb9ab; merge d12bcf8ee / receipts
      31b9a8d93. Hosted run after this landing: recorded in the push receipts (wave4i-3-push4) and the PR body.
- [x] W4H-20 (the four biome warnings on integ: GitHub-expression fixtures flagged as templates in two CI-registration tests, and a comma operator in
      the PostgreSQL recovery helper): ghExpr() in the shared scripts/lib/ci-registration.ts; adminSql() asserts before it builds the client; biome.json
      unchanged; lint 0/0 repo-wide: validator-8 ACCEPT f3c62b889a2b9be2 at 6e9f8a2c6; merge 2e1008de8 / receipts 5bd3dad9a. Lands in the same push as W4H-18.
- [x] W4H-21 (the Factory Temporal coverage producer hung silently and was cancelled at its 10-minute job limit on hosted run 38001537073: its
      reporter wrote only to a file, its inner timeout equalled the job's, no per-test timeout, and the totals read "fail 0" after a kill because
      "cancelled" was never printed): --test-timeout 200 s (3.33x the slowest green test) with --test-force-exit, the spec reporter to stdout as well,
      inner timeout 450 s + 30 s grace with the log tail and totals printed on failure, the progress log uploaded with if: always(), and the totals print
      "cancelled": validator-8 ACCEPT 942b96f154921311 at b21eb4c57; merge fa25ce42f / receipts 7f641a70c.
- [x] W4H-22 (the content proof's file-organizer refused-add case timed out on the Hub page title with the 5 s default, before its click, on the same
      hosted run; a bare Hub render takes 3.6 s locally; the toast lives 5 s): the case awaits the Hub page response and the title with the file's 20 s
      render wait, the add-folder response with status 200 and the exact ok:false body, then the toast inside its life; spec-only, no sleep:
      validator-8 ACCEPT 01349409e1e1d68d at a708a22c8; merge c329cb4f7 / receipts 06da341d7. Both land in one push (wave4i-3-push5).
- [x] W4H-23 (post-merge: the nightly mutation workflow on main was red since 6eb1bbb33 — the wave's new zero-test-survivor guard met 5 static mutants
      that break a test file at load time, which runner 10.0.0 records as "Survived, 0 tests"; the earlier green nights had measured almost nothing):
      the runner patch now lets a test file that fails to load kill the mutant that broke it, only when the initial run loaded that file and an alone
      run without the mutant is reported and passes; a file the initial run could not load never kills, and a kill whose reason equals the file's initial-run failure is
      refused (validator-8 F1 at 614dafa9b: a false kill from a $server import that resolved only some of the time; REJECT e0cfd62aaf81a86d);
      a 19-case pin test; shards 3/6 and 5/6 green with 0 zero-test survivors and 0 resolution-reason kills: validator-8
      REJECT e0cfd62aaf81a86d at 614dafa9b then ACCEPT 1aebc9e9b61cdefa at 308d362e3 (R4: 54c5e493b initial-run seeding + message rule, 28adbc34d positive alone-run proof); merge fdf8ac512 / receipts 888f39653. Lands in the follow-up PR after the two main syncs.

## Leftover after wave 4i — 2026-10-05

Changed:
- [ ] W10/W11/W13 provider line: the credential and the pin landed with W10c (gpt-6-luna, OAuth); still open: W10 G27 (real code and catalog
      journeys to a draft PR with actual child bytes), G8c and G8d.

Added (w00/wave4h/leftover-additions.md, coordinator 2026-10-04, and the W4H merges):
- [ ] Patch gate scope: new-file and patch gates measure src/ and packages/ only; scripts/ is outside (W4H-3: setup-factory-python-base.ts
      measured 0 files, coverage shown by validator-5 instead). Decide whether scripts/ joins the gate's scope.
- [ ] Load-sensitive test: factory-sdk schema-generation test (7.1 s against 5 s under load; rerun 246/0). Make it load-independent.
- [ ] Load-sensitive test: src/__tests__/marketplace-search-perf.test.ts asserts wall-clock < 10 ms (10.497 ms under load). Make it
      load-independent; review the shard script's "isolated plain re-run" tolerance.
- [ ] Shard container shape: the local hosted-shard container lacks node and the python data image pull (W4H-6 list 7).
- [x] W4H-1 side finding 2, cause named: the branch runner service requires /v4/attach before /v4/events (11b9f72b9), so previous-release
      hosts fail historical-upgrade with operation_failed. Fixed by W4H-9 4550c2f66 / 2808ff324 (closed).
- [x] W4H-1 production-image proofs: closed by validator-6's addendum (49813b3b9dbc8293; runtime-resources green at d341d8690,
      28/28 verified; receipt amendment 96c96029e).
- [ ] Data image registry publication by digest: the user's decision; only then does the reference-data journey suite return to the hosted
      shards.
- [ ] Lane manifest hardening (W4H-4, validator-6's limit): refuse any --bound-tests list line that is not an existing *.test.ts file;
      today a fake bun lying about its version, with no real pinned bun in ~/.bun/bin or EZCORP_PINNED_BUN_DIR, would be trusted.
- [ ] The legacy-adoption proof calls docker directly; the podman lane cannot run it. (Not in the carried wave4h list: one box, added here.)
- [x] Hook noise: scripts/lib/hook-lib.sh "printf: Broken pipe" (grep -q early close) was fixed by W4H-3 (491b7cc22): 8 lines in the
      W4H-5 hook log, 0 in every hook log from the W4H-3 merge on (W4H-3, W10c, W4H-1, W4H-3b, W4H-3c).
- [x] W4H-3c: scripts/**/*.test.ts join the CI typecheck program (merged 392dac7dd).

Added after wave4i-2 (coordinator, 2026-10-06…08; details in w00/wave4h/leftover-additions.md):
- [ ] Bundled-bootstrap safety net (1544 s for 28 builds) exceeds the production-proof suite's per-proof `timeout` caps (15 / 25 min): align the
      caps or make the cap print the policy's state (W4H-11 F1).
- [ ] scripts/verify-shipping-delivery.ts: the timeout-receipt catch path has no unit test (W4H-11 F2); scripts/verify-extension-container.ts:40
      has an unused flat 240 s build wait.
- [ ] Pinned Node for local legs: /tmp/factory-tools/node-24.14.1 is installed with the SHASUMS256 match but the list's GPG signature is unchecked.
- [ ] Install race on many-CPU hosts: @ezcorp/sdk's `prepare` ran before @ezcorp/extension-contract's re2js was linked under a 32-CPU install with
      lifecycle scripts ("Cannot find module 're2js'"); fix the workspace build order, not a CPU pin.
- [ ] Local Podman replays of the production proofs: the pinned conmon 2.2.1 is built without journald, so a rootless Podman 4.x host with the journald
      log driver cannot start a container without an explicit --log-driver (the runner is immune; the proofs' compose apps are not).
- [ ] scripts/setup-git-hooks.sh re-stamps the SHARED .git/config on every install (`git config extensions.worktreeConfig true`); make the write
      conditional so an mtime dates a real change.
- [ ] .gitignore line 8 (bare `tasks`) ignores a directory the repo tracks (todo, lessons, 115 gate files force-added): replace with the real intent.
- [ ] Hook-lib hardening notes from the PR #326 review (comment placement; the unit case pointing GIT_DIR at the real git dir; `--local-env-vars`
      option; compgen fail-open; comment dates).
- [ ] `svelte-check --tsgo` peaks at 8–15 GB; a `check:light` or a heap cap for constrained hosts.
- [ ] CI ordering: running setup-extension-runner-ci.sh --install AFTER the factory-storage `up` failed (rc 1, log lost); reproduce with the log kept.
- [ ] audit-deps moderate advisory below the floor: sprintf-js (GHSA-hp3w-g68c-fv3c).
- [ ] Legacy-adoption under podman: `$ENGINE build --load` is Docker-only (verify-legacy-adoption.sh:89; build-archived-image.sh).
- [ ] Three pre-existing assertion gaps named by validator-8's W4H-16 mutants on unchanged lines (non-blocking by the changed-lines ruling):
      pack.ts sealProduced's digest-only disagreement (the tamper test also changes the size), the sealed-summaries count check, and
      uv-command.ts `located.startsWith("/")` (no test makes the probe print a relative path). Add the three assertions.
- [x] Four lint warnings on integ/w00 (errors 0): noTemplateCurlyInString at scripts/lcov-artifact-names-registration.test.ts:126 and :136 (W4H-15's
      new test) and scripts/setup-factory-python-base.test.ts:101; noCommaOperator at tests/postgres/helpers/factory-recovery-databases.ts:50 — cleared by
      W4H-20 (merge 2e1008de8); lint 0/0 repo-wide at 2e1008de8.
- [ ] Two pre-existing lint warnings: scripts/setup-factory-python-base.test.ts:101 and tests/postgres/helpers/factory-recovery-databases.ts:50
      (unchanged since 8ea96b0ed; biome.json unchanged). Fix both.

- [ ] Pinned toolchain and evidence live under /tmp (/tmp/factory-tools, /tmp/factory-platform-evidence) and age out under systemd-tmpfiles (10 days):
      move them to a persistent path or add the tmpfiles exclusions (user, root). Restore the 0-byte Bun 1.3.14 binary from the release with its SHASUMS.
- [ ] Browser-lane coverage varies run to run at line level outside the factory console (W4H-17 hold vs hosted run 37960843272: api.ts:819,
      chat/page-handlers/send-message.ts:818-819,827, ChatInput.svelte:566, ChatThread.svelte:1269, ContextUsageIndicator.svelte:145, ProjectRail.svelte:60,
      admin/dashboard/+page.svelte:266; a different set vs the local 6b9ff91ac lcov). The hosted gate passes today; each is a latent flake of the
      FactoryConsole:199 kind. Make those specs assert the outcome, not the request.
- [ ] scripts/verify-shipping-runtime-resources.ts runs the whole proof on load, so its runner-failure branch (W4H-18) cannot run in a unit test;
      add a script-level seam so the failure branch runs without a container (validator-8's leftover candidate).
- [ ] scripts/lib/ci-registration.test.ts does not execute ghExpr() on its own (the two consumer tests do): add one direct case (W4H-20 open item).
- [ ] web's Vite config prints a configLoader 'native' warning at vite.config.ts:6 (seen by W4H-20; outside its scope).
- [ ] No test pins the Bun SQL pipelining guard inside tests/postgres/helpers/factory-recovery-databases.ts's adminSql(): under bun test the preload
      (src/__tests__/preload.ts:12) runs the same guard first, so a dropped guard is invisible there (validator-8's W4H-20 probe). Add a preload-free case.
- [ ] The production-proof content job's Playwright run keeps no trace or screenshot on failure (the artifact of run 38001537073 shows none), so a hosted
      red cannot show what the page looked like. Enable trace/screenshot on failure for the proof lanes and upload them (W4H-22 finding).
- [ ] The orchestrator test "continues only from a quiescent state and restores absolute timers" takes 60.0 s in every run (a real 60 s wait); it is the
      likely site of the hosted hang and sets the per-test timeout floor. Make the wait fake-clocked or bounded (W4H-21 finding).
- [ ] Nightly mutation: 33 web/src/lib files report every mutant as NoCoverage at both e3309906d and 6eb1bbb33 because Stryker's vitest `related` filter
      cannot follow their tests' $lib-aliased imports (the same set, reshuffled across shards as the scope grew 190 → 200). Per file: exclude it in
      mutateGlobs when the bun leg owns its tests, or make its test import followable (W4H-23 finding B; not the red).
- [ ] Nightly mutation: the honest merged score is about 50–56 percent against the 80 break threshold. Before the Vitest 5 testNamePattern patch
      (81dfe3cb4) the green nights measured almost nothing (11772 of 18934 mutants with 0 tests on run 38042900360). Whether to keep 80, lower it
      with a plan, or stay report-only is a maintainer decision (W4H-23).
- [ ] Nightly mutation: 30–33 web test files per shard never load inside the Stryker sandbox because they import code outside web/ ($server/runtime/
      routing/default-selection via src/lib/model-selector-logic.ts 128 times, other $server paths, extensions/); they ran on no night. Decide per file:
      make the import sandbox-safe, or exclude the module from mutateGlobs with the reason (W4H-23 finding; the runner patch now WARNs with the list).
- [ ] Nightly mutation: inside the Stryker sandbox the `$server` alias points to web/.stryker-tmp/src, which does not exist, so
      `$server/runtime/routing/default-selection` never resolves there and 22 test files fail to load on every run (W4H-23 R4). The false kill
      validator-8 saw came from Vitest's late-bail cancel race (runFiles clears isCancelling while the previous mutant run's bail still cancels; a
      cancelled file is registered with no result), named from Vitest's code and not reproduced on demand. Decide: point the sandbox alias at the
      copied source, or exclude the 22 files with the reason. Until then the runner patch never counts a kill from a file the initial run could not
      load, needs a passing alone run as proof, and WARNs the list; shard-check.py binds "0 kills with a resolution reason".

## W4H-11 — bundled bootstrap deadline on the hosted 4-CPU runner (branch `wp/w4h-11-bootstrap-deadline` from integ/w00 1bc5f63c7; gates `tasks/factory/w4h-11-GATES.md`)

- [ ] R1 reproduce red in the W4H-6 runner-shaped container (resources and content shards, the hosted job's steps), with the per-installation timeline.
- [ ] R2 root cause from the timeline: (a) total wall clock, (b) a stall, or (c) both.
- [ ] R3 fix at the root: the wait ends on no progress (a live lease is expected silence); the total is a safety net sized from the measured 4-CPU rate, named once and read by every caller (the delivery proof's copied 480 s goes); the timeout error names each installation's state and elapsed time.
- [ ] R4 unit tests (fake clock, fake client): progress keeps the wait alive, no progress ends it, the error names the stuck installations; 100 percent of new and changed lines.
- [ ] R5 green in the same container: content, resources, delivery and recovery shards, one run each.
- [ ] Legs: typecheck, lint, hook-mapped suites with lcov, new-file and patch coverage, CRAP, guard set, gate-integrity, prune scan.

## W4H-15 — the hosted Per-file coverage gate lost six producers' LCOV to one file name (branch `wp/w4h-15-coverage-artifact-names`; gates `tasks/factory/w4h-15-GATES.md`)

- [x] R1: the new guard is red on the base workflows and names the seven `lcov-cov-*` producers that upload `lcov.info`. The merge
  collision is reproduced on run 37743486763's own artifacts: 6 overwrites, 40 SF records lost, the gate red with 70 files.
- [x] R2: each producer renames its LCOV to `lcov_<producer>.info` before upload (28c04b874). The gate job is unchanged. The guard
  and the 26 workflow-reading test files are green, and the renamed local merge loses no record.
- [x] R3: actionlint (no new finding), light legs, gate-integrity both legs (main = the 8 standing lines), prune scan and
  typecheck (under the memory rule) are green at 28c04b874.
- [ ] Open, outside the package: 4 files still fail the hosted gate once every record is present (pack.ts, materials.ts,
  uv-command.ts, publication.ts). Reported to the coordinator.

Review: the producers were correct; the gate's merged download dropped their files. A unique file name per producer fixes it
without changing the gate. The fix also uncovers 4 real coverage gaps the collision was hiding, so the hosted gate stays red
until another package closes them. Receipts: /tmp/factory-platform-evidence/w4h-15/report.txt (written once, at the end).
## W4H-16 — hosted per-file coverage for pack.ts, materials.ts, publication.ts and uv-command.ts (branch `wp/w4h-16-hosted-coverage-gaps` from integ/w00 8ea96b0ed; gates `tasks/factory/w4h-16-GATES.md`)

- [x] R1 reproduce the hosted gate's four failures from run 37743486763's artifacts and name the missed lines per file (G1).
- [x] R2 unit suites a hosted shard runs, with no image, no network and no real tool: pack-journey, publication, and the uv default probe (G2-G4). Two defects found red first and fixed at the root; the coordinator's ruling accepted the scope widening.
- [x] R3 the hosted check-coverage over the run's artifacts plus this branch's lcov passes; thresholds unchanged (G5).
- [x] Legs: hook-mapped suites with lcov, new-file and patch against integ, CRAP, lint, boundaries, lanes, prune, gate-integrity on both legs, typecheck, guard set and the real reference-data producer under the lock (G6-G11).

Review: the four files had no hosted producer. The image-bound journey was the only path into them, and hosted shards have uv on PATH. A guest double over the real W04 materials now drives the host side of the journey in every hosted coverage shard. A stand-in nix-shell drives the default probe. Writing those tests exposed two defects. First, an attempt directory leaked on any refusal raised after the attempt returned. Second, the probe re-resolved the bare tool name. Both are fixed. Lesson pending: w4h-16/pending-lesson.md.

## W4H-17 — the FactoryConsole import race in the browser coverage lane (branch `wp/w4h-17-import-outcome` from integ/w00 3897fe923; gates `tasks/factory/w4h-17-GATES.md`)

- [x] R1 reproduce DA:199,0 locally with the old success case while the spec passes (G1).
- [x] R2 the success case waits for the import outcome (row, heading, cleared file input); mutants without loadDrafts and without openDraft go red (G2, G3).
- [x] R3 the mock-full lane gives FactoryConsole.svelte 100 percent; the hosted check-coverage over run 37960843272's artifacts passes with the browser lcov replaced; the control stays red on line 199 (G4, G5).
- [x] Legs: new-file and patch vs integ (vacuous), CRAP, lint, boundaries, lanes, prune, gate-integrity on both legs, typecheck, guard set under the lock (G6-G9).

Review: the success case ended right after it saw the /import request, and the coverage fixture took coverage at teardown, so a late response left line 199 unhit. A test-only hold now forces the late response on every run, and the case waits for the outcome. The import creates its own draft so the outcome cannot be mistaken for the create step's state. No production change.

## W4H-18 — the runner-FD settle in the production resources proof (branch `wp/w4h-18-runner-fd-settle` from integ/w00 6df16debf; gates `tasks/factory/w4h-18-GATES.md`)

- [x] R1 red first: the settle test is red at base (missing helper). The hosted receipt has no runner descriptor field. The base resources shard is green under the lock (the race depends on timing).
- [x] R2 fix: a bounded settle to EQUALITY (150 polls × 100 ms) before the cycle sample. The strict check is byte-equal. The receipt names the kind of each extra runner descriptor and records the polls per cycle. The helpers are in the accounting lib, which has 100 percent line and function coverage.
- [x] R2 mutants: polling removed, bound 0, kinds omitted, `<=` allowance and no wait all go RED.
- [x] R3: the resources shard of the production suite at the head is green under the lock, with 1 settle poll in each of 10 cycles.
- [x] Legs: lint, boundaries, gate-integrity (integ PASS, main = the 8), typecheck under the tc rule, guard set, prune scan, CRAP. New-file and patch are vacuous for scripts/.

Review: the hosted red was a late close that the one-read check could not tell from a leak. The fix waits for equality and never allows a difference in either direction. A real leak still fails, now with its descriptor kinds in the receipt. The script's failure branch did not run live, and its logic is unit-covered in the lib.

## W4H-21 — the Factory Temporal coverage producer fails loudly, never hangs in silence (branch `wp/w4h-21-orchestrator-fail-loud` from integ/w00 fe445d241; gates `tasks/factory/w4h-21-GATES.md`)

- [x] R1 red first: the registration test is red at base on the three causes: the inner timeout is not below the job timeout, there is no per-test timeout, and there is no spec reporter to stdout. The two R2 items are red too. The silence is reproduced locally with an injected hanging test: stdout stays empty until the kill.
- [x] R2 fix: a 200 s per-test timeout and --test-force-exit; the spec reporter to stdout with tee to the progress log; an inner timeout of 450 s + 30 s grace, 120 s below the job timeout; the tail and the totals on failure; the cancelled count in the totals; the progress log uploaded on every outcome.
- [x] R2 proof: the injected hang fails by name at 200 s (exit 1 at 203 s); a load-time hang ends at the inner timeout (exit 124 at 453 s); both end before the simulated 566 s cancel. The three mutants go RED.
- [x] R3: the real producer at the head is green under the lock: 92 of 92 in 120 s. The slowest test is 60.03 s (3.33x margin), and the coverage is equal to base.
- [x] Legs: lint 0/0, boundaries, lanes, prune, CRAP, new-file and patch (vacuous for scripts/), gate-integrity (integ PASS, main = the 8), actionlint (the 3 label findings), typecheck under the tc rule, the guard set, and the 16 workflow-reading tests.

Review: the producer could hang without a word, because its only test names went to a file and its own timeout could never fire before the job's. It now names each test on stdout, ends a hanging test at 200 s, and ends any other hang at 450 s with the log tail and the totals. The progress log is uploaded even on a cancel. The hosted hang did not reproduce locally. The next hosted red will name it.
## W4H-22 — the file-organizer refused-add case awaits the outcome, not a 5 s clock (branch `wp/w4h-22-toast-outcome` from integ/w00 fe445d241; gates `tasks/factory/w4h-22-GATES.md`)

- [x] R1 the hosted shape reproduced in the content-shard form: a hold on the Hub page response fails the OLD case at the title wait (the hosted line); a hold on the dispatch response fails it at the toast wait with the correct refusal body (G1).
- [x] R2 the case waits for the page response and title, the dispatch response with its exact ok:false body, then the toast inside its 5 s life; green under both holds and a hold near the toast's life; three mutants red by assertion (G2, G3).
- [x] R3 the production-proof content shard at the head: file-organizer 13 passed, legacy-adoption 0 (G4).
- [x] Legs: lint 0/0, boundaries, lanes, prune, new-file and patch vs integ (vacuous), CRAP, gate-integrity on both legs, typecheck and guard set under the lock (G5-G7).

Review: the hosted red was the Hub page title wait, not the toast: the case gave a live render the 5 s default. The case now awaits each real response and then its result, with the file's 20 s bound, and checks the toast before the store removes it. Leftover candidate: the content shard keeps no trace or screenshot on failure.

## W4H-23 — the nightly mutation run counts a test file that fails to load as a kill (branch `wp/w4h-23-mutation-related` from origin/main 6eb1bbb33; gates `tasks/factory/w4h-23-GATES.md`)

- [x] R1 root cause first: the red is the new zero-test survivor guard on 5 static mutants that break a test file at load time; runner 10.0.0 reads only per-test results and bails, so it reported "Survived, 0 tests". The same 5 mutants and the same 33 no-coverage files were there on the green night, which measured almost nothing (11772 of 18934 mutants ran 0 tests) (G1, G2).
- [x] R2 fix (A): the runner patch lets a failed test file kill a mutant only when the file loads cleanly without it; the initial run warns about the 30 to 33 test files per shard that cannot load in the sandbox. The test is red on the old patch (9 of 14) and green with the new one (G3).
- [x] R2 proof: settings-nav.ts:134 is Killed; the four chat-turn-collapse mutants are Killed with a longer timeout and Timeout under the default on this host; all six shard dry runs stay green (G4, G5).
- [x] R3 (C): shards 3/6 and 5/6 as the workflow runs them, under the lock: 0 zero-test survivors; 59.72 and 50.42; merged with four hosted shards 56.36 (G6).
- [x] Legs: lint, boundaries, lanes, prune, gate-integrity on both legs, new-file and patch (vacuous), CRAP, typecheck and svelte-check under the tc rule, the guard set, the registration tests (G7 to G9).

- [x] R4 (validator-8 F1, a false kill from a baseline-broken file): the initial run records its unloadable files with messages for every worker; such a file, or the same message, never kills; and the alone check needs a passing run, because a late bail can cancel it. Pin 19 of 19 (red 5 of 17 on 614dafa9b, 2 of 19 on 54c5e493b); every mutant form red; five targeted runs with 0 resolve-error kills; shard 5/6 exit 0 at 50.22; legs green at 28adbc34d (G10 to G15).

Review: the nightly turned red because a new guard told the truth about five mutants the runner miscounted. The fix counts a load failure as a kill only when the mutant caused it, because about 30 test files per shard never load in the Stryker sandbox at all. That second artifact, and the real merged score of about 56 percent, are leftovers for the maintainers. R4 added what the first fix missed: the kill rule now reads the same run's baseline and asks for positive proof, never the absence of a failure.
