/**
 * D1 queries for the optional GitHub login: users (public GitHub profile;
 * `id` is a TEXT uuid, used by comments.user_id / stickers.user_id) and
 * sessions (id = sha256 of the `sid` token). Schema: migrations/0001_init.sql.
 *
 * Pure apart from the D1 handle passed in. No e-mail is ever stored.
 */
import type { GithubProfile } from "./github";
import type { PublicUser } from "./types";

type Db = D1Database;

/**
 * Creates or updates the user for a GitHub account (matched by the numeric
 * GitHub id; login, name and avatar can change) and returns users.id.
 */
export const upsertUser = async (
  db: Db,
  profile: GithubProfile,
  now: number
) => {
  const row = await db
    .prepare(
      `INSERT INTO users (id, github_id, login, name, avatar_url, html_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (github_id) DO UPDATE SET
         login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url,
         html_url = excluded.html_url, updated_at = excluded.updated_at
       RETURNING id`
    )
    .bind(
      crypto.randomUUID(),
      profile.githubId,
      profile.login,
      profile.name,
      profile.avatarUrl,
      profile.htmlUrl,
      now,
      now
    )
    .first<{ id: string }>();
  if (!row) {
    throw new Error("upsertUser: no id returned");
  }
  return row.id;
};

export type NewSession = {
  /** sha256 of the token (see auth.ts). */
  id: string;
  userId: string;
  now: number;
  expiresAt: number;
  /** The session this browser had before logging in again (fixation). */
  replaces: string | null;
};

/**
 * Stores a new session; in the same batch drops the browser's previous
 * session and this user's expired ones (keeps the table small without a cron).
 */
export const createSession = async (db: Db, session: NewSession) => {
  const statements = [
    db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?")
      .bind(session.userId, session.now),
    db
      .prepare(
        `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        session.id,
        session.userId,
        session.now,
        session.expiresAt,
        session.now
      ),
  ];
  if (session.replaces) {
    statements.unshift(
      db.prepare("DELETE FROM sessions WHERE id = ?").bind(session.replaces)
    );
  }
  await db.batch(statements);
};

export type SessionRow = {
  user_id: string;
  expires_at: number;
  last_seen_at: number;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
};

/** The session and its user, or null. Expiry is checked by the caller. */
export const findSession = (db: Db, id: string) =>
  db
    .prepare(
      `SELECT s.user_id, s.expires_at, s.last_seen_at,
         u.github_id, u.login, u.name, u.avatar_url, u.html_url
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .bind(id)
    .first<SessionRow>();

export const toPublicUser = (row: SessionRow): PublicUser => ({
  login: row.login,
  name: row.name,
  avatarUrl: row.avatar_url,
  htmlUrl: row.html_url,
});

/** Sliding expiry (at most once a day, see auth.ts sessionStatus). */
export const refreshSession = async (
  db: Db,
  id: string,
  now: number,
  expiresAt: number
) => {
  await db
    .prepare(
      "UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?"
    )
    .bind(expiresAt, now, id)
    .run();
};

export const deleteSession = async (db: Db, id: string) => {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
};
