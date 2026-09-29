/**
 * /robots.txt: everyone, including AI crawlers, may read the notes; /admin/
 * and /api/ are off limits.
 *
 * AI crawlers are listed by name with an explicit Allow so the intent is
 * clear to them and to anyone reading the file. A crawler follows only the
 * most specific group that names it, so every group repeats the Disallow
 * lines. Cloudflare's "Block AI bots" / managed robots.txt settings must stay
 * off for this file to be what crawlers see.
 *
 * Owner: SEO agent.
 */
import type { APIRoute } from "astro";
import { absoluteUrl } from "@/lib/seo/site";

const AI_CRAWLERS = [
  // OpenAI
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  // Anthropic
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Google / Apple AI training opt-ins
  "Google-Extended",
  "Applebot-Extended",
  // Others
  "CCBot",
  "Amazonbot",
  "Bytespider",
  "meta-externalagent",
  "cohere-ai",
  "DuckAssistBot",
  "MistralAI-User",
  "YouBot",
];

const RULES = ["Allow: /", "Disallow: /admin/", "Disallow: /api/"];

export const GET: APIRoute = () => {
  const lines = [
    ...AI_CRAWLERS.map((agent) => `User-agent: ${agent}`),
    ...RULES,
    "",
    "User-agent: *",
    ...RULES,
    "",
    `Sitemap: ${absoluteUrl("/sitemap-index.xml")}`,
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
