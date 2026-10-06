// biome-ignore-all lint/style/noMagicNumbers: test fixtures and expected values
import { describe, expect, test } from "bun:test";
import { verifyTurnstile } from "../src/lib/server/turnstile";

const reply = (body: unknown) =>
  (() => Promise.resolve(Response.json(body))) as unknown as typeof fetch;

const base = {
  action: "comment",
  hostname: "blog.sonui.cn",
  secret: "s",
  token: "t",
};

describe("verifyTurnstile", () => {
  test("no secret configured → 503", async () => {
    const result = await verifyTurnstile({ ...base, secret: undefined });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  test("success with matching hostname and action", async () => {
    const fetchFn = reply({
      action: "comment",
      hostname: "blog.sonui.cn",
      success: true,
    });
    expect(await verifyTurnstile({ ...base, fetchFn })).toEqual({ ok: true });
  });

  test("sends secret, token and remote ip", async () => {
    let sent: Record<string, string> = {};
    const fetchFn = ((_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Promise.resolve(
        Response.json({
          action: "comment",
          hostname: "blog.sonui.cn",
          success: true,
        })
      );
    }) as unknown as typeof fetch;
    await verifyTurnstile({ ...base, fetchFn, remoteip: "1.2.3.4" });
    expect(sent).toEqual({ remoteip: "1.2.3.4", response: "t", secret: "s" });
  });

  test("failure → 403", async () => {
    const fetchFn = reply({
      "error-codes": ["invalid-input-response"],
      success: false,
    });
    expect(await verifyTurnstile({ ...base, fetchFn })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  test("wrong hostname or action → 403", async () => {
    const other = reply({
      action: "comment",
      hostname: "evil.example",
      success: true,
    });
    expect(await verifyTurnstile({ ...base, fetchFn: other })).toMatchObject({
      ok: false,
      status: 403,
    });
    const action = reply({
      action: "sticker",
      hostname: "blog.sonui.cn",
      success: true,
    });
    expect(await verifyTurnstile({ ...base, fetchFn: action })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  test("Cloudflare test keys skip the hostname/action check", async () => {
    const fetchFn = reply({
      hostname: "example.com",
      metadata: { result_with_testing_key: true },
      success: true,
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
