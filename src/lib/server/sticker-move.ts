/**
 * The decision part of moving or tearing off a placed sticker, shared by
 * PATCH / DELETE /api/stickers/:id (the uploader with the edit token, the
 * uploader's GitHub account, or the owner's GitHub session) and
 * PATCH /api/admin/stickers/:id (the owner behind Cloudflare Access). Pure:
 * the routes load the row, call planMove / planDelete, and write what they
 * return.
 */
import { checkEditToken } from "./edit-token";
import { STATUS } from "./http";
import {
  type Placement,
  roundPlacement,
  samePlacement,
} from "./sticker-limits";
import type { ItemStatus } from "./types";

/** The columns that decide who may edit a sticker. */
export interface EditableRow {
  edit_token_hash: string | null;
  status: ItemStatus;
  /** The logged-in uploader (users.id), if any. */
  user_id?: string | null;
}

export type MovableRow = Placement & EditableRow;

export type DeletableRow = EditableRow & { r2_key: string };

/** A logged-in GitHub user making the request. */
export interface MoveSession {
  isOwner: boolean;
  userId: string;
}

export type MoveAuth =
  | {
      kind: "visitor";
      /** Edit token from the upload, when this browser has it. */
      token?: string;
      salt: string;
      session?: MoveSession | null;
    }
  | { kind: "admin" };

/** What allowed the edit (logged as the actor). */
export type MoveVia = "token" | "account" | "owner" | "admin";

export type MovePlan =
  | { ok: false; status: number; message: string }
  | {
      ok: true;
      from: Placement;
      to: Placement;
      changed: boolean;
      via: MoveVia;
    };

const NOT_FOUND = "没有这张贴纸。";
const NOT_YOURS = "这张贴纸不是你贴的，挪不了。";
const GONE = "这张贴纸已经被拒绝，没法再挪了。";
/** DELETE answers missing and not-yours with the same body. */
const CANNOT_TEAR = "没有这张贴纸，或者它不是你贴的。";

export type DeletePlan =
  | { ok: false; status: number; message: string }
  | {
      ok: true;
      via: MoveVia;
      /** Already rejected: nothing to write, only retry the R2 delete. */
      alreadyGone: boolean;
      /** The image to delete from R2. */
      r2Key: string;
    };

/**
 * Who may move or tear off a sticker for everyone (docs/design.md
 * 「访客互动」): the browser with its edit token, the GitHub account that
 * uploaded it, or the blog owner (GitHub session or Cloudflare Access).
 * null → not allowed.
 */
export const authoriseStickerEdit = async (
  row: EditableRow,
  auth: MoveAuth
): Promise<MoveVia | null> => {
  if (auth.kind === "admin") {
    return "admin";
  }
  const { session } = auth;
  if (session?.isOwner) {
    return "owner";
  }
  if (session && row.user_id && row.user_id === session.userId) {
    return "account";
  }
  if (
    auth.token &&
    (await checkEditToken(auth.token, row.edit_token_hash, auth.salt))
  ) {
    return "token";
  }
  return null;
};

/**
 * Checks that the sticker exists, is not rejected and that the request may
 * move it (see authoriseStickerEdit), then rounds the new position the way
 * the upload does. A missing row and a refused move answer the same 404, so ids cannot
 * be probed.
 */
export const planMove = async (
  row: MovableRow | null,
  input: Placement,
  auth: MoveAuth
): Promise<MovePlan> => {
  if (!row) {
    return { message: NOT_FOUND, ok: false, status: STATUS.notFound };
  }
  const via = await authoriseStickerEdit(row, auth);
  if (!via) {
    return { message: NOT_YOURS, ok: false, status: STATUS.notFound };
  }
  if (row.status === "rejected") {
    return { message: GONE, ok: false, status: STATUS.conflict };
  }
  const from = roundPlacement(row);
  const to = roundPlacement(input);
  return { changed: !samePlacement(from, to), from, ok: true, to, via };
};

/**
 * DELETE /api/stickers/:id (撕掉): the same people as planMove. A missing row
 * and a refused request answer the same 404 with the same message, checked
 * before the status so a rejected id cannot be probed either. Tearing off a
 * sticker that is already rejected is allowed and changes nothing
 * (`alreadyGone`), so a retry after a failed R2 delete still cleans up.
 */
export const planDelete = async (
  row: DeletableRow | null,
  auth: MoveAuth
): Promise<DeletePlan> => {
  const via = row ? await authoriseStickerEdit(row, auth) : null;
  if (!(row && via)) {
    return { message: CANNOT_TEAR, ok: false, status: STATUS.notFound };
  }
  return {
    alreadyGone: row.status === "rejected",
    ok: true,
    r2Key: row.r2_key,
    via,
  };
};

/** moderation_log note for a tear-off: the owner throws it away. */
export const tearOffNote = (via: MoveVia) =>
  via === "owner" || via === "admin" ? "博主扔掉了" : "上传者撕掉了";
