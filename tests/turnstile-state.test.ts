import { describe, expect, test } from "bun:test";
import {
  appearanceFor,
  boxShown,
  failText,
  TEXT,
} from "../src/scripts/interact/turnstile-state";

describe("turnstile status", () => {
  test("invisible until Cloudflare asks, always visible after a failure", () => {
    expect(appearanceFor(false)).toBe("interaction-only");
    expect(appearanceFor(true)).toBe("always");
  });

  test("the box shows when a click is needed", () => {
    expect(boxShown("need", false)).toBe(true);
    for (const state of ["idle", "wait", "ok", "fail", "off"] as const) {
      expect(boxShown(state, false)).toBe(false);
    }
  });

  test("in manual mode the box stays until it passes", () => {
    for (const state of ["wait", "need", "fail"] as const) {
      expect(boxShown(state, true)).toBe(true);
    }
    expect(boxShown("ok", true)).toBe(false);
    expect(boxShown("off", true)).toBe(false);
  });

  test("fail text carries Cloudflare's error code", () => {
    expect(failText("600010")).toBe("验证没通过（600010），点这里手动验证");
    expect(failText()).toBe(TEXT.fail);
    expect(failText("<b>")).toBe(TEXT.fail);
  });
});
