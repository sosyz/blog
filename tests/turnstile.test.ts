// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import { verifyTurnstile } from "../src/lib/server/turnstile";

const reply = (body: unknown) =>
  (() => Promise.resolve(Response.json(body))) as unknown as typeof fetch;

const base = {
  secret: "s",
  token: "t",
  action: "comment",
  hostname: "blog.sonui.cn",
};

describe("verifyTurnstile", () => {
  test("no secret configured → 503", async () => {
    const result = await verifyTurnstile({ ...base, secret: undefined });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  test("success with matching hostname and action", async () => {
    const fetchFn = reply({
      success: true,
      hostname: "blog.sonui.cn",
      action: "comment",
    });
    expect(await verifyTurnstile({ ...base, fetchFn })).toEqual({ ok: true });
  });

  test("sends secret, token and remote ip", async () => {
    let sent: Record<string, string> = {};
    const fetchFn = ((_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Promise.resolve(
        Response.json({
          success: true,
          hostname: "blog.sonui.cn",
          action: "comment",
        })
      );
    }) as unknown as typeof fetch;
    await verifyTurnstile({ ...base, remoteip: "1.2.3.4", fetchFn });
    expect(sent).toEqual({ secret: "s", response: "t", remoteip: "1.2.3.4" });
  });

  test("failure → 403", async () => {
    const fetchFn = reply({
      success: false,
      "error-codes": ["invalid-input-response"],
    });
    expect(await verifyTurnstile({ ...base, fetchFn })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  test("wrong hostname or action → 403", async () => {
    const other = reply({
      success: true,
      hostname: "evil.example",
      action: "comment",
    });
    expect(await verifyTurnstile({ ...base, fetchFn: other })).toMatchObject({
      ok: false,
      status: 403,
    });
    const action = reply({
      success: true,
      hostname: "blog.sonui.cn",
      action: "sticker",
    });
    expect(await verifyTurnstile({ ...base, fetchFn: action })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  test("Cloudflare test keys skip the hostname/action check", async () => {
    const fetchFn = reply({
      success: true,
      hostname: "example.com",
      metadata: { result_with_testing_key: true },
    });
    expect(await verifyTurnstile({ ...base, fetchFn })).toEqual({ ok: true });
  });

  test("network error → 502", async () => {
    const fetchFn = (() =>
      Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await verifyTurnstile({ ...base, fetchFn })).toMatchObject({
      ok: false,
      status: 502,
    });
  });
});
