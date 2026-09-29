/**
 * GET /api/admin/comments?slug= — for reviewing in place on a note page: the
 * note's pending comments (normal and inline, with anchors; oldest first)
 * and its rejected ones (newest first, at most 50) so the owner can restore
 * them. No e-mail hash, full IP hash or user agent: `fingerprint` is the
 * first 8 characters of the IP hash. Behind Cloudflare Access; not cached.
 */
import type { APIRoute } from "astro";
import { checkAdmin } from "@/lib/server/access";
import { listAdminComments } from "@/lib/server/db";
import { accessConfig, authConfig, database } from "@/lib/server/env";
import { fail, json, STATUS } from "@/lib/server/http";
import { firstIssue, slugField } from "@/lib/server/validate";

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const admin = await checkAdmin(request, accessConfig());
  if (!admin.ok) {
    return fail(admin.status, admin.message);
  }
  const slug = slugField.safeParse(url.searchParams.get("slug"));
  if (!slug.success) {
    return fail(STATUS.badRequest, firstIssue(slug.error));
  }
  return json(
    await listAdminComments(database(), slug.data, authConfig().ownerId)
  );
};
