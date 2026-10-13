/**
 * Unit tests for `src/contexts/llm.ts` — the dual-lane completion runner.
 *
 * All lanes exercised with injected `fetchFn` / `completeFn` (no network).
 */
import { test, expect, describe } from "bun:test";
import {
  runContextsCompletion,
  DEFAULT_CONTEXTS_TIMEOUT_MS,
  type ContextsCompletionRequest,
} from "../contexts/llm";
import type { ContextsTarget } from "../contexts/config";

const sidecarTarget: ContextsTarget = { kind: "sidecar", baseUrl: "http://local:11434/v1", model: "qwen3:1.7b" };
const piTarget: ContextsTarget = { kind: "pi", provider: "anthropic", modelId: "claude-x", piModel: { id: "claude-x" } };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function sidecarReq(overrides: Partial<ContextsCompletionRequest> = {}): ContextsCompletionRequest {
  return {
    target: sidecarTarget,
    systemPrompt: "sys",
    userPrompt: "user",
    schema: { type: "object" },
    schemaName: "topic_detection",
    ...overrides,
  };
}

describe("sidecar lane", () => {
  test("happy path sends json_schema, normalizes the /v1 baseUrl, returns content", async () => {
    let capturedUrl = "";
    let capturedBody: any;
    const fetchFn = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return jsonResponse({ choices: [{ message: { content: "hello" } }] });
    }) as unknown as typeof fetch;

    const out = await runContextsCompletion(sidecarReq(), { fetchFn });
    expect(out).toBe("hello");
    // trailing /v1 stripped then re-appended → exactly one /v1
    expect(capturedUrl).toBe("http://local:11434/v1/chat/completions");
    expect(capturedBody.model).toBe("qwen3:1.7b");
    expect(capturedBody.response_format.type).toBe("json_schema");
    expect(capturedBody.response_format.json_schema.name).toBe("topic_detection");
    expect(capturedBody.response_format.json_schema.strict).toBe(true);
  });

  test("non-OK with schema → retries WITHOUT response_format, then succeeds", async () => {
    const calls: any[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      calls.push(body);
      if (calls.length === 1) return jsonResponse({}, false, 400);
      return jsonResponse({ choices: [{ message: { content: "recovered" } }] });
    }) as unknown as typeof fetch;

    const out = await runContextsCompletion(sidecarReq(), { fetchFn });
    expect(out).toBe("recovered");
    expect(calls).toHaveLength(2);
    expect(calls[0].response_format).toBeDefined();
    expect(calls[1].response_format).toBeUndefined(); // retry dropped the schema
  });

  test("retry also fails → throws with the HTTP status", async () => {
    const fetchFn = (async () => jsonResponse({}, false, 503)) as unknown as typeof fetch;
    await expect(runContextsCompletion(sidecarReq(), { fetchFn })).rejects.toThrow(/HTTP 503/);
  });

  test("no-schema request (extraction) makes a single call, no retry", async () => {
    let count = 0;
    const fetchFn = (async () => {
      count++;
      return jsonResponse({ choices: [{ message: { content: "# md" } }] });
    }) as unknown as typeof fetch;
    const out = await runContextsCompletion(sidecarReq({ schema: undefined }), { fetchFn });
    expect(out).toBe("# md");
    expect(count).toBe(1);
  });

  test("empty / non-string content → throws", async () => {
    const empty = (async () => jsonResponse({ choices: [{ message: { content: "   " } }] })) as unknown as typeof fetch;
    await expect(runContextsCompletion(sidecarReq(), { fetchFn: empty })).rejects.toThrow(/empty content/);
    const missing = (async () => jsonResponse({ choices: [{}] })) as unknown as typeof fetch;
    await expect(runContextsCompletion(sidecarReq(), { fetchFn: missing })).rejects.toThrow(/empty content/);
  });

  test("fetch rejection (abort/timeout) propagates", async () => {
    const fetchFn = (async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(runContextsCompletion(sidecarReq(), { fetchFn })).rejects.toThrow(/timed out/);
  });

  test("passes the abort signal with the requested timeout", async () => {
    let sawSignal = false;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sawSignal = init.signal instanceof AbortSignal;
      return jsonResponse({ choices: [{ message: { content: "x" } }] });
    }) as unknown as typeof fetch;
    await runContextsCompletion(sidecarReq({ timeoutMs: DEFAULT_CONTEXTS_TIMEOUT_MS }), { fetchFn });
    expect(sawSignal).toBe(true);
  });
});

describe("pi lane", () => {
  test("happy path: string content", async () => {
    const completeFn = async (piModel: any, ctx: any, opts: any) => {
      expect(piModel).toEqual({ id: "claude-x" });
      expect(ctx.systemPrompt).toBe("sys");
      expect(ctx.messages[0].content).toBe("user");
      expect(opts.conversationId).toBe("conv-1");
      return { stopReason: "stop", content: "plain text" };
    };
    const out = await runContextsCompletion(
      { target: piTarget, systemPrompt: "sys", userPrompt: "user", conversationId: "conv-1" },
      { completeFn },
    );
    expect(out).toBe("plain text");
  });

  test("happy path: array content joins text parts", async () => {
    const completeFn = async () => ({
      stopReason: "stop",
      content: [
        { type: "text", text: "a" },
        { type: "tool_use", id: "x" },
        { type: "text", text: "b" },
      ],
    });
    const out = await runContextsCompletion(
      { target: piTarget, systemPrompt: "s", userPrompt: "u" },
      { completeFn },
    );
    expect(out).toBe("ab");
  });

  test("stopReason 'error' → throws with errorMessage", async () => {
    const completeFn = async () => ({ stopReason: "error", errorMessage: "provider 500", content: [] });
    await expect(
      runContextsCompletion({ target: piTarget, systemPrompt: "s", userPrompt: "u" }, { completeFn }),
    ).rejects.toThrow("provider 500");
  });

  test("stopReason 'error' with no message → generic throw", async () => {
    const completeFn = async () => ({ stopReason: "error", content: [] });
    await expect(
      runContextsCompletion({ target: piTarget, systemPrompt: "s", userPrompt: "u" }, { completeFn }),
    ).rejects.toThrow(/no error message/);
  });

  test("empty content (undefined) → throws no-text", async () => {
    const completeFn = async () => ({ stopReason: "stop", content: undefined });
    await expect(
      runContextsCompletion({ target: piTarget, systemPrompt: "s", userPrompt: "u" }, { completeFn }),
    ).rejects.toThrow(/no text/);
  });

  test("passes maxTokens, temperature, and an abort signal to the model call", async () => {
    let seen: any;
    const completeFn = async (_m: any, _c: any, opts: any) => {
      seen = opts;
      return { stopReason: "stop", content: "ok" };
    };
    let cancelled = false;
    await runContextsCompletion(
      { target: piTarget, systemPrompt: "s", userPrompt: "u", maxTokens: 4_000, temperature: 0.1 },
      { completeFn, scheduleTimeout: () => () => { cancelled = true; } },
    );
    expect(seen.maxTokens).toBe(4_000);
    expect(seen.temperature).toBe(0.1);
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(seen.signal.aborted).toBe(false);
    // A call that finished must not leave its timer armed.
    expect(cancelled).toBe(true);
  });

  test("a hanging call is aborted when the timeout fires", async () => {
    let fire: (() => void) | undefined;
    let armedMs = 0;
    const scheduleTimeout = (onTimeout: () => void, ms: number) => {
      fire = onTimeout;
      armedMs = ms;
      return () => {};
    };
    // Never settles on its own — only the abort signal ends it, the way a
    // stuck provider stream ends.
    const completeFn = (_m: any, _c: any, opts: any) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const pending = runContextsCompletion(
      { target: piTarget, systemPrompt: "s", userPrompt: "u", timeoutMs: 5_000 },
      { completeFn, scheduleTimeout },
    );
    expect(armedMs).toBe(5_000);
    fire!();
    await expect(pending).rejects.toThrow("contexts model call timed out after 5000ms");
  });

  test("a model-call throw that is not a timeout propagates unchanged", async () => {
    const completeFn = async () => { throw new Error("credential missing"); };
    await expect(
      runContextsCompletion({ target: piTarget, systemPrompt: "s", userPrompt: "u" }, { completeFn }),
    ).rejects.toThrow("credential missing");
  });

  test("the timeout defaults to DEFAULT_CONTEXTS_TIMEOUT_MS", async () => {
    let armedMs = 0;
    await runContextsCompletion(
      { target: piTarget, systemPrompt: "s", userPrompt: "u" },
      {
        completeFn: async () => ({ stopReason: "stop", content: "ok" }),
        scheduleTimeout: (_fn, ms) => { armedMs = ms; return () => {}; },
      },
    );
    expect(armedMs).toBe(DEFAULT_CONTEXTS_TIMEOUT_MS);
  });
});
