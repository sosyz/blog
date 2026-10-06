// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { beforeAll, describe, expect, test } from "bun:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";
import { checkAdmin, readAccessToken } from "../src/lib/server/access";

const TEAM = "myteam.cloudflareaccess.com";
const AUD = "aud-tag";
let privateKey: CryptoKey;
let keySet: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  ({ privateKey } = pair);
  const jwk = { ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "k1" };
  keySet = createLocalJWKSet({ keys: [jwk] });
});

const sign = (claims: { iss?: string; aud?: string; email?: string }) =>
  new SignJWT({ email: claims.email ?? "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(claims.iss ?? `https://${TEAM}`)
    .setAudience(claims.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

const request = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

describe("checkAdmin", () => {
  test("not configured → 503", async () => {
    expect(
      await checkAdmin(request("https://blog.sonui.cn/admin/"), {})
    ).toMatchObject({ ok: false, status: 503 });
  });

  test("dev bypass works only on localhost", async () => {
    const local = await checkAdmin(request("http://localhost:4321/admin/"), {
      devBypass: true,
    });
    expect(local).toEqual({
      bypass: true,
      email: "dev-bypass@localhost",
      ok: true,
    });
    const prod = await checkAdmin(request("https://blog.sonui.cn/admin/"), {
      devBypass: true,
    });
    expect(prod.ok).toBe(false);
  });

  test("valid header token → admin email", async () => {
    const token = await sign({});
    const result = await checkAdmin(
      request("https://blog.sonui.cn/admin/", {
        "cf-access-jwt-assertion": token,
      }),
      { aud: AUD, keySet, teamDomain: TEAM }
    );
    expect(result).toEqual({
      bypass: false,
      email: "owner@example.com",
      ok: true,
    });
  });

  test("CF_Authorization cookie is accepted too", async () => {
    const token = await sign({});
    const req = request("https://blog.sonui.cn/api/stickers/x/image", {
      cookie: `a=1; CF_Authorization=${token}`,
    });
    expect(readAccessToken(req)).toBe(token);
    expect(
      (
        await checkAdmin(req, {
          aud: AUD,
          keySet,
          teamDomain: `https://${TEAM}/`,
        })
      ).ok
    ).toBe(true);
  });

  test("missing token → 401; wrong audience or issuer → 403", async () => {
    const config = { aud: AUD, keySet, teamDomain: TEAM };
    expect(
      await checkAdmin(request("https://blog.sonui.cn/admin/"), config)
    ).toMatchObject({ status: 401 });
    for (const claims of [
      { aud: "other" },
      { iss: "https://evil.cloudflareaccess.com" },
    ]) {
      const token = await sign(claims);
      const result = await checkAdmin(
        request("https://blog.sonui.cn/admin/", {
          "cf-access-jwt-assertion": token,
        }),
        config
      );
      expect(result).toMatchObject({ ok: false, status: 403 });
    }
  });
});
