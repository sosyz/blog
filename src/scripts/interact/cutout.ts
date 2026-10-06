/**
 * Main-thread side of 自动抠图: starts cutout.worker.ts on first use (so
 * nothing is downloaded until the visitor turns 自动抠图 on), sends it one
 * picture, and reports progress. Aborting terminates the worker, which also
 * stops a download in progress; the next call starts a fresh one (the files
 * are in the HTTP cache by then).
 */
import type { CutoutMessage, CutoutRequest } from "./cutout.worker";

export type CutoutProgress =
  | { phase: "loading"; loaded: number; total: number }
  | { phase: "processing" };

export interface Matte {
  alpha: Uint8ClampedArray;
  height: number;
  width: number;
}

let worker: Worker | null = null;
let nextId = 0;

const startWorker = () => {
  worker ??= new Worker(new URL("./cutout.worker.ts", import.meta.url), {
    name: "sticker-cutout",
    type: "module",
  });
  return worker;
};

const stopWorker = () => {
  worker?.terminate();
  worker = null;
};

/**
 * Cuts the subject out of `bitmap` (transferred to the worker, so it is
 * unusable afterwards). Resolves with an alpha matte of the same size.
 */
export const cutOut = (
  bitmap: ImageBitmap,
  onProgress: (progress: CutoutProgress) => void,
  signal: AbortSignal
) =>
  new Promise<Matte>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    nextId += 1;
    const id = nextId;
    const target = startWorker();
    const done = () => {
      target.removeEventListener("message", onMessage);
      target.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onMessage = (event: MessageEvent<CutoutMessage>) => {
      const message = event.data;
      if (message.id !== id) {
        return;
      }
      if (message.type === "loading") {
        onProgress({
          loaded: message.loaded,
          phase: "loading",
          total: message.total,
        });
      } else if (message.type === "processing") {
        onProgress({ phase: "processing" });
      } else if (message.type === "result") {
        done();
        resolve({
          alpha: new Uint8ClampedArray(message.alpha),
          height: message.height,
          width: message.width,
        });
      } else {
        done();
        reject(new Error(message.message));
      }
    };
    const onError = (event: ErrorEvent) => {
      done();
      stopWorker();
      reject(new Error(event.message || "worker failed"));
    };
    const onAbort = () => {
      done();
      stopWorker();
      reject(new DOMException("aborted", "AbortError"));
    };
    target.addEventListener("message", onMessage);
    target.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort);
    const request: CutoutRequest = { bitmap, id };
    target.postMessage(request, [bitmap]);
  });
