/**
 * The last step of logging in, shared by the GitHub callback and the local
 * dev login: store the profile, start a fresh session (a new token every
 * time, so a session id planted before login is useless), drop the browser's
 * previous session, set the `sid` cookie and go back to `next`.
 *
 * Pure apart from the D1 handle passed in.
 */
import {
  clearStateCookie,
  hashSessionToken,
  readSessionToken,
  SESSION_TTL,
  safeNext,
  secureCookies,
  sessionCookie,
} from "./auth";
import type { GithubProfile } from "./github";
import { randomToken, redirectWithCookies } from "./http";
import { createSession, upsertUser } from "./users";

export const finishLogin = async (
  db: D1Database,
  options: {
    request: Request;
    profile: GithubProfile;
    next: string;
    now: number;
  }
) => {
  const { request, profile, now } = options;
  const userId = await upsertUser(db, profile, now);
  const token = randomToken();
  const previous = readSessionToken(request.headers.get("cookie"));
  await createSession(db, {
    expiresAt: now + SESSION_TTL,
    id: await hashSessionToken(token),
    now,
    replaces: previous ? await hashSessionToken(previous) : null,
    userId,
  });
  const secure = secureCookies(new URL(request.url));
  return redirectWithCookies(safeNext(options.next), [
    sessionCookie(token, secure),
    clearStateCookie(secure),
  ]);
};
