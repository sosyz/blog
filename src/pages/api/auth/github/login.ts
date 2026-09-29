/**
 * GET /api/auth/github/login?next=/path — start the optional GitHub login:
 * a random `state` goes into a short-lived HttpOnly cookie (with `next`), then
 * the browser is sent to GitHub's consent page (scope read:user).
 * 503 when GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not set.
 */
import type { APIRoute } from "astro";
import {
  authorizeUrl,
  callbackUrl,
  encodeState,
  githubConfigured,
  NOT_CONFIGURED,
  secureCookies,
  stateCookie,
} from "@/lib/server/auth";
import { authConfig } from "@/lib/server/env";
import {
  fail,
  randomToken,
  redirectWithCookies,
  STATUS,
} from "@/lib/server/http";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const config = authConfig();
  if (!githubConfigured(config)) {
    return fail(STATUS.unavailable, NOT_CONFIGURED);
  }
  const state = randomToken();
  const next = url.searchParams.get("next") ?? "/";
  return redirectWithCookies(
    authorizeUrl({
      clientId: config.clientId,
      redirectUri: callbackUrl(url.origin),
      state,
    }),
    [stateCookie(encodeState(state, next), secureCookies(url))]
  );
};
