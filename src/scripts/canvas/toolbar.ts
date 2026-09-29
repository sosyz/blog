/**
 * Toolbar: the search box and the 画布 / 列表 switch.
 *
 * The toolbar is rendered by every page, so it is re-bound after each
 * navigation; the query itself lives in ./store and survives page swaps.
 * On the home page on a narrow screen both views live at `/`, so the switch
 * flips them in place and remembers the choice for this tab.
 */
import {
  applyHomeView,
  getQuery,
  getRawQuery,
  type HomeView,
  isNarrow,
  matches,
  NARROW_QUERY,
  onQuery,
  setQuery,
  visibleView,
  writeView,
} from "./store";

const bound = new WeakSet<HTMLElement>();

/** Count distinct notes that match (cards and list rows share slugs). */
const countHits = (term: string) => {
  const slugs = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>("[data-q]")) {
    if (matches(el, term) && el.dataset.slug) {
      slugs.add(el.dataset.slug);
    }
  }
  return slugs.size;
};

const renderCount = (term: string) => {
  const count = document.querySelector<HTMLElement>("[data-search-count]");
  if (count) {
    count.textContent = term ? `${countHits(term)} 条` : "";
  }
};

/** Highlight the switch half that matches what is on screen. */
const renderSwitch = () => {
  const view = visibleView();
  for (const link of document.querySelectorAll<HTMLElement>(
    "[data-view-link]"
  )) {
    link.classList.toggle("is-active", link.dataset.viewLink === view);
  }
};

const onSwitchClick = (event: MouseEvent) => {
  const link =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-view-link]")
      : null;
  const view = link?.dataset.viewLink as HomeView | undefined;
  if (!(link && view)) {
    return;
  }
  writeView(view);
  // On the narrow home page both views are already here: flip in place.
  if (document.querySelector("[data-home]") && isNarrow()) {
    event.preventDefault();
    applyHomeView();
    renderSwitch();
    window.scrollTo({ top: 0 });
    return;
  }
  if (
    link instanceof HTMLAnchorElement &&
    link.pathname === location.pathname
  ) {
    event.preventDefault();
  }
};

const bindToolbar = () => {
  const input = document.querySelector<HTMLInputElement>("[data-search]");
  if (input && !bound.has(input)) {
    bound.add(input);
    input.value = getRawQuery();
    input.addEventListener("input", () => setQuery(input.value));
  }
  const seg = document.querySelector<HTMLElement>("[data-view-switch]");
  if (seg && !bound.has(seg)) {
    bound.add(seg);
    seg.addEventListener("click", onSwitchClick);
  }
  renderCount(getQuery());
  renderSwitch();
};

onQuery(renderCount);
window.matchMedia(NARROW_QUERY).addEventListener("change", renderSwitch);
document.addEventListener("astro:page-load", bindToolbar);
document.addEventListener("astro:after-swap", bindToolbar);
bindToolbar();
