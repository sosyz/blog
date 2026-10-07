/**
 * Moving stickers that are already on the canvas (docs/design.md 「访客互动」):
 *
 * 1. Your own sticker (this browser has its edit token, sticker-store.ts):
 *    press it to select it, then drag / rotate / resize it like when placing
 *    it. The new position is saved for everyone (PATCH /api/stickers/:id)
 *    when you let go, or shortly after keys / the wheel; no new review.
 *    Logged in with GitHub, the stickers of that account work the same on
 *    any device (PATCH /api/stickers/:id without a token; the session proves
 *    ownership).
 * 2. The owner's 整理贴纸 mode (toolbar toggle): shown when the owner is
 *    logged in with GitHub (GET /api/auth/me isOwner; saves through PATCH
 *    /api/stickers/:id with the session), or after /admin/ was opened in this
 *    browser and GET /api/admin/whoami says yes (saves through PATCH
 *    /api/admin/stickers/:id). Every visitor sticker then works like your
 *    own. The built-in stickers are part of the code and are never saved by
 *    this mode; dragging them stays local (3.).
 * 3. Anyone can drag any sticker (visitor stickers and the built-in ones)
 *    just for themselves: an offset kept in this browser (sticker-offsets.ts),
 *    drag only. 贴纸放回原位 in the toolbar clears the offsets. A visitor
 *    sticker this viewer may throw away (the owner outside 整理贴纸, the
 *    uploader) shows the trash during this drag as well; so does a built-in
 *    one for the owner (Access or the GitHub session): thrown away, it is
 *    hidden for every visitor (sticker-trash.ts `throwBuiltin`,
 *    builtin-hidden.ts) until /admin/ restores it. For the owner the
 *    built-ins are also focusable, and Delete / Backspace throws the focused
 *    one away.
 *
 * 4. With an Access session (review-stickers.ts): pending stickers are
 *    selectable too; `onSelectionChange` tells the review card which sticker
 *    is selected (and when it moved) so it can float next to it.
 *
 * A sticker has to be peeled right off (撕下来) before it moves: pulling it
 * first curls it up where it is (a WebGL curl, sticker-peel.ts; a small CSS
 * tilt without it), and only once it is fully off does it follow the pointer.
 * The element then moves with the whole pull at once; sticker-peel.ts keeps
 * what is shown continuous (the curl stays pinned under the pointer, the CSS
 * fallback glides into the hand). The curl's WebGL chunk is fetched when a
 * sticker is hovered or focused, or when the desk is idle.
 * Let go before that and it lays back flat where it was, nothing saved; let
 * go after and it is laid down (贴回去) and saved as before. While a sticker
 * this viewer may delete is off the desk, the trash can shows
 * (sticker-trash.ts); dropping it there, or Delete / Backspace on a selected
 * one, throws it away with 已扔掉 · 撤销. Keys, the wheel and the rotate /
 * resize handles work at once, without peeling.
 *
 * A press that moves less than DRAG_SLOP px is a click, not a move. Pressing
 * a sticker never pans the canvas: the listener on the world element stops
 * the event before it reaches the viewport (src/scripts/canvas/input.ts).
 */
import { stickerDisplayWidth } from "@/lib/server/image-header";
import type { MovedResponse } from "@/lib/server/types";
import {
  CANVAS_READY,
  type CanvasApi,
  prefersReducedMotion,
  whenCanvasReady,
} from "@/scripts/canvas/api";
import { authNow, subscribe as subscribeAuth } from "./auth";
import { setBuiltinOwner } from "./builtin-hidden";
import { STICKERS_RENDERED } from "./events";
import { canModerate, isGithubOwner, resetModerate } from "./owner";
import { isOver, peelAxis, unrotate } from "./sticker-gesture";
import {
  hasOffsets,
  type Offset,
  type Offsets,
  offsetOf,
  readOffsets,
  visitorStickerKey,
  withOffset,
  writeOffsets,
} from "./sticker-offsets";
import { type Peel, startPeel, warmPeel } from "./sticker-peel";
import { movePendingSticker, ownedToken } from "./sticker-store";
import {
  applyPlacement,
  clampEdit,
  type EditPlacement,
  keyChange,
  modeOf,
  type SizedPlacement,
  trackTransform,
  wheelScale,
} from "./sticker-transform";
import {
  canThrow,
  hideTrash,
  openTrash,
  setTrashHost,
  showTrash,
  throwAway,
  throwBuiltin,
  trashBox,
} from "./sticker-trash";
import { isAccountOwned, isTidy, setTidy, updateShown } from "./stickers";
import { requestJson } from "./util";

/** Screen px a press may wander and still be a click (as for the canvas). */
const DRAG_SLOP = 4;
/** Save this long after the last key / wheel step. */
const SAVE_DELAY = 700;
const STATUS_MS = 2200;
/** Matches the .vs-gliding transition in StickerLayer.astro. */
const GLIDE_MS = 450;
/** Space between a sticker's lower edge and its status note (world px). */
const STATUS_GAP = 18;

const MOVED = "已挪好";
const NOT_MOVED = "没挪成功，稍后再试";

interface Selected {
  el: HTMLElement;
  id: string;
  placement: SizedPlacement;
  /** What the server has. */
  saved: SizedPlacement;
  saving: boolean;
  timer: number;
}

let api: CanvasApi | null = null;
let selected: Selected | null = null;
let offsets: Offsets = readOffsets();
let owner = false;
let ownerCheck: Promise<boolean> | null = null;
let statusEl: HTMLElement | null = null;
let statusTimer = 0;

/** The selected visitor sticker (or null), for the review card. */
export type SelectionListener = (
  selection: { id: string; el: HTMLElement } | null
) => void;
const selectionListeners = new Set<SelectionListener>();

/** Called on select, deselect, re-render and every move of the selection. */
export const onSelectionChange = (listener: SelectionListener) => {
  selectionListeners.add(listener);
  return () => selectionListeners.delete(listener);
};

const notifySelection = () => {
  const selection = selected ? { el: selected.el, id: selected.id } : null;
  for (const listener of selectionListeners) {
    listener(selection);
  }
};

/** Presses inside the review card keep the sticker selected. */
const REVIEW_CARD = "[data-vs-review]";

/* ---------- small DOM helpers ---------- */

const elementOf = (target: EventTarget | null) =>
  target instanceof Element ? target : null;

const visitorSticker = (target: EventTarget | null) =>
  elementOf(target)?.closest<HTMLElement>("[data-sticker-layer] .vs") ?? null;

const builtInSticker = (target: EventTarget | null) =>
  elementOf(target)?.closest<HTMLElement>("[data-sticker-key]") ?? null;

const keyOf = (el: HTMLElement) =>
  el.dataset.vsId
    ? visitorStickerKey(el.dataset.vsId)
    : (el.dataset.stickerKey ?? "");

const setOffsetVars = (el: HTMLElement, { dx, dy }: Offset) => {
  el.style.setProperty("--dx", `${dx}px`);
  el.style.setProperty("--dy", `${dy}px`);
};

const placementOf = (el: HTMLElement): SizedPlacement => {
  const read = (name: string, fallback: number) => {
    const value = Number(el.dataset[name]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    height: read("height", 1),
    rotation: read("rotation", 0),
    scale: read("scale", 1),
    width: read("width", 1),
    x: read("x", 0),
    y: read("y", 0),
  };
};

const writePlacement = (el: HTMLElement, placement: SizedPlacement) => {
  applyPlacement(el, placement);
  el.dataset.x = String(placement.x);
  el.dataset.y = String(placement.y);
  el.dataset.rotation = String(placement.rotation);
  el.dataset.scale = String(placement.scale);
};

/* ---------- toolbar: 整理贴纸 and 贴纸放回原位 ---------- */

const syncTools = () => {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-vs-tidy]"
  )) {
    button.hidden = !(owner && api?.viewportEl.isConnected);
    button.setAttribute("aria-pressed", String(isTidy()));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-vs-reset]"
  )) {
    button.hidden = !(hasOffsets(offsets) && api?.viewportEl.isConnected);
  }
};

/* ---------- the little status note under a moved sticker ---------- */

const say = (record: Selected, message: string, failed: boolean) => {
  const world = api?.worldEl;
  if (!world) {
    return;
  }
  if (!statusEl?.isConnected) {
    statusEl = document.createElement("p");
    statusEl.className = "vs-moved";
    statusEl.setAttribute("role", "status");
    world.appendChild(statusEl);
  }
  const { x, y, width, height, scale } = record.placement;
  const shownWidth = stickerDisplayWidth(width, scale);
  const shownHeight = (shownWidth * height) / width;
  statusEl.style.left = `${x}px`;
  statusEl.style.top = `${y + shownHeight / 2 + STATUS_GAP}px`;
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", failed);
  statusEl.classList.add("is-shown");
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(
    () => statusEl?.classList.remove("is-shown"),
    STATUS_MS
  );
};

/* ---------- saving a real move ---------- */

const same = (a: EditPlacement, b: EditPlacement) =>
  a.x === b.x &&
  a.y === b.y &&
  a.rotation === b.rotation &&
  a.scale === b.scale;

/** The owner is logged in with GitHub (moves go through the session). */
const sessionOwner = () => authNow()?.isOwner === true;

/** This browser or this GitHub account may move the sticker as its own. */
const canMoveOwn = (id: string) =>
  Boolean(ownedToken(id)) || isAccountOwned(id);

const moveRequest = (record: Selected) => {
  const { x, y, rotation, scale } = record.placement;
  const token = ownedToken(record.id);
  const init = (body: object): RequestInit => ({
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  if (token) {
    return {
      init: init({ rotation, scale, token, x, y }),
      url: `/api/stickers/${record.id}`,
    };
  }
  // The GitHub session proves ownership (or that this is the owner).
  if (isAccountOwned(record.id) || sessionOwner()) {
    return {
      init: init({ rotation, scale, x, y }),
      url: `/api/stickers/${record.id}`,
    };
  }
  return {
    init: init({ rotation, scale, x, y }),
    url: `/api/admin/stickers/${record.id}`,
  };
};

const show = (record: Selected, placement: SizedPlacement) => {
  record.placement = { ...placement };
  if (record.el.isConnected) {
    writePlacement(record.el, placement);
  }
  updateShown(record.id, placement);
  if (selected === record) {
    notifySelection();
  }
};

const save = async (record: Selected) => {
  window.clearTimeout(record.timer);
  if (record.saving || same(record.placement, record.saved)) {
    return;
  }
  record.saving = true;
  const { url, init } = moveRequest(record);
  const result = await requestJson<MovedResponse>(url, init);
  record.saving = false;
  if (!result.ok) {
    // Put it back where the server still has it.
    show(record, record.saved);
    say(record, NOT_MOVED, true);
    return;
  }
  const { x, y, rotation, scale } = result.data;
  record.saved = { ...record.saved, rotation, scale, x, y };
  movePendingSticker(record.id, { rotation, scale, x, y });
  if (same(record.placement, record.saved)) {
    say(record, MOVED, false);
    return;
  }
  // Moved again while the request was on its way.
  save(record);
};

const scheduleSave = (record: Selected) => {
  window.clearTimeout(record.timer);
  record.timer = window.setTimeout(() => save(record), SAVE_DELAY);
};

/**
 * A sticker that was dragged locally before it became editable (e.g. in
 * 整理贴纸 mode): its first real move starts from where it is shown.
 */
const foldOffset = (record: Selected) => {
  const key = visitorStickerKey(record.id);
  const offset = offsetOf(offsets, key);
  if (offset.dx === 0 && offset.dy === 0) {
    return;
  }
  record.placement = {
    ...record.placement,
    x: record.placement.x + offset.dx,
    y: record.placement.y + offset.dy,
  };
  offsets = withOffset(offsets, key, { dx: 0, dy: 0 });
  writeOffsets(offsets);
  setOffsetVars(record.el, { dx: 0, dy: 0 });
  syncTools();
};

const adjust = (record: Selected, change: Partial<EditPlacement>) => {
  foldOffset(record);
  show(record, clampEdit({ ...record.placement, ...change }));
};

/* ---------- selection ---------- */

const deselect = () => {
  const record = selected;
  if (!record) {
    return;
  }
  selected = null;
  record.el.classList.remove("is-selected");
  record.el.setAttribute("aria-pressed", "false");
  notifySelection();
  // A key / wheel change still waiting for its timer.
  save(record);
};

const select = (el: HTMLElement) => {
  if (selected?.el === el) {
    return selected;
  }
  deselect();
  const placement = placementOf(el);
  const record: Selected = {
    el,
    id: el.dataset.vsId ?? "",
    placement,
    saved: { ...placement },
    saving: false,
    timer: 0,
  };
  selected = record;
  el.classList.add("is-selected");
  el.setAttribute("aria-pressed", "true");
  if (document.activeElement !== el) {
    el.focus({ preventScroll: true });
  }
  notifySelection();
  return record;
};

/** After the layer re-renders, find the selected sticker's new element. */
const reselect = () => {
  const record = selected;
  if (!record) {
    return;
  }
  const el = document.querySelector<HTMLElement>(
    `[data-sticker-layer] .vs.is-editable[data-vs-id="${CSS.escape(record.id)}"]`
  );
  if (!el) {
    selected = null;
    notifySelection();
    save(record);
    return;
  }
  const hadFocus = record.el.contains(document.activeElement);
  record.el = el;
  writePlacement(el, record.placement);
  el.classList.add("is-selected");
  el.setAttribute("aria-pressed", "true");
  if (hadFocus || document.activeElement === document.body) {
    el.focus({ preventScroll: true });
  }
  notifySelection();
};

/** Selects a visitor sticker that is on the layer and editable (review link). */
export const selectSticker = (id: string) => {
  const el = document.querySelector<HTMLElement>(
    `[data-sticker-layer] .vs.is-editable[data-vs-id="${CSS.escape(id)}"]`
  );
  if (!el) {
    return false;
  }
  select(el);
  return true;
};

export const deselectSticker = () => deselect();

/* ---------- 撕下来 / 贴回去 ---------- */

/**
 * The CSS fallback's curl: the corner under the pointer (--peel-ax /
 * --peel-ay). The WebGL curl (sticker-peel.ts) finds its own corner.
 */
const aimPeel = (el: HTMLElement, event: PointerEvent) => {
  const rect = el.getBoundingClientRect();
  const rotation = Number.parseFloat(getComputedStyle(el).rotate) || 0;
  const local = unrotate(
    event.clientX - (rect.left + rect.width / 2),
    event.clientY - (rect.top + rect.height / 2),
    rotation
  );
  const { ax, ay } = peelAxis(local.dx, local.dy);
  el.style.setProperty("--peel-ax", String(ax));
  el.style.setProperty("--peel-ay", String(ay));
};

/** Starts the curl for a press that may become a drag of the sticker. */
const beginPeel = (canvas: CanvasApi, el: HTMLElement, event: PointerEvent) => {
  // Measure first: aimPeel writes styles, a read after them would flush.
  const peel = startPeel(canvas, el, event);
  aimPeel(el, event);
  return peel;
};

/* ---------- 垃圾桶 ---------- */

/**
 * Throws the selected sticker away. The move that carried it to the trash is
 * not saved; 撤销 brings it back where it was picked up.
 */
const throwRecord = (record: Selected, focusUndo: boolean, fallen = false) => {
  const { id, el } = record;
  const saved = { ...record.saved };
  window.clearTimeout(record.timer);
  // Nothing left to save when it is let go.
  record.placement = { ...saved };
  if (selected === record) {
    selected = null;
    el.classList.remove("is-selected");
    el.setAttribute("aria-pressed", "false");
    notifySelection();
  }
  throwAway({
    el,
    fallen,
    focusUndo,
    id,
    restore: () => updateShown(id, saved),
    scale: api?.getCamera().scale ?? 1,
  });
};

/** Dropped on the trash: the curl carries it into the bin, then the throw. */
const dropInTrash = async (record: Selected, peel: Peel | null) => {
  // Nothing to save while it falls, even if it is let go of meanwhile.
  window.clearTimeout(record.timer);
  record.placement = { ...record.saved };
  const fallen = (await peel?.fall(trashBox())) ?? false;
  throwRecord(record, false, fallen);
  // The element is gone now (or crumpling): the curl can stop.
  peel?.end();
};

/**
 * Throws a sticker away by id, the same throw as the trash. The review note
 * has no 拒绝 / 撤下 button any more (the trash and Delete do it); kept for
 * callers that only have the id.
 */
export const throwSticker = (id: string, focusUndo: boolean) => {
  if (selected?.id !== id) {
    selectSticker(id);
  }
  const record = selected as Selected | null;
  if (record?.id === id) {
    throwRecord(record, focusUndo);
  }
};

/* ---------- pointer: real moves and local drags ---------- */

const startEdit = (canvas: CanvasApi, el: HTMLElement, event: PointerEvent) => {
  const record = select(el);
  const offset = offsetOf(offsets, visitorStickerKey(record.id));
  const origin = {
    ...record.placement,
    x: record.placement.x + offset.dx,
    y: record.placement.y + offset.dy,
  };
  const throwable = canThrow(record.id);
  let overTrash = false;
  // Only moving peels it, not turning or resizing it by a handle.
  const peel =
    modeOf(event.target) === "move" ? beginPeel(canvas, el, event) : null;
  let lifted = false;
  // Off the desk (fully peeled): only then does it move. Handles turn and
  // resize it at once.
  let held = !peel;
  trackTransform({
    api: canvas,
    el,
    event,
    onChange: (change) => {
      if (held) {
        adjust(record, change);
      }
    },
    onEnd: (moved, e, mode) => {
      if (moved && mode === "move" && overTrash) {
        dropInTrash(record, peel);
        return;
      }
      hideTrash();
      let shift = { x: 0, y: 0 };
      if (e.type === "pointercancel") {
        peel?.end();
      } else if (peel) {
        shift = peel.drop();
      }
      // Let go before it came off: it never moved, nothing to save.
      if (moved && held) {
        // Lands where the curl drew it (on the pencil silhouette).
        if (shift.x !== 0 || shift.y !== 0) {
          const scale = canvas.getCamera().scale || 1;
          adjust(record, {
            x: record.placement.x + shift.x / scale,
            y: record.placement.y + shift.y / scale,
          });
        }
        save(record);
      }
    },
    onMove: (e) => {
      if (!peel) {
        return;
      }
      // Peel only once it really moves (a click just selects).
      if (!lifted) {
        lifted = true;
        peel.lift();
      }
      if (!peel.move(e)) {
        return;
      }
      if (!held) {
        held = true;
        if (throwable) {
          showTrash();
        }
      }
      if (throwable) {
        overTrash = isOver(trashBox(), { x: e.clientX, y: e.clientY });
        openTrash(overTrash);
        peel.hoverTrash(overTrash);
      }
    },
    origin,
    slop: DRAG_SLOP,
  });
};

/**
 * Dropped on the trash from a local drag: the curl carries it into the bin,
 * then the usual throw. The local move is not kept; 撤销 brings it back
 * where it was picked up.
 */
const throwLocal = async (
  id: string,
  el: HTMLElement,
  peel: Peel,
  start: Offset
) => {
  const fallen = await peel.fall(trashBox());
  await throwAway({
    el,
    fallen,
    focusUndo: false,
    id,
    restore: () => setOffsetVars(el, start),
    scale: api?.getCamera().scale ?? 1,
  });
  peel.end();
};

/** The same for a built-in sticker (the owner only): hidden for everyone. */
const throwBuiltinLocal = async (
  key: string,
  el: HTMLElement,
  peel: Peel,
  start: Offset
) => {
  const fallen = await peel.fall(trashBox());
  await throwBuiltin({
    el,
    fallen,
    focusUndo: false,
    key,
    restore: () => setOffsetVars(el, start),
    scale: api?.getCamera().scale ?? 1,
  });
  peel.end();
};

/** A focused built-in, Delete / Backspace (the owner only). */
const throwFocusedBuiltin = (el: HTMLElement) => {
  const key = el.dataset.stickerKey;
  if (!key) {
    return;
  }
  const start = offsetOf(offsets, key);
  throwBuiltin({
    el,
    focusUndo: true,
    key,
    restore: () => setOffsetVars(el, start),
    scale: api?.getCamera().scale ?? 1,
  });
};

const startLocalDrag = (
  canvas: CanvasApi,
  el: HTMLElement,
  event: PointerEvent
) => {
  const key = keyOf(el);
  if (!key) {
    return;
  }
  const start = offsetOf(offsets, key);
  const scale = canvas.getCamera().scale || 1;
  let current = start;
  let moved = false;
  /** Fully peeled off: only then does it follow the pointer. */
  let held = false;
  // A visitor sticker this viewer may throw away (the owner outside
  // 整理贴纸, the uploader), or a built-in one for the owner: the trash
  // shows here too.
  const throwId = el.dataset.vsId;
  const builtinKey = throwId === undefined ? el.dataset.stickerKey : undefined;
  const throwable =
    throwId === undefined
      ? owner && builtinKey !== undefined
      : canThrow(throwId);
  let overTrash = false;
  const peel = beginPeel(canvas, el, event);
  el.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) {
      return;
    }
    const dx = e.clientX - event.clientX;
    const dy = e.clientY - event.clientY;
    if (!moved && Math.hypot(dx, dy) <= DRAG_SLOP) {
      return;
    }
    if (!moved) {
      moved = true;
      peel.lift();
    }
    if (!peel.move(e)) {
      return;
    }
    if (!held && throwable) {
      showTrash();
    }
    held = true;
    current = { dx: start.dx + dx / scale, dy: start.dy + dy / scale };
    setOffsetVars(el, current);
    if (throwable) {
      overTrash = isOver(trashBox(), { x: e.clientX, y: e.clientY });
      openTrash(overTrash);
      peel.hoverTrash(overTrash);
    }
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) {
      return;
    }
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    if (throwable && held && overTrash && e.type !== "pointercancel") {
      if (throwId) {
        throwLocal(throwId, el, peel, start);
      } else if (builtinKey) {
        throwBuiltinLocal(builtinKey, el, peel, start);
      }
      return;
    }
    hideTrash();
    let shift = { x: 0, y: 0 };
    if (e.type === "pointercancel") {
      peel.end();
    } else {
      shift = peel.drop();
    }
    // A click, or let go before it came off: it stays where it was.
    if (!held) {
      return;
    }
    // Lands where the curl drew it (on the pencil silhouette).
    current = {
      dx: current.dx + shift.x / scale,
      dy: current.dy + shift.y / scale,
    };
    offsets = withOffset(readOffsets(), key, current);
    writeOffsets(offsets);
    setOffsetVars(el, offsetOf(offsets, key));
    syncTools();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
};

const onPointerDown = (event: PointerEvent) => {
  const canvas = api;
  if (!canvas || event.button !== 0) {
    return;
  }
  const el = visitorSticker(event.target) ?? builtInSticker(event.target);
  if (!el) {
    return;
  }
  // The sticker moves, not the desk.
  event.stopPropagation();
  event.preventDefault();
  if (el.classList.contains("is-editable")) {
    startEdit(canvas, el, event);
  } else {
    startLocalDrag(canvas, el, event);
  }
};

/* ---------- keyboard, click, wheel ---------- */

const isDeleteKey = (event: KeyboardEvent) =>
  event.key === "Delete" || event.key === "Backspace";

const onKeyDown = (event: KeyboardEvent) => {
  const builtin = builtInSticker(event.target);
  if (owner && builtin && event.target === builtin && isDeleteKey(event)) {
    event.preventDefault();
    event.stopPropagation();
    throwFocusedBuiltin(builtin);
    return;
  }
  const record = selected;
  if (!record || event.target !== record.el) {
    return;
  }
  if (isDeleteKey(event) && canThrow(record.id)) {
    event.preventDefault();
    event.stopPropagation();
    throwRecord(record, true);
    return;
  }
  const change = keyChange(event, record.placement);
  if (!change) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  adjust(record, change);
  scheduleSave(record);
};

/**
 * Clicks select an editable sticker (pointer presses already did); Enter /
 * Space (detail 0) toggle it, matching its aria-pressed.
 */
const onClick = (event: MouseEvent) => {
  const el = visitorSticker(event.target);
  if (!el?.classList.contains("is-editable")) {
    return;
  }
  if (event.detail === 0 && selected?.el === el) {
    deselect();
    return;
  }
  select(el);
};

const onWheel = (event: WheelEvent) => {
  const record = selected;
  if (!record?.el.contains(elementOf(event.target))) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  adjust(record, { scale: wheelScale(record.placement.scale, event) });
  scheduleSave(record);
};

/** Esc or a press anywhere else lets go of the selected sticker. */
const onDocumentKey = (event: KeyboardEvent) => {
  if (event.key === "Escape" && selected && !event.defaultPrevented) {
    // Keep the drawer open (canvas.ts skips Esc that was handled).
    event.preventDefault();
    deselect();
  }
};

const onDocumentPointer = (event: PointerEvent) => {
  const target = elementOf(event.target);
  if (
    selected &&
    !selected.el.contains(target) &&
    !target?.closest(REVIEW_CARD)
  ) {
    deselect();
  }
};

/* ---------- 贴纸放回原位 ---------- */

const resetOffsets = () => {
  const world = api?.worldEl;
  const glide = !prefersReducedMotion();
  if (world) {
    for (const el of world.querySelectorAll<HTMLElement>(
      "[data-sticker-key], [data-sticker-layer] .vs"
    )) {
      const { dx, dy } = offsetOf(offsets, keyOf(el));
      if (dx === 0 && dy === 0) {
        continue;
      }
      if (glide) {
        el.classList.add("vs-gliding");
        window.setTimeout(() => el.classList.remove("vs-gliding"), GLIDE_MS);
      }
      setOffsetVars(el, { dx: 0, dy: 0 });
    }
  }
  offsets = {};
  writeOffsets(offsets);
  syncTools();
};

/* ---------- the owner ---------- */

/** The owner: logged in with GitHub as OWNER_GITHUB_ID, or via Access. */
const checkOwner = () => {
  if (!ownerCheck) {
    ownerCheck = isGithubOwner().then((yes) => yes || canModerate());
  }
  return ownerCheck;
};

/**
 * Ask again who this is (a login change, or an admin request answered 401 /
 * 403). Losing the owner turns 整理贴纸 off and lets go of a sticker that is
 * not one's own.
 */
export const recheckOwner = async () => {
  ownerCheck = null;
  resetModerate();
  const yes = await checkOwner();
  owner = yes;
  setBuiltinOwner(yes);
  if (!yes && isTidy()) {
    if (selected && !canMoveOwn(selected.id)) {
      deselect();
    }
    setTidy(false);
  }
  syncTools();
  return yes;
};

/** Logged out (or the owner logged in elsewhere): ask again. */
let seenOwner: boolean | undefined;
subscribeAuth((state) => {
  const changed = seenOwner !== undefined && seenOwner !== state.isOwner;
  seenOwner = state.isOwner;
  if (changed) {
    recheckOwner();
  }
});

/* ---------- warming up the curl ---------- */

const ANY_STICKER = "[data-sticker-layer] .vs, [data-sticker-key]";
/** Warm up at the latest this long (ms) after the desk shows stickers. */
const IDLE_TIMEOUT = 3000;
let warmed = false;

const warm = () => {
  if (!warmed) {
    warmed = true;
    warmPeel();
  }
};

/** A sticker is hovered or focused: it may be dragged next, fetch the curl. */
const onApproach = (event: Event) => {
  if (
    !warmed &&
    (visitorSticker(event.target) ?? builtInSticker(event.target))
  ) {
    warm();
  }
};

/**
 * The desk shows stickers anyone may drag: fetch the curl when the browser
 * is idle, so even a first touch (no hover) gets it. Not while the desk is
 * hidden (the phone's list view) or with reduced motion (no curl then).
 */
const warmWhenIdle = () => {
  const canvas = api;
  if (warmed || !canvas || prefersReducedMotion()) {
    return;
  }
  // display: none on the phone's list view and under a phone's drawer (the
  // canvas is not even published before it first shows).
  const world = canvas.worldEl;
  const shown = world.isConnected && world.getClientRects().length > 0;
  if (!(shown && world.querySelector(ANY_STICKER))) {
    return;
  }
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warm, { timeout: IDLE_TIMEOUT });
  } else {
    window.setTimeout(warm, IDLE_TIMEOUT);
  }
};

/* ---------- wiring ---------- */

const attach = (canvas: CanvasApi) => {
  api = canvas;
  // The trash sits next to the zoom buttons, outside the moving world.
  setTrashHost(canvas.viewportEl.parentElement);
  const world = canvas.worldEl;
  offsets = readOffsets();
  for (const el of world.querySelectorAll<HTMLElement>("[data-sticker-key]")) {
    setOffsetVars(el, offsetOf(offsets, keyOf(el)));
  }
  if (world.dataset.stickerEdit === undefined) {
    world.dataset.stickerEdit = "";
    world.addEventListener("pointerdown", onPointerDown);
    world.addEventListener("keydown", onKeyDown);
    world.addEventListener("click", onClick);
    world.addEventListener("wheel", onWheel, { passive: false });
    world.addEventListener("pointerover", onApproach);
    world.addEventListener("focusin", onApproach);
  }
  syncTools();
  warmWhenIdle();
  checkOwner().then((yes) => {
    owner = yes;
    setBuiltinOwner(yes);
    syncTools();
  });
};

const bindTools = () => {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-vs-tidy]:not([data-ready])"
  )) {
    button.dataset.ready = "";
    button.addEventListener("click", () => {
      const on = !isTidy();
      if (!on && selected && !canMoveOwn(selected.id)) {
        deselect();
      }
      setTidy(on);
      syncTools();
    });
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-vs-reset]:not([data-ready])"
  )) {
    button.dataset.ready = "";
    button.addEventListener("click", () => {
      resetOffsets();
      // The button hides itself; keep focus in the toolbar.
      document
        .querySelector<HTMLElement>("[data-vs-open]:not([hidden])")
        ?.focus({ preventScroll: true });
    });
  }
  syncTools();
};

document.addEventListener("keydown", onDocumentKey);
document.addEventListener("pointerdown", onDocumentPointer, true);
document.addEventListener("astro:page-load", bindTools);
window.addEventListener(STICKERS_RENDERED, reselect);
window.addEventListener(STICKERS_RENDERED, warmWhenIdle);
window.addEventListener(CANVAS_READY, (event) => attach(event.detail));
whenCanvasReady().then(attach);
bindTools();
