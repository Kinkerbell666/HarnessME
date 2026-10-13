import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { canonicalJson, compileValueSchema, sha256, sealPublishedRelease, validatePublishedRelease, validateManifest, validateWorkspaceFiles, validateWorkspacePath, validateArtifactFiles } from "./index";

const manifest = { schemaVersion: 4, name: "echo", version: "1.0.0", description: "Echo", author: { name: "Test" }, permissions: {}, tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false }, outputSchema: { type: "string" } }] };

describe("data contracts", () => {
  test("AJV's resolved URI parser preserves authority across hostile normalization inputs", () => {
    const uri = createRequire(import.meta.resolve("ajv"))("fast-uri");
    for (const input of ["http://[::not-valid]/private", "http://[fc00::not-hex]/", "%2f%2fevil.example:/pwn", "%u002f%u002fevil.example:/pwn", "%0d%0ahttps:/path"]) {
      expect(uri.parse(input).error).toBeDefined();
      expect(uri.normalize(input)).toBe(input);
    }
    const nestedHost = "http://%256c%256f%2563%2561%256c%2568%256f%2573%2574/";
    expect(uri.normalize(nestedHost)).toBe(nestedHost);
    expect(uri.resolve("https://example.com/base", "//ｅxample.com/")).toBe("https://example.com/");
    expect(uri.parse("https://example.com/path").host).toBe("example.com");
  });
  test("compiled schemas reuse exact content without retaining mutable source or byte limits", () => {
    const source = { type: "object", const: { value: "original" }, description: "detached cache probe" };
    const original = compileValueSchema(source);
    expect(compileValueSchema(structuredClone(source))).toBe(original);
    expect(compileValueSchema({ description: source.description, const: { value: "original" }, type: "object" })).toBe(original);
    source.const.value = "changed";
    expect(() => original({ value: "original" })).not.toThrow();
    expect(() => original({ value: "changed" })).toThrow();
    const changed = compileValueSchema(source);
    expect(changed).not.toBe(original);
    expect(() => changed({ value: "changed" })).not.toThrow();
    const bounded = compileValueSchema({ type: "string" }, 4);
    const wider = compileValueSchema({ type: "string" }, 8);
    expect(bounded).not.toBe(wider);
    expect(() => bounded("12345")).toThrow();
    expect(() => wider("12345")).not.toThrow();
  });

  test("compiled schema cache stays bounded and invalid schemas never gain admission", () => {
    const firstSchema = { const: "cache eviction oldest" };
    const first = compileValueSchema(firstSchema);
    const recentSchema = { const: "cache eviction recent" };
    const recent = compileValueSchema(recentSchema);
    for (let index = 0; index < 64; index++) {
      compileValueSchema({ const: `cache eviction ${index}` });
      expect(compileValueSchema(recentSchema)).toBe(recent);
    }
    expect(compileValueSchema(firstSchema)).not.toBe(first);
    for (let index = 0; index < 2; index++) expect(() => compileValueSchema({ $ref: "https://attacker.invalid/schema" })).toThrow();
  });

  test("a local reference resolves only a schema the document defines", () => {
    // Inherited names such as `__proto__` and `toString` are not definitions.
    // Resolving one used to compile `__proto__` to an accept-anything schema.
    for (const name of ["__proto__", "toString", "constructor"]) {
      expect(() => compileValueSchema({ $defs: { name: { type: "string" } }, $ref: `#/$defs/${name}` })).toThrow("Unknown local reference");
    }
    expect(() => compileValueSchema({ $defs: { name: { type: "string" } }, $ref: "#/$defs/name" })(1)).toThrow();
  });
  test("artifact maps admit sealed dependencies while preserving path and count limits", () => {
    const files = { ".runner/dependencies.json": "x".repeat(21 * 1024 * 1024) };
    expect(validateArtifactFiles(files)).toBe(files);
    expect(() => validateWorkspaceFiles(files)).toThrow();
    expect(() => validateArtifactFiles({ "node_modules/evil": "x" })).toThrow();
    expect(() => validateArtifactFiles(Object.fromEntries(Array.from({ length: 2006 }, (_, index) => [`file${index}`, ""])))).not.toThrow();
    expect(() => validateArtifactFiles(Object.fromEntries(Array.from({ length: 2007 }, (_, index) => [`file${index}`, ""])))).toThrow();
  });
  test("published releases bind source, catalog, checksums and runner artifacts", async () => {
    const sourceFiles = { "extension.ts": "source" };
    const artifacts = { ...sourceFiles, ".runner/extension.js": "compiled" };
    const build = { operationId: "build", state: "succeeded" as const, sourceDigest: await sha256(canonicalJson(sourceFiles)), artifactDigest: await sha256(canonicalJson(artifacts)), imageDigest: "image", manifest: validateManifest(manifest), diagnostics: [], evidence: { protocolVersion: 4 as const, validatorVersion: "v4", tests: [{ name: "fixture", passed: true }], discoveryDigest: await sha256(canonicalJson(manifest)) } };
    const release = await sealPublishedRelease(build, artifacts);
    expect(await validatePublishedRelease(release)).toEqual(release);
    expect(release.sourceFiles).toEqual(sourceFiles);
    expect(release.packageChecksums["extension.ts"]).toBe(await sha256("source"));
    await expect(sealPublishedRelease(build, { ...artifacts, "extension.ts": "tampered" })).rejects.toThrow("artifact digest");
    for (const change of [
      (value: typeof release) => { value.build.state = "failed"; },
      (value: typeof release) => { value.build.evidence.tests = []; },
      (value: typeof release) => { value.build.evidence.tests[0]!.passed = false; },
      (value: typeof release) => { value.sourceFiles[".runner/private"] = "forged"; },
      (value: typeof release) => { value.sourceFiles["extension.ts"] = "tampered"; },
      (value: typeof release) => { value.packageChecksums["extension.ts"] = "tampered"; },
      (value: typeof release) => { value.releaseDigest = "tampered"; },
    ]) {
      const changed = structuredClone(release);
      change(changed);
      await expect(validatePublishedRelease(changed)).rejects.toThrow();
    }
  });




  test("workspace paths cannot escape or shadow directories", () => {
    for (const path of ["../file", "/file", "a/../../file", "a\\b", "C:foo", "a\0b", "a//b", "node_modules/foo", ".git/config", "a/constructor"]) expect(() => validateWorkspacePath(path)).toThrow();
    expect(validateWorkspaceFiles({ "src/main.ts": "export {}", "assets/icon.svg": "<svg/>" })["src/main.ts"]).toBe("export {}");
    expect(() => validateWorkspaceFiles({ src: "file", "src/main.ts": "code" })).toThrow();
    expect(() => validateWorkspaceFiles({ "large.ts": "x".repeat(20 * 1024 * 1024 + 1) })).toThrow();
    expect(validateWorkspaceFiles({})).toEqual({});
  });





  test("canonical digests ignore key order but bind every value", async () => {
    expect(canonicalJson({ second: 2, first: 1 })).toBe(canonicalJson({ first: 1, second: 2 }));
    expect(await sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256(canonicalJson({ allowed: true }))).not.toBe(await sha256(canonicalJson({ allowed: false })));
  });




});
