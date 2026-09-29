/**
 * GET /api/auth/github/callback?code=&state= — GitHub sends the browser back
 * here. Checks `state` against the cookie (constant time), trades `code` for
 * an access token, reads the public profile once and forgets the token, then
 * starts a session (src/lib/server/login.ts) and goes back to the `next`
 * path saved in the state cookie (same-site paths only).
 */
import type { APIRoute } from "astro";
import {
  callbackUrl,
  checkState,
  clearStateCookie,
  githubConfigured,
  NOT_CONFIGURED,
  STATE_COOKIE,
  secureCookies,
} from "@/lib/server/auth";
import { authConfig, database } from "@/lib/server/env";
import { exchangeCode, fetchGithubUser } from "@/lib/server/github";
import {
  fail,
  htmlMessage,
  readCookie,
  redirectWithCookies,
  STATUS,
} from "@/lib/server/http";
import { finishLogin } from "@/lib/server/login";

export const prerender = false;

/** GitHub codes are short; anything longer is not one. */
const MAX_CODE = 100;

export const GET: APIRoute = async ({ request, url }) => {
  const config = authConfig();
  if (!githubConfigured(config)) {
    return fail(STATUS.unavailable, NOT_CONFIGURED);
  }
  const secure = secureCookies(url);
  const clear = [clearStateCookie(secure)];
  const state = checkState(
    readCookie(request.headers.get("cookie"), STATE_COOKIE),
    url.searchParams.get("state")
  );
  if (!state.ok) {
    return htmlMessage(
      STATUS.badRequest,
      "这次登录的请求过期了或者对不上。回到页面，再点一次「用 GitHub 登录」。",
      "/",
      clear
    );
  }
  // Cancelled on GitHub: just go back.
  if (url.searchParams.has("error")) {
    return redirectWithCookies(state.next, clear);
  }
  const code = url.searchParams.get("code") ?? "";
  if (!code || code.length > MAX_CODE) {
    return htmlMessage(
      STATUS.badRequest,
      "GitHub 没有带回登录凭据，再试一次吧。",
      state.next,
      clear
    );
  }
  const token = await exchangeCode({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code,
    redirectUri: callbackUrl(url.origin),
  });
  if (!token.ok) {
    return htmlMessage(STATUS.badGateway, token.message, state.next, clear);
  }
  // The access token is used for this one request and never stored.
  const profile = await fetchGithubUser(token.value);
  if (!profile.ok) {
    return htmlMessage(STATUS.badGateway, profile.message, state.next, clear);
  }
  return finishLogin(database(), {
    request,
    profile: profile.value,
    next: state.next,
    now: Date.now(),
  });
};
