import { json } from "@sveltejs/kit";
import { getConversationObservability, getConversationStats } from "$server/db/queries/observability";
import { requireAuth } from "$server/auth/middleware";
import { requireScope } from "$lib/server/security/api-keys";
import { errorJson } from "$lib/server/http-errors";
import { resolveRootConversationForOwnership } from "$lib/server/conversation-ownership";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, locals }) => {
  try {
    const scopeErr = requireScope(locals, "read");
    if (scopeErr) return scopeErr;
    const user = requireAuth(locals);
    const { conversationId } = params;
    // IDOR guard: the events carry tool errors and agent result previews.
    // Only the root conversation's owner (or an admin) may read them; anyone
    // else gets the same 404 as an unknown id.
    const ownership = await resolveRootConversationForOwnership(conversationId, user);
    if (!ownership) return errorJson(404, "Not found");
    const [events, stats] = await Promise.all([
      getConversationObservability(conversationId),
      getConversationStats(conversationId),
    ]);
    return json({ events, stats });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
};
