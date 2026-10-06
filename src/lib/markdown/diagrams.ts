/*
 * Mermaid blocks become hand-drawn diagrams. The SVGs are rendered ahead of
 * time by scripts/build-diagrams.ts (`bun run diagrams`, needs a browser)
 * and committed to src/assets/diagrams/; this Sätteri plugin only inlines
 * them, so the build needs no browser. Loaded by astro.config.mjs through
 * ./config.ts: imports stay relative.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SatteriProcessorOptions } from "@astrojs/markdown-satteri";
import type { Element, ElementContent } from "hast";
import { type HastVisitorContext, htmlToHast } from "satteri";
import {
  DIAGRAM_DIR,
  diagramHash,
  diagramId,
  normaliseDiagramSource,
  readableDiagramSource,
} from "./diagram-hash.ts";

type Entry<T> = T extends readonly (infer E)[] ? E : never;
type HastPlugin = Extract<
  Entry<NonNullable<SatteriProcessorOptions["hastPlugins"]>>,
  { name: string }
>;
const MERMAID = "mermaid";
const MERMAID_CLASS = `language-${MERMAID}`;

const codeOf = (pre: Readonly<Element>) =>
  pre.children.find(
    (child): child is Element =>
      child.type === "element" && child.tagName === "code"
  );

const classList = (node: Readonly<Element> | undefined): string[] => {
  const value: unknown = node?.properties?.className;
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return typeof value === "string" ? value.split(" ") : [];
};

/**
 * A ```mermaid block: `<pre><code class="language-mermaid">` when the
 * highlighter skips the language, `<pre data-language="mermaid">` when
 * Shiki took it. The source copy this plugin puts under 图的文字版 is marked
 * `data-diagram-source` and left alone.
 */
export const isMermaidPre = (pre: Readonly<Element>) => {
  if (
    pre.tagName !== "pre" ||
    pre.properties?.dataDiagramSource !== undefined
  ) {
    return false;
  }
  return (
    pre.properties?.dataLanguage === MERMAID ||
    classList(codeOf(pre)).includes(MERMAID_CLASS)
  );
};

/** The fence body of a mermaid <pre>, as the hash sees it. */
export const mermaidSourceOf = (
  pre: Readonly<Element>,
  ctx: HastVisitorContext
) => normaliseDiagramSource(ctx.textContent(pre));

const text = (value: string): ElementContent => ({ type: "text", value });

// Inline SVG needs no xmlns, and Sätteri's HTML parser mangles it (`:xmlns`).
const XMLNS = /\sxmlns="[^"]*"/;

/**
 * The SVG as hast. Markdown takes it as a raw node, byte for byte; MDX
 * compiles to JSX and cannot hold raw HTML, so there it is parsed.
 */
const svgContent = (svg: string, format: "markdown" | "mdx") => {
  if (format === "markdown") {
    return [{ type: "raw", value: svg }] as ElementContent[];
  }
  const tree = htmlToHast(svg.replace(XMLNS, ""), {
    fragment: true,
    space: "svg",
  });
  return "children" in tree ? (tree.children as ElementContent[]) : [];
};

/**
 * <figure class="diagram" aria-labelledby="chart-title-mmd-…">
 *   <div class="diagram-sheet" tabindex="0"><svg …/></div>
 *   <details class="diagram-source"><summary>图的文字版</summary>
 *     <pre data-diagram-source><code class="language-mermaid">…</code></pre>
 *   </details>
 * </figure>
 * The sheet scrolls sideways when the diagram is wider than the page, so it
 * is focusable like a code block. The SVG keeps mermaid's own labelling:
 * <title> (accTitle) and <desc> (accDescr).
 */
export const diagramFigure = (
  source: string,
  svg: string,
  format: "markdown" | "mdx" = "markdown"
): Element => {
  const id = diagramId(diagramHash(source));
  return {
    children: [
      {
        children: svgContent(svg, format),
        properties: { className: ["diagram-sheet"], tabIndex: 0 },
        tagName: "div",
        type: "element",
      },
      {
        children: [
          {
            children: [text("图的文字版")],
            properties: {},
            tagName: "summary",
            type: "element",
          },
          {
            children: [
              {
                children: [text(readableDiagramSource(source))],
                properties: { className: [MERMAID_CLASS] },
                tagName: "code",
                type: "element",
              },
            ],
            properties: { dataDiagramSource: "" },
            tagName: "pre",
            type: "element",
          },
        ],
        properties: { className: ["diagram-source"] },
        tagName: "details",
        type: "element",
      },
    ],
    properties: {
      ariaLabelledBy: [`chart-title-${id}`],
      className: ["diagram"],
    },
    tagName: "figure",
    type: "element",
  };
};

const where = (fileURL: URL | undefined) =>
  fileURL ? ` (${decodeURIComponent(fileURL.pathname)})` : "";

/** A plugin that reads the SVGs from `dir` (tests point it elsewhere). */
export const createMermaidDiagrams = (dir: string): HastPlugin => {
  const cache = new Map<string, string>();
  const svgFor = (source: string, fileURL: URL | undefined) => {
    const hash = diagramHash(source);
    const cached = cache.get(hash);
    if (cached !== undefined) {
      return cached;
    }
    const file = join(dir, `${hash}.svg`);
    let svg: string;
    try {
      svg = readFileSync(file, "utf8");
    } catch (error) {
      throw new Error(
        `Mermaid 图 ${hash} 还没有渲染${where(fileURL)}：先运行 bun run diagrams，再提交 ${DIAGRAM_DIR}/${hash}.svg`,
        { cause: error }
      );
    }
    cache.set(hash, svg);
    return svg;
  };
  return {
    element: {
      filter: ["pre"],
      visit(pre, ctx) {
        if (!isMermaidPre(pre)) {
          return;
        }
        const source = mermaidSourceOf(pre, ctx);
        const svg = svgFor(source, ctx.fileURL);
        ctx.replaceNode(pre, diagramFigure(source, svg, ctx.sourceFormat));
      },
    },
    name: "journal-mermaid-diagrams",
  };
};

/**
 * Replace every ```mermaid block with its pre-rendered SVG. Runs before
 * codeSlips (config.ts). A block without an SVG fails the build.
 */
export const mermaidDiagrams = createMermaidDiagrams(
  join(process.cwd(), DIAGRAM_DIR)
);

/** A plugin that only records mermaid sources (build-diagrams.ts). */
export const collectMermaid = (into: string[]): HastPlugin => ({
  element: {
    filter: ["pre"],
    visit(pre, ctx) {
      if (isMermaidPre(pre)) {
        into.push(mermaidSourceOf(pre, ctx));
      }
    },
  },
  name: "journal-collect-mermaid",
});
