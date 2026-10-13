import { expect, mock, test } from "bun:test";
import type { TransactionalDb } from "../db/migrations/types";
import { FactoryAssuranceCommands } from "./assurance-commands";
import { FactoryGrantError, type FactoryGrants, type FactoryPrincipal } from "./grants";

const tenantId = "tenant-1";
const actor: FactoryPrincipal = { kind: "user", id: "user-a", authentication: "session" };

function fixture(approvalExists: boolean) {
  const execute = mock(async () => ({ rows: approvalExists ? [{ approval_id: "approval-1", run_id: "run-1" }] : [] }));
  const database = { execute, transaction: async () => { throw new Error("no transaction expected"); } } as unknown as TransactionalDb;
  const grants = { tenantId, authorize: mock(async () => { throw new FactoryGrantError("factory_forbidden"); }) };
  const scoped = { tenantId, assertService: () => {} };
  const commands = new FactoryAssuranceCommands(database, tenantId, grants as unknown as FactoryGrants, scoped as never, scoped as never, scoped as never, { tenantId, subject: "service-1" });
  return { commands, execute, grants };
}

test.each([false, true])("a caller with no approve grant on the project is refused before the approval lookup (approval exists: %p)", async (approvalExists) => {
  const f = fixture(approvalExists);
  const decision = f.commands.decide(actor, "project-of-user-b", "run-1", "approval-1", "a".repeat(64), "approve", 0, "decision-key");
  // The same answer whether or not the approval exists, so another project's approvals cannot be probed.
  await expect(decision).rejects.toMatchObject({ code: "factory_forbidden" });
  expect(f.grants.authorize).toHaveBeenCalledWith(actor, "project-of-user-b", "factory.approve");
  expect(f.execute).not.toHaveBeenCalled();
});
