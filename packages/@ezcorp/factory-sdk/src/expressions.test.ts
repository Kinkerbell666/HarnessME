import { describe, expect, test } from "bun:test";
import { evaluateExpression } from "./expressions";
import type { Expression, ExpressionContext, JsonValue } from "./types";

const context: ExpressionContext = {
  inputs: Object.assign(Object.create(null), { constructor: { nested: ["a", "b"] }, count: 2 }),
  nodes: { task: { ok: true } },
  map: { item: "x", index: 0 },
  loop: { carried: "y", result: [1, 2], index: 1 },
};
const literal = (value: never): Expression => ({ kind: "literal", value });

describe("bounded expressions", () => {
  test("evaluates every supported operator", () => {
    const cases: [Expression, JsonValue][] = [
      [{ kind: "ref", root: "input", name: "constructor", path: ["nested", 1] }, "b"],
      [{ kind: "exists", value: { kind: "ref", root: "input", name: "missing" } }, false],
      [{ kind: "eq", left: literal({ a: 1 } as never), right: literal({ a: 1 } as never) }, true],
      [{ kind: "eq", left: literal([1, 2] as never), right: literal([1, 2] as never) }, true],
      [{ kind: "lt", left: literal(1 as never), right: literal(2 as never) }, true],
      [{ kind: "lte", left: literal("a" as never), right: literal("a" as never) }, true],
      [{ kind: "gt", left: literal(2 as never), right: literal(1 as never) }, true],
      [{ kind: "gte", left: literal(2 as never), right: literal(2 as never) }, true],
      [{ kind: "not", value: literal(false as never) }, true],
      [{ kind: "and", values: [literal(true as never), literal(false as never), { kind: "ref", root: "input", name: "missing" }] }, false],
      [{ kind: "or", values: [literal(true as never), { kind: "ref", root: "input", name: "missing" }] }, true],
      [{ kind: "and", values: [] }, true],
      [{ kind: "or", values: [] }, false],
      [{ kind: "in", value: literal("b" as never), collection: literal(["a", "b"] as never) }, true],
      [{ kind: "in", value: literal("z" as never), collection: literal(["x"] as never) }, false],
      [{ kind: "length", value: { kind: "ref", root: "loop", name: "result" } }, 2],
      [{ kind: "length", value: literal("🌳" as never) }, 1],
    ];
    for (const [expression, expected] of cases) expect(evaluateExpression(expression, context)).toEqual({ ok: true, value: expected });
  });

  test("reports missing references and type errors", () => {
    const failures: Expression[] = [
      { kind: "ref", root: "input", name: "missing" },
      { kind: "ref", root: "input", name: "constructor", path: ["missing"] },
      { kind: "not", value: literal(1 as never) },
      { kind: "and", values: [literal(1 as never)] },
      { kind: "or", values: [literal(1 as never)] },
      { kind: "length", value: literal({} as never) },
      { kind: "in", value: literal(1 as never), collection: literal("x" as never) },
      { kind: "lt", left: literal(1 as never), right: literal("2" as never) },
    ];
    for (const expression of failures) expect(evaluateExpression(expression, context).ok).toBe(false);
  });

  test("rejects unsupported shapes and all static bounds before short circuit", () => {
    expect(evaluateExpression({ kind: "wat" } as never, context).ok).toBe(false);
    expect(evaluateExpression({ kind: "literal", value: true, extra: true } as never, context).ok).toBe(false);
    expect(evaluateExpression({ kind: "ref", root: "wat", name: 1 } as never, context).ok).toBe(false);
    expect(evaluateExpression({ kind: "ref", root: "input", name: "count", path: [-1] } as never, context).ok).toBe(false);
    expect(evaluateExpression({ kind: "exists", value: literal(1 as never) } as never, context).ok).toBe(false);
    expect(evaluateExpression({ kind: "not" } as never, context).ok).toBe(false);
    expect(evaluateExpression({ kind: "and", values: true } as never, context).ok).toBe(false);
    expect(evaluateExpression({ kind: "in", value: literal(1 as never) } as never, context).ok).toBe(false);
    expect(evaluateExpression({ kind: "eq", left: literal(1 as never) } as never, context).ok).toBe(false);
    let deep: Expression = literal(true as never);
    for (let index = 0; index < 17; index += 1) deep = { kind: "not", value: deep };
    expect(evaluateExpression({ kind: "or", values: [literal(true as never), deep] }, context)).toMatchObject({ ok: false, code: "EXPRESSION_DEPTH_LIMIT" });
    expect(evaluateExpression({ kind: "and", values: Array.from({ length: 257 }, () => literal(false as never)) }, context)).toMatchObject({ ok: false, code: "EXPRESSION_NODE_LIMIT" });
    const cyclic: Record<string, unknown> = { kind: "not" };
    cyclic.value = cyclic;
    expect(evaluateExpression(cyclic as never, context)).toMatchObject({ ok: false, code: "EXPRESSION_IJSON" });
  });

  test("charges reference traversal and equality work", () => {
    const longPath = Array.from({ length: 1_025 }, () => "x");
    expect(evaluateExpression({ kind: "ref", root: "input", name: "constructor", path: longPath }, context)).toMatchObject({ ok: false });
    const array = Array.from({ length: 1_025 }, (_, index) => index);
    expect(evaluateExpression({ kind: "eq", left: literal(array as never), right: literal([...array] as never) }, context)).toMatchObject({ ok: false, code: "EXPRESSION_STEP_LIMIT" });
  });
});
