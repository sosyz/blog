/**
 * 撕下来 / 贴回去 with a real paper curl. Used by sticker-edit.ts for every
 * sticker that can be dragged. A sticker has to be peeled right off before it
 * moves:
 *
 * - hover / focus (sticker-edit.ts `warmPeel`) or the press: the WebGL layer
 *   (peel-gl.ts, its own chunk) starts loading; nothing changes on screen (a
 *   click stays a click);
 * - the press moves past the slop (`lift`): 撕 — the sticker stays stuck
 *   where it is and the layer draws it curling up along the pull (its
 *   direction shaped by `shapePull`); the curl is solved so the held edge
 *   travels with the pointer (`progressForPull`), and goes back down when the
 *   pointer comes back. The element itself is hidden (opacity 0: it keeps its
 *   layout, focus and pointer capture);
 * - the pull peels it all the way (PEEL.detach): from then on `move` returns
 *   true and the caller moves the element with the pointer. The drawing does
 *   not jump with it: it is drawn at `pinnedCentre`, so the held edge stays
 *   under the pointer, and whatever the pull left over (its smoothing, a
 *   pull that left its cone) is taken up softly (`settleSlack`). It comes off
 *   the desk (PEEL_MS.pop, `popPose`): the curl relaxes to the carried one
 *   on a soft spring and the lift shadow rises, so the sheet swings down
 *   from where it is held. The curl keeps the pull's direction through the
 *   pop, then turns slowly (PEEL_TAU.carryDirection) round to the grabbed
 *   corner, bent a little by the pointer's speed (`bendDirection`); it
 *   curls a bit more the faster it goes (`dragProgress`) and over the trash
 *   eases towards PEEL.trash;
 * - let go (`drop`): the curl flattens and it is pressed onto the desk
 *   (PEEL_MS.layBack) — where it was stuck if it never came off; once off,
 *   still pinned, so it unrolls onto the element where it is let go — then
 *   the element shows again;
 * - into the trash (`fall`, only once off): it peels right off and shrinks
 *   into the bin (PEEL_MS.throw); the caller then runs the usual throw.
 *
 * Without WebGL, with reduced motion, or when the layer is late (more than
 * LATE_MS after the peel started), the CSS fallback is used instead: a pull
 * longer than CSS_DETACH of the sticker's size takes it off; before that the
 * corner only tilts a little (`.is-tugged`), once off it is lifted
 * (`.is-lifted`) and glides from where it was stuck into the hand
 * (`--peel-lag-x` / `--peel-lag-y`, PEEL_MS.settle; at once with reduced
 * motion), and `.is-sticking` is the press when it is let go. Esc, a lost
 * window focus and leaving the page end the curl at once (the gesture itself
 * goes on with the fallback).
 */
import { type CanvasApi, prefersReducedMotion } from "@/scripts/canvas/api";
import type { PeelLayer } from "./peel-gl";
import { pinnedCentre, progressForPull } from "./peel-math";
import {
  approach,
  approachAngle,
  BIN_MOUTH,
  bendDirection,
  cssDetached,
  dragProgress,
  type Grab,
  grabPoint,
  inwardAngle,
  layBackPose,
  NO_AIM,
  PEEL,
  PEEL_MS,
  PEEL_TAU,
  type PeelPose,
  type PullAim,
  popPose,
  rotateDegrees,
  settleSlack,
  shapePull,
  smoothVelocity,
  throwPose,
  type Vec,
} from "./sticker-gesture";

/** Below the toolbar and zoom buttons (20) and the trash (21), as the world is. */
const LAYER_Z = 19;
/** Wait this long (ms) for the layer after the peel starts, then use CSS. */
const LATE_MS = 100;
/** Longest frame step (ms) the smoothing takes, e.g. after a busy frame. */
const MAX_STEP = 64;
/** Matches the vs-stick animation in StickerLayer.astro. */
const STICK_MS = 260;
const HIDDEN = "is-peeling";
const LIFTED = "is-lifted";
const TUGGED = "is-tugged";
/** The CSS fallback's glide into the hand (world px, in `translate`). */
const LAG_X = "--peel-lag-x";
const LAG_Y = "--peel-lag-y";
const STILL: Vec = { x: 0, y: 0 };
const HALF_TURN = 180;
const DEG = Math.PI / HALF_TURN;
const NO_HULL = new Float32Array(0);

/**
 * The WebGL layer is its own chunk (most visitors never drag a sticker),
 * fetched when a sticker is hovered or focused (`warmPeel`), when the desk
 * is idle with stickers on it, or at the latest on the first press. A first
 * peel that outruns the download uses the CSS fallback (LATE_MS).
 */
let peelGl: Promise<typeof import("./peel-gl")> | null = null;
const loadPeelGl = () => {
  peelGl ??= import("./peel-gl").catch((error: unknown) => {
    peelGl = null;
    throw error;
  });
  return peelGl;
};
const createPeelLayer: typeof import("./peel-gl")["createPeelLayer"] = (
  ...args
) => loadPeelGl().then((module) => module.createPeelLayer(...args));

const ignore = () => {
  // Warming up only: a failed download is tried again on the press.
};

/** Starts fetching the WebGL layer, so the first peel gets the real curl. */
export const warmPeel = () => {
  if (!prefersReducedMotion()) {
    loadPeelGl().catch(ignore);
  }
};

/**
 * pressed: not moved yet; peeling: stuck, curling with the pull; pop: just
 * came off; held: carried; layBack / throw: let go.
 */
type Phase =
  | "pressed"
  | "peeling"
  | "pop"
  | "held"
  | "layBack"
  | "throw"
  | "done";
/** How this gesture is shown: waiting for the layer, WebGL, or CSS. */
type Mode = "pending" | "gl" | "css";

export interface Peel {
  /** Let go on the desk (or a click): 贴回去. */
  drop: () => void;
  /** Ends at once, the element shown as it is (pointercancel, after a throw). */
  end: () => void;
  /**
   * Dropped on the trash: falls into the bin. Resolves true when the curl
   * did the fall (skip the crumple; call `end` after the throw), false when
   * the caller should animate it as before.
   */
  fall: (bin: DOMRect | null) => Promise<boolean>;
  /** Over the trash: peel further. */
  hoverTrash: (over: boolean) => void;
  /** The press moved past the slop: start peeling (it stays where it is). */
  lift: () => void;
  /**
   * Every pointer move after `lift`. Returns true once the sticker is off
   * (fully peeled): only then should the caller move it.
   */
  move: (event: PointerEvent) => boolean;
}

const live = new Set<() => void>();

/** Esc, a lost window focus and navigation: stop every curl now. */
const stopAll = () => {
  for (const stop of [...live]) {
    stop();
  }
};

const numberOf = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

interface Measure {
  centre: Vec;
  degrees: number;
  height: number;
  width: number;
}

/**
 * Where the (hidden) element is on screen: centre, unrotated size, rotation.
 * One rect read per frame; the computed style after it is already flushed.
 * The hover styles (scale, a straighter rotate) are included, so the curl
 * matches the element when it hides and shows.
 */
const measure = (el: HTMLElement, base: Vec, zoom: number): Measure => {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const scale = numberOf(style.scale, 1) * zoom;
  return {
    centre: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    degrees: rotateDegrees(style.rotate),
    height: base.y * scale,
    width: base.x * scale,
  };
};

const pressCss = (el: HTMLElement) => {
  el.classList.remove(LIFTED, TUGGED);
  if (prefersReducedMotion()) {
    return;
  }
  el.classList.add("is-sticking");
  window.setTimeout(() => el.classList.remove("is-sticking"), STICK_MS);
};

const isMoving = (phase: Phase) =>
  phase === "peeling" || phase === "pop" || phase === "held";

/** Starts following a press on a sticker; `api` gives the camera's zoom. */
export const startPeel = (
  api: CanvasApi,
  el: HTMLElement,
  event: PointerEvent
): Peel => {
  const image =
    el instanceof HTMLImageElement
      ? el
      : el.querySelector<HTMLImageElement>("img");
  const zoom = () => api.getCamera().scale || 1;
  const base = { x: el.offsetWidth, y: el.offsetHeight };
  const press: Vec = { x: event.clientX, y: event.clientY };
  /** Where it is stuck (screen), measured again every frame until it is off. */
  let anchor = measure(el, base, zoom());
  const grab: Grab = grabPoint(
    { x: press.x - anchor.centre.x, y: press.y - anchor.centre.y },
    anchor.width,
    anchor.height,
    anchor.degrees
  );

  let mode: Mode = image && !prefersReducedMotion() ? "pending" : "css";
  let phase: Phase = "pressed";
  /** Fully peeled: the caller moves it from now on. */
  let off = false;
  let layer: PeelLayer | null = null;
  let lateTimer = 0;
  let frame = 0;
  let last = 0;
  let phaseStart = 0;
  let overTrash = false;
  let pose: PeelPose = { lift: 0, progress: 0, size: 1 };
  let from: PeelPose = pose;
  let direction = inwardAngle(
    grab,
    anchor.width,
    anchor.height,
    anchor.degrees * DEG
  );
  let aim: PullAim = NO_AIM;
  let pull = 0;
  let velocity: Vec = { x: 0, y: 0 };
  let travel: Vec = { x: 0, y: 0 };
  let pointer: Vec = { ...press };
  /** The centre last drawn (null before the first drawing), and the pointer then. */
  let drawn: Vec | null = null;
  let drawnPointer: Vec = press;
  /** Just came off: measure the slack against the last drawing next frame. */
  let measureSlack = false;
  /** Shown minus where it should be (screen px) at `slackStart`; see settleSlack. */
  let slackFrom: Vec = STILL;
  let slackStart = 0;
  let lagFrame = 0;
  let lagShown = false;
  let fallFrom: Vec = anchor.centre;
  let fallTo: Vec = anchor.centre;
  let fallAt: Vec = anchor.centre;
  let hidden = false;
  let fallen: ((done: boolean) => void) | null = null;

  const hide = (on: boolean) => {
    if (hidden === on) {
      return;
    }
    hidden = on;
    el.classList.toggle(HIDDEN, on);
  };

  /* ---- the slack: how far the shown sticker still is from the hand ---- */

  const slackAt = (now: number) =>
    settleSlack(slackFrom, (now - slackStart) / PEEL_MS.settle);

  const setSlack = (value: Vec, now: number) => {
    slackFrom = value;
    slackStart = now;
  };

  /** The CSS fallback shows the slack by shifting the element (world px). */
  const writeLag = (value: Vec | null) => {
    if (value) {
      const scale = zoom();
      el.style.setProperty(LAG_X, `${value.x / scale}px`);
      el.style.setProperty(LAG_Y, `${value.y / scale}px`);
      lagShown = true;
    } else if (lagShown) {
      el.style.removeProperty(LAG_X);
      el.style.removeProperty(LAG_Y);
      lagShown = false;
    }
  };

  const lagTick = (now: number) => {
    lagFrame = 0;
    // WebGL took over: it draws the slack (and clears the shift as it hides).
    if (mode === "gl") {
      return;
    }
    if (now - slackStart >= PEEL_MS.settle) {
      writeLag(null);
      return;
    }
    writeLag(slackAt(now));
    lagFrame = window.requestAnimationFrame(lagTick);
  };

  /** CSS: the element starts `value` (screen px) away and glides into the hand. */
  const glide = (value: Vec) => {
    if (prefersReducedMotion() || (value.x === 0 && value.y === 0)) {
      return;
    }
    setSlack(value, performance.now());
    writeLag(value);
    if (!lagFrame) {
      lagFrame = window.requestAnimationFrame(lagTick);
    }
  };

  const stopGlide = () => {
    window.cancelAnimationFrame(lagFrame);
    lagFrame = 0;
    slackFrom = STILL;
    writeLag(null);
  };

  const dropLayer = () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
    layer?.destroy();
    layer = null;
  };

  /** Leaves WebGL for good; `show` puts the element back on screen. */
  const finish = (show: boolean) => {
    live.delete(stop);
    window.clearTimeout(lateTimer);
    dropLayer();
    // Thrown, or re-rendered: the element is gone, nothing to show.
    if (show) {
      hide(false);
    }
    phase = "done";
    fallen?.(true);
    fallen = null;
  };

  /**
   * Leaving the curl while it is carried: how far the element is from where
   * the curl has the sticker now (null: nothing drawn to carry on from).
   */
  const handOff = (): Vec | null => {
    if (!(off && drawn && (phase === "pop" || phase === "held"))) {
      return null;
    }
    const here = measure(el, base, zoom()).centre;
    return {
      x: drawn.x + pointer.x - drawnPointer.x - here.x,
      y: drawn.y + pointer.y - drawnPointer.y - here.y,
    };
  };

  /** From here on this gesture is shown with CSS. */
  const toCss = () => {
    const wasGl = mode === "gl";
    // Measured before the classes change the element's box.
    const carried = handOff();
    mode = "css";
    live.delete(stop);
    window.clearTimeout(lateTimer);
    dropLayer();
    hide(false);
    if (phase === "peeling") {
      el.classList.add(TUGGED);
    } else if (phase === "pop" || phase === "held") {
      phase = "held";
      el.classList.add(LIFTED);
      // Carried on from where the curl had it, not from the element's place.
      if (carried) {
        glide(carried);
      }
    } else if (wasGl && phase !== "pressed") {
      // Mid 贴回去 / fall: just show it where it is.
      phase = "done";
    }
    fallen?.(false);
    fallen = null;
  };

  const stop = () => {
    if (mode === "gl" || mode === "pending") {
      toCss();
    }
  };

  const enter = (next: Phase, now: number) => {
    phase = next;
    phaseStart = now;
    from = { ...pose };
  };

  /** The curl's shape for the sticker as measured (`size` from the pose). */
  const curlInput = (at: Measure, angle: number) => ({
    direction: angle,
    grabU: grab.u,
    grabV: grab.v,
    height: at.height * pose.size,
    rotation: at.degrees * DEG,
    width: at.width * pose.size,
  });

  /** The curl that keeps the held edge with the pointer, for `at`. */
  const pullProgress = (at: Measure) => {
    if (!aim.dir) {
      return 0;
    }
    return progressForPull(
      pull,
      curlInput(at, Math.atan2(aim.dir.y, aim.dir.x)),
      layer?.hull ?? NO_HULL
    );
  };

  /** Fully peeled? With WebGL by the curl, otherwise by the distance. */
  const peeledOff = () =>
    mode === "gl"
      ? pullProgress(anchor) >= PEEL.detach
      : cssDetached(pull, anchor.width, anchor.height);

  /** One frame of each phase: moves `pose` on; false once it is over. */
  const steps: Partial<
    Record<Phase, (now: number, dt: number, at: Measure) => boolean>
  > = {
    held: (_now, dt) => {
      const speed = Math.hypot(velocity.x, velocity.y);
      const target = overTrash ? PEEL.trash : dragProgress(speed);
      pose = {
        lift: 1,
        progress: approach(pose.progress, target, dt, PEEL_TAU.progress),
        size: 1,
      };
      return true;
    },
    layBack: (now) => {
      const t = (now - phaseStart) / PEEL_MS.layBack;
      pose = layBackPose(t, from);
      return t < 1;
    },
    peeling: (_now, dt, at) => {
      pose = {
        lift: 0,
        progress: approach(pose.progress, pullProgress(at), dt, PEEL_TAU.pull),
        size: 1,
      };
      return true;
    },
    pop: (now) => {
      const t = (now - phaseStart) / PEEL_MS.pop;
      pose = popPose(t, from);
      if (t >= 1) {
        phase = "held";
      }
      return true;
    },
    throw: (now) => {
      const t = (now - phaseStart) / PEEL_MS.throw;
      const fall = throwPose(t, from.progress, fallFrom, fallTo);
      pose = fall;
      fallAt = fall;
      return t < 1;
    },
  };

  /** The carried curl's direction: round to the grabbed corner, bent by the speed. */
  const carryAngle = (at: Measure) =>
    bendDirection(
      inwardAngle(grab, at.width, at.height, at.degrees * DEG),
      velocity
    );

  /**
   * Turns the curl for this frame. Stuck: along the pull. Coming off, let go
   * or falling: it keeps its direction. Carried: slowly round to the
   * grabbed corner, the short way.
   */
  const steer = (at: Measure, dt: number) => {
    if (phase === "held") {
      direction = approachAngle(
        direction,
        carryAngle(at),
        dt,
        PEEL_TAU.carryDirection
      );
    } else if (phase === "peeling" || phase === "pressed") {
      const target = aim.dir
        ? Math.atan2(aim.dir.y, aim.dir.x)
        : inwardAngle(grab, at.width, at.height, at.degrees * DEG);
      direction = approachAngle(direction, target, dt, PEEL_TAU.direction);
    }
  };

  /**
   * Where the curl is drawn. Stuck: where it is stuck. Off: pinned so the
   * held edge stays under the pointer, plus what is left of the slack.
   */
  const centreOf = (at: Measure, now: number): Vec => {
    if (phase === "throw") {
      return fallAt;
    }
    if (!off) {
      return at.centre;
    }
    const pinned = pinnedCentre(
      at.centre,
      pose.progress,
      curlInput(at, direction),
      layer?.hull ?? NO_HULL
    );
    if (measureSlack) {
      // The frame it comes off: where it was last drawn, moved on with the
      // pointer since (so the held edge keeps pace; the rest is slack).
      measureSlack = false;
      setSlack(
        drawn
          ? {
              x: drawn.x + pointer.x - drawnPointer.x - pinned.x,
              y: drawn.y + pointer.y - drawnPointer.y - pinned.y,
            }
          : STILL,
        now
      );
    }
    const slack = slackAt(now);
    return { x: pinned.x + slack.x, y: pinned.y + slack.y };
  };

  /** Smooths the pointer's speed from what it travelled since the last frame. */
  const trackSpeed = (dt: number) => {
    if (dt <= 0) {
      return;
    }
    velocity = smoothVelocity(
      velocity,
      { x: travel.x / dt, y: travel.y / dt },
      dt,
      PEEL_TAU.velocity
    );
    travel = { x: 0, y: 0 };
  };

  const draw = (target: PeelLayer, at: Measure, centre: Vec) => {
    target.draw({
      cx: centre.x,
      cy: centre.y,
      direction,
      grabU: grab.u,
      grabV: grab.v,
      height: at.height * pose.size,
      lift: pose.lift,
      progress: pose.progress,
      rotation: at.degrees * DEG,
      width: at.width * pose.size,
    });
    drawn = centre;
    drawnPointer = pointer;
  };

  const tick = (now: number) => {
    frame = 0;
    if (mode !== "gl" || !layer) {
      return;
    }
    if (!el.isConnected) {
      // The layer re-rendered under the drag: the new element shows itself.
      finish(false);
      return;
    }
    const dt = Math.min(MAX_STEP, Math.max(0, now - last));
    last = now;
    trackSpeed(dt);
    const at = measure(el, base, zoom());
    if (!off) {
      anchor = at;
    }
    const going = steps[phase]?.(now, dt, at) ?? false;
    steer(at, dt);
    draw(layer, at, centreOf(at, now));
    // Hidden in the same frame as the first drawing, so it never blinks; the
    // CSS glide's shift goes with it (the drawing carries the slack now).
    hide(true);
    writeLag(null);
    if (!going) {
      finish(phase !== "throw");
      return;
    }
    frame = window.requestAnimationFrame(tick);
  };

  const run = () => {
    if (!frame) {
      last = performance.now();
      frame = window.requestAnimationFrame(tick);
    }
  };

  /** Comes off the desk: from now on the caller carries it. */
  const detach = () => {
    off = true;
    if (mode === "gl") {
      measureSlack = true;
      enter("pop", performance.now());
      run();
      return;
    }
    phase = "held";
    // The caller is about to move the element by the whole pull: it starts
    // from where it was stuck instead and glides into the hand.
    glide({ x: press.x - pointer.x, y: press.y - pointer.y });
    if (mode === "css") {
      el.classList.remove(TUGGED);
      el.classList.add(LIFTED);
    }
  };

  /** The layer is ready and the peel has started: draw it with WebGL. */
  const startGl = () => {
    mode = "gl";
    window.clearTimeout(lateTimer);
    if (phase === "held") {
      // Came off before the layer was ready and is lying flat in the hand
      // (still gliding there, maybe): it curls up from there, the way it is
      // carried.
      direction = carryAngle(anchor);
      enter("pop", performance.now());
    }
    run();
  };

  if (mode === "pending" && image) {
    live.add(stop);
    createPeelLayer(image, { zIndex: LAYER_Z }).then(
      (made) => {
        if (mode !== "pending" || phase === "done") {
          made?.destroy();
          return;
        }
        if (!made) {
          toCss();
          return;
        }
        layer = made;
        if (isMoving(phase)) {
          startGl();
        }
      },
      () => toCss()
    );
  }

  return {
    drop: () => {
      if (mode === "gl" && isMoving(phase)) {
        enter("layBack", performance.now());
        run();
        return;
      }
      if (mode === "css" && isMoving(phase)) {
        if (off) {
          pressCss(el);
        } else {
          el.classList.remove(TUGGED);
        }
      }
      // The CSS glide (if any) goes on: it ends where it is let go.
      finish(true);
    },
    end: () => {
      el.classList.remove(LIFTED, TUGGED);
      stopGlide();
      finish(true);
    },
    fall: (bin) => {
      if (mode !== "gl" || !(phase === "pop" || phase === "held")) {
        // The crumple starts from the element's place.
        stopGlide();
        return Promise.resolve(false);
      }
      const now = performance.now();
      fallFrom = drawn ?? centreOf(measure(el, base, zoom()), now);
      fallTo = bin
        ? { x: bin.left + bin.width / 2, y: bin.top + bin.height * BIN_MOUTH }
        : fallFrom;
      enter("throw", now);
      run();
      return new Promise((resolve) => {
        fallen = resolve;
      });
    },
    hoverTrash: (over) => {
      overTrash = over;
    },
    lift: () => {
      if (phase !== "pressed") {
        return;
      }
      phase = "peeling";
      if (mode === "css") {
        el.classList.add(TUGGED);
        return;
      }
      if (layer) {
        startGl();
        return;
      }
      lateTimer = window.setTimeout(toCss, LATE_MS);
    },
    move: (e) => {
      travel = {
        x: travel.x + e.clientX - pointer.x,
        y: travel.y + e.clientY - pointer.y,
      };
      pointer = { x: e.clientX, y: e.clientY };
      if (phase !== "peeling") {
        return off;
      }
      const shaped = shapePull(
        { x: pointer.x - press.x, y: pointer.y - press.y },
        aim
      );
      ({ aim } = shaped);
      pull = shaped.distance;
      if (peeledOff()) {
        detach();
      }
      return off;
    },
  };
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    stopAll();
  }
});
window.addEventListener("blur", stopAll);
document.addEventListener("astro:before-swap", stopAll);
