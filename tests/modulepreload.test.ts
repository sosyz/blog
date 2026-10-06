import { describe, expect, test } from "bun:test";
import {
  preloadsFor,
  staticImports,
  withModulePreloads,
} from "../src/lib/build/modulepreload";

const CHUNKS: Record<string, string> = {
  "/_astro/api.js": "export const n=1;",
  "/_astro/Canvas.js":
    'globalThis.x??={};import{t as e}from"./client.js";import"./api.js";var a=()=>import("./peel-gl.js");',
  "/_astro/client.js": 'export{a as t}from"./store.js";',
  "/_astro/peel-gl.js": 'import"./gl-only.js";',
  "/_astro/store.js": 'import{n}from"./api.js";export const a=n;',
  "/_astro/Toolbar.js": 'import{a}from"./store.js";',
};
const read = (path: string) => CHUNKS[path];

describe("staticImports", () => {
  test("finds import / export-from, not dynamic imports", () => {
    expect(staticImports(CHUNKS["/_astro/Canvas.js"] ?? "")).toEqual([
      "./client.js",
      "./api.js",
    ]);
    expect(staticImports(CHUNKS["/_astro/client.js"] ?? "")).toEqual([
      "./store.js",
    ]);
  });
});

describe("preloadsFor", () => {
  test("walks static imports once, entries excluded", () => {
    expect(
      preloadsFor(["/_astro/Canvas.js", "/_astro/Toolbar.js"], read)
    ).toEqual(["/_astro/client.js", "/_astro/api.js", "/_astro/store.js"]);
  });
});

describe("withModulePreloads", () => {
  const page = `<html><head><link rel="modulepreload" href="/_astro/api.js"><script type="module" src="/_astro/Canvas.js"></script></head><body></body></html>`;

  test("adds the missing links before </head>", () => {
    const html = withModulePreloads(page, read);
    expect(html).toContain(
      '<link rel="modulepreload" href="/_astro/client.js"><link rel="modulepreload" href="/_astro/store.js"></head>'
    );
    // Already there: not twice. Dynamic imports: never.
    expect(html.match(/api\.js/g)).toHaveLength(1);
    expect(html).not.toContain("peel-gl");
  });

  test("leaves pages without module scripts alone", () => {
    const plain = "<html><head></head><body></body></html>";
    expect(withModulePreloads(plain, read)).toBe(plain);
  });
});
