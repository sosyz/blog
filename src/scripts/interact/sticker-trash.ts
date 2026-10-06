/**
 * 垃圾桶 for visitor stickers (docs/design.md 「访客互动」). The can, the
 * 「已扔掉 · 撤销」 slip and the delayed commit are shared with comments
 * (trash.ts); this module adds who may throw a sticker, its crumple in
 * world space and the requests.
 *
 * While a sticker the viewer may delete is peeled off the desk, the
 * hand-drawn can shows at the bottom right (above the zoom buttons);
 * dropping the sticker on it (or pressing Delete / Backspace on a selected
 * one) crumples it into the bin. There is no confirmation: 已扔掉 · 撤销
 * stays for UNDO_MS, and only then is the request sent (or when the page is
 * hidden, with keepalive). 撤销 puts the sticker back where it was before it
 * was picked up.
 *
 * Who may throw what (sticker-gesture.ts `throwRoute`): the owner with an
 * Access session rejects it (review-stickers.ts registers the admin remover;
 * an approved one is taken down, 撤下); the uploader (edit token or GitHub
 * account) and the owner's GitHub session delete it with
 * DELETE /api/stickers/:id. Nobody else sees the trash.
 *
 * Built-in stickers (`data-sticker-key`, `throwBuiltin`): only the owner
 * (Access or the GitHub session; sticker-edit.ts decides) may throw one. It
 * is hidden for every visitor with POST /api/builtins {key, hidden: true}
 * after the same 已扔掉 · 撤销, and comes back from /admin/.
 */
import type { BuiltinToggleResponse } from "@/lib/server/types";
import { authNow } from "./auth";
import {
  confirmBuiltinChange,
  expectBuiltinHidden,
  hideThrownBuiltin,
  unhideThrownBuiltin,
} from "./builtin-hidden";
import { BIN_MOUTH, CRUMPLE_STOPS, throwRoute } from "./sticker-gesture";
import { ownedToken } from "./sticker-store";
import {
  hideShown,
  isAccountOwned,
  removeShown,
  unhideShown,
} from "./stickers";
import {
  trashBox as binBox,
  flushHeld,
  hideTrash as hideBin,
  hold,
  isHeld,
  LID_MS,
  openTrash as openBin,
  setTrashHost as setBinHost,
  showTrash as showBin,
  toast,
} from "./trash";
import { esc, reduceMotion } from "./util";

/* ---------- the can (trash.ts), for sticker-edit.ts ---------- */

/** Where the can and the slip live: the persisted canvas root. */
export const setTrashHost = (el: HTMLElement | null) => setBinHost(el);

/** Shows the can in the canvas root, above the zoom buttons. */
export const showTrash = () => showBin();

export const hideTrash = () => hideBin();

/** The can's box on screen (client px), or null when it is not up. */
export const trashBox = () => binBox();

/** Lid open while a sticker hovers over it. */
export const openTrash = (open: boolean) => openBin(open);

export type ThrowOutcome =
  | { ok: true; note?: string; link?: { href: string; label: string } }
  | { ok: false; message: string };

/** Sends the real request for a thrown sticker. */
export type Remover = (id: string, keepalive: boolean) => Promise<ThrowOutcome>;

/** Shown after a successful throw with a note / link (e.g. 下一条待审). */
const NOTE_MS = 8000;
const ERROR_MS = 5000;
const CRUMPLE_MS = 420;
const FADE_MS = 150;
/** Matches the vs-stick animation in StickerLayer.astro. */
const STICK_MS = 260;
const HTTP_NO_CONTENT = 204;

let adminRemover: Remover | null = null;

/* ---------- who may throw ---------- */

/** review-stickers.ts: the Access session is here (or gone, with null). */
export const setAdminRemover = (remover: Remover | null) => {
  adminRemover = remover;
};

const routeFor = (id: string) =>
  throwRoute({
    accountOwned: isAccountOwned(id),
    hasToken: Boolean(ownedToken(id)),
    moderating: adminRemover !== null,
    sessionOwner: authNow()?.isOwner === true,
  });

/** This viewer may throw the visitor sticker away (and sees the trash). */
export const canThrow = (id: string) => routeFor(id) !== null;

/* ---------- the throw ---------- */

const offsetPx = (el: HTMLElement, name: string) =>
  Number.parseFloat(el.style.getPropertyValue(name)) || 0;

/** Where the sticker has to fall (world px from where it is now). */
const fallTo = (el: HTMLElement, scale: number) => {
  const box = trashBox();
  if (!box) {
    return { x: 0, y: 0 };
  }
  const rect = el.getBoundingClientRect();
  return {
    x: (box.left + box.width / 2 - rect.left - rect.width / 2) / scale,
    y: (box.top + box.height * BIN_MOUTH - rect.top - rect.height / 2) / scale,
  };
};

/**
 * The sticker crumples and falls into the bin (a fade with reduced motion).
 * Visitor stickers are centred with translate -50%; built-ins are not.
 */
const crumple = async (el: HTMLElement, scale: number) => {
  el.classList.remove("is-lifted", "is-sticking");
  const done = () => {
    // Cancelled (the layer re-rendered): nothing to wait for.
  };
  if (reduceMotion()) {
    await el
      .animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: FADE_MS,
        fill: "forwards",
      })
      .finished.catch(done);
    return;
  }
  const to = fallTo(el, scale);
  const dx = offsetPx(el, "--dx");
  const dy = offsetPx(el, "--dy");
  const rotation = getComputedStyle(el).rotate;
  const start = rotation === "none" ? 0 : Number.parseFloat(rotation) || 0;
  const centre = el.dataset.stickerKey === undefined ? "-50% + " : "";
  const frames = CRUMPLE_STOPS.map((stop) => ({
    offset: stop.offset,
    opacity: stop.opacity,
    rotate: `${start + stop.turn}deg`,
    scale: stop.scale,
    translate: `calc(${centre}${dx + to.x * stop.way}px) calc(${centre}${dy + to.y * stop.way - stop.hop}px)`,
  }));
  await el
    .animate(frames, {
      duration: CRUMPLE_MS,
      easing: "cubic-bezier(0.5, 0, 0.75, 0)",
      fill: "forwards",
    })
    .finished.catch(done);
};

const deleteOwn: Remover = async (id, keepalive) => {
  const token = ownedToken(id);
  try {
    const response = await fetch(`/api/stickers/${encodeURIComponent(id)}`, {
      body: JSON.stringify(token ? { token } : {}),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      keepalive,
      method: "DELETE",
    });
    if (response.ok || response.status === HTTP_NO_CONTENT) {
      return { ok: true };
    }
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    return {
      message: data?.error ?? `没扔掉（${response.status}），稍后再试。`,
      ok: false,
    };
  } catch {
    return { message: "网络好像断了，贴纸没扔掉。", ok: false };
  }
};

const outcomeExtra = (outcome: ThrowOutcome) => {
  if (!(outcome.ok && outcome.link)) {
    return "";
  }
  // A full page load: review links are read when the page starts.
  return ` · <a href="${esc(outcome.link.href)}" data-astro-reload>${esc(outcome.link.label)}</a>`;
};

/** Sends the request for a sticker once its 撤销 ran out. */
const commit = async (
  id: string,
  route: "admin" | "own",
  keepalive: boolean
) => {
  const remover = route === "admin" ? adminRemover : deleteOwn;
  const outcome: ThrowOutcome = remover
    ? await remover(id, keepalive)
    : { message: "需要先在 /admin/ 登录，贴纸没扔掉。", ok: false };
  // Something else went into the trash meanwhile: keep its 撤销 up.
  const quiet = isHeld();
  if (!outcome.ok) {
    unhideShown(id);
    if (!quiet) {
      toast(outcome.message, "", ERROR_MS, true);
    }
    return;
  }
  removeShown(id);
  if (outcome.note && !quiet) {
    toast(outcome.note, outcomeExtra(outcome), NOTE_MS);
  }
};

/** 撤销: the sticker comes back where it was picked up. */
const undo = (id: string, hadFocus: boolean) => {
  unhideShown(id);
  const el = document.querySelector<HTMLElement>(
    `[data-sticker-layer] .vs[data-vs-id="${CSS.escape(id)}"]`
  );
  // Laid back flat where it was, with the same press as 贴回去.
  if (el && !reduceMotion()) {
    el.classList.add("is-sticking");
    window.setTimeout(() => el.classList.remove("is-sticking"), STICK_MS);
  }
  if (hadFocus) {
    el?.focus({ preventScroll: true });
  }
};

export interface ThrowRequest {
  el: HTMLElement;
  /** It already fell into the bin (the WebGL curl did it): no crumple. */
  fallen?: boolean;
  /** Keyboard: focus 撤销 afterwards. */
  focusUndo: boolean;
  id: string;
  /** Puts the layer's copy back where the sticker was picked up. */
  restore: () => void;
  /** Camera scale (world px → screen px) for the fall into the bin. */
  scale: number;
}

/** Throws a sticker away: crumple, hide, 已扔掉 · 撤销, then really delete. */
export const throwAway = async ({
  id,
  el,
  scale,
  restore,
  focusUndo,
  fallen = false,
}: ThrowRequest) => {
  const route = routeFor(id);
  if (!route) {
    return false;
  }
  // One at a time: the previous one goes now.
  flushHeld();
  showTrash();
  openTrash(true);
  if (!fallen) {
    await crumple(el, scale || 1);
  }
  window.setTimeout(hideTrash, LID_MS);
  restore();
  hideShown(id);
  hold(
    {
      commit: (keepalive) => commit(id, route, keepalive),
      undo: (hadFocus) => undo(id, hadFocus),
    },
    focusUndo
  );
  return true;
};

/* ---------- built-in stickers (the owner only) ---------- */

const hideBuiltin = async (
  key: string,
  keepalive: boolean
): Promise<ThrowOutcome> => {
  expectBuiltinHidden(key);
  try {
    const response = await fetch("/api/builtins", {
      body: JSON.stringify({ hidden: true, key }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      keepalive,
      method: "POST",
    });
    const data = (await response.json().catch(() => null)) as
      | (Partial<BuiltinToggleResponse> & { error?: string })
      | null;
    if (response.ok) {
      confirmBuiltinChange(key, true, data?.hiddenBuiltins ?? []);
      return { ok: true };
    }
    return {
      message: data?.error ?? `没扔掉（${response.status}），稍后再试。`,
      ok: false,
    };
  } catch {
    return { message: "网络好像断了，贴纸没扔掉。", ok: false };
  }
};

const commitBuiltin = async (key: string, keepalive: boolean) => {
  const outcome = await hideBuiltin(key, keepalive);
  if (outcome.ok) {
    return;
  }
  expectBuiltinHidden(key, true);
  unhideThrownBuiltin(key);
  // Something else went into the trash meanwhile: keep its 撤销 up.
  if (!isHeld()) {
    toast(outcome.message, "", ERROR_MS, true);
  }
};

const builtinEl = (key: string) =>
  document.querySelector<HTMLElement>(
    `[data-sticker-key="${CSS.escape(key)}"]`
  );

/** 撤销: the built-in is back where it was picked up. */
const undoBuiltin = (key: string, hadFocus: boolean) => {
  unhideThrownBuiltin(key);
  const el = builtinEl(key);
  if (el && !reduceMotion()) {
    el.classList.add("is-sticking");
    window.setTimeout(() => el.classList.remove("is-sticking"), STICK_MS);
  }
  if (hadFocus) {
    el?.focus({ preventScroll: true });
  }
};

export interface BuiltinThrow {
  el: HTMLElement;
  /** It already fell into the bin (the WebGL curl did it): no crumple. */
  fallen?: boolean;
  /** Keyboard: focus 撤销 afterwards. */
  focusUndo: boolean;
  key: string;
  /** Puts it back where it was picked up (its local offset). */
  restore: () => void;
  /** Camera scale (world px → screen px) for the fall into the bin. */
  scale: number;
}

/**
 * The owner throws a built-in away: crumple, hide, 已扔掉 · 撤销, then POST
 * /api/builtins. The caller checks that this is the owner.
 */
export const throwBuiltin = async ({
  key,
  el,
  scale,
  restore,
  focusUndo,
  fallen = false,
}: BuiltinThrow) => {
  flushHeld();
  showTrash();
  openTrash(true);
  if (!fallen) {
    await crumple(el, scale || 1);
  }
  window.setTimeout(hideTrash, LID_MS);
  hideThrownBuiltin(key);
  // The crumple holds its last frame: drop it, the element is hidden now.
  for (const animation of el.getAnimations()) {
    animation.cancel();
  }
  el.classList.remove("is-lifted", "is-tugged", "is-sticking");
  restore();
  hold(
    {
      commit: (keepalive) => commitBuiltin(key, keepalive),
      undo: (hadFocus) => undoBuiltin(key, hadFocus),
    },
    focusUndo
  );
};
