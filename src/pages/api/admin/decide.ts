/**
 * POST /api/admin/decide {type, id, decision, reply?} — approve / reject /
 * put back on hold, on pending or already decided items (reject on an
 * approved comment takes it down, approve on a rejected one restores it);
 * "reply" only sets (or with "" removes) the owner reply on a comment, and
 * `reply` next to approve / reject / hold does the same. Deciding what an
 * item already is returns 200 without logging again. Behind Cloudflare
 * Access. Rejected sticker images are deleted from R2, so a rejected sticker
 * cannot be approved again (409).
 *
 * → DecideResponse {ok, id, decision, status, next}: `next` is the oldest
 * other pending item (comments and stickers) as a deep link, or null.
 */
import type { APIRoute } from "astro";
import { checkAdmin } from "@/lib/server/access";
import { decide, nextPending } from "@/lib/server/db";
import { accessConfig, database, stickerBucket } from "@/lib/server/env";
import {
  crossOrigin,
  fail,
  isSameOrigin,
  JSON_BODY_LIMIT,
  json,
  readJson,
  STATUS,
} from "@/lib/server/http";
import type { DecideResponse } from "@/lib/server/types";
import { decisionInput, firstIssue } from "@/lib/server/validate";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) {
    return crossOrigin();
  }
  const admin = await checkAdmin(request, accessConfig());
  if (!admin.ok) {
    return fail(admin.status, admin.message);
  }
  const raw = await readJson(request, JSON_BODY_LIMIT);
  if (raw === null) {
    return fail(STATUS.badRequest, "提交的内容格式不对。");
  }
  const parsed = decisionInput.safeParse(raw);
  if (!parsed.success) {
    return fail(STATUS.badRequest, firstIssue(parsed.error));
  }
  const input = parsed.data;
  if (
    input.type === "sticker" &&
    (input.decision === "reply" || input.reply !== undefined)
  ) {
    return fail(STATUS.badRequest, "贴纸不能回复。");
  }
  const db = database();
  const result = await decide(db, {
    ...input,
    actor: `admin:${admin.email}`,
    now: Date.now(),
  });
  if (!result.found) {
    return fail(STATUS.notFound, "没有找到这条内容。");
  }
  if (result.gone) {
    return fail(
      STATUS.conflict,
      "这张贴纸已经拒绝过，图片也删了，没法再通过。"
    );
  }
  // Also when it was already rejected: retries a delete that failed before
  // (deleting a missing key does nothing).
  if (input.type === "sticker" && input.decision === "reject" && result.r2Key) {
    await stickerBucket().delete(result.r2Key);
  }
  const body: DecideResponse = {
    ok: true,
    id: input.id,
    decision: input.decision,
    status: result.status,
    next: await nextPending(db, input.id),
  };
  return json(body);
};
