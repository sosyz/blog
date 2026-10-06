/**
 * Tencent EdgeOne in front of the Worker (docs/deploy.md 「EdgeOne」).
 *
 * Visitors reach blog.sonui.cn on EdgeOne; EdgeOne fetches from the Worker
 * at its own hostname (cf-blog.sonui.cn), because blog.sonui.cn itself
 * resolves to EdgeOne and Cloudflare only serves hostnames it proxies. Every
 * origin request carries EDGE_AUTH_HEADER with a secret only EdgeOne and the
 * Worker know, and the visitor's IP in EO-Client-IP (EdgeOne's default).
 *
 * `fromEdge` runs first in src/worker.ts: with the right secret the request
 * is rewritten to the public site (so the same-origin check, the GitHub
 * callback and cookies see blog.sonui.cn) and cf-connecting-ip becomes the
 * visitor's IP (rate limits count visitors, not EdgeOne nodes). Anything
 * else passes through untouched: a request straight to cf-blog.sonui.cn
 * cannot claim another IP or host. Pure: no Worker globals, so bun test can
 * import it.
 */

/** Set by EdgeOne on every origin request; its value is EDGE_ORIGIN_SECRET. */
export const EDGE_AUTH_HEADER = "x-edge-auth";
/** EdgeOne's own header with the visitor's IP. */
export const EDGE_CLIENT_IP_HEADER = "eo-client-ip";

export interface EdgeConfig {
  /** EDGE_ORIGIN_SECRET; empty = no EdgeOne, nothing is trusted. */
  secret: string;
  /** The public site, e.g. https://blog.sonui.cn. */
  site: string;
}

/** Compares without stopping at the first difference. */
const sameSecret = (given: string, secret: string) => {
  if (given.length !== secret.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < secret.length; index += 1) {
    diff += given.charCodeAt(index) === secret.charCodeAt(index) ? 0 : 1;
  }
  return diff === 0;
};

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
/** At least two colons: "198.51.100.2:443" is an IPv4 with a port, not IPv6. */
const IPV6 = /^[0-9a-f]*:[0-9a-f]*:[0-9a-f:.]*$/i;
const IPV6_MAX = 45;

/** A plain IPv4 or IPv6 address, or null (ports, names and junk are refused). */
export const plainIp = (value: string | null | undefined) => {
  const ip = value?.trim() ?? "";
  if (IPV4.test(ip) || (ip.length <= IPV6_MAX && IPV6.test(ip))) {
    return ip;
  }
  return null;
};

/** The visitor's IP as EdgeOne reports it: EO-Client-IP, else X-Forwarded-For. */
export const edgeClientIp = (headers: Headers) =>
  plainIp(headers.get(EDGE_CLIENT_IP_HEADER)) ??
  plainIp(headers.get("x-forwarded-for")?.split(",").at(0));

/** The request as the visitor sent it to the public site, if EdgeOne sent it. */
export const fromEdge = (request: Request, config: EdgeConfig): Request => {
  const secret = config.secret.trim();
  const given = request.headers.get(EDGE_AUTH_HEADER);
  if (!(secret && given !== null && sameSecret(given, secret))) {
    return request;
  }
  // Built from the site, not by setting .host: that would keep the origin's port.
  const { pathname, search } = new URL(request.url);
  const url = new URL(`${pathname}${search}`, config.site);
  const headers = new Headers(request.headers);
  headers.delete(EDGE_AUTH_HEADER);
  const ip = edgeClientIp(request.headers);
  if (ip) {
    headers.set("cf-connecting-ip", ip);
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(url, {
    body: hasBody ? request.body : null,
    headers,
    method: request.method,
    redirect: "manual",
  });
};
