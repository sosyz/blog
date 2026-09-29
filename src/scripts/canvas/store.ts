/**
 * Small client state shared by the toolbar, the canvas and the list. Lives
 * for the whole visit (module state survives <ClientRouter /> swaps).
 */

type Listener = (term: string) => void;

let query = "";
let raw = "";
const listeners = new Set<Listener>();

/** Current search text, trimmed and lower-cased. */
export const getQuery = () => query;

/** The search text as typed, to refill the box after a page swap. */
export const getRawQuery = () => raw;

export const setQuery = (typed: string) => {
  raw = typed;
  const next = typed.trim().toLowerCase();
  if (next === query) {
    return;
  }
  query = next;
  for (const listener of listeners) {
    listener(query);
  }
};

/** Subscribe to search changes. Returns an unsubscribe function. */
export const onQuery = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Whether a card or list row matches the query. Items carry `data-q`
 * (title, summary, topic and tags, lower-cased) rendered by the server.
 */
export const matches = (el: HTMLElement, term = query) =>
  !term || (el.dataset.q ?? "").includes(term);

/* ---------- canvas / list preference on the home page ---------- */

export type HomeView = "canvas" | "list";

const VIEW_KEY = "journal:view";

/** Explicit choice from the toolbar switch, for this tab. */
export const readView = (): HomeView | null => {
  try {
    const value = sessionStorage.getItem(VIEW_KEY);
    return value === "canvas" || value === "list" ? value : null;
  } catch {
    return null;
  }
};

export const writeView = (view: HomeView) => {
  try {
    sessionStorage.setItem(VIEW_KEY, view);
  } catch {
    // Storage unavailable (private mode, blocked): the choice just isn't remembered.
  }
};

/** Below this width the home page opens on the list. */
export const NARROW_QUERY = "(max-width: 639px)";

export const isNarrow = () => window.matchMedia(NARROW_QUERY).matches;

/**
 * Apply the remembered view to the home page (`.home[data-view]`): on narrow
 * screens the list shows unless the visitor picked the canvas.
 */
export const applyHomeView = () => {
  const home = document.querySelector<HTMLElement>("[data-home]");
  if (!home) {
    return null;
  }
  home.dataset.view = readView() ?? "auto";
  return home;
};

/** Which view the visitor is looking at right now. */
export const visibleView = (): HomeView => {
  const home = document.querySelector<HTMLElement>("[data-home]");
  if (home) {
    return isNarrow() && home.dataset.view !== "canvas" ? "list" : "canvas";
  }
  return document.querySelector("[data-canvas]") ? "canvas" : "list";
};
