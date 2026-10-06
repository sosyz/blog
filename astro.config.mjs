// @ts-check

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig, envField } from "astro/config";
import { legacyListRedirects } from "./src/integrations/legacy-list-redirects.ts";
import { addModulePreloads } from "./src/lib/build/modulepreload.ts";
import { markdownConfig } from "./src/lib/markdown/config.ts";
import { noteSlugsPlugin } from "./src/lib/seo/note-slugs.ts";
import { redirects } from "./src/lib/seo/redirects.ts";
import { sitemapOptions } from "./src/lib/seo/sitemap.ts";

// transformers.js (the sticker workshop's cutout worker) imports the WebGPU
// build of ONNX Runtime Web, whose bundle references the ~27 MB asyncify wasm:
// Vite would emit it, and it is over the 25 MiB Workers asset limit. Use the
// CPU-only build that loads the plain SIMD wasm from /ort/ instead
// (public/ort/SOURCE.md).
const ortWasmOnly = join(
  dirname(createRequire(import.meta.url).resolve("onnxruntime-web")),
  "ort.wasm.min.mjs"
);

/**
 * Prerendered pages get <link rel="modulepreload"> for the chunks their
 * scripts import statically (src/lib/build/modulepreload.ts), so the browser
 * fetches them with the entry scripts instead of a round trip later.
 * @type {import("astro").AstroIntegration}
 */
const modulePreloads = {
  hooks: {
    "astro:build:done": async ({ dir, logger }) => {
      const pages = await addModulePreloads(fileURLToPath(dir));
      logger.info(`modulepreload links added to ${pages} pages`);
    },
  },
  name: "journal-modulepreload",
};

// https://astro.build/config
export default defineConfig({
  // Pages are prerendered; only routes with `export const prerender = false`
  // (src/pages/api/**, src/pages/admin/**) run on the Worker.
  adapter: cloudflare({
    // Optimise images at build time with our own service (AI alt text).
    imageService: "compile",
    // Prerender in Node so sharp and the AI SDK work during the build.
    prerenderEnvironment: "node",
  }),
  compressHTML: true,

  env: {
    schema: {
      ACCESS_AUD: envField.string({
        access: "secret",
        context: "server",
        optional: true,
      }),
      ACCESS_TEAM_DOMAIN: envField.string({
        access: "secret",
        context: "server",
        optional: true,
      }),
      // Worker secrets: `wrangler secret put <NAME>`, or .dev.vars locally.
      TURNSTILE_SECRET_KEY: envField.string({
        access: "secret",
        context: "server",
        optional: true,
      }),
      // Public, inlined into client code at build time. Read from the build
      // environment (.env or CI), not from .dev.vars.
      TURNSTILE_SITE_KEY: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
    },
  },
  image: {
    service: {
      entrypoint: "src/lib/ai/image.ts",
    },
  },

  // legacyListRedirects must follow the adapter (see its header).
  integrations: [
    mdx(),
    sitemap(sitemapOptions),
    legacyListRedirects(),
    modulePreloads,
  ],
  markdown: markdownConfig,
  redirects,
  // No sessions: otherwise the adapter provisions a SESSION KV namespace.
  session: false,
  site: "https://blog.sonui.cn",
  trailingSlash: "ignore",

  vite: {
    build: {
      // Never inline a <script> chunk into the page: the CSP (public/_headers)
      // has no 'unsafe-inline' for scripts. Other assets keep the 4 KB default.
      /** @param {string} filePath */
      assetsInlineLimit: (filePath) =>
        filePath.endsWith(".js") ? false : undefined,
    },
    plugins: [noteSlugsPlugin()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "onnxruntime-web/webgpu": ortWasmOnly,
      },
    },
    // The cutout worker is a module worker (dynamic imports).
    worker: { format: "es" },
  },
});
