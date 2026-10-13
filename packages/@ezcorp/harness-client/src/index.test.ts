/**
 * Tests for @ezcorp/harness-client: pure SSE decoding, the event-name
 * parity guard against the app's canonical list, and the HTTP/SSE client
 * driven against a live fake server.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HarnessClient, HarnessApiError, SseDataBuffer, RUNTIME_EVENT_NAMES, HARNESS_ROUTES, buildPath, type CallerToolCall } from "./index";
// The app's canonical list — must stay identical to the package's copy.
import { RUNTIME_EVENT_NAMES as APP_EVENT_NAMES } from "../../../../web/src/lib/runtime-event-names";
import { referenceCodeV1 } from "@ezcorp/factory-sdk";

describe("SseDataBuffer", () => {
  test("splits records and skips comments/heartbeats", () => {
    const b = new SseDataBuffer();
    expect(b.push(": connected\n\n")).toEqual([]);
    expect(b.push('data: {"type":"run:start"}\n\n')).toEqual(['{"type":"run:start"}']);
    expect(b.push(": heartbeat\n\n")).toEqual([]);
  });

  test("buffers across chunk boundaries", () => {
    const b = new SseDataBuffer();
    expect(b.push("data: hel")).toEqual([]);
    expect(b.push("lo\n")).toEqual([]);
    expect(b.push("\n")).toEqual(["hello"]);
  });

  test("joins multi-line data fields", () => {
    const b = new SseDataBuffer();
    expect(b.push("data: a\ndata: b\n\n")).toEqual(["a\nb"]);
  });
});

test("factory authoring client sends encoded paths, queries, and mutation preconditions", async () => {
  const requests: Request[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(input.toString(), init);
    requests.push(request);
    return Response.json({ schemaVersion: "factory.api.response.v1", kind: "draft.validation", valid: true, diagnostics: [] });
  }) as unknown as typeof fetch;
  const factory = new HarnessClient({ baseUrl: "http://factory.test/", apiKey: "ezk_factory", fetch: fetcher });
  await factory.listFactoryDefinitions("project/one", { limit: 2, archived: false, availability: "available" });
  await factory.createFactoryDraft("project/one", referenceCodeV1, "create-key");
  await factory.importFactoryDraft("project/one", "yaml", "schemaVersion: factory.v1", "import-key");
  await factory.getFactoryDraft("project/one", "factory/one");
  await factory.updateFactoryDraft("project/one", "factory/one", referenceCodeV1, 1, "update-key");
  await factory.archiveFactoryDraft("project/one", "factory/one", 2, "archive-key");
  await factory.exportFactoryDraft("project/one", "factory/one", "json");
  await factory.validateFactoryDraft("project/one", "factory/one", referenceCodeV1);
  await factory.listFactoryVersions("project/one", "factory/one", {});
  await factory.getFactoryVersion("project/one", "factory/one", "1/0");
  await factory.listFactoryGrants("project/one", { principalKind: "service", action: "factory.run" });

  expect(requests).toHaveLength(11);
  expect(new URL(requests[0]!.url).pathname).toBe("/api/factories/projects/project%2Fone/definitions");
  expect(new URL(requests[0]!.url).searchParams.get("archived")).toBe("false");
  expect(requests[1]!.headers.get("If-Match")).toBe("0");
  expect(requests[1]!.headers.get("Idempotency-Key")).toBe("create-key");
  expect(await requests[1]!.clone().json()).toEqual({ source: referenceCodeV1 });
  expect(requests[5]!.method).toBe("DELETE");
  expect(requests[5]!.headers.get("If-Match")).toBe("2");
  expect(new URL(requests[8]!.url).search).toBe("");
  expect(new URL(requests[9]!.url).pathname).toEndWith("/versions/1%2F0");
  expect(new URL(requests[10]!.url).searchParams.get("action")).toBe("factory.run");
  const runBody = { factoryVersion: "1", definitionDigest: `sha256:${"a".repeat(64)}`, grantRevision: 1, parameters: {} };
  await factory.startFactoryRun("project/one", "factory/one", runBody, "start-key");
  await factory.listFactoryRuns("project/one", { factoryId: "factory/one", status: "waiting", limit: 2 });
  await factory.listFactoryRuns("project/one");
  await factory.getFactoryRun("project/one", "run/one");
  await factory.controlFactoryRun("project/one", "run/one", { action: "cancel" }, 2, "cancel-key");
  await factory.getFactoryCommand("project/one", "run/one", "command/one");
  expect(requests[11]!.headers.get("If-Match")).toBe("0");
  expect(requests[11]!.headers.get("Idempotency-Key")).toBe("start-key");
  expect(new URL(requests[12]!.url).searchParams.get("status")).toBe("waiting");
  expect(requests[15]!.headers.get("If-Match")).toBe("2");
  expect(new URL(requests[16]!.url).pathname).toContain("/runs/run%2Fone/commands/command%2Fone");
  expect(requests.every(request => request.headers.get("Authorization") === "Bearer ezk_factory")).toBe(true);
});

test("extension control exposes the shared lifecycle without a key-based approval method", async () => {
  const input = { action: "create", name: "test" };
  type Echo = { tool: string; input: Record<string, unknown> };
  expect(await client().extensionControl<Echo>("extensions_workspace", input)).toEqual({ tool: "extensions_workspace", input });
  expect(await client().extensionControl<Echo>("extensions_describe")).toEqual({ tool: "extensions_describe", input: {} });
});

describe("event-name parity with the app", () => {
  test("package list === app list (no drift)", () => {
    expect([...RUNTIME_EVENT_NAMES]).toEqual([...APP_EVENT_NAMES]);
  });
});

// ── Live fake server ───────────────────────────────────────────────────
let server: ReturnType<typeof Bun.serve>;
let lastAuth: string | null = null;
let lastUrl: string | null = null;
let lastConversationBody: Record<string, unknown> | null = null;
let lastUpdateConversationBody: Record<string, unknown> | null = null;
let lastMintBody: Record<string, unknown> | null = null;
let scripted: { scriptKey: string; turns: unknown[] } | null = null;
let lastWireBody: Record<string, unknown> | null = null;
let lastRewindBody: Record<string, unknown> | null = null;
let lastRetryBody: Record<string, unknown> | null = null;
let lastRetryPath: string | null = null;
let lastToolInvoke: Record<string, unknown> | null = null;
// Extension-lifecycle + hub-action capture (Track 3 surface).
let lastInstallBody: Record<string, unknown> | null = null;
let lastActivateBody: Record<string, unknown> | null = null;
let lastPatchBody: Record<string, unknown> | null = null;
let lastPermissionsBody: Record<string, unknown> | null = null;
let lastSecretBody: Record<string, unknown> | null = null;
let lastHubActionBody: Record<string, unknown> | null = null;
// Toggles the shape GET /api/extensions returns so both the bare-array and
// `{ extensions }` normalization branches are exercised.
let extListShape: "array" | "wrapper" | "other" = "array";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      lastAuth = req.headers.get("authorization");
      lastUrl = req.url;
      const p = url.pathname;
      if (req.method === "POST" && p === "/api/extensions/control") return Response.json(await req.json());
      if (req.method === "POST" && p === "/api/conversations") {
        lastConversationBody = (await req.json()) as Record<string, unknown>;
        return Response.json({ id: "c1" });
      }
      if (req.method === "PUT" && /^\/api\/conversations\/[^/]+$/.test(p)) {
        lastUpdateConversationBody = (await req.json()) as Record<string, unknown>;
        return Response.json({ id: p.split("/").pop(), ...lastUpdateConversationBody });
      }
      if (req.method === "POST" && p === "/api/settings/developer/api-keys") {
        lastMintBody = (await req.json()) as Record<string, unknown>;
        return Response.json(
          { key: "ezk_child", keyId: "k-child", ...lastMintBody },
          { status: 201 },
        );
      }
      // Capture-only route: echoes the raw path so encoding can be asserted.
      if (req.method === "GET" && p.startsWith("/api/runs/")) {
        if (url.searchParams.get("wait") === "1" && p !== "/api/runs/r1") {
          return Response.json({ outcome: "complete", run: { id: "x", status: "success" } });
        }
        if (p !== "/api/runs/r1") return Response.json({ id: "captured", status: "running" });
      }
      // Redirect route: a 3xx the client must refuse to follow. The target is
      // a REACHABLE same-origin route (not an unresolvable host) on purpose —
      // an unreachable target would throw either way (redirect refused, or
      // redirect followed then DNS fails), which proves nothing. Pointing at
      // a live route means the test only passes if the redirect is actually
      // refused; if it were followed, the call would succeed with { value: 7 }.
      if (req.method === "GET" && p === "/api/settings/redirect") {
        return new Response(null, { status: 302, headers: { Location: "/api/settings/k" } });
      }
      if (req.method === "POST" && p === "/api/conversations/c1/messages") {
        return Response.json({ userMessage: { id: "m1" }, runId: "r1" });
      }
      // ── Sessions P4 rewind/checkpoint surface ──
      if (req.method === "GET" && /^\/api\/conversations\/[^/]+\/tree$/.test(p)) {
        if (p === "/api/conversations/off/tree") {
          return Response.json({ error: "Session history producer is disabled", code: "session_producer_disabled" }, { status: 409 });
        }
        return Response.json({
          conversationId: p.split("/")[3],
          currentLeaf: "a1",
          nodes: [{ id: "a1", parentId: null, role: "assistant", excluded: false, createdAt: "t" }],
        });
      }
      if (req.method === "POST" && /^\/api\/conversations\/[^/]+\/rewind$/.test(p)) {
        lastRewindBody = (await req.json()) as Record<string, unknown>;
        return Response.json({ conversationId: p.split("/")[3], currentLeaf: lastRewindBody.targetMessageId, nodes: [] });
      }
      // ── Sessions P5 clean A/B retry surface ──
      if (req.method === "POST" && /^\/api\/conversations\/[^/]+\/messages\/[^/]+\/retry$/.test(p)) {
        lastRetryPath = p;
        lastRetryBody = (await req.json()) as Record<string, unknown>;
        return Response.json({ userMessage: { id: "u1" }, retriedMessageId: p.split("/")[5], runId: "r-retry" });
      }
      // ── Extension control surface ──
      if (req.method === "GET" && p === "/api/extensions") {
        if (extListShape === "array") return Response.json([{ id: "e1", name: "scratchpad" }]);
        if (extListShape === "wrapper") return Response.json({ extensions: [{ id: "e2", name: "task-tracking" }] });
        return Response.json({ note: "neither array nor wrapper" });
      }
      if (p.startsWith("/api/conversations/") && p.endsWith("/extensions")) {
        if (req.method === "POST") {
          lastWireBody = (await req.json()) as Record<string, unknown>;
          if (p === "/api/conversations/forbidden/extensions") {
            return Response.json({ error: "Insufficient scope", required: "extensions" }, { status: 403 });
          }
          const names = (lastWireBody.names as string[]) ?? [];
          const unknown = names.filter((n) => n === "ghost");
          if (unknown.length > 0) {
            return Response.json({ error: "Unknown extension(s)", unknown }, { status: 404 });
          }
          return Response.json({ wired: names, extensionIds: names.map((n) => `id-${n}`) });
        }
        if (req.method === "GET") {
          return Response.json({ extensions: [{ id: "e1", name: "scratchpad" }] });
        }
      }
      if (req.method === "POST" && p === "/api/tool-invoke") {
        lastToolInvoke = (await req.json()) as Record<string, unknown>;
        if (lastToolInvoke.extensionName === "denied") {
          return Response.json({ error: "Insufficient scope", required: "extensions" }, { status: 403 });
        }
        // A tool-level failure is HTTP 200 with { success: false } — the client
        // must RESOLVE with it, not throw.
        if (lastToolInvoke.extensionName === "failing") {
          return Response.json({ success: false, error: "boom", toolCallId: lastToolInvoke.invocationId });
        }
        return Response.json({ success: true, output: `${lastToolInvoke.toolName}:ok`, toolCallId: lastToolInvoke.invocationId });
      }
      // ── Extension lifecycle surface (Track 3) ──
      if (req.method === "POST" && p === "/api/extensions") {
        lastInstallBody = (await req.json()) as Record<string, unknown>;
        return Response.json({ id: "ext-new", name: "installed-ext", enabled: false }, { status: 201 });
      }
      if (req.method === "POST" && /^\/api\/extensions\/[^/]+\/activate$/.test(p)) {
        lastActivateBody = (await req.json()) as Record<string, unknown>;
        return Response.json({ id: p.split("/")[3], name: "installed-ext", enabled: true });
      }
      if (req.method === "PUT" && /^\/api\/extensions\/[^/]+\/permissions$/.test(p)) {
        lastPermissionsBody = (await req.json()) as Record<string, unknown>;
        return Response.json({
          id: p.split("/")[3],
          name: "installed-ext",
          grantedPermissions: lastPermissionsBody.permissions,
        });
      }
      if (/^\/api\/extensions\/[^/]+\/secrets$/.test(p)) {
        const body = (await req.json()) as Record<string, unknown>;
        if (req.method === "POST") {
          lastSecretBody = body;
          // id "denied" models a per-extension RBAC refusal.
          if (p === "/api/extensions/denied/secrets") {
            return Response.json({ error: "Missing extension scope 'secrets' for denied" }, { status: 403 });
          }
          return Response.json({ ok: true });
        }
        if (req.method === "DELETE") {
          lastSecretBody = body;
          return Response.json({ deleted: body.name === "known" });
        }
      }
      if (/^\/api\/extensions\/[^/]+$/.test(p) && req.method !== "GET") {
        if (req.method === "PATCH") {
          lastPatchBody = (await req.json()) as Record<string, unknown>;
          if (lastPatchBody.enabled === true) {
            return Response.json({ error: "Use POST /:id/activate to enable an extension" }, { status: 400 });
          }
          return Response.json({ id: p.split("/")[3], name: "installed-ext", enabled: false });
        }
        if (req.method === "DELETE") {
          // Uninstall: 204 No Content, empty body.
          return new Response(null, { status: 204 });
        }
      }
      // ── Hub actions (Track 3) ──
      if (req.method === "POST" && /^\/api\/hub\/pages\/[^/]+\/actions\/[^/]+$/.test(p)) {
        lastHubActionBody = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const action = p.split("/")[6];
        if (action === "refresh") {
          return Response.json({ ok: true, page: { type: "root", children: [] }, renderedAt: 123 });
        }
        return Response.json({ ok: true });
      }
      // ── Cancel run (Track 3) ──
      if (req.method === "DELETE" && p.startsWith("/api/runs/")) {
        if (p === "/api/runs/r1") return Response.json({ ok: true });
        return Response.json({ error: "Run not found or not running" }, { status: 404 });
      }
      if (req.method === "GET" && p === "/api/runs/r1" && url.searchParams.get("wait") === "1") {
        return Response.json({ outcome: "complete", run: { id: "r1", status: "success", result: { output: "done" } } });
      }
      if (req.method === "POST" && p === "/api/__test/mock-llm/script") {
        scripted = (await req.json()) as typeof scripted;
        return Response.json({ ok: true }, { status: 201 });
      }
      if (req.method === "PUT" && p === "/api/settings/foo") return Response.json({ ok: true });
      if (req.method === "GET" && p === "/api/settings/k") return Response.json({ value: 7 });
      if (req.method === "GET" && p === "/api/settings/missing") {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      if (req.method === "GET" && p === "/api/runs/r1") {
        return Response.json({ id: "r1", status: "running" });
      }
      if (req.method === "POST" && p === "/api/tool-calls/tc1/permission") {
        return Response.json({ ok: true });
      }
      if (req.method === "DELETE" && p === "/api/__test/mock-llm/script") {
        scripted = null;
        return Response.json({ ok: true });
      }
      // SSE redirect route: a 3xx the streamEvents path must refuse to
      // follow. Target is the real, reachable `/api/runtime-events` route
      // below (not an unresolvable host) — see the comment on the sibling
      // `/api/settings/redirect` route for why that matters.
      if (req.method === "GET" && p === "/api/runtime-events-redirect") {
        return new Response(null, { status: 302, headers: { Location: "/api/runtime-events" } });
      }
      if (req.method === "GET" && p === "/api/runtime-events") {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            const enc = new TextEncoder();
            c.enqueue(enc.encode(": connected\n\n"));
            c.enqueue(enc.encode('data: {"type":"run:start","data":{"runId":"r1"}}\n\n'));
            c.enqueue(enc.encode('data: {"type":"run:complete","data":{"runId":"r1"}}\n\n'));
            c.close();
          },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      }
      return new Response("nope", { status: 404 });
    },
  });
});
afterAll(() => server.stop(true));

function client(): HarnessClient {
  return new HarnessClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "ezk_test" });
}

describe("HarnessClient", () => {
  test("sends the bearer token", async () => {
    await client().createConversation();
    expect(lastAuth).toBe("Bearer ezk_test");
  });

  test("createConversation defaults projectId to the global project", async () => {
    await client().createConversation();
    expect(lastConversationBody).toEqual({ projectId: "global" });
    await client().createConversation({ title: "t" });
    expect(lastConversationBody).toEqual({ projectId: "global", title: "t" });
  });

  test("createConversation lets an explicit projectId win over the default", async () => {
    await client().createConversation({ projectId: "p-42" });
    expect(lastConversationBody).toEqual({ projectId: "p-42" });
  });

  test("configure: get/set settings", async () => {
    expect(await client().getSetting<{ value: number }>("k")).toEqual({ value: 7 });
    expect(await client().setSetting("foo", 1)).toEqual({ ok: true });
  });

  test("getRun (non-wait) returns the run row", async () => {
    expect(await client().getRun("r1")).toMatchObject({ id: "r1", status: "running" });
  });

  test("getConversationTree returns the tree; a UUID-ish id is path-encoded", async () => {
    const tree = await client().getConversationTree("c1");
    expect(tree).toMatchObject({ conversationId: "c1", currentLeaf: "a1" });
    expect(tree.nodes).toHaveLength(1);
  });

  test("getConversationTree throws HarnessApiError 409 when the flag is off", async () => {
    try {
      await client().getConversationTree("off");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HarnessApiError);
      expect((e as HarnessApiError).status).toBe(409);
      expect((e as HarnessApiError).body).toMatchObject({ code: "session_producer_disabled" });
    }
  });

  test("rewindConversation posts the target (+ optional summary) and returns the tree", async () => {
    const tree = await client().rewindConversation("c1", "m2", { summary: "went sideways" });
    expect(lastRewindBody).toEqual({ targetMessageId: "m2", summary: "went sideways" });
    expect(tree.currentLeaf).toBe("m2");
    // Omitting summary sends only targetMessageId (no undefined key).
    await client().rewindConversation("c1", "m3");
    expect(lastRewindBody).toEqual({ targetMessageId: "m3" });
  });

  test("retryMessage posts the clean-A/B path (mid in the URL) + optional overrides", async () => {
    const res = await client().retryMessage("c1", "a2", { provider: "openai", model: "gpt", thinkingLevel: "high" });
    expect(lastRetryPath).toBe("/api/conversations/c1/messages/a2/retry");
    expect(lastRetryBody).toEqual({ provider: "openai", model: "gpt", thinkingLevel: "high" });
    expect(res.retriedMessageId).toBe("a2");
    expect(res.runId).toBe("r-retry");
    // Omitting overrides sends an empty body (no undefined keys).
    await client().retryMessage("c1", "a3");
    expect(lastRetryBody).toEqual({});
  });

  test("retryMessage percent-encodes a traversal-ish message id into one segment", async () => {
    await client().retryMessage("c1", "../evil");
    expect(new URL(lastUrl!).pathname).toBe("/api/conversations/c1/messages/..%2Fevil/retry");
  });

  test("resolveToolPermission posts approval with scope", async () => {
    expect(await client().resolveToolPermission("tc1", true, { scope: "session" })).toEqual({ ok: true });
  });

  test("clearLlmScripts clears the mock scripts", async () => {
    await client().scriptLlm("k", [{ text: "x" }]);
    expect(scripted).not.toBeNull();
    await client().clearLlmScripts();
    expect(scripted).toBeNull();
  });

  test("runToCompletion drives a message and returns the terminal result", async () => {
    const r = await client().runToCompletion("c1", "hello");
    expect(r.outcome).toBe("complete");
    expect(r.run.id).toBe("r1");
  });

  test("runScripted seeds the mock then drives with the mock provider", async () => {
    const r = await client().runScripted("c1", "go", [{ text: "scripted reply" }], { scriptKey: "k1" });
    expect(scripted).toMatchObject({ scriptKey: "k1", turns: [{ text: "scripted reply" }] });
    expect(r.outcome).toBe("complete");
  });

  test("non-2xx throws HarnessApiError with status + parsed body", async () => {
    try {
      await client().getSetting("missing");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HarnessApiError);
      expect((e as HarnessApiError).status).toBe(404);
      expect((e as HarnessApiError).body).toMatchObject({ error: "not found" });
    }
  });

  test("percent-encodes ids with special chars in the request path", async () => {
    await client().getRun("../../etc/passwd");
    const u = new URL(lastUrl!);
    // The traversal stays a single encoded segment, not a path climb.
    expect(u.pathname).toBe("/api/runs/..%2F..%2Fetc%2Fpasswd");

    await client().getRun("r1?x=1&y=2");
    const u2 = new URL(lastUrl!);
    expect(u2.pathname).toBe("/api/runs/r1%3Fx%3D1%26y%3D2");
    // No injected query params leaked from the id.
    expect(u2.searchParams.get("x")).toBeNull();
    expect(u2.searchParams.get("y")).toBeNull();

    await client().getRun("a b#c");
    const u3 = new URL(lastUrl!);
    expect(u3.pathname).toBe("/api/runs/a%20b%23c");
    expect(u3.hash).toBe("");
  });

  test("encodes the wait-path runId without disturbing the query", async () => {
    await client().awaitRun("../evil", 5_000);
    const u = new URL(lastUrl!);
    expect(u.pathname).toBe("/api/runs/..%2Fevil");
    expect(u.searchParams.get("wait")).toBe("1");
    expect(u.searchParams.get("timeoutMs")).toBe("5000");
  });

  test("encodes conversationId and toolCallId path segments", async () => {
    await client().sendMessage("c/../x", "hi").catch(() => {});
    expect(new URL(lastUrl!).pathname).toBe("/api/conversations/c%2F..%2Fx/messages");

    await client().resolveToolPermission("tc/../1", true).catch(() => {});
    expect(new URL(lastUrl!).pathname).toBe("/api/tool-calls/tc%2F..%2F1/permission");
  });

  test("refuses to follow a redirect (no bearer-token replay)", async () => {
    let threw = false;
    try {
      // The target (`/api/settings/k`) is a real, reachable route — if the
      // redirect were followed instead of refused, this would resolve with
      // `{ value: 7 }` rather than throw. That's what makes this assertion
      // meaningful rather than trivially true.
      await client().getSetting("redirect");
    } catch (e) {
      threw = true;
      // fetch rejects under `redirect: "error"` (an Error, not a
      // TypeError, on Bun); it never surfaces as a HarnessApiError, which
      // would imply the redirect was followed and the response read.
      expect(e).not.toBeInstanceOf(HarnessApiError);
    }
    expect(threw).toBe(true);
  });

  test("streamEvents refuses to follow a redirect (no bearer-token replay)", async () => {
    // Point streamEvents' `/api/runtime-events` fetch at the 302 route via a
    // path-rewriting fetch wrapper. The 302 targets the real, reachable
    // `/api/runtime-events` route below — under `redirect: "error"` the SSE
    // fetch must still reject rather than transparently follow it and
    // establish the stream.
    // Cast to `typeof fetch`: the real type carries a `preconnect` member a
    // bare arrow can't satisfy (same shape the deliverHook stub uses).
    const redirectingFetch = ((input: string | URL | Request, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return fetch(u.replace("/api/runtime-events", "/api/runtime-events-redirect"), init);
    }) as unknown as typeof fetch;
    const c = new HarnessClient({
      baseUrl: `http://127.0.0.1:${server.port}`,
      apiKey: "ezk_test",
      fetch: redirectingFetch,
    });
    let threw = false;
    try {
      for await (const _ of c.streamEvents()) {
        // unreachable: the fetch itself must reject before yielding.
      }
    } catch (e) {
      threw = true;
      // fetch rejects under `redirect: "error"`; it never surfaces as a
      // HarnessApiError, which would imply the redirect was followed and
      // the response read.
      expect(e).not.toBeInstanceOf(HarnessApiError);
    }
    expect(threw).toBe(true);
  });

  test("streamEvents yields parsed runtime events", async () => {
    const events: string[] = [];
    for await (const evt of client().streamEvents({ conversationId: "c1" })) {
      events.push(evt.type);
    }
    expect(events).toEqual(["run:start", "run:complete"]);
  });

  test("streamEvents cancels the open stream when the consumer stops early", async () => {
    // The server never closes an SSE stream, so a consumer that breaks out
    // must close the connection itself; releasing the reader lock alone
    // leaves the socket open for the life of the process.
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"type":"run:start","data":{"runId":"r1"}}\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const c = new HarnessClient({
      baseUrl: "http://harness.test",
      apiKey: "ezk_test",
      fetch: (async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })) as unknown as typeof fetch,
    });
    for await (const evt of c.streamEvents()) {
      expect(evt.type).toBe("run:start");
      break;
    }
    expect(cancelled).toBe(true);
  });
});

describe("HarnessClient — extension control", () => {
  test("listExtensions returns a bare array (includes scratchpad)", async () => {
    extListShape = "array";
    const exts = await client().listExtensions();
    expect(exts).toEqual([{ id: "e1", name: "scratchpad" }]);
    expect(exts.some((e) => e.name === "scratchpad")).toBe(true);
  });

  test("listExtensions normalizes a { extensions } wrapper", async () => {
    extListShape = "wrapper";
    const exts = await client().listExtensions();
    expect(exts).toEqual([{ id: "e2", name: "task-tracking" }]);
  });

  test("listExtensions throws on an unexpected shape (does not silently return [])", async () => {
    extListShape = "other";
    await expect(client().listExtensions()).rejects.toThrow(/unexpected \/api\/extensions response shape/);
  });

  test("wireExtensions posts { names } and returns wired + extensionIds", async () => {
    const res = await client().wireExtensions("c1", ["scratchpad"]);
    expect(res).toEqual({ wired: ["scratchpad"], extensionIds: ["id-scratchpad"] });
    expect(lastWireBody).toEqual({ names: ["scratchpad"] });
    expect(new URL(lastUrl!).pathname).toBe("/api/conversations/c1/extensions");
    expect(lastAuth).toBe("Bearer ezk_test");
  });

  test("wireExtensions percent-encodes the conversationId path segment", async () => {
    await client().wireExtensions("c/../x", ["scratchpad"]);
    expect(new URL(lastUrl!).pathname).toBe("/api/conversations/c%2F..%2Fx/extensions");
  });

  test("wireExtensions throws HarnessApiError 404 on an unknown name", async () => {
    try {
      await client().wireExtensions("c1", ["ghost"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HarnessApiError);
      expect((e as HarnessApiError).status).toBe(404);
      expect((e as HarnessApiError).body).toMatchObject({ error: "Unknown extension(s)", unknown: ["ghost"] });
    }
  });

  test("wireExtensions maps a 403 to HarnessApiError", async () => {
    try {
      await client().wireExtensions("forbidden", ["scratchpad"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HarnessApiError);
      expect((e as HarnessApiError).status).toBe(403);
    }
  });

  test("listWiredExtensions returns the wired set (encoded path)", async () => {
    const wired = await client().listWiredExtensions("c/../x");
    expect(wired).toEqual([{ id: "e1", name: "scratchpad" }]);
    expect(new URL(lastUrl!).pathname).toBe("/api/conversations/c%2F..%2Fx/extensions");
  });

  test("invokeExtensionTool auto-generates an invocationId and returns the result", async () => {
    const res = await client().invokeExtensionTool("c1", "scratchpad", "scratchpad_write", { key: "k", value: "v" });
    expect(res).toMatchObject({ success: true, output: "scratchpad_write:ok" });
    expect(lastToolInvoke).toMatchObject({
      conversationId: "c1",
      extensionName: "scratchpad",
      toolName: "scratchpad_write",
      input: { key: "k", value: "v" },
    });
    // Auto-generated: a uuid-shaped invocationId is present; messageId is absent.
    expect(typeof lastToolInvoke!.invocationId).toBe("string");
    expect((lastToolInvoke!.invocationId as string).length).toBeGreaterThanOrEqual(32);
    expect("messageId" in lastToolInvoke!).toBe(false);
  });

  test("invokeExtensionTool honours an explicit invocationId + messageId, defaults input to {}", async () => {
    const res = await client().invokeExtensionTool("c1", "scratchpad", "scratchpad_read", undefined, {
      invocationId: "inv-fixed",
      messageId: "m-9",
    });
    expect(res.success).toBe(true);
    expect(lastToolInvoke).toEqual({
      conversationId: "c1",
      extensionName: "scratchpad",
      toolName: "scratchpad_read",
      input: {},
      invocationId: "inv-fixed",
      messageId: "m-9",
    });
  });

  test("invokeExtensionTool RESOLVES with a tool-level failure (HTTP 200 { success:false })", async () => {
    const res = await client().invokeExtensionTool("c1", "failing", "whatever");
    expect(res).toMatchObject({ success: false, error: "boom" });
  });

  test("invokeExtensionTool maps a 403 to HarnessApiError", async () => {
    try {
      await client().invokeExtensionTool("c1", "denied", "whatever");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HarnessApiError);
      expect((e as HarnessApiError).status).toBe(403);
    }
  });
});

describe("route table (HARNESS_ROUTES + buildPath)", () => {
  test("every table entry has an uppercase HTTP method and an /api path template", () => {
    const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
    for (const [name, route] of Object.entries(HARNESS_ROUTES)) {
      expect(methods.has(route.httpMethod), `${name} httpMethod`).toBe(true);
      expect(route.pathTemplate.startsWith("/api/"), `${name} pathTemplate`).toBe(true);
    }
  });

  test("getRun and awaitRun intentionally share GET /api/runs/:id", () => {
    expect(HARNESS_ROUTES.getRun).toEqual({ httpMethod: "GET", pathTemplate: "/api/runs/:id" });
    expect(HARNESS_ROUTES.awaitRun).toEqual({ httpMethod: "GET", pathTemplate: "/api/runs/:id" });
  });

  test("buildPath percent-encodes each param as a single segment", () => {
    expect(buildPath("/api/settings/:key", { key: "theme:dark" })).toBe("/api/settings/theme%3Adark");
    expect(buildPath("/api/extensions/:id/activate", { id: "../x" })).toBe("/api/extensions/..%2Fx/activate");
    expect(buildPath("/api/hub/pages/:id/actions/:action", { id: "p 1", action: "do" })).toBe(
      "/api/hub/pages/p%201/actions/do",
    );
  });

  test("buildPath leaves a template with no params untouched", () => {
    expect(buildPath("/api/extensions")).toBe("/api/extensions");
  });

  test("buildPath refuses a param that is a whole dot segment", () => {
    // encodeURIComponent leaves `.` alone and the URL parser resolves `..`
    // even when encoded, so `/api/extensions/../activate` reached another route.
    for (const id of ["", ".", ".."]) {
      expect(() => buildPath("/api/extensions/:id/activate", { id })).toThrow(/invalid route param ':id'/);
    }
  });

  test("buildPath throws loudly on a missing route param", () => {
    expect(() => buildPath("/api/extensions/:id/activate", {})).toThrow(
      /missing route param ':id'/,
    );
  });
});

describe("HarnessClient — extension lifecycle", () => {
  test("installExtension posts the source body and returns the new row (201)", async () => {
    const res = await client().installExtension({ source: "local", path: "/srv/ext" });
    expect(res).toEqual({ id: "ext-new", name: "installed-ext", enabled: false });
    expect(lastInstallBody).toEqual({ source: "local", path: "/srv/ext" });
    expect(new URL(lastUrl!).pathname).toBe("/api/extensions");
    expect(lastAuth).toBe("Bearer ezk_test");
  });

  test("installExtension supports the git source shape", async () => {
    await client().installExtension({ source: "git", url: "https://h/r.git", ref: "main" });
    expect(lastInstallBody).toEqual({ source: "git", url: "https://h/r.git", ref: "main" });
  });

  test("activateExtension without perms posts an empty body and enables", async () => {
    const res = await client().activateExtension("e1");
    expect(res).toMatchObject({ id: "e1", enabled: true });
    expect(lastActivateBody).toEqual({});
    expect(new URL(lastUrl!).pathname).toBe("/api/extensions/e1/activate");
  });

  test("activateExtension forwards grantedPermissions when supplied", async () => {
    await client().activateExtension("e1", { network: true });
    expect(lastActivateBody).toEqual({ grantedPermissions: { network: true } });
  });

  test("setExtensionEnabled(false) disables and returns the updated row", async () => {
    const res = await client().setExtensionEnabled("e1", false);
    expect(res).toMatchObject({ id: "e1", enabled: false });
    expect(lastPatchBody).toEqual({ enabled: false });
    expect(new URL(lastUrl!).pathname).toBe("/api/extensions/e1");
  });

  test("setExtensionEnabled(true) is rejected by the server (enable via /activate)", async () => {
    await expect(client().setExtensionEnabled("e1", true)).rejects.toMatchObject({ status: 400 });
  });

  test("uninstallExtension resolves with no body on 204", async () => {
    const res = await client().uninstallExtension("e1");
    expect(res).toBeUndefined();
    expect(new URL(lastUrl!).pathname).toBe("/api/extensions/e1");
  });

  test("updateExtensionPermissions PUTs the permissions and returns the row", async () => {
    const res = await client().updateExtensionPermissions("e1", { network: true, shell: false });
    expect(lastPermissionsBody).toEqual({ permissions: { network: true, shell: false } });
    expect(res).toMatchObject({ id: "e1", grantedPermissions: { network: true, shell: false } });
    expect(new URL(lastUrl!).pathname).toBe("/api/extensions/e1/permissions");
  });

  test("lifecycle methods percent-encode the extension id path segment", async () => {
    await client().activateExtension("e/../x");
    expect(new URL(lastUrl!).pathname).toBe("/api/extensions/e%2F..%2Fx/activate");
  });
});

describe("HarnessClient — extension secrets", () => {
  test("setExtensionSecret posts name+value (no projectId) and never echoes the value", async () => {
    const res = await client().setExtensionSecret("e1", "TOKEN", "s3cr3t");
    expect(res).toEqual({ ok: true });
    expect(lastSecretBody).toEqual({ name: "TOKEN", value: "s3cr3t" });
    expect(new URL(lastUrl!).pathname).toBe("/api/extensions/e1/secrets");
  });

  test("setExtensionSecret forwards an explicit projectId (including null)", async () => {
    await client().setExtensionSecret("e1", "TOKEN", "v", { projectId: "p-1" });
    expect(lastSecretBody).toEqual({ name: "TOKEN", value: "v", projectId: "p-1" });
    await client().setExtensionSecret("e1", "TOKEN", "v", { projectId: null });
    expect(lastSecretBody).toEqual({ name: "TOKEN", value: "v", projectId: null });
  });

  test("setExtensionSecret maps a per-extension RBAC 403 to HarnessApiError", async () => {
    await expect(client().setExtensionSecret("denied", "TOKEN", "v")).rejects.toMatchObject({ status: 403 });
  });

  test("deleteExtensionSecret returns { deleted } and forwards projectId when given", async () => {
    const hit = await client().deleteExtensionSecret("e1", "known");
    expect(hit).toEqual({ deleted: true });
    expect(lastSecretBody).toEqual({ name: "known" });
    const miss = await client().deleteExtensionSecret("e1", "absent", { projectId: "p-2" });
    expect(miss).toEqual({ deleted: false });
    expect(lastSecretBody).toEqual({ name: "absent", projectId: "p-2" });
  });
});

describe("HarnessClient — hub actions + cancel run", () => {
  test("triggerHubAction posts an empty body when no payload and returns { ok }", async () => {
    const res = await client().triggerHubAction("core:daily-briefing", "noop");
    expect(res).toEqual({ ok: true });
    expect(lastHubActionBody).toEqual({});
    expect(new URL(lastUrl!).pathname).toBe("/api/hub/pages/core%3Adaily-briefing/actions/noop");
  });

  test("triggerHubAction forwards a scalar payload and surfaces a rendered page", async () => {
    const res = await client().triggerHubAction("core:x", "refresh", { since: 5, mode: "full" });
    expect(lastHubActionBody).toEqual({ payload: { since: 5, mode: "full" } });
    expect(res).toMatchObject({ ok: true, page: { type: "root" }, renderedAt: 123 });
  });

  test("cancelRun deletes the run and returns { ok:true }", async () => {
    const res = await client().cancelRun("r1");
    expect(res).toEqual({ ok: true });
    expect(new URL(lastUrl!).pathname).toBe("/api/runs/r1");
  });

  test("cancelRun maps a not-running 404 to HarnessApiError", async () => {
    await expect(client().cancelRun("gone")).rejects.toMatchObject({ status: 404 });
  });
});

describe("HarnessClient — deliverHook (Loops EZ Mode Phase 4)", () => {
  // Self-contained: a stub fetch captures the request so we can assert the hook
  // route path, the per-hook auth headers, and the CRITICAL invariant that the
  // harness API key is NEVER attached to the public webhook route.
  interface Captured { url: string; init: RequestInit }
  function stubClient(status: number, body: unknown): { client: HarnessClient; captured: Captured[] } {
    const captured: Captured[] = [];
    // Cast to `typeof fetch`: the real type carries a `preconnect` member a bare
    // arrow can't satisfy (same shape the redirect test uses).
    const stub = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      captured.push({ url, init: init ?? {} });
      return Promise.resolve(
        status === 202 ? Response.json(body, { status }) : new Response(JSON.stringify(body), { status }),
      );
    }) as unknown as typeof fetch;
    return {
      client: new HarnessClient({ baseUrl: "http://h", apiKey: "ezk_HARNESS_KEY", fetch: stub }),
      captured,
    };
  }

  test("route table entry matches the registered path", () => {
    expect(HARNESS_ROUTES.deliverHook).toEqual({
      httpMethod: "POST",
      pathTemplate: "/api/hooks/:extensionId/:slug",
    });
  });

  test("posts to the hook path with a Bearer token and NEVER the harness key", async () => {
    const { client, captured } = stubClient(202, { accepted: true, deliveryId: "d-1" });
    const res = await client.deliverHook("docs-updater", "tickets", {
      body: '{"n":1}',
      contentType: "application/json",
      token: "ezhook_secret-token",
    });
    expect(res).toEqual({ accepted: true, deliveryId: "d-1" });
    expect(new URL(captured[0]!.url).pathname).toBe("/api/hooks/docs-updater/tickets");
    const headers = captured[0]!.init.headers as Record<string, string>;
    // The hook token is the auth — NOT the harness ezk_ key.
    expect(headers["Authorization"]).toBe("Bearer ezhook_secret-token");
    expect(headers["Authorization"]).not.toContain("ezk_");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(captured[0]!.init.body).toBe('{"n":1}');
  });

  test("sends an X-Hub-Signature-256 header and no Authorization when using HMAC", async () => {
    const { client, captured } = stubClient(202, { accepted: true, deliveryId: "d-2" });
    await client.deliverHook("docs-updater", "tickets", {
      body: "raw",
      signature: "sha256=deadbeef",
    });
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers["X-Hub-Signature-256"]).toBe("sha256=deadbeef");
    expect(headers["Authorization"]).toBeUndefined();
  });

  test("maps a 401 to HarnessApiError", async () => {
    const { client } = stubClient(401, { error: "Unauthorized" });
    await expect(
      client.deliverHook("docs-updater", "tickets", { token: "wrong" }),
    ).rejects.toMatchObject({ status: 401 });
  });

  test("path params are percent-encoded (no traversal)", async () => {
    const { client, captured } = stubClient(202, { accepted: true, deliveryId: "d-3" });
    await client.deliverHook("ext/../evil", "a b", { token: "t" });
    // Both segments are opaque — the slash and space never climb or split.
    expect(new URL(captured[0]!.url).pathname).toBe("/api/hooks/ext%2F..%2Fevil/a%20b");
  });
});

// ── Caller-executed tools ────────────────────────────────────────────────

describe("SseDataBuffer — lastEventId", () => {
  test("starts empty and tracks the most recent id: field", () => {
    const b = new SseDataBuffer();
    expect(b.lastEventId).toBe("");
    b.push('id: 7\ndata: {"type":"run:start"}\n\n');
    expect(b.lastEventId).toBe("7");
  });

  test("an id-only record still updates the cursor and yields no payload", () => {
    const b = new SseDataBuffer();
    expect(b.push("id: 3\n\n")).toEqual([]);
    expect(b.lastEventId).toBe("3");
  });

  test("a record with no id: leaves the cursor where it was (SSE persistence)", () => {
    const b = new SseDataBuffer();
    b.push("id: 11\ndata: a\n\n");
    b.push("data: b\n\n");
    expect(b.lastEventId).toBe("11");
  });
});

/** One request the fake saw. */
interface FakeCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
}

/**
 * A scripted stand-in for the whole caller-tools surface. Deliberately a stub
 * `fetch` rather than a live server: `serveCallerTools` is a reconnect loop,
 * and driving reconnection, a transport failure, and abort deterministically
 * needs per-connection control that a real socket cannot give without timing
 * assumptions.
 *
 * Termination is scripted too — `abortAfterActiveRunCalls` fires the caller's
 * AbortController from inside the Nth drain, and the stub then honours
 * `init.signal` exactly as a real fetch does, so the loop exits through its
 * own aborted check rather than a timer the test would have to race.
 */
function callerToolsFake(opts: {
  controller: AbortController;
  abortAfterActiveRunCalls: number;
  pendings?: CallerToolCall[][];
  connections?: Array<string[] | "throw">;
  resolvedAck?: boolean;
  /** Status the gate-resolve route answers with — set it to refuse the
   *  approval (an expired gate, a revoked scope) and see what that does to
   *  the serve loop. Defaults to accepting. */
  permissionStatus?: number;
}): { stub: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let activeRunCalls = 0;
  let connections = 0;
  const stub = ((input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    // Checked BEFORE recording: a real fetch on an aborted signal never
    // reaches the server, so counting it would make `calls` describe traffic
    // that did not happen.
    if (init?.signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }
    calls.push({ method, path: url.pathname, body, headers });
    if (url.pathname.endsWith("/active-run")) {
      const pending = opts.pendings?.[activeRunCalls] ?? [];
      activeRunCalls += 1;
      if (activeRunCalls >= opts.abortAfterActiveRunCalls) opts.controller.abort();
      return Promise.resolve(Response.json({ runId: "run-1", pendingCallerTools: pending }));
    }
    if (url.pathname.endsWith("/tool-results")) {
      const resolved = opts.resolvedAck ?? true;
      return Promise.resolve(
        Response.json(resolved ? { ok: true, resolved } : { ok: true, resolved, reason: "already-resolved" }),
      );
    }
    if (url.pathname.endsWith("/permission")) {
      const status = opts.permissionStatus ?? 200;
      return Promise.resolve(
        status === 200
          ? Response.json({ ok: true })
          : Response.json({ error: "gate is gone" }, { status }),
      );
    }
    if (url.pathname === "/api/runtime-events") {
      const script = opts.connections?.[connections];
      connections += 1;
      if (script === "throw") return Promise.reject(new Error("connection reset"));
      return Promise.resolve(
        new Response(sseBody(script ?? []), { headers: { "Content-Type": "text/event-stream" } }),
      );
    }
    return Promise.resolve(Response.json({ error: "unrouted" }, { status: 404 }));
  }) as unknown as typeof fetch;
  return { stub, calls };
}

function fakeClient(stub: typeof fetch): HarnessClient {
  return new HarnessClient({ baseUrl: "http://h", apiKey: "ezk_test", fetch: stub });
}

function callerEvent(over: Partial<CallerToolCall> = {}): string {
  const data = {
    conversationId: "c1",
    runId: "run-1",
    toolCallId: "tc-1",
    toolName: "_caller__open_app",
    input: { app: "notes" },
    ...over,
  };
  return `data: ${JSON.stringify({ type: "caller:tool-call", data })}\n\n`;
}

/**
 * One `tool:permission_request` frame. Every field is overridable — including
 * to a wrong TYPE or (via `undefined`, which `JSON.stringify` drops) to absent,
 * because the payload crosses a network boundary and the client narrows all
 * three fields itself.
 */
function gateEvent(over: Record<string, unknown> = {}): string {
  const data: Record<string, unknown> = {
    conversationId: "c1",
    toolCallId: "tc-gate",
    toolName: "_caller__open_app",
    ...over,
  };
  return `data: ${JSON.stringify({ type: "tool:permission_request", data })}\n\n`;
}

const resultPosts = (calls: FakeCall[]) => calls.filter((c) => c.path.endsWith("/tool-results"));
const approvalPaths = (calls: FakeCall[]) =>
  calls.filter((c) => c.path.endsWith("/permission")).map((c) => c.path);

describe("HarnessClient — caller-tool route table + methods", () => {
  test("every caller-tools route is in the shared table at the registered path", () => {
    expect(HARNESS_ROUTES.declareCallerTools).toEqual({
      httpMethod: "PUT",
      pathTemplate: "/api/conversations/:id/caller-tools",
    });
    expect(HARNESS_ROUTES.getCallerTools).toEqual({
      httpMethod: "GET",
      pathTemplate: "/api/conversations/:id/caller-tools",
    });
    expect(HARNESS_ROUTES.clearCallerTools).toEqual({
      httpMethod: "DELETE",
      pathTemplate: "/api/conversations/:id/caller-tools",
    });
    expect(HARNESS_ROUTES.submitToolResult).toEqual({
      httpMethod: "POST",
      pathTemplate: "/api/conversations/:id/tool-results",
    });
    expect(HARNESS_ROUTES.getActiveRun).toEqual({
      httpMethod: "GET",
      pathTemplate: "/api/conversations/:id/active-run",
    });
  });

  test("declare / read / clear / submit / drain each drive their own verb+path", async () => {
    const calls: FakeCall[] = [];
    const stub = ((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : String(input));
      calls.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        headers: {},
      });
      if (url.pathname.endsWith("/caller-tools") && init?.method === "PUT") {
        return Promise.resolve(
          Response.json({ tools: [{ name: "open_app" }], appliedFrom: "next-turn", activeRunId: "r9" }),
        );
      }
      if (url.pathname.endsWith("/caller-tools") && init?.method === "DELETE") {
        return Promise.resolve(Response.json({ ok: true, cleared: 2 }));
      }
      if (url.pathname.endsWith("/caller-tools")) {
        return Promise.resolve(Response.json({ tools: [{ name: "open_app", description: "d", parameters: {} }] }));
      }
      if (url.pathname.endsWith("/tool-results")) {
        return Promise.resolve(Response.json({ ok: true, resolved: false, reason: "already-resolved" }));
      }
      return Promise.resolve(Response.json({ runId: "r9", pendingCallerTools: [] }));
    }) as unknown as typeof fetch;
    const c = fakeClient(stub);

    const declared = await c.declareCallerTools("c1", [
      { name: "open_app", description: "Open an app", parameters: { type: "object" } },
    ]);
    expect(declared).toMatchObject({ appliedFrom: "next-turn", activeRunId: "r9" });

    expect(await c.getCallerTools("c1")).toEqual([
      { name: "open_app", description: "d", parameters: {} },
    ]);
    expect(await c.clearCallerTools("c1")).toEqual({ ok: true, cleared: 2 });
    expect(await c.submitToolResult("c1", "tc-1", { ok: true })).toEqual({
      ok: true,
      resolved: false,
      reason: "already-resolved",
    });
    expect(await c.getActiveRun("c1")).toMatchObject({ runId: "r9" });

    expect(calls.map((x) => `${x.method} ${x.path}`)).toEqual([
      "PUT /api/conversations/c1/caller-tools",
      "GET /api/conversations/c1/caller-tools",
      "DELETE /api/conversations/c1/caller-tools",
      "POST /api/conversations/c1/tool-results",
      "GET /api/conversations/c1/active-run",
    ]);
    expect(calls[0]!.body).toEqual({
      tools: [{ name: "open_app", description: "Open an app", parameters: { type: "object" } }],
    });
    expect(calls[3]!.body).toEqual({ toolCallId: "tc-1", result: { ok: true } });
  });
});

describe("HarnessClient — serveCallerTools", () => {
  test("drains pending calls from active-run BEFORE consuming any event", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      pendings: [
        [
          {
            conversationId: "c1",
            runId: "run-1",
            toolCallId: "tc-recovered",
            toolName: "_caller__open_app",
            input: { app: "notes" },
          },
        ],
      ],
      connections: [[]],
    });
    const seen: unknown[] = [];
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: (input) => { seen.push(input); return { opened: true }; } },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    expect(seen).toEqual([{ app: "notes" }]);
    // The drain POST lands before the SSE connection is even opened.
    const order = calls.map((c) => c.path);
    expect(order.indexOf("/api/conversations/c1/tool-results")).toBeLessThan(
      order.indexOf("/api/runtime-events"),
    );
    expect(resultPosts(calls)[0]!.body).toEqual({
      toolCallId: "tc-recovered",
      result: {
        ok: true,
        toolName: "_caller__open_app",
        toolCallId: "tc-recovered",
        detail: { opened: true },
      },
    });
  });

  test("a call delivered by BOTH drain and SSE executes exactly once", async () => {
    const controller = new AbortController();
    const call: CallerToolCall = {
      conversationId: "c1",
      runId: "run-1",
      toolCallId: "tc-dupe",
      toolName: "_caller__open_app",
      input: {},
    };
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      pendings: [[call]],
      connections: [[callerEvent({ toolCallId: "tc-dupe" })]],
    });
    let runs = 0;
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => { runs += 1; return {}; } },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    expect(runs).toBe(1);
    expect(resultPosts(calls)).toHaveLength(1);
  });

  test("an unknown tool is answered immediately, never parked", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      connections: [[callerEvent({ toolCallId: "tc-ghost", toolName: "_caller__no_such_tool" })]],
    });
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => ({}) },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    const posts = resultPosts(calls);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({
      toolCallId: "tc-ghost",
      result: { ok: false, code: "unknown-tool" },
    });
    expect((posts[0]!.body as { result: { error: string } }).result.error).toContain("no_such_tool");
  });

  test("a throwing handler reports a tool-level failure and keeps serving", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      connections: [
        [
          callerEvent({ toolCallId: "tc-boom" }),
          callerEvent({ toolCallId: "tc-after", toolName: "_caller__ping" }),
        ],
      ],
    });
    await fakeClient(stub).serveCallerTools(
      "c1",
      {
        open_app: () => { throw new Error("device refused"); },
        ping: () => "pong",
      },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    const posts = resultPosts(calls);
    expect(posts).toHaveLength(2);
    expect(posts[0]!.body).toMatchObject({
      result: { ok: false, code: "rejected", error: "device refused" },
    });
    expect(posts[1]!.body).toMatchObject({ result: { ok: true, detail: "pong" } });
  });

  test("a non-Error throw is stringified rather than lost", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      connections: [[callerEvent({ toolCallId: "tc-str" })]],
    });
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => { throw "plain string"; } },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    expect(resultPosts(calls)[0]!.body).toMatchObject({
      result: { ok: false, error: "plain string" },
    });
  });

  test("a call for another conversation is ignored", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      connections: [[callerEvent({ conversationId: "OTHER", toolCallId: "tc-foreign" })]],
    });
    let runs = 0;
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => { runs += 1; return {}; } },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    expect(runs).toBe(0);
    expect(resultPosts(calls)).toHaveLength(0);
  });

  test("a malformed caller:tool-call payload is dropped, not thrown on", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      connections: [
        [
          // Missing toolCallId / toolName — the two narrowing branches.
          `data: ${JSON.stringify({ type: "caller:tool-call", data: { conversationId: "c1", runId: "r" } })}\n\n`,
          `data: ${JSON.stringify({ type: "caller:tool-call", data: { toolCallId: "x", toolName: "y" } })}\n\n`,
        ],
      ],
    });
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => ({}) },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    expect(resultPosts(calls)).toHaveLength(0);
  });

  test("auto-approves a _caller__* gate and leaves every other gate alone", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      connections: [
        [
          gateEvent(),
          gateEvent({ toolName: "shell", toolCallId: "tc-shell" }),
          // A gate with a non-string toolCallId must not be answered either.
          gateEvent({ toolCallId: 7 }),
        ],
      ],
    });
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => ({}) },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    const approvals = calls.filter((c) => c.path.endsWith("/permission"));
    expect(approvals.map((a) => a.path)).toEqual(["/api/tool-calls/tc-gate/permission"]);
    expect(approvals[0]!.body).toEqual({ approved: true });
  });

  // ── The gate stream is USER-scoped ──────────────────────────────────
  //
  // `/api/runtime-events` narrows on the payload's userId and on conversation
  // OWNERSHIP; the `conversationId` query param is a cache-key hint the filter
  // does not enforce. So one connection carries every gate this key's user
  // owns, and the approval branch — like `dispatch` before it — has to do its
  // own scoping. The loop that gets this wrong silently answers the gates of a
  // sibling loop running `autoApprove: false` for a human to decide.
  test("a _caller__* gate from ANOTHER conversation is not auto-approved", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      connections: [
        [
          gateEvent({ conversationId: "OTHER", toolCallId: "tc-foreign" }),
          // Same tool, same shape, THIS conversation — the only difference is
          // the id, so the conversation is provably what discriminates.
          gateEvent({ toolCallId: "tc-mine" }),
        ],
      ],
    });
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => ({}) },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    expect(approvalPaths(calls)).toEqual(["/api/tool-calls/tc-mine/permission"]);
  });

  test("a gate with a missing or non-string conversationId fails CLOSED", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      connections: [
        [
          // `undefined` drops the key from the JSON entirely.
          gateEvent({ conversationId: undefined, toolCallId: "tc-absent" }),
          gateEvent({ conversationId: 7, toolCallId: "tc-nonstring" }),
          gateEvent({ conversationId: null, toolCallId: "tc-null" }),
          gateEvent({ toolCallId: "tc-mine" }),
        ],
      ],
    });
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => ({}) },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    // An unattributable gate is not this loop's to answer: skipped, never
    // approved "just in case".
    expect(approvalPaths(calls)).toEqual(["/api/tool-calls/tc-mine/permission"]);
  });

  test("a REFUSED approval is reported and the stream keeps running", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      permissionStatus: 403,
      connections: [[gateEvent(), callerEvent({ toolCallId: "tc-after" })]],
    });
    const errors: unknown[] = [];
    let ran = 0;
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => { ran += 1; return {}; } },
      { signal: controller.signal, reconnectDelayMs: 0, onError: (e) => errors.push(e) },
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(HarnessApiError);
    expect((errors[0] as HarnessApiError).status).toBe(403);
    // …and the event AFTER the failed gate was still served, on the SAME
    // connection: a throw out of the `for await` would have unwound the
    // stream and opened a second one.
    expect(ran).toBe(1);
    expect(resultPosts(calls)[0]!.body).toMatchObject({ toolCallId: "tc-after" });
    expect(calls.filter((c) => c.path === "/api/runtime-events")).toHaveLength(1);
  });

  test("autoApprove:false answers no gate at all", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      connections: [[gateEvent()]],
    });
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => ({}) },
      { signal: controller.signal, reconnectDelayMs: 0, autoApprove: false },
    );
    expect(approvalPaths(calls)).toHaveLength(0);
  });

  test("a run's terminal event drops that run's open calls (and a runId-less one is ignored)", async () => {
    const controller = new AbortController();
    const { stub } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      connections: [
        [
          callerEvent({ toolCallId: "tc-open" }),
          `data: ${JSON.stringify({ type: "run:complete", data: { runId: "run-1" } })}\n\n`,
          `data: ${JSON.stringify({ type: "run:error", data: {} })}\n\n`,
          `data: ${JSON.stringify({ type: "run:cancel", data: { runId: "unknown-run" } })}\n\n`,
        ],
      ],
    });
    // The assertion that matters is that the loop survives all three shapes
    // and still exits cleanly — a thrown TypeError on the runId-less event
    // would end the serve loop through the catch and reconnect forever.
    await expect(
      fakeClient(stub).serveCallerTools(
        "c1",
        { open_app: () => ({}) },
        { signal: controller.signal, reconnectDelayMs: 0 },
      ),
    ).resolves.toBeUndefined();
  });

  test("reconnects after a transport failure, re-drains, and reports the error", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 3,
      pendings: [
        [],
        [
          {
            conversationId: "c1",
            runId: "run-2",
            toolCallId: "tc-missed",
            toolName: "_caller__open_app",
            input: {},
          },
        ],
      ],
      connections: ["throw", []],
    });
    const errors: unknown[] = [];
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => ({ recovered: true }) },
      { signal: controller.signal, reconnectDelayMs: 0, onError: (e) => errors.push(e) },
    );
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("connection reset");
    // The SECOND drain is what recovered the missed call — replay could not
    // have, and this is the whole point of draining on every reconnect.
    expect(resultPosts(calls)[0]!.body).toMatchObject({ toolCallId: "tc-missed" });
    expect(calls.filter((c) => c.path.endsWith("/active-run"))).toHaveLength(3);
  });

  test("sends Last-Event-ID on the reconnect, and nothing on the first connect", async () => {
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 3,
      connections: [[`id: 42\n${callerEvent({ toolCallId: "tc-id" })}`], []],
    });
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => ({}) },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    const streams = calls.filter((c) => c.path === "/api/runtime-events");
    expect(streams).toHaveLength(2);
    expect(streams[0]!.headers["Last-Event-ID"]).toBeUndefined();
    expect(streams[1]!.headers["Last-Event-ID"]).toBe("42");
  });

  test("the dedupe set is bounded — the oldest id is evicted past the ceiling", async () => {
    // 513 = the 512-entry ceiling + 1. The first id must have been evicted,
    // so re-delivering it executes again; a later one must NOT.
    const controller = new AbortController();
    const many: CallerToolCall[] = Array.from({ length: 513 }, (_, i) => ({
      conversationId: "c1",
      runId: "run-1",
      toolCallId: `tc-${i}`,
      toolName: "_caller__open_app",
      input: {},
    }));
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      pendings: [many],
      connections: [[callerEvent({ toolCallId: "tc-0" }), callerEvent({ toolCallId: "tc-512" })]],
    });
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => ({}) },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    const posted = resultPosts(calls).map((c) => (c.body as { toolCallId: string }).toolCallId);
    // 513 from the drain + one re-run of the evicted tc-0.
    expect(posted).toHaveLength(514);
    expect(posted.filter((id) => id === "tc-0")).toHaveLength(2);
    expect(posted.filter((id) => id === "tc-512")).toHaveLength(1);
  });

  test("a pre-aborted signal never opens a connection", async () => {
    const controller = new AbortController();
    controller.abort();
    const { stub, calls } = callerToolsFake({ controller, abortAfterActiveRunCalls: 99 });
    await fakeClient(stub).serveCallerTools("c1", {}, { signal: controller.signal });
    expect(calls).toEqual([]);
  });
});

describe("serveCallerTools — the two events disagree about the tool-name form", () => {
  test("dispatch works on the BARE name the caller:tool-call actually carries", async () => {
    // `caller:tool-call` sends `decl.name` (`open_app`), while
    // `tool:permission_request` sends the runtime's `_caller__open_app`. A
    // client that assumed one form for both would either never approve its
    // own gates or never find its own handlers.
    const controller = new AbortController();
    const { stub, calls } = callerToolsFake({
      controller,
      abortAfterActiveRunCalls: 2,
      connections: [
        [gateEvent(), callerEvent({ toolCallId: "tc-bare", toolName: "open_app" })],
      ],
    });
    let ran = 0;
    await fakeClient(stub).serveCallerTools(
      "c1",
      { open_app: () => { ran += 1; return {}; } },
      { signal: controller.signal, reconnectDelayMs: 0 },
    );
    // The WIRE-form gate was approved…
    expect(approvalPaths(calls)).toEqual(["/api/tool-calls/tc-gate/permission"]);
    // …and the BARE-form call found its handler.
    expect(ran).toBe(1);
    expect(resultPosts(calls)[0]!.body).toMatchObject({
      toolCallId: "tc-bare",
      result: { ok: true, toolName: "open_app" },
    });
  });
});

// ── Provisioning + mode placement ───────────────────────────────────────
//
// The two writes a CONFINED companion key needs on either side of it: an
// operator's admin key mints the narrow key, and the app puts its
// conversation under the mode that key is locked to.
describe("mintApiKey / updateConversation", () => {
  test("mintApiKey posts name + scopes and omits the optional fields when absent", async () => {
    const minted = await client().mintApiKey("plain", ["read"]);
    expect(lastMintBody).toEqual({ name: "plain", scopes: ["read"] });
    expect(minted.key).toBe("ezk_child");
    expect(minted.keyId).toBe("k-child");
  });

  test("mintApiKey forwards role + toolPolicy, bundle NAME included", async () => {
    await client().mintApiKey("companion", ["read", "write", "chat"], {
      role: "member",
      toolPolicy: {
        routeBundle: "desktop-companion",
        allowedCallerTools: ["open_app"],
        maxCallerTools: 1,
        lockedModeId: "mode-1",
      },
    });
    expect(lastMintBody).toEqual({
      name: "companion",
      scopes: ["read", "write", "chat"],
      role: "member",
      toolPolicy: {
        routeBundle: "desktop-companion",
        allowedCallerTools: ["open_app"],
        maxCallerTools: 1,
        lockedModeId: "mode-1",
      },
    });
  });

  test("updateConversation PUTs the patch at the conversation path", async () => {
    const res = await client().updateConversation("c1", { modeId: "mode-1", title: "t" });
    expect(lastUpdateConversationBody).toEqual({ modeId: "mode-1", title: "t" });
    expect(res.id).toBe("c1");
  });

  test("updateConversation can CLEAR the mode (which bricks a locked key, by design)", async () => {
    await client().updateConversation("c1", { modeId: null });
    expect(lastUpdateConversationBody).toEqual({ modeId: null });
  });

  test("both routes are in the shared table (one place a path is written)", () => {
    expect(HARNESS_ROUTES.mintApiKey).toEqual({
      httpMethod: "POST",
      pathTemplate: "/api/settings/developer/api-keys",
    });
    expect(HARNESS_ROUTES.updateConversation).toEqual({
      httpMethod: "PUT",
      pathTemplate: "/api/conversations/:id",
    });
  });
});
