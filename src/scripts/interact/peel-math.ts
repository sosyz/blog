// biome-ignore-all lint/style/noMagicNumbers: geometry constants are named where they matter
/**
 * Pure maths behind the sticker "peel" (撕起来): a paper curl where the part
 * of the sticker behind a moving fold line wraps round a cylinder and flips
 * over, showing its white backing. `peel-gl.ts` runs the same mapping in a
 * vertex shader; these functions are the reference (tests/peel-math.test.ts).
 *
 * The cylinder curl is adapted from CatsJuice/sticker-forge (MIT,
 * `lib/shaders.ts`: `deformSticker`, `stickerSurfaceNormal`); see
 * ATTRIBUTIONS.md.
 *
 * The hand: `heldShift` is the forward model (where the point the pointer
 * holds has gone for a given curl), `progressForPull` inverts it while the
 * sticker is peeled, and `pinnedCentre` keeps that point under the pointer
 * once it is off.
 *
 * Coordinates: the sticker's local frame in CSS px, centred on the sticker,
 * x right, y down (like the screen before rotation), z up towards the viewer.
 */

/**
 * The curl stops turning at this angle (radians) and the rest of the lifted
 * part goes straight on as a flat tail. A little under π, so the tail rises
 * away from the sticker instead of lying flat on it like a turned page.
 */
export const MAX_CURL_ANGLE = 2.75;
/** Curl radius as a share of the sticker's short side, at progress 0 and 1. */
const RADIUS_START = 0.11;
const RADIUS_END = 0.07;
/** The radius never goes below this many px (degenerate curl). */
const MIN_RADIUS = 0.75;
/** At progress 1 the fold is pushed this far (px) past the far edge, so every point is lifted. */
const FULL_PEEL_OVERSHOOT = 2;
/** Mild perspective: camera distance in CSS px above the sticker centre. */
export const PERSPECTIVE_DISTANCE = 1600;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Curl radius: shrinks a little as the peel goes on, and is tighter while the
 * lifted part is still short (so a freshly lifted corner curls up at once
 * instead of barely bending — sticker-forge's adaptive radius).
 */
export const curlRadius = (
  shortSide: number,
  progress: number,
  depth: number
) => {
  const t = clamp01(progress);
  const base = shortSide * (RADIUS_START + (RADIUS_END - RADIUS_START) * t);
  return Math.max(MIN_RADIUS, Math.min(base, depth / MAX_CURL_ANGLE));
};

/** Where the silhouette starts and ends along a direction (local px). */
export interface Range {
  max: number;
  min: number;
}

/** A width and height, CSS px. */
export interface Size {
  height: number;
  width: number;
}
/** A unit direction (local). */
export interface Direction {
  x: number;
  y: number;
}

/**
 * Extent of the silhouette along `dir`. `hull` holds (u, v) pairs in the
 * sticker's unit square (see `silhouetteHull`); an empty hull means the whole
 * rectangle. Writes into `out` (no allocation) and returns it.
 */
export const supportRange = (
  hull: ArrayLike<number>,
  size: Size,
  dir: Direction,
  out: Range
) => {
  const dx = dir.x * size.width;
  const dy = dir.y * size.height;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < hull.length; i += 2) {
    const along =
      ((hull[i] ?? 0.5) - 0.5) * dx + ((hull[i + 1] ?? 0.5) - 0.5) * dy;
    min = Math.min(min, along);
    max = Math.max(max, along);
  }
  if (hull.length < 2) {
    max = (Math.abs(dx) + Math.abs(dy)) / 2;
    min = -max;
  }
  out.min = min;
  out.max = max;
  return out;
};

/** Everything the curl needs for one frame, in the sticker's local frame. */
export interface PeelGeometry {
  /** Unit direction the curl travels (local). */
  dirX: number;
  dirY: number;
  /** Fold line: points with along < front are lifted. */
  front: number;
  maxAlong: number;
  maxAngle: number;
  /** Silhouette extent along the direction. */
  minAlong: number;
  radius: number;
}

export const createGeometry = (): PeelGeometry => ({
  dirX: 1,
  dirY: 0,
  front: 0,
  maxAlong: 0,
  maxAngle: MAX_CURL_ANGLE,
  minAlong: 0,
  radius: 1,
});

/** The inputs of `peelGeometry` (a subset of `PeelFrame`). */
export interface PeelInput {
  direction: number;
  grabU: number;
  grabV: number;
  height: number;
  progress: number;
  rotation: number;
  width: number;
}

const scratchRange: Range = { max: 0, min: 0 };
const scratchDirection: Direction = { x: 1, y: 0 };

/**
 * Fold line, direction and radius for a frame. The curl starts at the part of
 * the silhouette furthest back along `direction` — the edge or corner nearest
 * the grab point when `direction` runs from the grab point towards the centre
 * — and the fold moves forward with `progress` until, at 1, all of it is
 * lifted. When `direction` is not a finite number it falls back to "from the
 * grab point towards the centre". Writes into `out`.
 */
export const peelGeometry = (
  input: PeelInput,
  hull: ArrayLike<number>,
  out: PeelGeometry
) => {
  let dirX = 0;
  let dirY = 0;
  if (Number.isFinite(input.direction)) {
    const local = input.direction - input.rotation;
    dirX = Math.cos(local);
    dirY = Math.sin(local);
  } else {
    dirX = (0.5 - input.grabU) * input.width;
    dirY = (0.5 - input.grabV) * input.height;
    const length = Math.hypot(dirX, dirY);
    if (length > 1e-6) {
      dirX /= length;
      dirY /= length;
    } else {
      dirX = 1;
      dirY = 0;
    }
  }
  scratchDirection.x = dirX;
  scratchDirection.y = dirY;
  const range = supportRange(hull, input, scratchDirection, scratchRange);
  const progress = clamp01(input.progress);
  const depth = progress * (range.max - range.min + FULL_PEEL_OVERSHOOT);
  out.dirX = dirX;
  out.dirY = dirY;
  out.minAlong = range.min;
  out.maxAlong = range.max;
  out.front = progress > 0 ? range.min + depth : Number.NEGATIVE_INFINITY;
  out.radius = curlRadius(Math.min(input.width, input.height), progress, depth);
  out.maxAngle = MAX_CURL_ANGLE;
  return out;
};

/** A curled point: position (local px, z up) and unit normal of the front face. */
export interface CurlPoint {
  /** How far round the cylinder the point went (0 = still flat). */
  angle: number;
  nx: number;
  ny: number;
  nz: number;
  x: number;
  y: number;
  z: number;
}

export const createCurlPoint = (): CurlPoint => ({
  angle: 0,
  nx: 0,
  ny: 0,
  nz: 1,
  x: 0,
  y: 0,
  z: 0,
});

/**
 * Maps a flat point (local px) onto the curl. Points ahead of the fold line
 * stay put; points behind it roll round a cylinder of radius `radius` whose
 * axis runs along the fold line at height `radius`, then continue as a
 * straight tail once they have turned `maxAngle`. Same as the vertex shader.
 */
export const curlPoint = (
  x: number,
  y: number,
  geometry: PeelGeometry,
  out: CurlPoint
) => {
  const { dirX, dirY, front, maxAngle } = geometry;
  const radius = Math.max(geometry.radius, 1e-3);
  const along = x * dirX + y * dirY;
  const arc = front - along;
  if (!(arc > 0)) {
    out.x = x;
    out.y = y;
    out.z = 0;
    out.nx = 0;
    out.ny = 0;
    out.nz = 1;
    out.angle = 0;
    return out;
  }
  const angle = Math.min(arc / radius, maxAngle);
  let projected = -radius * Math.sin(angle);
  let elevation = radius * (1 - Math.cos(angle));
  const free = arc - radius * maxAngle;
  if (free > 0) {
    projected -= free * Math.cos(maxAngle);
    elevation += free * Math.sin(maxAngle);
  }
  const shift = arc + projected;
  out.x = x + dirX * shift;
  out.y = y + dirY * shift;
  out.z = elevation;
  const sine = Math.sin(angle);
  out.nx = dirX * sine;
  out.ny = dirY * sine;
  out.nz = Math.cos(angle);
  out.angle = angle;
  return out;
};

/** Where a local point (after the curl) lands on screen, CSS px. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Rotates a local point by the sticker's rotation, adds a mild perspective
 * centred on the sticker (so the flat plane z = 0 maps exactly onto the DOM
 * sticker) and translates to the sticker centre. Writes into `out`.
 */
export const toScreen = (
  point: { x: number; y: number; z: number },
  frame: { cx: number; cy: number; rotation: number },
  out: ScreenPoint
) => {
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const scale =
    PERSPECTIVE_DISTANCE / Math.max(PERSPECTIVE_DISTANCE - point.z, 1);
  out.x = frame.cx + (point.x * cos - point.y * sin) * scale;
  out.y = frame.cy + (point.x * sin + point.y * cos) * scale;
  return out;
};

/* ---------- the held point (撕下来 and carrying it) ---------- */

const pullInput: PeelInput = {
  direction: 0,
  grabU: 0.5,
  grabV: 0.5,
  height: 0,
  progress: 0,
  rotation: 0,
  width: 0,
};
const pullGeometry = createGeometry();
const pullPoint = createCurlPoint();
const pullFlat: ScreenPoint = { x: 0, y: 0 };
const pullCurled: ScreenPoint = { x: 0, y: 0 };
const pullOrigin = { cx: 0, cy: 0, rotation: 0 };
const pullShift: ScreenPoint = { x: 0, y: 0 };
const PULL_STEPS = 20;

/**
 * The forward model of the hand: where the held point has gone (screen px,
 * curled minus flat) with the curl at `progress`. The held point is the
 * rear edge of the silhouette on the line through the centre along the
 * curl's direction — the edge the curl starts from, which the pointer holds
 * (as in sticker-forge, where the grab is always on that edge). It is
 * rolled over and carried forward along the direction: 0 at progress 0,
 * about twice the sticker's extent along the direction at 1. Both points
 * lie on the centre line and the perspective scales from the centre, so the
 * shift is always along the direction. Writes into `out`.
 */
export const heldShift = (
  progress: number,
  input: Omit<PeelInput, "progress">,
  hull: ArrayLike<number>,
  out: ScreenPoint
) => {
  Object.assign(pullInput, input);
  pullInput.progress = progress;
  const geometry = peelGeometry(pullInput, hull, pullGeometry);
  const x = geometry.dirX * geometry.minAlong;
  const y = geometry.dirY * geometry.minAlong;
  curlPoint(x, y, geometry, pullPoint);
  pullOrigin.rotation = input.rotation;
  toScreen(pullPoint, pullOrigin, pullCurled);
  toScreen({ x, y, z: 0 }, pullOrigin, pullFlat);
  out.x = pullCurled.x - pullFlat.x;
  out.y = pullCurled.y - pullFlat.y;
  return out;
};

/**
 * How far (screen px, along the curl's direction) the held point has
 * travelled at `progress`: `heldShift` measured along the direction. This
 * is what follows the pointer while a sticker is being peeled.
 */
export const rearShift = (
  progress: number,
  input: Omit<PeelInput, "progress">,
  hull: ArrayLike<number>
) => {
  heldShift(progress, input, hull, pullShift);
  const cos = Math.cos(input.rotation);
  const sin = Math.sin(input.rotation);
  const { dirX, dirY } = pullGeometry;
  const screenX = dirX * cos - dirY * sin;
  const screenY = dirX * sin + dirY * cos;
  return pullShift.x * screenX + pullShift.y * screenY;
};

/**
 * Where to draw the sticker's centre so the held point stays where the
 * hand has it: `centre` is where the sticker would lie flat (the element,
 * moved with the pointer), and the curl at `progress` has carried the held
 * point `heldShift` ahead of it, so the drawing goes back by as much. At
 * progress 0 it is `centre` itself: letting go flattens it onto the element.
 */
export const pinnedCentre = (
  centre: ScreenPoint,
  progress: number,
  input: Omit<PeelInput, "progress">,
  hull: ArrayLike<number>
): ScreenPoint => {
  heldShift(progress, input, hull, pullShift);
  return { x: centre.x - pullShift.x, y: centre.y - pullShift.y };
};

/**
 * The progress at which the rear edge has travelled `distance` screen px
 * along the curl's direction (bisection on `rearShift`, which grows with
 * progress): the curl that keeps the peeled edge with the pointer. 0 for no
 * pull, 1 once the pull reaches `rearShift(1, …)`.
 */
export const progressForPull = (
  distance: number,
  input: Omit<PeelInput, "progress">,
  hull: ArrayLike<number>
) => {
  if (!(distance > 0)) {
    return 0;
  }
  if (distance >= rearShift(1, input, hull)) {
    return 1;
  }
  let low = 0;
  let high = 1;
  for (let step = 0; step < PULL_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (rearShift(middle, input, hull) < distance) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
};

/** Alpha at or above this counts as part of the silhouette. */
const HULL_ALPHA = 24;

type Point = [number, number];

const cross = (o: Point, a: Point, b: Point) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** How the alpha values are laid out: one byte per pixel, or RGBA with `stride` 4 and `channel` 3. */
export interface AlphaLayout {
  channel?: number;
  stride?: number;
}

/** Corners of the leftmost and rightmost opaque pixel in each row: only these can be on the hull. */
const rowExtremes = (
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  layout: AlphaLayout
) => {
  const stride = layout.stride ?? 1;
  const channel = layout.channel ?? 0;
  const opaque = (x: number, y: number) =>
    (alpha[(y * width + x) * stride + channel] ?? 0) >= HULL_ALPHA;
  const points: Point[] = [];
  for (let y = 0; y < height; y += 1) {
    let left = 0;
    while (left < width && !opaque(left, y)) {
      left += 1;
    }
    let right = width - 1;
    while (right > left && !opaque(right, y)) {
      right -= 1;
    }
    if (left < width) {
      points.push([left, y], [left, y + 1], [right + 1, y], [right + 1, y + 1]);
    }
  }
  return points;
};

/** One half of Andrew's monotone chain (points already sorted). */
const chain = (points: readonly Point[]) => {
  const out: Point[] = [];
  for (const p of points) {
    let a = out.at(-2);
    let b = out.at(-1);
    while (a && b && cross(a, b, p) <= 0) {
      out.pop();
      a = out.at(-2);
      b = out.at(-1);
    }
    out.push(p);
  }
  out.pop();
  return out;
};

/**
 * Convex hull of the opaque part of an alpha mask, as (u, v) pairs in the
 * unit square (cell corners, so the hull covers the pixels). Empty mask →
 * empty array (the caller then treats the sticker as its full rectangle).
 * Computed once per sticker, so it may allocate.
 */
export const silhouetteHull = (
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  layout: AlphaLayout = {}
) => {
  const points = rowExtremes(alpha, width, height, layout);
  if (points.length === 0) {
    return new Float32Array(0);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const hull = [...chain(points), ...chain(points.toReversed())];
  const out = new Float32Array(hull.length * 2);
  for (const [i, [px, py]] of hull.entries()) {
    out[i * 2] = px / width;
    out[i * 2 + 1] = py / height;
  }
  return out;
};
