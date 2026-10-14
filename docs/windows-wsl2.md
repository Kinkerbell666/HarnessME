# Running on Windows with WSL2 and Ubuntu

On Windows, run the production stack inside Ubuntu on WSL2. There the
repository's shell scripts and rootless Podman behave as on any Linux host.
These steps follow the [README quick start](../README.md#quick-start-self-hosted-builds-from-source);
this page adds only what differs on Windows.

## 1. Install WSL2 and Ubuntu

Open PowerShell as Administrator and run Microsoft's
[documented install command](https://learn.microsoft.com/en-us/windows/wsl/install)
(Windows 10 version 2004 or later, or Windows 11):

```powershell
wsl --install
```

Restart Windows when it finishes. Then open **Ubuntu** from the Start menu and
create your Linux user name and password when it asks.

Ubuntu on WSL enables systemd by default. The setup script needs it for the
rootless Podman socket. If `systemctl --user status` fails, enable systemd as
[Microsoft describes](https://learn.microsoft.com/en-us/windows/wsl/systemd).

## 2. Install Podman and a Compose client

Do every step below in the Ubuntu terminal, not in PowerShell.

The scripts drive Podman through a Compose client: `docker compose` or
`docker-compose`. They need only the client, not the Docker daemon. Take the
client and its Compose plugin from [Docker's apt repository](https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository):

```bash
sudo apt update
sudo apt install -y podman ca-certificates curl

# Docker's apt repository, as Docker documents it
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update

# The client and the Compose plugin only. Do not install docker-ce.
sudo apt install -y docker-ce-cli docker-compose-plugin
docker compose version
```

## 3. Clone and run the guided setup

Clone into your Linux home directory, not under `/mnt/c`. Bind mounts and file
permissions on the Windows drive do not behave like a Linux file system.

```bash
cd ~
git clone <repo-url> ez-corp-ai && cd ez-corp-ai
bash scripts/setup-podman.sh
```

On Linux the script stops before it writes `.env.prod` until you choose an
extension runner. Choose one of these:

- **Isolated runner (recommended).** Provision the host runner from
  [deploy/extension-runner/README.md](../deploy/extension-runner/README.md),
  then set `EZ_RUNNER_SOCKET_DIR`, `EZ_RUNNER_TOKEN_FILE` and `EZ_RUNNER_GROUP`
  as the script prints. The two paths can name any directory and file that
  the runner really uses; `/run` and `/etc` are only the defaults. This path is
  not yet verified on WSL2.
- **Trusted-local (no sandbox).** Extensions run inside the app container with
  the app's full powers. Read
  [what this costs](../deploy/extension-runner/README.md#no-host-runner-the-trusted-local-mode)
  first. To accept it, type the flag yourself:

  ```bash
  bash scripts/setup-podman.sh --accept-unsandboxed-extensions
  ```

Do not write the acknowledgement into `.env.prod` by hand, and do not loosen
permissions on the runner socket directory or credential.

When setup reports the stack ready, open <http://localhost:4000> in your
Windows browser. WSL2 forwards `localhost` to Ubuntu.

## Troubleshooting

**`Extension runner is not ready` and the app restarts.** The app checks its
runner at every start. With the default isolated runner, it stops when the
socket or credential that `.env.prod` names does not exist or does not
answer. A `permission denied` on `/run/ez-extension-runner` or
`/etc/ezharness` means the runner is not provisioned at those paths. Provision
it, or choose trusted-local as above.

**Setup refuses an existing `.env.prod`.** Setup never changes an existing
file. It prints the exact lines to add. Edit the file yourself, or move it
away and run setup again.

**Later commands.** Use the same wrapper that setup uses. It reads `.env.prod`
itself, so do not export the file into your shell:

```bash
bash scripts/podman-compose.sh --prod ps
bash scripts/podman-compose.sh --prod logs -f app
bash scripts/podman-compose.sh --prod down
```
