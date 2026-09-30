/** biome-ignore-all lint/style/noMagicNumbers: icon sizes and ICO header layout are the format. */
/**
 * Raster site icons from public/favicon.svg (the black cat head, drawn by
 * hand as SVG so it stays sharp at 16 px):
 *
 * - public/favicon.ico: 16, 32 and 48 px PNGs in one ICO, for browsers and
 *   tools that ask for /favicon.ico;
 * - public/apple-touch-icon.png: 180 px on desk paper (iOS fills
 *   transparency with black and rounds the corners itself).
 *
 * Usage (one-off; the files are committed): `bun run icons`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { consola } from "consola";
import sharp from "sharp";

const PUBLIC = join(import.meta.dir, "..", "public");
const SVG = readFileSync(join(PUBLIC, "favicon.svg"));
const ICO_SIZES = [16, 32, 48] as const;
const TOUCH_SIZE = 180;
/** The cat fills this share of the touch icon; the rest is paper. */
const TOUCH_FILL = 0.78;
const PAPER = "#f6edd6";

const png = (size: number) =>
  sharp(SVG, { density: 72 * (size / 64) * 4 })
    .resize(size, size)
    .png()
    .toBuffer();

/** An ICO file holding PNG images (supported everywhere since Vista). */
const ico = (images: readonly { size: number; data: Buffer }[]) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
};

const icoImages = await Promise.all(
  ICO_SIZES.map(async (size) => ({ size, data: await png(size) }))
);
writeFileSync(join(PUBLIC, "favicon.ico"), ico(icoImages));

const inner = Math.round(TOUCH_SIZE * TOUCH_FILL);
await sharp({
  create: {
    width: TOUCH_SIZE,
    height: TOUCH_SIZE,
    channels: 4,
    background: PAPER,
  },
})
  .composite([{ input: await png(inner), gravity: "center" }])
  .png()
  .toFile(join(PUBLIC, "apple-touch-icon.png"));

consola.success("Wrote public/favicon.ico and public/apple-touch-icon.png");
