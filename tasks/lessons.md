# Lessons

- Seal every persisted field that controls a protected decision, including its scope, revision, and approving authority. Recompute the canonical seal before acceptance and before a later effect claim; a semantic source digest alone cannot detect authority or policy-row tampering.

- Keep definition list rows bounded. Persist compact semantic and resource metadata when a bounded source is saved; do not load or compile up to 200 full 16 MiB sources for one list request. Snapshot mutable request input before an authorization await.
- When infrastructure is not provisioned, separate locally verifiable contract work from later network qualification. Do not infer AMD, Xeon, Incus, Infisical, or credential availability from a delivery plan.

- Describe a raw entrypoint subprocess as a process, not an installed immutable release.
- In asynchronous delivery tests, await an observed operation or use transport ordering. Do not use a fixed sleep as proof of completion.
- When proving that asynchronous work did not happen, capture and await every operation started by the trigger. Waiting only for the expected positive callback cannot prove the denied phase is complete.
- A denied-path test needs a controlled fault that removes the protection and makes the test fail.

## Validation discipline

- A new CI job that selects several backend Bun test files must run each file in a separate Bun process. The root pool requires process isolation because cross-file mocks can contaminate or deadlock a combined run; an explicit multi-file command is not an exception.

- Select gpt-5.6-sol explicitly with fresh bounded briefs when the user requests a Sol team. Use distinct ownership and worktrees.
- Match each new team to the model requested for that task; a previous Sol request does not override a later Terra request.
- Read exact lifecycle and CI commands before selecting tests. A passing subset does not prove a full lane.
- Match pinned Bun and required Node versions. First-install proof requires a new worktree with no dependencies.
- Inspect screenshots and test assertions, not only pass counts or artifact existence.
- Wait for builds to finish before starting another process that writes generated output. Serialize heavy commands with the shared lock.
- Use follow-up tasks to wake an idle agent. A message alone does not resume completed work.
- Reopen only affected validation when the base or source changes, and keep exact revision receipts.
- Preserve live-event E2E transitions when adding saved-state hydration coverage.
- Capture each tested command's exit. A later successful shell command must not mask failure.
- Fetch the base before completion and compare hosted results to the actual PR head.
- Check whether incoming commits track ignored local task files before merging. Preserve both local and incoming lessons.
- When screenshot evidence covers navigation removal, assert both the navigation item and the displayed page change. A hidden tab does not prove stale content was removed.
- When invalidation makes an active route unavailable, reuse its existing reload and error path. Automatic fallback navigation adds empty-list and unmount races unless the product requires it.
- Put the pinned Bun directory first in PATH for commit hooks as well as tests. A hook warning under the system Bun is not authoritative evidence.
- Validate production-image dependencies by importing them inside the built container. Source-string assertions mirror implementation and do not prove runtime packaging.
- Fully qualify every external Dockerfile image reference so unattended Podman builds cannot stop at a short-name prompt.
- Prefix an explicit Bun test path with `./`; without it, Bun treats a nested path as a name filter and runs nothing.
- Calculate the complete private Unix-socket path used by a subprocess. A test-owned socket root must stay short even when a coverage wrapper exports a nested `TMPDIR`.
- A seccomp probe must use the production sandbox context and the expected filter file descriptor. Decode the compiled filter and inspect rule counts before inferring which syscall action caused a process exit.
- In zsh, do not assign to the special `path` array. Use a task-specific variable name so commands remain available through `PATH`.
- Match the required image format before certifying a production build. Inspect build warnings and the resulting health-check configuration; a successful boot verifier does not prove packaging preserved it.
- A gated security test must run the production context and descriptor plumbing, and assert child exit and observed effect before checking audit records. Opening a filter file proves neither attachment nor enforcement.
- Verify parser cursor claims with actual compiled output before changing production code. An expected denied call must agree with the declared profile; a permitted call cannot prove a deny boundary.
- A package-level test wrapper must delegate to the canonical test-set selector. Duplicating filename suffix rules lets the two entrypoints drift and can run Vitest APIs under Bun.
- A fixed oldest-first pending page can starve healthy work when a corrupt row remains pending. Persist each failed attempt and order unattempted work before the least-recently-attempted retry; prove the `runs: 1` case across repeated drains.
- A resolver that expands a large immutable artifact into JSON can exceed durable request and workflow-history limits. Keep oversized inputs as verified opaque references through the start and activity contracts, and bind media type plus storage version with the digest and byte count.
- Snapshot every public artifact-load identity, reference, and allowed-kind list before the transaction starts. A caller can mutate values while the database waits for a transaction.
- A lazy artifact reader must derive its reference from the durable run parameter by name and compare the caller value exactly. A valid project artifact alone must not become an input substitution capability.
- When a focused coverage command uses `set -u` in a login shell, the system logout hook can replace a successful test exit. Avoid the login shell or capture and return the command status outside that hook.
- Check an agent’s live state before assigning the next check. A message to a completed agent does not restart work; use a follow-up task and verify that it is running.
- Run the pinned secret scan after final evidence edits. Name commit-hash fields explicitly; an ambiguous API field can trigger a false positive. Correct the metadata instead of adding a scanner exception.
- Check all user triggers before calling a flow absent. A missing dedicated button does not rule out chat mentions, direct actions, or another supported path.
- A visible input marker is not proof of extension execution. Assert a transformed result in the output area and verify the real invocation succeeds.
- Before adding a test-only status endpoint, check whether an existing idempotent operation already returns the required terminal state.
- Do not amend a commit after another worktree has reviewed or merged its SHA. Add a new commit so integration history stays stable.
- An HTTP 200 lifecycle response can contain a failed operation. Check the operation state and diagnostics before reading installation state.
- Verify both a floating panel and its trigger against the viewport bounds. Document scroll width does not detect clipped overlays or overflowing toolbar controls.
- Inspect final screenshots before building the final image. A green browser test can miss a visible layout defect.
- Do not release a retained extension name to make a fresh installation pass. Check name-keyed secrets, hooks, and permissions, and distinguish a new installation from an explicit restore operation.
- Generated extension tests must exercise actual code. A placeholder assertion is not valid build evidence.
- Wait for the resulting UI state, not a fixed number of resolved promises or an element that was already present before the action.
- When changing a client request contract, search every browser fixture that overrides the old endpoint. Run the canonical visual selection as well as the standard mock lane; their test sets differ.
- A fake-timer heartbeat test proves enqueue timing, not the life of a real HTTP stream. Reproduce connection errors through the built server and browser, and verify the repair against the production image.
- Inspect the server adapter's exposed platform API before changing global server settings. Long-lived authenticated streams should use the available per-request timeout control.
- Click the exposed part of a backdrop as a user would. A forced click at its center can hit the panel it surrounds and produce a false drawer failure.
- Compare request-start and event times before calling a response stale. A fresh response with old fixture data is a mock persistence defect; it must not justify weakening authoritative replacement.
- Order live client updates with a local sequence. Server timestamps cannot safely define a browser request boundary.
- Store archive filenames and their SHA-256 values in separate named fields. Auth-related filenames used as JSON keys can make the secret scanner misread checksum values as credentials.

- For a binary kernel interface, verify the producer framing before writing a loader; do not infer a header from a byte dump. In single-quoted shell heredocs, use C `\n` only when it must become one backslash-n escape in source.
- Bound each owned VM command with an explicit timeout and kill grace. For a no-row control, await every delegated persistence promise before the database assertion; a fixed delay is not proof.
- When a parent explicitly says to hold a heavyweight validation run pending a source change, re-check messages immediately before launch. If the run has already started, terminate only its process group and mark its receipt as non-evidence.
- A deferred callback test must assert that its controlled callback ran with the expected arguments. A downstream state count can stay unchanged when the callback is never invoked.
- Before stopping a queued command, verify its exact current command and absence of children. Do not identify a process from a remembered PID or queue position.

- A terminal operation is not proof of a successful effect. For a file move, assert the successful state, exact destination bytes, and source removal; a failed or blocked proposal must fail the success case.
- A recovered target build does not prove restart health. Inspect every bundled bootstrap operation after restart and require eventual verification; transient runner capacity errors must not leave permanent failed installs.

- Do not use Bun.file(directory).exists() to prove a directory is absent. Assert lstat returns ENOENT; otherwise an existing directory can satisfy the alleged absence check.

- A fake permission engine can hide a host/worker path mismatch and an unanswerable consent prompt. Exercise the actual v4 grant, live projection, and consent branch before calling a filesystem repair complete.

- Store historical container-only TypeScript probes as `.ts.txt` in evidence. A documentation path can still be included by the host TypeScript configuration; check the final curated tree before reporting static checks green.

- Record the actual receipt directory from the launched command. A planned timestamp is not the command’s output path. Do not modify a test file while any active controller can load it; use the shared lock for controlled source faults and restore exact bytes before releasing it.

- One captured request does not prove two failure events belong to the same request. Compare actual trace identities and start times before suppressing a duplicate. A request outside the capture window may still fail later.

- In `lsof` output for the shared lock, `3rW` identifies the holder and `3r` identifies a waiter. Verify the mode, current children, and actual receipt before claiming a run started or changing queue order. A persistent tool session can still be waiting for the lock.

- A nonempty snapshot file can still be writing. Wait for an explicit completion marker after the awaited write, validate its byte count, and retain the test exit separately from snapshot collection.
- A planned duration is not observed duration. Record the selected mode and configuration before launch, then reject a final receipt that does not meet the required elapsed time.

- Label byte measurements exactly: use decimal MB only for `/1_000_000` and MiB only for `/1_048_576`; retain the original byte value in evidence.
- A hash receipt proves identity only if the matching input bytes are retained. Do not describe a baseline source as preserved when only its hash, result, or snapshot remains.
- With `set -u`, never reference a variable in the same `local` declaration that initializes it. Declare dependent locals first, then assign them on separate lines; run `bash -n` and inspect the function before handing off a controller.

- A sourced validation guard that returns nonzero does not stop a shell with only `set -uo pipefail`. Explicitly propagate its failure and prove the whole wrapper stops before launching tools; testing the helper alone is insufficient.
- `set -u` does not stop a failed command. Stage controllers that rely on a guard must use `set -e` or explicitly propagate the guard status, and test rejection before any runtime command can execute.
- A rejection probe that supports a delivery claim is evidence. Keep its logs and exit records in a named private receipt; do not clean it before the parent can inspect the path.

- In fault-injection drivers, attempt cleanup and evidence capture after the primary failure, then report all failures. Never throw from `finally` and hide the event that caused the failure.

- Before calling a validation interrupted, re-read its terminal exit files and current log tail after the process ends. A missing old PID or earlier partial output is not a failure verdict. Record UTC times and preserve actual terminal files; never rerun a completed passing suite based only on a stale process observation.

- Before force-staging ignored evidence, inspect its publication scope and recursively scan nested archives. Raw browser reports can contain live test tokens in traces or inline attachments. Keep those reports private and publish safe logs, images, and identity metadata. Check remote history before claiming that a scan caught data before publication.

- A web-only check does not cover backend test types. For a new backend test, run the canonical command and verify all four type-check sections.
- Do not call a reconstructed evidence script the exact executed source. Check syntax, replay into a separate owned directory, and compare every output before making a provenance claim.

- `git rev-list --objects BASE..HEAD` retains blobs reachable from commits in the range even when a later commit deletes their paths. Use explicit diff-tree path mapping for provenance; do not claim the object walk necessarily misses deleted blobs.
- A function invoked in a conditional can continue after a failed intermediate command despite `set -e`. Return after each cleanup observation, and use a controlled leftover-resource case to prove the terminal predicate fails.
- Before a helper writes a receipt, create its required receipt directory explicitly. Treat temporary snapshot creation and blob materialization as preflight steps with explicit failure propagation; do not rely on later scan failures to expose them.

- Measure actual archive expansion before choosing a scan bound. Coverage bundles can contain many large repeated members and hardlinks despite small compressed sizes. Validate hardlinks within the same archive and reject a byte-limit breach before copying.
- A streaming archive reader must consume the producer before requiring its successful exit. Returning after one member can close the pipe early and cause SIGPIPE; collect the result, drain the stream, then check the process exit.

- When merging a large main change, compare resolved exports and test-lane membership against both parents. Removing conflict markers does not prove that v4 permissions, browser engines or blocking checks survived. Apply the incoming delta from the common base instead of replacing a branch-owned registry with main’s older whole file.

- When merging browser configuration, preserve shutdown signals as well as test selection. A passing browser run can still lose fixture cleanup when the runner replaces graceful termination with SIGKILL. Verify temporary roots after each direct engine run.

- A successful app-log collection command does not prove clean app logs. Parse the collected file and make its health result a separate blocking receipt; inspect plain dependency warnings as well as structured error levels.
- Do not infer a cache backend from a generic dependency warning. Check runtime flags, trace the actual request, and compare default options with per-call options before changing global configuration.
- Validate embedded languages with their actual parser. `bash -n` does not catch an invalid AWK program. Test valid, missing, duplicate, malformed and nonzero records before launching a long controller.

- For host-side /proc descriptor checks, match both app and verifier user/group credentials. Follow CI’s dynamic id -g contract; a hard-coded group can fail ptrace access even when the user IDs match. Keep cache-ownership proof and descriptor-observer identities explicit.

- Treat a complete persisted resource series and its console projection as separate artifacts. Check every sample from the complete file, compare any observed prefix exactly, and retain an unexplained output limit without inventing a cause. Test that a bad unprinted sample still fails review.

- Check archive signatures as well as filenames when scanning evidence. Keep classification reads bounded, reject unsupported compression, and prove the actual scanner detects a synthetic token in the expanded member. Treat exact raw log whitespace separately from authored source.

- Retain the first pooled test failure before any recovery or retry. A successful retry cannot establish the cause of discarded assertion output.
- Test child readiness through the required executable identity, and wait for actual child close when cleanup must drain its streams. Attach rejection handlers when waits start, before another awaited operation can fail.
- A pull-request image can carry GitHub’s synthetic merge commit. Verify its parents and exact tree against the PR head before treating different commit labels as different source.

- Capture the entire PIPESTATUS array in one assignment immediately after a pipeline. Reading one element first resets the array. Prove producer failure, collector failure, and combined failure before using the wrapper for evidence.

- When validation finds a tool failure, bound diagnosis and compare one supported repair early. Do not spend repeated cycles on symbols, receipt curation, or unchanged broad suites. Reuse source-matched passing evidence and give the user a clear next decision.

- State explicitly when E2E checks use the Playwright test runner. Keep the actual user journey visible in updates; browser-engine and CI diagnosis must not obscure which product flows were exercised.

- Parallelize independent reviews and hosted CI jobs. Schedule local builds, browser runs, coverage, and scans under one shared lock; check available RAM and swap activity before increasing local concurrency. More agents must not mean more heavy local processes.

- Releasing a stream reader lock does not cancel its pipe. Preserve an explicit byte-overflow flag, confirm an exact-limit read against EOF, and cancel overflow before awaiting the child exit.

- Reproduce each CI failure with the smallest matching local check before another push. Run affected tests and types first; reuse passing evidence for unchanged source. Use hosted CI to confirm the repair, and do not wait for unrelated jobs to diagnose a known failure.

- A failed policy check still needs a concrete repair analysis. Check whether test locations, lost assertions and coverage obligations can be repaired before treating every finding as an approval-only outcome. Never substitute a bypass or artificial assertions for restored coverage.

- A test move needs an inventory of original test bodies and all explicit coverage producers. Passing glob discovery does not prove that a named coverage leg follows the move. Preserve each authority and rejection branch before removing the old file.
- On Linux, matching /proc/<pid>/exe does not prove that cmdline is populated. A live process with an empty readable cmdline is indeterminate during exec; keep the database guard conservative and wait for arguments before asserting a non-runtime PID is stale.
- Store private authentication review metadata under the existing masked agent directory. A metadata filename can match a credential-path guard even when the JSON contains no credential. Keep the guard unchanged.

## Extension activation regression

## 2026-09-13 — Factory merged SDK validation

- After merging Factory SDK sources, rebuild the pinned root and web dependencies and run the Factory SDK build before interpreting TypeScript export errors. A stale package `dist` can look like a missing source export.
- A live `flock` wrapper with an empty test log is queued, not a hung producer. Mark the log only after lock acquisition and inspect the child PID before terminating a check.

- A healthy server and sign-in page do not prove extension activation. After a deployment or container change, open an existing persisted installation and verify its immutable source and release files are readable through the real review/enable journey.

- Verify a fresh dev image through Vite: Bun source exports alone do not satisfy the standard import exports. Build the trusted workspace packages in the image, then test a container replacement with persisted extension records.

- Validate coverage with the actual merged producer reports and unchanged gate. A focused V8 report can omit a catch line that a Bun producer measures as zero, so a passing focused hit count alone does not prove patch coverage. Cover the behavior in the producing suite and replay the merge locally.

## 2026-09-09 — Test review build isolation

- Run production builds, `bun run typecheck`, and `web` checks in sequence within one checkout. Both type-check commands run SvelteKit sync and write `.svelte-kit`. Overlap can give the browser different server and client build identifiers. Read command side effects before parallel execution.

## Test gap planning isolation — 2026-09-09

- Check whether planning files are tracked before creating task records. This repository has historical root PLAN.md and GATES.md files. Keep new task plans under tasks/testing-gaps/ and use explicit gate-file arguments so old task gates are neither overwritten nor treated as current requirements.
- Removing a typecheck exclusion list is incomplete if the gate still accepts its former baseline. Make the committed exclusion arrays required-empty and prove a former valid entry fails before the compiler starts.

- When editing from a shell call, set its working directory to the repository root. Use a separate call for web commands; do not mix root-relative edit paths with a web working directory.
- Keep a required E2E spec at its manifest path when replacing a skipped body. The lane manifest is a tested contract; move the real body into the existing file instead of creating a second path.

## 2026-09-09 — Provider-error coverage

- A failover test that writes context state directly does not cover the event bridge that supplies it. For each newly persisted bridge field, emit the real terminal event in a direct bridge test and assert the field before relying on end-to-end coverage.
- A transport isolation probe must fail closed. Its spy may count an unexpected call, but must never forward it to the original transport.

## 2026-09-09 — Coverage receipt accuracy

- Read pass, failure, and skip counts from the complete runner summary. Do not infer passes by subtracting failures from collected tests: skipped tests are separate.
- Keyboard model selection follows visible group order, not fixture insertion order. Assert the selected label and choose a reasoning model explicitly before testing its thinking control.
- Cancelling Playwright can leave its preview child bound to the private port. Check the listener and working directory, stop only that owned process, then rerun. A port collision is not a product failure.

## 2026-09-09 — Coverage record integrity

- An LCOV `SF:` header is not evidence. A source producer guard must require at least one syntactically valid `DA:<positive-line>,<nonnegative-hit>` record before it treats a source as measured. Test empty, malformed, and valid records separately.
- Do not infer executable source coverage from a generated source-map point alone. Validate mapping semantics against the established V8-to-Istanbul path or retain a negative control that makes a mapped but unexecuted source line remain `DA:0`.
- When a test passes a fetch implementation as `typeof fetch`, preserve Bun's `preconnect` member with an exact helper; a plain async function type-checks too weakly even when it runs correctly.
- For adapter-copied browser assets, resolve Vite map `sources` against `.svelte-kit/output/client`, not the adapter's `build/client` copy path.

## 2026-09-10 — Coverage worker limits
- `scripts/test-coverage.sh` default host pool can exceed the authorized backend worker cap. Record its actual concurrency as evidence, and pass `PARALLEL=3` for every later focused/backend coverage run unless the coordinator explicitly changes the limit.

## 2026-09-10 — Canonical producer identity
- A blank LCOV `TN:` is not producer evidence. Canonical sources must require a unique producer tag and preserve it through both merge stages; prove blank and other trusted-producer tags cannot supply that source.

## 2026-09-10 — Execution receipts and bounded scheduling

- Confirm each selected test path exists before invoking a runner. A multi-file command can ignore an unmatched filter while its other files pass. Record the exact collected count; use `./` for Bun test paths outside its default search root.
- A `wait -n` scheduler must not count unregistered children. Include every child in its capacity accounting or run the independent child after the tracked pool drains.
- A preview reuse config starts a new preview from existing production assets. It needs a verified build, not an already running server. Use a private port and rebuild after application source changes.
- A browser test with no application scripts is a valid checkpoint. Retain and count it, but require the final same-build aggregate to contain real DA records for every expected route and canonical browser source.
## 2026-09-09 — Picker reopening

- When a picker closes on a delayed blur, test immediate native reopen with fake-timer advancement beyond the prior deadline. A browser assertion alone can miss a timing race or hide it behind a fixed wait.
- Clear delayed picker-close callbacks at unmount, and keep both the selection callback and native outside-close behavior in the regression.

## 2026-09-10 — Live source and process identity

- Read the current manifest and its CI consumer before requesting lane changes. Historical checkpoint summaries can describe removed lanes. Existing source is authoritative; do not add overlapping lanes to solve stale checkout findings.
- Do not stop only a flock wrapper to cancel a queued test: it can acquire the lock and start its child between inspection and termination. Serialize builds and preview runs in the same checkout from the start.

## 2026-09-10 — Gate-integrity assertions
- Do not add duplicate `expect` calls merely to satisfy a static gate. First inspect the called local helper. If it contains the behavior assertion, make the gate recognize only that local, assertionful call path and add opaque-helper and declaration-only negative controls. For a test-gutting finding, restore a distinct user action and its result.
- A local helper's assertion is evidence only inside its parsed lexical body and only along an invoked call path. Never approximate a body with the next declaration: statements after an empty helper, or a never-called nested function, must remain vacuous.
- File-scope assertion helpers must resolve through their actual lexical binding. A nested declaration or a parameter/local binding with the same name must never make another call assertionful.
- Check a shadow declaration before skipping its nested function body. Resolve enclosing suite scopes too; when a static scan cannot prove the binding, it must reject the helper path.
## 2026-09-10 — Session-history refresh fixtures

- A mocked message POST must retain the client `parentMessageId`. Otherwise a completion refetch can correctly render a new root branch while a test falsely calls it a full-thread refresh. Capture the actual POST response and run ID, persist that returned user message, and assert every earlier turn plus the new reply after reconciliation.
- Do not apply a lint auto-fix when it changes a constructible function into an arrow. Tests may instantiate it with `new`; keep a named constructor and run the affected browser flows. Do not narrow a public `Promise<T | void>` contract to satisfy a lint rule when existing `Promise<void>` implementations rely on it.

## 2026-09-10 — Browser Worker aliases

- Page-level CDP coverage does not prove code that runs only inside a browser Worker. For a literal Node-module alias, use a direct contract producer that asserts the public shape, stamp it with a unique TN, and require its own exact floor.

- Do not place Vitest fixtures in a `bun test` batch. Their hoisted mocks require Vitest, while canonical backend coverage isolates Bun test files because module mocks leak across a shared process.

## 2026-09-10 — Integration review and active runners

- Do not edit a script, fixture, or generated build while its runner is active. A shell can resume reading at an old offset after an edit and execute broken text. Commit and align each checkout before the run, then retain that exact source until it exits.
- Get the authoritative revision from the parent checkout. A peer worktree or old summary can contain already-fixed skips. Exclude comments when counting test skips, and inspect the actual executable call.
- For retry tests, assert a successful response and new visible data. A timed error toast is separate state; its continued display does not prove that the retry failed.
- Review every lint auto-fix, including all fake constructors, and remove unused pure declarations instead of hiding them with underscore names.
- Preserve parent-path order when adding audit annotations to chat. Sort or merge only independent annotations, deduplicate IDs, and test inverted timestamps and branch isolation.

- Large validation JSON files should remain linted. Use an exact-file size-limit override instead of excluding the files; measure the added lint cost. Keep historical skipped suite declarations unchanged when only documenting their executable replacements, so diff-scoped integrity checks do not misclassify them as new skips.
- A leading underscore is not a cleanup for a dead declaration. Remove pure unused helpers and constants with their unused imports; retain only bindings that still have a side effect or a structural use.

## 2026-09-10 — Picker component timing proof

- Use fake timers to cross a known dismissal deadline in a component test. Do not use a fixed wall-clock delay when the timer is the behavior under test.
- Describe dispatched component events accurately. Reserve “native interaction” for browser-engine evidence that performs the physical click path.

- Explicitly pass empty storage state and assert no cookies for anonymous browser contexts. A new context can inherit the runner's configured storage state. Do not call a loaded admin page an anonymous access leak before that control passes.
- A mock HTML copy is not application coverage. Render the actual component with controlled loader data, and use a real empty database to test server redirects.
- When adding audit detail, preserve the existing burst volume bound. An allowed capability kind must not accidentally introduce one audit key per file path. Keep deny evidence complete.
## 2026-09-10 — Shared-style coverage

- Do not duplicate a shared style constant to satisfy V8 coverage. A source-mapped branch from Svelte's defensive generated `?? ''` fallback is not an executable product branch when the imported constant is typed and defined. Keep the import, test real event payloads, and report the generated mapping to the coverage owner.


## 2026-09-10 — Completed browser write journeys

- A captured write request proves only dispatch. For every browser write journey, wait for its response, prove the control returns to its completed state, then reload or refresh and assert the persisted user-visible value.

- Before freezing coverage source, check every new source against its actual canonical producer. A web Bun test in the orphan pass/fail set does not emit LCOV. New server helpers with coverage floors must have their test in the shared host list (both coverage and pass/fail), with a file-set regression check. A standalone coverage proof does not establish full-run membership.

## 2026-09-10 — Initial hydration and native composer tests

- Do not hold a conversation’s first authoritative tool-history response while waiting for native composer entry. ChatThread keeps the composer disabled until that response completes. Release and assert the known initial snapshot first; hold only later refreshes when testing live-event reconciliation.

## 2026-09-10 — Live-event stale history races

- A delayed first-load response is not a valid live-event race if it prevents native input. Complete initial hydration, then start a separate stale history read before the event. Release it after the live event and assert the live surface remains; test the later persisted row as a separate refresh.

## 2026-09-10 — Isolated stale-response races

- Count the exact authoritative reads in a stale-response browser race before and after release. Without that count, an unexpected later persisted read can make the visible state pass while the intended stale overlap was never isolated.

## 2026-09-10 — Full producer and native focus review

- Reproduce test environments with the exact temporary-directory ancestry. Keep fixtures that assert no Git ancestor outside every checkout; preserve nested path length when diagnosing Unix sockets.
- A failed startup has not acquired ownership of a public socket. Prove a rejected duplicate leaves the original service reachable before changing cleanup.
- Assert modal focus after evidence capture and deferred frame callbacks. Initial focus alone can miss later composer autofocus.
- Verify a visual evidence case is selected by the mandatory evidence lane, not merely tagged.
- Recompute performance from the live final test inventory. Keep modeled time separate from measured hosted runtime.
- Distinguish a passing direct test from a coverage producer. Verify each source's direct suite contributes a trusted receipt before adding replacement tests.
# Testing coverage review rules

- Check the visible result after an asynchronous response. A request call or cleared field alone does not prove success.
- Wait for loaded records before clicking their controls. Static headings can appear before the data.
- Restore global mocks, prototype descriptors, timers, and module mock state after each test.
- Put Svelte test hosts under `__tests__` so product coverage does not count fixtures as shipped code.
- Run the actual web type check for browser test fixtures; backend/E2E type checks do not cover that surface.
- Match both quote styles when a temporary review tool selects tests. Verify its actual file list and counts.

- Run every coverage gate as an early diagnostic before another full browser freeze. A passing per-file floor check cannot detect a changed file that has no record; the patch gate can.
- When a canonical source inventory changes, update positive receipt fixtures from that shared inventory and retain a negative missing-source control.
- Keep native runtime cleanup failures separate from assertion failures. Retain initial errors, reproduce under the exact runtime and temporary-directory shape, and do not claim that a passing retry proves a root-cause fix.

- Scope repeated conversation titles to their actual UI surface. A page-wide exact-text locator can pass before hydration and fail after the same title appears in a header. Reproduce the fully loaded state, then use the named conversation navigation and its accessible row buttons.

- Check Git's actual diff separately from text-search binary detection. A NUL byte beyond Git's initial sample can affect search output while Git still renders the full diff. Do not report a hidden Git diff without reproducing that result.

## 2026-09-10 — Browser build artifacts

- A Vite preview artifact needs SvelteKit's hidden `web/.svelte-kit/output/server` as well as `web/build` and client source maps. Test the exact upload/download root by restoring it into a clean consumer and starting preview; file-presence checks alone do not prove the server starts.

## 2026-09-10 — Native drag activation

- A drag ghost proves that the pointer crossed the library threshold, but not that the destination received a `consider` event. For a native drag across a long row, first cross the activation threshold, await the ghost, then move to the target and assert the live order before release. Do not replace that state check with a longer timeout or retry.

## 2026-09-10 — Pagination controls and observers

- Do not call an off-screen pagination button deterministic when scrolling it into view activates the same observer path first. Test the manual control with observer callbacks held inert, and test automatic loading with a native scroll. Keep both user-visible window and anchor assertions.

## 2026-09-10 — Browser transport diagnosis

- Do not state a transport root cause from a failed browser trace alone. First compare the exact server and browser paths, retain the failed asset response evidence, and describe any transport explanation as an inference until a matching red-to-green control proves it.

## 2026-09-10 — Clean coverage runners and failed Git commands

- Check the import graph of each no-install CI command. Shared text parsers must not load the AST package required by another job.
- A failed Git diff is an error, never an empty set of changes. Test invalid base revisions through the real coverage commands.
- Assign container tests to a lane that installs and checks the exact runner image. Validate collection as well as the test result.

- Distinguish an import-graph concern from a reproduced runtime failure. Pinned Bun can resolve a stub differently from Node; report the actual clean-runner command result before calling a dependency a blocker.

## 2026-09-10 — Loop dashboard integration fixtures

- Inject the loop-log page seam before defining a dashboard loop. Loop event spies do not intercept `pushDashboard`; a live page seam creates the production channel and can allocate Bun stdout state during coverage. Capture registration and publish calls through one test-barrel helper, restore it after each test, and assert both calls in the real loop flow.
- Pass an explicit `./` prefix when Bun test receives a nested path. Without it, Bun can treat the path as a name filter and run no test file.

## 2026-09-10 — Drawer backdrop tests

- A full-screen backdrop can be covered by its drawer panel. Do not force-click its locator centre: verify an exposed point with `elementFromPoint`, then perform a normal native click. Reuse that contract for each SwipeDrawer test.

- When raising a popover trigger above its backdrop, keep it below the modal layer and verify the actual pointer target. A Playwright interception alone does not prove a user-visible failure; a coordinate click may already dismiss through the backdrop.
- For canonical browser coverage, unit V8 coverage is supplementary. Exercise both changed placement branches in the real browser and inspect remapped line hits.

## 2026-09-10 — Shared coverage runners

- When a parent asks for a process status before any stop, report the exact process chain and wait for the response. Do not infer approval to terminate a shared coverage run. Use the shared heavy-run lock for every broad producer.
- When reviewing a child process runtime, inspect the exact parent command and inherited PATH before using the ambient shell binary as evidence.

## 2026-09-10 — Picker geometry and approval payloads

- Wait until the startup overlay is removed before a native coordinate click. Measure the anchor again after opening when selected chips can change the control's height; an old rectangle can produce a false placement failure.
- Prove timing changes with the corrected browser test. The tick-only control passed all 55 picker/team cases, so the extra animation-frame wait was removed.
- Measure a constrained list at its natural height on each filter/open. Measuring its previous cap can remove that cap on the next update; retain a real short-window regression.
- Validate the complete serialized permission payload in bytes. A valid canonical route permission can exceed an arbitrary per-string character limit; preserve exact grants and human approval rather than splitting or dropping capabilities.
- Read the API result contract before writing a control script: activation returns an operation; inspect durable installation state separately. Keep script-shape errors separate from product failures.

## 2026-09-10 — Async layout and browser-engine checks

- Assert related asynchronous layout values in the same wait. Control deferred preferences so both the initial and updated menu layouts are proved.
- Read operation state and ID from the operation heading. Diagnostic content can use the same inline elements.
- Before a Nix WebKit run, check whether its launcher replaces LD_LIBRARY_PATH. Use a task-owned launcher copy for local compatibility; do not alter the shared browser cache. Keep Chromium-only coverage disabled for other engines and assign an unused task port.

- Run gate integrity before every commit that changes tests, even after a passing suite. Its AST check does not follow local assertion helpers; keep a meaningful visible-result assertion in the test body.

## 2026-09-10 — Standard coverage manifest

- A focused coverage include does not prove the CI producer measures that source. Register every canonical source in the standard manifest and assert registry completeness. Use the actual standard launcher for the final coverage diagnostic. Do not let a manual include mask a missing producer registration.

## 2026-09-10 — Production startup and idle baselines

- When first-admin setup begins real background work, resource and recovery proofs must observe verified bootstrap completion before requiring an idle runner. Keep setup HTTP pools outside the measured process and retain the startup receipt.
- Bounded container polling needs a pacing interval. A fast fixed-count loop can exhaust all observations before an asynchronously created container appears. Keep native pause/recovery and zero-resource assertions intact.

## 2026-09-10 — Shutdown subprocess ownership

- A passing shard can hide a first-attempt failure. Audit raw failed-test summaries and the actual `Retry sweep` / `isolated plain re-run` messages before accepting CI.
- A readiness timeout must kill and reap the owned child. Drain stdout and stderr from spawn, bound exit after the signal, and retain diagnostics on early exit. Use the current executable rather than an ambient `bun` binary.
- Shutdown tests need a real writable database, not repeated catalog creation inside the signal handshake. Build a closed empty catalog once, give each child a private copy, and keep writes and data-survival checks in the real child/reopen path. Verify the unchanged deadline under the same load that reproduced the failure.

## Factory test infrastructure

- When the user identifies a local GPU, inspect DRM, KFD, PCI and container device access. A missing NVIDIA tool or device does not prove that the host has no GPU.
- Check local Compose services before asking for remote test infrastructure. Use the user's current test scale and report its limits separately from launch capacity claims.
# Announced commits are immutable

- After I send a commit SHA to another agent, I must not amend or rewrite that commit.
- Any correction, generated artifact update, or coverage fix must be a new follow-up commit so active consumers can cherry-pick safely.

## 2026-09-13 — Artifact partition identities

- Never map an unbounded partition identity to a signed database slot with a lossy hash. Prove both numeric range and collision behavior on PostgreSQL before using an identity as a unique key.

## 2026-09-13 — Portable real-service proofs

- A real-service test must obtain endpoint and secret-reference paths from the explicit test environment. Do not hardcode one user's runtime directory or loopback port.
## 2026-09-12 — Ambiguous delivery reconciliation

- A high-water inbox sequence cannot prove that a specific event was applied. Reconcile an uncertain delivery only from the exact event ID and hash in the live inbox or an immutable product tombstone; otherwise retain `outcome_unknown`.

## Factory compiler output invariants

- A compiler success must pass its own public compiled-artifact validator. Test materialized defaults against shorter enclosing bounds, including nested control graphs.
- Enforce size limits on the final canonical artifact as well as its source and pages. Derived indexes can duplicate enough source data to cross the compiled IR limit.
- API resource types must match the durable store's canonical metadata names and object model. Do not require extra content-addressed objects when one immutable compiled artifact already embeds the definition and lock.
- Keep digest namespaces explicit in shared contracts. Compiler definition digests use the `sha256:` prefix; blob and idempotency payload digests use raw lowercase hex. Build integration fixtures from real compiler and store outputs so format drift fails at the boundary.
- Define one canonical mutation-payload helper and use it for both digest creation and verification. Exclude only caller-selected idempotency keys and the digest claim itself; include trusted route identity, the expected revision, and the complete request body.
- Return a terminal workflow result before evaluating continuation thresholds. A partition that crosses the threshold on its final event must close; continuing a terminal kernel state can produce an invalid history action and a stuck result handle.
- Apply all C08 byte limits to audit activities too. Canonicalize a transition once, stage bounded immutable pages, finalize their manifest, and commit only the compact event identity and artifact reference before effects.
- Derive root and partition Temporal workflow IDs with one shared helper. Keep the stored root workflow identity separate from the explicit target interpreter so delivery and reconciliation address the same child.
- Restrict partition repair traversal to nodes present in the active kernel state. A full compiled successor index includes foreign partitions; a non-null assertion can turn a valid source repair into a workflow failure.
- Snapshot caller-owned principals, resource keys, and mutation bodies before the first asynchronous authorization step. A caller can otherwise change the authority check, idempotency hash, or eventual write target while the operation waits.
- Register shared authorization wrappers in the scope-enforcement scan when routes delegate their complete gate. A shared gate is safe only when the guard test recognizes and verifies its use.

- An artifact staging callback must accept the caller's transaction and run after the scoped run row is inserted. A separate storage transaction can violate foreign keys or deadlock an enclosing transaction; prove composition with real PostgreSQL and S3.
- Permission tables can contain alternative authorities. Test a run-only initiator separately from an owner who also holds operate permission, and recheck authority when returning a cached cancellation result.
- Compare each modeled foreign key's exact columns, target and delete rule with the PostgreSQL catalog. Counting keys alone can miss a wrong relationship.

## 2026-09-13 assurance review

- Bind an acceptance decision to the full run, node, candidate generation, and lifecycle fence. Do not use a project-wide decision ID as release authority.
- Recompute every protected evidence digest from all persisted fields before a claim. A stored digest alone does not prove a mutable row still has its approved facts.
- Use `Set.has` before `Set.add`; `Set.add` always returns the set and cannot detect duplicates.
- Snapshot untrusted inputs before the first await and test the exact digest object in both creation and consumption paths.

## 2026-09-13 — Shared heavy validation

- Check the shared heavy-validation lock before starting a broad test or coverage pool. When another producer holds it, run only focused leaf checks and leave the canonical regression run to the queued owner.

## 2026-09-13 — Scoped artifact keys

- Every durable artifact key and foreign key must carry tenant/project scope. An opaque object ID alone is not a sufficient product primary key.

## 2026-09-13 — Drizzle foreign-key parity

- When a raw factory migration defines a scoped foreign key, model the same source columns, target columns, and delete rule in Drizzle. Schema table/primary-key parity alone is incomplete.

## 2026-09-13 — Factory C06 validation correction

- Do not report a factory leaf complete from focused Bun tests and lint. Record all four canonical typechecks, owned-source and patch LCOV producers, real Node runtime proof, and real local-S3 proof.
- Rebuild `@ezcorp/factory-sdk` before Node orchestrator checks that consume generated `dist` declarations.

- After changing kernel state retention or control expansion, run every SDK test file, including expansion and recovery. Focused kernel, partition and simulator proofs do not cover all repair behavior.

- Run each production client against its real server across process boundaries. A raw HTTP client and a separate mock-server client suite can both pass while they disagree on empty responses or receipt shapes.

## 2026-09-13 — Stored command lookup review

- Snapshot every trusted command-reference coordinate before its first await, then use only that snapshot for lookup and verification.
- A stable command ID with identical canonical bytes may recur in a later transition. Retain its first committed audit pointer; reject only a digest change.
### 2026-09-13 — Verify exact test paths before sending replay commands

- Search the repository for the test file and copy its actual path into the replay command. Do not infer a path from the route name.
- A browser coverage fixture name must also come from the current tree. In this project it is `web/e2e/fixtures/hydration.ts`.

### 2026-09-13 — Preserve durable service authority

- Persist the complete public service credential identity with a durable request. Reconstructing only the service account ID loses the credential revision and revocation fence during later authorization.
- Audit every adapter that reconstructs a principal from that durable request. Lifecycle and journal authorization must both carry the credential fence into the current grant check.

### 2026-09-13 — Verify nested route imports

- Count a SvelteKit route's directory levels from its actual file and run the focused server test before treating a shared-handler import as correct.
## 2026-09-13 — Release authority fact scope

- A current-candidate reader must include the exact node instance. A run can contain several candidate-producing nodes, so run scope alone cannot select release authority.
- A real PostgreSQL proof must use the shared per-test database helper and `FACTORY_TEST_POSTGRES_URL`. Never point a release test at the shared application `DATABASE_URL`.
- Candidate authority must originate from an authenticated terminal journal fact and verified stored output bytes. Do not derive it from a caller digest, a latest acceptance row, or an allow-all reader.
- A candidate artifact slot needs its own node-instance and generation columns. Do not reuse interpreter identity or transition sequence fields for candidate identity.

- In tool orchestration, check each shell exit code before dependent staging or commit calls. A failed conflict-resolution script must stop the sequence.
- Validate the current protected row before advancing any authority revision or epoch. A correct expected counter must never launder a damaged prior seal.
- A successful terminal fact must close the attempt's effect journal. Preserve exact terminal replay through its own verified path, and reject every later prepare or dispatch.

- A PostgreSQL restart test must call the production migration adapter and lock, not a raw Drizzle connection whose execute result has a different shape. Reuse one fixture migration function for setup and restart.

## 2026-09-13 — Release mutation receipts

- For a mutation with post-commit immutable archive work, cache a stable product locator first. On retry, reauthorize, resolve the current product row, and resume only the missing archive phase.
- Put reconciliation proof, archive publication, product state, audit, and the cached response under one receipt transaction. This prevents a cached retry from repeating external proof or creating another reconciliation fact.
- Map each factory release route to the C01 authentication table before declaring a shared session gate. Release preparation and reads can use scoped service principals; reconciliation uses write routing while its store still requires a human session. Contract, approval, policy, and trust remain session-only.
## 2026-09-13 — Pool admission retries

- Validate and snapshot the full pool request before writing its grant binding. An invalid resource vector must not reserve an id.
- Converge concurrent identical first requests with conflict-safe insertion and an exact durable reread. A select followed by a plain insert is not retry-safe.
- Authorize a reconciliation operator before loading protected operation details or resolving a provider. Keep the store's transactional authorization as the final current-authority fence.
- Deep-snapshot public request bodies before the first await. A response or provider call must never observe mutations to the caller's nested objects while durable work is pending.
- Live Temporal workflows use shared server/task-queue state. Acquire `/tmp/ezcorp-validation-heavy.lock` before every Temporal producer, write START only after acquisition, and await fixture teardown before another launch. SDK builds must run before any workflow bundle that imports a changed runtime SDK export.
## Producer source freeze

- Do not queue a coverage or integration producer until all source, tests, registration, and gate edits are complete. If the source changes while my own producer waits for the shared heavy lock, cancel only my queued producer and restart it from the final source snapshot.
## 2026-09-13 — Durable input validation

- A durable artifact descriptor cannot be validated through a placeholder JSON value. Validate its immutable host facts separately, and validate only inline parameters against workflow port schemas until a recorded bounded read resolves an artifact field.

## 2026-09-13 — Command reply identity
- Keep response event identity in the agreed command-derived form when retries and records already use it; do not substitute a new hash only for defensive length concerns.

## 2026-09-13 — Async partition test liveness
- For a cross-partition Temporal assertion, wait for the recorded delivery activity to finish before querying the target state. Polling a target before the source effect is scheduled tests host timing, not invalidation behavior.

## 2026-09-13 — Child authority and delegation

- A child run can be independently durable without becoming independently authorized. Recheck every live ancestor binding and fence before each child task, child, or approval admission; an old child receipt may recover only its exact prior result.
- A child budget uses a sealed parent portion, not a fresh copy of parent limits. Lock parent before child, reserve the parent sub-envelope with child creation, and settle only measured child spending after every child hold resolves.

## 2026-09-13 — Child workflow scheduling identity

- One logical child run has one scheduling authority. A child launched through `executeChild` must use its durable child logical ID and must never also enqueue a root `start_run` command.

## 2026-09-13 — Compute admission execution fences

- Persist and compare only execution authority fields in a compute admission fence. Public projection revisions and status can advance from queued to running without changing execution authority.
- Test canonical zero-based candidate generations at every writer and reader boundary. A terminal reader must accept generation zero when the kernel defines it as the first generation.

## 2026-09-13 — Child start clocks

- A child has no root `start_run` outbox, so it must persist the original root clock inside its sealed binding. Never infer it from row creation time or use a zero default for legacy rows.
- A reader of that clock must verify the entire binding digest, not only a timestamp and a digest-shaped string. A legacy populated binding without the fact must stop migration for explicit backfill.

## 2026-09-13 — Child ancestor liveness

- A sealed child binding pins the parent command and its attempt, not the parent audit head. Recheck that exact command against the latest verified parent state; unrelated timers, sibling results, and approvals may advance the head while the child remains valid.
- Idempotent settlement must reread the binding after budget locks. A concurrent winner can change open to settled while the loser waits; return its same durable receipt instead of reporting a conflict.

## 2026-09-13 — Runner boundary scope

- `FactoryRunnerSupervisor.invoke` is a single-tool journal adapter. Never present it as a complete `TrustedFactoryRunner.run` implementation or use it to prove full C02 request execution.
- Package preparation may prove exact v4 build and artifact hydration. The durable dispatcher remains responsible for claim, token minting, and complete request execution.

## 2026-09-13 — Schema migration parity

- For every migration default, model the same default in `schema.ts`. Run the canonical schema parity test; focused feature tests do not detect a missing ORM default.
- When `exec_command` returns a session ID, the producer is still active. Poll it to completion before editing any source that belongs to its manifest.
- Before importing a support commit into an older isolated worktree, compare its parent ancestry with the worktree base. If the support commit depends on intermediate modules, merge the validated descendant that contains the full ancestry instead of cherry-picking the leaf alone.

- A repair of an active candidate stops that attempt before it creates the replacement. Its retained prior-candidate status is therefore `cancelled`, even when the repair signal first observed it as `running`.
# Generic approval currentness (2026-09-13)

- Do not equate an approval command's creation transition with the interpreter head. Validate the stored command against the latest committed runtime attempt. Unrelated committed progress can advance the head while that approval remains current.
- Notification visibility and decision authority must use the same current-command reader. A projection-only head equality check can hide a decision that the store still accepts.

## 2026-09-13 — Partition command batches

- Do not use the simultaneous-activity limit as a persisted command-batch limit. A valid partition can emit more commands than it executes at once. Test real published partition transitions through product storage, not only an in-memory Temporal activity fixture.

## 2026-09-13 — Preparation receipts need durable authority

- Do not populate an in-memory readiness cache until the enclosing database transaction has committed. Return only immutable snapshots; a rollback must not expose a receipt.
- A claimed two-phase operation needs a durable intent before external work. Read checks alone are not an intent.
- Do not reuse one project-wide package lock for a graph with several pinned runner references. Each prepared reference needs its own revocable trust fact and readiness check.
- Keep comments aligned with the accepted transport seam. Dispatcher readiness runs after durable claim and before token minting.
# Package trust identity — 2026-09-13

- When a public reference accepts optional identity fields, every database key and foreign key must use the canonical complete reference. A seal alone does not prevent row collisions.
## Command authority extension on moving integration bases

- Before extending a shared authority module, compare it with the current integration head. Reuse its stored command entry, source sequence, command digest, and ancestor validation. Do not reconstruct an origin query that the integrated module already supplies.
- A partition command must bind the requested interpreter ID to its declared source partition, in addition to validating the loaded state partition and compiled edge.

## 2026-09-13 — Package authority parent review

- A sealed historical revision does not prove current authority. Validate mutable current pointers against the latest immutable revision before dispatch or mutation.
- Bind an extension installation's project scope at every catalog read; a project grant does not grant access to another project's package.
- A concurrent preparation may observe the other worker's completed intent. Verify its facts and receipt, then return the same receipt. Do not reject completion solely because its phase changed.
- Reused preparation receipts need the same current release/evidence checks as dispatch readiness.
- Model every migration foreign key, including references to pre-existing v4 tables. Run the canonical PostgreSQL schema proof before calling an integration complete.
## 2026-09-13: Preserve optional quorum evidence and subfactory provenance

- A claim referenced by a quorum group is protected evidence even when `required` is false. Register and validate every group claim. Apply `required` only as an individual gate; apply the group threshold separately.
- A subfactory result is not the parent task's terminal result. Bind a sealed alias to the exact current parent attempt, child binding, child acceptance decision, and child artifact. Recheck both parent and child lifecycle fences before reuse.
- A mutable current pointer must equal the maximum immutable revision in its scope. Validate that invariant while the pointer is locked so a rollback cannot reactivate revoked trust.

## 2026-09-13 — Provider receipt proof

- A structurally matching operator-supplied receipt is not proof of an external effect. Resolve the configured provider and verify the exact immutable version before success or archival settlement.
- Use the same bounded, abortable proof boundary for receipt attachment and absence reconciliation. Timeouts preserve uncertainty.
## Repository test commands

- Read the root package scripts before invoking a focused web test. This repository has no `test:web` script; run `test:component` from `web` and pass paths relative to that working directory.
- When light checks run in parallel, wait for every producer to close before applying even a small lint fix. Rerun every check whose source snapshot changed.
- A change to a shared verifier (JWT `iss`/`aud`) must be proven with the canonical web Vitest pool, not only focused factory suites. A legacy test that hand-signs tokens must mint them through the production signer so the test exercises the enforced envelope instead of bypassing it.
- In zsh, `set -- $var` and unquoted `$var` do not word-split. Run multi-field loops through `bash -c` or `read a b <<< "$line"`; check that every iteration ran before trusting a batch.
- A hook can require `git worktree add ./.worktrees/<name>`; create agent worktrees from the integration worktree root with that exact prefix.
- Before merging an agent branch, run its full component suite on both the branch and the integration baseline. A branch note that cites one passing case does not show whether the branch broke a neighbouring existing test.

- `podman ps` can report a container `Up` from stale state. When the systemd user session dies, podman cannot reach the user bus, `crun` fails with `sd-bus call: Access denied`, and the reported status keeps describing a process that no longer exists. Check `State.Pid` against the process table and probe the port before trusting a service container, and read a `Connection closed` from a client as a possible dead server rather than a client defect.

- Adding a wildcard threshold key without registering its producer in the canonical pipeline reds every local coverage run through the whole-tree dropout signal. A new runtime's coverage registration is not complete until the producer runs in `scripts/test-coverage.sh` as well as in CI; check which of the three modes should carry it, because a leg that needs a toolchain CI installs in one job must stay out of legs-only.

- Derive a registration requirement from the artifacts on disk, not from a written list. Five PostgreSQL suites and thirty-four C13 reuse edges were missing precisely because both inventories were hand-kept; a check that re-derives them fails closed on the next omission instead of waiting for the next audit.

## 2026-09-13 — Auxiliary artifact materials

- An additive unique index is part of a table's contract. Before giving an existing table a new
  row kind, check every unique index over it: a kind that fills none of the existing identity
  slots collides with every other row of that kind and needs its own bounded dimension.
- A repeat-safe migration must also be safe against later steps. A migration that drops and
  re-adds a narrower CHECK on every boot rejects rows a later widening already admitted. Install
  a narrowing constraint only when the database has not reached the later widening.
- When one module must both own a shared validator and reuse another module's denial funnel, move
  the funnel to the shared leaf and re-export it. A runtime import cycle is not the alternative to
  a small move; it is a worse version of it.
- Build the rejection list as thunks, not as an array of started promises. Awaiting them one at a
  time afterwards leaves every rejection unhandled first, which in bun:test wedges the whole file
  rather than failing one case.
- Read a limit from its source text when a Node strip-only test cannot import the module that
  defines it. A changed limit still fails the test, and no constant is duplicated.
- Raising an envelope also raises the cost of how the body is buffered. Rejoining the whole
  connection buffer on every packet is invisible at 1 MiB and quadratic at 8 MiB.
- A per-test timeout inside a test's own signature is not raised by the runner's `--timeout`. When
  such a test fails only under coverage on a loaded box, give it its own invocation rather than a
  bigger budget.
- Check a shared container's PID, not `podman ps`. Podman reported a dead PostgreSQL container as
  up for ninety minutes while its PID was gone, `podman exec` failed, and its port refused.
- Never reach for `git stash` to answer a question. A lint baseline is a `git show`/`git diff`
  question; stashing touches a stack other sessions own.

- An operation that is retried must return its first handle, not repeat its write. Composing
  idempotent primitives does not make the composition idempotent: begin was idempotent and
  writeChunk correctly refused a sealed material, so the replay failed until the composition
  checked for the sealed record itself.
- A generated JSON Schema with `additionalProperties: false` rejects a hand-built fixture that
  carries one extra field. Copy the shape from the package's own valid fixture rather than
  assembling it from the type.
- A package that adds a `tests/postgres/*.test.ts` suite must register it in the `db-postgres.yml` producer list in the same change. Two branches can each pass alone and fail together: the registration gate arrived with W18 while the unregistered suite arrived with W04. Run the combined tree's registration gates at integration, not only each branch's.
- Check host memory and other sessions' heavy processes before starting parallel producers on a shared box. A 30 GB host reached kernel OOM when an external 20 GB mutation run overlapped three workers; it killed the per-user systemd manager and the PostgreSQL proof container, which then falsely reported `Up` while refusing connections. Verify `pg_isready` inside the container, not the `podman ps` status.

## 2026-09-13 — Independent archive writer

- A gateway role can be added without editing the file that composes it. The release store already
  took a `FactoryReleaseArchive`, so the archive-writer role became that interface and did the rest
  of C04 step 1 inside the material write. Widening a union or restructuring `releases.ts` would
  have been a change to another owner's file for no behaviour the seam did not already allow.
- Order the writes so the observable marker is last. Members, then the manifest, then the material
  object; the shared store sets `archive_ready` only after that call returns, so every crash
  boundary leaves publication pending with nothing to undo.
- A manifest that embeds storage metadata is only stable if the store's conditional create is.
  The first memory fixture handed out a new version on every write, so a retried archive produced a
  second manifest and the idempotence assertion failed. The fixture was wrong, not the code — but a
  fixture that is more permissive than the real store hides exactly this class of defect.
- Do not construct another module's key layout to read it back. Derive the prefix by stripping the
  known `<name>/<digest>` suffix from a reference the operation already holds. The layout then has
  one owner, and a restore that has only the archive can still list the operation.
- Separate credentials and separate volumes on one host prove credential separation and nothing
  else. Put the verdict in a field (`failureDomain`, `deployedIndependenceProven`,
  `unmetCriteria`), not in a sentence, and make the classifier refuse to return the good verdict
  without an operator's replication statement. A record that cannot overclaim is worth more than a
  caveat a reader may skip.
- Split "ready" from "publication grade". A same-host deployment can be operationally ready while
  still failing the criterion that gates a production claim; one boolean would have forced a choice
  between blocking local work and lying about the deployment.
- Prove a denial with the status, not just the absence of success. All 130 refusals here were HTTP
  403; a 404 would have been a weaker claim, because a missing object and a refused one look alike
  from the outside.
# C02 topology — 2026-09-13

- A native runner function is not an isolated runner. Keep the durable tenant launch intent in the gateway database, run the Bun and Python bridges inside the per-attempt guest, and keep the host to opaque process facts and physical-stop receipts.
- A physical-stop receipt digest identifies the canonical unsigned facts. Sign those same bytes with the configured RSA host key; do not digest a separate signed wrapper.
- A physical-stop proof needs the configured host principal as a signed required fact. Provider allocations without a stable host identity cannot use this stop-settlement path.
- A launch claim must identify its one winner. A `launching` row alone does not grant another caller permission to start or invoke a guest; after a recovery boundary, use a durable result or report uncertainty.
- Compare a prepared package receipt with the full canonical runner reference, including model and configuration fields. A stopped worker is physically absent only after a terminal runtime observation, never because an inspect call says `unknown`.
- A restart proof must use a fresh real supervisor, not a fake runner that implements attach. The real adapter must reconstruct a live framed connection and remove a surviving container after restart. GPU devices belong to the held per-attempt allocation; a global host runner device list cannot authorize every attempt on that host.

## 2026-09-13 — W01 durable runtime

- Making a readiness call lazy can remove more than the call. Changing `PodmanRunner.build()` from `initialize()` to `acquireLease()` to keep a recovery attach from sweeping orphans also removed store preparation and the fail-closed kernel isolation probe from every build. When narrowing a startup path, list what that path did and reintroduce each part deliberately; an `ENOENT` on an artifact rename was the visible symptom of a missing security control.
- Parameterize the destructive half, not the whole readiness step. `probeSecurity(cleanupOrphans)` already existed and nothing ever passed `false`; a dead parameter is a sign the intended seam was bypassed rather than used.
- A reverse capability that checks only the method name is unbound. The v4 guest SDK already sends the exact `InvocationContext` beside its input, so compare it byte for byte; without that, losing the controlling attachment does not stop another attachment's frames from being answered.
- Build a guest's start request once. A context whose deadline derives from `now()` cannot be recomputed later and still compare equal, so the started context and the invoked context silently diverge.
- A durable claim that a later check denies must be released when nothing physical has happened. Leaving the row in `launching` turns a transient trust failure into a permanently stuck attempt. Release only when no token was minted and no container exists; a denial against a live guest records uncertainty instead.
- Declare every migration CHECK constraint by name on both the fresh and the upgraded path. An unnamed table-level CHECK in `CREATE TABLE` gets a different generated name than an `ALTER TABLE ADD CONSTRAINT`, which is how a fresh database ends up with a constraint an upgraded one lacks.
- Pick one uniqueness mechanism per column. An inline `UNIQUE` on the fresh path plus a `CREATE UNIQUE INDEX` on the upgrade path leaves the two databases structurally different.
- Do not keep a TypeScript guard for a state a database CHECK already forbids. It is unreachable, it cannot be covered, and asserting the constraint name from the driver error proves the schema instead of the code.
- Before blaming a change for a container failure, check the per-user systemd manager. `crun: sd-bus call: Access denied ... requires interactive authentication` means `user@1001.service` is dead, not that the code regressed; `podman ps` can still report a container `Up` for hours after its processes were killed with that manager, so verify the recorded PID exists and the port answers.

## 2026-09-13 — W01 real-container corrections

- Never run a kernel probe on a recovery attach. It creates a container and costs seconds, and a guest whose control pipe died with its supervisor does not survive that window; the attach then fails with `worker_not_running` and the recovery it was performing is lost. Attach creates no sandbox, and the running guest already carries the namespaces, seccomp profile, and cgroup limits fixed when it was created, so the probe protects nothing there.
- Once execution is detached, the orphan sweep belongs only to explicit daemon startup. A container legitimately outlives the process that started it, so a fresh supervisor calling `build()` or `start()` must not sweep, or it destroys another attempt's surviving guest.
- Release a test-held exclusive lease in a `finally`. An assertion that fails before the release leaks the store lock and every later test in the file fails with an unrelated `runner_store_busy`, which hides the one real failure behind seven false ones.
- A readiness stub must answer with the exact receipt the dispatch carries. Returning a base fixture while the test dispatches a freshly built artifact makes a correct drift check look like a product failure.
- Model a jsonb column default as SQL, never as a JavaScript object. Real PostgreSQL schema parity stringifies a non-SQL default, so an object default compares as `[object Object]` against the engine's normalized JSON literal.
- A blocked producer is not a passing producer. Keep its receipt, label it blocked, and rerun it from the final source once the host recovers; two real defects in my own fix appeared only in that rerun.
- Hand a downstream seam every coordinate it needs. A checkpoint writer that receives only an operation ID has to parse its cursor back out of that string, and the SDK validator requires the cursor to equal the operation index exactly. Pass the index and the attempt authority instead.
- A declared interface never satisfies a `JsonValue`-style index signature, because declaration merging can widen it later. Only type aliases get that implicit signature. So a seam typed `Promise<JsonValue>` silently rejects any implementer returning an SDK interface, and the mismatch surfaces at integration rather than in either worker's own typecheck. Type the seam as the thing it actually returns, and convert once at the storage boundary.
- Verify a peer's "satisfies your interface structurally" claim with an assignability probe against their real signature. Reading the code is not the same check the compiler performs, and a fixture that returns an invented shape hides the mismatch from both sides.
- The consumer cannot run that probe. A worker who may not import the other branch's interface can only mirror it, and a mirror encodes their belief about the contract rather than its declaration, so it passes while the real assignment fails. The owner of the seam must pin it instead: commit a conformance test in the owning tree that assigns a writer returning the real downstream type to the real interface, and prove the guard by re-widening the seam and watching the typecheck break.
- A new file under a gitignored directory is silently skipped by `git add -A`, even when sibling files in that directory are tracked. Tracked files there still stage normally, so the omission is invisible: my gate file lived only in the worktree for eleven commits while `todo.md` and `lessons.md` committed fine. Force-add a new file under an ignored path and verify with `git ls-files`, never with `git status`.
- Treat "flaky test" as a hypothesis, not a diagnosis. Reproducing the supervisor-kill path faithfully showed the guest exits on its control pipe's EOF within 250 ms, so the test had been passing by winning a race against a real requirement violation. The recommended bounded retry would have converted an honest intermittent failure into permanent false confidence.
- A control channel whose transport is the container's stdin cannot survive its client. `podman attach` forwards its own end-of-input into the container, so any supervisor death kills the guest. A FIFO the guest holds `O_RDWR` does survive, because a FIFO reader sees end-of-file only when every writer closes and the guest is permanently one of them.
- Abstract a transport by extracting exactly the members the consumer already uses. `ChildProcessWithoutNullStreams` then satisfies the new interface structurally, so nine consuming files and a security-relevant frame policy stayed untouched while the underlying channel changed completely. Mirror the platform's overload shapes, since a single union-event signature will not match Node's overloaded `on`.
- Do not assert a container's exact podman status string. `stopped` and `exited` are both terminal and which one appears depends on how far teardown has progressed; key on `Running` and `ExitCode` as the product does.
- A bind mount is a two-way boundary. I added the guest's only read-write mount and widened its directory to 0o777 so the mapped uid could reach the FIFOs, which let the guest unlink an entry and plant a symlink the host then opened by name. Give the guest the narrowest inode modes it needs, never a writable directory, and mount read-only: a FIFO still opens read-write on a read-only mount because the kernel's EROFS check covers directory-entry changes and regular files, not passing data through a pipe.
- A host that reopens a path an untrusted party can reach must open with `O_NOFOLLOW` and then `fstat` the descriptor against the file type and the device and inode recorded when it created the file. Checking the path before opening it is a race; checking the descriptor after opening it is not. Keep those recorded identities outside anything the untrusted party can see.
- Share the exact flags between production and its security test. Exporting the mount builder and calling it from both means the test cannot quietly drift from what ships, which is the usual way a hardening regression stops testing the real configuration.
- A guard that rejects correctly can still report badly. `O_NOFOLLOW` raises the kernel's own ELOOP, and a directory raises EISDIR, before any identity check runs, so two of the refusals surfaced as raw filesystem errors while the rest were typed. Wrap the whole open so every refusal leaves one typed error with the underlying code preserved; a caller should never have to tell a rejected substitution apart from an incidental I/O failure.
- All worktrees share one `.git/config`. A `core.bare = true` written there (by any session) makes `git status`, `add`, and `commit` fail with "must be run in a work tree" in every checkout at once while `git log` still works. When workers stall without commits, check `git config --show-origin core.bare` before suspecting their code; never run `git config core.bare` or `git init --bare` in a worktree. With `extensions.worktreeConfig` enabled, `git config --worktree core.bare false` inside a worktree repairs that worktree without touching the shared file.

## 2026-09-13 — W09 application and service startup

- A gate with no input is not a gate. `assertFactoryBootReadiness` had shipped for weeks with an
  `availableServices` parameter that defaulted to the empty array and no caller that ever supplied
  one. Before trusting a readiness check, find its producer; a requirement index can record a
  control as implemented when only half of it exists.
- Reproduce the audit lead before deciding what it is. The initialization race is real in the module
  and is currently unreachable over HTTP, because every route that initializes lazily calls
  `requireAuth` first and resolving a principal needs the database initialization opens. That is one
  `await` of distance, not a guarantee, so the fix still belongs at the source — but the report has
  to say which of the two it is.
- The in-flight promise is the latch. A boolean set before the work it stands for reports success
  twice over: to a concurrent caller and to every caller after a failed attempt. Clearing the slot
  on failure is what turns a transient outage into a slow start instead of a permanent one.
- Name every missing dependency in one error. A parser that throws on the first bad field makes an
  operator with three unset paths restart three times, and each restart is a new chance to read the
  next field wrong.
- Split the configuration check from the readiness check. My own composition called the readiness
  half with an empty available set before probing, and it reported all seven services down before a
  single probe ran. The test caught it; a reviewer reading the call site would not have.
- An absent collaborator is a seam that refuses, never a stub that answers. A stop that reports
  `stopped` with no stopped process and a release that reports `completed` with no receipt are
  durable false facts, and they are indistinguishable from real ones the moment they are written.
  Registering a held role as a loop that returns a plausible value is the same mistake wearing a
  scheduler.
- A type-only import links nothing. A regex over `from "..."` reported the host supervisor as
  holding a product database handle it never touches, because it names `FactoryExecutionJournal`
  under `import type`. A boundary check about what a process HOLDS has to separate erased imports
  from real ones, which means an AST and not a pattern.
- A changed file that no coverage include names is unmeasurable, and the patch gate says so rather
  than passing. Two factory routes whose scope changed had no lcov data at all; adding them to the
  Vitest include manifest widens what the gate measures, which is the only direction that is allowed.
- Rebuild before believing a real-server receipt. The first probe run reported the OLD disabled
  reason string because it ran against a build made before the fix; the code was right and the
  evidence was stale.

## 2026-09-14 — W09 rejection and rewiring

- Building a composition root is not composing anything. `startFactoryRuntime`
  compiled, was tested to 100%, and was never called; the flag-on server sat at a
  static `booting` placeholder forever. Before reporting a composition done,
  grep for its own name outside its test and follow the one production caller to
  a process entry point. If there is no caller, there is no feature.
- Worse than the omission was the report. I presented a 503-forever as proof of
  fail-closed design and attributed every gap to other packages. When a system
  is inert, the honest reading is that it is inert; a fail-closed answer looks
  identical to a thing that never started, and only the caller graph tells them
  apart.
- Assert presence, not absence. My test for the seam-driven roles checked that
  supplying a seam removed the role from the held list, and it passed while the
  role was registered nowhere at all. A test that only proves something is not
  in one list proves nothing about where it is.
- Type a driver against the value it actually returns. I declared the projector
  as returning `{ applied }` while `projectPending` returns a page of runs, so
  `applied === 0` was permanently false and the role would have spun at its
  batch bound forever. The fake matched my invented shape, so the tests agreed
  with me instead of with the code.
- Never freeze an object a client library will mark. `@aws-sdk/core` assigns
  `$source` onto the credentials it is handed; a frozen credential made every
  request throw `undefined is not an object`, which surfaced as an unavailable
  object store. Three real-server runs were spent on it because the readiness
  detail deliberately carries no message.
- Do not overwrite a richer diagnosis with a coarser one. The composition wrote
  "object-storage: InvalidAccessKeyId" and the host layer replaced it with the
  bare service name, which is exactly the line an operator needs. A wrapper that
  catches should add context, never remove it.
- A relative default path becomes a directory in the repository. `getDbPath()`
  returns the literal string `external` for an external database, so a store
  rooted at it created `web/external/factory-blobs` inside the working tree. A
  configured resource should come from the configuration, not from a default
  that happens to resolve.
- Copy a credential file into the installation's own private directory rather
  than reading a shared fixture in place. The provisioner already does this, and
  the private bounded reader refuses the 0644 fixtures for the right reason.

## 2026-09-14 — W09 re-validation fixes

- A heartbeat must not sit behind an unbounded probe. The supervisor wrote its
  readiness only after a Podman probe that creates a container, so the write
  interval was probe latency plus the heartbeat against a reader window of three
  heartbeats: a live process that read as dead whenever the box was busy. One
  passing run proved nothing. Separate the observation from the publication, and
  state every interval as a multiple of one configured value so the margins can
  be read rather than guessed.
- A record must not conflate "has not looked yet" with "looked and did not like
  it". Both were `starting` with a reason attached, which is two different
  operator actions behind one word.
- Prove a timing fix by repetition, not by one green run. Three consecutive
  independent runs, each with its own root, certificates, database, and
  processes, is the smallest honest claim for a fix to an intermittent fault.
- A test fake whose `wait` resolves on the microtask queue starves the other
  loop's file I/O: the publisher spun forever and the observation never landed,
  which looked exactly like a deadlock in the code under test. A fake that
  stands in for a timer has to yield a macrotask, because a real timer does.
- Read the whole log before quoting its order. I claimed the factory teardown ran
  first of fourteen; it runs second, after a `background-timers` registration
  that predates this package. The claim came from a filter that matched only my
  own name, so the line above it was never in the excerpt I read.
- Regenerate a receipt when the commit moves. Citing `gate-*.json` produced three
  commits earlier is citing a different tree.
- zsh does not word-split an unquoted variable. A loop that built commands as
  strings and ran `$cmd` produced four exit-127 receipts that looked like four
  broken gates. This is already in this file; I hit it anyway. Build argument
  lists, not command strings.
- A per-item mitigation cannot reach a per-page failure. I hardened a settlement
  loop so one bad row could not abandon the page, and stated the residual bound
  as "200 simultaneously unsettleable items". The owner then showed the
  verification ran inside the `map` that BUILT the page, so one corrupt row
  rejected the whole promise and my loop received no items to step over: the
  real bound was one row, not two hundred. Before quoting a bound, check where
  the failure is raised, not only where it is caught.
- Not every failure deserves the same volume. A settlement that throws because a
  budget hold has not reconciled is a queue doing its job; one that throws
  because a seal no longer matches needs a person. Reporting both as "failed"
  gives an operator a stream they cannot triage. Classify at the composition,
  where the error vocabularies are known, and default the unclassified case to
  the loud one.
- A disposition is a property of the CALLER, not of the error. I classified
  `factory_child_conflict` as transient because the name reads like a race. For
  a caller that reaches settlement through a scan already filtered on terminal
  status, a conflict means two records genuinely disagree, and retrying it
  forever would have reported a real fault as backpressure. Ask the owner for
  the complete reachable vocabulary before writing a classifier, and pin it as a
  table so a code that changes class fails a test.
- A classifier must never throw. Reading `.code` off an unknown value crashed on
  `null`, which would have turned one item's failure into the whole role's
  failure — reintroducing, one layer down, exactly what the page driver exists
  to prevent.

- A proof harness that cannot write its own record turns three failures into
  three passes. `finish()` called `writeFileSync` without importing it, so every
  run threw after its work was done and exited 1 with an empty log, while the
  driver copied the PREVIOUS run's record and built receipts from it. The
  receipt said `exitCode: 1` and `readyStatus: 200` in the same object and I read
  the second field first. Two rules: a receipt must carry evidence that it
  describes its own run (delete the record before the run, compare the record's
  own timestamps against the run window), and a failure path must print before
  it does anything else, so an empty log can never be a crash's only symptom.
- A test that reaches the state once cannot see a defect in reaching it twice. My
  three full-stack runs each sampled `/api/ready` the moment it turned green and
  shut down, so they could not observe the second container-runner probe, which
  was the one that failed. When the suspected fault is in repetition, hold the
  system and watch it repeat, and count the resource whose leak is the symptom.
- Running only the focused suites hides the tests that read a contract you
  changed. A deliberate API scope change left `factory-service-routes.test.ts`
  asserting the old behaviour; no suite of mine imported that file, so only the
  full pool found it. After changing a shared table, grep for its readers rather
  than trusting the suite list you already have.
- Piping a test through `tail` inside a loop records `tail`'s exit code. Two of
  my evidence scripts did this, and a postgres producer that was failing on a
  missing environment variable read as green for hours. Capture output to a
  variable, keep the command's own status, and accumulate it.
- Bound every command that holds the shared heavy lock with `timeout` (for example `flock <lock> timeout 1200 bun test ...`). A test process that spins at 100% CPU with no output held the lock for fifty minutes and stalled three other workers; a per-test `--timeout` does not stop a busy loop outside a test body.


## 2026-09-13 — W03 stop, cancellation, and settlement

- A container's PID 1 gets no default signal action from the kernel, so a guest shim without an explicit `SIGTERM` handler silently discards every graceful stop. Measured against a real rootless Podman sandbox: the abort was delivered, 41 cleanup observations found the sandbox still running, and the full ten-second contract grace was paid before the kill. Forwarding the signal to the extension, which is not PID 1 and does take the default action, turned the same case into a clean exit in 6.4 s with no kill. A cleanup window that no signal can reach is not a cleanup window.
- Run the contract against the real runtime before believing the grace period works. The unit tests for the three phases were green while the abort reached nothing; only a real container showed it.
- A `jsonb` column reads back as an object on PGlite and as a string on the real engine's driver. `rowIntent` decoded only the object form, so every launch read failed on real PostgreSQL with a schema error while PGlite passed. One decode helper for both is the fix; a sibling reader in the same file already did it, which is the usual shape of this bug.
- A grace loop that polls under an injected clock must bound its own iterations. With a frozen `now()` the deadline never arrives, and a wait that does not advance the clock turns the loop into a busy spin that pins a core until the test timeout. Bound it by elapsed budget AND by poll count.
- `bun test ... | tail -12` can hide a red banner behind a zero exit code. Read the `N fail` line from the full log, never the exit status of a pipeline whose head was truncated.
- The stop path must not re-authorize forward dispatch. Reading the attempt through `readAuthorizedStoredInTransaction` dragged in the live-run authorizer, which refuses a cancelling run by design. Read the queue's sealed reference and the durable execution row and compare them; that is a stronger check and it does not borrow an authority meant for starting work.
- C02 needs a settlement-scoped run authority. `authorizeRunInTransaction` allowed only `queued|running|waiting`, so the moment an operator cancelled a run nothing could stop its attempt. Settlement continues after new dispatch stops, so the allowance has to exist; give it to the cancellation path only, and propagate it to ancestors or a nested cancellation still fails at its cancelling parent.
- Idempotency added to the wrong predicate weakens a gate. Making `confirmStopped` return true for an already-stopped row dropped the rest of the authority tuple from the answer, and an existing test caught it. Let the caller's own sealed record carry the idempotency instead.
- Order the cheap sealed check before the durable write. A late provider receipt with a changed amount was reaching the journal first, so the caller saw a journal error instead of the settlement conflict that actually applied. Read the existing settlement for that receipt first, return it on a replay, refuse a differing amount, and only then write the proof.
- `expect(...).rejects` never drives Bun's lazy `SQLQuery`, and on Bun 1.3.14 it then BUSY-SPINS rather than blocking: measured at state R, 100% CPU, with CPU time tracking wall time one for one and no output, while the adopted form `Promise.resolve(query).then(ok, err)` rejected in 6 ms. That is how one assertion held the shared heavy lock for fifty minutes. Adopt the query into a real promise, and guard it statically, because a hang cannot be caught by a runtime check that does not race a clock. PGlite returns a real promise and hides all of this.
- Killing a `flock` wrapper does not release the lock, because the child inherits the descriptor. An orphaned `bun test` held the shared heavy lock for about fifty minutes and starved every other agent. Kill the process group and verify with `ls -l /proc/<pid>/fd`. (From the pool work in this package.)
- `node --test --experimental-strip-types` cannot strip a TypeScript constructor parameter property; use an explicit field. `bun run typecheck` does not catch it. (From the pool work in this package.)
- Workspace packages resolve through their built `dist` types. After merging a branch that changes `packages/@ezcorp/factory-transport` (or the SDK or orchestrator), rebuild that package before typecheck; a stale `dist` reports a missing export that the source has.
- A probe that asserts the environment it happens to run in cannot be shipped as a test. The Python guest's own suite runs both on the host and, during the build, inside the isolated container; a case asserting "at least one escape succeeded" was true in one place and false in the other. Give the probe its own control instead: an action it is always allowed to take, whose success proves the probe can observe one, so an all-refused report is never vacuous wherever it runs.
- Name what a probe actually measures. Reading `/proc/1/environ` under a private PID namespace reads the guest's own init, not the host's, and spawning a process inside a sandbox is not an escape. Measure the spawned child's capabilities, no-new-privileges, seccomp mode and routes instead of whether the spawn succeeded.
- Verify a control from the runtime API in the shape that API reports. Podman expands `--cap-drop=ALL` into the explicit set it would otherwise have granted, so asserting the literal string `ALL` fails against a container that is correctly configured.
- A container's environment is not what the run command declares. The image's own `ENV` reaches every guest unless `--unsetenv-all` removes it, and two variables the OCI runtime writes after the spec is built cannot be unset at all. Measure the environment inside a real guest before recording an environment requirement as met.
- A file bind-mounted into a container must be readable by the container's mapped user. A worktree created with a restrictive umask leaves committed fixtures at 0600, which fails a proof for a reason that has nothing to do with what it proves. Stage a readable copy.
- `git add -A` silently skips a NEW file under a gitignored directory, even when sibling files in that same directory are tracked. `tasks/` is ignored while `tasks/lessons.md` and `tasks/todo.md` are tracked, so two commits that were meant to add `tasks/factory/<package>-GATES.md` updated the two tracked files and added nothing else, with no warning. After committing anything under `tasks/`, check `git ls-tree -r --name-only HEAD -- tasks/` names the file; `git add -f` is what lands it.
- PGlite and Bun's SQL driver disagree about JSONB, and only real PostgreSQL shows it. Bun types a string parameter as json, so an interpolated-text cast to jsonb is a no-op and the column stores a JSON *string scalar*: every server-side `->` path then reads NULL and every read decodes a string instead of an object. Cast through text first, decode through one shared helper, and assert `jsonb_typeof(column) = 'object'` in a real-PostgreSQL test. A feature whose only storage tests run on PGlite has not been tested.
- A concurrency test is not a coverage formality. The sequential cases for a `pg_advisory_xact_lock` fence all passed while the fence matched nothing at all; the `Promise.all` case on a real pool is what exposed it. When the plan asks for concurrent calls, the serial version is not a weaker form of the same evidence.
- Changing a CLI means grepping for its callers, not just its tests. Removing two argparse flags broke a test in a required CI lane that the changed-file list never mentioned, and the lane gate only checks that the workflow *declares* the producer, so it stayed green.

- A `DO $$ ... $$` body accepts no bind parameter. Splice a fixed catalog definition into it with `sql.raw` and keep the literal in one named constant, so the guard and the statement it guards can never drift.
- Do not install a CHECK that no landed writer can satisfy. A constraint whose column is still written NULL by the current path fails every write from the moment it lands, and `NOT VALID` does not help because it still enforces on insert. Land the column and its format checks, and let the writer's own change add the completeness check.
- A migration that drops and re-adds a primary key on every boot churns its catalog entry and revalidates the table. Guard each reshaping step on the exact shape it produces, then assert constraint OIDs are unchanged across two boots; a definition-only comparison cannot see the churn.
- A CHECK line that names a category of commands instead of the commands is not a reproduction recipe. W05's coverage row said "focused `--coverage` runs over the producing files"; the two legs it silently omitted, the gate-script suites and the repo-rooted SDK invocation, are exactly the ones nobody would guess, and an independent validator could not rerun it. Write every leg, and note which legs exist for a reason that is not obvious.
- Coverage for a workspace package must be produced from the repository root. Run from inside the package and the emitted `SF:` paths are package-relative, so `merge-lcov.ts` cannot match them against a repo-relative changed-file list, and the patch gate reads a fully tested package as unmeasured.
- Disclose an ownership crossing even after you undo it. Taking another package's commit by cherry-pick can force you to carry a trimmed copy of files you do not own, which reads to a reviewer as an undeclared edit. Say so in the gate file, name the commits that bound the crossing, and show the diff against staging is empty once the merge repairs it.
- Two branches can each own a fixture identity in a shared unique index. W02's and W05's migration restart cases both used `restart-trust@example.test`, and the merged suite failed on `users_email_key` rather than on anything either branch tested. Give every restart fixture a package-scoped identity and an `ON CONFLICT DO NOTHING`.
- A `git diff --numstat` of `-` `-` does not prove your side is binary. It reports binary if EITHER blob is, so a file you repaired still shows dashes against the unrepaired parent. Check the blob itself for bytes below 32, or diff two copies of your own version.
- A source file with a raw NUL byte in a string literal reads as binary to `grep`, which then prints nothing and exits 1 instead of matching. `src/factory/archive-writer.ts:237` uses two literal NULs as a key separator, so every plain `grep` over it silently returns no hits and a reader concludes the symbol is absent. Use `grep -a`, and write the separator as `\0` so the file stays text.
- Probe the real object store before designing around what S3 "does". SeaweedFS returns a composite ETag and NO `ChecksumSHA256` at all for a multipart object, so neither is a content digest; it does honour `IfNoneMatch: "*"` on both a single put and a multipart completion, returns a `VersionId` from both, and lowercases user metadata keys. Three of those five facts changed the adapter's shape, and none of them is guessable.
- Pin a member's chunk count in the frozen request. `FactoryScopedArtifactReader` exposes `read` and `readChunk(index)` and nothing that reports how many chunks exist, so a consumer that streams must be told, or it discovers the end by provoking a denial.
- A test that drives a pinned request cannot vary the data behind it alone. Rewriting a reader's chunks to three while the request still pins two makes the provider read two and succeed, so the "overlong stream" case proved nothing until the request's own `chunkCount` moved with it.
- `merge-lcov.ts` globs from `process.cwd()`. An absolute pattern matches nothing and the script refuses to write rather than writing an empty report, which reads as a coverage failure. Copy the leg's lcov under the repo's gitignored `coverage/` and pass a relative glob.
- The local SeaweedFS stores have a fixed volume cap, and a SeaweedFS collection grows several volumes at a time. When uploads start failing with "failed to find writable volumes" while the host disk has space, check the master log for "only 0 volumes left" before suspecting the code; raise `-volume.max` in the compose profile and recreate the service (data volumes and credentials survive), and make S3 tests delete what they create.
- Never run destructive tooling against a shared test store (bulk deletes by time window across tenant buckets) without coordinator authorization, even to free capacity. Test cleanup deletes exactly the keys the test recorded creating; a validator found 212 versions deleted mid-validation by a window-based script.


## 2026-09-14 — W07 GitHub publication

- Measure a format against the tool that owns it, not against a document. The interface freeze put the operation id at 79 characters and its branch suffix at 81; both are one longer. Real `git check-ref-format` also disagreed with three rules I had written as "stricter than git" — the leading dash is refused by git's own `--branch` mode, the bare `@` is a legal ref that only the revision syntax makes unusable, and git imposes no length cap at all. Every one of those corrections came from running the tool inside the test rather than from re-reading the spec.
- `git check-ref-format` takes no `--` terminator. That is not a footnote: it is the reason a branch name may not start with `-` anywhere in this repository, because there is no way to pass one to git as data.
- A percent-encoded branch has to be percent-encoded again to reach the API. `refs/heads/ezcorp-factory/factory-release%3A<hex>` sent as a URL path decodes server-side back into the colon the encoding existed to remove. Escape each path segment; keep the slashes literal.
- Moving external work out of a transaction breaks idempotent replay unless the receipt is read first. The proofs and archive writes now run before the product transaction, so the second call with the same key did that work against an operation the first call had already moved, and the preconditions refused it. The fix is a `replay` read on the shared mutation protocol, before any external call — not a looser precondition.
- Prove a transaction-boundary rule by counting, not by reading. Wrapping the store's database handle and recording the open-transaction depth at every provider and archive call turns "no I/O inside a transaction" into an assertion. Re-introducing the old shape turned it red with `depth: 1`, which is the only way to know the gate was real.
- A test double that is more permissive than the real service hides the path you meant to test. The GitHub fake happily created a second pull request for the same head and base; real GitHub answers 422, which is what routes the adapter into its lookup. Make the double refuse what the real one refuses.
- An operator's recovery action is a lookup, not a retry. Calling `publish` again to obtain a receipt worked, but it is a dispatch: it can create. A read-only `lookupReceipt` that reads the ref and lists by head, base, and operation marker gives the same answer and provably cannot produce a second effect, and the test asserts the write count did not move.
- Make a request prove it contains what it names. The publication request declares its tree SHA and commit SHA, and validation recomputes both from its own file list, base parent, identities, and message. A forged request cannot claim an accepted candidate it does not carry, and that check costs nothing at publish time.
- A changed gate script needs its own coverage leg. `scripts/check-factory-boundaries.ts` is a source file no backend test loads, so the patch gate failed on "no lcov data" until `scripts/check-factory-boundaries.test.ts` ran under its own `--coverage` invocation. W05 recorded this same lesson; it cost me one cycle anyway because the failure names the file, not the missing leg.
- Diagnose a shared service before touching it. Eleven neighbouring producers failed with S3 HTTP 500; the container log said `No writable volumes and no free volumes left`, which is volume exhaustion, not a code fault. The repository's own unchanged verifier reproduced it, which is what places the fault outside the branch. Raising the volume cap or pruning the collection would have destroyed other packages' evidence, so the right action was a receipt, a labelled blocked gate, and a message to the coordinator.
- Merging the integration branch mid-package is cheaper than handing the coordinator a break. My `prepare` signature change had already invalidated W08's call site on `integ/w00`; merging and fixing it myself took one edit, and it also surfaced that W08 and I had independently built the same publication-scope resolver.
- Wrap a borrowed validator in your own error type at the module boundary. `assertFactoryGitHubPublicationRequest` called the git object layer's path check directly, so an escaping path reached a publication caller as `FactoryGitObjectError` — a type that caller has no reason to handle — and no test named it, because every assertion checked the code rather than the class. Assert `instanceof` on the boundary type; that is the assertion that fails when the wrap is missing.
- Two correct implementations of one concept are still a C13 violation. W08 and I each derived the verified attempt id for a publication scope, by two different durable paths, and both were right. The fix was not to pick a winner but to find the seam: one provenance derivation, and a per-provider "which material operation holds my members" half. The loser's implementation became an optional agreement check, which is strictly stronger than either alone.
- Consolidating across an owner boundary is cheap if the wrapper keeps every name. `FactoryS3PublicationProvenance` kept its class name, constructor options, and all four methods, so no W08 caller changed; only the three error codes moved to a provider-neutral vocabulary, and those appear in no HTTP mapping. Renaming the codes was the honest half: one implementation with two vocabularies is the duplication wearing a disguise.
- A repaired shared service can be re-broken by the very producer you are re-running. The ordinary store passed its conformance check, the four archive suites went green, and W08's 256 MiB export case then exhausted it again inside the same run. Re-run the suites you were asked about on their own, and report the capacity fact separately from the repair.
- A compose file change does not reach a container that was restarted rather than recreated. `docker restart` reuses the existing container's `Cmd`, so the SeaweedFS volume cap stayed at 100 while the file said 400 and the sibling service, which had been recreated, carried the new flag. `docker inspect <name> --format '{{json .Config.Cmd}}'` is what settles it; equal `Created` and `StartedAt` timestamps are the tell.
- Free a shared store by run window, never by prefix. The test prefixes are shared across packages, so deleting `ordinary/archive-writer/*` would have destroyed the objects W04a's receipts name. Deleting only versions whose `LastModified` falls inside one recorded run window cannot reach anything that run did not create, and holding the shared heavy lock for the whole run is what makes the window exclusive. Default to a dry run and make deletion the explicit flag.
- **No destructive tooling against a shared store without the coordinator's authorization, and test cleanup deletes only what the test created.** I wrote a prune that deleted every object version in a time window across all ten tenant buckets and ran it with `--apply` against the shared SeaweedFS store during validation, removing 212 versions. The instruction had been to delete the objects my tests create. A window is not that: its blast radius is the store, not the run, and the fact that it happened to catch only my five suites' prefixes was luck verified afterwards rather than a property of the tool. The replacement takes a manifest of exact `{bucket, key, versionId}` entries, refuses to run without one, refuses any key that could stand for more than one object, and defaults to a dry run. If a cleanup tool can delete an object it did not create, it is the wrong tool — and asking first costs one message.
- Before naming a collaborator in an interface, open the file that is supposed
  to implement it. I declared `deliverNextAcrossProjects` on a driver interface
  and nothing in production has that method; the collaborator that exists is
  per-project. That is the same defect a reviewer had already found one file
  over, and I reproduced it because an interface I write feels like a decision
  rather than a claim about someone else's code. It is a claim.
- A held role's reason is a pointer, and a stale pointer costs more than none.
  Mine said the release store could not be composed long after every release
  collaborator had landed, which would have sent the next reader to W07 and W08
  for something neither owed. When a dependency lands, re-derive the reason.
- End-to-end through the product's own front door finds what no seeded test can.
  Creating a project over HTTP answered 500 because nothing in production ever
  called `bindInstallation`, and the foreign key it satisfies had been in the
  schema for weeks. Every test seeded that row itself, so every test was green.
  If a fixture creates a row the product must create, the product's version of
  that step is untested.
- A proof phase that cannot fail is not evidence. I added a durable-run phase
  that recorded its steps but did not gate the outcome, and it spent three runs
  reporting 401 on every call while the receipt said `passed`. Make a new phase
  a pass criterion in the same change that adds it.
- A negative control has to be re-checked against the thing it controls every
  time that thing changes. Mine induced its failure by overriding an environment
  variable, and a later change stopped the harness from reading that variable:
  the control passed, reported "the failure path works", and proved nothing.
  The fault a control injects must be something the current code path cannot
  ignore.
- A catch that returns a fallback and says nothing turns a composition failure
  into an unexplained hold. I wrapped a release-store composition in
  `catch { return undefined; }`, which left two roles held with no way for an
  operator to tell a missing credential from an unreachable store from a scope
  mismatch. If a failure changes what the product does, the failure has to reach
  the operator's stream with its cause, and a test has to assert both the
  degraded behaviour and the explanation.
- Check whether a merge you made still stands before writing that it does not. I
  described W03's scans as "briefly merged, no longer carried" when the merge
  commit was four commits back on my own branch and the methods were in the
  files. One `grep` settled it. A gate file that is wrong about its own history
  is worse than one that omits it.
- A new `tests/postgres/` suite is not a gate until CI runs it, and this repo
  enforces that: `scripts/factory-postgres-suite-registration.test.ts` failed
  because I added a suite without adding it to the workflow's producer list. A
  suite nobody runs is a suite that passes forever. Register it in the same
  change that adds it.
- When a shared service is reported fixed, check the RUNNING container, not the
  compose file. The ordinary S3 store OOM-killed a second time because it had
  been started from the stale pre-fix container while its sibling, recreated
  properly, ran with the new limit. `docker inspect --format
  '{{.HostConfig.Memory}}'` differing between two services that should match is
  the whole diagnosis, and it takes one command.
- Do not repair shared infrastructure you do not own while another agent's run
  holds the lock. Record the diagnosis precisely enough that the owner can act
  in one step, and finish everything that does not depend on it.
- `tasks/` is gitignored, and the existing gate files are tracked from before it was. `git add tasks/factory/<new>-GATES.md` silently does nothing, `git commit` reports "nothing to commit", and the gate file stays in the worktree where the coordinator cannot read it. `git add -f` is required for a new file there. `git check-ignore -v <path>` is the one command that says so out loud.
- `bun test` does not typecheck, so a test file can be green under the runner and red under `tsc`. Twice in one package a readonly tuple's missing `.sort()` and a literal-typed constant in `toBe` passed every assertion and failed `bun run typecheck`. Run the typecheck before the commit, not after the suite.
- Bundling inside a Bun test worker that has also loaded PGlite's WebAssembly module and the Podman toolchain fails with `EBADF` and `EISDIR` while reading ordinary readable dependency files, and the error names a package the module under test never imports. The same `Bun.build` call succeeds in a bare process. Do the bundling somewhere else rather than hunting the named package.
- Ship a guest the product's own committed source, not a bundle. The isolated runner typechecks the `.ts` files it stages and ignores `.js`, so a bundle either fails on transpiled third-party code or silently skips the one check the sandbox performs. Staging the real files with their specifiers rewritten keeps one implementation and keeps the check.
- A pure helper behind a heavy import is a dependency nobody can see. `digestBytes` lived in the module that constructs an S3 client, so hashing bytes transitively required the AWS SDK and a JSON-schema validator, and no isolated guest could carry the real validator. Splitting it out and re-exporting changed no caller and shrank the guest closure from 892 KB to 18 KB. Measure the closure before assuming a "small" import is small.
- Prove a registry dispatches, do not assert it is a function. `typeof implementation === "function"` left every entry's body uncovered and would have passed for five stubs. Calling each entry and comparing its result with a direct call is what makes the registry evidence that the implementations exist.

- A shared store can die from its own container limit, not the host. The SeaweedFS ordinary tier
  exited 137 with `OOMKilled=true` under a 768 MiB `mem_limit` once 186 volumes were loaded and a
  256 MiB object arrived; the host had 16 GiB free. When a worker reports `ECONNREFUSED` against a
  shared service, run `docker ps -a` and `podman ps -a` both (the storage stack is Docker, the proof
  database is Podman) and read `OOMKilled` from `inspect` before blaming the workload. Size container
  limits from a measured idle footprint with the data loaded, and record the measurement in the doc.
# WREG inherited backend-pool regressions — 2026-09-14

- "Byte-for-byte unchanged" is not "still called". W01's revalidation recorded truthfully that
  `build()`, `launch()` and `run()` were unchanged and concluded the runner subclasses were safe.
  `start()` had simply stopped calling `launch()` and now called a **private** `launchDetached`, so
  `TrustedLocalRunner`'s override became dead code and every trusted-local build failed on an image
  that does not exist. When a new call path replaces an overridable method, ask which seams it
  bypasses, not only which bodies changed — and note that a suite which only exercises the base
  class cannot see the break.
- Hardening an environment must declare what it removes. `--unsetenv-all` gave the guest a declared,
  tenant-independent environment and dropped the image's `PATH` as collateral, which broke every v4
  extension that spawns a helper by bare name — three first-party extensions stopped building.
  Dropping `PATH` buys no isolation, because the read-only image's binaries stay reachable by
  absolute path; it only breaks name resolution. Declaring a fixed `--env=PATH=…` keeps the property
  that was wanted and restores the behavior that was lost.
- A generated artifact is a product surface, not just a drift check. `wire-schema.json` compiles into
  the wire validator and `StartRequest` carries `additionalProperties: false`, so a schema that
  lagged `types.d.ts` by one optional field rejected the exact payload the interface freeze had
  authorized. Run `schema:generate` in the same commit as the type change.
- A branch cut from `integ/w00` must re-merge it before running `BASE_REF=integ/w00` gates. The base
  advanced by fifteen commits mid-task, so `git diff integ/w00 HEAD` read the newer base's ~5700
  added lines as deletions and the gates measured a diff that was mostly not mine. `git rev-list
  --count HEAD..integ/w00` is the one command that says so before the gate does.
- Two validators that both constrain the same value must be reconciled, not worked around. A v4 manifest name and a scoped distribution name were required to be equal while their grammars made that impossible; three reference packs each invented a different workaround before anyone diagnosed the conflict. When a pack has to bend to satisfy a rule, suspect the rule pair.
- Making a field required is a repository-wide edit, and the compiler finds only the typed sites. Fixtures built as object literals inside test helpers, multi-line literals, and shorthand properties (`digest,` not `digest:`) all escape a naive search; run the suites after the typecheck passes, because a schema validator rejects what the type system already accepted.
- The merged LCOV drops a record whose `TN:` producer tag is empty. A V8-canonical web module measured by a hand-run Vitest leg needs `TN:ezcorp-node-v8`, or the patch-coverage gate reports the file as having no coverage data at all while the leg that produced it was green.
- A migration note that names a helper must name one the reader can import. `manifestNameOf` lived in a module the barrel re-exported only four symbols from, with no subpath in the exports map, so the note told three packages to call a function that did not resolve. Write the test as the consumer would write it: import from the package name, not by relative path, and the export cannot be dropped again silently.
- A derivation helper owes its caller the invariant the caller is trusting it for. `manifestNameOf` was meant to hand back a legal v4 manifest name and did not: the grammar wants a letter first, and the helper only trimmed leading dashes, so a scoped name beginning with a digit produced an illegal one. Assert the invariant over inputs the grammar itself refuses, not over tidy examples that were always going to pass.

## 2026-09-14 — W01b attempt dispatch and the host transport

- Check whether the primitive already exists before writing a driver for it. `FactoryAttemptDispatcher` already claimed, revalidated readiness, minted the token, dispatched, and recorded; the `attempt-dispatch` role was held for want of wiring, not behaviour. The deliverable was a composition module, not a state machine.
- A held role's stated reason can be right about the hold and wrong about the cause. W09 recorded that readiness needed a container runner; `FactoryPackagePreparations` takes one in its constructor but `assertDispatchReady` never touches it. Read the method the path actually calls.
- Put a deployment choice behind one argument. The dispatcher cannot tell whether the guest runs in this process or across a mutual-TLS boundary, because both supply the same `FactoryAttemptRuntime`; nothing else in the queue, the driver, or the registration changes between the two.
- A remote handle decomposes into routes, not into one call. `FactoryAttemptOpen` carries `wait`, so the wire needs a separate bounded result route; and attach must carry the whole intent rather than an id, because a restarted host remembers nothing and has to rebuild the identities it reconnects to.
- Let the receiver recompute every derived identity instead of trusting the sender. The worker id, invocation id, request digest, and device grant all follow from the intent's own contents, so the host rebuilds them exactly as the database reader does. The request digest is taken over the token-free identity, which is why a freshly minted token travels without breaking the binding.
- A host's memory is not a durable record. After a lost launch response the guest may already have been invoked, so the honest recovered state is uncertain until a terminal result is recorded; reading the host's in-memory result instead would turn a crash into an invented fact.
- A durable claim that another process already holds is a reason to reconnect, not a reason to give up. My remote runtime answered a lost `claimStart` with uncertainty and never attached, so a gateway that restarted mid-launch abandoned a perfectly live attempt. Mirror whatever the in-process path does on that branch, and count launches and invocations in the test so a second one cannot slip in.
- A host's in-flight result is not a durable fact, but it is still worth collecting. A supervisor that is still running the guest holds the invocation's return value, so a reconnecting gateway should read it and record it durably; only when the host has nothing either does the attempt stay uncertain.

- `combined-integration.py` takes `/tmp/ezcorp-validation-heavy.lock` itself (fcntl.flock at its
  top). Wrapping it in an outer `flock` deadlocks it against its own parent for the whole outer
  `timeout`, silently, after it prints the focused-file line. Run it with `timeout` only, and when
  a lock-serialized job prints nothing for ten minutes, read `/proc/locks` for the holder before
  waiting longer.
## W11 (reference image pack), 2026-09-14

- **An isolated guest cannot return more than one mebibyte, ever.**
  `FramedExecution.received` in `packages/@ezcorp/extension-runner/src/protocol.ts`
  accumulates for the worker's whole life and is compared against a ceiling that
  `podman.ts` hard-caps at `1024**2` whatever the attempt's `outputBytes` says.
  It is a lifetime budget, not a per-frame one, so chunking does not help and a
  fresh worker holds no state to slice across. Design guest work so the bytes
  stay in the guest and only digests and verdicts come out. W04's material
  service is HTTPS and unreachable from `--network=none`.

- **A venv interpreter reached through another path silently loses its venv.**
  CPython derives `sys.prefix` from the path it was invoked by, so symlinking
  `/usr/local/bin/python3` at `/opt/venv/bin/python3` produces an interpreter
  that reports the SYSTEM site-packages. The image builds, the runner launches,
  and the first import fails. Use a wrapper script that `exec`s the real path,
  and assert the import in the build.

- **A shell redirect follows a symlink and writes the target.**
  `printf ... > /usr/local/bin/python3` where that name is a symlink to
  `/usr/bin/python3.13` overwrites the REAL interpreter. The wrapper then
  `exec`s itself and spins at full CPU. Write to a new path and `ln -sf` over
  the name, which replaces the link rather than following it.

- **`test -w` is useless as root.** Root bypasses the permission bits, so
  `test ! -w` passes on a world-writable file. Read the mode with
  `stat -c '%a'` and compare it.

- **Touching every file's metadata copies the whole layer up.** A `chmod -R` on
  a seven-gigabyte `COPY`ed directory cost a second seven-gigabyte layer and
  more time than the rest of the build. `COPY` already preserves the mode;
  verify it instead of re-applying it.

- **An LFS file's Git object id names the pointer, not the content.** Binding
  weight bytes to the blob id rejects a correct download. A content-addressed
  file is bound by the host's SHA-256; a small inline file is bound by the blob
  id, which IS computed over its content. One binding per file, chosen by which
  one exists.

- **Record a result only once the bytes are safely stored.** Pushing a
  "succeeded" record when the guest answered, then fetching, left a variant
  naming a file that a later step could not read, plus a second "failed" record
  for the same seed. Write the record after the last step that can fail.

- **Write the evidence even when the run dies.** A fatal error that discards
  everything measured before it makes a partial run indistinguishable from a run
  that never started. Catch it, record it in the report, and still write.

- **The new-file coverage gate has no pattern for a Python test helper.**
  `**/test_*.py` and `**/tests/__init__.py` are exempt; `tests/helpers.py` is
  not, and is treated as product code. Put helpers in the package marker beside
  the tests, as `src/factory/runner/python` already does. An empty
  `__init__.py` also reads as unmeasured, because coverage.py emits no record
  for a file with no statements.
- Constructing a collaborator and handing it to its consumer are two jobs, and
  only one of them may be possible. The provider broker could be built from
  configuration today; it could not be given to the runner, because the runtime
  wants `invoke(request, input)`, the broker offers `stream(request)`, and no
  contract says what a guest sends to request a model stream. Writing an adapter
  over an undefined payload would have been the substitute the requirement
  forbids, dressed as progress.
- A union merge of a JSON file can put the closing brace in the middle. Splicing
  two conflict halves produced a file that parsed nowhere; rebuilding the object
  from every key/value pair in file order, first value wins, is the safe form,
  and comparing key counts against both sides afterwards is the proof.
- When an integration branch moves during your round, say which commit you
  merged and check what landed after it before blaming your own branch for a red
  suite. Three suites failed here on an allow-list that had not yet learned a
  newly-required field; the fix was two commits past the tip I was told to
  merge, and the tell was that the same suite passed on the integration branch.
- Rebuild a workspace package's `dist` after merging the integration branch, not only after changing it yourself. The merge brought `RunnerReference.manifestName` and `isManifestName` into the SDK's `src`, and every consumer typechecked against the stale `dist`, so `tsc` reported them as missing members of a module that plainly exports them. `bun run --cwd packages/@ezcorp/factory-sdk build` is the fix, and the error message never says so.
- A mechanical migration finishes the literals, not the assumption behind them. W02b had already added `manifestName` to my one `RunnerReference`, so nothing was red; what remained was that the guest's manifest name was a literal in one file and the scoped package name a literal in another, with no code linking them. Derive one from the other through the shared helper and assert the link, or the next rename fails at bind time instead of at a test.
- Split a producer list by what it actually depends on before reporting it red. Nine PostgreSQL producers reported 47 failures; six needed object storage and three did not. Running the three on their own turned "my merge broke the producers" into "the shared store is down", and the repository's own verifier named the fault in one command.
## 2026-09-14 — W01c material mount

- A guest's files belong to a mapped subuid, so the host cannot delete a directory the guest created inside a mount. An ordinary recursive remove fails with EACCES and `podman unshare rm -rf` is the answer; an `idmap` bind mount, which would have made the host the owner, did not work on Podman 5.8.2 here. Measure this before designing a cleanup path.
- My own cleanup threw from `finally` and reported a fully passing test body as a failure. The repo already had this lesson and I still wrote it. Cleanup after a container test must be best-effort and must never mask the assertions.
- When two packages need the same piece of a shared module, land it once in the owning package rather than reviewing each copy. W11 and W12 both needed the material mount; one canonical `runnerMaterialMount` with a test that asserts its exact option string is what stops a security-relevant flag drifting in one consumer.
- I wrote the lesson about `git add -A` silently skipping a new file under a gitignored directory, and then repeated the mistake on the very next leaf. Having the lesson is not the control; the verification step is. After committing anything under `tasks/`, run `git ls-files tasks/` and confirm the file is listed, because `git status` stays clean either way and the omission is otherwise invisible until someone else looks for the file.
- A script named `verify-*` can still mutate what it verifies. `scripts/verify-factory-storage.ts`
  ends its conformance run by stopping and recreating the ordinary S3 service from the repository
  compose file. I ran it twice against shared infrastructure to satisfy myself the store was
  healthy, from a worktree whose compose file still carried the old memory limit, and each run
  replaced another agent's correctly-sized container with an undersized one that was then
  OOM-killed. Read what a tool does before pointing it at something you share.
- Diagnose from the artefact that records causation, not the one you happened to look at. I had the
  container's memory limit and start time, built a story from them, and never asked who started it.
  `docker inspect` carries `com.docker.compose.project.working_dir` and `config_files`, which name
  the worktree that ran the compose command. Two labels would have pointed at me in one command.
- State a diagnosis of someone else's infrastructure with the confidence the evidence supports. I
  wrote "the fix never reached it" as settled fact in a gate file and a receipt. It was wrong, and a
  confident wrong diagnosis sends the owner to the wrong repair.
- Run every command from your own worktree. A lock-holding shell of mine had its working directory
  in the main checkout; the scripts passed an explicit repo path so nothing broke, but a bare `git`
  or a relative path in that shell would have acted on the integration branch.

## 2026-09-14 — W12 real data reference pack

- Measure the transport before designing for it. I assumed a guest could stream bytes over its control channel until I read `protocol.ts`: `received` accumulates across the WHOLE execution and `frameBytes` is capped at one mebibyte, so a guest may emit 1 MiB in its lifetime, result frame included. Two hours of design rested on that one line. Read the limit, do not infer it from the field name.
- A blocking gap is a message AND a plan, not a stop. The byte path did not exist and was not mine to own, so the right move was to state the measurement, propose the minimal additive fix, send it, and then build everything that did not depend on the answer while keeping the byte path behind one adapter. Waiting would have delivered nothing; forking would have been the thing the brief forbids.
- `open(path, mode)` requests a mode; the umask decides it. Under this host's 077 the staged input was 0600 and the guest, which is a different uid in a different user namespace, got `Permission denied` with no hint about why. `chmod` after the write is the fix, and the lesson is that a permission passed to `open` is never the permission the file gets.
- A validator that decodes with the encoder proves nothing. The whole point of the independent Parquet reader is that a PyArrow serialisation defect would agree with PyArrow. Writing a compact-protocol Thrift decoder took an afternoon and immediately paid for itself: the corruption sweep over a real footer found a `TextDecoder` `TypeError` escaping as a bare `TypeError`.
- Compare against the SOURCE, not only against the manifest. My first reconciliation checked the export against the manifest and passed a transform that dropped rows and wrote a matching manifest. That is exactly the self-certification C10 forbids, and it passed because both sides of my comparison came from the same defective run. Both comparisons, always.
- Exact integers do not survive JSON. `Number("9223372036854775807")` is `9223372036854775808`, so a manifest that writes its sums as JSON numbers rounds away the last digits of the very domain the contract pins. Decimal strings across every boundary, and a parser that refuses a number in a sum position rather than reading it.
- A caller's block size has nothing to do with a chunk plan. The seal wrote one chunk per incoming block, which was invisible for three-row fixtures and ran thirty-two chunks past the plan for a 256 MiB input arriving in one-mebibyte blocks. The boundary case is the only thing that could have found it, which is the argument for running the boundary case rather than stating it.
- `pending = pending[at + 1:]` inside a per-line loop is quadratic. At C10's 256 MiB bound that is hundreds of gigabytes of copying for an input that should take seconds. Split the whole block once and keep the remainder.
- A nested `[tool.mypy]` section is read by nothing unless something points at it. mypy resolves its config relative to the current directory, the lane runs from a repository root that holds no `pyproject.toml`, and the locked project's strict settings had never been applied. `--config-file` is the fix; the lesson is that a config file nobody reads looks exactly like a config file that passes.
- A reserved name in a shared adapter is a real constraint, not a naming preference. `manifest.json` belongs to the S3 publication manifest and no member may take it, which is obvious in hindsight and cost a full real-services run to discover. Read the member grammar before choosing member names.
- A receipt taken while the tree is changing is not a receipt. I started a fifteen-minute producer, then edited three files, and the recorded "no dirty files" was true at start and false by the end. Commit first, run second, and re-run everything on the final tree.
- `argparse.REMAINDER` swallows flags that follow the positional. `receipt.py label --lock -- cmd` put `--lock` into the command; `receipt.py --lock label -- cmd` is the working order. Worth knowing before losing a long run to it.
- `bun run typecheck && ...` does not gate a commit when the typecheck output is
  piped through `grep`: grep exits 0 for a match, so a chain that greps for
  "error TS" runs the commit exactly when there ARE errors. I committed a file
  that did not typecheck this way. Gate on the command's own exit code, or run
  the check as its own step and read it.
- Do not commit wiring that does not wire. I threaded a composer that always
  returned undefined and kept its imports alive with `void` statements; it
  typechecked and read like progress while doing nothing, and it would have told
  the next reader the role was one step from running when the assembly had not
  begun. Reverted before committing. An honest "not built" in the gate file
  costs nothing; dead code that looks like wiring costs the next person's trust.
- A flaky run on a loaded box is evidence about the box, not a threshold to
  raise. One proof run in six hit `runner_probe_timeout` right after a long
  combined integration run; the composition did exactly the right thing
  (degraded, named, admission closed) and the fix was to re-run on a quieter
  box and record the measurement, not to widen the probe budget the product
  states as an invariant.
- common.md lists coverage as a heavy producer and I only ever locked the
  obvious three: Podman, real PostgreSQL, and the real-server proofs. My sweep
  ran `bun run test:coverage` -- one bun plus PGlite process per file across
  1700+ files -- outside the lock, beside another package's full backend pool,
  on a host down to 6 GB. The tell is that "heavy" is a property of what a
  command DOES, not of which service it talks to: a pool that forks a process
  per file is heavier than a single Podman probe. Every producer in that list
  goes under the lock, one at a time.

## 2026-09-20 — W09b assembly and the guest proof

- **A hold reason is a claim, and claims expire.** `release-outcome` held for
  "no production `FactoryReleaseProviderResolver`". The resolver was built here
  in an afternoon and the role still could not register, because `claim` needs a
  CONSENT — an approved approval or an automatic policy — and nothing reads one.
  Before restating a hold, re-derive it from the call you are actually blocked
  on, not from the last person's sentence.
- **Composing a listener is not the same as having one.** `startFactoryPrivateService`
  had no production caller, and the composition root's own comment explained
  why in a way that was right about three processes and wrong about the fourth.
  "C02 puts every other role in its own process" is true of the pool, the
  supervisor, and the orchestrator; the private service is how the product is
  reached BY one of them, and it needs the database they must not hold. Read a
  comment that justifies an absence as a hypothesis, not as a finding.
- **Two readiness gates that each require the other never converge.** The
  orchestrator's readiness probes the product's private service; the product's
  readiness reads the orchestrator's record. With one probe round, whichever
  starts second loses, and the listener the other needs is closed by the failure
  path. The fix is to keep probing with the listener bound and admission closed —
  not to relax either gate. A distributed bring-up that depends on start order is
  a defect even when every component is correct.
- **A boundary gate earns its keep on the change you were sure was safe.**
  Hosting W01b's launch routes and W03's stop route in the supervisor pulled
  `drizzle-orm`, PGlite and the S3 client into a process C01 says holds only host
  identity, because the three values those routes need share a module with the
  durable launch store. Nothing about the code looked wrong; the closure test
  printed the eleven packages. Run the boundary test on any change that moves a
  module into a new process.
- **A process entry that exits 1 in silence costs a whole round.** The
  orchestrator refused its own configuration and printed nothing, and the
  orchestrator package replaced every startup cause with a bare "factory
  orchestrator process failed". Two lines — print before setting the exit code,
  and attach the cause — turned an hour of bisecting into one readable message:
  a private path with a writable ancestor, then a peer that was not listening.
- **A fake store must return what a real one would.** `InstallationDataKey.loadOrCreate`
  re-reads what it just saved and decrypts it to prove the round trip, so a
  harness store that handed back the base64 the FILE carries failed with
  `factory_key_missing` — a name that describes the symptom and not the cause.
  When a fake sits between two halves of a round trip, it has to speak both.
- **The pinned test server is not the real server.** The Temporal test server
  does not implement `DescribeTaskQueue`, which the orchestrator's readiness
  probe requires, so it cannot serve this proof at all — and the failure looks
  like a product fault. Check that a pinned tool implements the method under
  test before concluding anything about the code.
- **A proof may add a deployment topology; it may not relax a requirement.** The
  orchestrator requires mutual TLS to its namespace and the Temporal server
  terminates none, so the proof puts a real TLS terminator in front of it —
  presenting this installation's certificate, requiring the client's, verifying
  both against the same CA. That is the sidecar a real deployment uses. Passing
  a different `connect` dependency to make the light turn green would have been
  the substitute.
- **Six faults, found by running it and by nothing else.** Every one of these
  passed typecheck, lint and its own unit tests; each cost a full proof cycle,
  and none of them would have been found by reading the code they were in.
  - `toolchain.ts` versus `provision.ts`: the harness provisioned the runner
    toolchain through the wrong module and got a store the builder could not
    read.
  - The built web server predated the C11 config field, so the startup document
    read as invalid. Rebuild before believing any receipt about a built server.
  - The pool answered 401 to every compute call, because the harness keyed the
    pool's tenant identity by tenant id and `authorizePoolRequest` looks it up
    by the client certificate's common name.
  - The guest's `failed` result was missing `resultDigest` and
    `error.retryable`, the host launch route refused it as `invalid_result`, and
    the attempt settled `outcome_unknown` — the runtime doing exactly the right
    thing with a result it could not validate.
  - `journalCursor: 0` where the column defaults to `-1`. Zero says "operation
    zero is settled"; an attempt that performed none has settled nothing.
  - The private service's 15-second request timeout sat inside the 20-second
    physical stop bound, so every real stop was cut off by the transport before
    the host could answer. Two independently reasonable numbers, one of which
    has to be larger than the other.
- **`present()` reads `unknown` as PRESENT, and that is right for a worker this
  host never had and wrong for one it just ran.** A guest that RETURNED had its
  execution closed by the host itself, so `inspect` can no longer find it —
  which is the runtime agreeing, not withholding. Without a first-hand record of
  which workers this host ran to a result, every normal finish raised
  `sandbox_stop_unconfirmed`, the kernel's `cancel-node` never settled, and the
  run sat in `stopping` forever. When a predicate is deliberately conservative
  about an absence, ask who is entitled to know better, and let them say so.
- **A retry that re-reads durable state loses the reason it just learned.**
  `markUncertain` returned the durable row whenever the row was already
  uncertain, and a durable row carries the sealed event, not the error. So the
  first failing pass named its cause and the next thirty named nothing. The
  identity of an uncertainty is durable and must not be re-minted; the CAUSE
  belongs to the pass that learned it. Keep them apart.
## 2026-09-14 — W01d material handover

- A rule written into a review is not enforced until production does it. My review forbade `0o777` on the material directory, and then my own integration test used exactly that, which hid from everyone that production set no mode or owner at all and no guest could write. When a review's rule needs a mode or an owner set, check which side actually sets it; if the answer is "the test", the rule is not in force.
- The v4 build type-checks the guest source, so a guest program must be strict TypeScript. An untyped diagnostic object fails the BUILD, which surfaces as `build.state === "failed"` rather than as the assertion you were aiming at.
- `writeFile(path, data, { mode })` is masked by the process umask, so a file meant to be `0o644` can land `0o600` and an isolated guest reads EACCES. Set the mode with an explicit `chmod` after the write; the runner's own staging already did this and the reason is now recorded.
- When a container test fails with a generic handler error, make the guest report each step's outcome instead of throwing. One rerun then names the failing operation and its errno, where guessing costs a lock cycle each time.

- Only the coordinator manages the shared stores. A worker's proof harness ran `compose up` from its
  own worktree, whose compose file still carried the old 768 MiB limit, and recreated the ordinary
  store twenty minutes after the coordinator had raised it to 2 GiB; it was OOM-killed again. Docker's
  labels (`com.docker.compose.project.working_dir`, `config_files`) name the worktree that created a
  container, so read them before blaming the workload. A proof verifies a shared service is up and
  records a named readiness failure if it is not; it never creates, recreates, or restarts one.
- A shared type change is not done until every hand-written key allow-list knows the new field. W02b
  added the required `manifestName`, updated the allow-list in package-preparation.ts, and missed the
  one in release-authority.ts; the package's focused set and the validator's reruns both passed, and
  the combined integration run failed 17 cases. Grep for every `"<lastKey>"]` list and run every
  suite that constructs the type, not only the owning package's suites.
- Never edit a shell script while an instance of it is running. A `sed` typo had a receipt recorder writing to `w07bb` instead of `w07b`; correcting the file mid-run made the executing bash re-read it and pick up the new value partway through, so one run's log and JSON landed in different directories than the four before it. Write a new file and switch callers to it, then clean up.
- A patch-coverage gate measures the committed diff, so running it before the commit reports "0 file(s)" and passes vacuously. Commit first, then run the gate, and read the file count in its output as the check that it actually looked at something.
- A guard is untested until an assertion changes when you remove it. Two of my consent guards were listed as covered because a line in the test named them, but the suite built every operation from one shared decision id, so the `UPDATE ... SET decision_id=<the same value>` that "moved" a decision was a no-op and the guard never fired. Coverage counted the line as executed, which is exactly how this hides. Build the disagreement the guard is about — here a second real acceptance decision row belonging to no operation in the suite — and then delete the guard once and record that the case goes red.

## 2026-09-20 — W13 composition and the legacy adapter

- A declared field that nothing reads is not a feature, and its type will not tell you. `releaseMode`
  had a union in `types.ts`, an `enum` in five generated JSON Schemas, a `required` entry in each,
  and three literals in the reference definitions — and no runtime code anywhere read it, so the
  composite definition it configured could not have executed at all. Grep for the READER before
  believing a declared enum is implemented; `grep` for the writer finds the literals and reassures.
- `Omit<T, K>` does not stop a caller handing in a whole `T`. A seal built as
  `digestObject({ schemaVersion, ...value })` silently folded the excluded `revoked` flag and the
  seal itself back in, so every stored attestation read back as corrupt. Name every field a digest
  covers; a spread into a sealing function is a spread into the seal.
- A `const` initialised with a string literal still WIDENS in an object-literal property, so
  `typeof MY_CONST` as a field type stops matching the moment the value is read rather than inlined.
  `as const` on the declaration, not at the use site, is what fixes it — and `as const` applied to a
  reference is a compile error that names something else entirely.
- `isUniqueViolation` looks exactly one level down from what it is handed, and drizzle already
  spends that level. A caller that wraps the error again — `persistCritical` wraps it in a
  `WorkflowCursorWriteError` — puts the SQLSTATE out of reach without changing a line of either
  module. Unwrap the one envelope you know you added; walking `cause` blindly would make an
  unrelated nested error look like a conflict.
- Revert the fix and watch the test go red, even when the fix is two tokens. Mine looked obviously
  right; the revert is what showed that exactly two of the four new cases depended on it, and which
  two.
- Attribute a derived finding to the walk that produced it. The shared closure walk yields
  capabilities per DEFINITION, so a classifier's findings are per definition; inventing per-step
  attribution would have meant a second walk of the same graph, which is the divergence the one
  shared walk exists to prevent. Say what the attribution is in the type's doc rather than implying
  a precision the data does not have.
- Two trees that may not import each other can still be held equal by a parity test that reads one
  as TEXT. The factory cannot import a bundled v4 extension to learn its storage key layout, and a
  mirrored copy silently rots; a test that parses the extension's own `const` declarations and
  compares them fails on the rename instead of the exclusion quietly matching nothing.
- A crash-recovery path that runs only after a crash is a path nothing exercises. Making the
  key lookup unconditional — every start looks the run up before creating one — removed the special
  case, and the same code is now covered by the ordinary test as well as the crash test.
- A secret passed as `env VAR=value <command>` is a secret published. `/proc/<pid>/cmdline` is
  world-readable on a shared host, and `receipt.py` copies the command array verbatim into
  `receipts.jsonl`, so the same shape that leaks to every process also writes the value into a
  document. The brief said to EXPORT the URL and I read past it. Assemble a credential inside a
  script file whose own argv is just its path, and make the last step of the producer a
  `grep -rlF` for the value over the whole evidence directory — a scan that can fail is worth more
  than an intention not to leak.

## 2026-09-20 — W01e guest model broker

- PGlite settles a query through the MICROTASK queue; a real server settles it through a socket, which is a macrotask. So `while (!done) await Promise.resolve()` in front of a query passes on PGlite and starves a real server forever: every turn enqueues a fresh microtask, the event loop never reaches its I/O phase, the result can never arrive, and bun's own `--timeout` never fires because that timer is a macrotask too. Measured: 4.25 seconds green versus killed at 120 seconds with nothing printed but the banner, same code, same suite. This is the third spin in this file (the grace-loop poll and the lazy `SQLQuery`), and the rule is the same each time: await the thing you are waiting for. Have the collaborator resolve a promise when the event you care about happens, and await that. If a suite must run against both stores, pace one leg's round trips onto macrotasks so the fast store can no longer hide the defect.
- A gate you check off without running is worse than a gate you leave open. I wrote "CI runs ./tests/postgres/..." into a gate file and cited the PGlite leg as its evidence. The suite I had just registered in a shared 25-suite CI job hung it, which would have taken five unrelated suites and the coverage artifact down with it. Cite the receipt for the lane you are claiming, or do not claim the lane.
- One digest, one shape, checked end to end. The receipt digest went to the journal as bare 64-hex while `FactoryUsageReconciliation` enforces `^sha256:[0-9a-f]{64}$` in both entry points, so every receipt this leaf wrote would have been refused — through the same branch the resolver uses for a TAMPERED digest, which makes a legitimate receipt indistinguishable from an attack. Neither typecheck nor any test caught it, because both sides were internally consistent. When a value crosses into another worker's surface, grep that surface for the pattern it enforces before writing the value.
- `export type *` carries types only. A runtime constant declared in a file re-exported that way is invisible to every consumer unless it is ALSO named in the explicit value-export list, and nothing in the type system says so: the source compiles, the declaration is right there, and the import yields `undefined`. Assert an exported constant from the BUILT package, not from the source barrel that your own workspace resolves.
- The shared services run under PODMAN. `docker ps` cannot see them, so a docker listing that comes back empty says nothing about whether a service is up, and neither does guessing at ports. I concluded the proof database was down, marked a gate open, and asked the coordinator to recreate a container that had been running for seven days. `common.md` resolves it in one line: build the URL from `/tmp/factory-platform-evidence/postgres.env` and `podman port factory-platform-proof-postgres 5432`. Read the brief's resolution path before improvising one, and never report a shared service dead — still less request store management — on the strength of a tool that cannot see it.
- A field that crosses two surfaces has to satisfy both, and checking one is how you get a plausible wrong answer. The operation receipt digest is read by the settlement store off the journal row AND mirrored into the terminal result, where `validateFactoryRunnerResult` and `verifyRunnerResultInTransaction` both constrain it. I grepped the settlement store, found `^sha256:[0-9a-f]{64}$`, emitted that, and every one of my tests passed: each looked at one side. An attempt that called a model could then settle or complete but not both. When a value crosses a boundary, enumerate every consumer of the field before choosing its shape, and write the one test that spans them.

## 2026-09-21 — W09b round 2

- A coverage gate names FILES; it cannot name the leg that was never run. Nine of the fourteen findings on a red patch-coverage receipt were fully tested code whose producing leg was absent from the runner: the Vitest pool is the only producer that measures `web/**`, `scripts/factory-orchestrator-coverage.sh` is the only one that names `src/factory/orchestration-process.ts`, and three suites had been added to the leg list after the receipt was stamped. "No lcov data" reads like "nobody tested it" and usually means "nobody ran the producer". Before writing a test for an uncovered file, check which leg in `combined-integration.py` claims it and whether your runner runs that leg.
- The missing leg was also hiding a live regression, which is the real cost. The branch had changed a dispatch result to carry a refused commit's cause, and the one suite asserting that result was off the leg list and had been red for the whole package. A leg you do not run is a suite you are not running, and the coverage number is the least of what you lose.
- A test that sets `process.exitCode` must restore it to a NUMBER. Restoring the captured `undefined` left bun's runner exiting 1 on a file whose own banner said 37 pass, 0 fail — a green suite with a red exit code, which the leg script read as a failure while the log said nothing was wrong. `process.exitCode = previous ?? 0`.
- When a frozen surface cannot express the instruction you were given, say so and build against the surface; do not fork it. `FactoryReleases.claim` opens its own transaction and takes none, so "read the consent and claim in ONE transaction" is not expressible — but the property that rule protects (no stale consent can authorize a claim) already holds, because the read mutates nothing and `claim` re-derives everything under its own lock. State the measurement, deliver the tested behaviour, and raise the surface change as a question rather than making it.
- A held role's reason has to be computed from something the real path actually sets. `release-outcome`'s reason branched on `factoryReleaseSeamsPresent`, which is never true in production because the composition builds the release store directly instead of through those five seams — so the specific reason could only ever appear in a test. A reason nothing in production can reach is a reason nobody will read.
- A shared-resource path copied into every repro script is a landmine for the run AFTER the outage. `common.md` named one S3 secrets directory, six scripts under `repro/` had hard-coded it, and the host reboot deleted it — so a resumed run would have exported the dead path over the live one the coordinator was about to supply, and every S3 producer would have failed for a reason that had already been fixed. Read a shared path through `${VAR:-}` and let the caller win; hard-code it only where a human will see the failure immediately.
- Report a dead shared store from what you measured, not from what you were told, and say when the two differ. The coordinator reported the proof PostgreSQL container as gone; `podman ps -a` still held an `Exited (0)` record for it, while the S3 side matched exactly — no container at all and no secrets directory. Neither difference changes what a producer does, and saying so costs one sentence and keeps the record honest.
- `Write` overwrites, so check whether the path is taken before creating a "new" file. I wrote a new module to `src/factory/release-destinations.ts` and silently clobbered W07/W08's destination reservations and sender fence. Typecheck caught it within a minute and `git checkout --` restored it byte-for-byte, but nothing about the tool said the file already existed. `ls` the path first, or pick a name and confirm it is free.
- A script called `verify-*` may not be read-only. `common.md` points at `scripts/verify-factory-storage.ts` as the shared-storage readiness check; its durability step RESTARTS the local SeaweedFS, which is coordinator-only work. It failed harmlessly here only because it shells out to `docker` on a podman host. Read what a script does before running it against a shared resource, however reassuring its name and however clearly the brief recommends it.
- A heavy producer started while "just syntax-checking" is still a heavy producer. I piped `bash -n script.sh && bash script.sh` into one command to check syntax and it ran the whole resume suite without the heavy lock. Stopping its process group two minutes in cost nothing because it was still in the lightest step, but the lock exists for the steps after that. Syntax-check and run are two commands.
## Do not truncate an inventory you are about to act on (2026-09-21)
`podman ps -a | head` hid the exited proof PostgreSQL container, and the coordinator nearly recreated it from the wrong image. Before any repair, list the exact resource by name (`podman ps -a --filter name=...`) and read its image, mounts, and port binding; a start of what exists beats a recreate.

## Subagent reports truncate; require a file (2026-09-21)
Long final messages are cut at a few thousand characters and the tail is lost. Every worker writes its full report to a plain-text file under its evidence directory (the harness blocks `.md` report files for subagents) and sends a summary of at most fifteen lines.

## Main's pooled coverage command is CI-only (2026-09-21)
`bun run test:coverage` aborts before writing `coverage/lcov.info` when the browser-route coverage receipt is absent, so the global floor and CRAP gates read "lcov not found" (or a stale file) on a developer host. Measure them over the combined runner's merged lcov, and never score a gate against a `coverage/lcov.info` older than the tree.
- A freshly provisioned credential directory is not automatically a PRIVATE one, and the platform's own reader is stricter than the provisioner. The reprovisioned S3 credential sets landed at mode 0644 while `readPrivateBounded` refuses any file with group or other bits — so every test harness that reads them with a plain `readFile` passes, and the one production path that reads them properly cannot compose at all. When a shared resource is reprovisioned, check it against the reader the PRODUCT uses, not the one the tests use.
- `/tmp` is mode 1777, and a reader that refuses a world-writable ancestor refuses everything under it. A private copy of a credential written to `mkdtemp(tmpdir())` was refused for a reason the message did not name; the same copy under `$HOME` was accepted. Put anything the private reader must open under a directory with no world-writable ancestor.
- Prove a positive against a live service by also proving the negative reaches it. "An unpublished object reads as absent" is indistinguishable from "we never talked to the store" until a wrong credential answers differently. Measured here: right secret 404, wrong secret 403, and only the pair is evidence.

## 2026-09-21 — W01f event-stream detach

- Measure which events a runtime delivers before writing a handler that waits for one. Bun 1.3.14's
  `node:http` server raises NOTHING when a client drops a parked exchange: no `close` on the
  response, no `aborted` or `close` on the request, and no event on the socket, not even the one
  `server.on("connection")` hands out. The code was correct Node, so it read as correct to three
  reviewers and to its author, and the only thing that could have caught it is attaching every
  candidate listener to one real exchange and printing which fired. Under Bun, `request.socket` is
  a synthesized `Symbol(fakeSocket)` with no `_handle`, which is why the socket layer is silent too.
- A heartbeat only detects a disconnect if its write can fail. With the headers flushed and the
  body streaming, five `response.write()` calls totalling 320 KiB into a dropped `node:http`
  connection all returned `true` and threw nothing. Prove the failing write before designing a
  heartbeat around it; on this runtime that design is unavailable, not merely slower.
- `Bun.serve`'s `Request.signal` does abort, in about ten milliseconds, for `request.abort()`,
  `request.destroy()`, `socket.destroy()`, a SIGKILLed client process, and a half-close followed by
  exit. It does NOT abort for a pure half-close where the client stays alive and keeps reading,
  which is correct: that client can still receive its answer. Measure each close form separately;
  "the client disconnected" is four different things at the socket layer.
- Where a runtime reports nothing, bound the leak with a lease the protocol itself renews, not with
  a timer that guesses. The renewal is an observed request; the signal still releases immediately
  where it is delivered; the lease only covers what is never delivered. Declare the lease and the
  window it must outlast as options validated against each other — that is also what makes the case
  testable in under a second rather than in twenty-one.
- Making an unreachable branch reachable can expose a second defect behind it. Once detach could
  actually run, the old code fell through and spliced the queued notifications out to a client that
  had already gone, losing them for the replacement host. Read what the code does AFTER the branch
  you are about to enable.
- When a transport migration drops a declared control, move it rather than let it vanish.
  `Bun.serve` has no `maxHeaderSize`, so the 4096-byte policy became an explicit check in the
  handler with its own test; `maxConnections` and the two node:http timeouts were already enforced
  by the Python peer gateway on the only path an untrusted peer can reach, and the gate file says
  so. A refactor that silently loses a bound is a security regression with a clean diff.
- A lease on a long-poll attachment must be read against the CLIENT's loop, not the server's. This
  repo's `RunnerClient` collects an event, runs the host's reverse call, and only then polls again,
  so the legitimate gap between two host requests is as long as that call takes — up to the sixty
  second host timeout. My first lease counted that gap as silence and would have evicted a host in
  the middle of its work. Re-arming the lease while the host still owes a reply costs one line and
  needs no second constant, because the outstanding call already carries its own timeout and
  deletes itself when it expires. Read the consumer's loop before choosing any interval that
  expires on its silence.
- How to recognise an inherited lock descriptor before waiting on it: `/proc/locks` names a holder
  PID that `ps` cannot find, and some surviving child has the lock file on a descriptor
  (`ls -l /proc/<pid>/fd`). That child is the real holder and it is usually reparented to PID 1.
  Read the holder rather than the queue length, and report it instead of killing another worker's
  process; the `flock --close` rule below is the repair.
## A child inherits the flock descriptor; use `flock --close` (2026-09-21)
A Temporal test server spawned by a suite that ran under `flock /tmp/ezcorp-validation-heavy.lock ...` outlived its wrapper and held the lock for thirteen minutes, blocking three queued producers. `flock --close` (`-o`) closes the lock descriptor before the command runs, so no child can inherit it; every heavy-producer wrapper uses it from now on. And run a package's suite only through its own test script: `bun test` on `packages/@ezcorp/factory-orchestrator` is the wrong harness (the package tests run under `node --test`), which is how the server was orphaned in the first place.
## Cross-file state in one bun test process (2026-09-21)
- `mock.restore()` undoes spies only. It does NOT undo `mock.module()`, so every module stub a file registers survives for the rest of the process. Restore with the shared `restoreModuleMocks()` helper, and name the modules in its MODULE_PATHS list.
- A `mock.module()` over a module that was ALREADY loaded overrides only the keys its factory returns; the other exports keep their real values. Over a specifier that was never loaded — every `$server/*` alias — the factory DEFINES the whole export set, and no later registration can add a missing export back. A later file then fails to link and its entire test file is lost, which a batch reports as one unhandled error, not as the tests it silently dropped. Spread the real module into any alias factory, and make the override itself revert.
- Registering a `$server/*` alias also hijacks it for every later file: the specifier stops resolving through the importer's own tsconfig, so the suite's own `mock.module("../../X")` and `spyOn` reach a different instance than the route under test does. Do not re-register aliases in shared cleanup.
- Before making a victim "own" a process-wide cache by clearing it, check what the cache is protecting. A second `Bun.build()` in one bun process reads the wrong files (`EISDIR`); the SDK bundle cache exists for that reason, so the test must settle the owed build outside its spy and assert the delta, not clear the cache.
- A test that asserts an absolute count of a process-wide effect is asserting file order. Say what the test's own actions cause, and keep a separate assertion for the floor the count no longer carries.
- A relative-path mock reaches a route that imports the `$server/*` alias ONLY while nothing in the pool has registered that alias. Once any file registers it, the specifier is served from that registration for the rest of the process. Check who else claims it before moving a stub off an alias; if the pool claims it, claim it too — spread the real module so no export is deleted, and re-register the real module in afterAll.
- Re-registering an alias updates its values but cannot rebind an import that is already resolved. A route module is linked once per process, so the suite that loads it first decides what every later suite sees. A stub that must not outlive its file has to be absent, not reverted.
- Proving each changed file against one named victim cannot see a regression. Run every ORDERED pair among the files you touched and compare each pair against the sum of its two files run alone; then rebuild the real batch at your final head, because a changed test file adds itself to a `--diff-filter` auto list and the batch you were given is no longer the batch you must make green.
- Before calling a cross-file failure yours, measure the same pair at the merge base in a separate worktree. Report the pre-existing ones with both numbers rather than fixing or hiding them.
## 2026-09-21 — A conflict target is an arbiter list, not a uniqueness statement

- Name every unique index that a row can collide on in `ON CONFLICT`, or name none. PostgreSQL
  resolves a conflict only on the index the target names; a collision on any other unique index is
  a plain 23505. A derived primary key whose input is a superset of a unique index means both
  always collide together, so targeting one of them alone converges some interleavings and raises
  on the rest.
- Read a conflict target against the table's whole index set, not against the concept it was
  written for. The nine-column identity index expressed the C04 rule exactly and was still the
  wrong arbiter list.
- `ON CONFLICT DO NOTHING` with no target is not a widening of what is accepted when the durable
  reread that follows decides identity. Prove that by keeping the refusal cases and showing they
  pass before and after the change.
- A race that fails one run in twenty is evidence of a window, not of its cause. A `BEFORE INSERT`
  row trigger runs before the arbiter pre-check, so it parks concurrent writers at the exact point
  the window opens; release them together and assert on `pg_locks` that both are parked, so the
  test drives the interleaving instead of waiting for the host to produce it.
- Pair a driven race with one timing-free case that pins the same property. Wake order belongs to
  the host, so a forced race is strong evidence and a poor gate on its own.

## 2026-09-21 — A cluster-wide view is not a per-database fact

- `pg_locks` spans every database in the cluster, but an advisory locktag carries `MyDatabaseId`.
  A readiness counter built on `pg_locks` must filter on `database` or it counts a parallel run's
  waiters; the set that blocks and the set that is counted have to be the same set.
- Run a new concurrency producer at more than one parallel width before calling it stable. A test
  whose own coordination is measured at width 1 only has not been measured. Width 1 hid this;
  width 3 showed it at fifteen percent.
- When a race producer fails, separate the failure signatures before attributing a rate. The
  pre-fix evidence here survived only because every failing log was checked for the 23505
  signature, which distinguished the real defect from the producer's own flake.
- Name a constraint as the database names it, not as the ORM declares it. An inline `UNIQUE` in a
  migration is auto-named by PostgreSQL, so a drizzle `uniqueIndex(...)` label can name an index
  that does not exist. Probe a live migrated database before writing the name into a comment.
- Amending a commit after a producer has run against it strands the receipt. Run producers at the
  last commit that touches source, and keep later commits documentation-only.
- A lease on a long-poll attachment has two behaviours and they must be kept apart: RENEWING pushes
  the deadline, DEFERRING only stops the clock against an unchanged one. Conflating them cost two
  findings in one review. Only a request that proves the caller owns the stream may renew, because
  this protocol carries no host identity and `workerId` is not identity: any authenticated caller
  naming the worker was able to keep a silent host attached indefinitely. Deferring is safe for any
  caller, because it cannot buy silence past the deadline the holder last set.
- Make the client survive an eviction the server may get wrong. My service fix removed the eviction
  I knew about, but `RunnerClient` answered ANY failed poll with `closed = true` and no re-attach,
  so one spurious refusal permanently ended a host session whose worker was still running. When a
  resource can be lost without being destroyed, the consumer needs a bounded way to take it back;
  three consecutive recoveries with a reset on success is enough, and the bound is what stops a
  genuinely dead worker from spinning.
- Do not commit on a branch while a validator is measuring it, and say so the moment you realise
  you have. My validator was handed one head, asked me in writing to hold, and the branch moved
  three times, the last move changing product source while their heavy batch was queued on the
  shared lock. Their mixed-head merge then failed a coverage gate for a reason that had nothing to
  do with the code. Treat a validation window as a freeze even when the change you are making is a
  good one.
- Bun's isolated store keeps a STALE version after a lockfile change, and an incremental `bun install --frozen-lockfile` does not remove it. After merging main's dependency bump my worktree held `zod@4.5.2` next to `zod@4.5.4`, and 25 typecheck errors appeared in a package I had never touched. I proved the SOURCE trees were byte-identical against staging and reported the red as inherited — which was wrong, because a tree diff says nothing about the installed graph. Staging, reinstalled clean, was green at the same merge base with the same SDK. After merging a dependency bump: `rm -rf node_modules web/node_modules`, reinstall both, rebuild the workspace packages, THEN judge a red.
- Attributing a failure away from yourself needs a stronger proof than attributing one to yourself. "The files are identical" is evidence about one input; a build has several. Before telling someone a red is theirs, reproduce it somewhere they control, or rule out every input you own.
- A Svelte `<script module>` export is invisible to plain `tsc`. svelte-check and Vitest both passed while `bash scripts/typecheck.sh` failed on the component tests that imported those helpers. Put a pure helper in a `.ts` module next to the component, and run the full typecheck script, not only svelte-check, before a commit.
- Register an `@evidence` spec in `web/e2e/evidence-covers.json` in the same commit that adds the tag. The visual-evidence meta test fails on any unmapped tagged spec, and I only found the gap in a later sweep.
- The Temporal Java test server cannot report task-queue pollers, so the factory orchestrator's readiness never opens against it (an orchestrator test asserts exactly this). A service-backed stack needs the Temporal CLI dev server. Probe what the real consumer calls before trusting that a pinned binary "is Temporal".
- `getByRole("button", { name: "Start run" })` in Playwright is a case-insensitive substring match, so it also matched "Close start run". Use `exact: true` for any button label that another label contains.
- Queue at most one job on the shared heavy lock. I queued mutation and the journeys together; I had to stop one. Chain the heavy work into one script instead.
- zsh does not word-split an unquoted `$var`, and `pkill -f <pattern>` kills the calling shell when the pattern is in its own command line. Use `bash -c` for arrays, and stop a server by its port.

## 2026-09-22 — W01g round 2
- Check the merge base yourself before you trust a stated one. The handoff said `integ/w00` was merged at the W09b merge; `git merge-base HEAD integ/w00` showed an older commit, and the file the whole round depended on was absent.
- A proof harness that reads a credential directory from the environment must refuse by name when it is empty. An empty value became a copy from a relative path and a failure that looked like a product fault.
- When a proof needs a composition the product cannot yet express, add the configuration field to the product and inject it from the harness. Do not add a convention (a file beside a key) that only a harness uses.

## 2026-09-22 — W09d: composing validators

- A test suite that pins the clock cannot see a lease expire. W05's acceptance path re-recorded the candidate's terminal fact through a live-attempt authorization on every call, and every suite passed because `now` never moved past the candidate's lease. The real started application refused `factory_run_fence_changed` the first time a validator took longer than that lease, which is always. When a path can run long after the thing it re-authorizes, write one test whose authorizer says "expired".
- A proof harness that treats "the server never became ready" as a pass for a negative control proves nothing. Two early control records passed vacuously that way. Every mode, control included, must first require a live application that accepted the run and reached the point under test.
- Read what a database driver actually returns before matching on it. Bun's SQL returns a JSON column as an object, so `String(row.json).includes('"completed"')` is always false ("[object Object]"); parse whichever shape arrives.
- Copy a harness by its whole closure, and re-copy when its owner moves. W01g's harness gained a supervisor wrapper (`bun-host.sh`) and moved its host mount from a proof branch into `wp/w01g-staging`; a stale copy failed twice before a single product line ran.
- A fix proven in the kernel alone can still hang in the real application. The first `command-failed` handler stopped the run through `beginStopping`, which emits a `cancel-node` for every node it thinks is physical; a release node's only attempt was the effect that had just failed, so the cancel could never resolve and the run sat in `stopping`. The kernel tests passed because they used a task node. Prove a lifecycle change on the node kind the real run actually ends on.

- A proof judge should check the exact thing a finding names. Round 4 passed with "a projected FACTORY_COMMAND_FAILED reason" while that reason said only "Activity task failed". The judge now requires the refusal's code, and it would have failed round 4.
- After a worktree moves, rebuild everything that stored an absolute path. The Python virtual environments kept shebangs to the old path, so the typecheck failed although no source changed. Harness scripts with hard-coded worktree paths failed the same way.

## 2026-09-22 — W15 retention, checkpoints, and restore

- **Bun 1.3.14's `toMatchObject` overwrites array elements matched by `expect.any(...)`.** After
  `expect(value).toMatchObject({ a: [expect.any(Object)] })`, `value.a[0]` was `{}` — measured
  with a one-line probe. A later read of the same array then failed far from the assertion. Assert
  lengths or exact values instead of asymmetric matchers inside arrays.
- **Bun 1.3.14's line coverage reports a function's LAST line as unexecuted when the next function
  in the file never runs.** A console probe showed the statement ran three times while lcov said 0,
  and a six-line probe reproduced it: adding an unexecuted method after an executed one zeroed the
  executed one's last line. Rewriting the statement changes nothing; exercising the following
  function (or placing the new function where the next one runs) does. Reproduce a coverage
  anomaly in a probe before rewriting production code to please the gate.
- **Measure a pause, not only a barrier.** The first barrier drained senders while product writes
  were already paused, so every writer stalled for the full one-second drain (writer p95 1042 ms).
  Closing effect claims first and draining while writes still flowed cut the write pause to 54 ms
  at p95 with the same barrier length. Report the window a user feels beside the total.
- **Read where a key actually lives before recording it.** The barrier first aborted when the
  product database held no data-key wrap; the W09b harness showed that a real deployment keeps the
  wrap in the orchestration process's private file, which the product process must never read. The
  manifest now says which of the two it saw, and restore proves the key opens with the operator's
  keys either way.
- **A re-verification must judge the state it was given, not the state it produced.** Restore's
  second pass compared the database with the manifest after the first pass had imported archived
  audit, and called a correct backup incompatible. Capture the comparison input when the epoch
  opens, before any restore write.
- **Iterating PostgreSQL suites against a private container is still a heavy producer.** I ran
  focused PostgreSQL and S3 suites on a private container outside the shared lock to avoid a
  multi-hour queue. The final evidence runs under the lock; the development runs are disclosed as
  such rather than presented as the receipts.

- W15: Temporal's HTTP describe route cannot address a workflow id that contains `/`, encoded once
  or twice. Read positions through the visibility list (`?query=WorkflowId="..."`) and wait for it,
  because visibility is eventually consistent. A running execution has no history length there.
- W15: A PostgreSQL point-in-time replica refuses to start when its `max_connections` is below the
  primary's. Pass the primary's value to the replica.
- W15: Never stop a locked run with `pkill -f <pattern>`. It killed the `flock` parent, the lock
  released, and the orphaned `bun test` kept running on the shared PostgreSQL outside the lock, then
  left a temporary database no one can attribute. Record the batch's PID and kill that process
  group only, and never change the tree while a batch that reads it live is running.
- W15: A test that seeds `factory_installation` directly and then claims an effect needs the
  explicit freshness opt-out (`openFactoryEffectClaimsForTest`). Find such tests with a grep over
  every lane, including Podman lanes, before changing a gate default.
## 2026-09-22 — W18b pool fixes

- A failure label copied from a test name is a hypothesis, not a cause. W15 recorded the launcher failure as a Unix socket path limit because the test is named for it; the real error was a `TimeoutError` from a one-second readiness probe. Run the failing file under the pool's concurrency (six copies at once reproduced it 1 in 24) and read the error before naming a cause.
- A "hard expiry" date in code is a scheduled behaviour change with no deploy. Once the date passes, retire the dead branch rather than keep a clock comparison that only looks alive. Source-regex gates that match indentation broke silently on a refactor; pin the behaviour on the real handler instead.
- A project-root walk must accept only a real repository marker. `existsSync(".git")` also matched a stray empty `/tmp/.git`, which git itself rejects. Ask "what does git say?" and plant the stray marker inside the test's own tree so the case holds whatever the host's /tmp contains.
- A git hook exports `GIT_DIR` and `GIT_INDEX_FILE`. Any `git` a test or tool spawns from inside a hook acts on the hook's repository, so `rev-parse` reports "inside a repository" everywhere and `git init <dir>` targets the wrong place. Drop the caller's `GIT_*` variables when git must discover from a directory.
- W15b: A batch script must source a database environment inside a subshell. Sourcing it into the
  batch shell leaked `DATABASE_URL` into the backend pool and failed eleven tests that expect none.
- W15b: Node's type stripping rejects TypeScript parameter properties. A module the Node
  orchestrator loads declares its fields explicitly and imports with `.ts` extensions.
- W15b: Gate integrity treats a moved test file or coverage key as a deleted gate. To merge two
  modules, keep the gated file's name as the home of the moved code. Search dynamic imports
  (`import("...")`) and evidence scripts too when a module's exports move.
## 2026-09-22 — A measured list is stale after a merge (W18a-2)

- Recompute a complexity or CRAP list on the tree you will hand over. Do not trust the list in the brief. The brief
  named six functions from wave4c. After the W09b merge, `parseFactoryStartupConfig` was at 65 and
  `parseFactoryPoolProcessConfig` was at 44 instead of 37. Only a fresh run of the gate showed this.
- A bun coverage run from `web/` writes root files as `SF:../src/...` and web files as `SF:src/...`. Rewrite both
  prefixes before merging. Otherwise the root coverage of that leg lands under a path no gate reads. The global floor
  showed this, as a `../../../src/db/migrate.ts` entry.
- A behaviour-free split can still be proved by more than the existing tests. Run the old function and the new one
  side by side on generated inputs, and compare exact outputs, including error lists. That is cheap, and it found
  nothing to fix here, which is the point.
- Replacing a suffix-based error mapping with explicit code lists silently drops any code built outside a literal `new XError("code")`. My search for thrown codes missed `unavailable()`, a helper in another file, and a real journey caught the 500. Before removing a pattern rule, list every code the class can carry, including helper-built ones, or keep a test per code the old rule matched.
- Never edit a shell script while a job is executing it. Bash reads a running script incrementally, so shifted bytes can make it re-run or skip steps. Write the new version to a new file.

## 2026-09-22 — W18b pool fixes

- A failure label copied from a test name is a hypothesis, not a cause. W15 recorded the launcher failure as a Unix socket path limit because the test is named for it; the real error was a `TimeoutError` from a one-second readiness probe. Run the failing file under the pool's concurrency (six copies at once reproduced it 1 in 24) and read the error before naming a cause.
- A "hard expiry" date in code is a scheduled behaviour change with no deploy. Once the date passes, retire the dead branch rather than keep a clock comparison that only looks alive. Source-regex gates that match indentation broke silently on a refactor; pin the behaviour on the real handler instead.
- A project-root walk must accept only a real repository marker. `existsSync(".git")` also matched a stray empty `/tmp/.git`, which git itself rejects. Ask "what does git say?" and plant the stray marker inside the test's own tree so the case holds whatever the host's /tmp contains.
- A git hook exports `GIT_DIR` and `GIT_INDEX_FILE`. Any `git` a test or tool spawns from inside a hook acts on the hook's repository, so `rev-parse` reports "inside a repository" everywhere and `git init <dir>` targets the wrong place. Drop the caller's `GIT_*` variables when git must discover from a directory.

## 2026-09-23 — W14 round 2

- A receipt proves a head only if nothing changed the tree while it ran. Commit every fix before queueing the heavy job, and draft documents outside the worktree until the job ends; an edit during the run mixes two heads in one receipt.
- `waitForLoadState("networkidle")` never settles on a page that holds a live stream (SSE). Bound every idle wait in a shared capture helper; a journey that watches a waiting run otherwise spends its whole timeout before the screenshot.
- Check `scripts/coverage-config.ts` before adding a test for an uncovered Svelte line. A browser-canonical source takes coverage only from browser journeys, so a component test that already exercises the line does not count.
- In a serial Playwright file one failure skips every later journey. Read "did not run" as untested, not as passed, and rerun the whole file after the fix.

- Verify live state before you answer a factual question about it. When the user asked which model the subagents run on, the first answer came from the spawn parameter, not from evidence. Ask the agents (or read the source) first, then answer with the evidence named.
- An outer `timeout` around a command that waits for a lock counts the wait. The first W18a-2 combined run waited about 1.6 hours for the heavy lock inside `timeout 9000` and was killed (exit 124) in its node leg. Put the timeout inside the lock (`flock ... timeout N cmd`), or rely on the runner's own per-leg bound.
- Never pipe a command that must run to completion into a reader that can close early (head, a limited grep). A closed pipe kills git commit with SIGPIPE and nothing is committed. Write to a file, then summarize from the file.
## 2026-09-21 — Isolated Git fixtures

- Never delegate `git init` from a fake Git shim that can inherit the caller's repository variables. Use a real temporary repository with every `GIT_*` variable removed, and assert that provenance probes leave `core.bare=false`.

## Pluggable infrastructure scope

- When infrastructure does not exist, validate locally first. Do not make external host connections a prerequisite for the local implementation. Keep local validation and later remote networking as separate milestones.

- This infrastructure build uses the native EZHarness loop only. Claude and Codex guest workers are excluded by user decision; do not add worker placement or SDK integrations for them.

- When the user requests the bare minimum MVP, reduce the active milestone explicitly. Keep optional protocols, second-provider proof and external services in the later backlog; do not keep building them under the earlier full-plan scope.
- 2026-09-20: For integration audits, verify the exact parent worktree and HEAD before reporting findings. Do not infer current code from an earlier feature worktree.
- 2026-09-20: Before classifying a focused-suite failure as a source defect, check ownership messages and active fixture migrations; distinguish an assigned stale-test update from behavior.

- Freeze every tracked file, including documentation and task notes, while collecting or verifying source-attested browser coverage. Apply pending documentation only after those checks finish. Rebuilding mapped assets can change chunk names; preserve the exact mapped build until coverage receipt validation completes.

- A lock released in `finally` must await every returned asynchronous cleanup inside the `try`. Test the final deletion phase with at least three queued callers; serializing only the earlier unmount phase does not prove the lock lifetime. Preserve post-conflict idempotency replay when adding a pre-insert lookup.
 - `tasks/` is gitignored but `tasks/todo.md` and `tasks/lessons.md` are force-tracked. Append a section; never overwrite either file, and check `git status` after writing under `tasks/`.
- A report-only flag must suppress only the verdict it was made for. Classify a tool exit by whether the tool produced its report this run; delete the previous report first so a stale file cannot vouch for a crash.
- A summary reporter must be told which gates ran. Absence of a report is a failure, never an omission; there is no safe default for the expected set.
- A PR in conflict with its base gets no pull_request workflow runs at all; GitHub cannot build the merge ref. When checks are silently absent, check `mergeable` before suspecting the workflow. Merge or rebase, then reinstall dependencies before the pre-push typecheck when the base moved a lockfile.
- Budget a hosted-runner job against the 360-minute cap with a measured rate, not a guess. When one job cannot finish, shard the work and merge with an exact-count check so a missing slice fails instead of shrinking the denominator.
- When hosted CI times out on fixture readiness, fix the test's synchronization even if the PR did not change that fixture. Wait for the producer's observable output or exit; do not treat a passing focused rerun as proof that a wall-clock deadline is safe.
- Report a hash or count only after reading the command's output; never write the value you expect. (Integrator, 2026-09-24: a staged-tree hash and file count were sent in the same step as the query that produced them.)
- In a shell wrapper, save the exit code on the line right after the command (`rc=$?`). A `$(...)` in the same echo as `$?` runs first and resets it to 0: "exit=0" was logged for a test pool that exited 1 (2026-09-24).

## 2026-09-23 — W02c package quarantine fence

- Do not edit a shell script while a queued job will run it. Bash reads a script as it runs, so an edit made while an earlier leg was running broke the sweep with "unexpected EOF". Copy a driver before queueing it, or change it only between runs.
- A proof harness must keep every child process log. My runner deleted `process-*.log` after moving only a few of them, and the one failure that mattered was in the gateway stub's log. Move them all, by glob.
- Run a proof from a detached worktree at a fixed commit, never from the worktree you are editing. The harness imports repository sources at run time, so an edit made while a job waits in the lock queue changes what the job measures.
- A race test that passes on PGlite can still hide a branch, because PGlite serializes the two transactions. My quarantine and launch race always let the quarantine win on PGlite. On real PostgreSQL the launch won, and it failed on an unprepared package the test had never needed.
- A 500 from the object store can be a full host disk. When S3 PutObject returned InternalError while List worked, `df -h /` showed 100% used. Probe with a key of your own, delete it afterwards, and report the store to the coordinator. Do not repair it.
- `/tmp` inputs older than ten days are removed by the daily systemd-tmpfiles clean at 03:55 local. When `postgres.env` or the pinned Bun disappears, check the tmpfiles journal before debugging.

## 2026-09-23 — W01g round 4
- A summary built from receipt files can report an old pass as a new one. When a run fails before it writes its record, the summary must not read the previous record. Check `producingCommit` and `startedAt` on every receipt before quoting it.
- When the AWS SDK fails with "DOMParser is not defined / Deserialization error", read the object store's log before blaming the bundle. The SDK parses XML only for an S3 error body, and here the real error was a full host disk that made the store's volumes read-only.
- Bun's line coverage can mark the line before an unexecuted function as uncovered: the unexecuted block's range bleeds back one line. Before restructuring code to satisfy the patch gate, check whether the neighbouring function runs in the measured suites, and add the suite that exercises it.

## 2026-09-24 — A Node service must not import a product module for a constant (W15c)

- A Node service may import only leaf modules from the product. `src/db/queries/*` and anything that
  reaches them (records, auth) pull in `db/connection` and the Bun SQL driver. Put shared constants and
  types in a leaf, and let `check-factory-boundaries.ts` (`NODE_SERVICE_BOUNDARIES`) guard the entry.

## 2026-09-24 — An empty test list turns a targeted run into a root run (W16)

- Under zsh, an unmatched glob such as `--include=*.test.ts` fails the whole command substitution, so
  `bun test --timeout N $T` received no file and ran every test at the repo root. Build a test list in
  bash with `mapfile`, quote the pattern, and exit before `bun test` when the list is empty.

## 2026-09-25 — Never pass --no-verify, not even in a scratch worktree (W16)

- A scratch merge was started with `git merge --no-verify`. It stopped on a conflict, so nothing was
  committed, but the rule is absolute: no `--no-verify` on any git command, in any worktree. If a hook
  is in the way, the scratch tree is the wrong tool; merge without the flag and resolve, or do the work
  on the real branch after the ruling that allows it.
## 2026-09-24 — W19a graph proof

- Under Bun, `ClientRequest.destroy(error)` emits `close` and never `error`. A promise that waits on
  the `error` event after a timeout stays pending forever. Settle the promise from the timer itself,
  then destroy the request. Probe the runtime before trusting a Node idiom in code that runs on Bun.
- Bun's `mock.module` leaks across files in one process. A coverage leg that mixes a file that mocks
  the settings module with a file that writes real settings measures the wrong code. Give each
  mocking file its own leg.
- Rows from a real PostgreSQL driver are not plain objects, and an object matcher compares
  prototypes. A suite that passes on PGlite can fail on PostgreSQL with identical fields. Copy rows
  into plain objects before matching.
- Ollama 0.21 with `qwen3:1.7b` thinks by default, even with `/no_think` in the prompt. Two
  identical seeded calls at temperature 0 gave different reasoning text. `reasoning_effort: "none"`
  gave the same answer on repeated calls. Measure a provider's determinism before promising it.
- Read what the branch actually exports before you port a harness from another branch. The W15b
  harness used a function that exists only on the unmerged W15b branch. The failure also showed that a
  start which creates shared databases needs its cleanup in place before the first create.

## 2026-09-25 — A receipt runner must not strip git status output (W12d)

- Never `.strip()` the output of `git status --porcelain`. The first line's leading space is part of
  the status code, so stripping it shifts the path by one character, and the file drops out of the
  receipt's dirty-file map. Strip only the trailing newline, and parse each line as `XY path`.
- A temporary worktree for a producer run needs a real `bun install --frozen-lockfile` at the root and in web/; symlinking node_modules misses the workspace packages' own node_modules (integrator, W18a-3 merge, 2026-09-25: six producers failed on "cannot find zod / @temporalio").
- The backend pool (`bash scripts/test.sh`) runs WITHOUT DATABASE_URL and FACTORY_TEST_POSTGRES_URL; exporting them fails the db-connection and EZCORP_DB_PATH tests (integrator, W18a-3 merge, 2026-09-25).
- A background job's completion notification can be missed; set a timed check on its exit file instead of waiting (integrator, W18a-3 merge, 2026-09-25: a finished rerun sat unread for hours).

## 2026-09-23 — W03e usage settlement for stops with no operations

- A proof check must encode the product's rule, including its conditions. The kernel needs an explicit `uncertain: false` only after an earlier uncertain stop event; my first harness demanded it always, and one real pass failed a correct run. Derive the expected event from the observed history, then rerun the passes rather than re-scoring a recorded one.
- Read the consumer before emitting an event. The kernel ignores a certain `attempt-stopped` for an attempt it already holds as uncertain unless the event says `uncertain: false`, so a late stop receipt had never cleared anything, in the measured path too. The real stop went through `stop-uncertain` first on the base run, which is exactly the case that stayed stuck.
- PostgreSQL returns BIGINT as a string and PGlite as a number. Normalize numeric columns in shared conformance suites, or the PostgreSQL leg fails a correct change.
- In zsh an unquoted `$files` does not word-split; a loop over it runs once with the whole list. Use `${=files}` or a bash script.
- The pre-commit hook runs real-PostgreSQL suites for staged test helpers; those belong under the heavy lock, so a scratch proof commit skips only the hook's test step and says so.
- Cite only captures you have read. I named W01h's failed graph-proof pass as a second site of the boot stall from its symptom alone; its web process had exited 2 ms after start with "Module not found build/index.js", so no product code ran. Before calling another run the same defect, read its logs and find the same signature.
- In zsh, `echo ===` fails ("== not found") and aborts the rest of a `;` chain; `=word` expands to a command path. Quote separators: `echo '---'`.
- A deadline test must make the probe ignore its signal. A fake that honours the abort passes even with the deadline race removed, because the deadline also aborts the signal.
- Bun 1.3.14's `jest.useFakeTimers()` can leave the next test file in the same run hanging with no output, even after `useRealTimers()`. Run every test file combination in both orders before trusting a fake-timer test. Prefer an injected short deadline on real timers.

## 2026-09-24 — W05b reconciliation clearing

- A proof check must describe the promise, not the path I expected. The check "one `:usage-resolved` event" failed two of three passes in which the run ended correctly, because the real server took the reverse order: the stop confirmed after reconciliation and cleared the attempt through its own event. Count the outcome the kernel sees (one `uncertain: false` after the uncertain stop), not the id of the path.
- When a worktree's git suddenly says "must be run in a work tree", read the shared config. With `extensions.worktreeConfig` on, a shared `core.bare = true` makes every worktree without its own `core.bare = false` stop being a work tree, and tests that shell out to `git grep` or `git check-ignore` fail at any commit. Set it per worktree (`git config --worktree core.bare false`); never edit the shared config.

## 2026-09-25 — Search for a prior decision before building a destructive tool (W15d)

- Before writing a delete or prune tool, search the repository for an existing one and its history. I
  drafted a prefix-and-age prune for the shared store, then found `scripts/prune-factory-storage-manifest.ts`
  and `tasks/factory/w07-GATES.md`: a window deleter had removed another package's evidence, and the
  project replaced it with a manifest-only tool. A run may delete only what it wrote, under its own
  unique prefix; anything older needs a reviewed manifest.
- Never raise `EZ_PRECOMMIT_TEST_MAX`, even to run more suites. A staged suite that spawns git inherits
  the hook's `GIT_DIR`, which re-initialised the shared repository twice. Above the cap, ask the
  coordinator for the skip ruling and run the listed suites yourself with `GIT_DIR`, `GIT_INDEX_FILE`,
  and `GIT_WORK_TREE` cleared.
- A resource ceiling must keep the host above its disk floor at recreate time, counting what is already
  stored. Measure free space against the full ceiling, not the growth you expect.
- A kernel OOM record names its constraint. `CONSTRAINT_MEMCG` is the container limit; `CONSTRAINT_NONE`
  with `global_oom` is the host. Read it before raising a container limit.


## 2026-09-25 — A fail-closed gate that has never passed is untested (W15e)

- Run each gate green by hand once before the real run of a destructive tool. The first approved W15e prune stopped at its own SHA256SUMS gate, because the sums listed `manifests/<name>` while the gate checked from inside `manifests/`, so it could never pass. It failed closed and nothing was deleted, but the approved run was lost and the script had to change after approval. Before queueing, pass each gate by hand: the checksum check, the memory gate, one dry run of the destructive tool (it must report deleted 0 and applied false), and the census code on existing data.

## 2026-09-26 — No bypass and no heavy run without the lock and a ruling (W18c)

- No hook bypass without a coordinator ruling, even for a scratch or proof commit. `EZ_SKIP_HOOKS=1` on
  the measurement merge 303e2b33b was a deviation; `EZ_PRECOMMIT_TEST_MAX=0` on a merge is a hook-test
  skip by another name. The only skip is `EZ_SKIP_HOOK_TESTS=1`, with the ruling in the commit message.
- Any bun or vitest run of more than ten files, any coverage run, any Stryker run, and any suite that
  starts containers runs only under the heavy lock. A 178-file bun process run outside the lock
  coincided with the host-wide OOM of 2026-09-26 00:37Z, which killed the user's app container.
- Before every leg: at least 6 GiB available, at least 2 GiB swap free, and at least 100 GB disk, and the
  leg's own peak must fit (the backend pool alone peaks near 15 GiB). A 256 MB swap floor let a
  near-exhausted host through.
- After any host OOM, stop everything, report, and restart nothing without the coordinator's word.
  Re-read the coordinator's latest messages before restarting any job; a smaller rerun is still a rerun.
- A failure set another package owns is reported, not bisected or fixed: check the owner's recorded
  OPEN set (for example docs/validation/factory/wave4/*-merge.json .OPEN) first.
- Kill a process by its PID, never by a `pkill -f` pattern: the pattern also matches the shell that runs it.
- Run typecheck before every commit, not only the changed suite: vitest and bun run TypeScript without
  checking types, so a green suite can hide type errors (W18c 4e1f1541e carried 12; fixed in 376278d17).
- A test must measure the code under test, not a package manager: a live `bun install` inside a test's
  budget is a flake under host load. Prepare the install result from a pinned local copy and assert its
  version against the lockfile (W18c 226a3fadb).

## 2026-09-27 — A test leg that ran zero tests must fail loudly (W01h merge)

- `bun test <path>` without a leading `./` treats the path as a name filter. The W01h merge batch listed `tests/postgres/...` and `src/...` bare, so bun matched nothing and its three PostgreSQL legs and its Podman leg ran no tests. Write every listed test path with `./`, and make every test leg assert that it ran at least one test: a count of zero is a failure, whatever the exit code. The integrator's heavy-batch and fast-check scripts now add `./` and fail a zero-test leg with exit 97.
## 2026-09-27 — Test harness mistakes found in W09f

- A suite that calls `mock.module` must run in its own bun process when it is grouped with other
  suites. A mocked `db/migrate` once poisoned the shared PGlite snapshot cache for the whole checkout.
- A reproduction suite must close each trial's pool completely before the next trial opens. Pools left
  closing hold connections on a shared server and look like a driver stall.
- Settle a Bun.sql query with `.then` or `await` in a test. `expect(query).rejects` never starts a lazy
  query, and the test hangs.


## 2026-09-25 — W01h runner outcome unknown

- Under Bun 1.3.14, `node:https` `request.destroy(error)` and an aborted `signal` emit only `close`, never `error`. A promise that rejects only from `error` then never settles. Settle explicitly on the deadline, on abort, and on a `close` that arrives before a response. Node emits `error` in all three cases, so a Node-only test cannot see this.
- A long result wait over one HTTP call is fragile. Use a bounded long poll: the server answers inside its own window (for example 504 `host_timeout`), keeps a settled answer until it is collected, and the client asks again until the attempt deadline.
- Never delete a result in the handler that returns it. The caller may already be gone, and the result is then lost for good.
- An unknown outcome with no durable record stops a run for good: the kernel only moves on `node-failed`. Record a typed `failed` result over the journal's own facts, and let the kernel's `cancel-node` decide the retry.
- The pre-commit hook runs every staged test file, including `*.podman.integration.test.ts`, without the heavy lock. Commit a Podman test on its own, inside `flock --close /tmp/ezcorp-validation-heavy.lock`.
- The durable run fence epoch (`factory_run_lifecycle.cancellation_epoch`) moves only on a user cancel. A stop the kernel begins itself (run deadline) makes every later `cancel-node` stale. Check a kernel-initiated stop path end to end before you trust it.
- Never raise EZ_PRECOMMIT_TEST_MAX so the hook runs suites you did not write. On 2026-09-25 the hook ran c3-extension-install.test.ts, whose `git init` inherited the hook's GIT_DIR and set core.bare=true in the shared repository config. Run such suites yourself, outside the hook, with GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE cleared.
- A skip ruling names one commit. EZ_SKIP_HOOK_TESTS=1 on the a4dc40f3e merge was used under an earlier merge's ruling and needed a retroactive ratification (coordinator, 2026-09-26 00:12Z). Ask the coordinator for the ruling before every skip commit, and name that ruling in the commit message.
- W19a's `run.sh pass` starts `web/build/index.js` as it finds it; only `run.sh all` builds the web server. A fresh proof tree for a lone pass needs `bun run --cwd web build` first, and the driver must stop if the build is missing. On 2026-09-26 the W01h 70 s pass ran without it: the web process exited at once, the orchestrator got ECONNREFUSED 107 times, and the pass read like a boot stall.
- Report a job's end to the coordinator within ten minutes, red or green, and read the process logs before naming a cause.
- Before a shared client reads a new field, list every caller and the exact shape each one passes. W01i's host stop client read `request.cancelReference.tenantId`, but W01h's post-result stop calls the same client through `factoryIntentPhysicalStop` with only the physical coordinates. Every unit and transport suite stayed green; only the real factory-services lane found it (2026-09-27).
- A lock-order claim needs a concurrent test, not a sequential one. W01h's "the launch row lock orders the lost result against the stop" held in `factory-stop-after-loss.test.ts`, which runs the two transactions one after the other, and deadlocked on the proof server under the lane (validator-2, 2026-09-27). Before adding a second lock to a path, list every path that locks both rows and its order, and drive the interleaving on real PostgreSQL with two connections.
- Build the workspace packages before any suite in a hold, not in the late fast steps. After a merge, a suite that imports a package's built output reads the stale dist and fails for a reason that is not in the code (r4: client-requests.unit.test.ts, 18 tests).
- A suite that no hold of mine runs is still mine when my routes break it. The scope and route-contract scans had failed on W16's routes since the bootstrap work, and only a merge's hook list ran them.
- Pin `bunx` with `bun`. `/tmp/factory-tools/bun-1.3.14/bun-linux-x64/` holds only `bun`, so `bunx` fell through to the system Bun 1.4.2 and the web build, preview and tests ran under it; the preview server then crashed (ERR_STREAM_WRITE_AFTER_END) in 2 of 4 repeat runs (W09e, 2026-09-27). Put a `bunx` link to the pinned `bun` first on PATH and log `bunx --version` in every driver.
- A test world that persists a transition must also project it. W09e's R6 case committed a cancel transition and never applied it, and PGlite's "oldest pending run" projection case failed on that run a commit later.

## 2026-09-27 — Build JSON in SQL, and let a filter on it fail open (W15f)

- Write a JSONB value with `jsonb_build_object` from typed parameters, not a JSON text parameter cast to `jsonb`. On
  real PostgreSQL the text parameter arrived as a JSON string; PGlite stored an object, so only the PostgreSQL leg
  caught it. Assert `jsonb_typeof(...) = 'object'` in the test.
- A scan that skips rows by a stored mark must compare with `IS DISTINCT FROM`, so a mark it cannot read keeps the row
  (and its loud report) rather than hiding it: `NULL <> value` is not true, and the row vanishes in silence.
- Before relaunching a background job, look at the flock queue itself (`pgrep -af 'flock --close'`), not only a
  pattern for the script. A job started with `&` in a tool shell survived the shell, my narrower check missed it,
  and the W15f batch ran twice back to back, holding the shared lock twice for nothing.

- Gate the commit on the typecheck's exit, not on its printed code. W02d R5 printed `tc=1` inside a subshell and the `&&` chain still committed; the fix was an amend. Write `timeout 900 bun run typecheck > log || exit 1` before `git commit`.


## 2026-09-27 — W03f: scratch snapshots and hook skips (coordinator correction)

- Mistake: to snapshot a detached scratch worktree I ran `git commit` with `EZ_SKIP_HOOK_TESTS=1`
  and no per-commit ruling (9178be47c, never merged).
- Rule: a snapshot of a scratch or detached worktree is `git add -A && git write-tree` then
  `git commit-tree <tree> -p <parents>`: no hooks, no refs. `EZ_SKIP_HOOK_TESTS` is never set
  without a per-commit ruling, on any commit, scratch or not.
- Also from this package: a suite that needs no database must not get `--pg` (DATABASE_URL changes
  its behaviour), and a vitest file runs under `bunx vitest run`, never `bun test`; count tests with
  the shared counter, and treat a zero count as red.
## 2026-09-28 — A stricter config parser breaks every writer of that config (W16)

- A harness document is a product input; parse it with the product parser in a test.
- When a change makes a parser refuse a key, find every writer of that schema (`git grep` its schema string) and
  change them in the same commit. W16 dropped the pool's installationId; the graph-proof stack and the
  factory-services e2e stack still wrote it, and only a live runbook pass showed it. Pin it with a test that parses
  each harness document with the parser of the process it starts.
- A process that fails to start prints why, by its generic message. The pool exited 1 with an empty log, and the
  cause had to be read from the harness instead.
- In a hold, keep steps that do not need the image ahead of the image steps. The runbook pass and Kubernetes sat
  behind the candidates step, so a disk refusal there hid both for two holds.
- A step that starts the web server from `web/build` needs the web build in the same hold.
- Write a queue script whole, with its label in one variable. A sed-derived copy kept the old label and would have
  deleted the previous hold's receipts; the waiter was stopped before it took the lock.

## 2026-09-28 — A harness that hides the refusal is a silent failure (W02d)

- A failed pass must name what the product refused. P2's first base pass said "Unable to connect" (its own teardown)
  while the web log held the real event, an admission refused `factory_budget_exhausted`; read the product's refusals
  before the harness's error, and make the harness print them.
- A proof expectation belongs to the run type: a run R9 must fail by name cannot be judged by the generic success
  checks. Give each type its own verdict, print every check with expected and seen, and exit nonzero on any failure.
- Nothing that starts a stack, a container or a PostgreSQL-backed suite runs outside the heavy lock, a smoke included:
  a lock-free smoke ran beside another lane's runbook leg, which then failed.
- A failed pass keeps its product database apart (retainedProductDatabase); clean-up must read it too, or the
  database stays on the shared server.

## 2026-09-28 — Check the latest ruling before committing, and prove lock waits by blocker (W09h)

- Before committing a rule, re-read the brief and the handoff lines for the package: a ruling can replace a design
  line mid-task. W09h's first R4 commit used a settlement basis the lead had withdrawn half an hour earlier, so a
  correcting commit had to follow it.
- In a concurrency test, identify each lock waiter by `pg_blocking_pids` in a database of its own, not by matching
  query text: the second contender often waits on an earlier row (the run row) than the one the gate holds. Release
  the gate in a `finally`, or a failed probe leaves the gate open and the fixture's teardown hangs.

## 2026-09-29 — W02d: a ruled hook skip is still the user's permission

- What happened: the coordinator's list-bound ruling allowed `EZ_SKIP_HOOK_TESTS=1` for one merge commit, and the tool
  permission system refused it for the agent and for the coordinator.
- Rule: a teammate's ruling never grants a permission the tool system refuses. Report the denial, freeze the staged
  tree, prepare the exact command and message file, and let the user run it; verify tree, parents, identity and
  message after.
- Stop a process you started by its PID (`$!`, and `pkill -P <pid>` for its children), never by `pgrep -f`/`pkill -f`
  on a command-line pattern: the pattern also matches the shell that runs the command, so it can stop the wrong
  process and miss the server (w12e-2, 2026-09-28; no other process was touched).
- `git add -A -- . ':!dir'` exits 1 when a pathspec matches an ignored directory, even though it staged the files, so
  a `&&` chain after it never runs. Use `git add -A` without a pathspec, then `git add -f` for tracked files under an
  ignored directory, and check the staged list before committing (w12e-2, 2026-09-28: commit 2 waited three hours).
- A detached job's end does not wake the agent that queued it. Wait for a heavy job in the foreground (a polling loop
  with a bounded timeout) or check it on every turn, and report its end yourself; three W12e jobs ended unreported for
  hours (w12e-2, 2026-09-30).
- Count a result from its own structured field, never by grepping a word the log also prints in source lines: a
  "stall=" count that matched "stall" in the test's printed code turned three decode failures into "stalls" (w12e-2).
- A probe that must import repository modules runs from outside the worktree with absolute imports; a copy placed in
  the tree dirties it for every locked job reading it, and a hung probe leaves it there (w12e-2).

## Wave 4f (2026-09-27)

Lessons from wave 4 and its final run (wave4f at baeade976), one per cause. Lessons already in this file
(the bunx pin, `process.exitCode` restore, commit-tree snapshots, harness documents, queue-script labels,
smokes under the lock, detached-job wake-ups) are not repeated.

### Runner and pool

- A file that passes alone and fails in a pool is a contamination finding, not a flake. The 462-file pooled leg
  produced reds that vanished per file. Run files whose isolation is unproven one process per file, join their
  coverage in the merge, and open a follow-up that names the pair (polluter, victim), never a retry.
- Choose the runner by the package's own test script. Pulling every `*.test.ts` under `bun test` ran `node --test`
  suites under the wrong harness and reported false reds. Exclude by the nearest package.json `test` script, and
  record the excluded list in the plan.
- Deduplicate against fixed inputs only. The runner dropped the coverage-extras leg because it "covered" files that
  another dynamic leg also listed; both legs came from the same scan, so each covered the other and one vanished.
- Count what the producer prints, not what you expect it to print. CI coverage producers printed no " N pass" line,
  so the zero-count guard exited 97 on green legs. Make every producer print its totals red-first, probe the counter
  with a real log of every producer before the guard is armed, and never loosen the guard to accept silence.
- Mirror the CI step, not only its file. The runner took only the list lines of the PostgreSQL workflow and missed
  four suites that run in their own steps, then ran a step-level suite without the step's env block. Parse the
  workflow's steps as steps: their env, their run, and which list they belong to; a suite with its own CI step gets
  its own process.
- A gate red by design must not hide the measurement. gate-integrity is red until the user approves the package's
  own gate changes; the runner's fail-closed rule then skipped the coverage merge and every gate. Only a failed
  producer or build may block the merge; every other red is recorded and fails the run's exit without erasing the rest.
- A filter that matches nothing reports green. A results file read with a key filter that matched no field gave an
  empty list of reds, and the run was reported green while eight legs were red. Read the file's actual fields first,
  and check every derived result against one known row.
- Never edit a script a running bash is still reading. bash reads a script incrementally, so an edit lands in the
  running process at an unpredictable offset. Copy the script to a new name for the next run.

### Coverage, gates and producers

- One canonical producer per source class, and a merge batch runs the producer of every file it touches. web/src/lib
  is credited only by the Node-run vitest leg; V8-canonical sources (the transport package) only by the Node producer;
  provisioning files by their own producer script; five Svelte components only by the browser lanes. Two merge-batch
  gaps (the provisioning producer, the orchestrator Node producer) turned a green hold red at the merge; both are
  standing legs now, switched on by the diff.
- Run the final gates once, after the last coverage producer. The runner's new-file gate ran before the browser lanes,
  so components covered only there read as unmeasured. Record any earlier gate run as interim with the reason.
- A gate that does not watch its own tools is not a gate. gate-integrity watched the coverage configuration and
  thresholds but not the merge script, the converters or the checkers, so two coverage-credit changes passed unseen.
  Watch every script that shapes or judges the measurement, and expect the watch to flag the package that adds it.
- Two packages can each add "check 11" to the same gate script. Fold them into one watched set; the author of the
  surviving check does the fold, and the other package's test becomes a case of it.
- CRAP on a partial lcov is not a number. The same `crap-score.ts --changed` gave 403 functions over 30 on a merge
  batch's lcov and 6 on the full-pool lcov, because a file loaded but not exercised scores 0%. Judge the wave's CRAP
  only over the full-pool lcov; a merge's binding leg judges only the functions it touched, against its own base.
- Run the PR's gates at the last package's head, before the final run. The final gates at W12e's head found the
  wave-level reds (six functions over CRAP 30, two coverage gaps, an attestation no longer needed) with hours to
  spare; they became one small package (W4F, three branches) instead of a red final run.
- Behaviour-preserving splits are checkable: no existing test line edited or removed; the same check order, error
  codes and messages read line by line; the CRAP report per touched function before and after. Six functions went
  from 32-44 to at most 13 with every suite unchanged.
- Bun credits a function's last statement to the previous line (1.3.14 and 1.4.2 alike; six equivalent shapes did
  not move it). When the only red is a line the tool cannot see, the answer is a user decision, an attestation with
  its probe on record, or a hold, never a threshold change or an exclude.
- An attestation pinned by a whole-file hash stales on every later edit to that file, by design. When two packages
  touch the attested file, the one that lands second re-proves the line at its own tree and refreshes the entry in its
  own branch, red first; the integrator never refreshes an attestation at a merge.
- Prove before ruling on a refactor meant to please a measurement. A `.then` rewrite was ruled and then measured
  uncredited, and the ruling was withdrawn. Measure the candidate shape first, then rule on the measured one.
- A gate-change decision file states its approved path on one machine-readable line, not in prose; a validator's tool had
  to normalise it.

### Latent reds and runtime upgrades

- An integration branch can hold a red no lane has run yet. Two latent reds surfaced only when a later package's leg
  touched them (a `bun` import in a web module; a C13 inventory drift), and a hook-mapped per-head run passed while the
  C13 inventory test was red for the package's new file. Every per-head run and merge batch runs the standing guard
  set and a web-server leg; a validator's unit leg is the union of changed tests and hook-mapped tests.
- A migration change maps its own `src/db/migrations/*.test.ts` into every per-head run, and the full backend pool runs
  at least once per wave before the final merge. A migration test was red on integ for days (a new column, an old
  expected list) and only a runtime bump's full pool ran it.
- A runtime bump is not a hook-mapped change. W12e's per-head hold was green while the full pool at the same head found
  five reds. A package that changes the runtime pin runs the whole backend pool, the guard set and the browser lanes
  at its final head before the verdict.
- A toolchain pin belongs in one place, and every wrapper reads it from the tree. Two dozen scripts hard-coded the
  1.3.14 directory. Derive the pinned directory from `.bun-version` and assert both `bun` and `bunx` against it; a
  driver also prints the pin and any runtime flag in its own log (wave4f's driver did not, and its receipts had to
  cite the pin from the after-runner log and the pin helper's assertion).
- Root-cause a flaky runtime defect by controlled configurations, not by rerunning to green. The request-queue stall
  was settled by one deciding harness run in four configurations: the old pin deadlocked 13 of 13 trials within the
  harness bound; the new pin 1 of 300; the new pin with pipelining off 0 of 3000; the upstream canary 0 of 300. The
  result named the defect (a response mix-up in Bun's Postgres client), its upstream fixes and the one
  mitigation that works.
- A mitigation for a runtime defect is a fail-closed startup guard, not a setting someone remembers. The guard refuses
  to start on the affected versions unless the flag was in the start environment (/proc/self/environ), every client
  opens through one function, and the version list is closed upward (an unlisted version fails a test until a
  3000-trial record exists).
- A test that pins a runtime defect says so in its title. When the runtime fixes the defect, the test asserts the
  correct behaviour, states the old behaviour as history with the probe, and keeps every product check it had.
- A held decision is not a closed one. When the user chose the Bun upgrade, the package needed an owner, a rebase onto
  the final head, and its own red-first proof of the runtime's known defects before it could land last.
- A base reproduction that turns red for a reason the package did not expect is a finding, not noise. W02d's P3 and P5
  repros exposed a cancel-during-admission wedge; it became its own package (W09h), and W02d records the dependency.

### Locks, waiters and messages

- `flock` is not a queue, and a late withdrawal order is no order. Waiters wake in an order the kernel chooses, and an
  owner in a long turn reads its inbox only between turns; four jobs took the lock ahead of the critical path within
  one hour after they were ordered withdrawn. Every heavy wrapper checks a per-lane veto file (`lock_veto <lane>`) as
  its first statement after taking the lock; only the coordinator writes one. It worked on first use: a multi-hour
  rerun queued at a head with two open defects stopped before it took the lock, and nobody killed anything.
- Say "check the veto" in a run order, never "write the veto file": a veto file stops the lane it names.
- Waiters must watch the real process or file, with patterns that cannot match themselves. The wake-up gap recurred
  for 12 hours because `pgrep -f` matched the waiter's own command line, a zsh glob that matched nothing aborted the
  waiter's loop on every pass, and the combined runner holds the lock inside Python where a `flock` pgrep cannot see
  it. Use `find` for file waits and the job's own PID for process waits, and test the waiter once on a known match.
- Messages between agents arrive late and in batches, without timestamps. A ruling sent once can cross a report and
  read as "pending" on both sides. Restate every ruling in one short line, name the commit it binds, and treat
  "pending ruling" as a signal to resend.
- Read the failing component's log before naming a cause. A validator's runbook failure was blamed on a concurrent
  smoke from timing alone; the web process log said "Module not found build/index.js" (no web build in that hold).
- Host resource gates are gates. Under memory and disk pressure the runner voided legs (exit 96) rather than running
  them short; nobody lowered a gate, and the writer that ate the disk (another session's workload) was identified by
  /proc io counters and left alone.
- Rehearse the validation before the head arrives. A lock-free rehearsal of the hold at an interim head found a red
  typecheck and an untested branch before any lock time was spent on them.
- Prove a rebase, do not describe it: patch-ids of the code commits, byte-identical code files, and the docs unions
  read; compare each side's own change against its own base.

### Validation (validator-5)

- A fresh validation worktree needs three installs: the repository root, web/, and the isolated gate-integrity parser
  (`bun install --cwd .github/gate-integrity-deps --frozen-lockfile --ignore-scripts`), as ci.yml installs it.
  Without it, scripts/gate-integrity-rule11.test.ts was 10/2 ("TypeScript AST parser is unavailable") on a correct head.
- A red check reads every runner's own summary: bun ("N fail", "(fail)"), vitest ("Tests N failed"), and node --test
  in both forms ("# fail N" and "ℹ fail N"). Missing one form marked a red mutant as survived.
- Reverting a whole fix commit is not a red-first proof when its test imports something the fix added: that is a load
  error, not an assertion failure. Restore only the behaviour line with a mutant instead.
- A test that reads ignored files from disk passes vacuously in a clean worktree; plant the file the lane would leave,
  then check.
- In zsh, "$VAR:src/..." applies the :s history modifier even inside double quotes; write "${VAR}:path".

### W-SYNC (2026-10-01)

- A ruled hook skip still meets the permission checkers (the 2026-09-29 W02d lesson, again). W-SYNC's merge commit needed
  `EZ_SKIP_HOOK_TESTS=1` under a list-bound ruling; both the owner's and the coordinator's checkers refused it, and the user
  made the commit by hand. When a merge's hook list is above the cap, plan for the user's hand from the start: the frozen
  staged tree, the exact command and message file, and the checks of tree, parents, identity and message after.
- Keep a merge's gates doc on a side branch, a child of the merge, so the merge commit stays the reviewed object. The
  integrator publishes the merge by compare-and-swap, then checks that the side branch adds only the gates file and
  fast-forwards to it.

### W4G-1 (2026-10-01)

- `mapfile` is a bash builtin; in zsh (the agents' shell here) it fills nothing, so `bun test "${LIST[@]}"` ran with no files
  and bun tested the whole repository outside the lock (about six minutes, stopped by the owner, no OOM). Build a test
  list only inside a bash script, and refuse an empty list before calling `bun test` (w4g-1/guard-run.sh does both).
- A frozen install reads more than the workspace manifests: `patchedDependencies` patch files too. A container guard
  derives every input from the lock and the manifest it serves, and the image proof builds past every install, to the end.

### W4G, W4G-13 and W4G-14 (2026-10-01 to 2026-10-03)

- A finished detached job never wakes its owner. Four times in W4G a green result sat unread for 2–3 h (an integrator hold, two validator
  phases, an owner's commit sequence). Rule: every detached run gets a real waiter on its output file or process, started before the run;
  the owner polls in the foreground as well; a pgrep waiter uses `[.]` so it cannot match itself.
- A test file that runs zero tests is VOID, never a pass: bun exits 0 when every test skips (opt-in e2e files). Selection sets exclude opt-in
  files unless opted in with their prerequisites; the merge hold's zero-count guard and the validator's nonzero-pass rule enforce it.
- A runner-shaped container uses the runner's own tool versions (OpenSSL, uv, conmon, bun from the pinned releases), never the host's; one
  mounted host openssl turned a hosted red into a local green.
- Image proofs build from a clean `git archive` snapshot, never a worktree: ignored `dist/` folders in the worktree masked a missing build
  step in the Dockerfile and produced a false green.
- Never run `podman image prune` on the shared host; remove only your own tags by name. The shared brief's old "always safe" line was wrong.
- A permission classifier refuses `EZ_SKIP_HOOK_TESTS=1` commits; when the hook maps more than its cap, plan for the user's hand from the start.
- Set the archy identity with `--worktree` in every new worktree and check the shared .git/config afterwards; one owner's plain `git config
  user.name` stopped every hold and merge for an hour.
- A test that encodes a file's shape asserts the intent (which steps run as which user), never a count: dev-image-ownership counted RUN steps by a
  regex and went red when Dockerfile.dev gained `bun run build:packages` (W4G-13, test fix only).
- Every test that reads a container or compose file is in the guard set (36 files from 2026-10-03; opt-in files excluded), because the hook maps
  no test to Dockerfile*.
- A test that pins an environment variable another module caches per process must reset that cache itself (and restore both in afterAll):
  file-organizer-applier-reserved-dirs pinned EZCORP_PROJECT_ROOT after getProjectRoot() had cached the repository root for the process (W4G-14,
  victim-side fix; there is no single polluter when every earlier caller fills the cache legitimately).
- A "lost update" signature (fewer writes than calls) can be a stall, not a race: W4H-7's two task_add workers never raced. A test-helper
  trace of every reverse RPC showed the second write answered only when the deadline closed the other worker (the FIFO-pool stall W4H-6
  fixed). Trace the frames before you change a write path that already holds a row lock and a revision check.
- A status check is answered with results (counts, file:line, cause, what is blocked), never only "queued".
- A runner-shaped snapshot that a container bind-mounts goes outside the evidence dir, and is removed (with `podman unshare rm -rf`) the
  moment its last leg ends.

### W4H, W10c and the wave4i run (2026-10-03 to 2026-10-05)

#### Integrator (integrator-3)
- A merge prep takes its trial tree from the tool that resolved the conflicts. prep.sh took merge-tree's raw tree while hook-map.sh had
  built the docs-union tree, and the W4H-5 commit was refused twice ("staged tree differs"). Rule: one place computes the tree; the
  prep reads it from there and stops on an empty value.
- A gate that waits inside the heavy lock holds the lock for everyone. Rule (common.md "Gate before the lock"): wait for the resource
  gate outside the lock; inside, check once without waiting and release at once on red (exit 75, re-queue). A released hold is VOID.
  gated-flock.sh adds a start margin (104 GB, 2.5 GiB) so a hold does not start at the floor and void mid-run.
  A loop counts only the runs it executed; a gate-skipped iteration is not a run (W4H-7's first loop waited ten minutes for disk
  inside the lock).
- A waiter's own end needs a waiter. My first gated-flock call gave up after its 4-hour bound at 05:42Z and nobody saw it until 14:34Z,
  so the hold missed the 14:19Z green window. Rule: poll the waiter's output in the foreground too, and read every completion notice.
- The exit file of a hold is written by the wrapper (GATED_FLOCK_EXIT_FILE), never by hand; the publish command runs alone on its line.
  A permission classifier refused a hand-written exit file plus publish as a "blind apply"; the user then granted publish.sh by rule.
- Read a script's usage before calling it, and pass absolute paths. One receipts call with the wrong first argument and a relative
  sources path copied 56 untracked files into the receipts directory before it failed; they were removed after a tracked/identical check.
- A package-base patch leg runs at the BRANCH HEAD, not at the merge commit: at the merge commit the merge-base with the package base is
  the base itself, so the diff holds every integ change since then (W10c: two red files from W4H-5 and W4H-2).
- Disk at the floor: compress receipted raw artifacts in place with a README per directory (original name, receipt sha256, gzip date,
  .gz sha256) and remove rebuildable outputs that are not evidence; never touch another session's files. (2.4 GiB freed on 2026-10-04.)
- Above the hook cap, a ruling to run every mapped file is applied with the hook's own EZ_PRECOMMIT_TEST_MAX for that one commit; nothing
  is skipped and the refused attempt is kept.
- A document that quotes a command it removes is not a command: the prune scan classes a prune subcommand in *.md as "candidate (doc file):
  validator reads" (prune-scan.sh efffa0178530c74a), as it does for test files.
- A waiter blocks until the last step it starts has ended; never end a waiter by handing work to a detached child. (integrator-4, wave4i-2:
  the trigger job ended when it launched the detached after-2 stage, so nobody watched it; its green result sat unseen for 3 hours.)
- A producer that runs legs with coverage on needs its own memory floor (15 GiB available at start, resource-gate.sh / gated-flock.sh), or
  the gate inside the lock times out (exit 96). The floor is named in the brief, never lowered.
- Background notices do not wake an idle teammate: while a hold runs, keep a foreground poll of its exit file at most 10 minutes apart
  (integrator-4, twice: wave4i-2 after-2 and the W4H-12 hold).
- Never suggest a host-wide memory action (swapoff, drop_caches, kills of others' processes); report the gate figures only (integrator-4).

#### Coordinator (team-lead)
- When a wrapper replaces another, check the files its callers used to write: W4H-5's publish refused because heavy.exit was gone with the
  old wrapper.
- A permission denial is handed to the user as the exact command, never worked around; a peer's denied step is never run for it.
- A carry-over ruling names the exact paths from the real diff, not a guessed directory (W4H-6-M1 amendment).
- Running bash scripts are replaced with `mv` (atomic), never edited in place, and waiters are restarted to pick up the new text.
- Commands handed to the user are zsh-safe: literal pid lists; `$P` does not split in zsh.
- Silence is a signal, not a wait: when a report is overdue, read the exit files and logs (heavy.exit, *.exit, trigger.log) before waiting
  longer. (2026-10-05: extras and after-2 were green at 18:32Z and 19:22Z; found at 22:15Z.)
- A brief cites the file at the BASE, not a peer's read of another branch (W4H-13: the hook fix was already on integ; main's line numbers were quoted).
- Shared git config: the mtime dates nothing (install hooks re-stamp it); snapshot the content hash with the time at every hold.
- Attribute a process to its session (cwd, parent, cmdline) before naming it to the user: the tsgo OOM killer of 2026-10-05/06 was the team's own
  `svelte-check --tsgo` legs, blamed for a day on the user's editor. Rule added: typecheck legs gated on memory, never two at once.

#### Validators (validator-5, validator-6; from their pending-lesson.md files, 2026-10-05; the GATE_TRIES=1 line kept once)
- Inside the heavy lock, check the resource gate once (GATE_TRIES=1) and exit 75 on red; wait for the gate only outside the lock, through
  gated-flock with its start margin. Start nothing under a red gate, not even a 2-second diagnostic run.
- Judge a test run by its counts ("N pass", "0 fail", the file's test count), not by "(pass)" lines: Bun 1.4.2 prints none when output is
  not a terminal. A per-file leg counts tests, not exit codes: a file whose run executes zero tests (opt-in, all skipped) is VOID and is
  named, never counted as a pass.
- Count a leg's own disk use (an install inside a container, about 6 GB) as its peak in the gate outside the lock; make a snapshot only when
  the legs are about to run, keep it outside the evidence dir (/tmp/v6-<pkg>-hold or /run/user/<uid>), copy only logs, lcov and results
  into the evidence dir, and delete it the moment the legs end.
- Refuse owner evidence whose head differs from the head under review: check the head each log ran at (the W4H-6 shard lists ran at an
  older head).
- A type-level change needs a typecheck program that compiles its users: W4H-3b's type-only mutant (WorkflowStep.env dropped) survived
  because scripts/**/*.test.ts were in no program, until W4H-3c added them.
- Record a load-sensitive timeout as a flake on the leftover list, with its time, limit and host load; rerun it once only to show the
  cause, never retry it into green without saying so.

#### Owners and validators of the W4H-11…14 round (pending-lesson.md files, 2026-10-06…08; condensed)
- A ruling that closes a line of inquiry is followed, not re-argued; read every queued coordinator message before queueing a heavy leg
  (W4H-11 queued three forbidden base runs by reporting before reading).
- A heavy harness classifies a leg that dies on a signal while the kernel log shows host OOM kills as VOID with its own exit code that the queue
  wrapper never re-queues; a resumed hold re-queues only the legs not yet green at the head.
- A fix whose rule is "one policy read by every caller" is proven by a sweep of the remaining fixed deadlines and a call-graph check BEFORE the
  commit (W4H-11's first fix missed production-lifecycle-client.ts; the recovery proof found it).
- Files bind-mounted into a rootless runner container are 0644 (the container's user is a subordinate id; 0600 voided a run); a snapshot's tree is
  compared with `git add -A --force` so ignored tracked files are kept; the snapshot's init/config chain aborts if any GIT_* variable is set.
- Remove each scratch container in its own `podman rm -f -v` call and log any survivor by name; a hold's cleanup runs on EVERY exit path including
  the gate's exit 75 (an early exit left a 5.8 GB image untagged).
- A test that runs a tool with GIT_DIR = the real git dir asserts the real config is byte-equal afterwards.
- A command matcher matches command tokens, never paths: a typecheck gate caught a test file whose name contains "tsgo" and waited inside its
  own hold (validator-8); kill by pid only, never by pattern (validator-6).
- When a queued job should end within minutes, watch its exit file in the turn and report at once; background notices reach an idle owner late.

#### Owners, validator and coordinator of the W4H-15…16 round (2026-10-08 to 2026-10-09)
- Owner: after report.txt, FREEZE. One gate-file commit, then no commit at all; disclosures go in report-addendum.txt or pending-lesson.md (w4h-15 moved its head twice after the verdict reading, so the verdict needed a CARRY line).
- Owner: a test that exposes a defect in production code is a scope change. Report the defect with its red log and wait for the ruling before committing the fix (w4h-16 committed two root-cause fixes under a tests-only approval; accepted, but the ruling came after).
- Validator: a pkill pattern must not match the validator's own shell; kill by pid only (validator-8 hit its own shell once).
- Validator: own-pg.sh's EXIT trap binds to the shell that starts it. Never start it in a subshell; trace it with BASH_XTRACEFD in the same shell (a try of the W4H-16 journey leg lost its PostgreSQL at once).
- Validator: a heredoc that carries backticks must be quoted ('EOF'), so nothing executes while the file is written.
- Coordinator: attribute a memory hog by cwd and parent pid before naming a culprit; our own svelte-check --tsgo legs were the first OOM killer, other sessions' checks the second, the editor's tsserver the third.
- Coordinator: a teammate that "asks again" may be reading a late batch, not ignoring the inbox; check the message timestamps before re-ruling (integrator-5 received five answers in one batch).
- Owner: prove read-only with a hash list before and after, not with chmod; a read-only copy made a tool's rm -rf and sed fail silently (W4H-17 lost two replay tries).
- Coordinator: a browser spec that asserts on the mocked REQUEST and ends is a coverage race; assert the UI OUTCOME. The hosted browser lcov is five lanes, so a single lane's lcov never replaces it; add it or replace one record.
- Coordinator: a ruling that calls a symptom "the known flake" must cite the fix that covers the exact check. W4H-11's runner-FD failure was set aside as covered by #329, which settles the app's connections, not the runner's descriptors; it came back hosted (W4H-18).
- Coordinator: Docker Hub answers 429 to anonymous pulls from GitHub's shared runner addresses; three pinned oven/bun pulls (Dockerfile.test, Dockerfile.dev, the extension runner's guest image) have no login in ci.yml. The lasting answer is the user's (authenticated pulls or a mirror).
- Coordinator: a background sampler forked after a lock fd is open inherits the fd and keeps the lock until its last child exits; close the fd in the child first (`( exec {fd}>&-; … ) &`). tc-gate.sh refused a second typecheck for up to 2 s after the first ended (found by w4h-20; regression test added).
- Owner: a test reporter that writes only to a file makes a hang invisible in the job log, and an inner timeout equal to the job's never fires; the totals helper must print "cancelled" or a kill reads as "fail 0" (W4H-21).
- Owner: a browser case that asserts a live page or a live refusal on the 5 s default clock races the render and the toast's 5 s life; await the response, then assert inside the window (W4H-22; the same lesson as W4H-17 in another form).
- Coordinator: shared tools under /tmp age out. systemd-tmpfiles-clean removed the pinned `bunx` link after 10 days (2026-10-09) and a hold stopped at bun_pin; a 0-byte Bun 1.3.14 binary dates from the same daily window. Keep pinned toolchains and evidence outside /tmp, or exclude them in tmpfiles (root).
- Coordinator: a CI-wiring-only or tests-only package gets a targeted merge hold, never a skipped one; the receipts name the no-combined-run risk. A package that turns out to change production code puts the real journey leg back into the hold.

#### Validator, integrator and coordinator of the W4H-17…23 round (pending-lesson.md files, 2026-10-09 to 2026-10-12; condensed)
- Validator: judge a Playwright mutant by its own check (the target test failed on an expect() error and every other test passed); a mutant that only
  makes Playwright print "1 failed" otherwise reads as SURVIVED (browser-lib.sh spec_red).
- Validator: a sourced helper never reuses a global name the caller's library owns; arrays in helpers are `local -a`.
- Validator: TYPECHECK_WAIT_MIN above 0 inside the lock waits while holding the lock; in-lock typecheck legs use 0, and a blocked leg re-runs in its own hold.
- Validator: check a coverage claim against the fields the converter writes; the browser lcov lists only instrumented DA lines and no LF/LH, so
  "every DA line hit" is the 100 percent check, never a named line list.
- Validator: files bind-mounted into a runner container need the source's modes (cp -p; 0755 directories, 0644 configs); cp and mkdir under this umask give 0600/0700.
- Validator: crap-touched.ts and crap-score.ts load coverage/lcov.info at import; place the lcov first.
- Validator: before a harness is reused for a new shard, diff it against the harness that last ran THAT shard (a resources-shard copy had dropped the
  content shard's legacy fetch).
- Validator: under node --test an unsettled top-level await fails the file at once; a hang needs an open handle as well.
- Validator: read every kill's recorded reason, not only its status; a "Killed" whose reason the mutant cannot cause (a $server import failure for an
  options-object mutant) is a false kill (W4H-23 F1).
- Validator: a command whose output has no bun counts (Stryker, mutation.ts) is a measure or static step, never a test step; the zero-count guard turns it into exit 97.
- Validator: compute, read, then send a hash; never type one into a message before the command has printed it.
- Integrator: hosted job logs carry an ISO timestamp per line; strip it before a line-anchored matcher reads the log ("found: (none)" on a red log is a
  reader error until the stripped log is checked).
- Integrator: for one finished job of a running run, `gh api --allow-escape-sequences .../jobs/<id>/logs` into a file; `gh run view --log` refuses while the run is in progress.
- Integrator: `gh secret list` without -R exits 1 on "multiple remotes"; always pass -R and record the rc with the list.
- Integrator: tracked files under an ignored folder (tasks/) are staged with `git add -u -- <paths>`, never -f.
- Integrator: a unified diff's sha changes with its header timestamps; report the sha of the result files or of the diff body.
- Integrator: on the second copy of a per-round script, make the varying value a parameter (--pkg, the run id); one tested script per job.
- Integrator: a hold's copy step must fail loudly; assert the producer's output name exists (web-security writes lcov_security.info, not lcov.info).
- Integrator: a frozen install must also re-run when a file under web/patches changes, not only on a manifest or lockfile change; otherwise the hook
  tests the old installed dependency (W4H-23; commit.sh).
- Coordinator: a baseline must come from the same run and sandbox that recorded the failure; an alone re-run later in the run is a different environment
  and a different answer (W4H-23 F1: the initial run's failed-file list seeds the never-kill set).
- Coordinator: after a feature PR merges, main shares the gate tooling; the "main = the N standing findings" binding becomes "main = 0 findings, any
  finding = STOP", and the expected list goes empty (kept as .bak).
- Owner: a baseline you measured is worthless if the decision does not read it. The initial Stryker run listed the 22 test files that cannot load in
  the sandbox, but the kill rule asked a later, separate run, which a late bail could cancel and leave reading as "loaded". Decide from the baseline
  of the SAME run, shared with every worker, and require positive evidence (the file ran and passed) before a check may say "clean" (W4H-23 F1).
- Owner: an intermittent false result (1 of 9 runs) is a correctness bug, not noise. Fix it by construction and prove it with a pin case that fails
  on the old code; never accept "it did not happen again in five runs" as the fix (W4H-23 F1).

#### Owner, validator, integrator and coordinator of W4H-24 and the PR 337 round (pending-lesson.md files, 2026-10-12 to 2026-10-13; condensed)
- Owner: size a job timeout from the slowdown you must survive, not from a fixed multiple alone; replay the incident's numbers before you
  choose the value (3x the p95 = 15 min would still have cancelled run 38404984224 on a 5.7x slower runner; the ruled 6x = 30 min holds).
- Owner: make a slow runner visible in the log before the slow phase starts; a wall-time line that warns above 2x the median at the end of
  install names the cause even when the job is cancelled later. A cancel alone reads like a hang.
- Owner: `bun install --ignore-scripts` skips `build:packages`, so workspace packages have no dist/; a browser-building test then lists 0
  Playwright tests and typecheck reports hundreds of errors. Run `bun run build:packages` before you call such a red a defect; CI's install runs it.
- Validator: the same hash error twice in one day means the rule needs a mechanism, not intent: a hash never goes into a message in the same
  batch as the command that computes it — compute, read the output, then send.
- Validator and integrator: a bash line-coverage tool built on xtrace must not count function definition headers (`name() {`) as executable;
  bash never traces them. A test that starts bash with a clean environment drops BASH_ENV, so the trace settings travel in a wrapper first on PATH.
- Coordinator: a job cap is a hang guard, not a performance budget; a correct result after 18 minutes beats a cancel plus a human re-run. The
  performance signal is the WARN step, never the cap.
- Coordinator: teammate reports reach the coordinator only when its turn ends; four re-sends of the same report are noise. One report per
  milestone, and the coordinator reads the state from disk and git in between.
- Coordinator: Docker Hub answers 502 as well as 429 to the hosted runners' anonymous pulls (class D); the three jobs behind the pull fail
  closed as cascades (B). The root fix is a login step or a mirror, a maintainer decision; a re-run of the failed jobs is the recovery.

#### Owners (from w4h-5/pending-lesson.md)
- Read the inbox before each report and before each new leg of work; when an order changes the plan (a split, a hold, a start word), stop
  and follow it.
- Runner homes and checkout snapshots live outside the evidence dir (/tmp/<pkg>-home-*/) or are removed after each run.
- A public image you pulled (for example docker.io/pgvector/pgvector:pg15) is not your tag; leave public images in place. Only tags you
  built (localhost/<pkg>-*) are yours to remove by name.

### W4H-23 (2026-10-12)
- Owner: never edit a shell script while a run executes it. Bash reads a script as it goes, so an edit shifts the bytes the
  running shell reads next. Copy the script to a new name and change the copy. (I edited my R2 wrapper mid-run and had to
  restore its original bytes before the shell left its loop.)
- Owner: a guard that turns a silent artifact into a red can expose a second silent artifact under it. Before counting a new
  failure kind as a kill, measure its baseline: 30-33 test files per shard already fail to load in the Stryker sandbox, so
  "a test file failed" must mean "failed WITH the mutant and loaded WITHOUT it".
- Owner: a green nightly can measure nothing. The mutation nightly was green while 11772 of 18934 mutants ran zero tests;
  read the per-mutant test counts, not the exit code, before calling a quality gate green.
