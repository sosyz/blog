/**
 * 贴一张贴纸: pick an image (checked here first: type by magic bytes, ≤ 10 MB)
 * → 贴纸工坊 (sticker-workshop.ts) turns it into a die-cut sticker ≤ 300 KB,
 * ≤ 512×512 → it appears in the middle of the visible desk → drag it where
 * you want (drag the round handle to rotate, the square handle or the wheel /
 * pinch to resize; arrow keys move, [ ] rotate, - = resize) → Turnstile → 贴上. The sticker then shows for this visitor
 * only, dashed with 审核中, until it is approved.
 *
 * The button (StickerUpload.astro, in the toolbar) stays hidden unless a
 * canvas is on the page. The gestures are shared with moving a placed
 * sticker (sticker-transform.ts); the edit token from the response is kept in
 * sticker-store.ts so the uploader can move the sticker later
 * (sticker-edit.ts).
 */
import type { StickerCreatedResponse } from "@/lib/server/types";
import type { CanvasApi, Point } from "@/scripts/canvas/api";
import { CANVAS_READY } from "@/scripts/canvas/api";
import { announce } from "./announce";
import {
  authBarHtml,
  authNow,
  bindLogout,
  currentPath,
  getAuth,
  SKIP_TURNSTILE_HTML,
  subscribe as subscribeAuth,
} from "./auth";
import { checkWorkshopInput } from "./sticker-fit";
import { addOwnedSticker, addPendingSticker } from "./sticker-store";
import {
  applyPlacement,
  clampEdit,
  HANDLES_HTML,
  KEY_HELP,
  keyChange,
  ROTATE_STEP,
  SCALE_STEP,
  type SizedPlacement,
  trackTransform,
  wheelScale,
} from "./sticker-transform";
import { StickerWorkshop, type WorkshopResult } from "./sticker-workshop";
import {
  mountTurnstile,
  type TurnstileHandle,
  turnstileMarkup,
} from "./turnstile";
import { esc, readProfile, requestJson } from "./util";

const CLOSE_AFTER = 2600;
/** A drawer narrower than this from the left edge is treated as covering the desk. */
const MIN_DESK = 200;

/** The canvas on this page, if it is actually showing. */
const liveCanvas = (): CanvasApi | null => {
  const api = window.__canvas;
  if (!api?.viewportEl.isConnected) {
    return null;
  }
  return api.viewportEl.getClientRects().length > 0 ? api : null;
};

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });

/** Centre of the desk area that is not covered by the drawer, in viewport coords. */
const deskCentre = (api: CanvasApi): Point => {
  const rect = api.viewportEl.getBoundingClientRect();
  const drawer = document.querySelector<HTMLElement>("[data-drawer], .drawer");
  const drawerRect = drawer?.getBoundingClientRect();
  const drawerOpen =
    drawerRect &&
    drawerRect.width > 0 &&
    drawerRect.left > rect.left + MIN_DESK;
  const right = drawerOpen ? drawerRect.left : rect.right;
  return { x: (rect.left + right) / 2 - rect.left, y: rect.height / 2 };
};

type Placement = SizedPlacement;

class StickerSession {
  readonly api: CanvasApi;
  readonly image: Blob;
  readonly objectUrl: string;
  readonly placement: Placement;
  readonly el: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly onDone: () => void;
  turnstile: TurnstileHandle | null = null;
  /** Logged in with GitHub (the form has no 署名 and no Turnstile). */
  member = false;
  /** The login state the form was last filled for. */
  authKey = "";
  closed = false;
  readonly cleanups: (() => void)[] = [];

  constructor(
    api: CanvasApi,
    image: Blob,
    size: { width: number; height: number },
    onDone: () => void
  ) {
    this.api = api;
    this.image = image;
    this.onDone = onDone;
    this.objectUrl = URL.createObjectURL(image);
    const centre = api.screenToWorld(deskCentre(api));
    this.placement = {
      rotation: 0,
      scale: 1,
      x: Math.round(centre.x),
      y: Math.round(centre.y),
      ...size,
    };
    this.el = this.buildSticker();
    this.panel = this.buildPanel();
    api.worldEl.appendChild(this.el);
    document.body.appendChild(this.panel);
    this.apply();
    this.wire();
    this.el.focus({ preventScroll: true });
  }

  buildSticker() {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "vs-place";
    el.setAttribute("aria-label", `要贴的贴纸：${KEY_HELP}`);
    el.innerHTML = `<img src="${this.objectUrl}" alt="" draggable="false" />${HANDLES_HTML}`;
    return el;
  }

  buildPanel() {
    const panel = document.createElement("div");
    panel.className = "vs-panel sticky-paper";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "贴一张贴纸");
    panel.innerHTML = `<img class="tape" src="/journal/tape/washi-dots-mustard.webp" alt="" style="--tr: -3deg; --tape-w: 90px" />
      <p class="vs-hint">把贴纸拖到想贴的位置。拖右上角的小圆点旋转，拖右下角的小方块调大小，也可以用滚轮或双指缩放。</p>
      <div class="vs-tools" role="group" aria-label="调整贴纸">
        <button type="button" data-vs="rotate-left" aria-label="向左转">↺</button>
        <button type="button" data-vs="rotate-right" aria-label="向右转">↻</button>
        <button type="button" data-vs="smaller" aria-label="小一点">−</button>
        <button type="button" data-vs="bigger" aria-label="大一点">＋</button>
      </div>
      <form novalidate>
        <div class="vs-row"><span class="vs-actions"><button type="button" class="vs-cancel" data-vs="cancel">不贴了</button><button type="submit" class="stamp-btn">贴上</button></span></div>
        <p class="cmt-error" role="alert" hidden></p>
        <p class="vs-note">贴纸审核通过后大家都能看到；审核前只有你自己看得到。</p>
      </form>`;
    return panel;
  }

  /**
   * Fills the form for the login state: logged in with GitHub, the login is
   * the signature and there is no Turnstile; logged out (again), the
   * 署名 field and Turnstile come back. Runs on every change of the state.
   */
  applyAuth() {
    const form = this.panel.querySelector("form");
    const row = form?.querySelector(".vs-row");
    if (!(form && row)) {
      return;
    }
    const auth = authNow();
    const key = auth ? `${auth.enabled}:${auth.user?.login ?? ""}` : "?";
    if (key === this.authKey) {
      return;
    }
    this.authKey = key;
    this.member = Boolean(auth?.user);
    for (const el of form.querySelectorAll(
      ".auth-bar, [data-vs-sign], [data-turnstile], .auth-skip"
    )) {
      el.remove();
    }
    this.turnstile?.remove();
    this.turnstile = null;
    const bar = auth
      ? authBarHtml(auth, { next: currentPath(), verb: "贴贴纸" })
      : "";
    const name = readProfile().name ?? "";
    const signature = this.member
      ? ""
      : `<label data-vs-sign>署名<input name="name" maxlength="24" placeholder="选填" autocomplete="nickname" value="${esc(name)}" /></label>`;
    form.insertAdjacentHTML("afterbegin", `${bar}${signature}`);
    row.insertAdjacentHTML(
      "afterbegin",
      this.member ? SKIP_TURNSTILE_HTML : turnstileMarkup("sticker")
    );
    // After 退出 the button is gone: keep focus in the panel.
    bindLogout(form, () => {
      if (!this.panel.contains(document.activeElement)) {
        this.el.focus({ preventScroll: true });
      }
    });
    const wrap = form.querySelector<HTMLElement>("[data-turnstile]");
    if (wrap) {
      this.turnstile = mountTurnstile(wrap);
    }
  }

  apply() {
    applyPlacement(this.el, this.placement);
  }

  adjust(change: Partial<Placement>) {
    Object.assign(this.placement, clampEdit({ ...this.placement, ...change }));
    this.apply();
  }

  listen(target: EventTarget, type: string, handler: (event: Event) => void) {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  wire() {
    this.listen(this.el, "pointerdown", (event) =>
      this.startDrag(event as PointerEvent)
    );
    this.listen(this.el, "keydown", (event) =>
      this.onKey(event as KeyboardEvent)
    );
    // Wheel / trackpad pinch over the sticker resizes it instead of the canvas.
    this.listen(this.el, "wheel", (event) => {
      const wheel = event as WheelEvent;
      wheel.preventDefault();
      wheel.stopPropagation();
      this.adjust({ scale: wheelScale(this.placement.scale, wheel) });
    });
    this.listen(this.panel, "click", (event) => this.onTool(event));
    this.listen(document, "keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") {
        this.close();
      }
    });
    this.listen(document, "astro:before-swap", () => this.close());
    const form = this.panel.querySelector("form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submit(form);
    });
    // Right away when the state is known, and again after 退出.
    this.cleanups.push(subscribeAuth(() => this.applyAuth()));
    if (!authNow()) {
      this.applyAuth();
    }
  }

  startDrag(event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }
    // Keep the canvas from panning while the sticker moves.
    event.stopPropagation();
    event.preventDefault();
    trackTransform({
      api: this.api,
      el: this.el,
      event,
      onChange: (change) => this.adjust(change),
      onEnd: () => {
        // Nothing to do: the placement is sent with 贴上.
      },
      origin: { ...this.placement },
    });
  }

  onKey(event: KeyboardEvent) {
    const change = keyChange(event, this.placement);
    if (change) {
      event.preventDefault();
      event.stopPropagation();
      this.adjust(change);
    }
  }

  onTool(event: Event) {
    const tool =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-vs]")?.dataset.vs
        : undefined;
    const { rotation, scale } = this.placement;
    if (tool === "rotate-left") {
      this.adjust({ rotation: rotation - ROTATE_STEP });
    } else if (tool === "rotate-right") {
      this.adjust({ rotation: rotation + ROTATE_STEP });
    } else if (tool === "smaller") {
      this.adjust({ scale: scale - SCALE_STEP });
    } else if (tool === "bigger") {
      this.adjust({ scale: scale + SCALE_STEP });
    } else if (tool === "cancel") {
      this.close();
    }
  }

  say(message: string) {
    const error = this.panel.querySelector<HTMLElement>(".cmt-error");
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
  }

  async submit(form: HTMLFormElement) {
    const token = this.turnstile?.token() ?? "";
    if (!(this.member || token)) {
      this.say("人机验证还没完成，稍等一下再贴。");
      return;
    }
    const name = this.member
      ? (authNow()?.user?.login ?? "")
      : String(new FormData(form).get("name") ?? "").trim();
    const data = new FormData();
    const extension = this.image.type === "image/webp" ? "webp" : "png";
    data.set("image", this.image, `sticker.${extension}`);
    data.set("x", String(this.placement.x));
    data.set("y", String(this.placement.y));
    data.set("rotation", String(this.placement.rotation));
    data.set("scale", String(this.placement.scale));
    if (!this.member) {
      data.set("name", name);
      data.set("turnstile", token);
    }
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    );
    if (submit) {
      submit.disabled = true;
    }
    const result = await requestJson<StickerCreatedResponse>("/api/stickers", {
      body: data,
      method: "POST",
    });
    this.turnstile?.reset();
    if (submit) {
      submit.disabled = false;
    }
    if (!result.ok) {
      this.say(result.message);
      return;
    }
    this.say("");
    await this.remember(result.data, name);
    this.finish(
      result.data.status === "approved"
        ? "贴好了！"
        : "贴好了！审核通过后大家都能看到它。"
    );
  }

  async remember(created: StickerCreatedResponse, name: string) {
    // The edit token lets this browser move the sticker later, also after
    // it is approved.
    if (created.token && created.status !== "rejected") {
      addOwnedSticker({ id: created.id, token: created.token });
    }
    if (created.status !== "pending") {
      return;
    }
    const { x, y, rotation, scale, width, height } = this.placement;
    addPendingSticker({
      createdAt: Date.now(),
      dataUrl: await readAsDataUrl(this.image),
      height,
      id: created.id,
      name: name || null,
      rotation,
      scale,
      width,
      x,
      y,
    });
  }

  finish(message: string) {
    this.el.remove();
    this.panel.querySelector("form")?.setAttribute("hidden", "");
    this.panel.querySelector(".vs-tools")?.setAttribute("hidden", "");
    const hint = this.panel.querySelector(".vs-hint");
    if (hint) {
      hint.textContent = message;
    }
    // The panel closes soon after; the page-wide status region says it.
    announce(message);
    window.setTimeout(() => this.close(), CLOSE_AFTER);
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.turnstile?.remove();
    this.el.remove();
    this.panel.remove();
    URL.revokeObjectURL(this.objectUrl);
    this.onDone();
  }
}

/* ---------- the toolbar button ---------- */

let session: StickerSession | null = null;
let workshop: StickerWorkshop | null = null;

/** A small note next to the button for problems before placing starts. */
const flash = (host: HTMLElement, message: string) => {
  const note = host.querySelector<HTMLElement>("[data-vs-message]");
  if (!note) {
    return;
  }
  note.textContent = message;
  note.hidden = !message;
};

const focusOpener = (host: HTMLElement) =>
  host
    .querySelector<HTMLButtonElement>("[data-vs-open]")
    ?.focus({ preventScroll: true });

const place = (host: HTMLElement, result: WorkshopResult) => {
  const api = liveCanvas();
  if (!api) {
    flash(host, "切到画布视图再贴吧。");
    return;
  }
  session?.close();
  const { blob, width, height } = result;
  session = new StickerSession(api, blob, { height, width }, () => {
    session = null;
    focusOpener(host);
  });
};

const openWorkshop = (host: HTMLElement, file: File) => {
  session?.close();
  workshop?.close();
  workshop = new StickerWorkshop(file, {
    onCancel: () => {
      workshop = null;
      focusOpener(host);
    },
    onRepick: (next) => {
      workshop = null;
      openWorkshop(host, next);
    },
    onUse: (result) => {
      workshop = null;
      place(host, result);
    },
  });
};

const onFile = async (host: HTMLElement, input: HTMLInputElement) => {
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }
  if (!liveCanvas()) {
    flash(host, "切到画布视图再贴吧。");
    return;
  }
  const check = checkWorkshopInput(new Uint8Array(await file.arrayBuffer()));
  if (!check.ok) {
    flash(host, check.message);
    return;
  }
  flash(host, "");
  openWorkshop(host, file);
};

const setup = (host: HTMLElement) => {
  host.dataset.ready = "";
  // Know early whether the placement panel needs Turnstile.
  getAuth();
  const button = host.querySelector<HTMLButtonElement>("[data-vs-open]");
  const input = host.querySelector<HTMLInputElement>("[data-vs-file]");
  if (!(button && input)) {
    return;
  }
  const sync = () => {
    button.hidden = !window.__canvas?.viewportEl.isConnected;
  };
  sync();
  window.addEventListener(CANVAS_READY, sync);
  document.addEventListener(
    "astro:before-swap",
    () => window.removeEventListener(CANVAS_READY, sync),
    { once: true }
  );
  button.addEventListener("click", () => {
    flash(host, "");
    if (liveCanvas()) {
      input.click();
    } else {
      flash(host, "切到画布视图再贴吧。");
    }
  });
  input.addEventListener("change", () => onFile(host, input));
};

const init = () => {
  for (const host of document.querySelectorAll<HTMLElement>(
    "[data-sticker-upload]:not([data-ready])"
  )) {
    setup(host);
  }
};

document.addEventListener("astro:page-load", init);
init();
