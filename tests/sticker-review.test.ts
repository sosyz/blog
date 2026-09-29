// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  badgeCount,
  cardSide,
  decidedText,
  findById,
  isAuthLost,
  REVIEW_LIFT,
  REVIEW_SCALE_MAX,
  REVIEW_SCALE_MIN,
  reviewCamera,
  reviewTime,
  shortFingerprint,
  withoutIds,
} from "../src/scripts/interact/sticker-review";

describe("badgeCount", () => {
  test("adds the counts the queue reports", () => {
    expect(badgeCount({ counts: { comments: 3, stickers: 2 } })).toBe(5);
  });

  test("falls back to the list lengths without counts", () => {
    expect(badgeCount({ comments: [1, 2], stickers: [1] })).toBe(3);
    expect(badgeCount({ counts: { comments: 4 }, stickers: [1, 2] })).toBe(6);
  });

  test("ignores nonsense and missing queues", () => {
    expect(badgeCount(null)).toBe(0);
    expect(badgeCount({})).toBe(0);
    expect(badgeCount({ counts: { comments: -1, stickers: Number.NaN } })).toBe(
      0
    );
    expect(badgeCount({ counts: { comments: 2.7, stickers: 0 } })).toBe(2);
  });
});

describe("isAuthLost", () => {
  test("401, 403 and an Access redirect mean the session is gone", () => {
    expect(isAuthLost(401)).toBe(true);
    expect(isAuthLost(403)).toBe(true);
    expect(isAuthLost(0, true)).toBe(true);
  });

  test("other failures are not about the session", () => {
    expect(isAuthLost(404)).toBe(false);
    expect(isAuthLost(409)).toBe(false);
    expect(isAuthLost(500)).toBe(false);
    expect(isAuthLost(200)).toBe(false);
  });
});

describe("findById / withoutIds", () => {
  const review = [{ id: "a", from: "review" }];
  const approved = [
    { id: "a", from: "approved" },
    { id: "b", from: "approved" },
  ];

  test("finds the review target in the first list that has it", () => {
    expect(findById("a", review, approved)?.from).toBe("review");
    expect(findById("b", review, approved)?.from).toBe("approved");
    expect(findById("c", review, approved)).toBeNull();
    expect(findById("a")).toBeNull();
  });

  test("the review copy replaces the uploader's own copy", () => {
    const own = [{ id: "a" }, { id: "x" }];
    expect(withoutIds(own, ["a", "b"])).toEqual([{ id: "x" }]);
    expect(withoutIds(own, [])).toEqual(own);
  });
});

describe("reviewCamera", () => {
  test("keeps a comfortable zoom and lifts the sticker above centre", () => {
    expect(reviewCamera({ x: 100, y: 200 }, 1)).toEqual({
      x: 100,
      y: 200 + REVIEW_LIFT,
      scale: 1,
    });
  });

  test("zooms in from far out and out from very close", () => {
    const far = reviewCamera({ x: 0, y: 0 }, 0.3);
    expect(far.scale).toBe(REVIEW_SCALE_MIN);
    expect(far.y).toBeCloseTo(REVIEW_LIFT / REVIEW_SCALE_MIN);
    expect(reviewCamera({ x: 0, y: 0 }, 1.8).scale).toBe(REVIEW_SCALE_MAX);
  });

  test("survives a broken camera scale", () => {
    expect(reviewCamera({ x: 5, y: 5 }, 0).scale).toBe(1);
    expect(reviewCamera({ x: 5, y: 5 }, Number.NaN).scale).toBe(1);
  });
});

describe("cardSide", () => {
  test("below when it fits", () => {
    expect(
      cardSide({ top: 100, bottom: 200, cardHeight: 150, viewportHeight: 800 })
    ).toBe("below");
  });

  test("above when the bottom is too close and there is room above", () => {
    expect(
      cardSide({ top: 500, bottom: 700, cardHeight: 150, viewportHeight: 800 })
    ).toBe("above");
  });

  test("stays below when neither side fits better", () => {
    expect(
      cardSide({ top: 40, bottom: 700, cardHeight: 150, viewportHeight: 800 })
    ).toBe("below");
  });
});

describe("labels", () => {
  test("short fingerprint", () => {
    expect(shortFingerprint(" 0123456789abcdef ")).toBe("01234567");
    expect(shortFingerprint("")).toBe("");
  });

  test("time in China", () => {
    // 2025-10-08T06:03:00Z is 14:03 in Shanghai.
    expect(reviewTime(Date.UTC(2025, 9, 8, 6, 3))).toBe("2025.10.08 14:03");
  });

  test("what the note says after deciding", () => {
    expect(decidedText("approve", false)).toContain("已通过");
    expect(decidedText("reject", false)).toContain("已拒绝");
    expect(decidedText("reject", true)).toContain("已撤下");
  });
});
