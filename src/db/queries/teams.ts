import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "../connection";
import { teams, teamMembers, users } from "../schema";
import type { Team, TeamMember } from "../schema";

export type { Team, TeamMember };

export async function createTeam(name: string): Promise<Team> {
  const rows = await getDb().insert(teams).values({ name }).returning();
  return rows[0]!;
}

export async function getTeam(id: string): Promise<Team | undefined> {
  const rows = await getDb().select().from(teams).where(eq(teams.id, id));
  return rows[0];
}

export async function listTeams(): Promise<Team[]> {
  return getDb().select().from(teams);
}

export async function updateTeamName(id: string, name: string): Promise<Team | undefined> {
  const rows = await getDb().update(teams).set({ name }).where(eq(teams.id, id)).returning();
  return rows[0];
}

export async function deleteTeam(id: string): Promise<boolean> {
  const rows = await getDb().delete(teams).where(eq(teams.id, id)).returning();
  return rows.length > 0;
}

/** Add a member, or set the role of an existing one (unique on team + user). */
export async function addTeamMember(
  teamId: string,
  userId: string,
  role: "owner" | "editor" | "viewer",
): Promise<TeamMember> {
  const rows = await getDb()
    .insert(teamMembers)
    .values({ teamId, userId, role })
    .onConflictDoUpdate({ target: [teamMembers.teamId, teamMembers.userId], set: { role } })
    .returning();
  return rows[0]!;
}

export async function removeTeamMember(teamId: string, userId: string): Promise<boolean> {
  const rows = await getDb()
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .returning();
  return rows.length > 0;
}

export async function updateTeamMemberRole(
  teamId: string,
  userId: string,
  role: "owner" | "editor" | "viewer",
): Promise<boolean> {
  const rows = await getDb()
    .update(teamMembers)
    .set({ role })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .returning();
  return rows.length > 0;
}

export async function getTeamMembers(
  teamId: string,
): Promise<(TeamMember & { userName: string; userEmail: string })[]> {
  const rows = await getDb()
    .select({
      id: teamMembers.id,
      teamId: teamMembers.teamId,
      userId: teamMembers.userId,
      role: teamMembers.role,
      createdAt: teamMembers.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));
  return rows as (TeamMember & { userName: string; userEmail: string })[];
}

export async function getUserTeams(userId: string): Promise<(Team & { role: string })[]> {
  const rows = await getDb()
    .select({
      id: teams.id,
      name: teams.name,
      createdAt: teams.createdAt,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teamMembers.userId, userId));
  return rows as (Team & { role: string })[];
}

export async function getTeamMembership(
  userId: string,
  teamId: string,
): Promise<TeamMember | undefined> {
  const rows = await getDb()
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId)));
  return rows[0];
}

/**
 * Batched variant of {@link getTeamMembership}. Returns a Map keyed by
 * `teamId`. Teams the user is not a member of map to `null` so callers
 * can branch identically to the per-call form (which returns
 * `undefined`). Internally dedupes `teamIds` to keep the SQL `IN (...)`
 * list tight; the returned Map is always keyed by every input id, even
 * duplicates.
 */
// fallow-ignore-next-line unused-export
export async function getTeamMembershipsByTeams(
  userId: string,
  teamIds: string[],
): Promise<Map<string, TeamMember | null>> {
  const result = new Map<string, TeamMember | null>();
  if (teamIds.length === 0) return result;
  const uniqueIds = Array.from(new Set(teamIds));
  const rows = await getDb()
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        inArray(teamMembers.teamId, uniqueIds),
      ),
    );
  const byTeam = new Map<string, TeamMember>();
  for (const row of rows) byTeam.set(row.teamId, row);
  for (const id of teamIds) {
    result.set(id, byTeam.get(id) ?? null);
  }
  return result;
}
