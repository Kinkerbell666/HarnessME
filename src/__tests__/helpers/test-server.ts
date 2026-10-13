import type { AgentExecutor } from "../../runtime/executor";
import type { EventBus } from "../../runtime/events";
import type { AgentEvents } from "../../types";

// Use dynamic require() inside handlers to always resolve from the current
// mock.module() state.  Static ESM imports can go stale when restoreModuleMocks()
// runs in another test file's afterAll (Bun shares one module cache across all files).
function getProjectQueries() { return require("../../db/queries/projects"); }
function getSettingQueries() { return require("../../db/queries/settings"); }
function getConvQueries() { return require("../../db/queries/conversations"); }
function getObsQueries() { return require("../../db/queries/observability"); }
function getAgentConfigQueries() { return require("../../db/queries/agent-configs"); }
function getExportLib() { return require("../../lib/export"); }

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** This server has no sessions; a test names the acting user with this header. */
export const TEST_USER_HEADER = "x-test-user-id";

function testUserId(req: Request): string | undefined {
  return req.headers.get(TEST_USER_HEADER) ?? undefined;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export async function startTestServer(
  port: number,
  executor: AgentExecutor,
  bus: EventBus<AgentEvents>,
): Promise<ReturnType<typeof Bun.serve>> {
  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",

    fetch(req, server) {
      const url = new URL(req.url);
      const { pathname } = url;
      const method = req.method;

      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      if (pathname === "/ws") {
        const upgraded = server.upgrade(req);
        if (upgraded) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (method === "GET" && pathname === "/api/agents") {
        return (async () => {
          const fileAgents = executor.listAgents();
          const dbConfigs = (await getAgentConfigQueries().listAgentConfigs()) as Array<Record<string, unknown>>;
          const dbConfigMap = new Map(dbConfigs.map((c) => [c.name, c]));

          const agents = fileAgents.map((a) => {
            const config = dbConfigMap.get(a.name);
            return {
              name: a.name,
              description: a.description,
              capabilities: a.capabilities,
              inputSchema: a.inputSchema,
              source: config ? "config" : "file",
              id: config?.id ?? null,
              prompt: config?.prompt ?? null,
              category: config?.category ?? null,
            };
          });
          return json(agents);
        })();
      }

      if (method === "GET" && pathname === "/api/runs") {
        return (async () => {
          const projectId = url.searchParams.get("projectId") ?? undefined;
          return json(await executor.listRuns(projectId));
        })();
      }

      const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (method === "GET" && runMatch) {
        return (async () => {
          const run = await executor.getRun(runMatch[1]!);
          if (!run) return json({ error: "Not found" }, 404);
          return json(run);
        })();
      }

      const agentRunMatch = pathname.match(/^\/api\/agents\/([^/]+)\/run$/);
      if (method === "POST" && agentRunMatch) {
        const agentName = agentRunMatch[1]!;
        return (async () => {
          try {
            const body = (await req.json()) as Record<string, unknown>;
            const { projectId, ...input } = body;
            const run = await executor.runAgent(
              agentName,
              input,
              typeof projectId === "string" ? projectId : undefined,
            );
            return json(run);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return json({ error: message }, 400);
          }
        })();
      }

      if (method === "GET" && pathname === "/api/projects") {
        return (async () => json(await getProjectQueries().listProjects()))();
      }

      if (method === "POST" && pathname === "/api/projects") {
        return (async () => {
          const body = (await req.json()) as { name: string; path: string; icon?: string | null; variables?: Record<string, unknown> };
          if (!body.name || !body.path) return json({ error: "name and path required" }, 400);
          return json(await getProjectQueries().createProject(body), 201);
        })();
      }

      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch) {
        const id = projectMatch[1]!;
        if (method === "GET") {
          return (async () => {
            const project = await getProjectQueries().getProject(id);
            if (!project) return json({ error: "Not found" }, 404);
            return json(project);
          })();
        }
        if (method === "PUT") {
          return (async () => {
            const body = (await req.json()) as Partial<{ name: string; path: string; icon: string | null; variables: Record<string, unknown> }>;
            const updated = await getProjectQueries().updateProject(id, body);
            if (!updated) return json({ error: "Not found" }, 404);
            return json(updated);
          })();
        }
        if (method === "DELETE") {
          return (async () => {
            const deleted = await getProjectQueries().deleteProject(id);
            if (!deleted) return json({ error: "Not found" }, 404);
            return json({ ok: true });
          })();
        }
      }

      if (method === "GET" && pathname === "/api/favicon") {
        return (async () => {
          const rawUrl = url.searchParams.get("url");
          if (!rawUrl) return json({ error: "url parameter required" }, 400);
          try {
            const domain = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`).hostname;
            const faviconRes = await fetch(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
            if (!faviconRes.ok) return json({ error: "Failed to fetch favicon" }, 502);
            const buf = await faviconRes.arrayBuffer();
            const base64 = Buffer.from(buf).toString("base64");
            return json({ icon: `data:image/png;base64,${base64}` });
          } catch {
            return json({ error: "Invalid URL" }, 400);
          }
        })();
      }

      if (method === "GET" && pathname === "/api/settings") {
        return (async () => json(await getSettingQueries().getAllSettings()))();
      }

      const settingMatch = pathname.match(/^\/api\/settings\/([^/]+)$/);
      if (settingMatch) {
        const key = settingMatch[1]!;
        if (method === "GET") {
          return (async () => {
            const value = await getSettingQueries().getSetting(key);
            if (value === undefined) return json({ error: "Not found" }, 404);
            return json({ value });
          })();
        }
        if (method === "PUT") {
          return (async () => {
            const body = (await req.json()) as { value: unknown };
            if (body.value === undefined) return json({ error: "value required" }, 400);
            await getSettingQueries().upsertSetting(key, body.value);
            return json({ ok: true });
          })();
        }
        if (method === "DELETE") {
          return (async () => {
            const deleted = await getSettingQueries().deleteSetting(key);
            if (!deleted) return json({ error: "Not found" }, 404);
            return json({ ok: true });
          })();
        }
      }

      // ── Conversations ──────────────────────────────────────────────
      if (method === "GET" && pathname === "/api/conversations") {
        return (async () => {
          const projectId = url.searchParams.get("projectId");
          if (!projectId) return json({ error: "projectId required" }, 400);
          const search = url.searchParams.get("search");
          if (search) {
            return json(await getConvQueries().searchConversations(projectId, search));
          }
          return json(await getConvQueries().listConversations(projectId));
        })();
      }

      if (method === "POST" && pathname === "/api/conversations") {
        return (async () => {
          const body = (await req.json()) as { projectId: string; title?: string; model?: string; provider?: string; agentConfigId?: string; test?: boolean };
          if (!body.projectId) return json({ error: "projectId required" }, 400);

          let systemPrompt: string | undefined;
          let title: string | undefined = body.title;

          if (body.agentConfigId) {
            const agentConfig = await getAgentConfigQueries().getAgentConfig(body.agentConfigId);
            if (!agentConfig) return json({ error: "Agent config not found" }, 404);
            systemPrompt = agentConfig.prompt;
            if (!title) title = `Chat with ${agentConfig.name}`;
          }

          return json(await getConvQueries().createConversation(body.projectId, {
            title,
            model: body.model,
            provider: body.provider,
            agentConfigId: body.agentConfigId,
            systemPrompt,
            test: body.test,
            userId: testUserId(req),
          }), 201);
        })();
      }

      const convMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);
      if (convMatch) {
        const id = convMatch[1]!;
        if (method === "GET") {
          return (async () => {
            const conv = await getConvQueries().getConversation(id);
            if (!conv) return json({ error: "Not found" }, 404);
            return json(conv);
          })();
        }
        if (method === "PUT") {
          return (async () => {
            const body = (await req.json()) as Partial<{ title: string; model: string; provider: string; systemPrompt: string }>;
            const updated = await getConvQueries().updateConversation(id, body);
            if (!updated) return json({ error: "Not found" }, 404);
            return json(updated);
          })();
        }
        if (method === "DELETE") {
          return (async () => {
            const deleted = await getConvQueries().deleteConversation(id);
            if (!deleted) return json({ error: "Not found" }, 404);
            return new Response(null, { status: 204 });
          })();
        }
      }

      const msgMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (msgMatch) {
        const convId = msgMatch[1]!;
        if (method === "GET") {
          return (async () => {
            const all = url.searchParams.get("all");
            if (all === "true") {
              return json(await getConvQueries().getMessages(convId));
            }
            const leafMessageId = url.searchParams.get("leafMessageId");
            if (leafMessageId) {
              return json(await getConvQueries().getConversationPath(leafMessageId, convId));
            }
            const leaf = await getConvQueries().getLatestLeaf(convId);
            if (!leaf) return json([]);
            return json(await getConvQueries().getConversationPath(leaf.id, convId));
          })();
        }
        if (method === "POST") {
          return (async () => {
            const body = (await req.json()) as {
              content: string;
              provider?: string;
              model?: string;
              parentMessageId?: string;
              editOf?: string;
            };
            if (!body.content) return json({ error: "content required" }, 400);

            const conv = await getConvQueries().getConversation(convId);
            if (!conv) return json({ error: "Conversation not found" }, 404);

            let parentMessageId = body.parentMessageId;

            // Handle edit: create sibling of the edited message (same parent)
            if (body.editOf) {
              const allMessages = (await getConvQueries().getMessages(convId)) as Array<Record<string, unknown>>;
              const editedMsg = allMessages.find((m) => m.id === body.editOf);
              if (editedMsg) {
                parentMessageId = (editedMsg.parentMessageId ?? undefined) as string | undefined;
              }
            }

            const userMessage = await getConvQueries().createMessage(convId, {
              role: "user",
              content: body.content,
              parentMessageId,
            });

            const runId = crypto.randomUUID();
            const provider = body.provider ?? conv.provider ?? undefined;
            const model = body.model ?? conv.model ?? undefined;

            // Start streaming in background
            const streamPromise = executor.streamChat(convId, body.content, {
              projectId: conv.projectId,
              provider,
              model,
              runId,
              parentMessageId: userMessage.id,
              agentConfigId: conv.agentConfigId ?? undefined,
            });

            // Assistant message is now persisted by the executor before run:complete
            streamPromise.catch((err) => {
              console.error("[test-server] streamChat error:", err instanceof Error ? err.message : err);
            });

            return json({ userMessage, runId });
          })();
        }
      }

      // ── Export ──────────────────────────────────────────────────
      const exportMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/export$/);
      if (method === "GET" && exportMatch) {
        const convId = exportMatch[1]!;
        return (async () => {
          const conv = await getConvQueries().getConversation(convId);
          if (!conv) return json({ error: "Not found" }, 404);

          const leafMessageId = url.searchParams.get("leafMessageId");
          let msgs: unknown[];
          if (leafMessageId) {
            msgs = await getConvQueries().getConversationPath(leafMessageId, convId);
          } else {
            const leaf = await getConvQueries().getLatestLeaf(convId);
            msgs = leaf
              ? await getConvQueries().getConversationPath(leaf.id, convId)
              : [];
          }

          const format = url.searchParams.get("format") ?? "markdown";

          if (format === "json") {
            const content = getExportLib().exportToJson(conv, msgs);
            return new Response(content, {
              headers: {
                "Content-Type": "application/json",
                "Content-Disposition": `attachment; filename="export.json"`,
                ...CORS_HEADERS,
              },
            });
          }

          const content = getExportLib().exportToMarkdown(conv, msgs);
          return new Response(content, {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Content-Disposition": `attachment; filename="export.md"`,
              ...CORS_HEADERS,
            },
          });
        })();
      }

      if (method === "GET" && pathname === "/api/fs/list") {
        return (async () => {
          const { readdir } = await import("node:fs/promises");
          const home = process.env.HOME ?? "/";
          const raw = url.searchParams.get("dir") ?? home;
          const dir = raw.startsWith("~") ? raw.replace("~", home) : raw;
          const showHidden = url.searchParams.get("hidden") === "1";
          try {
            const dirents = await readdir(dir, { withFileTypes: true });
            const entries = dirents
              .filter((d) => showHidden || !d.name.startsWith("."))
              .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
              .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
            return json(entries);
          } catch {
            return json([], 200);
          }
        })();
      }

      // ── Observability ──────────────────────────────────────────────
      const obsConvMatch = pathname.match(/^\/api\/observability\/conversations\/([^/]+)$/);
      if (method === "GET" && obsConvMatch) {
        const convId = obsConvMatch[1]!;
        return (async () => json(await getObsQueries().getConversationObservability(convId)))();
      }

      const obsStatsMatch = pathname.match(/^\/api\/observability\/conversations\/([^/]+)\/stats$/);
      if (method === "GET" && obsStatsMatch) {
        const convId = obsStatsMatch[1]!;
        return (async () => json(await getObsQueries().getConversationStats(convId)))();
      }

      if (method === "GET" && pathname === "/api/observability/stats") {
        return (async () => {
          const days = url.searchParams.get("days");
          return json(await getObsQueries().getGlobalStats(days ? { days: Number(days) } : undefined));
        })();
      }

      // ── Sandbox Test Conversations ────────────────────────────────
      const testConvMatch = pathname.match(/^\/api\/agents\/([^/]+)\/test-conversations$/);
      if (testConvMatch) {
        const agentConfigId = testConvMatch[1]!;
        // Per-user like the real route: the caller names itself by header.
        const userId = testUserId(req);
        if (!userId) return json({ error: "Authentication required" }, 401);
        if (method === "GET") {
          return (async () => json(await getConvQueries().getTestConversations(agentConfigId, userId)))();
        }
        if (method === "DELETE") {
          return (async () => {
            const count = await getConvQueries().deleteTestConversations(agentConfigId, userId);
            return json({ deleted: count });
          })();
        }
      }

      return json({ error: "Not found" }, 404);
    },

    websocket: {
      open(ws) {
        ws.subscribe("events");
      },
      message() {},
      close(ws) {
        ws.unsubscribe("events");
      },
    },
  });

  for (const event of ["run:start", "run:status", "run:log", "run:complete", "run:error", "run:cancel", "run:token", "run:usage"] as const) {
    bus.on(event, (data) => {
      server.publish("events", JSON.stringify({ type: event, data }));
    });
  }

  return server;
}
