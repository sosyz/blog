/**
 * Friend links (友链): the entry type, the build-time check of
 * src/data/links.ts, and small pure helpers shared by the canvas pile, the
 * /links/ page and the list.
 *
 * Pure (relative imports only, no `astro:*`), so tests/links.test.ts can
 * import it. Avatars are resolved to images in link-avatars.ts (Astro only).
 */
import { PROFILE } from "../consts.ts";
import { seeded } from "../scripts/canvas/seed.ts";
import {
  AUTHOR,
  absoluteUrl,
  SITE_LANGUAGE,
  SITE_NAME,
  SITE_URL,
  WEBSITE_ID,
} from "./seo/site.ts";

export type FriendLink = {
  /** Name on the card, e.g. the blog's title. Unique. */
  name: string;
  /** The friend's site. Must be https. Unique. */
  url: string;
  /** One short sentence (≤ 40 characters). */
  description: string;
  /** File name of an image in src/assets/links/, e.g. "someone.webp". */
  avatar?: string;
  /** When the link was exchanged: "YYYY-MM-DD" or "YYYY-MM". */
  since?: string;
};

/** How many name cards the canvas shows; /links/ shows all of them. */
export const CANVAS_FRIENDS = 6;
export const MAX_NAME_LENGTH = 24;
export const MAX_DESCRIPTION_LENGTH = 40;

const AVATAR_FILE = /^[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp|avif)$/;
const SINCE = /^(?<year>\d{4})-(?<month>\d{2})(?:-(?<day>\d{2}))?$/;
const LINE_BREAK = /[\r\n]/;
const TRAILING_SLASHES = /\/+$/;
const WWW = /^www\./;
const MONTHS = 12;
const LAST_DAY = 31;

const length = (text: string) => [...text].length;

/** Same site written two ways (case, www, trailing slash) counts as one. */
const urlKey = (url: URL) =>
  `${url.hostname.replace(WWW, "")}${url.pathname.replace(TRAILING_SLASHES, "")}`;

const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const sinceProblem = (since: string) => {
  const groups = SINCE.exec(since)?.groups;
  const month = Number(groups?.month);
  const day = groups?.day ? Number(groups.day) : 1;
  if (!groups || month < 1 || month > MONTHS || day < 1 || day > LAST_DAY) {
    return "since 要写成 YYYY-MM-DD 或 YYYY-MM";
  }
  return null;
};

const urlProblems = (value: string) => {
  const url = parseUrl(value);
  if (!url) {
    return { url: null, problems: ["url 不是完整的网址"] };
  }
  const problems: string[] = [];
  if (url.protocol !== "https:") {
    problems.push("url 必须是 https:// 开头");
  }
  if (url.username || url.password) {
    problems.push("url 里不能带用户名或密码");
  }
  if (new URL(SITE_URL).hostname === url.hostname) {
    problems.push("url 是本站自己");
  }
  return { url, problems };
};

/** Problems with one entry (without the duplicate checks). */
const entryProblems = (link: FriendLink) => {
  const name = link.name.trim();
  const description = link.description.trim();
  const { url, problems } = urlProblems(link.url);
  if (!name) {
    problems.push("name 不能为空");
  } else if (length(name) > MAX_NAME_LENGTH) {
    problems.push(`name 最多 ${MAX_NAME_LENGTH} 个字`);
  }
  if (!description) {
    problems.push("description 不能为空");
  } else if (length(description) > MAX_DESCRIPTION_LENGTH) {
    problems.push(`description 最多 ${MAX_DESCRIPTION_LENGTH} 个字`);
  }
  if (LINE_BREAK.test(link.name) || LINE_BREAK.test(link.description)) {
    problems.push("name 和 description 不能换行");
  }
  if (link.avatar !== undefined && !AVATAR_FILE.test(link.avatar)) {
    problems.push(
      "avatar 是 src/assets/links/ 里的文件名（小写字母、数字、短横线，png/jpg/webp/avif）"
    );
  }
  const since = link.since === undefined ? null : sinceProblem(link.since);
  if (since) {
    problems.push(since);
  }
  return { name, url, problems };
};

/**
 * Remembers the first entry for each key; for a repeat, returns the index
 * of that earlier entry.
 */
const firstSeen = () => {
  const seen = new Map<string, number>();
  return (key: string, index: number) => {
    const earlier = seen.get(key);
    if (earlier === undefined && key) {
      seen.set(key, index);
    }
    return key ? earlier : undefined;
  };
};

/**
 * Everything wrong with the friend list, one message per problem (empty
 * when it is fine): https-only URLs, unique names and sites, a short
 * one-line description, avatar file names and `since` dates.
 */
export const linkProblems = (links: readonly FriendLink[]) => {
  const messages: string[] = [];
  const sameName = firstSeen();
  const sameSite = firstSeen();
  for (const [index, link] of links.entries()) {
    const label = `第 ${index + 1} 条（${link.name || "没有名字"}）`;
    const { name, url, problems } = entryProblems(link);
    const earlierName = sameName(name.toLowerCase(), index);
    if (earlierName !== undefined) {
      problems.push(`name 和第 ${earlierName + 1} 条重复`);
    }
    const earlierSite = sameSite(url ? urlKey(url) : "", index);
    if (earlierSite !== undefined) {
      problems.push(`url 和第 ${earlierSite + 1} 条是同一个网站`);
    }
    for (const problem of problems) {
      messages.push(`${label}：${problem}`);
    }
  }
  return messages;
};

/** The list itself, or a build error listing every problem. */
export const checkedLinks = (links: readonly FriendLink[]) => {
  const problems = linkProblems(links);
  if (problems.length > 0) {
    throw new Error(
      `src/data/links.ts 的友链有问题：\n- ${problems.join("\n- ")}`
    );
  }
  return links;
};

/** The first character of a name for the hand-drawn badge, e.g. "S". */
export const friendInitial = (name: string) =>
  ([...name.trim()].at(0) ?? "?").toUpperCase();

/** Stationery inks for the badge, picked by name so it never changes. */
const BADGE_INKS = [
  "var(--link)",
  "var(--str)",
  "var(--stamp-ink)",
  "var(--pencil)",
] as const;

export const friendInk = (name: string) =>
  BADGE_INKS[Math.floor(seeded(name) * BADGE_INKS.length)] ?? BADGE_INKS[0];

/** "https://www.example.com/blog/" → "example.com/blog" */
export const displayHost = (value: string) => {
  const url = parseUrl(value);
  if (!url) {
    return value;
  }
  const path = url.pathname.replace(TRAILING_SLASHES, "");
  return `${url.hostname.replace(WWW, "")}${path}`;
};

/** "2026-10-01" → "2026.10.01" (as on the date stamp). */
export const sinceLabel = (since: string) => since.replaceAll("-", ".");

/** This site's own card, for friends to copy when they add it. */
export const SELF_CARD = {
  name: SITE_NAME,
  url: SITE_URL,
  description: PROFILE.title,
  avatar: AUTHOR.image,
} as const;

/** JSON-LD for /links/: a CollectionPage whose main entity lists the sites. */
export const linksJsonLd = (links: readonly FriendLink[]) => {
  const pageUrl = absoluteUrl("/links/");
  return {
    "@type": "CollectionPage",
    "@id": `${pageUrl}#page`,
    url: pageUrl,
    name: `友链 · ${SITE_NAME}`,
    inLanguage: SITE_LANGUAGE,
    isPartOf: { "@id": WEBSITE_ID },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: links.length,
      itemListElement: links.map((link, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "WebSite",
          name: link.name,
          url: link.url,
          description: link.description,
        },
      })),
    },
  };
};
