/**
 * GET /api/admin/stickers — every pending sticker with its position, for
 * reviewing in place on the canvas (oldest first). Images come from
 * GET /api/stickers/:id/image, which serves pending ones to the admin.
 * `fingerprint` is the first 8 characters of the IP hash. Behind Cloudflare
 * Access; not cached.
 */
import type { APIRoute } from "astro";
import { checkAdmin } from "@/lib/server/access";
import { listPendingStickers } from "@/lib/server/db";
import { accessConfig, database } from "@/lib/server/env";
import { fail, json } from "@/lib/server/http";
import type { AdminStickersResponse } from "@/lib/server/types";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const admin = await checkAdmin(request, accessConfig());
  if (!admin.ok) {
    return fail(admin.status, admin.message);
  }
  const body: AdminStickersResponse = {
    pending: await listPendingStickers(database()),
  };
  return json(body);
};
