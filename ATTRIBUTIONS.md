# Attributions

Third-party material used by this site, and the licence each one is under.

**The canonical list is `src/data/licenses.ts`**, shown to visitors on
[/licenses/](https://blog.sonui.cn/licenses/) (开源许可, linked from the
footer) with the full MIT, Apache-2.0 and SIL OFL 1.1 texts. Minified bundles
lose their licence headers, so that page is where the notices live. When a
library, font, model or asset is added or removed, change the data module
first, then this file; `tests/licenses.test.ts` fails if browser code imports
an npm package the module does not list.

This site itself: the source code is MIT (`LICENSE`, Copyright (c) 2025-2026
Sonui); the notes in `src/posts/` and their images are CC BY-NC-SA 4.0
(`src/lib/seo/copyright.ts`). Build-time-only npm dependencies keep their own
licences in `node_modules`.

## Fonts

All three fonts are under the [SIL Open Font License 1.1](https://openfontlicense.org/).
The CJK fonts are split into small woff2 chunks by `scripts/build-fonts.ts`
(cn-font-split) so the browser only downloads the characters a page uses.
The split files are for loading on this site only and are not distributed
as fonts on their own.
The split woff2 keep the copyright line but lose the licence fields, so each
folder has an `OFL.txt` with the font's copyright lines and the full licence;
`bun run fonts` rewrites it (lines in `FONT_COPYRIGHT`, `src/data/licenses.ts`).

| Font | Used for | Files | Source |
| --- | --- | --- | --- |
| 小赖字体 Xiaolai (LXGW, based on Seto Font by Nozomi Seto) | topic names, sticky notes, UI chrome | `public/fonts/xiaolai/` | <https://github.com/lxgw/kose-font> |
| 朱雀仿宋 Zhuque Fangsong (Triones Type, Copyright 2023 JadeFoci), technical preview | article body | `public/fonts/zhuque/` | <https://github.com/TrionesType/zhuque> |
| Maple Mono (subframe7536), latin subset | code | `@fontsource/maple-mono` | <https://github.com/subframe7536/maple-font> |

Zhuque Fangsong's author asks that modified versions are not redistributed
before 1.0. The chunks here are an unmodified subset served for this site
only; replace them when 1.0 is released (`bun run fonts`).

## Paper and journal materials (`public/journal/`)

| Asset | Files | Licence | Source |
| --- | --- | --- | --- |
| Paper textures (canvas, document, grain, kraft) | `paper/*.jpg` | CC0 1.0 | Derived from [ambientCG](https://ambientcg.com/) Paper001/002/004/006 |
| Washi and masking tapes | `tape/*.webp` | CC0 1.0 | Rendered for this site from CC0 ambientCG paper grain |
| Stamp speckle texture | `stamp-speckle.png` | CC0 1.0 | Rendered for this site from CC0 ambientCG grain |
| Paperclip | `paperclip.svg` | Public domain | [Openclipart](https://openclipart.org/) |
| Doodles: arrow-curved-brush, arrow-loop, heart-sketch | `doodle/*.svg` | Public domain | [Openclipart](https://openclipart.org/) |
| Accessories: postage-stamp-frame, torn-paper-sheet, ticket-admit-one | `accessory/*.svg` | Public domain | [Openclipart](https://openclipart.org/) |
| Doodles: arrow-down, arrow-ne, arrow-right, arrow-se, bookmark, bug, bulb, calendar, caution, checklist, coffee-cup-1, coffee-cup-2, cross, fire, flag, heart, magic-wand, note, pencil, pin, question, rocket, star, tag, tick, tick-2, zap | `doodle/*.svg` | CC0 1.0 | [Doodle Icons](https://khushmeen.com/icons.html) by Khushmeen Sidhu |
| Doodles: box, bracket, check-rough, circle-loop, circle-rough, emphasis-marks, scribble-strike, star-rough, underline-double, underline-swoosh, underline-wavy | `doodle/*.svg` | Original, same licence as this site | Drawn for this site with [rough.js](https://roughjs.com/) (MIT) |
| Accessories: index-tab, polaroid-frame, stamp-check, stamp-frame-rect, tag-label, ticket-stub | `accessory/*.svg` | Original, same licence as this site | Drawn for this site |

## Stickers and covers

| Asset | Files | Licence |
| --- | --- | --- |
| 16 journal stickers (places, people incl. the dog avatar, dev objects) | `public/stickers/*.webp` | Original artwork generated for this blog (Codex image generation from original prompts, no reference images) |
| Cover of "通过 Cloudflare AI Gateway 使用 LLM" | `src/assets/covers/cloudflare-ai-gateway-llama.png` | Original artwork generated for this blog |

## Libraries shipped to the browser

| Library | Licence | Source |
| --- | --- | --- |
| Astro client runtime (`<ClientRouter />` page transitions, script loading), Copyright (c) 2021 Fred K. Schott | MIT | <https://github.com/withastro/astro> |
| Rough Notation (highlight, underline, box marks) | MIT | <https://github.com/rough-stuff/rough-notation> |
| Rough.js (bundled inside Rough Notation; also used at build time for the hand-drawn doodles and diagram strokes), Copyright (c) 2019 Preet Shihn | MIT | <https://github.com/rough-stuff/rough> |
| transformers.js (`@huggingface/transformers` 4.3.0; runs the sticker cutout model in a Web Worker) | Apache-2.0 | <https://github.com/huggingface/transformers.js> |
| ONNX Runtime Web (`onnxruntime-web` 1.31.0-dev, bundled JS + `public/ort/<version>/ort-wasm-simd-threaded.{mjs,wasm}`), Copyright (c) Microsoft Corporation | MIT | <https://github.com/microsoft/onnxruntime> |
| GitHub mark (`mark-github-16` from Octicons, inlined as SVG on the 「用 GitHub 登录」 button in `src/scripts/interact/auth.ts`), Copyright (c) GitHub Inc. | MIT | <https://github.com/primer/octicons> |

## Sticker workshop (贴纸工坊)

### U-2-Netp background-removal model

`public/models/u2netp/` (`config.json`, `onnx/model.onnx`) is redistributed
unmodified from [BritishWerewolf/U-2-Netp](https://huggingface.co/BritishWerewolf/U-2-Netp)
(revision `7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8`) under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0); the full
text is in `public/models/u2netp/LICENSE.txt`, provenance and SHA-256 in
`public/models/u2netp/SOURCE.md`. The model is U²-Net (Xuebin Qin et al.,
<https://github.com/xuebinqin/U-2-Net>, Apache-2.0), converted to ONNX by
[rembg](https://github.com/danielgatis/rembg).

### Code ported from sticker-forge

The cutout pre/post-processing (`src/scripts/interact/cutout.worker.ts`: letterbox,
ImageNet normalisation, min-max matte, `cleanMatteAlpha`) and the die-cut
outline (`src/scripts/interact/die-cut.ts`: exterior flood fill, exact
Euclidean distance transform, anti-aliased coverage) and the peel shader
(`src/scripts/interact/peel-gl.ts` and `peel-math.ts`: the cylinder curl with
its surface normal, and the multi-tap alpha shadow blur) are adapted from
[CatsJuice/sticker-forge](https://github.com/CatsJuice/sticker-forge)
(`workers/background-removal.worker.ts`, `lib/source.ts`, `lib/shaders.ts`:
`deformSticker`, `stickerSurfaceNormal`, `galleryShadowFragmentShader`), used
under the MIT licence:

```text
MIT License

Copyright (c) 2026 CatsJuice

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The 手账滤镜 grain uses the CC0 paper grain texture above
(`public/journal/paper/grain-overlay-gray.jpg`).

## Build tools

These run while the site is built; visitors download their output, not their
code, so no licence travels with the pages. Credited on /licenses/: Mermaid
(MIT; diagrams in notes are drawn to hand-drawn SVG at build time), SVGO
(MIT), Shiki (MIT, code colouring) and cn-font-split (Apache-2.0, font
splitting).
