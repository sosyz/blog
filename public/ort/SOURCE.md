# ONNX Runtime Web（贴纸工坊的推理运行时）

贴纸工坊的自动抠图 worker 通过 transformers.js 调用 ONNX Runtime Web。运行时文件从本站自己提供（`env.backends.onnx.wasm.wasmPaths` 指向这里），不走 jsDelivr。

- 来源：npm `onnxruntime-web@1.31.0-dev.20260914-8d85527a0`（`@huggingface/transformers@4.3.0` 固定的版本）的 `dist/`
- 授权：MIT，Copyright (c) Microsoft Corporation（见 `ATTRIBUTIONS.md`）
- 文件放在以版本号命名的子目录（`1.31.0-dev.20260914-8d85527a0/`）里，缓存一年（`public/_headers`）；JS 胶水代码（打包进 worker）和 wasm 必须是同一个构建，换版本就换目录，不会拿到缓存里的旧 wasm。
- 用 `bun scripts/build-cutout-assets.ts` 从 `node_modules` 复制。升级 transformers 后：改 `src/scripts/interact/cutout-assets.ts` 的 `ORT_VERSION`，重新运行脚本，删掉旧目录；`tests/cutout-assets.test.ts` 会检查这里的文件和 `node_modules` 里的一致。

为什么是这个构建：transformers.js 默认用 `ort-wasm-simd-threaded.asyncify.wasm`（约 27 MB），JSEP 版约 28 MB，都超过 Cloudflare Workers 静态资源单个文件 25 MiB 的上限。这里用只含 CPU 执行器的普通 SIMD 构建（约 14 MB，gzip 后约 3.6 MB），`astro.config.mjs` 把 `onnxruntime-web/webgpu` 指到与之配套的 `ort.wasm.min.mjs`。站点没有跨源隔离（COOP/COEP），所以只用单线程。

| 文件 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `ort-wasm-simd-threaded.mjs` | 24,381 | `c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f` |
| `ort-wasm-simd-threaded.wasm` | 14,264,838 | `06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3` |
