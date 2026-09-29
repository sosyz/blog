// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { beforeEach, describe, expect, test } from "bun:test";
import {
  type AdminCommentRow,
  adminQueue,
  decide,
  listAdminComments,
  listApprovedComments,
  listPendingStickers,
  nextPending,
  reviewHref,
  reviewLink,
  toAdminComment,
} from "@/lib/server/db";
import type { ItemStatus } from "@/lib/server/types";
import { decisionInput } from "@/lib/server/validate";
import { createTestDb, type TestDb } from "./support/d1";

const PRIVATE_FIELDS = /email|ip_?hash|github_?id|"ua"|r2_?key|user_?id/i;
const IP_HASH = "abcdef0123456789abcdef0123456789";
const ACTOR = "admin:test@example.com";
const NOW = 1_700_000_000_000;

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type CommentSeed = {
  n: number;
  slug?: string;
  status?: ItemStatus;
  at?: number;
  kind?: "comment" | "inline";
  decidedAt?: number | null;
};

const addComment = (
  { sqlite }: TestDb,
  {
    n,
    slug = "go-context",
    status = "pending",
    at = n,
    kind = "comment",
    decidedAt = null,
  }: CommentSeed
) => {
  sqlite
    .query(
      `INSERT INTO comments (id, slug, kind, anchor_exact, anchor_prefix, name, email_hash, site,
         body, status, created_at, decided_at, ip_hash, ua)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id(n),
      slug,
      kind,
      kind === "inline" ? "被划的字" : null,
      kind === "inline" ? "前面" : null,
      `访客${n}`,
      "secret-email-hash",
      `评论 ${n}`,
      status,
      at,
      decidedAt,
      IP_HASH,
      "Mozilla/5.0"
    );
  return id(n);
};

const addSticker = (
  { sqlite }: TestDb,
  {
    n,
    status = "pending",
    at = n,
  }: { n: number; status?: ItemStatus; at?: number }
) => {
  sqlite
    .query(
      `INSERT INTO stickers (id, r2_key, mime, width, height, bytes, x, y, rotation, scale, name,
         status, created_at, ip_hash)
       VALUES (?, ?, 'image/webp', 100, 80, 1000, 10, -20, 5, 1, NULL, ?, ?, ?)`
    )
    .run(id(n), `stickers/${id(n)}.webp`, status, at, IP_HASH);
  return id(n);
};

const logRows = ({ sqlite }: TestDb, itemId: string) =>
  sqlite
    .query<{ decision: string; note: string | null }, [string]>(
      "SELECT decision, note FROM moderation_log WHERE item_id = ? ORDER BY id"
    )
    .all(itemId);

const commentRow = ({ sqlite }: TestDb, itemId: string) =>
  sqlite
    .query<
      {
        status: ItemStatus;
        decided_at: number | null;
        owner_reply: string | null;
        owner_reply_at: number | null;
      },
      [string]
    >(
      "SELECT status, decided_at, owner_reply, owner_reply_at FROM comments WHERE id = ?"
    )
    .get(itemId);

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

const run = (
  type: "comment" | "sticker",
  itemId: string,
  decision: "approve" | "reject" | "hold" | "reply",
  reply?: string
) =>
  decide(db.d1, { type, id: itemId, decision, reply, actor: ACTOR, now: NOW });

describe("reviewHref", () => {
  test("comments open on their note, stickers on the canvas", () => {
    expect(reviewHref({ type: "comment", id: id(1), slug: "go-context" })).toBe(
      `/notes/go-context/?review=c:${id(1)}#comments`
    );
    expect(reviewHref({ type: "sticker", id: id(2) })).toBe(
      `/?review=s:${id(2)}`
    );
  });

  test("reviewLink carries type, id and href", () => {
    expect(reviewLink({ type: "sticker", id: id(3) })).toEqual({
      type: "sticker",
      id: id(3),
      href: `/?review=s:${id(3)}`,
    });
  });
});

describe("admin comment shaping", () => {
  test("toAdminComment drops private columns even if they were selected", () => {
    const row = {
      id: id(1),
      kind: "inline",
      parent_id: null,
      name: "访客",
      site: null,
      body: "内容",
      anchor_exact: "被划的字",
      anchor_prefix: "前面",
      created_at: 5,
      owner_reply: null,
      owner_reply_at: null,
      author_github_id: 42,
      author_login: null,
      author_name: null,
      author_avatar: null,
      author_html: null,
      status: "pending",
      fingerprint: IP_HASH,
      email_hash: "secret-email-hash",
      ip_hash: IP_HASH,
      ua: "Mozilla/5.0",
      user_id: "u1",
    } as AdminCommentRow;
    const comment = toAdminComment(row, null);
    expect(comment.fingerprint).toBe("abcdef01");
    expect(comment.status).toBe("pending");
    expect(comment.createdAt).toBe(5);
    expect(comment.anchor).toEqual({ exact: "被划的字", prefix: "前面" });
    expect(JSON.stringify(comment)).not.toMatch(PRIVATE_FIELDS);
    expect(JSON.stringify(comment)).not.toContain(IP_HASH);
    expect(
      toAdminComment({ ...row, fingerprint: null }, null).fingerprint
    ).toBe("");
  });

  test("listAdminComments: pending oldest first, rejected newest first, per note", async () => {
    const first = addComment(db, { n: 1, at: 10 });
    const inline = addComment(db, { n: 2, at: 20, kind: "inline" });
    addComment(db, { n: 3, at: 5, slug: "other-note" });
    addComment(db, { n: 4, at: 1, status: "approved" });
    const oldReject = addComment(db, {
      n: 5,
      at: 1,
      status: "rejected",
      decidedAt: 100,
    });
    const newReject = addComment(db, {
      n: 6,
      at: 2,
      status: "rejected",
      decidedAt: 200,
    });
    const { pending, hidden } = await listAdminComments(
      db.d1,
      "go-context",
      null
    );
    expect(pending.map((c) => c.id)).toEqual([first, inline]);
    expect(pending.at(1)?.anchor).toEqual({
      exact: "被划的字",
      prefix: "前面",
    });
    expect(hidden.map((c) => c.id)).toEqual([newReject, oldReject]);
    expect(hidden.every((c) => c.status === "rejected")).toBe(true);
    expect(pending.at(0)?.fingerprint).toBe("abcdef01");
    const text = JSON.stringify({ pending, hidden });
    expect(text).not.toMatch(PRIVATE_FIELDS);
    expect(text).not.toContain(IP_HASH);
    expect(text).not.toContain("secret-email-hash");
  });
});

describe("listPendingStickers", () => {
  test("pending only, oldest first, public fields plus review ones", async () => {
    const later = addSticker(db, { n: 1, at: 20 });
    const earlier = addSticker(db, { n: 2, at: 10 });
    addSticker(db, { n: 3, status: "approved" });
    const stickers = await listPendingStickers(db.d1);
    expect(stickers.map((s) => s.id)).toEqual([earlier, later]);
    expect(stickers.at(0)).toEqual({
      id: earlier,
      x: 10,
      y: -20,
      rotation: 5,
      scale: 1,
      width: 100,
      height: 80,
      name: null,
      src: `/api/stickers/${earlier}/image`,
      status: "pending",
      createdAt: 10,
      fingerprint: "abcdef01",
    });
    expect(JSON.stringify(stickers)).not.toMatch(PRIVATE_FIELDS);
  });
});

describe("decide: comments", () => {
  test("pending → approved logs once; approving again changes nothing", async () => {
    const c = addComment(db, { n: 1 });
    expect(await run("comment", c, "approve")).toEqual({
      found: true,
      gone: false,
      status: "approved",
      changed: true,
      r2Key: null,
    });
    expect(commentRow(db, c)?.decided_at).toBe(NOW);
    const again = await run("comment", c, "approve");
    expect(again).toMatchObject({ status: "approved", changed: false });
    expect(logRows(db, c).map((row) => row.decision)).toEqual(["approve"]);
  });

  test("approved → rejected takes it down; rejected → approved restores it", async () => {
    const c = addComment(db, { n: 1, status: "approved" });
    expect(await run("comment", c, "reject")).toMatchObject({
      status: "rejected",
      changed: true,
    });
    expect(await listApprovedComments(db.d1, "go-context", null)).toEqual([]);
    const { hidden } = await listAdminComments(db.d1, "go-context", null);
    expect(hidden.map((h) => h.id)).toEqual([c]);
    expect(await run("comment", c, "reject")).toMatchObject({ changed: false });
    expect(await run("comment", c, "approve")).toMatchObject({
      status: "approved",
      changed: true,
    });
    const visible = await listApprovedComments(db.d1, "go-context", null);
    expect(visible.map((v) => v.id)).toEqual([c]);
    expect(logRows(db, c).map((row) => row.decision)).toEqual([
      "reject",
      "approve",
    ]);
  });

  test("reply only sets the owner reply, never the status", async () => {
    const c = addComment(db, { n: 1 });
    expect(await run("comment", c, "reply", "谢谢")).toMatchObject({
      status: "pending",
      changed: true,
    });
    expect(commentRow(db, c)).toEqual({
      status: "pending",
      decided_at: null,
      owner_reply: "谢谢",
      owner_reply_at: NOW,
    });
    expect(await run("comment", c, "reply", "谢谢")).toMatchObject({
      changed: false,
    });
    await run("comment", c, "reply", "");
    expect(commentRow(db, c)).toMatchObject({
      owner_reply: null,
      owner_reply_at: null,
    });
    expect(logRows(db, c)).toEqual([
      { decision: "reply", note: "谢谢" },
      { decision: "reply", note: "(removed)" },
    ]);
  });

  test("approve with a reply does both", async () => {
    const c = addComment(db, { n: 1 });
    await run("comment", c, "approve", "欢迎");
    expect(commentRow(db, c)).toMatchObject({
      status: "approved",
      owner_reply: "欢迎",
    });
    expect(logRows(db, c).map((row) => row.decision)).toEqual([
      "approve",
      "reply",
    ]);
  });

  test("unknown ids are not found", async () => {
    expect(await run("comment", id(99), "approve")).toEqual({ found: false });
    expect(await run("sticker", id(99), "reject")).toEqual({ found: false });
  });
});

describe("decide: stickers", () => {
  test("reject hands back the image key; a rejected sticker cannot come back", async () => {
    const s = addSticker(db, { n: 1 });
    expect(await run("sticker", s, "reject")).toEqual({
      found: true,
      gone: false,
      status: "rejected",
      changed: true,
      r2Key: `stickers/${s}.webp`,
    });
    expect(await run("sticker", s, "approve")).toEqual({
      found: true,
      gone: true,
    });
    expect(await run("sticker", s, "hold")).toEqual({
      found: true,
      gone: true,
    });
    // Rejecting again is a no-op that still returns the key (R2 delete retry).
    expect(await run("sticker", s, "reject")).toMatchObject({
      changed: false,
      r2Key: `stickers/${s}.webp`,
    });
    expect(logRows(db, s).map((row) => row.decision)).toEqual(["reject"]);
  });

  test("approve is idempotent", async () => {
    const s = addSticker(db, { n: 1 });
    await run("sticker", s, "approve");
    expect(await run("sticker", s, "approve")).toMatchObject({
      status: "approved",
      changed: false,
    });
    expect(logRows(db, s)).toHaveLength(1);
  });
});

describe("nextPending", () => {
  test("oldest pending item across comments and stickers, not the decided one", async () => {
    const sticker = addSticker(db, { n: 1, at: 5 });
    const comment = addComment(db, { n: 2, at: 10 });
    addComment(db, { n: 3, at: 1, status: "approved" });
    expect(await nextPending(db.d1, id(99))).toEqual({
      type: "sticker",
      id: sticker,
      href: `/?review=s:${sticker}`,
    });
    expect(await nextPending(db.d1, sticker)).toEqual({
      type: "comment",
      id: comment,
      href: `/notes/go-context/?review=c:${comment}#comments`,
    });
  });

  test("an item put back on hold is not its own next; empty queue → null", async () => {
    const c = addComment(db, { n: 1 });
    await run("comment", c, "hold");
    expect(await nextPending(db.d1, c)).toBeNull();
    await run("comment", c, "approve");
    expect(await nextPending(db.d1, id(99))).toBeNull();
  });

  test("equal times fall back to id order", async () => {
    addComment(db, { n: 2, at: 7 });
    addSticker(db, { n: 1, at: 7 });
    expect((await nextPending(db.d1, id(99)))?.id).toBe(id(1));
  });
});

describe("adminQueue", () => {
  test("every item links to its review place; counts are pending totals", async () => {
    const c = addComment(db, { n: 1 });
    const approved = addComment(db, { n: 2, status: "approved", decidedAt: 3 });
    const s = addSticker(db, { n: 3 });
    addSticker(db, { n: 4, status: "rejected" });
    const queue = await adminQueue(db.d1);
    expect(queue.counts).toEqual({ comments: 1, stickers: 1 });
    expect(queue.comments.map((item) => item.href)).toEqual([
      `/notes/go-context/?review=c:${c}#comments`,
    ]);
    expect(queue.recent.map((item) => item.href)).toEqual([
      `/notes/go-context/?review=c:${approved}#comments`,
    ]);
    expect(queue.stickers.at(0)).toMatchObject({
      id: s,
      src: `/api/stickers/${s}/image`,
      href: `/?review=s:${s}`,
      moves: 0,
    });
  });
});

describe("decisionInput: reply", () => {
  test("reply needs the reply field; an empty reply removes it", () => {
    const base = { type: "comment", id: id(1), decision: "reply" };
    expect(decisionInput.safeParse(base).success).toBe(false);
    expect(decisionInput.parse({ ...base, reply: "" }).reply).toBe("");
    expect(decisionInput.parse({ ...base, reply: " 好 " }).reply).toBe("好");
  });
});
