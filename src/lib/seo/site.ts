/**
 * Site identity used by <head> metadata, JSON-LD, RSS, llms.txt and robots.
 *
 * Owner: SEO agent. Also imported by astro.config.mjs through sitemap.ts, so
 * keep this file free of `astro:*` imports and `@/` aliases.
 */
import { PROFILE } from "../../consts.ts";

export const SITE_URL = "https://blog.sonui.cn";

/** Site name: the `<title>` suffix, og:site_name, RSS title, llms.txt H1. */
export const SITE_NAME = "Sonui 的手账";

/** Default meta description and the llms.txt summary. */
export const SITE_DESCRIPTION =
  "Sonui 的灵感手账：在一块无限画布上记录编程踩过的坑和一些随想，主要是 AI、Web、后端、Go、云原生和运维。";

export const SITE_LANGUAGE = "zh-CN";
export const OG_LOCALE = "zh_CN";

/**
 * The blog's author (JSON-LD Person, RSS, article:author). `url` is the home
 * page, written exactly like WebSite.url; `description` is the intro card's
 * bio; `image` is the dog sticker the site uses as the owner's avatar.
 */
export const AUTHOR = {
  name: PROFILE.name,
  url: `${SITE_URL}/`,
  description: PROFILE.bio,
  image: `${SITE_URL}/stickers/people-dog.webp`,
  sameAs: ["https://github.com/sosyz"],
  knowsAbout: [
    "AI 工具链",
    "Web 开发",
    "后端开发",
    "Go",
    "TypeScript",
    "云原生",
    "Kubernetes",
    "运维与网络",
  ],
} as const;

/** Default share image (public/og-default.png, see build-og-image.ts). */
export const DEFAULT_OG_IMAGE = {
  src: "/og-default.png",
  width: 1200,
  height: 630,
  alt: "点阵纸上贴着一张写着「这本手账属于 Sonui，技术踩坑和随想」的索引卡，旁边的便利贴写着最近在折腾的主题",
} as const;

/** Stable JSON-LD node ids, so pages can reference the same Person/WebSite. */
export const PERSON_ID = `${SITE_URL}/#person`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** Absolute URL on this site. */
export const absoluteUrl = (path: string) => new URL(path, SITE_URL).href;

/** Absolute URL of a note's page, e.g. https://blog.sonui.cn/notes/go-context/ */
export const noteUrl = (slug: string) => absoluteUrl(`/notes/${slug}/`);

/** Absolute URL of a note's raw Markdown, e.g. https://blog.sonui.cn/notes/go-context.md */
export const noteMarkdownUrl = (slug: string) =>
  absoluteUrl(`/notes/${slug}.md`);

export const personNode = () => ({
  "@type": "Person",
  "@id": PERSON_ID,
  name: AUTHOR.name,
  url: AUTHOR.url,
  description: AUTHOR.description,
  image: AUTHOR.image,
  sameAs: [...AUTHOR.sameAs],
  knowsAbout: [...AUTHOR.knowsAbout],
});

export const websiteNode = () => ({
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  name: SITE_NAME,
  url: absoluteUrl("/"),
  description: SITE_DESCRIPTION,
  inLanguage: SITE_LANGUAGE,
  author: { "@id": PERSON_ID },
  publisher: { "@id": PERSON_ID },
});

const JSON_LD_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};
const JSON_LD_UNSAFE = /[<>&\u2028\u2029]/g;

/**
 * JSON for a `<script type="application/ld+json">` body. `<`, `>` and `&`
 * are escaped so a value containing `</script>` cannot close the tag.
 */
export const serializeJsonLd = (data: unknown) =>
  JSON.stringify(data).replace(
    JSON_LD_UNSAFE,
    (char) => JSON_LD_ESCAPES[char] ?? char
  );
