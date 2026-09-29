// biome-ignore-all lint/style/noMagicNumbers: pixel maths on RGBA bytes (4 per pixel, alpha at +3, 0–255) and tuned constants, named where they carry meaning
/**
 * 自动抠图 for the sticker workshop, off the main thread: U-2-Netp through
 * transformers.js + ONNX Runtime Web (CPU wasm, one thread). Every file comes
 * from this site (src/scripts/interact/cutout-assets.ts); nothing is fetched
 * from a CDN or the Hugging Face Hub.
 *
 * Started by cutout.ts only when the visitor turns 自动抠图 on. Messages:
 * in  { id, bitmap } (ImageBitmap, transferred)
 * out { id, type: "loading", loaded, total } while downloading,
 *     { id, type: "processing" }, then { id, type: "result", alpha, width,
 *     height } (alpha: one byte per pixel, transferred) or { id, type:
 *     "error", message }.
 *
 * The pre/post-processing follows CatsJuice/sticker-forge
 * (workers/background-removal.worker.ts, MIT; see ATTRIBUTIONS.md): letterbox
 * to 320×320, ImageNet normalisation, min-max the matte, crop the padding,
 * resize back, cleanMatteAlpha × the source alpha.
 */
import { AutoModel, env, LogLevel, Tensor } from "@huggingface/transformers";
import {
  CUTOUT_DOWNLOAD_BYTES,
  MODEL_FILES,
  MODEL_ID,
  MODEL_ROOT,
  ORT_MJS_URL,
  ORT_WASM_URL,
} from "./cutout-assets";
import { cleanMatteAlpha } from "./die-cut";

export type CutoutRequest = { id: number; bitmap: ImageBitmap };
export type CutoutMessage =
  | { id: number; type: "loading"; loaded: number; total: number }
  | { id: number; type: "processing" }
  | {
      id: number;
      type: "result";
      alpha: ArrayBuffer;
      width: number;
      height: number;
    }
  | { id: number; type: "error"; message: string };

const INPUT = 320;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;
const MAX = 255;
/** The composite (fused) output of U²-Net; the others are side outputs. */
const OUTPUT = "1959";
const TINY = 0.000_01;

// U-2-Netp has no model class of its own; transformers.js warns and then
// runs it as a plain single-file model, which is what we want.
env.logLevel = LogLevel.ERROR;
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = MODEL_ROOT;
// The wasm and the model are fetched below, once, with progress, and handed
// to transformers.js from memory (its own loader would request model.onnx
// twice: once to read its size, once for the bytes). The HTTP cache keeps
// them between visits (public/_headers).
env.useWasmCache = false;
env.useBrowserCache = false;
env.useCustomCache = true;
const prefetched = new Map<string, Uint8Array<ArrayBuffer>>();
env.customCache = {
  match: (key) => {
    for (const [name, bytes] of prefetched) {
      if (key.endsWith(`/${name}`)) {
        return Promise.resolve(
          new Response(bytes, {
            headers: { "content-length": String(bytes.byteLength) },
          })
        );
      }
    }
    return Promise.resolve(undefined);
  },
  put: () => Promise.resolve(),
};
const onnx = env.backends.onnx;
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: ORT_MJS_URL, wasm: ORT_WASM_URL };
  // No cross-origin isolation on this site, so no SharedArrayBuffer threads.
  onnx.wasm.numThreads = 1;
}

const post = (message: CutoutMessage, transfer: Transferable[] = []) =>
  self.postMessage(message, { transfer });

type Model = Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
type Output = { data: Float32Array };
type Run = (inputs: Record<string, Tensor>) => Promise<Record<string, Output>>;

/** Fetches a file, reporting bytes as they arrive. */
const download = async (url: string, onBytes: (bytes: number) => void) => {
  const response = await fetch(url);
  if (!(response.ok && response.body)) {
    throw new Error(`${url}: ${response.status}`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  const pump = async (): Promise<void> => {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    chunks.push(value);
    received += value.byteLength;
    onBytes(received);
    return pump();
  };
  await pump();
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

let modelPromise: Promise<Model> | null = null;

const loadModel = async (id: number) => {
  const files = [
    { name: "wasm", url: ORT_WASM_URL },
    ...MODEL_FILES.map((file) => ({ name: file.name, url: file.url })),
  ];
  const loaded = new Map<string, number>();
  const report = () => {
    let sum = 0;
    for (const bytes of loaded.values()) {
      sum += bytes;
    }
    post({ id, type: "loading", loaded: sum, total: CUTOUT_DOWNLOAD_BYTES });
  };
  report();
  const bytes = await Promise.all(
    files.map((file) =>
      download(file.url, (received) => {
        loaded.set(file.name, received);
        report();
      })
    )
  );
  for (const [index, file] of files.entries()) {
    const data = bytes[index];
    if (!data) {
      throw new Error(`${file.url}: empty`);
    }
    if (file.name === "wasm" && onnx.wasm) {
      onnx.wasm.wasmBinary = data;
    } else {
      prefetched.set(file.name, data);
    }
  }
  const model = await AutoModel.from_pretrained(MODEL_ID, {
    device: "wasm",
    dtype: "fp32",
  });
  // The session holds its own copy now.
  prefetched.clear();
  return model;
};

/** Letterboxes the picture into 320×320; returns the normalised tensor and where it sits. */
const prepare = (bitmap: ImageBitmap) => {
  const scale = Math.min(INPUT / bitmap.width, INPUT / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const left = Math.floor((INPUT - width) / 2);
  const top = Math.floor((INPUT - height) / 2);
  const canvas = new OffscreenCanvas(INPUT, INPUT);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("no 2d context");
  }
  context.drawImage(bitmap, left, top, width, height);
  const { data } = context.getImageData(0, 0, INPUT, INPUT);
  const plane = INPUT * INPUT;
  const input = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    for (let c = 0; c < 3; c += 1) {
      input[c * plane + pixel] =
        ((data[pixel * 4 + c] ?? 0) / MAX - (MEAN[c] ?? 0)) / (STD[c] ?? 1);
    }
  }
  return {
    tensor: new Tensor("float32", input, [1, 3, INPUT, INPUT]),
    box: { left, top, width, height },
  };
};

/** Min-max normalises the raw matte into a grey image (alpha 255). */
const matteImage = (raw: Float32Array) => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of raw) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const range = Math.max(max - min, TINY);
  const image = new ImageData(INPUT, INPUT);
  for (let i = 0; i < INPUT * INPUT; i += 1) {
    const value = Math.round((((raw[i] ?? 0) - min) / range) * MAX);
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = MAX;
  }
  return image;
};

const cutOut = async (model: Model, bitmap: ImageBitmap) => {
  const { width, height } = bitmap;
  const { tensor, box } = prepare(bitmap);
  const outputs = await (model as unknown as Run)({ "input.1": tensor });
  const raw = outputs[OUTPUT] ?? Object.values(outputs)[0];
  if (!raw) {
    throw new Error("no matte");
  }
  // Crop the letterbox padding and scale the matte back to the picture.
  const square = new OffscreenCanvas(INPUT, INPUT);
  square.getContext("2d")?.putImageData(matteImage(raw.data), 0, 0);
  const full = new OffscreenCanvas(width, height);
  const context = full.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("no 2d context");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(
    square,
    box.left,
    box.top,
    box.width,
    box.height,
    0,
    0,
    width,
    height
  );
  const matte = context.getImageData(0, 0, width, height).data;
  context.clearRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0);
  const source = context.getImageData(0, 0, width, height).data;
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = cleanMatteAlpha(matte[i * 4] ?? 0) * (source[i * 4 + 3] ?? 0);
  }
  return alpha;
};

self.addEventListener("message", async (event: MessageEvent<CutoutRequest>) => {
  const { id, bitmap } = event.data;
  try {
    modelPromise ??= loadModel(id);
    const model = await modelPromise;
    post({ id, type: "processing" });
    const alpha = await cutOut(model, bitmap);
    post(
      {
        id,
        type: "result",
        alpha: alpha.buffer,
        width: bitmap.width,
        height: bitmap.height,
      },
      [alpha.buffer]
    );
  } catch (error) {
    modelPromise = null;
    post({
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    bitmap.close();
  }
});
