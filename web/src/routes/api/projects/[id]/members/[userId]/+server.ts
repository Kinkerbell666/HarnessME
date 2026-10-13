import { json } from "@sveltejs/kit";
import * as memberQueries from "$server/db/queries/project-members";
import { getProject } from "$server/db/queries/projects";
import { checkProjectRole } from "$server/auth/middleware";
import { requireScope } from "$lib/server/security/api-keys";
import { errorJson } from "$lib/server/http-errors";
import { lastOwnerConflict } from "../_owner-guard";
import type { RequestHandler } from "./$types";

/**
 * Remove a member from a project. `owner` (or an instance admin) only —
 * same rule as adding one, for the same reason: membership is the authority
 * axis, and a plain `member` who could revoke an owner would be able to take
 * a project over.
 *
 * ## The LAST member cannot be removed
 *
 * A project with zero membership rows is reachable only through the
 * instance-admin override. `migrate()`'s ownerless backfill exists precisely
 * to stop that state existing, so the API must not be able to re-create it
 * one DELETE at a time — an owner removing themselves from their own project
 * would silently hand it to the admins and lock every member out.
 *
 * The refusal is a 409, not a 403: the caller HAS the authority, the request
 * is refused because of the state it would leave behind. A 403 would read as
 * "you may not do this", which is the wrong diagnosis and sends the operator
 * looking at roles instead of at the member count.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
  const scopeErr = requireScope(locals, "write");
  if (scopeErr) return scopeErr;
  const project = await getProject(params.id);
  if (!project) return errorJson(404, "Not found");
  const gate = await checkProjectRole(locals, params.id, "owner");
  if (gate instanceof Response) return gate;

  const count = await memberQueries.countProjectMembers(params.id);
  if (count <= 1) {
    return errorJson(409, "A project must keep at least one member");
  }

  const conflict = await lastOwnerConflict(params.id, params.userId);
  if (conflict) return conflict;

  const removed = await memberQueries.removeProjectMember(params.id, params.userId);
  if (!removed) return errorJson(404, "Not found");
  return json({ ok: true });
};
