import type { FactoryInboxEnvelope } from "./contracts.ts";
import { MAX_INBOX_EVENTS } from "./contracts.ts";
import { validateInboxEnvelope } from "./validation.ts";

export interface FactoryInboxAcceptance {
  readonly accepted?: FactoryInboxEnvelope;
  readonly error?: string;
  readonly overflow: boolean;
}

export function acceptFactoryInbox(
  delivery: unknown,
  acknowledgedSequence: number,
  pending: Map<number, FactoryInboxEnvelope>,
): FactoryInboxAcceptance {
  try {
    validateInboxEnvelope(delivery);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "factory inbox signal is invalid", overflow: false };
  }
  if (delivery.sequence <= acknowledgedSequence) return { overflow: false };
  const sameSequence = pending.get(delivery.sequence);
  if (sameSequence) {
    return sameSequence.eventId === delivery.eventId && sameSequence.eventHash === delivery.eventHash
      ? { overflow: false }
      : { error: "factory inbox sequence has conflicting identities", overflow: false };
  }
  for (const existing of pending.values()) {
    if (existing.eventId === delivery.eventId && existing.eventHash !== delivery.eventHash) return { error: "factory inbox event ID has conflicting hashes", overflow: false };
  }
  if (pending.size >= MAX_INBOX_EVENTS || delivery.sequence > acknowledgedSequence + MAX_INBOX_EVENTS) return { overflow: true };
  pending.set(delivery.sequence, delivery);
  return { accepted: delivery, overflow: false };
}
