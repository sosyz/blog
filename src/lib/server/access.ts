/**
 * Cloudflare Access check for /admin/ and /api/admin/*.
 * https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 *
 * Access puts a signed JWT in the `Cf-Access-Jwt-Assertion` header for paths
 * inside the Access application, and in the `CF_Authorization` cookie for the
 * whole host. The header is preferred; the cookie covers requests outside the
 * application's paths (e.g. /api/stickers/:id/image for pending previews).
 *
 * Local development: with ADMIN_DEV_BYPASS=1 in .dev.vars AND a localhost
 * hostname, the check passes as "dev-bypass@localhost". Both conditions are
 * required, so a stray variable in production does nothing.
 */
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { readCookie } from "./http";

export type AccessConfig = {
  /** e.g. "myteam.cloudflareaccess.com" (with or without https://). */
  teamDomain?: string;
  /** Application Audience (AUD) tag. */
  aud?: string;
  /** ADMIN_DEV_BYPASS === "1". */
  devBypass?: boolean;
  /** Tests only: verify against these keys instead of the team's JWKS URL. */
  keySet?: JWTVerifyGetKey;
};

export type AdminCheck =
  | { ok: true; email: string; bypass: boolean }
  | { ok: false; status: number; message: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PROTOCOL = /^https?:\/\//;
const TRAILING_SLASH = /\/+$/;
const COOKIE_NAME = "CF_Authorization";

/** One JWKS fetcher per team; jose caches the keys inside it. */
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const teamOrigin = (teamDomain: string) =>
  `https://${teamDomain.trim().replace(PROTOCOL, "").replace(TRAILING_SLASH, "")}`;

const keySetFor = (origin: string) => {
  let keySet = keySets.get(origin);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${origin}/cdn-cgi/access/certs`));
    keySets.set(origin, keySet);
  }
  return keySet;
};

export const readAccessToken = (request: Request) =>
  request.headers.get("cf-access-jwt-assertion") ??
  readCookie(request.headers.get("cookie"), COOKIE_NAME);

export const isLocalRequest = (request: Request) =>
  LOCAL_HOSTS.has(new URL(request.url).hostname);

export const checkAdmin = async (
  request: Request,
  config: AccessConfig
): Promise<AdminCheck> => {
  if (config.devBypass && isLocalRequest(request)) {
    return { ok: true, email: "dev-bypass@localhost", bypass: true };
  }
  if (!(config.teamDomain && config.aud)) {
    return {
      ok: false,
      status: 503,
      message:
        "后台还没配置 Cloudflare Access（ACCESS_TEAM_DOMAIN / ACCESS_AUD）。",
    };
  }
  const token = readAccessToken(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      message: "请先通过 Cloudflare Access 登录。",
    };
  }
  const issuer = teamOrigin(config.teamDomain);
  try {
    const { payload } = await jwtVerify(
      token,
      config.keySet ?? keySetFor(issuer),
      {
        issuer,
        audience: config.aud,
        algorithms: ["RS256"],
      }
    );
    const email = typeof payload.email === "string" ? payload.email : "";
    return {
      ok: true,
      email: email || String(payload.sub ?? "admin"),
      bypass: false,
    };
  } catch {
    return { ok: false, status: 403, message: "登录已失效或无权访问后台。" };
  }
};
