/**
 * PATCH /api/admin/stickers/:id {x, y, rotation, scale} — the owner moves any
 * visitor sticker (整理贴纸 on the canvas). Behind Cloudflare Access (and the
 * localhost-only dev bypass). Logged as 'move' with the admin as actor.
 */
import type { APIRoute } from "astro";
import { checkAdmin } from "@/lib/server/access";
import { getStickerForMove, moveSticker } from "@/lib/server/db";
import { moveNote } from "@/lib/server/edit-token";
import { accessConfig, database } from "@/lib/server/env";
import {
  crossOrigin,
  fail,
  isSameOrigin,
  JSON_BODY_LIMIT,
  json,
  readJson,
  STATUS,
} from "@/lib/server/http";
import { planMove } from "@/lib/server/sticker-move";
import type { MovedResponse } from "@/lib/server/types";
import { adminMoveInput, firstIssue, idField } from "@/lib/server/validate";

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request }) => {
  if (!isSameOrigin(request)) {
    return crossOrigin();
  }
  const admin = await checkAdmin(request, accessConfig());
  if (!admin.ok) {
    return fail(admin.status, admin.message);
  }
  const id = idField.safeParse(params.id);
  if (!id.success) {
    return fail(STATUS.notFound, "没有这张贴纸。");
  }
  const raw = await readJson(request, JSON_BODY_LIMIT);
  if (raw === null) {
    return fail(STATUS.badRequest, "提交的内容格式不对。");
  }
  const parsed = adminMoveInput.safeParse(raw);
  if (!parsed.success) {
    return fail(STATUS.badRequest, firstIssue(parsed.error));
  }
  const db = database();
  const plan = await planMove(
    await getStickerForMove(db, id.data),
    parsed.data,
    {
      kind: "admin",
    }
  );
  if (!plan.ok) {
    return fail(plan.status, plan.message);
  }
  const body: MovedResponse = { id: id.data, ...plan.to };
  if (!plan.changed) {
    return json(body);
  }
  const moved = await moveSticker(db, id.data, plan.to, {
    actor: `admin:${admin.email}`,
    createdAt: Date.now(),
    decision: "move",
    itemId: id.data,
    itemType: "sticker",
    note: moveNote(plan.from, plan.to, "博主整理贴纸"),
  });
  if (!moved) {
    return fail(STATUS.conflict, "这张贴纸已经被拒绝，没法再挪了。");
  }
  return json(body);
};
