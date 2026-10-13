import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const helper = resolve(import.meta.dirname, "../../../../scripts/lib/extension-runner-delegation.sh");
const fixture = `
set -euo pipefail
id() { if [[ "$1" == "-un" ]]; then echo runner; else echo 1001; fi; }
awk() { [[ "\${TEST_INSIDE_MANAGER:-}" == yes ]]; }
sudo() {
  printf '%s\\n' "$*" >> "$TEST_ROOT/commands"
  case "$1" in
    install) [[ "$*" == 'install -d -m 0755 /run/systemd/system/user@1001.service.d' ]] ;;
    tee) [[ "$2" == '/run/systemd/system/user@1001.service.d/90-extension-runner.conf' ]]; cat > "$TEST_ROOT/drop-in" ;;
    loginctl) [[ "$*" == 'loginctl enable-linger runner' ]] ;;
    systemctl) shift; systemctl "$@" ;;
    *) return 90 ;;
  esac
}
systemctl() {
  case "$*" in
    daemon-reload) [[ "\${TEST_RELOAD_FAILURE:-}" != yes ]] ;;
    'restart user@1001.service') test -f "$TEST_ROOT/drop-in" ;;
    'show user@1001.service --property=DelegateControllers --value') printf '%s\\n' "\${TEST_CONTROLLERS-cpu memory pids}" ;;
    '--user show-environment') [[ "\${TEST_BUS_FAILURE:-}" != yes ]] ;;
    *) echo 'Cannot set property Delegate, or unknown property.' >&2; return 91 ;;
  esac
}
source "$TEST_HELPER"
configure_extension_runner_delegation
printf '%s\\n%s\\n' "$XDG_RUNTIME_DIR" "$DBUS_SESSION_BUS_ADDRESS"
`;

async function provision(overrides: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "runner-delegation-test-"));
  try {
    const child = Bun.spawn(["bash", "-c", fixture], { env: { ...process.env, TEST_ROOT: root, TEST_HELPER: helper, ...overrides }, stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const commands = await Bun.file(join(root, "commands")).exists() ? await readFile(join(root, "commands"), "utf8") : "";
    const dropIn = await Bun.file(join(root, "drop-in")).exists() ? await readFile(join(root, "drop-in"), "utf8") : "";
    return { exitCode, stdout, stderr, commands, dropIn };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("writes a per-user runtime unit drop-in before reload and restart, then checks the bus", async () => {
  const result = await provision();
  expect(result.exitCode).toBe(0);
  expect(result.dropIn).toBe("[Service]\nDelegate=cpu memory pids\n");
  expect(result.commands.trim().split("\n")).toEqual([
    "install -d -m 0755 /run/systemd/system/user@1001.service.d",
    "tee /run/systemd/system/user@1001.service.d/90-extension-runner.conf",
    "systemctl daemon-reload",
    "loginctl enable-linger runner",
    "systemctl restart user@1001.service",
  ]);
  expect(result.stdout).toBe("/run/user/1001\nunix:path=/run/user/1001/bus\n");
});

test.each(["cpu", "memory", "pids"])("rejects missing %s delegation", async missing => {
  const result = await provision({ TEST_CONTROLLERS: ["cpu", "memory", "pids"].filter(controller => controller !== missing).join(" ") });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain(`required controller: ${missing}`);
  expect(result.stdout).toBe("");
});

test("does not restart the manager containing the CI job", async () => {
  const result = await provision({ TEST_INSIDE_MANAGER: "yes" });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("restarting it would terminate this job");
  expect(result.commands).toBe("");
});

test.each(["TEST_RELOAD_FAILURE", "TEST_BUS_FAILURE"])("does not hide %s", async failure => {
  const result = await provision({ [failure]: "yes" });
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout).toBe("");
  if (failure === "TEST_RELOAD_FAILURE") expect(result.commands).not.toContain("restart");
});
