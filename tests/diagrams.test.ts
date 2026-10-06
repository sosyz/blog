import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdownToHtml, mdxToJs } from "satteri";
import {
  accTitleOf,
  DIAGRAM_DIR,
  DIAGRAM_FILE,
  DIAGRAM_PALETTE,
  diagramHash,
  diagramId,
  readableDiagramSource,
} from "../src/lib/markdown/diagram-hash";
import {
  collectMermaid,
  createMermaidDiagrams,
  isMermaidPre,
  mermaidDiagrams,
} from "../src/lib/markdown/diagrams";
import { rejectionMessage } from "./support/rejection";

const POSTS = "src/posts";
const MERMAID_FENCE = /^[ \t]*(?:```|~~~)mermaid\b/gm;
const DIAGRAM_FIGURE = /<figure [^>]*class="diagram"/g;
const EDGE_LABEL = /class="edgeLabel"/;
const EDGE_LABEL_RECT = /<rect[^>]*class="background"/;
const FORBIDDEN = /<script|<foreignObject|@import|\son[a-z]+=/i;

const posts = readdirSync(POSTS).filter((file) => file.endsWith(".md"));
const svgFiles = readdirSync(DIAGRAM_DIR).filter((file) =>
  file.endsWith(".svg")
);

const fence = (source: string) => `\`\`\`mermaid\n${source}\n\`\`\`\n`;

describe("committed diagrams (bun run diagrams)", () => {
  test("every mermaid block in the notes has an SVG", async () => {
    let blocks = 0;
    for (const post of posts) {
      const markdown = readFileSync(join(POSTS, post), "utf8");
      const expected = markdown.match(MERMAID_FENCE)?.length ?? 0;
      if (expected === 0) {
        continue;
      }
      blocks += expected;
      // The build plugin throws when an SVG is missing.
      const { html } = await markdownToHtml(markdown, {
        hastPlugins: [mermaidDiagrams],
      });
      expect(html.match(DIAGRAM_FIGURE)?.length ?? 0).toBe(expected);
    }
    expect(blocks).toBeGreaterThan(0);
  });

  test("no stray files: every SVG belongs to a block in a note", async () => {
    const sources: string[] = [];
    for (const post of posts) {
      const markdown = readFileSync(join(POSTS, post), "utf8");
      await markdownToHtml(markdown, {
        hastPlugins: [collectMermaid(sources)],
      });
    }
    const used = new Set(sources.map((source) => `${diagramHash(source)}.svg`));
    expect(new Set(svgFiles)).toEqual(used);
    for (const file of svgFiles) {
      expect(file).toMatch(DIAGRAM_FILE);
    }
  });

  for (const file of svgFiles) {
    test(`${file} is safe to inline and labelled`, () => {
      const svg = readFileSync(join(DIAGRAM_DIR, file), "utf8");
      const id = diagramId(file.replace(".svg", ""));
      expect(svg).not.toMatch(FORBIDDEN);
      expect(
        svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" id="${id}"`)
      ).toBe(true);
      expect(svg).toContain('role="graphics-document document"');
      expect(svg).toContain(`aria-labelledby="chart-title-${id}"`);
      expect(svg).toContain(`aria-describedby="chart-desc-${id}"`);
      expect(svg).toContain(`<title id="chart-title-${id}">`);
      expect(svg).not.toContain(`<title id="chart-title-${id}"></title>`);
      expect(svg).toContain(`<desc id="chart-desc-${id}">`);
      expect(svg).not.toContain(`<desc id="chart-desc-${id}"></desc>`);
      // Natural width for diagrams.css; no mermaid width="100%".
      expect(svg).toContain('style="--w:');
      expect(svg).not.toContain('width="100%"');
      // SVGO must not turn edge-label backgrounds into paths (black boxes).
      if (EDGE_LABEL.test(svg)) {
        expect(svg).toMatch(EDGE_LABEL_RECT);
      }
    });
  }
});

describe("render config", () => {
  test("palette matches tokens.css", () => {
    const tokens = readFileSync("src/styles/tokens.css", "utf8");
    for (const [name, value] of Object.entries(DIAGRAM_PALETTE)) {
      expect(tokens).toContain(`--${name}: ${value};`);
    }
  });

  test("hash ignores line endings and outer blank lines only", () => {
    const source = "graph LR\n  A --> B";
    expect(diagramHash(`\n${source}\n\n`)).toBe(diagramHash(source));
    expect(diagramHash(source.replace("\n", "\r\n"))).toBe(diagramHash(source));
    expect(diagramHash(`${source} --> C`)).not.toBe(diagramHash(source));
    expect(`${diagramHash(source)}.svg`).toMatch(DIAGRAM_FILE);
  });

  test("accTitle is read; acc lines are left out of the text version", () => {
    const source = "graph LR\n  accTitle: 标题\n  accDescr: 说明\n  A --> B";
    expect(accTitleOf(source)).toBe("标题");
    expect(accTitleOf("graph LR\n A --> B")).toBe("");
    expect(readableDiagramSource(source)).toBe("graph LR\n  A --> B");
  });
});

describe("mermaidDiagrams plugin", () => {
  const dir = mkdtempSync(join(tmpdir(), "diagrams-"));
  afterAll(() => rmSync(dir, { force: true, recursive: true }));

  const source = "graph LR\n  accTitle: 测试图\n  A[甲] --> B[乙]";
  const hash = diagramHash(source);
  const id = diagramId(hash);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="${id}" aria-labelledby="chart-title-${id}" role="graphics-document document" viewBox="0 0 10 10"><title id="chart-title-${id}">测试图</title><rect width="10" height="10"/></svg>`;
  writeFileSync(join(dir, `${hash}.svg`), svg);
  const plugin = createMermaidDiagrams(dir);

  test("replaces a mermaid block with figure.diagram", async () => {
    const markdown = `前文\n\n${fence(source)}\n\`\`\`ts\nconst a = 1;\n\`\`\`\n`;
    const { html } = await markdownToHtml(markdown, { hastPlugins: [plugin] });
    expect(html).toContain(
      `<figure aria-labelledby="chart-title-${id}" class="diagram">`
    );
    expect(html).toContain(
      `<div class="diagram-sheet" tabindex="0">${svg}</div>`
    );
    expect(html).toContain("<summary>图的文字版</summary>");
    expect(html).toContain(
      '<pre data-diagram-source=""><code class="language-mermaid">graph LR\n  A[甲] --&gt; B[乙]</code></pre>'
    );
    // Other code blocks are left for codeSlips.
    expect(html).toContain('<pre><code class="language-ts">');
  });

  test("works in MDX, which cannot hold raw HTML", async () => {
    const { code } = await mdxToJs(fence(source), { hastPlugins: [plugin] });
    expect(code).toContain(`chart-title-${id}`);
    expect(code).toContain("测试图");
  });

  test("fails the build when the SVG was never rendered", async () => {
    const markdown = fence("graph LR\n  accTitle: 没渲染\n  X --> Y");
    // Sätteri throws synchronously when every plugin is synchronous.
    const compile = async () =>
      await markdownToHtml(markdown, { hastPlugins: [plugin] });
    expect(await rejectionMessage(compile())).toContain("bun run diagrams");
  });

  test("recognises Shiki's pre and skips its own source copy", () => {
    const code = {
      children: [],
      properties: { className: ["language-mermaid"] },
      tagName: "code",
      type: "element" as const,
    };
    const pre = (properties: Record<string, string>) => ({
      children: [code],
      properties,
      tagName: "pre",
      type: "element" as const,
    });
    expect(isMermaidPre(pre({}))).toBe(true);
    expect(
      isMermaidPre({ ...pre({ dataLanguage: "mermaid" }), children: [] })
    ).toBe(true);
    expect(isMermaidPre(pre({ dataDiagramSource: "" }))).toBe(false);
    expect(isMermaidPre({ ...pre({}), children: [] })).toBe(false);
  });
});
