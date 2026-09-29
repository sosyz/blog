/**
 * GET /api/admin/queue — pending comments and stickers, plus recently
 * approved comments (for owner replies). Every item has `href`, the page
 * where the owner reviews it in place; `counts` has the pending totals.
 * Behind Cloudflare Access.
 */
import type { APIRoute } from "astro";
import { checkAdmin } from "@/lib/server/access";
import { adminQueue } from "@/lib/server/db";
import { accessConfig, database } from "@/lib/server/env";
import { fail, json } from "@/lib/server/http";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const admin = await checkAdmin(request, accessConfig());
  if (!admin.ok) {
    return fail(admin.status, admin.message);
  }
  return json(await adminQueue(database()));
};
