/**
 * GET /api/auth/dev-login?login=&id=&next= — local testing without a real
 * GitHub OAuth App: logs in as a made-up GitHub account (`id` is the numeric
 * GitHub id, so `id=<OWNER_GITHUB_ID>` tests the owner).
 *
 * Works ONLY when AUTH_DEV_LOGIN=1 or ADMIN_DEV_BYPASS=1 AND the request is for
 * localhost / 127.0.0.1 (src/lib/server/auth.ts devLoginAllowed); anywhere
 * else it is a plain 404. Never set these flags in production.
 */
import type { APIRoute } from "astro";
import { devLoginAllowed } from "@/lib/server/auth";
import { authConfig, database } from "@/lib/server/env";
import { devProfile } from "@/lib/server/github";
import { fail, STATUS } from "@/lib/server/http";
import { finishLogin } from "@/lib/server/login";
import { devLoginInput, firstIssue } from "@/lib/server/validate";

export const prerender = false;

const DEFAULT_LOGIN = "dev-visitor";
const DEFAULT_ID = "10000001";

export const GET: APIRoute = ({ request, url }) => {
  if (!devLoginAllowed(request, authConfig())) {
    return fail(STATUS.notFound, "没有这个地址。");
  }
  const parsed = devLoginInput.safeParse({
    id: url.searchParams.get("id") ?? DEFAULT_ID,
    login: url.searchParams.get("login") ?? DEFAULT_LOGIN,
  });
  if (!parsed.success) {
    return fail(STATUS.badRequest, firstIssue(parsed.error));
  }
  return finishLogin(database(), {
    next: url.searchParams.get("next") ?? "/",
    now: Date.now(),
    profile: devProfile(parsed.data.id, parsed.data.login),
    request,
  });
};
