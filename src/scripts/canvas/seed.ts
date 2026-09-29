/**
 * Deterministic "randomness" for the journal look, shared by the server
 * (Astro frontmatter renders tapes, rotations and stickers) and the client
 * (layout jitter). The keys match the approved prototype, so every card gets
 * the same tape, tilt and offset there and here.
 */

const FNV_OFFSET = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const BUCKETS = 10_000;
/** Seeded values are in [0, 1); subtract this to centre them on zero. */
const CENTRE = 0.5;

/** FNV-1a hash of a string → a stable number in [0, 1). */
export const seeded = (key: string) => {
  let hash = FNV_OFFSET;
  for (const char of key) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a is defined with XOR
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME);
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: unsigned view of the 32-bit hash
  return ((hash >>> 0) % BUCKETS) / BUCKETS;
};

/** A stable angle in degrees within ±span/2, e.g. rot(slug, 3.4) → ±1.7°. */
export const rot = (key: string, span: number) =>
  Number(((seeded(key) - CENTRE) * span).toFixed(2));

/** Pick a stable item from a list. */
export const pick = <T>(key: string, list: readonly T[]) =>
  list[Math.floor(seeded(key) * list.length)] as T;

/** Washi and masking tapes in /journal/tape/ (rendered at 2x). */
export const TAPES = [
  "washi-grid-ivory",
  "washi-stripes-pink",
  "washi-dots-mustard",
  "washi-plain-sage",
  "masking-cream",
  "kraft-brown",
] as const;

export type TapeName = (typeof TAPES)[number];

export const tapeSrc = (name: TapeName) => `/journal/tape/${name}.webp`;
export const stickerSrc = (name: string) => `/stickers/${name}.webp`;

/** Share of index cards held by a paperclip instead of tape. */
const CLIP_SHARE = 0.2;
const CARD_TILT = 3.4;
const TAPE_TILT = 8;

/** Tilt of a card on the canvas (±1.7°). */
export const cardTilt = (slug: string) => rot(slug, CARD_TILT);

/** How an index card is fixed to the desk: a paperclip or a strip of tape. */
export const cardFixing = (
  slug: string
): { kind: "clip" } | { kind: "tape"; tape: TapeName; tilt: number } =>
  seeded(`${slug}c`) < CLIP_SHARE
    ? { kind: "clip" }
    : {
        kind: "tape",
        tape: pick(`${slug}t`, TAPES),
        tilt: rot(`${slug}tr`, TAPE_TILT),
      };

/**
 * Stickers stuck next to each topic pile (first one beside the topic name,
 * second one at the bottom-right corner). Topics without an entry get none.
 */
export const TOPIC_STICKERS: Readonly<Record<string, readonly string[]>> = {
  AI: ["obj-idea"],
  Web: ["obj-laptop", "obj-bug"],
  后端: ["obj-tools", "obj-coffee"],
  Go: ["people-coder"],
  云原生: ["obj-cloud"],
  运维与网络: ["place-lighthouse"],
  早年笔记: ["people-coffee"],
};

/** Places and people around the outer ring of the canvas. */
export const OUTER_STICKERS = [
  "place-tower",
  "place-tram",
  "place-mountain",
  "place-bridge",
  "people-traveler",
  "place-shop",
] as const;

/** The owner's avatar: the dog with glasses and headphones. */
export const DOG_STICKER = "people-dog";
