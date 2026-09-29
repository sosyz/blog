import { describe, expect, test } from "bun:test";
import { PROFILE } from "../src/consts";
import { AUTHOR, personNode, websiteNode } from "../src/lib/seo/site";

describe("author entity", () => {
  test("Person.url is the same URL as WebSite.url", () => {
    expect(websiteNode().url).toBe(personNode().url);
    expect(websiteNode().url).toBe(AUTHOR.url);
  });

  test("Person describes the author", () => {
    const person = personNode();
    expect(person.description).toBe(PROFILE.bio);
    expect(person.image).toStartWith(websiteNode().url);
    expect(person.knowsAbout.length).toBeGreaterThan(0);
    expect(person.sameAs).toContain("https://github.com/sosyz");
  });
});
