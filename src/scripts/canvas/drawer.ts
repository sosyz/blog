/**
 * Drawer motion. The drawer is part of each /notes/<slug>/ page, so the
 * router replaces it on every navigation; these helpers make that look like
 * one drawer that slides in, swaps its page, and slides out.
 */
import { prefersReducedMotion } from "./api";

/** Near-invisible overshoot, as in the prototype. */
const SPRING = "cubic-bezier(.22, 1.06, .36, 1)";
const OUT = "cubic-bezier(.2, .8, .2, 1)";
const SLIDE_MS = 400;
export const FADE_MS = 140;
const OFFSCREEN = "translateX(calc(100% + 30px))";

const NOTE_PATH = /^\/notes\/([^/]+)\/?$/;

/** `/notes/go-context/` → `go-context`; anything else → null. */
export const noteSlugFromPath = (pathname: string) => {
  const match = NOTE_PATH.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

export interface DrawerParts {
  bodyEl: HTMLElement;
  drawerEl: HTMLElement;
  pageEl: HTMLElement;
  scrollEl: HTMLElement;
  slug: string;
}

/** The drawer on the current page, if this page shows a note. */
export const findDrawer = (): DrawerParts | null => {
  const drawerEl = document.querySelector<HTMLElement>(
    "[data-drawer]:not([data-leaving])"
  );
  const scrollEl = drawerEl?.querySelector<HTMLElement>("[data-drawer-scroll]");
  const pageEl = drawerEl?.querySelector<HTMLElement>("[data-drawer-page]");
  const bodyEl = drawerEl?.querySelector<HTMLElement>("[data-post-body]");
  const slug = drawerEl?.dataset.slug;
  if (!(drawerEl && scrollEl && pageEl && bodyEl && slug)) {
    return null;
  }
  return { bodyEl, drawerEl, pageEl, scrollEl, slug };
};

export const slideIn = (drawer: HTMLElement) => {
  if (prefersReducedMotion()) {
    return;
  }
  drawer.animate([{ transform: OFFSCREEN }, { transform: "none" }], {
    duration: SLIDE_MS,
    easing: SPRING,
  });
};

/** Slide a leaving drawer off to the right, then remove it. */
export const slideOut = (drawer: HTMLElement) => {
  if (prefersReducedMotion()) {
    drawer.remove();
    return;
  }
  drawer
    .animate([{ transform: "none" }, { transform: OFFSCREEN }], {
      duration: SLIDE_MS,
      easing: SPRING,
      fill: "forwards",
    })
    .finished.then(
      () => drawer.remove(),
      () => drawer.remove()
    );
};

/** The page inside the drawer fades out before a note switch… */
export const fadeOutPage = (page: HTMLElement) => {
  if (prefersReducedMotion()) {
    return;
  }
  page.animate(
    [
      { opacity: 1, translate: "0 0" },
      { opacity: 0, translate: "0 5px" },
    ],
    { duration: FADE_MS, easing: OUT, fill: "forwards" }
  );
};

/** …and the new one fades in; the drawer itself does not move. */
export const fadeInPage = (page: HTMLElement) => {
  if (prefersReducedMotion()) {
    return;
  }
  page.animate(
    [
      { opacity: 0, translate: "0 5px" },
      { opacity: 1, translate: "0 0" },
    ],
    { duration: FADE_MS, easing: OUT }
  );
};

/**
 * Keep the old drawer on screen while the router swaps the page to one
 * without a drawer, so it can slide out. It is inert and stripped of the
 * hooks other scripts look for (`data-post-body`, ids).
 */
export const carryOverLeavingDrawer = (newDocument: Document) => {
  const old = findDrawer();
  if (!old || prefersReducedMotion()) {
    return;
  }
  const { drawerEl } = old;
  drawerEl.setAttribute("data-leaving", "");
  drawerEl.inert = true;
  drawerEl.setAttribute("aria-hidden", "true");
  for (const el of drawerEl.querySelectorAll("[id], [data-post-body]")) {
    el.removeAttribute("id");
    el.removeAttribute("data-post-body");
  }
  drawerEl.removeAttribute("id");
  newDocument.body.appendChild(drawerEl);
};
