/**
 * The only module that touches Worker bindings and secrets. API routes and
 * the admin page read configuration through here, so everything else in
 * src/lib/server stays pure and testable.
 */
import { getSecret } from "astro:env/server";
import { env } from "cloudflare:workers";
import type { AccessConfig } from "./access";
import { type AuthConfig, ownerIdOf } from "./auth";
import { createModerator } from "./moderation";
import { resolveViewer } from "./session";

export const database = () => env.DB;

export const stickerBucket = () => env.STICKERS;

/** Optional extra vars (not in the astro:env schema; see .dev.vars.example). */
type OptionalVars = {
  ADMIN_DEV_BYPASS?: string;
  TURNSTILE_SITE_KEY?: string;
  IP_HASH_SALT?: string;
  MODERATOR?: string;
  /** GitHub OAuth App (optional login). The client id is public. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Numeric GitHub id of the owner (博主 stamp, 整理贴纸). */
  OWNER_GITHUB_ID?: string;
  /** Local testing: /api/auth/dev-login (localhost only). */
  AUTH_DEV_LOGIN?: string;
};

const optionalVars = (): OptionalVars => env;

export const turnstileSecret = () => getSecret("TURNSTILE_SECRET_KEY");

/** Public Turnstile site key served to the browser at runtime (wrangler.jsonc vars / .dev.vars). */
export const turnstileSiteKey = () => optionalVars().TURNSTILE_SITE_KEY ?? "";

export const accessConfig = (): AccessConfig => ({
  teamDomain: getSecret("ACCESS_TEAM_DOMAIN"),
  aud: getSecret("ACCESS_AUD"),
  devBypass: optionalVars().ADMIN_DEV_BYPASS === "1",
});

/**
 * Salt for ip_hash and email_hash. IP_HASH_SALT if set, else the Turnstile
 * secret (already a secret the site needs), so hashes cannot be brute-forced
 * from the database.
 */
export const ipSalt = () =>
  optionalVars().IP_HASH_SALT || turnstileSecret() || "local-dev";

/** See moderation.ts for how to switch on the AI moderator. */
export const moderator = () =>
  createModerator({ mode: optionalVars().MODERATOR });

/** GitHub login settings; see src/lib/server/auth.ts. */
export const authConfig = (): AuthConfig => {
  const vars = optionalVars();
  return {
    clientId: vars.GITHUB_CLIENT_ID?.trim() ?? "",
    clientSecret: vars.GITHUB_CLIENT_SECRET?.trim() ?? "",
    ownerId: ownerIdOf(vars.OWNER_GITHUB_ID),
    devLogin: vars.AUTH_DEV_LOGIN === "1" || vars.ADMIN_DEV_BYPASS === "1",
  };
};

/** The logged-in GitHub user behind the request's `sid` cookie, if any. */
export const viewerOf = (request: Request) =>
  resolveViewer(
    database(),
    request.headers.get("cookie"),
    authConfig().ownerId,
    Date.now()
  );
