// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import {
  hashEmail,
  hashIp,
  readBodyBytes,
  readJson,
  sha256Hex,
  visitorNetwork,
} from "../src/lib/server/http";

/** A POST whose body arrives in chunks, with no Content-Length. */
const chunked = (chunks: string[]) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Request("https://blog.test/api", {
    body,
    // @ts-expect-error `duplex` is required for stream bodies but not typed.
    duplex: "half",
    method: "POST",
  });
};

describe("visitorNetwork", () => {
  test("IPv4 is kept as is", () => {
    expect(visitorNetwork("203.0.113.7")).toBe("203.0.113.7");
    expect(visitorNetwork("unknown")).toBe("unknown");
  });

  test("IPv6 is cut to its /64", () => {
    expect(visitorNetwork("2001:db8:85a3:12:8a2e:370:7334:1")).toBe(
      "2001:db8:85a3:12::/64"
    );
    expect(visitorNetwork("2001:0DB8:0000:0012::1")).toBe("2001:db8:0:12::/64");
    expect(visitorNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(visitorNetwork("::1")).toBe("0:0:0:0::/64");
  });

  test("addresses in one /64 share a network, others do not", () => {
    const a = visitorNetwork("2001:db8:1:2:aaaa::1");
    expect(visitorNetwork("2001:db8:1:2:bbbb:cccc:dddd:eeee")).toBe(a);
    expect(visitorNetwork("2001:db8:1:3::1")).not.toBe(a);
  });

  test("IPv4-mapped IPv6 counts as the IPv4 address", () => {
    expect(visitorNetwork("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  test("malformed IPv6 is left alone", () => {
    expect(visitorNetwork("1::2::3")).toBe("1::2::3");
    expect(visitorNetwork("1:2:3")).toBe("1:2:3");
  });
});

describe("hashes", () => {
  test("hashIp groups an IPv6 /64", async () => {
    expect(await hashIp("2001:db8:1:2::1", "s")).toBe(
      await hashIp("2001:db8:1:2::ffff", "s")
    );
  });

  test("hashEmail is salted and normalised", async () => {
    const plain = await sha256Hex("a@b.cn");
    const salted = await hashEmail(" A@B.cn ", "salt");
    expect(salted).not.toBe(plain);
    expect(salted).toBe(await hashEmail("a@b.cn", "salt"));
    expect(salted).not.toBe(await hashEmail("a@b.cn", "other"));
  });
});

describe("bounded body reads", () => {
  test("a chunked body over the limit is cut off", async () => {
    const request = chunked(["x".repeat(600), "x".repeat(600)]);
    expect(await readBodyBytes(request, 1000)).toBeNull();
  });

  test("a chunked body within the limit is read whole", async () => {
    const bytes = await readBodyBytes(chunked(["ab", "cd"]), 1000);
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe("abcd");
  });

  test("Content-Length over the limit is refused before reading", async () => {
    const request = new Request("https://blog.test/api", {
      body: "x".repeat(20),
      headers: { "content-length": "2000" },
      method: "POST",
    });
    expect(await readBodyBytes(request, 1000)).toBeNull();
  });

  test("readJson parses within the limit and refuses past it", async () => {
    expect(await readJson(chunked(['{"a":', "1}"]), 100)).toEqual({ a: 1 });
    expect(
      await readJson(chunked(['{"a":"', "x".repeat(200), '"}']), 100)
    ).toBe(null);
  });
});
