/**
 * Approved visitor stickers on the canvas, at their world position, plus the
 * visitor's own pending ones (dashed, 审核中).
 *
 * Stickers this browser uploaded (sticker-store.ts keeps their edit tokens),
 * stickers of the logged-in GitHub account (from the server, any device) and,
 * in the owner's 整理贴纸 mode, all visitor stickers are rendered as buttons
 * with rotate / resize handles; sticker-edit.ts does the moving.
 * Everyone else's stickers are plain elements that can only be dragged
 * locally (an offset in this browser, see sticker-offsets.ts).
 *
 * With an Access session (review-stickers.ts, owner.ts `canModerate()`),
 * every pending sticker is shown too (dashed, 待审) as a button, so the owner
 * can select it and approve or reject it where it would go.
 *
 * The same response lists the built-in stickers the owner threw away
 * (`hiddenBuiltins`); builtin-hidden.ts hides them.
 *
 * The layer element (StickerLayer.astro) lives inside the persisted canvas;
 * it is attached to `CanvasApi.worldEl` (src/scripts/canvas/api.ts) so its
 * children use world px. Set up once per layer element; a new canvas (after
 * visiting a page without one) gets a new layer and is set up again.
 */
import { stickerDisplayWidth } from "@/lib/server/image-header";
import type { AdminSticker, StickersResponse } from "@/lib/server/types";
import {
  CANVAS_READY,
  type CanvasApi,
  whenCanvasReady,
} from "@/scripts/canvas/api";
import { getAuth, subscribe as subscribeAuth } from "./auth";
import { setServerHidden } from "./builtin-hidden";
import { STICKERS_CHANGED, STICKERS_RENDERED } from "./events";
import { offsetOf, readOffsets, visitorStickerKey } from "./sticker-offsets";
import { withoutIds } from "./sticker-review";
import {
  keepOwnedStickers,
  type PendingSticker,
  readOwnedStickers,
  readPendingStickers,
  writePendingStickers,
} from "./sticker-store";
import {
  type EditPlacement,
  HANDLES_HTML,
  KEY_HELP,
} from "./sticker-transform";
import { esc, requestJson } from "./util";

export type Shown = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  width: number;
  height: number;
  name: string | null;
  src: string;
  pending: boolean;
  /** Pending and shown to the owner for review (待审). */
  review?: boolean;
};

/** At most this many ids in `mine=` (the server reads 50). */
const MAX_MINE = 50;

let approved: Shown[] = [];
/** Logged in: this account's pending stickers (served to it by id). */
let accountPending: Shown[] = [];
/** Logged in: ids of this account's stickers (movable without a token). */
let accountOwned = new Set<string>();
/** The owner's 整理贴纸 mode: every visitor sticker can be moved for all. */
let tidy = false;
/** With an Access session: every pending sticker (review-stickers.ts). */
let reviewPending: Shown[] = [];
/** The sticker a review link points at: selectable even when approved. */
let reviewFocus: string | null = null;
let loading: Promise<void> | null = null;
/** Thrown into the trash, waiting for 撤销 to run out (sticker-trash.ts). */
const thrown = new Set<string>();

export const isTidy = () => tidy;

/** The logged-in GitHub account uploaded this sticker. */
export const isAccountOwned = (id: string) => accountOwned.has(id);

type Context = {
  owned: Set<string>;
  offsets: ReturnType<typeof readOffsets>;
};

/** Everyone who can select a visitor sticker may also throw it away. */
const THROW_HELP = "Delete 扔进垃圾桶";

const labelFor = (item: Shown, own: boolean) => {
  if (item.review) {
    const from = item.name ? `来自 ${item.name} 的待审贴纸` : "待审贴纸";
    return `${from}。按回车选中，然后可以通过，或者${THROW_HELP}（拒绝）；也能${KEY_HELP}`;
  }
  if (own) {
    return `你的贴纸。按回车选中，然后${KEY_HELP}，${THROW_HELP}，Esc 取消选中`;
  }
  const from = item.name ? `来自 ${item.name} 的贴纸` : "访客贴纸";
  return `${from}。整理贴纸：按回车选中，然后${KEY_HELP}，${THROW_HELP}，Esc 取消选中`;
};

const titleFor = (item: Shown, own: boolean, editable: boolean) => {
  if (item.review) {
    return "待审：选中后可以通过或拒绝";
  }
  if (own) {
    return "你的贴纸，可以挪动";
  }
  if (editable) {
    return "整理贴纸：拖动会替所有人挪动";
  }
  return item.name ? `来自 ${item.name}` : "访客贴纸";
};

const tagHtml = (item: Shown) => {
  if (item.review) {
    return '<span class="vs-tag">待审</span>';
  }
  return item.pending ? '<span class="vs-tag">审核中</span>' : "";
};

const stickerHtml = (item: Shown, context: Context) => {
  const width = stickerDisplayWidth(item.width, item.scale);
  const height = Math.round((width * item.height) / item.width);
  const own = context.owned.has(item.id);
  const editable =
    own || tidy || item.review === true || item.id === reviewFocus;
  const { dx, dy } = offsetOf(context.offsets, visitorStickerKey(item.id));
  const classes = [
    "vs",
    item.pending ? "pending" : "",
    item.review ? "is-review" : "",
    own ? "is-own" : "",
    editable ? "is-editable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const attributes = `class="${classes}" data-vs-id="${esc(item.id)}" data-x="${item.x}" data-y="${item.y}" data-rotation="${item.rotation}" data-scale="${item.scale}" data-width="${item.width}" data-height="${item.height}" title="${esc(titleFor(item, own, editable))}" style="left: ${item.x}px; top: ${item.y}px; --w: ${width}px; --r: ${item.rotation}deg; --dx: ${dx}px; --dy: ${dy}px"`;
  const inner = `<img src="${esc(item.src)}" alt="" width="${width}" height="${height}" loading="lazy" decoding="async" draggable="false" />
    ${tagHtml(item)}`;
  if (!editable) {
    return `<div ${attributes}>${inner}</div>`;
  }
  return `<button type="button" ${attributes} aria-pressed="false" aria-label="${esc(labelFor(item, own))}">${inner}${HANDLES_HTML}</button>`;
};

const pendingShown = (items: PendingSticker[]): Shown[] =>
  items.map((item) => ({ ...item, src: item.dataUrl, pending: true }));

const render = (layer: HTMLElement) => {
  const local = pendingShown(readPendingStickers());
  const localIds = new Set(local.map((item) => item.id));
  const mine = withoutIds(
    [...local, ...accountPending.filter((item) => !localIds.has(item.id))],
    // The review copy (or, once approved, the public copy) wins.
    [...reviewPending, ...approved].map((item) => item.id)
  );
  const context: Context = {
    owned: new Set([
      ...readOwnedStickers().map((item) => item.id),
      ...accountOwned,
    ]),
    offsets: readOffsets(),
  };
  layer.innerHTML = [...approved, ...mine, ...reviewPending]
    .filter((item) => !thrown.has(item.id))
    .map((item) => stickerHtml(item, context))
    .join("");
  window.dispatchEvent(new CustomEvent(STICKERS_RENDERED));
};

const rerender = () => {
  const layer = document.querySelector<HTMLElement>(
    "[data-sticker-layer][data-ready]"
  );
  if (layer) {
    render(layer);
  }
};

/** The owner switched 整理贴纸 on or off. */
export const setTidy = (on: boolean) => {
  if (tidy !== on) {
    tidy = on;
    rerender();
  }
};

/**
 * A sticker was moved (and saved): keep the layer's copy in step so the
 * next render puts it in the same place.
 */
export const updateShown = (id: string, placement: EditPlacement) => {
  const item =
    approved.find((entry) => entry.id === id) ??
    reviewPending.find((entry) => entry.id === id) ??
    accountPending.find((entry) => entry.id === id);
  if (item) {
    Object.assign(item, placement);
  }
};

/* ---------- reviewing in place (review-stickers.ts) ---------- */

/** Resolves once the layer has asked the server for its stickers. */
export const whenStickersLoaded = () => loading ?? Promise.resolve();

/** A sticker on the layer (approved, own pending or under review). */
export const findShown = (id: string) =>
  reviewPending.find((item) => item.id === id) ??
  approved.find((item) => item.id === id) ??
  accountPending.find((item) => item.id === id) ??
  null;

/** Access session present: show these pending stickers; null hides them. */
export const setReviewPending = (items: AdminSticker[] | null) => {
  reviewPending = (items ?? []).map((item) => ({
    id: item.id,
    x: item.x,
    y: item.y,
    rotation: item.rotation,
    scale: item.scale,
    width: item.width,
    height: item.height,
    name: item.name,
    src: item.src,
    pending: true,
    review: true,
  }));
  if (!items) {
    reviewFocus = null;
  }
  rerender();
};

/** A review link points at this sticker: make it selectable. */
export const setReviewFocus = (id: string | null) => {
  if (reviewFocus !== id) {
    reviewFocus = id;
    rerender();
  }
};

/** Approved in place: now a normal sticker (others see it after the cache). */
export const markApproved = (id: string) => {
  const item = findShown(id);
  if (!item) {
    return;
  }
  reviewPending = reviewPending.filter((entry) => entry.id !== id);
  accountPending = accountPending.filter((entry) => entry.id !== id);
  if (reviewFocus === id) {
    reviewFocus = null;
  }
  if (!approved.some((entry) => entry.id === id)) {
    approved = [...approved, { ...item, pending: false, review: false }];
  }
  rerender();
};

/** Thrown into the trash: hidden until 撤销 or the real delete. */
export const hideShown = (id: string) => {
  thrown.add(id);
  rerender();
};

/** 撤销, or the delete failed: show it again. */
export const unhideShown = (id: string) => {
  if (thrown.delete(id)) {
    rerender();
  }
};

/** Rejected, taken down or deleted: gone for good (the image is deleted). */
export const removeShown = (id: string) => {
  thrown.delete(id);
  reviewPending = reviewPending.filter((entry) => entry.id !== id);
  approved = approved.filter((entry) => entry.id !== id);
  accountPending = accountPending.filter((entry) => entry.id !== id);
  accountOwned.delete(id);
  if (reviewFocus === id) {
    reviewFocus = null;
  }
  // The owner's own upload: forget its pending copy and edit token too.
  writePendingStickers(readPendingStickers().filter((item) => item.id !== id));
  keepOwnedStickers((item) => item.id !== id);
  rerender();
};

const load = async (layer: HTMLElement) => {
  const pending = readPendingStickers();
  const owned = readOwnedStickers();
  const ids = [
    ...new Set([
      ...pending.map((item) => item.id),
      ...owned.map((item) => item.id),
    ]),
  ].slice(-MAX_MINE);
  const params = new URLSearchParams();
  if (ids.length > 0) {
    params.set("mine", ids.join(","));
  }
  // Logged in: a URL of its own, so a cached anonymous copy is never reused.
  if ((await getAuth()).user) {
    params.set("me", "1");
  }
  const query = params.size > 0 ? `?${params}` : "";
  const result = await requestJson<StickersResponse>(`/api/stickers${query}`);
  if (!result.ok) {
    render(layer);
    return;
  }
  const { stickers, mine } = result.data;
  // Built-in stickers the owner threw away: hidden here too.
  setServerHidden(result.data.hiddenBuiltins ?? []);
  approved = stickers.map((item) => ({ ...item, pending: false }));
  accountPending = (result.data.ownPending ?? []).map((item) => ({
    ...item,
    pending: true,
  }));
  accountOwned = new Set(result.data.owned ?? []);
  writePendingStickers(pending.filter((item) => mine[item.id] === "pending"));
  // Rejected (or deleted) stickers cannot be moved any more.
  keepOwnedStickers(
    (item) =>
      !ids.includes(item.id) ||
      mine[item.id] === "pending" ||
      mine[item.id] === "approved"
  );
  render(layer);
};

const attach = (api: CanvasApi) => {
  const layer =
    api.worldEl.querySelector<HTMLElement>("[data-sticker-layer]") ??
    document.querySelector<HTMLElement>("[data-sticker-layer]");
  if (!layer || layer.dataset.ready !== undefined) {
    return;
  }
  layer.dataset.ready = "";
  if (!api.worldEl.contains(layer)) {
    api.worldEl.appendChild(layer);
  }
  layer.hidden = false;
  loading = load(layer);
};

/** Logged out (or in as someone else): the account's stickers change. */
let seenLogin: string | null | undefined;
subscribeAuth((state) => {
  const login = state.user?.login ?? null;
  const changed = seenLogin !== undefined && seenLogin !== login;
  seenLogin = login;
  const layer = document.querySelector<HTMLElement>(
    "[data-sticker-layer][data-ready]"
  );
  if (changed && layer) {
    loading = load(layer);
  }
});

window.addEventListener(STICKERS_CHANGED, rerender);
window.addEventListener(CANVAS_READY, (event) => attach(event.detail));
whenCanvasReady().then(attach);
