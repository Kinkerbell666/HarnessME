/**
 * The single source of truth mapping each `HarnessClient` method to the HTTP
 * method + path template it drives. Every method in `index.ts` consumes this
 * table (via the private `route()` helper or `buildPath()` directly) so a path
 * string is written exactly once — no inline duplication between the method and
 * its tests, and no drift between what the client calls and what the server
 * registers.
 *
 * The governance route-contract meta-test imports `HARNESS_ROUTES` to enforce
 * the controllable⇄client contract both ways: every `harness.controllable`
 * registry entry has a client route here, and every client route here is a
 * registered controllable route. Two carve-outs that check must apply:
 *   - `getRun` and `awaitRun` intentionally share `GET /api/runs/:id` (dedupe
 *     by `{httpMethod, pathTemplate}` before the registry cross-check).
 *   - `/api/__test/**` entries (`scriptLlm`, `clearLlmScripts`) are the
 *     determinism tier: gated by `isTestSurfaceEnabled`, never in the registry.
 *     Exclude the `/api/__test/` prefix from the registry cross-check.
 */

export interface HarnessRoute {
  httpMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Express-style template (`:param` segments), matching `src/api-registry.ts`
   *  path strings so the two can be compared directly. */
  pathTemplate: string;
}

export const HARNESS_ROUTES = {
  // Factory definition authoring (human-only publish and grant mutations are
  // deliberately absent because a HarnessClient authenticates with a key).
  listFactoryDefinitions: { httpMethod: "GET", pathTemplate: "/api/factories/projects/:projectId/definitions" },
  createFactoryDraft: { httpMethod: "POST", pathTemplate: "/api/factories/projects/:projectId/definitions" },
  importFactoryDraft: { httpMethod: "POST", pathTemplate: "/api/factories/projects/:projectId/definitions/import" },
  getFactoryDraft: { httpMethod: "GET", pathTemplate: "/api/factories/projects/:projectId/definitions/:factoryId" },
  updateFactoryDraft: { httpMethod: "PUT", pathTemplate: "/api/factories/projects/:projectId/definitions/:factoryId" },
  archiveFactoryDraft: { httpMethod: "DELETE", pathTemplate: "/api/factories/projects/:projectId/definitions/:factoryId" },
  exportFactoryDraft: { httpMethod: "GET", pathTemplate: "/api/factories/projects/:projectId/definitions/:factoryId/export" },
  validateFactoryDraft: { httpMethod: "POST", pathTemplate: "/api/factories/projects/:projectId/definitions/:factoryId/validate" },
  listFactoryVersions: { httpMethod: "GET", pathTemplate: "/api/factories/projects/:projectId/definitions/:factoryId/versions" },
  getFactoryVersion: { httpMethod: "GET", pathTemplate: "/api/factories/projects/:projectId/definitions/:factoryId/versions/:version" },
  listFactoryGrants: { httpMethod: "GET", pathTemplate: "/api/factories/projects/:projectId/grants" },
  startFactoryRun: { httpMethod: "POST", pathTemplate: "/api/factories/projects/:projectId/definitions/:factoryId/runs" },
  listFactoryRuns: { httpMethod: "GET", pathTemplate: "/api/factories/projects/:projectId/runs" },
  getFactoryRun: { httpMethod: "GET", pathTemplate: "/api/factories/projects/:projectId/runs/:runId" },
  controlFactoryRun: { httpMethod: "POST", pathTemplate: "/api/factories/projects/:projectId/runs/:runId/control" },
  getFactoryCommand: { httpMethod: "GET", pathTemplate: "/api/factories/projects/:projectId/runs/:runId/commands/:commandId" },
  extensionControl: { httpMethod: "POST", pathTemplate: "/api/extensions/control" },
  // Configure
  getSetting: { httpMethod: "GET", pathTemplate: "/api/settings/:key" },
  setSetting: { httpMethod: "PUT", pathTemplate: "/api/settings/:key" },
  // Provisioning: mint a (optionally policy-confined) child key
  mintApiKey: { httpMethod: "POST", pathTemplate: "/api/settings/developer/api-keys" },
  // Conversations + drive
  createConversation: { httpMethod: "POST", pathTemplate: "/api/conversations" },
  sendMessage: { httpMethod: "POST", pathTemplate: "/api/conversations/:id/messages" },
  // Put a conversation under a mode (or clear it) — the write a key minted
  // with `toolPolicy.lockedModeId` needs before its first send.
  updateConversation: { httpMethod: "PUT", pathTemplate: "/api/conversations/:id" },
  // Sessions P4 rewind/checkpoint
  getConversationTree: { httpMethod: "GET", pathTemplate: "/api/conversations/:id/tree" },
  rewindConversation: { httpMethod: "POST", pathTemplate: "/api/conversations/:id/rewind" },
  // Sessions P5 clean A/B retry (sibling assistant, no duplicate user row)
  retryMessage: { httpMethod: "POST", pathTemplate: "/api/conversations/:id/messages/:mid/retry" },
  // Caller-executed tools: declare / inspect / clear, submit a result, and
  // re-drain what is pending after a reconnect.
  declareCallerTools: { httpMethod: "PUT", pathTemplate: "/api/conversations/:id/caller-tools" },
  getCallerTools: { httpMethod: "GET", pathTemplate: "/api/conversations/:id/caller-tools" },
  clearCallerTools: { httpMethod: "DELETE", pathTemplate: "/api/conversations/:id/caller-tools" },
  submitToolResult: { httpMethod: "POST", pathTemplate: "/api/conversations/:id/tool-results" },
  getActiveRun: { httpMethod: "GET", pathTemplate: "/api/conversations/:id/active-run" },
  // Extension lifecycle (admin-role key)
  listExtensions: { httpMethod: "GET", pathTemplate: "/api/extensions" },
  installExtension: { httpMethod: "POST", pathTemplate: "/api/extensions" },
  activateExtension: { httpMethod: "POST", pathTemplate: "/api/extensions/:id/activate" },
  setExtensionEnabled: { httpMethod: "PATCH", pathTemplate: "/api/extensions/:id" },
  uninstallExtension: { httpMethod: "DELETE", pathTemplate: "/api/extensions/:id" },
  updateExtensionPermissions: { httpMethod: "PUT", pathTemplate: "/api/extensions/:id/permissions" },
  // Extension secrets (extensions scope + per-extension RBAC)
  setExtensionSecret: { httpMethod: "POST", pathTemplate: "/api/extensions/:id/secrets" },
  deleteExtensionSecret: { httpMethod: "DELETE", pathTemplate: "/api/extensions/:id/secrets" },
  // Extension wiring + invoke
  wireExtensions: { httpMethod: "POST", pathTemplate: "/api/conversations/:id/extensions" },
  listWiredExtensions: { httpMethod: "GET", pathTemplate: "/api/conversations/:id/extensions" },
  invokeExtensionTool: { httpMethod: "POST", pathTemplate: "/api/tool-invoke" },
  // Hub actions
  triggerHubAction: { httpMethod: "POST", pathTemplate: "/api/hub/pages/:id/actions/:action" },
  // Loops EZ Mode Phase 4 — inbound webhook delivery. PUBLIC (auth is the
  // per-hook token / HMAC, NOT the harness key), so `deliverHook` sends its own
  // headers and never attaches the harness `Authorization`.
  deliverHook: { httpMethod: "POST", pathTemplate: "/api/hooks/:extensionId/:slug" },
  // Runs
  getRun: { httpMethod: "GET", pathTemplate: "/api/runs/:id" },
  awaitRun: { httpMethod: "GET", pathTemplate: "/api/runs/:id" },
  cancelRun: { httpMethod: "DELETE", pathTemplate: "/api/runs/:id" },
  // Tool-call permission gates
  resolveToolPermission: { httpMethod: "POST", pathTemplate: "/api/tool-calls/:id/permission" },
  // Deterministic mock LLM (determinism tier — not registry-registered)
  scriptLlm: { httpMethod: "POST", pathTemplate: "/api/__test/mock-llm/script" },
  clearLlmScripts: { httpMethod: "DELETE", pathTemplate: "/api/__test/mock-llm/script" },
  // Observe (SSE)
  streamEvents: { httpMethod: "GET", pathTemplate: "/api/runtime-events" },
} as const satisfies Record<string, HarnessRoute>;

export type HarnessRouteName = keyof typeof HARNESS_ROUTES;

/**
 * Substitute `:param` segments in a route template with percent-encoded values.
 * Each value is `encodeURIComponent`d so a traversal or query-injection attempt
 * in an id stays a single opaque path segment (never a path climb or an
 * injected query param). Throws on a missing param so a refactor that drops an
 * argument fails loudly instead of silently building a wrong path.
 */
export function buildPath(template: string, params: Record<string, string> = {}): string {
  return template.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_full, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`buildPath: missing route param ':${name}' for template ${template}`);
    }
    // The URL parser resolves `.` and `..` even when encoded, so a param that
    // is a whole dot segment would leave its route; an empty one merges two.
    if (value === "" || value === "." || value === "..") {
      throw new Error(`buildPath: invalid route param ':${name}' for template ${template}`);
    }
    return encodeURIComponent(value);
  });
}
