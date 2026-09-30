/**
 * Render the notes' ```mermaid blocks to hand-drawn SVGs.
 *
 * Usage: bun run diagrams            render the blocks that have no SVG yet
 *        bun run diagrams --force    render every block again
 *
 * Run it after adding or changing a mermaid block, then commit
 * src/assets/diagrams/. The build only inlines these files
 * (src/lib/markdown/diagrams.ts) and fails when one is missing, so it never
 * needs a browser.
 *
 * Needs:
 * - Google Chrome: the macOS default path, or set CHROME_PATH (playwright-core
 *   drives the installed browser; nothing is downloaded).
 * - fonts-src/xiaolai-regular.ttf (not committed; see scripts/build-fonts.ts):
 *   labels are measured in 小赖, the font the page sets them in.
 *
 * Every block needs an `accTitle:` line (and should have `accDescr:`): mermaid
 * turns them into the SVG's <title> and <desc>, which screen readers read.
 *
 * File name: first 12 hex of sha256(DIAGRAM_CONFIG_VERSION + render config +
 * source) (src/lib/markdown/diagram-hash.ts). Bump the version after
 * upgrading mermaid or svgo. SVGs no note uses any more are deleted.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Glob } from "bun";
import { consola } from "consola";
import type MermaidApi from "mermaid";
import { chromium, type Page } from "playwright-core";
import { markdownToHtml } from "satteri";
import { optimize } from "svgo";
import {
  accTitleOf,
  DIAGRAM_DIR,
  DIAGRAM_FILE,
  diagramHash,
  diagramId,
  MERMAID_CONFIG,
} from "../src/lib/markdown/diagram-hash.ts";
import { collectMermaid } from "../src/lib/markdown/diagrams.ts";
import { splitFrontmatter } from "./font-chars.ts";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, DIAGRAM_DIR);
const FONT = join(ROOT, "fonts-src/xiaolai-regular.ttf");
const MERMAID_DIST = dirname(fileURLToPath(import.meta.resolve("mermaid")));
const DEFAULT_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FORCE = process.argv.includes("--force");

type Diagram = { post: string; source: string; hash: string };

/* ---------- finding the blocks ---------- */

/**
 * Every mermaid block, read through Sätteri with the same detection and
 * normalisation as the build plugin, so the hashes match.
 */
const findDiagrams = async () => {
  const diagrams: Diagram[] = [];
  for await (const file of new Glob("src/posts/**/*.{md,mdx}").scan(ROOT)) {
    const { body } = splitFrontmatter(await Bun.file(join(ROOT, file)).text());
    if (!(body.includes("```mermaid") || body.includes("~~~mermaid"))) {
      continue;
    }
    const sources: string[] = [];
    await markdownToHtml(body, { hastPlugins: [collectMermaid(sources)] });
    for (const source of sources) {
      diagrams.push({ post: file, source, hash: diagramHash(source) });
    }
  }
  return diagrams.sort((a, b) => a.post.localeCompare(b.post));
};

/* ---------- rendering ---------- */

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>@font-face{font-family:"Xiaolai";src:url("/xiaolai.ttf")}</style></head>
<body><script type="module">
import mermaid from "/mermaid/mermaid.esm.min.mjs";
await document.fonts.load('15px "Xiaolai"', "图");
window.mermaid = mermaid;
window.ready = true;
</script></body></html>`;

/** A local page that loads mermaid's ESM build and the 小赖 TTF. */
const serve = () =>
  Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/") {
        return new Response(PAGE, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (pathname === "/xiaolai.ttf") {
        return new Response(Bun.file(FONT));
      }
      if (pathname.startsWith("/mermaid/")) {
        const file = normalize(
          join(
            MERMAID_DIST,
            decodeURIComponent(pathname.slice("/mermaid/".length))
          )
        );
        if (!relative(MERMAID_DIST, file).startsWith("..")) {
          return new Response(Bun.file(file));
        }
      }
      return new Response("not found", { status: 404 });
    },
  });

type RenderArgs = { config: typeof MERMAID_CONFIG; source: string; id: string };

const render = (page: Page, source: string, id: string) =>
  page.evaluate(
    async ({ config, source: text, id: svgId }: RenderArgs) => {
      const { mermaid } = globalThis as unknown as {
        mermaid: typeof MermaidApi;
      };
      mermaid.initialize(structuredClone(config) as never);
      const { svg } = await mermaid.render(svgId, text);
      return svg;
    },
    { config: MERMAID_CONFIG, source, id }
  );

/* ---------- post-processing ---------- */

const ROOT_TAG = /^<svg\b[^>]*>/;
const VIEW_BOX = /\sviewBox="([^"]+)"/;
const WIDTH_ATTR = /\swidth="[^"]*"/;
const STYLE_ATTR = /\sstyle="[^"]*"/;
const ROLE_DESCRIPTION = /aria-roledescription="flowchart(?:-v2)?"/;
// Mermaid's edge animations: nothing here animates (design.md 动效).
const KEYFRAMES = /@keyframes [\w-]+\{(?:[^{}]*\{[^{}]*\})*\}/g;
const EDGE_ANIMATION = /#[\w-]+ \.edge-animation-(?:slow|fast)\{[^}]*\}/g;
const FORBIDDEN = /<script|<foreignObject|@import|\son[a-z]+=/i;
const VIEW_BOX_PARTS = 4;
const WIDTH_INDEX = 2;
const HEIGHT_INDEX = 3;
const ONE_DECIMAL = 10;

const round = (value: number) => Math.round(value * ONE_DECIMAL) / ONE_DECIMAL;

/**
 * Give the <svg> its real size instead of mermaid's width="100%" and inline
 * max-width, so diagrams.css decides how far it may shrink (it scrolls
 * sideways past that). The natural width goes into `--w`.
 */
const sizeRoot = (svg: string) => {
  const tag = ROOT_TAG.exec(svg)?.[0];
  const box = tag ? VIEW_BOX.exec(tag)?.[1]?.split(" ").map(Number) : undefined;
  if (!(tag && box) || box.length !== VIEW_BOX_PARTS) {
    throw new Error("mermaid 输出的 <svg> 没有 viewBox");
  }
  const width = round(box[WIDTH_INDEX] ?? 0);
  const height = round(box[HEIGHT_INDEX] ?? 0);
  const sized = tag
    .replace(WIDTH_ATTR, "")
    .replace(STYLE_ATTR, "")
    .replace(ROLE_DESCRIPTION, 'aria-roledescription="流程图"')
    .slice(0, -1);
  return svg.replace(
    tag,
    `${sized} width="${width}" height="${height}" style="--w:${width}px">`
  );
};

const minify = (svg: string) =>
  optimize(svg, {
    multipass: true,
    floatPrecision: 1,
    plugins: [
      {
        name: "preset-default",
        params: {
          overrides: {
            // Keep ids: <title>/<desc>, markers and aria-labelledby use them.
            cleanupIds: false,
            // Turning the edge-label rects into paths leaves black boxes.
            convertShapeToPath: false,
            inlineStyles: false,
            minifyStyles: false,
            removeUnknownsAndDefaults: false,
            removeDesc: false,
          },
        },
      },
    ],
  }).data;

const finish = (raw: string, diagram: Diagram) => {
  const svg = minify(
    sizeRoot(raw).replace(KEYFRAMES, "").replace(EDGE_ANIMATION, "")
  );
  if (FORBIDDEN.test(svg)) {
    throw new Error(`${diagram.post}：SVG 里有脚本、foreignObject 或 @import`);
  }
  if (!svg.includes(`<title id="chart-title-${diagramId(diagram.hash)}"`)) {
    throw new Error(`${diagram.post}：SVG 没有 <title>`);
  }
  return svg;
};

/* ---------- main ---------- */

const chromePath = () => {
  const path = process.env.CHROME_PATH ?? DEFAULT_CHROME;
  if (!existsSync(path)) {
    throw new Error(
      `找不到 Chrome：${path}。安装 Google Chrome，或把 CHROME_PATH 设成 Chrome / Chromium 可执行文件的路径。`
    );
  }
  return path;
};

const renderAll = async (todo: readonly Diagram[]) => {
  if (!existsSync(FONT)) {
    throw new Error(
      `缺少 ${relative(ROOT, FONT)}（不进仓库，来源见 scripts/build-fonts.ts 开头）`
    );
  }
  const server = serve();
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.waitForFunction(() => "ready" in globalThis);
    for (const diagram of todo) {
      const raw = await render(page, diagram.source, diagramId(diagram.hash));
      await Bun.write(
        join(OUT_DIR, `${diagram.hash}.svg`),
        finish(raw, diagram)
      );
      consola.info(`${diagram.post} → ${DIAGRAM_DIR}/${diagram.hash}.svg`);
    }
  } finally {
    await browser.close();
    server.stop(true);
  }
};

const removeUnused = async (used: Set<string>) => {
  const removed: string[] = [];
  for (const file of await readdir(OUT_DIR)) {
    if (DIAGRAM_FILE.test(file) && !used.has(file)) {
      await rm(join(OUT_DIR, file));
      removed.push(file);
    }
  }
  return removed;
};

const main = async () => {
  const diagrams = await findDiagrams();
  const untitled = diagrams.filter((diagram) => !accTitleOf(diagram.source));
  if (untitled.length > 0) {
    const posts = [...new Set(untitled.map((diagram) => diagram.post))];
    throw new Error(
      `这些笔记的 mermaid 块缺少 accTitle: 一行（读屏软件读它）：${posts.join("、")}`
    );
  }
  await mkdir(OUT_DIR, { recursive: true });
  const unique = [
    ...new Map(diagrams.map((diagram) => [diagram.hash, diagram])).values(),
  ];
  const todo = unique.filter(
    (diagram) => FORCE || !existsSync(join(OUT_DIR, `${diagram.hash}.svg`))
  );
  if (todo.length > 0) {
    await renderAll(todo);
  }
  const removed = await removeUnused(
    new Set(unique.map((diagram) => `${diagram.hash}.svg`))
  );
  consola.success(
    `${unique.length} 张图：渲染 ${todo.length}，已有 ${unique.length - todo.length}，删除 ${removed.length}`
  );
};

try {
  await main();
} catch (error) {
  consola.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
