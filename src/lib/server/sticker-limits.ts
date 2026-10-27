/**
 * Where and how a visitor sticker may sit on the canvas. Shared by the
 * server validation (validate.ts) and the browser (placing and moving
 * stickers), so both clamp and round the same way. Pure, no imports: the
 * client must not pull zod in through validate.ts.
 */

export const STICKER_PLACEMENT = {
  /** Degrees either way. */
  rotation: 45,
  scaleMax: 1.6,
  scaleMin: 0.4,
  /** World coordinates stay within this box around the intro card. */
  world: 20_000,
} as const;

export interface Placement {
  rotation: number;
  scale: number;
  x: number;
  y: number;
}

const ROTATION_PRECISION = 10;
const SCALE_PRECISION = 100;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Stored precision: whole world px, 0.1°, scale in 0.01 steps. The upload,
 * both move endpoints and the client use this, so what the visitor sees is
 * what the database keeps.
 */
export const roundPlacement = (placement: Placement): Placement => {
  const { world, rotation, scaleMin, scaleMax } = STICKER_PLACEMENT;
  return {
    rotation: clamp(
      Math.round(placement.rotation * ROTATION_PRECISION) / ROTATION_PRECISION,
      -rotation,
      rotation
    ),
    scale: clamp(
      Math.round(placement.scale * SCALE_PRECISION) / SCALE_PRECISION,
      scaleMin,
      scaleMax
    ),
    x: clamp(Math.round(placement.x), -world, world),
    y: clamp(Math.round(placement.y), -world, world),
  };
};

/**
 * What a sticker is stuck to (migrations/0002_sticker_anchor.sql): the intro
 * card, the 友链 pile or a note's card, and that thing's top-left corner in
 * world px when the sticker was placed.
 */
export interface StickerAnchor {
  /** 'intro', 'friends' or 'card:<slug>'. */
  key: string;
  x: number;
  y: number;
}

/** Anchor keys the canvas can resolve (slugs as in validate.ts). */
export const ANCHOR_KEY = /^(?:intro|friends|card:[a-z0-9][a-z0-9-]{0,119})$/;

/** Stored like the position: whole world px, inside the world box. */
export const roundAnchor = (anchor: StickerAnchor): StickerAnchor => {
  const { world } = STICKER_PLACEMENT;
  return {
    key: anchor.key,
    x: clamp(Math.round(anchor.x), -world, world),
    y: clamp(Math.round(anchor.y), -world, world),
  };
};

export const samePlacement = (a: Placement, b: Placement) =>
  a.x === b.x &&
  a.y === b.y &&
  a.rotation === b.rotation &&
  a.scale === b.scale;
