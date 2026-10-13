import Ajv from "ajv";
import { RE2JS } from "re2js";
import schema from "./wire-schema.json";
import type { ExtensionManifestV4, JsonValue, ToolDefinitionV4, ValueSchema, WireData, WorkspaceFile, WorkspaceFiles } from "@ezcorp/extension-contract/types";
import { parseTcpDestination } from "./network";
import { assertJson, ContractError, isForbiddenJsonKey, MAX_FRAME_BYTES } from "./json";
import { validateWorkspaceFiles, validateWorkspacePath } from "./files";
export * from "./json";
export * from "./files";

export const PROTOCOL_VERSION = 4;
export const VALIDATOR_VERSION = "4.0.0";
export const WORKSPACE_FILE_SCHEMA = { anyOf: [{ type: "string" }, schema.definitions.EncodedWorkspaceFile] };
export const TOOL_RESULT_SCHEMA = {
  type: "object", required: ["content"],
  properties: { content: { type: "array", items: { type: "object", required: ["type"], properties: { type: { type: "string" }, text: { type: "string" } }, additionalProperties: true } }, isError: { type: "boolean" } },
  additionalProperties: true,
};
export type SandboxProviderGroup = "sandbox.lifecycle.v1" | "sandbox.process.v1" | "sandbox.files.v1" | "sandbox.transfer.v1";
export type ProviderSchemaDirection = "input" | "result";
const providerMethodDefinitions = {
  "sandbox.lifecycle.v1": {
    create: ["SandboxCreateInput", "SandboxCreateResult"], inspect: ["SandboxInspectInput", "SandboxInspectResult"], start: ["SandboxStartInput", "SandboxStartResult"], stop: ["SandboxStopInput", "SandboxStopResult"], destroy: ["SandboxDestroyInput", "SandboxDestroyResult"],
  },
  "sandbox.process.v1": {
    start: ["SandboxProcessStartInput", "SandboxProcessStartResult"], inspect: ["SandboxProcessInspectInput", "SandboxProcessInspectResult"], readOutput: ["SandboxProcessReadOutputInput", "SandboxProcessReadOutputResult"], cancel: ["SandboxProcessCancelInput", "SandboxProcessCancelResult"],
  },
  "sandbox.files.v1": {
    stat: ["SandboxFileStatInput", "SandboxFileStatResult"], list: ["SandboxFileListInput", "SandboxFileListResult"], read: ["SandboxFileReadInput", "SandboxFileReadResult"], write: ["SandboxFileWriteInput", "SandboxFileWriteResult"], mkdir: ["SandboxFileMkdirInput", "SandboxFileMkdirResult"], remove: ["SandboxFileRemoveInput", "SandboxFileRemoveResult"], chmod: ["SandboxFileChmodInput", "SandboxFileChmodResult"],
  },
  "sandbox.transfer.v1": {
    beginExport: ["SandboxBeginExportInput", "SandboxBeginExportResult"], readExport: ["SandboxReadExportInput", "SandboxReadExportResult"], endExport: ["SandboxEndExportInput", "SandboxEndExportResult"],
  },
} as const;
export type SandboxProviderOperation<Group extends SandboxProviderGroup> = keyof typeof providerMethodDefinitions[Group] & string;
const providerSchemaCache = new Map<string, { inputSchema: ValueSchema; outputSchema: ValueSchema }>();

function standaloneWireSchema(definitionName: string): ValueSchema {
  const definitions = schema.definitions as Record<string, ValueSchema>;
  const included = new Map<string, ValueSchema>();
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string" && record.$ref.startsWith("#/definitions/")) {
      const name = decodeURIComponent(record.$ref.slice("#/definitions/".length));
      if (!definitions[name]) throw new ContractError("INVALID_CONTRACT", `Missing provider wire definition: ${name}`);
      if (!included.has(name)) {
        included.set(name, {});
        included.set(name, rewrite(definitions[name]) as ValueSchema);
      }
      return { $ref: `#/$defs/${name}` };
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, rewrite(child)]));
  };
  const root = definitions[definitionName];
  if (!root) throw new ContractError("INVALID_CONTRACT", `Missing provider wire definition: ${definitionName}`);
  const rewritten = rewrite(root) as ValueSchema;
  return { ...rewritten, ...(included.size ? { $defs: Object.fromEntries(included) } : {}) };
}

export function providerMethodSchemas<Group extends SandboxProviderGroup>(group: Group, operation: SandboxProviderOperation<Group>): { inputSchema: ValueSchema; outputSchema: ValueSchema } {
  const key = `${group}:${operation}`;
  const cached = providerSchemaCache.get(key);
  if (cached) return structuredClone(cached);
  const pair = (providerMethodDefinitions[group] as Record<string, readonly [string, string]>)[operation];
  if (!pair) throw new ContractError("INVALID_CONTRACT", "Unsupported provider method");
  const value = { inputSchema: standaloneWireSchema(pair[0]), outputSchema: standaloneWireSchema(pair[1]) };
  providerSchemaCache.set(key, value);
  return structuredClone(value);
}
const encoder = new TextEncoder();
const ajv = new Ajv({ strict: false, allErrors: false, ownProperties: true, validateFormats: false });
ajv.addSchema(schema, "wire");

export function validateWire<Key extends keyof WireData>(kind: Key, value: unknown): WireData[Key] {
  assertJson(value, kind === "buildRequest" || kind === "publishedRelease" ? 128 * 1024 * 1024 : MAX_FRAME_BYTES);
  const validator = ajv.getSchema(`wire#/definitions/WireData/properties/${kind}`);
  if (!validator?.(value)) {
    const issue = validator?.errors?.[0];
    throw new ContractError("INVALID_CONTRACT", `${kind}: ${issue?.message ?? "unsupported schema"}`, issue?.instancePath);
  }
  return value as unknown as WireData[Key];
}

const schemaKeywords = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "oneOf", "allOf", "not", "description", "title", "default", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "pattern", "$ref", "$defs", "definitions"]);
const annotations = new Set(["x-options", "x-shared"]);
const presentationFormats = new Set(["combo-box", "tag-input", "file-path", "search"]);
const formats: Record<string, (value: string) => boolean> = {
  date: value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
  "date-time": value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)),
  uri: value => { try { return Boolean(new URL(value).protocol); } catch { return false; } },
  email: value => value.length <= 254 && RE2JS.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matcher(value).find(),
  uuid: value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
};
const valueValidators = new Map<string, (input: unknown) => void>();
const maxCachedValidators = 64;

export function compileValueSchema(value: unknown, maxValueBytes = MAX_FRAME_BYTES): (input: unknown) => void {
  assertJson(value, 64 * 1024);
  const cacheKey = `${maxValueBytes}:${canonicalJson(value)}`;
  const cached = valueValidators.get(cacheKey);
  if (cached) { valueValidators.delete(cacheKey); valueValidators.set(cacheKey, cached); return cached; }
  const detached = structuredClone(value);
  let nodes = 0;
  function check(entry: unknown, depth: number): void {
    if (++nodes > 256 || depth > 12) throw new ContractError("SCHEMA_LIMIT", "Schema exceeds complexity limit");
    if (typeof entry === "boolean") return;
    if (!entry || Array.isArray(entry) || typeof entry !== "object") throw new ContractError("INVALID_SCHEMA", "Expected JSON Schema object");
    for (const [key, child] of Object.entries(entry)) {
      if (!schemaKeywords.has(key) && !annotations.has(key) && key !== "format") throw new ContractError("UNSUPPORTED_SCHEMA", `Unsupported JSON Schema keyword: ${key}`);
      if (key === "format" && (typeof child !== "string" || (!Object.hasOwn(formats, child) && !presentationFormats.has(child)))) throw new ContractError("UNSUPPORTED_SCHEMA", "Unsupported schema format");
      if (key === "x-shared" && typeof child !== "string") throw new ContractError("INVALID_SCHEMA", "Shared context annotation must be a name");
      if (key === "x-options" && (!child || typeof child !== "object" || Array.isArray(child))) throw new ContractError("INVALID_SCHEMA", "UI options must be an object");
      if (["properties", "$defs", "definitions"].includes(key)) {
        if (!child || Array.isArray(child) || typeof child !== "object") throw new ContractError("INVALID_SCHEMA", "Invalid properties");
        for (const field of Object.values(child)) check(field, depth + 1);
      } else if (["items", "additionalProperties", "not"].includes(key)) check(child, depth + 1);
      else if (["anyOf", "oneOf", "allOf"].includes(key)) {
        if (!Array.isArray(child) || child.length > 16) throw new ContractError("INVALID_SCHEMA", "Invalid schema alternatives");
        for (const alternative of child) check(alternative, depth + 1);
      }
      if (key === "$ref") {
        if (typeof child !== "string" || !/^#\/(?:definitions|\$defs)\/[a-zA-Z0-9_-]+$/.test(child)) throw new ContractError("UNSUPPORTED_SCHEMA", "Only local named schema references are supported");
      }
      if (key === "pattern") {
        if (typeof child !== "string" || child.length > 256) throw new ContractError("SCHEMA_LIMIT", "Pattern exceeds limit");
        try { RE2JS.compile(child); } catch { throw new ContractError("UNSUPPORTED_SCHEMA", "Pattern must use supported RE2 syntax"); }
      }
    }
  }
  check(value, 0);
  let expandedNodes = 0;
  function expand(entry: unknown, visited: Set<string>, depth: number): unknown {
    if (++expandedNodes > 1024 || depth > 16) throw new ContractError("SCHEMA_LIMIT", "Schema reference expansion exceeds limit");
    if (!entry || typeof entry !== "object") return entry;
    if (Array.isArray(entry)) return entry.map(child => expand(child, visited, depth + 1));
    const record = entry as Record<string, unknown>;
    if (typeof record.$ref === "string") {
      if (visited.has(record.$ref)) throw new ContractError("UNSUPPORTED_SCHEMA", "Recursive schemas are not supported");
      const [group, name] = record.$ref.slice(2).split("/");
      const root = detached as Record<string, Record<string, unknown>>;
      const definitions = Object.hasOwn(root, group!) ? root[group!] : undefined;
      const target = definitions && Object.hasOwn(definitions, name!) ? definitions[name!] : undefined;
      if (!target) throw new ContractError("INVALID_SCHEMA", "Unknown local reference");
      const next = new Set(visited).add(record.$ref);
      const siblings = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "$ref"));
      return { allOf: [expand(target, next, depth + 1), expand(siblings, next, depth + 1)] };
    }
    return Object.fromEntries(Object.entries(record).filter(([key, child]) => !["$defs", "definitions"].includes(key) && !annotations.has(key) && !(key === "format" && presentationFormats.has(String(child)))).map(([key, child]) => {
      if (key === "properties") return [key, Object.fromEntries(Object.entries(child as Record<string, unknown>).map(([name, property]) => [name, expand(property, visited, depth + 1)]))];
      return [key, ["items", "additionalProperties", "not", "anyOf", "oneOf", "allOf"].includes(key) ? expand(child, visited, depth + 1) : child];
    }));
  }
  const expanded = expand(detached, new Set(), 0);
  assertJson(expanded, 128 * 1024);
  const linearRegex = Object.assign((pattern: string) => {
    const compiled = RE2JS.compile(pattern);
    return { test: (input: string) => compiled.matcher(input).find() };
  }, { code: "RE2JS.compile" });
  const engine = new Ajv({ strict: false, allErrors: false, ownProperties: true, validateFormats: true, formats, code: { regExp: linearRegex } });
  let validate: ReturnType<Ajv["compile"]>;
  try { validate = engine.compile(expanded as ValueSchema); } catch { throw new ContractError("INVALID_SCHEMA", "Invalid JSON Schema"); }
  const checkValue = (input: unknown) => {
    assertJson(input, maxValueBytes);
    if (!validate(input)) throw new ContractError("SCHEMA_MISMATCH", validate.errors?.[0]?.message ?? "Value does not match schema", validate.errors?.[0]?.instancePath);
  };
  if (valueValidators.size >= maxCachedValidators) valueValidators.delete(valueValidators.keys().next().value!);
  valueValidators.set(cacheKey, checkValue);
  return checkValue;
}

const PROVIDER_CHUNK_BYTES = 256 * 1024;
const PROVIDER_DEADLINE_MS = 24 * 60 * 60 * 1000;
const providerIdentifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const providerDigestPattern = /^[a-f0-9]{64}$/;

function providerIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string" || !providerIdentifierPattern.test(value)) throw new ContractError("INVALID_PROVIDER_VALUE", `Invalid ${field}`);
}

function providerInteger(value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new ContractError("INVALID_PROVIDER_VALUE", `Invalid ${field}`);
}

function providerVirtualPath(value: unknown): void {
  if (typeof value !== "string" || encoder.encode(value).byteLength > 1024 || !value.startsWith("/") || (value.length > 1 && value.endsWith("/")) || value.includes("\\") || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new ContractError("INVALID_PROVIDER_PATH", "Expected a canonical workspace-root path");
  if (value !== "/" && value.slice(1).split("/").some(part => !part || part === "." || part === ".." || isForbiddenJsonKey(part))) throw new ContractError("INVALID_PROVIDER_PATH", "Unsafe workspace-root path");
}

function providerEncodedBytes(encoding: unknown, data: unknown): number {
  if (typeof data !== "string") throw new ContractError("INVALID_PROVIDER_VALUE", "Invalid provider byte payload");
  if (encoding === "utf8") return encoder.encode(data).byteLength;
  if (encoding !== "base64" || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || (data && btoa(atob(data.slice(-4))) !== data.slice(-4))) throw new ContractError("INVALID_PROVIDER_VALUE", "Expected canonical provider base64");
  return data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}

function validateProviderCall(call: Record<string, unknown>): void {
  const scope = call.scope as Record<string, unknown>;
  providerIdentifier(scope.projectId, "project ID");
  providerIdentifier(scope.bindingId, "binding ID");
  providerInteger(scope.generation, "generation", 1);
  providerIdentifier(call.operationId, "operation ID");
  providerIdentifier(call.idempotencyKey, "idempotency key");
  if (typeof call.requestDigest !== "string" || !providerDigestPattern.test(call.requestDigest)) throw new ContractError("INVALID_PROVIDER_VALUE", "Invalid request digest");
}

function validateProviderReceipt(receipt: Record<string, unknown>): void {
  providerIdentifier(receipt.operationId, "receipt operation ID");
  providerIdentifier(receipt.idempotencyKey, "receipt idempotency key");
  if (typeof receipt.requestDigest !== "string" || !providerDigestPattern.test(receipt.requestDigest)) throw new ContractError("INVALID_PROVIDER_VALUE", "Invalid receipt request digest");
  if (receipt.providerOperationId !== undefined) providerIdentifier(receipt.providerOperationId, "provider operation ID");
  if (receipt.outcome === "failed" && !receipt.error) throw new ContractError("INVALID_PROVIDER_VALUE", "Failed provider receipt requires an error");
  if (receipt.outcome === "succeeded" && receipt.error) throw new ContractError("INVALID_PROVIDER_VALUE", "Successful provider receipt cannot contain an error");
  if (receipt.error) {
    const error = receipt.error as Record<string, unknown>;
    providerIdentifier(error.code, "provider error code");
    if (typeof error.message !== "string" || encoder.encode(error.message).byteLength > 4096) throw new ContractError("INVALID_PROVIDER_VALUE", "Invalid provider error message");
  }
}

function validateProviderResource(resource: Record<string, unknown>): void {
  providerIdentifier(resource.resourceId, "resource ID");
  const limits = resource.limits as Record<string, unknown>;
  providerInteger(limits.memoryBytes, "memory bytes", 1);
  providerInteger(limits.milliCpu, "CPU milliCPU", 1, 1_000_000);
  providerInteger(limits.pids, "PID limit", 1, 32_768);
  providerInteger(limits.diskBytes, "disk bytes", 1);
}

function validateProviderProcess(process: Record<string, unknown>): void {
  const identity = process.identity as Record<string, unknown>;
  providerIdentifier(identity.bootId, "boot ID");
  providerIdentifier(identity.processId, "process ID");
  providerInteger(process.outputCursor, "process output cursor");
  if (process.exitCode !== undefined) providerInteger(process.exitCode, "process exit code", -255, 255);
}

function validateProviderFileStat(entry: Record<string, unknown>): void {
  providerVirtualPath(entry.path);
  providerIdentifier(entry.revision, "file revision");
  providerInteger(entry.sizeBytes, "file size");
  providerInteger(entry.mode, "file mode", 0, 0o777);
}

type ProviderRecord = Record<string, unknown>;

function validateLifecycleProviderInput(operation: string, record: ProviderRecord): void {
  if (operation === "create") validateProviderResource({ resourceId: "request", desiredState: "stopped", observedState: "stopped", limits: record.limits });
}

function validateProcessStartArgv(record: ProviderRecord): void {
  const argv = record.argv as unknown[];
  if (argv.length === 0 || argv.length > 128 || argv.some(item => typeof item !== "string" || item.includes("\0") || encoder.encode(item).byteLength > 4096)) throw new ContractError("INVALID_PROVIDER_VALUE", "Invalid process argv");
}

function validateProcessStartEnvironment(record: ProviderRecord): void {
  const env = record.env as Record<string, unknown>;
  if (Object.keys(env).length > 128 || Object.entries(env).some(([name, item]) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || typeof item !== "string" || item.includes("\0")) || encoder.encode(JSON.stringify(env)).byteLength > 64 * 1024) throw new ContractError("INVALID_PROVIDER_VALUE", "Invalid process environment");
}

function validateProcessStartInput(record: ProviderRecord): void {
  validateProcessStartArgv(record);
  validateProcessStartEnvironment(record);
  providerVirtualPath(record.cwd);
  providerInteger(record.timeoutMs, "process timeout", 1, PROVIDER_DEADLINE_MS);
}

function validateProcessOutputInput(record: ProviderRecord): void {
  providerInteger(record.cursor, "process output cursor");
  providerInteger(record.maxBytes, "process output byte limit", 1, PROVIDER_CHUNK_BYTES);
}

function validateProcessProviderInput(operation: string, record: ProviderRecord): void {
  if (record.identity) validateProviderProcess({ identity: record.identity, state: "unknown", outputCursor: 0 });
  if (operation === "start") validateProcessStartInput(record);
  if (operation === "readOutput") validateProcessOutputInput(record);
}

function validateFileProviderInput(operation: string, record: ProviderRecord): void {
  providerVirtualPath(record.path);
  if (record.cursor !== undefined) providerIdentifier(record.cursor, "file list cursor");
  if (record.expectedRevision !== undefined) providerIdentifier(record.expectedRevision, "expected file revision");
  if (record.revision !== undefined) providerIdentifier(record.revision, "file revision");
  fileInputValidators[operation]?.(record);
}

const fileInputValidators: Record<string, ((record: ProviderRecord) => void) | undefined> = {
  list: record => providerInteger(record.limit, "file list limit", 1, 256),
  read: record => {
    providerInteger(record.offsetBytes, "file read offset");
    providerInteger(record.lengthBytes, "file read length", 1, PROVIDER_CHUNK_BYTES);
  },
  write: record => {
    if (providerEncodedBytes(record.encoding, record.data) > PROVIDER_CHUNK_BYTES) throw new ContractError("DATA_LIMIT", "File write exceeds provider chunk limit");
  },
  chmod: record => providerInteger(record.mode, "file mode", 0, 0o777),
};

function validateProviderInput(group: SandboxProviderGroup, operation: string, record: ProviderRecord): void {
  validateProviderCall(record.call as ProviderRecord);
  if (record.resourceId !== undefined) providerIdentifier(record.resourceId, "resource ID");
  if (group === "sandbox.lifecycle.v1") validateLifecycleProviderInput(operation, record);
  if (group === "sandbox.process.v1") validateProcessProviderInput(operation, record);
  if (group === "sandbox.files.v1") validateFileProviderInput(operation, record);
  if (group === "sandbox.transfer.v1") {
    if (record.snapshotId !== undefined) providerIdentifier(record.snapshotId, "snapshot ID");
    if (operation === "readExport") {
      providerInteger(record.offsetBytes, "snapshot offset");
      providerInteger(record.lengthBytes, "snapshot length", 1, PROVIDER_CHUNK_BYTES);
    }
  }
}

function validateProviderResultObjects(record: ProviderRecord): void {
  if (record.resource) validateProviderResource(record.resource as ProviderRecord);
  if (record.process) validateProviderProcess(record.process as ProviderRecord);
  if (record.entry) validateProviderFileStat(record.entry as ProviderRecord);
}

function validateProviderResultEntries(record: ProviderRecord): void {
  if (!record.entries) return;
  const entries = record.entries as unknown[];
  if (entries.length > 256) throw new ContractError("DATA_LIMIT", "File list exceeds provider entry limit");
  for (const entry of entries as ProviderRecord[]) validateProviderFileStat(entry);
}

function validateProviderResultCursors(record: ProviderRecord): void {
  if (record.nextCursor !== undefined) providerIdentifier(record.nextCursor, "next file list cursor");
  if (record.removedRevision !== undefined) providerIdentifier(record.removedRevision, "removed file revision");
}

function validateProviderResultDetails(record: ProviderRecord): void {
  validateProviderResultObjects(record);
  validateProviderResultEntries(record);
  validateProviderResultCursors(record);
}

function validateProcessOutputResult(record: ProviderRecord): void {
  validateProviderProcess({ identity: record.identity, state: "unknown", outputCursor: record.cursor });
  providerInteger(record.cursor, "process output cursor");
  const chunks = record.chunks as unknown[];
  if (chunks.length > 256) throw new ContractError("DATA_LIMIT", "Too many process output chunks");
  let bytes = 0;
  for (const chunk of chunks as ProviderRecord[]) bytes += providerEncodedBytes(chunk.encoding, chunk.data);
  if (bytes > PROVIDER_CHUNK_BYTES) throw new ContractError("DATA_LIMIT", "Process output exceeds provider chunk limit");
}

function validateFileReadResult(record: ProviderRecord): void {
  providerVirtualPath(record.path);
  providerIdentifier(record.revision, "file revision");
  providerInteger(record.offsetBytes, "file read offset");
  providerInteger(record.nextOffsetBytes, "next file read offset");
  if ((record.nextOffsetBytes as number) < (record.offsetBytes as number)) throw new ContractError("INVALID_PROVIDER_VALUE", "Next file read offset cannot move backwards");
  if (providerEncodedBytes(record.encoding, record.data) > PROVIDER_CHUNK_BYTES) throw new ContractError("DATA_LIMIT", "File read exceeds provider chunk limit");
}

function validateProviderResult(group: SandboxProviderGroup, operation: string, record: ProviderRecord): void {
  validateProviderReceipt(record.receipt as ProviderRecord);
  if ((record.receipt as ProviderRecord).outcome !== "succeeded") return;
  validateProviderResultDetails(record);
  if (group === "sandbox.process.v1" && operation === "readOutput") validateProcessOutputResult(record);
  if (group === "sandbox.files.v1" && operation === "read") validateFileReadResult(record);
  if (group === "sandbox.transfer.v1") {
    if (record.snapshotId !== undefined) providerIdentifier(record.snapshotId, "snapshot ID");
    if (operation === "beginExport") {
      providerInteger(record.byteLength, "snapshot size", 0, 48 * 1024 * 1024);
      if (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new ContractError("INVALID_PROVIDER_VALUE", "Invalid snapshot digest");
    }
    if (operation === "readExport") {
      providerInteger(record.offsetBytes, "snapshot offset");
      providerInteger(record.nextOffsetBytes, "next snapshot offset");
      if (providerEncodedBytes("base64", record.data) > PROVIDER_CHUNK_BYTES) throw new ContractError("DATA_LIMIT", "Snapshot chunk exceeds provider limit");
    }
  }
}

export function validateProviderMethodValue<Group extends SandboxProviderGroup>(group: Group, operation: SandboxProviderOperation<Group>, direction: ProviderSchemaDirection, value: unknown): unknown {
  const schemas = providerMethodSchemas(group, operation);
  compileValueSchema(direction === "input" ? schemas.inputSchema : schemas.outputSchema)(value);
  const record = value as Record<string, unknown>;
  if (direction === "input") {
    validateProviderInput(group, operation, record);
  } else {
    validateProviderResult(group, operation, record);
  }
  return value;
}

function validateProviderReceiptIdentity(call: ProviderRecord, receipt: ProviderRecord): void {
  for (const field of ["operationId", "idempotencyKey", "requestDigest"]) if (call[field] !== receipt[field]) throw new ContractError("INVALID_PROVIDER_RECEIPT", `Provider receipt changed ${field}`);
}

function validateProviderResourceIdentity(request: ProviderRecord, response: ProviderRecord): void {
  if (request.resourceId !== undefined) {
    const resource = response.resource as ProviderRecord | undefined;
    if (resource && request.resourceId !== resource.resourceId) throw new ContractError("INVALID_PROVIDER_RECEIPT", "Provider response changed resource ID");
  }
}

function validateProviderProcessIdentity(request: ProviderRecord, response: ProviderRecord): void {
  if (request.identity !== undefined) {
    const process = response.process as ProviderRecord | undefined;
    if (process && canonicalJson(request.identity) !== canonicalJson(process.identity)) throw new ContractError("INVALID_PROVIDER_RECEIPT", "Provider response changed process identity");
  }
}

function validateProcessOutputExchange(request: ProviderRecord, response: ProviderRecord): void {
  if (canonicalJson(request.identity) !== canonicalJson(response.identity)) throw new ContractError("INVALID_PROVIDER_RECEIPT", "Provider output changed process identity");
  const chunks = response.chunks as ProviderRecord[];
  const bytes = chunks.reduce((total, chunk) => total + providerEncodedBytes(chunk.encoding, chunk.data), 0);
  const requestCursor = request.cursor as number;
  const responseCursor = response.cursor as number;
  const minimumCursor = requestCursor + bytes;
  if (responseCursor < minimumCursor || bytes > (request.maxBytes as number) || (response.gap === false && responseCursor !== minimumCursor)) throw new ContractError("INVALID_PROVIDER_RECEIPT", "Provider output exceeded its requested cursor or byte range");
}

function validateFileReadIdentity(request: ProviderRecord, response: ProviderRecord): void {
  if (response.path !== request.path || response.offsetBytes !== request.offsetBytes || (request.revision !== undefined && response.revision !== request.revision)) throw new ContractError("INVALID_PROVIDER_RECEIPT", "Provider read changed path, revision, or offset");
}

function validateFileReadRange(request: ProviderRecord, response: ProviderRecord): void {
  const bytes = providerEncodedBytes(response.encoding, response.data);
  if (bytes > (request.lengthBytes as number) || response.nextOffsetBytes !== (request.offsetBytes as number) + bytes) throw new ContractError("INVALID_PROVIDER_RECEIPT", "Provider read returned an invalid byte range");
}

function validateFileListExchange(requestedPath: string, response: ProviderRecord): void {
  const prefix = requestedPath === "/" ? "/" : `${requestedPath}/`;
  for (const entry of response.entries as ProviderRecord[]) {
    const path = entry.path as string;
    if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) throw new ContractError("INVALID_PROVIDER_RECEIPT", "Provider list returned an entry outside the requested directory");
  }
}

function validateFileEntryPath(requestedPath: string, response: ProviderRecord): void {
  const returnedEntry = response.entry as ProviderRecord | undefined;
  if (returnedEntry && returnedEntry.path !== requestedPath) throw new ContractError("INVALID_PROVIDER_RECEIPT", "Provider response changed file path");
}

function validateFilesProviderExchange(operation: string, request: ProviderRecord, response: ProviderRecord): void {
  const requestedPath = request.path as string;
  validateFileEntryPath(requestedPath, response);
  if (operation === "list") validateFileListExchange(requestedPath, response);
  if (operation === "read") {
    validateFileReadIdentity(request, response);
    validateFileReadRange(request, response);
  }
  if (operation === "remove" && request.expectedRevision !== undefined && response.removedRevision !== request.expectedRevision) throw new ContractError("INVALID_PROVIDER_RECEIPT", "Provider removal changed the expected revision");
}

function validateSuccessfulProviderExchange(group: SandboxProviderGroup, operation: string, request: ProviderRecord, response: ProviderRecord): void {
  validateProviderResourceIdentity(request, response);
  validateProviderProcessIdentity(request, response);
  if (group === "sandbox.process.v1" && operation === "readOutput") validateProcessOutputExchange(request, response);
  if (group === "sandbox.files.v1") validateFilesProviderExchange(operation, request, response);
  if (group === "sandbox.transfer.v1" && operation === "readExport") {
    if (request.snapshotId !== response.snapshotId || request.offsetBytes !== response.offsetBytes) throw new ContractError("INVALID_PROVIDER_RECEIPT", "Snapshot read changed identity or offset");
    const size = providerEncodedBytes("base64", response.data);
    if (response.nextOffsetBytes !== (request.offsetBytes as number) + size || size > (request.lengthBytes as number) || (!response.eof && size === 0)) throw new ContractError("INVALID_PROVIDER_RECEIPT", "Snapshot read returned an invalid range");
  }
}

export function validateProviderMethodExchange<Group extends SandboxProviderGroup>(group: Group, operation: SandboxProviderOperation<Group>, input: unknown, result: unknown): { input: unknown; result: unknown } {
  validateProviderMethodValue(group, operation, "input", input);
  validateProviderMethodValue(group, operation, "result", result);
  const call = (input as { call: Record<string, unknown> }).call;
  const receipt = (result as { receipt: Record<string, unknown> }).receipt;
  validateProviderReceiptIdentity(call, receipt);
  if (receipt.outcome !== "succeeded") return { input, result };
  const request = input as Record<string, unknown>;
  const response = result as Record<string, unknown>;
  validateSuccessfulProviderExchange(group, operation, request, response);
  return { input, result };
}

type ManifestProvider = NonNullable<ExtensionManifestV4["providers"]>[number];
type ManifestMethod = NonNullable<ExtensionManifestV4["methods"]>[number];
type MethodSensitivity = ManifestMethod["sensitivity"];

function validateManifestNetworkPermissions(manifest: ExtensionManifestV4): void {
  const destinations = manifest.permissions.networkTcp;
  if (!destinations) return;
  if (destinations.length > 32 || new Set(destinations).size !== destinations.length) throw new ContractError("INVALID_MANIFEST", "TCP grants must be a unique bounded destination list");
  for (const destination of destinations) parseTcpDestination(destination);
}

function validateManifestSecretPermissions(manifest: ExtensionManifestV4): void {
  const providers = manifest.permissions.secretRead;
  if (!providers) return;
  if (new Set(providers).size !== providers.length || providers.some(name => !["OPENAI_API_KEY", "OPENAI_ACCESS_TOKEN", "GITHUB_TOKEN"].includes(name))) throw new ContractError("INVALID_MANIFEST", "Raw credential grants must name unique supported providers");
}

function validateManifestIdentity(manifest: ExtensionManifestV4): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(manifest.name) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new ContractError("INVALID_MANIFEST", "Invalid extension name or version");
  if (manifest.entrypoint) validateWorkspacePath(manifest.entrypoint.replace(/^\.\//, ""));
}

function validateManifestTool(tool: ToolDefinitionV4, names: Set<string>): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(tool.name) || names.has(tool.name)) throw new ContractError("INVALID_MANIFEST", "Invalid or duplicate tool name");
  names.add(tool.name);
  compileValueSchema(tool.inputSchema);
  compileValueSchema(tool.outputSchema);
  if (tool.mcpOutputSchema) compileValueSchema(tool.mcpOutputSchema);
}

function validateManifestTools(manifest: ExtensionManifestV4): Set<string> {
  const names = new Set<string>();
  for (const tool of manifest.tools ?? []) validateManifestTool(tool, names);
  if (names.size > 128) throw new ContractError("DATA_LIMIT", "Too many tools");
  return names;
}

function validateManifestMethod(method: ManifestMethod, names: Set<string>): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_./:-]{0,127}$/.test(method.name) || method.name.startsWith("extension/") || names.has(method.name)) throw new ContractError("INVALID_MANIFEST", "Invalid or duplicate runtime method");
  names.add(method.name);
  compileValueSchema(method.inputSchema);
  compileValueSchema(method.outputSchema);
}

function validateManifestMethods(manifest: ExtensionManifestV4): Set<string> {
  const names = new Set<string>();
  for (const method of manifest.methods ?? []) validateManifestMethod(method, names);
  if (names.size > 128) throw new ContractError("DATA_LIMIT", "Too many runtime methods");
  return names;
}

function validateManifestMethodSensitivity(manifest: ExtensionManifestV4, toolNames: Set<string>): Map<string, MethodSensitivity> {
  const sensitivity = new Map((manifest.methods ?? []).map(method => [method.name, method.sensitivity]));
  for (const [method, value] of sensitivity) if (value === "sensitive" && toolNames.has(method)) throw new ContractError("INVALID_MANIFEST", "Sensitive runtime methods cannot be tools");
  return sensitivity;
}

function validateProviderId(provider: ManifestProvider, providerIds: Set<string>): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(provider.id) || providerIds.has(provider.id)) throw new ContractError("INVALID_MANIFEST", "Invalid or duplicate provider ID");
}

function validateProviderHostAndProfiles(provider: ManifestProvider): void {
  if (provider.minimumHostContract.minor !== 0) throw new ContractError("INVALID_MANIFEST", "Provider minimum host contract must be supported host contract 4.0");
  if (!provider.profiles.length || provider.profiles.length > 8 || new Set(provider.profiles).size !== provider.profiles.length) throw new ContractError("INVALID_MANIFEST", "Provider profiles must be a unique bounded list");
}

function validateProviderCapabilitiesAndGroups(provider: ManifestProvider): void {
  if (provider.capabilities.length > 16 || new Set(provider.capabilities).size !== provider.capabilities.length) throw new ContractError("INVALID_MANIFEST", "Provider capabilities must be a unique bounded list");
  if (!provider.methodGroups.length || provider.methodGroups.length > 16) throw new ContractError("INVALID_MANIFEST", "Provider method groups must be a non-empty bounded list");
}

function validateProviderMetadata(provider: ManifestProvider): void {
  validateProviderHostAndProfiles(provider);
  validateProviderCapabilitiesAndGroups(provider);
  compileValueSchema(provider.configSchema, 64 * 1024);
  if (provider.requiredPermissions.length > 16 || new Set(provider.requiredPermissions).size !== provider.requiredPermissions.length) throw new ContractError("INVALID_MANIFEST", "Provider permissions must be a unique bounded list");
}

function validateProviderPermissions(provider: ManifestProvider, manifest: ExtensionManifestV4): void {
  for (const permission of provider.requiredPermissions) {
    const declaration = manifest.permissions[permission as keyof typeof manifest.permissions];
    const declared = Object.hasOwn(manifest.permissions, permission) && (Array.isArray(declaration) ? declaration.length > 0 : Boolean(declaration));
    if (!declared) throw new ContractError("INVALID_MANIFEST", "Provider required permission must be declared by the manifest");
  }
}

function validateSandboxProviderMethodSchema(group: string, operation: string, mapped: string, manifest: ExtensionManifestV4): void {
  const definitions = (providerMethodDefinitions[group as SandboxProviderGroup] as Record<string, readonly [string, string]>)[operation];
  const method = manifest.methods?.find(candidate => candidate.name === mapped);
  if (!definitions || !method || canonicalJson(method.inputSchema) !== canonicalJson(standaloneWireSchema(definitions[0])) || canonicalJson(method.outputSchema) !== canonicalJson(standaloneWireSchema(definitions[1]))) throw new ContractError("INVALID_MANIFEST", "Sandbox provider methods must use the canonical wire schemas");
}

function validateProviderMethodKind(provider: ManifestProvider, group: string, operation: string, mapped: string, manifest: ExtensionManifestV4, methodSensitivity: Map<string, MethodSensitivity>): void {
  if (provider.kind === "static-secret" && methodSensitivity.get(mapped) !== "sensitive") throw new ContractError("INVALID_MANIFEST", "Secret provider methods must be sensitive");
  if (provider.kind === "sandbox") validateSandboxProviderMethodSchema(group, operation, mapped, manifest);
}

function validateProviderMethodMapping(provider: ManifestProvider, group: string, operation: string, mapped: string, manifest: ExtensionManifestV4, methodNames: Set<string>, methodSensitivity: Map<string, MethodSensitivity>, mappedMethods: Set<string>): void {
  if (!methodNames.has(mapped) || mappedMethods.has(mapped) || !methodSensitivity.get(mapped)) throw new ContractError("INVALID_MANIFEST", "Provider methods must uniquely reference explicitly classified manifest methods");
  mappedMethods.add(mapped);
  validateProviderMethodKind(provider, group, operation, mapped, manifest, methodSensitivity);
}

function validateProviderKindGroups(provider: ManifestProvider, groupNames: Set<string>): void {
  if (provider.kind === "sandbox") {
    for (const required of ["sandbox.lifecycle.v1", "sandbox.process.v1", "sandbox.files.v1"]) if (!groupNames.has(required)) throw new ContractError("INVALID_MANIFEST", "Sandbox providers must declare lifecycle, process, and file method groups");
  } else if (!groupNames.has("secret.static.v1")) throw new ContractError("INVALID_MANIFEST", "Static secret providers must declare the static secret method group");
}

function validateProviderContribution(provider: ManifestProvider, manifest: ExtensionManifestV4, methodNames: Set<string>, methodSensitivity: Map<string, MethodSensitivity>): void {
  validateProviderMetadata(provider);
  validateProviderPermissions(provider, manifest);
  const groupNames = new Set<string>();
  const mappedMethods = new Set<string>();
  for (const group of provider.methodGroups) {
    if (groupNames.has(group.name)) throw new ContractError("INVALID_MANIFEST", "Duplicate provider method group");
    groupNames.add(group.name);
    for (const [operation, mapped] of Object.entries(group.methods)) validateProviderMethodMapping(provider, group.name, operation, mapped, manifest, methodNames, methodSensitivity, mappedMethods);
  }
  validateProviderKindGroups(provider, groupNames);
}

function validateManifestProviders(manifest: ExtensionManifestV4, methodNames: Set<string>, methodSensitivity: Map<string, MethodSensitivity>): void {
  const providerIds = new Set<string>();
  for (const provider of manifest.providers ?? []) {
    validateProviderId(provider, providerIds);
    providerIds.add(provider.id);
    validateProviderContribution(provider, manifest, methodNames, methodSensitivity);
  }
  if (providerIds.size > 16) throw new ContractError("DATA_LIMIT", "Too many provider contributions");
}

function validateDataSchemaCompatibility(data: NonNullable<ExtensionManifestV4["dataSchema"]>): void {
  if (![data.version, ...data.readableVersions].every(version => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(version)) || data.readableVersions.length > 64 || new Set(data.readableVersions).size !== data.readableVersions.length || !data.readableVersions.includes(data.version)) throw new ContractError("INVALID_MANIFEST", "Invalid data schema compatibility declaration");
}

function validateDataSchemaMigration(data: NonNullable<ExtensionManifestV4["dataSchema"]>, methodNames: Set<string>, methodSensitivity: Map<string, MethodSensitivity>): void {
  if (data.migrateMethod && !methodNames.has(data.migrateMethod)) throw new ContractError("INVALID_MANIFEST", "Data migration must reference a declared runtime method");
  if (data.migrateMethod && methodSensitivity.get(data.migrateMethod) === "sensitive") throw new ContractError("INVALID_MANIFEST", "Data migration cannot invoke a sensitive runtime method");
}

function validateManifestDataSchema(manifest: ExtensionManifestV4, methodNames: Set<string>, methodSensitivity: Map<string, MethodSensitivity>): void {
  if (!manifest.dataSchema) return;
  validateDataSchemaCompatibility(manifest.dataSchema);
  validateDataSchemaMigration(manifest.dataSchema, methodNames, methodSensitivity);
}

function validateManifestHostApi(manifest: ExtensionManifestV4): void {
  for (const route of manifest.permissions.hostApi?.routes ?? []) if (!/^\/api\/(?:[a-zA-Z0-9_-]+|:[a-zA-Z][a-zA-Z0-9_]*)(?:\/(?:[a-zA-Z0-9_-]+|:[a-zA-Z][a-zA-Z0-9_]*))*$/.test(route.path)) throw new ContractError("INVALID_MANIFEST", "Host API routes must be fixed /api paths with named parameters");
}

function validateManifestPreprocessors(manifest: ExtensionManifestV4, toolNames: Set<string>): void {
  for (const preprocessor of manifest.preprocessors ?? []) if (!toolNames.has(preprocessor.tool) || preprocessor.accepts.length === 0) throw new ContractError("INVALID_MANIFEST", "Preprocessor must reference a declared tool and MIME types");
}

function validateManifestSmokeTest(manifest: ExtensionManifestV4, toolNames: Set<string>): void {
  if (manifest.smokeTest && !toolNames.has(manifest.smokeTest.tool)) throw new ContractError("INVALID_MANIFEST", "Smoke test must reference a declared tool");
}

function validateManifestContributionGroup(contributions: unknown[] | undefined): void {
  const identities = new Set<string>();
  for (const item of contributions ?? []) {
    const record = item as Record<string, unknown>;
    const identity = String(record.name ?? record.id ?? record.type);
    if (!identity || identities.has(identity)) throw new ContractError("INVALID_MANIFEST", "Duplicate contribution identity");
    identities.add(identity);
  }
}

function validateManifestContributions(manifest: ExtensionManifestV4): void {
  for (const contributions of [manifest.skills, manifest.pages, manifest.entities, manifest.messageToolbar, manifest.mcpServers]) validateManifestContributionGroup(contributions as unknown[] | undefined);
}

function validateManifestToolbar(manifest: ExtensionManifestV4): void {
  const subscriptions = manifest.permissions.eventSubscriptions;
  const events = Array.isArray(subscriptions) ? subscriptions : subscriptions?.events ?? [];
  for (const item of manifest.messageToolbar ?? []) if (!item.event.startsWith(`${manifest.name}:`) || !events.includes(item.event)) throw new ContractError("INVALID_MANIFEST", "Toolbar event must be declared in extension namespace");
}

export function validateManifest(value: unknown): ExtensionManifestV4 {
  const manifest = validateWire("manifest", value);
  validateManifestNetworkPermissions(manifest);
  validateManifestSecretPermissions(manifest);
  validateManifestIdentity(manifest);
  const toolNames = validateManifestTools(manifest);
  const methodNames = validateManifestMethods(manifest);
  const methodSensitivity = validateManifestMethodSensitivity(manifest, toolNames);
  validateManifestProviders(manifest, methodNames, methodSensitivity);
  validateManifestDataSchema(manifest, methodNames, methodSensitivity);
  validateManifestHostApi(manifest);
  validateManifestPreprocessors(manifest, toolNames);
  validateManifestSmokeTest(manifest, toolNames);
  validateManifestContributions(manifest);
  validateManifestToolbar(manifest);
  return manifest;
}

export function validateResourceLimits(value: unknown): WireData["limits"] {
  const limits = validateWire("limits", value);
  for (const [key, limit] of Object.entries(limits)) if (!Number.isSafeInteger(limit) || limit <= 0) throw new ContractError("INVALID_LIMITS", `Invalid resource limit: ${key}`);
  return limits;
}

export function validateInvocationContext(value: unknown): WireData["invocationContext"] {
  const context = validateWire("invocationContext", value);
  for (const [key, entry] of Object.entries(context)) if (!["deadline", "metadata"].includes(key) && (typeof entry !== "string" || !entry.length || entry.length > 4096)) throw new ContractError("INVALID_CONTEXT", `Invalid context field: ${key}`);
  if (!Number.isSafeInteger(context.deadline) || context.deadline <= 0) throw new ContractError("INVALID_CONTEXT", "Invalid invocation deadline");
  return context;
}

export function canonicalJson(value: unknown): string {
  assertJson(value, 192 * 1024 * 1024);
  function encode(entry: JsonValue): string {
    if (entry === null || typeof entry !== "object") return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map(encode).join(",")}]`;
    return `{${Object.keys(entry).sort().map(key => `${JSON.stringify(key)}:${encode(entry[key]!)}`).join(",")}}`;
  }
  return encode(value);
}

export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function workspaceFileChecksum(value: WorkspaceFile): Promise<string> {
  return sha256(typeof value === "string" ? value : canonicalJson(value));
}

export async function validatePublishedRelease(value: unknown): Promise<WireData["publishedRelease"]> {
  const release = validateWire("publishedRelease", value);
  const build = release.build;
  if (build.state !== "succeeded" || !build.artifactDigest || !build.manifest || !build.evidence.tests.length || build.evidence.tests.some(test => !test.passed)) throw new ContractError("UNVERIFIED_RELEASE", "Publishing requires a successful tested build");
  validateManifest(build.manifest);
  validateWorkspaceFiles(release.sourceFiles);
  if (!Object.hasOwn(release.sourceFiles, (build.manifest.entrypoint ?? "extension.ts").replace(/^\.\//, ""))) throw new ContractError("UNVERIFIED_RELEASE", "Published source is missing its verified entrypoint");
  if (Object.keys(release.sourceFiles).some(path => path === ".runner" || path.startsWith(".runner/"))) throw new ContractError("INVALID_PATH", "Published source cannot include runner metadata");
  if (await sha256(canonicalJson(release.sourceFiles)) !== build.sourceDigest || await sha256(canonicalJson(build.manifest)) !== build.evidence.discoveryDigest) throw new ContractError("DIGEST_MISMATCH", "Published source or catalog digest mismatch");
  const checksums = Object.fromEntries(await Promise.all(Object.entries(release.sourceFiles).map(async ([path, contents]) => [path, await workspaceFileChecksum(contents)])));
  if (canonicalJson(checksums) !== canonicalJson(release.packageChecksums)) throw new ContractError("DIGEST_MISMATCH", "Published file checksum mismatch");
  const { releaseDigest, ...payload } = release;
  if (await sha256(canonicalJson(payload)) !== releaseDigest) throw new ContractError("DIGEST_MISMATCH", "Published release digest mismatch");
  return release;
}

export async function sealPublishedRelease(build: WireData["buildResult"], artifacts: WorkspaceFiles): Promise<WireData["publishedRelease"]> {
  validateWire("buildResult", build);
  if (await sha256(canonicalJson(artifacts)) !== build.artifactDigest) throw new ContractError("DIGEST_MISMATCH", "Runner artifact digest mismatch");
  const sourceFiles = Object.fromEntries(Object.entries(artifacts).filter(([path]) => !path.startsWith(".runner/")));
  validateWorkspaceFiles(sourceFiles);
  const packageChecksums = Object.fromEntries(await Promise.all(Object.entries(sourceFiles).map(async ([path, contents]) => [path, await workspaceFileChecksum(contents)])));
  const payload = { schemaVersion: 4 as const, build, sourceFiles, packageChecksums };
  return validatePublishedRelease({ ...payload, releaseDigest: await sha256(canonicalJson(payload)) });
}

export const valueSchemaValidator = {
  getValidator<Result>(schema: Record<string, unknown>) {
    const validate = compileValueSchema(schema);
    return (value: unknown) => {
      try { validate(value); return { valid: true as const, data: value as Result, errorMessage: undefined }; }
      catch { return { valid: false as const, data: undefined, errorMessage: "Value does not match the approved schema" }; }
    };
  },
};

export function normalizeMcpCatalog(value: unknown): ToolDefinitionV4[] {
  assertJson(value);
  if (!Array.isArray(value) || value.length > 128) throw new ContractError("INVALID_MCP", "MCP catalog must contain at most 128 tools");
  const names = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ContractError("INVALID_MCP", "Invalid MCP tool");
    const tool = raw as Record<string, unknown>;
    if (typeof tool.name !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(tool.name) || names.has(tool.name)) throw new ContractError("INVALID_MCP", "Invalid or duplicate MCP tool name");
    names.add(tool.name);
    compileValueSchema(tool.inputSchema);
    if (tool.outputSchema) compileValueSchema(tool.outputSchema);
    const description = tool.description ?? tool.title ?? tool.name;
    if (typeof description !== "string") throw new ContractError("INVALID_MCP", "Invalid MCP tool description");
    return { name: tool.name, description, inputSchema: tool.inputSchema as ValueSchema, outputSchema: TOOL_RESULT_SCHEMA, ...(tool.outputSchema ? { mcpOutputSchema: tool.outputSchema as ValueSchema } : {}) };
  }).sort((left, right) => left.name.localeCompare(right.name));
}
