/**
 * The owner throws comments into the trash (docs/design.md 「审核」): only
 * with the Access session (review-comments.ts `reviewNow(slug).on`), only
 * for cards the lists marked throwable with `data-throw="<id>"` (待审 →
 * 拒绝, approved → 撤下). Visitors get no `data-throw`, so nothing here
 * reacts for them.
 *
 * - Pointer: press the card's paper and pull it more than DRAG_SLOP px. The
 *   paper is everything that is not text or a control (NO_GRAB in
 *   review-state.ts: the padding, the avatar circle, the stamps), so
 *   selecting and copying the text still works; margin notes are small
 *   previews and are picked up anywhere. A lifted copy of the card (same
 *   size, a slight tilt, a deeper shadow) follows the pointer while the
 *   card itself stays in place, dimmed. The hand-drawn can (trash.ts) shows
 *   at the bottom right above the drawer and opens when the pointer is over
 *   it; letting go there crumples the copy into it and hands the comment to
 *   throwComment() (已扔掉 · 撤销, then the decide request). Let go
 *   elsewhere, pointercancel or Escape: the copy floats back.
 * - Keyboard: the card is focusable (Tab, or a click on its paper) and
 *   Delete / Backspace throws it the same way, focusing 撤销.
 * - Reduced motion: no tilt; the copy fades into the can and snaps back.
 */
import { throwComment } from "./review-comments";
import {
  FLOAT_BACK_MS,
  LIFT_SCALE,
  NO_GRAB,
  pastSlop,
  slipPose,
} from "./review-state";
import { isOver } from "./sticker-gesture";
import {
  crumpleInto,
  hideTrash,
  LID_MS,
  openTrash,
  type SlipPose,
  showTrash,
  trashBox,
} from "./trash";
import { reduceMotion } from "./util";

export interface ThrowSource {
  /** Picked up anywhere, text included (margin notes). */
  anywhere?: boolean;
  /** The throwable card a press or key on `target` is about. */
  cardOf: (target: Element) => HTMLElement | null;
  /** The card of this comment now (the lists re-render). */
  findCard: (id: string) => HTMLElement | null;
  /** Focus the first element with one of these data-keys, after sending. */
  focusKeys: (keys: string[]) => void;
  /** Extra class for the lifted copy (a popover row is sticky yellow). */
  ghostClass?: string;
  /** Presses and keys inside it are watched. */
  root: HTMLElement;
  slug: string;
}

interface Drag {
  /** The card's own rotation (deg). */
  base: number;
  card: HTMLElement;
  ghost: HTMLElement | null;
  id: string;
  over: boolean;
  pointerId: number;
  pose: SlipPose;
  source: ThrowSource;
  start: { x: number; y: number };
}

const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const LIFTING = "is-lifting";
/** Copied onto the lifted copy, which leaves the list's own styles behind. */
const COPIED = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
] as const;
/** Not on the copy: a second element with the same id or key. */
const UNIQUE = ["id", "data-key", "data-throw", "data-item", "tabindex"];
/**
 * Classes of the card that are not wanted on the copy (a 待审 card is
 * dashed and see-through; the lifted copy is plain paper).
 */
const TRANSIENT = [
  "rv-target",
  "rv-pulse",
  "rv-back",
  "flash",
  "pop-in",
  "hot",
  "pending",
];

let drag: Drag | null = null;

const rotationOf = (el: HTMLElement) => {
  const value = getComputedStyle(el).rotate;
  return value === "none" ? 0 : Number.parseFloat(value) || 0;
};

/* ---------- the lifted copy ---------- */

const makeGhost = (card: HTMLElement, extraClass = "") => {
  const rect = card.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const ghost = card.cloneNode(true) as HTMLElement;
  for (const el of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
    for (const name of UNIQUE) {
      el.removeAttribute(name);
    }
  }
  ghost.removeAttribute("aria-keyshortcuts");
  ghost.removeAttribute("aria-describedby");
  ghost.removeAttribute("role");
  ghost.hidden = false;
  ghost.classList.remove(LIFTING, ...TRANSIENT);
  ghost.classList.add("cmt-ghost");
  if (extraClass) {
    ghost.classList.add(extraClass);
  }
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  const computed = getComputedStyle(card);
  for (const name of COPIED) {
    ghost.style.setProperty(name, computed.getPropertyValue(name));
  }
  // Out of the list's flow and above the drawer, whatever the card's own
  // position rule says (the classes came along with the copy).
  ghost.style.position = "fixed";
  ghost.style.margin = "0";
  ghost.style.transition = "none";
  ghost.style.animation = "none";
  // Centred where the card is (its box grows a little when it is tilted).
  ghost.style.left = `${rect.left + rect.width / 2 - width / 2}px`;
  ghost.style.top = `${rect.top + rect.height / 2 - height / 2}px`;
  ghost.style.width = `${width}px`;
  ghost.style.height = `${height}px`;
  document.body.appendChild(ghost);
  return ghost;
};

const placeGhost = (ghost: HTMLElement, pose: SlipPose, lifted: boolean) => {
  ghost.style.translate = `${pose.dx}px ${pose.dy}px`;
  ghost.style.rotate = `${pose.turn}deg`;
  ghost.style.scale = lifted && !reduceMotion() ? String(LIFT_SCALE) : "1";
};

/** The card is shown again: a small press, and focus back when it had it. */
const settleCard = (source: ThrowSource, id: string, focus: boolean) => {
  const card = source.findCard(id);
  if (!card) {
    return;
  }
  card.classList.remove(LIFTING);
  if (!reduceMotion()) {
    card.classList.remove("rv-back");
    // Restart the animation when it comes back twice.
    card.getBoundingClientRect();
    card.classList.add("rv-back");
    card.addEventListener(
      "animationend",
      () => card.classList.remove("rv-back"),
      { once: true }
    );
  }
  if (focus) {
    card.focus({ preventScroll: true });
  }
};

/* ---------- throwing ---------- */

/** Crumple the copy into the can, then 已扔掉 · 撤销 and the request. */
const throwInto = async ({
  source,
  id,
  ghost,
  pose,
  focusUndo,
}: {
  source: ThrowSource;
  id: string;
  ghost: HTMLElement;
  pose: SlipPose;
  /** Keyboard: focus 撤销 afterwards. */
  focusUndo: boolean;
}) => {
  showTrash({ raised: true });
  openTrash(true);
  await crumpleInto(ghost, pose);
  ghost.remove();
  window.setTimeout(hideTrash, LID_MS);
  const thrown = throwComment(source.slug, id, {
    focusUndo,
    onSent: (keys) => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) {
        source.focusKeys(keys);
      }
    },
    onUndo: (hadFocus) => settleCard(source, id, hadFocus),
  });
  if (!thrown) {
    settleCard(source, id, focusUndo);
  }
};

/** Delete / Backspace on a focused card. */
const throwByKey = (source: ThrowSource, card: HTMLElement) => {
  const ghost = makeGhost(card, source.ghostClass);
  const base = rotationOf(card);
  const pose = { dx: 0, dy: 0, turn: base };
  placeGhost(ghost, pose, false);
  card.classList.add(LIFTING);
  throwInto({
    focusUndo: true,
    ghost,
    id: card.dataset.throw ?? "",
    pose,
    source,
  });
};

/* ---------- pointer ---------- */

/** A click follows the release of a drag: it is not a click on the card. */
const swallowClick = () => {
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(
    () => window.removeEventListener("click", swallow, { capture: true }),
    0
  );
};

/** Let go elsewhere, cancelled or Escape: the copy floats back. */
const floatBack = async (current: Drag) => {
  const { ghost, source, id } = current;
  hideTrash();
  if (!ghost) {
    return;
  }
  if (!reduceMotion()) {
    await ghost
      .animate(
        [
          {
            rotate: `${current.pose.turn}deg`,
            scale: String(LIFT_SCALE),
            translate: `${current.pose.dx}px ${current.pose.dy}px`,
          },
          { rotate: `${current.base}deg`, scale: "1", translate: "0px 0px" },
        ],
        { duration: FLOAT_BACK_MS, easing: EASE_OUT, fill: "forwards" }
      )
      .finished.catch(() => {
        // The copy went away first: nothing to wait for.
      });
  }
  ghost.remove();
  current.card.classList.remove(LIFTING);
  source.findCard(id)?.classList.remove(LIFTING);
};

const stopListening = () => {
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
  window.removeEventListener("keydown", onEscape, { capture: true });
  document.body.classList.remove("is-throwing");
};

const lift = (current: Drag) => {
  current.ghost = makeGhost(current.card, current.source.ghostClass);
  current.card.classList.add(LIFTING);
  document.body.classList.add("is-throwing");
  showTrash({ raised: true });
  // Whatever the press started selecting is not wanted while dragging.
  window.getSelection()?.removeAllRanges();
};

function onMove(event: PointerEvent) {
  const current = drag;
  if (!current || event.pointerId !== current.pointerId) {
    return;
  }
  const point = { x: event.clientX, y: event.clientY };
  if (!current.ghost) {
    if (!pastSlop(point.x - current.start.x, point.y - current.start.y)) {
      return;
    }
    lift(current);
  }
  event.preventDefault();
  const moved = slipPose(current.start, point, reduceMotion());
  current.pose = { ...moved, turn: current.base + moved.turn };
  if (current.ghost) {
    placeGhost(current.ghost, current.pose, true);
  }
  current.over = isOver(trashBox(), point);
  openTrash(current.over);
  current.ghost?.classList.toggle("is-over", current.over);
}

function onUp(event: PointerEvent) {
  const current = drag;
  if (!current || event.pointerId !== current.pointerId) {
    return;
  }
  drag = null;
  stopListening();
  const { ghost } = current;
  if (!ghost) {
    return;
  }
  swallowClick();
  if (event.type === "pointerup" && current.over) {
    throwInto({
      focusUndo: false,
      ghost,
      id: current.id,
      pose: current.pose,
      source: current.source,
    });
    return;
  }
  floatBack(current);
}

function onEscape(event: KeyboardEvent) {
  const current = drag;
  if (event.key !== "Escape" || !current) {
    return;
  }
  drag = null;
  stopListening();
  if (!current.ghost) {
    return;
  }
  // Only the drag is cancelled, not the popover around the card.
  event.preventDefault();
  event.stopPropagation();
  floatBack(current);
}

const onPointerDown = (source: ThrowSource, event: PointerEvent) => {
  if (drag || event.button !== 0 || !event.isPrimary) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const card = target ? source.cardOf(target) : null;
  const id = card?.dataset.throw;
  if (!(card && id) || (!source.anywhere && target?.closest(NO_GRAB))) {
    return;
  }
  if (event.pointerType !== "touch") {
    // No text selection from the paper; the press selects the card instead.
    event.preventDefault();
    card.focus({ preventScroll: true });
  }
  const base = rotationOf(card);
  drag = {
    base,
    card,
    ghost: null,
    id,
    over: false,
    pointerId: event.pointerId,
    pose: { dx: 0, dy: 0, turn: base },
    source,
    start: { x: event.clientX, y: event.clientY },
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("keydown", onEscape, { capture: true });
};

const onKeyDown = (source: ThrowSource, event: KeyboardEvent) => {
  if (event.key !== "Delete" && event.key !== "Backspace") {
    return;
  }
  const target = event.target instanceof HTMLElement ? event.target : null;
  const card = target ? source.cardOf(target) : null;
  // Only the focused card itself, never a reply editor inside it.
  if (!(card?.dataset.throw && card === target) || drag) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  throwByKey(source, card);
};

/**
 * Watches `source.root` for cards being thrown away. Returns the cleanup
 * (the drawer and the popover are replaced on navigation).
 */
export const watchThrows = (source: ThrowSource) => {
  const down = (event: Event) => onPointerDown(source, event as PointerEvent);
  const key = (event: Event) => onKeyDown(source, event as KeyboardEvent);
  source.root.addEventListener("pointerdown", down);
  source.root.addEventListener("keydown", key);
  return () => {
    source.root.removeEventListener("pointerdown", down);
    source.root.removeEventListener("keydown", key);
    if (drag?.source === source) {
      const current = drag;
      drag = null;
      stopListening();
      current.ghost?.remove();
      hideTrash();
    }
  };
};
