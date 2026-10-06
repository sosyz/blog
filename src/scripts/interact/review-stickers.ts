/**
 * Reviewing visitor stickers where they sit on the canvas (owner only).
 *
 * Nothing here runs for visitors: it waits for `canModerate()` (owner.ts),
 * which only asks the server in a browser that opened /admin/ or arrived
 * through a review link, and only goes on with a Cloudflare Access session.
 *
 * - Every pending sticker (GET /api/admin/stickers) is shown on the canvas,
 *   dashed with 待审 (stickers.ts). Selecting one floats a small sticky note
 *   next to it with 通过, the signature, upload time and fingerprint, and
 *   「不要就拖进垃圾桶（或按 Delete）」: there is no 拒绝 / 撤下 button.
 * - 拒绝 is dragging the sticker into the trash (sticker-edit.ts,
 *   sticker-trash.ts), or Delete / Backspace on the selected sticker: no
 *   confirmation, 已扔掉 · 撤销 for a few seconds, then POST
 *   /api/admin/decide reject (the image is deleted for good). In 整理贴纸
 *   the same takes approved stickers down (撤下). This module registers that
 *   admin remover.
 * - A review link /?review=s:<id> (built by /admin/) glides the camera to the
 *   sticker (jumps with reduced motion), selects it and focuses 通过 (an
 *   approved one: the sticker itself, ready for Delete). After deciding,
 *   the note (or the toast, after 拒绝) links to the next pending item (a
 *   full page load of `next.href`) or says 都审完了.
 * - The toolbar shows 待审 N (pending comments + stickers), linking to /admin/.
 * - Decisions update the layer in place. 401 / 403 (or an Access redirect):
 *   the review tools go away and the toolbar says to log in at /admin/.
 */
import type {
  AdminSticker,
  AdminStickersResponse,
  DecideResponse,
  ReviewLink,
} from "@/lib/server/types";
import {
  CANVAS_READY,
  type CanvasApi,
  type Point,
  whenCanvasReady,
} from "@/scripts/canvas/api";
import { STICKERS_RENDERED } from "./events";
import { canModerate, resetModerate, reviewTarget } from "./owner";
import {
  deselectSticker,
  onSelectionChange,
  recheckOwner,
  selectSticker,
} from "./sticker-edit";
import {
  badgeCount,
  cardSide,
  decidedText,
  isAuthLost,
  type QueueSummary,
  reviewCamera,
  reviewTime,
  shortFingerprint,
} from "./sticker-review";
import { type Remover, setAdminRemover } from "./sticker-trash";
import {
  findShown,
  markApproved,
  setReviewFocus,
  setReviewPending,
  whenStickersLoaded,
} from "./stickers";
import { esc } from "./util";

/** Screen px between the sticker and its review note. */
const CARD_GAP = 16;

const NEED_LOGIN =
  '需要先在 <a href="/admin/" data-astro-reload>/admin/</a> 登录';
const NOT_FOUND =
  '这张贴纸不在待审里了，可能已经处理过。<a href="/admin/" data-astro-reload>回后台</a>';

interface ReviewState {
  busy: boolean;
  el: HTMLElement;
  error: string;
  id: string;
  mode: "review";
}

interface DoneState {
  /** World px of the note's anchor, and which side of it the note is on. */
  at: Point;
  id: string;
  mode: "done";
  next: ReviewLink | null;
  side: "below" | "above";
  text: string;
}

type CardState = ReviewState | DoneState;

let api: CanvasApi | null = null;
/** An Access session is present: the review tools are on. */
let moderating = false;
/** canModerate() answered for this canvas (yes or no). */
let settled = false;
const pending = new Map<string, AdminSticker>();
let queueCount: number | null = null;
let card: HTMLElement | null = null;
let state: CardState | null = null;
let stopCamera: (() => void) | null = null;
/** The review link (path + query) already handled. */
let handledLink: string | null = null;

/* ---------- requests ---------- */

type AdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; lost: boolean; status: number; message: string };

/** JSON request to /api/admin/*, telling a lost Access session apart. */
const adminJson = async <T>(
  url: string,
  init?: RequestInit
): Promise<AdminResult<T>> => {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "manual",
      ...init,
    });
    const data = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null;
    const { status } = response;
    if (isAuthLost(status, response.type === "opaqueredirect")) {
      return { lost: true, message: "", ok: false, status };
    }
    if (!response.ok) {
      const message =
        data?.error ?? `服务器出了点问题（${status}），稍后再试。`;
      return { lost: false, message, ok: false, status };
    }
    if (data === null) {
      const message = "服务器返回的内容看不懂，稍后再试。";
      return { lost: false, message, ok: false, status };
    }
    return { data, ok: true };
  } catch {
    const message = "网络好像断了，检查一下再试。";
    return { lost: false, message, ok: false, status: 0 };
  }
};

/* ---------- toolbar: 待审 N and messages ---------- */

const syncBadge = () => {
  for (const badge of document.querySelectorAll<HTMLAnchorElement>(
    "[data-vs-review-badge]"
  )) {
    // Nothing waiting (or not known yet): no badge.
    badge.hidden = !(moderating && queueCount);
    const count = badge.querySelector<HTMLElement>("[data-vs-review-count]");
    if (count) {
      count.textContent = queueCount === null ? "" : String(queueCount);
    }
    badge.setAttribute(
      "aria-label",
      queueCount === null ? "去后台审核" : `待审 ${queueCount} 条，去后台审核`
    );
  }
};

/** A note under the toolbar (trusted HTML: only the constants above). */
const say = (html: string) => {
  for (const message of document.querySelectorAll<HTMLElement>(
    "[data-vs-review-msg]"
  )) {
    message.innerHTML = html;
    message.hidden = false;
  }
};

const hideMessages = (target: Element | null) => {
  for (const message of document.querySelectorAll<HTMLElement>(
    "[data-vs-review-msg]:not([hidden])"
  )) {
    if (!message.contains(target)) {
      message.hidden = true;
    }
  }
};

/* ---------- the review note ---------- */

const reviewKind = (id: string): "pending" | "approved" | null => {
  if (pending.has(id)) {
    return "pending";
  }
  const shown = findShown(id);
  return shown && !shown.pending ? "approved" : null;
};

const metaHtml = (id: string) => {
  const item = pending.get(id);
  const name = item?.name ?? findShown(id)?.name ?? null;
  const parts = [`署名：${esc(name ?? "没署名")}`];
  if (item) {
    parts.push(esc(reviewTime(item.createdAt)));
    if (item.fingerprint) {
      parts.push(
        `指纹 <code>${esc(shortFingerprint(item.fingerprint))}</code>`
      );
    }
  }
  return `<p class="vsr-meta">${parts.map((part) => `<span>${part}</span>`).join("")}</p>`;
};

/** 通过 for a pending sticker; an approved one has no button (撤下 is the trash). */
const actionsHtml = (current: ReviewState, approved: boolean) => {
  if (approved) {
    return "";
  }
  const disabled = current.busy ? " disabled" : "";
  return `<div class="vsr-actions">
      <button type="button" class="stamp-btn vsr-approve" data-vsr="approve"${disabled}>通过</button>
    </div>`;
};

/** How to reject / take down: the trash, or Delete on the selected sticker. */
const HINT = '<p class="vsr-hint">不要就拖进垃圾桶（或按 Delete）</p>';

const reviewHtml = (current: ReviewState) => {
  const approved = reviewKind(current.id) === "approved";
  const title = approved ? "已公开的贴纸" : "待审贴纸";
  let status = "";
  if (current.busy) {
    status = '<p class="vsr-status">正在提交……</p>';
  } else if (current.error) {
    status = `<p class="vsr-error" role="alert">${esc(current.error)}</p>`;
  }
  return `<p class="vsr-title">${title}</p>${metaHtml(current.id)}${actionsHtml(current, approved)}${status}${HINT}`;
};

const nextLabel = (next: ReviewLink) =>
  next.type === "comment" ? "下一条待审（评论）→" : "下一条待审 →";

const nextHtml = (next: ReviewLink | null) => {
  if (!next) {
    return '<p class="vsr-all">都审完了</p>';
  }
  const label = nextLabel(next);
  // A full page load: the review link is read when the page starts.
  return `<a class="vsr-next" href="${esc(next.href)}" data-astro-reload>${label}</a>`;
};

const doneHtml = (current: DoneState) =>
  `<p class="vsr-done" role="status">${esc(current.text)}</p>
    <div class="vsr-actions">${nextHtml(current.next)}
      <button type="button" class="vsr-btn" data-vsr="close">收起</button>
    </div>`;

const layerEl = () =>
  document.querySelector<HTMLElement>("[data-sticker-layer][data-ready]");

/** Keeps the note right after its sticker (Tab goes sticker → note). */
const insertCard = () => {
  if (!(card && state)) {
    return;
  }
  if (state.mode === "review") {
    if (card.previousElementSibling !== state.el) {
      state.el.insertAdjacentElement("afterend", card);
    }
    return;
  }
  if (!card.isConnected) {
    layerEl()?.appendChild(card);
  }
};

/** Where the note goes for the selected sticker (world px + side). */
const anchorOf = (el: HTMLElement) => {
  const canvas = api;
  if (!(canvas && card)) {
    return null;
  }
  const viewport = canvas.viewportEl.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const side = cardSide({
    bottom: rect.bottom - viewport.top,
    cardHeight: card.offsetHeight,
    top: rect.top - viewport.top,
    viewportHeight: viewport.height,
  });
  const edge = side === "below" ? rect.bottom + CARD_GAP : rect.top - CARD_GAP;
  const at = canvas.screenToWorld({
    x: rect.left + rect.width / 2 - viewport.left,
    y: edge - viewport.top,
  });
  return { at, side };
};

const placeCard = () => {
  const canvas = api;
  if (!(canvas && card && state)) {
    return;
  }
  const anchor =
    state.mode === "review"
      ? anchorOf(state.el)
      : { at: state.at, side: state.side };
  if (!anchor) {
    return;
  }
  card.style.left = `${anchor.at.x}px`;
  card.style.top = `${anchor.at.y}px`;
  card.style.setProperty("--inv", String(1 / (canvas.getCamera().scale || 1)));
  card.classList.toggle("is-above", anchor.side === "above");
};

const focusIn = (selector: string) =>
  card?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });

const renderCard = () => {
  if (!(card && state)) {
    return;
  }
  card.innerHTML =
    state.mode === "review" ? reviewHtml(state) : doneHtml(state);
  insertCard();
  placeCard();
};

/** Delete / Backspace throws the selected sticker away (sticker-edit.ts). */
const KEYS = "aria-keyshortcuts";

const hideCard = () => {
  const el = card;
  const last = state;
  state = null;
  if (last?.mode === "review") {
    last.el.removeAttribute(KEYS);
  }
  stopCamera?.();
  stopCamera = null;
  if (!el?.isConnected) {
    return;
  }
  const hadFocus = el.contains(document.activeElement);
  el.remove();
  // Keyboard users go back to the sticker they were reviewing.
  if (hadFocus && last?.mode === "review" && last.el.isConnected) {
    last.el.focus({ preventScroll: true });
  }
};

/* ---------- losing the session ---------- */

const lostAccess = () => {
  // Parallel requests can all come back 401: say it once.
  if (!moderating) {
    return;
  }
  moderating = false;
  setAdminRemover(null);
  pending.clear();
  queueCount = null;
  hideCard();
  setReviewPending(null);
  syncBadge();
  say(NEED_LOGIN);
  // Hides 整理贴纸 too, unless this is the owner's GitHub session.
  recheckOwner();
};

const loadQueue = async () => {
  const result = await adminJson<QueueSummary>("/api/admin/queue");
  if (result.ok) {
    queueCount = badgeCount(result.data);
    syncBadge();
  } else if (result.lost) {
    lostAccess();
  }
};

/* ---------- deciding ---------- */

/** Drops ?review= once it is dealt with, so a reload does not look for it. */
const forgetReviewLink = (id: string) => {
  const target = reviewTarget();
  if (target?.type !== "sticker" || target.id !== id) {
    return;
  }
  const url = new URL(location.href);
  url.searchParams.delete("review");
  history.replaceState(history.state, "", url);
  handledLink = null;
};

/** 通过 went through: 已通过 and the next item, in the note. */
const finish = (
  current: ReviewState,
  next: ReviewLink | null,
  anchor: ReturnType<typeof anchorOf>
) => {
  const { id } = current;
  pending.delete(id);
  forgetReviewLink(id);
  loadQueue();
  if (state !== current) {
    // The owner already moved on to another sticker: just update the layer.
    markApproved(id);
    return;
  }
  state = {
    at: anchor?.at ?? { x: 0, y: 0 },
    id,
    mode: "done",
    next,
    side: anchor?.side ?? "below",
    text: decidedText("approve", false),
  };
  // Let go first, so the re-rendered layer does not select it again.
  deselectSticker();
  markApproved(id);
  renderCard();
  focusIn(".vsr-next, [data-vsr=close]");
};

const approve = async (current: ReviewState) => {
  if (current.busy) {
    return;
  }
  current.busy = true;
  current.error = "";
  renderCard();
  const anchor = anchorOf(current.el);
  const result = await adminJson<DecideResponse>("/api/admin/decide", {
    body: JSON.stringify({
      decision: "approve",
      id: current.id,
      type: "sticker",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!result.ok) {
    if (result.lost) {
      lostAccess();
      return;
    }
    current.busy = false;
    current.error = result.message;
    if (state === current) {
      renderCard();
      focusIn("[data-vsr=approve]");
    }
    return;
  }
  finish(current, result.data.next ?? null, anchor);
};

/**
 * 拒绝 / 撤下 after 已扔掉 · 撤销 ran out (sticker-trash.ts): the image is
 * deleted for good. Says what happened and links to the next pending item.
 */
const rejectSticker: Remover = async (id, keepalive) => {
  const wasApproved = reviewKind(id) === "approved";
  const result = await adminJson<DecideResponse>("/api/admin/decide", {
    body: JSON.stringify({ decision: "reject", id, type: "sticker" }),
    headers: { "content-type": "application/json" },
    keepalive,
    method: "POST",
  });
  if (!result.ok) {
    if (result.lost) {
      lostAccess();
      return { message: "需要先在 /admin/ 登录，贴纸没扔掉。", ok: false };
    }
    return { message: result.message, ok: false };
  }
  pending.delete(id);
  forgetReviewLink(id);
  loadQueue();
  const text = decidedText("reject", wasApproved);
  const { next } = result.data;
  if (!next) {
    return { note: wasApproved ? text : `${text}，都审完了`, ok: true };
  }
  return {
    link: { href: next.href, label: nextLabel(next) },
    note: text,
    ok: true,
  };
};

/* ---------- the note's own events ---------- */

const onCardClick = (event: MouseEvent) => {
  const target = event.target instanceof Element ? event.target : null;
  const action = target?.closest<HTMLElement>("[data-vsr]")?.dataset.vsr;
  const current = state;
  if (!(action && current)) {
    return;
  }
  if (current.mode === "done") {
    if (action === "close") {
      hideCard();
    }
    return;
  }
  if (action === "approve") {
    approve(current);
  }
};

const onCardKey = (event: KeyboardEvent) => {
  if (event.key !== "Escape" || !state) {
    return;
  }
  if (state.mode === "done") {
    event.preventDefault();
    event.stopPropagation();
    hideCard();
  }
};

/** Presses on the note are not canvas drags or empty-desk clicks. */
const stop = (event: Event) => event.stopPropagation();

const ensureCard = () => {
  if (card) {
    return card;
  }
  const el = document.createElement("div");
  el.className = "vsr sticky-paper";
  el.dataset.vsReview = "";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "审核这张贴纸");
  el.addEventListener("pointerdown", stop);
  el.addEventListener("pointerup", stop);
  el.addEventListener("click", onCardClick);
  el.addEventListener("keydown", onCardKey);
  card = el;
  return el;
};

const showCard = (next: CardState) => {
  ensureCard();
  if (state?.mode === "review") {
    state.el.removeAttribute(KEYS);
  }
  state = next;
  if (next.mode === "review") {
    next.el.setAttribute(KEYS, "Delete Backspace");
  }
  if (!stopCamera && api) {
    stopCamera = api.onCameraChange(placeCard);
  }
  renderCard();
};

/* ---------- selection (sticker-edit.ts) ---------- */

const onSelection = (selection: { id: string; el: HTMLElement } | null) => {
  if (!moderating) {
    return;
  }
  if (!selection) {
    if (state?.mode === "review") {
      hideCard();
    }
    return;
  }
  if (state?.mode === "review" && state.id === selection.id) {
    // Moved, or the layer was rebuilt.
    state.el = selection.el;
    state.el.setAttribute(KEYS, "Delete Backspace");
    insertCard();
    placeCard();
    return;
  }
  if (!reviewKind(selection.id)) {
    if (state?.mode === "review") {
      hideCard();
    }
    return;
  }
  showCard({
    busy: false,
    el: selection.el,
    error: "",
    id: selection.id,
    mode: "review",
  });
};

/** The layer rebuilt its stickers: put a 已通过 / 已拒绝 note back. */
const onLayerRendered = () => {
  if (state?.mode === "done") {
    insertCard();
    placeCard();
  }
};

const onDocumentPointer = (event: PointerEvent) => {
  const target = event.target instanceof Element ? event.target : null;
  hideMessages(target);
  if (state?.mode === "done" && !card?.contains(target)) {
    hideCard();
  }
};

/* ---------- review links ---------- */

const linkKey = () => `${location.pathname}${location.search}`;

const openReviewLink = async () => {
  const target = reviewTarget();
  const canvas = api;
  if (target?.type !== "sticker" || !canvas || handledLink === linkKey()) {
    return;
  }
  handledLink = linkKey();
  if (!moderating) {
    say(NEED_LOGIN);
    return;
  }
  await whenStickersLoaded();
  const item = pending.get(target.id) ?? findShown(target.id);
  if (!(item && reviewKind(target.id))) {
    say(NOT_FOUND);
    return;
  }
  // Approved stickers are only selectable in 整理贴纸; this one always is.
  setReviewFocus(target.id);
  const camera = reviewCamera(item, canvas.getCamera().scale);
  canvas.panTo({ x: camera.x, y: camera.y }, { scale: camera.scale });
  if (!selectSticker(target.id)) {
    return;
  }
  // An approved one has no button: the sticker itself, ready for Delete.
  const approveButton = card?.querySelector<HTMLElement>("[data-vsr=approve]");
  const reviewed = state?.mode === "review" ? state.el : null;
  (approveButton ?? reviewed)?.focus({ preventScroll: true });
};

/* ---------- start ---------- */

const loadPending = async () => {
  const result = await adminJson<AdminStickersResponse>("/api/admin/stickers");
  if (!result.ok) {
    if (result.lost) {
      lostAccess();
    }
    // Anything else: review from /admin/ as before.
    return;
  }
  pending.clear();
  for (const item of result.data.pending) {
    pending.set(item.id, item);
  }
  setReviewPending(result.data.pending);
};

const start = async () => {
  moderating = await canModerate();
  settled = true;
  syncBadge();
  if (!moderating) {
    openReviewLink();
    return;
  }
  setAdminRemover(rejectSticker);
  loadQueue();
  await loadPending();
  if (moderating) {
    openReviewLink();
  }
};

const attach = (canvas: CanvasApi) => {
  if (api === canvas) {
    return;
  }
  api = canvas;
  start();
};

/** Every page (the toolbar is replaced): badge, and a new review link. */
const onPageLoad = () => {
  syncBadge();
  if (!(api && settled) || reviewTarget()?.type !== "sticker") {
    return;
  }
  if (moderating) {
    openReviewLink();
    return;
  }
  // Arrived without a full load: ask the server now that there is a link.
  if (handledLink !== linkKey()) {
    resetModerate();
    settled = false;
    start();
  }
};

onSelectionChange(onSelection);
window.addEventListener(STICKERS_RENDERED, onLayerRendered);
document.addEventListener("pointerdown", onDocumentPointer, true);
document.addEventListener("astro:page-load", onPageLoad);
window.addEventListener(CANVAS_READY, (event) => attach(event.detail));
whenCanvasReady().then(attach);
