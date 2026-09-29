// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { beforeEach, describe, expect, test } from "bun:test";
import {
  getStickerForDelete,
  recentMoves,
  tearOffSticker,
} from "@/lib/server/db";
import { hashEditToken, newEditToken } from "@/lib/server/edit-token";
import {
  type DeletableRow,
  type MoveAuth,
  planDelete,
  tearOffNote,
} from "@/lib/server/sticker-move";
import type { ItemStatus } from "@/lib/server/types";
import { firstIssue, stickerDeleteInput } from "@/lib/server/validate";
import { moveActor } from "@/lib/server/visitor";
import { createTestDb, type TestDb } from "./support/d1";

const SALT = "test-salt";
const IP_HASH = "abcdef0123456789abcdef0123456789";
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UPLOADER = "user-uploader";
const OTHER = "user-other";
const STICKER = "00000000-0000-4000-8000-000000000001";
const R2_KEY = `stickers/${STICKER}.webp`;

const rowWith = async (
  status: ItemStatus,
  token: string,
  userId: string | null = UPLOADER
): Promise<DeletableRow> => ({
  r2_key: R2_KEY,
  status,
  edit_token_hash: await hashEditToken(token, SALT),
  user_id: userId,
});

const visitor = (
  token?: string,
  session: { userId: string; isOwner: boolean } | null = null
): MoveAuth => ({ kind: "visitor", token, salt: SALT, session });

describe("stickerDeleteInput", () => {
  const messageOf = (input: unknown) => {
    const result = stickerDeleteInput.safeParse(input);
    return result.success ? null : firstIssue(result.error);
  };

  test("an empty body (parsed as {}) or a well-formed token", () => {
    const token = newEditToken();
    expect(stickerDeleteInput.parse({})).toEqual({});
    expect(stickerDeleteInput.parse({ token })).toEqual({ token });
  });

  test("a malformed token is refused", () => {
    expect(messageOf({ token: "" })).toBe("这张贴纸不是你贴的，撕不了。");
    expect(messageOf({ token: 42 })).toBe("这张贴纸不是你贴的，撕不了。");
    expect(messageOf({ token: `${newEditToken()}x` })).toBe(
      "这张贴纸不是你贴的，撕不了。"
    );
  });
});

describe("planDelete: who may tear a sticker off", () => {
  const token = newEditToken();

  test.each([
    ["the edit token", () => visitor(token), "token"],
    [
      "the uploader's GitHub session",
      () => visitor(undefined, { userId: UPLOADER, isOwner: false }),
      "account",
    ],
    [
      "the owner's GitHub session",
      () => visitor(undefined, { userId: OTHER, isOwner: true }),
      "owner",
    ],
    [
      "another user who still has the token",
      () => visitor(token, { userId: OTHER, isOwner: false }),
      "token",
    ],
  ] as const)("allowed with %s", async (_name, auth, via) => {
    for (const status of ["pending", "approved"] as const) {
      expect(await planDelete(await rowWith(status, token), auth())).toEqual({
        ok: true,
        via,
        alreadyGone: false,
        r2Key: R2_KEY,
      });
    }
  });

  test.each([
    ["an anonymous request without a token", () => visitor()],
    ["a wrong token", () => visitor(newEditToken())],
    [
      "another GitHub user",
      () => visitor(undefined, { userId: OTHER, isOwner: false }),
    ],
  ] as const)("404 for %s", async (_name, auth) => {
    const plan = await planDelete(await rowWith("approved", token), auth());
    expect(plan).toEqual({
      ok: false,
      status: 404,
      message: "没有这张贴纸，或者它不是你贴的。",
    });
  });

  test("a missing sticker answers exactly like someone else's", async () => {
    const missing = await planDelete(null, visitor(token));
    const notYours = await planDelete(
      await rowWith("approved", token),
      visitor()
    );
    expect(missing).toEqual(notYours);
  });

  test("an anonymous sticker has no account to match", async () => {
    const plan = await planDelete(
      await rowWith("approved", token, null),
      visitor(undefined, { userId: UPLOADER, isOwner: false })
    );
    expect(plan.ok).toBe(false);
  });

  test("already rejected: allowed and idempotent, still hands back the key", async () => {
    expect(
      await planDelete(await rowWith("rejected", token), visitor(token))
    ).toEqual({ ok: true, via: "token", alreadyGone: true, r2Key: R2_KEY });
    // Not yours: still 404, so rejected ids cannot be probed.
    const plan = await planDelete(await rowWith("rejected", token), visitor());
    expect(plan.ok ? 0 : plan.status).toBe(404);
  });
});

describe("tearOffNote", () => {
  test("the uploader tears it off, the owner throws it away", () => {
    expect(tearOffNote("token")).toBe("上传者撕掉了");
    expect(tearOffNote("account")).toBe("上传者撕掉了");
    expect(tearOffNote("owner")).toBe("博主扔掉了");
  });
});

describe("tearing off in D1", () => {
  let db: TestDb;

  const addSticker = async (status: ItemStatus, token: string) => {
    db.sqlite
      .query(
        `INSERT INTO stickers (id, r2_key, mime, width, height, bytes, x, y, rotation, scale, name,
           status, created_at, ip_hash, edit_token_hash, user_id)
         VALUES (?, ?, 'image/webp', 100, 80, 1000, 10, -20, 5, 1, NULL, ?, 1, ?, ?, ?)`
      )
      .run(
        STICKER,
        R2_KEY,
        status,
        IP_HASH,
        await hashEditToken(token, SALT),
        UPLOADER
      );
  };

  const stickerRow = () =>
    db.sqlite
      .query<{ status: ItemStatus; decided_at: number | null }, [string]>(
        "SELECT status, decided_at FROM stickers WHERE id = ?"
      )
      .get(STICKER);

  const logRows = () =>
    db.sqlite
      .query<
        {
          decision: string;
          actor: string;
          note: string | null;
          ip_hash: string | null;
        },
        [string]
      >(
        "SELECT decision, actor, note, ip_hash FROM moderation_log WHERE item_id = ? ORDER BY id"
      )
      .all(STICKER);

  const tearOff = (via: "token" | "owner", login?: string) =>
    tearOffSticker(db.d1, STICKER, {
      itemType: "sticker",
      itemId: STICKER,
      decision: "reject",
      actor: moveActor(via, login).actor,
      note: tearOffNote(via),
      createdAt: NOW,
      ipHash: via === "owner" ? null : IP_HASH,
    });

  beforeEach(() => {
    db = createTestDb();
  });

  test("the route's row carries the R2 key and the auth columns", async () => {
    const token = newEditToken();
    await addSticker("approved", token);
    const row = await getStickerForDelete(db.d1, STICKER);
    expect(row).toMatchObject({
      r2_key: R2_KEY,
      status: "approved",
      user_id: UPLOADER,
    });
    expect(await getStickerForDelete(db.d1, "missing")).toBeNull();
    const plan = await planDelete(row, visitor(token));
    expect(plan).toMatchObject({ ok: true, r2Key: R2_KEY });
  });

  test("rejects the sticker, sets decided_at and logs a 'reject'", async () => {
    await addSticker("approved", newEditToken());
    expect(await tearOff("token")).toBe(true);
    expect(stickerRow()).toEqual({ status: "rejected", decided_at: NOW });
    expect(logRows()).toEqual([
      {
        decision: "reject",
        actor: "visitor:owner",
        note: "上传者撕掉了",
        ip_hash: IP_HASH,
      },
    ]);
  });

  test("the owner's tear-off is logged as the owner, without an ip_hash", async () => {
    await addSticker("pending", newEditToken());
    expect(await tearOff("owner", "sonui")).toBe(true);
    expect(logRows()).toEqual([
      {
        decision: "reject",
        actor: "owner:github:sonui",
        note: "博主扔掉了",
        ip_hash: null,
      },
    ]);
  });

  test("a rejected sticker is gone for good: the route skips the write", async () => {
    const token = newEditToken();
    await addSticker("approved", token);
    await tearOff("token");
    const again = await planDelete(
      await getStickerForDelete(db.d1, STICKER),
      visitor(token)
    );
    expect(again).toMatchObject({ ok: true, alreadyGone: true });
    // Even if it did write, the status stays and decided_at does not move.
    expect(await tearOff("token")).toBe(false);
    expect(stickerRow()).toEqual({ status: "rejected", decided_at: NOW });
  });

  test("visitor tear-offs count for the move limit; the owner's do not", async () => {
    await addSticker("approved", newEditToken());
    await tearOff("token");
    db.sqlite.run(
      `INSERT INTO moderation_log (item_type, item_id, decision, actor, note, created_at, ip_hash)
       VALUES ('sticker', '${STICKER}', 'move', 'visitor:owner', NULL, ${NOW - 2 * HOUR}, '${IP_HASH}'),
              ('sticker', '${STICKER}', 'reject', 'owner:github:sonui', NULL, ${NOW}, NULL),
              ('sticker', '${STICKER}', 'reject', 'admin:a@b.c', NULL, ${NOW}, NULL)`
    );
    expect(
      await recentMoves(db.d1, {
        ipHash: IP_HASH,
        now: NOW + 1,
        hour: HOUR,
        day: DAY,
      })
    ).toEqual([1, 2]);
  });
});
