/**
 * Moving, rotating and resizing a visitor sticker on the canvas: shared by
 * placing a new sticker (sticker-upload.ts) and moving a placed one
 * (sticker-edit.ts), so both feel the same.
 *
 * - drag the sticker to move it; drag the round handle (top right) to rotate,
 *   the square handle (bottom right) to resize;
 * - the wheel / trackpad pinch over the sticker resizes it;
 * - keys: arrows move (Shift: further), [ ] rotate, - = resize.
 */
import { stickerDisplayWidth } from "@/lib/server/image-header";
import { STICKER_PLACEMENT } from "@/lib/server/sticker-limits";
import type { CanvasApi, Point } from "@/scripts/canvas/api";

export type EditPlacement = {
  x: number;
  y: number;
  rotation: number;
  scale: number;
};

export type SizedPlacement = EditPlacement & { width: number; height: number };

export const SCALE_STEP = 0.1;
export const ROTATE_STEP = 5;
/** Scale moves in steps of 1/50 (0.02) so dragging feels continuous. */
const SCALE_PRECISION = 50;
/** How fast the wheel / trackpad pinch resizes the sticker. */
const WHEEL_ZOOM = 0.002;
const MOVE_STEP = 10;
const MOVE_STEP_FAST = 40;
const HALF_TURN = 180;
const DEG = HALF_TURN / Math.PI;

/** The two handles, inside the sticker element (styled in StickerUpload.astro). */
export const HANDLES_HTML =
  '<span class="vs-rot" title="拖这里旋转" aria-hidden="true"></span><span class="vs-scale" title="拖这里调大小" aria-hidden="true"></span>';

/** Keyboard help for the sticker's accessible name. */
export const KEY_HELP = "拖动或用方向键移动，[ 和 ] 旋转，- 和 = 调大小";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Keeps rotation and scale within what the server accepts. */
export const clampEdit = <T extends EditPlacement>(placement: T): T => {
  const { world, rotation, scaleMin, scaleMax } = STICKER_PLACEMENT;
  return {
    ...placement,
    x: clamp(Math.round(placement.x), -world, world),
    y: clamp(Math.round(placement.y), -world, world),
    rotation: clamp(Math.round(placement.rotation), -rotation, rotation),
    scale: clamp(
      Math.round(placement.scale * SCALE_PRECISION) / SCALE_PRECISION,
      scaleMin,
      scaleMax
    ),
  };
};

/** The change a key asks for, or null for keys that do nothing here. */
export const keyChange = (
  event: KeyboardEvent,
  { x, y, rotation, scale }: EditPlacement
): Partial<EditPlacement> | null => {
  const step = event.shiftKey ? MOVE_STEP_FAST : MOVE_STEP;
  const changes: Record<string, Partial<EditPlacement>> = {
    ArrowLeft: { x: x - step },
    ArrowRight: { x: x + step },
    ArrowUp: { y: y - step },
    ArrowDown: { y: y + step },
    "[": { rotation: rotation - ROTATE_STEP },
    "]": { rotation: rotation + ROTATE_STEP },
    "-": { scale: scale - SCALE_STEP },
    "=": { scale: scale + SCALE_STEP },
  };
  return changes[event.key] ?? null;
};

export const wheelScale = (scale: number, event: WheelEvent) =>
  scale * Math.exp(-event.deltaY * WHEEL_ZOOM);

/** Writes a placement onto a sticker element (left/top in world px). */
export const applyPlacement = (el: HTMLElement, placement: SizedPlacement) => {
  el.style.left = `${placement.x}px`;
  el.style.top = `${placement.y}px`;
  el.style.setProperty(
    "--w",
    `${stickerDisplayWidth(placement.width, placement.scale)}px`
  );
  el.style.setProperty("--r", `${placement.rotation}deg`);
};

/** What a press on a sticker does: move it, or turn / resize it by a handle. */
export type DragMode = "move" | "rotate" | "resize";

export type TransformDrag = {
  api: CanvasApi;
  el: HTMLElement;
  event: PointerEvent;
  origin: EditPlacement;
  /** Screen px before a press counts as a drag (0: at once). */
  slop?: number;
  onChange: (change: Partial<EditPlacement>) => void;
  /** Every pointer move once it counts as a drag (e.g. over the trash). */
  onMove?: (event: PointerEvent, mode: DragMode) => void;
  /** `moved` is false for a press that stayed within the slop (a click). */
  onEnd: (moved: boolean, event: PointerEvent, mode: DragMode) => void;
};

/** Move, or turn / resize when the press is on a handle. */
export const modeOf = (target: EventTarget | null): DragMode => {
  const handle =
    target instanceof Element ? target.closest(".vs-rot, .vs-scale") : null;
  if (!handle) {
    return "move";
  }
  return handle.classList.contains("vs-rot") ? "rotate" : "resize";
};

/**
 * Follows one pointer from pointerdown to pointerup: moves the sticker, or
 * rotates / resizes it when the press started on a handle. The caller has
 * already stopped the event reaching the canvas (so the desk does not pan).
 */
export const trackTransform = ({
  api,
  el,
  event,
  origin,
  slop = 0,
  onChange,
  onMove,
  onEnd,
}: TransformDrag) => {
  const mode = modeOf(event.target);
  const viewport = api.viewportEl.getBoundingClientRect();
  const toWorld = (e: PointerEvent) =>
    api.screenToWorld({
      x: e.clientX - viewport.left,
      y: e.clientY - viewport.top,
    });
  const start = toWorld(event);
  const angle = (p: Point) => Math.atan2(p.y - origin.y, p.x - origin.x) * DEG;
  const distance = (p: Point) =>
    Math.hypot(p.x - origin.x, p.y - origin.y) || 1;
  const startAngle = angle(start);
  const startDistance = distance(start);
  let moved = slop === 0;
  el.setPointerCapture(event.pointerId);
  el.classList.add("dragging");

  const move = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) {
      return;
    }
    if (
      !moved &&
      Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) <= slop
    ) {
      return;
    }
    moved = true;
    onMove?.(e, mode);
    const p = toWorld(e);
    if (mode === "rotate") {
      onChange({ rotation: origin.rotation + angle(p) - startAngle });
    } else if (mode === "resize") {
      onChange({ scale: (origin.scale * distance(p)) / startDistance });
    } else {
      onChange({ x: origin.x + p.x - start.x, y: origin.y + p.y - start.y });
    }
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) {
      return;
    }
    el.classList.remove("dragging");
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    onEnd(moved, e, mode);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
};
