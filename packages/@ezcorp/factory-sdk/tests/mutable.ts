/**
 * Test-only deep copies of readonly fixtures.
 *
 * Factory types are readonly all the way down, which is right for the
 * package API. A test that builds an invalid variant edits a fresh copy, so
 * the copy is typed without `readonly`.
 */
import type { JsonValue } from "../src/types";

// A homomorphic mapped type keeps arrays and tuples as arrays and tuples.
// JsonValue is already mutable and recursive, so the mapping stops there.
export type Mutable<T> = [JsonValue] extends [T] ? T
  : T extends (...args: never[]) => unknown ? T
  : T extends Uint8Array ? T
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> }
  : T;

export function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}
