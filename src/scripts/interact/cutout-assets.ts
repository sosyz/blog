/**
 * The self-hosted files behind 自动抠图 in the sticker workshop. Nothing here
 * is fetched from a CDN or the Hugging Face Hub: `bun scripts/build-cutout-assets.ts`
 * copies ONNX Runtime Web into public/ort/ and checks the model in
 * public/models/u2netp/ (provenance in the SOURCE.md next to each).
 * tests/cutout-assets.test.ts keeps these numbers honest.
 */

/**
 * The onnxruntime-web version @huggingface/transformers pins. The files live
 * in a folder named after it, so a new version never meets a cached old wasm
 * (the JS glue and the wasm must come from the same build).
 */
export const ORT_VERSION = "1.31.0-dev.20260914-8d85527a0";
const ORT_DIR = `/ort/${ORT_VERSION}/`;
export const ORT_MJS_URL = `${ORT_DIR}ort-wasm-simd-threaded.mjs`;
export const ORT_WASM_URL = `${ORT_DIR}ort-wasm-simd-threaded.wasm`;

/** ONNX Runtime Web, plain CPU (SIMD) build: the asyncify / JSEP builds are over 25 MiB. */
export const ORT_FILES = [
  { bytes: 24_381, name: "ort-wasm-simd-threaded.mjs", url: ORT_MJS_URL },
  { bytes: 14_264_838, name: "ort-wasm-simd-threaded.wasm", url: ORT_WASM_URL },
] as const;

export const ORT_WASM_BYTES = 14_264_838;

/** transformers.js looks for `${MODEL_ROOT}${MODEL_ID}/config.json` and `/onnx/model.onnx`. */
export const MODEL_ROOT = "/models/";
export const MODEL_ID = "u2netp";
export const MODEL_SOURCE = "BritishWerewolf/U-2-Netp";
export const MODEL_REVISION = "7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8";
export const MODEL_FILES = [
  {
    bytes: 388,
    name: "config.json",
    sha256: "863f4c818e573a77b0bedea8ecacc6c449ec24e8c179e2f8b1f4067ba8d0dea6",
    url: "/models/u2netp/config.json",
  },
  {
    bytes: 4_574_861,
    name: "onnx/model.onnx",
    sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
    url: "/models/u2netp/onnx/model.onnx",
  },
] as const;
export const MODEL_BYTES = 4_574_861;

/** What the visitor downloads the first time 自动抠图 runs (besides the worker script). */
export const CUTOUT_DOWNLOAD_BYTES = ORT_WASM_BYTES + MODEL_BYTES;
