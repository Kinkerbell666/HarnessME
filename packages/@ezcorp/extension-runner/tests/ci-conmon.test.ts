import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const helper = resolve(import.meta.dirname, "../../../../scripts/lib/extension-runner-conmon.sh");
const fixture = `
set -euo pipefail
uname() { echo "\${TEST_ARCH:-x86_64}"; }
curl() {
  printf '%s\\n' "$*" >> "$TEST_ROOT/commands"
  [[ "\${TEST_DOWNLOAD_FAILURE:-}" != yes ]] || return 22
  printf fixture > "\${@: -1}"
}
sha256sum() {
  [[ "$1" == --check ]]
  cat > "$TEST_ROOT/checksum"
  [[ "\${TEST_CHECKSUM_FAILURE:-}" != yes ]] || return 1
  touch "$TEST_ROOT/verified"
}
sudo() {
  test -f "$TEST_ROOT/verified"
  printf '%s\\n' "$*" >> "$TEST_ROOT/commands"
  if [[ "$1" == tee ]]; then cat > "$TEST_ROOT/config"; fi
}
source "$TEST_HELPER"
install_extension_runner_conmon
`;

async function install(overrides: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "conmon-install-test-"));
  try {
    const child = Bun.spawn(["bash", "-c", fixture], { env: { ...process.env, TEST_HELPER: helper, TEST_ROOT: root, ...overrides }, stdout: "pipe", stderr: "pipe" });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
    const read = async (name: string) => await Bun.file(join(root, name)).exists() ? Bun.file(join(root, name)).text() : "";
    return { exitCode, stderr, commands: await read("commands"), checksum: await read("checksum"), config: await read("config") };
  } finally { await rm(root, { recursive: true, force: true }); }
}

test.each([
  ["x86_64", "amd64", "1d97294c14c43d477e0a0826e9cd0f2a2af373ddfafe6f10252e8a3c43f32be6"],
  ["aarch64", "arm64", "c2fa62b3555eb0a729d853df23c5784d970f46050f2fb5f9931ded1bf455d216"],
])("verifies the fixed upstream %s asset before any root installation", async (architecture, asset, checksum) => {
  const result = await install({ TEST_ARCH: architecture! });
  expect(result.exitCode).toBe(0);
  expect(result.checksum).toStartWith(`${checksum}  `);
  expect(result.commands).toContain(`https://github.com/containers/conmon/releases/download/v2.2.1/conmon.${asset}`);
  expect(result.commands).toContain("--proto =https --proto-redir =https");
  expect(result.commands).toContain("install -o root -g root -m 0755");
  expect(result.config).toBe('[engine]\nconmon_path=["/usr/local/libexec/ezcorp-extension-runner/conmon-2.2.1"]\n');
});

test.each(["TEST_DOWNLOAD_FAILURE", "TEST_CHECKSUM_FAILURE"])("fails closed on %s without root installation", async failure => {
  const result = await install({ [failure]: "yes" });
  expect(result.exitCode).not.toBe(0);
  expect(result.commands).not.toContain("install ");
  expect(result.config).toBe("");
});

test("rejects an unsupported architecture before downloading or installing", async () => {
  const result = await install({ TEST_ARCH: "unknown" });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("Unsupported CI conmon architecture");
  expect(result.commands).toBe("");
});
