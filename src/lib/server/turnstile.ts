/**
 * Server-side Turnstile check.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * Pure apart from `fetch`, which can be injected for tests.
 */

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  action?: string;
  "error-codes"?: string[];
  hostname?: string;
  metadata?: { result_with_testing_key?: boolean };
  success: boolean;
}

export interface TurnstileCheck {
  /** The action the widget was rendered with ("comment", "inline", "sticker"). */
  action: string;
  fetchFn?: typeof fetch;
  /** Hostname of the site the form was served from. */
  hostname: string;
  remoteip?: string;
  secret: string | undefined;
  token: string;
}

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
      message: "人机验证还没配置好，暂时不能提交。",
      ok: false,
      status: 503,
    };
  }
  let data: SiteverifyResponse;
  try {
    const response = await fetchFn(SITEVERIFY, {
      body: JSON.stringify({ remoteip, response: token, secret }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    data = (await response.json()) as SiteverifyResponse;
  } catch {
    return {
      message: "人机验证服务暂时连不上，过一会儿再试。",
      ok: false,
      status: 502,
    };
  }
  if (!data.success) {
    return {
      message: "人机验证没通过，点一下验证状态重试。",
      ok: false,
      status: 403,
    };
  }
  // Cloudflare's test keys answer with hostname "example.com" and no action,
  // so these two checks only apply to real keys.
  if (
    !data.metadata?.result_with_testing_key &&
    (data.hostname !== hostname || data.action !== action)
  ) {
    return {
      message: "人机验证的结果和这个页面对不上，刷新后再试。",
      ok: false,
      status: 403,
    };
  }
  return { ok: true };
};
