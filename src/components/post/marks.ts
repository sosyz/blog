/*
 * Redraw `==marker pen==` highlights (<mark> in the article body) with Rough
 * Notation so they look hand-drawn. Without JavaScript, prose.css shows a
 * flat marker stroke instead.
 *
 * Runs once per full page load. The drawer body is replaced on every
 * navigation, so annotations are drawn per body element: on
 * `drawer:rendered` (forced, the body is now visible) and on
 * `astro:page-load` as a fallback for bodies shown outside the drawer.
 * Rough Notation is only downloaded when a note has marks.
 */
import type { RoughAnnotation } from "rough-notation/lib/model";
import { onDrawerRendered, prefersReducedMotion } from "@/scripts/canvas/api";

const MARKER = "rgb(250 214 92 / 0.55)";
const ANNOTATED = "is-annotated";

const drawn = new WeakMap<HTMLElement, RoughAnnotation[]>();

const clear = (body: HTMLElement) => {
  for (const annotation of drawn.get(body) ?? []) {
    annotation.remove();
  }
  drawn.delete(body);
  for (const mark of body.querySelectorAll(`mark.${ANNOTATED}`)) {
    mark.classList.remove(ANNOTATED);
  }
};

const isVisible = (element: HTMLElement) => element.getClientRects().length > 0;

const draw = async (body: HTMLElement, force: boolean) => {
  if (drawn.has(body) && !force) {
    return;
  }
  const marks = [...body.querySelectorAll<HTMLElement>("mark")];
  if (marks.length === 0) {
    return;
  }
  clear(body);
  // Claim the body before waiting; if another trigger claims it meanwhile,
  // that one draws and this one stops (no orphaned annotations).
  const claim: RoughAnnotation[] = [];
  drawn.set(body, claim);
  // Web fonts change line breaks; measure only after they are in.
  const [{ annotate, annotationGroup }] = await Promise.all([
    import("rough-notation"),
    document.fonts.ready,
  ]);
  if (drawn.get(body) !== claim) {
    return;
  }
  if (!(body.isConnected && isVisible(body))) {
    drawn.delete(body);
    return;
  }
  const animate = !prefersReducedMotion();
  const annotations = marks.filter(isVisible).map((mark) => {
    mark.classList.add(ANNOTATED);
    return annotate(mark, {
      type: "highlight",
      color: MARKER,
      multiline: true,
      iterations: 1,
      animate,
      animationDuration: 600,
    });
  });
  drawn.set(body, annotations);
  annotationGroup(annotations).show();
};

onDrawerRendered(({ bodyEl }) => {
  draw(bodyEl, true).catch(() => clear(bodyEl));
});

document.addEventListener("astro:page-load", () => {
  for (const body of document.querySelectorAll<HTMLElement>(
    "[data-post-body]"
  )) {
    draw(body, false).catch(() => clear(body));
  }
});
