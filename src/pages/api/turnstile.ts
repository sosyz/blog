/**
 * GET /api/turnstile  the public Turnstile site key, read at runtime from the
 * Worker var TURNSTILE_SITE_KEY (wrangler.jsonc `vars`, or .dev.vars locally).
 * Lets the static pages pick up a new key without a rebuild; a key baked in at
 * build time (astro:env) still takes precedence on the client.
 */
import type { APIRoute } from "astro";
import { turnstileSiteKey } from "@/lib/server/env";
import { json } from "@/lib/server/http";

export const prerender = false;

export const GET: APIRoute = () =>
  json(
    { siteKey: turnstileSiteKey() },
    { headers: { "cache-control": "public, max-age=300" } }
  );
