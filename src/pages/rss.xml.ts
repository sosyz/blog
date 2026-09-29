/**
 * /rss.xml: every note with its full rendered HTML, newest first.
 *
 * Owner: SEO agent.
 */
import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getPosts, lastUpdated, notePath } from "@/lib/posts";
import { renderPostHtml } from "@/lib/seo/render";
import {
  AUTHOR,
  absoluteUrl,
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
  const items = await Promise.all(
    posts.map(async (post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: notePath(post.id),
      categories: [...new Set([post.data.topic, ...post.data.tags])],
      content: await renderPostHtml(post),
      customData: `<dc:creator>${escapeXml(AUTHOR.name)}</dc:creator>`,
    }))
  );

  return rss({
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    site: absoluteUrl("/"),
    xmlns: {
      atom: "http://www.w3.org/2005/Atom",
      dc: "http://purl.org/dc/elements/1.1/",
    },
    customData: [
      `<language>${SITE_LANGUAGE}</language>`,
      `<atom:link href="${absoluteUrl("/rss.xml")}" rel="self" type="application/rss+xml"/>`,
      `<lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>`,
    ].join(""),
    items,
  });
};
