/**
 * Paper textures with their colour already blended in, so the browser paints
 * one plain image instead of compositing a texture over a colour with
 * `background-blend-mode` on every repaint (old machines feel that while the
 * canvas pans). The result is pixel-for-pixel what the CSS blend produced:
 *
 * - desk.jpg:   canvas-beige-fine × --desk (multiply), resampled to 960×560
 *               so it tiles on a 480×280 CSS grid that the 20px dot pitch
 *               divides; the canvas moves the desk by whole tiles
 *               (src/scripts/canvas/camera.ts).
 * - doc.jpg:    document-ivory × --doc (multiply).
 * - sticky.jpg: grain-overlay-gray soft-light over --sticky.
 *
 * Colours are read from src/styles/tokens.css. Re-run after changing a paper
 * token or texture: bun scripts/build-papers.ts
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";

const PAPER = new URL("../public/journal/paper/", import.meta.url);
const TOKENS = new URL("../src/styles/tokens.css", import.meta.url);
const QUALITY = 84;
const DESK_SIZE = { width: 960, height: 560 } as const;

type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

const token = (name: string): Rgb => {
  const css = readFileSync(TOKENS, "utf8");
  const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1];
  const match = value ? HEX.exec(value) : null;
  if (!match) {
    throw new Error(`tokens.css: --${name} is not a #rrggbb colour`);
  }
  return [
    Number.parseInt(match[1] ?? "0", 16),
    Number.parseInt(match[2] ?? "0", 16),
    Number.parseInt(match[3] ?? "0", 16),
  ];
};

/** CSS `multiply`: source × backdrop. */
const multiply = (s: number, b: number) => s * b;

const QUARTER = 0.25;
const HALF = 0.5;
/** Coefficients of the spec's D(Cb) polynomial for dark backdrops. */
const D_CUBIC = 16;
const D_SQUARE = 12;
const D_LINEAR = 4;

/** CSS `soft-light` (Compositing and Blending Level 1), source over backdrop. */
const softLight = (s: number, b: number) => {
  if (s <= HALF) {
    return b - (1 - 2 * s) * b * (1 - b);
  }
  const d =
    b <= QUARTER ? ((D_CUBIC * b - D_SQUARE) * b + D_LINEAR) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
};

const MAX = 255;
const CHANNELS = 3;

type Bake = {
  source: string;
  target: string;
  color: Rgb;
  blend: (s: number, b: number) => number;
  size?: { width: number; height: number };
};

const bake = async ({ source, target, color, blend, size }: Bake) => {
  let image = sharp(new URL(source, PAPER).pathname).removeAlpha();
  if (size) {
    image = image.resize({ ...size, fit: "fill" });
  }
  const { data, info } = await image
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const b = (color[i % CHANNELS] ?? 0) / MAX;
    const s = (data[i] ?? 0) / MAX;
    out[i] = Math.round(blend(s, b) * MAX);
  }
  await sharp(out, {
    raw: { width: info.width, height: info.height, channels: CHANNELS },
  })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toFile(new URL(target, PAPER).pathname);
};

await Promise.all([
  bake({
    source: "canvas-beige-fine.jpg",
    target: "desk.jpg",
    color: token("desk"),
    blend: multiply,
    size: DESK_SIZE,
  }),
  bake({
    source: "document-ivory.jpg",
    target: "doc.jpg",
    color: token("doc"),
    blend: multiply,
  }),
  bake({
    source: "grain-overlay-gray.jpg",
    target: "sticky.jpg",
    color: token("sticky"),
    blend: softLight,
  }),
]);
process.stdout.write("desk, doc, sticky → public/journal/paper/\n");
