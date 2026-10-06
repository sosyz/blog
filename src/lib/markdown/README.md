# Markdown pipeline

`config.ts` exports `markdownConfig`, which `astro.config.mjs` passes to `markdown`. Files here are loaded by the Astro config, so they use relative imports, not `@/`.

## Processor: Sätteri

Astro 7 renders Markdown with Sätteri by default. `unified()` from `@astrojs/markdown-remark` is the other option. We use Sätteri through `satteri()` from `@astrojs/markdown-satteri`, pinned to the version Astro ships with. It covers everything we need:

- Its `hastPlugins` run after Astro's Shiki highlighter and before Astro's image and heading-id passes. That is the right point to wrap code blocks and tag image paragraphs.
- Its plugin API can wrap, remove and replace nodes, so no remark or rehype packages are needed.
- It is the default and the fastest. Switching to `unified()` would mean adding another processor package and rewriting these plugins as rehype plugins.

## What the pipeline emits

| Source | HTML | Plugin |
| --- | --- | --- |
| A fenced code block | `<figure class="slip" data-lang data-no-annotate style="--tape --tr --sr"><pre class="astro-code" data-language>…</pre><button aria-label="复制代码" class="slip-copy" type="button">复制</button><span class="slip-said" role="status"></span><figcaption class="fname">label</figcaption></figure>` | `codeSlips` (hast) |
| `ts title="gateway.ts"` (or `file=`) | That file name as the label (`data-title` on the `<pre>`). Without one: `terminal` for shell languages, `code` for blocks with no language, otherwise the language | `fenceMeta` (Shiki transformer) |
| `ts collapse` | The `<pre>` folded into `<details class="slip-fold"><summary>展开代码（N 行）…</summary><pre>…</pre></details>` inside the slip | `fenceMeta` + `codeSlips` |
| `ts showLineNumbers` | `data-line-numbers` on the `<pre>`; prose.css numbers the lines with a CSS counter | `fenceMeta` |
| `ts {1,3-4}` | `.line.highlighted` on those lines (marker pen) | `transformerMetaHighlight` |
| `ts /accountId/` | `<span class="highlighted-word">` around every match | `transformerMetaWordHighlight` |
| `// [!code ++]`, `// [!code --]`, `// [!code highlight]`, `// [!code word:x]` at the end of a line | `.line.diff.add` / `.line.diff.remove` / `.line.highlighted` / `.highlighted-word`; the comment itself is removed | `transformerNotation*` (`matchAlgorithm: "v3"`) |
| A ```` ```mermaid ```` block | A pre-rendered hand-drawn diagram (`figure.diagram`), not a slip. Shiki skips the language (`syntaxHighlight.excludeLangs`) and `codeSlips` leaves any mermaid `<pre>` alone | `mermaidDiagrams` (hast, `diagrams.ts`) |
| A paragraph holding only images | `<p class="pic">` (polaroid) | `pictureParagraphs` (hast) |
| A leading `# Title` equal to the frontmatter title | Removed, because the drawer already prints the title as the page's `<h1>` | `dropTitleHeading` (hast) |
| `==text==` | `<mark>`, redrawn with Rough Notation by `src/components/post/marks.ts` | `highlightMarks` (mdast) |
| A blockquote starting with `[!aside] 吐槽` (label optional, default 旁注) | `<aside class="aside-sticky sticky-paper"><b>吐槽</b><p>…</p></aside>`: a sticky note floated into the right margin (inline on narrow screens), not open to inline comments | `asideStickies` (hast) |
| Footnotes | Labelled 注释 | GFM options |

- **Tape:** the tape on each slip is the figure's `::before`, not an `<img>`, so the article contains no decorative images.
- **Tilt:** tape colour and tilt are seeded from the slug and the block's position, so every build produces the same result.
- **Long blocks:** slips longer than 24 lines are not tilted, because a long tilted block drifts sideways and blurs. A folded (`collapse`) slip keeps its tilt.
- **Copy tab:** `src/scripts/copy.ts` handles `button.slip-copy` by delegation. It copies the slip's lines from the DOM (so it works while a folded slip is closed) and leaves out `diff remove` lines, so the reader gets the code after the change. 已复制 goes into the slip's own `role="status"` span. The + / − marks and line numbers are CSS, so they are never copied. copy.ts is loaded by `CopyrightSlip.astro`, which every note has; a page that shows a post body without it would have a dead copy tab.
- **Inline comments:** the whole slip carries `data-no-annotate`, so the summary and tab text cannot be picked for 划线评论.

## Writing code blocks in a post

````md
```ts title="src/gateway.ts" {2} /accountId/
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
const { accountId } = config.cloudflare;
```

```bash collapse
# a long log that most readers skip
```

```go showLineNumbers
package main
```
````

- **Prefer the fence meta** (`{1,3}`, `/word/`, `collapse`) over `// [!code …]` comments. The raw Markdown is also served as is (`/notes/<slug>.md`, `llms-full.txt`), and meta stays out of the code there, while a `[!code]` comment shows up as a stray comment.
- Use `// [!code ++]` / `// [!code --]` only for a real before/after diff, where marking lines by number would be fragile. Use the comment syntax of the language (`# [!code ++]` in shell and YAML).
- `title="…"` is removed from the meta before the other transformers read it, so a path such as `title="src/lib/a.ts"` is not taken as a `/word/`.

## Code colours

`ink-theme.ts` is a light Shiki theme with five inks (the same values as the `--kw`, `--str`, `--com`, `--fn` and `--punct` tokens in `src/styles/tokens.css`). Contrast is on the slip paper `#fdfaf2`:

| Ink | Colour | Scopes | Contrast |
| --- | --- | --- | --- |
| Blue-black | `#3d5f8f` | keywords, storage, language constants, built-in types and functions | 6.23:1 |
| Ochre | `#9a4d2c` | strings, numbers, attribute and property names | 5.80:1 |
| Grey | `#736b59` | comments | 5.06:1 |
| Vermilion (`--stamp-ink`) | `#9e3129` | functions, types, classes, namespaces, tags | 6.88:1 |
| Pencil | `#524a3e` | punctuation, operators, braces, so they recede | 8.36:1 |

All other text is `#2d2822` on a transparent background.

TextMate picks the deepest matching scope, so the specific scopes in the older rules still win over the broad new ones: `support.type.primitive` and `support.function.builtin` stay blue, `support.type.property-name` and `punctuation.definition.string` stay ochre, `punctuation.definition.comment` stays grey, and word operators (`keyword.operator.new`, `keyword.operator.word`, …) stay blue.

Marked lines sit on pale backgrounds that keep every ink at 4.5:1 or more (grey comments are the lowest, ~4.5:1): `--code-mark` (highlighted line, with a marker-pen bar on the left), `--code-word`, `--diff-add` (pale green, + in `--diff-add-ink`), `--diff-remove` (pale vermilion, − in `--stamp-ink`).

Chinese inside code falls through the monospace fonts to Zhuque Fangsong (`--code`). No extra download: the note-body subset built by `scripts/font-chars.ts` already has every character in the note, code fences included.

## Styles

The typography lives in `src/styles/prose.css`, scoped to `.post-body`; it imports `diagrams.css` for Mermaid diagrams. Section numbers on `h2` are CSS counters, so they are never part of the selectable text.

- **Scrolling slips:** the scrollbar thumb is `--field-line` (≥ 3:1 on the slip). Where scroll-driven animations are supported, a paper fade at the right edge (`.slip::after`) shows while there is more code to the right and fades out as the reader scrolls to the end; no JavaScript.
- **Tape and label:** the tape, kraft label and copy tab stick 10px out above the slip on purpose. An element screenshot of `figure.slip` crops them to the slip's box, which looks like a clipping bug; take the screenshot with a margin above the slip.

### Margin sticky note

```md
> [!aside] 吐槽
> gatewayId 感觉应该叫 gatewayName 比较好？
```

Put it right before the paragraph it comments on. Keep it short: it is 176px wide.

## Limits

- **`==mark==`:** it only matches inside one text node, so `==**bold**==` is not highlighted.
