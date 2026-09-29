// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  createCurlPoint,
  createGeometry,
  curlPoint,
  curlRadius,
  heldShift,
  MAX_CURL_ANGLE,
  type PeelInput,
  peelGeometry,
  pinnedCentre,
  progressForPull,
  rearShift,
  silhouetteHull,
  supportRange,
  toScreen,
} from "../src/scripts/interact/peel-math";

const WIDTH = 200;
const HEIGHT = 120;
const FULL_RECT = new Float32Array(0);
const SIZE = { width: WIDTH, height: HEIGHT };
const DIAGONAL = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
const RGBA = { stride: 4, channel: 3 };

const input = (overrides: Partial<PeelInput> = {}): PeelInput => ({
  width: WIDTH,
  height: HEIGHT,
  rotation: 0,
  grabU: 0,
  grabV: 0,
  progress: 0.4,
  direction: Math.PI / 4,
  ...overrides,
});

/** Points on a grid across the sticker (local px). */
const gridPoints = (steps = 12) => {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      points.push([(i / steps - 0.5) * WIDTH, (j / steps - 0.5) * HEIGHT]);
    }
  }
  return points;
};

describe("curlRadius", () => {
  test("shrinks as the peel goes on and stays within 6–12% of the short side", () => {
    const early = curlRadius(100, 0, 1000);
    const late = curlRadius(100, 1, 1000);
    expect(early).toBeGreaterThan(late);
    expect(early).toBeLessThanOrEqual(12);
    expect(late).toBeGreaterThanOrEqual(6);
  });

  test("is tight while only a sliver is lifted", () => {
    expect(curlRadius(100, 0.01, 5)).toBeCloseTo(5 / MAX_CURL_ANGLE);
    expect(curlRadius(100, 0.01, 0)).toBeGreaterThan(0);
  });
});

describe("supportRange", () => {
  test("full rectangle when there is no hull", () => {
    const range = supportRange(
      FULL_RECT,
      SIZE,
      { x: 1, y: 0 },
      { min: 0, max: 0 }
    );
    expect(range.min).toBeCloseTo(-WIDTH / 2);
    expect(range.max).toBeCloseTo(WIDTH / 2);
    const diagonal = supportRange(FULL_RECT, SIZE, DIAGONAL, {
      min: 0,
      max: 0,
    });
    expect(diagonal.max).toBeCloseTo((WIDTH + HEIGHT) * Math.SQRT1_2 * 0.5);
  });

  test("uses the hull points", () => {
    // A diamond touching the middle of each side.
    const hull = new Float32Array([0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5]);
    const range = supportRange(hull, { width: 100, height: 100 }, DIAGONAL, {
      min: 0,
      max: 0,
    });
    expect(range.max).toBeCloseTo(50 * Math.SQRT1_2);
    expect(range.min).toBeCloseTo(-50 * Math.SQRT1_2);
  });
});

describe("peelGeometry", () => {
  test("direction is converted into the sticker's local frame", () => {
    const g = peelGeometry(
      input({ rotation: Math.PI / 2, direction: Math.PI / 2 }),
      FULL_RECT,
      createGeometry()
    );
    expect(g.dirX).toBeCloseTo(1);
    expect(g.dirY).toBeCloseTo(0);
  });

  test("the fold starts at the back edge and reaches past the far edge at 1", () => {
    const start = peelGeometry(
      input({ progress: 0.001, direction: 0 }),
      FULL_RECT,
      createGeometry()
    );
    expect(start.front).toBeCloseTo(-WIDTH / 2, 0);
    const end = peelGeometry(
      input({ progress: 1, direction: 0 }),
      FULL_RECT,
      createGeometry()
    );
    expect(end.front).toBeGreaterThan(WIDTH / 2);
  });

  test("falls back to grab → centre when the direction is not a number", () => {
    const g = peelGeometry(
      input({ direction: Number.NaN, grabU: 0, grabV: 0.5 }),
      FULL_RECT,
      createGeometry()
    );
    expect(g.dirX).toBeCloseTo(1);
    expect(g.dirY).toBeCloseTo(0);
  });
});

describe("following the pull", () => {
  const pullOf = (overrides: Partial<PeelInput> = {}) => {
    const { progress: _ignored, ...rest } = input({
      direction: 0,
      ...overrides,
    });
    return rest;
  };

  test("the rear edge has not moved at 0 and travels about twice the width at 1", () => {
    expect(rearShift(0, pullOf(), FULL_RECT)).toBeCloseTo(0);
    const full = rearShift(1, pullOf(), FULL_RECT);
    expect(full).toBeGreaterThan(WIDTH * 1.6);
    expect(full).toBeLessThan(WIDTH * 2.2);
  });

  test("the edge travels further the more it is peeled", () => {
    let previous = -1;
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const shift = rearShift(p, pullOf(), FULL_RECT);
      expect(shift).toBeGreaterThan(previous);
      previous = shift;
    }
  });

  test("solving the pull puts the peeled edge under the pointer", () => {
    const full = rearShift(1, pullOf(), FULL_RECT);
    for (const distance of [1, 10, 40, 120, full * 0.8]) {
      const progress = progressForPull(distance, pullOf(), FULL_RECT);
      expect(progress).toBeGreaterThan(0);
      expect(progress).toBeLessThan(1);
      expect(rearShift(progress, pullOf(), FULL_RECT)).toBeCloseTo(distance, 1);
    }
  });

  test("no pull, no curl; past the full shift it is all the way off", () => {
    const full = rearShift(1, pullOf(), FULL_RECT);
    expect(progressForPull(0, pullOf(), FULL_RECT)).toBe(0);
    expect(progressForPull(-5, pullOf(), FULL_RECT)).toBe(0);
    expect(progressForPull(full, pullOf(), FULL_RECT)).toBe(1);
    expect(progressForPull(full * 2, pullOf(), FULL_RECT)).toBe(1);
  });

  test("goes back down as the pointer comes back", () => {
    const far = progressForPull(150, pullOf(), FULL_RECT);
    const near = progressForPull(60, pullOf(), FULL_RECT);
    expect(near).toBeLessThan(far);
  });

  test("a small pull only lifts a sliver, wherever the press was", () => {
    for (const [grabU, grabV] of [
      [0.5, 0.5],
      [0, 0],
      [1, 1],
    ]) {
      const progress = progressForPull(
        1,
        pullOf({ grabU, grabV, direction: Math.PI / 5 }),
        FULL_RECT
      );
      expect(progress).toBeLessThan(0.05);
    }
  });

  test("works in the sticker's frame: a turned sticker pulled the turned way is the same", () => {
    const upright = progressForPull(80, pullOf({ direction: 0 }), FULL_RECT);
    const turned = progressForPull(
      80,
      pullOf({ rotation: Math.PI / 2, direction: Math.PI / 2 }),
      FULL_RECT
    );
    expect(turned).toBeCloseTo(upright, 4);
  });

  test("the held point is carried straight along the curl's direction", () => {
    for (const rotation of [0, 0.4, -1.1]) {
      for (const direction of [0, Math.PI / 3, -2.5]) {
        const pull = pullOf({ rotation, direction });
        for (const progress of [0.1, 0.5, 0.96]) {
          const shift = heldShift(progress, pull, FULL_RECT, { x: 0, y: 0 });
          const along =
            shift.x * Math.cos(direction) + shift.y * Math.sin(direction);
          const across =
            -shift.x * Math.sin(direction) + shift.y * Math.cos(direction);
          expect(along).toBeCloseTo(rearShift(progress, pull, FULL_RECT), 6);
          expect(Math.abs(across)).toBeLessThan(1e-6);
        }
      }
    }
  });

  test("pinned: the element moved by the whole pull draws where it was stuck", () => {
    const stuck = { x: 300, y: 200 };
    for (const rotation of [0, 0.5]) {
      for (const direction of [Math.PI, -Math.PI / 4]) {
        const pull = pullOf({ rotation, direction });
        for (const length of [30, 150, 320]) {
          const progress = progressForPull(length, pull, FULL_RECT);
          const moved = {
            x: stuck.x + Math.cos(direction) * length,
            y: stuck.y + Math.sin(direction) * length,
          };
          const centre = pinnedCentre(moved, progress, pull, FULL_RECT);
          expect(centre.x).toBeCloseTo(stuck.x, 1);
          expect(centre.y).toBeCloseTo(stuck.y, 1);
        }
      }
    }
  });

  test("pinned: flat is the element itself", () => {
    const centre = pinnedCentre({ x: 10, y: 20 }, 0, pullOf(), FULL_RECT);
    expect(centre.x).toBeCloseTo(10);
    expect(centre.y).toBeCloseTo(20);
  });

  test("a narrower silhouette comes off with a shorter pull", () => {
    // The middle half of the width, full height.
    const hull = new Float32Array([0.25, 0, 0.75, 0, 0.75, 1, 0.25, 1]);
    const narrow = rearShift(1, pullOf(), hull);
    const wide = rearShift(1, pullOf(), FULL_RECT);
    expect(narrow).toBeLessThan(wide * 0.6);
  });
});

describe("curlPoint", () => {
  test("progress 0 is the identity", () => {
    const g = peelGeometry(input({ progress: 0 }), FULL_RECT, createGeometry());
    const out = createCurlPoint();
    for (const [x, y] of gridPoints()) {
      curlPoint(x, y, g, out);
      expect(out.x).toBe(x);
      expect(out.y).toBe(y);
      expect(out.z).toBe(0);
      expect(out.nz).toBe(1);
    }
  });

  test("progress 1 lifts every point", () => {
    for (const direction of [0, Math.PI / 4, 2, -2.5]) {
      const g = peelGeometry(
        input({ progress: 1, direction }),
        FULL_RECT,
        createGeometry()
      );
      const out = createCurlPoint();
      for (const [x, y] of gridPoints()) {
        curlPoint(x, y, g, out);
        expect(out.z).toBeGreaterThan(0);
      }
    }
  });

  test("points ahead of the fold are unchanged", () => {
    const g = peelGeometry(input(), FULL_RECT, createGeometry());
    const out = createCurlPoint();
    let checked = 0;
    for (const [x, y] of gridPoints()) {
      if (x * g.dirX + y * g.dirY >= g.front) {
        curlPoint(x, y, g, out);
        expect([out.x, out.y, out.z]).toEqual([x, y, 0]);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  test("points on the roll stay at distance r from the cylinder axis", () => {
    const g = peelGeometry(input(), FULL_RECT, createGeometry());
    const out = createCurlPoint();
    const r = g.radius;
    for (let arc = 0.05 * r; arc < r * g.maxAngle; arc += 0.1 * r) {
      // A point `arc` behind the fold, somewhere along it.
      const along = g.front - arc;
      const x = g.dirX * along - g.dirY * 7;
      const y = g.dirY * along + g.dirX * 7;
      curlPoint(x, y, g, out);
      // Axis: the fold line, raised to height r.
      const alongAfter = out.x * g.dirX + out.y * g.dirY;
      const distance = Math.hypot(alongAfter - g.front, out.z - r);
      expect(distance).toBeCloseTo(r, 6);
      // Sideways position (along the fold) doesn't change.
      expect(-out.x * g.dirY + out.y * g.dirX).toBeCloseTo(7, 6);
    }
  });

  test("normals are unit length and flip over past a quarter turn", () => {
    const g = peelGeometry(
      input({ progress: 0.7 }),
      FULL_RECT,
      createGeometry()
    );
    const out = createCurlPoint();
    for (const [x, y] of gridPoints()) {
      curlPoint(x, y, g, out);
      expect(Math.hypot(out.nx, out.ny, out.nz)).toBeCloseTo(1, 6);
      if (out.angle > Math.PI / 2 + 1e-6) {
        expect(out.nz).toBeLessThan(0); // the backing faces the viewer
      }
    }
  });

  test("height only grows the further back a point lies", () => {
    const g = peelGeometry(
      input({ progress: 0.8 }),
      FULL_RECT,
      createGeometry()
    );
    const out = createCurlPoint();
    let previous = -1;
    for (let along = g.maxAlong; along >= g.minAlong; along -= 1) {
      curlPoint(g.dirX * along, g.dirY * along, g, out);
      expect(out.z).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = out.z;
    }
    expect(previous).toBeGreaterThan(g.radius * 2);
  });

  test("the tail leaves the roll without a jump", () => {
    const g = peelGeometry(
      input({ progress: 0.9 }),
      FULL_RECT,
      createGeometry()
    );
    const out = createCurlPoint();
    const edge = g.front - g.radius * g.maxAngle;
    curlPoint(g.dirX * (edge + 1e-4), g.dirY * (edge + 1e-4), g, out);
    const before = { x: out.x, y: out.y, z: out.z };
    curlPoint(g.dirX * (edge - 1e-4), g.dirY * (edge - 1e-4), g, out);
    expect(
      Math.hypot(out.x - before.x, out.y - before.y, out.z - before.z)
    ).toBeLessThan(1e-3);
  });
});

describe("toScreen", () => {
  test("a flat point lands exactly where the DOM sticker has it", () => {
    const frame = { cx: 300, cy: 200, rotation: 0.3 };
    const out = { x: 0, y: 0 };
    toScreen({ x: 50, y: -20, z: 0 }, frame, out);
    const cos = Math.cos(0.3);
    const sin = Math.sin(0.3);
    expect(out.x).toBeCloseTo(300 + 50 * cos + 20 * sin, 9);
    expect(out.y).toBeCloseTo(200 + 50 * sin - 20 * cos, 9);
  });

  test("lifted points grow a little (perspective)", () => {
    const frame = { cx: 0, cy: 0, rotation: 0 };
    const out = { x: 0, y: 0 };
    toScreen({ x: 100, y: 0, z: 40 }, frame, out);
    expect(out.x).toBeGreaterThan(100);
    expect(out.x).toBeLessThan(105);
  });
});

describe("silhouetteHull", () => {
  test("covers the opaque pixels and nothing else", () => {
    const size = 20;
    const alpha = new Uint8ClampedArray(size * size);
    // Opaque block from (5, 4) to (14, 9) inclusive.
    for (let y = 4; y <= 9; y += 1) {
      for (let x = 5; x <= 14; x += 1) {
        alpha[y * size + x] = 255;
      }
    }
    const hull = silhouetteHull(alpha, size, size);
    const us = [...hull].filter((_, i) => i % 2 === 0);
    const vs = [...hull].filter((_, i) => i % 2 === 1);
    expect(Math.min(...us)).toBeCloseTo(5 / size);
    expect(Math.max(...us)).toBeCloseTo(15 / size);
    expect(Math.min(...vs)).toBeCloseTo(4 / size);
    expect(Math.max(...vs)).toBeCloseTo(10 / size);
    expect(hull.length).toBe(8); // four corners
  });

  test("reads RGBA alpha and returns nothing for an empty mask", () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    expect(silhouetteHull(rgba, 4, 4, RGBA).length).toBe(0);
    rgba[(1 * 4 + 2) * 4 + 3] = 200;
    const hull = silhouetteHull(rgba, 4, 4, RGBA);
    expect(hull.length).toBe(8);
  });
});
