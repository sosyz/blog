// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  hasOffsets,
  MAX_OFFSET,
  MAX_OFFSETS,
  normaliseOffsets,
  offsetOf,
  visitorStickerKey,
  withOffset,
} from "../src/scripts/interact/sticker-offsets";

const ID = "0b5f3a52-8a4c-4c1e-9d7e-3f0c2b1a9e8d";

describe("normaliseOffsets", () => {
  test("keeps valid entries, rounds and clamps them", () => {
    expect(
      normaliseOffsets({
        "dog:people-dog": { dx: 10.4, dy: -3.6 },
        [visitorStickerKey(ID)]: { dx: 1e9, dy: 0 },
        "pile:运维与网络:place-lighthouse": { dx: 1, dy: 2 },
      })
    ).toEqual({
      "dog:people-dog": { dx: 10, dy: -4 },
      [`vs:${ID}`]: { dx: MAX_OFFSET, dy: 0 },
      "pile:运维与网络:place-lighthouse": { dx: 1, dy: 2 },
    });
  });

  test("drops junk", () => {
    expect(normaliseOffsets(null)).toEqual({});
    expect(normaliseOffsets([{ dx: 1, dy: 1 }])).toEqual({});
    expect(normaliseOffsets("x")).toEqual({});
    expect(
      normaliseOffsets({
        "bad key <script>": { dx: 1, dy: 1 },
        "outer:a": { dx: "1", dy: 1 },
        "outer:b": { dx: Number.NaN, dy: 1 },
        "outer:c": { dx: 0, dy: 0 },
        "outer:d": null,
      })
    ).toEqual({});
  });
});

describe("withOffset", () => {
  test("sets, replaces and removes offsets without touching the input", () => {
    const start = {};
    const one = withOffset(start, "outer:place-tower", { dx: 30, dy: -12 });
    expect(start).toEqual({});
    expect(offsetOf(one, "outer:place-tower")).toEqual({ dx: 30, dy: -12 });
    const two = withOffset(one, "outer:place-tower", { dx: 5, dy: 5 });
    expect(two).toEqual({ "outer:place-tower": { dx: 5, dy: 5 } });
    const back = withOffset(two, "outer:place-tower", { dx: 0.2, dy: -0.3 });
    expect(back).toEqual({});
    expect(hasOffsets(back)).toBe(false);
    expect(hasOffsets(two)).toBe(true);
  });

  test("unknown stickers have no offset", () => {
    expect(offsetOf({}, "dog:people-dog")).toEqual({ dx: 0, dy: 0 });
  });

  test("forgets the oldest beyond the cap", () => {
    let offsets = {};
    for (let i = 0; i <= MAX_OFFSETS; i++) {
      offsets = withOffset(offsets, `outer:s${i}`, { dx: 1, dy: 1 });
    }
    expect(Object.keys(offsets)).toHaveLength(MAX_OFFSETS);
    expect(offsetOf(offsets, "outer:s0")).toEqual({ dx: 0, dy: 0 });
    expect(offsetOf(offsets, `outer:s${MAX_OFFSETS}`)).toEqual({
      dx: 1,
      dy: 1,
    });
  });
});
