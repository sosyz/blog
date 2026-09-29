import { ChangeFreqEnum, type SitemapOptions } from "@astrojs/sitemap";
import { postLastModified, readPostFiles } from "./post-files.ts";

/**
 * Options for @astrojs/sitemap.
 *
 * - Leaves out /admin/ and /api/ (never public pages) and the 404 page.
 * - Note pages get `lastmod` from `updatedDate ?? pubDate`; the home page and
 *   the list get the newest date of any note.
 *
 * Owner: SEO agent. Imported by astro.config.mjs (relative imports only).
 */

const EXCLUDED = [/^\/admin(\/|$)/, /^\/api(\/|$)/, /^\/404\/?$/];
const NOTE_PATH = /^\/notes\/(?<slug>[^/]+)\/?$/;
const INDEX_PATHS = new Set(["/", "/list/"]);
const PRIORITY = { home: 1, list: 0.6, note: 0.8 } as const;

let lastModified: Map<string, Date> | undefined;

const lastModifiedBySlug = () => {
  lastModified ??= new Map(
    readPostFiles().flatMap((post) => {
      const date = postLastModified(post);
      return date ? [[post.slug, date] as const] : [];
    })
  );
  return lastModified;
};

const newest = (dates: Iterable<Date>) => {
  let latest: Date | undefined;
  for (const date of dates) {
    if (!latest || date > latest) {
      latest = date;
    }
  }
  return latest;
};

export const sitemapOptions: SitemapOptions = {
  // Plain <urlset>: no news/image/video/xhtml extensions are used.
  namespaces: { news: false, xhtml: false, image: false, video: false },
  filter: (page) => {
    const { pathname } = new URL(page);
    return !EXCLUDED.some((pattern) => pattern.test(pathname));
  },
  serialize: (item) => {
    const { pathname } = new URL(item.url);
    const dates = lastModifiedBySlug();
    const slug = NOTE_PATH.exec(pathname)?.groups?.slug;

    if (slug) {
      const lastmod = dates.get(slug);
      return {
        ...item,
        lastmod: lastmod?.toISOString(),
        changefreq: ChangeFreqEnum.YEARLY,
        priority: PRIORITY.note,
      };
    }
    if (INDEX_PATHS.has(pathname)) {
      return {
        ...item,
        lastmod: newest(dates.values())?.toISOString(),
        changefreq: ChangeFreqEnum.WEEKLY,
        priority: pathname === "/" ? PRIORITY.home : PRIORITY.list,
      };
    }
    return item;
  },
};
