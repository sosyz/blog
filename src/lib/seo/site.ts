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
  description: PROFILE.bio,
  image: `${SITE_URL}/stickers/people-dog.webp`,
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
  name: PROFILE.name,
  sameAs: ["https://github.com/sosyz"],
  url: `${SITE_URL}/`,
} as const;

/** Default share image (public/og-default.png, see build-og-image.ts). */
export const DEFAULT_OG_IMAGE = {
  alt: "点阵纸上贴着一张写着「这本手账属于 Sonui，技术踩坑和随想」的索引卡，旁边的便利贴写着最近在折腾的主题",
  height: 630,
  src: "/og-default.png",
  width: 1200,
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
  "@id": PERSON_ID,
  "@type": "Person",
  description: AUTHOR.description,
  image: AUTHOR.image,
  knowsAbout: [...AUTHOR.knowsAbout],
  name: AUTHOR.name,
  sameAs: [...AUTHOR.sameAs],
  url: AUTHOR.url,
});

export const websiteNode = () => ({
  "@id": WEBSITE_ID,
  "@type": "WebSite",
  author: { "@id": PERSON_ID },
  description: SITE_DESCRIPTION,
  inLanguage: SITE_LANGUAGE,
  name: SITE_NAME,
  publisher: { "@id": PERSON_ID },
  url: absoluteUrl("/"),
});

const JSON_LD_ESCAPES: Record<string, string> = {
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
  "&": "\\u0026",
  "<": "\\u003c",
  ">": "\\u003e",
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
