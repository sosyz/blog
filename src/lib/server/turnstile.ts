/**
 * Server-side Turnstile check.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * Pure apart from `fetch`, which can be injected for tests.
 */

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type SiteverifyResponse = {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
  action?: string;
  metadata?: { result_with_testing_key?: boolean };
};

export type TurnstileCheck = {
  secret: string | undefined;
  token: string;
  remoteip?: string;
  /** The action the widget was rendered with ("comment", "inline", "sticker"). */
  action: string;
  /** Hostname of the site the form was served from. */
  hostname: string;
  fetchFn?: typeof fetch;
};

export type TurnstileResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export const verifyTurnstile = async ({
  secret,
  token,
  remoteip,
  action,
  hostname,
  fetchFn = fetch,
}: TurnstileCheck): Promise<TurnstileResult> => {
  if (!secret) {
    return {
      ok: false,
      status: 503,
      message: "人机验证还没配置好，暂时不能提交。",
    };
  }
  let data: SiteverifyResponse;
  try {
    const response = await fetchFn(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip }),
    });
    data = (await response.json()) as SiteverifyResponse;
  } catch {
    return {
      ok: false,
      status: 502,
      message: "人机验证服务暂时连不上，过一会儿再试。",
    };
  }
  if (!data.success) {
    return {
      ok: false,
      status: 403,
      message: "人机验证没通过，点一下验证状态重试。",
    };
  }
  // Cloudflare's test keys answer with hostname "example.com" and no action,
  // so these two checks only apply to real keys.
  if (
    !data.metadata?.result_with_testing_key &&
    (data.hostname !== hostname || data.action !== action)
  ) {
    return {
      ok: false,
      status: 403,
      message: "人机验证的结果和这个页面对不上，刷新后再试。",
    };
  }
  return { ok: true };
};
