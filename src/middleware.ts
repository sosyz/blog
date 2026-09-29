/**
 * Security headers on responses the Worker renders (/api/*, /admin/).
 * Prerendered pages and files are served by Workers static assets, which
 * never runs this: public/_headers gives them the same headers. That includes
 * the 404 page: for an unknown path Astro fetches the prerendered 404.html
 * through the ASSETS binding without running middleware.
 *
 * Only adds what a route did not set itself (see withSecurityHeaders).
 */
import { defineMiddleware } from "astro:middleware";
import { withSecurityHeaders } from "@/lib/server/http";

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (context.isPrerendered) {
    return response;
  }
  return withSecurityHeaders(response);
});
