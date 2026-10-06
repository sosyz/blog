/**
 * Plain Markdown versions of notes, for /notes/<slug>.md and /llms-full.txt.
 *
 * The body is the post's Markdown without its source front matter. A short
 * header gives the title, dates, topic, tags, the canonical URL and the
 * licence. /notes/<slug>.md also starts with YAML front matter (title, url,
 * dates, `license`); /llms-full.txt leaves it out. Relative image paths
 * (../assets/posts/…) are replaced with absolute URLs of the built files.
 *
 * Owner: SEO agent. Build-time only.
 */
import type { ImageMetadata } from "astro";
import { isoDate, lastUpdated, type Post } from "@/lib/posts";
import {
  COPYRIGHT_HOLDER,
  LICENSE,
  noteFrontMatter,
} from "@/lib/seo/copyright";
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
    `- 作者：${COPYRIGHT_HOLDER}`,
    `- 发布：${published}${updated === published ? "" : `（更新：${updated}）`}`,
    `- 类型：${kind}`,
    `- 主题：${data.topic}`,
    ...(data.tags.length > 0 ? [`- 标签：${data.tags.join("、")}`] : []),
    ...(data.source ? [`- 原文：${data.source}`] : []),
    `- 链接：${noteUrl(post.id)}`,
    `- 协议：${LICENSE.name}（${LICENSE.url}），转载请署名并注明原文链接`,
  ];
};

const frontMatter = (post: Post) =>
  noteFrontMatter({
    basedOn: post.data.source,
    description: post.data.description,
    published: isoDate(post.data.pubDate),
    title: post.data.title,
    updated: isoDate(lastUpdated(post)),
    url: noteUrl(post.id),
  });

/**
 * The note as Markdown, with a small header; `frontMatter: true` (the .md
 * route) puts YAML front matter before it.
 */
export const noteMarkdown = (
  post: Post,
  options: { frontMatter?: boolean } = {}
) => {
  const body = resolveAssetUrls(post.body ?? "").trim();
  return [
    ...(options.frontMatter ? [frontMatter(post), ""] : []),
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
