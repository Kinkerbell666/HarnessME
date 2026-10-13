/**
 * Memory dedup helper — host-side, cross-extension by design.
 *
 * Extracted from `src/memory/extraction.ts` in Phase 53.4 Stage 1 so
 * that Stage 2's deletion of `extraction.ts` doesn't break the bundled
 * memory-extractor's dedup path. The decision is locked in
 * tasks/v1.3-phase-53-bundled-extension-ports.md:
 *
 *   > Memory dedup stays host-side. Cross-extension by nature; an
 *   > extension cannot dedup against memories it can't see. Extension
 *   > calls `ctx.memory.write` and the host applies dedup before
 *   > insert. The dedup helper migrates from `src/memory/extraction.ts`
 *   > to a new `src/memory/dedup.ts` host module that survives the
 *   > deletion.
 *
 * Today's wiring (Stage 2 is done — `extraction.ts` is deleted): the
 * single caller is `handleDedupMemoryWrite` in
 * `src/extensions/runtime-invoke-handler.ts`, serving the bundled
 * memory-extractor's `ctx.invoke("runtime.memory.dedupMemoryWrite")`.
 * The extractor uses that RPC rather than `ctx.memory.write` precisely
 * because dedup must see memories authored by any extension, which the
 * `selfOnly` capability surface cannot.
 *
 * The mutex below is a per-project serialization gate. Concurrent
 * `run:complete` events extracting overlapping facts must not race past
 * the similarity check (the `findSimilarMemory` query and the
 * subsequent insert/update are not atomic). It lives here, on the
 * shared helper, so every writer holds ONE lock instance per project —
 * two writers each holding "their own" lock would still race.
 */

import type { ExtractedFact, MemoryProvenance } from "./types";
import { findSimilarMemory, insertMemory, updateMemory } from "../db/queries/memories";
import { getConversation } from "../db/queries/conversations";
import { logger } from "../logger";

const log = logger.child("memory.dedup");
void log;

// ── Per-project extraction mutex ────────────────────────────────────
//
// Same shape as the original lock in `extraction.ts`. Exposed via
// `withDedupLock` so both code paths (legacy + bundled extension)
// hold the same lock during the similarity-check + insert/update
// sequence.
const dedupLocks = new Map<string, Promise<void>>();

export async function withDedupLock<T>(projectKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = dedupLocks.get(projectKey) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  dedupLocks.set(projectKey, prev.then(() => next));
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (dedupLocks.get(projectKey) === next) dedupLocks.delete(projectKey);
  }
}

/** Project-scope key used by the mutex. Memories without a project
 *  share a single global slot ("__global__"); this matches the
 *  legacy behavior. */
export function dedupLockKey(projectId: string | null | undefined): string {
  return projectId ?? "__global__";
}

// ── Similarity threshold (extraction-time) ──────────────────────────
//
// 0.85 is the legacy default copied from `extraction.ts`. Lower than
// the compaction threshold (0.90) because extraction-time dedup needs
// to merge near-duplicates aggressively (the LLM may rephrase the same
// fact across runs); compaction is a stricter sweep. Both numbers are
// host-controlled — extensions cannot widen them.
export const EXTRACTION_DEDUP_THRESHOLD = 0.85;

// ── Embedding dependency ────────────────────────────────────────────
//
// Lazy-imported to keep onnxruntime-node off the import graph for
// modules that just want the dedup helper without paying the model
// load (Vite SSR on NixOS chokes on the eager import).
async function generateEmbedding(text: string): Promise<number[]> {
  const { generateEmbedding: gen } = await import("./embeddings");
  return gen(text);
}

// ── Dedup-aware memory write ────────────────────────────────────────
//
// Single entry point used by both the legacy extraction listener and
// the bundled memory-extractor's post-write hook. Returns the same
// shape callers expect today: `{action: "inserted" | "updated", id}`.
//
// Behavior:
//   1. Generate / receive an embedding for the candidate content.
//   2. Find the most-similar existing active memory (cross-extension).
//   3. If similarity >= threshold: update the existing row in place
//      (newer wins, history-extended provenance).
//   4. Otherwise: insert a new memory row with full provenance, the
//      source conversation's owner in `user_id`, and the caller's
//      injection eligibility in `injection_eligible`.
//
// The full sequence runs under `withDedupLock(projectKey)` so two
// concurrent run:complete events touching the same project cannot
// both pass the similarity check and produce duplicate rows.
//
// `provenanceFactory` lets the caller stamp extension-specific fields
// (`source`, `extensionId`) without this module knowing about
// extension identity — which keeps the cross-extension dedup
// invariant intact. Eligibility also rides in provenance for audit
// parity, but the COLUMN is what retrieval filters on.
export interface DedupWriteInput {
  fact: ExtractedFact;
  conversationId: string;
  projectId: string | null | undefined;
  /** Pre-computed embedding. If omitted, the helper computes one. */
  embedding?: number[];
  /** Injection eligibility for the INSERT branch, written to the real
   *  `memories.injection_eligible` column. Omit to let the column
   *  default (`true`) apply — the host pipeline's behaviour. The
   *  UPDATE branch never touches the column: an existing row's
   *  eligibility is the owner's setting (it is editable via
   *  `PATCH /api/memories/[id]`), and a dedup hit must not silently
   *  re-enable a memory the owner took out of injection. */
  injectionEligible?: boolean;
  /** Provenance factory for the INSERT branch. The factory receives
   *  the action ("created") and returns the full provenance object.
   *  The UPDATE branch always uses the legacy "updated" provenance
   *  shape (see updateProvenanceShape below) so cross-extension
   *  updates remain shape-compatible with the legacy pipeline. */
  provenanceFactory: (
    action: "created",
    fact: ExtractedFact,
    conversationId: string,
  ) => MemoryProvenance;
}

export interface DedupWriteResult {
  action: "inserted" | "updated";
  memoryId: string;
}

export async function dedupAndWriteMemory(
  input: DedupWriteInput,
): Promise<DedupWriteResult> {
  const { fact, conversationId, projectId, provenanceFactory, injectionEligible } = input;
  const embedding = input.embedding ?? (await generateEmbedding(fact.content));

  return withDedupLock(dedupLockKey(projectId), async () => {
    // Memories are per-user-private: scope the similar-match to the acting
    // conversation's owner. Unscoped, one user's extracted fact could match —
    // and then OVERWRITE — another user's memory row via the update branch
    // below. A conversation with no resolvable owner matches nothing
    // (fail-closed) and falls through to a fresh insert.
    //
    // Only ACTIVE rows are dedup targets. Retrieval never returns an
    // archived row, so a restated fact written into one would be lost.
    //
    // Only rows the writing scope can always see are targets, too: a
    // project fact matches rows that are members of that project (visible
    // with or without memory isolation); a global fact matches global rows
    // only. A fact merged into another project's row would be invisible
    // where it was said.
    const conv = await getConversation(conversationId);
    const similar = await findSimilarMemory(embedding, EXTRACTION_DEDUP_THRESHOLD, {
      ownerUserId: conv?.userId ?? null,
      status: "active",
      ...(projectId ? { projectId } : { projectIds: [] }),
    });
    if (similar) {
      const updatedProvenance: MemoryProvenance = {
        sourceConversationId: conversationId,
        sourceMessageIds: fact.messageIds ?? [],
        extractedAt: new Date(),
        confidence: fact.confidence ?? "medium",
        history: [
          {
            action: "updated",
            timestamp: new Date(),
            reason: "Updated with newer information",
            previousContent: similar.content,
          },
        ],
      };
      await updateMemory(similar.id, {
        content: fact.content,
        confidence: fact.confidence ?? "medium",
        embedding,
        provenance: updatedProvenance,
      });
      return { action: "updated", memoryId: similar.id };
    }

    const provenance = provenanceFactory("created", fact, conversationId);
    const inserted = await insertMemory({
      content: fact.content,
      category: fact.category,
      projectId: projectId ?? null,
      conversationId,
      messageIds: fact.messageIds ?? [],
      confidence: fact.confidence ?? "medium",
      embedding,
      provenance,
      // Stamp the owner into the real column. Retrieval only falls back
      // to the source conversation's owner when `user_id` is null, so a
      // row that relies on that fallback becomes unattributable — and
      // so invisible to the person it belongs to — the moment the
      // conversation is deleted (`on delete set null`). `conv` is the
      // same row the similarity scope above resolved, so the column and
      // the dedup scope can never disagree.
      userId: conv?.userId ?? null,
      // Omitted when the caller says nothing, so the schema default
      // (`true`) decides. The host pipeline never passes a value, which
      // keeps its rows injectable exactly as before this column was
      // written here.
      ...(injectionEligible === undefined ? {} : { injectionEligible }),
    });
    return { action: "inserted", memoryId: inserted.id };
  });
}

/** Provenance factory matching the legacy `extractMemories` shape (no
 *  `source` / `extensionId` / `injectionEligible` fields). Its
 *  production caller went away with `extraction.ts`; it survives as the
 *  reference "host pipeline" shape the dedup tests write through, so a
 *  row-shape regression still fails somewhere. */
export function legacyExtractionProvenance(
  _action: "created",
  fact: ExtractedFact,
  conversationId: string,
): MemoryProvenance {
  return {
    sourceConversationId: conversationId,
    sourceMessageIds: fact.messageIds ?? [],
    extractedAt: new Date(),
    confidence: fact.confidence ?? "medium",
    history: [
      { action: "created", timestamp: new Date(), reason: "Extracted from conversation" },
    ],
  };
}
