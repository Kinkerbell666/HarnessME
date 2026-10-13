import type { WorkflowCondition, WorkflowConditionOp } from "../types";
import { resolveConditionRef, type RefContext } from "./workflow-refs";

/** Result of evaluating a condition tree: whether it held, plus a
 *  human-readable explanation of the decisive leaf (used verbatim in the
 *  `Gate "<name>" failed: …` message and in loop diagnostics). */
export interface ConditionResult {
  passed: boolean;
  reason: string;
}

function fmt(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Apply a leaf operator. Comparisons on non-numbers evaluate to `false`
 *  (never throw); only `resolveConditionRef` may throw (unresolvable strict
 *  root ref). */
function applyOp(op: WorkflowConditionOp, actual: unknown, value: unknown): boolean {
  switch (op) {
    case "eq":
      return deepEq(actual, value);
    case "neq":
      return !deepEq(actual, value);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof value !== "number") return false;
      if (op === "gt") return actual > value;
      if (op === "gte") return actual >= value;
      if (op === "lt") return actual < value;
      return actual <= value;
    }
    case "contains": {
      if (typeof actual === "string") return actual.includes(String(value));
      if (Array.isArray(actual)) return actual.some((item) => deepEq(item, value));
      return false;
    }
    case "exists":
      return actual !== undefined && actual !== null;
    case "truthy":
      return Boolean(actual);
  }
}

/**
 * Every `ref` a condition tree reads, in evaluation order.
 *
 * Exported for the dry-run harness, which has to know whether a gate's
 * OPERANDS were fabricated before it decides to enforce the verdict — a
 * question about the refs, not about the outcome. It lives here because
 * this module owns the tree shape: a second walker elsewhere would
 * silently miss a node kind the day one is added.
 *
 * A malformed leaf contributes nothing. {@link evaluateCondition} is the
 * single place that rejects one, so this stays a pure reader.
 */
export function conditionRefs(cond: WorkflowCondition): string[] {
  if ("all" in cond) return cond.all.flatMap(conditionRefs);
  if ("any" in cond) return cond.any.flatMap(conditionRefs);
  if ("not" in cond) return conditionRefs(cond.not);
  const leaf = cond as { ref?: unknown };
  return typeof leaf.ref === "string" ? [leaf.ref] : [];
}

/** Structural equality. Object keys compare as a set (a step's JSON output
 *  rarely lists keys in the author's order); arrays compare in order. */
function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bArr = b as unknown[];
    return a.length === bArr.length && a.every((item, i) => deepEq(item, bArr[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = Object.keys(aObj);
  return keys.length === Object.keys(bObj).length
    && keys.every((k) => Object.hasOwn(bObj, k) && deepEq(aObj[k], bObj[k]));
}

/**
 * Evaluate a condition tree against a {@link RefContext}. Returns
 * `{ passed, reason }`; `reason` names the decisive leaf so a failing gate
 * can explain itself. Throws only when a strict ref (`$prev` with no
 * previous result, `$steps.<unknownStep>`) can't be resolved.
 */
export function evaluateCondition(
  cond: WorkflowCondition,
  ctx: RefContext,
): ConditionResult {
  if ("all" in cond) {
    for (const child of cond.all) {
      const r = evaluateCondition(child, ctx);
      if (!r.passed) return { passed: false, reason: r.reason };
    }
    return { passed: true, reason: "all conditions passed" };
  }

  if ("any" in cond) {
    const reasons: string[] = [];
    for (const child of cond.any) {
      const r = evaluateCondition(child, ctx);
      if (r.passed) return { passed: true, reason: r.reason };
      reasons.push(r.reason);
    }
    return {
      passed: false,
      reason: `none of the conditions matched (${reasons.join("; ")})`,
    };
  }

  if ("not" in cond) {
    const r = evaluateCondition(cond.not, ctx);
    return {
      passed: !r.passed,
      reason: `not(${r.reason})`,
    };
  }

  // Leaf condition. Defense-in-depth: definition-time validation
  // (`validateCondition`) should already have rejected a malformed leaf, but
  // a hand-edited YAML / legacy DB row could still smuggle one in. Guard
  // here so the ref resolver never dies with a raw
  // `TypeError: undefined is not an object (evaluating 'ref.startsWith')`.
  const leaf = cond as { ref?: unknown; op?: unknown; value?: unknown };
  if (typeof leaf.ref !== "string" || typeof leaf.op !== "string") {
    throw new Error(
      `Malformed condition leaf: expected a string "ref" and "op", got ${fmt(cond)}`,
    );
  }
  const actual = resolveConditionRef(cond.ref, ctx);
  const passed = applyOp(cond.op, actual, cond.value);
  const rhs = cond.op === "exists" || cond.op === "truthy" ? "" : ` ${fmt(cond.value)}`;
  const verb = passed ? "satisfies" : "does not satisfy";
  return {
    passed,
    reason: `${cond.ref} (=${fmt(actual)}) ${verb} ${cond.op}${rhs}`,
  };
}
