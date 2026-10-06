/**
 * Pure rules for the Turnstile status line (turnstile.ts): the texts, when
 * the Cloudflare widget itself is on screen, and how it is rendered. No DOM
 * or astro:env, so bun test can import it.
 *
 * The widget starts invisible (`interaction-only`: Cloudflare shows a box
 * only when it wants a click). When that fails, 点这里手动验证 renders it
 * again always visible (`manual`), so the visitor can click the checkbox and
 * see Cloudflare's own messages instead of retrying blind.
 */

export type State = "idle" | "wait" | "ok" | "need" | "fail" | "off";

export const TEXT: Record<State, string> = {
  fail: "验证没通过，点这里手动验证",
  idle: "寄出前会确认你不是机器人",
  need: "请点一下下面的验证",
  off: "人机验证暂时不可用，没法提交",
  ok: "已确认",
  wait: "正在确认你不是机器人……",
};

/** Cloudflare error codes look like 600010 or 110200. */
const ERROR_CODE = /^\d{3,6}$/;

/** The fail text, with Cloudflare's error code when there is one. */
export const failText = (code?: string) =>
  code && ERROR_CODE.test(code)
    ? `验证没通过（${code}），点这里手动验证`
    : TEXT.fail;

export const appearanceFor = (manual: boolean) =>
  manual ? ("always" as const) : ("interaction-only" as const);

/**
 * Is the widget's box on screen? When Cloudflare asks for a click, and in
 * manual mode until it passes (the widget then shows its own progress and
 * errors).
 */
export const boxShown = (state: State, manual: boolean) =>
  state === "need" || (manual && state !== "ok" && state !== "off");
