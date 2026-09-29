/**
 * GET /api/auth/me → {enabled, user: {login, name, avatarUrl, htmlUrl} | null,
 * isOwner, login: "github" | "dev" | null}. `enabled` is false when neither
 * GitHub (GITHUB_CLIENT_ID + secret) nor the localhost dev login is set up;
 * `login` says which one the login link should use. Never cached.
 *
 * The only place a session is extended: when it was last refreshed more than
 * a day ago, its expiry moves 30 days ahead and the cookie is sent again
 * (at most one D1 write per session per day). An unknown or expired `sid`
 * cookie is cleared.
 */
import type { APIRoute } from "astro";
import {
  clearSessionCookie,
  loginMethod,
  SESSION_TTL,
  secureCookies,
  sessionCookie,
} from "@/lib/server/auth";
import { authConfig, database, viewerOf } from "@/lib/server/env";
import { json } from "@/lib/server/http";
import type { MeResponse } from "@/lib/server/types";
import { refreshSession } from "@/lib/server/users";

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const { viewer, clearCookie } = await viewerOf(request);
  const secure = secureCookies(url);
  const headers = new Headers({ "cache-control": "private, no-store" });
  if (viewer?.stale) {
    const now = Date.now();
    await refreshSession(database(), viewer.sessionId, now, now + SESSION_TTL);
    headers.set("set-cookie", sessionCookie(viewer.token, secure));
  } else if (clearCookie) {
    headers.set("set-cookie", clearSessionCookie(secure));
  }
  const login = loginMethod(request, authConfig());
  const body: MeResponse = {
    enabled: login !== null,
    user: viewer?.user ?? null,
    isOwner: viewer?.isOwner ?? false,
    login,
  };
  return json(body, { headers });
};
