import { describe, expect, test } from "bun:test";
import {
  COPYRIGHT_HOLDER,
  copyrightLine,
  copyrightYears,
  feedCopyright,
  feedItemFooter,
  ICP_RECORD,
  LICENSE,
  licenseFields,
  llmsLicenseLine,
  noteFrontMatter,
  noteRights,
  yearOf,
  yearRange,
} from "../src/lib/seo/copyright";
import { PERSON_ID } from "../src/lib/seo/site";

const NOW = new Date("2026-09-30T12:00:00+08:00");
const THIS_YEAR = 2026;
const NEW_YEAR_2020 = 2020;
const NEW_YEAR_EVE_2019 = 2019;

describe("copyright years", () => {
  test("from the first note's year to the build year", () => {
    const years = copyrightYears(
      [new Date("2021-05-01"), new Date("2019-03-02"), new Date("2025-10-08")],
      NOW
    );
    expect(years).toEqual({ current: 2026, first: 2019 });
    expect(yearRange(years)).toBe("2019–2026");
    expect(copyrightLine(years)).toBe("© 2019–2026 Sonui");
  });

  test("a single year when everything is this year, or there are no notes", () => {
    expect(yearRange(copyrightYears([], NOW))).toBe("2026");
    expect(yearRange(copyrightYears([new Date("2026-01-02")], NOW))).toBe(
      "2026"
    );
  });

  test("a note dated in the future does not move the start", () => {
    expect(copyrightYears([new Date("2030-01-01")], NOW).first).toBe(THIS_YEAR);
  });

  test("years are counted in China time", () => {
    // 2019-12-31 17:00 UTC is already 2020-01-01 in Shanghai.
    expect(yearOf(new Date("2019-12-31T17:00:00Z"))).toBe(NEW_YEAR_2020);
    expect(yearOf(new Date("2019-12-31T15:00:00Z"))).toBe(NEW_YEAR_EVE_2019);
  });
});

describe("licence", () => {
  test("CC BY-NC-SA 4.0 with the Chinese deed for people", () => {
    expect(LICENSE.name).toBe("CC BY-NC-SA 4.0");
    expect(LICENSE.url).toBe(
      "https://creativecommons.org/licenses/by-nc-sa/4.0/"
    );
    expect(LICENSE.deed).toBe(`${LICENSE.url}deed.zh-hans`);
    expect(COPYRIGHT_HOLDER).toBe("Sonui");
  });

  test("no ICP line until the owner fills it in", () => {
    expect(ICP_RECORD.number).toBe("");
    expect(ICP_RECORD.url).toStartWith("https://beian.miit.gov.cn");
  });

  test("BlogPosting fields: licence, holder and year", () => {
    expect(licenseFields(new Date("2025-10-08"))).toEqual({
      copyrightHolder: { "@id": PERSON_ID },
      copyrightYear: 2025,
      license: LICENSE.url,
    });
  });

  test("RSS channel and item notices", () => {
    const channel = feedCopyright({ current: 2026, first: 2019 });
    expect(channel).toStartWith("© 2019–2026 Sonui");
    expect(channel).toContain(LICENSE.url);
    const item = noteRights(new Date("2025-10-08"));
    expect(item).toStartWith("© 2025 Sonui");
    expect(item).toContain(LICENSE.name);
  });

  test("feed footer links the original and escapes it", () => {
    const html = feedItemFooter('https://blog.sonui.cn/notes/a"b/');
    expect(html).toContain('href="https://blog.sonui.cn/notes/a&quot;b/"');
    expect(html).toContain(LICENSE.deed);
    expect(html).not.toContain('a"b');
  });

  test("llms.txt line names the licence and does not look like a note link", () => {
    const line = llmsLicenseLine();
    expect(line).toContain(LICENSE.name);
    expect(line).toContain(LICENSE.url);
    expect(line.startsWith("- [")).toBe(false);
  });
});

describe(".md front matter", () => {
  test("license, url and dates, strings quoted", () => {
    const yaml = noteFrontMatter({
      description: "一句话",
      published: "2025-10-08",
      title: 'Go: context "取消"',
      updated: "2025-10-09",
      url: "https://blog.sonui.cn/notes/go-context/",
    });
    const lines = yaml.split("\n");
    expect(lines.at(0)).toBe("---");
    expect(lines.at(-1)).toBe("---");
    expect(lines).toContain('title: "Go: context \\"取消\\""');
    expect(lines).toContain('url: "https://blog.sonui.cn/notes/go-context/"');
    expect(lines).toContain('license: "CC BY-NC-SA 4.0"');
    expect(lines).toContain(`license_url: "${LICENSE.url}"`);
    expect(lines).toContain("updated: 2025-10-09");
    expect(yaml).not.toContain("based_on");
  });

  test("no updated line when unchanged; based_on for translations", () => {
    const yaml = noteFrontMatter({
      basedOn: "https://example.com/original",
      description: "d",
      published: "2025-10-08",
      title: "t",
      updated: "2025-10-08",
      url: "https://blog.sonui.cn/notes/t/",
    });
    expect(yaml).not.toContain("updated:");
    expect(yaml).toContain('based_on: "https://example.com/original"');
  });
});
