/**
 * /rss.xml: every note with its full rendered HTML, newest first. The
 * channel carries <copyright> (© first year–build year, CC BY-NC-SA 4.0);
 * each item a <dc:rights> line and a short copyright footer in its HTML.
 *
 * Owner: SEO agent.
 */
import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getPosts, lastUpdated, notePath } from "@/lib/posts";
import {
  copyrightYears,
  feedCopyright,
  feedItemFooter,
  noteRights,
} from "@/lib/seo/copyright";
import { feedDiagrams } from "@/lib/seo/feed-html";
import { renderPostHtml } from "@/lib/seo/render";
import {
  AUTHOR,
  absoluteUrl,
  noteUrl,
  SITE_DESCRIPTION,
  SITE_LANGUAGE,
  SITE_NAME,
} from "@/lib/seo/site";

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const GET: APIRoute = async () => {
  const posts = await getPosts();
  // Newest change of any note, so the feed only changes when a note does.
  const lastBuild = Math.max(
    ...posts.map((post) => lastUpdated(post).valueOf())
  );
  const years = copyrightYears(
    posts.map((post) => post.data.pubDate),
    new Date()
  );
  const items = await Promise.all(
    posts.map(async (post) => ({
      categories: [...new Set([post.data.topic, ...post.data.tags])],
      content: `${feedDiagrams(await renderPostHtml(post), noteUrl(post.id))}${feedItemFooter(noteUrl(post.id))}`,
      customData: [
        `<dc:creator>${escapeXml(AUTHOR.name)}</dc:creator>`,
        `<dc:rights>${escapeXml(noteRights(post.data.pubDate))}</dc:rights>`,
      ].join(""),
      description: post.data.description,
      link: notePath(post.id),
      pubDate: post.data.pubDate,
      title: post.data.title,
    }))
  );

  return rss({
    customData: [
      `<language>${SITE_LANGUAGE}</language>`,
      `<copyright>${escapeXml(feedCopyright(years))}</copyright>`,
      `<atom:link href="${absoluteUrl("/rss.xml")}" rel="self" type="application/rss+xml"/>`,
      `<lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>`,
    ].join(""),
    description: SITE_DESCRIPTION,
    items,
    site: absoluteUrl("/"),
    title: SITE_NAME,
    xmlns: {
      atom: "http://www.w3.org/2005/Atom",
      dc: "http://purl.org/dc/elements/1.1/",
    },
  });
};
