/**
 * Stickers anyone has dragged just for themselves: an offset (dx, dy in world
 * px) per sticker key, kept in this browser only (localStorage). Visitor
 * stickers are keyed `vs:<id>`, the built-in ones by `data-sticker-key` in
 * Canvas.astro (`dog:people-dog`, `pile:<topic>:<name>`, `outer:<name>`).
 *
 * The functions on maps are pure (tests/sticker-offsets.test.ts); only
 * readOffsets / writeOffsets touch storage.
 */

export type Offset = { dx: number; dy: number };
export type Offsets = Record<string, Offset>;

const KEY = "interact:sticker-offsets";
/** Keys look like `vs:<uuid>`, `outer:place-tower` or `pile:运维与网络:obj-cloud`. */
const OFFSET_KEY = /^[\p{L}\p{N}\p{M} _:.-]{1,120}$/u;
/** Further than this from where it belongs is surely a mistake. */
export const MAX_OFFSET = 5000;
/** At most this many stickers remembered. */
export const MAX_OFFSETS = 200;
/** Offsets closer than this to zero count as "back in place". */
const NEAR_ZERO = 0.5;

const clamp = (value: number) =>
  Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, Math.round(value)));

const isOffset = (value: unknown): value is Offset =>
  typeof value === "object" &&
  value !== null &&
  Number.isFinite((value as Offset).dx) &&
  Number.isFinite((value as Offset).dy);

/** Whatever was stored → a clean map (bad keys and values dropped). */
export const normaliseOffsets = (raw: unknown): Offsets => {
  const out: Offsets = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return out;
  }
  for (const [key, value] of Object.entries(raw).slice(0, MAX_OFFSETS)) {
    if (OFFSET_KEY.test(key) && isOffset(value)) {
      const offset = { dx: clamp(value.dx), dy: clamp(value.dy) };
      if (offset.dx !== 0 || offset.dy !== 0) {
        out[key] = offset;
      }
    }
  }
  return out;
};

/** A copy with this sticker's offset set (or removed when it is ~0). */
export const withOffset = (
  offsets: Offsets,
  key: string,
  offset: Offset
): Offsets => {
  const { [key]: _old, ...rest } = offsets;
  if (!OFFSET_KEY.test(key)) {
    return rest;
  }
  if (Math.abs(offset.dx) < NEAR_ZERO && Math.abs(offset.dy) < NEAR_ZERO) {
    return rest;
  }
  const next = {
    ...rest,
    [key]: { dx: clamp(offset.dx), dy: clamp(offset.dy) },
  };
  const keys = Object.keys(next);
  // Newest last; forget the oldest beyond the cap.
  return keys.length > MAX_OFFSETS
    ? Object.fromEntries(
        keys.slice(-MAX_OFFSETS).map((k) => [k, next[k] as Offset])
      )
    : next;
};

export const offsetOf = (offsets: Offsets, key: string): Offset =>
  offsets[key] ?? { dx: 0, dy: 0 };

export const hasOffsets = (offsets: Offsets) => Object.keys(offsets).length > 0;

export const visitorStickerKey = (id: string) => `vs:${id}`;

export const readOffsets = (): Offsets => {
  try {
    return normaliseOffsets(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return {};
  }
};

export const writeOffsets = (offsets: Offsets) => {
  try {
    if (hasOffsets(offsets)) {
      localStorage.setItem(KEY, JSON.stringify(offsets));
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // Private mode or quota: the offset just lasts until the next load.
  }
};
