/**
 * The shared 垃圾桶 (docs/design.md 「访客互动」): one hand-drawn trash can
 * at the bottom right, the 「已扔掉 · 撤销」 slip, and the delayed commit
 * behind it. Stickers (sticker-trash.ts) and comments (comment-drag.ts) both
 * throw things away through here.
 *
 * - showTrash / openTrash / trashBox / hideTrash: the can shows while
 *   something throwable is picked up; its lid opens while it hovers over
 *   it. `raised` puts it on <body> above the drawer (comments are read in
 *   the drawer, which covers the bottom right).
 * - hold(): after something went into the can, 已扔掉 · 撤销 stays for
 *   UNDO_MS; only then (or when the page is hidden, with keepalive) does
 *   `commit` send the real request. One at a time: a new throw sends the
 *   previous one right away. 撤销 calls `undo` instead.
 * - crumpleInto(): a fixed-position slip (a comment's lifted copy) crumples
 *   and falls into the can; a fade with reduced motion.
 *
 * No request is built here: the callers own their routes and messages.
 */
import { BIN_MOUTH, CRUMPLE_STOPS, UNDO_MS } from "./sticker-gesture";
import { reduceMotion } from "./util";

/** Something thrown away, waiting for 撤销 to run out. */
export type HeldThrow = {
  /** Sends the real request (keepalive while the page is being left). */
  commit: (keepalive: boolean) => Promise<void> | void;
  /** 撤销: put it back. `hadFocus`: the slip had keyboard focus. */
  undo: (hadFocus: boolean) => void;
  /**
   * The slip goes away while it has focus (and 撤销 was not pressed):
   * where focus goes instead. Default: the canvas toolbar.
   */
  refocus?: () => void;
};

type Held = HeldThrow & { timer: number };

const CRUMPLE_MS = 420;
const FADE_MS = 150;
const CRUMPLE_EASE = "cubic-bezier(0.5, 0, 0.75, 0)";
/** The lid stays open a moment after something went in. */
export const LID_MS = 260;

const TRASH_SVG = `<svg viewBox="0 0 48 58" width="46" height="56" aria-hidden="true"><title>垃圾桶</title>
  <g class="vs-trash-lid">
    <path d="M19.4 12.4c.3-2.9 1.5-3.8 5-3.9 3.5 0 4.7.8 5 3.8" />
    <path d="M6.6 17.6 8 13.8c7.8-1.5 23.8-1.7 31.8-.4l1.7 3.9" />
    <path d="M5.8 17.8c8.4-1.3 28.2-1.6 36.6-.4" />
  </g>
  <path class="vs-trash-body" d="M9.6 21c1 9.6 2.2 20.2 3.2 29.8.3 1.9 1.4 2.7 3.4 2.6l16.4-.3c2-.1 3-1.1 3.3-2.6 1.1-9.7 2.1-20.2 2.9-30" />
  <path d="M17.2 26.4 18.3 47M24.3 26.2l-.2 21.2M31.3 26.4 30.2 47" />
</svg>`;

let host: HTMLElement | null = null;
let trashEl: HTMLElement | null = null;
let toastEl: HTMLElement | null = null;
let toastTimer = 0;
let held: Held | null = null;
let heldRefocus: (() => void) | undefined;

/* ---------- the can ---------- */

/** Where the can and the slip live by default: the persisted canvas root. */
export const setTrashHost = (el: HTMLElement | null) => {
  host = el;
};

const ensureTrash = () => {
  if (trashEl) {
    return trashEl;
  }
  const el = document.createElement("div");
  el.className = "vs-trash";
  el.dataset.vsTrash = "";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = TRASH_SVG;
  trashEl = el;
  return el;
};

/**
 * Shows the can. `raised`: on <body>, above the drawer and the margin
 * notes (comments); otherwise in the canvas root, under the drawer.
 */
export const showTrash = ({ raised = false }: { raised?: boolean } = {}) => {
  const el = ensureTrash();
  const parent = raised ? document.body : (host ?? document.body);
  if (el.parentElement !== parent) {
    parent.appendChild(el);
  }
  el.classList.toggle("is-raised", raised);
  el.classList.add("is-shown");
};

export const hideTrash = () => trashEl?.classList.remove("is-shown", "is-open");

let boxCache: DOMRect | null = null;

/**
 * The can's box on screen (client px), or null when it is not up. Read at
 * most once per frame: pointer moves come several to a frame, each after
 * the last one moved the dragged thing, and a fresh read would force layout.
 */
export const trashBox = () => {
  if (!(trashEl?.isConnected && trashEl.classList.contains("is-shown"))) {
    return null;
  }
  if (!boxCache) {
    boxCache = trashEl.getBoundingClientRect();
    requestAnimationFrame(() => {
      boxCache = null;
    });
  }
  return boxCache;
};

/** Lid open while something hovers over it. */
export const openTrash = (open: boolean) =>
  trashEl?.classList.toggle("is-open", open);

/* ---------- the slip at the bottom ---------- */

const focusToolbar = () =>
  document
    .querySelector<HTMLElement>("[data-vs-open]:not([hidden])")
    ?.focus({ preventScroll: true });

/** Hides the slip; focus inside it goes to `heldRefocus` or the toolbar. */
export const hideToast = () => {
  window.clearTimeout(toastTimer);
  const el = toastEl;
  if (!el || el.hidden) {
    return;
  }
  const hadFocus = el.contains(document.activeElement);
  el.hidden = true;
  if (hadFocus) {
    (heldRefocus ?? focusToolbar)();
  }
};

const ensureToast = () => {
  if (toastEl?.isConnected) {
    return toastEl;
  }
  const el = document.createElement("div");
  el.className = "vs-toast";
  el.dataset.vsToast = "";
  el.hidden = true;
  el.innerHTML =
    '<span class="vs-toast-text" role="status" data-vs-toast-text></span><span data-vs-toast-extra></span>';
  const stop = (event: Event) => event.stopPropagation();
  el.addEventListener("pointerdown", stop);
  el.addEventListener("pointerup", stop);
  el.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-vs-undo]")) {
      undoHeld();
    }
  });
  (host ?? document.body).appendChild(el);
  toastEl = el;
  return el;
};

/**
 * The hand-written slip at the bottom for `ms`. `extra` is trusted HTML
 * (callers build it from escaped parts).
 */
export const toast = (
  text: string,
  extra: string,
  ms: number,
  isError = false
) => {
  const el = ensureToast();
  const textEl = el.querySelector<HTMLElement>("[data-vs-toast-text]");
  const extraEl = el.querySelector<HTMLElement>("[data-vs-toast-extra]");
  if (textEl) {
    textEl.textContent = text;
  }
  if (extraEl) {
    extraEl.innerHTML = extra;
  }
  el.classList.toggle("is-error", isError);
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, ms);
  return el;
};

/* ---------- 已扔掉 · 撤销 ---------- */

/** Something is waiting for 撤销 to run out. */
export const isHeld = () => held !== null;

/** Sends the waiting one now (on time, before the next throw, on pagehide). */
export const flushHeld = async (keepalive = false) => {
  const item = held;
  if (!item) {
    return;
  }
  held = null;
  window.clearTimeout(item.timer);
  if (!keepalive) {
    hideToast();
  }
  heldRefocus = undefined;
  await item.commit(keepalive);
};

/** 撤销: the waiting one comes back, nothing is sent. */
const undoHeld = () => {
  const item = held;
  if (!item) {
    return;
  }
  held = null;
  window.clearTimeout(item.timer);
  heldRefocus = undefined;
  const hadFocus = toastEl?.contains(document.activeElement) === true;
  window.clearTimeout(toastTimer);
  if (toastEl) {
    toastEl.hidden = true;
  }
  item.undo(hadFocus);
};

/**
 * It went into the can: 已扔掉 · 撤销 for UNDO_MS, then `commit`. The one
 * waiting before is sent right away. `focusUndo` (keyboard): focus 撤销.
 */
export const hold = (item: HeldThrow, focusUndo: boolean) => {
  flushHeld();
  held = {
    ...item,
    timer: window.setTimeout(() => flushHeld(), UNDO_MS),
  };
  heldRefocus = item.refocus;
  const slip = toast(
    "已扔掉",
    ' · <button type="button" class="vs-undo" data-vs-undo>撤销</button>',
    UNDO_MS
  );
  if (focusUndo) {
    slip
      .querySelector<HTMLElement>("[data-vs-undo]")
      ?.focus({ preventScroll: true });
  }
};

/* ---------- crumpling a fixed-position slip into the can ---------- */

/** Where it is now: its translate (px) and rotate (deg). */
export type SlipPose = { dx: number; dy: number; turn: number };

/**
 * Crumples a `position: fixed` element (translated by `pose`) into the can,
 * or fades it with reduced motion. Resolves when it is gone.
 */
export const crumpleInto = async (el: HTMLElement, pose: SlipPose) => {
  const cancelled = () => {
    // The element went away first: nothing to wait for.
  };
  if (reduceMotion()) {
    await el
      .animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: FADE_MS,
        fill: "forwards",
      })
      .finished.catch(cancelled);
    return;
  }
  const box = trashBox();
  const rect = el.getBoundingClientRect();
  const to = box
    ? {
        x: box.left + box.width / 2 - (rect.left + rect.width / 2),
        y: box.top + box.height * BIN_MOUTH - (rect.top + rect.height / 2),
      }
    : { x: 0, y: 0 };
  const frames = CRUMPLE_STOPS.map((stop) => ({
    offset: stop.offset,
    translate: `${pose.dx + to.x * stop.way}px ${pose.dy + to.y * stop.way - stop.hop}px`,
    scale: stop.scale,
    rotate: `${pose.turn + stop.turn}deg`,
    opacity: stop.opacity,
  }));
  await el
    .animate(frames, {
      duration: CRUMPLE_MS,
      easing: CRUMPLE_EASE,
      fill: "forwards",
    })
    .finished.catch(cancelled);
};

// Leaving the page: send it now instead of losing it.
window.addEventListener("pagehide", () => {
  flushHeld(true);
});
