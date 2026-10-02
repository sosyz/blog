/**
 * The canvas: layout, camera, input, hover, search and the drawer lifecycle
 * across <ClientRouter /> navigations.
 *
 * The canvas root is `transition:persist="canvas"`, so one controller lives
 * as long as its root element does. Pages without a canvas (/list/) drop it;
 * coming back creates a fresh one. The drawer belongs to each note page and
 * is swapped by the router; the hooks at the bottom make the swap look like
 * one drawer (slide in, fade between notes, slide out) and emit the drawer
 * events from ./api.
 */
import { navigate } from "astro:transitions/client";
import {
  type CanvasApi,
  emitDrawerClose,
  emitDrawerOpen,
  emitDrawerRendered,
  prefersReducedMotion,
  publishCanvas,
} from "./api";
import { type Cam, createCamera } from "./camera";
import {
  carryOverLeavingDrawer,
  FADE_MS,
  fadeInPage,
  fadeOutPage,
  findDrawer,
  noteSlugFromPath,
  slideIn,
  slideOut,
} from "./drawer";
import { bindInput } from "./input";
import {
  drawLinks,
  isRendered,
  type Layout,
  layoutWorld,
  onRendered,
  setStagger,
} from "./layout";
import { fitsIn, isOutside, panToShow } from "./reveal";
import {
  applyHomeView,
  getQuery,
  matches,
  onQuery,
  visibleView,
} from "./store";

/** Longest entrance (stagger + animation), after which `.enter` goes. */
const ENTER_MS = 1300;
/** Wait this long at most for web fonts before the first layout. */
const FONT_WAIT_MS = 900;
const RELAYOUT_DEBOUNCE_MS = 120;
const SEARCH_GLIDE_DELAY_MS = 320;
/**
 * At this width and below the drawer covers the canvas: centre the card
 * instead, and make the canvas and toolbar inert (syncCovered).
 */
const WIDE_ENOUGH_FOR_SIDE_BY_SIDE = 820;
const DRAWER_MAX_WIDTH = 600;
const DRAWER_GUTTER = 24;
const FOCUS_MIN_SCALE = 0.85;
const HOME_NARROW = 700;
const HOME_NARROW_SCALE = 0.8;
const HOME_OFFSET_Y = 20;
const ZOOM_STEP = 1.25;

const notePath = (slug: string) => `/notes/${slug}/`;

const go = (href: string) => {
  navigate(href).catch(() => {
    window.location.assign(href);
  });
};

const closeNote = () => go("/");

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const query = <T extends Element>(root: Element, selector: string) => {
  const el = root.querySelector<T>(selector);
  if (!el) {
    throw new Error(`canvas: missing ${selector}`);
  }
  return el;
};

const slugOf = (el: Element | null) =>
  el instanceof HTMLElement ? (el.dataset.slug ?? null) : null;

const createCanvas = (root: HTMLElement) => {
  const viewport = query<HTMLElement>(root, "[data-viewport]");
  const world = query<HTMLElement>(root, "[data-world]");
  const camera = createCamera(
    query<HTMLElement>(root, "[data-desk]"),
    world,
    root.querySelector("[data-zoom-pct]")
  );
  const cleanups: (() => void)[] = [];
  let layout: Layout | null = null;
  let current: string | null = null;
  let userMoved = false;
  let dragging = false;
  let searchTimer = 0;
  let relayoutTimer = 0;
  /** Hidden (phone list view, drawer over it): lay out once it shows. */
  let waitingToReveal = false;
  let stale = false;

  const vw = () => viewport.clientWidth || window.innerWidth;
  const vh = () => viewport.clientHeight || window.innerHeight;

  const home = (): Cam => ({
    x: vw() / 2,
    y: vh() / 2 + HOME_OFFSET_Y,
    s: vw() < HOME_NARROW ? HOME_NARROW_SCALE : 1,
  });

  /** Width of the desk left of the drawer, or 0 when the drawer covers it. */
  const freeWidth = () => {
    const w = vw();
    if (w <= WIDE_ENOUGH_FOR_SIDE_BY_SIDE) {
      return 0;
    }
    return w - (Math.min(DRAWER_MAX_WIDTH, w - DRAWER_GUTTER) + DRAWER_GUTTER);
  };

  const cardEls = () => world.querySelectorAll<HTMLElement>("[data-card]");

  const cardFor = (slug: string) =>
    [...cardEls()].find((el) => el.dataset.slug === slug) ?? null;

  /** Camera that puts a card in the middle of the free desk. */
  const focusCam = (slug: string, keepLeftOf: number): Cam | null => {
    const box = layout?.cards.get(slug);
    if (!box) {
      return null;
    }
    const s = Math.max(camera.get().s, FOCUS_MIN_SCALE);
    const sx = keepLeftOf ? keepLeftOf / 2 : vw() / 2;
    return {
      x: sx - (box.x + box.w / 2) * s,
      y: vh() / 2 - (box.y + box.h / 2) * s,
      s,
    };
  };

  const focusCard = (slug: string, keepLeftOf: number, instant = false) => {
    const to = focusCam(slug, keepLeftOf);
    if (!to) {
      return;
    }
    if (instant) {
      camera.set(to);
    } else {
      camera.glide(to);
    }
  };

  /* ---------- related lines ---------- */

  const heat = (slug: string, on: boolean) => {
    for (const path of world.querySelectorAll<SVGPathElement>(
      "[data-links] path"
    )) {
      if (path.dataset.a === slug || path.dataset.b === slug) {
        path.classList.toggle("hot", on);
      }
    }
  };

  const setCurrent = (slug: string | null) => {
    if (current === slug) {
      return;
    }
    if (current) {
      cardFor(current)?.classList.remove("current");
      heat(current, false);
    }
    current = slug;
    if (slug) {
      cardFor(slug)?.classList.add("current");
      heat(slug, true);
    }
  };

  const onOver = (e: PointerEvent) => {
    const slug = slugOf(
      e.target instanceof Element ? e.target.closest("[data-card]") : null
    );
    if (slug && !dragging) {
      heat(slug, true);
    }
  };

  const onOut = (e: PointerEvent) => {
    const card =
      e.target instanceof Element ? e.target.closest("[data-card]") : null;
    const slug = slugOf(card);
    const into = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (slug && slug !== current && !card?.contains(into)) {
      heat(slug, false);
    }
  };

  /**
   * Pan so a focused card, intro-card link or sticker is on the visible desk
   * (left of the drawer when one is open). Cards use their layout box; a
   * link on the intro card brings the whole card into view when it fits.
   */
  const showFocused = (el: Element, slug: string | null) => {
    const keepLeftOf = findDrawer() ? freeWidth() : 0;
    const area = { width: keepLeftOf || vw(), height: vh() };
    const box = el.getBoundingClientRect();
    if (!isOutside(box, area)) {
      return;
    }
    if (slug) {
      focusCard(slug, keepLeftOf);
      return;
    }
    const intro = el.closest("[data-intro]")?.getBoundingClientRect();
    const target = intro && fitsIn(intro, area) ? intro : box;
    camera.glide(panToShow(camera.get(), target, area));
  };

  const onFocusIn = (e: FocusEvent) => {
    if (!(e.target instanceof Element)) {
      return;
    }
    const card = e.target.closest("[data-card]");
    const slug = slugOf(card);
    if (slug) {
      heat(slug, true);
    }
    // Only for keyboard focus: moving the camera under the pointer would
    // make the click miss.
    if (e.target.matches(":focus-visible")) {
      showFocused(card ?? e.target, slug);
    }
  };

  const onFocusOut = (e: FocusEvent) => {
    const slug = slugOf(
      e.target instanceof Element ? e.target.closest("[data-card]") : null
    );
    if (slug && slug !== current) {
      heat(slug, false);
    }
  };

  world.addEventListener("pointerover", onOver);
  world.addEventListener("pointerout", onOut);
  world.addEventListener("focusin", onFocusIn);
  world.addEventListener("focusout", onFocusOut);
  cleanups.push(() => {
    world.removeEventListener("pointerover", onOver);
    world.removeEventListener("pointerout", onOut);
    world.removeEventListener("focusin", onFocusIn);
    world.removeEventListener("focusout", onFocusOut);
  });

  /* ---------- input ---------- */

  cleanups.push(
    bindInput({
      viewport,
      camera,
      onEmptyClick: () => {
        if (findDrawer()) {
          closeNote();
        }
      },
      onUserMove: () => {
        userMoved = true;
      },
      isDragging: (value) => {
        dragging = value;
      },
    })
  );

  const zoomButton = (selector: string, action: () => void) => {
    const button = root.querySelector<HTMLButtonElement>(selector);
    if (!button) {
      return;
    }
    const onClick = () => {
      userMoved = true;
      action();
    };
    button.addEventListener("click", onClick);
    cleanups.push(() => button.removeEventListener("click", onClick));
  };
  zoomButton("[data-zoom-in]", () =>
    camera.zoomAt(vw() / 2, vh() / 2, ZOOM_STEP, true)
  );
  zoomButton("[data-zoom-out]", () =>
    camera.zoomAt(vw() / 2, vh() / 2, 1 / ZOOM_STEP, true)
  );
  zoomButton("[data-zoom-home]", () => {
    camera.glide(home());
    userMoved = false;
  });

  const onResize = () => {
    if (!(current || userMoved)) {
      camera.set(home());
    }
  };
  window.addEventListener("resize", onResize);
  cleanups.push(() => window.removeEventListener("resize", onResize));

  /* ---------- search: dim the rest, glide to the first hit ---------- */

  const applySearch = (term: string) => {
    let first: string | null = null;
    for (const card of cardEls()) {
      const hit = matches(card, term);
      card.classList.toggle("dim", !hit);
      // Faded misses leave the Tab order; they are still a click away.
      if (hit) {
        card.removeAttribute("tabindex");
      } else {
        card.tabIndex = -1;
      }
      if (hit && !first) {
        first = card.dataset.slug ?? null;
      }
    }
    clearTimeout(searchTimer);
    if (term && first && layout && visibleView() === "canvas") {
      const target = first;
      searchTimer = window.setTimeout(() => {
        userMoved = true;
        focusCard(target, findDrawer() ? freeWidth() : 0);
      }, SEARCH_GLIDE_DELAY_MS);
    }
  };
  cleanups.push(onQuery(applySearch));

  /* ---------- layout and entrance ---------- */

  const relayout = () => {
    if (!isRendered(world)) {
      stale = true;
      return;
    }
    stale = false;
    layout = layoutWorld(world);
    drawLinks(world, layout);
    if (current) {
      heat(current, true);
    }
  };

  const enter = () => {
    if (prefersReducedMotion()) {
      return;
    }
    setStagger(world, camera.get());
    world.classList.add("enter");
    const timer = window.setTimeout(
      () => world.classList.remove("enter"),
      ENTER_MS
    );
    cleanups.push(() => clearTimeout(timer));
  };

  const api: CanvasApi = {
    viewportEl: viewport,
    worldEl: world,
    screenToWorld: ({ x, y }) => {
      const c = camera.get();
      return { x: (x - c.x) / c.s, y: (y - c.y) / c.s };
    },
    worldToScreen: ({ x, y }) => {
      const c = camera.get();
      return { x: x * c.s + c.x, y: y * c.s + c.y };
    },
    getCamera: () => {
      const c = camera.get();
      return { x: c.x, y: c.y, scale: c.s };
    },
    onCameraChange: camera.onChange,
    panTo: (point, options) => {
      const s = options?.scale ?? camera.get().s;
      camera.glide({ x: vw() / 2 - point.x * s, y: vh() / 2 - point.y * s, s });
    },
    currentNote: () => current,
    openNote: (slug) => go(notePath(slug)),
    closeNote,
  };

  const reveal = () => {
    if (!root.isConnected) {
      return;
    }
    waitingToReveal = !isRendered(world);
    if (waitingToReveal) {
      return;
    }
    relayout();
    if (current) {
      focusCard(current, freeWidth(), true);
    } else {
      camera.set(home());
    }
    viewport.classList.add("is-laid-out");
    enter();
    const term = getQuery();
    if (term) {
      applySearch(term);
    }
    publishCanvas(api);
  };

  const scheduleRelayout = () => {
    clearTimeout(relayoutTimer);
    relayoutTimer = window.setTimeout(() => {
      if (layout && root.isConnected) {
        relayout();
      }
    }, RELAYOUT_DEBOUNCE_MS);
  };

  camera.set(home());
  const fonts = document.fonts;
  Promise.race([fonts.ready, wait(FONT_WAIT_MS)]).then(reveal, reveal);
  fonts.ready.then(scheduleRelayout, scheduleRelayout);
  fonts.addEventListener("loadingdone", scheduleRelayout);
  cleanups.push(
    onRendered(world, () => {
      if (waitingToReveal) {
        reveal();
      } else if (stale) {
        relayout();
      }
    })
  );
  cleanups.push(() => {
    fonts.removeEventListener("loadingdone", scheduleRelayout);
    clearTimeout(relayoutTimer);
    clearTimeout(searchTimer);
  });

  return {
    root,
    setCurrent,
    /** Glide so a note's card sits in the desk area left of the drawer. */
    glideToNote: (slug: string) => {
      if (layout) {
        focusCard(slug, freeWidth());
      }
    },
    destroy: () => {
      camera.stop();
      for (const cleanup of cleanups) {
        cleanup();
      }
    },
  };
};

/* ======================================================================
 * Router glue (module state lives for the whole visit)
 * ==================================================================== */

type Controller = ReturnType<typeof createCanvas>;

let controller: Controller | null = null;
/** Note shown in the drawer after the last sync. */
let shownSlug: string | null = null;
/** Note we last announced with `drawer:open` (avoid announcing twice). */
let openedSlug: string | null = null;
const renderedDrawers = new WeakSet<HTMLElement>();

/** At this width and below the drawer covers the desk (see freeWidth). */
const drawerCoversDesk = window.matchMedia(
  `(max-width: ${WIDE_ENOUGH_FOR_SIDE_BY_SIDE}px)`
);

/**
 * While the drawer covers the desk, the canvas (with its zoom controls) and
 * the toolbar under it are inert: Tab must not reach what nobody can see
 * (WCAG 2.4.11). Wider screens keep both beside the drawer (canvas.css).
 */
const syncCovered = () => {
  const covered = drawerCoversDesk.matches && findDrawer() !== null;
  for (const el of document.querySelectorAll<HTMLElement>(
    "[data-canvas], .toolbar"
  )) {
    el.inert = covered;
  }
};

drawerCoversDesk.addEventListener("change", syncCovered);

const ensureController = () => {
  const root = document.querySelector<HTMLElement>("[data-canvas]");
  if (controller && controller.root !== root) {
    controller.destroy();
    controller = null;
  }
  if (root && !controller) {
    controller = createCanvas(root);
  }
};

const announceOpen = (slug: string) => {
  if (openedSlug !== slug) {
    openedSlug = slug;
    emitDrawerOpen({ slug });
  }
};

/** Focus the first candidate that can take focus (visible, laid out). */
const focusFirst = (candidates: (HTMLElement | null | undefined)[]) => {
  for (const el of candidates) {
    if (el && el.getClientRects().length > 0) {
      el.focus({ preventScroll: true });
      if (document.activeElement === el) {
        return;
      }
    }
  }
};

/**
 * Keyboard and screen-reader users follow the note: after the router opens
 * or switches a note, focus moves to its title (the drawer sits before the
 * canvas in the DOM, so Tab alone would not get there); after it closes,
 * focus goes back to the note's card (or its row in the list on a phone).
 */
const moveFocus = (drawer: HTMLElement | null, closedSlug: string | null) => {
  const active = document.activeElement;
  if (drawer) {
    if (!drawer.contains(active)) {
      focusFirst([drawer.querySelector<HTMLElement>("#note-title"), drawer]);
    }
    return;
  }
  if (!closedSlug) {
    return;
  }
  // Only when focus was lost with the drawer (Esc, 关闭, a click on the desk).
  if (active && active !== document.body && active.isConnected) {
    const leaving = active.closest("[data-drawer][data-leaving]");
    if (!leaving) {
      return;
    }
  }
  const slug = CSS.escape(closedSlug);
  focusFirst([
    document.querySelector<HTMLElement>(`[data-card][data-slug="${slug}"]`),
    document.querySelector<HTMLElement>(`[data-row][data-slug="${slug}"]`),
  ]);
};

/** Bring canvas state in line with the drawer on this page. */
const syncDrawer = (animate: boolean) => {
  const drawer = findDrawer();
  const slug = drawer?.slug ?? null;
  const closedSlug = drawer ? null : shownSlug;
  if (drawer && slug) {
    announceOpen(slug);
    if (animate && shownSlug === null) {
      slideIn(drawer.drawerEl);
    } else if (animate && shownSlug !== slug) {
      fadeInPage(drawer.pageEl);
    }
  } else if (shownSlug) {
    emitDrawerClose({ slug: shownSlug });
    openedSlug = null;
  }
  for (const leaving of document.querySelectorAll<HTMLElement>(
    "[data-drawer][data-leaving]"
  )) {
    slideOut(leaving);
  }
  const changed = shownSlug !== slug;
  shownSlug = slug;
  controller?.setCurrent(slug);
  // Before moving focus: a closed drawer gives the card back to Tab.
  syncCovered();
  // Router navigations only: on a fresh page load focus stays where the
  // browser puts it (the skip link leads to the title).
  if (animate && changed) {
    moveFocus(drawer?.drawerEl ?? null, closedSlug);
  }
};

const announceRendered = () => {
  const drawer = findDrawer();
  if (!drawer || renderedDrawers.has(drawer.drawerEl)) {
    return;
  }
  renderedDrawers.add(drawer.drawerEl);
  emitDrawerRendered({
    slug: drawer.slug,
    drawerEl: drawer.drawerEl,
    scrollEl: drawer.scrollEl,
    bodyEl: drawer.bodyEl,
  });
};

document.addEventListener("astro:before-preparation", (event) => {
  const slug = noteSlugFromPath(event.to.pathname);
  if (!slug) {
    return;
  }
  announceOpen(slug);
  controller?.glideToNote(slug);
  const drawer = findDrawer();
  if (drawer && drawer.slug !== slug && !prefersReducedMotion()) {
    fadeOutPage(drawer.pageEl);
    const load = event.loader;
    event.loader = async () => {
      await Promise.all([load(), wait(FADE_MS)]);
    };
  }
});

document.addEventListener("astro:before-swap", (event) => {
  const fromCanvas = document.querySelector("[data-canvas]");
  const toCanvas = event.newDocument.querySelector("[data-canvas]");
  if (!(fromCanvas && toCanvas)) {
    // Canvas ↔ list keeps the router's cross-fade.
    return;
  }
  // The canvas stays put; the drawer does its own motion. Skipping rejects
  // the transition's `ready` promise, which is expected here.
  event.viewTransition.ready.catch(() => {
    // Expected: we skipped this transition on purpose.
  });
  event.viewTransition.skipTransition();
  if (!event.newDocument.querySelector("[data-drawer]")) {
    carryOverLeavingDrawer(event.newDocument);
  }
});

document.addEventListener("astro:after-swap", () => {
  applyHomeView();
  ensureController();
  syncDrawer(true);
});

document.addEventListener("astro:page-load", () => {
  applyHomeView();
  ensureController();
  syncDrawer(false);
  announceRendered();
});

/* Esc closes the note. Runs on window (after document listeners), so a
 * lightbox or pop-over that handles Esc first can call preventDefault(). */
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented || !findDrawer()) {
    return;
  }
  if (document.querySelector('[aria-modal="true"], dialog[open]')) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("input, textarea, select, [contenteditable]")) {
    return;
  }
  closeNote();
});

/* First full page load: the DOM is parsed when module scripts run. */
applyHomeView();
ensureController();
syncDrawer(false);
if (document.readyState === "complete") {
  announceRendered();
} else {
  document.addEventListener("DOMContentLoaded", announceRendered, {
    once: true,
  });
}
