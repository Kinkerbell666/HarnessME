/**
 * Client-side role gates. `requireAdmin` guards the `/settings/admin*` pages
 * (locked decision 1); `canDeleteProject` hides the project Delete control
 * from callers the API would refuse. Both fail closed: any error reads as
 * "not allowed". Pure fetch logic — testable without Svelte.
 */
export interface CurrentUser {
	id: string;
	email: string;
	name: string;
	role: "admin" | "member";
}

async function fetchCurrentUser(): Promise<CurrentUser | null> {
	try {
		const res = await fetch("/api/auth/me");
		if (!res.ok) return null;
		const data = await res.json();
		return (data?.user as CurrentUser | undefined) ?? null;
	} catch {
		return null;
	}
}

/** Resolves the current user only when they are an admin. */
export async function requireAdmin(): Promise<CurrentUser | null> {
	const user = await fetchCurrentUser();
	return user?.role === "admin" ? user : null;
}

/**
 * Mirrors `DELETE /api/projects/:id`, which needs the project `owner` role
 * or an instance admin (`checkProjectRole`).
 */
export async function canDeleteProject(projectId: string): Promise<boolean> {
	const user = await fetchCurrentUser();
	if (!user) return false;
	if (user.role === "admin") return true;
	try {
		const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members`);
		if (!res.ok) return false;
		const members = (await res.json()) as { userId: string; role: string }[];
		return members.some((member) => member.userId === user.id && member.role === "owner");
	} catch {
		return false;
	}
}
