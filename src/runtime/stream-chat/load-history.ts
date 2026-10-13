import type {
  AssistantMessage,
  Message,
  UserMessage,
} from "../../types";
import { getConversationPath, getLatestLeaf, resolveSystemPrompt } from "../../db/queries/conversations";
import { computeSessionBranch, isSessionHistoryProducerEnabled } from "../../db/session-sync";
import type { HistoryUserRow } from "../../chat/attachments/history-rehydrate";
import { logger } from "../../logger";
import type { StreamChatContext } from "./context";

const log = logger.child("executor.loadHistory.rehydrate");

/**
 * Smart-cap limits for rehydrating tool-generated images into history.
 *
 * We walk assistant turns newest → oldest, accumulating images until
 * EITHER cap is hit:
 *   - MAX_IMAGES: total image count across all rehydrated turns
 *   - MAX_TOTAL_BYTES: cumulative on-disk size (approximate token spend)
 *
 * Counting images (not turns) means a chat that generates five variants
 * across ten turns includes all five; a chat that generates one image
 * per turn across twenty turns caps at MAX_IMAGES. Bytes is the escape
 * valve for oversized PNGs — one 20 MB image shouldn't eat the entire
 * context window while four tiny ones fit easily.
 */
export const MAX_REHYDRATED_IMAGES = 5;
/** ~5 MB of image bytes ≈ ~6.7 MB base64 ≈ 10–15k tokens for most vision
 *  models. Per-request, not per-conversation. */
export const MAX_REHYDRATED_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Find the index of the first user message after `fromIdx`, or -1 if none.
 * Exported for unit coverage.
 */
export function findNextUserIndex(
  branch: Array<{ role: string }>,
  fromIdx: number,
): number {
  for (let i = fromIdx + 1; i < branch.length; i++) {
    if (branch[i]!.role === "user") return i;
  }
  return -1;
}

/**
 * Walk assistant turns newest → oldest, resolving ext-files image URLs
 * found in either the assistant text or any anchored tool-call output.
 * Each resolved image is attached to the index of the *next* user message
 * (pi-ai's AssistantMessage content can't hold images).
 *
 * Stops accumulating when either `MAX_REHYDRATED_IMAGES` or
 * `MAX_REHYDRATED_IMAGE_BYTES` is reached. Dedupes across turns by base64
 * payload so the same URL appearing in multiple places contributes once.
 *
 * Exported for focused unit coverage of the cap arithmetic.
 */
export async function collectRehydratedImages(
  branch: Array<{ id: string; role: string; content: string }>,
  out: Map<number, Array<{ type: "image"; data: string; mimeType: string }>>,
  limits: { maxImages?: number; maxBytes?: number } = {},
): Promise<void> {
  const maxImages = limits.maxImages ?? MAX_REHYDRATED_IMAGES;
  const maxBytes = limits.maxBytes ?? MAX_REHYDRATED_IMAGE_BYTES;

  const { extractExtFilesUrls, statExtFilesImage, loadExtFilesImage } =
    await import("../../chat/attachments/history-rehydrate");
  const { listToolCallOutputsForMessages } = await import("../../db/queries/tool-calls");
  const { extractOutputText } = await import("../../db/queries/conversations");

  // Index all tool outputs for assistants in the branch up front — the
  // walker can then read from the map without re-querying per turn.
  const assistantIds = branch.filter((m) => m.role === "assistant").map((m) => m.id);
  const toolOutputsByMessage = new Map<string, string[]>();
  let toolRowsFound = 0;
  if (assistantIds.length > 0) {
    const rows = await listToolCallOutputsForMessages(assistantIds).catch((err) => {
      log.warn("listToolCallOutputsForMessages failed", { error: String(err) });
      return [];
    });
    toolRowsFound = rows.length;
    for (const row of rows) {
      const text = extractOutputText(row.output);
      if (!text) continue;
      const list = toolOutputsByMessage.get(row.messageId) ?? [];
      list.push(text);
      toolOutputsByMessage.set(row.messageId, list);
    }
  }

  // Global dedupe set across all turns — a URL that appears in turn 5
  // and turn 3 (e.g. the model re-referenced the same image later)
  // should land on the model exactly once, attributed to the newest
  // occurrence.
  const seen = new Set<string>(); // keyed by resolved absPath
  let imageCount = 0;
  let totalBytes = 0;

  let urlsSeen = 0;
  let statMisses = 0;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (imageCount >= maxImages || totalBytes >= maxBytes) break;
    const m = branch[i]!;
    if (m.role !== "assistant") continue;
    const nextUserIdx = findNextUserIndex(branch, i);
    if (nextUserIdx === -1) continue; // trailing assistant — no follow-up

    // Gather URL candidates from assistant text + every anchored tool output.
    const toolTexts = toolOutputsByMessage.get(m.id) ?? [];
    const sources = [m.content, ...toolTexts].filter(Boolean) as string[];
    const urls: string[] = [];
    for (const s of sources) urls.push(...extractExtFilesUrls(s));
    if (urls.length === 0) continue;
    urlsSeen += urls.length;

    for (const url of urls) {
      if (imageCount >= maxImages || totalBytes >= maxBytes) break;
      const info = await statExtFilesImage(url);
      if (!info) { statMisses++; continue; }
      if (seen.has(info.absPath)) continue; // cross-turn dedupe
      // Stop early if adding this image would blow past the byte cap.
      // We don't "skip and keep scanning" — the walker commits to newest
      // first, and a partial append preserves that ordering guarantee.
      if (totalBytes + info.sizeBytes > maxBytes) break;
      const img = await loadExtFilesImage(info.absPath, info.mimeType);
      if (!img) continue;
      seen.add(info.absPath);
      const existing = out.get(nextUserIdx) ?? [];
      existing.push(img);
      out.set(nextUserIdx, existing);
      imageCount++;
      totalBytes += info.sizeBytes;
    }
  }

  // Single summary line per turn. One grep target tells you exactly which
  // stage is zero when rehydration isn't working:
  //   assistantsInBranch=0  → branch has no assistant turns yet
  //   toolRowsFound=0       → tool_calls anchoring lost the messageId link
  //   urlsSeen=0            → tool output format isn't producing ![](url)
  //   statMisses > 0        → cwd mismatch between save and read, or file GC'd
  //                           (ext-files volume not mounted → restart wipes)
  //   imagesInjected=0 with urlsSeen>0 → file-read failed (permissions, etc.)
  //
  // Warn when any URL failed to resolve to a file on disk — that's almost
  // always a missing volume mount (seen in production: container restart
  // → /app/.ezcorp wiped → tool-card URLs 404 and rehydration silently
  // fails). Info otherwise so successful turns stay quiet.
  const payload = {
    assistantsInBranch: assistantIds.length,
    toolRowsFound,
    urlsSeen,
    statMisses,
    imagesInjected: imageCount,
    totalBytes,
    cwd: process.cwd(),
  };
  if (statMisses > 0) log.warn("walked — some ext-files URLs could not be resolved on disk", payload);
  else log.info("walked", payload);
}

/** Subset of streamChat's options the load-history phase reads. */
export interface LoadHistoryOptions {
  parentMessageId?: string;
  system?: string;
  projectId?: string;
  modeId?: string;
  provider?: string;
  model?: string;
}

export interface LoadHistoryResult {
  /** pi-ai-shaped messages for the current branch, with past-turn
   *  attachments rehydrated into their UserMessage content. */
  history: Message[];
  /** Every attachment from every earlier user message in the branch.
   *  Threaded into the setup-tools phase so the attachment-handle
   *  resolver can substitute `ez-attachment://` handles emitted on
   *  prior turns into data URIs when the LLM echoes them back to a
   *  tool. */
  allPastAttachments: import("../../chat/attachments/content-builder").StagedAttachment[];
}

/**
 * The legacy (kill-switch OFF) branch source: the branch-aware
 * conversation history from the recursive-CTE walk, with `excluded` rows
 * dropped so pi-ai never sees them (the transcript still shows them
 * struck-through; toggling restores them next turn). Returns the
 * `{id, role, content}` subset the rehydration/mapping below reads.
 */
async function computeLegacyBranch(
  conversationId: string,
  options: LoadHistoryOptions,
): Promise<HistoryUserRow[]> {
  const path = options.parentMessageId
    ? await getConversationPath(options.parentMessageId, conversationId)
    : await (async () => {
        const leaf = await getLatestLeaf(conversationId);
        return leaf ? getConversationPath(leaf.id, conversationId) : [];
      })();
  return path.filter((m) => !m.excluded);
}

/**
 * Count of turns where the enabled session producer threw and this call fell
 * open to the legacy walk. Observability seam: an operator can watch it, and
 * the LIVE parity suite asserts it stays 0 on the happy path so a SILENT
 * fail-open can never masquerade as a session-produced parity pass.
 */
let sessionProducerFallbacks = 0;
/** Test/observability accessor for {@link sessionProducerFallbacks}. */
export function getSessionProducerFallbackCount(): number {
  return sessionProducerFallbacks;
}
/** Reset the fallback counter (tests assert 0 across a single ON read). */
export function resetSessionProducerFallbackCount(): void {
  sessionProducerFallbacks = 0;
}

/**
 * Choose the branch source. When the history producer is enabled the pi
 * session tree produces the branch (design §5); ANY failure on that path
 * (backfill/open failure, invalid_session, a poisoned tree) FAILS OPEN to
 * the legacy CTE walk for this one call with a warn — a single-container
 * deploy must never wedge a turn on the new path. Kill-switch OFF skips the
 * session path entirely, leaving the legacy path byte-for-byte untouched.
 */
async function computeBranch(
  conversationId: string,
  options: LoadHistoryOptions,
): Promise<HistoryUserRow[]> {
  if (await isSessionHistoryProducerEnabled()) {
    try {
      return await computeSessionBranch(conversationId, options.parentMessageId);
    } catch (err) {
      sessionProducerFallbacks++;
      // Recovery hint: a PERMANENT fail-open (a truly poisoned tree) is cleared
      // by deleting this conversation's `agent_sessions` row(s) — the next read
      // then backfills a fresh tree from the messages table.
      log.warn("session history producer failed — using legacy branch for this turn (delete the conversation's agent_sessions row to force a fresh backfill)", {
        conversationId,
        error: String(err),
      });
    }
  }
  return computeLegacyBranch(conversationId, options);
}

/**
 * Load the conversation branch + resolve the system prompt, then
 * rehydrate any past-turn attachments into the user-message content.
 *
 * Mutates `ctx.system` with the resolved value (closures further down
 * — memory/KB injection + orchestrator-prompt rewrites — both read and
 * write `ctx.system`, so the per-call context is the natural home for
 * it). Returns the hydrated message history + the flat list of past
 * attachments for the setup-tools phase to consume.
 */
export async function loadHistory(
  ctx: StreamChatContext,
  conversationId: string,
  options: LoadHistoryOptions,
): Promise<LoadHistoryResult> {
  // Load history and resolve system prompt in parallel (they're independent)
  const [branchMessages, resolvedSystem] = await Promise.all([
    // Gather the branch-aware conversation history as `{id, role, content}`
    // rows. Under the session history producer these come from the pi
    // session tree (design §5); otherwise from the legacy CTE walk. The
    // downstream rehydration/mapping is IDENTICAL for both, so a flag-OFF
    // turn is byte-for-byte the legacy path.
    computeBranch(conversationId, options),
    // Resolve system prompt (conversation > project > global)
    (async () => {
      if (options.system) return options.system;
      if (options.projectId) return resolveSystemPrompt(conversationId, options.projectId, options.modeId);
      return undefined;
    })(),
  ]);

  // Rehydrate past-turn attachments into history so images uploaded on
  // earlier turns (and their `ez-attachment://` handles) remain visible +
  // resolvable on the current turn. Server-only code path — storagePath
  // never leaks past the pi-ai call below.
  const { loadPastAttachments, rehydrateUserMessageContent } =
    await import("../../chat/attachments/history-rehydrate");
  const pastCaps = options.provider && options.model
    ? (await import("../../providers/model-capabilities")).getCapabilities(options.provider, options.model)
    : null;
  const { byMessage: pastByMessage, all: allPastAttachments } = pastCaps
    ? await loadPastAttachments(branchMessages).catch(() => ({ byMessage: new Map(), all: [] }))
    : { byMessage: new Map(), all: [] };

  // Tool-generated images persisted to `/api/ext-files/…` URLs in prior
  // assistant text need their bytes replayed on subsequent turns so the
  // model can describe/edit them. pi-ai's AssistantMessage content can't
  // carry image parts, so we attach each assistant message's resolved
  // images to the *next* user message in the branch.
  //
  // Walk newest → oldest, counting images + bytes. Stop when either cap
  // is hit. Prefers recency (the "edit the image you just made" flow)
  // while still including older images if they fit under the caps.
  const supportsImageInput = pastCaps?.kinds.includes("image") === true;
  const injectedImages = new Map<number, Array<{ type: "image"; data: string; mimeType: string }>>();
  if (supportsImageInput) {
    await collectRehydratedImages(branchMessages, injectedImages);
  } else {
    // Surface the gate state so "no image in context" mysteries are
    // one grep away from the answer. If this fires unexpectedly, check
    // that the provider+model registration carries input:["text","image"].
    log.info("skipped: model lacks image input capability", {
      provider: options.provider,
      model: options.model,
      kinds: pastCaps?.kinds,
      branchLen: branchMessages.length,
    });
  }

  // Map each branch row to a pi-ai message OR null. `null` means the row
  // is intentionally absent from the LLM-visible history. The post-map
  // filter strips nulls.
  //
  // Only `user` and `assistant` rows are turns. Every other role is a
  // UI-only synthetic row: `ez-action-result` / `preprocess-result` /
  // `capability-event` JSON cards and `extension` tool-card headers (see
  // the role list on `messages.role` in src/db/schema.ts). The downstream
  // `convertToLlm` filter in build-pi-agent.ts only sees the POST-mapping
  // role, so a synthetic row mapped to `"user"` would leak into the prompt
  // as a fake user turn. Filter at the source — by allowlist, so a new
  // synthetic role is excluded by default. (The CURRENT turn's preprocess
  // result is grounded via a system note added in setup-tools.)
  const mapped = await Promise.all(branchMessages.map(async (m, idx): Promise<Message | null> => {
    if (m.role !== "user" && m.role !== "assistant") return null;
    if (m.role === "assistant") {
      return {
        role: "assistant" as const,
        // pi-ai's `Api` is `KnownApi | (string & {})` — "unknown" fits the
        // branded-string escape hatch without needing a cast. Used for
        // rehydrated history turns where we never had the original api name.
        content: [{ type: "text" as const, text: m.content }],
        api: "unknown",
        provider: "unknown",
        model: "unknown",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop" as const,
        timestamp: Date.now(),
      } satisfies AssistantMessage;
    }
    const attsForMsg = pastByMessage.get(m.id) ?? [];
    const injected = injectedImages.get(idx) ?? [];
    let content: string | import("../../chat/attachments/content-builder").PiContentPart[] = pastCaps
      ? await rehydrateUserMessageContent(m.content, attsForMsg, pastCaps)
      : m.content;
    if (injected.length > 0) {
      // Lift plain-string content into a parts array so we can append the
      // injected images without losing the user's typed text.
      const base: import("../../chat/attachments/content-builder").PiContentPart[] =
        typeof content === "string" ? [{ type: "text", text: content }] : content;
      content = [...base, ...injected];
    }
    return {
      role: "user" as const,
      content,
      timestamp: Date.now(),
    } satisfies UserMessage;
  }));
  const history: Message[] = mapped.filter((m): m is Message => m !== null);

  // System prompt lives on the per-call context so the memory/KB injection
  // closure (in the parallel Promise.all below) and the orchestrator-prompt
  // rewrites further down can both mutate it without threading it as a param.
  ctx.system = resolvedSystem;

  return { history, allPastAttachments };
}
