import { describe, expect, test } from "bun:test";
import { FactoryParseError, parseFactoryJson, parseFactoryYaml, parseIJson, parseIYaml } from "./parse";
import { referenceCodeV1 } from "./references";

describe("safe authoring parsers", () => {
  test("parses JSON grammar into prototype-safe own properties", () => {
    const value = parseIJson('{"__proto__":{"polluted":true},"constructor":1,"toString":2,"escapes":"\\b\\f\\n\\r\\t\\/\\"\\\\\\u0041","numbers":[-1,0,1.5,2e2],"values":[true,false,null]}') as Record<string, unknown>;
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(value.escapes).toBe('\b\f\n\r\t/"\\A');
    expect(value.numbers).toEqual([-1, 0, 1.5, 200]);
  });

  test("rejects duplicate keys and malformed JSON variants", () => {
    const invalid = [
      '{"a":1,"a":2}', '{"a":01}', '{"a":1.}', '{"a":1e}', '{"a":}', '{a:1}',
      '[1,]', '{"a" 1}', '{"a":1,}', '"unterminated', '"\\x"', '"\\u00xz"',
      'true false', String.raw`"\ud800"`, '9007199254740992', '-x', '',
    ];
    for (const source of invalid) expect(() => parseIJson(source)).toThrow(FactoryParseError);
    expect(() => parseIJson(`${"[".repeat(65)}null${"]".repeat(65)}`)).toThrow("nesting limit");
  });

  test("parses YAML and rejects aliases, duplicates, and custom tags", () => {
    expect(parseIYaml("a: 1\nb:\n  - true\n  - null\n")).toEqual({ a: 1, b: [true, null] });
    expect(() => parseIYaml("a: 1\na: 2\n")).toThrow(FactoryParseError);
    expect(() => parseIYaml("a: &value 1\nb: *value\n")).toThrow("aliases");
    expect(() => parseIYaml("a: !unsafe value\n")).toThrow(FactoryParseError);
    expect(() => parseIYaml("a: 9007199254740992\n")).toThrow(FactoryParseError);
    expect(() => parseIYaml("1: value\n")).toThrow("mapping keys must be strings");
    const hostile = parseIYaml("__proto__: safe\nconstructor: owned\ntoString: value\n") as Record<string, unknown>;
    expect(Object.hasOwn(hostile, "__proto__")).toBe(true);
    const constructorValue: unknown = hostile.constructor;
    const toStringValue: unknown = hostile.toString;
    expect(constructorValue).toBe("owned");
    expect(toStringValue).toBe("value");
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
  });

  test("definition JSON and YAML use the same canonical schema", () => {
    const json = JSON.stringify(referenceCodeV1);
    expect(parseFactoryJson(json).id).toBe("reference.code.v1");
    expect(parseFactoryYaml(json).id).toBe("reference.code.v1");
    expect(() => parseFactoryJson('{"schemaVersion":"future"}')).toThrow("canonical FactoryDefinition");
  });
});
