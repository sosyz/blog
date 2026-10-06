// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import { fitsIn, isOutside, panToShow } from "../src/scripts/canvas/reveal";
import { sentMessage } from "../src/scripts/interact/announce";

const AREA = { height: 600, width: 800 };

describe("isOutside", () => {
  test("a box fully on the desk is visible", () => {
    expect(
      isOutside({ bottom: 100, left: 10, right: 200, top: 10 }, AREA)
    ).toBe(false);
  });

  test("a link above the top edge is outside", () => {
    expect(
      isOutside({ bottom: -30, left: 100, right: 160, top: -56 }, AREA)
    ).toBe(true);
  });

  test("a box under the drawer (past the free width) is outside", () => {
    expect(
      isOutside(
        { bottom: 140, left: 300, right: 420, top: 100 },
        { height: 600, width: 400 }
      )
    ).toBe(true);
  });
});

describe("fitsIn", () => {
  test("the intro card fits a phone-sized desk", () => {
    expect(fitsIn({ bottom: 300, left: -40, right: 248, top: 0 }, AREA)).toBe(
      true
    );
  });

  test("a card wider than the strip left of the drawer does not fit", () => {
    expect(
      fitsIn(
        { bottom: 300, left: 0, right: 360, top: 0 },
        { height: 600, width: 200 }
      )
    ).toBe(false);
  });
});

describe("panToShow", () => {
  test("centres the box in the area at the same scale", () => {
    const cam = { s: 0.8, x: 50, y: -20 };
    const box = { bottom: -60, left: 900, right: 1000, top: -100 };
    const next = panToShow(cam, box, AREA);
    expect(next.s).toBe(0.8);
    const shift = { x: next.x - cam.x, y: next.y - cam.y };
    expect((box.left + box.right) / 2 + shift.x).toBe(AREA.width / 2);
    expect((box.top + box.bottom) / 2 + shift.y).toBe(AREA.height / 2);
  });

  test("the result is visible afterwards", () => {
    const cam = { s: 1, x: 0, y: 0 };
    const box = { bottom: 740, left: -300, right: -200, top: 700 };
    const next = panToShow(cam, box, AREA);
    const dx = next.x - cam.x;
    const dy = next.y - cam.y;
    expect(
      isOutside(
        {
          bottom: box.bottom + dy,
          left: box.left + dx,
          right: box.right + dx,
          top: box.top + dy,
        },
        AREA
      )
    ).toBe(false);
  });
});

describe("sentMessage", () => {
  test("pending comments say they wait for review", () => {
    expect(sentMessage("pending")).toBe("已寄出，审核通过后公开。");
  });

  test("approved comments say they are public", () => {
    expect(sentMessage("approved")).toBe("已寄出，已经公开。");
  });

  test("a rejected comment reads like a pending one", () => {
    expect(sentMessage("rejected")).toBe(sentMessage("pending"));
  });
});
