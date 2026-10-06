/**
 * The list: filter by type and topic, dim rows that don't match the search.
 * On /list/ the filters are mirrored in the URL (?type=踩坑&topic=Go) so a
 * filtered list can be shared.
 */
import { getQuery, matches, onQuery } from "./store";

interface Filters {
  topic: string;
  type: string;
}

const bound = new WeakSet<HTMLElement>();
const TRAILING_SLASH = /\/$/;
const ownsUrl = () => location.pathname.replace(TRAILING_SLASH, "") === "/list";

const readUrl = (): Filters => {
  if (!ownsUrl()) {
    return { topic: "", type: "" };
  }
  const params = new URLSearchParams(location.search);
  return { topic: params.get("topic") ?? "", type: params.get("type") ?? "" };
};

const writeUrl = ({ type, topic }: Filters) => {
  if (!ownsUrl()) {
    return;
  }
  const url = new URL(location.href);
  for (const [key, value] of Object.entries({ topic, type })) {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }
  // Keep the router's history state (it stores its own index there).
  history.replaceState(history.state, "", url);
};

const dimRows = (list: HTMLElement, term: string) => {
  for (const row of list.querySelectorAll<HTMLElement>("[data-row]")) {
    row.classList.toggle("dim", !matches(row, term));
  }
};

const applyFilters = (list: HTMLElement, filters: Filters) => {
  let shown = 0;
  for (const year of list.querySelectorAll<HTMLElement>("[data-year]")) {
    let inYear = 0;
    for (const row of year.querySelectorAll<HTMLElement>("[data-row]")) {
      const ok =
        (!filters.type || row.dataset.type === filters.type) &&
        (!filters.topic || row.dataset.topic === filters.topic);
      const item = row.closest("li") ?? row;
      item.hidden = !ok;
      inYear += ok ? 1 : 0;
    }
    year.hidden = inYear === 0;
    shown += inYear;
  }
  const empty = list.querySelector<HTMLElement>("[data-list-empty]");
  if (empty) {
    empty.hidden = shown > 0;
  }
  for (const chip of list.querySelectorAll<HTMLButtonElement>(
    "[data-filter]"
  )) {
    const key = chip.dataset.filter as keyof Filters;
    chip.setAttribute(
      "aria-pressed",
      String((chip.dataset.value ?? "") === filters[key])
    );
  }
};

const bindList = (list: HTMLElement) => {
  bound.add(list);
  const filters = readUrl();
  list.addEventListener("click", (event) => {
    const chip =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("[data-filter]")
        : null;
    if (!chip) {
      return;
    }
    const key = chip.dataset.filter === "topic" ? "topic" : "type";
    filters[key] = chip.dataset.value ?? "";
    applyFilters(list, filters);
    writeUrl(filters);
  });
  applyFilters(list, filters);
  dimRows(list, getQuery());
};

const bindAll = () => {
  for (const list of document.querySelectorAll<HTMLElement>(
    "[data-note-list]"
  )) {
    if (!bound.has(list)) {
      bindList(list);
    }
  }
};

onQuery((term) => {
  for (const list of document.querySelectorAll<HTMLElement>(
    "[data-note-list]"
  )) {
    dimRows(list, term);
  }
});
document.addEventListener("astro:page-load", bindAll);
document.addEventListener("astro:after-swap", bindAll);
bindAll();
