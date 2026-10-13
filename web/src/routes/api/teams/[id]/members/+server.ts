import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { errorJson } from "$lib/server/http-errors";
import { requireTeamRole } from "$server/auth/middleware";
import {
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
} from "$server/db/queries/teams";
import { getUserById } from "$server/db/queries/users";
import { requireScope } from "$lib/server/security/api-keys";

// Boundary validation. POST adds a member, DELETE removes one. Both
// read `userId`; POST also reads `role` (defaulting to "viewer"). The
// inline 400 messages — `"userId is required"` and `"Invalid role"` —
// are test-pinned, so `role` stays a permissive string in the schema
// and the inline enum check fires for invalid values.
const addMemberSchema = z.object({
  userId: z.string().optional(),
  role: z.string().optional(),
}).strict();

const removeMemberSchema = z.object({
  userId: z.string().optional(),
}).strict();

/** Is `userId` the team's only owner? A team must keep one. */
function isLastOwner(members: { userId: string; role: string }[], userId: string): boolean {
  const owners = members.filter((m) => m.role === "owner");
  return owners.length === 1 && owners[0]!.userId === userId;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const scopeErr = requireScope(locals, "read");
  if (scopeErr) return scopeErr;
  try {
    await requireTeamRole(locals, params.id, "viewer");
    const members = await getTeamMembers(params.id);
    return json({ members });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const scopeErr = requireScope(locals, "admin");
  if (scopeErr) return scopeErr;
  try {
    await requireTeamRole(locals, params.id, "owner");
    const parsed = addMemberSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return errorJson(400, "userId is required");
    }
    const { userId, role = "viewer" } = parsed.data;
    if (!userId) return errorJson(400, "userId is required");
    if (!["owner", "editor", "viewer"].includes(role)) {
      return errorJson(400, "Invalid role");
    }
    if (!(await getUserById(userId))) return errorJson(404, "User not found");
    if (role !== "owner" && isLastOwner(await getTeamMembers(params.id), userId)) {
      return errorJson(400, "Cannot demote the last owner");
    }
    const member = await addTeamMember(params.id, userId, role as "owner" | "editor" | "viewer");
    return json({ member }, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
  const scopeErr = requireScope(locals, "admin");
  if (scopeErr) return scopeErr;
  try {
    await requireTeamRole(locals, params.id, "owner");
    const parsed = removeMemberSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return errorJson(400, "userId is required");
    }
    const { userId } = parsed.data;
    if (!userId) return errorJson(400, "userId is required");

    // Cannot remove last owner
    if (isLastOwner(await getTeamMembers(params.id), userId)) {
      return errorJson(400, "Cannot remove the last owner");
    }

    const removed = await removeTeamMember(params.id, userId);
    if (!removed) return errorJson(404, "Member not found");
    return json({ success: true });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
};
