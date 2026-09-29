/**
 * The owner's in-page review of comments, the pure part (unit-tested in
 * tests/review-comments.test.ts): the admin API shapes, merging pending
 * comments into the list by time, moving an item between the lists after a
 * decision, matching the `?review=c:<id>` deep link, the review bar's state
 * machine, the bar / owner tools as HTML strings, and the numbers of
 * throwing a comment into the trash (which comments, the drag slop, the
 * lifted slip's pose).
 *
 * Rejecting a pending comment and taking down (撤下) an approved one is not
 * a button: the owner drags the comment into the trash, or presses Delete on
 * the focused card (comment-drag.ts; the request waits for 已扔掉 · 撤销,
 * trash.ts). The bars only say so (THROW_HINT).
 *
 * The browser side (requests, rendering, focus) is review-comments.ts.
 */
import type {
  AdminComment,
  AdminDecision,
  ItemStatus,
  PublicComment,
} from "@/lib/server/types";
import type { ReviewTarget } from "./owner";
import type { PendingComment } from "./store";
import { esc } from "./util";

/*
 * Admin API shapes (src/lib/server/types.ts): GET /api/admin/comments?slug=
 * → AdminCommentsResponse {pending, hidden}; POST /api/admin/decide →
 * DecideResponse {ok, id, decision, status, next}.
 */

/** A comment as the admin API sends it: public fields + status, fingerprint. */
export type ReviewComment = AdminComment;

export type Decision = AdminDecision;

export type DecideRequest = { decision: Decision; reply?: string };

const STATUS_OF: Record<Decision, ItemStatus | null> = {
  approve: "approved",
  reject: "rejected",
  hold: "pending",
  reply: null,
};

/**
 * The status after a decision: what the server said, else what the decision
 * implies; null = unchanged (a reply only).
 */
export const statusAfter = (
  decision: Decision,
  reported?: ItemStatus
): ItemStatus | null => reported ?? STATUS_OF[decision];

/** Only same-site paths are followed (never `//host` or `javascript:`). */
export const safeHref = (href: string | null | undefined) =>
  href?.startsWith("/") && !href.startsWith("//") ? href : null;

/* ---------- rows of the comment list ---------- */

export type Row =
  | { kind: "approved"; item: PublicComment }
  | { kind: "own"; item: PendingComment }
  | { kind: "review"; item: ReviewComment }
  | { kind: "hidden"; item: ReviewComment };

const byTime = (a: { createdAt: number }, b: { createdAt: number }) =>
  a.createdAt - b.createdAt;

/** Visitors: approved comments, then their own pending ones (as before). */
export const visitorRows = (
  approved: PublicComment[],
  own: PendingComment[]
): Row[] => [
  ...approved.map((item): Row => ({ kind: "approved", item })),
  ...own.map((item): Row => ({ kind: "own", item })),
];

/**
 * The owner: every comment of the note in time order. An id shows once:
 * approved beats a pending review item, which beats the owner's own
 * pending copy from localStorage.
 */
export const mergeRows = (
  approved: PublicComment[],
  own: PendingComment[],
  review: ReviewComment[]
): Row[] => {
  const seen = new Set<string>();
  const rows: Row[] = [];
  const add = (row: Row) => {
    if (!seen.has(row.item.id)) {
      seen.add(row.item.id);
      rows.push(row);
    }
  };
  for (const item of approved) {
    add({ kind: "approved", item });
  }
  for (const item of review) {
    add({ kind: "review", item });
  }
  for (const item of own) {
    add({ kind: "own", item });
  }
  // Array#sort is stable: equal times keep the order above.
  return rows.sort((a, b) => byTime(a.item, b.item));
};

/* ---------- moving an item after a decision ---------- */

export type Board = {
  approved: PublicComment[];
  pending: ReviewComment[];
  hidden: ReviewComment[];
};

export type Outcome = {
  id: string;
  /** null: unchanged (reply only). */
  status: ItemStatus | null;
  /** Set / replace the owner reply; "" removes it; undefined leaves it. */
  reply?: string;
};

type Found = { item: PublicComment; status: ItemStatus; fingerprint: string };

const findItem = (board: Board, id: string): Found | null => {
  const approved = board.approved.find((item) => item.id === id);
  if (approved) {
    return { item: approved, status: "approved", fingerprint: "" };
  }
  const review = [...board.pending, ...board.hidden].find(
    (item) => item.id === id
  );
  return review
    ? { item: review, status: review.status, fingerprint: review.fingerprint }
    : null;
};

/** Just the public fields (drops status / fingerprint). */
const toPublic = (item: PublicComment): PublicComment => ({
  id: item.id,
  kind: item.kind,
  parentId: item.parentId,
  name: item.name,
  site: item.site,
  body: item.body,
  anchor: item.anchor,
  createdAt: item.createdAt,
  reply: item.reply,
  user: item.user,
  isOwner: item.isOwner,
});

const insertByTime = <T extends { createdAt: number }>(list: T[], item: T) =>
  [...list, item].sort(byTime);

const replyOf = (
  current: PublicComment["reply"],
  reply: string | undefined,
  now: number
): PublicComment["reply"] => {
  if (reply === undefined) {
    return current;
  }
  return reply ? { body: reply, at: now } : null;
};

/** Moves the decided item to the list of its new status (pure). */
export const applyDecision = (
  board: Board,
  outcome: Outcome,
  now: number
): Board => {
  const found = findItem(board, outcome.id);
  if (!found) {
    return board;
  }
  const status = outcome.status ?? found.status;
  const reply = replyOf(found.item.reply, outcome.reply, now);
  const others = (item: { id: string }) => item.id !== outcome.id;
  const next: Board = {
    approved: board.approved.filter(others),
    pending: board.pending.filter(others),
    hidden: board.hidden.filter(others),
  };
  const plain = { ...toPublic(found.item), reply };
  const moved: ReviewComment = {
    ...plain,
    status,
    fingerprint: found.fingerprint,
  };
  switch (status) {
    case "approved":
      next.approved = insertByTime(next.approved, plain);
      break;
    case "pending":
      next.pending = insertByTime(next.pending, moved);
      break;
    case "rejected":
      // 已撤下 lists the latest first (as GET /api/admin/comments does).
      next.hidden = [moved, ...next.hidden];
      break;
    default:
      return board;
  }
  return next;
};

/* ---------- the deep link ---------- */

export type TargetHit = {
  list: "pending" | "approved" | "hidden";
  item: PublicComment;
  /** A highlight comment: its real place is the underlined text. */
  inline: boolean;
  /** The action whose button gets focus. */
  focus: BarAction | "reply-open";
};

const FOCUS_OF: Record<TargetHit["list"], TargetHit["focus"]> = {
  pending: "approve",
  hidden: "restore",
  approved: "reply-open",
};

/** Where the `?review=c:<id>` comment is on this note, if it is here. */
export const matchTarget = (
  target: ReviewTarget | null,
  board: Board
): TargetHit | null => {
  if (target?.type !== "comment") {
    return null;
  }
  const lists: [TargetHit["list"], PublicComment[]][] = [
    ["pending", board.pending],
    ["approved", board.approved],
    ["hidden", board.hidden],
  ];
  for (const [list, items] of lists) {
    const item = items.find((entry) => entry.id === target.id);
    if (item) {
      return {
        list,
        item,
        inline: item.kind === "inline" && item.anchor !== null,
        focus: FOCUS_OF[list],
      };
    }
  }
  return null;
};

/* ---------- the review bar ---------- */

export type BarMode = "idle" | "reply";

export type BarState = {
  mode: BarMode;
  /** A request is on its way: buttons are inert. */
  busy: boolean;
  /** The reply being written (kept when the editor is folded). */
  draft: string;
  error: string;
};

export const IDLE_BAR: BarState = {
  mode: "idle",
  busy: false,
  draft: "",
  error: "",
};

export type BarEvent =
  | { type: "toggle-reply"; draft: string }
  | { type: "edit"; draft: string }
  | { type: "cancel" }
  | { type: "send" }
  | { type: "fail"; message: string }
  | { type: "done" };

/** The review bar's state machine (pure). */
export const reduceBar = (state: BarState, event: BarEvent): BarState => {
  if (state.busy && event.type !== "fail" && event.type !== "done") {
    return state;
  }
  switch (event.type) {
    case "toggle-reply":
      return state.mode === "reply"
        ? { ...state, mode: "idle", error: "" }
        : { ...state, mode: "reply", draft: state.draft || event.draft };
    case "edit":
      return { ...state, draft: event.draft };
    case "cancel":
      return { ...state, mode: "idle", error: "" };
    case "send":
      return { ...state, busy: true, error: "" };
    case "fail":
      return { ...state, busy: false, error: event.message };
    case "done":
      return IDLE_BAR;
    default:
      return state;
  }
};

export type BarAction =
  | "approve"
  | "reject"
  | "restore"
  | "reply-save"
  | "reply-delete";

export const BAR_ACTIONS: readonly string[] = [
  "approve",
  "reject",
  "restore",
  "reply-save",
  "reply-delete",
];

/** Owner replies: same limit as a comment (validate.ts LIMITS.body). */
export const REPLY_MAX = 800;

/** The request a button sends, or why it cannot be sent yet. */
export const requestFor = (
  action: BarAction,
  bar: BarState
): { ok: true; request: DecideRequest } | { ok: false; message: string } => {
  const draft = bar.mode === "reply" ? bar.draft.trim() : "";
  if ([...draft].length > REPLY_MAX) {
    return { ok: false, message: `回复最多 ${REPLY_MAX} 个字。` };
  }
  switch (action) {
    case "approve":
      // An empty editor sends no reply, so an existing one is kept.
      return {
        ok: true,
        request: draft
          ? { decision: "approve", reply: draft }
          : { decision: "approve" },
      };
    case "reject":
      return { ok: true, request: { decision: "reject" } };
    case "restore":
      return { ok: true, request: { decision: "approve" } };
    case "reply-save":
      return draft
        ? { ok: true, request: { decision: "reply", reply: draft } }
        : { ok: false, message: "回复还是空的。" };
    case "reply-delete":
      return { ok: true, request: { decision: "reply", reply: "" } };
    default:
      return { ok: false, message: "不认识这个操作。" };
  }
};

/* ---------- HTML (owner only) ---------- */

/** Fingerprint and GitHub login, small, under the name. */
export const whoHtml = (item: ReviewComment) => {
  const parts = [
    item.fingerprint
      ? `指纹 <code title="${esc(item.fingerprint)}">${esc(item.fingerprint)}</code>`
      : "",
    item.user ? `GitHub @${esc(item.user.login)}` : "",
  ].filter(Boolean);
  return parts.length > 0
    ? `<p class="rv-who">${parts.join('<span aria-hidden="true"> · </span>')}</p>`
    : "";
};

const key = (id: string, action: string) => `${esc(id)}:${action}`;

const button = (
  id: string,
  action: string,
  label: string,
  { cls = "rv-link", busy = false, extra = "" } = {}
) =>
  `<button type="button" class="${cls}" data-rv-act="${action}" data-key="${key(id, action)}"${busy ? ' aria-disabled="true"' : ""}${extra}>${label}</button>`;

const errorHtml = (bar: BarState) =>
  bar.error ? `<p class="rv-msg" role="alert">${esc(bar.error)}</p>` : "";

const draftHtml = (id: string, bar: BarState, placeholder: string) =>
  `<textarea class="rv-draft" data-rv-draft data-key="${key(id, "draft")}" maxlength="${REPLY_MAX}" rows="3" placeholder="${placeholder}" aria-label="博主回复">${esc(bar.draft)}</textarea>`;

const expanded = (open: boolean, controls: string) =>
  open
    ? ` aria-expanded="true" aria-controls="${controls}"`
    : ' aria-expanded="false"';

/** Says how to reject / take down (there is no button for it). */
export const THROW_HINT = "拖进垃圾桶即拒绝 / 撤下（或选中后按 Delete）";

/** The hint line under a throwable comment's tools (id for aria-describedby). */
export const throwHintId = (id: string) => `rv-throw-${esc(id)}`;

export const throwHintHtml = (id: string) =>
  `<p class="rv-hint rv-throw-hint" id="${throwHintId(id)}">${THROW_HINT}</p>`;

/** Pending comment: 通过 (stamp) / 回复… with an inline reply editor. */
export const reviewBarHtml = (id: string, bar: BarState) => {
  const replying = bar.mode === "reply";
  const panel = `rv-reply-${esc(id)}`;
  const editor = replying
    ? `<div class="rv-reply" id="${panel}">
        ${draftHtml(id, bar, "写一句回复，点「通过」时一起贴上……")}
        <p class="rv-hint">点「通过」时一起贴上，或者 ${button(id, "reply-save", "只存回复", { busy: bar.busy })}</p>
      </div>`
    : "";
  return `<div class="rv-bar" data-rv="${esc(id)}"${bar.busy ? ' aria-busy="true"' : ""}>
    <div class="rv-row">
      ${button(id, "approve", "通过", { cls: "stamp-btn rv-ok", busy: bar.busy })}
      ${button(id, "reply-open", "回复…", { busy: bar.busy, extra: expanded(replying, panel) })}
    </div>
    ${editor}
    ${throwHintHtml(id)}
    ${errorHtml(bar)}
  </div>`;
};

/** Approved comment: 回复 / 改回复 / 删回复; 撤下 is the trash. */
export const ownerToolsHtml = (item: PublicComment, bar: BarState) => {
  const { id } = item;
  const replying = bar.mode === "reply";
  const panel = `rv-reply-${esc(id)}`;
  const editor = replying
    ? `<div class="rv-reply" id="${panel}">
        ${draftHtml(id, bar, "写一句回复……")}
        <div class="rv-row">
          ${button(id, "reply-save", "存回复", { cls: "stamp-btn rv-ok", busy: bar.busy })}
          ${button(id, "cancel", "收起", { busy: bar.busy })}
        </div>
      </div>`
    : "";
  return `<div class="rv-bar rv-tools" data-rv="${esc(id)}"${bar.busy ? ' aria-busy="true"' : ""}>
    <div class="rv-row">
      <span class="rv-label">博主</span>
      ${button(id, "reply-open", item.reply ? "改回复" : "回复", { busy: bar.busy, extra: expanded(replying, panel) })}
      ${item.reply ? button(id, "reply-delete", "删回复", { busy: bar.busy }) : ""}
    </div>
    ${editor}
    ${throwHintHtml(id)}
    ${errorHtml(bar)}
  </div>`;
};

/** A comment in 已撤下: 恢复. */
export const restoreBarHtml = (id: string, bar: BarState) =>
  `<div class="rv-bar" data-rv="${esc(id)}"${bar.busy ? ' aria-busy="true"' : ""}>
    <div class="rv-row">${button(id, "restore", "恢复", { cls: "stamp-btn rv-ok", busy: bar.busy })}</div>
    ${errorHtml(bar)}
  </div>`;

/** After deciding the deep-linked comment. */
export type NextState = {
  id: string;
  status: ItemStatus | null;
  /** Same-site path of the next pending item; null = nothing left. */
  href: string | null;
};

const DONE_TEXT: Record<ItemStatus, string> = {
  approved: "这条通过了。",
  rejected: "这条拒绝了，在「已撤下」里还能恢复。",
  pending: "这条放回待审了。",
};

export const nextHtml = (next: NextState) => {
  const done = next.status ? DONE_TEXT[next.status] : "回复存好了。";
  const go = next.href
    ? `<button type="button" class="rv-next-go" data-rv-next="${esc(next.href)}" data-key="rv-next-go">下一条待审 →</button>`
    : '<button type="button" class="rv-next-go" data-rv-next="/admin/" data-key="rv-next-done">都审完了，回后台 →</button>';
  return `<div class="rv-next sticky-paper" role="status"><span>${done}</span>${go}</div>`;
};

/* ---------- throwing a comment into the trash (comment-drag.ts) ---------- */

/** The rows the owner can throw: 待审 (→ 拒绝) and approved (→ 撤下). */
export const canThrowRow = (kind: Row["kind"], owner: boolean) =>
  owner && (kind === "review" || kind === "approved");

/** What the trash does to it, for its label. */
export const throwVerb = (kind: "review" | "approved") =>
  kind === "review" ? "拒绝" : "撤下";

/** Pointer px a press may wander before the card is picked up. */
export const DRAG_SLOP = 6;

export const pastSlop = (dx: number, dy: number, slop = DRAG_SLOP) =>
  Math.hypot(dx, dy) > slop;

/**
 * Where a press may pick a card up: not on its text (so selecting and
 * copying still work), not on a control. Presses on the paper around the
 * text (padding, the avatar, the stamps) pick it up.
 */
export const NO_GRAB =
  "a, button, input, textarea, select, summary, label, [contenteditable], .cmt-body, .cmt-meta, .cmt-quote, .cmt-owner, .rv-who, .rv-bar, .ann-body, .ann-reply";

/** Tilt of the lifted slip (deg) and how much larger it gets. */
export const LIFT_TILT = -3;
export const LIFT_SCALE = 1.02;
/** A slip let go elsewhere floats back this long (ms). */
export const FLOAT_BACK_MS = 220;

/** Screen px of the lifted slip, from the card's place to the pointer. */
export const slipPose = (
  start: { x: number; y: number },
  point: { x: number; y: number },
  reduced: boolean
) => ({
  dx: point.x - start.x,
  dy: point.y - start.y,
  turn: reduced ? 0 : LIFT_TILT,
});
