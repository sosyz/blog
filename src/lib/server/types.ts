/**
 * JSON shapes of the public API, shared by the API routes and the client
 * scripts (type-only imports on the client).
 */

export type ItemStatus = "pending" | "approved" | "rejected";

export type CommentKind = "comment" | "inline";

export type Anchor = { exact: string; prefix: string };

/** The public GitHub profile of a logged-in visitor. */
export type PublicUser = {
  login: string;
  name: string | null;
  /** https://avatars.githubusercontent.com/… */
  avatarUrl: string;
  /** https://github.com/<login> */
  htmlUrl: string;
};

/** A comment as shown publicly (no e-mail hash, IP hash or user agent). */
export type PublicComment = {
  id: string;
  kind: CommentKind;
  parentId: string | null;
  name: string;
  site: string | null;
  body: string;
  anchor: Anchor | null;
  /** Epoch ms. */
  createdAt: number;
  reply: { body: string; at: number } | null;
  /** The GitHub account it was written with; null for nickname comments. */
  user: PublicUser | null;
  /** Written by the blog owner (OWNER_GITHUB_ID): shown with the 博主 stamp. */
  isOwner: boolean;
};

/** GET /api/comments?slug=&mine= */
export type CommentsResponse = {
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
};

/** GET /api/auth/me */
export type MeResponse = {
  /** A login is offered: GitHub is configured, or the localhost dev login. */
  enabled: boolean;
  user: PublicUser | null;
  isOwner: boolean;
  /** Which login to offer: GitHub, the localhost dev login, or none. */
  login: "github" | "dev" | null;
};

/** POST /api/comments and POST /api/stickers */
export type CreatedResponse = { id: string; status: ItemStatus };

/**
 * POST /api/stickers. `token` (the edit token for moving the sticker later)
 * is returned only here, once; the server keeps just its salted hash. It is
 * missing when the moderator rejected the sticker straight away.
 */
export type StickerCreatedResponse = CreatedResponse & { token?: string };

/** PATCH /api/stickers/:id and /api/admin/stickers/:id: the stored position. */
export type MovedResponse = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
};

export type PublicSticker = {
  id: string;
  /** World coordinates of the centre. */
  x: number;
  y: number;
  rotation: number;
  scale: number;
  width: number;
  height: number;
  name: string | null;
  src: string;
};

/** GET /api/stickers?mine= */
export type StickersResponse = {
  stickers: PublicSticker[];
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
  /**
   * Keys (data-sticker-key) of the built-in stickers the owner threw away:
   * hidden for everyone (POST /api/builtins, src/lib/builtin-stickers.ts).
   */
  hiddenBuiltins: string[];
};

/** POST /api/builtins {key, hidden} → the key's state and the whole list. */
export type BuiltinToggleResponse = {
  key: string;
  hidden: boolean;
  hiddenBuiltins: string[];
};

export type ErrorResponse = { error: string };

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
export type ReviewLink = {
  type: "comment" | "sticker";
  id: string;
  /** /notes/<slug>/?review=c:<id>#comments or /?review=s:<id> */
  href: string;
};

/** GET /api/admin/comments?slug= */
export type AdminCommentsResponse = {
  /** Waiting for review on this note, oldest first. */
  pending: AdminComment[];
  /** Rejected on this note (can be restored), newest first, at most 50. */
  hidden: AdminComment[];
};

/** GET /api/admin/stickers */
export type AdminStickersResponse = {
  /** Every pending sticker, oldest first. */
  pending: AdminSticker[];
};

/** POST /api/admin/decide {type, id, decision, reply?} */
export type AdminDecision = "approve" | "reject" | "hold" | "reply";

export type DecideResponse = {
  ok: true;
  id: string;
  decision: AdminDecision;
  /** The item's status after the decision. */
  status: ItemStatus;
  /** The oldest other pending item (comments and stickers), or null. */
  next: ReviewLink | null;
};
