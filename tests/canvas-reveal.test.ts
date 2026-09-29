// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import { fitsIn, isOutside, panToShow } from "../src/scripts/canvas/reveal";
import { sentMessage } from "../src/scripts/interact/announce";

const AREA = { width: 800, height: 600 };

describe("isOutside", () => {
  test("a box fully on the desk is visible", () => {
    expect(
      isOutside({ left: 10, top: 10, right: 200, bottom: 100 }, AREA)
    ).toBe(false);
  });

  test("a link above the top edge is outside", () => {
    expect(
      isOutside({ left: 100, top: -56, right: 160, bottom: -30 }, AREA)
    ).toBe(true);
  });

  test("a box under the drawer (past the free width) is outside", () => {
    expect(
      isOutside(
        { left: 300, top: 100, right: 420, bottom: 140 },
        { width: 400, height: 600 }
      )
    ).toBe(true);
  });
});

describe("fitsIn", () => {
  test("the intro card fits a phone-sized desk", () => {
    expect(fitsIn({ left: -40, top: 0, right: 248, bottom: 300 }, AREA)).toBe(
      true
    );
  });

  test("a card wider than the strip left of the drawer does not fit", () => {
    expect(
      fitsIn(
        { left: 0, top: 0, right: 360, bottom: 300 },
        { width: 200, height: 600 }
      )
    ).toBe(false);
  });
});

describe("panToShow", () => {
  test("centres the box in the area at the same scale", () => {
    const cam = { x: 50, y: -20, s: 0.8 };
    const box = { left: 900, top: -100, right: 1000, bottom: -60 };
    const next = panToShow(cam, box, AREA);
    expect(next.s).toBe(0.8);
    const shift = { x: next.x - cam.x, y: next.y - cam.y };
    expect((box.left + box.right) / 2 + shift.x).toBe(AREA.width / 2);
    expect((box.top + box.bottom) / 2 + shift.y).toBe(AREA.height / 2);
  });

  test("the result is visible afterwards", () => {
    const cam = { x: 0, y: 0, s: 1 };
    const box = { left: -300, top: 700, right: -200, bottom: 740 };
    const next = panToShow(cam, box, AREA);
    const dx = next.x - cam.x;
    const dy = next.y - cam.y;
    expect(
      isOutside(
        {
          left: box.left + dx,
          top: box.top + dy,
          right: box.right + dx,
          bottom: box.bottom + dy,
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
