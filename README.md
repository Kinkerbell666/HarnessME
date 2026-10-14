# EZCorp

Chat with persistent memory, find agent apps others built, and create your own.

EZCorp is a self-hosted AI platform that brings together multi-model chat, long-term memory, and an extension ecosystem in one product.

## Pillars
- Extensibility
  - extension that allow users to create custom UI, and interactions 
- Security 
  - Role Based Access Control
  - permissions for LLM tool calls
- Reliability

## Features

- **Multi-model streaming chat** -- Connect OpenAI, Anthropic, Google Gemini, and 20+ providers. Switch models mid-conversation. Long chats are auto-compacted per-model so they never dead-end on context-window errors. See [docs/context-compaction.md](docs/context-compaction.md).
- **Persistent memory** -- Conversations are remembered across sessions with semantic search and automatic context injection.
- **Extensions and marketplace** -- Install community extensions or build your own tools, skills, and agents.
- **Slash commands** -- Type `/review`, `/commit`, `/deploy` to expand reusable prompt templates. Compatible with Claude Code (`.claude/commands/`), Codex CLI (`.codex/prompts/`), and plain `agents/` folders. See [docs/slash-commands.md](docs/slash-commands.md).
- **Teams** -- Multi-user support with team workspaces and shared conversations.
- **Self-hosted** -- Your data stays on your infrastructure. Chat runs in one app container. Extensions use a separate isolated host runner.

## Quick Start (self-hosted, builds from source)

**Guided Podman setup for macOS or Linux** — installs the engine if missing on
macOS, verifies the required engine on Linux, prepares a complete `.env.prod`,
pre-creates the bind mounts, brings the stack up and waits for it to report
ready:

```bash
git clone <repo-url> ez-corp-ai && cd ez-corp-ai
bash scripts/setup-podman.sh
```

A fresh environment file stays private and unpublished until the runner choice
is complete. The script then publishes that complete mode-600 file once; a
concurrent file is never replaced. An existing `.env.prod` is never modified.
If it is private, has non-placeholder production secrets and URL, and has a
supported runner mode, setup leaves every byte unchanged. Otherwise setup
prints the exact manual settings and stops. It also refuses a file with group
or other permission bits. On Linux, an isolated runner counts as provisioned
only when its numeric group matches the socket's rootless Podman mapping and
its production-valid credential authenticates the canonical runner endpoint.
The installer accepts only portable printable-ASCII runner tokens (at least 32
bytes, with no whitespace); the runtime contract is wider, but this stricter
subset behaves identically across Linux and macOS locales.

On macOS the isolated extension runner cannot work, so fresh setup shows what
`trusted-local` costs and asks before adding it to the private candidate
(`--accept-unsandboxed-extensions` answers yes for non-interactive use). On
Linux, provision the isolated runner in an existing `.env.prod`, or pass that
flag to choose trusted-local for a fresh file; without either choice, nothing
is published. `--check` reports without changing anything. See
[docs/macos-local-dev.md](docs/macos-local-dev.md).

The manual steps it automates, for the record or for Docker:

```bash
git clone <repo-url> ez-corp-ai && cd ez-corp-ai
cp .env.prod.example .env.prod && chmod 600 .env.prod

# Fill the four required values in .env.prod:
#   EZCORP_ENCRYPTION_SECRET  →  openssl rand -base64 32
#   EZCORP_ENCRYPTION_SALT    →  openssl rand -base64 16
#   EZCORP_JWT_SECRET         →  openssl rand -base64 32
#   EZCORP_PUBLIC_URL         →  e.g. http://localhost:4000 (or your TLS-fronted URL)

# One-time: pre-create the data dir with the right owner. Docker auto-creates
# a missing bind-mount source as root, and the unprivileged uid-1000 `bun`
# runtime can't write it — PGlite then fails to open on first boot.
mkdir -p .ezcorp/data && sudo chown -R 1000:1000 .ezcorp/data

# Before the first start, set up the host extension runner:
# deploy/extension-runner/README.md
# Podman is the default engine. The wrapper points Compose at the rootless
# Podman socket (or the `podman machine` one on macOS) and layers the Podman
# override — both silently wrong when done by hand.
bun run podman --prod up -d --build

# Docker instead? Same stack, minus the Podman override:
#   docker compose -f compose.prod.yml --env-file .env.prod up -d --build
```

The first `up` builds the image locally (a couple of minutes); subsequent ups reuse the Docker layer cache. When build is done, open [http://localhost:4000](http://localhost:4000), create your admin account, and start chatting. Your data lives in `./.ezcorp/data/` in the working tree (a host bind mount, not a docker-managed volume), so it survives `docker compose down`, `down -v`, and image upgrades — backing up is just backing up that host directory. See [Data persistence](#data-persistence) below.

Both Compose stacks connect to the isolated extension runner by default. Set up the [host runner](deploy/extension-runner/README.md) before starting the app. Missing mounts or a failed authenticated connection stop startup with an error. Linux is required for the isolated runner; other hosts must explicitly choose the trusted-local mode described in that guide.

For HTTPS, backups, external Postgres, and auto-updates, see the **[production guide](docs/production-guide.md)**.

> **Using rootless Podman?** The development wrapper is Linux-only. The
> production stack runs on Linux or macOS with `compose.podman-prod.yml`, and
> the Docker-only `chown` step does not apply. See
> [Running the production stack under rootless Podman](docs/deployment.md#running-the-production-stack-under-rootless-podman).

> **Pre-built image (future):** once a release is published to a container registry, you can skip the build by setting `EZCORP_IMAGE=ghcr.io/<owner>/<image>:<tag>` in `.env.prod`. The `image:` line in `compose.prod.yml` already honors that override.

> **On Windows?** Run the stack in Ubuntu on WSL2. See
> [Running on Windows with WSL2 and Ubuntu](docs/windows-wsl2.md).

## Dev mode (Linux only)

A second compose file (`docker-compose.yml`) runs the same source tree with Vite HMR and a source-mounted container so edits hot-reload. It uses `network_mode: host`, which **only works on Linux** — Mac/Windows users should stick with the prod-mode quick start above.

```bash
cp .env.example .env

# Fill the same three encryption/JWT secrets in .env so they're stable
# across restarts (otherwise the JWT secret auto-rotates on each boot
# and every active session is invalidated — users get bounced to login).
#   EZCORP_ENCRYPTION_SECRET  →  openssl rand -base64 32
#   EZCORP_ENCRYPTION_SALT    →  openssl rand -base64 16
#   EZCORP_JWT_SECRET         →  openssl rand -base64 32

# Before the first start, set up the host extension runner:
# deploy/extension-runner/README.md
docker compose up -d                               # → http://localhost:3000
```

**Optional local suggestion model.** The composer's ✨ prompt-enhancement row
needs an Ollama on `localhost:11434`. The dev stack ships one, but it is
**opt-in**, because publishing that well-known port fails the whole `up` on a
box already running Ollama natively:

```bash
docker compose --profile ollama up -d              # adds the sidecar
```

Skip it if you already run Ollama yourself — the app is host-networked and
uses whatever answers on `:11434`, so your own daemon works as-is (just
`ollama pull qwen3:1.7b`). With neither, the ✨ row simply hides; everything
else, including the tool-suggestion chips, is unaffected. Details:
[deployment.md](docs/deployment.md#suggestion-model-sidecar-ollama).

### Self-modification project (dogfooding)

The dev stack mounts the **whole checkout** read-write at `/repo` inside the
container and boot-seeds a project named **"EZCorp (this app)"** pointing at it
(`EZCORP_SELF_PROJECT_PATH=/repo` → `src/db/seed-self-project.ts`). Pick that
project in the UI and the in-app agent can read and edit EZCorp's own source —
edits write straight through to your working tree, and `web/src/**` changes
hot-reload in the very UI you're chatting in.

What to know before letting an agent loose on it:

- **Backend edits can kill the run making them.** `/repo/src` is the same
  files as the Vite-watched `/app/src`, so a `src/**` write can invalidate the
  SSR module graph mid-request. The seeded per-project system prompt (editable
  at `/project/self/settings`) tells the agent to finish all writes first and
  then apply them via `docker compose restart app` (host) or `kill 1`
  (in-container; the container auto-restarts).
- **`.git` is mounted read-only.** `git diff/log/status` work for agent
  context, but commits/branches/stashes fail with a read-only-filesystem error
  on purpose: the container runs as root, and root-owned objects/refs would
  poison the host repo. Committing stays a host-side action. Optional
  `EZCORP_GIT_NAME` / `EZCORP_GIT_EMAIL` in `.env` set the identity should you
  ever loosen this.
- **New files land root-owned on the host** (same caveat as `./.ezcorp/`);
  edits to existing files keep their owner. `sudo chown` occasionally, or
  delete/recreate via git.
- **Non-mounted files need a rebuild.** `package.json`, `bun.lock`,
  `scripts/**`, `packages/**` edits persist to the checkout but the running
  server keeps the image's copy until `docker compose up -d --build`.
- **Secrets are masked.** `.env*`, `./.ezcorp/` (the prod stack's live DB +
  keys) and `worktrees/` are blanked out inside `/repo`. On a fresh clone the
  mask targets materialize as empty root-owned gitignored files — harmless.

### Dev and prod side-by-side

`docker-compose.yml` (dev) and `compose.prod.yml` (prod) declare distinct project names (`ez-corp-ai` and `ezcorp-prod`) and bind to different host ports (`3000` and `4000` by default), so the two stacks run independently — same source tree, different runtimes, different volumes. Bringing one up never touches the other:

```bash
bun run podman up -d            # dev  (docker compose up -d)
bun run podman --prod up -d     # prod (docker compose -f compose.prod.yml …)
docker compose -f compose.prod.yml --env-file .env.prod down      # stop prod, dev keeps running
```

Without the distinct `name:` they would share the default project namespace (the directory name) and `up` against either file would silently recreate the other's container in place.

## Docker Setup

EZCorp runs as a single Docker service with PGlite (embedded Postgres) by default. A safe boot sequence (pre-migrate snapshot → migrate → rollback-on-failure) protects your data across upgrades. See [Boot sequence and migration safety](docs/production-guide.md#2-boot-sequence-and-migration-safety) for details.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `EZCORP_PORT` | `3000` | Host port to bind |
| `EZCORP_DB_PATH` | `/app/data/ezcorp` | Database storage path |
| `EZCORP_BACKUP_DIR` | `<dbDir>/backups` | Where pre-boot and interval snapshots live |
| `EZCORP_CHECK_UPDATES` | `true` | In-app update banner (set `false` to disable the GitHub Releases poll) |
| `EZCORP_UPDATE_REPO` | `ezcorp-org/EZcorp` | Owner/repo for the update check |
| `EZCORP_SCAN_GLOBAL_COMMANDS` | `1` | Scan `~/.claude/`, `~/.codex/`, `~/agents/` for slash commands. Set to `0` for multi-tenant deploys. |

### Readiness probe

- `GET /api/health` — liveness (HTTP is up). Used by Docker's `HEALTHCHECK`.
- `GET /api/ready` — readiness (migrations succeeded). 503 during boot or if a migration failed. Point Watchtower / Kubernetes / load-balancer probes here.

### Auto-updates

The in-app banner notifies you when a new release is published. For fully
automatic updates, uncomment the Watchtower service in `compose.prod.yml` —
it'll pull new `:latest` images and the safe boot sequence handles migration
rollback if anything goes wrong.

### Data persistence

Data is stored in `./.ezcorp/data/` in the working tree (`.ezcorp/` is
gitignored), bind-mounted to `/app/data`. It survives `docker compose
down`, `down -v`, recreate, and image upgrades — there is no
docker-managed volume to lose. One-time setup before the first `up`:

```bash
mkdir -p .ezcorp/data && sudo chown -R 1000:1000 .ezcorp/data
```

### Migrating from an older named-volume deployment

Earlier builds stored data in the `ezcorp-data` Docker volume. Copy it
into the new local folder (stop the stack first), then fix ownership:

```bash
docker run --rm -v ezcorp-prod_ezcorp-data:/from -v "$PWD/.ezcorp/data":/to alpine cp -a /from/. /to/
sudo chown -R 1000:1000 .ezcorp/data
```

### Production deployment

For external Postgres, TLS reverse-proxy config, auto-updates, and backup/restore procedures, see [docs/production-guide.md](docs/production-guide.md).

## Building Extensions

EZCorp supports tools, skills, agents, and MCP servers as extensions.
From a checkout of this repository:

```bash
bun src/cli.ts ext init my-tool --type tool
```

See [docs/extensions/](docs/extensions/) for the full extension development guide.

## Contributing

Use the Bun version pinned in [`.bun-version`](.bun-version) (currently
`1.4.2`). A fresh checkout needs separate root, web, and gate-integrity
installs:

```bash
bun install --frozen-lockfile
bun install --cwd web --frozen-lockfile
bun install --cwd .github/gate-integrity-deps --frozen-lockfile --ignore-scripts
```

The full check needs Playwright Chromium. Install it once per machine, and
again after a Playwright browser update:

```bash
(cd web && bunx playwright install chromium)
```

Run the supported local CI path before opening a pull request:

```bash
bash scripts/ci-local.sh --fast  # fast checks before each push
bash scripts/ci-local.sh         # full checks, including CI's browser lanes
```

The full command uses the exact lane definitions that CI consumes. Do not run
bare `bun test` at the repository root: backend tests require the isolated
per-file wrapper exposed by `bun run test`. See
[the development lifecycle](docs/development-lifecycle.md) for targeted checks
and the complete required-check list.
