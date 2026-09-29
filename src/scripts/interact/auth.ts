/**
 * The optional GitHub login on the client: who is logged in (GET
 * /api/auth/me, asked once per full page load; the module outlives
 * ClientRouter navigations), subscribe() for the forms and the toolbar,
 * the login link, logging out in place, and the small bar the forms show
 * above their fields (comment form, inline-comment popover, sticker
 * placement panel).
 *
 * Logged out (and a login is offered, `enabled`), the forms show
 * 「用 GitHub 登录」 and 「或者直接填昵称」; logged in, they hide the name / site
 * fields and the Turnstile status line (the session stands in for it) and
 * say 以 <login> 的身份留言 · 退出. When /me fails or the login is not
 * configured, no login UI is shown at all and everything works as before.
 */
import type { MeResponse, PublicUser } from "@/lib/server/types";
import { esc, requestJson } from "./util";

export type AuthState = MeResponse;

export const ANONYMOUS: AuthState = {
  enabled: false,
  user: null,
  isOwner: false,
  login: null,
};

type Listener = (state: AuthState) => void;

let pending: Promise<AuthState> | null = null;
let known: AuthState | null = null;
const listeners = new Set<Listener>();

const fetchMe = () =>
  requestJson<MeResponse>("/api/auth/me", {
    credentials: "same-origin",
    cache: "no-store",
  }).then((result) => (result.ok ? result.data : ANONYMOUS));

const publish = (state: AuthState) => {
  known = state;
  for (const listener of listeners) {
    listener(state);
  }
  return state;
};

/** The login state (one request per full page load). */
export const getAuth = () => {
  pending ??= fetchMe().then(publish);
  return pending;
};

/** What is known right now without waiting (null before /me answered). */
export const authNow = () => known;

/** Asks /me again and tells every subscriber (after logging out). */
export const refreshAuth = () => {
  pending = fetchMe().then(publish);
  return pending;
};

/**
 * Calls `listener` with the state once it is known (right away when it
 * already is) and again whenever it changes. Returns the unsubscribe.
 */
export const subscribe = (listener: Listener) => {
  listeners.add(listener);
  if (known) {
    listener(known);
  } else {
    getAuth();
  }
  return () => {
    listeners.delete(listener);
  };
};

/** The page to come back to after logging in: path + query + `hash`. */
export const nextPath = (
  where: { pathname: string; search?: string },
  hash = ""
) => `${where.pathname}${where.search ?? ""}${hash}`;

/** nextPath() for the current page (`hash` e.g. "#comments"). */
export const currentPath = (hash = window.location.hash) =>
  nextPath(window.location, hash);

/**
 * Where 「用 GitHub 登录」 goes. On localhost without an OAuth App the server
 * offers its dev login instead (`login: "dev"`).
 */
export const loginHref = (state: Pick<AuthState, "login">, next: string) => {
  const route =
    state.login === "dev" ? "/api/auth/dev-login" : "/api/auth/github/login";
  return `${route}?next=${encodeURIComponent(next)}`;
};

/**
 * Ends this browser's session (POST /api/auth/logout answers 204, no body),
 * then refreshes the state and every subscriber (no reload). Resolves to
 * whether the server confirmed it.
 */
export const logout = async () => {
  const done = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  }).then(
    (response) => response.ok,
    () => false
  );
  await refreshAuth();
  return done;
};

/**
 * GitHub avatar at a given pixel size: sets the `s` query parameter the
 * avatar CDN reads (`?s=64` or `&s=64`, replacing one that is there).
 */
export const avatarSrc = (url: string, size: number) => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("s", String(size));
    return parsed.toString();
  } catch {
    return url;
  }
};

/** The GitHub mark (Octicons, MIT); `id` names its <title>. */
export const githubMarkSvg = (id: string) =>
  `<svg class="gh-mark" viewBox="0 0 16 16" width="16" height="16" role="img" aria-labelledby="${id}"><title id="${id}">GitHub</title><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

/** Unique ids for the mark's <title> when several bars are on one page. */
let markCount = 0;

/** Avatar size requested from GitHub for the 24px bar avatar (2× screens). */
const BAR_AVATAR_PX = 64;

/** A profile link to GitHub (user-supplied content: nofollow ugc). */
export const profileLinkHtml = (user: PublicUser, text = user.login) =>
  `<a href="${esc(user.htmlUrl)}" rel="nofollow ugc noopener" target="_blank">${esc(text)}</a>`;

/**
 * The bar above a form's fields. `verb` completes 以 <login> 的身份<verb>
 * (留言 / 贴贴纸). Returns "" when nobody is logged in and no login is
 * offered.
 */
export const authBarHtml = (
  state: AuthState,
  { next, verb }: { next: string; verb: string }
) => {
  const { user } = state;
  if (user) {
    return `<p class="auth-bar is-in">
      <img class="auth-av" src="${esc(avatarSrc(user.avatarUrl, BAR_AVATAR_PX))}" alt="" width="24" height="24" loading="lazy" referrerpolicy="no-referrer" />
      <span>以 ${profileLinkHtml(user)} 的身份${esc(verb)}</span>
      <span aria-hidden="true">·</span>
      <button type="button" class="auth-out" data-auth-logout>退出</button>
    </p>`;
  }
  if (!state.enabled) {
    return "";
  }
  markCount += 1;
  return `<p class="auth-bar">
      <a class="auth-in" href="${esc(loginHref(state, next))}" data-auth-login>${githubMarkSvg(`gh-mark-${markCount}`)}<span>用 GitHub 登录</span></a>
      <span class="auth-or">或者直接填昵称</span>
    </p>`;
};

/** The line that replaces the Turnstile status when logged in. */
export const SKIP_TURNSTILE_HTML =
  '<p class="auth-skip">已登录，不用人机验证</p>';

/**
 * Wires 退出 buttons inside `root` (once per element). The subscribers
 * re-render after the state changes; `onDone` runs after that (e.g. to put
 * focus back somewhere that still exists).
 */
export const bindLogout = (root: HTMLElement, onDone?: () => void) => {
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    "[data-auth-logout]:not([data-ready])"
  )) {
    button.dataset.ready = "";
    button.addEventListener("click", async () => {
      button.disabled = true;
      await logout();
      button.disabled = false;
      onDone?.();
    });
  }
};
