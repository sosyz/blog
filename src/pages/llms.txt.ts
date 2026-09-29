/**
 * /llms.txt (https://llmstxt.org): site name, a one-line summary and every
 * note grouped by topic, each linking to its Markdown version.
 *
 * Owner: SEO agent.
 */
import type { APIRoute } from "astro";
import { getTopics } from "@/lib/posts";
import {
  absoluteUrl,
  noteMarkdownUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "@/lib/seo/site";

export const GET: APIRoute = async () => {
  const topics = await getTopics();
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    "作者是 Sonui（https://github.com/sosyz）。笔记分两种：「踩坑」记录具体技术问题和解决过程，「随想」是短的想法。每篇笔记都有 Markdown 版本（下面的链接），网页版在去掉 .md、加上 / 的地址。",
    "",
    `- 全部笔记的 Markdown 全文：${absoluteUrl("/llms-full.txt")}`,
    `- 按时间排列的笔记列表：${absoluteUrl("/list/")}`,
    "",
  ];
  for (const topic of topics) {
    lines.push(`## ${topic.name}`, "");
    for (const post of topic.posts) {
      lines.push(
        `- [${post.data.title}](${noteMarkdownUrl(post.id)}): ${post.data.description}`
      );
    }
    lines.push("");
  }
  lines.push(
    "## Optional",
    "",
    `- [RSS](${absoluteUrl("/rss.xml")}): 全部笔记的全文订阅`,
    `- [Sitemap](${absoluteUrl("/sitemap-index.xml")}): 站点地图`,
    ""
  );

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
