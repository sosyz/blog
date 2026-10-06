/**
 * GET /api/stickers/:id/image — the sticker image from R2.
 * Approved: public, cached for a year (images never change for an id).
 * Pending: only for admins (Access JWT or the dev bypass), the GitHub account
 * that uploaded it, or the owner's GitHub session; never cached.
 */
import type { APIRoute } from "astro";
import { checkAdmin } from "@/lib/server/access";
import { getStickerFile } from "@/lib/server/db";
import {
  accessConfig,
  database,
  stickerBucket,
  viewerOf,
} from "@/lib/server/env";
import { fail, STATUS } from "@/lib/server/http";
import { idField } from "@/lib/server/validate";

export const prerender = false;

const notFound = () => fail(STATUS.notFound, "没有这张贴纸。");

/** Pending images: the uploader's account, the owner, or an admin. */
const maySeePending = async (request: Request, uploader: string | null) => {
  const { viewer } = await viewerOf(request);
  if (viewer && (viewer.isOwner || viewer.userId === uploader)) {
    return true;
  }
  const admin = await checkAdmin(request, accessConfig());
  return admin.ok;
};

export const GET: APIRoute = async ({ params, request }) => {
  const id = idField.safeParse(params.id);
  if (!id.success) {
    return notFound();
  }
  const row = await getStickerFile(database(), id.data);
  if (!row || row.status === "rejected") {
    return notFound();
  }
  const approved = row.status === "approved";
  if (!(approved || (await maySeePending(request, row.user_id)))) {
    return notFound();
  }
  const object = await stickerBucket().get(row.r2_key);
  if (!object) {
    return notFound();
  }
  const headers = new Headers({
    "cache-control": approved
      ? "public, max-age=31536000, immutable"
      : "private, no-store",
    "content-length": String(object.size),
    "content-security-policy": "default-src 'none'; sandbox",
    "content-type": row.mime,
    etag: object.httpEtag,
    "x-content-type-options": "nosniff",
  });
  return new Response(object.body, { headers });
};
