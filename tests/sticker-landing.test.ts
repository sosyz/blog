import { describe, expect, test } from "bun:test";
import {
  keepsAttribute,
  restingStyle,
} from "../src/scripts/interact/sticker-landing";

describe("restingStyle", () => {
  test("drops the CSS fallback's glide into the hand", () => {
    expect(
      restingStyle(
        "--w: 96px; --r: 4deg; --dx: 12px; --dy: -3px; --peel-lag-x: -40px; --peel-lag-y: 8.5px;"
      )
    ).toBe("--w: 96px; --r: 4deg; --dx: 12px; --dy: -3px;");
  });

  test("keeps left / top and the rest as they are", () => {
    expect(restingStyle("left: 120px; top: -40px; --w: 80px")).toBe(
      "left: 120px; top: -40px; --w: 80px"
    );
  });

  test("a glide written first leaves no stray separator", () => {
    expect(
      restingStyle("--peel-lag-x: 3px; --peel-lag-y: 4px; --dx: 1px")
    ).toBe("--dx: 1px");
  });

  test("empty stays empty", () => {
    expect(restingStyle("")).toBe("");
  });
});

describe("keepsAttribute", () => {
  test("keeps what draws and places the sticker", () => {
    for (const name of ["class", "style", "src", "srcset", "width", "height"]) {
      expect(keepsAttribute(name)).toBe(true);
    }
  });

  test("drops what layout.ts, the trash and assistive tech look for", () => {
    for (const name of [
      "data-sticker-key",
      "data-vs-id",
      "data-pile-sticker",
      "data-outer",
      "data-dog",
      "id",
      "tabindex",
      "title",
      "alt",
      "aria-label",
      "role",
    ]) {
      expect(keepsAttribute(name)).toBe(false);
    }
  });
});
