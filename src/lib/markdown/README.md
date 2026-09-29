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
| A fenced code block | `<figure class="slip" data-lang style="--tape --tr --sr"><pre class="astro-code" data-language>…</pre><figcaption class="fname">label</figcaption></figure>` | `codeSlips` (hast) |
| `ts title="gateway.ts"` (or `file=`) | That file name as the label. Without one: `terminal` for shell languages, `code` for blocks with no language, otherwise the language | `fenceTitle` (Shiki transformer) |
| A paragraph holding only images | `<p class="pic">` (polaroid) | `pictureParagraphs` (hast) |
| A leading `# Title` equal to the frontmatter title | Removed, because the drawer already prints the title as the page's `<h1>` | `dropTitleHeading` (hast) |
| `==text==` | `<mark>`, redrawn with Rough Notation by `src/components/post/marks.ts` | `highlightMarks` (mdast) |
| A blockquote starting with `[!aside] 吐槽` (label optional, default 旁注) | `<aside class="aside-sticky sticky-paper"><b>吐槽</b><p>…</p></aside>`: a sticky note floated into the right margin (inline on narrow screens), not open to inline comments | `asideStickies` (hast) |
| Footnotes | Labelled 注释 | GFM options |

- **Tape:** the tape on each slip is the figure's `::before`, not an `<img>`, so the article contains no decorative images.
- **Tilt:** tape colour and tilt are seeded from the slug and the block's position, so every build produces the same result.
- **Long blocks:** slips longer than 24 lines are not tilted, because a long tilted block drifts sideways and blurs.

## Code colours

`ink-theme.ts` is a light Shiki theme with three inks:

- keywords: `#3d5f8f`
- strings and numbers: `#9a4d2c`
- comments: `#736b59` (≥ 4.5:1 on the slip paper)

All other text is `#2d2822` on a transparent background.

## Styles

The typography lives in `src/styles/prose.css`, scoped to `.post-body`. Section numbers on `h2` are CSS counters, so they are never part of the selectable text.

### Margin sticky note

```md
> [!aside] 吐槽
> gatewayId 感觉应该叫 gatewayName 比较好？
```

Put it right before the paragraph it comments on. Keep it short: it is 176px wide.

## Limits

- **Mermaid:** mermaid blocks are shown as code slips; they are not rendered as diagrams.
- **`==mark==`:** it only matches inside one text node, so `==**bold**==` is not highlighted.
