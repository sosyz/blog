/**
 * Reads post slugs and dates straight from src/posts at config time.
 *
 * astro.config.mjs loads sitemap.ts and redirects.ts before content
 * collections exist, so they cannot call `getCollection`. This reads the
 * front matter with a small regex instead (only `pubDate` / `updatedDate`).
 *
 * Owner: SEO agent. Relative imports only (loaded by astro.config.mjs).
 */
import { readdirSync, readFileSync } from "node:fs";

const POSTS_DIR = new URL("../../posts/", import.meta.url);
const POST_FILE = /^(?<slug>.+)\.(?:md|mdx)$/;
const FRONT_MATTER = /^---\r?\n(?<yaml>[\s\S]*?)\r?\n---/;
const DATE_LINE =
  /^(?<key>pubDate|updatedDate):\s*["']?(?<value>[^"'\n]+?)["']?\s*$/gm;

export interface PostFile {
  pubDate?: Date;
  slug: string;
  updatedDate?: Date;
}

const parseDate = (value: string | undefined) => {
  if (!value) {
    return;
  }
  // Same parsing as `z.coerce.date()` in content.config.ts.
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
};

const readPostFile = (fileName: string, slug: string): PostFile => {
  const text = readFileSync(new URL(fileName, POSTS_DIR), "utf-8");
  const yaml = FRONT_MATTER.exec(text)?.groups?.yaml ?? "";
  const dates = new Map<string, string>();
  for (const match of yaml.matchAll(DATE_LINE)) {
    const { key, value } = match.groups ?? {};
    if (key && value) {
      dates.set(key, value);
    }
  }
  return {
    pubDate: parseDate(dates.get("pubDate")),
    slug,
    updatedDate: parseDate(dates.get("updatedDate")),
  };
};

let cache: PostFile[] | undefined;

/** Every post in src/posts (slug = file name without extension). */
export const readPostFiles = (): PostFile[] => {
  cache ??= readdirSync(POSTS_DIR)
    .flatMap((fileName) => {
      const slug = POST_FILE.exec(fileName)?.groups?.slug;
      return slug ? [readPostFile(fileName, slug)] : [];
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return cache;
};

/** `updatedDate ?? pubDate` */
export const postLastModified = (post: PostFile) =>
  post.updatedDate ?? post.pubDate;
