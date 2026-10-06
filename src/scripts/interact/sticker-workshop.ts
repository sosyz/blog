// biome-ignore-all lint/style/noMagicNumbers: pixel maths on RGBA bytes (4 per pixel, alpha at +3, 0–255) and tuned constants, named where they carry meaning
/**
 * 贴纸工坊: between picking a picture and placing it on the canvas, turn it
 * into a die-cut journal sticker with a live preview.
 *
 * picture (PNG / JPEG / WebP / GIF first frame, ≤ 10 MB) → decoded at most
 * 1024 px → optional 自动抠图 (cutout.ts, only downloaded when switched on)
 * → cropped to the artwork → scaled so artwork + white border ≤ 512×512 →
 * optional 手账滤镜 on the artwork → white die-cut border (die-cut.ts) →
 * trimmed → WebP (PNG if the browser cannot encode WebP), quality stepped
 * down until ≤ 300 KB (sticker-fit.ts).
 *
 * The panel is a modal <dialog>: focus stays inside, Esc (不贴了) closes it.
 * 用这张 hands the finished image to the placement step in sticker-upload.ts.
 */
import { checkStickerImage } from "@/lib/server/image-header";
import { type CutoutProgress, cutOut, type Matte } from "./cutout";
import { CUTOUT_DOWNLOAD_BYTES } from "./cutout-assets";
import {
  alphaBounds,
  type Box,
  compositeOverWhite,
  hasTransparency,
  outlineAlpha,
  roundedRectAlpha,
  VISIBLE_ALPHA,
} from "./die-cut";
import { applyJournalFilter } from "./journal-filter";
import {
  BORDER_LABELS,
  BORDER_RATIOS,
  checkWorkshopInput,
  DEFAULT_BORDER,
  type EncodeAttempt,
  encodeAttempts,
  firstThatFits,
  formatBytes,
  layoutSticker,
  OUTPUT_MAX_BYTES,
  OUTPUT_MAX_SIDE,
} from "./sticker-fit";

export interface WorkshopResult {
  blob: Blob;
  height: number;
  width: number;
}

interface WorkshopHandlers {
  /** 不贴了, Esc, or navigating away. */
  onCancel: () => void;
  /** 重新选图 picked a new, valid file. */
  onRepick: (file: File) => void;
  /** 用这张: the finished sticker. */
  onUse: (result: WorkshopResult) => void;
}

/** Longest side the picture is decoded to; the output is ≤ 512 anyway. */
const WORK_SIDE = 1024;
/** Corner radius of the rounded-rectangle die-cut, as a share of the short side. */
const CORNER = 0.06;
const GRAIN_URL = "/journal/paper/grain-overlay-gray.jpg";
const MB = 1_048_576;

type Mode = "matte" | "alpha" | "rect";

const canvas2d = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("no 2d context");
  }
  return { canvas, context };
};

const alphaOf = (rgba: Uint8ClampedArray) => {
  const alpha = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = rgba[i * 4 + 3] ?? 0;
  }
  return alpha;
};

let grainImage: Promise<HTMLImageElement | null> | null = null;

/** The paper grain texture (public/journal/), loaded once. */
const loadGrain = () => {
  grainImage ??= (async () => {
    const image = new Image();
    image.src = GRAIN_URL;
    try {
      await image.decode();
      return image;
    } catch {
      return null;
    }
  })();
  return grainImage;
};

/** Grey values of the grain texture tiled over width × height. */
const grainFor = async (width: number, height: number) => {
  const image = await loadGrain();
  if (!image) {
    return null;
  }
  const { canvas, context } = canvas2d(width, height);
  const pattern = context.createPattern(image, "repeat");
  if (!pattern) {
    return null;
  }
  context.fillStyle = pattern;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, width, height);
  const grey = new Uint8ClampedArray(width * height);
  for (let i = 0; i < grey.length; i += 1) {
    grey[i] = data[i * 4] ?? 0;
  }
  return grey;
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });

/** Encodes, shrinking the sticker if needed; checks the result like the API does. */
const encodeSticker = async (canvas: HTMLCanvasElement) => {
  // Safari cannot encode WebP and quietly returns PNG: check what we got.
  const probe = await toBlob(canvas, "image/webp", 1);
  const type = probe?.type === "image/webp" ? "image/webp" : "image/png";
  const encode = async (attempt: EncodeAttempt) => {
    let source = canvas;
    if (attempt.shrink < 1) {
      const width = Math.max(1, Math.round(canvas.width * attempt.shrink));
      const height = Math.max(1, Math.round(canvas.height * attempt.shrink));
      const small = canvas2d(width, height);
      small.context.imageSmoothingQuality = "high";
      small.context.drawImage(canvas, 0, 0, width, height);
      source = small.canvas;
    }
    const blob = await toBlob(source, attempt.type, attempt.quality);
    return blob?.type === attempt.type
      ? { blob, height: source.height, size: blob.size, width: source.width }
      : null;
  };
  const found = await firstThatFits(encodeAttempts(type), encode);
  if (!found) {
    return null;
  }
  const check = checkStickerImage(
    new Uint8Array(await found.result.blob.arrayBuffer()),
    { maxBytes: OUTPUT_MAX_BYTES, maxSide: OUTPUT_MAX_SIDE }
  );
  return check.ok ? found.result : null;
};

const saveData = () =>
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    ?.saveData === true;

const MARKUP = `<img class="tape" src="/journal/tape/washi-grid-ivory.webp" alt="" style="--tr: -4deg; --tape-w: 96px" />
  <h2 class="vs-shop-title" id="vs-shop-title">贴纸工坊</h2>
  <p class="vs-hint" id="vs-shop-hint">先把图片做成一张贴纸：抠出主体，描一圈白边。</p>
  <div class="vs-stage desk-paper" data-shop="stage">
    <img class="vs-preview" data-shop="preview" alt="做好的贴纸预览" hidden />
  </div>
  <p class="vs-status" role="status" data-shop="status"></p>
  <div class="vs-opts">
    <label class="vs-check"><input type="checkbox" data-shop="cutout" autofocus />自动抠图</label>
    <p class="vs-note" data-shop="cutout-note">第一次用要下载约 ${Math.round(CUTOUT_DOWNLOAD_BYTES / MB)} MB 的抠图工具；抠图在你的浏览器里完成。抠图模型 <a href="/licenses/#u2netp" target="_blank" rel="noopener">U-2-Netp（Apache-2.0）</a>。</p>
    <label class="vs-check"><input type="checkbox" data-shop="filter" checked />手账滤镜</label>
    <label class="vs-range">白边粗细
      <input type="range" min="0" max="2" step="1" value="${DEFAULT_BORDER}" data-shop="border" aria-valuetext="${BORDER_LABELS[DEFAULT_BORDER]}" />
      <span class="vs-range-value" data-shop="border-label" aria-hidden="true">${BORDER_LABELS[DEFAULT_BORDER]}</span>
    </label>
  </div>
  <p class="vs-size" data-shop="size"></p>
  <input type="file" accept="image/png,image/webp,image/gif,image/jpeg" aria-label="重新选一张图片" data-shop="file" hidden />
  <div class="vs-row">
    <button type="button" class="vs-cancel" data-shop="repick">重新选图</button>
    <span class="vs-actions">
      <button type="button" class="vs-cancel" data-shop="cancel">不贴了</button>
      <button type="button" class="stamp-btn" data-shop="use" disabled>用这张</button>
    </span>
  </div>`;

export class StickerWorkshop {
  readonly file: File;
  readonly handlers: WorkshopHandlers;
  readonly dialog: HTMLDialogElement;
  readonly cleanups: (() => void)[] = [];
  /** The picture at work resolution. */
  source: HTMLCanvasElement | null = null;
  sourcePixels: ImageData | null = null;
  opaque = true;
  matte: Matte | null = null;
  cutoutAbort: AbortController | null = null;
  /** Artwork with its alpha applied, per mode. */
  readonly art = new Map<Mode, HTMLCanvasElement>();
  result: WorkshopResult | null = null;
  previewUrl = "";
  renderToken = 0;
  renderQueued = false;
  /** Say 抠好了 once the cut-out preview is actually showing. */
  announceCutout = false;
  closed = false;

  constructor(file: File, handlers: WorkshopHandlers) {
    this.file = file;
    this.handlers = handlers;
    this.dialog = document.createElement("dialog");
    this.dialog.className = "vs-shop sticky-paper";
    this.dialog.setAttribute("aria-labelledby", "vs-shop-title");
    this.dialog.setAttribute("aria-describedby", "vs-shop-hint");
    this.dialog.innerHTML = MARKUP;
    document.body.appendChild(this.dialog);
    this.wire();
    this.dialog.showModal();
    this.start();
  }

  el<T extends HTMLElement>(name: string) {
    const found = this.dialog.querySelector<T>(`[data-shop="${name}"]`);
    if (!found) {
      throw new Error(`missing ${name}`);
    }
    return found;
  }

  checkbox(name: "cutout" | "filter") {
    return this.el<HTMLInputElement>(name);
  }

  listen(target: EventTarget, type: string, handler: (event: Event) => void) {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  wire() {
    this.listen(this.dialog, "cancel", (event) => {
      // Esc: close through our own path (cleanup, focus back to the opener).
      event.preventDefault();
      this.cancel();
    });
    this.listen(this.el("cancel"), "click", () => this.cancel());
    this.listen(this.el("use"), "click", () => this.use());
    const picker = this.el<HTMLInputElement>("file");
    this.listen(this.el("repick"), "click", () => picker.click());
    this.listen(picker, "change", () => this.repick(picker));
    this.listen(this.checkbox("cutout"), "change", () => this.onCutoutToggle());
    this.listen(this.checkbox("filter"), "change", () => this.queueRender());
    const border = this.el<HTMLInputElement>("border");
    this.listen(border, "input", () => {
      const label = BORDER_LABELS[Number(border.value)] ?? "";
      border.setAttribute("aria-valuetext", label);
      this.el("border-label").textContent = label;
      this.queueRender();
    });
    this.listen(document, "astro:before-swap", () => this.cancel());
  }

  status(message: string) {
    this.el("status").textContent = message;
  }

  async start() {
    try {
      await this.decode();
    } catch {
      this.status("这张图打不开，换一张试试。");
      return;
    }
    const cutout = this.checkbox("cutout");
    cutout.checked = this.opaque && !saveData();
    this.render();
    if (cutout.checked) {
      this.runCutout();
    }
  }

  /** Decodes the picture (GIF: first frame) at no more than WORK_SIDE px. */
  async decode() {
    const full = await createImageBitmap(this.file);
    const scale = Math.min(1, WORK_SIDE / Math.max(full.width, full.height));
    const width = Math.max(1, Math.round(full.width * scale));
    const height = Math.max(1, Math.round(full.height * scale));
    const { canvas, context } = canvas2d(width, height);
    context.imageSmoothingQuality = "high";
    context.drawImage(full, 0, 0, width, height);
    full.close();
    this.source = canvas;
    this.sourcePixels = context.getImageData(0, 0, width, height);
    this.opaque = !hasTransparency(alphaOf(this.sourcePixels.data));
  }

  onCutoutToggle() {
    if (this.checkbox("cutout").checked) {
      if (this.matte) {
        this.queueRender();
      } else {
        this.runCutout();
      }
      return;
    }
    // Switched off while downloading or working: stop it.
    this.cutoutAbort?.abort();
    this.cutoutAbort = null;
    this.status("");
    this.queueRender();
  }

  async runCutout() {
    if (!this.source || this.cutoutAbort) {
      return;
    }
    const abort = new AbortController();
    this.cutoutAbort = abort;
    this.setBusy(true);
    this.status("正在准备抠图工具…");
    const onProgress = (progress: CutoutProgress) => {
      if (progress.phase === "loading") {
        // Whole MB only, so a screen reader is not flooded with updates.
        const loaded = Math.floor(progress.loaded / MB);
        const total = Math.round(progress.total / MB);
        this.status(`正在准备抠图工具…（${loaded} / ${total} MB）`);
      } else {
        this.status("正在抠图…");
      }
    };
    try {
      const bitmap = await createImageBitmap(this.source);
      this.matte = await cutOut(bitmap, onProgress, abort.signal);
      this.art.delete("matte");
      this.status("抠好了，正在描白边…");
      this.announceCutout = true;
    } catch {
      if (abort.signal.aborted || this.closed) {
        return;
      }
      this.checkbox("cutout").checked = false;
      this.status(
        "抠图没成功，先用原图做成贴纸。可以稍后再打开自动抠图试一次。"
      );
    } finally {
      if (this.cutoutAbort === abort) {
        this.cutoutAbort = null;
      }
    }
    if (!this.closed) {
      this.queueRender();
    }
  }

  setBusy(busy: boolean) {
    const stage = this.el("stage");
    stage.setAttribute("aria-busy", String(busy));
    this.el<HTMLButtonElement>("use").disabled = busy || !this.result;
  }

  queueRender() {
    if (this.renderQueued) {
      return;
    }
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  mode(): Mode {
    if (this.checkbox("cutout").checked && this.matte) {
      return "matte";
    }
    return this.opaque ? "rect" : "alpha";
  }

  /** The picture with the alpha of the current mode, at work resolution. */
  artwork(mode: Mode) {
    const cached = this.art.get(mode);
    if (cached || !this.sourcePixels) {
      return cached ?? null;
    }
    const { width, height, data } = this.sourcePixels;
    const { canvas, context } = canvas2d(width, height);
    const pixels = new ImageData(new Uint8ClampedArray(data), width, height);
    if (mode === "matte" && this.matte) {
      for (let i = 0; i < this.matte.alpha.length; i += 1) {
        pixels.data[i * 4 + 3] = this.matte.alpha[i] ?? 0;
      }
    }
    context.putImageData(pixels, 0, 0);
    this.art.set(mode, canvas);
    return canvas;
  }

  /** Where the artwork is, in work-resolution px. */
  artBounds(mode: Mode): Box | null {
    const pixels = this.sourcePixels;
    if (!pixels) {
      return null;
    }
    if (mode === "rect") {
      return { height: pixels.height, width: pixels.width, x: 0, y: 0 };
    }
    const alpha =
      mode === "matte" && this.matte ? this.matte.alpha : alphaOf(pixels.data);
    return alphaBounds(alpha, pixels.width, pixels.height, VISIBLE_ALPHA);
  }

  async render() {
    if (!this.sourcePixels || this.closed) {
      return;
    }
    this.renderToken += 1;
    const token = this.renderToken;
    let mode = this.mode();
    let bounds = this.artBounds(mode);
    if (!bounds) {
      // The cutout found nothing (or the picture is fully transparent).
      mode = "rect";
      bounds = this.artBounds(mode);
      this.status("没找到明显的主体，先用整张图。");
    }
    const art = this.artwork(mode);
    if (!(bounds && art)) {
      return;
    }
    const border = Number(this.el<HTMLInputElement>("border").value);
    const ratio = BORDER_RATIOS[border] ?? BORDER_RATIOS[DEFAULT_BORDER];
    const layout = layoutSticker(bounds.width, bounds.height, ratio);
    const filter = this.checkbox("filter").checked;
    const grain = filter ? await grainFor(layout.width, layout.height) : null;
    if (token !== this.renderToken) {
      return;
    }
    const sticker = this.compose({ art, bounds, filter, grain, layout, mode });
    const encoded = sticker ? await encodeSticker(sticker) : null;
    if (token !== this.renderToken || this.closed) {
      return;
    }
    this.show(encoded);
  }

  /** Draws artwork + border at the final size and trims it; null if empty. */
  compose(input: {
    art: HTMLCanvasElement;
    bounds: Box;
    layout: ReturnType<typeof layoutSticker>;
    mode: Mode;
    filter: boolean;
    grain: Uint8ClampedArray | null;
  }) {
    const { art, bounds, layout, mode, filter, grain } = input;
    const { width, height, pad, contentWidth, contentHeight } = layout;
    const { context } = canvas2d(width, height);
    context.imageSmoothingQuality = "high";
    context.drawImage(
      art,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      pad,
      pad,
      contentWidth,
      contentHeight
    );
    const image = context.getImageData(0, 0, width, height);
    const rgba = image.data;
    if (mode === "rect") {
      const corner = CORNER * Math.min(contentWidth, contentHeight);
      const shape = roundedRectAlpha(contentWidth, contentHeight, corner);
      for (let y = 0; y < contentHeight; y += 1) {
        for (let x = 0; x < contentWidth; x += 1) {
          const o = ((y + pad) * width + x + pad) * 4 + 3;
          rgba[o] = ((rgba[o] ?? 0) * (shape[y * contentWidth + x] ?? 0)) / 255;
        }
      }
    }
    if (filter) {
      applyJournalFilter(rgba, grain);
    }
    const outline = outlineAlpha(alphaOf(rgba), width, height, layout.radius);
    compositeOverWhite(rgba, outline);
    const trim = alphaBounds(alphaOf(rgba), width, height);
    if (!trim) {
      return null;
    }
    const out = canvas2d(trim.width, trim.height);
    out.context.putImageData(image, -trim.x, -trim.y);
    return out.canvas;
  }

  show(encoded: Awaited<ReturnType<typeof encodeSticker>>) {
    const preview = this.el<HTMLImageElement>("preview");
    const size = this.el("size");
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = "";
    }
    if (!encoded) {
      this.result = null;
      preview.hidden = true;
      size.textContent = "这张图压不到 300 KB 以内，换一张试试。";
      this.setBusy(Boolean(this.cutoutAbort));
      return;
    }
    this.result = {
      blob: encoded.blob,
      height: encoded.height,
      width: encoded.width,
    };
    this.previewUrl = URL.createObjectURL(encoded.blob);
    preview.src = this.previewUrl;
    preview.hidden = false;
    if (this.announceCutout && this.mode() === "matte") {
      this.announceCutout = false;
      this.status("抠好了。不满意可以关掉自动抠图。");
    }
    const kind = encoded.blob.type === "image/webp" ? "WebP" : "PNG";
    size.textContent = `${kind} · ${formatBytes(encoded.blob.size)} · ${encoded.width}×${encoded.height}`;
    // Not usable while a cutout is still on its way.
    this.setBusy(Boolean(this.cutoutAbort));
  }

  repick(picker: HTMLInputElement) {
    const file = picker.files?.[0];
    picker.value = "";
    if (!file) {
      return;
    }
    file
      .arrayBuffer()
      .then((buffer) => {
        const check = checkWorkshopInput(new Uint8Array(buffer));
        if (!check.ok) {
          this.status(check.message);
          return;
        }
        this.close();
        this.handlers.onRepick(file);
      })
      .catch(() => this.status("这张图打不开，换一张试试。"));
  }

  use() {
    const { result } = this;
    if (!result || this.cutoutAbort) {
      return;
    }
    this.close();
    this.handlers.onUse(result);
  }

  cancel() {
    if (this.closed) {
      return;
    }
    this.close();
    this.handlers.onCancel();
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.cutoutAbort?.abort();
    this.cutoutAbort = null;
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
    }
    this.dialog.close();
    this.dialog.remove();
  }
}
