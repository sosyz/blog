// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
/**
 * 撕下来 → carried, frame by frame, with the same rules sticker-peel.ts
 * runs: the drawn sticker must not jump when it comes off, the held edge
 * stays with the pointer, and the curl turns round slowly.
 */
import { describe, expect, test } from "bun:test";
import {
  createCurlPoint,
  createGeometry,
  curlPoint,
  type PeelInput,
  peelGeometry,
  pinnedCentre,
  progressForPull,
  type ScreenPoint,
  toScreen,
} from "../src/scripts/interact/peel-math";
import {
  approach,
  approachAngle,
  bendDirection,
  dragProgress,
  type Grab,
  inwardAngle,
  NO_AIM,
  PEEL,
  PEEL_MS,
  PEEL_TAU,
  type PeelPose,
  type PullAim,
  popPose,
  settleSlack,
  shapePull,
  smoothVelocity,
  type Vec,
} from "../src/scripts/interact/sticker-gesture";

const FULL_RECT = new Float32Array(0);
const WIDTH = 200;
const HEIGHT = 120;
const FRAME = 1000 / 60;
const STUCK: Vec = { x: 600, y: 400 };

type Frame = {
  phase: "peeling" | "pop" | "held";
  pointer: Vec;
  centre: ScreenPoint;
  /** Where the held edge is drawn (curled, on screen). */
  held: ScreenPoint;
  direction: number;
  progress: number;
};

const geometry = createGeometry();
const point = createCurlPoint();

/** The rear edge on the centre line, curled and put on screen: what the pointer holds. */
const heldPoint = (input: PeelInput, centre: ScreenPoint): ScreenPoint => {
  peelGeometry(input, FULL_RECT, geometry);
  curlPoint(
    geometry.dirX * geometry.minAlong,
    geometry.dirY * geometry.minAlong,
    geometry,
    point
  );
  return toScreen(
    point,
    { cx: centre.x, cy: centre.y, rotation: input.rotation },
    { x: 0, y: 0 }
  );
};

/**
 * Presses at `grab` and moves the pointer along `path(ms)` (offset from the
 * press, screen px), one move per 60 fps frame, for `duration` ms.
 */
const simulate = (
  path: (ms: number) => Vec,
  { rotation, grab }: { rotation: number; grab: Grab },
  duration = 1600
) => {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const local = { x: (grab.u - 0.5) * WIDTH, y: (grab.v - 0.5) * HEIGHT };
  const press = {
    x: STUCK.x + local.x * cos - local.y * sin,
    y: STUCK.y + local.x * sin + local.y * cos,
  };
  const input = (progress: number, angle: number): PeelInput => ({
    width: WIDTH,
    height: HEIGHT,
    rotation,
    grabU: grab.u,
    grabV: grab.v,
    progress,
    direction: angle,
  });
  let aim: PullAim = NO_AIM;
  let pull = 0;
  let off = false;
  let popStart = 0;
  let phase: Frame["phase"] = "peeling";
  let pose: PeelPose = { progress: 0, lift: 0, size: 1 };
  let from = pose;
  let direction = inwardAngle(grab, WIDTH, HEIGHT, rotation);
  let velocity: Vec = { x: 0, y: 0 };
  let pointer = { ...press };
  let drawn: ScreenPoint | null = null;
  let drawnPointer = { ...press };
  let slackFrom: Vec = { x: 0, y: 0 };
  let slackStart = 0;
  let measureSlack = false;
  const frames: Frame[] = [];
  const pullProgress = () =>
    aim.dir
      ? progressForPull(
          pull,
          input(0, Math.atan2(aim.dir.y, aim.dir.x)),
          FULL_RECT
        )
      : 0;

  for (let now = FRAME; now <= duration; now += FRAME) {
    // The pointer moves (sticker-edit calls `move`).
    const offset = path(now);
    const next = { x: press.x + offset.x, y: press.y + offset.y };
    velocity = smoothVelocity(
      velocity,
      { x: (next.x - pointer.x) / FRAME, y: (next.y - pointer.y) / FRAME },
      FRAME,
      PEEL_TAU.velocity
    );
    pointer = next;
    if (!off) {
      const shaped = shapePull(
        { x: pointer.x - press.x, y: pointer.y - press.y },
        aim
      );
      aim = shaped.aim;
      pull = shaped.distance;
      if (pullProgress() >= PEEL.detach) {
        off = true;
        measureSlack = true;
        phase = "pop";
        popStart = now;
        from = { ...pose };
      }
    }
    // The element: stuck, or moved with the whole pull once off.
    const element = off
      ? { x: STUCK.x + pointer.x - press.x, y: STUCK.y + pointer.y - press.y }
      : STUCK;
    // The frame (sticker-peel.ts `tick`).
    if (phase === "peeling") {
      pose = {
        progress: approach(pose.progress, pullProgress(), FRAME, PEEL_TAU.pull),
        lift: 0,
        size: 1,
      };
      if (aim.dir) {
        direction = approachAngle(
          direction,
          Math.atan2(aim.dir.y, aim.dir.x),
          FRAME,
          PEEL_TAU.direction
        );
      }
    } else if (phase === "pop") {
      const t = (now - popStart) / PEEL_MS.pop;
      pose = popPose(t, from);
      if (t >= 1) {
        phase = "held";
      }
    } else {
      pose = {
        progress: approach(
          pose.progress,
          dragProgress(Math.hypot(velocity.x, velocity.y)),
          FRAME,
          PEEL_TAU.progress
        ),
        lift: 1,
        size: 1,
      };
      direction = approachAngle(
        direction,
        bendDirection(inwardAngle(grab, WIDTH, HEIGHT, rotation), velocity),
        FRAME,
        PEEL_TAU.carryDirection
      );
    }
    let centre: ScreenPoint = element;
    if (off) {
      const pinned = pinnedCentre(
        element,
        pose.progress,
        input(0, direction),
        FULL_RECT
      );
      if (measureSlack) {
        measureSlack = false;
        slackFrom = drawn
          ? {
              x: drawn.x + pointer.x - drawnPointer.x - pinned.x,
              y: drawn.y + pointer.y - drawnPointer.y - pinned.y,
            }
          : { x: 0, y: 0 };
        slackStart = now;
      }
      const slack = settleSlack(slackFrom, (now - slackStart) / PEEL_MS.settle);
      centre = { x: pinned.x + slack.x, y: pinned.y + slack.y };
    }
    drawn = centre;
    drawnPointer = pointer;
    frames.push({
      phase,
      pointer,
      centre,
      held: heldPoint(input(pose.progress, direction), centre),
      direction,
      progress: pose.progress,
    });
  }
  return frames;
};

/** Pull along `angle` at `speed` px/ms, then stand still after `stopAt` ms. */
const straight =
  (angle: number, speed = 1, stopAt = 1200) =>
  (ms: number): Vec => {
    const length = speed * Math.min(ms, stopAt);
    return { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
  };

/** A pull that bends round as it goes (the curl's direction lags behind it). */
const curved =
  (angle: number, bend: number, speed = 1) =>
  (ms: number): Vec => {
    const steps = Math.round(ms / 4);
    let x = 0;
    let y = 0;
    for (let i = 0; i < steps; i += 1) {
      const heading = angle + (bend * i * 4) / 1000;
      x += Math.cos(heading) * speed * 4;
      y += Math.sin(heading) * speed * 4;
    }
    return { x, y };
  };

const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const turn = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

const CASES = [
  {
    name: "a straight pull across it",
    path: straight(Math.PI),
    grab: { u: 0.92, v: 0.6 },
    rotation: 0,
  },
  {
    name: "a turned sticker pulled diagonally",
    path: straight(-Math.PI * 0.8, 1.4),
    grab: { u: 0.85, v: 0.9 },
    rotation: 0.35,
  },
  {
    name: "a pull that bends round (the curl lags behind it)",
    path: curved(Math.PI * 0.9, 1.2),
    grab: { u: 0.9, v: 0.3 },
    rotation: -0.2,
  },
  {
    name: "pulled outwards: the curl has far to turn once off",
    path: straight(0, 1),
    grab: { u: 0.95, v: 0.5 },
    rotation: 0,
  },
] as const;

describe("撕下来 → carried", () => {
  for (const { name, path, grab, rotation } of CASES) {
    describe(name, () => {
      const frames = simulate(path, { rotation, grab });
      const detachAt = frames.findIndex((frame) => frame.phase !== "peeling");

      test("comes off during the pull", () => {
        expect(detachAt).toBeGreaterThan(0);
        expect(frames.at(-1)?.phase).toBe("held");
      });

      test("the drawing only moves with the pointer on the frame it comes off", () => {
        const before = frames[detachAt - 1];
        const at = frames[detachAt];
        if (!(before && at)) {
          throw new Error("no detach frame");
        }
        expect(distance(at.centre, before.centre)).toBeCloseTo(
          distance(at.pointer, before.pointer),
          6
        );
      });

      test("the held edge stays with the pointer: no jumps", () => {
        let worst = 0;
        // From just before it comes off (the start of the pull, where the
        // curl picks its direction, is the peel's own business).
        for (let i = detachAt - 3; i < frames.length; i += 1) {
          const a = frames[i - 1];
          const b = frames[i];
          if (!(a && b) || b.phase === "held") {
            continue;
          }
          const gap = (frame: Frame) => ({
            x: frame.held.x - frame.pointer.x,
            y: frame.held.y - frame.pointer.y,
          });
          worst = Math.max(worst, distance(gap(a), gap(b)));
        }
        // The old pop moved it by ~ the sticker's size within a few frames.
        expect(worst).toBeLessThan(10);
      });

      test("once the slack is gone, the held edge is under the pointer's hold", () => {
        const settled = frames.find(
          (frame, i) =>
            i > detachAt &&
            frame.phase === "pop" &&
            (i - detachAt) * FRAME > PEEL_MS.settle
        );
        const first = frames[0];
        if (!(settled && first)) {
          throw new Error("no settled frame");
        }
        // Pinned: the held edge is where the pull put it relative to the pointer.
        const expected = heldPoint(
          {
            width: WIDTH,
            height: HEIGHT,
            rotation,
            grabU: grab.u,
            grabV: grab.v,
            progress: 0,
            direction: settled.direction,
          },
          {
            x: STUCK.x + settled.pointer.x - (first.pointer.x - path(FRAME).x),
            y: STUCK.y + settled.pointer.y - (first.pointer.y - path(FRAME).y),
          }
        );
        expect(distance(settled.held, expected)).toBeLessThan(1);
      });

      test("the curl keeps its direction while it comes off, then turns slowly", () => {
        const limit =
          Math.PI * (1 - Math.exp(-FRAME / PEEL_TAU.carryDirection));
        for (let i = detachAt + 1; i < frames.length; i += 1) {
          const a = frames[i - 1];
          const b = frames[i];
          if (!(a && b)) {
            continue;
          }
          const step = turn(a.direction, b.direction);
          if (b.phase === "pop") {
            expect(step).toBeLessThan(1e-9);
          } else {
            expect(step).toBeLessThanOrEqual(limit + 1e-9);
          }
        }
      });

      test("the pop ends at the carried curl", () => {
        const lastPop = frames.findLast((frame) => frame.phase === "pop");
        const firstHeld = frames.find((frame) => frame.phase === "held");
        expect(lastPop?.progress ?? 0).toBeCloseTo(PEEL.carry, 1);
        expect(firstHeld?.progress ?? 0).toBeCloseTo(PEEL.carry, 1);
        for (const frame of frames.slice(detachAt)) {
          expect(frame.progress).toBeLessThanOrEqual(PEEL.detach + 0.01);
          expect(frame.progress).toBeGreaterThanOrEqual(PEEL.dragMin - 0.06);
        }
      });
    });
  }
});
