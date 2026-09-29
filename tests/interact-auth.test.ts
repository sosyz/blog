// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import type { PublicUser } from "../src/lib/server/types";
import {
  ANONYMOUS,
  type AuthState,
  authBarHtml,
  avatarSrc,
  loginHref,
  nextPath,
} from "../src/scripts/interact/auth";
import {
  avatarHtml,
  commenterHtml,
  ownerStampHtml,
} from "../src/scripts/interact/comment-view";

const USER: PublicUser = {
  login: "octo-cat",
  name: "Octo <Cat>",
  avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
  htmlUrl: "https://github.com/octo-cat",
};

const TITLE_ID = /aria-labelledby="([^"]+)"/;

const OFFERED: AuthState = { ...ANONYMOUS, enabled: true, login: "github" };
const IN: AuthState = { ...OFFERED, user: USER };

describe("avatarSrc", () => {
  test("appends s with & when the URL has a query", () => {
    expect(avatarSrc(USER.avatarUrl, 64)).toBe(
      "https://avatars.githubusercontent.com/u/583231?v=4&s=64"
    );
  });

  test("adds ?s= when there is no query", () => {
    expect(avatarSrc("https://avatars.githubusercontent.com/u/1", 64)).toBe(
      "https://avatars.githubusercontent.com/u/1?s=64"
    );
  });

  test("replaces an existing size", () => {
    expect(
      avatarSrc("https://avatars.githubusercontent.com/u/1?s=460&v=4", 64)
    ).toBe("https://avatars.githubusercontent.com/u/1?s=64&v=4");
  });

  test("leaves an unparsable URL alone", () => {
    expect(avatarSrc("not a url", 64)).toBe("not a url");
  });
});

describe("nextPath and loginHref", () => {
  test("keeps path, query and the given hash", () => {
    expect(nextPath({ pathname: "/notes/go-context/" }, "#comments")).toBe(
      "/notes/go-context/#comments"
    );
    expect(nextPath({ pathname: "/list/", search: "?topic=AI" }, "")).toBe(
      "/list/?topic=AI"
    );
  });

  test("encodes next for the GitHub login route", () => {
    expect(loginHref(OFFERED, "/notes/a/#comments")).toBe(
      "/api/auth/github/login?next=%2Fnotes%2Fa%2F%23comments"
    );
  });

  test("uses the dev login when the server offers it", () => {
    expect(loginHref({ login: "dev" }, "/")).toBe(
      "/api/auth/dev-login?next=%2F"
    );
  });
});

describe("authBarHtml", () => {
  const options = { next: "/notes/a/#comments", verb: "留言" };

  test("shows nothing when login is not enabled", () => {
    expect(authBarHtml(ANONYMOUS, options)).toBe("");
  });

  test("logged out: GitHub link with a titled mark and the nickname hint", () => {
    const html = authBarHtml(OFFERED, options);
    expect(html).toContain(
      'href="/api/auth/github/login?next=%2Fnotes%2Fa%2F%23comments"'
    );
    expect(html).toContain("<title");
    expect(html).toContain(">GitHub</title>");
    expect(html).toContain("用 GitHub 登录");
    expect(html).toContain("或者直接填昵称");
  });

  test("each logged-out bar gets its own title id", () => {
    const ids = [authBarHtml(OFFERED, options), authBarHtml(OFFERED, options)]
      .map((html) => TITLE_ID.exec(html)?.[1])
      .filter(Boolean);
    expect(new Set(ids).size).toBe(2);
  });

  test("logged in: avatar, profile link, verb and 退出", () => {
    const html = authBarHtml(IN, { ...options, verb: "贴贴纸" });
    expect(html).toContain(
      'src="https://avatars.githubusercontent.com/u/583231?v=4&amp;s=64"'
    );
    expect(html).toContain('alt=""');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain(
      '<a href="https://github.com/octo-cat" rel="nofollow ugc noopener" target="_blank">octo-cat</a>'
    );
    expect(html).toContain("的身份贴贴纸");
    expect(html).toContain('type="button" class="auth-out" data-auth-logout');
    expect(html).not.toContain("用 GitHub 登录");
  });
});

describe("comment view", () => {
  test("GitHub commenter: lazy avatar in the circle, name links to profile", () => {
    const avatar = avatarHtml({ name: "octo-cat", user: USER });
    expect(avatar).toContain('class="cmt-av has-img"');
    expect(avatar).toContain('loading="lazy"');
    expect(avatar).toContain('referrerpolicy="no-referrer"');
    expect(avatar).toContain('alt=""');
    expect(avatar).toContain("v=4&amp;s=64");
    const name = commenterHtml({ name: "octo-cat", site: null, user: USER });
    expect(name).toContain(
      'href="https://github.com/octo-cat" rel="nofollow ugc noopener"'
    );
    expect(name).toContain("Octo &lt;Cat&gt;");
    expect(name).toContain("@octo-cat");
  });

  test("login shown once when there is no display name", () => {
    const name = commenterHtml({
      name: "octo-cat",
      site: null,
      user: { ...USER, name: null },
    });
    expect(name).toContain(">octo-cat</a>");
    expect(name).not.toContain("cmt-login");
  });

  test("anonymous commenter unchanged: initial and site link", () => {
    expect(avatarHtml({ name: "小明", user: null })).toContain(">小</span>");
    expect(
      commenterHtml({ name: "小明", site: "https://example.com", user: null })
    ).toBe(
      '<a href="https://example.com" rel="nofollow ugc noopener" target="_blank">小明</a>'
    );
    expect(commenterHtml({ name: "小明", site: null })).toBe("小明");
  });

  test("博主 stamp only for the owner's GitHub comments", () => {
    expect(ownerStampHtml({ user: USER, isOwner: true })).toContain("博主");
    expect(ownerStampHtml({ user: USER, isOwner: false })).toBe("");
    expect(ownerStampHtml({ user: null, isOwner: true })).toBe("");
  });
});
