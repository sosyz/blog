// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  type AuthConfig,
  authorizeUrl,
  buildCookie,
  checkState,
  clearSessionCookie,
  clearStateCookie,
  devLoginAllowed,
  encodeState,
  hashSessionToken,
  isOwnerId,
  loginMethod,
  ownerIdOf,
  REFRESH_AFTER,
  readSessionToken,
  SESSION_TTL,
  safeNext,
  secureCookies,
  sessionCookie,
  sessionStatus,
  stateCookie,
} from "../src/lib/server/auth";
import {
  devProfile,
  exchangeCode,
  fetchGithubUser,
  profileFromGithub,
} from "../src/lib/server/github";
import { randomToken, sha256Hex } from "../src/lib/server/http";
import { resolveViewer } from "../src/lib/server/session";
import {
  commentInput,
  devLoginInput,
  memberCommentInput,
  memberStickerInput,
} from "../src/lib/server/validate";

const HEX_DIGEST = /^[0-9a-f]{64}$/;
const config = (overrides: Partial<AuthConfig> = {}): AuthConfig => ({
  clientId: "",
  clientSecret: "",
  devLogin: false,
  ownerId: 30_596_875,
  ...overrides,
});
const get = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

describe("safeNext (no open redirects)", () => {
  test("keeps paths on this site, with query and hash", () => {
    expect(safeNext("/notes/go-context/#comments")).toBe(
      "/notes/go-context/#comments"
    );
    expect(safeNext("/list/?topic=Go")).toBe("/list/?topic=Go");
    expect(safeNext("/")).toBe("/");
  });

  test("anything that could leave the site becomes /", () => {
    for (const bad of [
      "https://evil.example/",
      "//evil.example/x",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "evil.example",
      "/\tevil",
      "/%0d%0aSet-Cookie:x",
      "",
      `/${"a".repeat(600)}`,
      null,
      42,
    ]) {
      const next = safeNext(bad);
      expect(next.startsWith("/")).toBe(true);
      expect(next.startsWith("//")).toBe(false);
      expect(new URL(next, "https://blog.sonui.cn").origin).toBe(
        "https://blog.sonui.cn"
      );
    }
    expect(safeNext("https://evil.example/")).toBe("/");
    expect(safeNext("//evil.example/x")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
  });

  test("never goes back to an API route", () => {
    expect(safeNext("/api/auth/logout")).toBe("/");
    expect(safeNext("/api/auth/github/login?next=/")).toBe("/");
  });
});

describe("OAuth state", () => {
  test("round trip: the matching state gives back next", () => {
    const state = randomToken();
    const cookie = encodeState(state, "/notes/go-context/#comments");
    expect(checkState(cookie, state)).toEqual({
      next: "/notes/go-context/#comments",
      ok: true,
    });
  });

  test("a different, missing or malformed state is refused", () => {
    const cookie = encodeState(randomToken(), "/");
    expect(checkState(cookie, randomToken())).toEqual({ ok: false });
    expect(checkState(undefined, randomToken())).toEqual({ ok: false });
    expect(checkState(cookie, null)).toEqual({ ok: false });
    expect(checkState(cookie, "short")).toEqual({ ok: false });
  });

  test("next is re-checked when read back from the cookie", () => {
    const state = randomToken();
    const forged = `${state}.${encodeURIComponent("//evil.example/")}`;
    expect(checkState(forged, state)).toEqual({ next: "/", ok: true });
    expect(encodeState(state, "https://evil.example/")).toBe(`${state}.%2F`);
  });

  test("authorize URL carries the expected parameters", () => {
    const url = new URL(
      authorizeUrl({
        clientId: "Iv1.abc",
        redirectUri: "https://blog.sonui.cn/api/auth/github/callback",
        state: "s",
      })
    );
    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize"
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      allow_signup: "true",
      client_id: "Iv1.abc",
      redirect_uri: "https://blog.sonui.cn/api/auth/github/callback",
      scope: "read:user",
      state: "s",
    });
  });
});

describe("cookies", () => {
  test("session cookie flags", () => {
    const token = randomToken();
    expect(sessionCookie(token, true)).toBe(
      `sid=${token}; Path=/; Max-Age=${SESSION_TTL / 1000}; HttpOnly; Secure; SameSite=Lax`
    );
    expect(sessionCookie(token, false)).not.toContain("Secure");
    expect(clearSessionCookie(true)).toBe(
      "sid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
    );
  });

  test("state cookie is short-lived and scoped to the OAuth routes", () => {
    const value = stateCookie("abc.%2F", true);
    expect(value).toContain("Path=/api/auth/github");
    expect(value).toContain("Max-Age=600");
    expect(value).toContain("HttpOnly");
    expect(value).toContain("SameSite=Lax");
    expect(clearStateCookie(false)).toContain("Max-Age=0");
  });

  test("Secure is dropped only for plain http on localhost", () => {
    expect(secureCookies(new URL("https://blog.sonui.cn/"))).toBe(true);
    expect(secureCookies(new URL("http://localhost:4321/"))).toBe(false);
    expect(secureCookies(new URL("http://127.0.0.1:4321/"))).toBe(false);
    expect(secureCookies(new URL("https://localhost:4321/"))).toBe(true);
    expect(secureCookies(new URL("http://blog.sonui.cn/"))).toBe(true);
  });

  test("buildCookie never goes below Max-Age 0", () => {
    expect(
      buildCookie("a", "b", { maxAge: -5, path: "/", secure: false })
    ).toBe("a=b; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  });
});

describe("sessions", () => {
  test("only well-formed tokens are read from the cookie", () => {
    const token = randomToken();
    expect(readSessionToken(`a=1; sid=${token}; b=2`)).toBe(token);
    expect(readSessionToken("sid=not-a-token")).toBeNull();
    expect(readSessionToken(null)).toBeNull();
  });

  test("the stored id is the sha256 of the token, not the token", async () => {
    const token = randomToken();
    const id = await hashSessionToken(token);
    expect(id).toMatch(HEX_DIGEST);
    expect(id).toBe(await sha256Hex(token));
    expect(id).not.toContain(token);
    expect(await hashSessionToken(randomToken())).not.toBe(id);
  });

  test("expiry and the daily sliding refresh", () => {
    const now = 1_000_000_000_000;
    expect(sessionStatus({ expires_at: now, last_seen_at: now }, now)).toBe(
      "expired"
    );
    expect(
      sessionStatus({ expires_at: now + 1, last_seen_at: now - 1000 }, now)
    ).toBe("fresh");
    expect(
      sessionStatus(
        { expires_at: now + SESSION_TTL, last_seen_at: now - REFRESH_AFTER },
        now
      )
    ).toBe("stale");
  });
});

/** A D1 stand-in that answers every first() with `row`. */
const fakeDb = (row: unknown) => {
  const queries: string[] = [];
  const db = {
    prepare: (sql: string) => {
      queries.push(sql);
      return { bind: () => ({ first: () => Promise.resolve(row) }) };
    },
  } as unknown as D1Database;
  return { db, queries };
};

describe("resolveViewer", () => {
  const now = 1_000_000_000_000;
  const row = (githubId: number, lastSeen = now) => ({
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    expires_at: now + SESSION_TTL,
    github_id: githubId,
    html_url: "https://github.com/someone",
    last_seen_at: lastSeen,
    login: "someone",
    name: null,
    user_id: "u1",
  });

  test("no cookie: nobody, and no database read", async () => {
    const { db, queries } = fakeDb(null);
    expect(await resolveViewer(db, null, 1, now)).toEqual({
      clearCookie: false,
      viewer: null,
    });
    expect(queries).toHaveLength(0);
  });

  test("a malformed or unknown sid is cleared", async () => {
    const bad = await resolveViewer(fakeDb(null).db, "sid=nope", 1, now);
    expect(bad).toEqual({ clearCookie: true, viewer: null });
    const unknown = await resolveViewer(
      fakeDb(null).db,
      `sid=${randomToken()}`,
      1,
      now
    );
    expect(unknown).toEqual({ clearCookie: true, viewer: null });
  });

  test("owner detection is by numeric GitHub id", async () => {
    const cookie = `sid=${randomToken()}`;
    const owner = await resolveViewer(
      fakeDb(row(30_596_875)).db,
      cookie,
      30_596_875,
      now
    );
    expect(owner.viewer?.isOwner).toBe(true);
    const visitor = await resolveViewer(
      fakeDb(row(42)).db,
      cookie,
      30_596_875,
      now
    );
    expect(visitor.viewer?.isOwner).toBe(false);
    expect(visitor.viewer?.user).toEqual({
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      htmlUrl: "https://github.com/someone",
      login: "someone",
      name: null,
    });
    const noOwner = await resolveViewer(fakeDb(row(42)).db, cookie, null, now);
    expect(noOwner.viewer?.isOwner).toBe(false);
  });

  test("expired sessions log out; old ones are marked for refresh", async () => {
    const cookie = `sid=${randomToken()}`;
    const expired = await resolveViewer(
      fakeDb({ ...row(1), expires_at: now - 1 }).db,
      cookie,
      null,
      now
    );
    expect(expired).toEqual({ clearCookie: true, viewer: null });
    const stale = await resolveViewer(
      fakeDb(row(1, now - REFRESH_AFTER - 1)).db,
      cookie,
      null,
      now
    );
    expect(stale.viewer?.stale).toBe(true);
  });
});

describe("owner and dev login", () => {
  test("OWNER_GITHUB_ID must be a positive number", () => {
    expect(ownerIdOf("30596875")).toBe(30_596_875);
    expect(ownerIdOf(" 30596875 ")).toBe(30_596_875);
    for (const bad of [undefined, "", "sosyz", "-1", "0", "1e5", "12.5"]) {
      expect(ownerIdOf(bad)).toBeNull();
    }
    expect(isOwnerId(30_596_875, 30_596_875)).toBe(true);
    expect(isOwnerId(1, 30_596_875)).toBe(false);
    expect(isOwnerId(30_596_875, null)).toBe(false);
  });

  test("dev login needs the flag AND localhost", () => {
    const on = config({ devLogin: true });
    expect(
      devLoginAllowed(get("http://localhost:4321/api/auth/dev-login"), on)
    ).toBe(true);
    expect(
      devLoginAllowed(get("http://127.0.0.1:4321/api/auth/dev-login"), on)
    ).toBe(true);
    // Flag set by mistake in production: refused.
    expect(
      devLoginAllowed(get("https://blog.sonui.cn/api/auth/dev-login"), on)
    ).toBe(false);
    expect(
      devLoginAllowed(
        get("https://sonui-blog.example.workers.dev/api/auth/dev-login"),
        on
      )
    ).toBe(false);
    // Localhost without the flag: refused.
    expect(
      devLoginAllowed(get("http://localhost:4321/api/auth/dev-login"), config())
    ).toBe(false);
  });

  test("which login the pages offer", () => {
    const local = get("http://localhost:4321/api/auth/me");
    const live = get("https://blog.sonui.cn/api/auth/me");
    const github = config({ clientId: "id", clientSecret: "secret" });
    expect(loginMethod(live, github)).toBe("github");
    expect(loginMethod(live, config({ clientId: "id" }))).toBeNull();
    expect(loginMethod(local, config({ devLogin: true }))).toBe("dev");
    expect(loginMethod(live, config({ devLogin: true }))).toBeNull();
  });

  test("dev login input", () => {
    expect(devLoginInput.parse({ id: "30596875", login: "sosyz" })).toEqual({
      id: 30_596_875,
      login: "sosyz",
    });
    expect(devLoginInput.safeParse({ id: "1", login: "-bad" }).success).toBe(
      false
    );
    expect(devLoginInput.safeParse({ id: "0", login: "ok" }).success).toBe(
      false
    );
    expect(devLoginInput.safeParse({ id: "x1", login: "ok" }).success).toBe(
      false
    );
  });
});

describe("GitHub profile", () => {
  const payload = {
    avatar_url: "https://avatars.githubusercontent.com/u/30596875?v=4",
    email: "secret@example.com",
    html_url: "https://evil.example/sosyz",
    id: 30_596_875,
    login: "sosyz",
    name: " Sonui‮ ",
  };

  test("keeps only public fields, cleans the name, builds the profile URL", () => {
    expect(profileFromGithub(payload)).toEqual({
      avatarUrl: "https://avatars.githubusercontent.com/u/30596875?v=4",
      githubId: 30_596_875,
      htmlUrl: "https://github.com/sosyz",
      login: "sosyz",
      name: "Sonui",
    });
  });

  test("avatars only from GitHub's avatar host", () => {
    const profile = profileFromGithub({
      ...payload,
      avatar_url: "http://tracker.example/pixel.gif",
    });
    expect(profile?.avatarUrl).toBe(
      "https://avatars.githubusercontent.com/u/30596875?v=4"
    );
  });

  test("rejects payloads that are not a user", () => {
    expect(profileFromGithub({ ...payload, login: "a b" })).toBeNull();
    expect(profileFromGithub({ ...payload, id: -1 })).toBeNull();
    expect(profileFromGithub({ ...payload, login: "x".repeat(40) })).toBeNull();
    expect(profileFromGithub(null)).toBeNull();
    expect(profileFromGithub({ ...payload, name: null })?.name).toBeNull();
  });

  test("dev profile looks like a real one", () => {
    expect(devProfile(7, "someone")).toEqual({
      avatarUrl: "https://avatars.githubusercontent.com/u/7?v=4",
      githubId: 7,
      htmlUrl: "https://github.com/someone",
      login: "someone",
      name: "someone",
    });
  });
});

describe("GitHub HTTP calls (fake fetch)", () => {
  const answer = (body: unknown, status = 200, seen: Request[] = []) =>
    ((input: string, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return Promise.resolve(Response.json(body, { status }));
    }) as unknown as typeof fetch;

  test("exchangeCode asks for JSON and returns the token", async () => {
    const seen: Request[] = [];
    const result = await exchangeCode({
      clientId: "id",
      clientSecret: "secret",
      code: "abc",
      fetchFn: answer(
        { access_token: "gho_x", token_type: "bearer" },
        200,
        seen
      ),
      redirectUri: "https://blog.sonui.cn/api/auth/github/callback",
    });
    expect(result).toEqual({ ok: true, value: "gho_x" });
    const [request] = seen;
    expect(request?.headers.get("accept")).toBe("application/json");
    expect(request?.headers.get("user-agent")).toBe("sonui-blog");
    expect((await request?.json()) as unknown).toEqual({
      client_id: "id",
      client_secret: "secret",
      code: "abc",
      redirect_uri: "https://blog.sonui.cn/api/auth/github/callback",
    });
  });

  test("exchangeCode reports GitHub errors and network failures", async () => {
    const base = {
      clientId: "id",
      clientSecret: "secret",
      code: "abc",
      redirectUri: "x",
    };
    const refused = await exchangeCode({
      ...base,
      fetchFn: answer({ error: "bad_verification_code" }),
    });
    expect(refused.ok).toBe(false);
    const offline = await exchangeCode({
      ...base,
      fetchFn: (() =>
        Promise.reject(new Error("offline"))) as unknown as typeof fetch,
    });
    expect(offline.ok).toBe(false);
  });

  test("fetchGithubUser sends the token and a User-Agent", async () => {
    const seen: Request[] = [];
    const result = await fetchGithubUser(
      "gho_x",
      answer(
        { avatar_url: null, id: 1, login: "someone", name: null },
        200,
        seen
      )
    );
    expect(result.ok && result.value.login).toBe("someone");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer gho_x");
    expect(seen[0]?.headers.get("user-agent")).toBe("sonui-blog");
    const denied = await fetchGithubUser("x", answer({ message: "no" }, 401));
    expect(denied.ok).toBe(false);
  });
});

describe("logged-in forms need no name or Turnstile", () => {
  test("member comments drop the anonymous-only fields", () => {
    const parsed = memberCommentInput.parse({
      body: "你好",
      kind: "comment",
      name: "someone else",
      site: "https://evil.example",
      slug: "go-context",
      turnstile: "x",
    });
    expect(parsed).toEqual({
      body: "你好",
      kind: "comment",
      parentId: undefined,
      slug: "go-context",
    });
    expect(
      commentInput.safeParse({
        body: "你好",
        kind: "comment",
        slug: "go-context",
      }).success
    ).toBe(false);
  });

  test("member stickers need only the placement", () => {
    expect(
      memberStickerInput.parse({ rotation: "", scale: "", x: "1", y: "2" })
    ).toEqual({ rotation: 0, scale: 1, x: 1, y: 2 });
  });
});
