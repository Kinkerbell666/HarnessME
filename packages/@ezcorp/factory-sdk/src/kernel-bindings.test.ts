import { expect, test } from "bun:test";
import { compileFactory } from "./compiler";
import { referenceCodeV1 } from "./references";
import { simulateFactory, type SimulatedOutcome } from "./simulator";
import type { CompiledFactory, FactoryDefinition, FactoryNode, JsonValue } from "./index";

const digest = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const runner = { package: "inert", manifestName: "inert", version: "1", digest, export: "run" } as const;
const string = { type: "string" } as const;
const integer = { type: "integer" } as const;
const labelledItem = { type: "object", properties: { label: string }, required: ["label"], additionalProperties: false } as const;

function compiled(nodes: readonly FactoryNode[]): CompiledFactory {
  const definition: FactoryDefinition = {
    schemaVersion: "factory.v1", id: "binding-regression", version: "1", interpreterCompatibility: "1",
    inputPorts: {}, outputPorts: {}, graph: { nodes, outputs: {} }, acceptance: referenceCodeV1.acceptance,
    packages: [...referenceCodeV1.packages, { name: runner.package, version: runner.version, digest }], capabilities: [], effects: ["none"],
    bounds: { maxExpandedNodes: 100, maxScopeDepth: 16 },
  };
  const result = compileFactory(definition);
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.code).join(", "));
  return result.factory;
}

test("nested maps pass real nodes and the innermost item/index values to callbacks", () => {
  const inner: Extract<FactoryNode, { readonly kind: "map" }> = {
    id: "inner-map", kind: "map", collection: { kind: "literal", value: [{ label: "a" }, { label: "b" }] },
    itemSchema: labelledItem, mode: "all", maxItems: 3, maxConcurrency: 2,
    outputPorts: { result: { type: "array", items: string } },
    body: {
      nodes: [{
        id: "inner-task", kind: "task", runner,
        inputPorts: { item: labelledItem, index: integer }, outputPorts: { value: string },
        bindings: { item: { kind: "ref", root: "map", name: "item" }, index: { kind: "ref", root: "map", name: "index" } },
      }],
      outputs: { result: { kind: "ref", root: "node", name: "inner-task", path: ["value"] } },
    },
  };
  const outer: Extract<FactoryNode, { readonly kind: "map" }> = {
    id: "outer-map", kind: "map", collection: { kind: "literal", value: [{ label: "outer-a" }, { label: "outer-b" }] },
    itemSchema: labelledItem,
    mode: "all", maxItems: 2, maxConcurrency: 2,
    outputPorts: { result: { type: "array", items: { type: "array", items: string } } },
    body: { nodes: [inner], outputs: { result: { kind: "ref", root: "node", name: "inner-map", path: ["result"] } } },
  };
  const calls: JsonValue[] = [];
  const result = simulateFactory(compiled([outer]), "nested-map-bindings", {}, {
    execute: (node, command) => {
      expect(node).toBeDefined();
      expect(node.id).toBe("inner-task");
      calls.push(command.input);
      const input = command.input as { readonly item: { readonly label: string }; readonly index: number };
      return { kind: "success", output: { value: `${input.item.label}:${input.index}` } };
    },
  });

  expect(calls).toEqual([
    { item: { label: "a" }, index: 0 },
    { item: { label: "b" }, index: 1 },
    { item: { label: "a" }, index: 0 },
    { item: { label: "b" }, index: 1 },
  ]);
  expect(result.state.status).toBe("completed");
  expect(result.state.nodes["outer-map"]?.output).toEqual({ result: [["a:0", "b:1"], ["a:0", "b:1"]] });
});

test("a scoped consumer resolves a declared ancestor output path", () => {
  const map: Extract<FactoryNode, { readonly kind: "map" }> = {
    id: "map", kind: "map", collection: { kind: "literal", value: ["one"] }, itemSchema: string, mode: "all", maxItems: 1, maxConcurrency: 1,
    outputPorts: { result: { type: "array", items: string } },
    body: {
      nodes: [
        { id: "producer", kind: "task", runner, outputPorts: { payload: { type: "object", properties: { name: string }, required: ["name"], additionalProperties: false } } },
        {
          id: "consumer", kind: "task", runner, dependsOn: ["producer"], inputPorts: { name: string }, outputPorts: { seen: string },
          bindings: { name: { kind: "ref", root: "node", name: "producer", path: ["payload", "name"] } },
        },
      ],
      outputs: { result: { kind: "ref", root: "node", name: "consumer", path: ["seen"] } },
    },
  };
  const seen: JsonValue[] = [];
  const result = simulateFactory(compiled([map]), "ancestor-path", {}, {
    execute: (_node, command): SimulatedOutcome => {
      if (command.nodeId.endsWith("/producer")) return { kind: "success", output: { payload: { name: "ancestor" } } };
      seen.push(command.input);
      return { kind: "success", output: { seen: (command.input as { readonly name: string }).name } };
    },
  });

  expect(seen).toEqual([{ name: "ancestor" }]);
  expect(result.state.status).toBe("completed");
  expect(result.state.nodes.map?.output).toEqual({ result: ["ancestor"] });
});

test("loop bindings receive carried/index values and use the explicit body output record", () => {
  const loop: Extract<FactoryNode, { readonly kind: "loop" }> = {
    id: "loop", kind: "loop", initialInput: { kind: "literal", value: { value: "seed" } }, carriedSchema: { type: "object", properties: { value: string }, required: ["value"], additionalProperties: false },
    resultSchema: { type: "object", properties: { result: string }, required: ["result"], additionalProperties: false },
    outputPorts: { result: string },
    until: { kind: "literal", value: true }, nextInput: { kind: "literal", value: { value: "seed" } }, maxIterations: 2, maxElapsedMs: 100, onExhausted: "fail",
    body: {
      nodes: [
        {
          id: "chosen", kind: "task", runner, inputPorts: { carried: { type: "object", properties: { value: string }, required: ["value"], additionalProperties: false }, index: integer }, outputPorts: { value: string },
          bindings: { carried: { kind: "ref", root: "loop", name: "carried" }, index: { kind: "ref", root: "loop", name: "index" } },
        },
        { id: "ignored-last", kind: "task", runner, dependsOn: ["chosen"], outputPorts: { value: string } },
      ],
      outputs: { result: { kind: "ref", root: "node", name: "chosen", path: ["value"] } },
    },
  };
  const result = simulateFactory(compiled([loop]), "loop-bindings", {}, {
    execute: (node, command) => node.id === "chosen"
      ? { kind: "success", output: { value: `${(command.input as { readonly carried: { readonly value: string } }).carried.value}:${(command.input as { readonly index: number }).index}` } }
      : { kind: "success", output: { value: "wrong-last-value" } },
  });

  expect(result.state.status).toBe("completed");
  expect(result.state.nodes.loop?.output).toEqual({ result: "seed:0" });
});

test("branch output is the selected graph output record, including an empty selected graph", () => {
  const selected = (condition: boolean): Extract<FactoryNode, { readonly kind: "branch" }> => ({
    id: "branch", kind: "branch", condition: { kind: "literal", value: condition }, outputPorts: { result: string },
    then: {
      nodes: [{ id: "then-task", kind: "task", runner, outputPorts: { value: string } }],
      outputs: { result: { kind: "ref", root: "node", name: "then-task", path: ["value"] } },
    },
    else: { nodes: [], outputs: { result: { kind: "literal", value: "else-output" } } },
  });
  const thenResult = simulateFactory(compiled([selected(true)]), "branch-then", {}, { execute: () => ({ kind: "success", output: { value: "then-output" } }) });
  const elseResult = simulateFactory(compiled([selected(false)]), "branch-else", {}, { execute: () => ({ kind: "success", output: { value: "must-not-run" } }) });

  expect(thenResult.state.status).toBe("completed");
  expect(thenResult.state.nodes.branch?.output).toEqual({ result: "then-output" });
  expect(elseResult.state.status).toBe("completed");
  expect(elseResult.state.nodes.branch?.output).toEqual({ result: "else-output" });
  expect(elseResult.commands.some((command) => command.kind === "dispatch-node")).toBe(false);
});

test("empty map and loop bodies progress to their explicit empty output records", () => {
  const map: Extract<FactoryNode, { readonly kind: "map" }> = {
    id: "empty-map", kind: "map", collection: { kind: "literal", value: ["item"] }, itemSchema: string,
    outputPorts: { result: { type: "array", items: string } },
    body: { nodes: [], outputs: { result: { kind: "literal", value: "empty-map-result" } } }, mode: "all", maxItems: 1, maxConcurrency: 1,
  };
  const loop: Extract<FactoryNode, { readonly kind: "loop" }> = {
    id: "empty-loop", kind: "loop", initialInput: { kind: "literal", value: { value: "seed" } }, carriedSchema: { type: "object", properties: { value: string }, required: ["value"], additionalProperties: false }, resultSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    outputPorts: {},
    body: { nodes: [], outputs: {} }, until: { kind: "literal", value: true }, nextInput: { kind: "literal", value: { value: "seed" } }, maxIterations: 1, maxElapsedMs: 100, onExhausted: "fail",
  };
  const result = simulateFactory(compiled([map, loop]), "empty-scopes", {});

  expect(result.state.status).toBe("completed");
  expect(result.state.nodes["empty-map"]?.output).toEqual({ result: ["empty-map-result"] });
  expect(result.state.nodes["empty-loop"]?.output).toEqual({});
});

test("a selected branch containing a map completes its nested scoped output", () => {
  const map: Extract<FactoryNode, { readonly kind: "map" }> = {
    id: "nested-map", kind: "map", collection: { kind: "literal", value: [{ label: "x" }, { label: "y" }] }, itemSchema: labelledItem, mode: "all", maxItems: 2, maxConcurrency: 2,
    outputPorts: { result: { type: "array", items: string } },
    body: {
      nodes: [{
        id: "nested-task", kind: "task", runner, inputPorts: { item: labelledItem }, outputPorts: { value: string },
        bindings: { item: { kind: "ref", root: "map", name: "item" } },
      }],
      outputs: { result: { kind: "ref", root: "node", name: "nested-task", path: ["value"] } },
    },
  };
  const branch: Extract<FactoryNode, { readonly kind: "branch" }> = {
    id: "branch", kind: "branch", condition: { kind: "literal", value: true }, outputPorts: { result: { type: "array", items: { type: ["string", "null"] } } },
    then: { nodes: [map], outputs: { result: { kind: "ref", root: "node", name: "nested-map", path: ["result"] } } },
    else: { nodes: [], outputs: { result: { kind: "literal", value: [] } } },
  };
  const result = simulateFactory(compiled([branch]), "branch-map", {}, {
    execute: (_node, command) => ({ kind: "success", output: { value: (command.input as { readonly item: { readonly label: string } }).item.label } }),
  });

  expect(result.state.status).toBe("completed");
  expect(result.state.nodes.branch?.output).toEqual({ result: ["x", "y"] });
});
