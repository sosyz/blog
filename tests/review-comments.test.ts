// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import type { PublicComment } from "../src/lib/server/types";
import { parseReview } from "../src/scripts/interact/owner";
import {
  applyDecision,
  type BarState,
  type Board,
  canThrowRow,
  DRAG_SLOP,
  IDLE_BAR,
  LIFT_TILT,
  matchTarget,
  mergeRows,
  NO_GRAB,
  nextHtml,
  ownerToolsHtml,
  pastSlop,
  type ReviewComment,
  reduceBar,
  requestFor,
  restoreBarHtml,
  reviewBarHtml,
  safeHref,
  slipPose,
  statusAfter,
  THROW_HINT,
  throwHintId,
  throwVerb,
  visitorRows,
  whoHtml,
} from "../src/scripts/interact/review-state";
import type { PendingComment } from "../src/scripts/interact/store";

const pub = (id: string, createdAt: number, extra = {}): PublicComment => ({
  id,
  kind: "comment",
  parentId: null,
  name: `n-${id}`,
  site: null,
  body: `body ${id}`,
  anchor: null,
  createdAt,
  reply: null,
  user: null,
  isOwner: false,
  ...extra,
});

const rev = (
  id: string,
  createdAt: number,
  status: ReviewComment["status"] = "pending",
  extra = {}
): ReviewComment => ({
  ...pub(id, createdAt, extra),
  status,
  fingerprint: `fp-${id}`,
});

const own = (id: string, createdAt: number): PendingComment => ({
  id,
  kind: "comment",
  name: "me",
  site: null,
  body: "mine",
  anchor: null,
  parentId: null,
  createdAt,
});

const ids = (rows: { item: { id: string } }[]) => rows.map((r) => r.item.id);

describe("mergeRows", () => {
  test("puts pending comments at their place in time", () => {
    const rows = mergeRows(
      [pub("a", 10), pub("c", 30)],
      [own("d", 40)],
      [rev("b", 20), rev("e", 50)]
    );
    expect(ids(rows)).toEqual(["a", "b", "c", "d", "e"]);
    expect(rows.map((r) => r.kind)).toEqual([
      "approved",
      "review",
      "approved",
      "own",
      "review",
    ]);
  });

  test("shows an id once: approved > review > own", () => {
    const rows = mergeRows(
      [pub("a", 10)],
      [own("a", 10), own("b", 20)],
      [rev("a", 10), rev("b", 20)]
    );
    expect(rows.map((r) => `${r.item.id}:${r.kind}`)).toEqual([
      "a:approved",
      "b:review",
    ]);
  });

  test("equal times keep approved first", () => {
    const rows = mergeRows([pub("a", 10)], [], [rev("b", 10)]);
    expect(ids(rows)).toEqual(["a", "b"]);
  });

  test("visitors keep the old order (approved, then their own)", () => {
    const rows = visitorRows([pub("a", 30)], [own("b", 10)]);
    expect(ids(rows)).toEqual(["a", "b"]);
  });
});

const board = (): Board => ({
  approved: [pub("a", 10), pub("c", 30)],
  pending: [rev("b", 20), rev("d", 40)],
  hidden: [rev("x", 5, "rejected")],
});

describe("applyDecision", () => {
  test("approve moves a pending comment into the list at its time", () => {
    const next = applyDecision(board(), { id: "b", status: "approved" }, 99);
    expect(ids(next.approved.map((item) => ({ item })))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(next.pending.map((c) => c.id)).toEqual(["d"]);
    const b = next.approved.find((c) => c.id === "b");
    expect(b && "fingerprint" in b).toBe(false);
  });

  test("approve with a reply sets the owner reply", () => {
    const next = applyDecision(
      board(),
      { id: "b", status: "approved", reply: "谢谢" },
      99
    );
    expect(next.approved.find((c) => c.id === "b")?.reply).toEqual({
      body: "谢谢",
      at: 99,
    });
  });

  test("reject moves a pending comment to 已撤下", () => {
    const next = applyDecision(board(), { id: "d", status: "rejected" }, 99);
    expect(next.pending.map((c) => c.id)).toEqual(["b"]);
    // Latest first, like the admin API.
    expect(next.hidden.map((c) => [c.id, c.status, c.fingerprint])).toEqual([
      ["d", "rejected", "fp-d"],
      ["x", "rejected", "fp-x"],
    ]);
  });

  test("撤下 an approved comment", () => {
    const next = applyDecision(board(), { id: "c", status: "rejected" }, 99);
    expect(next.approved.map((c) => c.id)).toEqual(["a"]);
    const taken = next.hidden.find((item) => item.id === "c");
    expect(taken?.status).toBe("rejected");
    expect(taken?.fingerprint).toBe("");
  });

  test("restore brings a hidden comment back", () => {
    const next = applyDecision(board(), { id: "x", status: "approved" }, 99);
    expect(next.hidden).toEqual([]);
    expect(next.approved.map((c) => c.id)).toEqual(["x", "a", "c"]);
  });

  test("reply only keeps the list and replaces or removes the reply", () => {
    const withReply = applyDecision(
      board(),
      { id: "a", status: null, reply: "好" },
      50
    );
    expect(withReply.approved.map((c) => c.id)).toEqual(["a", "c"]);
    expect(withReply.approved[0]?.reply).toEqual({ body: "好", at: 50 });
    const removed = applyDecision(
      withReply,
      { id: "a", status: null, reply: "" },
      60
    );
    expect(removed.approved[0]?.reply).toBeNull();
  });

  test("a reply on a pending comment keeps it pending", () => {
    const next = applyDecision(
      board(),
      { id: "b", status: null, reply: "嗯" },
      7
    );
    expect(next.pending.find((c) => c.id === "b")?.reply?.body).toBe("嗯");
  });

  test("unknown id changes nothing", () => {
    const before = board();
    expect(applyDecision(before, { id: "zz", status: "approved" }, 1)).toBe(
      before
    );
  });
});

describe("statusAfter and safeHref", () => {
  test("trusts the server, else derives from the decision", () => {
    expect(statusAfter("approve")).toBe("approved");
    expect(statusAfter("reject")).toBe("rejected");
    expect(statusAfter("hold")).toBe("pending");
    expect(statusAfter("reply")).toBeNull();
    expect(statusAfter("reply", "approved")).toBe("approved");
  });

  test("follows only same-site paths", () => {
    expect(safeHref("/notes/a/?review=c:1#comments")).toBe(
      "/notes/a/?review=c:1#comments"
    );
    expect(safeHref("//evil.example/")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});

describe("matchTarget", () => {
  test("finds a pending comment and focuses 通过", () => {
    const hit = matchTarget(parseReview("c:b"), board());
    expect(hit?.list).toBe("pending");
    expect(hit?.focus).toBe("approve");
    expect(hit?.inline).toBe(false);
  });

  test("hidden → 恢复, approved → 回复", () => {
    expect(matchTarget(parseReview("c:x"), board())?.focus).toBe("restore");
    expect(matchTarget(parseReview("c:a"), board())?.focus).toBe("reply-open");
  });

  test("marks highlight comments as inline", () => {
    const b = board();
    b.pending.push(
      rev("i", 60, "pending", {
        kind: "inline",
        anchor: { exact: "好的", prefix: "" },
      })
    );
    expect(matchTarget(parseReview("c:i"), b)?.inline).toBe(true);
  });

  test("ignores stickers, other notes and no link", () => {
    expect(matchTarget(parseReview("s:b"), board())).toBeNull();
    expect(matchTarget(parseReview("c:nope"), board())).toBeNull();
    expect(matchTarget(null, board())).toBeNull();
    expect(matchTarget(parseReview("x:b"), board())).toBeNull();
  });
});

describe("review bar", () => {
  const typed = (draft: string): BarState => ({
    ...IDLE_BAR,
    mode: "reply",
    draft,
  });

  test("回复… opens with the existing reply and folds again", () => {
    const open = reduceBar(IDLE_BAR, { type: "toggle-reply", draft: "旧" });
    expect(open.mode).toBe("reply");
    expect(open.draft).toBe("旧");
    const edited = reduceBar(open, { type: "edit", draft: "新" });
    const folded = reduceBar(edited, { type: "toggle-reply", draft: "旧" });
    expect(folded.mode).toBe("idle");
    // Reopening keeps what was typed.
    expect(reduceBar(folded, { type: "toggle-reply", draft: "旧" }).draft).toBe(
      "新"
    );
  });

  test("收起 folds the reply editor", () => {
    const open = reduceBar(IDLE_BAR, { type: "toggle-reply", draft: "" });
    expect(reduceBar(open, { type: "cancel" }).mode).toBe("idle");
  });

  test("busy ignores clicks until the answer comes", () => {
    const busy = reduceBar(typed("hi"), { type: "send" });
    expect(busy.busy).toBe(true);
    expect(reduceBar(busy, { type: "cancel" })).toBe(busy);
    expect(reduceBar(busy, { type: "toggle-reply", draft: "" })).toBe(busy);
    const failed = reduceBar(busy, { type: "fail", message: "断网了" });
    expect(failed).toEqual({ ...typed("hi"), error: "断网了" });
    expect(reduceBar(busy, { type: "done" })).toEqual(IDLE_BAR);
  });

  test("通过 sends the typed reply along", () => {
    expect(requestFor("approve", typed(" 谢谢 "))).toEqual({
      ok: true,
      request: { decision: "approve", reply: "谢谢" },
    });
  });

  test("通过 with an empty or folded editor keeps the existing reply", () => {
    expect(requestFor("approve", typed("  "))).toEqual({
      ok: true,
      request: { decision: "approve" },
    });
    expect(requestFor("approve", { ...IDLE_BAR, draft: "folded" })).toEqual({
      ok: true,
      request: { decision: "approve" },
    });
  });

  test("只存回复 needs text; 删回复 sends an empty reply", () => {
    expect(requestFor("reply-save", typed("")).ok).toBe(false);
    expect(requestFor("reply-save", typed("好"))).toEqual({
      ok: true,
      request: { decision: "reply", reply: "好" },
    });
    expect(requestFor("reply-delete", IDLE_BAR)).toEqual({
      ok: true,
      request: { decision: "reply", reply: "" },
    });
  });

  test("the trash sends reject (拒绝 / 撤下); 恢复 approves", () => {
    expect(requestFor("reject", IDLE_BAR)).toEqual({
      ok: true,
      request: { decision: "reject" },
    });
    expect(requestFor("restore", IDLE_BAR)).toEqual({
      ok: true,
      request: { decision: "approve" },
    });
  });

  test("a reply over the limit is refused", () => {
    expect(requestFor("approve", typed("字".repeat(801))).ok).toBe(false);
  });
});

describe("review HTML", () => {
  test("bar escapes ids and marks busy buttons", () => {
    const html = reviewBarHtml('a"b', { ...IDLE_BAR, busy: true });
    expect(html).toContain('data-rv="a&quot;b"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<textarea");
  });

  test("open editor shows the draft, escaped", () => {
    const html = reviewBarHtml("b", {
      ...IDLE_BAR,
      mode: "reply",
      draft: "<b>",
    });
    expect(html).toContain("&lt;b&gt;</textarea>");
    expect(html).toContain('aria-expanded="true" aria-controls="rv-reply-b"');
  });

  test("owner tools: 改回复 and 删回复 only with a reply", () => {
    expect(ownerToolsHtml(pub("a", 1), IDLE_BAR)).not.toContain("删回复");
    const replied = ownerToolsHtml(
      pub("a", 1, { reply: { body: "x", at: 1 } }),
      IDLE_BAR
    );
    expect(replied).toContain("改回复");
    expect(replied).toContain("删回复");
  });

  test("no 拒绝 / 撤下 buttons: the bars point to the trash", () => {
    const bar = reviewBarHtml("a", IDLE_BAR);
    const tools = ownerToolsHtml(pub("a", 1), IDLE_BAR);
    for (const html of [bar, tools]) {
      expect(html).not.toContain('data-rv-act="reject"');
      expect(html).not.toContain("ask-takedown");
      expect(html).not.toContain("确定撤下");
      expect(html).toContain(THROW_HINT);
      expect(html).toContain(`id="${throwHintId("a")}"`);
    }
    expect(bar).toContain('data-rv-act="approve"');
    expect(bar).toContain('data-rv-act="reply-open"');
    expect(THROW_HINT).toBe("拖进垃圾桶即拒绝 / 撤下（或选中后按 Delete）");
    // 已撤下 keeps its button and cannot be thrown again.
    const restore = restoreBarHtml("a", IDLE_BAR);
    expect(restore).toContain('data-rv-act="restore"');
    expect(restore).not.toContain(THROW_HINT);
  });

  test("hint ids are escaped", () => {
    expect(throwHintId('a"b')).toBe("rv-throw-a&quot;b");
  });

  test("who line: fingerprint and GitHub login", () => {
    const html = whoHtml(
      rev("a", 1, "pending", {
        user: {
          login: "octo",
          name: null,
          avatarUrl: "https://avatars.githubusercontent.com/u/1",
          htmlUrl: "https://github.com/octo",
        },
      })
    );
    expect(html).toContain("fp-a");
    expect(html).toContain("GitHub @octo");
    expect(whoHtml({ ...rev("a", 1), fingerprint: "" })).toBe("");
  });

  test("next: link or 都审完了", () => {
    expect(
      nextHtml({ id: "a", status: "approved", href: "/notes/x/?review=c:b" })
    ).toContain('data-rv-next="/notes/x/?review=c:b"');
    const done = nextHtml({ id: "a", status: "rejected", href: null });
    expect(done).toContain("都审完了");
    expect(done).toContain('data-rv-next="/admin/"');
    expect(nextHtml({ id: "a", status: null, href: null })).toContain(
      "回复存好了"
    );
  });
});

describe("throwing a comment into the trash", () => {
  test("only the owner, only 待审 and approved rows", () => {
    expect(canThrowRow("review", true)).toBe(true);
    expect(canThrowRow("approved", true)).toBe(true);
    expect(canThrowRow("hidden", true)).toBe(false);
    expect(canThrowRow("own", true)).toBe(false);
    for (const kind of ["review", "approved", "hidden", "own"] as const) {
      expect(canThrowRow(kind, false)).toBe(false);
    }
    expect(throwVerb("review")).toBe("拒绝");
    expect(throwVerb("approved")).toBe("撤下");
  });

  test("a press becomes a drag only past the slop", () => {
    expect(pastSlop(0, 0)).toBe(false);
    expect(pastSlop(DRAG_SLOP, 0)).toBe(false);
    expect(pastSlop(DRAG_SLOP, 1)).toBe(true);
    expect(pastSlop(-5, -5)).toBe(true);
    expect(pastSlop(3, 0, 2)).toBe(true);
  });

  test("the lifted slip follows the pointer, tilted unless reduced", () => {
    const start = { x: 100, y: 50 };
    expect(slipPose(start, { x: 130, y: 20 }, false)).toEqual({
      dx: 30,
      dy: -30,
      turn: LIFT_TILT,
    });
    expect(slipPose(start, { x: 100, y: 50 }, true)).toEqual({
      dx: 0,
      dy: 0,
      turn: 0,
    });
  });

  test("text and controls never start a drag", () => {
    const blocked = NO_GRAB.split(",").map((part) => part.trim());
    for (const selector of [
      "a",
      "button",
      "textarea",
      "summary",
      ".cmt-body",
      ".cmt-quote",
      ".ann-body",
      ".rv-bar",
    ]) {
      expect(blocked).toContain(selector);
    }
    // The paper around the text does: the avatar and the stamps.
    expect(blocked).not.toContain(".cmt-av");
    expect(blocked).not.toContain(".pend-stamp");
  });
});
