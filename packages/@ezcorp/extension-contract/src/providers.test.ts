import { describe, expect, test } from "bun:test";
import { providerMethodSchemas, validateManifest, type SandboxProviderGroup, type SandboxProviderOperation } from "./validation";

const schema = { type: "object", additionalProperties: false };
const sandboxGroups = [
  { name: "sandbox.lifecycle.v1", methods: { create: "sandbox/create", inspect: "sandbox/inspect", start: "sandbox/start", stop: "sandbox/stop", destroy: "sandbox/destroy" } },
  { name: "sandbox.process.v1", methods: { start: "process/start", inspect: "process/inspect", readOutput: "process/output", cancel: "process/cancel" } },
  { name: "sandbox.files.v1", methods: { stat: "files/stat", list: "files/list", read: "files/read", write: "files/write", mkdir: "files/mkdir", remove: "files/remove", chmod: "files/chmod" } },
] as const;
const sandboxMethodNames = sandboxGroups.flatMap(group => Object.values(group.methods));
function declaredMethods<Group extends SandboxProviderGroup>(group: Group, methods: Record<SandboxProviderOperation<Group>, string>) {
  return Object.entries(methods).map(([operation, name]) => ({
    name,
    ...providerMethodSchemas(group, operation as SandboxProviderOperation<Group>),
    sensitivity: "ordinary" as const,
  }));
}
const base = {
  schemaVersion: 4,
  name: "incus-provider",
  version: "1.0.0",
  description: "Provider contract fixture",
  author: { name: "Tests" },
  permissions: { storage: true },
  methods: sandboxGroups.flatMap(group => declaredMethods(group.name, group.methods)),
};
const sandboxProvider = {
  id: "primary",
  kind: "sandbox",
  protocolMajor: 1,
  minimumHostContract: { major: 4, minor: 0 },
  profiles: ["linux-exec.v1"],
  capabilities: [],
  configSchema: schema,
  requiredPermissions: ["storage"],
  methodGroups: sandboxGroups,
};

describe("provider manifest contributions", () => {
  test("preserves legacy manifests and admits bounded sandbox and static-secret declarations", () => {
    const legacy = { schemaVersion: 4, name: "legacy", version: "1.0.0", description: "Legacy", author: { name: "Tests" }, permissions: {} };
    // Validated output against the raw fixture: a data comparison, not a type one.
    expect<unknown>(validateManifest(legacy)).toEqual(legacy);
    expect(validateManifest({ ...legacy, skills: [{ name: "summarize", description: "Summarize a document" }] }).skills?.[0]?.name).toBe("summarize");
    expect<unknown>(validateManifest({ ...base, providers: [sandboxProvider] }).providers?.[0]).toEqual(sandboxProvider);
    const transfer = { name: "sandbox.transfer.v1" as const, methods: { beginExport: "transfer/beginExport", readExport: "transfer/readExport", endExport: "transfer/endExport" } };
    const withTransfer = { ...base, methods: [...base.methods, ...declaredMethods(transfer.name, transfer.methods)], providers: [{ ...sandboxProvider, methodGroups: [...sandboxGroups, transfer] }] };
    expect(validateManifest(withTransfer).providers?.[0]?.methodGroups.at(-1)).toEqual(transfer);

    const secret = {
      ...base,
      name: "secret-provider",
      permissions: { hostApi: { routes: [{ method: "POST", path: "/api/secrets/resolve" }], events: false } },
      tools: [],
      methods: [{ name: "secret/resolve", inputSchema: schema, outputSchema: schema, sensitivity: "sensitive" }],
      providers: [{ id: "static", kind: "static-secret", protocolMajor: 1, minimumHostContract: { major: 4, minor: 0 }, profiles: ["static-secret.v1"], capabilities: [], configSchema: schema, requiredPermissions: ["hostApi"], methodGroups: [{ name: "secret.static.v1", methods: { resolve: "secret/resolve" } }] }],
    };
    expect(validateManifest(secret).providers?.[0]?.kind).toBe("static-secret");
  });

  test("rejects unsupported protocol, host, profile, capability, and permission declarations", () => {
    const invalidProviders = [
      { ...sandboxProvider, protocolMajor: 2 },
      { ...sandboxProvider, minimumHostContract: { major: 4, minor: 1 } },
      { ...sandboxProvider, profiles: ["unknown.v1"] },
      { ...sandboxProvider, profiles: ["persistent-web-compose.v1"] },
      { ...sandboxProvider, profiles: ["linux-exec.v1", "linux-exec.v1"] },
      { ...sandboxProvider, capabilities: ["preview"] },
      { ...sandboxProvider, requiredPermissions: ["network"] },
      { ...sandboxProvider, requiredPermissions: ["storage", "storage"] },
      { ...sandboxProvider, configSchema: { patternProperties: {} } },
    ];
    for (const provider of invalidProviders) expect(() => validateManifest({ ...base, providers: [provider] })).toThrow();
  });

  test("rejects duplicate identities, groups, mappings, and incomplete mandatory groups", () => {
    const cases = [
      [sandboxProvider, sandboxProvider],
      [{ ...sandboxProvider, id: "Bad/Scope" }],
      [{ ...sandboxProvider, methodGroups: sandboxGroups.slice(0, 2) }],
      [{ ...sandboxProvider, methodGroups: [...sandboxGroups, sandboxGroups[0]] }],
      [{ ...sandboxProvider, methodGroups: sandboxGroups.map((group, index) => index === 1 ? { ...group, methods: { ...group.methods, start: "sandbox/create" } } : group) }],
      [{ ...sandboxProvider, methodGroups: sandboxGroups.map((group, index) => index === 0 ? { ...group, methods: { ...group.methods, create: "missing" } } : group) }],
    ];
    for (const providers of cases) expect(() => validateManifest({ ...base, providers })).toThrow();
    expect(() => validateManifest({ ...base, methods: base.methods.map((method, index) => index === 0 ? { ...method, outputSchema: schema } : method), providers: [sandboxProvider] })).toThrow("canonical wire schemas");
  });

  test("requires explicit sensitivity and keeps sensitive provider methods out of tools", () => {
    const unclassified = { ...base, methods: base.methods.map((method, index) => index === 0 ? { name: method.name, inputSchema: schema, outputSchema: schema } : method) };
    expect(() => validateManifest({ ...unclassified, providers: [sandboxProvider] })).toThrow();

    const sensitiveName = sandboxMethodNames[0]!;
    const collision = {
      ...base,
      methods: base.methods.map(method => method.name === sensitiveName ? { ...method, sensitivity: "sensitive" } : method),
      tools: [{ name: sensitiveName, description: "Collision", inputSchema: schema, outputSchema: schema }],
    };
    expect(() => validateManifest({ ...collision, providers: [sandboxProvider] })).toThrow();

    const sensitiveMigration = {
      ...base,
      methods: base.methods.map(method => method.name === sensitiveName ? { ...method, sensitivity: "sensitive" } : method),
      dataSchema: { version: "1", readableVersions: ["1"], migrateMethod: sensitiveName },
    };
    expect(() => validateManifest({ ...sensitiveMigration, providers: [sandboxProvider] })).toThrow();

    const standaloneCollision = {
      ...base,
      methods: [{ name: "private", inputSchema: schema, outputSchema: schema, sensitivity: "sensitive" }],
      tools: [{ name: "private", description: "Collision", inputSchema: schema, outputSchema: schema }],
    };
    expect(() => validateManifest(standaloneCollision)).toThrow("Sensitive runtime methods cannot be tools");
  });
});
