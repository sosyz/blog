/**
 * POST /api/builtins {key, hidden} — the owner throws a built-in sticker
 * (data-sticker-key, src/lib/builtin-stickers.ts) into the trash for every
 * visitor (hidden: true), or brings it back from /admin/ (hidden: false).
 * → {key, hidden, hiddenBuiltins}. Idempotent.
 *
 * Allowed for a Cloudflare Access login (or the localhost dev bypass; the
 * CF_Authorization cookie covers this path, which is outside the Access
 * application) or the owner's GitHub session (OWNER_GITHUB_ID); else 401 /
 * 403. Not under /api/admin/: the GitHub session has to reach it. Same-origin
 * only. Hiding needs a key the canvas has; restoring takes any well-formed
 * key (a sticker removed from the code can still be cleared). Others see the
 * change within 5 minutes (GET /api/stickers is edge-cached).
 */
import type { APIRoute } from "astro";
import { builtinByKey } from "@/lib/builtin-stickers";
import { checkAdmin } from "@/lib/server/access";
import { accessConfig, database, viewerOf } from "@/lib/server/env";
import {
  builtinEditor,
  listHiddenBuiltins,
  setBuiltinHidden,
} from "@/lib/server/hidden-builtins";
import {
  crossOrigin,
  fail,
  isSameOrigin,
  JSON_BODY_LIMIT,
  json,
  readJson,
  STATUS,
} from "@/lib/server/http";
import type { BuiltinToggleResponse } from "@/lib/server/types";
import { builtinToggleInput, firstIssue } from "@/lib/server/validate";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) {
    return crossOrigin();
  }
  const [admin, { viewer }] = await Promise.all([
    checkAdmin(request, accessConfig()),
    viewerOf(request),
  ]);
  const editor = builtinEditor(
    admin,
    viewer ? { isOwner: viewer.isOwner, login: viewer.user.login } : null
  );
  if (!editor.ok) {
    return fail(editor.status, editor.message);
  }
  const raw = await readJson(request, JSON_BODY_LIMIT);
  if (raw === null) {
    return fail(STATUS.badRequest, "提交的内容格式不对。");
  }
  const parsed = builtinToggleInput.safeParse(raw);
  if (!parsed.success) {
    return fail(STATUS.badRequest, firstIssue(parsed.error));
  }
  const { key, hidden } = parsed.data;
  if (hidden && !builtinByKey().has(key)) {
    return fail(STATUS.notFound, "画布上没有这张自带贴纸。");
  }
  const db = database();
  await setBuiltinHidden(db, {
    key,
    hidden,
    by: editor.actor,
    now: Date.now(),
  });
  const body: BuiltinToggleResponse = {
    key,
    hidden,
    hiddenBuiltins: await listHiddenBuiltins(db),
  };
  return json(body);
};
