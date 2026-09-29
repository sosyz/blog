/**
 * Client side of Turnstile: invisible unless Cloudflare needs an
 * interaction (`appearance: "interaction-only"`); a hand-written status line
 * shows 正在确认你不是机器人…… → 已确认, or 验证没通过，点这里重试.
 *
 * Markup comes from Turnstile.astro (static forms) or `turnstileMarkup()`
 * (forms built by scripts); both use the same classes.
 */
import { TURNSTILE_SITE_KEY } from "astro:env/client";
import { esc } from "./util";

type RenderOptions = {
  sitekey: string;
  action: string;
  appearance: "always" | "execute" | "interaction-only";
  theme: "light" | "dark" | "auto";
  language: string;
  size: "normal" | "flexible" | "compact";
  callback: (token: string) => void;
  "error-callback": () => boolean;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "before-interactive-callback": () => void;
  "after-interactive-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: RenderOptions) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
  getResponse: (id: string) => string | undefined;
};

declare global {
  // biome-ignore lint/nursery/useConsistentTypeDefinitions: global augmentation needs interfaces
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** Cloudflare's always-pass test key, used only by `astro dev` without a key. */
const TEST_SITE_KEY = "1x00000000000000000000AA";

/**
 * The site key is public. A key baked in at build time (TURNSTILE_SITE_KEY in
 * .env / CI) wins; otherwise it is read at runtime from the Worker
 * (GET /api/turnstile, which reads the TURNSTILE_SITE_KEY var from
 * wrangler.jsonc / .dev.vars), so changing keys never needs a rebuild.
 */
let siteKeyPromise: Promise<string> | undefined;

const resolveSiteKey = () => {
  siteKeyPromise ??= (async () => {
    if (TURNSTILE_SITE_KEY) {
      return TURNSTILE_SITE_KEY;
    }
    try {
      const response = await fetch("/api/turnstile", {
        headers: { accept: "application/json" },
      });
      if (response.ok) {
        const data = (await response.json()) as { siteKey?: unknown };
        if (typeof data.siteKey === "string" && data.siteKey) {
          return data.siteKey;
        }
      }
    } catch {
      // Offline or the API is not deployed: fall through.
    }
    return import.meta.env.DEV ? TEST_SITE_KEY : "";
  })();
  return siteKeyPromise;
};

type State = "idle" | "wait" | "ok" | "need" | "fail" | "off";

const TEXT: Record<State, string> = {
  idle: "寄出前会确认你不是机器人",
  wait: "正在确认你不是机器人……",
  ok: "已确认",
  need: "请点一下下面的验证",
  fail: "验证没通过，点这里重试",
  off: "人机验证暂时不可用，没法提交",
};

let loading: Promise<TurnstileApi> | undefined;

const loadTurnstile = () => {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.addEventListener("load", () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        reject(new Error("turnstile missing"));
      }
    });
    script.addEventListener("error", () => {
      loading = undefined;
      reject(new Error("turnstile blocked"));
    });
    document.head.appendChild(script);
  });
  return loading;
};

/** Same markup as Turnstile.astro, for forms built by scripts. */
export const turnstileMarkup = (action: string) =>
  `<div class="ts-wrap" data-turnstile data-action="${esc(action)}">
    <span class="ts-live" aria-live="polite"><button type="button" class="ts-status" data-state="idle" disabled><i aria-hidden="true"></i><span>${TEXT.idle}</span></button></span>
    <div class="ts-box"></div>
  </div>`;

export type TurnstileHandle = {
  /** Current token, or "" while not verified. */
  token: () => string;
  /** Tokens are single-use: call after every submit attempt. */
  reset: () => void;
  remove: () => void;
  /** False once it is known that no site key is configured (forms cannot be sent). */
  available: boolean;
};

/**
 * Renders the widget into a `.ts-wrap`. Safe to call once per wrap; later
 * calls return the same handle.
 */
const handles = new WeakMap<HTMLElement, TurnstileHandle>();

export const mountTurnstile = (wrap: HTMLElement): TurnstileHandle => {
  const existing = handles.get(wrap);
  if (existing) {
    return existing;
  }
  const status = wrap.querySelector<HTMLButtonElement>(".ts-status");
  const label = status?.querySelector("span");
  const box = wrap.querySelector<HTMLElement>(".ts-box");
  const action = wrap.dataset.action ?? "comment";
  let widgetId: string | undefined;
  let api: TurnstileApi | undefined;

  const set = (state: State) => {
    if (status) {
      status.dataset.state = state;
      status.disabled = state !== "fail";
    }
    if (label) {
      label.textContent = TEXT[state];
    }
    box?.classList.toggle("show", state === "need");
  };

  const handle: TurnstileHandle = {
    available: true,
    token: () => (api && widgetId ? (api.getResponse(widgetId) ?? "") : ""),
    reset: () => {
      if (api && widgetId) {
        set("wait");
        api.reset(widgetId);
      }
    },
    remove: () => {
      if (api && widgetId) {
        api.remove(widgetId);
        widgetId = undefined;
      }
    },
  };
  handles.set(wrap, handle);

  if (!box) {
    handle.available = false;
    set("off");
    return handle;
  }
  set("wait");
  status?.addEventListener("click", () => handle.reset());
  resolveSiteKey()
    .then(async (siteKey) => {
      if (!siteKey) {
        handle.available = false;
        set("off");
        return;
      }
      const loaded = await loadTurnstile();
      api = loaded;
      if (!wrap.isConnected) {
        return;
      }
      widgetId = loaded.render(box, {
        sitekey: siteKey,
        action,
        appearance: "interaction-only",
        theme: "light",
        language: "zh-cn",
        size: "flexible",
        callback: () => set("ok"),
        "error-callback": () => {
          set("fail");
          return true;
        },
        "expired-callback": () => set("wait"),
        "timeout-callback": () => set("fail"),
        "before-interactive-callback": () => set("need"),
        "after-interactive-callback": () => box.classList.remove("show"),
      });
    })
    .catch(() => set("fail"));
  return handle;
};
