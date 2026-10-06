import { describe, expect, test } from "bun:test";
import { type CommentRow, toPublicComment } from "@/lib/server/db";
import {
  commentAuthor,
  listCacheHeaders,
  moveActor,
  needsTurnstile,
} from "@/lib/server/visitor";

const PUBLIC = "public, max-age=60, s-maxage=300";
const PRIVATE_FIELDS = /email|ip_?hash|github_?id|"ua"/i;
const OTHER_USER = 7;

describe("listCacheHeaders", () => {
  test("only the plain anonymous list is shared", () => {
    expect(
      listCacheHeaders({ me: false, mine: false, session: false }, PUBLIC)
    ).toEqual({ "cache-control": PUBLIC, vary: "Cookie" });
  });

  test("mine=, me=1 or a session make it private", () => {
    const cases = [
      { me: false, mine: true, session: false },
      { me: true, mine: false, session: false },
      { me: false, mine: false, session: true },
      { me: true, mine: true, session: true },
    ];
    for (const input of cases) {
      expect(listCacheHeaders(input, PUBLIC)).toEqual({
        "cache-control": "private, no-store",
        vary: "Cookie",
      });
    }
  });
});

describe("commentAuthor", () => {
  const user = {
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
    htmlUrl: "https://github.com/octocat",
    login: "octocat",
    name: "The Octocat",
  };
  const form = {
    email: "a@example.com",
    name: "冒充者",
    site: "https://evil.example",
  };

  test("logged in: the account is the author, form fields are ignored", () => {
    expect(commentAuthor(user, form)).toEqual({
      email: null,
      name: "The Octocat",
      site: "https://github.com/octocat",
    });
  });

  test("logged in without a display name: the login", () => {
    expect(commentAuthor({ ...user, name: null }, {}).name).toBe("octocat");
    expect(commentAuthor({ ...user, name: "" }, {}).name).toBe("octocat");
  });

  test("anonymous: the nickname form", () => {
    expect(commentAuthor(null, form)).toEqual({
      email: "a@example.com",
      name: "冒充者",
      site: "https://evil.example",
    });
    expect(commentAuthor(null, { name: "路人" })).toEqual({
      email: null,
      name: "路人",
      site: null,
    });
  });
});

describe("needsTurnstile", () => {
  test("skipped only with a valid session", () => {
    expect(needsTurnstile(true)).toBe(false);
    expect(needsTurnstile(false)).toBe(true);
  });
});

describe("moveActor", () => {
  test("the log says who moved the sticker", () => {
    expect(moveActor("token", undefined)).toEqual({
      actor: "visitor:owner",
      label: "编辑口令",
    });
    expect(moveActor("account", "octocat")).toEqual({
      actor: "user:octocat",
      label: "GitHub @octocat",
    });
    expect(moveActor("owner", "sonui")).toEqual({
      actor: "owner:github:sonui",
      label: "博主整理贴纸",
    });
  });
});

describe("toPublicComment", () => {
  const OWNER = 42;
  const base: CommentRow = {
    anchor_exact: null,
    anchor_prefix: null,
    author_avatar: null,
    author_github_id: null,
    author_html: null,
    author_login: null,
    author_name: null,
    body: "你好",
    created_at: 1000,
    id: "c1",
    kind: "comment",
    name: "路人",
    owner_reply: null,
    owner_reply_at: null,
    parent_id: null,
    site: "https://example.com",
  };
  const withUser = (githubId: number, name: string | null): CommentRow => ({
    ...base,
    author_avatar: "https://avatars.githubusercontent.com/u/1",
    author_github_id: githubId,
    author_html: "https://github.com/octocat",
    author_login: "octocat",
    author_name: name,
    name: "stored",
    site: null,
  });

  test("a nickname comment has no user and is never the owner", () => {
    const comment = toPublicComment(base, OWNER);
    expect(comment.user).toBeNull();
    expect(comment.isOwner).toBe(false);
    expect(comment.name).toBe("路人");
    expect(comment.site).toBe("https://example.com");
  });

  test("a GitHub comment carries the current public profile", () => {
    const comment = toPublicComment(withUser(OTHER_USER, "The Octocat"), OWNER);
    expect(comment.user).toEqual({
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
      htmlUrl: "https://github.com/octocat",
      login: "octocat",
      name: "The Octocat",
    });
    expect(comment.isOwner).toBe(false);
    expect(comment.name).toBe("The Octocat");
    expect(comment.site).toBe("https://github.com/octocat");
    expect(toPublicComment(withUser(OTHER_USER, null), OWNER).name).toBe(
      "octocat"
    );
  });

  test("isOwner by numeric GitHub id; nobody without OWNER_GITHUB_ID", () => {
    expect(toPublicComment(withUser(OWNER, null), OWNER).isOwner).toBe(true);
    expect(toPublicComment(withUser(OWNER, null), null).isOwner).toBe(false);
  });

  test("no private fields in the public shape", () => {
    const keys = Object.keys(toPublicComment(withUser(OWNER, null), OWNER));
    expect(keys.sort()).toEqual(
      [
        "anchor",
        "body",
        "createdAt",
        "id",
        "isOwner",
        "kind",
        "name",
        "parentId",
        "reply",
        "site",
        "user",
      ].sort()
    );
    expect(
      JSON.stringify(toPublicComment(withUser(OWNER, null), OWNER))
    ).not.toMatch(PRIVATE_FIELDS);
  });
});
