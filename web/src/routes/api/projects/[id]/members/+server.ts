import { json } from "@sveltejs/kit";
import { z } from "zod";
import * as memberQueries from "$server/db/queries/project-members";
import { getProject } from "$server/db/queries/projects";
import { getUserById } from "$server/db/queries/users";
import { checkProjectRole } from "$server/auth/middleware";
import { requireScope } from "$lib/server/security/api-keys";
import { errorJson } from "$lib/server/http-errors";
import { lastOwnerConflict } from "./_owner-guard";
import { PROJECT_MEMBER_ROLES } from "$server/db/schema";
import type { RequestHandler } from "./$types";

/**
 * The WRITER for `project_members` — the thing that makes the table a
 * membership model rather than an owner column with extra steps.
 *
 * Without this route a project has exactly one member forever (its creator,
 * stamped by `createProject`), the `member` role has no producer at all, and
 * the read/run audience `project-members-and-admins` in
 * `src/runtime/workflow-scope.ts` admits a set nobody can join. A rung of a
 * ladder that no code path can put a principal on is the exact defect that
 * module's header calls out about `visibility: "private"`.
 *
 * ## Who may do what
 *
 * | verb   | gate            | why |
 * |--------|-----------------|-----|
 * | GET    | `member`        | knowing who else is on a project you are on |
 * | POST   | **`owner`**     | granting authority is the narrower right |
 *
 * `checkProjectRole` lets instance admins bypass, so an admin can always
 * repair a project's membership — including one whose only owner was
 * deleted (their rows CASCADE away).
 *
 * The 404-before-403 ordering matters: a caller who is not a member must not
 * be able to tell a real project id from a fabricated one through the
 * SHAPE of the refusal... except that they already can, because `GET
 * /api/projects` is instance-global and unfiltered. So the ordering here is
 * the honest one instead: the project's existence is checked FIRST and a
 * missing project is a plain 404, because pretending otherwise would protect
 * nothing the list route does not already publish.
 */

const addMemberSchema = z
  .object({
    userId: z.string().min(1),
    // The vocabulary comes from the schema module, not a hand-written enum
    // — a second copy of the role list is a second thing to forget to
    // update. `z.enum` needs a mutable tuple, hence the spread.
    role: z.enum([...PROJECT_MEMBER_ROLES]).optional(),
  })
  .strict();

export const GET: RequestHandler = async ({ params, locals }) => {
  const scopeErr = requireScope(locals, "read");
  if (scopeErr) return scopeErr;
  const project = await getProject(params.id);
  if (!project) return errorJson(404, "Not found");
  const gate = await checkProjectRole(locals, params.id, "member");
  if (gate instanceof Response) return gate;
  return json(await memberQueries.listProjectMembers(params.id));
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
  const scopeErr = requireScope(locals, "write");
  if (scopeErr) return scopeErr;
  const project = await getProject(params.id);
  if (!project) return errorJson(404, "Not found");
  const gate = await checkProjectRole(locals, params.id, "owner");
  if (gate instanceof Response) return gate;

  const parsed = addMemberSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorJson(400, "userId required");

  // The target must be a REAL user. Without this an owner could write a
  // membership row for any string, and the FK would only catch it because
  // `user_id` happens to reference `users` — a 500 where a 404 belongs.
  const target = await getUserById(parsed.data.userId);
  if (!target) return errorJson(404, "User not found");

  const role = parsed.data.role ?? "member";
  const conflict = await lastOwnerConflict(params.id, parsed.data.userId, role);
  if (conflict) return conflict;

  const member = await memberQueries.upsertProjectMember(
    params.id,
    parsed.data.userId,
    role,
  );
  return json(member, { status: 201 });
};
