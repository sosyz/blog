/**
 * Canvas camera: screen = world * s + (x, y). Pans, zooms around a point,
 * glides with an ease-out curve and coasts after a flick (inertia).
 * Background dots and paper texture move and scale with the world.
 *
 * Kept cheap for old machines: the world and the desk are their own
 * compositor layers (canvas.css), so a pan only moves them. The desk is one
 * tile larger than the viewport and shifts by the camera offset modulo a
 * tile; its texture is resized only when the scale changes. Nothing here
 * sets a custom property on an element with children, which would restyle
 * the whole world every frame.
 */
import { type Camera, prefersReducedMotion } from "./api";

export interface Cam {
  s: number;
  x: number;
  y: number;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 1.8;
const DOT_PITCH = 20;
/** Desk texture tile (CSS px at scale 1); a multiple of DOT_PITCH both ways. */
const TILE_W = 480;
const TILE_H = 280;
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

/** Offset in [-tile, 0) that lines the desk's tiles up with the world's. */
const tileOffset = (offset: number, tile: number) =>
  (((offset % tile) + tile) % tile) - tile;

export const createCamera = (
  desk: HTMLElement,
  world: HTMLElement,
  percentEl: HTMLElement | null
) => {
  const cam: Cam = { s: 1, x: 0, y: 0 };
  const listeners = new Set<(camera: Camera) => void>();
  let raf = 0;
  let deskScale = 0;

  const scaleDesk = () => {
    deskScale = cam.s;
    desk.style.setProperty("--dot", `${DOT_PITCH * cam.s}px`);
    desk.style.setProperty("--tile-w", `${TILE_W * cam.s}px`);
    desk.style.setProperty("--tile-h", `${TILE_H * cam.s}px`);
    if (percentEl) {
      percentEl.textContent = `${Math.round(cam.s * PERCENT)}%`;
    }
  };

  const apply = () => {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`;
    if (cam.s !== deskScale) {
      scaleDesk();
    }
    const dx = tileOffset(cam.x, TILE_W * cam.s);
    const dy = tileOffset(cam.y, TILE_H * cam.s);
    desk.style.transform = `translate(${dx}px, ${dy}px)`;
    const snapshot = { scale: cam.s, x: cam.x, y: cam.y };
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
    const to = { s, x: px - wx * s, y: py - wy * s };
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
    apply,
    coast,
    get: (): Cam => ({ ...cam }),
    glide,
    onChange,
    panBy,
    set,
    stop,
    zoomAt,
  };
};
