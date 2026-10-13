import { FACTORY_LAZY_INPUT_SCHEMA_VERSION, FACTORY_LIMITS, type CompiledFactory, type JsonValue } from "@ezcorp/factory-sdk/types";
import { firstValidationIssue, validateCompiledFactory } from "@ezcorp/factory-sdk/validation";
import { decodeFactoryPageBase64 } from "@ezcorp/factory-sdk/page-bytes";
import type { KernelEvent } from "@ezcorp/factory-sdk/kernel-types";
import { FACTORY_ATTEMPT_STOP_EFFECTS } from "@ezcorp/factory-sdk/kernel";
import { MAX_ACTIVITY_PAYLOAD_BYTES, MAX_COMMAND_BATCH_BYTES, MAX_DEFINITION_PAGES, MAX_PAGE_BYTES } from "./contracts.ts";
import type {
  FactoryContinuation,
  FactoryDefinitionPage,
  FactoryDefinitionPageReference,
  FactoryDefinitionSource,
  FactoryInboxEnvelope,
  FactoryManifestPage,
  FactoryPartitionSource,
  FactoryPlanSource,
  FactoryWorkflowInput,
  ImmutableObjectReference,
} from "./contracts.ts";

export const MAX_CONTINUATION_BYTES = 64 * 1024;

function requiredIdentity(value: string, label: string): void {
  if (value.length === 0 || value.length > 512) throw new Error(`${label} must contain 1 to 512 characters`);
}

function boundedInteger(value: unknown, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) throw new Error(`${label} must be between 1 and ${maximum}`);
}

function digest(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertActivityPayloadSize(value: unknown, label: string): void {
  if (encodedBytes(value) > MAX_ACTIVITY_PAYLOAD_BYTES) throw new Error(`${label} exceeds ${MAX_ACTIVITY_PAYLOAD_BYTES} bytes`);
}

export function assertCommandBatchSize(value: unknown): void {
  if (encodedBytes(value) > MAX_COMMAND_BATCH_BYTES) throw new Error(`factory command batch exceeds ${MAX_COMMAND_BATCH_BYTES} bytes`);
}

export function validateObjectReference(reference: ImmutableObjectReference, label: string): void {
  if (typeof reference !== "object" || reference === null) throw new Error(`${label} must be an immutable object reference`);
  requiredIdentity(reference.objectId, `${label} object ID`);
  digest(reference.digest, `${label} digest`);
  boundedInteger(reference.encodedBytes, MAX_PAGE_BYTES, `${label} byte count`);
}

export function validateDefinitionSource(source: FactoryDefinitionSource): void {
  if (typeof source !== "object" || source === null) throw new Error("factory definition source is required");
  digest(source.definitionDigest, "factory definition digest");
  boundedInteger(source.definitionEncodedBytes, FACTORY_LIMITS.maxDefinitionBytes, "factory definition byte count");
  validateObjectReference(source.manifest, "factory manifest");
}

export function isPartitionSource(source: FactoryPlanSource): source is FactoryPartitionSource {
  return typeof source === "object" && source !== null && ("executionManifest" in source || "partition" in source);
}

export function validatePartitionSource(source: FactoryPartitionSource): void {
  if (typeof source !== "object" || source === null) throw new Error("factory partition source is required");
  digest(source.definitionDigest, "factory definition digest");
  validateObjectReference(source.executionManifest, "factory execution manifest");
  validateObjectReference(source.partition, "factory partition artifact");
  requiredIdentity(source.partition.partitionId, "factory partition ID");
}

export function validateManifestPage(page: FactoryManifestPage): void {
  if (typeof page !== "object" || page === null || page.schemaVersion !== "factory.manifest-page.v1" || !Array.isArray(page.pages)) throw new Error("factory manifest page is invalid");
  digest(page.definitionDigest, "manifest definition digest");
  boundedInteger(page.definitionEncodedBytes, FACTORY_LIMITS.maxDefinitionBytes, "manifest definition byte count");
  validateObjectReference(page.self, "manifest self reference");
  if (page.pages.length > MAX_DEFINITION_PAGES) throw new Error(`factory manifest page exceeds ${MAX_DEFINITION_PAGES} entries`);
  for (const reference of page.pages) {
    validateObjectReference(reference, "factory definition page");
    if (!Number.isSafeInteger(reference.index) || reference.index < 0) throw new Error("factory definition page index must be a non-negative safe integer");
  }
  if (page.next) validateObjectReference(page.next, "next manifest page");
}

export function validateLoadedDefinitionPage(page: FactoryDefinitionPage, reference: FactoryDefinitionPageReference): void {
  if (typeof page !== "object" || page === null || typeof page.contentBase64 !== "string") throw new Error("loaded factory definition page is invalid");
  if (page.index !== reference.index || page.objectId !== reference.objectId || page.digest !== reference.digest) throw new Error("loaded factory definition page identity does not match its immutable reference");
  if (decodeFactoryPageBase64(page.contentBase64).byteLength !== reference.encodedBytes) throw new Error("loaded factory definition page byte count does not match its immutable reference");
}

function validateDurableInput(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("durable input must be an object");
  const input = value as { schemaVersion?: unknown; parameters?: unknown };
  if (input.schemaVersion !== FACTORY_LAZY_INPUT_SCHEMA_VERSION || typeof input.parameters !== "object" || input.parameters === null || Array.isArray(input.parameters)) throw new Error("durable input is invalid");
  for (const [name, parameter] of Object.entries(input.parameters)) {
    requiredIdentity(name, "durable input parameter name");
    if (typeof parameter !== "object" || parameter === null || Array.isArray(parameter)) throw new Error("durable input parameter is invalid");
    const transport = parameter as { kind?: unknown; value?: unknown; artifact?: unknown };
    if (transport.kind === "inline") continue;
    if (transport.kind !== "artifact" || typeof transport.artifact !== "object" || transport.artifact === null) throw new Error("durable input parameter is invalid");
    const artifact = transport.artifact as { artifactId?: unknown; digest?: unknown; encodedBytes?: unknown };
    requiredIdentity(typeof artifact.artifactId === "string" ? artifact.artifactId : "", "durable input artifact ID");
    digest(artifact.digest, "durable input artifact digest");
    boundedInteger(artifact.encodedBytes, FACTORY_LIMITS.maxDefinitionBytes, "durable input artifact byte count");
  }
}

export function validateWorkflowInput(input: FactoryWorkflowInput): void {
  requiredIdentity(input.tenantId, "tenant ID");
  requiredIdentity(input.projectId, "project ID");
  requiredIdentity(input.logicalRunId, "logical run ID");
  requiredIdentity(input.interpreterId, "interpreter ID");
  if (!Number.isSafeInteger(input.startedAtMs) || input.startedAtMs < 0) throw new Error("start timestamp must be a non-negative safe integer");
  if (input.deadlineAtMs !== undefined && (!Number.isSafeInteger(input.deadlineAtMs) || input.deadlineAtMs < input.startedAtMs)) throw new Error("workflow deadline must be a safe timestamp at or after start");
  assertActivityPayloadSize(input, "factory workflow input");
  if (input.durableInput !== undefined) validateDurableInput(input.durableInput);
  if (isPartitionSource(input.definition)) validatePartitionSource(input.definition);
  else validateDefinitionSource(input.definition);
  if (input.continuation && (input.continuation.state === undefined) === (input.continuation.stateArtifact === undefined)) throw new Error("continuation requires exactly one state source");
  if (input.continuation?.state && input.continuation.state.definitionDigest !== input.definition.definitionDigest) throw new Error("continuation definition digest does not match input");
  if (input.continuation?.state && isPartitionSource(input.definition) && input.continuation.state.partition?.id !== input.definition.partition.partitionId) throw new Error("continuation partition ID does not match input");
  if (input.continuation?.stateArtifact) {
    if (input.continuation.stateArtifact.sourceSequence !== input.continuation.sourceSequence) throw new Error("continuation artifact sequence does not match input");
    validateObjectReference(input.continuation.stateArtifact.manifest, "continuation transition manifest");
  }
  if (input.continuation && (!Number.isSafeInteger(input.continuation.acknowledgedInboxSequence) || input.continuation.acknowledgedInboxSequence < 0)) throw new Error("continuation inbox sequence must be a non-negative safe integer");
}

export function validateCompiledFactoryShape(factory: CompiledFactory): void {
  const result = validateCompiledFactory(factory);
  if (!result.ok) {
    const issue = firstValidationIssue(result);
    throw new Error(`${issue?.code ?? "COMPILED_INVALID"}: ${issue?.message ?? "Compiled factory is invalid."}`);
  }
}

/** Signal payloads are untrusted, so this takes `unknown` and narrows. */
export function validateInboxEnvelope(value: unknown): asserts value is FactoryInboxEnvelope {
  if (typeof value !== "object" || value === null) throw new Error("factory inbox envelope must be an object");
  const envelope: { readonly [Key in keyof FactoryInboxEnvelope]?: unknown } = value;
  if (!Number.isSafeInteger(envelope.sequence) || (envelope.sequence as number) < 1) throw new Error("factory inbox sequence must be a positive safe integer");
  requiredIdentity(typeof envelope.eventId === "string" ? envelope.eventId : "", "factory inbox event ID");
  digest(envelope.eventHash, "factory inbox event hash");
  const event = envelope.event as JsonValue;
  validateInboxEvent(event);
  if (event.id !== envelope.eventId) throw new Error("factory inbox event ID does not match its envelope");
  assertActivityPayloadSize(value, "factory inbox signal");
}

type InboxEventObject = { [key: string]: JsonValue };

export function validateInboxEvent(value: JsonValue): asserts value is JsonValue & KernelEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("inbox event must be an object");
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 512) throw new Error("inbox event requires a stable ID");
  if (!Number.isSafeInteger(value.atMs) || (value.atMs as number) < 0) throw new Error(`inbox event ${String(value.id)} requires a recorded timestamp`);
  if (typeof value.kind !== "string") throw new Error("inbox event requires a kind");
  if (value.kind === "attempt-stopped") validateAttemptStoppedEvent(value);
  if (value.kind === "repair" || value.kind === "replan") validateRunControlEvent(value);
}

function validateAttemptStoppedEvent(value: InboxEventObject): void {
  // W09e: a release stop's external effect is an explicit enum, never an arbitrary field.
  if (value.effect !== undefined && (typeof value.effect !== "string" || !Object.hasOwn(FACTORY_ATTEMPT_STOP_EFFECTS, value.effect))) {
    throw new Error("attempt-stopped effect must be uncertain or published");
  }
  // W09h: a stop before compute admission is named by one value, never an arbitrary field.
  if (value.stoppedBefore !== undefined && value.stoppedBefore !== "admission") {
    throw new Error("attempt-stopped stoppedBefore must be admission");
  }
}

function validateRunControlEvent(value: InboxEventObject): void {
  requiredIdentity(typeof value.nodeId === "string" ? value.nodeId : "", "run control node ID");
  if (value.reason !== undefined) requiredIdentity(typeof value.reason === "string" ? value.reason : "", "run control reason");
  if (value.inputOverride !== undefined && typeof value.inputOverride !== "object") throw new Error("run control input override must be JSON");
  const allowed = new Set(["kind", "id", "atMs", "nodeId", "reason", "inputOverride", ...(value.kind === "replan" ? ["replacement"] : [])]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error("run control event contains unknown fields");
  if (value.kind === "replan") validateReplanReplacement(value.replacement);
}

function validateReplanReplacement(replacement: JsonValue | undefined): void {
  if (typeof replacement !== "object" || replacement === null || Array.isArray(replacement)) throw new Error("replan replacement is required");
  requiredIdentity(typeof replacement.id === "string" ? replacement.id : "", "replan factory ID");
  const version = typeof replacement.version === "string" ? replacement.version : "";
  requiredIdentity(version, "replan factory version");
  if (version === "latest" || version.includes("*")) throw new Error("replan factory version must be exact");
  digest(replacement.digest, "replan factory digest");
  if (Object.keys(replacement).some(key => !["id", "version", "digest"].includes(key))) throw new Error("replan replacement contains unknown fields");
}

export function assertContinuationSize(continuation: FactoryContinuation): void {
  const bytes = new TextEncoder().encode(JSON.stringify(continuation)).byteLength;
  if (bytes > MAX_CONTINUATION_BYTES) throw new Error(`continuation snapshot exceeds ${MAX_CONTINUATION_BYTES} bytes`);
}
