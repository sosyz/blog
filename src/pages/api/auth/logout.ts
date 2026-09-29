/**
 * POST /api/auth/logout → 204 — ends this browser's session (same-origin
 * only): deletes the session row and clears the `sid` cookie. Other devices stay
 * logged in until their own sessions expire.
 */
import type { APIRoute } from "astro";
import {
  clearSessionCookie,
  hashSessionToken,
  readSessionToken,
  secureCookies,
} from "@/lib/server/auth";
import { database } from "@/lib/server/env";
import { crossOrigin, isSameOrigin, noContent } from "@/lib/server/http";
import { deleteSession } from "@/lib/server/users";

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  if (!isSameOrigin(request)) {
    return crossOrigin();
  }
  const token = readSessionToken(request.headers.get("cookie"));
  if (token) {
    await deleteSession(database(), await hashSessionToken(token));
  }
  return noContent([clearSessionCookie(secureCookies(url))]);
};
