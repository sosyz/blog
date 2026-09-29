// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  checkEditToken,
  EDIT_TOKEN,
  hashEditToken,
  moveNote,
  newEditToken,
  sameDigest,
} from "../src/lib/server/edit-token";
import { roundPlacement } from "../src/lib/server/sticker-limits";
import { type MovableRow, planMove } from "../src/lib/server/sticker-move";
import {
  adminMoveInput,
  firstIssue,
  LIMITS,
  stickerMoveInput,
} from "../src/lib/server/validate";

const SALT = "test-salt";
const HEX_DIGEST = /^[0-9a-f]{64}$/;

describe("edit tokens", () => {
  test("are 256-bit base64url strings, different every time", () => {
    const a = newEditToken();
    const b = newEditToken();
    expect(a).toMatch(EDIT_TOKEN);
    expect(b).toMatch(EDIT_TOKEN);
    expect(a).not.toBe(b);
  });

  test("hash is salted", async () => {
    const token = newEditToken();
    const one = await hashEditToken(token, SALT);
    expect(one).toMatch(HEX_DIGEST);
    expect(await hashEditToken(token, "other")).not.toBe(one);
  });

  test("checkEditToken accepts only the stored token", async () => {
    const token = newEditToken();
    const stored = await hashEditToken(token, SALT);
    expect(await checkEditToken(token, stored, SALT)).toBe(true);
    expect(await checkEditToken(newEditToken(), stored, SALT)).toBe(false);
    expect(await checkEditToken(token, stored, "other")).toBe(false);
    expect(await checkEditToken(token, null, SALT)).toBe(false);
    expect(await checkEditToken("short", stored, SALT)).toBe(false);
  });

  test("sameDigest compares whole strings", () => {
    expect(sameDigest("abcd", "abcd")).toBe(true);
    expect(sameDigest("abcd", "abce")).toBe(false);
    expect(sameDigest("abcd", "abc")).toBe(false);
    expect(sameDigest("", "")).toBe(false);
  });

  test("moveNote writes old → new", () => {
    expect(
      moveNote(
        { x: 10, y: 20, rotation: 0, scale: 1 },
        { x: 40, y: 20, rotation: 5, scale: 1.2 }
      )
    ).toBe("(10, 20) 0° ×1 → (40, 20) 5° ×1.2");
    expect(
      moveNote(
        { x: 0, y: 0, rotation: 0, scale: 1 },
        { x: 1, y: 0, rotation: 0, scale: 1 },
        "博主整理贴纸"
      )
    ).toBe("博主整理贴纸：(0, 0) 0° ×1 → (1, 0) 0° ×1");
  });
});

describe("roundPlacement", () => {
  test("rounds like the upload and clamps to the limits", () => {
    expect(
      roundPlacement({ x: 10.4, y: -3.6, rotation: 12.345, scale: 1.234 })
    ).toEqual({ x: 10, y: -4, rotation: 12.3, scale: 1.23 });
    expect(roundPlacement({ x: 1e9, y: -1e9, rotation: 90, scale: 9 })).toEqual(
      {
        x: LIMITS.world,
        y: -LIMITS.world,
        rotation: LIMITS.rotation,
        scale: LIMITS.scaleMax,
      }
    );
  });
});

describe("stickerMoveInput", () => {
  const token = newEditToken();
  const base = { x: 100, y: -40, rotation: 10, scale: 1.2, token };

  const messageOf = (input: unknown) => {
    const result = stickerMoveInput.safeParse(input);
    return result.success ? null : firstIssue(result.error);
  };

  test("accepts a move within the upload ranges", () => {
    expect(stickerMoveInput.parse(base)).toEqual(base);
    expect(
      messageOf({ ...base, x: LIMITS.world, scale: LIMITS.scaleMin })
    ).toBeNull();
  });

  test("rejects out-of-range or missing values", () => {
    expect(messageOf({ ...base, x: LIMITS.world + 1 })).toBe(
      "贴纸的位置不对。"
    );
    expect(messageOf({ ...base, rotation: 46 })).toBe("贴纸的角度不对。");
    expect(messageOf({ ...base, scale: 0.1 })).toBe("贴纸的大小不对。");
    expect(messageOf({ ...base, scale: 2 })).toBe("贴纸的大小不对。");
    const { y: _y, ...noY } = base;
    expect(messageOf(noY)).toBe("贴纸的位置不对。");
  });

  test("does not coerce strings, null or NaN", () => {
    expect(messageOf({ ...base, x: "100" })).toBe("贴纸的位置不对。");
    expect(messageOf({ ...base, x: null })).toBe("贴纸的位置不对。");
    expect(messageOf({ ...base, rotation: Number.NaN })).toBe(
      "贴纸的角度不对。"
    );
  });

  test("a token, when sent, must be well formed", () => {
    expect(messageOf({ ...base, token: "" })).toBe(
      "这张贴纸不是你贴的，挪不了。"
    );
    expect(messageOf({ ...base, token: `${token}x` })).toBe(
      "这张贴纸不是你贴的，挪不了。"
    );
    expect(messageOf({ ...base, token: 42 })).toBe(
      "这张贴纸不是你贴的，挪不了。"
    );
  });

  test("no token is fine at this stage: a GitHub session may own it", () => {
    const { token: _t, ...noToken } = base;
    expect(stickerMoveInput.parse(noToken)).toEqual(noToken);
  });

  test("admin moves need no token", () => {
    const { token: _t, ...placement } = base;
    expect(adminMoveInput.parse(placement)).toEqual(placement);
    expect(adminMoveInput.safeParse({ ...placement, x: "1" }).success).toBe(
      false
    );
  });
});

describe("planMove", () => {
  const row = async (
    status: MovableRow["status"],
    token: string
  ): Promise<MovableRow> => ({
    x: 0,
    y: 0,
    rotation: 0,
    scale: 1,
    status,
    edit_token_hash: await hashEditToken(token, SALT),
  });
  const to = { x: 12.6, y: 5, rotation: 3.33, scale: 1.111 };

  test("moves a pending or approved sticker with the right token", async () => {
    const token = newEditToken();
    for (const status of ["pending", "approved"] as const) {
      const plan = await planMove(await row(status, token), to, {
        kind: "visitor",
        token,
        salt: SALT,
      });
      expect(plan).toEqual({
        ok: true,
        from: { x: 0, y: 0, rotation: 0, scale: 1 },
        to: { x: 13, y: 5, rotation: 3.3, scale: 1.11 },
        changed: true,
        via: "token",
      });
    }
  });

  test("a wrong token looks like a missing sticker", async () => {
    const plan = await planMove(await row("approved", newEditToken()), to, {
      kind: "visitor",
      token: newEditToken(),
      salt: SALT,
    });
    expect(plan.ok).toBe(false);
    expect(plan.ok ? 0 : plan.status).toBe(404);
    const missing = await planMove(null, to, { kind: "admin" });
    expect(missing.ok ? 0 : missing.status).toBe(404);
  });

  test("a sticker without a stored token cannot be moved by visitors", async () => {
    const legacy = { ...(await row("approved", "x")), edit_token_hash: null };
    const plan = await planMove(legacy, to, {
      kind: "visitor",
      token: newEditToken(),
      salt: SALT,
    });
    expect(plan.ok ? 0 : plan.status).toBe(404);
    const admin = await planMove(legacy, to, { kind: "admin" });
    expect(admin.ok).toBe(true);
  });

  test("rejected stickers stay put", async () => {
    const token = newEditToken();
    const plan = await planMove(await row("rejected", token), to, {
      kind: "visitor",
      token,
      salt: SALT,
    });
    expect(plan.ok ? 0 : plan.status).toBe(409);
    const admin = await planMove(await row("rejected", token), to, {
      kind: "admin",
    });
    expect(admin.ok ? 0 : admin.status).toBe(409);
  });

  test("the same position is not a change", async () => {
    const plan = await planMove(
      await row("approved", "x"),
      { x: 0.2, y: 0, rotation: 0.01, scale: 1.001 },
      { kind: "admin" }
    );
    expect(plan.ok && plan.changed).toBe(false);
  });

  describe("authorisation matrix", () => {
    const token = newEditToken();
    const mine = async () => ({
      ...(await row("approved", token)),
      user_id: "user-a",
    });
    const anonymous = async () => ({
      ...(await row("pending", token)),
      user_id: null,
    });
    const visitor = (extra: {
      token?: string;
      session?: { userId: string; isOwner: boolean } | null;
    }) => ({ kind: "visitor" as const, salt: SALT, ...extra });
    const viaOf = async (
      sticker: MovableRow,
      auth: Parameters<typeof planMove>[2]
    ) => {
      const plan = await planMove(sticker, to, auth);
      return plan.ok ? plan.via : plan.status;
    };

    test("edit token alone", async () => {
      expect(await viaOf(await mine(), visitor({ token }))).toBe("token");
      expect(await viaOf(await anonymous(), visitor({ token }))).toBe("token");
      expect(
        await viaOf(await mine(), visitor({ token: newEditToken() }))
      ).toBe(404);
    });

    test("the uploader's GitHub account, without the token", async () => {
      const session = { userId: "user-a", isOwner: false };
      expect(await viaOf(await mine(), visitor({ session }))).toBe("account");
    });

    test("another account cannot, unless it has the token", async () => {
      const session = { userId: "user-b", isOwner: false };
      expect(await viaOf(await mine(), visitor({ session }))).toBe(404);
      expect(await viaOf(await mine(), visitor({ session, token }))).toBe(
        "token"
      );
    });

    test("an anonymous sticker has no account owner", async () => {
      const session = { userId: "user-a", isOwner: false };
      expect(await viaOf(await anonymous(), visitor({ session }))).toBe(404);
    });

    test("the owner's session moves any visitor sticker", async () => {
      const session = { userId: "owner", isOwner: true };
      expect(await viaOf(await mine(), visitor({ session }))).toBe("owner");
      expect(await viaOf(await anonymous(), visitor({ session }))).toBe(
        "owner"
      );
      const legacy = { ...(await anonymous()), edit_token_hash: null };
      expect(await viaOf(legacy, visitor({ session }))).toBe("owner");
    });

    test("nothing at all is refused like a missing sticker", async () => {
      expect(await viaOf(await mine(), visitor({}))).toBe(404);
      expect(await viaOf(await mine(), visitor({ session: null }))).toBe(404);
    });

    test("Access admin still works; rejected stays put for everyone", async () => {
      expect(await viaOf(await mine(), { kind: "admin" })).toBe("admin");
      const rejected = { ...(await mine()), status: "rejected" as const };
      expect(
        await viaOf(
          rejected,
          visitor({ session: { userId: "o", isOwner: true } })
        )
      ).toBe(409);
      expect(
        await viaOf(
          rejected,
          visitor({ session: { userId: "user-a", isOwner: false } })
        )
      ).toBe(409);
    });
  });
});
