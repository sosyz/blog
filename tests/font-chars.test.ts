// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  averageAdvance,
  codePointsOf,
  faceRule,
  handText,
  lineOverrides,
  parseChunks,
  parseUnicodeRange,
  restChunks,
  siteSets,
  sizeAdjust,
  splitFrontmatter,
  toUnicodeRange,
} from "../scripts/font-chars";
import { FONT_FACES, FONT_REST_CSS } from "../src/layouts/fonts.generated";

const cp = (char: string) => char.codePointAt(0) ?? -1;
const RANGE = /unicode-range:([^;}]*)/;
const REST_NAME = /^\/fonts\/rest\.[0-9a-f]+\.css$/;
const rangeOf = (rule: string) =>
  parseUnicodeRange(RANGE.exec(rule)?.[1] ?? "");

describe("unicode ranges", () => {
  test("merges runs and round-trips", () => {
    const set = new Set([0x41, 0x42, 0x43, 0x4e_00, 0x4e_02, 0x2_00_00]);
    const range = toUnicodeRange(set);
    expect(range).toBe("U+41-43,U+4E00,U+4E02,U+20000");
    expect(parseUnicodeRange(range)).toEqual(set);
  });

  test("reads wildcards and ignores junk", () => {
    expect(parseUnicodeRange("U+4??, nope").size).toBe(256);
    expect(toUnicodeRange([])).toBe("");
  });
});

describe("site character sets", () => {
  const post = `---
title: "踩坑记录"
tags: [网络]
---
正文里的字。

> 引用用手写体

![拓扑图](../a.png)

\`\`\`ts title="配置.ts"
const x = 1;
\`\`\`

\`\`\`mermaid
graph LR
  A[浏览器] --> B[服务器]
\`\`\`

\`\`\`js
const 变量 = 2;
\`\`\`
`;

  test("splits frontmatter from the body", () => {
    const { frontmatter, body } = splitFrontmatter(post);
    expect(frontmatter).toContain("踩坑记录");
    expect(body.startsWith("正文")).toBe(true);
    expect(splitFrontmatter("no frontmatter").body).toBe("no frontmatter");
  });

  test("finds the hand-set parts of a body", () => {
    const text = handText(splitFrontmatter(post).body);
    expect(text).toContain("引用用手写体");
    expect(text).toContain("拓扑图");
    expect(text).toContain("配置.ts");
    // Diagram labels are SVG text in the hand font; other code is not.
    expect(text).toContain("A[浏览器] --> B[服务器]");
    expect(text).not.toContain("变量");
    expect(text).not.toContain("正文");
  });

  test("common, body-only and hand sets", () => {
    const sets = siteSets({ ui: ["<p>搜索笔记</p>"], posts: [post] });
    // UI copy, frontmatter and the base ranges are on every page.
    for (const char of "搜索踩坑网A，。—") {
      expect(sets.common.has(cp(char))).toBe(true);
    }
    // Body-only characters, minus what `common` already has.
    expect(sets.body.has(cp("正"))).toBe(true);
    expect(sets.body.has(cp("记"))).toBe(false);
    // The hand font gets quotes and captions, not the whole body.
    expect(sets.hand.has(cp("引"))).toBe(true);
    expect(sets.hand.has(cp("拓"))).toBe(true);
    expect(sets.hand.has(cp("正"))).toBe(false);
    // No glyphs for line breaks.
    expect(sets.common.has(0x0a)).toBe(false);
  });
});

describe("second layer", () => {
  const css = `/* header */@font-face{font-family:"Z";src:local("Z"),url("./a1.woff2")format("woff2");unicode-range:U+4E00-4E03;}
@font-face{font-family:"Z";src:url("./b2.woff2")format("woff2");unicode-range:U+41-42;}`;

  test("parses cn-font-split rules", () => {
    const chunks = parseChunks(css);
    expect(chunks.map((chunk) => chunk.file)).toEqual(["a1.woff2", "b2.woff2"]);
    expect(chunks[0]?.codePoints.size).toBe(4);
  });

  test("takes covered characters out and drops empty chunks", () => {
    const covered = new Set([0x4e_00, 0x4e_02, 0x41, 0x42]);
    const rest = restChunks(parseChunks(css), covered);
    expect(rest).toHaveLength(1);
    expect(toUnicodeRange(rest[0]?.codePoints ?? [])).toBe("U+4E01,U+4E03");
  });
});

describe("@font-face rules", () => {
  test("writes descriptors and an optional range", () => {
    const rule = faceRule({
      family: "Z",
      src: ['url("/a.woff2") format("woff2")'],
      range: "U+41",
      descriptors: { "size-adjust": "95%" },
    });
    expect(rule).toBe(
      '@font-face{font-family:"Z";src:url("/a.woff2") format("woff2");font-style:normal;font-weight:400;font-display:swap;size-adjust:95%;unicode-range:U+41}'
    );
    expect(faceRule({ family: "Z", src: [] })).not.toContain("unicode-range");
  });
});

describe("fallback metrics", () => {
  const metrics = {
    unitsPerEm: 1000,
    ascent: 1050,
    descent: -150,
    lineGap: 200,
  };

  test("line box overrides follow the web font, scaled by size-adjust", () => {
    expect(lineOverrides(metrics)).toEqual({
      "ascent-override": "105%",
      "descent-override": "15%",
      "line-gap-override": "20%",
    });
    expect(lineOverrides(metrics, 0.5)["ascent-override"]).toBe("210%");
  });

  test("size-adjust is the ratio of average Latin advances", () => {
    expect(sizeAdjust(0.52, 0.52)).toBe(1);
    expect(sizeAdjust(0.5, 0.25)).toBe(2);
    expect(sizeAdjust(0.5, 0)).toBe(1);
    const average = averageAdvance("ab", 1000, (code) =>
      code === cp("a") ? 400 : 600
    );
    expect(average).toBe(0.5);
    expect(codePointsOf("𠀀a").size).toBe(2);
  });
});

describe("generated font CSS (bun run fonts)", () => {
  const faces = FONT_FACES.split("\n");
  const rules = (family: string) =>
    faces.filter((face) => face.includes(`font-family:"${family}"`));

  test("one or two site files per family, the first without a range", () => {
    for (const family of ["Xiaolai", "Zhuque Fangsong"]) {
      const own = rules(family);
      expect(own.length).toBeGreaterThanOrEqual(1);
      expect(own.length).toBeLessThanOrEqual(2);
      expect(own[0]).not.toContain("unicode-range");
      for (const rule of own.slice(1)) {
        expect(rule).toContain("unicode-range");
      }
    }
  });

  test("metric-matched fallback faces", () => {
    for (const family of ["Xiaolai Fallback", "Zhuque Fangsong Fallback"]) {
      const own = rules(family);
      expect(own).toHaveLength(2);
      expect(own.join("")).toContain("ascent-override");
      expect(own.join("")).toContain("size-adjust");
    }
  });

  test("the rest stylesheet is hashed and never overlaps the site files", async () => {
    expect(FONT_REST_CSS).toMatch(REST_NAME);
    const restCss = await Bun.file(`public${FONT_REST_CSS}`).text();
    for (const family of ["Xiaolai", "Zhuque Fangsong"]) {
      const site = new Set<number>();
      for (const rule of rules(family).slice(1)) {
        for (const code of rangeOf(rule)) {
          site.add(code);
        }
      }
      const rest = restCss
        .split("\n")
        .filter((line) => line.includes(`font-family:"${family}"`));
      expect(rest.length).toBeGreaterThan(0);
      for (const line of rest) {
        const range = rangeOf(line);
        for (const code of range) {
          expect(site.has(code)).toBe(false);
        }
      }
    }
  });

  test("every site character is in a site file, not in a rest chunk", async () => {
    const restCss = await Bun.file(`public${FONT_REST_CSS}`).text();
    const restCodes = new Set<number>();
    for (const line of restCss.split("\n")) {
      if (line.includes('font-family:"Zhuque Fangsong"')) {
        for (const code of rangeOf(line)) {
          restCodes.add(code);
        }
      }
    }
    // Characters on every page (toolbar, intro card).
    for (const char of "搜索笔记这本手账属于") {
      expect(restCodes.has(cp(char))).toBe(false);
    }
  });
});
