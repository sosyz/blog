/**
 * /llms-full.txt: every note's Markdown in one file, newest first, each with
 * its title, dates and canonical URL (same format as /notes/<slug>.md).
 *
 * Owner: SEO agent.
 */
import type { APIRoute } from "astro";
import { getPosts } from "@/lib/posts";
import { noteMarkdown } from "@/lib/seo/markdown";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo/site";

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,5}) /;

/** "# x" → "## x", outside fenced code blocks. */
const demoteHeadings = (markdown: string) => {
  let fence: string | undefined;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (marker && (!fence || fence === marker)) {
        fence = fence ? undefined : marker;
        return line;
      }
      return fence ? line : line.replace(HEADING, "#$1 ");
    })
    .join("\n");
};

export const GET: APIRoute = async () => {
  const posts = await getPosts();
  const header = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    `本文件收录全部 ${posts.length} 篇笔记的 Markdown 原文，按发布时间从新到旧排列。目录见 ${absoluteUrl("/llms.txt")}。`,
    "",
  ].join("\n");
  // Demote each note's headings by one level so the file keeps a single H1.
  const notes = posts.map((post) => demoteHeadings(noteMarkdown(post)));

  return new Response([header, ...notes].join("\n\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
