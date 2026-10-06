// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import { createSatteriMarkdownProcessor } from "@astrojs/markdown-satteri";
import { markdownToHtml } from "satteri";
import {
  codeSlips,
  parseFenceMeta,
  shikiConfig,
} from "../src/lib/markdown/plugins";

const FILE = new URL("file:///blog/src/posts/demo-note.md");
const FENCE = "```";
const LINE_CLASS = /<span class="([^"]*\bline\b[^"]*)"/g;

/** The site's Shiki settings and codeSlips, as config.ts wires them. */
const renderer = createSatteriMarkdownProcessor({
  hastPlugins: [codeSlips],
  shikiConfig,
  syntaxHighlight: { excludeLangs: ["math", "mermaid"], type: "shiki" },
});

const render = async (markdown: string) => {
  const { code } = await (await renderer).render(markdown, { fileURL: FILE });
  return code;
};

const fence = (meta: string, body: string) =>
  `${FENCE}${meta}\n${body}\n${FENCE}\n`;

const linesOf = (html: string) =>
  [...html.matchAll(LINE_CLASS)].map((match) => match[1] ?? "");

describe("codeSlips", () => {
  test("wraps a block in a slip with a kraft label, copy tab and status", async () => {
    const html = await render(fence('ts title="gateway.ts"', "const a = 1;"));
    expect(html).toContain('<figure class="slip" data-lang="ts"');
    expect(html).toContain("data-no-annotate");
    expect(html).toContain('<figcaption class="fname">gateway.ts</figcaption>');
    expect(html).toContain(
      '<button aria-label="复制代码" class="slip-copy" type="button">复制</button>'
    );
    expect(html).toContain('<span class="slip-said" role="status"></span>');
    // figcaption is the figure's last child.
    expect(html).toContain("</figcaption></figure>");
  });

  test("labels shell blocks terminal and bare blocks code", async () => {
    expect(await render(fence("bash", "bun add ai"))).toContain(
      '<figcaption class="fname">terminal</figcaption>'
    );
    expect(await render(fence("", "plain"))).toContain(
      '<figcaption class="fname">code</figcaption>'
    );
  });

  test("leaves mermaid blocks for the diagrams plugin", async () => {
    const html = await render(fence("mermaid", "graph TD\n  A --> B"));
    expect(html).not.toContain("slip");
    expect(html).toContain('class="language-mermaid"');
  });

  test("skips mermaid even without a highlighter", async () => {
    const { html } = await markdownToHtml(fence("mermaid", "graph TD"), {
      hastPlugins: [codeSlips({ fileURL: FILE })],
    });
    expect(html).not.toContain("slip");
  });

  test("collapse folds the block into details with the line count", async () => {
    const body = Array.from({ length: 30 }, (_, i) => `const v${i} = ${i};`);
    const html = await render(fence("ts collapse", body.join("\n")));
    expect(html).toContain('<details class="slip-fold"><summary>');
    expect(html).toContain("展开代码（30 行）");
    expect(html).toContain("收起代码");
    expect(html).toContain("</summary><pre ");
    // A folded slip keeps its tilt even when long.
    expect(html).toContain("--sr: -0.4deg");
  });

  test("long blocks without collapse lie straight", async () => {
    const body = Array.from({ length: 30 }, (_, i) => `v${i}`);
    const html = await render(fence("text", body.join("\n")));
    expect(html).not.toContain("<details");
    expect(html).toContain("--sr: 0deg");
  });
});

describe("marked lines", () => {
  test("{1,3} in the meta highlights those lines", async () => {
    const html = await render(fence("js {1,3}", "a();\nb();\nc();"));
    expect(linesOf(html)).toEqual([
      "line highlighted",
      "line",
      "line highlighted",
    ]);
  });

  test("/word/ in the meta marks the word", async () => {
    const html = await render(fence("js /token/", "const token = 1;"));
    expect(html).toContain('class="highlighted-word"');
  });

  test("a title path is not read as a /word/", async () => {
    const html = await render(
      fence('js title="src/lib/a.js"', "const lib = 1;")
    );
    expect(html).not.toContain("highlighted-word");
    expect(html).toContain(
      '<figcaption class="fname">src/lib/a.js</figcaption>'
    );
  });

  test("[!code ++] / [!code --] comments become diff lines", async () => {
    const html = await render(
      fence("js", "old(); // [!code --]\nnext(); // [!code ++]\nsame();")
    );
    expect(linesOf(html)).toEqual([
      "line diff remove",
      "line diff add",
      "line",
    ]);
    expect(html).not.toContain("[!code");
  });

  test("showLineNumbers marks the pre", async () => {
    const html = await render(fence("js showLineNumbers", "a();"));
    expect(html).toContain("data-line-numbers");
  });
});

describe("parseFenceMeta", () => {
  test("reads the title and the bare flags", () => {
    expect(parseFenceMeta('title="a b.ts" collapse {1}')).toEqual({
      collapse: true,
      lineNumbers: false,
      title: "a b.ts",
    });
    expect(parseFenceMeta("file=x.go showLineNumbers")).toEqual({
      collapse: false,
      lineNumbers: true,
      title: "x.go",
    });
    expect(parseFenceMeta('title="collapsed.ts"').collapse).toBe(false);
  });
});

describe("inks", () => {
  test("functions are vermilion, punctuation pencil, keywords blue", async () => {
    const html = await render(fence("ts", "const x = run(1);"));
    expect(html).toContain('<span style="color:#9E3129"> run</span>');
    expect(html).toContain('<span style="color:#524A3E">(</span>');
    expect(html).toContain('<span style="color:#3D5F8F">const</span>');
  });
});
