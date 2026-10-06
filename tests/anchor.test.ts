// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import { locateAnchor, prefixOf } from "../src/scripts/interact/anchor";

const pick = (texts: string[], parts: ReturnType<typeof locateAnchor>) =>
  (parts ?? [])
    .map((p) => (texts[p.index] ?? "").slice(p.start, p.end))
    .join("|");

describe("locateAnchor", () => {
  test("finds text inside one node", () => {
    const texts = ["gatewayId：直接给网关名称就好"];
    const parts = locateAnchor(texts, "直接给网关名称就好", "gatewayId：");
    expect(parts).toEqual([{ end: 19, index: 0, start: 10 }]);
  });

  test("spans several text nodes (inline code, links)", () => {
    const texts = ["模型名称要遵循 ", "workers-ai/[model_name]", " 这个格式。"];
    const parts = locateAnchor(
      texts,
      "遵循 workers-ai/[model_name] 这个",
      "模型名称要"
    );
    expect(pick(texts, parts)).toBe("遵循 |workers-ai/[model_name]| 这个");
  });

  test("uses the prefix to pick the right occurrence", () => {
    const texts = ["A 说：好的。B 说：好的。"];
    const parts = locateAnchor(texts, "好的", "B 说：");
    expect(parts).toEqual([{ end: 13, index: 0, start: 11 }]);
  });

  test("falls back to a shorter prefix, then to the text alone", () => {
    const texts = ["（已修改）前面改了很多 B 说：好的。"];
    expect(locateAnchor(texts, "好的", "原来的文字 B 说：")).toEqual([
      { end: 18, index: 0, start: 16 },
    ]);
    expect(locateAnchor(["完全不同的前文，好的。"], "好的", "B 说：")).toEqual([
      { end: 10, index: 0, start: 8 },
    ]);
  });

  test("whitespace differences do not matter", () => {
    const texts = ["第一行\n   第二行 结束"];
    const parts = locateAnchor(texts, "第一行 第二行", "");
    expect(pick(texts, parts)).toBe("第一行\n   第二行");
  });

  test("returns null when the text is gone", () => {
    expect(locateAnchor(["别的内容"], "被删掉的句子", "")).toBeNull();
    expect(locateAnchor(["任何"], "   ", "")).toBeNull();
  });

  test("surrogate pairs keep DOM (UTF-16) offsets", () => {
    const texts = ["🐶 小狗很可爱"];
    expect(locateAnchor(texts, "小狗", "🐶 ")).toEqual([
      { end: 5, index: 0, start: 3 },
    ]);
  });
});

test("prefixOf keeps the last 12 characters, whitespace collapsed", () => {
  expect(prefixOf("这是一段很长的前文，\n  里面有换行和空格")).toBe(
    "前文， 里面有换行和空格"
  );
  expect(prefixOf("短")).toBe("短");
});
