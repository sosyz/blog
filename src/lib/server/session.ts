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

export type Viewer = {
  /** sessions.id (sha256 of the token). */
  sessionId: string;
  /** The raw token from the cookie, to re-send it when the session slides. */
  token: string;
  /** users.id (TEXT uuid; comments.user_id / stickers.user_id). */
  userId: string;
  githubId: number;
  user: PublicUser;
  isOwner: boolean;
  /** True when the expiry should be extended (at most daily). */
  stale: boolean;
};

export type ViewerLookup = {
  viewer: Viewer | null;
  /** A `sid` cookie was sent but is unknown or expired: clear it. */
  clearCookie: boolean;
};

export const resolveViewer = async (
  db: D1Database,
  cookieHeader: string | null,
  ownerId: number | null,
  now: number
): Promise<ViewerLookup> => {
  const token = readSessionToken(cookieHeader);
  if (!token) {
    return {
      viewer: null,
      clearCookie: readCookie(cookieHeader, SESSION_COOKIE) !== undefined,
    };
  }
  const sessionId = await hashSessionToken(token);
  const row = await findSession(db, sessionId);
  const status = row ? sessionStatus(row, now) : "expired";
  if (!row || status === "expired") {
    return { viewer: null, clearCookie: true };
  }
  return {
    viewer: {
      sessionId,
      token,
      userId: row.user_id,
      githubId: row.github_id,
      user: toPublicUser(row),
      isOwner: isOwnerId(row.github_id, ownerId),
      stale: status === "stale",
    },
    clearCookie: false,
  };
};
