import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FactoryInboxEnvelope } from "../src/contracts.ts";
import { acceptFactoryInbox, type FactoryInboxAcceptance } from "../src/inbox.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const delivery = (sequence: number, id = `event-${sequence}`, eventHash = digest("a")): FactoryInboxEnvelope => ({
  sequence, eventId: id, eventHash, event: { kind: "repair", id, atMs: 1, nodeId: "node", reason: "test" },
});

const errorOf = (acceptance: FactoryInboxAcceptance): string => {
  assert.ok(acceptance.error !== undefined, "expected the inbox to reject the delivery");
  return acceptance.error;
};

describe("factory product inbox", () => {
  it("accepts a bounded future delivery and ignores acknowledged or exact duplicate input", () => {
    const pending = new Map<number, FactoryInboxEnvelope>();
    const first = delivery(1);
    assert.deepEqual(acceptFactoryInbox(first, 0, pending), { accepted: first, overflow: false });
    assert.deepEqual(acceptFactoryInbox(first, 0, pending), { overflow: false });
    assert.deepEqual(acceptFactoryInbox(first, 1, new Map()), { overflow: false });
  });

  it("rejects malformed, sequence-conflicting, and hash-conflicting input", () => {
    assert.match(errorOf(acceptFactoryInbox(null, 0, new Map())), /object/);
    const pending = new Map<number, FactoryInboxEnvelope>([[2, delivery(2, "first", digest("a"))]]);
    assert.match(errorOf(acceptFactoryInbox(delivery(2, "second", digest("b")), 0, pending)), /sequence/);
    assert.match(errorOf(acceptFactoryInbox(delivery(3, "first", digest("b")), 0, pending)), /hashes/);
  });

  it("rejects a window gap and a full distinct-decision window", () => {
    assert.deepEqual(acceptFactoryInbox(delivery(129), 0, new Map()), { overflow: true });
    const full = new Map(Array.from({ length: 128 }, (_, index): [number, FactoryInboxEnvelope] => [index + 1, delivery(index + 1)]));
    assert.deepEqual(acceptFactoryInbox(delivery(128), 0, full), { overflow: false });
    assert.deepEqual(acceptFactoryInbox(delivery(129), 0, full), { overflow: true });
  });
});
