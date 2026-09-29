/**
 * Pure helpers for scripts/build-fonts.ts: which characters the site uses,
 * unicode-range strings, @font-face rules and the metric overrides of the
 * fallback faces. No file or network access, so tests can import it.
 */

/**
 * Always in the site subsets (when the font has them): ASCII, Latin-1,
 * general punctuation (— “” … ‰), CJK symbols and punctuation (、。「」)
 * and the full-width ASCII forms (，：！？). Search queries and dates use
 * these too.
 */
export const BASE_RANGE =
  "U+20-7E,U+A0-FF,U+2000-206F,U+3000-303F,U+FF01-FF5E,U+FFE0-FFE6";

/** Every code point of `text` (a surrogate pair counts once). */
export const codePointsOf = (text: string, into = new Set<number>()) => {
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp !== undefined) {
      into.add(cp);
    }
  }
  return into;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Split a Markdown file into its YAML frontmatter and its body. */
export const splitFrontmatter = (source: string) => {
  const match = FRONTMATTER.exec(source);
  if (!match) {
    return { frontmatter: "", body: source };
  }
  return {
    frontmatter: match[1] ?? "",
    body: source.slice(match[0].length),
  };
};

const QUOTE_LINE = /^[ \t]*>(.*)$/gm;
const IMAGE_ALT = /!\[([^\]]*)\]/g;
const FENCE_TITLE =
  /^[ \t]*(?:```|~~~).*?(?:title|file)=(?:"([^"]+)"|'([^']+)'|(\S+))/gm;
const FOOTNOTE_LINE = /^\[\^[^\]]+\]:(.*)$/gm;

/**
 * The parts of a note body that prose.css sets in the hand font (Xiaolai):
 * quotes and margin notes, picture captions (image alt text), code-slip file
 * names and footnotes. The rest of the body is Zhuque Fangsong.
 */
export const handText = (body: string) => {
  const parts: string[] = [];
  for (const match of body.matchAll(QUOTE_LINE)) {
    parts.push(match[1] ?? "");
  }
  for (const match of body.matchAll(IMAGE_ALT)) {
    parts.push(match[1] ?? "");
  }
  for (const match of body.matchAll(FENCE_TITLE)) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  for (const match of body.matchAll(FOOTNOTE_LINE)) {
    parts.push(match[1] ?? "");
  }
  return parts.join("\n");
};

export type Sources = {
  /** UI copy: .astro / .ts / .css files outside src/posts. */
  ui: readonly string[];
  /** Raw note files (frontmatter + Markdown). */
  posts: readonly string[];
};

export type SiteSets = {
  /** On every page: UI copy, every note's frontmatter, BASE_RANGE. */
  common: Set<number>;
  /** Only in note bodies (not already in `common`). */
  body: Set<number>;
  /** Hand font: `common` plus the hand-set parts of note bodies. */
  hand: Set<number>;
};

export const minus = (a: Iterable<number>, b: Set<number>) => {
  const out = new Set<number>();
  for (const cp of a) {
    if (!b.has(cp)) {
      out.add(cp);
    }
  }
  return out;
};

const C1_END = 0xa0;
const DELETE = 0x7f;
const SPACE = 0x20;

/** Control characters and line breaks never need a glyph. */
const isPrintable = (cp: number) =>
  cp >= SPACE && !(cp >= DELETE && cp < C1_END);

const printable = (set: Iterable<number>) =>
  new Set([...set].filter((cp) => isPrintable(cp)));

/** The character sets the site subsets are cut from. */
export const siteSets = (sources: Sources): SiteSets => {
  const common = parseUnicodeRange(BASE_RANGE);
  for (const text of sources.ui) {
    codePointsOf(text, common);
  }
  const bodies = new Set<number>();
  const hand = new Set<number>();
  for (const source of sources.posts) {
    const { frontmatter, body } = splitFrontmatter(source);
    codePointsOf(frontmatter, common);
    codePointsOf(body, bodies);
    codePointsOf(handText(body), hand);
  }
  const commonSet = printable(common);
  return {
    common: commonSet,
    body: printable(minus(bodies, commonSet)),
    hand: printable(new Set([...commonSet, ...hand])),
  };
};

/** Keep only the code points the font has a glyph for. */
export const coveredBy = (set: Iterable<number>, font: Set<number>) =>
  new Set([...set].filter((cp) => font.has(cp)));

const HEX = 16;
const hex = (cp: number) => cp.toString(HEX).toUpperCase();
const part = (from: number, to: number) =>
  from === to ? `U+${hex(from)}` : `U+${hex(from)}-${hex(to)}`;

/** "U+20-7E,U+4E00" for a set of code points (sorted, runs merged). */
export const toUnicodeRange = (set: Iterable<number>) => {
  const sorted = [...new Set(set)].sort((a, b) => a - b);
  const parts: string[] = [];
  let from = -1;
  let to = -1;
  for (const cp of sorted) {
    if (cp === to + 1 && from >= 0) {
      to = cp;
    } else {
      if (from >= 0) {
        parts.push(part(from, to));
      }
      from = cp;
      to = cp;
    }
  }
  if (from >= 0) {
    parts.push(part(from, to));
  }
  return parts.join(",");
};

const RANGE_PART = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i;

/** Code points of a unicode-range value (wildcards like U+4?? included). */
export const parseUnicodeRange = (value: string) => {
  const out = new Set<number>();
  for (const raw of value.split(",")) {
    const match = RANGE_PART.exec(raw.trim());
    if (!match) {
      continue;
    }
    const first = match[1] ?? "";
    const from = Number.parseInt(first.replaceAll("?", "0"), HEX);
    const to = Number.parseInt(match[2] ?? first.replaceAll("?", "F"), HEX);
    for (let cp = from; cp <= to; cp++) {
      out.add(cp);
    }
  }
  return out;
};

/** One @font-face of a cn-font-split result.css: its file and characters. */
export type Chunk = { file: string; codePoints: Set<number> };

const FACE = /@font-face\s*\{([^}]*)\}/g;
const FACE_FILE = /url\(\s*["']?(?:\.\/)?([^"')]+\.woff2)["']?\s*\)/;
const FACE_RANGE = /unicode-range\s*:\s*([^;}]*)/;

export const parseChunks = (css: string): Chunk[] => {
  const out: Chunk[] = [];
  for (const match of css.matchAll(FACE)) {
    const body = match[1] ?? "";
    const file = FACE_FILE.exec(body)?.[1];
    if (file) {
      out.push({
        file,
        codePoints: parseUnicodeRange(FACE_RANGE.exec(body)?.[1] ?? ""),
      });
    }
  }
  return out;
};

/**
 * The second layer: cn-font-split chunks with the site files' characters
 * taken out of their unicode-range, so a page only fetches a chunk for a
 * character the site files lack (a visitor's comment, a search query).
 * Chunks left with nothing are dropped.
 */
export const restChunks = (
  chunks: readonly Chunk[],
  covered: Set<number>
): Chunk[] => {
  const out: Chunk[] = [];
  for (const chunk of chunks) {
    const left = minus(chunk.codePoints, covered);
    if (left.size > 0) {
      out.push({ file: chunk.file, codePoints: left });
    }
  }
  return out;
};

export type FaceRule = {
  family: string;
  /** Sources in order, already written as CSS (`url(...) format(...)`). */
  src: readonly string[];
  /** Omit to cover every character the file has. */
  range?: string;
  /** Extra descriptors, e.g. { "size-adjust": "95%" }. */
  descriptors?: Readonly<Record<string, string>>;
};

export const woff2 = (url: string) => `url("${url}") format("woff2")`;
export const local = (name: string) => `local("${name}")`;

/** One @font-face rule on one line. */
export const faceRule = (rule: FaceRule) => {
  const parts = [
    `font-family:"${rule.family}"`,
    `src:${rule.src.join(",")}`,
    "font-style:normal",
    "font-weight:400",
    "font-display:swap",
  ];
  for (const [name, value] of Object.entries(rule.descriptors ?? {})) {
    parts.push(`${name}:${value}`);
  }
  if (rule.range) {
    parts.push(`unicode-range:${rule.range}`);
  }
  return `@font-face{${parts.join(";")}}`;
};

/* ---------- metric-matched fallback ---------- */

export type Metrics = {
  unitsPerEm: number;
  ascent: number;
  /** Negative, as in hhea. */
  descent: number;
  lineGap: number;
};

const PERCENT = 100;
const DECIMALS = 100;

export const pct = (value: number) =>
  `${Math.round(value * PERCENT * DECIMALS) / DECIMALS}%`;

/**
 * ascent-, descent- and line-gap-override that give a fallback face the web
 * font's line box. The overrides are scaled by size-adjust, so divide by it.
 */
export const lineOverrides = (font: Metrics, adjust = 1) => ({
  "ascent-override": pct(font.ascent / font.unitsPerEm / adjust),
  "descent-override": pct(Math.abs(font.descent) / font.unitsPerEm / adjust),
  "line-gap-override": pct(font.lineGap / font.unitsPerEm / adjust),
});

/** Latin sample for average advance widths (letters, digits, space). */
export const LATIN_SAMPLE =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";

/** Average advance (per em) of the characters of `sample`. */
export const averageAdvance = (
  sample: string,
  unitsPerEm: number,
  advanceOf: (cp: number) => number
) => {
  const cps = [...codePointsOf(sample)];
  if (cps.length === 0 || unitsPerEm <= 0) {
    return 0;
  }
  const total = cps.reduce((sum, cp) => sum + advanceOf(cp), 0);
  return total / cps.length / unitsPerEm;
};

/**
 * size-adjust for the Latin fallback face: the web font's average Latin
 * advance over the fallback's. CJK stays at 100%: every CJK font sets
 * ideographs 1em wide already, so scaling them would make it worse.
 */
export const sizeAdjust = (webAverage: number, fallbackAverage: number) =>
  fallbackAverage > 0 && webAverage > 0 ? webAverage / fallbackAverage : 1;
