/**
 * Optional GitHub login: the pure parts (tokens, cookies, the OAuth state,
 * the `next` redirect, owner and dev-login checks). Unit-tested in
 * tests/auth.test.ts. The routes live in src/pages/api/auth/; the GitHub HTTP
 * calls are in github.ts, the session lookup in session.ts (and getSession
 * below for the API routes), the users / sessions queries in users.ts.
 *
 * Sessions: the `sid` cookie holds a 256-bit random token; the database keeps
 * only sha256(token) as the session id, so a leaked table does not hand out
 * live sessions. 30 days, refreshed at most once a day by GET /api/auth/me.
 */
import { isLocalRequest } from "./access";
import { sameDigest } from "./edit-token";
import { readCookie, sha256Hex } from "./http";
import { DAY } from "./rate-limit";

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;
export const SESSION_TTL = SESSION_DAYS * DAY;
/** Sliding expiry: extend (one D1 write) at most this often per session. */
export const REFRESH_AFTER = DAY;
/** base64url of 32 random bytes. */
export const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const STATE_COOKIE = "gh_oauth";
/** Only sent to the login and callback routes. */
export const STATE_PATH = "/api/auth/github";
/** Ten minutes to finish logging in on GitHub. */
export const STATE_MAX_AGE = 600;

const MS_PER_SECOND = 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/* ---------- cookies ---------- */

export type CookieOptions = {
  /** Seconds; 0 deletes the cookie. */
  maxAge: number;
  path: string;
  secure: boolean;
};

/**
 * A Set-Cookie value: always HttpOnly and SameSite=Lax (sent on top-level
 * GET navigations such as the OAuth callback, not on cross-site POSTs).
 */
export const buildCookie = (
  name: string,
  value: string,
  { maxAge, path, secure }: CookieOptions
) =>
  [
    `${name}=${value}`,
    `Path=${path}`,
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Lax",
  ]
    .filter(Boolean)
    .join("; ");

/**
 * Cookies are Secure everywhere except plain http on localhost (browsers
 * drop Secure cookies set over http, which would break local testing).
 */
export const secureCookies = (url: URL) =>
  !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));

export const sessionCookie = (token: string, secure: boolean) =>
  buildCookie(SESSION_COOKIE, token, {
    maxAge: SESSION_TTL / MS_PER_SECOND,
    path: "/",
    secure,
  });

export const clearSessionCookie = (secure: boolean) =>
  buildCookie(SESSION_COOKIE, "", { maxAge: 0, path: "/", secure });

/* ---------- sessions ---------- */

/** The session token from the Cookie header, if it is well formed. */
export const readSessionToken = (cookieHeader: string | null) => {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  return token && SESSION_TOKEN.test(token) ? token : null;
};

/** The session id stored in D1: sha256 of the token, hex. */
export const hashSessionToken = (token: string) => sha256Hex(token);

export type SessionTimes = { expires_at: number; last_seen_at: number };

/**
 * `expired`: log out. `stale`: still valid, extend it (and re-send the
 * cookie). `fresh`: nothing to write.
 */
export const sessionStatus = (row: SessionTimes, now: number) => {
  if (row.expires_at <= now) {
    return "expired" as const;
  }
  if (now - row.last_seen_at >= REFRESH_AFTER) {
    return "stale" as const;
  }
  return "fresh" as const;
};

/* ---------- where to go after logging in ---------- */

const MAX_NEXT = 512;
const BASE = "https://next.invalid";
const FIRST_PRINTABLE = 32;
const DELETE = 127;

/** Control characters or a backslash (browsers treat "\\" like "/"). */
const hasControlOrBackslash = (value: string) => {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < FIRST_PRINTABLE || code === DELETE || char === "\\") {
      return true;
    }
  }
  return false;
};

/**
 * `next` only when it is a path on this site (no scheme, no `//host`, no
 * backslashes or control characters, not an API route); otherwise "/". This
 * keeps the login from being an open redirect.
 */
export const safeNext = (next: unknown) => {
  if (
    typeof next !== "string" ||
    next.length === 0 ||
    next.length > MAX_NEXT ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    hasControlOrBackslash(next)
  ) {
    return "/";
  }
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE || url.pathname.startsWith("/api/")) {
    return "/";
  }
  return `${url.pathname}${url.search}${url.hash}`;
};

/* ---------- OAuth state ---------- */

/**
 * The state cookie holds the random state and where to go afterwards:
 * `<state>.<encodeURIComponent(next)>`. base64url never contains ".".
 */
export const encodeState = (state: string, next: string) =>
  `${state}.${encodeURIComponent(safeNext(next))}`;

export const stateCookie = (value: string, secure: boolean) =>
  buildCookie(STATE_COOKIE, value, {
    maxAge: STATE_MAX_AGE,
    path: STATE_PATH,
    secure,
  });

export const clearStateCookie = (secure: boolean) =>
  buildCookie(STATE_COOKIE, "", { maxAge: 0, path: STATE_PATH, secure });

export type StateCheck = { ok: true; next: string } | { ok: false };

/**
 * Compares the `state` GitHub sent back with the one in our cookie (constant
 * time). `next` is taken from the cookie only, never from the callback URL.
 */
export const checkState = (
  cookieValue: string | undefined,
  returned: string | null
): StateCheck => {
  if (!(cookieValue && returned && SESSION_TOKEN.test(returned))) {
    return { ok: false };
  }
  const dot = cookieValue.indexOf(".");
  const state = dot === -1 ? cookieValue : cookieValue.slice(0, dot);
  if (!sameDigest(state, returned)) {
    return { ok: false };
  }
  let next = "/";
  try {
    next = safeNext(decodeURIComponent(cookieValue.slice(dot + 1)));
  } catch {
    next = "/";
  }
  return { ok: true, next: dot === -1 ? "/" : next };
};

export const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const CALLBACK_PATH = "/api/auth/github/callback";

export const callbackUrl = (origin: string) => `${origin}${CALLBACK_PATH}`;

/** GitHub's consent page. `read:user` is enough for the public profile. */
export const authorizeUrl = (options: {
  clientId: string;
  redirectUri: string;
  state: string;
}) => {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", options.state);
  url.searchParams.set("allow_signup", "true");
  return url.toString();
};

/* ---------- configuration, owner, dev login ---------- */

export type AuthConfig = {
  clientId: string;
  clientSecret: string;
  /** Numeric GitHub id of the blog owner (OWNER_GITHUB_ID), or null. */
  ownerId: number | null;
  /** AUTH_DEV_LOGIN=1 or ADMIN_DEV_BYPASS=1 (still localhost only). */
  devLogin: boolean;
};

const NUMERIC_ID = /^\d{1,15}$/;

/** OWNER_GITHUB_ID → number; empty or not a number → null (nobody is owner). */
export const ownerIdOf = (value: string | undefined) => {
  const trimmed = value?.trim() ?? "";
  if (!NUMERIC_ID.test(trimmed)) {
    return null;
  }
  const id = Number.parseInt(trimmed, 10);
  return id > 0 ? id : null;
};

/** The owner is recognised by the numeric GitHub id, never by login. */
export const isOwnerId = (githubId: number, ownerId: number | null) =>
  ownerId !== null && githubId === ownerId;

/** What the login routes answer (503) when the OAuth App is not set up. */
export const NOT_CONFIGURED =
  "GitHub 登录还没配置好（GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET），先填昵称留言吧。";

export const githubConfigured = (config: AuthConfig) =>
  Boolean(config.clientId && config.clientSecret);

/**
 * The fake login for local testing works only when a dev flag is set AND the
 * request is for localhost / 127.0.0.1, like the admin dev bypass.
 */
export const devLoginAllowed = (request: Request, config: AuthConfig) =>
  config.devLogin && isLocalRequest(request);

/** Which login the pages should offer: GitHub, the local dev login, or none. */
export const loginMethod = (request: Request, config: AuthConfig) => {
  if (githubConfigured(config)) {
    return "github" as const;
  }
  if (devLoginAllowed(request, config)) {
    return "dev" as const;
  }
  return null;
};

/* ---------- the session of a request (for the API routes) ---------- */

/**
 * The logged-in GitHub user. `id` is users.id, a TEXT uuid (the value stored
 * in comments.user_id / stickers.user_id); `githubId` is GitHub's number.
 */
export type SessionUser = {
  id: string;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
};

export type Session = { user: SessionUser; isOwner: boolean };

/**
 * Reads the `sid` cookie, validates it against D1, returns null when
 * absent/expired/invalid. Never throws for bad input. Read-only: extending
 * the session is left to GET /api/auth/me.
 *
 * env.ts (Worker bindings) is imported lazily so the rest of this module
 * stays pure and unit-testable.
 */
export const getSession = async (request: Request): Promise<Session | null> => {
  const { viewerOf } = await import("./env");
  const { viewer } = await viewerOf(request);
  if (!viewer) {
    return null;
  }
  return {
    user: {
      id: viewer.userId,
      githubId: viewer.githubId,
      login: viewer.user.login,
      name: viewer.user.name,
      avatarUrl: viewer.user.avatarUrl,
      htmlUrl: viewer.user.htmlUrl,
    },
    isOwner: viewer.isOwner,
  };
};
