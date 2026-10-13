import { json } from "@sveltejs/kit";
import { z } from "zod";
import * as projectQueries from "$server/db/queries/projects";
import { requireAuth, checkProjectRole } from "$server/auth/middleware";
import { requireScope } from "$lib/server/security/api-keys";
import { projectPathSchema } from "$lib/server/security/validation";
import { errorJson } from "$lib/server/http-errors";
import { projectRequiresSandbox } from "$server/runtime/workspace/target";
import type { RequestHandler } from "./$types";

/**
 * Authorization model for projects: PROJECT MEMBERSHIP, with an instance
 * -admin override.
 *
 * This route used to gate PUT/DELETE on `user.role === "admin"`, and said so
 * at length, because there was nothing else to gate on: `projects` had no
 * owner column and no `project_members` table, so "let the person who made
 * it rename it" was not expressible. PR #82 shipped that stop-gap knowing it
 * broke a real case — the non-admin who created a project could not rename
 * or delete it from `/project/[id]/settings`.
 *
 * `project_members` (`src/db/schema.ts`) is now that model, so the rule is
 * the one the product actually wanted:
 *
 *   | caller                      | GET | PUT | DELETE |
 *   |-----------------------------|-----|-----|--------|
 *   | instance admin              | yes | yes | yes    |
 *   | project owner               | yes | yes | yes    |
 *   | project member              | yes | yes | **no** |
 *   | authenticated non-member    | yes | **no** | **no** |
 *
 * DELETE needs `owner` because it cascades to every member's conversations.
 *
 * `createProject` stamps its creator as an `owner`, so the case #82 broke —
 * a member renaming the project they just made — is the FIRST case this
 * covers rather than an afterthought.
 *
 * READS ARE DELIBERATELY NOT NARROWED, and the asymmetry in that table is
 * the point rather than an oversight. `GET /api/projects` returns every
 * project to every authenticated caller, so hiding a single project behind a
 * 404 here would be theatre — the same caller finds it in the list one
 * request later. Filtering the list is a separate, wider change: after the
 * migration's ownerless backfill every pre-existing project is owned by the
 * first admin, so a read filter would show a non-admin an EMPTY project list
 * on any instance that predates this table. That is a data-migration
 * question, not an authorization one, and it is tracked as the open gap it
 * is (pinned by "reads stay instance-global" in
 * `src/__tests__/security/cross-tenant-deletion-projects-kb-modes.test.ts`).
 *
 * 403, not the 404 used by the sec-H3 routes: those collapse denial into
 * "not found" to avoid an id-existence oracle. Projects have no existence to
 * hide — see above — so a 404 would misreport a project that plainly exists
 * and that this same caller may read.
 *
 * The gate itself is `checkProjectRole` in `src/auth/middleware.ts`, next to
 * `requireTeamRole`, so the membership read lives with the other membership
 * read rather than in a route.
 */

// Boundary validation for project update. The handler accepts a
// partial of the same fields the POST handler uses. `.strict()`
// rejects unknown fields — `updateProject` only reads these four.
const updateProjectSchema = z.object({
  name: z.string().optional(),
  path: z.string().optional(),
  icon: z.string().nullable().optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const GET: RequestHandler = async ({ params, locals }) => {
  const scopeErr = requireScope(locals, "read");
  if (scopeErr) return scopeErr;
  requireAuth(locals);
  const project = await projectQueries.getProject(params.id);
  if (!project) return errorJson(404, "Not found");
  return json(project);
};

export const PUT: RequestHandler = async ({ request, params, locals }) => {
  const scopeErr = requireScope(locals, "write");
  if (scopeErr) return scopeErr;
  const gate = await checkProjectRole(locals, params.id, "member");
  if (gate instanceof Response) return gate;
  if (await projectRequiresSandbox(params.id)) return errorJson(409, "Sandbox projects cannot be edited through project settings.");
  const parsed = updateProjectSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return errorJson(400, "Invalid request body");
  }
  // Same shape rule as POST — an edit can corrupt `path` exactly as a create
  // can, and this route is how a project gets REPOINTED at a bad directory.
  if (parsed.data.path !== undefined) {
    const path = projectPathSchema.safeParse(parsed.data.path);
    if (!path.success) {
      return errorJson(400, path.error.issues[0]?.message ?? "Invalid project path");
    }
  }
  const updated = await projectQueries.updateProject(params.id, parsed.data);
  if (!updated) return errorJson(404, "Not found");
  return json(updated);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const scopeErr = requireScope(locals, "write");
  if (scopeErr) return scopeErr;
  // Owner, not member: deleting a project deletes every member's conversations.
  const gate = await checkProjectRole(locals, params.id, "owner");
  if (gate instanceof Response) return gate;
  if (await projectRequiresSandbox(params.id)) return errorJson(409, "Dispose the sandbox before deleting its project.");
  const deleted = await projectQueries.deleteProject(params.id);
  if (!deleted) return errorJson(404, "Not found");
  return json({ ok: true });
};
