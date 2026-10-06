import { describe, expect, test } from "bun:test";
import { FRIEND_LINKS } from "../src/data/links";
import {
  CANVAS_FRIENDS,
  checkedLinks,
  displayHost,
  type FriendLink,
  friendInitial,
  friendInk,
  linkProblems,
  linksJsonLd,
  MAX_DESCRIPTION_LENGTH,
  SELF_CARD,
} from "../src/lib/links";

const HTTPS_THEN_DESCRIPTION = /https:\/\/[\s\S]*description/;
const SHOWN_ON_CANVAS = 6;

const friend = (overrides: Partial<FriendLink> = {}): FriendLink => ({
  description: "写 Rust 和摄影。",
  name: "小明的博客",
  url: "https://xiaoming.example/",
  ...overrides,
});

describe("friend link data", () => {
  test("the shipped list passes the build check", () => {
    expect(linkProblems(FRIEND_LINKS)).toEqual([]);
    expect(checkedLinks(FRIEND_LINKS)).toBe(FRIEND_LINKS);
  });

  test("a complete entry has no problems", () => {
    expect(
      linkProblems([
        friend({ avatar: "xiaoming.webp", since: "2026-10-01" }),
        friend({ name: "B", since: "2026-10", url: "https://b.example/blog" }),
      ])
    ).toEqual([]);
  });

  test("only https URLs", () => {
    for (const url of [
      "http://xiaoming.example/",
      "ftp://xiaoming.example/",
      "javascript:alert(1)",
    ]) {
      expect(linkProblems([friend({ url })]).join()).toContain("https://");
    }
    expect(
      linkProblems([friend({ url: "xiaoming.example" })]).join()
    ).toContain("完整的网址");
    expect(
      linkProblems([friend({ url: "https://user:pw@xiaoming.example/" })])
    ).toHaveLength(1);
  });

  test("this site is not its own friend", () => {
    expect(
      linkProblems([friend({ url: "https://blog.sonui.cn/" })]).join()
    ).toContain("本站");
  });

  test("names are unique, ignoring case and spaces", () => {
    const problems = linkProblems([
      friend({ name: "Alice" }),
      friend({ name: " alice ", url: "https://other.example/" }),
    ]);
    expect(problems).toEqual(["第 2 条（ alice ）：name 和第 1 条重复"]);
  });

  test("the same site written twice is caught", () => {
    const problems = linkProblems([
      friend({ name: "A", url: "https://www.Same.example/blog/" }),
      friend({ name: "B", url: "https://same.example/blog" }),
    ]);
    expect(problems).toEqual(["第 2 条（B）：url 和第 1 条是同一个网站"]);
  });

  test("description is one short line", () => {
    expect(linkProblems([friend({ description: " " })])).toHaveLength(1);
    expect(
      linkProblems([
        friend({ description: "字".repeat(MAX_DESCRIPTION_LENGTH + 1) }),
      ]).join()
    ).toContain(String(MAX_DESCRIPTION_LENGTH));
    expect(linkProblems([friend({ description: "一\n二" })])).toHaveLength(1);
    expect(
      linkProblems([
        friend({ description: "字".repeat(MAX_DESCRIPTION_LENGTH) }),
      ])
    ).toEqual([]);
  });

  test("avatar is a file name in src/assets/links/", () => {
    for (const avatar of [
      "https://x.example/a.png",
      "../a.png",
      "A.PNG",
      "a.gif",
    ]) {
      expect(linkProblems([friend({ avatar })])).toHaveLength(1);
    }
  });

  test("since is a real month or day", () => {
    for (const since of ["2026", "2026-13", "2026-10-32", "26-10-01"]) {
      expect(linkProblems([friend({ since })])).toHaveLength(1);
    }
  });

  test("checkedLinks fails the build with every problem listed", () => {
    expect(() =>
      checkedLinks([friend({ description: "", url: "http://a.example/" })])
    ).toThrow(HTTPS_THEN_DESCRIPTION);
  });
});

describe("friend link helpers", () => {
  test("initial and ink are stable per name", () => {
    expect(friendInitial("  sonui")).toBe("S");
    expect(friendInitial("小明")).toBe("小");
    expect(friendInitial("")).toBe("?");
    expect(friendInk("小明")).toBe(friendInk("小明"));
    expect(friendInk("小明")).toStartWith("var(--");
  });

  test("displayHost drops scheme, www and trailing slash", () => {
    expect(displayHost("https://www.example.com/blog/")).toBe(
      "example.com/blog"
    );
    expect(displayHost("https://example.com/")).toBe("example.com");
  });

  test("the canvas shows a handful of cards", () => {
    expect(CANVAS_FRIENDS).toBe(SHOWN_ON_CANVAS);
  });

  test("the site's own card is ready to copy", () => {
    expect(SELF_CARD.name).toBe("Sonui 的手账");
    expect(SELF_CARD.url).toBe("https://blog.sonui.cn");
    expect(SELF_CARD.avatar).toBe(
      "https://blog.sonui.cn/stickers/people-dog.webp"
    );
    expect(SELF_CARD.description.length).toBeGreaterThan(0);
  });

  test("JSON-LD lists every friend in order", () => {
    const empty = linksJsonLd([]);
    expect(empty["@type"]).toBe("CollectionPage");
    expect(empty.url).toBe("https://blog.sonui.cn/links/");
    expect(empty.mainEntity.numberOfItems).toBe(0);

    const two = linksJsonLd([
      friend(),
      friend({ name: "B", url: "https://b.example/" }),
    ]);
    expect(two.mainEntity.numberOfItems).toBe(2);
    expect(two.mainEntity.itemListElement.map((item) => item.position)).toEqual(
      [1, 2]
    );
    expect(two.mainEntity.itemListElement.at(1)?.item.url).toBe(
      "https://b.example/"
    );
  });
});
