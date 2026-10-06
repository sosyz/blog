/**
 * GitHub OAuth calls for the optional login: trade the callback `code` for an
 * access token, read the public profile once, then forget the token.
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
 *
 * Pure apart from `fetch`, which can be injected for tests. Only the public
 * profile is kept (id, login, name, avatar, profile URL); never the e-mail.
 */
import { z } from "astro/zod";
import { cleanLine, GITHUB_LOGIN } from "./validate";

const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const USER_AGENT = "sonui-blog";
const AVATAR_HOST = "avatars.githubusercontent.com";
/** Display names are cut to this many characters. */
const NAME_MAX = 60;

export interface GithubProfile {
  avatarUrl: string;
  githubId: number;
  htmlUrl: string;
  login: string;
  name: string | null;
}

const userPayload = z.object({
  avatar_url: z.string().nullish(),
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  login: z.string().regex(GITHUB_LOGIN),
  name: z.string().nullish(),
});

const fallbackAvatar = (id: number) => `https://${AVATAR_HOST}/u/${id}?v=4`;

/** Only GitHub's own avatar host over https; anything else → the default URL. */
const avatarOf = (raw: string | null | undefined, id: number) => {
  try {
    const url = new URL(raw ?? "");
    if (url.protocol === "https:" && url.hostname === AVATAR_HOST) {
      return url.toString();
    }
  } catch {
    // Not a URL: use the default.
  }
  return fallbackAvatar(id);
};

/**
 * The public profile from a GitHub /user response (or null when it does not
 * look like one). The profile URL is built from the login rather than
 * trusted from the payload.
 */
export const profileFromGithub = (raw: unknown): GithubProfile | null => {
  const parsed = userPayload.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const { id, login, name, avatar_url } = parsed.data;
  const shownName = [...cleanLine(name ?? "")].slice(0, NAME_MAX).join("");
  return {
    avatarUrl: avatarOf(avatar_url, id),
    githubId: id,
    htmlUrl: `https://github.com/${login}`,
    login,
    name: shownName || null,
  };
};

/** The profile the local dev login pretends to have. */
export const devProfile = (githubId: number, login: string): GithubProfile => ({
  avatarUrl: fallbackAvatar(githubId),
  githubId,
  htmlUrl: `https://github.com/${login}`,
  login,
  name: login,
});

export type GithubResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const tokenPayload = z.object({ access_token: z.string().min(1) });

/** Trades the one-time `code` for an access token (used once, then dropped). */
export const exchangeCode = async (options: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchFn?: typeof fetch;
}): Promise<GithubResult<string>> => {
  const { fetchFn = fetch } = options;
  try {
    const response = await fetchFn(TOKEN_URL, {
      body: JSON.stringify({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code: options.code,
        redirect_uri: options.redirectUri,
      }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      method: "POST",
    });
    const parsed = tokenPayload.safeParse(await response.json());
    if (!(response.ok && parsed.success)) {
      return { message: "GitHub 没有确认这次登录，再试一次吧。", ok: false };
    }
    return { ok: true, value: parsed.data.access_token };
  } catch {
    return { message: "暂时连不上 GitHub，过一会儿再试。", ok: false };
  }
};

/** Reads the public profile of the user the token belongs to. */
export const fetchGithubUser = async (
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<GithubResult<GithubProfile>> => {
  try {
    const response = await fetchFn(USER_URL, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": USER_AGENT,
        "x-github-api-version": "2022-11-28",
      },
    });
    const profile = response.ok
      ? profileFromGithub(await response.json())
      : null;
    if (!profile) {
      return { message: "没能读到你的 GitHub 资料，再试一次吧。", ok: false };
    }
    return { ok: true, value: profile };
  } catch {
    return { message: "暂时连不上 GitHub，过一会儿再试。", ok: false };
  }
};
