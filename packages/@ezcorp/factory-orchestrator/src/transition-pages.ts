import { canonicalizeJson, sha256Hex } from "@ezcorp/factory-sdk/canonical";
import { decodeFactoryPageBase64, encodeFactoryPageBase64 } from "@ezcorp/factory-sdk/page-bytes";
import type { JsonValue } from "@ezcorp/factory-sdk/types";
import type { KernelCommand, KernelEvent, KernelState } from "@ezcorp/factory-sdk/kernel-types";
import type {
  FactoryActivities,
  FactoryIdentity,
  FactoryInboxEnvelope,
  FinalizedTransitionArtifact,
  FactoryTransitionManifest,
  ImmutableObjectReference,
  TransitionArtifact,
  TransitionPageRequest,
  TransitionPageReference,
  TransitionRecord,
} from "./contracts.ts";
import { MAX_PAGE_BYTES, MAX_TRANSITION_BYTES } from "./contracts.ts";
import { assertActivityPayloadSize, validateObjectReference } from "./validation.ts";

export interface TransitionWriter {
  stageTransitionPage(request: TransitionPageRequest): Promise<TransitionPageReference>;
  finalizeTransitionArtifact(request: FactoryIdentity & { readonly sourceSequence: number; readonly encodedBytes: number; readonly eventId: string; readonly expectedEventHash?: string; readonly pages: readonly TransitionPageReference[] }): Promise<FinalizedTransitionArtifact>;
  recordTransition(record: TransitionRecord): Promise<void>;
}

export type TransitionReader = Pick<FactoryActivities, "loadTransitionManifest" | "loadTransitionPage">;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Split UTF-8 without cutting a multi-byte code point. */
export function splitTransitionContent(content: string): readonly string[] {
  const bytes = encoder.encode(content);
  if (bytes.byteLength === 0) return [""];
  const pages: string[] = [];
  for (let offset = 0; offset < bytes.byteLength;) {
    let end = Math.min(offset + MAX_PAGE_BYTES, bytes.byteLength);
    while (end < bytes.byteLength && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    pages.push(decoder.decode(bytes.subarray(offset, end)));
    offset = end;
  }
  return pages;
}

function validatePageReference(reference: TransitionPageReference, index: number, encodedBytes: number): void {
  validateObjectReference(reference, `factory transition page ${index}`);
  if (reference.index !== index || reference.encodedBytes !== encodedBytes) throw new Error(`factory transition page ${index} reference does not match staged content`);
}

/** Persist the exact transition, then commit its compact audit fact before effects run. */
export async function persistTransition(
  identity: FactoryIdentity,
  sourceSequence: number,
  event: KernelEvent,
  nextState: KernelState,
  commands: readonly KernelCommand[],
  inbox: Pick<FactoryInboxEnvelope, "sequence" | "eventId" | "eventHash"> | undefined,
  writer: TransitionWriter,
): Promise<FinalizedTransitionArtifact> {
  const artifact: TransitionArtifact = { schemaVersion: "factory.transition.v1", ...identity, sourceSequence, event, nextState, commands };
  const content = canonicalizeJson(JSON.parse(JSON.stringify(artifact)) as JsonValue);
  const encodedBytes = encoder.encode(content).byteLength;
  if (encodedBytes > MAX_TRANSITION_BYTES) throw new Error(`factory transition exceeds ${MAX_TRANSITION_BYTES} bytes`);
  const pages: TransitionPageReference[] = [];
  for (const [index, pageContent] of splitTransitionContent(content).entries()) {
    const pageBytes = encoder.encode(pageContent).byteLength;
    const request = { ...identity, sourceSequence, index, contentBase64: encodeFactoryPageBase64(encoder.encode(pageContent)), encodedBytes: pageBytes };
    assertActivityPayloadSize(request, `factory transition page ${index}`);
    const reference = await writer.stageTransitionPage(request);
    validatePageReference(reference, index, pageBytes);
    pages.push(reference);
  }
  const finalizeRequest = { ...identity, sourceSequence, encodedBytes, eventId: event.id, ...(inbox ? { expectedEventHash: inbox.eventHash } : {}), pages };
  assertActivityPayloadSize(finalizeRequest, "factory transition manifest");
  const finalized = await writer.finalizeTransitionArtifact(finalizeRequest);
  validateObjectReference(finalized.manifest, "factory transition manifest");
  if (!/^sha256:[0-9a-f]{64}$/.test(finalized.eventHash)) throw new Error("factory transition finalizer returned an invalid event digest");
  if (inbox && (inbox.eventId !== event.id || inbox.eventHash !== finalized.eventHash)) throw new Error("factory transition finalizer did not preserve the inbox event identity");
  const record: TransitionRecord = { ...identity, sourceSequence, eventId: event.id, eventHash: finalized.eventHash, ...(inbox ? { inboxSequence: inbox.sequence } : {}), artifactManifest: finalized.manifest };
  assertActivityPayloadSize(record, "factory transition audit record");
  await writer.recordTransition(record);
  return finalized;
}

function sameReference(actual: ImmutableObjectReference, expected: ImmutableObjectReference): boolean {
  return actual.objectId === expected.objectId && actual.digest === expected.digest && actual.encodedBytes === expected.encodedBytes;
}

function validateTransitionManifest(manifest: FactoryTransitionManifest, identity: FactoryIdentity, sourceSequence: number, reference: ImmutableObjectReference): void {
  if (manifest.schemaVersion !== "factory.transition-manifest.v1" || !sameReference(manifest.self, reference)) throw new Error("factory transition manifest identity does not match its immutable reference");
  if (manifest.tenantId !== identity.tenantId || manifest.projectId !== identity.projectId || manifest.logicalRunId !== identity.logicalRunId || manifest.interpreterId !== identity.interpreterId || manifest.sourceSequence !== sourceSequence) throw new Error("factory transition manifest scope does not match its continuation");
  if (!Number.isSafeInteger(manifest.encodedBytes) || manifest.encodedBytes < 1 || manifest.encodedBytes > MAX_TRANSITION_BYTES) throw new Error("factory transition manifest byte count is invalid");
  if (!/^sha256:[0-9a-f]{64}$/.test(manifest.eventHash) || !manifest.eventId) throw new Error("factory transition manifest event identity is invalid");
  if (!Array.isArray(manifest.pages) || manifest.pages.length < 1 || manifest.pages.length > Math.ceil(MAX_TRANSITION_BYTES / MAX_PAGE_BYTES)) throw new Error("factory transition manifest page count is invalid");
  for (const [index, page] of manifest.pages.entries()) validatePageReference(page, index, page.encodedBytes);
}

export async function loadTransitionArtifact(identity: FactoryIdentity, sourceSequence: number, reference: ImmutableObjectReference, reader: TransitionReader): Promise<TransitionArtifact> {
  validateObjectReference(reference, "factory transition manifest");
  const manifest = await reader.loadTransitionManifest({ ...identity, sourceSequence, manifest: reference });
  validateTransitionManifest(manifest, identity, sourceSequence, reference);
  let content = "";
  let encodedBytes = 0;
  for (const reference of manifest.pages) {
    const page = await reader.loadTransitionPage({ ...identity, sourceSequence, page: reference });
    validatePageReference(page, reference.index, reference.encodedBytes);
    if (page.objectId !== reference.objectId || page.digest !== reference.digest) throw new Error("factory transition page identity does not match its immutable reference");
    const bytes = decodeFactoryPageBase64(page.contentBase64);
    if (bytes.byteLength !== reference.encodedBytes || `sha256:${sha256Hex(bytes)}` !== reference.digest) throw new Error("factory transition page bytes do not match their immutable reference");
    content += decoder.decode(bytes);
    encodedBytes += bytes.byteLength;
  }
  if (encodedBytes !== manifest.encodedBytes) throw new Error("factory transition byte count does not match its immutable manifest");
  let artifact: TransitionArtifact;
  try { artifact = JSON.parse(content) as TransitionArtifact; } catch { throw new Error("factory transition pages do not contain valid JSON"); }
  if (canonicalizeJson(artifact as unknown as JsonValue) !== content) throw new Error("factory transition artifact is not canonical JSON");
  if (artifact.schemaVersion !== "factory.transition.v1" || artifact.tenantId !== identity.tenantId || artifact.projectId !== identity.projectId || artifact.logicalRunId !== identity.logicalRunId || artifact.interpreterId !== identity.interpreterId || artifact.sourceSequence !== sourceSequence) throw new Error("factory transition artifact scope does not match its continuation");
  const eventHash = `sha256:${sha256Hex(canonicalizeJson(artifact.event as unknown as JsonValue))}`;
  if (artifact.event.id !== manifest.eventId || eventHash !== manifest.eventHash) throw new Error("factory transition artifact event does not match its immutable manifest");
  return artifact;
}
