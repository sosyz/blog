/**
 * Pure decisions shared by the visitor endpoints (/api/comments,
 * /api/stickers and PATCH /api/stickers/:id) for anonymous visitors and
 * logged-in GitHub users. Unit-tested in tests/visitor.test.ts; the routes
 * import env-bound modules and cannot be loaded by `bun test`.
 */
import type { MoveVia } from "./sticker-move";
import type { PublicUser } from "./types";

/* ---------- caching of GET /api/comments and GET /api/stickers ---------- */

export interface CacheInput {
  /** `me=1` was sent (the page thinks it is logged in). */
  me: boolean;
  /** `mine=` ids were sent (the visitor's own items). */
  mine: boolean;
  /** A valid GitHub session came with the request. */
  session: boolean;
}

/**
 * Only the plain anonymous list may be kept by shared caches; anything that
 * depends on who asks is private. `Vary: Cookie` always, so a browser never
 * reuses an answer given for another login state.
 */
export const listCacheHeaders = (
  input: CacheInput,
  publicValue: string
): Record<string, string> => ({
  "cache-control":
    input.mine || input.me || input.session ? "private, no-store" : publicValue,
  vary: "Cookie",
});

/* ---------- who wrote a comment ---------- */

export interface FormAuthor {
  email?: string;
  name?: string;
  site?: string;
}

export interface CommentAuthorFields {
  /** Raw e-mail to hash (anonymous form only); never stored as is. */
  email: string | null;
  name: string;
  site: string | null;
}

/**
 * Logged in: the GitHub account is the author (its name, else its login, and
 * the profile URL); whatever the form sent for name, site or e-mail is
 * ignored. Otherwise the nickname form.
 */
export const commentAuthor = (
  user: PublicUser | null,
  form: FormAuthor
): CommentAuthorFields => {
  if (user) {
    return { email: null, name: user.name || user.login, site: user.htmlUrl };
  }
  return {
    email: form.email || null,
    name: form.name ?? "",
    site: form.site || null,
  };
};

/**
 * Turnstile is needed unless a valid GitHub session came with the request
 * (same-origin POST, SameSite=Lax cookie): the login already proves a human.
 */
export const needsTurnstile = (session: boolean) => !session;

/* ---------- who moved a sticker ---------- */

/**
 * moderation_log actor and note label for a visitor move, so the admin page
 * can tell who moved it: the edit token (the uploader's browser), the
 * uploader's GitHub account, or the owner.
 */
export const moveActor = (via: MoveVia, login: string | undefined) => {
  const who = login ?? "?";
  if (via === "account") {
    return { actor: `user:${who}`, label: `GitHub @${who}` };
  }
  if (via === "owner") {
    return { actor: `owner:github:${who}`, label: "博主整理贴纸" };
  }
  // Not reached from PATCH /api/stickers/:id (Access admins use their own route).
  if (via === "admin") {
    return { actor: "admin", label: "博主整理贴纸" };
  }
  return { actor: "visitor:owner", label: "编辑口令" };
};
