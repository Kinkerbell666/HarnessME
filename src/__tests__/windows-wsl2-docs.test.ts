import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { UNSANDBOXED_ACK_SENTENCE } from "../extensions/runner-mode";

/**
 * Holds the Windows/WSL2 runbook to the scripts it tells the reader to run.
 *
 * Readers paste these blocks. A setup flag that drifts from
 * `scripts/setup-podman.sh`, or a block that bash cannot parse, fails at the
 * reader's terminal. The page must also leave the trusted-local consent to
 * the script's typed flag, never to a pasted acknowledgement line.
 */

const ROOT = join(import.meta.dir, "..", "..");
const DOC = "docs/windows-wsl2.md";

async function text(relPath: string): Promise<string> {
  return Bun.file(join(ROOT, relPath)).text();
}

function bashBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
}

describe("Windows WSL2 runbook", () => {
  test("every bash block parses and runs as pasted", async () => {
    const blocks = bashBlocks(await text(DOC));
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      // Parses, but prints `$(...)` literally instead of running it.
      expect(block).not.toContain("\\$(");
      // `<repo-url>` is the README's placeholder; bash reads `<` as a redirect.
      const script = block.replaceAll("<repo-url>", "REPO_URL").replace(/^\s+/gm, "");
      const parsed = Bun.spawnSync(["bash", "-n"], { stdin: Buffer.from(script) });
      expect({ block, stderr: parsed.stderr.toString() }).toEqual({ block, stderr: "" });
    }
  });

  test("names only setup flags the script accepts", async () => {
    const doc = await text(DOC);
    const script = await text("scripts/setup-podman.sh");
    const flags = [...doc.matchAll(/setup-podman\.sh((?: --[a-z-]+)+)/g)].flatMap((m) =>
      (m[1] ?? "").trim().split(" "),
    );
    expect(flags).toContain("--accept-unsandboxed-extensions");
    for (const flag of flags) expect(script).toContain(`${flag})`);
  });

  test("leaves trusted-local consent to the typed flag", async () => {
    const doc = await text(DOC);
    expect(doc).not.toContain(UNSANDBOXED_ACK_SENTENCE);
    expect(doc).not.toMatch(/chmod\s+777/);
    expect(doc).not.toMatch(/export \$\(cat/);
  });
});
