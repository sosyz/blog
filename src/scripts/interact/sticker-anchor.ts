/**
 * What a visitor sticker is stuck to (migrations/0002_sticker_anchor.sql).
 *
 * The canvas lays the notes out anew on every load (layout.ts: the most
 * recently updated topic in the middle), so a new note moves whole piles. A
 * sticker remembers the closest thing when it was placed (the intro card, the
 * 友链 pile or a note's card) and where that thing's top-left corner was; it
 * is shown moved by as much as that thing has moved since. Without an anchor,
 * or when its note is gone, it stays at its plain world x/y.
 *
 * The functions on boxes are pure (tests/sticker-anchor.test.ts); only
 * anchorBoxes reads the DOM.
 */
import { roundAnchor, type StickerAnchor } from "@/lib/server/sticker-limits";

export interface AnchorBox {
  h: number;
  w: number;
  x: number;
  y: number;
}

export type AnchorBoxes = ReadonlyMap<string, AnchorBox>;

const px = (value: string) => Number.parseFloat(value) || 0;

/** Laid out (layout.ts sets left/top); before that every box reads 0. */
const isPlaced = (el: HTMLElement) => el.style.left !== "";

const boxOf = (el: HTMLElement, x: number, y: number): AnchorBox => ({
  h: el.offsetHeight,
  w: el.offsetWidth,
  x,
  y,
});

/**
 * World boxes of everything a sticker can be stuck to, read from the left /
 * top layout.ts wrote (cards sit inside their pile). Empty before the first
 * layout.
 */
export const anchorBoxes = (world: HTMLElement): AnchorBoxes => {
  const boxes = new Map<string, AnchorBox>();
  const intro = world.querySelector<HTMLElement>("[data-intro]");
  if (!(intro && isPlaced(intro))) {
    return boxes;
  }
  boxes.set("intro", boxOf(intro, px(intro.style.left), px(intro.style.top)));
  const friends = world.querySelector<HTMLElement>("[data-friends]");
  if (friends && isPlaced(friends)) {
    boxes.set(
      "friends",
      boxOf(friends, px(friends.style.left), px(friends.style.top))
    );
  }
  for (const pile of world.querySelectorAll<HTMLElement>("[data-pile]")) {
    const left = px(pile.style.left);
    const top = px(pile.style.top);
    for (const card of pile.querySelectorAll<HTMLElement>("[data-card]")) {
      const { slug } = card.dataset;
      if (slug) {
        boxes.set(
          `card:${slug}`,
          boxOf(card, left + px(card.style.left), top + px(card.style.top))
        );
      }
    }
  }
  return boxes;
};

/** Distance from a point to a box (0 inside it). */
const distance = (box: AnchorBox, x: number, y: number) =>
  Math.hypot(
    Math.max(box.x - x, 0, x - (box.x + box.w)),
    Math.max(box.y - y, 0, y - (box.y + box.h))
  );

/**
 * The closest box to a sticker's centre, as an anchor (rounded the way the
 * server stores it); null when none.
 */
export const nearestAnchor = (
  boxes: AnchorBoxes,
  point: { x: number; y: number }
): StickerAnchor | null => {
  let best: StickerAnchor | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [key, box] of boxes) {
    const d = distance(box, point.x, point.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = { key, x: box.x, y: box.y };
    }
  }
  return best && roundAnchor(best);
};

/**
 * Where a sticker shows now: its stored centre moved by as much as its
 * anchor has moved since it was placed.
 */
export const anchoredPoint = (
  boxes: AnchorBoxes,
  sticker: { x: number; y: number; anchor?: StickerAnchor | null }
) => {
  const box = sticker.anchor ? boxes.get(sticker.anchor.key) : undefined;
  if (!(box && sticker.anchor)) {
    return { x: sticker.x, y: sticker.y };
  }
  return {
    x: sticker.x + box.x - sticker.anchor.x,
    y: sticker.y + box.y - sticker.anchor.y,
  };
};
