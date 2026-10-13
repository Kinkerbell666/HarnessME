/**
 * Thin wrapper around pi-ai stream()/complete() with credential resolution.
 * Replaces ~500 lines of hand-rolled HTTP/SSE code with pi-ai calls.
 *
 * Both entry points apply the OAuth model swap (resolveModelForCredential):
 * when the resolved credential is an OAuth token, the standard API-key
 * endpoint model is exchanged for its subscription-eligible sibling
 * (e.g. openai → openai-codex backend). Without the swap a ChatGPT-plan
 * token 401s api.openai.com ("Missing scopes: api.responses.write") and
 * callers get an error result with empty content — the exact failure the
 * Ez summarize_conversation tool used to surface as a blank summary.
 */

import { stream, complete } from "@earendil-works/pi-ai/compat";
import type {
  Api,
  Model,
  Context,
  AssistantMessage,
  AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { authCallOptions, getCredential } from "./credentials";
import { resolveModelForCredential } from "./registry";

// Re-export for downstream usage
export type { AssistantMessageEventStream };

export async function streamLLM(
  model: Model<Api>,
  context: Context,
  opts?: { signal?: AbortSignal; conversationId?: string },
): Promise<AssistantMessageEventStream> {
  const cred = await getCredential(model.provider, opts?.conversationId);
  return stream(resolveModelForCredential(model, model.provider, cred.type), context, {
    ...authCallOptions(cred.token),
    signal: opts?.signal,
  });
}

export async function completeLLM(
  model: Model<Api>,
  context: Context,
  opts?: { conversationId?: string; signal?: AbortSignal; maxTokens?: number; temperature?: number },
): Promise<AssistantMessage> {
  const cred = await getCredential(model.provider, opts?.conversationId);
  return complete(resolveModelForCredential(model, model.provider, cred.type), context, {
    ...authCallOptions(cred.token),
    signal: opts?.signal,
    maxTokens: opts?.maxTokens,
    temperature: opts?.temperature,
  });
}
