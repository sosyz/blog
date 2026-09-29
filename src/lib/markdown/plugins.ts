/*
 * Sätteri plugins that turn plain Markdown into journal pages.
 *
 * Loaded by astro.config.mjs (through ./config.ts), so imports stay relative.
 * They run after Astro's highlighter and before its image and heading-id
 * passes. See ./README.md for what each one emits and why.
 */
import type { SatteriProcessorOptions } from "@astrojs/markdown-satteri";
import type { Element, ElementContent } from "hast";
import type { PhrasingContent } from "mdast";

type Entry<T> = T extends readonly (infer E)[] ? E : never;
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

/**
 * Wrap every code block in a taped paper slip with a kraft file-name label:
 * <figure class="slip" data-lang style="--tape --tr --sr">
 *   <pre class="astro-code" data-language …>…</pre>
 *   <figcaption class="fname">gateway.ts</figcaption>
 * </figure>
 * The tape is the figure's ::before (no <img> inside the article).
 */
export const codeSlips = ({ fileURL }: FactoryContext): HastPlugin => {
  const slug = slugOf(fileURL);
  let index = 0;
  return {
    name: "journal-code-slips",
    element: {
      filter: ["pre"],
      visit(pre, ctx) {
        index += 1;
        const lang = languageOf(pre);
        const lines = ctx.textContent(pre).split("\n").length;
        const tape = TAPES[index % TAPES.length];
        const tapeAngle = angle(`${slug}:${index}:tape`, TAPE_TILT_SPAN);
        const slipAngle = lines > STRAIGHT_AFTER_LINES ? 0 : SLIP_TILT;
        ctx.wrapNode(pre, {
          type: "element",
          tagName: "figure",
          properties: {
            className: ["slip"],
            dataLang: lang,
            style: `--tape: url("/journal/tape/${tape}.webp"); --tr: ${tapeAngle}deg; --sr: ${slipAngle}deg`,
          },
          children: [
            {
              type: "element",
              tagName: "figcaption",
              properties: { className: ["fname"] },
              children: [{ type: "text", value: labelOf(pre, lang) }],
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
