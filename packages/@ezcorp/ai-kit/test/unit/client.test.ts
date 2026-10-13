import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EzcorpClient, EzcorpApiError } from "../../src/client";
import { startStubServer, type StubServer } from "../fixtures/stub-server";

let server: StubServer;
let client: EzcorpClient;

beforeEach(() => {
  server = startStubServer();
  client = new EzcorpClient({ baseUrl: server.url });
});

afterEach(() => {
  server.stop();
});

describe("EzcorpClient — auth + errors", () => {
  test("injects Authorization header when apiKey provided", async () => {
    server.stop();
    server = startStubServer({ apiKey: "ez_test" });
    const authed = new EzcorpClient({ baseUrl: server.url, apiKey: "ez_test" });
    expect(await authed.me()).toMatchObject({ id: "stub-user" });
  });

  test("health requires no auth", async () => {
    server.stop();
    server = startStubServer({ apiKey: "ez_test" });
    const noKey = new EzcorpClient({ baseUrl: server.url });
    expect(await noKey.health()).toEqual({ ok: true });
  });

  test("rejects malformed health and identity response envelopes", async () => {
    const malformed = new EzcorpClient({
      baseUrl: "http://stub.invalid",
      fetch: (async (input: unknown) =>
        Response.json(
          String(input).endsWith("/api/health") ? { ok: true } : { id: "unwrapped" },
        )) as unknown as typeof fetch,
    });
    await expect(malformed.health()).rejects.toThrow("Invalid /api/health response");
    await expect(malformed.me()).rejects.toThrow("Invalid /api/auth/me response");
  });

  test("maps the valid degraded health status to not ok", async () => {
    const degraded = new EzcorpClient({
      baseUrl: "http://stub.invalid",
      fetch: (async () => Response.json({ status: "degraded" })) as unknown as typeof fetch,
    });
    expect(await degraded.health()).toEqual({ ok: false });
  });

  test("throws EzcorpApiError with status + url on non-2xx", async () => {
    server.state.nextConversationFailure = { status: 400, body: '{"error":"bad"}' };
    const err = await client
      .createConversation({ projectId: "global" })
      .then(() => null, (e) => e);
    expect(err).toBeInstanceOf(EzcorpApiError);
    expect((err as EzcorpApiError).status).toBe(400);
    expect((err as EzcorpApiError).url).toContain("/api/conversations");
  });

  test("baseUrl trailing slash is normalized", () => {
    const c = new EzcorpClient({ baseUrl: "http://x/" });
    expect(c.baseUrl).toBe("http://x");
  });
});

describe("EzcorpClient — projects + conversations", () => {
  test("listProjects returns seeded global", async () => {
    const ps = await client.listProjects();
    expect(ps.some((p) => p.id === "global")).toBe(true);
  });

  test("createProject + getProject round-trip", async () => {
    const created = await client.createProject({ name: "p1", path: "/tmp/p1" });
    expect(created.name).toBe("p1");
    const fetched = await client.getProject(created.id);
    expect(fetched.id).toBe(created.id);
  });

  test("listConversations filters by projectId", async () => {
    const c1 = await client.createConversation({ projectId: "global", title: "a" });
    const list = await client.listConversations({ projectId: "global", limit: 10, offset: 0 });
    expect(list.some((c) => c.id === c1.id)).toBe(true);
    const empty = await client.listConversations({
      projectId: "00000000-0000-4000-8000-000000000999",
      search: "nomatch",
    });
    expect(empty).toEqual([]);
  });

  test("getConversation returns a single row", async () => {
    const c = await client.createConversation({ projectId: "global" });
    const fetched = await client.getConversation(c.id);
    expect(fetched.id).toBe(c.id);
  });

  test("getTasks returns stub shape", async () => {
    const c = await client.createConversation({ projectId: "global" });
    const tasks = await client.getTasks(c.id);
    expect(tasks).toBeDefined();
  });

  test("createConversation + sendMessage round-trip", async () => {
    const c = await client.createConversation({ projectId: "global", title: "t" });
    expect(c.projectId).toBe("global");
    const res = await client.sendMessage(c.id, { content: "hi" });
    expect(res.runId).toBeString();
    const msgs = await client.getMessages(c.id);
    expect(msgs[0]?.content).toBe("hi");
  });

  test("createConversation validates uuid projectId", () => {
    expect(() =>
      client.createConversation({ projectId: "not-a-uuid" as unknown as string }),
    ).toThrow();
  });

  test("sendMessage enforces content length", () => {
    expect(() => client.sendMessage("conv-id", { content: "" })).toThrow();
  });

  test("an id stays inside its own path segment", async () => {
    // Ids reach these routes from MCP tool input. Interpolated raw, an id with
    // `/`, `?` or a dot segment steered the bearer-carrying request to a
    // different route.
    const paths: string[] = [];
    const capturing = new EzcorpClient({
      baseUrl: server.url,
      fetch: (async (url: URL | string) => {
        paths.push(new URL(String(url)).pathname);
        return Response.json({ runId: "r1" });
      }) as unknown as typeof fetch,
    });
    await capturing.sendMessage("x/../../extensions/e1/uninstall?", { content: "hi" });
    await capturing.startAssignment({ conversationId: "00000000-0000-4000-8000-000000000001", taskId: "t/../..", assignmentId: "a1" });
    expect(paths).toEqual([
      "/api/conversations/x%2F..%2F..%2Fextensions%2Fe1%2Funinstall%3F/messages",
      "/api/conversations/00000000-0000-4000-8000-000000000001/tasks/t%2F..%2F../assignments/a1/start",
    ]);
    for (const id of ["", ".", ".."]) expect(() => capturing.getConversation(id)).toThrow("path segment");
    expect(paths).toHaveLength(2);
  });
});

describe("EzcorpClient — fan-out", () => {
  test("spawnChats rejects batches larger than 10 (amplification defense)", async () => {
    const tooMany = Array.from({ length: 11 }, () => ({
      projectId: "global" as const,
      initialMessage: "x",
    }));
    await expect(client.spawnChats({ chats: tooMany })).rejects.toThrow();
  });

  test("spawnChats accepts a batch of exactly 10 (the hard cap)", async () => {
    const atLimit = Array.from({ length: 10 }, () => ({
      projectId: "global" as const,
      initialMessage: "x",
    }));
    const res = await client.spawnChats({ chats: atLimit });
    expect(res.chats).toHaveLength(10);
  });

  test("spawnChats creates N independent root conversations", async () => {
    const res = await client.spawnChats({
      chats: [
        { projectId: "global", initialMessage: "first" },
        { projectId: "global", initialMessage: "second" },
        { projectId: "global", initialMessage: "third" },
      ],
    });
    expect(res.chats).toHaveLength(3);
    const ids = new Set(res.chats.map((c) => c.conversationId));
    expect(ids.size).toBe(3);
  });

  test("assignTask + startAssignment produces a sub-conversation", async () => {
    const parent = await client.createConversation({ projectId: "global" });
    const { assignment } = await client.assignTask({
      conversationId: parent.id,
      taskId: "t1",
      agentConfigId: "00000000-0000-4000-8000-000000000001",
    });
    const started = await client.startAssignment({
      conversationId: parent.id,
      taskId: "t1",
      assignmentId: assignment.id,
    });
    expect(started.subConversationId).toBeString();
    const subs = await client.getSubConversations(parent.id);
    expect(subs.some((s) => s.id === started.subConversationId)).toBe(true);
  });
});

describe("EzcorpClient — agents", () => {
  test("createAgent round-trips", async () => {
    const agent = await client.createAgent({ name: "reviewer", prompt: "You review code." });
    expect(agent.name).toBe("reviewer");
  });

  test("generateAgent returns clarifying text then config on second turn", async () => {
    const turn1 = await client.generateAgent({
      messages: [{ role: "user", content: "build me a reviewer" }],
    });
    expect(turn1.config).toBeNull();
    const turn2 = await client.generateAgent({
      messages: [
        { role: "user", content: "build me a reviewer" },
        { role: "assistant", content: turn1.text },
        { role: "user", content: "TypeScript security focus" },
      ],
    });
    expect(turn2.config?.name).toBeString();
  });

  test("searchMentions with type filter", async () => {
    const hits = await client.searchMentions({ q: "code", type: "agent" });
    expect(hits[0]?.kind).toBe("agent");
  });
});

describe("EzcorpClient — call context", () => {
  test("onBehalfOfContext back-compat shim round-trips through callContext", async () => {
    const { onBehalfOfContext, callContext } = await import("../../src/client");
    expect(onBehalfOfContext.getStore()).toBeUndefined();
    const got = onBehalfOfContext.run("geff", () => {
      return {
        shimValue: onBehalfOfContext.getStore(),
        ctxValue: callContext.getStore()?.onBehalfOf,
      };
    });
    expect(got.shimValue).toBe("geff");
    expect(got.ctxValue).toBe("geff");
  });

  test("callContext defaults fill in missing model + provider", async () => {
    const { callContext } = await import("../../src/client");
    const s = startStubServer();
    const c = new EzcorpClient({ baseUrl: s.url });
    try {
      const conv = await callContext.run(
        { defaultModel: "claude-sonnet-4-6", defaultProvider: "anthropic" },
        () => c.createConversation({ projectId: "global" }),
      );
      expect(conv.projectId).toBe("global");
    } finally {
      s.stop();
    }
  });

  test("explicit args override callContext defaults", async () => {
    const { callContext } = await import("../../src/client");
    const s = startStubServer();
    const captured: Array<{ model?: string }> = [];
    const c = new EzcorpClient({
      baseUrl: s.url,
      fetch: ((input: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body === "string" && (init?.method ?? "GET") === "POST") {
          try {
            captured.push(JSON.parse(init.body));
          } catch {
            /* not JSON */
          }
        }
        return fetch(input, init);
      }) as unknown as typeof fetch,
    });
    try {
      await callContext.run(
        { defaultModel: "sonnet", defaultProvider: "anthropic" },
        () => c.createConversation({ projectId: "global", model: "opus" }),
      );
      expect(captured[0]?.model).toBe("opus");
    } finally {
      s.stop();
    }
  });
});

describe("EzcorpClient — redirects", () => {
  // A stub fetch wrapper that rewrites the target path to a 302 route just
  // before dispatch, so the real request/streamEvents code paths are
  // exercised unmodified — only the URL the fake server sees changes. Cast
  // to `typeof fetch`: the real type carries a `preconnect` member a bare
  // arrow can't satisfy.
  function redirectingFetch(fromPath: string, toPath: string): typeof fetch {
    return ((input: string | URL | Request, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return fetch(u.replace(fromPath, toPath), init);
    }) as unknown as typeof fetch;
  }

  test("refuses to follow a redirect (no bearer-token replay)", async () => {
    const c = new EzcorpClient({
      baseUrl: server.url,
      fetch: redirectingFetch("/api/health", "/api/health-redirect"),
    });
    let threw = false;
    try {
      // The target (`/api/health`) is a real, reachable route — if the
      // redirect were followed instead of refused, this would resolve with
      // `{ ok: true }` rather than throw. That's what makes this assertion
      // meaningful rather than trivially true.
      await c.health();
    } catch (e) {
      threw = true;
      // fetch rejects under `redirect: "error"`; it never surfaces as an
      // EzcorpApiError, which would imply the redirect was followed and the
      // response read.
      expect(e).not.toBeInstanceOf(EzcorpApiError);
    }
    expect(threw).toBe(true);
  });

  test("streamEvents refuses to follow a redirect (no bearer-token replay)", async () => {
    const c = new EzcorpClient({
      baseUrl: server.url,
      fetch: redirectingFetch("/api/runtime-events", "/api/runtime-events-redirect"),
    });
    let threw = false;
    try {
      // The target is the real `/api/runtime-events` SSE route — a followed
      // redirect would successfully establish the stream instead of throwing.
      for await (const _ of c.streamEvents()) {
        // unreachable: the fetch itself must reject before yielding.
      }
    } catch (e) {
      threw = true;
      expect(e).not.toBeInstanceOf(EzcorpApiError);
    }
    expect(threw).toBe(true);
  });
});

describe("EzcorpClient — SSE streaming", () => {
  test("streamEvents yields emitted frames in order", async () => {
    const ac = new AbortController();
    const received: string[] = [];
    const task = (async () => {
      for await (const ev of client.streamEvents({ signal: ac.signal })) {
        received.push(ev.type);
        if (ev.type === "run:complete") break;
      }
    })();
    // Allow client to establish before we emit
    await new Promise((r) => setTimeout(r, 20));
    server.emit({ type: "run:start", data: { runId: "r1" } });
    server.emit({ type: "run:token", data: { runId: "r1", token: "hi" } });
    server.emit({ type: "run:complete", data: { runId: "r1" } });
    await task;
    ac.abort();
    expect(received).toEqual(["run:start", "run:token", "run:complete"]);
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
    const stubbed = new EzcorpClient({
      baseUrl: server.url,
      fetch: (async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })) as unknown as typeof fetch,
    });
    for await (const ev of stubbed.streamEvents()) {
      expect(ev.type).toBe("run:start");
      break;
    }
    expect(cancelled).toBe(true);
  });
});
