/**
 * Built-in stickers the owner threw into the trash (hidden_builtins,
 * migrations/0001_init.sql). GET /api/stickers lists the keys so
 * every visitor's canvas hides them; POST /api/builtins hides or restores
 * one; /admin/ lists them with 恢复.
 *
 * Pure apart from the D1 handle passed in (tests/hidden-builtins.test.ts).
 */
import type { AdminCheck } from "./access";
import { STATUS } from "./http";

type Db = D1Database;

/** More than the canvas has; keeps a runaway table from growing the list. */
const MAX_HIDDEN = 200;

export interface HiddenBuiltinRow {
  hidden_at: number;
  hidden_by: string;
  key: string;
}

/** The rows, newest first (/admin/). */
export const listHiddenBuiltinRows = async (db: Db) => {
  const { results } = await db
    .prepare(
      `SELECT key, hidden_at, hidden_by FROM hidden_builtins
       ORDER BY hidden_at DESC, key LIMIT ?`
    )
    .bind(MAX_HIDDEN)
    .all<HiddenBuiltinRow>();
  return results;
};

/** Keys of the hidden built-ins. */
export const listHiddenBuiltins = async (db: Db) =>
  (await listHiddenBuiltinRows(db)).map((row) => row.key);

export interface BuiltinChange {
  /** 'admin:<email>' or 'owner:github:<login>'. */
  by: string;
  hidden: boolean;
  key: string;
  now: number;
}

/**
 * Hides (a row) or restores (no row) a built-in. Idempotent: hiding one that
 * is already hidden keeps the first hidden_at / hidden_by; restoring one that
 * is not hidden does nothing. `changed` says whether a row was written.
 */
export const setBuiltinHidden = async (
  db: Db,
  { key, hidden, by, now }: BuiltinChange
) => {
  const statement = hidden
    ? db
        .prepare(
          `INSERT INTO hidden_builtins (key, hidden_at, hidden_by)
           VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`
        )
        .bind(key, now, by)
    : db.prepare("DELETE FROM hidden_builtins WHERE key = ?").bind(key);
  const result = await statement.run();
  return { changed: (result.meta.changes ?? 0) > 0 };
};

/* ---------- who may hide or restore ---------- */

export type BuiltinEditor =
  | { ok: true; actor: string }
  | { ok: false; status: number; message: string };

const NOT_OWNER = "只有博主能收起或放回自带贴纸。";

/**
 * The owner, by either door: a Cloudflare Access login (or the localhost
 * dev bypass) → 'admin:<email>'; the owner's GitHub session
 * (OWNER_GITHUB_ID) → 'owner:github:<login>'. Anyone else: 403 when they
 * are someone (a GitHub session, or an Access token that failed), else 401.
 */
export const builtinEditor = (
  admin: AdminCheck,
  session: { isOwner: boolean; login: string } | null
): BuiltinEditor => {
  if (admin.ok) {
    return { actor: `admin:${admin.email}`, ok: true };
  }
  if (session?.isOwner) {
    return { actor: `owner:github:${session.login}`, ok: true };
  }
  const someone = session !== null || admin.status === STATUS.forbidden;
  return {
    message: NOT_OWNER,
    ok: false,
    status: someone ? STATUS.forbidden : STATUS.unauthorized,
  };
};
