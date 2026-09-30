/*
 * What a Mermaid diagram is rendered with and how its SVG file is named.
 * Shared by scripts/build-diagrams.ts (renders the SVGs) and ./diagrams.ts
 * (puts them into the page), so both name a diagram the same way. Loaded by
 * astro.config.mjs through ./config.ts: imports stay relative.
 */
import { createHash } from "node:crypto";

/**
 * Bump after upgrading mermaid or svgo (or changing how build-diagrams.ts
 * post-processes an SVG), so every diagram gets a new file name and
 * `bun run diagrams` renders it again. Palette and layout changes in
 * MERMAID_CONFIG change the names by themselves.
 */
export const DIAGRAM_CONFIG_VERSION = "1";

/** Committed SVGs, relative to the repository root. */
export const DIAGRAM_DIR = "src/assets/diagrams";

/** Paper and ink from src/styles/tokens.css (a test keeps them in sync). */
export const DIAGRAM_PALETTE = {
  ink: "#2d2822",
  pencil: "#524a3e",
  doc: "#f6edd6",
  slip: "#fdfaf2",
} as const;

/**
 * Hand-drawn Mermaid on the journal's paper: ink outlines and text, pencil
 * edges, transparent node fill (the rough hachure disappears and the paper
 * shows through), labels as SVG text in 小赖 so the page's font applies.
 * mermaid 12 defaults to ELK and a new theme, so layout and theme are set.
 */
export const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  look: "handDrawn",
  handDrawnSeed: 7,
  layout: "dagre",
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  themeVariables: {
    fontFamily: '"Xiaolai", "Xiaolai Fallback", cursive',
    fontSize: "15px",
    background: "transparent",
    mainBkg: "transparent",
    primaryColor: DIAGRAM_PALETTE.slip,
    primaryTextColor: DIAGRAM_PALETTE.ink,
    primaryBorderColor: DIAGRAM_PALETTE.ink,
    textColor: DIAGRAM_PALETTE.ink,
    lineColor: DIAGRAM_PALETTE.pencil,
    edgeLabelBackground: DIAGRAM_PALETTE.doc,
  },
} as const;

const CRLF = /\r\n?/g;
const HASH_LENGTH = 12;

/** The fence body as both sides see it: LF line ends, no outer blank lines. */
export const normaliseDiagramSource = (source: string) =>
  source.replace(CRLF, "\n").trim();

/** First 12 hex of sha256(version + config + source): the SVG's file name. */
export const diagramHash = (source: string) =>
  createHash("sha256")
    .update(DIAGRAM_CONFIG_VERSION)
    .update(JSON.stringify(MERMAID_CONFIG))
    .update(normaliseDiagramSource(source))
    .digest("hex")
    .slice(0, HASH_LENGTH);

/** The <svg> id; mermaid prefixes every inner id with it, so ids never clash. */
export const diagramId = (hash: string) => `mmd-${hash}`;

/** Names build-diagrams.ts writes (and is allowed to delete). */
export const DIAGRAM_FILE = /^[0-9a-f]{12}\.svg$/;

const ACC_LINE = /^[ \t]*acc(?:Title|Descr)[ \t]*:.*$/;
const ACC_TITLE = /^[ \t]*accTitle[ \t]*:(.*)$/;

/** accTitle / accDescr text, which mermaid turns into <title> and <desc>. */
export const accTitleOf = (source: string) => {
  for (const line of normaliseDiagramSource(source).split("\n")) {
    const match = ACC_TITLE.exec(line);
    if (match) {
      return (match[1] ?? "").trim();
    }
  }
  return "";
};

/**
 * The source shown under 图的文字版: without the accTitle / accDescr lines,
 * which the SVG already carries as its title and description.
 */
export const readableDiagramSource = (source: string) =>
  normaliseDiagramSource(source)
    .split("\n")
    .filter((line) => !ACC_LINE.test(line))
    .join("\n");
