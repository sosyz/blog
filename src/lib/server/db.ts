/**
 * D1 queries. Public reads select explicit columns and never return
 * email_hash, ip_hash or ua.
 */
import { isOwnerId } from "./auth";
import type { Decision } from "./moderation";
import type { LimitWindow } from "./rate-limit";
import type { Placement } from "./sticker-limits";
import type {
  AdminComment,
  AdminCommentsResponse,
  AdminDecision,
  AdminSticker,
  Anchor,
  CommentKind,
  ItemStatus,
  PublicComment,
  PublicSticker,
  PublicUser,
  ReviewLink,
} from "./types";

type Db = D1Database;

const MAX_COMMENTS_PER_NOTE = 500;
const MAX_STICKERS = 300;
const QUEUE_LIMIT = 200;
const RECENT_LIMIT = 30;
/** Rejected comments per note the owner can still restore. */
const HIDDEN_LIMIT = 50;
/** Characters of ip_hash shown to the owner to spot repeat visitors. */
const FINGERPRINT_LENGTH = 8;
/** A logged-in visitor's own pending comments per note / stickers. */
const MAX_OWN_ITEMS = 50;

export interface CommentRow {
  anchor_exact: string | null;
  anchor_prefix: string | null;
  author_avatar: string | null;
  /** From users (LEFT JOIN): null for nickname comments. */
  author_github_id: number | null;
  author_html: string | null;
  author_login: string | null;
  author_name: string | null;
  body: string;
  created_at: number;
  id: string;
  kind: CommentKind;
  name: string;
  owner_reply: string | null;
  owner_reply_at: number | null;
  parent_id: string | null;
  site: string | null;
}

/** Public columns only; users has no e-mail and the IP hash is never read. */
const PUBLIC_COMMENT_COLUMNS = `c.id, c.kind, c.parent_id, c.name, c.site, c.body, c.anchor_exact,
  c.anchor_prefix, c.created_at, c.owner_reply, c.owner_reply_at,
  u.github_id AS author_github_id, u.login AS author_login, u.name AS author_name,
  u.avatar_url AS author_avatar, u.html_url AS author_html`;

const userOf = (row: CommentRow): PublicUser | null => {
  if (
    row.author_login === null ||
    row.author_avatar === null ||
    row.author_html === null
  ) {
    return null;
  }
  return {
    avatarUrl: row.author_avatar,
    htmlUrl: row.author_html,
    login: row.author_login,
    name: row.author_name,
  };
};

/**
 * A comment row as the public sees it. Written while logged in: the current
 * GitHub profile (name, else login; profile URL) replaces the stored name
 * and site, and `isOwner` marks the blog owner (OWNER_GITHUB_ID).
 */
export const toPublicComment = (
  row: CommentRow,
  ownerId: number | null
): PublicComment => {
  const user = userOf(row);
  return {
    anchor:
      row.anchor_exact === null
        ? null
        : { exact: row.anchor_exact, prefix: row.anchor_prefix ?? "" },
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    isOwner:
      user !== null &&
      row.author_github_id !== null &&
      isOwnerId(row.author_github_id, ownerId),
    kind: row.kind,
    name: user ? user.name || user.login : row.name,
    parentId: row.parent_id,
    reply:
      row.owner_reply === null
        ? null
        : { at: row.owner_reply_at ?? row.created_at, body: row.owner_reply },
    site: user ? user.htmlUrl : row.site,
    user,
  };
};

export const listApprovedComments = async (
  db: Db,
  slug: string,
  ownerId: number | null
) => {
  const { results } = await db
    .prepare(
      `SELECT ${PUBLIC_COMMENT_COLUMNS}
       FROM comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.slug = ? AND c.status = 'approved'
       ORDER BY c.created_at ASC LIMIT ?`
    )
    .bind(slug, MAX_COMMENTS_PER_NOTE)
    .all<CommentRow>();
  return results.map((row) => toPublicComment(row, ownerId));
};

/** A logged-in visitor's own comments on a note that still wait for review. */
export const listOwnPendingComments = async (
  db: Db,
  {
    slug,
    userId,
    ownerId,
  }: { slug: string; userId: string; ownerId: number | null }
) => {
  const { results } = await db
    .prepare(
      `SELECT ${PUBLIC_COMMENT_COLUMNS}
       FROM comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.user_id = ? AND c.slug = ? AND c.status = 'pending'
       ORDER BY c.created_at ASC LIMIT ?`
    )
    .bind(userId, slug, MAX_OWN_ITEMS)
    .all<CommentRow>();
  return results.map((row) => toPublicComment(row, ownerId));
};

const placeholders = (count: number) =>
  Array.from({ length: count }, () => "?").join(", ");

/** Statuses of the visitor's own items (by id); unknown ids are left out. */
export const statusesByIds = async (
  db: Db,
  table: "comments" | "stickers",
  ids: string[]
) => {
  const out: Record<string, ItemStatus> = {};
  if (ids.length === 0) {
    return out;
  }
  const { results } = await db
    .prepare(
      `SELECT id, status FROM ${table} WHERE id IN (${placeholders(ids.length)})`
    )
    .bind(...ids)
    .all<{ id: string; status: ItemStatus }>();
  for (const row of results) {
    out[row.id] = row.status;
  }
  return out;
};

export interface RecentQuery {
  day: number;
  /** Window lengths in ms. */
  hour: number;
  ipHash: string;
  now: number;
  table: "comments" | "stickers";
}

/** [last hour, last day] submissions from this visitor. */
export const recentCounts = async (
  db: Db,
  { table, ipHash, now, hour, day }: RecentQuery
) => {
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS hour,
         COUNT(*) AS day
       FROM ${table} WHERE ip_hash = ? AND created_at > ?`
    )
    .bind(now - hour, ipHash, now - day)
    .first<{ hour: number | null; day: number | null }>();
  return [row?.hour ?? 0, row?.day ?? 0] as const;
};

/** [last hour, last day] submissions from this account. */
export const recentCountsByUser = async (
  db: Db,
  {
    table,
    userId,
    now,
    hour,
    day,
  }: Omit<RecentQuery, "ipHash"> & { userId: string }
) => {
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS hour,
         COUNT(*) AS day
       FROM ${table} WHERE user_id = ? AND created_at > ?`
    )
    .bind(now - hour, userId, now - day)
    .first<{ hour: number | null; day: number | null }>();
  return [row?.hour ?? 0, row?.day ?? 0] as const;
};

/** True when the parent exists on the same note (reply target). */
export const parentExists = async (db: Db, slug: string, parentId: string) => {
  const row = await db
    .prepare("SELECT 1 AS ok FROM comments WHERE id = ? AND slug = ?")
    .bind(parentId, slug)
    .first<{ ok: number }>();
  return Boolean(row);
};

export interface NewComment {
  anchor: Anchor | null;
  body: string;
  createdAt: number;
  emailHash: string | null;
  id: string;
  ipHash: string;
  kind: CommentKind;
  name: string;
  parentId: string | null;
  site: string | null;
  slug: string;
  status: ItemStatus;
  ua: string | null;
  /** Logged-in author (users.id), or null for a nickname comment. */
  userId: string | null;
}

export interface LogEntry {
  actor: string;
  createdAt: number;
  decision: Decision | "reply" | "move";
  /** Visitor moves only: counted for the move rate limit. */
  ipHash?: string | null;
  itemId: string;
  itemType: "comment" | "sticker";
  note?: string | null;
}

const logValues = (entry: LogEntry) => [
  entry.itemType,
  entry.itemId,
  entry.decision,
  entry.actor,
  entry.note ?? null,
  entry.createdAt,
  entry.ipHash ?? null,
];

const LOG_COLUMNS =
  "INSERT INTO moderation_log (item_type, item_id, decision, actor, note, created_at, ip_hash)";

const logStatement = (db: Db, entry: LogEntry) =>
  db
    .prepare(`${LOG_COLUMNS} VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(...logValues(entry));

/** A SQL condition and the values its placeholders take. */
interface Condition {
  sql: string;
  values: unknown[];
}

/** The log row, written only when `when` holds (checked in the same statement). */
const logStatementWhen = (db: Db, entry: LogEntry, when: Condition) =>
  db
    .prepare(`${LOG_COLUMNS} SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${when.sql}`)
    .bind(...logValues(entry), ...when.values);

/**
 * One rate limit checked inside a write: the rows of `column` = `value` in
 * the table being limited (see LIMIT_SOURCES), against a window from
 * rate-limit.ts. Moves are only counted by ip_hash.
 */
export interface LimitKey {
  column: "ip_hash" | "user_id";
  value: string;
  window: LimitWindow;
}

/** Per IP always; per account too when logged in (both must hold). */
export const visitorLimits = (
  window: LimitWindow,
  { ipHash, userId }: { ipHash: string; userId: string | null }
): LimitKey[] => [
  { column: "ip_hash", value: ipHash, window },
  ...(userId === null
    ? []
    : [{ column: "user_id" as const, value: userId, window }]),
];

/** What each limit counts: every row, whatever its status (like recentCounts). */
const LIMIT_SOURCES = {
  comments: "comments WHERE",
  /** Visitor moves and tear-offs (like recentMoves). */
  moves: "moderation_log WHERE decision IN ('move', 'reject') AND",
  stickers: "stickers WHERE",
} as const;

/**
 * True while every key is under its limit (fewer rows than perHour in the
 * last hour and than perDay in the last day); always true without keys.
 * Used in the WHERE of the write itself, so parallel requests cannot all
 * pass a check made before any of them wrote.
 */
const underLimits = (
  source: keyof typeof LIMIT_SOURCES,
  keys: readonly LimitKey[]
): Condition => {
  const from = LIMIT_SOURCES[source];
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const { column, value, window } of keys) {
    parts.push(
      `(SELECT COUNT(*) FROM ${from} ${column} = ? AND created_at > ?) < ?`,
      `(SELECT COUNT(*) FROM ${from} ${column} = ? AND created_at > ?) < ?`
    );
    values.push(
      value,
      window.hourStart,
      window.perHour,
      value,
      window.dayStart,
      window.perDay
    );
  }
  return { sql: parts.length > 0 ? parts.join(" AND ") : "1", values };
};

const changed = (result: D1Result | undefined) =>
  (result?.meta.changes ?? 0) > 0;

/**
 * Inserts a comment and its log row in one batch, only while the visitor is
 * under `limits` (checked by the INSERT itself). False when over the limit:
 * nothing was written.
 */
export const insertComment = async (
  db: Db,
  row: NewComment,
  log: LogEntry,
  limits: readonly LimitKey[]
) => {
  const limit = underLimits("comments", limits);
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO comments (id, slug, parent_id, kind, anchor_exact, anchor_prefix, name,
           email_hash, site, body, status, created_at, decided_at, ip_hash, ua, user_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ${limit.sql}`
      )
      .bind(
        row.id,
        row.slug,
        row.parentId,
        row.kind,
        row.anchor?.exact ?? null,
        row.anchor?.prefix ?? null,
        row.name,
        row.emailHash,
        row.site,
        row.body,
        row.status,
        row.createdAt,
        row.status === "pending" ? null : row.createdAt,
        row.ipHash,
        row.ua,
        row.userId,
        ...limit.values
      ),
    logStatementWhen(db, log, {
      sql: "EXISTS (SELECT 1 FROM comments WHERE id = ?)",
      values: [row.id],
    }),
  ]);
  return changed(insert);
};

interface StickerRow {
  height: number;
  id: string;
  name: string | null;
  rotation: number;
  scale: number;
  width: number;
  x: number;
  y: number;
}

export const stickerImagePath = (id: string) => `/api/stickers/${id}/image`;

const toPublicSticker = (row: StickerRow): PublicSticker => ({
  ...row,
  src: stickerImagePath(row.id),
});

export const listApprovedStickers = async (db: Db) => {
  const { results } = await db
    .prepare(
      `SELECT id, x, y, rotation, scale, width, height, name FROM stickers
       WHERE status = 'approved' ORDER BY created_at ASC LIMIT ?`
    )
    .bind(MAX_STICKERS)
    .all<StickerRow>();
  return results.map(toPublicSticker);
};

export type NewSticker = StickerRow & {
  /** Salted hash of the edit token (see edit-token.ts); null when not kept. */
  editTokenHash: string | null;
  r2Key: string;
  mime: string;
  bytes: number;
  status: ItemStatus;
  createdAt: number;
  ipHash: string;
  /** Logged-in uploader (users.id), or null. */
  userId: string | null;
};

/**
 * Inserts a sticker row and its log row in one batch, only while the visitor
 * is under `limits` (checked by the INSERT itself). False when over the
 * limit: nothing was written. See sticker-store.ts for the R2 side.
 */
export const insertSticker = async (
  db: Db,
  row: NewSticker,
  log: LogEntry,
  limits: readonly LimitKey[]
) => {
  const limit = underLimits("stickers", limits);
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO stickers (id, r2_key, mime, width, height, bytes, x, y, rotation, scale,
           name, status, created_at, decided_at, ip_hash, edit_token_hash, user_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ${limit.sql}`
      )
      .bind(
        row.id,
        row.r2Key,
        row.mime,
        row.width,
        row.height,
        row.bytes,
        row.x,
        row.y,
        row.rotation,
        row.scale,
        row.name,
        row.status,
        row.createdAt,
        row.status === "pending" ? null : row.createdAt,
        row.ipHash,
        row.editTokenHash,
        row.userId,
        ...limit.values
      ),
    logStatementWhen(db, log, {
      sql: "EXISTS (SELECT 1 FROM stickers WHERE id = ?)",
      values: [row.id],
    }),
  ]);
  return changed(insert);
};

/**
 * After the image is in R2: gives a sticker inserted as 'pending' its
 * moderated status (only if it is still pending; decided_at as insertSticker
 * would set it) and returns its status now, null when the row is gone. The
 * caller deletes the image when it came back rejected or null.
 */
export const settleSticker = async (
  db: Db,
  id: string,
  status: ItemStatus,
  now: number
) => {
  const read = db.prepare("SELECT status FROM stickers WHERE id = ?").bind(id);
  const promote = db
    .prepare(
      "UPDATE stickers SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'"
    )
    .bind(status, now, id);
  const results = await db.batch<{ status: ItemStatus }>(
    status === "pending" ? [read] : [promote, read]
  );
  return results.at(-1)?.results.at(0)?.status ?? null;
};

/** Removes a sticker row and its log rows (its image never reached R2). */
export const discardSticker = async (db: Db, id: string) => {
  await db.batch([
    db.prepare("DELETE FROM stickers WHERE id = ?").bind(id),
    db
      .prepare(
        "DELETE FROM moderation_log WHERE item_type = 'sticker' AND item_id = ?"
      )
      .bind(id),
  ]);
};

/**
 * A logged-in visitor's own stickers that are not rejected: the pending ones
 * (shown to them with 审核中 on every device) and the ids of all of them
 * (they can move these).
 */
export const listOwnStickers = async (db: Db, userId: string) => {
  const { results } = await db
    .prepare(
      `SELECT id, x, y, rotation, scale, width, height, name, status FROM stickers
       WHERE user_id = ? AND status != 'rejected'
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(userId, MAX_OWN_ITEMS)
    .all<StickerRow & { status: ItemStatus }>();
  const statuses: Record<string, ItemStatus> = {};
  for (const row of results) {
    statuses[row.id] = row.status;
  }
  return {
    ids: results.map((row) => row.id),
    pending: results
      .filter((row) => row.status === "pending")
      .map(({ status: _status, ...row }) => toPublicSticker(row))
      .reverse(),
    statuses,
  };
};

export type StickerForMove = Placement & {
  status: ItemStatus;
  edit_token_hash: string | null;
  user_id: string | null;
};

export const getStickerForMove = (db: Db, id: string) =>
  db
    .prepare(
      "SELECT x, y, rotation, scale, status, edit_token_hash, user_id FROM stickers WHERE id = ?"
    )
    .bind(id)
    .first<StickerForMove>();

/** The columns DELETE /api/stickers/:id needs (see planDelete). */
export interface StickerForDelete {
  edit_token_hash: string | null;
  r2_key: string;
  status: ItemStatus;
  user_id: string | null;
}

export const getStickerForDelete = (db: Db, id: string) =>
  db
    .prepare(
      "SELECT r2_key, status, edit_token_hash, user_id FROM stickers WHERE id = ?"
    )
    .bind(id)
    .first<StickerForDelete>();

/**
 * Visitor moves and tear-offs from this ip_hash (for the move rate limit):
 * 'move' and 'reject' rows that carry an ip_hash. Uploads, admin decisions
 * and the owner's own edits leave ip_hash NULL and are not counted.
 */
export const recentMoves = async (
  db: Db,
  { ipHash, now, hour, day }: Omit<RecentQuery, "table">
) => {
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS hour,
         COUNT(*) AS day
       FROM moderation_log
       WHERE decision IN ('move', 'reject') AND ip_hash = ? AND created_at > ?`
    )
    .bind(now - hour, ipHash, now - day)
    .first<{ hour: number | null; day: number | null }>();
  return [row?.hour ?? 0, row?.day ?? 0] as const;
};

/**
 * The outcome of a limited write: `limited` when the visitor was at the
 * limit (nothing was written), else `changed` as for the unlimited write.
 */
export interface LimitedWrite {
  changed: boolean;
  limited: boolean;
}

/**
 * An UPDATE of a sticker plus its log row, both only while `limits` hold.
 * The UPDATE never touches moderation_log, so the same count condition gives
 * the same answer in both statements of the batch: both are written or
 * neither. The log row does not depend on the UPDATE (as before, it is still
 * written when the sticker was rejected in the meantime). Without limits
 * both are unconditional.
 */
const limitedStickerWrite = async (
  db: Db,
  update: Condition,
  log: LogEntry,
  limits: readonly LimitKey[]
): Promise<LimitedWrite> => {
  const limit = underLimits("moves", limits);
  const [row, logged] = await db.batch([
    db
      .prepare(`${update.sql} AND ${limit.sql}`)
      .bind(...update.values, ...limit.values),
    logStatementWhen(db, log, limit),
  ]);
  return { changed: changed(row), limited: !changed(logged) };
};

export interface LimitedMove {
  limits: readonly LimitKey[];
  log: LogEntry;
  to: Placement;
}

/**
 * Moves a sticker and logs it, in one batch (two writes). The status is
 * checked again in the UPDATE, so a sticker rejected in the meantime stays
 * where it was; `changed` is false then. A visitor's move passes the move
 * limit (moderation_log rows of their ip_hash, see recentMoves) as `limits`,
 * checked inside the same batch; the owner's and admin moves pass none.
 */
export const moveStickerWithinLimit = (
  db: Db,
  id: string,
  { to, log, limits }: LimitedMove
) =>
  limitedStickerWrite(
    db,
    {
      sql: `UPDATE stickers SET x = ?, y = ?, rotation = ?, scale = ?, updated_at = ?
         WHERE id = ? AND status != 'rejected'`,
      values: [to.x, to.y, to.rotation, to.scale, log.createdAt, id],
    },
    log,
    limits
  );

/** moveStickerWithinLimit without a limit; false when it was rejected. */
export const moveSticker = async (
  db: Db,
  id: string,
  to: Placement,
  log: LogEntry
) => (await moveStickerWithinLimit(db, id, { limits: [], log, to })).changed;

/**
 * Tears off a sticker (DELETE /api/stickers/:id): status 'rejected' and
 * decided_at, plus the log row, in one batch. Like an admin reject it cannot
 * come back; the caller deletes the R2 image. `changed` is false when it was
 * already rejected (the log row is still written in that race, as with
 * decide). `limits` as for moveStickerWithinLimit (tear-offs share the move
 * limit).
 */
export const tearOffStickerWithinLimit = (
  db: Db,
  id: string,
  { log, limits }: Omit<LimitedMove, "to">
) =>
  limitedStickerWrite(
    db,
    {
      sql: `UPDATE stickers SET status = 'rejected', decided_at = ?
         WHERE id = ? AND status != 'rejected'`,
      values: [log.createdAt, id],
    },
    log,
    limits
  );

/** tearOffStickerWithinLimit without a limit; false when already rejected. */
export const tearOffSticker = async (db: Db, id: string, log: LogEntry) =>
  (await tearOffStickerWithinLimit(db, id, { limits: [], log })).changed;

export const getStickerFile = (db: Db, id: string) =>
  db
    .prepare("SELECT r2_key, mime, status, user_id FROM stickers WHERE id = ?")
    .bind(id)
    .first<{
      r2_key: string;
      mime: string;
      status: ItemStatus;
      user_id: string | null;
    }>();

/* ---------- admin ---------- */

/** An item to review in place: a comment on its note, or a sticker. */
export type ReviewTarget =
  | { type: "comment"; id: string; slug: string }
  | { type: "sticker"; id: string };

/**
 * Where the owner reviews an item in place: comments (normal and inline) on
 * their note page, stickers on the canvas. Pure; slugs are [a-z0-9-] and ids
 * UUIDs, so nothing needs encoding.
 */
export const reviewHref = (target: ReviewTarget) =>
  target.type === "comment"
    ? `/notes/${target.slug}/?review=c:${target.id}#comments`
    : `/?review=s:${target.id}`;

export const reviewLink = (target: ReviewTarget): ReviewLink => ({
  href: reviewHref(target),
  id: target.id,
  type: target.type,
});

/** First characters of ip_hash, cut in SQL so the full hash never leaves D1. */
const fingerprintColumn = (column: string) =>
  `COALESCE(substr(${column}, 1, ${FINGERPRINT_LENGTH}), '') AS fingerprint`;

export type AdminCommentRow = CommentRow & {
  status: ItemStatus;
  fingerprint: string | null;
};

/**
 * A comment for in-place review: the public shape plus status and a short
 * fingerprint. Built field by field (via toPublicComment), so private
 * columns in the row (e-mail hash, IP hash, user agent) are never copied.
 */
export const toAdminComment = (
  row: AdminCommentRow,
  ownerId: number | null
): AdminComment => ({
  ...toPublicComment(row, ownerId),
  createdAt: row.created_at,
  fingerprint: (row.fingerprint ?? "").slice(0, FINGERPRINT_LENGTH),
  status: row.status,
});

const ADMIN_COMMENT_SELECT = `SELECT ${PUBLIC_COMMENT_COLUMNS}, c.status, ${fingerprintColumn("c.ip_hash")}
  FROM comments c LEFT JOIN users u ON u.id = c.user_id`;

/**
 * GET /api/admin/comments?slug=: the note's pending comments (oldest first)
 * and its rejected ones (newest first, to restore).
 */
export const listAdminComments = async (
  db: Db,
  slug: string,
  ownerId: number | null
): Promise<AdminCommentsResponse> => {
  const [pending, hidden] = await db.batch<AdminCommentRow>([
    db
      .prepare(
        `${ADMIN_COMMENT_SELECT}
         WHERE c.slug = ? AND c.status = 'pending'
         ORDER BY c.created_at ASC, c.id ASC LIMIT ?`
      )
      .bind(slug, QUEUE_LIMIT),
    db
      .prepare(
        `${ADMIN_COMMENT_SELECT}
         WHERE c.slug = ? AND c.status = 'rejected'
         ORDER BY COALESCE(c.decided_at, c.created_at) DESC, c.id DESC LIMIT ?`
      )
      .bind(slug, HIDDEN_LIMIT),
  ]);
  return {
    hidden: (hidden?.results ?? []).map((row) => toAdminComment(row, ownerId)),
    pending: (pending?.results ?? []).map((row) =>
      toAdminComment(row, ownerId)
    ),
  };
};

export type AdminStickerRow = StickerRow & {
  status: ItemStatus;
  created_at: number;
  fingerprint: string | null;
};

/** A sticker for in-place review; only public columns plus the review ones. */
export const toAdminSticker = (row: AdminStickerRow): AdminSticker => ({
  createdAt: row.created_at,
  fingerprint: (row.fingerprint ?? "").slice(0, FINGERPRINT_LENGTH),
  height: row.height,
  id: row.id,
  name: row.name,
  rotation: row.rotation,
  scale: row.scale,
  src: stickerImagePath(row.id),
  status: row.status,
  width: row.width,
  x: row.x,
  y: row.y,
});

/** GET /api/admin/stickers: every pending sticker, oldest first. */
export const listPendingStickers = async (db: Db) => {
  const { results } = await db
    .prepare(
      `SELECT id, x, y, rotation, scale, width, height, name, status, created_at,
         ${fingerprintColumn("ip_hash")}
       FROM stickers WHERE status = 'pending'
       ORDER BY created_at ASC, id ASC LIMIT ?`
    )
    .bind(QUEUE_LIMIT)
    .all<AdminStickerRow>();
  return results.map(toAdminSticker);
};

/**
 * The oldest pending item in the whole queue (comments and stickers) other
 * than `excludeId`, as a deep link; null when nothing else waits.
 */
export const nextPending = async (
  db: Db,
  excludeId: string
): Promise<ReviewLink | null> => {
  const row = await db
    .prepare(
      `SELECT type, id, slug FROM (
         SELECT 'comment' AS type, id, slug, created_at FROM comments
         WHERE status = 'pending' AND id != ?
         UNION ALL
         SELECT 'sticker' AS type, id, NULL AS slug, created_at FROM stickers
         WHERE status = 'pending' AND id != ?
       ) ORDER BY created_at ASC, id ASC LIMIT 1`
    )
    .bind(excludeId, excludeId)
    .first<{ type: "comment" | "sticker"; id: string; slug: string | null }>();
  if (!row) {
    return null;
  }
  if (row.type === "comment") {
    return reviewLink({ id: row.id, slug: row.slug ?? "", type: "comment" });
  }
  return reviewLink({ id: row.id, type: "sticker" });
};

/** A pending or recently approved comment in GET /api/admin/queue. */
export interface QueueComment {
  anchor_exact: string | null;
  anchor_prefix: string | null;
  body: string;
  created_at: number;
  email_hash: string | null;
  /** Where to review it in place (see reviewHref). */
  href: string;
  id: string;
  ip_hash: string;
  kind: CommentKind;
  name: string;
  owner_reply: string | null;
  parent_id: string | null;
  site: string | null;
  slug: string;
  status: ItemStatus;
  ua: string | null;
  /** GitHub login when written while logged in. */
  user_login: string | null;
}

/** A pending sticker in GET /api/admin/queue. */
export type QueueSticker = StickerRow & {
  /** How often the sticker was moved (moderation_log 'move' rows). */
  moves: number;
  mime: string;
  bytes: number;
  status: ItemStatus;
  created_at: number;
  ip_hash: string;
  /** GitHub login when uploaded while logged in. */
  user_login: string | null;
  src: string;
  /** Where to review it in place (see reviewHref). */
  href: string;
};

export interface AdminQueue {
  comments: QueueComment[];
  /** All pending items (the lists above stop at 200). */
  counts: { comments: number; stickers: number };
  /** Recently approved comments, to add or edit an owner reply. */
  recent: QueueComment[];
  stickers: QueueSticker[];
}

const USER_LOGIN = (table: string) =>
  `(SELECT login FROM users WHERE users.id = ${table}.user_id) AS user_login`;

const ADMIN_COMMENT_COLUMNS = `id, slug, parent_id, kind, anchor_exact, anchor_prefix, name, email_hash, site, body,
  status, owner_reply, created_at, ip_hash, ua, ${USER_LOGIN("comments")}`;

const withCommentHref = (row: Omit<QueueComment, "href">): QueueComment => ({
  ...row,
  href: reviewHref({ id: row.id, slug: row.slug, type: "comment" }),
});

export const adminQueue = async (db: Db): Promise<AdminQueue> => {
  const [pending, stickers, recent, commentCount, stickerCount] =
    await db.batch([
      db
        .prepare(
          `SELECT ${ADMIN_COMMENT_COLUMNS} FROM comments
           WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`
        )
        .bind(QUEUE_LIMIT),
      db
        .prepare(
          `SELECT id, x, y, rotation, scale, width, height, name, mime, bytes, status, created_at, ip_hash,
             ${USER_LOGIN("stickers")},
             (SELECT COUNT(*) FROM moderation_log m
              WHERE m.item_type = 'sticker' AND m.item_id = stickers.id AND m.decision = 'move') AS moves
           FROM stickers WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`
        )
        .bind(QUEUE_LIMIT),
      db
        .prepare(
          `SELECT ${ADMIN_COMMENT_COLUMNS} FROM comments
           WHERE status = 'approved' ORDER BY COALESCE(decided_at, created_at) DESC LIMIT ?`
        )
        .bind(RECENT_LIMIT),
      db.prepare(
        "SELECT COUNT(*) AS count FROM comments WHERE status = 'pending'"
      ),
      db.prepare(
        "SELECT COUNT(*) AS count FROM stickers WHERE status = 'pending'"
      ),
    ]);
  const countOf = (result: typeof commentCount) =>
    Number(
      (result?.results.at(0) as { count?: number } | undefined)?.count ?? 0
    );
  return {
    comments: ((pending?.results ?? []) as Omit<QueueComment, "href">[]).map(
      withCommentHref
    ),
    counts: {
      comments: countOf(commentCount),
      stickers: countOf(stickerCount),
    },
    recent: ((recent?.results ?? []) as Omit<QueueComment, "href">[]).map(
      withCommentHref
    ),
    stickers: (
      (stickers?.results ?? []) as Omit<QueueSticker, "src" | "href">[]
    ).map((row) => ({
      ...row,
      href: reviewHref({ id: row.id, type: "sticker" }),
      src: stickerImagePath(row.id),
    })),
  };
};

const statusOf: Record<Decision, ItemStatus> = {
  approve: "approved",
  hold: "pending",
  reject: "rejected",
};

export interface DecideCommand {
  actor: string;
  decision: AdminDecision;
  id: string;
  now: number;
  /** Owner reply (comments only); "" removes it. */
  reply?: string;
  type: "comment" | "sticker";
}

export type DecideResult =
  | { found: false }
  /** A rejected sticker: its image is deleted, so it cannot come back. */
  | { found: true; gone: true }
  | {
      found: true;
      gone: false;
      /** The item's status after the decision. */
      status: ItemStatus;
      /** False when nothing had to change (already in that state). */
      changed: boolean;
      /** Sticker image key (the caller deletes it on reject), else null. */
      r2Key: string | null;
    };

interface DecisionTarget {
  owner_reply: string | null;
  r2_key: string | null;
  status: ItemStatus;
}

const loadDecisionTarget = (db: Db, type: DecideCommand["type"], id: string) =>
  db
    .prepare(
      type === "sticker"
        ? "SELECT r2_key, status, NULL AS owner_reply FROM stickers WHERE id = ?"
        : "SELECT NULL AS r2_key, status, owner_reply FROM comments WHERE id = ?"
    )
    .bind(id)
    .first<DecisionTarget>();

/** UPDATE + log for a status change; none when the status already matches. */
const statusStatements = (
  db: Db,
  command: DecideCommand,
  current: ItemStatus
) => {
  if (command.decision === "reply") {
    return [];
  }
  const status = statusOf[command.decision];
  if (status === current) {
    return [];
  }
  const { type, id, decision, actor, now } = command;
  // A sticker rejected in the meantime stays rejected: its image is gone.
  const sql =
    type === "sticker"
      ? "UPDATE stickers SET status = ?, decided_at = ? WHERE id = ? AND status != 'rejected'"
      : "UPDATE comments SET status = ?, decided_at = ? WHERE id = ?";
  return [
    db.prepare(sql).bind(status, now, id),
    logStatement(db, {
      actor,
      createdAt: now,
      decision,
      itemId: id,
      itemType: type,
    }),
  ];
};

/** UPDATE + log for the owner reply; none when it is unchanged or not given. */
const replyStatements = (
  db: Db,
  command: DecideCommand,
  current: string | null
) => {
  const { type, id, reply, actor, now } = command;
  if (type !== "comment" || reply === undefined) {
    return [];
  }
  const value = reply || null;
  if (value === current) {
    return [];
  }
  return [
    db
      .prepare(
        "UPDATE comments SET owner_reply = ?, owner_reply_at = ? WHERE id = ?"
      )
      .bind(value, value === null ? null : now, id),
    logStatement(db, {
      actor,
      createdAt: now,
      decision: "reply",
      itemId: id,
      itemType: type,
      note: value ?? "(removed)",
    }),
  ];
};

/**
 * Applies an admin decision, on pending or already decided items: reject on
 * an approved comment takes it down, approve on a rejected one restores it,
 * "reply" only sets or clears the owner reply. Deciding what an item already
 * is changes nothing and logs nothing. A rejected sticker cannot come back
 * (`gone`): its image is deleted from R2 by the caller (see r2Key).
 */
export const decide = async (
  db: Db,
  command: DecideCommand
): Promise<DecideResult> => {
  const target = await loadDecisionTarget(db, command.type, command.id);
  if (!target) {
    return { found: false };
  }
  if (
    command.type === "sticker" &&
    target.status === "rejected" &&
    command.decision !== "reject"
  ) {
    return { found: true, gone: true };
  }
  const changesStatus = statusStatements(db, command, target.status);
  const statements = [
    ...changesStatus,
    ...replyStatements(db, command, target.owner_reply),
  ];
  if (statements.length > 0) {
    const [first] = await db.batch(statements);
    // The sticker was rejected between the read and the write.
    if (changesStatus.length > 0 && (first?.meta.changes ?? 0) === 0) {
      return { found: true, gone: true };
    }
  }
  return {
    changed: statements.length > 0,
    found: true,
    gone: false,
    r2Key: target.r2_key,
    status:
      command.decision === "reply" ? target.status : statusOf[command.decision],
  };
};
