import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  CUTOUT_DOWNLOAD_BYTES,
  MODEL_BYTES,
  MODEL_FILES,
  ORT_FILES,
  ORT_VERSION,
  ORT_WASM_BYTES,
} from "../src/scripts/interact/cutout-assets";

const root = join(import.meta.dir, "..");
const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

/** Cloudflare Workers static assets: 25 MiB per file. */
const ASSET_LIMIT = 26_214_400;

describe("self-hosted cutout assets", () => {
  test("public/ort matches the onnxruntime-web that transformers.js uses", async () => {
    const installed = JSON.parse(
      await readFile(
        join(root, "node_modules/onnxruntime-web/package.json"),
        "utf8"
      )
    ).version;
    expect(installed).toBe(ORT_VERSION);
    const checks = ORT_FILES.map(async (file) => {
      const served = join(root, "public", file.url);
      const original = join(
        root,
        "node_modules/onnxruntime-web/dist",
        file.name
      );
      const { size } = await stat(served);
      expect(size).toBe(file.bytes);
      expect(size).toBeLessThan(ASSET_LIMIT);
      expect(await sha256(served)).toBe(await sha256(original));
    });
    await Promise.all(checks);
  });

  test("the model files are the checked upstream revision", async () => {
    const checks = MODEL_FILES.map(async (file) => {
      const path = join(root, "public", file.url);
      expect((await stat(path)).size).toBe(file.bytes);
      expect(await sha256(path)).toBe(file.sha256);
    });
    await Promise.all(checks);
  });

  test("the download size shown to visitors adds up", () => {
    expect(ORT_FILES.find((f) => f.name.endsWith(".wasm"))?.bytes).toBe(
      ORT_WASM_BYTES
    );
    expect(MODEL_FILES.find((f) => f.name.endsWith(".onnx"))?.bytes).toBe(
      MODEL_BYTES
    );
    expect(CUTOUT_DOWNLOAD_BYTES).toBe(ORT_WASM_BYTES + MODEL_BYTES);
  });
});
