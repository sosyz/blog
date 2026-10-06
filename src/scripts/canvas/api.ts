/**
 * Client-side contract between the canvas/drawer (Canvas agent) and features
 * that build on it (sticker layer, inline comments, margin notes, comments).
 *
 * The canvas publishes a `CanvasApi` once it has laid out the world, and
 * dispatches drawer events on `window`. Consumers never reach into canvas
 * internals; they use this module only.
 *
 * Lifecycle with <ClientRouter />: the canvas element is `transition:persist`,
 * so the API object survives page swaps and `canvas:ready` fires once per
 * full page load. Drawer content is part of each page's static HTML and is
 * replaced on navigation, so `drawer:rendered` fires after every swap that
 * shows an article (and on first load of /notes/<slug>/). Consumers must
 * re-bind to the `bodyEl` they receive each time.
 */

export interface Point {
  x: number;
  y: number;
}

/** Screen = world * scale + (x, y). */
export interface Camera {
  scale: number;
  x: number;
  y: number;
}

export interface CanvasApi {
  closeNote: () => void;
  /** Slug of the note open in the drawer, or null. */
  currentNote: () => string | null;
  getCamera: () => Camera;
  /** Called on every camera change (pan, zoom, inertia, glide). Returns an unsubscribe function. */
  onCameraChange: (listener: (camera: Camera) => void) => () => void;
  /** Open a note in the drawer (navigates to /notes/<slug>/). */
  openNote: (slug: string) => void;
  /** Smoothly move the camera so this world point is centred. */
  panTo: (point: Point, options?: { scale?: number }) => void;
  /** Viewport-relative client coordinates → world coordinates. */
  screenToWorld: (point: Point) => Point;
  /** Fixed, full-screen element that receives pointer and wheel input. */
  viewportEl: HTMLElement;
  /**
   * Transformed element in world coordinates. Append absolutely positioned
   * children (left/top in world px) and they pan and zoom with the canvas.
   * World origin (0, 0) is the centre of the intro card.
   */
  worldEl: HTMLElement;
  /** World coordinates → viewport-relative client coordinates. */
  worldToScreen: (point: Point) => Point;
}

export interface DrawerOpenDetail {
  slug: string;
}

export interface DrawerRenderedDetail {
  /** The article body: the element with `data-post-body`. */
  bodyEl: HTMLElement;
  /** The drawer panel (fixed, right side). */
  drawerEl: HTMLElement;
  /** The scrolling element inside the drawer; listen to its `scroll`. */
  scrollEl: HTMLElement;
  slug: string;
}

export interface DrawerCloseDetail {
  slug: string;
}

export const CANVAS_READY = "canvas:ready";
export const DRAWER_OPEN = "drawer:open";
export const DRAWER_RENDERED = "drawer:rendered";
export const DRAWER_CLOSE = "drawer:close";

declare global {
  interface WindowEventMap {
    "canvas:ready": CustomEvent<CanvasApi>;
    /** The drawer closed. */
    "drawer:close": CustomEvent<DrawerCloseDetail>;
    /** The drawer starts opening (or switches) to this note. */
    "drawer:open": CustomEvent<DrawerOpenDetail>;
    /** The article DOM for this note is in place and visible. */
    "drawer:rendered": CustomEvent<DrawerRenderedDetail>;
  }
  interface Window {
    /** Set by the canvas once ready; prefer `whenCanvasReady()`. */
    __canvas?: CanvasApi;
  }
}

/** Canvas side: publish the API (idempotent; the latest call wins). */
export const publishCanvas = (api: CanvasApi) => {
  window.__canvas = api;
  window.dispatchEvent(new CustomEvent(CANVAS_READY, { detail: api }));
};

/**
 * Consumer side: resolves with the API, whether the canvas became ready
 * before or after this call. Never resolves on pages without a canvas.
 */
export const whenCanvasReady = (): Promise<CanvasApi> => {
  const existing = window.__canvas;
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    window.addEventListener(CANVAS_READY, (event) => resolve(event.detail), {
      once: true,
    });
  });
};

/** Canvas side: announce drawer state changes. */
export const emitDrawerOpen = (detail: DrawerOpenDetail) => {
  window.dispatchEvent(new CustomEvent(DRAWER_OPEN, { detail }));
};

export const emitDrawerRendered = (detail: DrawerRenderedDetail) => {
  window.dispatchEvent(new CustomEvent(DRAWER_RENDERED, { detail }));
};

export const emitDrawerClose = (detail: DrawerCloseDetail) => {
  window.dispatchEvent(new CustomEvent(DRAWER_CLOSE, { detail }));
};

/** Consumer side helpers. Each returns an unsubscribe function. */
export const onDrawerOpen = (listener: (detail: DrawerOpenDetail) => void) => {
  const handler = (event: CustomEvent<DrawerOpenDetail>) =>
    listener(event.detail);
  window.addEventListener(DRAWER_OPEN, handler);
  return () => window.removeEventListener(DRAWER_OPEN, handler);
};

export const onDrawerRendered = (
  listener: (detail: DrawerRenderedDetail) => void
) => {
  const handler = (event: CustomEvent<DrawerRenderedDetail>) =>
    listener(event.detail);
  window.addEventListener(DRAWER_RENDERED, handler);
  return () => window.removeEventListener(DRAWER_RENDERED, handler);
};

export const onDrawerClose = (
  listener: (detail: DrawerCloseDetail) => void
) => {
  const handler = (event: CustomEvent<DrawerCloseDetail>) =>
    listener(event.detail);
  window.addEventListener(DRAWER_CLOSE, handler);
  return () => window.removeEventListener(DRAWER_CLOSE, handler);
};

/** True when the visitor asked the OS for reduced motion. */
export const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
