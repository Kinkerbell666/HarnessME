import * as memberQueries from "$server/db/queries/project-members";
import type { ProjectMemberRole } from "$server/db/schema";
import { errorJson } from "$lib/server/http-errors";

/**
 * The 409 for a change that would leave a project with members but no
 * owner, or undefined. `nextRole` is the target's new role; omit it for a
 * removal. Without an owner nobody can grant authority on the project except
 * through the instance-admin override — the stranding the last-member rule
 * already refuses.
 */
export async function lastOwnerConflict(
  projectId: string,
  userId: string,
  nextRole?: ProjectMemberRole,
): Promise<Response | undefined> {
  if (nextRole === "owner") return undefined;
  const membership = await memberQueries.getProjectMembership(userId, projectId);
  if (membership?.role !== "owner") return undefined;
  if (await memberQueries.countProjectMembers(projectId, "owner") > 1) return undefined;
  return errorJson(409, "A project must keep at least one owner");
}
