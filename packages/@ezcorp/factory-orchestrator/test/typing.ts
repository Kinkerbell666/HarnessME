import type { JsonValue } from "@ezcorp/factory-sdk/types";

/**
 * Deliberately malformed input for a negative test of a runtime validator.
 * The validator's parameter type describes VALID input; a test that proves
 * the validator rejects bad input must break that type on purpose. Doing it
 * through this one named helper keeps every such break visible and greppable.
 */
export function malformed<T>(value: unknown): T {
  return value as T;
}

/** Round-trip a typed artifact through JSON, the way the wire carries it. */
export function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
