/**
 * 落点: while a peeled sticker is carried, a faint pencil silhouette on the
 * paper shows where it lands if it is let go now. The carried sticker is
 * drawn curled up and lifted (its shadow falls away from it), so without
 * this the spot is a guess until it is pressed down.
 *
 * The mark is a copy of the sticker element right after it, so the same CSS
 * places it (left / top, --dx / --dy, --w, --r, the `.vs` translate). Only
 * presentational attributes are kept: no data-* (layout.ts and the trash
 * look stickers up by them), no id, focus or ARIA; it is inert and hidden
 * from assistive tech. A MutationObserver copies the element's inline style
 * as the drag moves it, without the CSS fallback's glide (--peel-lag-*),
 * which only shows the hand catching up, not where it lands.
 *
 * Used by sticker-peel.ts: shown once the sticker is off, hidden over the
 * trash, faded out when it is let go, removed when the gesture ends. Styled
 * in StickerLayer.astro (`.peel-landing`).
 */

const MARK = "peel-landing";
const SHOWN = "is-shown";
/** How long the fade out takes (ms); matches `.peel-landing` in StickerLayer.astro. */
const FADE_MS = 160;

/** Attributes the copy keeps: what draws and places it, nothing that names it. */
const KEPT = new Set([
  "class",
  "decoding",
  "height",
  "sizes",
  "src",
  "srcset",
  "style",
  "width",
]);

/** The drag's own state on the element; the mark is the sticker at rest. */
const STATE_CLASSES = [
  "is-editable",
  "is-lifted",
  "is-peeling",
  "is-selected",
  "is-sticking",
  "is-tugged",
  "vs-gliding",
];

const LAG = /(?:^|;)\s*--peel-lag-[xy]\s*:[^;]*/g;
const LEADING_SEPARATOR = /^\s*;\s*/;

/** The element's inline style without the glide into the hand. */
export const restingStyle = (cssText: string) =>
  cssText.replace(LAG, "").replace(LEADING_SEPARATOR, "").trim();

/** Whether the copy keeps an attribute of the sticker element. */
export const keepsAttribute = (name: string) => KEPT.has(name);

const strip = (root: HTMLElement) => {
  for (const { name } of [...root.attributes]) {
    if (!keepsAttribute(name)) {
      root.removeAttribute(name);
    }
  }
  root.classList.remove(...STATE_CLASSES);
  for (const child of root.querySelectorAll("[id], [tabindex], [data-vs-id]")) {
    child.removeAttribute("id");
    child.removeAttribute("tabindex");
  }
  for (const img of root.querySelectorAll("img")) {
    img.alt = "";
  }
  if (root instanceof HTMLImageElement) {
    root.alt = "";
  }
};

export interface Landing {
  /** Let go: fades out, then goes away. */
  fade: () => void;
  /** Gone now (thrown, cancelled, re-rendered). */
  remove: () => void;
  /** Shown or hidden (over the trash) while it is carried. */
  show: (on: boolean) => void;
}

/** A mark for `el`, hidden until `show(true)`. */
export const createLanding = (el: HTMLElement): Landing => {
  const mark = el.cloneNode(true) as HTMLElement;
  strip(mark);
  mark.classList.add(MARK);
  // Built-in stickers get their offset from [data-sticker-key], which the
  // copy does not have.
  if (el.dataset.stickerKey !== undefined) {
    mark.classList.add(`${MARK}-builtin`);
  }
  mark.inert = true;
  mark.setAttribute("aria-hidden", "true");
  mark.setAttribute("style", restingStyle(el.getAttribute("style") ?? ""));
  el.insertAdjacentElement("afterend", mark);

  const observer = new MutationObserver(() => {
    mark.setAttribute("style", restingStyle(el.getAttribute("style") ?? ""));
  });
  observer.observe(el, { attributeFilter: ["style"] });

  let timer = 0;
  const remove = () => {
    window.clearTimeout(timer);
    observer.disconnect();
    mark.remove();
  };

  return {
    fade: () => {
      observer.disconnect();
      mark.classList.remove(SHOWN);
      window.clearTimeout(timer);
      timer = window.setTimeout(remove, FADE_MS);
    },
    remove,
    show: (on) => {
      mark.classList.toggle(SHOWN, on);
    },
  };
};
