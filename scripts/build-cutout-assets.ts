/**
 * Puts the files the sticker workshop's 自动抠图 needs into public/ and
 * checks them:
 *
 * - public/ort/<version>/ort-wasm-simd-threaded.{mjs,wasm}: the ONNX Runtime
 *   Web CPU build, copied from node_modules/onnxruntime-web (the version that
 *   @huggingface/transformers pins). After upgrading transformers: set
 *   ORT_VERSION in cutout-assets.ts, re-run, delete the old folder.
 * - public/models/u2netp/{config.json,onnx/model.onnx}: U-2-Netp from
 *   https://huggingface.co/BritishWerewolf/U-2-Netp at a fixed revision.
 *   Downloaded only when missing; set HF_ENDPOINT (e.g. https://hf-mirror.com)
 *   if huggingface.co is not reachable. Hashes must match either way.
 *
 * Then it prints the sizes for src/scripts/interact/cutout-assets.ts.
 *
 *   bun scripts/build-cutout-assets.ts
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MODEL_FILES,
  MODEL_REVISION,
  MODEL_SOURCE,
  ORT_FILES,
  ORT_VERSION,
} from "../src/scripts/interact/cutout-assets";

const root = join(import.meta.dir, "..");
const ortDist = join(root, "node_modules/onnxruntime-web/dist");
const hfEndpoint = process.env.HF_ENDPOINT ?? "https://huggingface.co";

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const exists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const copyOrt = () =>
  Promise.all(
    ORT_FILES.map(async (file) => {
      const target = join(root, "public", file.url);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(ortDist, file.name), target);
      return target;
    })
  );

const fetchModelFile = async (file: (typeof MODEL_FILES)[number]) => {
  const target = join(root, "public", file.url);
  if (!(await exists(target))) {
    const url = `${hfEndpoint}/${MODEL_SOURCE}/resolve/${MODEL_REVISION}/${file.name}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}): ${url}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(await response.arrayBuffer()));
  }
  const hash = await sha256(target);
  if (hash !== file.sha256) {
    throw new Error(`SHA-256 mismatch for ${target}: ${hash}`);
  }
  return target;
};

const version = JSON.parse(
  await readFile(
    join(root, "node_modules/onnxruntime-web/package.json"),
    "utf8"
  )
).version;
if (version !== ORT_VERSION) {
  throw new Error(
    `node_modules has onnxruntime-web ${version}; set ORT_VERSION in src/scripts/interact/cutout-assets.ts first`
  );
}
const ort = await copyOrt();
const model = await Promise.all(MODEL_FILES.map(fetchModelFile));
const lines = await Promise.all(
  [...ort, ...model].map(
    async (path) =>
      `${path.replace(`${root}/`, "")}  ${(await stat(path)).size} bytes  sha256 ${await sha256(path)}`
  )
);
process.stdout.write(
  `onnxruntime-web ${version}\n${lines.join("\n")}\nUpdate the sizes in src/scripts/interact/cutout-assets.ts and public/ort/SOURCE.md if they changed.\n`
);
