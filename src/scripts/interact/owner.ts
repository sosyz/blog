/**
 * Is this browser the site owner, and can it moderate right here on the page?
 *
 * - `canModerate()`: the Cloudflare Access session is present (GET
 *   /api/admin/whoami answers 200). Moderation actions go through
 *   /api/admin/*, which only Access can open, so this is what gates the
 *   in-page review tools. Only browsers that opened /admin/ (which sets the
 *   `interact:owner` flag) or arrive through a review link (`?review=…`) ever
 *   ask, so ordinary visitors never make the request.
 * - `isGithubOwner()`: logged in with GitHub as OWNER_GITHUB_ID (can move
 *   stickers via 整理贴纸, but moderation still needs Access).
 *
 * `reviewTarget()` parses the deep link /admin/ builds:
 *   comments / inline comments → /notes/<slug>/?review=c:<id>#comments
 *   stickers                   → /?review=s:<id>
 */
import { getAuth } from "./auth";

/** Set by /admin/ when the owner opened it successfully in this browser. */
export const OWNER_FLAG = "interact:owner";
const OK = 200;

export type ReviewTarget = { type: "comment" | "sticker"; id: string };

const REVIEW_PARAM = "review";
const REVIEW_PATTERN = /^(c|s):([A-Za-z0-9-]{1,64})$/;

/** Pure: parse a `review` query value such as "c:<id>" or "s:<id>". */
export const parseReview = (value: string | null): ReviewTarget | null => {
  const match = value ? REVIEW_PATTERN.exec(value) : null;
  if (!match) {
    return null;
  }
  return { type: match[1] === "c" ? "comment" : "sticker", id: match[2] ?? "" };
};

/** Pure: the query string value for a deep link. */
export const reviewValue = (target: ReviewTarget) =>
  `${target.type === "comment" ? "c" : "s"}:${target.id}`;

export const reviewTarget = (): ReviewTarget | null =>
  parseReview(new URL(location.href).searchParams.get(REVIEW_PARAM));

export const hasOwnerFlag = () => {
  try {
    return localStorage.getItem(OWNER_FLAG) === "1";
  } catch {
    return false;
  }
};

export const setOwnerFlag = () => {
  try {
    localStorage.setItem(OWNER_FLAG, "1");
  } catch {
    // Storage blocked: review links still work through ?review=.
  }
};

export const clearOwnerFlag = () => {
  try {
    localStorage.removeItem(OWNER_FLAG);
  } catch {
    // Nothing to clear.
  }
};

let moderateCheck: Promise<boolean> | null = null;

const askServer = async () => {
  try {
    const response = await fetch("/api/admin/whoami", {
      redirect: "manual",
      credentials: "same-origin",
      cache: "no-store",
    });
    await response.text().catch(() => "");
    if (response.status === OK) {
      setOwnerFlag();
      return true;
    }
  } catch {
    // Offline: ask again on the next full page load.
    return false;
  }
  clearOwnerFlag();
  return false;
};

/** Access session present → the in-page review tools can be shown. */
export const canModerate = () => {
  if (!moderateCheck) {
    moderateCheck =
      hasOwnerFlag() || reviewTarget() ? askServer() : Promise.resolve(false);
  }
  return moderateCheck;
};

/** Forget the cached answer (e.g. after an action returned 401/403). */
export const resetModerate = () => {
  moderateCheck = null;
};

export const isGithubOwner = async () => (await getAuth()).isOwner === true;
