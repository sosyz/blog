/**
 * Inline (highlight) comments, ported from the approved prototype:
 *
 * - select 2–200 characters inside one paragraph → a "✎ 划线评论" button →
 *   a sticky-note popover with the form (Turnstile, 贴上 stamp);
 * - commented text gets a wavy pencil underline (dashed while only the
 *   visitor's own pending items exist) and a small count;
 * - on wide screens every highlight also gets a sticky note on the desk left
 *   of the drawer, level with the text, joined by a double-stroke ink leader
 *   line from a numbered ring on the drawer's margin, with an arrowhead.
 *   Notes follow scrolling and hide when their text leaves the view. Hovering
 *   a note or its text highlights both. With less than 230px of room the
 *   notes are hidden and clicking the underline opens the popover instead.
 *
 * Binding: re-binds to the article body on every `drawer:rendered` (the
 * drawer DOM is replaced on navigation), with a fallback that finds
 * `[data-post-body]` itself on `astro:page-load`.
 *
 * The owner (Access session, review-comments.ts) also sees the note's
 * pending highlight comments like their own pending ones (dashed underline,
 * dashed margin note, 待审), and the popover has a review bar for each. A
 * `?review=c:<id>` link to one of them lands here (REVIEW_FOCUS). The
 * owner rejects (待审) or takes down (撤下, approved) a highlight comment by
 * dragging it into the trash (comment-drag.ts): a row of the popover by its
 * paper (not its text), or a margin note that stands for a single comment
 * from anywhere; Delete / Backspace on the focused row or note does the
 * same. A thrown one is left out until 撤销 runs out (isThrown).
 */
import type { PublicComment } from "@/lib/server/types";
import {
  type DrawerRenderedDetail,
  onDrawerClose,
  onDrawerRendered,
} from "@/scripts/canvas/api";
import { rot, seeded } from "@/scripts/canvas/seed";
import { collapseSpace, locateAnchor, prefixOf } from "./anchor";
import { announce, sentMessage } from "./announce";
import {
  authBarHtml,
  authNow,
  bindLogout,
  currentPath,
  getAuth,
  SKIP_TURNSTILE_HTML,
  subscribe as subscribeAuth,
} from "./auth";
import { watchThrows } from "./comment-drag";
import { JUMP_EVENT, type JumpDetail } from "./events";
import {
  barOf,
  DENIED_TEXT,
  focusKey,
  isThrown,
  keepFocus,
  onReviewClick,
  onReviewInput,
  pulse,
  REVIEW_FOCUS,
  type ReviewFocusDetail,
  type ReviewView,
  reviewNow,
  watchReview,
} from "./review-comments";
import {
  nextHtml,
  reviewBarHtml,
  throwHintHtml,
  throwHintId,
  throwVerb,
  whoHtml,
} from "./review-state";
import {
  loadThread,
  type PendingComment,
  submitComment,
  subscribe,
  type Thread,
  threadNow,
} from "./store";
import {
  mountTurnstile,
  type TurnstileHandle,
  turnstileMarkup,
} from "./turnstile";
import {
  dotDate,
  esc,
  pick,
  readProfile,
  reduceMotion,
  saveProfile,
  scrollBehavior,
  TAPES,
  tapeSrc,
} from "./util";

const BLOCKS =
  "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, figcaption";
/** Never annotate inside these. */
const EXCLUDED =
  "pre, svg, .aside-sticky, .ann-pop, .ann-btn, [data-no-annotate]";
/** Text nodes inside these are not part of the article text. */
const SKIP_TEXT = "svg, script, style, .ann-n, .ann-btn, .ann-pop";
const EXACT_MIN = 2;
const EXACT_MAX = 200;
const INLINE_BODY_MAX = 300;
const NOTE_W = 196;
const NOTE_GAP = 40;
const MIN_ROOM = 230;
const NOTE_TEXT = 42;
const QUOTE_TEXT = 60;
const SELECTION_DELAY = 180;
const FOLLOW_MS = 460;
/** Stop following once the drawer has not moved for this many frames. */
const STILL_FRAMES = 4;
/** Movement below this (px) counts as the drawer standing still. */
const STILL_EPSILON_PX = 0.5;
const FOLLOW_MAX_MS = 2000;
const TOP_LIMIT = 76;
/** Fallback z-index for the margin-note layer (drawer + 1). */
const DEFAULT_LAYER_Z = 31;
const LABEL_TEXT = 20;
const NOTE_TILT = 5;
const TAPE_TILT = 10;
/** A highlight counts as visible when this far inside the scroll area. */
const VIEW_EDGE = 8;
const ROOM_MARGIN = 16;
/** Notes sit a little above their line and keep this gap between them. */
const NOTE_LIFT = 18;
const NOTE_SPACING = 16;
const STAGGER = 90;
const NOTE_DELAY = 380;
/** Margin ring: px from the drawer's left edge, and height within the line. */
const RING_X = 13;
const RING_Y = 0.55;
/** Arrow tip: gap right of the note, px below the note's top. */
const ARROW_GAP = 6;
const ARROW_Y = 26;

/** Shape of the pencil leader line (values from the prototype). */
const LEADER = {
  jitter: 12,
  curveStart: 0.35,
  curveEnd: 0.72,
  tail: 9,
  ghostY: 1.2,
  ghostC1: 2,
  ghostC2y: 1.5,
  lengthSlack: 1.3,
  ghostDelay: 80,
  mainDelay: 60,
  headDelay: 520,
  headLength: 20,
  ring: 8.5,
  textDy: 0.5,
  centre: 0.5,
} as const;

type ItemState = "approved" | "own" | "review";

type Item = {
  id: string;
  exact: string;
  prefix: string;
  name: string;
  body: string;
  createdAt: number;
  /** Not public yet: the visitor's own (审核中) or, for the owner, 待审. */
  pending: boolean;
  state: ItemState;
  /** Owner only (待审 items): fingerprint / GitHub line and saved reply. */
  who: string;
  reply: string;
};

type Group = {
  exact: string;
  prefix: string;
  items: Item[];
  marks: HTMLElement[];
  /** 1-based, in document order; 0 when the text was not found. */
  no: number;
};

type Selected = { exact: string; prefix: string; rect: DOMRect };

type Source = PublicComment | PendingComment;

const itemOf = (c: Source, state: ItemState, who = ""): Item => ({
  id: c.id,
  exact: c.anchor?.exact ?? "",
  prefix: c.anchor?.prefix ?? "",
  name: c.name,
  body: c.body,
  createdAt: c.createdAt,
  pending: state !== "approved",
  state,
  who,
  reply: ("reply" in c && c.reply?.body) || "",
});

/** Approved, then (owner) 待审, then the visitor's own; each id once. */
const itemsOf = (thread: Thread, review: ReviewView): Item[] => {
  const seen = new Set<string>();
  const items: Item[] = [];
  const add = (c: Source, state: ItemState, who = "") => {
    if (c.kind === "inline" && c.anchor && !seen.has(c.id) && !isThrown(c.id)) {
      seen.add(c.id);
      items.push(itemOf(c, state, who));
    }
  };
  for (const c of thread.approved) {
    add(c, "approved");
  }
  for (const c of review.on ? review.pending : []) {
    add(c, "review", whoHtml(c));
  }
  for (const c of thread.pending) {
    add(c, "own");
  }
  return items;
};

const STATE_LABEL: Record<ItemState, string> = {
  approved: "",
  own: " · 审核中",
  review: " · 待审",
};

/** The owner can throw it into the trash: 待审 → 拒绝, approved → 撤下. */
const throwable = (item: Item, review: ReviewView) =>
  review.on && (item.state === "review" || item.state === "approved");

/** Focusable, Delete / Backspace, picked up by comment-drag.ts. */
const throwAttrs = (item: Item, review: ReviewView, key: string) =>
  throwable(item, review)
    ? ` tabindex="0" data-throw="${esc(item.id)}" data-key="${esc(item.id)}:${key}" aria-keyshortcuts="Delete Backspace"`
    : "";

const STATE_TAG: Record<ItemState, string> = {
  approved: "",
  own: '<span class="tag">审核中</span>',
  review: '<span class="tag rv-tag">待审</span>',
};

/** What is missing before an inline comment can be sent ("" = nothing). */
const inlineProblem = ({
  member,
  name,
  body,
  token,
}: {
  member: boolean;
  name: string;
  body: string;
  token: string;
}) => {
  if (!(member || name)) {
    return "写一下昵称吧。";
  }
  if (!body) {
    return "内容还是空的。";
  }
  if (!(member || token)) {
    return "人机验证还没完成，稍等一下。";
  }
  return "";
};

const truncate = (text: string, max: number) => {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
};

const textNodesOf = (block: Element) => {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (text) =>
      text.parentElement?.closest(SKIP_TEXT)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
};

const unwrap = (mark: Element) => {
  const parent = mark.parentNode;
  mark.replaceWith(...mark.childNodes);
  parent?.normalize();
};

const scrollParent = (el: HTMLElement) => {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") {
      return node;
    }
    node = node.parentElement;
  }
  return document.documentElement;
};

/* ---------- leader lines ---------- */

const arrowHead = (ex: number, ey: number, fromX: number, fromY: number) => {
  const angle = Math.atan2(ey - fromY, ex - fromX);
  const length = 7;
  const spread = 0.45;
  const p1 = [
    ex - length * Math.cos(angle - spread),
    ey - length * Math.sin(angle - spread),
  ];
  const p2 = [
    ex - length * Math.cos(angle + spread),
    ey - length * Math.sin(angle + spread),
  ];
  return `M${p1[0]} ${p1[1]} L${ex} ${ey} L${p2[0]} ${p2[1]}`;
};

type Leader = {
  key: string;
  no: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
};

/** Double pencil stroke from the margin ring to the note, plus arrowhead. */
const leaderSvg = (leader: Leader, index: number, animate: boolean) => {
  const { key, no, sx, sy, ex, ey } = leader;
  const dx = ex - sx;
  const jitter = (k: string) =>
    (seeded(`${key}${k}`) - LEADER.centre) * LEADER.jitter;
  const c1 = [sx + dx * LEADER.curveStart + jitter("1"), sy + jitter("2")];
  const c2 = [sx + dx * LEADER.curveEnd + jitter("3"), ey + jitter("4")];
  const main = `M${sx - LEADER.tail} ${sy} C${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${ex} ${ey}`;
  const ghost = `M${sx - LEADER.tail} ${sy + LEADER.ghostY} C${(c1[0] ?? 0) + LEADER.ghostC1} ${(c1[1] ?? 0) + LEADER.ghostC1}, ${(c2[0] ?? 0) + 1} ${(c2[1] ?? 0) - LEADER.ghostC2y}, ${ex + 1} ${ey + LEADER.ghostC2y}`;
  const length = Math.ceil(Math.hypot(ex - sx, ey - sy) * LEADER.lengthSlack);
  const cls = animate ? "draw" : "";
  return `<g data-ann="${esc(key)}">
    <path class="ghost ${cls}" d="${ghost}" style="--len: ${length}; --d: ${index * STAGGER + LEADER.ghostDelay}ms"></path>
    <path class="main ${cls}" d="${main}" style="--len: ${length}; --d: ${index * STAGGER + LEADER.mainDelay}ms"></path>
    <path class="head ${cls}" d="${arrowHead(ex, ey, c2[0] ?? sx, c2[1] ?? sy)}" style="--len: ${LEADER.headLength}; --d: ${index * STAGGER + LEADER.headDelay}ms"></path>
    <circle class="ring" cx="${sx}" cy="${sy}" r="${LEADER.ring}"></circle>
    <text x="${sx}" y="${sy + LEADER.textDy}">${no}</text>
  </g>`;
};

/* ---------- one bound article ---------- */

class InlineSession {
  readonly slug: string;
  readonly bodyEl: HTMLElement;
  readonly drawerEl: HTMLElement;
  readonly scrollEl: HTMLElement;
  groups = new Map<string, Group>();
  readonly layer: HTMLElement;
  readonly svg: SVGSVGElement;
  readonly notes = new Map<string, HTMLElement>();
  pop: HTMLElement | null = null;
  popTurnstile: TurnstileHandle | null = null;
  /** Prefix of the text the open popover's form comments on. */
  popPrefix = "";
  /** The owner's review lists (off for visitors). */
  review: ReviewView = reviewNow("");
  /** The `?review=` comment shown in the popover (for 下一条待审). */
  targetId = "";
  popReturnFocus: HTMLElement | null = null;
  button: HTMLButtonElement | null = null;
  selected: Selected | null = null;
  animateNext = false;
  raf = 0;
  /** Separate handle so a one-off schedule() never cancels an ongoing follow(). */
  followRaf = 0;
  selectionTimer = 0;
  readonly cleanups: (() => void)[] = [];

  constructor(detail: {
    slug: string;
    bodyEl: HTMLElement;
    drawerEl: HTMLElement;
    scrollEl: HTMLElement;
  }) {
    this.slug = detail.slug;
    this.bodyEl = detail.bodyEl;
    this.drawerEl = detail.drawerEl;
    this.scrollEl = detail.scrollEl;
    this.layer = document.createElement("div");
    this.layer.className = "ann-layer";
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("aria-hidden", "true");
    this.layer.appendChild(this.svg);
    const z = Number.parseInt(getComputedStyle(this.drawerEl).zIndex, 10);
    this.layer.style.zIndex = String(Number.isNaN(z) ? DEFAULT_LAYER_Z : z + 1);
    document.body.appendChild(this.layer);
    this.listen();
    this.cleanups.push(subscribe(this.slug, () => this.update()));
    this.cleanups.push(watchReview(this.slug, (view) => this.onReview(view)));
    this.cleanups.push(subscribeAuth(() => this.refreshPopForm()));
    this.cleanups.push(
      watchThrows({
        slug: this.slug,
        root: this.layer,
        anywhere: true,
        cardOf: (target) =>
          target.closest<HTMLElement>(".ann-note[data-throw]"),
        findCard: (id) =>
          this.layer.querySelector<HTMLElement>(
            `.ann-note[data-throw="${CSS.escape(id)}"]`
          ),
        focusKeys: (keys) => this.focusAfterThrow(keys),
      })
    );
    this.cleanups.push(
      watchThrows({
        slug: this.slug,
        root: this.bodyEl,
        ghostClass: "is-row",
        cardOf: (target) =>
          target.closest<HTMLElement>(".ann-pop li[data-throw]"),
        findCard: (id) =>
          this.pop?.querySelector<HTMLElement>(
            `li[data-throw="${CSS.escape(id)}"]`
          ) ?? null,
        focusKeys: (keys) => this.focusAfterThrow(keys),
      })
    );
    loadThread(this.slug);
    this.follow();
  }

  on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document | Window,
    type: K | string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions
  ) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() =>
      target.removeEventListener(type, handler, options)
    );
  }

  listen() {
    this.on(document, "selectionchange", () => {
      window.clearTimeout(this.selectionTimer);
      this.selectionTimer = window.setTimeout(
        () => this.captureSelection(),
        SELECTION_DELAY
      );
    });
    this.on(this.bodyEl, "click", (event) => this.onBodyClick(event));
    this.on(this.bodyEl, "keydown", (event) =>
      this.onBodyKey(event as KeyboardEvent)
    );
    this.on(this.bodyEl, "pointerover", (event) =>
      this.hoverFrom(event, "mark.ann", true)
    );
    this.on(this.bodyEl, "pointerout", (event) =>
      this.hoverFrom(event, "mark.ann", false)
    );
    this.on(this.layer, "pointerover", (event) =>
      this.hoverFrom(event, ".ann-note", true)
    );
    this.on(this.layer, "pointerout", (event) =>
      this.hoverFrom(event, ".ann-note", false)
    );
    this.on(this.layer, "click", (event) => this.onNoteClick(event));
    this.on(this.layer, "keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        this.onNoteClick(event);
      }
    });
    this.on(document, "keydown", (event) => {
      // Esc while writing a reply in the review bar keeps the popover open.
      const inReply =
        event.target instanceof Element && event.target.closest(".rv-draft");
      if ((event as KeyboardEvent).key === "Escape" && this.pop && !inReply) {
        this.closePop(true);
      }
    });
    this.on(
      this.scrollEl === document.documentElement ? window : this.scrollEl,
      "scroll",
      () => this.schedule(),
      { passive: true }
    );
    this.on(window, "resize", () => this.schedule());
    this.on(window, REVIEW_FOCUS, (event) => this.onReviewFocus(event));
    this.on(window, JUMP_EVENT, (event) => {
      const detail = (event as CustomEvent<JumpDetail>).detail;
      if (detail.slug === this.slug) {
        this.jumpTo(detail.exact);
      }
    });
    // The drawer slides with a CSS transition/animation; settle on its end.
    this.on(this.drawerEl, "transitionend", () => this.follow(0));
    this.on(this.drawerEl, "animationend", () => this.follow(0));
    this.on(document, "astro:page-load", () => this.follow());
    const resize = new ResizeObserver(() => this.schedule());
    resize.observe(this.bodyEl);
    this.cleanups.push(() => resize.disconnect());
  }

  destroy() {
    window.cancelAnimationFrame(this.raf);
    window.cancelAnimationFrame(this.followRaf);
    window.clearTimeout(this.selectionTimer);
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.closePop(false);
    this.hideButton();
    this.clearMarks();
    this.layer.remove();
    document.body.classList.remove("has-notes");
  }

  /* ----- data → marks → notes ----- */

  /** Only a review bar or 下一条 changed: just the popover; else everything. */
  onReview(view: ReviewView) {
    const before = this.review;
    this.review = view;
    const same =
      before.on === view.on &&
      before.pending === view.pending &&
      before.hidden === view.hidden &&
      before.thrown === view.thrown;
    if (same) {
      this.refreshPop();
    } else {
      this.update();
    }
  }

  update() {
    const popExact = this.pop?.dataset.ann;
    const hadGroup = popExact !== undefined && this.groups.has(popExact);
    const groups = new Map<string, Group>();
    for (const item of itemsOf(threadNow(this.slug), this.review)) {
      const group = groups.get(item.exact) ?? {
        exact: item.exact,
        prefix: item.prefix,
        items: [],
        marks: [],
        no: 0,
      };
      group.items.push(item);
      groups.set(item.exact, group);
    }
    this.groups = groups;
    this.applyMarks();
    this.buildNotes();
    this.layout();
    this.refreshPop();
    // Its last comment went into the trash: nothing left to show.
    if (
      hadGroup &&
      popExact !== undefined &&
      !this.groups.has(popExact) &&
      !this.pop?.querySelector("form")
    ) {
      this.closePop(this.pop?.contains(document.activeElement) === true);
    }
  }

  /** After a thrown comment was sent: focus back in the popover, if open. */
  focusAfterThrow(keys: string[]) {
    const pop = this.pop;
    if (pop && !focusKey(pop, keys)) {
      pop
        .querySelector<HTMLElement>(".more, .x")
        ?.focus({ preventScroll: true });
    }
  }

  clearMarks() {
    for (const mark of this.bodyEl.querySelectorAll("mark.ann")) {
      unwrap(mark);
    }
    for (const count of this.bodyEl.querySelectorAll(".ann-n")) {
      count.remove();
    }
  }

  findParts(group: Group) {
    for (const block of this.bodyEl.querySelectorAll(BLOCKS)) {
      if (block.closest(EXCLUDED)) {
        continue;
      }
      const nodes = textNodesOf(block);
      const parts = locateAnchor(
        nodes.map((node) => node.data),
        group.exact,
        group.prefix
      );
      if (parts) {
        return parts.map((part) => ({ ...part, node: nodes[part.index] }));
      }
    }
    return null;
  }

  markGroup(group: Group) {
    const parts = this.findParts(group);
    const pendingOnly = group.items.every((item) => item.pending);
    for (const part of parts ?? []) {
      if (!part.node) {
        continue;
      }
      const range = document.createRange();
      range.setStart(part.node, part.start);
      range.setEnd(part.node, part.end);
      const mark = document.createElement("mark");
      mark.className = pendingOnly ? "ann pending" : "ann";
      mark.dataset.ann = group.exact;
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute(
        "aria-label",
        `${group.items.length} 条划线评论：${truncate(group.exact, LABEL_TEXT)}`
      );
      range.surroundContents(mark);
      group.marks.push(mark);
    }
    const last = group.marks.at(-1);
    if (last) {
      const count = document.createElement("span");
      count.className = "ann-n";
      count.dataset.ann = group.exact;
      count.setAttribute("aria-hidden", "true");
      count.textContent = String(group.items.length);
      last.insertAdjacentElement("afterend", count);
    }
  }

  applyMarks() {
    this.clearMarks();
    for (const group of this.groups.values()) {
      this.markGroup(group);
    }
    const placed = [...this.groups.values()].filter(
      (group) => group.marks.length > 0
    );
    // Number the highlights in reading order.
    const order = [...this.bodyEl.querySelectorAll("mark.ann")];
    const position = (group: Group) =>
      group.marks[0] ? order.indexOf(group.marks[0]) : -1;
    placed.sort((a, b) => position(a) - position(b));
    for (const [index, group] of placed.entries()) {
      group.no = index + 1;
    }
  }

  /** One comment only: the note stands for it and can be thrown away. */
  markThrowable(note: HTMLElement, group: Group) {
    const [only] = group.items;
    if (!(only && group.items.length === 1 && throwable(only, this.review))) {
      return;
    }
    const verb = throwVerb(only.state === "review" ? "review" : "approved");
    note.dataset.throw = only.id;
    note.classList.add("is-throwable");
    note.setAttribute("aria-keyshortcuts", "Delete Backspace");
    note.setAttribute(
      "aria-label",
      `查看第 ${group.no} 处划线评论（拖进垃圾桶或按 Delete 即${verb}）`
    );
  }

  buildNotes() {
    for (const note of this.notes.values()) {
      note.remove();
    }
    this.notes.clear();
    for (const group of this.groups.values()) {
      if (group.no === 0) {
        continue;
      }
      const [first] = group.items;
      if (!first) {
        continue;
      }
      const pendingOnly = group.items.every((item) => item.pending);
      const note = document.createElement("div");
      note.className = `ann-note sticky-paper${pendingOnly ? " pending" : ""}`;
      note.dataset.ann = group.exact;
      note.tabIndex = 0;
      note.setAttribute("role", "button");
      note.setAttribute("aria-label", `查看第 ${group.no} 处划线评论`);
      this.markThrowable(note, group);
      note.style.setProperty("--r", `${rot(group.exact, NOTE_TILT)}deg`);
      note.style.setProperty("--tr", `${rot(`${group.exact}r`, TAPE_TILT)}deg`);
      note.hidden = true;
      const more =
        group.items.length > 1
          ? `<span class="more-n">还有 ${group.items.length - 1} 条 →</span>`
          : "";
      note.innerHTML = `<img class="note-tape" src="${tapeSrc(pick(TAPES, `${group.exact}t`) ?? "masking-cream")}" alt="" /><span class="no">${group.no}</span><b>${esc(first.name)}${STATE_LABEL[first.state]}</b>${esc(truncate(first.body, NOTE_TEXT))}${more}`;
      this.layer.appendChild(note);
      this.notes.set(group.exact, note);
    }
  }

  /* ----- margin notes layout ----- */

  schedule() {
    window.cancelAnimationFrame(this.raf);
    this.raf = window.requestAnimationFrame(() => this.layout());
  }

  /**
   * Re-layout every frame while the drawer slides in or switches notes: at
   * least `ms`, then until the drawer has stopped moving for a few frames
   * (its slide can outlast `ms`, e.g. after a client-side navigation), capped
   * at FOLLOW_MAX_MS.
   */
  follow(ms = FOLLOW_MS) {
    const start = performance.now();
    let lastLeft = Number.NaN;
    let still = 0;
    const tick = (now: number) => {
      this.layout();
      const left = this.drawerEl.getBoundingClientRect().left;
      still = Math.abs(left - lastLeft) < STILL_EPSILON_PX ? still + 1 : 0;
      lastLeft = left;
      const settled = now - start >= ms && still >= STILL_FRAMES;
      if (!settled && now - start < FOLLOW_MAX_MS) {
        this.followRaf = window.requestAnimationFrame(tick);
      }
    };
    window.cancelAnimationFrame(this.followRaf);
    this.followRaf = window.requestAnimationFrame(tick);
  }

  visibleRows() {
    const view =
      this.scrollEl === document.documentElement
        ? { top: 0, bottom: window.innerHeight }
        : this.scrollEl.getBoundingClientRect();
    const rows: { group: Group; rect: DOMRect }[] = [];
    for (const group of this.groups.values()) {
      const rect = group.marks[0]?.getClientRects()[0];
      if (
        rect &&
        rect.bottom >= view.top + VIEW_EDGE &&
        rect.top <= view.bottom - VIEW_EDGE
      ) {
        rows.push({ group, rect });
      }
    }
    return rows.sort((a, b) => a.rect.top - b.rect.top);
  }

  layout() {
    const drawer = this.drawerEl.getBoundingClientRect();
    const visible =
      drawer.width > 0 &&
      getComputedStyle(this.drawerEl).visibility !== "hidden";
    const on =
      visible && drawer.left - ROOM_MARGIN >= MIN_ROOM && this.notes.size > 0;
    document.body.classList.toggle("has-notes", on);
    this.layer.hidden = !on;
    if (!on) {
      return;
    }
    const x = drawer.left - NOTE_W - NOTE_GAP;
    const shown = new Set<string>();
    const leaders: string[] = [];
    let floor = Number.NEGATIVE_INFINITY;
    for (const [index, { group, rect }] of this.visibleRows().entries()) {
      const note = this.notes.get(group.exact);
      if (!note) {
        continue;
      }
      const y = Math.max(rect.top - NOTE_LIFT, floor + NOTE_SPACING, TOP_LIMIT);
      note.hidden = false;
      note.style.left = `${x}px`;
      note.style.top = `${y}px`;
      if (this.animateNext) {
        note.classList.add("pop-in");
        note.style.setProperty("--d", `${index * STAGGER + NOTE_DELAY}ms`);
      }
      shown.add(group.exact);
      leaders.push(
        leaderSvg(
          {
            key: group.exact,
            no: group.no,
            sx: drawer.left + RING_X,
            sy: rect.top + rect.height * RING_Y,
            ex: x + NOTE_W + ARROW_GAP,
            ey: y + ARROW_Y,
          },
          index,
          this.animateNext
        )
      );
      floor = y + note.offsetHeight;
    }
    for (const [key, note] of this.notes) {
      note.hidden = !shown.has(key);
    }
    this.svg.innerHTML = leaders.join("");
    this.animateNext = false;
  }

  hoverFrom(event: Event, selector: string, on: boolean) {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(selector)
        : null;
    const related = (event as PointerEvent).relatedTarget;
    if (
      !target ||
      (!on && related instanceof Node && target.contains(related))
    ) {
      return;
    }
    const key = target.dataset.ann;
    for (const el of [
      ...this.bodyEl.querySelectorAll<HTMLElement>("mark.ann"),
      ...this.layer.querySelectorAll<HTMLElement>("[data-ann]"),
    ]) {
      if (el.dataset.ann === key) {
        el.classList.toggle("hot", on);
      }
    }
  }

  /* ----- selection → button ----- */

  hideButton() {
    this.button?.remove();
    this.button = null;
  }

  readSelection(): Selected | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return null;
    }
    const range = selection.getRangeAt(0);
    const blockOf = (node: Node) =>
      (node instanceof Element ? node : node.parentElement)?.closest(BLOCKS);
    const block = blockOf(range.startContainer);
    if (
      !block ||
      block !== blockOf(range.endContainer) ||
      !this.bodyEl.contains(block) ||
      block.closest(EXCLUDED)
    ) {
      return null;
    }
    const exact = collapseSpace(selection.toString()).trim();
    const length = [...exact].length;
    if (length < EXACT_MIN || length > EXACT_MAX) {
      return null;
    }
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    return {
      exact,
      prefix: prefixOf(before.toString()),
      rect: range.getBoundingClientRect(),
    };
  }

  captureSelection() {
    const selected = this.readSelection();
    if (!selected) {
      this.hideButton();
      return;
    }
    this.selected = selected;
    if (!this.button) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ann-btn";
      button.textContent = "✎ 划线评论";
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const chosen = this.selected;
        window.getSelection()?.removeAllRanges();
        this.hideButton();
        if (chosen) {
          this.openPop(chosen.exact, {
            fresh: true,
            prefix: chosen.prefix,
            rect: chosen.rect,
          });
        }
      });
      this.bodyEl.appendChild(button);
      this.button = button;
    }
    const base = this.bodyEl.getBoundingClientRect();
    this.button.style.left = `${selected.rect.left - base.left + selected.rect.width / 2}px`;
    this.button.style.top = `${selected.rect.bottom - base.top + 10}px`;
  }

  /* ----- popover ----- */

  closePop(restoreFocus: boolean) {
    this.popTurnstile?.remove();
    this.popTurnstile = null;
    this.pop?.remove();
    this.pop = null;
    for (const mark of this.bodyEl.querySelectorAll("mark.ann.on")) {
      mark.classList.remove("on");
    }
    if (restoreFocus) {
      this.popReturnFocus?.focus({ preventScroll: true });
    }
    this.popReturnFocus = null;
  }

  /** Owner only, under a 待审 item: who wrote it, saved reply, review bar. */
  reviewHtml(item: Item) {
    if (!this.review.on) {
      return "";
    }
    if (item.state === "approved") {
      return throwHintHtml(item.id);
    }
    if (item.state !== "review") {
      return "";
    }
    const reply = item.reply
      ? `<p class="ann-reply">Sonui 回复：${esc(item.reply)}</p>`
      : "";
    return `${item.who}${reply}${reviewBarHtml(item.id, barOf(item.id))}`;
  }

  itemsHtml(exact: string) {
    const items = this.groups.get(exact)?.items ?? [];
    const denied = this.review.denied
      ? `<p class="rv-msg" role="status">${DENIED_TEXT}</p>`
      : "";
    const next =
      this.review.next && this.review.next.id === this.targetId
        ? nextHtml(this.review.next)
        : "";
    if (items.length === 0) {
      return `${denied}${next}`;
    }
    const rows = items.map((item) => {
      const canThrow = throwable(item, this.review);
      const cls = [
        item.state === "review" ? "rv-item" : "",
        item.id === this.targetId ? "rv-target" : "",
        canThrow ? "is-throwable" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const described = canThrow
        ? ` aria-describedby="${throwHintId(item.id)}"`
        : "";
      return `<li${cls ? ` class="${cls}"` : ""} data-item="${esc(item.id)}"${throwAttrs(item, this.review, "row")}${described}><b>${esc(item.name)} · ${dotDate(item.createdAt)}</b><span class="ann-body">${esc(item.body)}</span>${STATE_TAG[item.state]}${this.reviewHtml(item)}</li>`;
    });
    return `${denied}<ol class="ann-items">${rows.join("")}</ol>${next}`;
  }

  refreshPop() {
    const pop = this.pop;
    const exact = pop?.dataset.ann;
    const list = pop?.querySelector<HTMLElement>("[data-ann-items]");
    if (!(pop && list && exact !== undefined)) {
      return;
    }
    keepFocus(pop, () => {
      list.innerHTML = this.itemsHtml(exact);
    });
  }

  /** A `?review=c:<id>` link to a 待审 highlight comment (from comments.ts). */
  onReviewFocus(event: Event) {
    const { slug, id } = (event as CustomEvent<ReviewFocusDetail>).detail;
    if (slug !== this.slug) {
      return;
    }
    const group = [...this.groups.values()].find(
      (entry) =>
        entry.marks.length > 0 && entry.items.some((item) => item.id === id)
    );
    if (!group) {
      return;
    }
    event.preventDefault();
    this.targetId = id;
    this.jumpTo(group.exact);
    const row = this.pop?.querySelector<HTMLElement>(
      `[data-item="${CSS.escape(id)}"]`
    );
    if (row) {
      pulse(row);
    }
    this.pop
      ?.querySelector<HTMLElement>(
        `[data-key="${CSS.escape(`${id}:approve`)}"]`
      )
      ?.focus({ preventScroll: true });
  }

  /**
   * Logged in with GitHub: no name field and no Turnstile. The login state
   * is fetched when the page loads, long before a popover opens; when it
   * changes (退出), refreshPopForm() swaps the form.
   */
  formHtml() {
    const auth = authNow();
    const bar = auth
      ? authBarHtml(auth, { next: currentPath("#comments"), verb: "留言" })
      : "";
    const body = `<textarea name="body" maxlength="${INLINE_BODY_MAX}" placeholder="对这段话说点什么……" aria-label="划线评论内容"></textarea>`;
    const error = '<p class="cmt-error" role="alert" hidden></p>';
    if (auth?.user) {
      return `<form novalidate data-member>
      ${bar}
      ${body}
      <div class="row">${SKIP_TURNSTILE_HTML}<button type="submit" class="stamp-btn">贴上</button></div>
      ${error}
    </form>`;
    }
    const name = readProfile().name ?? "";
    return `<form novalidate>
      ${bar}
      <input name="name" maxlength="24" placeholder="昵称" autocomplete="nickname" aria-label="昵称" value="${esc(name)}" />
      ${body}
      <div class="row">${turnstileMarkup("inline")}<button type="submit" class="stamp-btn">贴上</button></div>
      ${error}
    </form>`;
  }

  openPop(
    exact: string,
    options: { fresh?: boolean; prefix?: string; rect?: DOMRect } = {}
  ) {
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    this.closePop(false);
    this.hideButton();
    this.popReturnFocus = returnFocus;
    const group = this.groups.get(exact);
    const pop = document.createElement("div");
    pop.className = "ann-pop sticky-paper";
    pop.dataset.ann = exact;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "划线评论");
    pop.innerHTML = `<img class="note-tape" src="${tapeSrc("washi-grid-ivory")}" alt="" />
      <button type="button" class="x" aria-label="关闭">×</button>
      <p class="ann-quote">${esc(truncate(exact, QUOTE_TEXT))}</p>
      <div data-ann-items>${this.itemsHtml(exact)}</div>
      ${options.fresh ? this.formHtml() : '<button type="button" class="more">✎ 我也说两句</button>'}`;
    this.bodyEl.appendChild(pop);
    this.pop = pop;
    for (const mark of group?.marks ?? []) {
      mark.classList.add("on");
    }
    const rect = group?.marks.at(-1)?.getBoundingClientRect() ?? options.rect;
    if (rect) {
      this.placeBelow(pop, rect);
    }
    const prefix = group?.prefix ?? options.prefix ?? "";
    pop
      .querySelector(".x")
      ?.addEventListener("click", () => this.closePop(true));
    pop.addEventListener("click", (event) =>
      onReviewClick(this.slug, pop, event, ".more, .x")
    );
    pop.addEventListener("input", onReviewInput);
    const more = pop.querySelector<HTMLButtonElement>(".more");
    more?.addEventListener("click", () => {
      more.outerHTML = this.formHtml();
      this.wireForm(exact, prefix);
    });
    if (options.fresh) {
      this.wireForm(exact, prefix);
    } else {
      pop
        .querySelector<HTMLElement>(".more, .x")
        ?.focus({ preventScroll: true });
    }
  }

  placeBelow(el: HTMLElement, rect: DOMRect) {
    const base = this.bodyEl.getBoundingClientRect();
    const width = el.offsetWidth;
    const left = Math.min(
      Math.max(10, rect.left - base.left + rect.width / 2 - width / 2),
      this.bodyEl.clientWidth - width - 10
    );
    el.style.left = `${Math.max(0, left)}px`;
    el.style.top = `${rect.bottom - base.top + 10}px`;
  }

  /** The login state changed while the popover's form is open. */
  refreshPopForm() {
    const form = this.pop?.querySelector("form");
    const exact = this.pop?.dataset.ann;
    if (!(form && exact !== undefined)) {
      return;
    }
    const member = form.dataset.member !== undefined;
    if (member === Boolean(authNow()?.user) && form.dataset.auth === "known") {
      return;
    }
    const typed = form.querySelector("textarea")?.value ?? "";
    this.popTurnstile?.remove();
    this.popTurnstile = null;
    form.outerHTML = this.formHtml();
    const textarea = this.pop?.querySelector("textarea");
    if (textarea) {
      textarea.value = typed;
    }
    this.wireForm(exact, this.popPrefix);
  }

  wireForm(exact: string, prefix: string) {
    const form = this.pop?.querySelector("form");
    if (!form) {
      return;
    }
    this.popPrefix = prefix;
    if (authNow()) {
      form.dataset.auth = "known";
    }
    bindLogout(form);
    const wrap = form.querySelector<HTMLElement>("[data-turnstile]");
    const turnstile = wrap ? mountTurnstile(wrap) : null;
    this.popTurnstile = turnstile;
    form.querySelector("textarea")?.focus({ preventScroll: true });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.send(form, turnstile, exact, prefix);
    });
  }

  async send(
    form: HTMLFormElement,
    turnstile: TurnstileHandle | null,
    exact: string,
    prefix: string
  ) {
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const body = String(data.get("body") ?? "").trim();
    const error = form.querySelector<HTMLElement>(".cmt-error");
    const say = (message: string) => {
      if (error) {
        error.textContent = message;
        error.hidden = !message;
      }
    };
    const auth = form.dataset.member === undefined ? null : await getAuth();
    const user = auth?.user ?? null;
    const member = Boolean(user);
    const token = turnstile?.token() ?? "";
    const problem = inlineProblem({ member, name, body, token });
    say(problem);
    if (problem) {
      return;
    }
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    );
    if (submit) {
      submit.disabled = true;
    }
    const common = {
      slug: this.slug,
      kind: "inline" as const,
      body,
      anchor: { exact, prefix },
    };
    const result = await submitComment(
      member ? common : { ...common, name, turnstile: token },
      { user, isOwner: auth?.isOwner ?? false }
    );
    if (submit) {
      submit.disabled = false;
    }
    turnstile?.reset();
    if (!result.ok) {
      say(result.message);
      return;
    }
    if (!member) {
      saveProfile({ ...readProfile(), name });
    }
    announce(sentMessage(result.data.status));
    this.animateNext = !reduceMotion();
    this.openPop(exact);
    this.layout();
  }

  /* ----- clicks ----- */

  onBodyClick(event: Event) {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("mark.ann, .ann-n")
        : null;
    if (target?.dataset.ann) {
      event.preventDefault();
      this.openPop(target.dataset.ann);
    }
  }

  onBodyKey(event: KeyboardEvent) {
    const mark =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("mark.ann")
        : null;
    if (mark?.dataset.ann && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this.openPop(mark.dataset.ann);
    }
  }

  onNoteClick(event: Event) {
    const note =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(".ann-note")
        : null;
    if (note?.dataset.ann) {
      this.jumpTo(note.dataset.ann, "nearest");
    }
  }

  jumpTo(exact: string, block: ScrollLogicalPosition = "center") {
    const mark = this.groups.get(exact)?.marks[0];
    if (!mark) {
      return;
    }
    mark.scrollIntoView({ block, behavior: scrollBehavior() });
    this.openPop(exact);
  }
}

/* ---------- binding to the drawer ---------- */

let session: InlineSession | null = null;

const unbind = () => {
  session?.destroy();
  session = null;
};

const bind = (detail: {
  slug: string;
  bodyEl: HTMLElement;
  drawerEl: HTMLElement;
  scrollEl: HTMLElement;
}) => {
  if (
    session &&
    session.bodyEl === detail.bodyEl &&
    session.drawerEl === detail.drawerEl &&
    session.scrollEl === detail.scrollEl
  ) {
    return;
  }
  unbind();
  if (detail.slug && detail.bodyEl.isConnected) {
    session = new InlineSession(detail);
  }
};

/** Without a `drawer:rendered` event (e.g. before the canvas is ready), find the article ourselves. */
const discover = () => {
  const host = document.querySelector<HTMLElement>("[data-inline-comments]");
  const bodyEl = document.querySelector<HTMLElement>("[data-post-body]");
  if (!(host && bodyEl)) {
    unbind();
    return;
  }
  if (session?.bodyEl === bodyEl) {
    return;
  }
  const drawerEl =
    bodyEl.closest<HTMLElement>("[data-drawer], .drawer, aside") ??
    bodyEl.parentElement ??
    bodyEl;
  bind({
    slug: host.dataset.slug ?? bodyEl.dataset.slug ?? "",
    bodyEl,
    drawerEl,
    scrollEl: scrollParent(bodyEl),
  });
};

onDrawerRendered((detail: DrawerRenderedDetail) => bind(detail));
onDrawerClose(unbind);
document.addEventListener("astro:before-swap", unbind);
document.addEventListener("astro:page-load", () =>
  window.requestAnimationFrame(discover)
);
window.requestAnimationFrame(discover);
