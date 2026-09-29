/**
 * GET /api/admin/whoami — 200 {ok: true} when the request carries a valid
 * Cloudflare Access login (or the localhost dev bypass), else 401/403/503.
 * The canvas calls it only after the owner has opened /admin/ in this
 * browser (a localStorage flag), to decide whether to show 整理贴纸.
 */
import type { APIRoute } from "astro";
import { checkAdmin } from "@/lib/server/access";
import { accessConfig } from "@/lib/server/env";
import { fail, json } from "@/lib/server/http";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const admin = await checkAdmin(request, accessConfig());
  if (!admin.ok) {
    return fail(admin.status, admin.message);
  }
  return json({ ok: true });
};
