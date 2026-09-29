/**
 * Built-in stickers (`data-sticker-key` in Canvas.astro) the owner threw
 * into the trash are hidden on every visitor's canvas (docs/design.md
 * 「访客互动」). The list comes with GET /api/stickers (`hiddenBuiltins`,
 * stickers.ts hands it here); until it arrives the list this browser saw
 * last is used (builtin-hidden-store.ts), so a hidden sticker does not flash.
 *
 * Hidden = `.is-thrown-away` (visibility: hidden in StickerLayer.astro): the
 * box stays, so nothing on the canvas moves, and it is out of the tab order,
 * the accessibility tree and hit-testing at once.
 *
 * For the owner (sticker-edit.ts `setBuiltinOwner`) the shown built-ins are
 * focusable, labelled and announce Delete: sticker-edit.ts throws the
 * focused one away (sticker-trash.ts `throwBuiltin`). Nothing here sends a
 * request.
 */
import { builtinByKey } from "@/lib/builtin-stickers";
import { CANVAS_READY, whenCanvasReady } from "@/scripts/canvas/api";
import {
  type HiddenCache,
  hiddenKeys,
  readHiddenCache,
  withChange,
  withServerKeys,
  writeHiddenCache,
} from "./builtin-hidden-store";

const HIDDEN_CLASS = "is-thrown-away";
const SELECTOR = "[data-sticker-key]";

let cache: HiddenCache = readHiddenCache();
/** Thrown into the trash, waiting for 撤销 to run out. */
const thrown = new Set<string>();
/** The viewer is the owner: built-ins are focusable and can be thrown. */
let ownerMode = false;

const labels = builtinByKey();

const ownerLabel = (key: string) =>
  `${labels.get(key)?.label ?? "贴纸"}（自带贴纸）。按 Delete 扔进垃圾桶，所有访客都看不到它，可以在审核台恢复`;

const setOwnerAttributes = (el: HTMLElement, key: string, on: boolean) => {
  if (on) {
    el.tabIndex = 0;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", ownerLabel(key));
    el.setAttribute("aria-keyshortcuts", "Delete Backspace");
    return;
  }
  el.removeAttribute("tabindex");
  el.removeAttribute("role");
  el.removeAttribute("aria-label");
  el.removeAttribute("aria-keyshortcuts");
};

/** Hides / shows every built-in on the page to match the list. */
export const applyHidden = () => {
  const hidden = hiddenKeys(cache, Date.now());
  for (const key of thrown) {
    hidden.add(key);
  }
  for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
    const key = el.dataset.stickerKey ?? "";
    const gone = hidden.has(key);
    el.classList.toggle(HIDDEN_CLASS, gone);
    if (gone) {
      el.setAttribute("aria-hidden", "true");
    } else {
      el.removeAttribute("aria-hidden");
    }
    setOwnerAttributes(el, key, ownerMode && !gone);
  }
};

/** GET /api/stickers answered with this list. */
export const setServerHidden = (keys: unknown) => {
  cache = withServerKeys(cache, keys, Date.now());
  writeHiddenCache(cache);
  applyHidden();
};

/** POST /api/builtins took the change (`keys`: the server's whole list). */
export const confirmBuiltinChange = (
  key: string,
  hidden: boolean,
  keys: unknown
) => {
  const now = Date.now();
  cache = withChange(withServerKeys(cache, keys, now), key, hidden, now);
  thrown.delete(key);
  writeHiddenCache(cache);
  applyHidden();
};

/**
 * The hide request is on its way (maybe with keepalive while the page is
 * left): remember it now, so this browser keeps it hidden on the next load
 * even if the response is never read. `failed`: it did not go through.
 */
export const expectBuiltinHidden = (key: string, failed = false) => {
  const now = Date.now();
  if (failed) {
    const { [key]: _mine, ...recent } = cache.recent;
    cache = { keys: cache.keys.filter((entry) => entry !== key), recent };
  } else {
    cache = withChange(cache, key, true, now);
  }
  writeHiddenCache(cache);
};

/** Into the trash: hidden while 已扔掉 · 撤销 is up. */
export const hideThrownBuiltin = (key: string) => {
  thrown.add(key);
  applyHidden();
};

/** 撤销, or the request failed: shown again. */
export const unhideThrownBuiltin = (key: string) => {
  if (thrown.delete(key)) {
    applyHidden();
  }
};

/** sticker-edit.ts: whether this viewer is the owner. */
export const setBuiltinOwner = (on: boolean) => {
  if (ownerMode !== on) {
    ownerMode = on;
    applyHidden();
  }
};

export const isBuiltinOwner = () => ownerMode;

// The canvas is server-rendered and persisted across navigations: hide from
// the cached list right away, and again whenever a canvas is (re)published.
applyHidden();
window.addEventListener(CANVAS_READY, applyHidden);
document.addEventListener("astro:after-swap", applyHidden);
whenCanvasReady().then(applyHidden);
