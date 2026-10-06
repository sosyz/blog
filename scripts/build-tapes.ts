/**
 * Washi tapes for the web: scripts/assets/tape/*.webp (600–640px wide
 * sources) → public/journal/tape/*.webp at 280px wide, twice the widest
 * display size (130px), keeping each tape's aspect ratio.
 *
 * Run: bun scripts/build-tapes.ts
 */
import { readdirSync } from "node:fs";
import sharp from "sharp";

const SOURCE = new URL("./assets/tape/", import.meta.url);
const TARGET = new URL("../public/journal/tape/", import.meta.url);
const WIDTH = 280;
const QUALITY = 82;

const files = readdirSync(SOURCE).filter((name) => name.endsWith(".webp"));
await Promise.all(
  files.map((name) =>
    sharp(new URL(name, SOURCE).pathname)
      .resize({ width: WIDTH })
      .webp({ alphaQuality: 90, effort: 6, quality: QUALITY })
      .toFile(new URL(name, TARGET).pathname)
  )
);
process.stdout.write(`${files.length} tapes → public/journal/tape/\n`);
