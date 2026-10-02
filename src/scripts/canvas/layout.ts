/**
 * Automatic canvas layout, ported from the approved prototype.
 *
 * - Intro card centred on the world origin.
 * - Topic piles spiral outwards in pile order (most recently updated topic
 *   first, so it sits closest to the centre) without overlapping.
 * - Inside a pile, cards form a masonry: 1–2 notes → as many columns,
 *   3–4 → two, 5+ → three; 252px columns, 18px gaps, 52px for the topic name,
 *   each card nudged a few pixels (seeded by slug).
 * - Topic stickers, the outer ring of place/people stickers, the dog next to
 *   the intro card and the "最近在折腾" arrow towards the first pile.
 * - Hand-drawn lines between related notes.
 */
import { seeded } from "./seed";

export type Box = { x: number; y: number; w: number; h: number };

export type Layout = {
  /** World-space box of each card, by slug. */
  cards: Map<string, Box>;
  intro: Box;
};

const COL = 252;
const GAP = 18;
/** Space kept between piles (and around the intro card). */
const PAD = 34;
/** Height reserved for the topic name above the cards. */
const HEAD = 52;
const JITTER_X = 10;
const JITTER_Y = 8;
const MAX_SPIRAL_STEPS = 6000;
/** More notes than this in a pile → three columns; fewer → one per note. */
const MANY_NOTES = 4;
const MAX_COLUMNS = 3;
const FEW_COLUMNS = 2;
/** Seeded values are in [0, 1); subtract this to centre them on zero. */
const CENTRE = 0.5;
const HALF_TURN_DEG = 180;
const DEG_PER_RAD = HALF_TURN_DEG / Math.PI;
/** Elliptical spiral the piles are placed along (radians, px). */
const SPIRAL = {
  start: -0.3,
  step: 0.2,
  radius: 60,
  growth: 2.2,
  stretchX: 1.35,
  stretchY: 0.85,
} as const;
/** Space kept clear around the intro card (px). */
const INTRO_CLEARANCE = { side: 20, top: 50, bottom: 40 } as const;
/** The dog sits by the intro card's bottom-left corner. */
const DOG_OFFSET = { x: -112, y: -64 } as const;
/** "最近在折腾" arrow, just outside the intro card. */
const ARROW = {
  distance: 40,
  x: -60,
  y: -35,
  tilt: -25,
  textX: -50,
  textY: -70,
} as const;
/** Topic stickers: after the topic name, and at the pile's bottom-right. */
const PILE_STICKER = {
  afterLabel: 24,
  top: -34,
  right: 50,
  bottom: 40,
} as const;
/** Outer ring of place/people stickers, relative to everything's bounds. */
const RING = {
  left: 110,
  top: 90,
  topMid: 120,
  topMidShift: 40,
  right: 20,
  rightTop: 80,
  rightMid: 30,
  bottom: 30,
  bottomLeft: 120,
  bottomLeftUp: 20,
} as const;
/** How far a related line bows out, as a share of its length. */
const LINK_BEND = 0.25;
const SVG_NS = "http://www.w3.org/2000/svg";

const place = (el: HTMLElement | SVGElement, x: number, y: number) => {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
};

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w + PAD &&
  b.x < a.x + a.w + PAD &&
  a.y < b.y + b.h + PAD &&
  b.y < a.y + a.h + PAD;

const columnsFor = (count: number) => {
  if (count > MANY_NOTES) {
    return MAX_COLUMNS;
  }
  return Math.min(FEW_COLUMNS, count);
};

type LocalCard = { el: HTMLElement; slug: string; box: Box };

/** Masonry inside one pile, in pile-local coordinates (below the head). */
const stackPile = (cards: HTMLElement[]) => {
  const cols = Math.max(1, columnsFor(cards.length));
  const heights = new Array<number>(cols).fill(0);
  const local: LocalCard[] = [];
  for (const el of cards) {
    const slug = el.dataset.slug ?? "";
    const column = heights.indexOf(Math.min(...heights));
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const jx = (seeded(`${slug}x`) - CENTRE) * JITTER_X;
    const jy = (seeded(`${slug}y`) - CENTRE) * JITTER_Y;
    local.push({
      el,
      slug,
      box: {
        x: column * (COL + GAP) + (COL - w) / 2 + jx,
        y: (heights[column] ?? 0) + jy,
        w,
        h,
      },
    });
    heights[column] = (heights[column] ?? 0) + h + GAP;
  }
  const width = cols * COL + (cols - 1) * GAP;
  const height = Math.max(...heights) - GAP + HEAD;
  return { local, width, height };
};

/** First free spot along an elliptical spiral around the centre. */
const findSpot = (taken: Box[], w: number, h: number): Box => {
  let box: Box = { x: -w / 2, y: -h / 2, w, h };
  for (let k = 0; k < MAX_SPIRAL_STEPS; k++) {
    const angle = SPIRAL.start + k * SPIRAL.step;
    const radius = SPIRAL.radius + k * SPIRAL.growth;
    const cx = Math.cos(angle) * radius * SPIRAL.stretchX;
    const cy = Math.sin(angle) * radius * SPIRAL.stretchY;
    box = { x: cx - w / 2, y: cy - h / 2, w, h };
    if (!taken.some((other) => overlaps(other, box))) {
      break;
    }
  }
  return box;
};

/** The doodle arrow from the intro card towards the most recent pile. */
const pointArrow = (world: HTMLElement, pile: Box, intro: Box) => {
  const arrow = world.querySelector<HTMLElement>("[data-arrow]");
  const text = world.querySelector<HTMLElement>("[data-arrow-text]");
  const angle = Math.atan2(pile.y + pile.h / 2, pile.x + pile.w / 2);
  const ex = Math.cos(angle) * (intro.w / 2 + ARROW.distance);
  const ey = Math.sin(angle) * (intro.h / 2 + ARROW.distance);
  if (arrow) {
    place(arrow, ex + ARROW.x, ey + ARROW.y);
    arrow.style.rotate = `${angle * DEG_PER_RAD + ARROW.tilt}deg`;
  }
  if (text) {
    place(text, ex + ARROW.textX, ey + ARROW.textY);
  }
};

/** Place/people stickers around the outside of everything. */
const placeRing = (world: HTMLElement, boxes: Box[]) => {
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const midX = (minX + maxX) / 2;
  const ring: [number, number][] = [
    [minX - RING.left, minY - RING.top],
    [midX - RING.topMidShift, minY - RING.topMid],
    [maxX + RING.right, minY - RING.rightTop],
    [maxX + RING.rightMid, (minY + maxY) / 2],
    [midX, maxY + RING.bottom],
    [minX - RING.bottomLeft, maxY - RING.bottomLeftUp],
  ];
  const outer = world.querySelectorAll<HTMLElement>("[data-outer]");
  for (const [i, el] of [...outer].entries()) {
    const [x, y] = ring[i % ring.length] ?? [0, 0];
    place(el, x, y);
  }
};

const layoutPile = (
  pileEl: HTMLElement,
  taken: Box[],
  cards: Layout["cards"]
) => {
  const cardEls = [...pileEl.querySelectorAll<HTMLElement>("[data-card]")];
  const { local, width, height } = stackPile(cardEls);
  const box = findSpot(taken, width, height);
  taken.push(box);
  place(pileEl, box.x, box.y);
  for (const { el, slug, box: b } of local) {
    place(el, b.x, HEAD + b.y);
    cards.set(slug, { x: box.x + b.x, y: box.y + HEAD + b.y, w: b.w, h: b.h });
  }
  const label = pileEl.querySelector<HTMLElement>("[data-topic-label]");
  const [first, second] = pileEl.querySelectorAll<HTMLElement>(
    "[data-pile-sticker]"
  );
  if (first) {
    place(
      first,
      (label?.offsetWidth ?? 0) + PILE_STICKER.afterLabel,
      PILE_STICKER.top
    );
  }
  if (second) {
    place(second, width - PILE_STICKER.right, height - PILE_STICKER.bottom);
  }
  return box;
};

/**
 * Whether the world is rendered at all. On a phone the list view and the
 * drawer hide it with `display: none` (canvas.css), so nothing inside is
 * fetched or laid out; every size reads 0 then, and a layout would stack
 * everything on the origin.
 */
export const isRendered = (world: HTMLElement) =>
  (world.querySelector<HTMLElement>("[data-intro]")?.offsetWidth ?? 0) > 0;

/**
 * Call `onShow` each time the world goes from hidden to rendered (the
 * visitor switches to 画布, closes the drawer, or turns the phone). Returns
 * a cleanup function.
 */
export const onRendered = (world: HTMLElement, onShow: () => void) => {
  const intro = world.querySelector<HTMLElement>("[data-intro]");
  if (!intro || typeof ResizeObserver === "undefined") {
    return () => {
      // Nothing to observe.
    };
  }
  let shown = isRendered(world);
  const observer = new ResizeObserver(() => {
    const now = isRendered(world);
    if (now && !shown) {
      onShow();
    }
    shown = now;
  });
  observer.observe(intro);
  return () => observer.disconnect();
};

/** The 友链 pile: placed as a whole, after (outside) the topic piles. */
const layoutFriends = (world: HTMLElement, taken: Box[]) => {
  const el = world.querySelector<HTMLElement>("[data-friends]");
  if (!el) {
    return;
  }
  const box = findSpot(taken, el.offsetWidth, el.offsetHeight);
  taken.push(box);
  place(el, box.x, box.y);
};

/** Measure and place everything. Safe to call again after fonts load. */
export const layoutWorld = (world: HTMLElement): Layout => {
  const introEl = world.querySelector<HTMLElement>("[data-intro]");
  const iw = introEl?.offsetWidth ?? 0;
  const ih = introEl?.offsetHeight ?? 0;
  const intro: Box = { x: -iw / 2, y: -ih / 2, w: iw, h: ih };
  if (introEl) {
    place(introEl, intro.x, intro.y);
  }
  const dog = world.querySelector<HTMLElement>("[data-dog]");
  if (dog) {
    place(dog, -iw / 2 + DOG_OFFSET.x, ih / 2 + DOG_OFFSET.y);
  }

  const { side, top, bottom } = INTRO_CLEARANCE;
  const taken: Box[] = [
    {
      x: -iw / 2 - side,
      y: -ih / 2 - top,
      w: iw + 2 * side,
      h: ih + top + bottom,
    },
  ];
  const cards: Layout["cards"] = new Map();
  const piles = world.querySelectorAll<HTMLElement>("[data-pile]");
  for (const [i, pileEl] of [...piles].entries()) {
    const box = layoutPile(pileEl, taken, cards);
    if (i === 0) {
      pointArrow(world, box, intro);
    }
  }
  layoutFriends(world, taken);
  placeRing(world, taken);
  return { cards, intro };
};

const center = (box: Box) => [box.x + box.w / 2, box.y + box.h / 2] as const;

/** Dotted pencil lines between related notes (each pair once). */
export const drawLinks = (world: HTMLElement, layout: Layout) => {
  const svg = world.querySelector<SVGSVGElement>("[data-links]");
  if (!svg) {
    return;
  }
  svg.replaceChildren();
  const seen = new Set<string>();
  for (const card of world.querySelectorAll<HTMLElement>("[data-card]")) {
    const a = card.dataset.slug ?? "";
    const related = (card.dataset.related ?? "").split(" ").filter(Boolean);
    for (const b of related) {
      const key = [a, b].sort().join("|");
      const boxA = layout.cards.get(a);
      const boxB = layout.cards.get(b);
      if (seen.has(key) || !boxA || !boxB) {
        continue;
      }
      seen.add(key);
      const [x1, y1] = center(boxA);
      const [x2, y2] = center(boxB);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const bend = (seeded(key) - CENTRE) * LINK_BEND * len;
      const qx = (x1 + x2) / 2 - (dy / len) * bend;
      const qy = (y1 + y2) / 2 + (dx / len) * bend;
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", `M${x1} ${y1} Q${qx} ${qy} ${x2} ${y2}`);
      path.dataset.a = a;
      path.dataset.b = b;
      svg.appendChild(path);
    }
  }
};

const STAGGER_PER_PX = 0.4;
const STAGGER_MAX = 520;
/** Stickers and doodles land a little after the cards. */
const DECOR_DELAY = 180;

/** Things this far outside the window still land; the rest just sit there. */
const LAND_MARGIN = 120;

const offScreen = (r: DOMRect) =>
  r.right < -LAND_MARGIN ||
  r.bottom < -LAND_MARGIN ||
  r.left > window.innerWidth + LAND_MARGIN ||
  r.top > window.innerHeight + LAND_MARGIN;

/**
 * Entrance order: centre first, outwards. Sets `--d` on each element from
 * its distance to the world origin (needs the current camera). Elements
 * nobody can see get `data-still` and skip the animation (canvas.css):
 * every landing element is a compositor layer while it runs, which old
 * machines feel.
 */
export const setStagger = (
  world: HTMLElement,
  cam: { x: number; y: number; s: number }
) => {
  const items = world.querySelectorAll<HTMLElement>(
    ".card, .friend, .exchange, .intro, .topic, .sticker, .arrow, .scribble"
  );
  for (const el of items) {
    const r = el.getBoundingClientRect();
    el.toggleAttribute("data-still", offScreen(r));
    const x = (r.left + r.width / 2 - cam.x) / cam.s;
    const y = (r.top + r.height / 2 - cam.y) / cam.s;
    const decor =
      el.classList.contains("sticker") ||
      el.classList.contains("arrow") ||
      el.classList.contains("scribble");
    const delay =
      Math.min(STAGGER_MAX, Math.hypot(x, y) * STAGGER_PER_PX) +
      (decor ? DECOR_DELAY : 0);
    el.style.setProperty("--d", `${Math.round(delay)}ms`);
  }
};
