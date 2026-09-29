// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { noteUrl } from "../src/lib/seo/site";
import {
  json,
  SECURITY_HEADERS,
  withSecurityHeaders,
} from "../src/lib/server/http";

type HeaderRule = { path: string; headers: Map<string, string> };

const PATH_LINE = /^\//;
const HEADER_LINE = /^(?<name>[^:\s]+):\s*(?<value>.*)$/;
const REGEX_SPECIAL = /[-/\\^$*+?.()|[\]{}]/g;
const PLACEHOLDER = /:([A-Za-z]\w*)/g;

/** public/_headers as Cloudflare reads it (paths, then indented headers). */
const parseHeaders = (content: string) => {
  const rules: HeaderRule[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (PATH_LINE.test(line)) {
      rules.push({ path: line, headers: new Map() });
      continue;
    }
    const match = HEADER_LINE.exec(line);
    const rule = rules.at(-1);
    if (match?.groups && rule) {
      rule.headers.set(
        match.groups.name?.toLowerCase() ?? "",
        match.groups.value ?? ""
      );
    }
  }
  return rules;
};

/** Same pattern → regex as workers-shared rules-engine.ts. */
const ruleRegExp = (path: string) => {
  const source = path
    .split("*")
    .map((part) => part.replace(REGEX_SPECIAL, "\\$&"))
    .join("(?<splat>.*)")
    .replace(PLACEHOLDER, "(?<$1>[^/]+)");
  return new RegExp(`^${source}$`);
};

/** Headers Cloudflare would add to a static file at `pathname`. */
const headersFor = (list: HeaderRule[], pathname: string) => {
  const out = new Map<string, string[]>();
  for (const rule of list) {
    const match = ruleRegExp(rule.path).exec(pathname);
    if (!match) {
      continue;
    }
    for (const [name, value] of rule.headers) {
      let replaced = value;
      for (const [key, part] of Object.entries(match.groups ?? {})) {
        replaced = replaced.replaceAll(`:${key}`, part);
      }
      out.set(name, [...(out.get(name) ?? []), replaced]);
    }
  }
  return out;
};

const rules = parseHeaders(
  await readFile(new URL("../public/_headers", import.meta.url), "utf-8")
);

describe("public/_headers", () => {
  test("stays under Cloudflare's 100 rules (plus the adapter's one)", () => {
    expect(rules.length).toBeLessThan(100);
  });

  test("/* sends the same security headers as the Worker", () => {
    const all = rules.find((rule) => rule.path === "/*");
    expect(all).toBeDefined();
    expect(Object.fromEntries(all?.headers ?? [])).toEqual({
      ...SECURITY_HEADERS,
    });
  });

  test("no header is set twice for one file (Cloudflare would join them)", () => {
    for (const path of [
      "/",
      "/notes/go-context/",
      "/notes/go-context.md",
      "/llms-full.txt",
      "/fonts/xiaolai/a.woff2",
      "/fonts/xiaolai/result.css",
      "/journal/paper/a.jpg",
      "/stickers/people-dog.webp",
      "/ort/1.0/ort-wasm-simd-threaded.wasm",
      "/models/u2netp/onnx/model.onnx",
      "/_astro/index.js",
    ]) {
      for (const [name, values] of headersFor(rules, path)) {
        expect({ path, name, count: values.length }).toEqual({
          path,
          name,
          count: 1,
        });
      }
    }
  });

  test("/* never sets Cache-Control (the adapter's /_astro/* rule would be skipped)", () => {
    expect(headersFor(rules, "/_astro/probe").has("cache-control")).toBe(false);
  });

  test("each note's .md points to the note page as canonical", () => {
    const headers = headersFor(rules, "/notes/go-context.md");
    expect(headers.get("link")).toEqual([
      `<${noteUrl("go-context")}>; rel="canonical"`,
    ]);
    expect(headersFor(rules, "/notes/go-context/").has("link")).toBe(false);
  });

  test("llms-full.txt is not indexed, llms.txt and notes are", () => {
    expect(headersFor(rules, "/llms-full.txt").get("x-robots-tag")).toEqual([
      "noindex",
    ]);
    expect(headersFor(rules, "/llms.txt").has("x-robots-tag")).toBe(false);
    expect(headersFor(rules, "/notes/go-context/").has("x-robots-tag")).toBe(
      false
    );
  });
});

describe("withSecurityHeaders", () => {
  test("adds every missing header", () => {
    const response = withSecurityHeaders(new Response("ok"));
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  test("keeps a route's own headers", () => {
    const own = "default-src 'none'; sandbox";
    const response = withSecurityHeaders(
      new Response("img", { headers: { "content-security-policy": own } })
    );
    expect(response.headers.get("content-security-policy")).toBe(own);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("copies responses whose headers are immutable", () => {
    const response = withSecurityHeaders(
      Response.redirect("https://blog.test/list/", 301)
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://blog.test/list/");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("json", () => {
  test("sends nosniff", () => {
    expect(json({}).headers.get("x-content-type-options")).toBe("nosniff");
  });
});
