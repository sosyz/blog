/**
 * The owner reviews comments where they are (browser side; the pure part is
 * review-state.ts). Only when `canModerate()` says the Cloudflare Access
 * session is present: visitors never request anything here.
 *
 * - watchReview(slug, fn): the note's pending and 已撤下 comments from
 *   GET /api/admin/comments, shared by the comment list (comments.ts) and the
 *   highlight popover (inline.ts).
 * - act(slug, id, action): one button of a review bar (通过, 回复, 删回复,
 *   恢复). Decisions go to POST /api/admin/decide and move the item in place
 *   (store.ts patchThread + the lists here), no page reload. 401/403 →
 *   resetModerate() and the tools hide behind 「需要先在 /admin/ 登录」.
 * - throwComment(slug, id, …): the comment went into the trash
 *   (comment-drag.ts). It is hidden at once (isThrown) and 已扔掉 · 撤销
 *   shows (trash.ts); when that runs out the same decide request as before
 *   is sent: reject (a pending one is rejected, an approved one taken down,
 *   撤下). 撤销 shows it again, nothing is sent. Failing puts it back with
 *   the error.
 * - Deciding the `?review=c:<id>` comment sets `next` (下一条待审 → / 都审完了).
 * - REVIEW_FOCUS: comments.ts asks inline.ts to show a deep-linked highlight
 *   comment at its underlined text; inline.ts calls preventDefault() when it
 *   could, else the list shows it.
 */

import type { AdminCommentsResponse, DecideResponse } from "@/lib/server/types";
import { canModerate, resetModerate, reviewTarget } from "./owner";
import {
  applyDecision,
  BAR_ACTIONS,
  type BarAction,
  type BarEvent,
  type BarState,
  type Board,
  type DecideRequest,
  IDLE_BAR,
  type NextState,
  type ReviewComment,
  reduceBar,
  requestFor,
  safeHref,
  statusAfter,
} from "./review-state";
import { patchThread, threadNow } from "./store";
import { hold, toast } from "./trash";
import { reduceMotion } from "./util";

export const REVIEW_FOCUS = "interact:review-focus";
export interface ReviewFocusDetail {
  id: string;
  slug: string;
}

export interface ReviewView {
  /** An admin request answered 401/403: 需要先在 /admin/ 登录. */
  denied: boolean;
  error: string | null;
  hidden: ReviewComment[];
  loaded: boolean;
  /** Set after deciding the deep-linked comment. */
  next: NextState | null;
  /** The review tools are shown. */
  on: boolean;
  pending: ReviewComment[];
  /** Bumped whenever a comment is thrown away or comes back (isThrown). */
  thrown: number;
}

export const DENIED_TEXT = "需要先在 /admin/ 登录";

const OFF: ReviewView = {
  denied: false,
  error: null,
  hidden: [],
  loaded: false,
  next: null,
  on: false,
  pending: [],
  thrown: 0,
};

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
/** Re-fetch when coming back to a note after this long. */
const STALE_AFTER = 60_000;

type Listener = (view: ReviewView) => void;

const views = new Map<string, ReviewView>();
const listeners = new Map<string, Set<Listener>>();
const loadedAt = new Map<string, number>();
const inflight = new Set<string>();
/** Review bar state per comment id (ids are unique across notes). */
const bars = new Map<string, BarState>();
/** In the trash, waiting for 撤销 to run out: not shown anywhere. */
const thrown = new Set<string>();
/** The error slip after a throw failed. */
const THROW_ERROR_MS = 5000;

export const reviewNow = (slug: string) => views.get(slug) ?? OFF;

const publish = (slug: string, view: ReviewView) => {
  views.set(slug, view);
  for (const listener of listeners.get(slug) ?? []) {
    listener(view);
  }
};

/** Re-notify without changing the lists (a review bar changed). */
const touch = (slug: string) => publish(slug, { ...reviewNow(slug) });

/* ---------- requests ---------- */

type AdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; denied: boolean; status: number; message: string };

const adminJson = async <T>(
  input: string,
  init?: RequestInit
): Promise<AdminResult<T>> => {
  try {
    const response = await fetch(input, {
      cache: "no-store",
      credentials: "same-origin",
      // An expired Access session answers with a redirect to its login page.
      redirect: "manual",
      ...init,
    });
    const { status } = response;
    const denied =
      response.type === "opaqueredirect" ||
      status === HTTP_UNAUTHORIZED ||
      status === HTTP_FORBIDDEN;
    const data = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null;
    if (denied) {
      return { denied, message: DENIED_TEXT, ok: false, status };
    }
    if (!response.ok) {
      return {
        denied,
        message: data?.error ?? `服务器出了点问题（${status}），稍后再试。`,
        ok: false,
        status,
      };
    }
    if (data === null) {
      return {
        denied,
        message: "服务器返回的内容看不懂，稍后再试。",
        ok: false,
        status,
      };
    }
    return { data, ok: true };
  } catch {
    return {
      denied: false,
      message: "网络好像断了，检查一下再试。",
      ok: false,
      status: 0,
    };
  }
};

const deny = (slug: string) => {
  resetModerate();
  publish(slug, { ...OFF, denied: true, thrown: reviewNow(slug).thrown });
};

const fetchReview = async (slug: string) => {
  inflight.add(slug);
  const result = await adminJson<AdminCommentsResponse>(
    `/api/admin/comments?${new URLSearchParams({ slug })}`
  );
  inflight.delete(slug);
  loadedAt.set(slug, Date.now());
  if (!result.ok) {
    if (result.denied) {
      deny(slug);
    } else {
      publish(slug, {
        ...reviewNow(slug),
        error: result.message,
        loaded: true,
        on: true,
      });
    }
    return;
  }
  publish(slug, {
    ...reviewNow(slug),
    denied: false,
    error: null,
    hidden: result.data.hidden ?? [],
    loaded: true,
    on: true,
    pending: result.data.pending ?? [],
  });
};

const start = async (slug: string) => {
  const fresh = Date.now() - (loadedAt.get(slug) ?? 0) < STALE_AFTER;
  if (inflight.has(slug) || (fresh && reviewNow(slug).loaded)) {
    return;
  }
  inflight.add(slug);
  const allowed = await canModerate();
  inflight.delete(slug);
  if (allowed) {
    await fetchReview(slug);
  }
};

/**
 * Calls `listener` now and on every change; starts loading (only when the
 * owner can moderate — otherwise the view stays off and nothing is asked).
 */
export const watchReview = (slug: string, listener: Listener) => {
  let set = listeners.get(slug);
  if (!set) {
    set = new Set();
    listeners.set(slug, set);
  }
  set.add(listener);
  listener(reviewNow(slug));
  start(slug);
  return () => set.delete(listener);
};

/* ---------- review bars ---------- */

export const barOf = (id: string) => bars.get(id) ?? IDLE_BAR;

const dispatch = (slug: string, id: string, event: BarEvent) => {
  bars.set(id, reduceBar(barOf(id), event));
  touch(slug);
};

/** Typing in a reply editor: kept silently, no re-render. */
export const setDraft = (id: string, draft: string) => {
  bars.set(id, reduceBar(barOf(id), { draft, type: "edit" }));
};

const boardOf = (slug: string): Board => {
  const view = reviewNow(slug);
  return {
    approved: threadNow(slug).approved,
    hidden: view.hidden,
    pending: view.pending,
  };
};

const existingReply = (slug: string, id: string) => {
  const { approved, pending, hidden } = boardOf(slug);
  return (
    [...approved, ...pending, ...hidden].find((item) => item.id === id)?.reply
      ?.body ?? ""
  );
};

const isBarAction = (action: string): action is BarAction =>
  BAR_ACTIONS.includes(action);

/** After a decision: which buttons to focus, in order of preference. */
const focusAfter = (id: string, next: NextState | null, status: string) => {
  if (next) {
    return ["rv-next-go", "rv-next-done"];
  }
  if (status === "rejected") {
    return [`${id}:restore`, "rv-hidden-summary"];
  }
  return [`${id}:reply-open`, `${id}:approve`];
};

type Sent = { ok: true; keys: string[] } | { ok: false; message: string };

/** POST /api/admin/decide and move the item; the elements to focus next. */
const decide = async (
  slug: string,
  id: string,
  request: DecideRequest,
  keepalive = false
): Promise<Sent> => {
  dispatch(slug, id, { type: "send" });
  const result = await adminJson<DecideResponse>("/api/admin/decide", {
    body: JSON.stringify({ id, type: "comment", ...request }),
    headers: { "content-type": "application/json" },
    keepalive,
    method: "POST",
  });
  if (!result.ok) {
    dispatch(slug, id, { message: result.message, type: "fail" });
    if (result.denied) {
      deny(slug);
    }
    return { message: result.message, ok: false };
  }
  const status = statusAfter(request.decision, result.data.status);
  const board = applyDecision(
    boardOf(slug),
    { id, reply: request.reply, status },
    Date.now()
  );
  const target = reviewTarget();
  const next: NextState | null =
    target?.type === "comment" && target.id === id
      ? {
          href: safeHref(result.data.next?.href),
          id,
          // A reply only leaves the status as it was: say 回复存好了.
          status: request.decision === "reply" ? null : status,
        }
      : reviewNow(slug).next;
  bars.delete(id);
  patchThread(slug, (thread) => ({
    ...thread,
    approved: board.approved,
    // The owner's own copy (localStorage) is settled on the next load.
    pending: status
      ? thread.pending.filter((item) => item.id !== id)
      : thread.pending,
  }));
  publish(slug, {
    ...reviewNow(slug),
    hidden: board.hidden,
    next,
    pending: board.pending,
  });
  return {
    keys: focusAfter(id, next?.id === id ? next : null, status ?? ""),
    ok: true,
  };
};

const send = async (slug: string, id: string, request: DecideRequest) => {
  const sent = await decide(slug, id, request);
  return sent.ok ? sent.keys : [];
};

/**
 * One button of a review bar or of the owner tools. Resolves with the
 * data-key of the element to focus next (first one found wins).
 */
export const act = async (
  slug: string,
  id: string,
  action: string
): Promise<string[]> => {
  const bar = barOf(id);
  if (bar.busy) {
    return [];
  }
  switch (action) {
    case "reply-open":
      dispatch(slug, id, {
        draft: existingReply(slug, id),
        type: "toggle-reply",
      });
      return barOf(id).mode === "reply"
        ? [`${id}:draft`]
        : [`${id}:reply-open`];
    case "cancel":
      dispatch(slug, id, { type: "cancel" });
      return [`${id}:reply-open`];
    default:
      break;
  }
  if (!isBarAction(action)) {
    return [];
  }
  const planned = requestFor(action, bar);
  if (!planned.ok) {
    dispatch(slug, id, { message: planned.message, type: "fail" });
    return [`${id}:draft`];
  }
  return await send(slug, id, planned.request);
};

/* ---------- the trash ---------- */

/** Thrown away and waiting for 撤销 to run out: not shown. */
export const isThrown = (id: string) => thrown.has(id);

const bumpThrown = (slug: string) =>
  publish(slug, { ...reviewNow(slug), thrown: reviewNow(slug).thrown + 1 });

export interface ThrowOptions {
  /** Keyboard: focus 撤销 afterwards. */
  focusUndo: boolean;
  /** Sent: the data-keys to focus when focus was left nowhere. */
  onSent: (keys: string[]) => void;
  /** 撤销: the card is shown again; put focus / a small press on it. */
  onUndo: (hadFocus: boolean) => void;
}

/**
 * The comment went into the trash: hide it, 已扔掉 · 撤销, then reject it
 * (pending → 拒绝, approved → 撤下, the same request as the old buttons).
 * False when it cannot be thrown now (a request for it is on its way).
 */
export const throwComment = (
  slug: string,
  id: string,
  options: ThrowOptions
) => {
  if (!reviewNow(slug).on || barOf(id).busy || thrown.has(id)) {
    return false;
  }
  thrown.add(id);
  bumpThrown(slug);
  hold(
    {
      commit: async (keepalive) => {
        const planned = requestFor("reject", barOf(id));
        const sent = planned.ok
          ? await decide(slug, id, planned.request, keepalive)
          : planned;
        thrown.delete(id);
        bumpThrown(slug);
        if (!sent.ok) {
          toast(`没扔掉：${sent.message}`, "", THROW_ERROR_MS, true);
          return;
        }
        options.onSent(sent.keys);
      },
      refocus: () => {
        // Not the toolbar: onSent puts focus back in the list once sent.
      },
      undo: (hadFocus) => {
        thrown.delete(id);
        bumpThrown(slug);
        options.onUndo(hadFocus);
      },
    },
    options.focusUndo
  );
  return true;
};

/* ---------- DOM helpers shared by the list and the popover ---------- */

/** Focus the first element of `root` with one of these data-keys. */
export const focusKey = (root: HTMLElement, keys: string[]) => {
  for (const key of keys) {
    const el = root.querySelector<HTMLElement>(
      `[data-key="${CSS.escape(key)}"]`
    );
    el?.focus({ preventScroll: false });
    // Inside a folded 已撤下 or a hidden slot the focus does not take.
    if (el && document.activeElement === el) {
      return el;
    }
  }
  return null;
};

/**
 * Re-render `root` without losing the owner's place: the focused element
 * (by data-key) and the caret in a reply editor come back afterwards.
 */
export const keepFocus = (root: HTMLElement, render: () => void) => {
  const active = document.activeElement;
  const key =
    active instanceof HTMLElement && root.contains(active)
      ? active.dataset.key
      : undefined;
  const caret =
    active instanceof HTMLTextAreaElement
      ? [active.selectionStart, active.selectionEnd]
      : null;
  render();
  if (!key) {
    return;
  }
  const again = root.querySelector<HTMLElement>(
    `[data-key="${CSS.escape(key)}"]`
  );
  if (!again || again === document.activeElement) {
    return;
  }
  again.focus({ preventScroll: true });
  if (caret && again instanceof HTMLTextAreaElement) {
    again.setSelectionRange(caret[0] ?? 0, caret[1] ?? 0);
  }
};

/** Clicks on review buttons inside `root` (list or popover). */
export const onReviewClick = (
  slug: string,
  root: HTMLElement,
  event: Event,
  /** Focused when none of the suggested elements is there (the popover). */
  fallback = ""
) => {
  const target = event.target instanceof Element ? event.target : null;
  const go = target?.closest<HTMLElement>("[data-rv-next]");
  const href = safeHref(go?.dataset.rvNext);
  if (href) {
    location.assign(href);
    return true;
  }
  const button = target?.closest<HTMLElement>("[data-rv-act]");
  const id = button?.closest<HTMLElement>("[data-rv]")?.dataset.rv;
  if (!(button && id)) {
    return false;
  }
  event.preventDefault();
  act(slug, id, button.dataset.rvAct ?? "").then((keys) => {
    if (!root.isConnected || keys.length === 0) {
      return;
    }
    if (!focusKey(root, keys) && fallback) {
      root.querySelector<HTMLElement>(fallback)?.focus({ preventScroll: true });
    }
  });
  return true;
};

/** Typing in a reply editor inside `root`. */
export const onReviewInput = (event: Event) => {
  const area = event.target;
  if (
    !(area instanceof HTMLTextAreaElement && area.dataset.rvDraft !== undefined)
  ) {
    return;
  }
  const id = area.closest<HTMLElement>("[data-rv]")?.dataset.rv;
  if (id) {
    setDraft(id, area.value);
  }
};

const SETTLE_FRAMES = 4;
const SETTLE_EPSILON_PX = 0.5;
const SETTLE_MAX_MS = 2000;

/** Wait for the fonts and for the drawer to stop sliding. */
export const settle = async (el: HTMLElement) => {
  await document.fonts?.ready.catch(() => {
    // No font loading API or it failed: go on with the fallback fonts.
  });
  const moving = el.closest<HTMLElement>("[data-drawer]") ?? el;
  await new Promise<void>((resolve) => {
    const began = performance.now();
    let last = Number.NaN;
    let still = 0;
    const tick = (now: number) => {
      const { left } = moving.getBoundingClientRect();
      still = Math.abs(left - last) < SETTLE_EPSILON_PX ? still + 1 : 0;
      last = left;
      if (still >= SETTLE_FRAMES || now - began > SETTLE_MAX_MS) {
        resolve();
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });
};

const PULSE_CLASS = "rv-pulse";

/** Outline pulse on the deep-linked element (just the outline when reduced). */
export const pulse = (el: HTMLElement) => {
  if (reduceMotion()) {
    return;
  }
  el.classList.remove(PULSE_CLASS);
  // Restart the animation when pulsed twice.
  el.getBoundingClientRect();
  el.classList.add(PULSE_CLASS);
  el.addEventListener("animationend", () => el.classList.remove(PULSE_CLASS), {
    once: true,
  });
};
