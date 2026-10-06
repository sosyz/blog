/**
 * Pure rules for picking stickers up (撕下来), sticking them back (贴回去)
 * and throwing them away (垃圾桶). Used by sticker-edit.ts,
 * sticker-peel.ts and sticker-trash.ts; no DOM access, so bun test can
 * import it.
 */

/** How long 已扔掉 · 撤销 stays before the sticker is really deleted. */
export const UNDO_MS = 5000;

/**
 * The axis to curl a sticker around so the corner nearest the pointer lifts
 * towards the viewer: for `rotate3d(ax, ay, 0, angle)` with a positive angle.
 * `dx`, `dy`: pointer minus sticker centre in the sticker's own frame
 * (screen directions, y down).
 */
export const peelAxis = (dx: number, dy: number) => {
  const cornerX = dx < 0 ? -1 : 1;
  const cornerY = dy < 0 ? -1 : 1;
  // rotate3d lifts point p by angle × (a × p).z = ax·py − ay·px; with
  // a = (cornerY, −cornerX) that is cornerX² + cornerY² > 0 at the corner.
  return { ax: cornerY, ay: -cornerX };
};

const HALF_TURN = 180;

/** Undoes a rotation (degrees) of a screen offset into the sticker's frame. */
export const unrotate = (dx: number, dy: number, degrees: number) => {
  const radians = (-degrees * Math.PI) / HALF_TURN;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
};

export interface Box {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

/** Pointer over the trash can, with a little slack around it. */
export const isOver = (
  box: Box | null,
  point: { x: number; y: number },
  slack = 12
) =>
  box !== null &&
  point.x >= box.left - slack &&
  point.x <= box.right + slack &&
  point.y >= box.top - slack &&
  point.y <= box.bottom + slack;

export interface ThrowRights {
  /** The logged-in GitHub account uploaded it. */
  accountOwned: boolean;
  /** This browser has the sticker's edit token. */
  hasToken: boolean;
  /** Cloudflare Access session (owner.ts canModerate). */
  moderating: boolean;
  /** Logged in with GitHub as the blog owner. */
  sessionOwner: boolean;
}

/**
 * Who may throw a visitor sticker away, and how: the owner with Access
 * rejects it (POST /api/admin/decide), the uploader or the owner's GitHub
 * session deletes it (DELETE /api/stickers/:id); anyone else never sees the
 * trash. The admin route wins when both apply.
 */
export const throwRoute = (rights: ThrowRights): "admin" | "own" | null => {
  if (rights.moderating) {
    return "admin";
  }
  if (rights.hasToken || rights.accountOwned || rights.sessionOwner) {
    return "own";
  }
  return null;
};

/**
 * The crumple into the bin as keyframe stops: the share of the way to the
 * bin, how high it hops first (px), how squashed it is and how far it turns.
 * With reduced motion the sticker only fades.
 */
export const CRUMPLE_STOPS = [
  { hop: 0, offset: 0, opacity: 1, scale: "1", turn: 0, way: 0 },
  { hop: 12, offset: 0.35, opacity: 1, scale: "0.7 0.55", turn: 25, way: 0.2 },
  { hop: 0, offset: 1, opacity: 0, scale: "0.12 0.1", turn: 80, way: 1 },
] as const;

/** Aim a third of the way down the can, into its mouth. */
export const BIN_MOUTH = 0.33;

/* ---------- the WebGL curl (sticker-peel.ts drives peel-gl.ts) ---------- */

export interface Vec {
  x: number;
  y: number;
}

/** Where a press landed, in the sticker's own unit square: (0, 0) top left. */
export interface Grab {
  u: number;
  v: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const HALF = 0.5;

/**
 * The grabbed point in the sticker's unit square, before its rotation and
 * scale. `offset`: pointer minus the sticker's centre (screen px); `width`,
 * `height`: its unrotated size on screen; `degrees`: its rotation.
 */
export const grabPoint = (
  offset: Vec,
  width: number,
  height: number,
  degrees: number
): Grab => {
  const local = unrotate(offset.x, offset.y, degrees);
  return {
    u: clamp01(HALF + local.dx / (width || 1)),
    v: clamp01(HALF + local.dy / (height || 1)),
  };
};

/**
 * The curl's direction on screen (radians, y down): from the grab point
 * towards the sticker's centre, turned with the sticker (`radians`, CSS
 * sense: clockwise). A press right in the middle curls from the lower right.
 */
export const inwardAngle = (
  grab: Grab,
  width: number,
  height: number,
  radians: number
) => {
  let x = (HALF - grab.u) * width;
  let y = (HALF - grab.v) * height;
  if (Math.hypot(x, y) < Number.EPSILON) {
    x = -1;
    y = -1;
  }
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return Math.atan2(x * sin + y * cos, x * cos - y * sin);
};

/* ---------- 撕下来: the pull before the sticker is off ---------- */

/**
 * Pulls this short (screen px) keep the direction they had: the pointer's
 * first few px are too noisy to aim the curl.
 */
export const PULL_DEAD_ZONE = 4;
/**
 * The pull may turn away from the way it started until its direction's dot
 * product with that first direction drops below this (a little past a right
 * angle, as sticker-forge's OUTWARD_DIRECTION_LIMIT); beyond it the curl
 * keeps its last direction and only the part of the pull along it counts.
 */
export const PULL_CONE = -0.22;
/**
 * Without the WebGL curl (no WebGL, reduced motion) a sticker is off once it
 * is pulled this far, as a share of its longer side on screen.
 */
export const CSS_DETACH = 0.6;

/** Where a pull is aimed: the first direction and the current one (unit). */
export interface PullAim {
  base: Vec | null;
  dir: Vec | null;
}

export const NO_AIM: PullAim = { base: null, dir: null };

/**
 * Shapes a pull (pointer minus where it was pressed, screen px) into the
 * curl's direction and how far the peeled edge should have travelled. The
 * direction is the pull's own, within PULL_CONE of the way it started; a
 * pull back inside the dead zone starts over, so the curl can then go any
 * way again. `aim.dir` is null until the pull has a direction.
 */
export const shapePull = (
  pull: Vec,
  previous: PullAim
): { aim: PullAim; distance: number } => {
  const length = Math.hypot(pull.x, pull.y);
  const along = (way: Vec | null) =>
    way ? Math.max(0, pull.x * way.x + pull.y * way.y) : 0;
  if (length <= PULL_DEAD_ZONE) {
    return {
      aim: { base: null, dir: previous.dir },
      distance: along(previous.dir),
    };
  }
  const unit = { x: pull.x / length, y: pull.y / length };
  const base = previous.base ?? unit;
  if (unit.x * base.x + unit.y * base.y >= PULL_CONE) {
    return { aim: { base, dir: unit }, distance: length };
  }
  const dir = previous.dir ?? base;
  return { aim: { base, dir }, distance: along(dir) };
};

/** Without the WebGL curl: pulled far enough (screen px) to be off? */
export const cssDetached = (distance: number, width: number, height: number) =>
  distance >= CSS_DETACH * Math.max(width, height, 1);

/**
 * Time constants (ms) that smooth the curl frame by frame (`approach`).
 */
export const PEEL_TAU = {
  /**
   * The curl's direction once it is off: from the way it was pulled round
   * to the grabbed corner (`inwardAngle`), slowly, so the sheet swings
   * instead of turning at once.
   */
  carryDirection: 280,
  /** The curl's direction while it is peeled. */
  direction: 80,
  /** The carried curl (faster, more; over the trash). */
  progress: 90,
  /** While it is peeled the curl stays close to the pull (a little smoothing for sparse events). */
  pull: 35,
  /** The pointer's speed. */
  velocity: 60,
} as const;

/** Pointer speed (screen px per ms) at which the drag curl is fullest. */
export const SPEED_FULL = 1.6;
/** How far the pull's direction bends the curl (a weight below 1 never flips it). */
const BEND_WEIGHT = 0.5;

/**
 * Bends the curl a little towards where the sticker is being pulled, more
 * the faster it goes. `velocity` in screen px per ms.
 */
export const bendDirection = (inward: number, velocity: Vec) => {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed < Number.EPSILON) {
    return inward;
  }
  const weight = (BEND_WEIGHT * clamp01(speed / SPEED_FULL)) / speed;
  return Math.atan2(
    Math.sin(inward) + velocity.y * weight,
    Math.cos(inward) + velocity.x * weight
  );
};

/** How far the sticker is peeled at each step (renderer: 0 flat … 1 off). */
export const PEEL = {
  /** Just popped off: the curl it settles to while carried. */
  carry: 0.35,
  /**
   * While it is being peeled (still stuck at its place), the pull's curl
   * reaching this counts as off: it pops into the hand and can move.
   */
  detach: 0.96,
  dragMax: 0.45,
  /** While carried slowly … fast. */
  dragMin: 0.3,
  /** Hovering over the trash. */
  trash: 0.7,
} as const;

const smoothstep = (t: number) => t * t * (1 + 2 * (1 - t));

/** The drag curl for a pointer speed (px per ms): faster, a bit more. */
export const dragProgress = (speed: number) =>
  PEEL.dragMin +
  (PEEL.dragMax - PEEL.dragMin) * smoothstep(clamp01(speed / SPEED_FULL));

/**
 * Frame-rate independent exponential approach: moves `current` towards
 * `target` as a first-order lag with time constant `tau` (ms).
 */
export const approach = (
  current: number,
  target: number,
  dt: number,
  tau: number
) => {
  if (dt <= 0 || tau <= 0) {
    return dt > 0 ? target : current;
  }
  return target + (current - target) * Math.exp(-dt / tau);
};

/** `approach` for velocities: smooths jittery pointer samples. */
export const smoothVelocity = (
  current: Vec,
  sample: Vec,
  dt: number,
  tau: number
): Vec => ({
  x: approach(current.x, sample.x, dt, tau),
  y: approach(current.y, sample.y, dt, tau),
});

const FULL_TURN = 2 * Math.PI;

/** `approach` for angles (radians), the short way round. */
export const approachAngle = (
  current: number,
  target: number,
  dt: number,
  tau: number
) => {
  const diff =
    ((((target - current + Math.PI) % FULL_TURN) + FULL_TURN) % FULL_TURN) -
    Math.PI;
  return approach(current, current + diff, dt, tau);
};

/* ---------- easing and the timelines ---------- */

const cube = (x: number) => x * x * x;

export const easeOutCubic = (t: number) => 1 - cube(1 - clamp01(t));
export const easeInCubic = (t: number) => cube(clamp01(t));
export const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < HALF ? cube(2 * x) / 2 : 1 - cube(2 - 2 * x) / 2;
};
/** How quickly `softEase` settles: the spring's ω × duration. */
const SOFT_STIFFNESS = 5.5;
const SOFT_END = 1 - (1 + SOFT_STIFFNESS) * Math.exp(-SOFT_STIFFNESS);
/**
 * A critically damped spring let go from rest, scaled to reach 1 at 1: it
 * starts without a jolt (zero speed), settles softly and never overshoots.
 */
export const softEase = (t: number) => {
  const k = SOFT_STIFFNESS * clamp01(t);
  return (1 - (1 + k) * Math.exp(-k)) / SOFT_END;
};

const mix = (from: number, to: number, t: number) => from + (to - from) * t;

/** How long each move of the curl takes (ms). */
export const PEEL_MS = {
  /** 贴回去: laid back down with a little press. */
  layBack: 220,
  /**
   * Fully peeled: it comes off the desk into the hand, the curl relaxing
   * to the carried one and the lift shadow rising.
   */
  pop: 340,
  /**
   * What is left between where the sticker is shown and where it should be
   * (a pull that left its cone, the curl's lag, the CSS fallback coming
   * off) is taken up over this long.
   */
  settle: 200,
  /** Into the trash. */
  throw: 300,
} as const;

/** The curl's state that the timelines move. */
export interface PeelPose {
  lift: number;
  progress: number;
  /** Size factor on top of the sticker's own (the press, the fall). */
  size: number;
}

/**
 * Popping off at `t` (0 … 1 of PEEL_MS.pop), from the fully peeled curl
 * `from`: the curl relaxes to the carried one and the whole sticker comes up
 * off the desk, both on a soft spring (no snap). The caller keeps the held
 * point under the pointer meanwhile (`pinnedCentre` in peel-math.ts), so the
 * sheet swings down from where it is held.
 */
export const popPose = (t: number, from: PeelPose): PeelPose => {
  const eased = softEase(t);
  return {
    lift: mix(from.lift, 1, eased),
    progress: mix(from.progress, PEEL.carry, eased),
    size: 1,
  };
};

/**
 * The part of `slack` (screen px) still left `t` (0 … 1 of PEEL_MS.settle)
 * after it was measured: taken up on the same soft spring, gone at 1.
 */
export const settleSlack = (slack: Vec, t: number): Vec => {
  const left = 1 - softEase(t);
  return { x: slack.x * left, y: slack.y * left };
};

/** The curl is flat this far into 贴回去; the rest is the press. */
const FLAT_AT = 0.7;
/** The press: the sticker is this much smaller at its deepest. */
const PRESS_DEPTH = 0.025;

/**
 * 贴回去 at `t` (0 … 1 of PEEL_MS.layBack): the curl flattens and the
 * sticker comes down, then is pressed onto the desk (slightly smaller for a
 * moment) and springs back to its size.
 */
export const layBackPose = (
  t: number,
  from: { progress: number; lift: number }
): PeelPose => {
  const flat = t / FLAT_AT;
  const press = clamp01((t - FLAT_AT) / (1 - FLAT_AT));
  return {
    lift: from.lift * (1 - easeInOutCubic(flat)),
    progress: from.progress * (1 - easeOutCubic(flat)),
    size: 1 - PRESS_DEPTH * Math.sin(Math.PI * press),
  };
};

/** The sticker is this small when it reaches the bottom of the bin. */
export const THROW_SIZE = 0.16;
/** It hops this high (screen px) before it drops in, as in CRUMPLE_STOPS. */
const THROW_HOP = 12;

/**
 * Into the trash at `t` (0 … 1 of PEEL_MS.throw): peels right off, shrinks
 * and falls from `start` into the bin's mouth `bin` (screen px).
 */
export const throwPose = (
  t: number,
  from: number,
  start: Vec,
  bin: Vec
): PeelPose & Vec => {
  const way = easeInCubic(t);
  return {
    lift: 1,
    progress: mix(from, 1, easeOutCubic(t)),
    size: mix(1, THROW_SIZE, way),
    x: mix(start.x, bin.x, way),
    y: mix(start.y, bin.y, way) - THROW_HOP * Math.sin(Math.PI * clamp01(t)),
  };
};

const HALF_TURN_DEG = 180;
/** Degrees per CSS angle unit. */
const ANGLE_UNITS: Record<string, number> = {
  deg: 1,
  grad: 0.9,
  rad: HALF_TURN_DEG / Math.PI,
  turn: 360,
};
const ANGLE_AT_END = /(-?\d*\.?\d+(?:e-?\d+)?)(deg|rad|grad|turn)\s*$/i;

/**
 * Computed `rotate` → degrees. Browsers may serialise it as "8deg",
 * "z 8deg" or "0 0 1 8deg" (Safari), or "none"; the angle is always last.
 */
export const rotateDegrees = (value: string) => {
  const match = ANGLE_AT_END.exec(value.trim());
  if (!match) {
    return 0;
  }
  const amount = Number.parseFloat(match[1] ?? "0");
  const unit = ANGLE_UNITS[(match[2] ?? "deg").toLowerCase()] ?? 1;
  return Number.isFinite(amount) ? amount * unit : 0;
};
