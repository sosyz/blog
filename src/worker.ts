/**
 * The Worker entry (wrangler.jsonc `main`): Astro's Cloudflare handler, with
 * requests from EdgeOne rewritten to the public site first
 * (src/lib/server/edge.ts). Static files are served by the assets layer
 * before this runs, so only /api/*, /admin/ and 404s pass through here.
 */
import { handle } from "@astrojs/cloudflare/handler";
import { SITE_URL } from "./lib/seo/site";
import { fromEdge } from "./lib/server/edge";

interface EdgeVars {
  EDGE_ORIGIN_SECRET?: string;
}

export default {
  fetch: (request, env, context) =>
    handle(
      fromEdge(request, {
        secret: (env as EdgeVars).EDGE_ORIGIN_SECRET ?? "",
        site: SITE_URL,
      }),
      env,
      context
    ),
} satisfies ExportedHandler<Env>;
