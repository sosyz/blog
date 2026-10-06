// biome-ignore-all lint/style/noMagicNumbers: pixel maths on RGBA bytes (4 per pixel, alpha at +3, 0–255) and tuned constants, named where they carry meaning
/**
 * The white die-cut border of a workshop sticker, on plain pixel arrays (no
 * DOM, so bun test can run it). An exact Euclidean distance transform gives
 * a round, even border of any width; holes enclosed by the artwork are
 * filled, as on a real die-cut sticker.
 *
 * distanceTransform1D, the exterior flood fill and the coverage formula are
 * ported from CatsJuice/sticker-forge (lib/source.ts, MIT; see
 * ATTRIBUTIONS.md). The 1D pass is Felzenszwalb & Huttenlocher's lower
 * envelope of parabolas.
 */

/** Alpha at or above this counts as part of the artwork (0.1 × 255). */
export const VISIBLE_ALPHA = 26;
const OPAQUE = 255;
const HALF_PIXEL = 0.5;
/** Larger than any squared distance inside a 4096 px image. */
const FAR = 1_000_000_000_000;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export interface Box {
  height: number;
  width: number;
  x: number;
  y: number;
}

/**
 * Transparent pixels connected to the image edge (4-neighbour flood fill).
 * Everything else is artwork or a hole inside it.
 */
export const exteriorMask = (
  alpha: ArrayLike<number>,
  width: number,
  height: number
) => {
  const exterior = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const visit = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return;
    }
    const index = y * width + x;
    if (exterior[index] || (alpha[index] ?? 0) >= VISIBLE_ALPHA) {
      return;
    }
    exterior[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    visit(0, y);
    visit(width - 1, y);
  }
  while (head < tail) {
    const index = queue[head] ?? 0;
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    visit(x - 1, y);
    visit(x + 1, y);
    visit(x, y - 1);
    visit(x, y + 1);
  }
  return exterior;
};

interface Line {
  length: number;
  offset: number;
  source: Float32Array;
  stride: number;
  target: Float32Array;
}

/** Squared distance along one row or column (in place from source to target). */
const distanceTransform1D = (
  line: Line,
  parabolas: Int32Array,
  bounds: Float64Array
) => {
  const { source, target, offset, stride, length } = line;
  const f = (i: number) => source[offset + i * stride] ?? FAR;
  const meet = (q: number, p: number) =>
    (f(q) + q * q - (f(p) + p * p)) / (2 * q - 2 * p);
  let k = 0;
  parabolas[0] = 0;
  bounds[0] = Number.NEGATIVE_INFINITY;
  bounds[1] = Number.POSITIVE_INFINITY;
  for (let q = 1; q < length; q += 1) {
    let s = meet(q, parabolas[k] ?? 0);
    while (s <= (bounds[k] ?? 0) && k > 0) {
      k -= 1;
      s = meet(q, parabolas[k] ?? 0);
    }
    k += 1;
    parabolas[k] = q;
    bounds[k] = s;
    bounds[k + 1] = Number.POSITIVE_INFINITY;
  }
  k = 0;
  for (let q = 0; q < length; q += 1) {
    while ((bounds[k + 1] ?? 0) < q) {
      k += 1;
    }
    const p = parabolas[k] ?? 0;
    target[offset + q * stride] = (q - p) * (q - p) + f(p);
  }
};

/**
 * Squared Euclidean distance from every pixel to the nearest artwork pixel
 * (visible, or inside a hole of the artwork). Null when there is no artwork.
 */
export const squaredDistanceToArtwork = (
  alpha: ArrayLike<number>,
  width: number,
  height: number
) => {
  const size = width * height;
  const exterior = exteriorMask(alpha, width, height);
  const grid = new Float32Array(size);
  let any = false;
  for (let i = 0; i < size; i += 1) {
    const inside = !exterior[i];
    grid[i] = inside ? 0 : FAR;
    any ||= inside;
  }
  if (!any) {
    return null;
  }
  const rows = new Float32Array(size);
  const longest = Math.max(width, height);
  const parabolas = new Int32Array(longest);
  const bounds = new Float64Array(longest + 1);
  for (let y = 0; y < height; y += 1) {
    distanceTransform1D(
      {
        length: width,
        offset: y * width,
        source: grid,
        stride: 1,
        target: rows,
      },
      parabolas,
      bounds
    );
  }
  for (let x = 0; x < width; x += 1) {
    distanceTransform1D(
      { length: height, offset: x, source: rows, stride: width, target: grid },
      parabolas,
      bounds
    );
  }
  return grid;
};

/**
 * Coverage (0–255) of a border `radius` px wide around the artwork, holes
 * filled; the edge is anti-aliased over one pixel.
 */
export const outlineAlpha = (
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  radius: number
) => {
  const out = new Uint8ClampedArray(width * height);
  const distance = squaredDistanceToArtwork(alpha, width, height);
  if (!distance) {
    return out;
  }
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.round(
      clamp01(radius + HALF_PIXEL - Math.sqrt(distance[i] ?? FAR)) * OPAQUE
    );
  }
  return out;
};

/**
 * Puts the artwork (RGBA, straight alpha) over a white border of the given
 * coverage, in place.
 */
export const compositeOverWhite = (
  rgba: Uint8ClampedArray,
  outline: ArrayLike<number>
) => {
  for (let i = 0; i < outline.length; i += 1) {
    const o = i * 4;
    const art = (rgba[o + 3] ?? 0) / OPAQUE;
    const border = (outline[i] ?? 0) / OPAQUE;
    const under = border * (1 - art);
    const total = art + under;
    if (total <= 0) {
      rgba[o + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c += 1) {
      rgba[o + c] = ((rgba[o + c] ?? 0) * art + OPAQUE * under) / total;
    }
    rgba[o + 3] = total * OPAQUE;
  }
  return rgba;
};

/**
 * Alpha of a rounded rectangle filling width × height (corner radius r),
 * anti-aliased: the die-cut shape for an opaque picture without a cutout.
 */
export const roundedRectAlpha = (width: number, height: number, r: number) => {
  const out = new Uint8ClampedArray(width * height);
  const radius = Math.max(0, Math.min(r, width / 2, height / 2));
  for (let y = 0; y < height; y += 1) {
    const py = y + HALF_PIXEL;
    const dy = Math.max(radius - py, py - (height - radius), 0);
    for (let x = 0; x < width; x += 1) {
      const px = x + HALF_PIXEL;
      const dx = Math.max(radius - px, px - (width - radius), 0);
      const inside =
        dx > 0 && dy > 0
          ? clamp01(radius + HALF_PIXEL - Math.hypot(dx, dy))
          : 1;
      out[y * width + x] = Math.round(inside * OPAQUE);
    }
  }
  return out;
};

/** Smallest box holding every pixel with alpha ≥ threshold; null if none. */
export const alphaBounds = (
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  threshold = 1
): Box | null => {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((alpha[y * width + x] ?? 0) >= threshold) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < 0) {
    return null;
  }
  return { height: bottom - top + 1, width: right - left + 1, x: left, y: top };
};

/** More than this share of clearly see-through pixels = the picture already has a cutout. */
const TRANSPARENT_SHARE = 0.005;
const SEE_THROUGH = 128;

/** Whether an alpha channel has meaningful transparency (not just a stray pixel). */
export const hasTransparency = (
  alpha: Iterable<number> & { length: number }
) => {
  let count = 0;
  for (const value of alpha) {
    if (value < SEE_THROUGH) {
      count += 1;
    }
  }
  return count > alpha.length * TRANSPARENT_SHARE;
};

/** U²-Net's matte tail often holds the old background; squeeze it (sticker-forge). */
const MATTE_BLACK = 0.12;
const MATTE_WHITE = 0.78;

/** Cleans one matte value (0–255) into an alpha factor 0–1 (smoothstep). */
export const cleanMatteAlpha = (value: number) => {
  const t = clamp01(
    (clamp01(value / OPAQUE) - MATTE_BLACK) / (MATTE_WHITE - MATTE_BLACK)
  );
  return t * t * (3 - 2 * t);
};
