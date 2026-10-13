import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { requireAuth } from "$server/auth/middleware";
import { getUserById, updateUserPassword } from "$server/db/queries/users";
import { verifyPassword, hashPassword } from "$server/auth/password";
import { insertAuditEntry } from "$server/db/queries/audit-log";
import { validationError, passwordSchema as passwordFieldSchema } from "$lib/server/security/validation";
import { requireScope } from "$lib/server/security/api-keys";
import { errorJson } from "$lib/server/http-errors";

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordFieldSchema,
});

export const PUT: RequestHandler = async ({ request, locals }) => {
  try {
    const scopeErr = requireScope(locals, "admin");
    if (scopeErr) return scopeErr;
    const authUser = requireAuth(locals);
    const result = passwordSchema.safeParse(await request.json());
    if (!result.success) return validationError(result.error);

    const { currentPassword, newPassword } = result.data;

    const user = await getUserById(authUser.id);
    if (!user) return errorJson(404, "User not found");

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return errorJson(400, "Current password is incorrect");
    }

    const newHash = await hashPassword(newPassword);
    // Keep this tab's session; every other session of the user is revoked.
    await updateUserPassword(authUser.id, newHash, { keepSessionId: locals.sessionId });
    await insertAuditEntry(authUser.id, "auth:password_changed");

    return json({ success: true, message: "Password changed. Other sessions were signed out." });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
};
