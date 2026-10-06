// biome-ignore-all lint/style/noMagicNumbers: byte offsets and marker codes from the PNG, GIF, WebP and JPEG specs, commented where used
/**
 * Reads the type and pixel size of an image from its first bytes, without
 * decoding it. Pure: used by the sticker API (the authoritative check) and by
 * the upload UI for an early, friendlier error.
 *
 * Supported: PNG, GIF, WebP (VP8, VP8L, VP8X) and JPEG. Anything else,
 * including SVG, returns null.
 */

export type ImageMime = "image/png" | "image/gif" | "image/webp" | "image/jpeg";

export interface ImageHeader {
  height: number;
  mime: ImageMime;
  width: number;
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const u16be = (b: Uint8Array, i: number) => (b[i] ?? 0) * 256 + (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) + (b[i + 1] ?? 0) * 256;
const u24le = (b: Uint8Array, i: number) =>
  (b[i] ?? 0) + (b[i + 1] ?? 0) * 256 + (b[i + 2] ?? 0) * 65_536;
const u32be = (b: Uint8Array, i: number) =>
  u16be(b, i) * 65_536 + u16be(b, i + 2);

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const LOW_14_BITS = 16_384;

const parsePng = (b: Uint8Array): ImageHeader | null => {
  const signature = PNG_SIGNATURE.every((value, index) => b[index] === value);
  if (!signature || b.length < 24 || ascii(b, 12, 4) !== "IHDR") {
    return null;
  }
  return { height: u32be(b, 20), mime: "image/png", width: u32be(b, 16) };
};

const parseGif = (b: Uint8Array): ImageHeader | null => {
  const magic = ascii(b, 0, 6);
  if ((magic !== "GIF87a" && magic !== "GIF89a") || b.length < 10) {
    return null;
  }
  return { height: u16le(b, 8), mime: "image/gif", width: u16le(b, 6) };
};

const parseWebp = (b: Uint8Array): ImageHeader | null => {
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP" || b.length < 30) {
    return null;
  }
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    // Lossy: frame tag (3 bytes) + start code 9d 01 2a, then 14-bit sizes.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) {
      return null;
    }
    return {
      height: u16le(b, 28) % LOW_14_BITS,
      mime: "image/webp",
      width: u16le(b, 26) % LOW_14_BITS,
    };
  }
  if (chunk === "VP8L") {
    // Lossless: signature 0x2f, then width-1 and height-1 packed in 14 bits each.
    if (b[20] !== 0x2f) {
      return null;
    }
    const b1 = b[21] ?? 0;
    const b2 = b[22] ?? 0;
    const b3 = b[23] ?? 0;
    const b4 = b[24] ?? 0;
    const width = 1 + b1 + (b2 % 64) * 256;
    const height = 1 + Math.floor(b2 / 64) + b3 * 4 + (b4 % 16) * 1024;
    return { height, mime: "image/webp", width };
  }
  if (chunk === "VP8X") {
    // Extended: canvas width-1 and height-1 as 24-bit little endian.
    return {
      height: 1 + u24le(b, 27),
      mime: "image/webp",
      width: 1 + u24le(b, 24),
    };
  }
  return null;
};

/** Start-of-frame markers carry the size; C4 (DHT), C8 (JPG) and CC (DAC) do not. */
const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 &&
  marker <= 0xcf &&
  marker !== 0xc4 &&
  marker !== 0xc8 &&
  marker !== 0xcc;

/** Markers without a length field. */
const isStandalone = (marker: number) =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);

/**
 * One step of the JPEG segment walk from offset i: the next offset to look
 * at, the frame size when this is a start-of-frame segment, or null when the
 * data ends or is not JPEG.
 */
const jpegStep = (
  b: Uint8Array,
  i: number
): { next: number } | { header: ImageHeader } | null => {
  if (b[i] !== 0xff) {
    return null;
  }
  const marker = b[i + 1] ?? 0;
  if (marker === 0xff) {
    // Fill byte.
    return { next: i + 1 };
  }
  if (isStandalone(marker)) {
    return { next: i + 2 };
  }
  if (marker === 0xd9 || marker === 0xda) {
    // End of image / start of scan before any frame header.
    return null;
  }
  if (!isStartOfFrame(marker)) {
    return { next: i + 2 + u16be(b, i + 2) };
  }
  if (i + 8 >= b.length) {
    return null;
  }
  return {
    header: {
      height: u16be(b, i + 5),
      mime: "image/jpeg",
      width: u16be(b, i + 7),
    },
  };
};

const parseJpeg = (b: Uint8Array): ImageHeader | null => {
  if (b[0] !== 0xff || b[1] !== 0xd8) {
    return null;
  }
  let i = 2;
  while (i + 3 < b.length) {
    const step = jpegStep(b, i);
    if (!step) {
      return null;
    }
    if ("header" in step) {
      return step.header;
    }
    i = step.next;
  }
  return null;
};

export const parseImageHeader = (bytes: Uint8Array): ImageHeader | null => {
  const header =
    parsePng(bytes) ?? parseGif(bytes) ?? parseWebp(bytes) ?? parseJpeg(bytes);
  if (!header || header.width < 1 || header.height < 1) {
    return null;
  }
  return header;
};

export interface StickerImageLimits {
  maxBytes: number;
  maxSide: number;
}

/** Checks an upload; returns a visitor-facing error or the parsed header. */
export const checkStickerImage = (
  bytes: Uint8Array,
  limits: StickerImageLimits
): { ok: true; header: ImageHeader } | { ok: false; message: string } => {
  if (bytes.length === 0) {
    return { message: "没有收到图片。", ok: false };
  }
  if (bytes.length > limits.maxBytes) {
    const kb = Math.round(limits.maxBytes / 1024);
    return { message: `图片太大了，最大 ${kb} KB。`, ok: false };
  }
  const header = parseImageHeader(bytes);
  if (!header) {
    return {
      message: "只支持 PNG、WebP、GIF 或 JPEG 图片。",
      ok: false,
    };
  }
  if (header.width > limits.maxSide || header.height > limits.maxSide) {
    return {
      message: `图片最大 ${limits.maxSide}×${limits.maxSide} 像素，这张是 ${header.width}×${header.height}。`,
      ok: false,
    };
  }
  return { header, ok: true };
};

/** Width of a sticker on the canvas, in world px (same on server and client). */
export const stickerDisplayWidth = (width: number, scale: number) =>
  Math.round(Math.min(160, width) * scale);
