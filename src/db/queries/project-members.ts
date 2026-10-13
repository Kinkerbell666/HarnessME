/**
 * Reads and writes over `project_members` — the project-membership model.
 *
 * The shape deliberately mirrors `db/queries/teams.ts`, because the two
 * answer the same question about different objects and a reader who knows
 * one should not have to learn the other. The one place they differ is
 * {@link listProjectIdsForUser}, which has no team equivalent: the workflow
 * read/run ladder authorizes a PRINCIPAL against a row without a project id
 * in hand, so it needs the caller's whole membership set, not a point
 * lookup.
 *
 * Nothing here decides authorization. These are the reads the gates in
 * `src/auth/middleware.ts` (`checkProjectRole`) and the ladder in
 * `src/runtime/workflow-scope.ts` are built on; keeping the decision out of
 * the query layer is what stops a second, slightly-different copy of the
 * rule appearing next to the SQL.
 */
import { and, eq } from "drizzle-orm";
import { getDb, type DbTransaction } from "../connection";
import { projectMembers, users } from "../schema";
import type { ProjectMember, ProjectMemberRole } from "../schema";

export type { ProjectMember, ProjectMemberRole };

/** A membership row joined to the human it names, for the members list UI. */
export type ProjectMemberWithUser = ProjectMember & {
  userName: string;
  userEmail: string;
};

/**
 * The caller's membership in one project, or `undefined`.
 *
 * `undefined` is the ONLY "not a member" representation — there is no null
 * row and no ownerless sentinel — which is what makes the gate that consumes
 * it fail closed by construction rather than by remembering to.
 */
export async function getProjectMembership(
  userId: string,
  projectId: string,
): Promise<ProjectMember | undefined> {
  const rows = await getDb()
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, projectId)));
  return rows[0];
}

/**
 * Every project id this user belongs to.
 *
 * Server-resolved, and that distinction is the whole reason this exists: the
 * `projectId` a request carries is named BY the caller (a query param or a
 * body field), so comparing it to anything is a boundary the caller
 * controls. This set is read from the DB against the authenticated user id,
 * so it is the one project-scoped fact the ladder may trust.
 */
export async function listProjectIdsForUser(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  return rows.map((r: { projectId: string }) => r.projectId);
}

/** Every member of a project, with the name/email the UI renders. */
export async function listProjectMembers(projectId: string): Promise<ProjectMemberWithUser[]> {
  return getDb()
    .select({
      id: projectMembers.id,
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId));
}

/**
 * Add a member, or update the role of one already there.
 *
 * Upsert rather than insert-or-409 because "add Bob as an owner" is the same
 * user intent whether or not Bob is already a plain member, and the
 * alternative makes the caller do a read-then-write that races. The unique
 * index on `(project_id, user_id)` is the arbiter, so this is a real
 * `ON CONFLICT` — the nullable-scope tables next door cannot do that and use
 * select-then-write instead.
 */
export async function upsertProjectMember(
  projectId: string,
  userId: string,
  role: ProjectMemberRole,
): Promise<ProjectMember> {
  return upsertProjectMemberInTransaction(getDb(), projectId, userId, role);
}

/** Shares the project creator's transaction without duplicating the membership write. */
export async function upsertProjectMemberInTransaction(
  transaction: Pick<DbTransaction, "insert">,
  projectId: string,
  userId: string,
  role: ProjectMemberRole,
): Promise<ProjectMember> {
  const rows = await transaction
    .insert(projectMembers)
    .values({ projectId, userId, role })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { role },
    })
    .returning();
  return rows[0]!;
}

/** Remove a member. `false` when they were not one to begin with. */
export async function removeProjectMember(projectId: string, userId: string): Promise<boolean> {
  const rows = await getDb()
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .returning();
  return rows.length > 0;
}

/**
 * How many members a project has.
 *
 * Used by the remove route to refuse the LAST membership row. A project with
 * no members is reachable only through the instance-admin override, which is
 * exactly the state the migration's backfill exists to prevent — so the API
 * must not be able to create it either. With `role`, counts only members
 * holding it — the routes also refuse to leave a project with no owner.
 */
export async function countProjectMembers(projectId: string, role?: ProjectMemberRole): Promise<number> {
  const rows = await getDb()
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), role ? eq(projectMembers.role, role) : undefined));
  return rows.length;
}
