import { json } from "@sveltejs/kit";
import { getAgentConfigByName } from "$server/db/queries/agent-configs";
import { deleteTestConversations, getTestConversations } from "$server/db/queries/conversations";
import { requireAuth } from "$server/auth/middleware";
import { requireScope } from "$lib/server/security/api-keys";
import { errorJson } from "$lib/server/http-errors";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, locals }) => {
  const scopeErr = requireScope(locals, "read");
  if (scopeErr) return scopeErr;
  const user = requireAuth(locals);
  const config = await getAgentConfigByName(params.name);
  if (!config) return errorJson(404, "Agent not found");

  // Agent configs are shared; the query returns only the caller's own rows.
  return json(await getTestConversations(config.id, user.id));
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const scopeErr = requireScope(locals, "chat");
  if (scopeErr) return scopeErr;
  const user = requireAuth(locals);
  const config = await getAgentConfigByName(params.name);
  if (!config) return errorJson(404, "Agent not found");

  const deleted = await deleteTestConversations(config.id, user.id);
  return json({ deleted });
};
