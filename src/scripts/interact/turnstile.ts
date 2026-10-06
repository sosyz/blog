/**
 * Client side of Turnstile: invisible unless Cloudflare needs an
 * interaction (`appearance: "interaction-only"`); a hand-written status line
 * shows 正在确认你不是机器人…… → 已确认, or 验证没通过，点这里手动验证, which
 * renders the widget again always visible so the checkbox can be clicked
 * (rules in turnstile-state.ts).
 *
 * Markup comes from Turnstile.astro (static forms) or `turnstileMarkup()`
 * (forms built by scripts); both use the same classes.
 */
import { TURNSTILE_SITE_KEY } from "astro:env/client";
import {
  appearanceFor,
  boxShown,
  failText,
  type State,
  TEXT,
} from "./turnstile-state";
import { esc } from "./util";

interface RenderOptions {
  action: string;
  "after-interactive-callback": () => void;
  appearance: "always" | "execute" | "interaction-only";
  "before-interactive-callback": () => void;
  callback: (token: string) => void;
  "error-callback": (code?: string) => boolean;
  "expired-callback": () => void;
  language: string;
  sitekey: string;
  size: "normal" | "flexible" | "compact";
  theme: "light" | "dark" | "auto";
  "timeout-callback": () => void;
}

interface TurnstileApi {
  getResponse: (id: string) => string | undefined;
  remove: (id: string) => void;
  render: (container: HTMLElement, options: RenderOptions) => string;
  reset: (id: string) => void;
}

declare global {
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

export interface TurnstileHandle {
  /** False once it is known that no site key is configured (forms cannot be sent). */
  available: boolean;
  remove: () => void;
  /** Tokens are single-use: call after every submit attempt. */
  reset: () => void;
  /** Current token, or "" while not verified. */
  token: () => string;
}

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
  let siteKey = "";
  /** After a failure: the widget is always visible, for a manual click. */
  let manual = false;

  const set = (state: State, text = TEXT[state]) => {
    if (status) {
      status.dataset.state = state;
      status.disabled = state !== "fail";
    }
    if (label) {
      label.textContent = text;
    }
    box?.classList.toggle("show", boxShown(state, manual));
  };

  const handle: TurnstileHandle = {
    available: true,
    remove: () => {
      if (api && widgetId) {
        api.remove(widgetId);
        widgetId = undefined;
      }
    },
    reset: () => {
      if (api && widgetId) {
        set("wait");
        api.reset(widgetId);
      }
    },
    token: () => (api && widgetId ? (api.getResponse(widgetId) ?? "") : ""),
  };
  handles.set(wrap, handle);

  if (!box) {
    handle.available = false;
    set("off");
    return handle;
  }
  const render = (loaded: TurnstileApi) => {
    widgetId = loaded.render(box, {
      action,
      // Passed or failed, `callback` / `error-callback` says which.
      "after-interactive-callback": () => set("wait"),
      appearance: appearanceFor(manual),
      "before-interactive-callback": () => set("need"),
      callback: () => set("ok"),
      "error-callback": (code) => {
        set("fail", failText(code));
        return true;
      },
      "expired-callback": () => set("wait"),
      language: "zh-cn",
      sitekey: siteKey,
      size: "flexible",
      theme: "light",
      "timeout-callback": () => set("fail"),
    });
  };

  const start = async () => {
    siteKey = await resolveSiteKey();
    if (!siteKey) {
      handle.available = false;
      set("off");
      return;
    }
    const loaded = await loadTurnstile();
    api = loaded;
    if (wrap.isConnected) {
      render(loaded);
    }
  };

  /** 点这里手动验证: render it again, always visible, for a click. */
  const retryManually = () => {
    manual = true;
    if (api && siteKey) {
      if (widgetId) {
        api.remove(widgetId);
        widgetId = undefined;
      }
      set("need");
      render(api);
      return;
    }
    // The script never loaded (blocked or offline): try loading it again.
    set("wait");
    start().catch(() => set("fail"));
  };

  set("wait");
  status?.addEventListener("click", retryManually);
  start().catch(() => set("fail"));
  return handle;
};
