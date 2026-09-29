/**
 * PATCH /api/stickers/:id {x, y, rotation, scale, token?} — move a placed
 * sticker (pending or approved) for everyone. Allowed for:
 *   - the uploader's browser: `token` is the edit token POST /api/stickers
 *     returned, checked against the stored salted hash;
 *   - the GitHub account that uploaded it (session cookie, any device);
 *   - the blog owner's GitHub session (整理贴纸; OWNER_GITHUB_ID).
 * No Turnstile and no new review: only the position changes. Rate-limited per
 * visitor (RATE_LIMITS.move), except for the owner; each move is logged as
 * 'move'.
 *
 * DELETE /api/stickers/:id {token?} — tear a sticker off (撕掉), same people
 * as PATCH; the body may be empty when the session is enough. Sets it
 * 'rejected' (it cannot come back), deletes the R2 image and logs a 'reject'
 * (counted for the same move limit, except for the owner). 204 on success and
 * when it is already rejected (retries the R2 delete); 404 when missing or not
 * yours. Others may still see it for up to 5 minutes (GET /api/stickers is
 * edge-cached).
 */
import type { APIRoute } from "astro";
import {
  getStickerForDelete,
  getStickerForMove,
  type LimitKey,
  moveStickerWithinLimit,
  recentMoves,
  tearOffStickerWithinLimit,
} from "@/lib/server/db";
import { moveNote } from "@/lib/server/edit-token";
import { database, ipSalt, stickerBucket, viewerOf } from "@/lib/server/env";
import {
  clientIp,
  crossOrigin,
  fail,
  hashIp,
  isSameOrigin,
  JSON_BODY_LIMIT,
  json,
  noContent,
  readBodyBytes,
  readJson,
  STATUS,
} from "@/lib/server/http";
import {
  DAY,
  HOUR,
  limitReachedMessage,
  limitWindow,
  rateLimitMessage,
} from "@/lib/server/rate-limit";
import {
  type MoveVia,
  planDelete,
  planMove,
  tearOffNote,
} from "@/lib/server/sticker-move";
import type { MovedResponse } from "@/lib/server/types";
import {
  firstIssue,
  idField,
  stickerDeleteInput,
  stickerMoveInput,
} from "@/lib/server/validate";
import { moveActor } from "@/lib/server/visitor";

export const prerender = false;

const readMove = async (request: Request) => {
  const raw = await readJson(request, JSON_BODY_LIMIT);
  if (raw === null) {
    return {
      ok: false as const,
      response: fail(STATUS.badRequest, "提交的内容格式不对。"),
    };
  }
  const parsed = stickerMoveInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: fail(STATUS.badRequest, firstIssue(parsed.error)),
    };
  }
  return { ok: true as const, input: parsed.data };
};

/**
 * The move limit (PATCH and DELETE share it); the owner is not limited. An
 * early, cheap check; moveLimits is checked again inside the write, which is
 * what holds when requests arrive in parallel.
 */
const moveLimited = async (
  db: D1Database,
  via: MoveVia,
  { ipHash, now }: { ipHash: string; now: number }
) => {
  if (via === "owner") {
    return null;
  }
  const [lastHour, lastDay] = await recentMoves(db, {
    ipHash,
    now,
    hour: HOUR,
    day: DAY,
  });
  return rateLimitMessage("move", lastHour, lastDay);
};

/** The move limit as the write checks it (none for the owner). */
const moveLimits = (
  via: MoveVia,
  { ipHash, now }: { ipHash: string; now: number }
): LimitKey[] =>
  via === "owner"
    ? []
    : [{ column: "ip_hash", value: ipHash, window: limitWindow("move", now) }];

const MOVE_LIMITED = () =>
  fail(STATUS.tooManyRequests, limitReachedMessage("move"));

export const PATCH: APIRoute = async ({ params, request }) => {
  if (!isSameOrigin(request)) {
    return crossOrigin();
  }
  const id = idField.safeParse(params.id);
  if (!id.success) {
    return fail(STATUS.notFound, "没有这张贴纸。");
  }
  const move = await readMove(request);
  if (!move.ok) {
    return move.response;
  }
  const { token, ...placement } = move.input;
  const db = database();
  const salt = ipSalt();
  const { viewer } = await viewerOf(request);
  const plan = await planMove(await getStickerForMove(db, id.data), placement, {
    kind: "visitor",
    token,
    salt,
    session: viewer ? { userId: viewer.userId, isOwner: viewer.isOwner } : null,
  });
  if (!plan.ok) {
    return fail(plan.status, plan.message);
  }
  const body: MovedResponse = { id: id.data, ...plan.to };
  if (!plan.changed) {
    return json(body);
  }

  const now = Date.now();
  const ipHash = await hashIp(clientIp(request), salt);
  // The owner tidies without a limit, like through /api/admin/stickers/:id.
  const limited = await moveLimited(db, plan.via, { ipHash, now });
  if (limited) {
    return fail(STATUS.tooManyRequests, limited);
  }

  // Who moved it: the edit token, the GitHub account or the owner.
  const who = moveActor(plan.via, viewer?.user.login);
  const moved = await moveStickerWithinLimit(db, id.data, {
    to: plan.to,
    log: {
      itemType: "sticker",
      itemId: id.data,
      decision: "move",
      actor: who.actor,
      note: moveNote(plan.from, plan.to, who.label),
      createdAt: now,
      // Owner moves are not counted for the visitor limit.
      ipHash: plan.via === "owner" ? null : ipHash,
    },
    limits: moveLimits(plan.via, { ipHash, now }),
  });
  if (moved.limited) {
    return MOVE_LIMITED();
  }
  if (!moved.changed) {
    return fail(STATUS.conflict, "这张贴纸已经被拒绝，没法再挪了。");
  }
  return json(body);
};

const badBody = () => fail(STATUS.badRequest, "提交的内容格式不对。");

/** `{token?}`; an empty body is `{}` (the session may be enough). */
const readDelete = async (request: Request) => {
  const bytes = await readBodyBytes(request, JSON_BODY_LIMIT);
  if (!bytes) {
    return { ok: false as const, response: badBody() };
  }
  let raw: unknown = {};
  if (bytes.byteLength > 0) {
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return { ok: false as const, response: badBody() };
    }
  }
  const parsed = stickerDeleteInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: fail(STATUS.badRequest, firstIssue(parsed.error)),
    };
  }
  return { ok: true as const, input: parsed.data };
};

export const DELETE: APIRoute = async ({ params, request }) => {
  if (!isSameOrigin(request)) {
    return crossOrigin();
  }
  const id = idField.safeParse(params.id);
  if (!id.success) {
    return fail(STATUS.notFound, "没有这张贴纸，或者它不是你贴的。");
  }
  const body = await readDelete(request);
  if (!body.ok) {
    return body.response;
  }
  const db = database();
  const salt = ipSalt();
  const { viewer } = await viewerOf(request);
  const plan = await planDelete(await getStickerForDelete(db, id.data), {
    kind: "visitor",
    token: body.input.token,
    salt,
    session: viewer ? { userId: viewer.userId, isOwner: viewer.isOwner } : null,
  });
  if (!plan.ok) {
    return fail(plan.status, plan.message);
  }

  if (!plan.alreadyGone) {
    const now = Date.now();
    const ipHash = await hashIp(clientIp(request), salt);
    const limited = await moveLimited(db, plan.via, { ipHash, now });
    if (limited) {
      return fail(STATUS.tooManyRequests, limited);
    }
    const torn = await tearOffStickerWithinLimit(db, id.data, {
      log: {
        itemType: "sticker",
        itemId: id.data,
        decision: "reject",
        actor: moveActor(plan.via, viewer?.user.login).actor,
        note: tearOffNote(plan.via),
        createdAt: now,
        // Counted for the move limit, except the owner's.
        ipHash: plan.via === "owner" ? null : ipHash,
      },
      limits: moveLimits(plan.via, { ipHash, now }),
    });
    // Over the limit: nothing changed, so the image stays too.
    if (torn.limited) {
      return MOVE_LIMITED();
    }
  }
  // Also when it was already rejected: retries a delete that failed before.
  await stickerBucket().delete(plan.r2Key);
  return noContent();
};
