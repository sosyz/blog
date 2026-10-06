// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  alphaBounds,
  cleanMatteAlpha,
  compositeOverWhite,
  exteriorMask,
  hasTransparency,
  outlineAlpha,
  roundedRectAlpha,
  squaredDistanceToArtwork,
} from "../src/scripts/interact/die-cut";
import { applyJournalFilter } from "../src/scripts/interact/journal-filter";

const SIZE = 101;
const CENTRE = 50;

/** Alpha of a filled disc (optionally with a round hole) centred in SIZE×SIZE. */
const disc = (radius: number, hole = 0) => {
  const alpha = new Uint8ClampedArray(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const d = Math.hypot(x - CENTRE, y - CENTRE);
      alpha[y * SIZE + x] = d <= radius && d >= hole ? 255 : 0;
    }
  }
  return alpha;
};

const at = (values: ArrayLike<number>, x: number, y: number) =>
  values[y * SIZE + x] ?? -1;

describe("squaredDistanceToArtwork", () => {
  test("is the exact Euclidean distance to a single point", () => {
    const alpha = new Uint8ClampedArray(SIZE * SIZE);
    alpha[CENTRE * SIZE + CENTRE] = 255;
    const d = squaredDistanceToArtwork(alpha, SIZE, SIZE);
    expect(d).not.toBeNull();
    expect(at(d ?? [], CENTRE, CENTRE)).toBe(0);
    expect(at(d ?? [], CENTRE + 3, CENTRE + 4)).toBe(25);
    expect(at(d ?? [], 0, 0)).toBe(CENTRE * CENTRE * 2);
  });

  test("is null without any artwork", () => {
    expect(
      squaredDistanceToArtwork(new Uint8ClampedArray(16), 4, 4)
    ).toBeNull();
  });
});

describe("outlineAlpha", () => {
  test("a disc gets a ring of the requested width", () => {
    const radius = 20;
    const border = 6;
    const outline = outlineAlpha(disc(radius), SIZE, SIZE, border);
    // Along the x axis from the centre: solid up to the border's width, the
    // pixel centred exactly on its edge half covered, then nothing.
    expect(at(outline, CENTRE + radius, CENTRE)).toBe(255);
    expect(at(outline, CENTRE + radius + border - 1, CENTRE)).toBe(255);
    expect(at(outline, CENTRE + radius + border, CENTRE)).toBe(128);
    expect(at(outline, CENTRE + radius + border + 1, CENTRE)).toBe(0);
    // In every direction: the border is round, not square.
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const d = Math.hypot(x - CENTRE, y - CENTRE);
        if (d <= radius + border - 1) {
          expect(at(outline, x, y)).toBe(255);
        } else if (d >= radius + border + 1.5) {
          expect(at(outline, x, y)).toBe(0);
        }
      }
    }
  });

  test("the edge is anti-aliased", () => {
    const outline = outlineAlpha(disc(20), SIZE, SIZE, 5.5);
    // distance 6 from the disc edge: coverage 5.5 + 0.5 - 6 = 0 … 1 px ramp
    const values = new Set(Array.from(outline));
    expect([...values].some((v) => v > 0 && v < 255)).toBe(true);
  });

  test("fills holes enclosed by the artwork", () => {
    const ring = disc(30, 12);
    expect(at(ring, CENTRE, CENTRE)).toBe(0);
    const outline = outlineAlpha(ring, SIZE, SIZE, 3);
    // The hole is 12 px wide, far more than the 3 px border: still filled.
    expect(at(outline, CENTRE, CENTRE)).toBe(255);
    expect(at(exteriorMask(ring, SIZE, SIZE), CENTRE, CENTRE)).toBe(0);
    expect(at(exteriorMask(ring, SIZE, SIZE), 0, 0)).toBe(1);
  });

  test("does not fill a notch that opens to the outside", () => {
    const alpha = disc(30, 12);
    // Cut a channel from the hole to the right edge.
    for (let x = CENTRE; x < SIZE; x += 1) {
      for (let y = CENTRE - 2; y <= CENTRE + 2; y += 1) {
        alpha[y * SIZE + x] = 0;
      }
    }
    const outline = outlineAlpha(alpha, SIZE, SIZE, 1);
    expect(at(outline, CENTRE - 6, CENTRE)).toBe(0);
  });
});

describe("compositeOverWhite", () => {
  test("puts the artwork over the white border", () => {
    // pixel 0: opaque red artwork; 1: border only; 2: nothing; 3: half red over border
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 128,
    ]);
    compositeOverWhite(rgba, [255, 255, 0, 255]);
    expect(Array.from(rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(rgba.slice(4, 8))).toEqual([255, 255, 255, 255]);
    expect(rgba[11]).toBe(0);
    expect(Array.from(rgba.slice(12, 16))).toEqual([255, 127, 127, 255]);
  });
});

describe("shapes and bounds", () => {
  test("roundedRectAlpha cuts the corners only", () => {
    const shape = roundedRectAlpha(40, 30, 8);
    expect(shape[0]).toBe(0);
    expect(shape[15 * 40]).toBe(255);
    expect(shape[20]).toBe(255);
    expect(shape[15 * 40 + 20]).toBe(255);
  });

  test("alphaBounds finds the artwork box", () => {
    const box = alphaBounds(disc(10), SIZE, SIZE, 26);
    expect(box).toEqual({ height: 21, width: 21, x: 40, y: 40 });
    expect(alphaBounds(new Uint8ClampedArray(9), 3, 3)).toBeNull();
  });

  test("hasTransparency ignores a few stray pixels", () => {
    const alpha = new Uint8ClampedArray(10_000).fill(255);
    alpha[0] = 0;
    expect(hasTransparency(alpha)).toBe(false);
    alpha.fill(0, 0, 500);
    expect(hasTransparency(alpha)).toBe(true);
  });

  test("cleanMatteAlpha squeezes the matte tail", () => {
    expect(cleanMatteAlpha(0)).toBe(0);
    expect(cleanMatteAlpha(0.1 * 255)).toBe(0);
    expect(cleanMatteAlpha(0.8 * 255)).toBe(1);
    expect(cleanMatteAlpha(0.45 * 255)).toBeCloseTo(0.5, 1);
  });
});

describe("applyJournalFilter", () => {
  test("warms and mutes a little, leaves transparent pixels alone", () => {
    const rgba = new Uint8ClampedArray([100, 100, 200, 255, 9, 9, 9, 0]);
    applyJournalFilter(rgba, null);
    const [r = 0, g = 0, b = 0] = rgba;
    expect(r).toBeGreaterThan(100);
    expect(b).toBeLessThan(200);
    expect(b).toBeGreaterThan(170);
    expect(Math.abs(g - 100)).toBeLessThan(15);
    expect(Array.from(rgba.slice(4))).toEqual([9, 9, 9, 0]);
  });
});
