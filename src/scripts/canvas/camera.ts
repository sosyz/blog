/**
 * Canvas camera: screen = world * s + (x, y). Pans, zooms around a point,
 * glides with an ease-out curve and coasts after a flick (inertia).
 * Background dots and paper texture move and scale with the world.
 */
import { type Camera, prefersReducedMotion } from "./api";

export type Cam = { x: number; y: number; s: number };

const MIN_SCALE = 0.3;
const MAX_SCALE = 1.8;
const DOT_PITCH = 20;
const TEXTURE_SIZE = 480;
const GLIDE_MS = 520;
/** Velocity decay per 16ms frame while coasting. */
const FRICTION = 0.94;
const FRAME_MS = 16;
/** Stop coasting below this speed (px/ms). */
const MIN_SPEED = 0.02;
const PERCENT = 100;

export const clampScale = (s: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

const CUBIC = 3;
const easeOutCubic = (t: number) => 1 - (1 - t) ** CUBIC;

export type CameraController = ReturnType<typeof createCamera>;

export const createCamera = (
  viewport: HTMLElement,
  world: HTMLElement,
  percentEl: HTMLElement | null
) => {
  const cam: Cam = { x: 0, y: 0, s: 1 };
  const listeners = new Set<(camera: Camera) => void>();
  let raf = 0;

  const apply = () => {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`;
    viewport.style.setProperty("--dot", `${DOT_PITCH * cam.s}px`);
    viewport.style.setProperty("--tex", `${TEXTURE_SIZE * cam.s}px`);
    viewport.style.setProperty("--bx", `${cam.x}px`);
    viewport.style.setProperty("--by", `${cam.y}px`);
    if (percentEl) {
      percentEl.textContent = `${Math.round(cam.s * PERCENT)}%`;
    }
    const snapshot = { x: cam.x, y: cam.y, scale: cam.s };
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const stop = () => {
    cancelAnimationFrame(raf);
  };

  const set = (to: Cam) => {
    stop();
    cam.x = to.x;
    cam.y = to.y;
    cam.s = to.s;
    apply();
  };

  const glide = (to: Cam, duration = GLIDE_MS) => {
    stop();
    if (prefersReducedMotion() || duration <= 1) {
      set(to);
      return;
    }
    const from = { ...cam };
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const e = easeOutCubic(p);
      cam.x = from.x + (to.x - from.x) * e;
      cam.y = from.y + (to.y - from.y) * e;
      cam.s = from.s + (to.s - from.s) * e;
      apply();
      if (p < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
  };

  /** Scale by `factor` keeping the world point under (px, py) in place. */
  const zoomAt = (px: number, py: number, factor: number, animate = false) => {
    const s = clampScale(cam.s * factor);
    const wx = (px - cam.x) / cam.s;
    const wy = (py - cam.y) / cam.s;
    const to = { x: px - wx * s, y: py - wy * s, s };
    if (animate) {
      glide(to, GLIDE_MS / 2);
    } else {
      set(to);
    }
  };

  const panBy = (dx: number, dy: number) => {
    cam.x += dx;
    cam.y += dy;
    apply();
  };

  /** Keep sliding after a flick; `vx`, `vy` in px/ms. */
  const coast = (startVx: number, startVy: number) => {
    stop();
    if (prefersReducedMotion()) {
      return;
    }
    let vx = startVx;
    let vy = startVy;
    let last = performance.now();
    const step = (now: number) => {
      const ms = now - last;
      last = now;
      cam.x += vx * ms;
      cam.y += vy * ms;
      const decay = FRICTION ** (ms / FRAME_MS);
      vx *= decay;
      vy *= decay;
      apply();
      if (Math.hypot(vx, vy) > MIN_SPEED) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
  };

  const onChange = (listener: (camera: Camera) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    get: (): Cam => ({ ...cam }),
    set,
    glide,
    zoomAt,
    panBy,
    coast,
    stop,
    apply,
    onChange,
  };
};
