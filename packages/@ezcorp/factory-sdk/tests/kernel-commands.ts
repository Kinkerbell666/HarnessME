import type { KernelCommand } from "../src/kernel-types";

/**
 * The first command of one kind, typed as that kind. `Array.find` with a
 * compound condition does not narrow, so tests reading `nodeId` or
 * `candidateGeneration` off a found command go through here.
 */
export function findCommand<K extends KernelCommand["kind"]>(
  commands: readonly KernelCommand[],
  kind: K,
  nodeId?: string,
): Extract<KernelCommand, { kind: K }> | undefined {
  return commands.find((command): command is Extract<KernelCommand, { kind: K }> =>
    command.kind === kind && (nodeId === undefined || ("nodeId" in command && command.nodeId === nodeId)));
}
