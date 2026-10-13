import { expect, test } from "bun:test";
import { browserBuild } from "../src/browser";

const spec = { schemaVersion: 1 as const, entrypoint: "app.js", html: "index.html", styles: ["style.css"], tools: ["echo"] };
const files = { "app.js": "", "index.html": "", "style.css": "" };

test("browser build is explicit and admits only bounded frozen text inputs", () => {
  expect(browserBuild(files)).toBeUndefined();
  expect(browserBuild({ ...files, "ezcorp.browser.json": JSON.stringify(spec) })).toEqual(spec);
  for (const value of [null, [], {}, { ...spec, plugin: "untrusted.ts" }, { ...spec, schemaVersion: 2 }, { ...spec, tools: ["echo", "echo"] }, { ...spec, tools: ["a.b"] }, { ...spec, styles: Array(17).fill("style.css") }, { ...spec, tools: Array.from({ length: 33 }, (_, index) => `tool${index}`) }, { ...spec, html: "../host.html" }, { ...spec, html: "absent.html" }, { ...spec, html: "style.css" }, { ...spec, styles: ["app.js"] }]) {
    expect(() => browserBuild({ ...files, "ezcorp.browser.json": JSON.stringify(value) })).toThrow();
  }
  expect(() => browserBuild({ ...files, "ezcorp.browser.json": " ".repeat(8193) })).toThrow("limit");
  expect(() => browserBuild({ ...files, "ezcorp.browser.json": "{" })).toThrow();
  expect(() => browserBuild({ ...files, "app.js": { encoding: "base64", data: "AA==", executable: false }, "ezcorp.browser.json": JSON.stringify(spec) })).toThrow();
});
