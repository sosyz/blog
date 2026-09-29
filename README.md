# Sonui's Blog

A hand-drawn technical journal on an infinite canvas: notes on things that
broke (踩坑) and short thoughts (随想). Built with Astro and deployed as a
Cloudflare Worker with static assets.

## Stack

- Astro 7 (static pages; on-demand API routes via `@astrojs/cloudflare` 14)
- TypeScript, plain CSS (no React, no Tailwind)
- Astro content collections, RSS, sitemap
- Cloudflare D1, R2, Turnstile, Access (comments and visitor stickers)
- Fonts: 小赖 Xiaolai, 朱雀仿宋 Zhuque Fangsong (split with cn-font-split), Maple Mono
- AI SDK with OpenAI-compatible providers (build-time image alt text)
- Ultracite/Biome for TS/JS/CSS, Prettier for `.astro`

## Project Structure

See [docs/architecture.md](docs/architecture.md) for the full map, the
ownership of each area and the contracts between them, and
[docs/design.md](docs/design.md) for the design decisions. Asset licences are
in [ATTRIBUTIONS.md](ATTRIBUTIONS.md).

## Commands

Run commands from the project root.

| Command                 | Action                                          |
| :---------------------- | :---------------------------------------------- |
| `bun install`           | Install dependencies                            |
| `bun run dev`           | Start the local dev server at `localhost:4321`  |
| `bun run build`         | Build the site to `./dist/`                     |
| `bun run preview`       | Preview the production build locally            |
| `bun run check`         | Type-check with `astro check`                   |
| `bun x ultracite fix`   | Format and apply safe automatic fixes           |
| `bun run lint`          | Format `.astro` files with Prettier             |
| `bun run fonts`         | Re-split the CJK fonts into `public/fonts/`     |
| `bun run cf-typegen`    | Regenerate Worker binding types                 |

Use `bun run build` instead of `bun build`. `bun build` is Bun's standalone
bundler command and does not run this project's Astro build script.

## Writing Posts

Add Markdown or MDX files under `src/posts`. Frontmatter is validated by
`src/content.config.ts`; the fields are described in
[docs/design.md](docs/design.md#内容).

```yaml
---
title: "通过 Cloudflare AI Gateway 使用 LLM"
description: "一句话摘要"
type: 踩坑 # 踩坑 | 随想
topic: AI
tags: [AI, LLM]
pubDate: 2025-10-08
---
```

## Environment

Copy `.env.example` to `.env` (build time) and `.dev.vars.example` to
`.dev.vars` (local Worker secrets). In production, set Worker secrets with
`bunx wrangler secret put <NAME>`.

AI image-alt generation reads provider configuration from environment
variables (optional; without them the build uses a generic alt text):

- `OPENROUTER_API_KEY`
- `MAASHUB_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_GATEWAY_ID`
- `CLOUDFLARE_GATEWAY_AUTH`
- `CLOUDFLARE_AI_API_KEY`

Do not commit real secrets.

## References

- [Astro](https://astro.build)
- [Biome](https://biomejs.dev)
- [Ultracite](https://github.com/haydenbleasel/ultracite)
