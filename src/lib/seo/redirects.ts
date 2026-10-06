import type { AstroUserConfig } from "astro";
import { readPostFiles } from "./post-files.ts";

/**
 * Static 301 redirects: old Hexo URLs, old Hexo archive pages, the old
 * /about/ page and the pre-2.0 Astro /blog/<slug>/ pages.
 *
 * With the Cloudflare adapter these are written to dist/client/_redirects and
 * handled by Workers static assets before the Worker runs. The adapter adds
 * both the `/x` and `/x/` form of every entry (trailingSlash: "ignore").
 * Keys must be plain paths: a `*` or `:name` here would make the rules after
 * it dynamic (see redirect-rules.ts).
 *
 * Old Hexo post URLs keep their original case and encode spaces as `%20`
 * (map in docs/migration.md). Cloudflare matches static rules against the raw
 * request pathname, where a space stays `%20`, so the keys below are written
 * encoded. Matching is case-sensitive, so the case must stay as it was.
 *
 * Owner: SEO agent. Imported by astro.config.mjs (relative imports only).
 */

type Redirects = NonNullable<AstroUserConfig["redirects"]>;

/** Old Hexo `/:title/` → new slug. Keep in sync with docs/migration.md. */
const HEXO_POSTS: Record<string, string> = {
  "/C-C-Binary-Trees/": "c-cpp-binary-trees",
  "/css-study-1/": "css-study-1",
  "/css-study-2/": "css-study-2",
  "/development-notes-for-apache-answer-plugin/":
    "development-notes-for-apache-answer-plugin",
  "/easySQLite-use-note/": "easysqlite-use-note",
  "/favorites/": "favorites",
  "/fitness-function-driven-development/":
    "fitness-function-driven-development",
  "/Go%20Redis%20Lib%20Serialize%20Struct/": "go-redis-lib-serialize-struct",
  "/go-context/": "go-context",
  "/Hydro-2-Custom-Development-Notes-Frontend-Section/":
    "hydro-2-custom-development-notes-frontend-section",
  "/how%20to%20set%20up%20cors/": "how-to-set-up-cors",
  "/Journey-to-Web-Development-Security/":
    "journey-to-web-development-security",
  "/k8s-install/": "k8s-install",
  "/kubesphere-extended-component-development-note/":
    "kubesphere-extended-component-development-note",
  "/Linux-Error-Certificate-verification-failed-The-certificate-is-NOT-trusted/":
    "linux-certificate-not-trusted",
  "/Python-Code-to-Convert-Chinese-Uppercase-Amounts-to-Lowercase-Numbers/":
    "python-chinese-amount-to-number",
  "/provide-idempotence-mechanisms/": "provide-idempotence-mechanisms",
  "/Redis-Reading-Notes/": "redis-reading-notes",
  "/rename-pve-hostname/": "rename-pve-hostname",
  "/restricting-access-to-mapped-ports-in-docker-containers/":
    "restrict-docker-mapped-ports",
  "/running-golang-code-on-tencent-cloud-FaaS/":
    "running-golang-code-on-tencent-cloud-faas",
  "/Setting-Up-the-VS-Code-C-C-Environment/": "vscode-cpp-environment",
  "/the-haters-guide-to-kubernetes/": "the-haters-guide-to-kubernetes",
  "/WireGuard%20Use%20Notes/": "wireguard-use-notes",
};

/** Hexo archive and pagination pages (the old site had 3 pages). */
const HEXO_LISTS = ["/archives/", "/page/2/", "/page/3/"];

// Hexo tag, category and archive sub-pages (/tags/Go/, /archives/2024/05/)
// are splat rules in redirect-rules.ts: Astro redirects cannot send a dynamic
// route to a fixed page. They must come after every rule below (a splat turns
// all later rules dynamic, capped at 100), so the legacy-list-redirects
// integration appends them at the very end of dist/client/_redirects.
//
// Every rule here is static (limit 2000), so the /blog/<slug>/ rules stay:
// about 216 lines with both slash forms, far from the limit.

const notePath = (slug: string) => `/notes/${slug}/`;

const permanent = (destination: string) => ({
  destination,
  status: 301 as const,
});

const buildRedirects = (): Redirects => {
  const redirects: Redirects = {
    "/about/": permanent("/"),
    "/blog/": permanent("/list/"),
  };
  for (const path of HEXO_LISTS) {
    redirects[path] = permanent("/list/");
  }
  for (const [from, slug] of Object.entries(HEXO_POSTS)) {
    redirects[from] = permanent(notePath(slug));
  }
  // Pre-2.0 Astro pages lived at /blog/<id>/ with the same ids.
  for (const { slug } of readPostFiles()) {
    redirects[`/blog/${slug}/`] = permanent(notePath(slug));
  }
  return redirects;
};

export const redirects: Redirects = buildRedirects();
