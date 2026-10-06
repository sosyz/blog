// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  BORDER_RATIOS,
  checkWorkshopInput,
  type EncodeAttempt,
  encodeAttempts,
  firstThatFits,
  formatBytes,
  layoutSticker,
  OUTPUT_MAX_BYTES,
  OUTPUT_MAX_SIDE,
} from "../src/scripts/interact/sticker-fit";

describe("layoutSticker", () => {
  test("a big square picture: artwork + border fill 512 and no more", () => {
    const layout = layoutSticker(1000, 1000, 0.045);
    expect(layout.width).toBeLessThanOrEqual(OUTPUT_MAX_SIDE);
    expect(layout.height).toBeLessThanOrEqual(OUTPUT_MAX_SIDE);
    expect(layout.width).toBeGreaterThan(OUTPUT_MAX_SIDE - 6);
    // The border is 4.5 % of the artwork's long side.
    expect(layout.radius / layout.contentWidth).toBeCloseTo(0.045, 3);
    expect(layout.pad).toBeGreaterThanOrEqual(Math.ceil(layout.radius));
  });

  test("keeps the aspect ratio of a wide picture", () => {
    const layout = layoutSticker(1024, 256, BORDER_RATIOS[2]);
    expect(layout.contentWidth / layout.contentHeight).toBeCloseTo(4, 1);
    expect(layout.width).toBeLessThanOrEqual(OUTPUT_MAX_SIDE);
  });

  test("never scales a small picture up", () => {
    const layout = layoutSticker(120, 80, 0.045);
    expect(layout.scale).toBe(1);
    expect(layout.contentWidth).toBe(120);
    expect(layout.width).toBe(120 + layout.pad * 2);
  });

  test("tiny pictures still get a visible border", () => {
    expect(layoutSticker(10, 10, 0.03).radius).toBeGreaterThanOrEqual(2);
  });

  test("every border width fits", () => {
    for (const ratio of BORDER_RATIOS) {
      for (const [w, h] of [
        [512, 512],
        [4000, 3000],
        [300, 2000],
        [1, 1],
      ] as const) {
        const layout = layoutSticker(w, h, ratio);
        expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(
          OUTPUT_MAX_SIDE
        );
      }
    }
  });
});

describe("encoding", () => {
  test("WebP steps down in quality before shrinking; PNG only shrinks", () => {
    const webp = encodeAttempts("image/webp");
    expect(webp[0]).toEqual({ quality: 0.9, shrink: 1, type: "image/webp" });
    expect(webp[1]?.shrink).toBe(1);
    expect(webp[1]?.quality).toBeLessThan(0.9);
    const png = encodeAttempts("image/png");
    expect(png.every((a) => a.quality === 1)).toBe(true);
    expect(png[1]?.shrink).toBeLessThan(1);
  });

  test("firstThatFits stops at the first result under the limit", async () => {
    const tried: EncodeAttempt[] = [];
    const found = await firstThatFits(
      encodeAttempts("image/webp"),
      (attempt) => {
        tried.push(attempt);
        return Promise.resolve({ size: attempt.quality * 400_000 });
      }
    );
    expect(found?.result.size).toBeLessThanOrEqual(OUTPUT_MAX_BYTES);
    expect(found?.attempt.quality).toBe(0.74);
    expect(tried).toHaveLength(3);
  });

  test("firstThatFits returns null when nothing fits or encoding fails", async () => {
    const none = await firstThatFits(encodeAttempts("image/png"), () =>
      Promise.resolve({ size: OUTPUT_MAX_BYTES + 1 })
    );
    expect(none).toBeNull();
    const failed = await firstThatFits(encodeAttempts("image/png"), () =>
      Promise.resolve(null)
    );
    expect(failed).toBeNull();
  });

  test("formatBytes", () => {
    expect(formatBytes(88_000)).toBe("86 KB");
    expect(formatBytes(18_839_699)).toBe("18.0 MB");
  });
});

describe("checkWorkshopInput", () => {
  const png = (width: number, height: number) => {
    const bytes = new Uint8Array(40);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    bytes.set([73, 72, 68, 82], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
  };

  test("accepts big pictures the API itself would refuse", () => {
    const check = checkWorkshopInput(png(4000, 3000));
    expect(check.ok).toBe(true);
  });

  test("refuses other types, empty files and huge pixel counts", () => {
    expect(checkWorkshopInput(new Uint8Array(0)).ok).toBe(false);
    expect(checkWorkshopInput(new TextEncoder().encode("<svg></svg>")).ok).toBe(
      false
    );
    expect(checkWorkshopInput(png(10_000, 10_000)).ok).toBe(false);
  });
});
