import { json } from "@sveltejs/kit";
import { getGlobalStats } from "$server/db/queries/observability";
import { requireAuth } from "$server/auth/middleware";
import { requireScope } from "$lib/server/security/api-keys";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
  try {
    const scopeErr = requireScope(locals, "read");
    if (scopeErr) return scopeErr;
    const user = requireAuth(locals);
    const days = parseInt(url.searchParams.get("days") ?? "30", 10);
    // An admin sees every user's totals; anyone else, only their own
    // conversations. `scope` tells the dashboard which one it got.
    const isAdmin = user.role === "admin";
    const stats = await getGlobalStats({
      days: Number.isNaN(days) ? 30 : days,
      ...(isAdmin ? {} : { userId: user.id }),
    });
    return json({ ...stats, scope: isAdmin ? "all" : "own" });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
};
