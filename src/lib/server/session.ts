/**
 * Who is asking: the logged-in GitHub user behind the `sid` cookie, if any.
 * Reads one row (sessions JOIN users); writes nothing. Refreshing the expiry
 * is left to GET /api/auth/me so ordinary requests stay read-only.
 *
 * Pure apart from the D1 handle passed in (unit-testable with a fake).
 */
import {
  hashSessionToken,
  isOwnerId,
  readSessionToken,
  SESSION_COOKIE,
  sessionStatus,
} from "./auth";
import { readCookie } from "./http";
import type { PublicUser } from "./types";
import { findSession, toPublicUser } from "./users";

export interface Viewer {
  githubId: number;
  isOwner: boolean;
  /** sessions.id (sha256 of the token). */
  sessionId: string;
  /** True when the expiry should be extended (at most daily). */
  stale: boolean;
  /** The raw token from the cookie, to re-send it when the session slides. */
  token: string;
  user: PublicUser;
  /** users.id (TEXT uuid; comments.user_id / stickers.user_id). */
  userId: string;
}

export interface ViewerLookup {
  /** A `sid` cookie was sent but is unknown or expired: clear it. */
  clearCookie: boolean;
  viewer: Viewer | null;
}

export const resolveViewer = async (
  db: D1Database,
  cookieHeader: string | null,
  ownerId: number | null,
  now: number
): Promise<ViewerLookup> => {
  const token = readSessionToken(cookieHeader);
  if (!token) {
    return {
      clearCookie: readCookie(cookieHeader, SESSION_COOKIE) !== undefined,
      viewer: null,
    };
  }
  const sessionId = await hashSessionToken(token);
  const row = await findSession(db, sessionId);
  const status = row ? sessionStatus(row, now) : "expired";
  if (!row || status === "expired") {
    return { clearCookie: true, viewer: null };
  }
  return {
    clearCookie: false,
    viewer: {
      githubId: row.github_id,
      isOwner: isOwnerId(row.github_id, ownerId),
      sessionId,
      stale: status === "stale",
      token,
      user: toPublicUser(row),
      userId: row.user_id,
    },
  };
};
