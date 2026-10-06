// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { beforeEach, describe, expect, test } from "bun:test";
import {
  BUILTIN_KEY_MAX,
  builtinByKey,
  builtinStickers,
  dogKey,
  isBuiltinKeyShape,
  outerKey,
  pileKey,
} from "@/lib/builtin-stickers";
import {
  builtinEditor,
  listHiddenBuiltinRows,
  listHiddenBuiltins,
  setBuiltinHidden,
} from "@/lib/server/hidden-builtins";
import { builtinToggleInput, firstIssue } from "@/lib/server/validate";
import { createTestDb, type TestDb } from "./support/d1";

const NOW = 1_700_000_000_000;
const TRAM = outerKey("place-tram");
const DOG = dogKey("people-dog");
const STICKER_SRC = /^\/stickers\/[a-z-]+\.webp$/;

describe("built-in sticker keys", () => {
  test("every built-in has a unique, well-formed key and a label", () => {
    const all = builtinStickers();
    expect(all.length).toBe(16);
    expect(new Set(all.map((item) => item.key)).size).toBe(all.length);
    for (const item of all) {
      expect(isBuiltinKeyShape(item.key)).toBe(true);
      expect(item.src).toMatch(STICKER_SRC);
      expect(item.label).not.toBe("贴纸");
    }
    expect(builtinByKey().has(DOG)).toBe(true);
    expect(builtinByKey().has(pileKey("运维与网络", "place-lighthouse"))).toBe(
      true
    );
  });

  test("the key pattern rejects anything else", () => {
    for (const bad of [
      "",
      "dog:",
      "cat:people-dog",
      "dog:People-Dog",
      "dog:people dog",
      "pile::obj-idea",
      "pile:a:b:obj-idea",
      "pile:AI",
      "pile:A\u0000I:obj-idea",
      "outer:place-tram\n",
      `outer:${"a".repeat(BUILTIN_KEY_MAX)}`,
    ]) {
      expect(isBuiltinKeyShape(bad)).toBe(false);
    }
  });
});

describe("POST /api/builtins input", () => {
  test("accepts a key and a boolean", () => {
    expect(builtinToggleInput.parse({ hidden: true, key: TRAM })).toEqual({
      hidden: true,
      key: TRAM,
    });
  });

  test("rejects bad keys and non-boolean hidden", () => {
    const badKey = builtinToggleInput.safeParse({
      hidden: true,
      key: "<script>",
    });
    expect(badKey.success).toBe(false);
    if (!badKey.success) {
      expect(firstIssue(badKey.error)).toBe("不知道是哪张自带贴纸。");
    }
    expect(
      builtinToggleInput.safeParse({ hidden: "yes", key: TRAM }).success
    ).toBe(false);
    expect(builtinToggleInput.safeParse({ key: TRAM }).success).toBe(false);
    expect(
      builtinToggleInput.safeParse({
        hidden: false,
        key: `pile:${"字".repeat(25)}:obj-idea`,
      }).success
    ).toBe(false);
  });
});

describe("hidden_builtins", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });

  test("hide is idempotent and keeps who hid it first", async () => {
    const first = await setBuiltinHidden(db.d1, {
      by: "admin:owner@example.com",
      hidden: true,
      key: TRAM,
      now: NOW,
    });
    expect(first.changed).toBe(true);
    const again = await setBuiltinHidden(db.d1, {
      by: "owner:github:sosyz",
      hidden: true,
      key: TRAM,
      now: NOW + 1000,
    });
    expect(again.changed).toBe(false);
    expect(await listHiddenBuiltinRows(db.d1)).toEqual([
      { hidden_at: NOW, hidden_by: "admin:owner@example.com", key: TRAM },
    ]);
  });

  test("restore deletes the row; restoring again does nothing", async () => {
    await setBuiltinHidden(db.d1, {
      by: "admin:a",
      hidden: true,
      key: TRAM,
      now: NOW,
    });
    await setBuiltinHidden(db.d1, {
      by: "admin:a",
      hidden: true,
      key: DOG,
      now: NOW + 1,
    });
    expect(await listHiddenBuiltins(db.d1)).toEqual([DOG, TRAM]);
    const restored = await setBuiltinHidden(db.d1, {
      by: "admin:a",
      hidden: false,
      key: TRAM,
      now: NOW + 2,
    });
    expect(restored.changed).toBe(true);
    const twice = await setBuiltinHidden(db.d1, {
      by: "admin:a",
      hidden: false,
      key: TRAM,
      now: NOW + 3,
    });
    expect(twice.changed).toBe(false);
    expect(await listHiddenBuiltins(db.d1)).toEqual([DOG]);
  });
});

describe("who may hide a built-in", () => {
  const noAccess = { message: "请先登录", ok: false, status: 401 } as const;

  test("an Access login", () => {
    expect(
      builtinEditor({ bypass: false, email: "me@example.com", ok: true }, null)
    ).toEqual({ actor: "admin:me@example.com", ok: true });
  });

  test("the owner's GitHub session", () => {
    expect(builtinEditor(noAccess, { isOwner: true, login: "sosyz" })).toEqual({
      actor: "owner:github:sosyz",
      ok: true,
    });
  });

  test("a visitor without a login: 401", () => {
    const result = builtinEditor(noAccess, null);
    expect(result.ok).toBe(false);
    expect(result.ok ? 0 : result.status).toBe(401);
  });

  test("another GitHub user, or a failed Access token: 403", () => {
    const other = builtinEditor(noAccess, { isOwner: false, login: "x" });
    expect(other.ok ? 0 : other.status).toBe(403);
    const expired = builtinEditor(
      { message: "登录已失效", ok: false, status: 403 },
      null
    );
    expect(expired.ok ? 0 : expired.status).toBe(403);
  });

  test("Access not configured is still just 401 for a visitor", () => {
    const result = builtinEditor(
      { message: "没配置", ok: false, status: 503 },
      null
    );
    expect(result.ok ? 0 : result.status).toBe(401);
  });
});
