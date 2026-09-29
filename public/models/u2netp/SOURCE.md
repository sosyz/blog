# U-2-Netp（贴纸工坊的自动抠图模型）

贴纸工坊（`src/scripts/interact/cutout.worker.ts`）在访客浏览器里用这个模型抠图。文件从本站自己提供，不访问 Hugging Face Hub；模型权重没有修改。

- 来源：<https://huggingface.co/BritishWerewolf/U-2-Netp>，revision `7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8`
- 原始项目：U²-Net，<https://github.com/xuebinqin/U-2-Net>（Xuebin Qin 等，Apache License 2.0）
- ONNX 转换：<https://github.com/danielgatis/rembg>
- 授权：Apache License 2.0，全文见同目录的 `LICENSE.txt`
- 输入 `input.1`：1×3×320×320 float32（ImageNet 均值/方差归一化）；输出 `1959`：1×320×320 前景概率

| 文件 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `config.json` | 388 | `863f4c818e573a77b0bedea8ecacc6c449ec24e8c179e2f8b1f4067ba8d0dea6` |
| `onnx/model.onnx` | 4,574,861 | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` |

两个哈希都和上游该 revision 的文件核对过。`bun scripts/build-cutout-assets.ts` 会重新校验（文件缺失时从上游下载，可用 `HF_ENDPOINT` 换镜像）。
