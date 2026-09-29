/**
 * Plain Markdown versions of notes, for /notes/<slug>.md and /llms-full.txt.
 *
 * The body is the post's Markdown without front matter. A short header gives
 * the title, dates, topic, tags and the canonical URL. Relative image paths
 * (../assets/posts/…) are replaced with absolute URLs of the built files.
 *
 * Owner: SEO agent. Build-time only.
 */
import type { ImageMetadata } from "astro";
import { isoDate, lastUpdated, type Post } from "@/lib/posts";
import { absoluteUrl, noteUrl } from "@/lib/seo/site";

/** Every image under src/assets, keyed by "/src/assets/…". */
const ASSET_IMAGES = import.meta.glob<ImageMetadata>(
  "/src/assets/**/*.{png,jpg,jpeg,webp,gif,avif,svg}",
  { eager: true, import: "default" }
);

/** Posts live in src/posts/, so their images are "../assets/…". */
const RELATIVE_ASSET = /\.\.\/assets\/[^\s)"'>]+/g;

const resolveAssetUrls = (markdown: string) =>
  markdown.replace(RELATIVE_ASSET, (path) => {
    const image = ASSET_IMAGES[`/src/${path.slice("../".length)}`];
    return image ? absoluteUrl(image.src) : path;
  });

const metaLines = (post: Post) => {
  const { data } = post;
  const published = isoDate(data.pubDate);
  const updated = isoDate(lastUpdated(post));
  const kind = data.status ? `${data.type}（${data.status}）` : data.type;
  return [
    "- 作者：Sonui",
    `- 发布：${published}${updated === published ? "" : `（更新：${updated}）`}`,
    `- 类型：${kind}`,
    `- 主题：${data.topic}`,
    ...(data.tags.length > 0 ? [`- 标签：${data.tags.join("、")}`] : []),
    ...(data.source ? [`- 原文：${data.source}`] : []),
    `- 链接：${noteUrl(post.id)}`,
  ];
};

/** The note as Markdown, with a small header. */
export const noteMarkdown = (post: Post) => {
  const body = resolveAssetUrls(post.body ?? "").trim();
  return [
    `# ${post.data.title}`,
    "",
    `> ${post.data.description}`,
    "",
    ...metaLines(post),
    "",
    "---",
    "",
    body,
    "",
  ].join("\n");
};
