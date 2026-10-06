// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { legacyListRedirects } from "../src/integrations/legacy-list-redirects";
import {
  appendLines,
  checkRedirects,
  LEGACY_LIST_SPLATS,
  MAX_DYNAMIC_RULES,
  parseRedirectRules,
  splatRedirectLines,
} from "../src/lib/seo/redirect-rules";
import { redirects } from "../src/lib/seo/redirects";
import { rejectionMessage } from "./support/rejection";

const ROOT = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, ROOT), "utf-8");

const TRAILING_SLASH = /\/$/;
const DYNAMIC_PART = /[*:]/;

/**
 * What @astrojs/cloudflare appends to _redirects for `redirects`
 * (trailingSlash "ignore": both `/x` and `/x/`, no trailing newline).
 */
const adapterLines = () => {
  const lines: string[] = [];
  for (const [from, to] of Object.entries(redirects)) {
    const target = typeof to === "string" ? to : to.destination;
    const status = typeof to === "string" ? 301 : to.status;
    const bare = from.replace(TRAILING_SLASH, "");
    for (const path of [bare, `${bare}/`]) {
      lines.push(`${path}    ${target}    ${status}`);
    }
  }
  return lines.join("\n");
};

/** dist/client/_redirects as the build writes it. */
const mergedRedirects = async () =>
  appendLines(
    (await read("public/_redirects")) + adapterLines(),
    splatRedirectLines()
  );

describe("checkRedirects", () => {
  test("accepts static rules followed by splats", () => {
    const report = checkRedirects(
      "/about/ / 301\n/old/ /new/ 301\n/tags/* /list/ 301\n"
    );
    expect(report).toEqual({ dynamicRules: 1, problems: [], staticRules: 2 });
  });

  test("fails when a splat comes before a static rule", () => {
    const report = checkRedirects(
      "# comment\n/tags/* /list/ 301\n/about/ / 301\n"
    );
    expect(report.staticRules).toBe(0);
    expect(report.dynamicRules).toBe(2);
    expect(report.problems).toHaveLength(1);
    expect(report.problems.at(0)).toContain("/about/");
  });

  test("a :placeholder counts as dynamic too", () => {
    const rules = parseRedirectRules("/a/:id /b/:id 301\n/c/ /d/ 301");
    expect(rules.map((rule) => rule.dynamic)).toEqual([true, true]);
  });

  test("fails when dynamic rules exceed the limit", () => {
    const lines = Array.from(
      { length: MAX_DYNAMIC_RULES + 1 },
      (_, index) => `/t${index}/* /list/ 301`
    );
    const report = checkRedirects(lines.join("\n"));
    expect(report.dynamicRules).toBe(MAX_DYNAMIC_RULES + 1);
    expect(report.problems).toHaveLength(1);
  });

  test("fails when static rules exceed the limit", () => {
    const report = checkRedirects("/a/ /b/ 301\n/c/ /d/ 301", {
      dynamic: 100,
      static: 1,
    });
    expect(report.problems).toHaveLength(1);
  });

  test("ignores comments, blank lines and trailing comments", () => {
    const rules = parseRedirectRules(
      "# /tags/* /list/ 301\n\n/a/ /b/ 301 # moved\nnot-a-rule\n"
    );
    expect(rules).toEqual([{ dynamic: false, from: "/a/", line: 3 }]);
  });
});

describe("appendLines", () => {
  test("starts the new lines on a line of their own", () => {
    expect(appendLines("/a/ /b/ 301", ["/c/* /d/ 301"])).toBe(
      "/a/ /b/ 301\n/c/* /d/ 301\n"
    );
    expect(appendLines("/a/ /b/ 301\n", ["/c/* /d/ 301"])).toBe(
      "/a/ /b/ 301\n/c/* /d/ 301\n"
    );
    expect(appendLines("", ["/c/* /d/ 301"])).toBe("/c/* /d/ 301\n");
  });
});

describe("site _redirects", () => {
  test("public/_redirects has no rules (it precedes the generated ones)", async () => {
    const content = await read("public/_redirects");
    expect(parseRedirectRules(content)).toEqual([]);
    // The adapter appends without a newline of its own.
    expect(content.endsWith("\n")).toBe(true);
  });

  test("redirects.ts only has plain paths", () => {
    for (const from of Object.keys(redirects)) {
      expect(from).not.toMatch(DYNAMIC_PART);
    }
  });

  test("the merged file keeps every rule, splats last", async () => {
    const merged = await mergedRedirects();
    const report = checkRedirects(merged);
    expect(report.problems).toEqual([]);
    expect(report.dynamicRules).toBe(LEGACY_LIST_SPLATS.length);
    expect(report.staticRules).toBe(Object.keys(redirects).length * 2);
    const rules = parseRedirectRules(merged);
    expect(rules.slice(-LEGACY_LIST_SPLATS.length).map((r) => r.from)).toEqual(
      LEGACY_LIST_SPLATS.map((splat) => splat.from)
    );
  });

  test("keeps the rules the deploy checklist curls", async () => {
    const froms = parseRedirectRules(await mergedRedirects()).map(
      (rule) => rule.from
    );
    for (const path of [
      "/about/",
      "/about",
      "/archives",
      "/blog/css-study-1/",
      "/blog/c-cpp-binary-trees/",
      "/tags/*",
    ]) {
      expect(froms).toContain(path);
    }
  });

  // Handoff guard: fails until astro.config.mjs lists the integration. Without
  // it the /tags/*, /categories/* and /archives/* redirects are not written.
  test("astro.config.mjs registers the legacy-list-redirects integration", async () => {
    const config = await read("astro.config.mjs");
    expect(
      config.includes("legacyListRedirects()"),
      'astro.config.mjs 需要 import { legacyListRedirects } from "./src/integrations/legacy-list-redirects.ts" 并在 integrations 里加 legacyListRedirects()'
    ).toBe(true);
  });
});

describe("legacyListRedirects integration", () => {
  const hook = legacyListRedirects().hooks["astro:build:done"];
  const logged: string[] = [];
  const logger = { info: (message: string) => logged.push(message) };
  type HookOptions = Parameters<NonNullable<typeof hook>>[0];

  const runHook = async (content: string) => {
    const dir = await mkdtemp(join(tmpdir(), "redirects-"));
    try {
      await writeFile(join(dir, "_redirects"), content);
      // Only dir and logger are read.
      await hook?.({
        dir: pathToFileURL(`${dir}/`),
        logger,
      } as unknown as HookOptions);
      return await readFile(join(dir, "_redirects"), "utf-8");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  };

  test("appends the splats after the adapter's rules", async () => {
    const out = await runHook("# c\n/about    /    301\n/about/    /    301");
    expect(out).toBe(
      `# c\n/about    /    301\n/about/    /    301\n${splatRedirectLines().join("\n")}\n`
    );
    expect(logged.at(-1)).toBe("_redirects: 2 static + 3 splat rules");
  });

  test("fails the build when a splat was left in front", async () => {
    expect(
      await rejectionMessage(runHook("/tags/* /list/ 301\n/about/ / 301"))
    ).toContain("/about/");
  });
});
