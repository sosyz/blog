import { readFile, writeFile } from "node:fs/promises";
import type { AstroIntegration } from "astro";
import {
  appendLines,
  checkRedirects,
  splatRedirectLines,
} from "../lib/seo/redirect-rules.ts";

/**
 * Appends the old Hexo /tags/*, /categories/* and /archives/* splat rules to
 * the very end of dist/client/_redirects, after the static rules the
 * Cloudflare adapter writes, then fails the build if Cloudflare would drop or
 * demote any rule (see src/lib/seo/redirect-rules.ts).
 *
 * Must be listed after the adapter: Astro runs the adapter's
 * `astro:build:done` first (it is put at the front of `integrations`), and
 * that hook is where the static rules are appended.
 *
 * Owner: SEO agent. Relative imports only (loaded by astro.config.mjs).
 */
export const legacyListRedirects = (): AstroIntegration => ({
  name: "journal-legacy-list-redirects",
  hooks: {
    "astro:build:done": async ({ dir, logger }) => {
      const file = new URL("_redirects", dir);
      let content = "";
      try {
        content = await readFile(file, "utf-8");
      } catch {
        // No file yet: the splat rules are the only ones.
      }
      const merged = appendLines(content, splatRedirectLines());
      const report = checkRedirects(merged);
      if (report.problems.length > 0) {
        throw new Error(
          `dist/client/_redirects 会被 Cloudflare 截断或降级：\n${report.problems.join("\n")}`
        );
      }
      await writeFile(file, merged);
      logger.info(
        `_redirects: ${report.staticRules} static + ${report.dynamicRules} splat rules`
      );
    },
  },
});
