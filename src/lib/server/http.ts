/**
 * Small HTTP helpers for the API routes. Pure (Web APIs only).
 */

export const STATUS = {
  created: 201,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  tooLarge: 413,
  tooManyRequests: 429,
  badGateway: 502,
  unavailable: 503,
} as const;

/** Largest JSON body the API reads (16 KB). */
export const JSON_BODY_LIMIT = 16_384;

export const KIB = 1024;

/**
 * Enforced CSP: only the parts that cannot break a page. Nobody may frame the
 * site (clickjacking on the review tools), no <base> hijack, no plugins.
 */
export const CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";

/**
 * Report-Only CSP: exactly what the site loads, so violations show in the
 * browser console before it is enforced. No report endpoint (console only).
 * - scripts: our bundles (no inline scripts; JSON-LD is a data block) and
 *   Turnstile. The sticker workshop's cutout worker is served under the same
 *   policy: ONNX Runtime turns its wasm factory into a blob: module and
 *   compiles wasm ('wasm-unsafe-eval').
 * - styles: 'unsafe-inline' because Shiki writes thousands of `style=`
 *   attributes and Astro inlines small stylesheets as <style>; hashes cannot
 *   cover attributes without 'unsafe-hashes'.
 * - images: our files, GitHub avatars, data:/blob: previews in the workshop.
 */
export const CONTENT_SECURITY_POLICY_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' blob: 'wasm-unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Sent with every response. public/_headers sets the same values on static
 * files (`/*` rule) and src/middleware.ts on Worker responses;
 * tests/security-headers.test.ts keeps the three in sync.
 */
export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "content-security-policy-report-only": CONTENT_SECURITY_POLICY_REPORT_ONLY,
} as const;

const setMissingSecurityHeaders = (headers: Headers) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }
};

/**
 * Adds the security headers a response does not set itself (a route's own
 * CSP, e.g. the sticker image's sandbox, wins). Responses with immutable
 * headers (Response.redirect(), fetch()) are copied first.
 */
export const withSecurityHeaders = (response: Response) => {
  try {
    setMissingSecurityHeaders(response.headers);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    setMissingSecurityHeaders(copy.headers);
    return copy;
  }
};

/** JSON response; not cached unless the caller says so. */
export const json = (data: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-store");
  }
  if (!headers.has("x-content-type-options")) {
    headers.set("x-content-type-options", "nosniff");
  }
  return Response.json(data, { ...init, headers });
};

/** Error body is always `{ error: "<中文说明>" }`. */
export const fail = (
  status: number,
  message: string,
  init: ResponseInit = {}
) => json({ error: message }, { ...init, status });

/**
 * POSTs must come from our own pages. Browsers always send Origin on
 * fetch() POSTs; Sec-Fetch-Site is a fallback for older ones.
 */
export const isSameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === new URL(request.url).origin;
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
};

export const crossOrigin = () => fail(STATUS.forbidden, "只能从本站页面提交。");

const FOUND = 302;

/**
 * A redirect that also sets cookies (Response.redirect() has immutable
 * headers, so it cannot carry Set-Cookie).
 */
export const redirectWithCookies = (location: string, cookies: string[]) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: FOUND, headers });
};

const NO_CONTENT = 204;

/** 204 with cookies (and never cached). */
export const noContent = (cookies: string[] = []) => {
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: NO_CONTENT, headers });
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const HTML_SPECIAL = /[&<>"']/g;

export const escapeHtml = (value: string) =>
  value.replace(HTML_SPECIAL, (char) => HTML_ESCAPES[char] ?? char);

/**
 * A tiny standalone page for errors met during a browser navigation (the
 * OAuth callback), where JSON would be unhelpful.
 */
export const htmlMessage = (
  status: number,
  message: string,
  back: string,
  cookies: string[] = []
) => {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>登录没有完成 · Sonui 的手账</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eee2c6;color:#2d2822;font:17px/1.7 system-ui,sans-serif;padding:16px}main{max-width:26rem;background:#fbe7a1;padding:24px 22px;box-shadow:0 10px 18px -12px rgb(60 40 20/.45);rotate:-1deg}a{color:#3d5f8f}</style></head><body><main><h1 style="font-size:20px;margin:0 0 8px">登录没有完成</h1><p style="margin:0 0 12px">${escapeHtml(message)}</p><p style="margin:0"><a href="${escapeHtml(back)}">回到刚才的页面</a></p></main></body></html>`;
  return new Response(body, { status, headers });
};

export const clientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") ??
  request.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ??
  "unknown";

const LEADING_ZEROS = /^0+/;

/** Groups kept from an IPv6 address: its /64 network prefix. */
const IPV6_PREFIX_GROUPS = 4;
const IPV6_GROUPS = 8;

/**
 * The part of an address that identifies one visitor. An IPv6 client usually
 * owns a whole /64 and can rotate through it, so only the first four groups
 * count. IPv4 (and anything unparsable) is returned unchanged.
 */
export const visitorNetwork = (ip: string) => {
  if (!ip.includes(":")) {
    return ip;
  }
  // IPv4-mapped (::ffff:1.2.3.4): the IPv4 address is the visitor.
  if (ip.includes(".")) {
    return ip.split(":").at(-1) ?? ip;
  }
  const [head = "", tail, ...extra] = ip.toLowerCase().split("::");
  if (extra.length > 0) {
    return ip;
  }
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === undefined || tail === "" ? [] : tail.split(":");
  const missing = IPV6_GROUPS - headGroups.length - tailGroups.length;
  if (tail === undefined ? missing !== 0 : missing < 1) {
    return ip;
  }
  const groups = [
    ...headGroups,
    ...Array.from({ length: Math.max(missing, 0) }, () => "0"),
    ...tailGroups,
  ];
  const prefix = groups
    .slice(0, IPV6_PREFIX_GROUPS)
    .map((group) => group.replace(LEADING_ZEROS, "") || "0");
  return `${prefix.join(":")}::/64`;
};

const HEX_PAD = 2;
const HEX = 16;

export const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  let out = "";
  for (const byte of new Uint8Array(digest)) {
    out += byte.toString(HEX).padStart(HEX_PAD, "0");
  }
  return out;
};

/**
 * Visitor fingerprint for rate limits and the admin queue: the IPv4 address
 * or the IPv6 /64 (see visitorNetwork). Salted so the stored hash cannot be
 * reversed by trying every address.
 */
export const hashIp = (ip: string, salt: string) =>
  sha256Hex(`${salt}:${visitorNetwork(ip)}`);

/**
 * Salted like hashIp: an unsalted SHA-256 of an email is the Gravatar id and
 * can be matched against known addresses. Only used as an admin fingerprint.
 */
export const hashEmail = (email: string, salt: string) =>
  sha256Hex(`${salt}:email:${email.trim().toLowerCase()}`);

/**
 * Reads at most `maxBytes` of the request body. Counts the bytes as they
 * arrive, so a chunked body without Content-Length cannot make the Worker
 * buffer (or parse) more than the limit. null when the body is too large.
 */
export const readBodyBytes = async (
  request: Request,
  maxBytes: number
): Promise<Uint8Array<ArrayBuffer> | null> => {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) {
    return null;
  }
  if (!request.body) {
    return new Uint8Array();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    // Chunks must be read one after another.
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

const PLUS = /\+/g;
const SLASH = /\//g;
const PADDING = /=+$/;

export const base64url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(PLUS, "-")
    .replace(SLASH, "_")
    .replace(PADDING, "");
};

/** 32 random bytes = 256 bits. */
const TOKEN_BYTES = 32;

/** A 256-bit random secret as base64url (43 characters, no padding). */
export const randomToken = () =>
  base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));

/** The value of one cookie in a Cookie header, if present. */
export const readCookie = (header: string | null, name: string) => {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return;
};

/** Reads a JSON body; null when it is not valid JSON or too large. */
export const readJson = async (request: Request, maxBytes: number) => {
  try {
    const bytes = await readBodyBytes(request, maxBytes);
    if (!bytes) {
      return null;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
};

/** Parses a body read with readBodyBytes as a form; null when it is not one. */
export const parseForm = async (
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string
) => {
  try {
    const headers = new Headers({ "content-type": contentType });
    return await new Response(bytes, { headers }).formData();
  } catch {
    return null;
  }
};
