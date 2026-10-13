/**
 * Dual-lane LLM runner for topic contexts.
 *
 *  - SIDECAR lane: a raw `fetch` to an OpenAI-compatible `/v1/chat/completions`
 *    endpoint via the shared `../providers/openai-compat-client` (also used by
 *    `src/suggest/enhance.ts`). When a JSON schema is supplied it is sent as
 *    `response_format: json_schema` (Ollama ≥0.5 / llama.cpp translate this
 *    to GBNF — grammar-constrained decoding, the accuracy backbone on small
 *    models) with a no-schema retry for servers that reject `response_format`.
 *    pi-ai does NOT pass grammar through, which is why detection cannot use
 *    the pi lane for its constrained pass.
 *  - PI lane: `completeLLM` (credentials + OAuth model swap). pi-ai reports
 *    provider failures as RESULT FIELDS (`stopReason: "error"` +
 *    `errorMessage`), not throws — without that check a failed call has an
 *    empty content array and would look like a blank success (the exact bug
 *    `summarize_conversation`'s `defaultSummarize` guards against).
 *
 * The runner returns the raw model text; JSON parsing / `<think>` stripping
 * live in detect.ts / extract.ts. `fetchFn` / `completeFn` are injectable so
 * every branch is unit-testable with no network.
 */

import { requestOpenAICompatCompletion } from "../providers/openai-compat-client";
import type { ContextsTarget } from "./config";

/** Default completion timeout — a slow local model on a long transcript can
 *  legitimately run well past a chat turn's watchdog. */
export const DEFAULT_CONTEXTS_TIMEOUT_MS = 120_000;

export interface ContextsCompletionRequest {
  target: ContextsTarget;
  systemPrompt: string;
  userPrompt: string;
  /** JSON schema for grammar-constrained decoding (detection). Omit for the
   *  plain-markdown extraction pass. Only the sidecar lane enforces it. */
  schema?: Record<string, unknown>;
  schemaName?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Threaded into completeLLM so credential resolution honors the
   *  conversation's access-mode override (pi lane only). */
  conversationId?: string;
}

export interface ContextsCompletionDeps {
  fetchFn?: typeof fetch;
  // Single line: a multi-line arrow-type signature makes Bun's coverage
  // instrumenter attribute the wrapping lines as uncovered "statements"
  // (they carry no runtime code), dropping this file below its 100% line
  // threshold on the merged host-pool run.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // biome-ignore lint/suspicious/noExplicitAny: a test seam for pi-ai's `completeLLM`, whose model/context/result types are the provider-generic pi-ai ones (see AnyModel). Must stay ONE line — a multi-line arrow type makes Bun's coverage instrumenter attribute the wrapping lines as uncovered statements and drops this file below its 100% threshold.
  completeFn?: (piModel: any, context: any, opts?: { conversationId?: string; signal?: AbortSignal; maxTokens?: number; temperature?: number }) => Promise<any>;
  /** Arm the pi-lane timeout; returns its cancel. Defaults to setTimeout.
   *  Tests inject a fake so they fire the timeout without waiting. */
  scheduleTimeout?: (onTimeout: () => void, ms: number) => () => void;
}

const defaultScheduleTimeout: NonNullable<ContextsCompletionDeps["scheduleTimeout"]> = (onTimeout, ms) => {
  const timer = setTimeout(onTimeout, ms);
  return () => clearTimeout(timer);
};

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

async function runSidecar(
  target: Extract<ContextsTarget, { kind: "sidecar" }>,
  req: ContextsCompletionRequest,
  fetchFn: typeof fetch,
): Promise<string> {
  const res = await requestOpenAICompatCompletion({
    baseUrl: target.baseUrl,
    model: target.model,
    systemPrompt: req.systemPrompt,
    userPrompt: req.userPrompt,
    temperature: req.temperature ?? 0.2,
    maxTokens: req.maxTokens ?? 2_000,
    timeoutMs: req.timeoutMs ?? DEFAULT_CONTEXTS_TIMEOUT_MS,
    schema: req.schema ? { name: req.schemaName ?? "contexts_output", schema: req.schema } : undefined,
    fetchFn,
  });
  if (!res.ok) {
    throw new Error(`contexts sidecar completion failed (HTTP ${res.status})`);
  }
  const payload = (await res.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("contexts sidecar returned empty content");
  }
  return content;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// biome-ignore lint/suspicious/noExplicitAny: an assistant message's `content`, which pi-ai types per provider API; this reads only the text parts and guards every access, so narrowing it would require naming every provider's content union.
function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
  }
  return String(content ?? "");
}

async function runPi(
  target: Extract<ContextsTarget, { kind: "pi" }>,
  req: ContextsCompletionRequest,
  completeFn: NonNullable<ContextsCompletionDeps["completeFn"]>,
  scheduleTimeout: NonNullable<ContextsCompletionDeps["scheduleTimeout"]>,
): Promise<string> {
  // Same bound as the sidecar lane: a stuck provider must not hold the
  // request open forever.
  const timeoutMs = req.timeoutMs ?? DEFAULT_CONTEXTS_TIMEOUT_MS;
  const controller = new AbortController();
  const cancelTimeout = scheduleTimeout(() => controller.abort(), timeoutMs);
  let result: Awaited<ReturnType<typeof completeFn>> | undefined;
  try {
    result = await completeFn(
      target.piModel,
      {
        systemPrompt: req.systemPrompt,
        messages: [{ role: "user", content: req.userPrompt }],
      },
      { conversationId: req.conversationId, signal: controller.signal, maxTokens: req.maxTokens, temperature: req.temperature },
    );
  } catch (err) {
    if (!controller.signal.aborted) throw err;
  } finally {
    cancelTimeout();
  }
  // An abort can surface as a throw (caught above) or, from pi-ai, as a
  // result field — both mean the timeout fired.
  if (controller.signal.aborted) throw new Error(`contexts model call timed out after ${timeoutMs}ms`);
  // pi-ai reports provider failures as result fields, not throws.
  if (result?.stopReason === "error") {
    throw new Error(result.errorMessage || "contexts model call failed with no error message");
  }
  const text = extractText(result?.content);
  if (!text.trim()) {
    throw new Error(`contexts model returned no text (stopReason: ${String(result?.stopReason ?? "unknown")})`);
  }
  return text;
}

/** Default pi-lane completer — routes through the project's credential-aware
 *  `completeLLM` (which applies the OAuth model swap). */
const defaultCompleteFn: NonNullable<ContextsCompletionDeps["completeFn"]> = async (
  piModel,
  context,
  opts,
) => {
  const { completeLLM } = await import("../providers/llm");
  return completeLLM(piModel, context, opts);
};

/**
 * Run a contexts completion on whichever lane the resolved target selects.
 * Returns the raw model text (caller parses). Throws on transport failure,
 * an empty response, or a pi-lane provider error surfaced as result fields.
 */
export async function runContextsCompletion(
  req: ContextsCompletionRequest,
  deps: ContextsCompletionDeps = {},
): Promise<string> {
  if (req.target.kind === "sidecar") {
    return runSidecar(req.target, req, deps.fetchFn ?? fetch);
  }
  return runPi(req.target, req, deps.completeFn ?? defaultCompleteFn, deps.scheduleTimeout ?? defaultScheduleTimeout);
}
