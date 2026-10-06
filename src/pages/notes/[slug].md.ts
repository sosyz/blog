/**
 * /notes/<slug>.md: the note as plain Markdown (for AI tools and plain-text
 * reading), with YAML front matter (url, dates, license). Linked from each
 * note's <head> as rel="alternate".
 *
 * Owner: SEO agent.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { getPosts, type Post } from "@/lib/posts";
import { noteMarkdown } from "@/lib/seo/markdown";

export const getStaticPaths = (async () => {
  const posts = await getPosts();
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}) satisfies GetStaticPaths;

interface Props {
  post: Post;
}

export const GET: APIRoute<Props> = ({ props }) =>
  new Response(noteMarkdown(props.post, { frontMatter: true }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
