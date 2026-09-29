// biome-ignore-all lint/style/noMagicNumbers: pixel maths on RGBA bytes (4 per pixel, alpha at +3, 0–255) and tuned constants, named where they carry meaning
/**
 * 手账滤镜: a subtle warm, slightly faded print with paper grain, so a photo
 * sits next to the hand-drawn stickers. Applied to the artwork only (before
 * the white border goes under it). Pure: RGBA in, changed in place.
 */

/** Share of colour taken out (0 = none). */
const DESATURATE = 0.1;
/** Added to R / G / B after desaturating: a little warmer, a little less blue. */
const WARM = [7, 3, -8] as const;
/** Lift the blacks a touch, like ink on paper. */
const FADE = 6;
/**
 * How strongly the grain texture's relative deviation from its average
 * darkens / lightens the pixel (the paper grain varies about ±5 %).
 */
const GRAIN = 0.7;
const MAX = 255;
/** Rec. 601 luma. */
const LUMA = [0.299, 0.587, 0.114] as const;

const average = (values: Iterable<number> & { length: number }) => {
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return values.length > 0 ? sum / values.length : 0;
};

/**
 * rgba: straight-alpha pixels; grain: one grey value (0–255) per pixel from
 * the paper texture, or null for no grain.
 */
/** One pixel at byte offset o: mute, warm, fade, then grain (texture factor). */
const filterPixel = (rgba: Uint8ClampedArray, o: number, texture: number) => {
  const r = rgba[o] ?? 0;
  const g = rgba[o + 1] ?? 0;
  const b = rgba[o + 2] ?? 0;
  const luma = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
  const channels = [r, g, b];
  for (let c = 0; c < 3; c += 1) {
    const value = channels[c] ?? 0;
    const muted = value + (luma - value) * DESATURATE + (WARM[c] ?? 0);
    const faded = FADE + (muted * (MAX - FADE)) / MAX;
    rgba[o + c] = faded * texture;
  }
};

export const applyJournalFilter = (
  rgba: Uint8ClampedArray,
  grain: Uint8ClampedArray | null
) => {
  const mean = grain ? average(grain) : 0;
  const pixels = rgba.length / 4;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    if ((rgba[o + 3] ?? 0) > 0) {
      const texture =
        grain && mean > 0
          ? 1 + (GRAIN * ((grain[i] ?? mean) - mean)) / mean
          : 1;
      filterPixel(rgba, o, texture);
    }
  }
  return rgba;
};
