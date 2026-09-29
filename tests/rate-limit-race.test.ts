// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
/**
 * Rate limits hold when requests arrive in parallel. Each flow below runs
 * like its route: the early count (recentCounts / recentMoves), then the
 * write. Under Promise.all every early count runs before any write, which is
 * the race the audit reproduced (15 parallel comments, 12 accepted); the
 * limit checked inside the write must still stop at the limit.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  insertComment,
  type LimitKey,
  type LogEntry,
  moveStickerWithinLimit,
  type NewComment,
  type NewSticker,
  recentCounts,
  recentCountsByUser,
  recentMoves,
  tearOffSticker,
  tearOffStickerWithinLimit,
  visitorLimits,
} from "@/lib/server/db";
import {
  DAY,
  HOUR,
  limitReachedMessage,
  limitWindow,
  RATE_LIMITS,
  rateLimitMessage,
} from "@/lib/server/rate-limit";
import { type StickerBucket, storeSticker } from "@/lib/server/sticker-store";
import type { ItemStatus } from "@/lib/server/types";
import { createTestDb, type TestDb } from "./support/d1";

const NOW = 1_700_000_000_000;
const IP = "ip-hash-0000000000000000000000000";
const USER = "user-racer";
const PARALLEL = 15;

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
  db.sqlite.run(
    `INSERT INTO users (id, github_id, login, name, avatar_url, html_url, created_at, updated_at)
     VALUES ('${USER}', 1, 'racer', NULL, 'https://a/', 'https://g/', 1, 1)`
  );
});

const countOf = (sql: string) =>
  db.sqlite.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${sql}`).get()
    ?.n ?? 0;

const logFor = (itemType: "comment" | "sticker", itemId: string): LogEntry => ({
  itemType,
  itemId,
  decision: "hold",
  actor: "moderator:manual",
  createdAt: NOW,
});

/* ---------- comments ---------- */

const commentRow = (
  id: string,
  { ipHash, userId }: { ipHash: string; userId: string | null },
  createdAt = NOW
): NewComment => ({
  id,
  slug: "go-context",
  parentId: null,
  kind: "comment",
  anchor: null,
  name: "racer",
  emailHash: null,
  site: null,
  body: "hello",
  status: "pending",
  createdAt,
  ipHash,
  ua: null,
  userId,
});

/** POST /api/comments from the rate limit's point of view. */
const postComment = async (
  n: number,
  who: { ipHash: string; userId: string | null },
  prechecks: (string | null)[]
) => {
  const window = { table: "comments" as const, now: NOW, hour: HOUR, day: DAY };
  const [byIp, byUser] = await Promise.all([
    recentCounts(db.d1, { ...window, ipHash: who.ipHash }),
    who.userId
      ? recentCountsByUser(db.d1, { ...window, userId: who.userId })
      : ([0, 0] as const),
  ]);
  prechecks.push(
    rateLimitMessage("comment", byIp[0], byIp[1]) ??
      rateLimitMessage("comment", byUser[0], byUser[1])
  );
  const id = `comment-${n}`;
  return insertComment(
    db.d1,
    commentRow(id, who),
    logFor("comment", id),
    visitorLimits(limitWindow("comment", NOW), who)
  );
};

const race = async (
  count: number,
  who: (n: number) => { ipHash: string; userId: string | null }
) => {
  const prechecks: (string | null)[] = [];
  const inserted = await Promise.all(
    Array.from({ length: count }, (_, n) => postComment(n, who(n), prechecks))
  );
  return { accepted: inserted.filter(Boolean).length, prechecks };
};

describe("comments: the limit is checked inside the INSERT", () => {
  test("15 parallel comments from one IP: every early check passes, 6 are stored", async () => {
    const { accepted, prechecks } = await race(PARALLEL, () => ({
      ipHash: IP,
      userId: null,
    }));
    // The early check alone would have let all of them through.
    expect(prechecks.every((message) => message === null)).toBe(true);
    expect(accepted).toBe(RATE_LIMITS.comment.perHour);
    expect(countOf("comments")).toBe(RATE_LIMITS.comment.perHour);
    // No log row for a comment that was not stored.
    expect(countOf("moderation_log WHERE item_type = 'comment'")).toBe(
      RATE_LIMITS.comment.perHour
    );
    expect(
      countOf(
        "moderation_log m WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.id = m.item_id)"
      )
    ).toBe(0);
  });

  test("one account from many IPs is limited per account", async () => {
    const { accepted } = await race(PARALLEL, (n) => ({
      ipHash: `ip-${n}`,
      userId: USER,
    }));
    expect(accepted).toBe(RATE_LIMITS.comment.perHour);
  });

  test("many IPs without an account are each under their own limit", async () => {
    const { accepted } = await race(PARALLEL, (n) => ({
      ipHash: `ip-${n}`,
      userId: null,
    }));
    expect(accepted).toBe(PARALLEL);
  });

  test("the day limit holds too; rows older than a day do not count", async () => {
    const { perDay, perHour } = RATE_LIMITS.comment;
    const earlier = perDay - 2;
    for (let n = 0; n < earlier; n += 1) {
      await insertComment(
        db.d1,
        commentRow(
          `earlier-${n}`,
          { ipHash: IP, userId: null },
          NOW - 2 * HOUR
        ),
        logFor("comment", `earlier-${n}`),
        []
      );
    }
    await insertComment(
      db.d1,
      commentRow("old", { ipHash: IP, userId: null }, NOW - DAY - 1),
      logFor("comment", "old"),
      []
    );
    const { accepted } = await race(perHour, () => ({
      ipHash: IP,
      userId: null,
    }));
    expect(accepted).toBe(2);
  });

  test("the 429 message is the same as the early check's", () => {
    expect(limitReachedMessage("comment")).toBe(
      rateLimitMessage("comment", RATE_LIMITS.comment.perHour, 0) ?? ""
    );
  });
});

/* ---------- stickers ---------- */

type FakeBucket = StickerBucket & {
  keys: Set<string>;
  puts: string[];
  /** Runs inside put, before the object "arrives" (to simulate a race). */
  onPut?: (key: string) => void;
  failPut?: boolean;
};

const fakeBucket = (): FakeBucket => {
  const bucket: FakeBucket = {
    keys: new Set(),
    puts: [],
    put: (key) => {
      bucket.puts.push(key);
      bucket.onPut?.(key);
      if (bucket.failPut) {
        return Promise.reject(new Error("R2 is down"));
      }
      bucket.keys.add(key);
      return Promise.resolve(null);
    },
    delete: (key) => {
      bucket.keys.delete(key);
      return Promise.resolve();
    },
  };
  return bucket;
};

const stickerRow = (
  id: string,
  status: ItemStatus,
  { ipHash, userId }: { ipHash: string; userId: string | null } = {
    ipHash: IP,
    userId: null,
  }
): NewSticker => ({
  id,
  r2Key: `stickers/${id}.webp`,
  mime: "image/webp",
  bytes: 3,
  width: 100,
  height: 80,
  x: 10,
  y: -20,
  rotation: 5,
  scale: 1,
  name: null,
  editTokenHash: null,
  status,
  createdAt: NOW,
  ipHash,
  userId,
});

const BYTES = new Uint8Array([1, 2, 3]);

const stickerLimits = (
  who: { ipHash: string; userId: string | null } = { ipHash: IP, userId: null }
) => visitorLimits(limitWindow("sticker", NOW), who);

const stickerState = (id: string) =>
  db.sqlite
    .query<{ status: ItemStatus; decided_at: number | null }, [string]>(
      "SELECT status, decided_at FROM stickers WHERE id = ?"
    )
    .get(id);

describe("stickers: D1 row first, then R2", () => {
  test("parallel uploads: 3 stored, and only those 3 images reach R2", async () => {
    const bucket = fakeBucket();
    const stored = await Promise.all(
      Array.from({ length: 10 }, async (_, n) => {
        const [lastHour, lastDay] = await recentCounts(db.d1, {
          table: "stickers",
          ipHash: IP,
          now: NOW,
          hour: HOUR,
          day: DAY,
        });
        expect(rateLimitMessage("sticker", lastHour, lastDay)).toBeNull();
        return storeSticker(db.d1, bucket, {
          bytes: BYTES,
          row: stickerRow(`s-${n}`, "pending"),
          log: logFor("sticker", `s-${n}`),
          limits: stickerLimits(),
        });
      })
    );
    const { perHour } = RATE_LIMITS.sticker;
    expect(stored.filter(Boolean).length).toBe(perHour);
    expect(countOf("stickers")).toBe(perHour);
    expect(countOf("moderation_log WHERE item_type = 'sticker'")).toBe(perHour);
    expect(bucket.puts.length).toBe(perHour);
    const keys = db.sqlite
      .query<{ r2_key: string }, []>("SELECT r2_key FROM stickers")
      .all()
      .map((row) => row.r2_key)
      .sort();
    expect([...bucket.keys].sort()).toEqual(keys);
  });

  test("per account across IPs", async () => {
    const bucket = fakeBucket();
    const stored = await Promise.all(
      Array.from({ length: 10 }, (_, n) => {
        const who = { ipHash: `ip-${n}`, userId: USER };
        return storeSticker(db.d1, bucket, {
          bytes: BYTES,
          row: stickerRow(`s-${n}`, "pending", who),
          log: logFor("sticker", `s-${n}`),
          limits: stickerLimits(who),
        });
      })
    );
    expect(stored.filter(Boolean).length).toBe(RATE_LIMITS.sticker.perHour);
    expect(bucket.keys.size).toBe(RATE_LIMITS.sticker.perHour);
  });

  test("the row is in D1 (pending) before the image is put", async () => {
    const bucket = fakeBucket();
    const during: ReturnType<typeof stickerState>[] = [];
    bucket.onPut = () => {
      during.push(stickerState("s-1"));
    };
    await storeSticker(db.d1, bucket, {
      bytes: BYTES,
      row: stickerRow("s-1", "approved"),
      log: logFor("sticker", "s-1"),
      limits: stickerLimits(),
    });
    expect(during).toEqual([{ status: "pending", decided_at: null }]);
    // Then it gets the moderated status, decided when it was created.
    expect(stickerState("s-1")).toEqual({
      status: "approved",
      decided_at: NOW,
    });
    expect(bucket.keys.has("stickers/s-1.webp")).toBe(true);
  });

  test("a pending sticker stays pending, decided_at null", async () => {
    const bucket = fakeBucket();
    await storeSticker(db.d1, bucket, {
      bytes: BYTES,
      row: stickerRow("s-1", "pending"),
      log: logFor("sticker", "s-1"),
      limits: stickerLimits(),
    });
    expect(stickerState("s-1")).toEqual({
      status: "pending",
      decided_at: null,
    });
  });

  test("a failed R2 put removes the row and its log again", async () => {
    const bucket = fakeBucket();
    bucket.failPut = true;
    await expect(
      storeSticker(db.d1, bucket, {
        bytes: BYTES,
        row: stickerRow("s-1", "pending"),
        log: logFor("sticker", "s-1"),
        limits: stickerLimits(),
      })
    ).rejects.toThrow("R2 is down");
    expect(countOf("stickers")).toBe(0);
    expect(countOf("moderation_log")).toBe(0);
  });

  test("a sticker the moderator rejects is logged, counted, never uploaded", async () => {
    const bucket = fakeBucket();
    const stored = await storeSticker(db.d1, bucket, {
      bytes: BYTES,
      row: stickerRow("s-1", "rejected"),
      log: { ...logFor("sticker", "s-1"), decision: "reject" },
      limits: stickerLimits(),
    });
    expect(stored).toBe(true);
    expect(bucket.puts).toEqual([]);
    expect(stickerState("s-1")).toEqual({
      status: "rejected",
      decided_at: NOW,
    });
  });

  test("over the limit: nothing in D1, nothing in R2", async () => {
    const bucket = fakeBucket();
    for (let n = 0; n < RATE_LIMITS.sticker.perHour; n += 1) {
      await storeSticker(db.d1, bucket, {
        bytes: BYTES,
        row: stickerRow(`s-${n}`, "pending"),
        log: logFor("sticker", `s-${n}`),
        limits: stickerLimits(),
      });
    }
    bucket.puts.length = 0;
    const stored = await storeSticker(db.d1, bucket, {
      bytes: BYTES,
      row: stickerRow("late", "pending"),
      log: logFor("sticker", "late"),
      limits: stickerLimits(),
    });
    expect(stored).toBe(false);
    expect(bucket.puts).toEqual([]);
    expect(stickerState("late")).toBeNull();
    expect(countOf("moderation_log WHERE item_id = 'late'")).toBe(0);
  });

  test("rejected while the image was on its way: the image is deleted", async () => {
    const bucket = fakeBucket();
    bucket.onPut = () => {
      db.sqlite.run(
        "UPDATE stickers SET status = 'rejected', decided_at = 1 WHERE id = 's-1'"
      );
    };
    await storeSticker(db.d1, bucket, {
      bytes: BYTES,
      row: stickerRow("s-1", "approved"),
      log: logFor("sticker", "s-1"),
      limits: stickerLimits(),
    });
    expect(bucket.keys.size).toBe(0);
    expect(stickerState("s-1")?.status).toBe("rejected");
  });

  test("approved by the owner while the image was on its way: kept", async () => {
    const bucket = fakeBucket();
    bucket.onPut = () => {
      db.sqlite.run(
        "UPDATE stickers SET status = 'approved', decided_at = 1 WHERE id = 's-1'"
      );
    };
    await storeSticker(db.d1, bucket, {
      bytes: BYTES,
      row: stickerRow("s-1", "pending"),
      log: logFor("sticker", "s-1"),
      limits: stickerLimits(),
    });
    expect(bucket.keys.has("stickers/s-1.webp")).toBe(true);
    expect(stickerState("s-1")).toEqual({ status: "approved", decided_at: 1 });
  });
});

/* ---------- moves and tear-offs ---------- */

const STICKER = "00000000-0000-4000-8000-000000000001";

const addSticker = () => {
  db.sqlite.run(
    `INSERT INTO stickers (id, r2_key, mime, width, height, bytes, x, y, rotation, scale,
       status, created_at, ip_hash)
     VALUES ('${STICKER}', 'stickers/x.webp', 'image/webp', 100, 80, 1000, 0, 0, 0, 1,
       'approved', 1, '${IP}')`
  );
};

const moveLimits = (): LimitKey[] => [
  { column: "ip_hash", value: IP, window: limitWindow("move", NOW) },
];

const moveLog = (decision: "move" | "reject", ipHash: string | null) => ({
  itemType: "sticker" as const,
  itemId: STICKER,
  decision,
  actor: "visitor:owner",
  createdAt: NOW,
  ipHash,
});

describe("moves and tear-offs: the move limit is checked in the batch", () => {
  test("70 parallel moves: 60 moved and logged, the rest limited", async () => {
    addSticker();
    const results = await Promise.all(
      Array.from({ length: 70 }, async (_, n) => {
        const [lastHour, lastDay] = await recentMoves(db.d1, {
          ipHash: IP,
          now: NOW,
          hour: HOUR,
          day: DAY,
        });
        expect(rateLimitMessage("move", lastHour, lastDay)).toBeNull();
        return moveStickerWithinLimit(db.d1, STICKER, {
          to: { x: n, y: 0, rotation: 0, scale: 1 },
          log: moveLog("move", IP),
          limits: moveLimits(),
        });
      })
    );
    const { perHour } = RATE_LIMITS.move;
    expect(results.filter((result) => !result.limited).length).toBe(perHour);
    expect(results.filter((result) => result.changed).length).toBe(perHour);
    expect(results.every((result) => result.changed !== result.limited)).toBe(
      true
    );
    expect(countOf("moderation_log WHERE decision = 'move'")).toBe(perHour);
    // The last move that got through is where the sticker is.
    const { x } = db.sqlite
      .query<{ x: number }, []>("SELECT x FROM stickers")
      .get() ?? { x: -1 };
    expect(x).toBe(perHour - 1);
  });

  test("the owner is not limited (no limit keys)", async () => {
    addSticker();
    const results = await Promise.all(
      Array.from({ length: 70 }, (_, n) =>
        moveStickerWithinLimit(db.d1, STICKER, {
          to: { x: n, y: 0, rotation: 0, scale: 1 },
          log: moveLog("move", null),
          limits: [],
        })
      )
    );
    expect(results.every((result) => result.changed && !result.limited)).toBe(
      true
    );
  });

  test("a tear-off over the move limit changes nothing and logs nothing", async () => {
    addSticker();
    for (let n = 0; n < RATE_LIMITS.move.perHour; n += 1) {
      await moveStickerWithinLimit(db.d1, STICKER, {
        to: { x: n, y: 0, rotation: 0, scale: 1 },
        log: moveLog("move", IP),
        limits: moveLimits(),
      });
    }
    const torn = await tearOffStickerWithinLimit(db.d1, STICKER, {
      log: moveLog("reject", IP),
      limits: moveLimits(),
    });
    expect(torn).toEqual({ limited: true, changed: false });
    expect(stickerState(STICKER)?.status).toBe("approved");
    expect(countOf("moderation_log WHERE decision = 'reject'")).toBe(0);
  });

  test("under the limit a tear-off works; again it is unchanged, not limited", async () => {
    addSticker();
    const first = await tearOffStickerWithinLimit(db.d1, STICKER, {
      log: moveLog("reject", IP),
      limits: moveLimits(),
    });
    expect(first).toEqual({ limited: false, changed: true });
    const again = await tearOffStickerWithinLimit(db.d1, STICKER, {
      log: moveLog("reject", IP),
      limits: moveLimits(),
    });
    expect(again).toEqual({ limited: false, changed: false });
    // The unlimited wrapper keeps its boolean contract.
    expect(await tearOffSticker(db.d1, STICKER, moveLog("reject", null))).toBe(
      false
    );
  });
});
