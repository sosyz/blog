// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  type AnchorBox,
  anchoredPoint,
  nearestAnchor,
} from "../src/scripts/interact/sticker-anchor";

const boxes = new Map<string, AnchorBox>([
  ["intro", { h: 353, w: 360, x: -180, y: -176.5 }],
  ["card:wireguard-use-notes", { h: 210, w: 250, x: -449, y: 637 }],
  ["card:rename-pve-hostname", { h: 189, w: 250, x: -445, y: 424 }],
]);

describe("nearestAnchor", () => {
  test("the box the centre is in, rounded like the server stores it", () => {
    expect(nearestAnchor(boxes, { x: 0, y: 0 })).toEqual({
      key: "intro",
      x: -180,
      y: -176,
    });
  });

  test("otherwise the closest edge wins", () => {
    // 22 px below the wireguard card, 71 px from the other one.
    expect(nearestAnchor(boxes, { x: -177, y: 682 })?.key).toBe(
      "card:wireguard-use-notes"
    );
  });

  test("null when nothing is laid out", () => {
    expect(nearestAnchor(new Map(), { x: 0, y: 0 })).toBeNull();
  });
});

describe("anchoredPoint", () => {
  test("moves by as much as the anchor moved", () => {
    const moved = new Map(boxes);
    moved.set("card:wireguard-use-notes", { h: 210, w: 250, x: 791, y: -21 });
    expect(
      anchoredPoint(moved, {
        anchor: { key: "card:wireguard-use-notes", x: -449, y: 637 },
        x: -177,
        y: 682,
      })
    ).toEqual({ x: 1063, y: 24 });
  });

  test("stays put without an anchor or when its note is gone", () => {
    const sticker = { x: 10, y: 20 };
    expect(anchoredPoint(boxes, sticker)).toEqual(sticker);
    expect(anchoredPoint(boxes, { ...sticker, anchor: null })).toEqual(sticker);
    expect(
      anchoredPoint(boxes, {
        ...sticker,
        anchor: { key: "card:deleted-note", x: 0, y: 0 },
      })
    ).toEqual(sticker);
  });
});
