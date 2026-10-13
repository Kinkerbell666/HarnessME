# Sandbox & Isolation

> _The OS-level confinement layer that wraps every untrusted spawn — extension subprocesses, per-run agent shells, and MCP servers — behind a capability-probed tier (bwrap › landlock › advisory) whose one non-negotiable invariant is that `.ezcorp/data` (the PGlite DB + JWT secret) is never reachable._

## Intent

EZCorp runs arbitrary third-party code: extension entrypoints, the per-run agent shell, and external MCP server binaries. None of it can be trusted with the host filesystem — most critically the encrypted SQLite/PGlite database and the JWT signing secret that both live under `<projectRoot>/.ezcorp/data`. This feature is the defense-in-depth wrapper that, at every spawn site, applies the strongest OS-isolation primitive the host actually supports (an `unshare`+Landlock `bwrap` jail, a per-process Landlock fs-jail, or — last resort — only the in-process SDK module-poisoning) plus a memory bound, while guaranteeing by construction that no granted path is, contains, or is contained by the data dir. It is the OS-level companion to the permission/grant system (which gates *what an extension may ask for*); this layer enforces *what its process can physically touch*.

## How it works

The design is one capability probe + one DRY argv builder + three spawn seams, layered over an always-on in-process preload for the Bun extension subprocess.

### 1. Capability probe — pick the strongest tier (`sandbox/capability-probe.ts`)

`probeSandboxCapabilities()` runs each primitive probe and `selectTier()` resolves the strongest, memoized on first use via `getSandboxCapabilities()` / `getSandboxTier()` (one probe per process; `__resetSandboxCapabilitiesCache()` is the test seam). Probes:

- `probeLandlockAbi()` — Landlock ABI via FFI (`sandbox/landlock-ffi.ts`'s `landlockAbiVersion()`).
- `probeUserns()` — spawns `unshare -Ur true`.
- `bwrapIsSetuid()` — walks `$PATH` for a `bwrap` with the S_ISUID bit.
- plus informational `probeCgroupV2Delegation()` / `probeKvm()` (microVM upgrade path).

`selectTier()` is pure and exhaustively tested:

- **`bwrap`** — a verified x64 or arm64 syscall table, `landlockAbi >= 1`, working `userns`, and a non-setuid `bwrap`. Adds `/proc` + PID hiding on top of the Landlock-equivalent fs jail.
- **`landlock`** — usable Landlock (verified x64 or arm64 table and ABI ≥ 1) but no usable userns (or a setuid `bwrap`). fs-jail only, no PID/proc hiding. **This is the Docker app-container case** — Landlock needs zero namespaces/caps/setuid and its syscalls pass Docker's default seccomp, where the earlier bwrap/netns spike failed on unprivileged-userns restrictions.
- **`advisory`** — no usable Landlock. No OS isolation prefix; the inner command runs as-is and only the SDK module-poisoning (preload) applies.

A setuid-root `bwrap` is deliberately *refused* (it rejects `--size` on its private `/tmp`, and on such hosts the runtime lives behind `/run/...` symlinks the minimal bind-set misses), so the tier drops to `landlock`.

### 2. The DRY isolation seam (`sandbox/build-sandbox-argv.ts`)

`buildSandboxArgv({ tier, workspaceDir, projectRoot, command, args, roPaths, rwPaths, listPaths, seccompFd })` is a **pure** function returning `{ argv, env, landlockSpec, tier }` — it never spawns; the caller does. Per tier:

- **advisory** → returns the inner command unchanged (no binds, so nothing new to expose).
- **landlock** → builds a `LandlockJailSpec` (below) and returns `["bun", <landlock-shim>, "--", ...inner]` with the serialized spec in `EZCORP_LANDLOCK_SPEC`. Landlock is per-process, so a pre-exec shim applies the jail in-process then execs the inner command, which **inherits** the restrictions across `execve`.
- **bwrap** → delegates to `preview-jail.ts`'s `buildMcpJailBwrapArgs` (the minimal bind-set: ONE rw workspace, ro-bind system dirs, private `/tmp`, `/proc` + `/dev`, **no `--bind / /`**, nothing under `.ezcorp/data`), omitting `--size` when `bwrap` is setuid.

Every tier delegates the deny-by-default invariant to a shared assertion — fail-closed on any granted path that would expose the DB/secret dir.

### 3. The Landlock jail (`sandbox/landlock.ts` + `sandbox/landlock-shim.ts`)

`buildLandlockJailSpec()` resolves an allowlist into a serializable `{ ro, rw, list? }` spec:

- `rw` paths get a write-inclusive grant (read/exec/write/make/remove/truncate, masked to the kernel ABI); `ro` paths get read/exec only; everything else loses all access. Landlock *enforces* every access in the handled set, so the rw/ro split is load-bearing — a read-only workspace would EACCES every write.
- **The deny invariant is checked against the REAL (symlink-resolved) path** via `canonicalizeForJail()` → `realpathSync`. This closes the symlink leak: Landlock binds the *kernel inode*, so a grant that is a symlink whose target is `.ezcorp/data` would pass a purely-lexical check yet have the kernel grant the real data-dir inode (a read leak of the DB + JWT secret). A non-existent path falls back to lexical `resolve()` (the kernel can't grant a missing inode), keeping the tier's tolerance for distro-absent RO dirs like `/lib64`, `/nix`.
- `list` paths (optional) are granted read-only and are **exempt** from the data-dir-*ancestor* assertion — used to grant a git repo root that *contains* `.ezcorp/data` (git must scan the whole tree). They may be an ancestor of the data dir but must not BE it or live under it; since they are read-only, the ungranted `.ezcorp/data` subtree stays unreadable.

`landlock-shim.ts` is a separate `bun` entrypoint (never imported, only spawned). It parses the spec from `EZCORP_LANDLOCK_SPEC`, `chdir`s into `rw[0]` (the workspace) so the inner `bun` can read its cwd, calls `applyLandlockJailSpec()` (which throws if the kernel can't enforce), then spawns the inner command — fail-closed: a missing/invalid spec, unsupported kernel, or failed `restrict_self` aborts WITHOUT running the inner command.

### 4. Extension subprocess preload (`runtime/sandbox-preload.ts`) — the in-process layer

Loaded via `bun run --preload <preload>` before the extension entrypoint (resolved by `subprocess.ts:resolveSandboxPreloadPath`, with a bundled-server fallback under `EZCORP_PROJECT_ROOT`). It poisons the JS surface regardless of OS tier:

- **Filesystem is ALWAYS poisoned** — `fs` / `fs/promises` modules, `Bun.file` / `Bun.write` / `Bun.glob`. Granted fs access does NOT unblock the raw primitive; it flows through the host-mediated `ezcorp/fs.*` reverse-RPC (`fs-handler.ts`) so the host does the realpath check + IO + audit. `EZCORP_FS_ALLOWED` is informational only (SDK fast-fail).
- **Network** — `http`/`https`/`net`/`tls`/`dns`/`dgram` modules, `fetch`, `Bun.connect`/`listen`/`serve`/`udpSocket` are denied unless `EZCORP_NETWORK_ALLOWED=1`. When granted, `fetch` is wrapped (below), not freed.
- **Shell** — `child_process`, `Bun.spawn`/`spawnSync`/`$` denied unless `EZCORP_SHELL_ALLOWED=1`.
- **Always denied** — `Bun.dlopen` (FFI = unrestricted native code), `Worker` / `WebSocket` / `EventSource` (no manifest surface / would spawn an un-preloaded module graph). A `process.binding` denylist (`fs`, `natives`, `util`, `config`) closes the C++ binding escape while leaving Bun's legitimate internal `require` calls intact.
- Poisoning is belt-and-suspenders: every own property of a builtin module becomes a throwing getter, AND `Module.prototype.require` + `Module.createRequire` are patched so even `require("http")` throws with the permission-label message before returning the cached object.

### 5. In-sandbox fetch classification (`runtime/network-wrapper.ts`)

When network IS granted, `installFetchWrapper()` wraps `globalThis.fetch`; `classifyFetch(url, …)` decides the lane (pure, tested):

- **invalid** → throw.
- **internal** (localhost / 127.0.0.1 / ::1 / RFC-1918 / link-local, per `internal-host.ts`) → forwarded to the host via `ezcorp/network.internal` reverse-RPC. The host PDP enforces and performs the fetch host-side, and follows redirects itself so the PDP checks every hop — the **SSRF carve-out**: the wrapper can't trust its own env for internal hosts, so the manifest gate lives host-side.
- **deny** → host not in the spawn-time `EZCORP_PERMITTED_HOSTS` ceiling, or not in the active tool's `EZCORP_TOOL_NETWORK_CAPS` per-tool override (ALS-bound). Per-tool overrides can only narrow, never widen.
- **external** → forward to the real `fetch` (the host already vetted the allowlist; the PDP is deliberately not consulted per-call for perf).

### 6. Three spawn seams

- **Seam A — extension subprocess** (`src/extensions/subprocess.ts`): inner command is `prlimit --rss=<bytes> bun run --preload <preload> <entrypoint>`. `resolveSandboxWrap()` calls `buildSandboxArgv` (workspace = `.ezcorp/extension-data/<id>`; rw also includes the per-ext `TMPDIR`; the extension *code* dir + preload dir are added read-only or `bun` couldn't read its own entrypoint). Fail-SAFE: a jail-build error logs and runs un-jailed (the preload still applies).
- **Seam B — per-run agent shell** (`src/runtime/tools/shell.ts`): jails every `/bin/sh -c` spawn to the per-run `workspaceDir` (rw) on the same tier; `spawnCwd` is the workspace when jailed.
- **Seam C — MCP servers** (`src/extensions/mcp-sandbox.ts`): the heaviest stack, below.

### 7. MCP server isolation (`src/extensions/mcp-sandbox.ts`)

MCP `stdio` servers are arbitrary external binaries (Python/Go/Rust) — the SDK module-poisoning does **not** apply to them — so they get a separate, deeper stack built by `buildSandboxedMcpSpec()`:

- **Always**: `prlimit --rss/--as` memory bounds + `buildAllowedEnv` (the child never inherits the web server's `process.env`).
- **With a PDP `ctx`** (the production path): wrap in `unshare -U -m` + a launcher that drops `CAP_SYS_ADMIN`; start a **per-MCP forward proxy** on host loopback with a per-instance bearer token and inject `HTTPS_PROXY`/`HTTP_PROXY` (and lower-case forms) so outbound HTTPS routes through it, gated per-host by the PDP; load a **seccomp BPF** profile (FD 3, `--seccomp`); and on capable hosts a **Stage 2 veth** network namespace (`ip link ... type veth` into `br-ezcorp-mcp`, 60-slot cap) for kernel-level network isolation.
- **Tier-gated fs-jail** (unconditional whenever a usable tier exists, no longer behind a flag): `bwrap` tier → the `EZCORP_MCP_FS_JAIL=1` minimal-bind launcher branch; `landlock` tier → wrap the inner prlimit chain with the Landlock shim; `advisory` → the legacy `--bind / /` path but with `EZCORP_MCP_DATA_DIR` masking the real DB dir + backups + `.ezcorp/data` via a private tmpfs (a denylist backstop).
- **Fail-open vs fail-closed**: by default every degrade point (no netns/bwrap/veth, kill-switches) **fails open** to a weaker stage with an `MCP_NETNS_FALLBACK` audit row. `EZCORP_MCP_REQUIRE_SANDBOX=1` flips this to **fail-closed**: any spawn that can't deliver full isolation is *refused* with an operator-actionable error + `MCP_SANDBOX_REQUIRED_REFUSAL` row. A pre-spawn conntrack-pressure guard (>70% of `nf_conntrack_max`) also refuses + emits `MCP_CONNTRACK_HIGH`. A post-shutdown soak reader (`runMcpSeccompSoakReader`) scans `journalctl -k` for `type=1326` seccomp violations matching the child PID and emits `MCP_SECCOMP_VIOLATION`.

## Usage

This is infrastructure — there is no API route or UI page. It is exercised by configuration and at every untrusted spawn.

### Env vars (operator)

| Var | Effect |
|---|---|
| `EZCORP_MCP_REQUIRE_SANDBOX=1` | Fail-CLOSED: refuse any MCP spawn that can't deliver full isolation (else fail-open degrade). |
| `EZCORP_MCP_STAGE1_TMPFS=0` | Kill-switch: skip the bwrap tmpfs wrap (one `MCP_NETNS_FALLBACK` boot row). |
| `EZCORP_MCP_STAGE1_SECCOMP=0` | Kill-switch: skip the seccomp BPF profile load. |
| `EZCORP_MCP_STAGE2_VETH=0` | Kill-switch: skip Stage 2 veth network isolation (fall back to Stage 1). |
| `EZCORP_PROJECT_ROOT` | Host-resolved project root; sole source for the `.ezcorp/data` exclusion (never from a manifest's `spec.env`). |

### Env vars (host→sandbox, set by the spawn sites — not operator-facing)

- `EZCORP_NETWORK_ALLOWED` / `EZCORP_SHELL_ALLOWED` — `=1` unblocks the corresponding preload deniers.
- `EZCORP_PERMITTED_HOSTS` (comma-joined) + `EZCORP_TOOL_NETWORK_CAPS` (JSON) — the fetch wrapper's per-extension ceiling + per-tool override.
- `EZCORP_FS_ALLOWED` — informational only (SDK fast-fail; does NOT unblock fs primitives).
- `EZCORP_LANDLOCK_SPEC` — the serialized `LandlockJailSpec` consumed by the landlock shim.

`buildAllowedEnv()` (`src/extensions/registry.ts`) is the env whitelist: only **PATH, HOME, NODE_ENV, and a per-extension TMPDIR** pass by default; granted `manifest.permissions.env` keys + the conditional flags above are added on top. The child never sees the host `process.env`.

### Manifest

- `resources.memory` (e.g. `"256MB"`) sizes the `prlimit --rss` bound (`MIN_MEMORY_LIMIT_MB` / `DEFAULT_MEMORY_LIMIT_MB` = 512MB floor).
- `permissions.network` / `shell` / `filesystem` / `env` drive the preload flags + allowlist.

## Key files

- `src/extensions/sandbox/capability-probe.ts` — `selectTier` + memoized `getSandboxTier` / `getSandboxCapabilities`; the bwrap › landlock › advisory decision.
- `src/extensions/sandbox/build-sandbox-argv.ts` — the single DRY `buildSandboxArgv` seam (pure; argv + env per tier).
- `src/extensions/sandbox/landlock.ts` — `buildLandlockJailSpec` / `applyLandlockJailSpec`; `canonicalizeForJail` (realpath, closes the symlink leak); rw/ro/list distinction.
- `src/extensions/sandbox/landlock-shim.ts` — pre-exec `bun` shim: parse spec → chdir → apply jail → exec inner (fail-closed).
- `src/extensions/sandbox/landlock-ffi.ts` — raw Landlock + prctl syscalls via FFI (`landlockAbiVersion`, `applyReadWriteJail`, ABI access masks; verified x64 and arm64 tables).
- `src/extensions/runtime/sandbox-preload.ts` — `bun --preload` for extension subprocesses: poison fs always; net/shell unless granted; FFI/Worker/process.binding always denied; fetch wrapper.
- `src/extensions/runtime/network-wrapper.ts` — `classifyFetch` (invalid/internal/deny/external) + allowlist parsers; the SSRF carve-out routing.
- `src/extensions/runtime/internal-host.ts` — shared internal-host regex (`INTERNAL_HOST_RE`) so wrapper + host agree on "internal".
- `src/extensions/preview-jail.ts` — minimal bwrap bind-set builder (`buildMcpJailBwrapArgs`, `buildPreviewJailBwrapArgs`) + the shared `forbiddenDataDir` / `assertOutsideDataDir` / `canonicalizeJailPath` (realpath) data-dir invariant; `assertJailArgsSafe`.
- `src/extensions/mcp-sandbox.ts` — `buildSandboxedMcpSpec`: prlimit + proxy + seccomp + Stage 2 veth + tier-gated fs-jail; fail-open/fail-closed gates; `runMcpSeccompSoakReader`.
- `src/extensions/subprocess.ts` — Seam A: `ExtensionProcess.getSpawnArgs` / `resolveSandboxWrap` (extension subprocess wrap; prlimit + preload).
- `src/runtime/tools/shell.ts` — Seam B: per-run agent shell jailed to the run workspace.
- `src/extensions/registry.ts` — `buildAllowedEnv` (env whitelist) + the MCP spawn caller (`getMcpClient`).
- `src/extensions/mcp-netns.ts` — netns/veth/bwrap probes + `unshare` launcher args for the MCP stack.
- `src/extensions/mcp-proxy.ts` — the per-MCP bearer-gated forward proxy.
- `docs/extensions/security.md` — the bundled-extension trust model (ceiling + manifest lockfile), complementary to this OS layer.

## Features it touches

- [[mcp-servers]] — MCP `stdio` servers get the deepest sandbox stack (namespace + proxy + seccomp + veth) since the preload doesn't apply to external binaries.
- [[permissions-and-grants]] — grants decide *what may be asked for*; this layer enforces *what the process can physically reach*. The preload flags are derived from granted permissions.
- [[runtime-and-rpc]] — poisoned fs/network primitives route through the host-mediated `ezcorp/fs.*` + `ezcorp/network.internal` reverse-RPC over the JSON-RPC transport.
- [[builtin-file-tools]] — note the asymmetry: those tools' `validatePath` containment is **lexical** (no realpath), whereas this layer's jail invariant resolves real paths; the `@`-mention FS scanner uses realpath too.
- [[preview-port-exposure]] — the bwrap minimal-bind builder is shared with the untrusted preview-process jail (same `.ezcorp/data` threat class).
- [[web-search]] — extension/MCP outbound network rides the fetch wrapper + per-MCP proxy allowlist.
- [[audit-and-observability]] — every degrade/refusal emits audit rows (`MCP_NETNS_CREATED/FALLBACK`, `MCP_VETH_CREATED`, `MCP_SECCOMP_VIOLATION`, `MCP_CONNTRACK_HIGH`, `MCP_SANDBOX_REQUIRED_REFUSAL`).
- [[bundled-catalog]] — bundled extensions still run through the same OS sandbox; their *grant* ceiling is the separate concern in `docs/extensions/security.md`.
- [[rbac-and-permission-modes]] — the permission mode (default `yolo`) governs tool-call approval; orthogonal to OS confinement, which is always on where a tier exists.

## Related docs

- [docs/extensions/security.md](../../extensions/security.md) — bundled-extension trust model: the capability ceiling (`bundled-ceiling.ts`) + manifest lockfile (`manifest.lock.json`). Complements (does not duplicate) this OS-isolation layer.
- [docs/extensions/data-storage.md](../../extensions/data-storage.md) — the `.ezcorp/extension-data/<name>/` convention that becomes the jail's writable workspace.
- `scripts/spikes/A1-FINDINGS.md` — in-repo evidence for the Landlock-primary thesis (why bwrap/netns failed in the container).

## Notes & gotchas

- **The probe is lazy, not boot-eager.** `getSandboxTier()` memoizes on FIRST spawn, not at server boot — there is no explicit boot-time wiring; the first untrusted spawn pays the probe cost once per process.
- **`landlock` is the production-container tier.** In the Docker app container userns is typically blocked, so the resolved tier is `landlock` (no PID/proc hiding) — not `bwrap`. `advisory` (SDK poisoning only) is the fallback on hosts with no usable Landlock or without a verified x64/arm64 syscall table; the probe does not guess numbers for other architectures.
- **Lexical vs realpath asymmetry across the codebase.** This layer's jail invariant (both `landlock.ts:canonicalizeForJail` and `preview-jail.ts:canonicalizeJailPath`) resolves REAL paths to close the symlink-into-`.ezcorp/data` leak. By contrast the built-in file-tool path containment (`src/runtime/tools/validate.ts:validatePath`) is **lexical** (no realpath); only the FS scanner / `@`-autocomplete (`src/runtime/fs/scan-fs.ts:realpathInsideRoot`) realpaths. Don't assume one containment model everywhere.
- **MCP fails OPEN by default.** Unless `EZCORP_MCP_REQUIRE_SANDBOX=1` is set, a host that can't set up netns/veth/bwrap silently runs the MCP at a weaker isolation stage (only an audit row). On many real Docker hosts netns/veth can't be set up even `--privileged`. The tier-gated fs-jail is the floor that always applies, but kernel network isolation is best-effort.
- **The fs primitive denial is unconditional and flag-independent.** `EZCORP_FS_ALLOWED` does NOT unblock `Bun.file` / `node:fs` — granted fs access only means the host-mediated `ezcorp/fs.*` reverse-RPC is meaningful. This closed both the TOCTOU window in the old path-check-then-read pattern and the bypass where an extension ignored the SDK helper.
- **`advisory` tier means the extension subprocess is contained by the preload only** — an extension that manages to escape the JS poisoning (or an MCP binary, which the preload never touches) has the host fs unless a real OS tier is present. The OS jail is the load-bearing containment; the preload is the JS-level backstop.
- **Memory bound is `prlimit --rss`, not the tmpfs `--size`.** The private `/tmp` size cap is defense-in-depth and is dropped on setuid-bwrap hosts; the real RAM bound is always the `--rss` on the inner command. MCP keeps a finite-but-generous `--as` (≥4 GiB) because JIT runtimes reserve tens of GB of *virtual* address space.
- **The data-dir exclusion uses the HOST-resolved project root only.** `EZCORP_PROJECT_ROOT` (from `buildAllowedEnv`) computes `.ezcorp/data`; a manifest's `spec.env` can never steer it (the jail env additions are merged AFTER `spec.env`).
- **A HOST-side applier is outside this layer entirely — it must carry its own containment.** The `file-organizer` daemon and Hub events route touch watched host folders (Desktop/Downloads/…) with raw `node:fs` from the HOST process, by design: those folders are outside the subprocess `$CWD` jail, so no sandbox tier is in the path. The subprocess still cannot reach them, but the invariant above then rests entirely on `src/extensions/file-organizer-applier.ts`. It reproduces the jail's rules in software: every path canonicalized (parents realpath'd, leaves preserved) and contained on BOTH ends against a realpath'd anchor; symlink decisions from a live `lstat`, never from caller-supplied metadata; a fail-closed refusal when an anchor won't resolve; and a hard deny on `isReservedSensitivePath()` — the same reserved set this layer masks, which is what covers the container's `EZCORP_DB_PATH=/app/data/ezcorp` (no `.ezcorp/data` segment, so a path-shaped check alone misses it). A host-side executor that skips any of that re-opens the `.ezcorp/data` invariant with no sandbox behind it.
- **bwrap-tier integration tests are skipped where userns is unavailable** — the live FFI/jail behavior is proven by the `scripts/spikes/` evidence scripts and by tier-pinned unit tests (`_setSandboxTierOverrideForTests`), not by spawning a real jail in CI.
