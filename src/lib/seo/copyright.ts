/**
 * Copyright and licence: the notes are © Sonui under CC BY-NC-SA 4.0.
 * Used by the footer line, the copyright slip under each note, BlogPosting
 * JSON-LD, RSS, llms.txt and the Markdown versions.
 *
 * Pure and relative-import only (like site.ts), so tests can import it.
 */
import { AUTHOR, PERSON_ID } from "./site.ts";

export const LICENSE = {
  /** Short name, as shown on the page. */
  name: "CC BY-NC-SA 4.0",
  /** Full name in Chinese. */
  title: "知识共享 署名-非商业性使用-相同方式共享 4.0 国际",
  /** Canonical licence URL, for machines: JSON-LD, rel="license", RSS. */
  url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  /** Simplified Chinese deed, for people: links on the page. */
  deed: "https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans",
} as const;

export const COPYRIGHT_HOLDER = AUTHOR.name;

/** One line on what reusing a note takes. */
export const REPRINT_NOTICE =
  "转载请署名并注明原文链接，非商业使用，改编后以相同协议发布";

/**
 * ICP 备案号 for the footer. Empty: no line is shown. Fill in e.g.
 * "京ICP备12345678号-1" to show it (linked to beian.miit.gov.cn) under the
 * © line on the canvas intro card, /list/, /links/, /privacy/ and 404.
 */
export const ICP_RECORD: { number: string; url: string } = {
  number: "",
  url: "https://beian.miit.gov.cn/",
};

/** Years are counted in China time, like every date on the site. */
const YEAR = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
});

export const yearOf = (date: Date) => Number(YEAR.format(date));

export type CopyrightYears = { first: number; current: number };

/**
 * From the year of the first note to the current year (at build time).
 * Without notes, or with a note dated in the future, it is just this year.
 */
export const copyrightYears = (
  dates: Iterable<Date>,
  now: Date
): CopyrightYears => {
  const current = yearOf(now);
  let first = current;
  for (const date of dates) {
    first = Math.min(first, yearOf(date));
  }
  return { first, current };
};

/** "2019–2026", or "2026" when both are the same year. */
export const yearRange = ({ first, current }: CopyrightYears) =>
  first === current ? String(current) : `${first}–${current}`;

/** "© 2019–2026 Sonui" */
export const copyrightLine = (years: CopyrightYears) =>
  `© ${yearRange(years)} ${COPYRIGHT_HOLDER}`;

/** RSS <channel><copyright>. */
export const feedCopyright = (years: CopyrightYears) =>
  `${copyrightLine(years)}. 文章采用 ${LICENSE.name} 协议：${LICENSE.url}`;

/** RSS <item><dc:rights> for one note. */
export const noteRights = (published: Date) =>
  `© ${yearOf(published)} ${COPYRIGHT_HOLDER}. ${LICENSE.name}：${LICENSE.url}`;

/** BlogPosting fields: licence URL, holder (the site's Person), year. */
export const licenseFields = (published: Date) => ({
  license: LICENSE.url,
  copyrightHolder: { "@id": PERSON_ID },
  copyrightYear: yearOf(published),
});

/** The licence line for llms.txt / llms-full.txt. */
export const llmsLicenseLine = () =>
  `本站文章由 ${COPYRIGHT_HOLDER} 撰写，采用 ${LICENSE.name}（${LICENSE.title}）协议：${LICENSE.url}。${REPRINT_NOTICE}。`;

export type NoteMeta = {
  title: string;
  description: string;
  /** Canonical page URL. */
  url: string;
  published: string;
  updated?: string;
  /** The original this note translates or reposts. */
  basedOn?: string;
};

/**
 * YAML front matter for /notes/<slug>.md. Strings are JSON-quoted, which is
 * valid YAML and keeps colons, quotes and "#" in titles safe.
 */
export const noteFrontMatter = (meta: NoteMeta) =>
  [
    "---",
    `title: ${JSON.stringify(meta.title)}`,
    `description: ${JSON.stringify(meta.description)}`,
    `author: ${JSON.stringify(COPYRIGHT_HOLDER)}`,
    `url: ${JSON.stringify(meta.url)}`,
    `published: ${meta.published}`,
    ...(meta.updated && meta.updated !== meta.published
      ? [`updated: ${meta.updated}`]
      : []),
    `license: ${JSON.stringify(LICENSE.name)}`,
    `license_url: ${JSON.stringify(LICENSE.url)}`,
    ...(meta.basedOn ? [`based_on: ${JSON.stringify(meta.basedOn)}`] : []),
    "---",
  ].join("\n");

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
const HTML_UNSAFE = /[&<>"]/g;
const escapeHtml = (text: string) =>
  text.replace(HTML_UNSAFE, (char) => HTML_ESCAPES[char] ?? char);

/** A short copyright paragraph appended to each note's HTML in the feed. */
export const feedItemFooter = (url: string) => {
  const link = escapeHtml(url);
  return `<hr /><p>作者 ${escapeHtml(COPYRIGHT_HOLDER)} · 原文链接 <a href="${link}">${link}</a> · 采用 <a href="${LICENSE.deed}">${LICENSE.name}</a> 协议。${REPRINT_NOTICE}。</p>`;
};
