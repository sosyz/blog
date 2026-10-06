import { describe, expect, test } from "bun:test";
import {
  EDGE_AUTH_HEADER,
  EDGE_CLIENT_IP_HEADER,
  edgeClientIp,
  fromEdge,
  plainIp,
} from "../src/lib/server/edge";

const SECRET = "s3cret-edge-value";
const CONFIG = { secret: SECRET, site: "https://blog.sonui.cn" };
const ORIGIN = "https://cf-blog.sonui.cn/api/comments?slug=go-context";

const edgeRequest = (headers: Record<string, string>, init: RequestInit = {}) =>
  new Request(ORIGIN, {
    ...init,
    headers: { "cf-connecting-ip": "43.0.0.1", ...headers },
  });

describe("fromEdge", () => {
  test("with the secret: public host, visitor IP, secret removed", () => {
    const request = fromEdge(
      edgeRequest({
        [EDGE_AUTH_HEADER]: SECRET,
        [EDGE_CLIENT_IP_HEADER]: "203.0.113.7",
      }),
      CONFIG
    );
    expect(request.url).toBe(
      "https://blog.sonui.cn/api/comments?slug=go-context"
    );
    expect(request.headers.get("cf-connecting-ip")).toBe("203.0.113.7");
    expect(request.headers.has(EDGE_AUTH_HEADER)).toBe(false);
  });

  test("the origin's port is dropped", () => {
    const request = fromEdge(
      new Request("http://localhost:4321/api/stickers?me=1", {
        headers: { [EDGE_AUTH_HEADER]: SECRET },
      }),
      CONFIG
    );
    expect(request.url).toBe("https://blog.sonui.cn/api/stickers?me=1");
  });

  test("keeps the method and body of a POST", async () => {
    const request = fromEdge(
      edgeRequest(
        { [EDGE_AUTH_HEADER]: SECRET, "content-type": "application/json" },
        { body: '{"a":1}', method: "POST" }
      ),
      CONFIG
    );
    expect(request.method).toBe("POST");
    expect(await request.text()).toBe('{"a":1}');
    expect(request.headers.get("content-type")).toBe("application/json");
  });

  test("without EO-Client-IP the first X-Forwarded-For is used", () => {
    const request = fromEdge(
      edgeRequest({
        [EDGE_AUTH_HEADER]: SECRET,
        "x-forwarded-for": "2001:db8::1, 10.0.0.1",
      }),
      CONFIG
    );
    expect(request.headers.get("cf-connecting-ip")).toBe("2001:db8::1");
  });

  test("a wrong or missing secret changes nothing", () => {
    const cases: Record<string, string>[] = [
      { [EDGE_AUTH_HEADER]: "guess", [EDGE_CLIENT_IP_HEADER]: "1.2.3.4" },
      { [EDGE_CLIENT_IP_HEADER]: "1.2.3.4" },
    ];
    for (const headers of cases) {
      const original = edgeRequest(headers);
      const request = fromEdge(original, CONFIG);
      expect(request).toBe(original);
      expect(request.headers.get("cf-connecting-ip")).toBe("43.0.0.1");
    }
  });

  test("no secret configured: nothing is trusted", () => {
    const original = edgeRequest({ [EDGE_AUTH_HEADER]: "" });
    expect(fromEdge(original, { ...CONFIG, secret: "" })).toBe(original);
  });

  test("a junk client IP keeps Cloudflare's", () => {
    const request = fromEdge(
      edgeRequest({
        [EDGE_AUTH_HEADER]: SECRET,
        [EDGE_CLIENT_IP_HEADER]: "evil.example",
      }),
      CONFIG
    );
    expect(request.url.startsWith("https://blog.sonui.cn/")).toBe(true);
    expect(request.headers.get("cf-connecting-ip")).toBe("43.0.0.1");
  });
});

describe("client IP parsing", () => {
  test("plain addresses only", () => {
    expect(plainIp(" 198.51.100.2 ")).toBe("198.51.100.2");
    expect(plainIp("2001:db8::2")).toBe("2001:db8::2");
    expect(plainIp("198.51.100.2:443")).toBeNull();
    expect(plainIp("example.com")).toBeNull();
    expect(plainIp(null)).toBeNull();
  });

  test("EO-Client-IP wins over X-Forwarded-For", () => {
    const headers = new Headers({
      [EDGE_CLIENT_IP_HEADER]: "198.51.100.3",
      "x-forwarded-for": "198.51.100.4",
    });
    expect(edgeClientIp(headers)).toBe("198.51.100.3");
  });
});
