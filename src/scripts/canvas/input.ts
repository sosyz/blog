/**
 * Pointer, wheel and pinch input on the canvas viewport.
 *
 * - Drag anywhere to pan; a flick keeps sliding (inertia).
 * - Plain wheel / trackpad scroll pans; ctrl/⌘ + wheel (and trackpad pinch,
 *   which browsers report as ctrl + wheel) zooms around the pointer.
 * - Two-finger touch pinch zooms around the midpoint.
 * - A click that did not move is left to the browser (cards are links the
 *   router handles); a click on empty desk calls `onEmptyClick`.
 */
import { type CameraController, clampScale } from "./camera";

/** Movement before a press becomes a drag (px). */
const DRAG_SLOP = 4;
/** Only the last stretch of a drag decides the flick speed (ms). */
const FLICK_WINDOW = 90;
const MAX_SAMPLES = 6;
const WHEEL_ZOOM = 0.01;

interface Sample {
  t: number;
  x: number;
  y: number;
}

interface Drag {
  cx: number;
  cy: number;
  id: number;
  moved: boolean;
  samples: Sample[];
  sx: number;
  sy: number;
}

interface Pinch {
  cam: { x: number; y: number; s: number };
  dist: number;
  mid: { x: number; y: number };
}

const INTERACTIVE = "a, button, input, textarea, select, label, [role=button]";

export interface InputOptions {
  camera: CameraController;
  isDragging?: (dragging: boolean) => void;
  onEmptyClick: () => void;
  onUserMove: () => void;
  viewport: HTMLElement;
}

const midpoint = (a: Sample, b: Sample) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export const bindInput = ({
  viewport,
  camera,
  onEmptyClick,
  onUserMove,
  isDragging,
}: InputOptions) => {
  const pointers = new Map<number, Sample>();
  let drag: Drag | null = null;
  let pinch: Pinch | null = null;
  /** Swallow the click that ends a drag, so a card under it doesn't open. */
  let swallowClick = false;

  const startPinch = () => {
    const [a, b] = [...pointers.values()];
    if (!(a && b)) {
      return;
    }
    camera.stop();
    pinch = {
      cam: camera.get(),
      dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      mid: midpoint(a, b),
    };
    if (drag) {
      drag.moved = true;
    }
  };

  const movePinch = () => {
    const [a, b] = [...pointers.values()];
    if (!(pinch && a && b)) {
      return;
    }
    const start = pinch;
    const s = clampScale(
      (start.cam.s * Math.hypot(b.x - a.x, b.y - a.y)) / start.dist
    );
    const mid = midpoint(a, b);
    const wx = (start.mid.x - start.cam.x) / start.cam.s;
    const wy = (start.mid.y - start.cam.y) / start.cam.s;
    camera.set({ s, x: mid.x - wx * s, y: mid.y - wy * s });
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    // A drag that ended without a click (touch) must not eat the next one.
    if (pointers.size === 0) {
      swallowClick = false;
    }
    pointers.set(e.pointerId, { t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      startPinch();
      return;
    }
    camera.stop();
    const cam = camera.get();
    drag = {
      cx: cam.x,
      cy: cam.y,
      id: e.pointerId,
      moved: false,
      samples: [],
      sx: e.clientX,
      sy: e.clientY,
    };
  };

  const onMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) {
      return;
    }
    pointers.set(e.pointerId, { t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (pinch) {
      movePinch();
      return;
    }
    if (!drag || e.pointerId !== drag.id) {
      return;
    }
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_SLOP) {
      drag.moved = true;
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add("grabbing");
      isDragging?.(true);
      onUserMove();
    }
    if (!drag.moved) {
      return;
    }
    camera.set({ s: camera.get().s, x: drag.cx + dx, y: drag.cy + dy });
    drag.samples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (drag.samples.length > MAX_SAMPLES) {
      drag.samples.shift();
    }
  };

  const flick = (d: Drag) => {
    const now = performance.now();
    const recent = d.samples.filter((s) => now - s.t < FLICK_WINDOW);
    const a = recent.at(0);
    const b = recent.at(-1);
    if (!(a && b) || recent.length < 2) {
      return;
    }
    const dt = Math.max(1, b.t - a.t);
    camera.coast((b.x - a.x) / dt, (b.y - a.y) / dt);
  };

  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        swallowClick = true;
        drag = null;
        onUserMove();
      }
      return;
    }
    if (!drag || e.pointerId !== drag.id) {
      return;
    }
    const d = drag;
    drag = null;
    viewport.classList.remove("grabbing");
    isDragging?.(false);
    if (d.moved) {
      swallowClick = true;
      flick(d);
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    if (e.type === "pointerup" && !target?.closest(INTERACTIVE)) {
      onEmptyClick();
    }
  };

  const onClick = (e: MouseEvent) => {
    if (swallowClick) {
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    camera.stop();
    onUserMove();
    if (e.ctrlKey || e.metaKey) {
      const r = viewport.getBoundingClientRect();
      camera.zoomAt(
        e.clientX - r.left,
        e.clientY - r.top,
        Math.exp(-e.deltaY * WHEEL_ZOOM)
      );
    } else {
      camera.panBy(-e.deltaX, -e.deltaY);
    }
  };

  /** Links and images must not start a native drag-and-drop. */
  const onDragStart = (e: DragEvent) => {
    e.preventDefault();
  };

  /**
   * Tabbing to a card inside an overflow:hidden box makes the browser scroll
   * it; the camera does the moving, so undo that.
   */
  const onScroll = () => {
    viewport.scrollTop = 0;
    viewport.scrollLeft = 0;
  };

  viewport.addEventListener("pointerdown", onDown);
  viewport.addEventListener("pointermove", onMove);
  viewport.addEventListener("pointerup", onUp);
  viewport.addEventListener("pointercancel", onUp);
  viewport.addEventListener("click", onClick, true);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("dragstart", onDragStart);
  viewport.addEventListener("scroll", onScroll);

  return () => {
    viewport.removeEventListener("pointerdown", onDown);
    viewport.removeEventListener("pointermove", onMove);
    viewport.removeEventListener("pointerup", onUp);
    viewport.removeEventListener("pointercancel", onUp);
    viewport.removeEventListener("click", onClick, true);
    viewport.removeEventListener("wheel", onWheel);
    viewport.removeEventListener("dragstart", onDragStart);
    viewport.removeEventListener("scroll", onScroll);
  };
};
