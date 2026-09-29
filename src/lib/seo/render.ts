/**
 * Build-time rendering of a post to standalone HTML, for feeds.
 *
 * Uses the Astro container so the output goes through the same markdown
 * pipeline (src/lib/markdown/config.ts) and image optimisation as the
 * <PostBody> on the note page. Relative URLs are made absolute, because feed
 * readers do not know the page's base URL.
 *
 * Owner: SEO agent. Build-time only (prerendered routes).
 */
import { loadRenderers } from "astro:container";
import { render } from "astro:content";
import { getContainerRenderer as mdxRenderer } from "@astrojs/mdx/container-renderer";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import type { Post } from "@/lib/posts";
import { absoluteUrl } from "@/lib/seo/site";

let containerPromise: Promise<AstroContainer> | undefined;

const getContainer = () => {
  containerPromise ??= loadRenderers([mdxRenderer()]).then((renderers) =>
    AstroContainer.create({ renderers })
  );
  return containerPromise;
};

/** src="/x", href="/x", poster="/x" (not protocol-relative "//x"). */
const ROOT_RELATIVE_ATTR = /\b(src|href|poster)="(\/(?!\/)[^"]*)"/g;
const SRCSET_ATTR = /\bsrcset="([^"]*)"/g;
const SRCSET_ROOT_RELATIVE = /(^|,\s*)(\/(?!\/)[^\s,]+)/g;
/** Scripts and styles have no place in a feed item. */
const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

export const absolutizeHtml = (html: string) =>
  html
    .replace(SCRIPT_OR_STYLE, "")
    .replace(
      ROOT_RELATIVE_ATTR,
      (_match, attr: string, path: string) => `${attr}="${absoluteUrl(path)}"`
    )
    .replace(
      SRCSET_ATTR,
      (_match, value: string) =>
        `srcset="${value.replace(
          SRCSET_ROOT_RELATIVE,
          (_m, lead: string, path: string) => `${lead}${absoluteUrl(path)}`
        )}"`
    );

/** Full article HTML with absolute URLs. */
export const renderPostHtml = async (post: Post) => {
  const container = await getContainer();
  const { Content } = await render(post);
  const html = await container.renderToString(Content);
  return absolutizeHtml(html);
};
