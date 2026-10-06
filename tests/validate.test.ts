// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  cleanText,
  commentInput,
  decisionInput,
  firstIssue,
  parseMineIds,
  stickerInput,
} from "../src/lib/server/validate";

const base = {
  body: "你好",
  kind: "comment",
  name: "  小周 ",
  slug: "go-context",
  turnstile: "token",
};

const messageOf = (input: unknown) => {
  const result = commentInput.safeParse(input);
  return result.success ? null : firstIssue(result.error);
};

describe("commentInput", () => {
  test("accepts a minimal comment and trims the name", () => {
    const result = commentInput.parse(base);
    expect(result.name).toBe("小周");
    expect(result.email).toBeUndefined();
    expect(result.site).toBeUndefined();
  });

  test("blank optional fields become undefined", () => {
    const result = commentInput.parse({
      ...base,
      email: " ",
      parentId: "",
      site: "",
    });
    expect(result.email).toBeUndefined();
    expect(result.site).toBeUndefined();
    expect(result.parentId).toBeUndefined();
  });

  test("name is required and at most 24 characters", () => {
    expect(messageOf({ ...base, name: "   " })).toBe("写一下昵称吧。");
    expect(messageOf({ ...base, name: "字".repeat(25) })).toBe(
      "昵称最多 24 个字。"
    );
    expect(messageOf({ ...base, name: "字".repeat(24) })).toBeNull();
  });

  test("body limits: 800 for comments, 300 for inline", () => {
    expect(messageOf({ ...base, body: "字".repeat(800) })).toBeNull();
    expect(messageOf({ ...base, body: "字".repeat(801) })).toBe(
      "内容最多 800 个字。"
    );
    const inline = {
      ...base,
      anchor: { exact: "网关名称", prefix: "" },
      kind: "inline",
    };
    expect(messageOf({ ...inline, body: "字".repeat(300) })).toBeNull();
    expect(messageOf({ ...inline, body: "字".repeat(301) })).toBe(
      "内容最多 300 个字。"
    );
  });

  test("body is cleaned: control chars dropped, blank lines capped", () => {
    expect(cleanText(" a\u0000b\r\n\r\n\r\n\r\nc ")).toBe("ab\n\nc");
    expect(messageOf({ ...base, body: " \n\t " })).toBe("内容还是空的。");
  });

  test("invisible format characters are dropped, ZWJ is kept", () => {
    const result = commentInput.parse({
      ...base,
      body: "a\u2066b\ufeffc 👨\u200d👩",
      name: "小\u202e周\u200b\u0085",
    });
    expect(result.name).toBe("小周");
    expect(result.body).toBe("abc 👨\u200d👩");
    expect(messageOf({ ...base, name: "\u202e\u200b" })).toBe("写一下昵称吧。");
  });

  test("anchor prefix is cleaned but not trimmed", () => {
    const result = commentInput.parse({
      ...base,
      anchor: { exact: "网关名称", prefix: "\u0000\u202e前面 \n的字 " },
      kind: "inline",
    });
    expect(result.kind === "inline" && result.anchor.prefix).toBe("前面 的字 ");
  });

  test("site must be an http(s) URL", () => {
    expect(messageOf({ ...base, site: "javascript:alert(1)" })).toBe(
      "网址要以 http:// 或 https:// 开头。"
    );
    expect(messageOf({ ...base, site: "ftp://example.com" })).not.toBeNull();
    expect(
      messageOf({ ...base, site: "https://example.com/a?b=1" })
    ).toBeNull();
  });

  test("email must look like an e-mail", () => {
    expect(messageOf({ ...base, email: "nope" })).toBe("邮箱格式不对。");
    expect(messageOf({ ...base, email: "a@b.cn" })).toBeNull();
  });

  test("slug must be a note id", () => {
    expect(messageOf({ ...base, slug: "../etc" })).toBe("不知道这是哪篇笔记。");
    expect(messageOf({ ...base, slug: "Go Context" })).toBe(
      "不知道这是哪篇笔记。"
    );
  });

  test("token is required", () => {
    expect(messageOf({ ...base, turnstile: "" })).toBe(
      "人机验证还没完成，稍等一下再寄出。"
    );
  });

  test("inline comments need an anchor of 2–200 characters", () => {
    const inline = { ...base, kind: "inline" };
    expect(messageOf(inline)).toBe("划线评论缺少被划的文字。");
    expect(messageOf({ ...inline, anchor: { exact: "网", prefix: "" } })).toBe(
      "划线的文字要在 2–200 个字之间。"
    );
    expect(
      messageOf({ ...inline, anchor: { exact: "字".repeat(201), prefix: "" } })
    ).toBe("划线的文字要在 2–200 个字之间。");
    const ok = commentInput.parse({
      ...inline,
      anchor: { exact: " 直接给网关\n名称就好 ", prefix: "gatewayId：" },
    });
    expect(ok.kind === "inline" && ok.anchor.exact).toBe("直接给网关 名称就好");
  });

  test("unknown kind is rejected", () => {
    expect(messageOf({ ...base, kind: "spam" })).toBe("不知道这是哪种留言。");
  });
});

describe("stickerInput", () => {
  const sticker = { turnstile: "t", x: "12.5", y: "-40" };

  test("coerces form strings and applies defaults", () => {
    const result = stickerInput.parse({ ...sticker, rotation: "", scale: "" });
    expect(result).toMatchObject({ rotation: 0, scale: 1, x: 12.5, y: -40 });
  });

  test("position is required: missing or blank is not (0, 0)", () => {
    for (const position of [
      { x: null, y: null },
      { x: "", y: "" },
      { x: " ", y: "3" },
      {},
    ]) {
      expect(
        stickerInput.safeParse({ turnstile: "t", ...position }).success
      ).toBe(false);
    }
    expect(stickerInput.parse({ ...sticker, x: "0", y: "0" })).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  test("rejects out-of-range values", () => {
    expect(stickerInput.safeParse({ ...sticker, x: "abc" }).success).toBe(
      false
    );
    expect(stickerInput.safeParse({ ...sticker, y: "50000" }).success).toBe(
      false
    );
    expect(stickerInput.safeParse({ ...sticker, rotation: "90" }).success).toBe(
      false
    );
    expect(stickerInput.safeParse({ ...sticker, scale: "3" }).success).toBe(
      false
    );
    expect(stickerInput.safeParse({ ...sticker, x: "Infinity" }).success).toBe(
      false
    );
  });
});

describe("decisionInput", () => {
  const id = "2166540f-7b0d-4706-88c2-c0694dbb6cc3";
  test("accepts approve with a reply", () => {
    const result = decisionInput.parse({
      decision: "approve",
      id,
      reply: " 谢谢 ",
      type: "comment",
    });
    expect(result.reply).toBe("谢谢");
  });
  test("rejects unknown decisions and bad ids", () => {
    expect(
      decisionInput.safeParse({ decision: "maybe", id, type: "comment" })
        .success
    ).toBe(false);
    expect(
      decisionInput.safeParse({ decision: "approve", id: "1", type: "comment" })
        .success
    ).toBe(false);
  });
});

test("parseMineIds keeps only uuids, at most 50", () => {
  const id = "2166540f-7b0d-4706-88c2-c0694dbb6cc3";
  expect(parseMineIds(`${id}, x ,'; DROP`)).toEqual([id]);
  expect(parseMineIds(null)).toEqual([]);
  expect(
    parseMineIds(Array.from({ length: 80 }, () => id).join(","))
  ).toHaveLength(50);
});
