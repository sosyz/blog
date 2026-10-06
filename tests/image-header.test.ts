// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import sharp, { type Sharp } from "sharp";
import {
  checkStickerImage,
  parseImageHeader,
  stickerDisplayWidth,
} from "../src/lib/server/image-header";

const W = 37;
const H = 23;

const solid = (channels: 3 | 4) =>
  sharp({
    create: {
      background: { alpha: 0.5, b: 40, g: 120, r: 200 },
      channels,
      height: H,
      width: W,
    },
  });

const bytes = async (image: Sharp) => new Uint8Array(await image.toBuffer());

describe("parseImageHeader", () => {
  test("PNG", async () => {
    expect(parseImageHeader(await bytes(solid(4).png()))).toEqual({
      height: H,
      mime: "image/png",
      width: W,
    });
  });

  test("GIF", async () => {
    expect(parseImageHeader(await bytes(solid(3).gif()))).toEqual({
      height: H,
      mime: "image/gif",
      width: W,
    });
  });

  test("JPEG baseline and progressive (SOF0 / SOF2 after APP/DQT segments)", async () => {
    for (const progressive of [false, true]) {
      const jpeg = await bytes(solid(3).jpeg({ progressive }).withMetadata());
      expect(parseImageHeader(jpeg)).toEqual({
        height: H,
        mime: "image/jpeg",
        width: W,
      });
    }
  });

  test("WebP lossy (VP8), lossless (VP8L) and extended (VP8X)", async () => {
    const lossy = await bytes(solid(3).webp({ quality: 80 }));
    const lossless = await bytes(solid(3).webp({ lossless: true }));
    const extended = await bytes(solid(4).webp({ quality: 80 }));
    const chunk = (b: Uint8Array) => String.fromCharCode(...b.subarray(12, 16));
    expect([chunk(lossy), chunk(lossless), chunk(extended)]).toEqual([
      "VP8 ",
      "VP8L",
      "VP8X",
    ]);
    for (const webp of [lossy, lossless, extended]) {
      expect(parseImageHeader(webp)).toEqual({
        height: H,
        mime: "image/webp",
        width: W,
      });
    }
  });

  test("a real sticker from public/stickers", async () => {
    const file = new Uint8Array(
      await Bun.file("public/stickers/obj-bug.webp").arrayBuffer()
    );
    const header = parseImageHeader(file);
    expect(header?.mime).toBe("image/webp");
    expect(header?.width).toBeGreaterThan(0);
  });

  test("rejects SVG, HTML, truncated and empty input", () => {
    const text = (value: string) => new TextEncoder().encode(value);
    expect(
      parseImageHeader(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))
    ).toBeNull();
    expect(parseImageHeader(text("<html>GIF89a</html>"))).toBeNull();
    expect(
      parseImageHeader(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    ).toBeNull();
    expect(
      parseImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))
    ).toBeNull();
    expect(parseImageHeader(new Uint8Array())).toBeNull();
  });
});

describe("checkStickerImage", () => {
  const limits = { maxBytes: 300 * 1024, maxSide: 512 };

  test("accepts a small image", async () => {
    const result = checkStickerImage(await bytes(solid(4).png()), limits);
    expect(result.ok).toBe(true);
  });

  test("rejects too many bytes, too many pixels and unknown types", async () => {
    expect(checkStickerImage(new Uint8Array(300 * 1024 + 1), limits)).toEqual({
      message: "图片太大了，最大 300 KB。",
      ok: false,
    });
    const big = await bytes(
      sharp({
        create: { background: "#fff", channels: 3, height: 20, width: 600 },
      }).png()
    );
    expect(checkStickerImage(big, limits)).toEqual({
      message: "图片最大 512×512 像素，这张是 600×20。",
      ok: false,
    });
    expect(
      checkStickerImage(new TextEncoder().encode("hello"), limits).ok
    ).toBe(false);
    expect(checkStickerImage(new Uint8Array(), limits)).toEqual({
      message: "没有收到图片。",
      ok: false,
    });
  });
});

test("stickerDisplayWidth caps at 160 world px before scaling", () => {
  expect(stickerDisplayWidth(512, 1)).toBe(160);
  expect(stickerDisplayWidth(100, 1.5)).toBe(150);
});
