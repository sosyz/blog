/** biome-ignore-all lint/style/noMagicNumbers: pixel layout of a one-off image; the numbers are the design. */
/**
 * Generates the default share image public/og-default.png (1200×630) from
 * the journal materials: dotted desk paper, an ivory index card with washi
 * tape, a sticky note and two stickers, lettered in 小赖 (Xiaolai).
 *
 * Usage (one-off; the PNG is committed, the build does not run this):
 *   bun run og   (= bun src/lib/seo/build-og-image.ts)
 *
 * Needs the full Xiaolai TTF in fonts-src/xiaolai-regular.ttf (gitignored,
 * see scripts/build-fonts.ts for the download link). Uses sharp (already a
 * dependency) and fontkitten (dev dependency) for the glyph outlines.
 *
 * Owner: SEO agent.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consola } from "consola";
import { create } from "fontkitten";
import sharp, { type OverlayOptions } from "sharp";

const ROOT = join(import.meta.dir, "..", "..", "..");
const PUBLIC = join(ROOT, "public");
const FONT_FILE = join(ROOT, "fonts-src", "xiaolai-regular.ttf");
const OUT = join(PUBLIC, "og-default.png");

const WIDTH = 1200;
const HEIGHT = 630;

// Colors from src/styles/tokens.css.
const INK = "#2d2822";
const PENCIL = "#6b6254";
const STAMP = "#bf3f36";
const DESK = "#eee2c6";
const DOC = "#f6edd6";
const STICKY = "#fbe7a1";

const asset = (...parts: string[]) => join(PUBLIC, ...parts);

interface Placed {
  cx: number;
  cy: number;
  input: Buffer;
}
type Layer = Placed & { angle: number };

type Font = Extract<ReturnType<typeof create>, { isCollection: false }>;

let fontCache: Font | undefined;

const loadFont = (): Font => {
  if (!fontCache) {
    const font = create(readFileSync(FONT_FILE));
    if (font.isCollection) {
      throw new Error(`${FONT_FILE} is a font collection; expected one font.`);
    }
    fontCache = font;
  }
  return fontCache;
};

const LINE_HEIGHT = 1.3;

/**
 * Hand-lettered text as a transparent PNG. Glyph outlines are drawn as SVG
 * paths (librsvg cannot load a font file, and Pango on macOS ignores
 * sharp's `fontfile`). `size` is in px; "\n" starts a new line.
 */
const lettering = (text: string, size: number, color: string) => {
  const font = loadFont();
  const scale = size / font.unitsPerEm;
  const ascent = font.ascent * scale;
  const lineHeight = size * LINE_HEIGHT;
  const paths: string[] = [];
  let width = 0;
  for (const [row, line] of text.split("\n").entries()) {
    let x = 0;
    const baseline = ascent + row * lineHeight;
    for (const glyph of font.glyphsForString(line)) {
      const d = glyph.path.toSVG();
      if (d) {
        paths.push(
          `<path transform="translate(${x.toFixed(2)} ${baseline.toFixed(2)}) scale(${scale} ${-scale})" d="${d}"/>`
        );
      }
      x += glyph.advanceWidth * scale;
    }
    width = Math.max(width, x);
  }
  const lines = text.split("\n").length;
  const height = Math.ceil(
    ascent + (lines - 1) * lineHeight - font.descent * scale
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${height}"><g fill="${color}">${paths.join("")}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};

/** Rotate around the centre, keeping transparency. */
const rotated = (input: Buffer, degrees: number) =>
  sharp(input)
    .rotate(degrees, { background: { alpha: 0, b: 0, g: 0, r: 0 } })
    .png()
    .toBuffer();

/** Overlay whose centre lands on (cx, cy). */
const centred = async ({ input, cx, cy }: Placed): Promise<OverlayOptions> => {
  const { width = 0, height = 0 } = await sharp(input).metadata();
  return {
    input,
    left: Math.round(cx - width / 2),
    top: Math.round(cy - height / 2),
  };
};

/** Soft paper shadow: a blurred dark rectangle. */
const shadow = (w: number, h: number, opacity: number, blur: number) => {
  const pad = blur * 3;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w + pad * 2}" height="${h + pad * 2}"><rect x="${pad}" y="${pad}" width="${w}" height="${h}" fill="rgb(80,60,30)" fill-opacity="${opacity}"/></svg>`;
  return sharp(Buffer.from(svg)).blur(blur).png().toBuffer();
};

const desk = async () => {
  const dots = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"><defs><pattern id="d" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="1.2" fill="rgb(110,95,70)" fill-opacity="0.3"/></pattern></defs><rect width="100%" height="100%" fill="url(#d)"/></svg>`;
  const texture = await sharp(
    asset("journal", "paper", "canvas-beige-fine.jpg")
  )
    .png()
    .toBuffer();
  return sharp({
    create: { background: DESK, channels: 4, height: HEIGHT, width: WIDTH },
  })
    .composite([
      { blend: "multiply", input: texture, tile: true },
      { input: Buffer.from(dots) },
    ])
    .png()
    .toBuffer();
};

const CARD_W = 620;
const CARD_H = 390;

/** Ivory index card with blue rules, a red margin and the site name. */
const indexCard = async () => {
  const rules = Array.from({ length: 9 }, (_, i) => 118 + i * 34)
    .map(
      (y) =>
        `<line x1="0" x2="${CARD_W}" y1="${y}" y2="${y}" stroke="rgb(84,112,150)" stroke-opacity="0.22" stroke-width="1.4"/>`
    )
    .join("");
  const lines = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">${rules}<line x1="0" x2="${CARD_W}" y1="84" y2="84" stroke="rgb(196,84,72)" stroke-opacity="0.45" stroke-width="1.6"/><line x1="70" x2="70" y1="0" y2="${CARD_H}" stroke="rgb(196,84,72)" stroke-opacity="0.38" stroke-width="1.4"/></svg>`;
  const paper = await sharp(asset("journal", "paper", "document-ivory.jpg"))
    .resize(CARD_W, CARD_H, { fit: "cover" })
    .png()
    .toBuffer();
  const [owner, name, tagline, url] = await Promise.all([
    lettering("这本手账属于", 30, PENCIL),
    lettering("Sonui", 118, INK),
    lettering("技术踩坑和随想", 44, INK),
    lettering("blog.sonui.cn", 28, PENCIL),
  ]);
  return sharp({
    create: { background: DOC, channels: 4, height: CARD_H, width: CARD_W },
  })
    .composite([
      { blend: "multiply", input: paper },
      { input: Buffer.from(lines) },
      { input: owner, left: 92, top: 40 },
      { input: name, left: 90, top: 106 },
      { input: tagline, left: 96, top: 250 },
      { input: url, left: 96, top: 326 },
    ])
    .png()
    .toBuffer();
};

const STICKY_SIZE = 290;

/** Yellow sticky note listing the topics. */
const stickyNote = async () => {
  const fill = `<svg xmlns="http://www.w3.org/2000/svg" width="${STICKY_SIZE}" height="${STICKY_SIZE}"><defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="rgb(150,110,20)" stop-opacity="0.12"/><stop offset="0.3" stop-color="rgb(150,110,20)" stop-opacity="0"/></linearGradient></defs><path d="M0 0H${STICKY_SIZE}V${STICKY_SIZE - 8}Q${STICKY_SIZE - 60} ${STICKY_SIZE} 0 ${STICKY_SIZE}Z" fill="${STICKY}"/><path d="M0 0H${STICKY_SIZE}V${STICKY_SIZE - 8}Q${STICKY_SIZE - 60} ${STICKY_SIZE} 0 ${STICKY_SIZE}Z" fill="url(#g)"/></svg>`;
  const [title, topics] = await Promise.all([
    lettering("最近在折腾", 40, STAMP),
    lettering("AI、Web、Go\n后端、云原生\n运维与网络", 32, INK),
  ]);
  return sharp(Buffer.from(fill))
    .composite([
      { input: title, left: 30, top: 34 },
      { input: topics, left: 30, top: 104 },
    ])
    .png()
    .toBuffer();
};

const sticker = (name: string, size: number) =>
  sharp(asset("stickers", `${name}.webp`))
    .resize(size, size)
    .png()
    .toBuffer();

const tape = (name: string, width: number) =>
  sharp(asset("journal", "tape", `${name}.webp`))
    .resize({ width })
    .png()
    .toBuffer();

const build = async () => {
  if (!existsSync(FONT_FILE)) {
    throw new Error(
      `Missing ${FONT_FILE}. Download 小赖字体 (see scripts/build-fonts.ts).`
    );
  }

  const [
    background,
    cardImage,
    noteImage,
    dog,
    laptop,
    washi,
    cardShadow,
    noteShadow,
  ] = await Promise.all([
    desk(),
    indexCard(),
    stickyNote(),
    sticker("people-dog", 190),
    sticker("obj-laptop", 150),
    tape("washi-grid-ivory", 240),
    shadow(CARD_W, CARD_H, 0.45, 14),
    shadow(STICKY_SIZE, STICKY_SIZE, 0.4, 10),
  ]);

  const card = { angle: -2, x: 440, y: 318 };
  const note = { angle: 4, x: 935, y: 260 };

  const layers: Layer[] = [
    { angle: card.angle, cx: card.x + 4, cy: card.y + 14, input: cardShadow },
    { angle: card.angle, cx: card.x, cy: card.y, input: cardImage },
    { angle: 3, cx: card.x + 10, cy: card.y - CARD_H / 2 - 4, input: washi },
    { angle: note.angle, cx: note.x + 8, cy: note.y + 12, input: noteShadow },
    { angle: note.angle, cx: note.x, cy: note.y, input: noteImage },
    { angle: 8, cx: 150, cy: 540, input: laptop },
    { angle: -6, cx: 1010, cy: 500, input: dog },
  ];
  const placed = await Promise.all(
    layers.map(async ({ input, angle, cx, cy }) => ({
      cx,
      cy,
      input: await rotated(input, angle),
    }))
  );
  const overlays = await Promise.all(placed.map(centred));

  await sharp(background)
    .composite(overlays)
    .png({ compressionLevel: 9, palette: false })
    .toFile(OUT);
  consola.success(`Wrote ${OUT}`);
};

await build();
