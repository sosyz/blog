// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  approach,
  approachAngle,
  bendDirection,
  CRUMPLE_STOPS,
  CSS_DETACH,
  cssDetached,
  dragProgress,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  grabPoint,
  inwardAngle,
  isOver,
  layBackPose,
  NO_AIM,
  PEEL,
  PEEL_MS,
  PEEL_TAU,
  PULL_CONE,
  PULL_DEAD_ZONE,
  peelAxis,
  popPose,
  SPEED_FULL,
  settleSlack,
  shapePull,
  smoothVelocity,
  softEase,
  THROW_SIZE,
  throwPose,
  throwRoute,
  UNDO_MS,
  unrotate,
} from "../src/scripts/interact/sticker-gesture";

/** How much rotate3d(ax, ay, 0, +angle) lifts point (px, py) toward the viewer. */
const lift = ({ ax, ay }: { ax: number; ay: number }, px: number, py: number) =>
  ax * py - ay * px;

describe("peelAxis", () => {
  test("the corner under the pointer lifts, the opposite one does not", () => {
    for (const [px, py] of [
      [30, 20],
      [-30, 20],
      [30, -20],
      [-30, -20],
    ] as const) {
      const axis = peelAxis(px, py);
      expect(lift(axis, Math.sign(px), Math.sign(py))).toBeGreaterThan(0);
      expect(lift(axis, -Math.sign(px), -Math.sign(py))).toBeLessThan(0);
    }
  });

  test("a press in the middle still gives a usable axis", () => {
    const { ax, ay } = peelAxis(0, 0);
    expect(Math.hypot(ax, ay)).toBeGreaterThan(0);
  });
});

describe("unrotate", () => {
  test("no rotation leaves the offset alone", () => {
    const { dx, dy } = unrotate(10, -4, 0);
    expect(dx).toBeCloseTo(10);
    expect(dy).toBeCloseTo(-4);
  });

  test("a sticker turned 90° clockwise: screen right is its own up", () => {
    const { dx, dy } = unrotate(10, 0, 90);
    expect(dx).toBeCloseTo(0);
    expect(dy).toBeCloseTo(-10);
  });
});

describe("isOver", () => {
  const box = { left: 100, top: 100, right: 160, bottom: 160 };

  test("inside, and just outside within the slack", () => {
    expect(isOver(box, { x: 130, y: 130 })).toBe(true);
    expect(isOver(box, { x: 95, y: 165 })).toBe(true);
  });

  test("outside, or no trash on screen", () => {
    expect(isOver(box, { x: 60, y: 130 })).toBe(false);
    expect(isOver(box, { x: 95, y: 165 }, 0)).toBe(false);
    expect(isOver(null, { x: 130, y: 130 })).toBe(false);
  });
});

describe("throwRoute", () => {
  const none = {
    moderating: false,
    hasToken: false,
    accountOwned: false,
    sessionOwner: false,
  };

  test("visitors never get the trash for others' stickers", () => {
    expect(throwRoute(none)).toBeNull();
  });

  test("the uploader and the owner's GitHub session delete", () => {
    expect(throwRoute({ ...none, hasToken: true })).toBe("own");
    expect(throwRoute({ ...none, accountOwned: true })).toBe("own");
    expect(throwRoute({ ...none, sessionOwner: true })).toBe("own");
  });

  test("an Access session rejects, even for the owner's own sticker", () => {
    expect(throwRoute({ ...none, moderating: true })).toBe("admin");
    expect(
      throwRoute({
        ...none,
        moderating: true,
        hasToken: true,
        sessionOwner: true,
      })
    ).toBe("admin");
  });
});

describe("timing and crumple", () => {
  test("撤销 stays for about five seconds", () => {
    expect(UNDO_MS).toBe(5000);
  });

  test("the crumple starts where it is and ends in the bin, gone", () => {
    const first = CRUMPLE_STOPS.at(0);
    const last = CRUMPLE_STOPS.at(-1);
    expect(first?.offset).toBe(0);
    expect(first?.way).toBe(0);
    expect(last?.offset).toBe(1);
    expect(last?.way).toBe(1);
    expect(last?.opacity).toBe(0);
  });
});

/** Angle difference folded into -π … π. */
const turn = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));

describe("grabPoint", () => {
  test("an upright sticker: the pointer's place in its unit square", () => {
    expect(grabPoint({ x: 0, y: 0 }, 100, 50, 0)).toEqual({ u: 0.5, v: 0.5 });
    const corner = grabPoint({ x: 40, y: 20 }, 100, 50, 0);
    expect(corner.u).toBeCloseTo(0.9);
    expect(corner.v).toBeCloseTo(0.9);
  });

  test("turned 90° clockwise: screen right is its own top", () => {
    const grab = grabPoint({ x: 20, y: 0 }, 100, 100, 90);
    expect(grab.u).toBeCloseTo(0.5);
    expect(grab.v).toBeCloseTo(0.3);
  });

  test("outside the sticker (e.g. its shadow) is clamped to the edge", () => {
    const grab = grabPoint({ x: -300, y: 300 }, 100, 100, 0);
    expect(grab).toEqual({ u: 0, v: 1 });
  });
});

describe("inwardAngle", () => {
  test("from the grabbed corner towards the centre", () => {
    // Lower right corner, upright: up and to the left.
    expect(
      turn(inwardAngle({ u: 1, v: 1 }, 100, 100, 0), (-3 * Math.PI) / 4)
    ).toBeCloseTo(0);
    // Left edge: straight right.
    expect(inwardAngle({ u: 0, v: 0.5 }, 100, 100, 0)).toBeCloseTo(0);
  });

  test("turns with the sticker", () => {
    // Its top edge, turned 90° clockwise, faces right; inward is left.
    expect(
      Math.abs(turn(inwardAngle({ u: 0.5, v: 0 }, 100, 100, Math.PI / 2), 0))
    ).toBeCloseTo(Math.PI);
  });

  test("a press in the middle still curls", () => {
    expect(Number.isFinite(inwardAngle({ u: 0.5, v: 0.5 }, 80, 80, 0))).toBe(
      true
    );
  });
});

describe("bendDirection", () => {
  test("standing still: straight inward", () => {
    expect(bendDirection(1, { x: 0, y: 0 })).toBe(1);
  });

  test("bends towards the pull, more when faster, at most about 27°", () => {
    const slow = bendDirection(0, { x: 0, y: SPEED_FULL / 4 });
    const fast = bendDirection(0, { x: 0, y: SPEED_FULL });
    const faster = bendDirection(0, { x: 0, y: SPEED_FULL * 5 });
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(faster).toBeCloseTo(fast);
    expect(fast).toBeLessThan(Math.PI / 6);
  });

  test("a pull straight against it never flips the curl", () => {
    expect(bendDirection(0, { x: -SPEED_FULL * 3, y: 0 })).toBeCloseTo(0);
  });
});

describe("shapePull", () => {
  test("nothing to aim at until the pull leaves the dead zone", () => {
    const { aim, distance } = shapePull({ x: 2, y: 1 }, NO_AIM);
    expect(aim.dir).toBeNull();
    expect(distance).toBe(0);
  });

  test("the curl follows the pull's own direction and length", () => {
    const { aim, distance } = shapePull({ x: 30, y: 40 }, NO_AIM);
    expect(distance).toBeCloseTo(50);
    expect(aim.dir?.x).toBeCloseTo(0.6);
    expect(aim.dir?.y).toBeCloseTo(0.8);
    // The first direction is the one the cone is measured from.
    expect(aim.base).toEqual(aim.dir);
  });

  test("turning a little past a right angle is fine", () => {
    const first = shapePull({ x: 50, y: 0 }, NO_AIM).aim;
    const turned = shapePull({ x: 0, y: 50 }, first);
    expect(turned.distance).toBeCloseTo(50);
    expect(turned.aim.dir?.y).toBeCloseTo(1);
    expect(turned.aim.base?.x).toBeCloseTo(1);
  });

  test("pulled back the other way: the last direction stays, only its part counts", () => {
    let aim = shapePull({ x: 60, y: 0 }, NO_AIM).aim;
    aim = shapePull({ x: 10, y: 60 }, aim).aim;
    const back = shapePull({ x: -40, y: 20 }, aim);
    // dot((-40, 20)/|…|, (1, 0)) is well below the cone.
    expect(-40 / Math.hypot(40, 20)).toBeLessThan(PULL_CONE);
    expect(back.aim.dir).toEqual(aim.dir);
    const dir = aim.dir ?? { x: 0, y: 0 };
    expect(back.distance).toBeCloseTo(Math.max(0, -40 * dir.x + 20 * dir.y));
    expect(back.distance).toBeLessThan(Math.hypot(40, 20));
  });

  test("back near the press it starts over and can go any way", () => {
    const right = shapePull({ x: 80, y: 0 }, NO_AIM).aim;
    const home = shapePull({ x: 1, y: 1 }, right);
    expect(home.aim.base).toBeNull();
    expect(home.distance).toBeLessThanOrEqual(PULL_DEAD_ZONE);
    const left = shapePull({ x: -80, y: 0 }, home.aim);
    expect(left.distance).toBeCloseTo(80);
    expect(left.aim.dir?.x).toBeCloseTo(-1);
  });
});

describe("cssDetached", () => {
  test("off once pulled past a share of the longer side", () => {
    expect(cssDetached(CSS_DETACH * 200 - 1, 200, 120)).toBe(false);
    expect(cssDetached(CSS_DETACH * 200, 200, 120)).toBe(true);
    expect(cssDetached(CSS_DETACH * 200, 120, 200)).toBe(true);
    expect(cssDetached(0, 0, 0)).toBe(false);
  });
});

describe("dragProgress", () => {
  test("between the slow and fast curl, growing with speed", () => {
    expect(dragProgress(0)).toBeCloseTo(PEEL.dragMin);
    expect(dragProgress(SPEED_FULL)).toBeCloseTo(PEEL.dragMax);
    expect(dragProgress(SPEED_FULL * 10)).toBeCloseTo(PEEL.dragMax);
    let previous = 0;
    for (let speed = 0; speed <= SPEED_FULL; speed += 0.1) {
      const progress = dragProgress(speed);
      expect(progress).toBeGreaterThanOrEqual(previous);
      previous = progress;
    }
  });

  test("the trash peels it further than any drag", () => {
    expect(PEEL.trash).toBeGreaterThan(PEEL.dragMax);
  });
});

describe("approach", () => {
  test("one time constant covers about 63% of the way", () => {
    expect(approach(0, 1, 100, 100)).toBeCloseTo(1 - Math.exp(-1));
  });

  test("the same whatever the frame rate", () => {
    let at60 = 0;
    for (let i = 0; i < 6; i += 1) {
      at60 = approach(at60, 1, 1000 / 60, 90);
    }
    const at30 = approach(
      approach(approach(0, 1, 1000 / 30, 90), 1, 1000 / 30, 90),
      1,
      1000 / 30,
      90
    );
    expect(at60).toBeCloseTo(at30);
  });

  test("no time, no change", () => {
    expect(approach(0.3, 1, 0, 90)).toBe(0.3);
  });

  test("velocity smoothing works per axis", () => {
    const v = smoothVelocity({ x: 0, y: 1 }, { x: 1, y: 1 }, 60, 60);
    expect(v.x).toBeCloseTo(1 - Math.exp(-1));
    expect(v.y).toBeCloseTo(1);
  });

  test("angles go the short way round", () => {
    const next = approachAngle(Math.PI - 0.1, -Math.PI + 0.1, 1000, 1);
    expect(Math.abs(turn(next, Math.PI))).toBeLessThan(0.11);
    expect(Math.abs(turn(next, -Math.PI + 0.1))).toBeCloseTo(0);
  });
});

describe("easing", () => {
  test("every curve starts at 0 and ends at 1", () => {
    for (const ease of [easeOutCubic, easeInCubic, easeInOutCubic, softEase]) {
      expect(ease(0)).toBeCloseTo(0);
      expect(ease(1)).toBeCloseTo(1);
      expect(ease(-1)).toBeCloseTo(0);
      expect(ease(2)).toBeCloseTo(1);
    }
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });

  test("softEase starts from rest and never overshoots", () => {
    // Zero speed at the start: the first 1% moves a tiny bit.
    expect(softEase(0.01)).toBeLessThan(0.005);
    let previous = 0;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const value = softEase(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });
});

describe("peel timelines", () => {
  test("popping off: from fully peeled to the carried curl, lifted, no snap", () => {
    const from = { progress: 0.97, lift: 0, size: 1 };
    expect(popPose(0, from)).toEqual({ progress: 0.97, lift: 0, size: 1 });
    const end = popPose(1, from);
    expect(end.progress).toBeCloseTo(PEEL.carry);
    expect(end.lift).toBeCloseTo(1);
    let previous = popPose(0, from);
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const pose = popPose(t, from);
      // Straight down to the carried curl (never below it) as the shadow
      // rises over the same time.
      expect(pose.progress).toBeLessThanOrEqual(previous.progress);
      expect(pose.progress).toBeGreaterThanOrEqual(PEEL.carry - 1e-9);
      expect(pose.lift).toBeGreaterThanOrEqual(previous.lift);
      previous = pose;
    }
    // It leaves the fully peeled curl gently: after one 60 fps frame the
    // curl has barely moved.
    const firstFrame = popPose(1000 / 60 / PEEL_MS.pop, from);
    expect(from.progress - firstFrame.progress).toBeLessThan(0.02);
  });

  test("popping off takes about a third of a second; the slack is gone sooner", () => {
    expect(PEEL_MS.pop).toBeGreaterThanOrEqual(300);
    expect(PEEL_MS.pop).toBeLessThanOrEqual(360);
    expect(PEEL_MS.settle).toBeLessThan(PEEL_MS.layBack);
  });

  test("the slack is taken up softly and is gone at the end", () => {
    const slack = { x: 30, y: -12 };
    expect(settleSlack(slack, 0)).toEqual(slack);
    const end = settleSlack(slack, 1);
    expect(end.x).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(0);
    let previous = slack.x;
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const left = settleSlack(slack, t);
      expect(left.x).toBeLessThanOrEqual(previous);
      expect(left.x).toBeGreaterThanOrEqual(-1e-9);
      // Always the same way back: the two axes shrink together.
      expect(left.y / slack.y).toBeCloseTo(left.x / slack.x);
      previous = left.x;
    }
  });

  test("once off, the curl turns round slowly", () => {
    expect(PEEL_TAU.carryDirection).toBeGreaterThanOrEqual(250);
    expect(PEEL_TAU.carryDirection).toBeLessThanOrEqual(300);
    expect(PEEL_TAU.carryDirection).toBeGreaterThan(PEEL_TAU.direction);
  });

  test("the carried curl is well below the one that takes it off", () => {
    expect(PEEL.detach).toBeGreaterThan(0.9);
    expect(PEEL.detach).toBeLessThanOrEqual(1);
    expect(PEEL.carry).toBeGreaterThanOrEqual(0.3);
    expect(PEEL.carry).toBeLessThanOrEqual(0.4);
  });

  test("贴回去: flat and down, a small press, back to its size", () => {
    const from = { progress: 0.4, lift: 1 };
    expect(layBackPose(0, from)).toEqual({ progress: 0.4, lift: 1, size: 1 });
    const end = layBackPose(1, from);
    expect(end.progress).toBeCloseTo(0);
    expect(end.lift).toBeCloseTo(0);
    expect(end.size).toBeCloseTo(1);
    let smallest = 1;
    for (let t = 0; t <= 1; t += 0.02) {
      const pose = layBackPose(t, from);
      smallest = Math.min(smallest, pose.size);
      expect(pose.progress).toBeGreaterThanOrEqual(0);
      expect(pose.progress).toBeLessThanOrEqual(from.progress);
    }
    expect(smallest).toBeLessThan(1);
    expect(smallest).toBeGreaterThan(0.95);
  });

  test("into the trash: peeled right off, small, at the bin", () => {
    const start = { x: 100, y: 100 };
    const bin = { x: 500, y: 600 };
    const first = throwPose(0, 0.7, start, bin);
    expect(first.progress).toBeCloseTo(0.7);
    expect(first.size).toBeCloseTo(1);
    expect(first.x).toBeCloseTo(start.x);
    expect(first.y).toBeCloseTo(start.y);
    const end = throwPose(1, 0.7, start, bin);
    expect(end.progress).toBeCloseTo(1);
    expect(end.size).toBeCloseTo(THROW_SIZE);
    expect(end.x).toBeCloseTo(bin.x);
    expect(end.y).toBeCloseTo(bin.y);
    // It hops up a little first.
    expect(throwPose(0.3, 0.7, start, bin).y).toBeLessThan(start.y + 20);
  });
});

import { rotateDegrees } from "@/scripts/interact/sticker-gesture";

describe("rotateDegrees", () => {
  test("reads every serialisation of a computed rotate", () => {
    expect(rotateDegrees("8deg")).toBe(8);
    expect(rotateDegrees("0 0 1 8deg")).toBe(8);
    expect(rotateDegrees("z -12.5deg")).toBe(-12.5);
    expect(rotateDegrees("0.5turn")).toBe(180);
    expect(rotateDegrees("none")).toBe(0);
    expect(rotateDegrees("")).toBe(0);
  });
});
