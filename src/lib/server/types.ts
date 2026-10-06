/**
 * JSON shapes of the public API, shared by the API routes and the client
 * scripts (type-only imports on the client).
 */

export type ItemStatus = "pending" | "approved" | "rejected";

export type CommentKind = "comment" | "inline";

export interface Anchor {
  exact: string;
  prefix: string;
}

/** The public GitHub profile of a logged-in visitor. */
export interface PublicUser {
  /** https://avatars.githubusercontent.com/… */
  avatarUrl: string;
  /** https://github.com/<login> */
  htmlUrl: string;
  login: string;
  name: string | null;
}

/** A comment as shown publicly (no e-mail hash, IP hash or user agent). */
export interface PublicComment {
  anchor: Anchor | null;
  body: string;
  /** Epoch ms. */
  createdAt: number;
  id: string;
  /** Written by the blog owner (OWNER_GITHUB_ID): shown with the 博主 stamp. */
  isOwner: boolean;
  kind: CommentKind;
  name: string;
  parentId: string | null;
  reply: { body: string; at: number } | null;
  site: string | null;
  /** The GitHub account it was written with; null for nickname comments. */
  user: PublicUser | null;
}

/** GET /api/comments?slug=&mine= */
export interface CommentsResponse {
  comments: PublicComment[];
  /**
   * Status of the ids passed in `mine` (the visitor's own submissions) and,
   * with a GitHub session, of that account's pending comments on the note.
   */
  mine: Record<string, ItemStatus>;
  /**
   * With a GitHub session: the full pending comments of that account on this
   * note (their ids are also in `mine`), so another device can render them.
   */
  ownPending: PublicComment[];
}

/** GET /api/auth/me */
export interface MeResponse {
  /** A login is offered: GitHub is configured, or the localhost dev login. */
  enabled: boolean;
  isOwner: boolean;
  /** Which login to offer: GitHub, the localhost dev login, or none. */
  login: "github" | "dev" | null;
  user: PublicUser | null;
}

/** POST /api/comments and POST /api/stickers */
export interface CreatedResponse {
  id: string;
  status: ItemStatus;
}

/**
 * POST /api/stickers. `token` (the edit token for moving the sticker later)
 * is returned only here, once; the server keeps just its salted hash. It is
 * missing when the moderator rejected the sticker straight away.
 */
export type StickerCreatedResponse = CreatedResponse & { token?: string };

/** PATCH /api/stickers/:id and /api/admin/stickers/:id: the stored position. */
export interface MovedResponse {
  id: string;
  rotation: number;
  scale: number;
  x: number;
  y: number;
}

export interface PublicSticker {
  height: number;
  id: string;
  name: string | null;
  rotation: number;
  scale: number;
  src: string;
  width: number;
  /** World coordinates of the centre. */
  x: number;
  y: number;
}

/** GET /api/stickers?mine= */
export interface StickersResponse {
  /**
   * Keys (data-sticker-key) of the built-in stickers the owner threw away:
   * hidden for everyone (POST /api/builtins, src/lib/builtin-stickers.ts).
   */
  hiddenBuiltins: string[];
  /**
   * Status of the ids passed in `mine` and, with a GitHub session, of that
   * account's stickers (pending and approved).
   */
  mine: Record<string, ItemStatus>;
  /** With a GitHub session: ids of that account's stickers (movable). */
  owned: string[];
  /**
   * With a GitHub session: that account's pending stickers with position and
   * `src` (GET /api/stickers/:id/image serves them to the account), so
   * another device can show them as 审核中.
   */
  ownPending: PublicSticker[];
  stickers: PublicSticker[];
}

/** POST /api/builtins {key, hidden} → the key's state and the whole list. */
export interface BuiltinToggleResponse {
  hidden: boolean;
  hiddenBuiltins: string[];
  key: string;
}

export interface ErrorResponse {
  error: string;
}

/* ---------- admin (behind Cloudflare Access) ---------- */

/**
 * A comment as the owner sees it while reviewing in place. Like the public
 * shape, it never carries the e-mail hash, the full IP hash or the user
 * agent; `fingerprint` is the first 8 characters of the IP hash ("" if none),
 * enough to spot repeat visitors.
 */
export type AdminComment = PublicComment & {
  status: ItemStatus;
  createdAt: number;
  fingerprint: string;
};

/** A sticker as the owner sees it (image via GET /api/stickers/:id/image). */
export type AdminSticker = PublicSticker & {
  status: ItemStatus;
  /** Epoch ms. */
  createdAt: number;
  fingerprint: string;
};

/**
 * Where the owner reviews an item in place: a comment (normal or inline) on
 * its note page, a sticker on the canvas. See reviewHref in db.ts.
 */
export interface ReviewLink {
  /** /notes/<slug>/?review=c:<id>#comments or /?review=s:<id> */
  href: string;
  id: string;
  type: "comment" | "sticker";
}

/** GET /api/admin/comments?slug= */
export interface AdminCommentsResponse {
  /** Rejected on this note (can be restored), newest first, at most 50. */
  hidden: AdminComment[];
  /** Waiting for review on this note, oldest first. */
  pending: AdminComment[];
}

/** GET /api/admin/stickers */
export interface AdminStickersResponse {
  /** Every pending sticker, oldest first. */
  pending: AdminSticker[];
}

/** POST /api/admin/decide {type, id, decision, reply?} */
export type AdminDecision = "approve" | "reject" | "hold" | "reply";

export interface DecideResponse {
  decision: AdminDecision;
  id: string;
  /** The oldest other pending item (comments and stickers), or null. */
  next: ReviewLink | null;
  ok: true;
  /** The item's status after the decision. */
  status: ItemStatus;
}
