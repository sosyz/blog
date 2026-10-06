/**
 * Keyboard focus on the desk must stay in sight (WCAG 2.4.11). Pure geometry
 * for canvas.ts, which pans the camera when Tab reaches something that is
 * off-screen or under the drawer.
 */
import type { Cam } from "./camera";

/** A screen rectangle, as from getBoundingClientRect(). */
export interface Box {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

/**
 * The part of the screen that shows the desk, from the top-left corner: the
 * whole viewport, or the strip left of an open drawer.
 */
export interface Area {
  height: number;
  width: number;
}

/** True when any edge of `box` lies outside the visible desk. */
export const isOutside = (box: Box, area: Area) =>
  box.left < 0 ||
  box.top < 0 ||
  box.right > area.width ||
  box.bottom > area.height;

/** True when `box` is no bigger than the visible desk. */
export const fitsIn = (box: Box, area: Area) =>
  box.right - box.left <= area.width && box.bottom - box.top <= area.height;

/** The camera moved, at the same scale, so `box` sits in the middle of `area`. */
export const panToShow = (cam: Cam, box: Box, area: Area): Cam => ({
  s: cam.s,
  x: cam.x + area.width / 2 - (box.left + box.right) / 2,
  y: cam.y + area.height / 2 - (box.top + box.bottom) / 2,
});
