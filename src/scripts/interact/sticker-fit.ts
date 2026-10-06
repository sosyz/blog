// biome-ignore-all lint/style/noMagicNumbers: size limits, quality steps and unit conversions, each explained where declared
/**
 * Sizing and encoding rules for a workshop sticker, kept pure so bun test can
 * check them: the artwork plus its white border must fit 512×512, and the
 * file must be ≤ 300 KB (the same limits as the API, src/lib/server/validate.ts).
 */
import { type ImageHeader, parseImageHeader } from "@/lib/server/image-header";

export const OUTPUT_MAX_SIDE = 512;
export const OUTPUT_MAX_BYTES = 307_200;

/**
 * 白边粗细 细 / 中 / 粗 as a share of the artwork's long side. 中 matches the
 * hand-drawn stickers in public/stickers/ (about 9 px at 200 px).
 */
export const BORDER_RATIOS = [0.03, 0.045, 0.065] as const;
export const BORDER_LABELS = ["细", "中", "粗"] as const;
export const DEFAULT_BORDER = 1;
/** Never thinner than this, so tiny pictures still get a visible edge. */
const MIN_RADIUS = 2;
/** Anti-aliasing room around the border. */
const EDGE = 1;

export interface StickerLayout {
  contentHeight: number;
  /** Artwork size in the output, px. */
  contentWidth: number;
  height: number;
  /** Space on every side of the artwork for the border. */
  pad: number;
  /** Border width, px. */
  radius: number;
  /** Scale from the source crop to the output. */
  scale: number;
  width: number;
}

const layoutFor = (
  width: number,
  height: number,
  ratio: number,
  long: number
): StickerLayout => {
  const scale = long / Math.max(width, height);
  const contentWidth = Math.max(1, Math.round(width * scale));
  const contentHeight = Math.max(1, Math.round(height * scale));
  const radius = Math.max(MIN_RADIUS, ratio * long);
  const pad = Math.ceil(radius) + EDGE;
  return {
    contentHeight,
    contentWidth,
    height: contentHeight + pad * 2,
    pad,
    radius,
    scale,
    width: contentWidth + pad * 2,
  };
};

/**
 * Where the artwork (a crop of width × height source px) goes: never scaled
 * up, and shrunk until artwork + border fit maxSide.
 */
export const layoutSticker = (
  width: number,
  height: number,
  ratio: number,
  maxSide = OUTPUT_MAX_SIDE
): StickerLayout => {
  const long = Math.max(width, height);
  const shrinkToFit = (target: number): StickerLayout => {
    const layout = layoutFor(width, height, ratio, target);
    const over = Math.max(layout.width, layout.height) - maxSide;
    return over > 0 && target > 1
      ? shrinkToFit(Math.max(1, target - over))
      : layout;
  };
  return shrinkToFit(Math.min(long, Math.floor(maxSide / (1 + 2 * ratio))));
};

export interface EncodeAttempt {
  quality: number;
  shrink: number;
  type: string;
}

/** WebP qualities to try, best first. */
const QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5] as const;
/** If even the lowest quality is too big, shrink the whole sticker. */
const SHRINKS = [1, 0.85, 0.72, 0.6, 0.5] as const;

/** Every encode to try, in order: lossy formats step down in quality first. */
export const encodeAttempts = (type: string): EncodeAttempt[] =>
  SHRINKS.flatMap((shrink) =>
    type === "image/png"
      ? [{ quality: 1, shrink, type }]
      : QUALITIES.map((quality) => ({ quality, shrink, type }))
  );

/**
 * Runs the attempts one after another (no parallel encodes) and returns the
 * first result small enough, or null.
 */
export const firstThatFits = async <T extends { size: number }>(
  attempts: readonly EncodeAttempt[],
  encode: (attempt: EncodeAttempt) => Promise<T | null>,
  maxBytes = OUTPUT_MAX_BYTES,
  index = 0
): Promise<{ attempt: EncodeAttempt; result: T } | null> => {
  const attempt = attempts[index];
  if (!attempt) {
    return null;
  }
  const result = await encode(attempt);
  if (result && result.size <= maxBytes) {
    return { attempt, result };
  }
  return firstThatFits(attempts, encode, maxBytes, index + 1);
};

/** 86 KB / 1.2 MB, for the workshop's size line and progress. */
export const formatBytes = (bytes: number) => {
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.max(1, Math.round(kb))} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
};

/** The workshop takes bigger pictures than the API; it shrinks them itself. */
export const INPUT_MAX_BYTES = 10_485_760;
/** Refuse pictures that would need too much memory to decode (50 megapixels). */
export const INPUT_MAX_PIXELS = 50_000_000;

/** Checks a picked file before the workshop decodes it: type by magic bytes, size. */
export const checkWorkshopInput = (
  bytes: Uint8Array
): { ok: true; header: ImageHeader } | { ok: false; message: string } => {
  if (bytes.length === 0) {
    return { message: "没有收到图片。", ok: false };
  }
  if (bytes.length > INPUT_MAX_BYTES) {
    return { message: "图片太大了，最大 10 MB。", ok: false };
  }
  const header = parseImageHeader(bytes);
  if (!header) {
    return { message: "只支持 PNG、WebP、GIF 或 JPEG 图片。", ok: false };
  }
  if (header.width * header.height > INPUT_MAX_PIXELS) {
    return {
      message: `这张图有 ${header.width}×${header.height} 像素，太大了，换一张小一点的吧。`,
      ok: false,
    };
  }
  return { header, ok: true };
};
