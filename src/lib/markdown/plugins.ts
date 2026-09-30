/*
 * Sätteri plugins that turn plain Markdown into journal pages.
 *
 * Loaded by astro.config.mjs (through ./config.ts), so imports stay relative.
 * They run after Astro's highlighter and before its image and heading-id
 * passes. See ./README.md for what each one emits and why.
 */
import type { SatteriProcessorOptions } from "@astrojs/markdown-satteri";
import {
  transformerMetaHighlight,
  transformerMetaWordHighlight,
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import type { AstroUserConfig } from "astro";
import type { Element, ElementContent } from "hast";
import type { PhrasingContent } from "mdast";
import { inkTheme } from "./ink-theme.ts";

type Entry<T> = T extends readonly (infer E)[] ? E : never;
type ShikiConfig = NonNullable<
  NonNullable<AstroUserConfig["markdown"]>["shikiConfig"]
>;
type ShikiTransformer = Entry<NonNullable<ShikiConfig["transformers"]>>;
type HastPlugin = Extract<
  Entry<NonNullable<SatteriProcessorOptions["hastPlugins"]>>,
  { name: string }
>;
type MdastPlugin = Extract<
  Entry<NonNullable<SatteriProcessorOptions["mdastPlugins"]>>,
  { name: string }
>;
/** What a plugin factory is told about the document (satteri). */
type FactoryContext = { readonly fileURL: URL | undefined };
/** A node Sätteri renders through `data.hName` (see satteri `Custom`). */
type CustomNode = {
  type: string;
  children: PhrasingContent[];
  data: { hName: string };
};

/* ---------- helpers ---------- */

const EXTENSION = /\.(md|mdx)$/;
const WHITESPACE = /\s+/g;
const TRAILING_NEWLINE = /\n$/;

/** Post slug from the file URL: the collection id is the file name. */
const slugOf = (fileURL: URL | undefined) => {
  const last = fileURL?.pathname.split("/").at(-1) ?? "";
  return decodeURIComponent(last).replace(EXTENSION, "");
};

// Park-Miller (MINSTD) step: every product stays below 2^53, so it is exact.
const HASH_SEED = 1_234_567;
const HASH_MULTIPLIER = 48_271;
const HASH_MODULUS = 2_147_483_647;
// The step is linear, so neighbouring keys give evenly spaced values; a sine
// finaliser scatters them.
const SCATTER = 10_000;
const CENTRE = 0.5;
const HUNDREDTHS = 100;

/**
 * Deterministic 0..1 from a string (no bitwise operators) so tape choice and
 * angles never change between builds.
 */
const seeded = (key: string) => {
  let hash = HASH_SEED;
  for (const char of key) {
    hash =
      ((hash + (char.codePointAt(0) ?? 0)) * HASH_MULTIPLIER) % HASH_MODULUS;
  }
  const scattered = Math.sin(hash) * SCATTER;
  return scattered - Math.floor(scattered);
};

/** Angle in degrees in [-span/2, span/2], two decimals. */
const angle = (key: string, span: number) =>
  Math.round((seeded(key) - CENTRE) * span * HUNDREDTHS) / HUNDREDTHS;

const classList = (node: Readonly<Element>): string[] => {
  const value: unknown = node.properties?.className;
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return typeof value === "string" ? value.split(" ") : [];
};

const isBlank = (child: ElementContent) =>
  child.type === "text" && child.value.trim() === "";

/* ---------- fence meta and Shiki ---------- */

// ```ts title="gateway.ts"  or  ```ts file=gateway.ts
const TITLE_META = /(?:title|file)=(?:"([^"]+)"|'([^']+)'|(\S+))/;
// Bare words in the fence meta: ```ts collapse showLineNumbers
const COLLAPSE_META = /(?:^|\s)collapse(?=\s|$)/;
const LINE_NUMBERS_META = /(?:^|\s)showLineNumbers(?=\s|$)/;

type FenceMeta = { title?: string; collapse: boolean; lineNumbers: boolean };
/** Where fenceMeta keeps what it read, in Shiki's per-block `this.meta`. */
const FENCE_META = Symbol("journal-fence-meta");

/** Read the file name and the bare flags from a fence's raw meta. */
export const parseFenceMeta = (raw: string): FenceMeta => {
  const match = TITLE_META.exec(raw);
  const title = match?.[1] ?? match?.[2] ?? match?.[3];
  return {
    ...(title ? { title } : {}),
    collapse: COLLAPSE_META.test(raw),
    lineNumbers: LINE_NUMBERS_META.test(raw),
  };
};

/**
 * Astro only hands the fence meta to Shiki, so read it here and leave it on
 * the <pre> as data-title / data-collapse / data-line-numbers for codeSlips
 * and prose.css. It runs first and drops `title="…"` from the meta the other
 * transformers see, so a path like `title="src/lib/a.ts"` is not read as a
 * `/word/` highlight.
 */
export const fenceMeta: ShikiTransformer = {
  name: "journal-fence-meta",
  preprocess(_code, options) {
    const meta = options.meta as { __raw?: string } | undefined;
    const raw = meta?.__raw;
    if (!(meta && raw)) {
      return;
    }
    (this.meta as Record<symbol, FenceMeta>)[FENCE_META] = parseFenceMeta(raw);
    meta.__raw = raw.replace(TITLE_META, "");
  },
  pre(node) {
    const found = (this.meta as Record<symbol, FenceMeta | undefined>)[
      FENCE_META
    ];
    if (found?.title) {
      node.properties.dataTitle = found.title;
    }
    if (found?.collapse) {
      node.properties.dataCollapse = "";
    }
    if (found?.lineNumbers) {
      node.properties.dataLineNumbers = "";
    }
  },
};

/**
 * Shiki settings for the whole site (config.ts): the three-ink theme, the
 * fence meta, and marked lines from the meta ({1,3-4}, /word/) or from
 * `// [!code ++]`-style comments (the `v3` algorithm counts the comment's
 * own line). See ./README.md for how to write them in a post.
 */
export const shikiConfig: ShikiConfig = {
  theme: inkTheme,
  transformers: [
    fenceMeta,
    transformerMetaHighlight(),
    transformerMetaWordHighlight(),
    transformerNotationDiff({ matchAlgorithm: "v3" }),
    transformerNotationHighlight({ matchAlgorithm: "v3" }),
    transformerNotationWordHighlight({ matchAlgorithm: "v3" }),
  ],
};

/* ---------- code slips ---------- */

/** Washi and masking tapes in public/journal/tape/, cycled per note. */
const TAPES = [
  "washi-grid-ivory",
  "washi-stripes-pink",
  "washi-dots-mustard",
  "washi-plain-sage",
  "masking-cream",
  "kraft-brown",
] as const;

const SHELL_LANGS = new Set([
  "bash",
  "sh",
  "shell",
  "shellscript",
  "shellsession",
  "zsh",
  "console",
]);

/** Slips taller than this lie straight: a long rotated block drifts and blurs. */
const STRAIGHT_AFTER_LINES = 24;
/** Slip tilt (prototype value) and the range of tape tilts, in degrees. */
const SLIP_TILT = -0.4;
const TAPE_TILT_SPAN = 7;

const languageOf = (pre: Readonly<Element>) => {
  const fromShiki = pre.properties?.dataLanguage;
  if (typeof fromShiki === "string") {
    return fromShiki;
  }
  const code = pre.children.find(
    (child): child is Element =>
      child.type === "element" && child.tagName === "code"
  );
  const langClass = code
    ? classList(code).find((name) => name.startsWith("language-"))
    : undefined;
  return langClass?.slice("language-".length) ?? "plaintext";
};

/** Kraft label text: a file name from the fence meta, else the language. */
const labelOf = (pre: Readonly<Element>, lang: string) => {
  const title = pre.properties?.dataTitle;
  if (typeof title === "string" && title !== "") {
    return title;
  }
  if (SHELL_LANGS.has(lang)) {
    return "terminal";
  }
  return lang === "plaintext" || lang === "" ? "code" : lang;
};

/** Languages another plugin draws (diagrams.ts); never put on a slip. */
const NOT_CODE = new Set(["mermaid"]);

const textNode = (value: string): ElementContent => ({
  type: "text",
  value,
});

const spanOf = (className: string, value: string): Element => ({
  type: "element",
  tagName: "span",
  properties: { className: [className] },
  children: [textNode(value)],
});

/**
 * A folded slip: `<details>` with the pre inside and a summary that reads
 * 展开代码（N 行） while closed and 收起代码 while open (prose.css shows one
 * span at a time, so the button's accessible name follows its state).
 */
const folded = (pre: Readonly<Element>, lines: number): Element => ({
  type: "element",
  tagName: "details",
  properties: { className: ["slip-fold"] },
  children: [
    {
      type: "element",
      tagName: "summary",
      properties: {},
      children: [
        spanOf("slip-open", `展开代码（${lines} 行）`),
        spanOf("slip-close", "收起代码"),
      ],
    },
    pre,
  ],
});

/**
 * Wrap every code block in a taped paper slip with a kraft file-name label
 * and a copy tab (src/scripts/copy.ts copies the code and writes 已复制 into
 * the slip's own status region):
 * <figure class="slip" data-lang data-no-annotate style="--tape --tr --sr">
 *   <pre class="astro-code" data-language …>…</pre>
 *     (or, with `collapse` in the fence meta,
 *      <details class="slip-fold"><summary>…</summary><pre>…</pre></details>)
 *   <button type="button" class="slip-copy" aria-label="复制代码">复制</button>
 *   <span class="slip-said" role="status"></span>
 *   <figcaption class="fname">gateway.ts</figcaption>
 * </figure>
 * The tape is the figure's ::before (no <img> inside the article). Mermaid
 * blocks are left alone for the diagrams plugin.
 */
export const codeSlips = ({ fileURL }: FactoryContext): HastPlugin => {
  const slug = slugOf(fileURL);
  let index = 0;
  return {
    name: "journal-code-slips",
    element: {
      filter: ["pre"],
      visit(pre, ctx) {
        const lang = languageOf(pre);
        if (NOT_CODE.has(lang)) {
          return;
        }
        index += 1;
        const lines = ctx
          .textContent(pre)
          .replace(TRAILING_NEWLINE, "")
          .split("\n").length;
        const tape = TAPES[index % TAPES.length];
        const tapeAngle = angle(`${slug}:${index}:tape`, TAPE_TILT_SPAN);
        const collapse = pre.properties?.dataCollapse !== undefined;
        // A folded slip is short on the page, so it keeps the tilt.
        const straight = lines > STRAIGHT_AFTER_LINES && !collapse;
        ctx.replaceNode(pre, {
          type: "element",
          tagName: "figure",
          properties: {
            className: ["slip"],
            dataLang: lang,
            // Inline comments skip the slip (inline.ts: [data-no-annotate]).
            dataNoAnnotate: "",
            style: `--tape: url("/journal/tape/${tape}.webp"); --tr: ${tapeAngle}deg; --sr: ${straight ? 0 : SLIP_TILT}deg`,
          },
          children: [
            collapse ? folded(pre, lines) : pre,
            {
              type: "element",
              tagName: "button",
              properties: {
                type: "button",
                className: ["slip-copy"],
                ariaLabel: "复制代码",
              },
              children: [textNode("复制")],
            },
            {
              type: "element",
              tagName: "span",
              properties: { className: ["slip-said"], role: "status" },
              children: [],
            },
            {
              type: "element",
              tagName: "figcaption",
              properties: { className: ["fname"] },
              children: [textNode(labelOf(pre, lang))],
            },
          ],
        });
      },
    },
  };
};

/* ---------- polaroid paragraphs ---------- */

const isPicture = (child: ElementContent): boolean => {
  if (child.type !== "element") {
    return false;
  }
  if (child.tagName === "img") {
    return true;
  }
  // A linked image: <a><img></a>.
  return (
    child.tagName === "a" &&
    child.children.some(
      (inner) => inner.type === "element" && inner.tagName === "img"
    ) &&
    child.children.every((inner) => isPicture(inner) || isBlank(inner))
  );
};

/** Mark paragraphs that hold only images as `p.pic` (polaroid frames). */
export const pictureParagraphs: HastPlugin = {
  name: "journal-picture-paragraphs",
  element: {
    filter: ["p"],
    visit(paragraph, ctx) {
      const children = paragraph.children;
      const onlyPictures =
        children.some(isPicture) &&
        children.every((child) => isPicture(child) || isBlank(child));
      if (onlyPictures) {
        ctx.setProperty(paragraph, "className", [
          ...classList(paragraph),
          "pic",
        ]);
      }
    },
  },
};

/* ---------- responsive pictures ---------- */

/**
 * srcset widths for article pictures; Astro drops the ones above the file's
 * own width and adds that width instead. 1200 covers the drawer at 2x.
 */
export const PICTURE_WIDTHS = ["400", "800", "1200"] as const;

/**
 * How wide a picture is shown: the drawer is min(600px, 100% − 24px), the
 * page inside it has 44 + 32px of padding (34 + 20 on a phone) and the
 * polaroid border 8 + 8.
 */
export const PICTURE_SIZES = "(max-width: 639px) calc(100vw - 94px), 508px";

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Give local article pictures `widths` and `sizes`, which Astro's image pass
 * (right after these plugins) turns into srcset / sizes, so a phone gets a
 * 400–800px file instead of the full-size one. Sätteri passes property
 * values on as strings; the image service (src/lib/ai/image.ts) reads the
 * widths back as numbers. Remote and data: images are left alone.
 */
export const responsivePictures: HastPlugin = {
  name: "journal-responsive-pictures",
  element: {
    filter: ["img"],
    visit(img, ctx) {
      const src = img.properties?.src;
      if (typeof src !== "string" || EXTERNAL.test(src)) {
        return;
      }
      if (img.properties?.widths === undefined) {
        ctx.setProperty(img, "widths", [...PICTURE_WIDTHS]);
      }
      if (img.properties?.sizes === undefined) {
        ctx.setProperty(img, "sizes", PICTURE_SIZES);
      }
    },
  },
};

/* ---------- margin sticky notes ---------- */

// `> [!aside] 吐槽` on the first line of a blockquote; the label is optional.
const ASIDE_MARKER = /^[ \t]*\[!aside\][ \t]*(?<label>[^\n]*)\n?/i;
const ASIDE_LABEL = "旁注";

const hasContent = (node: ElementContent) =>
  !(
    isBlank(node) ||
    (node.type === "element" && node.tagName === "br") ||
    (node.type === "element" &&
      node.tagName === "p" &&
      node.children.every((child) => isBlank(child)))
  );

/**
 * A blockquote that starts with `[!aside] label` becomes a sticky note in
 * the page margin (design.md: 页边可以贴便利贴写旁注):
 * <aside class="aside-sticky sticky-paper"><b>label</b><p>…</p></aside>
 */
export const asideStickies: HastPlugin = {
  name: "journal-aside-stickies",
  element: {
    filter: ["blockquote"],
    visit(quote, ctx) {
      const first = quote.children.find(
        (child): child is Element => child.type === "element"
      );
      const lead = first?.tagName === "p" ? first.children.at(0) : undefined;
      const match =
        lead?.type === "text" ? ASIDE_MARKER.exec(lead.value) : null;
      if (!(first && lead?.type === "text" && match)) {
        return;
      }
      const label = match.groups?.label?.trim() || ASIDE_LABEL;
      const rest = lead.value.slice(match[0].length);
      const paragraph: Element = {
        ...first,
        children: [
          ...(rest === "" ? [] : [{ type: "text" as const, value: rest }]),
          ...first.children.slice(1),
        ].filter((child, index) => index > 0 || hasContent(child)),
      };
      const children = quote.children
        .map((child) => (child === first ? paragraph : child))
        .filter(hasContent);
      ctx.replaceNode(quote, {
        type: "element",
        tagName: "aside",
        properties: { className: ["aside-sticky", "sticky-paper"] },
        children: [
          {
            type: "element",
            tagName: "b",
            properties: {},
            children: [{ type: "text", value: label }],
          },
          ...children,
        ],
      });
    },
  },
};

/* ---------- title heading ---------- */

const normalise = (text: string) => text.replace(WHITESPACE, " ").trim();

/**
 * Drop a leading `# Title` that repeats the frontmatter title: the drawer
 * already prints the title as the page's only <h1>.
 */
export const dropTitleHeading: HastPlugin = {
  name: "journal-drop-title-heading",
  before(root, ctx) {
    const astro = ctx.data.astro as
      | { frontmatter?: Record<string, unknown> }
      | undefined;
    const title = astro?.frontmatter?.title;
    const first = root.children.find((child) => child.type === "element");
    if (
      typeof title === "string" &&
      first?.type === "element" &&
      first.tagName === "h1" &&
      normalise(ctx.textContent(first)) === normalise(title)
    ) {
      ctx.removeNode(first);
    }
  },
};

/* ---------- ==highlight== ---------- */

// `==text==`, not part of `===`, no space just inside the markers.
const HIGHLIGHT = /(?<!=)==(?![\s=])(.+?)(?<![\s=])==(?!=)/g;

/**
 * `==marker pen==` → <mark>. Rough Notation redraws it on the client
 * (src/components/post/marks.ts); without JS the CSS highlight shows.
 * Only plain text inside one text node is matched (not across **bold**).
 */
export const highlightMarks: MdastPlugin = {
  name: "journal-highlight-marks",
  text(node, ctx) {
    if (!node.value.includes("==")) {
      return;
    }
    const parts: (PhrasingContent | CustomNode)[] = [];
    let last = 0;
    for (const match of node.value.matchAll(HIGHLIGHT)) {
      const start = match.index ?? 0;
      if (start > last) {
        parts.push({ type: "text", value: node.value.slice(last, start) });
      }
      parts.push({
        type: "mark",
        children: [{ type: "text", value: match[1] ?? "" }],
        data: { hName: "mark" },
      });
      last = start + match[0].length;
    }
    if (parts.length === 0) {
      return;
    }
    if (last < node.value.length) {
      parts.push({ type: "text", value: node.value.slice(last) });
    }
    ctx.replaceNode(node, parts);
  },
};
