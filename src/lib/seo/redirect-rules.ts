/**
 * The `_redirects` file that Workers static assets reads, and the limits it
 * must stay within.
 *
 * Cloudflare reads the file top to bottom. A rule whose source has a `*` or a
 * `:placeholder` is dynamic, and from the first dynamic rule on, every later
 * rule counts as dynamic too, even a plain path. Static rules are capped at
 * 2000 and dynamic ones at 100; past the cap the rest of the file is dropped
 * with only a log line (workers-shared parseRedirects.ts). So every splat
 * must come after every static rule.
 *
 * public/_redirects is copied first and the adapter appends the static rules
 * from redirects.ts after it, so public/_redirects holds comments only. The
 * splat rules below are appended at the very end by
 * src/integrations/legacy-list-redirects.ts, which also runs the check.
 *
 * Owner: SEO agent. Relative imports only (loaded by astro.config.mjs).
 */

/** workers-shared: MAX_STATIC_REDIRECT_RULES / MAX_DYNAMIC_REDIRECT_RULES. */
export const MAX_STATIC_RULES = 2000;
export const MAX_DYNAMIC_RULES = 100;

const MOVED = 301;

/**
 * Old Hexo tag, category and archive sub-pages (/tags/Go/, /archives/2024/05/)
 * → the list. Astro redirects cannot send a dynamic route to a fixed page, so
 * these are written straight into dist/client/_redirects.
 */
export const LEGACY_LIST_SPLATS = [
  { from: "/tags/*", to: "/list/" },
  { from: "/categories/*", to: "/list/" },
  { from: "/archives/*", to: "/list/" },
] as const;

export const splatRedirectLines = () =>
  LEGACY_LIST_SPLATS.map(({ from, to }) => `${from} ${to} ${MOVED}`);

const SPLAT = /\*/;
const PLACEHOLDER = /:[A-Za-z]\w*/;
const TRAILING_COMMENT = /\s+#.*$/;
const WHITESPACE = /\s+/;
const MIN_TOKENS = 2;
const MAX_TOKENS = 3;

export interface RedirectRule {
  dynamic: boolean;
  from: string;
  line: number;
}

/** The rules Cloudflare would parse from a `_redirects` file, in order. */
export const parseRedirectRules = (content: string) => {
  const rules: RedirectRule[] = [];
  let sawDynamic = false;
  for (const [index, raw] of content.split("\n").entries()) {
    const text = raw.trim();
    if (text === "" || text.startsWith("#")) {
      continue;
    }
    const tokens = text.replace(TRAILING_COMMENT, "").split(WHITESPACE);
    if (tokens.length < MIN_TOKENS || tokens.length > MAX_TOKENS) {
      continue;
    }
    const from = tokens.at(0) ?? "";
    const dynamic: boolean =
      sawDynamic || SPLAT.test(from) || PLACEHOLDER.test(from);
    sawDynamic = dynamic;
    rules.push({ dynamic, from, line: index + 1 });
  }
  return rules;
};

export interface RedirectReport {
  dynamicRules: number;
  problems: string[];
  staticRules: number;
}

/**
 * Counts the rules and lists what Cloudflare would drop or demote: a plain
 * path after a splat (counted as dynamic), and anything over the limits.
 */
export const checkRedirects = (
  content: string,
  limits: { static: number; dynamic: number } = {
    dynamic: MAX_DYNAMIC_RULES,
    static: MAX_STATIC_RULES,
  }
): RedirectReport => {
  const rules = parseRedirectRules(content);
  const problems: string[] = [];
  let staticRules = 0;
  let dynamicRules = 0;
  for (const rule of rules) {
    if (!rule.dynamic) {
      staticRules += 1;
      continue;
    }
    dynamicRules += 1;
    if (!(SPLAT.test(rule.from) || PLACEHOLDER.test(rule.from))) {
      problems.push(
        `第 ${rule.line} 行 ${rule.from} 在 splat 规则之后，会被当成动态规则`
      );
    }
  }
  if (staticRules > limits.static) {
    problems.push(`静态规则 ${staticRules} 条，超过 ${limits.static} 条`);
  }
  if (dynamicRules > limits.dynamic) {
    problems.push(`动态规则 ${dynamicRules} 条，超过 ${limits.dynamic} 条`);
  }
  return { dynamicRules, problems, staticRules };
};

/** Appends lines at the end, making sure they start on a line of their own. */
export const appendLines = (content: string, lines: readonly string[]) => {
  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${lines.join("\n")}\n`;
};
