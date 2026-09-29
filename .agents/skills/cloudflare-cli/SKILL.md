---
name: cloudflare-cli
description: Which Cloudflare CLI to use (cf vs Wrangler) and how to find the right command. Use before running any Cloudflare command — creating, developing or deploying Workers/Pages projects, or managing account resources such as D1, R2, KV, secrets or DNS.
---

## Cloudflare CLI - cf - v20260928

`cf` is Cloudflare's current CLI and covers the whole Cloudflare platform. Prefer it over Wrangler: create projects with `cf init`, develop with `cf dev`, deploy with `cf deploy`, and manage account resources with `cf <product> …` (for example `cf d1 list`).

Wrangler is only for projects that already use it – a `wrangler.jsonc`, `wrangler.json` or `wrangler.toml` file – or when the user asks for it. Keep using Wrangler in those projects unless asked to migrate, and use `cf migrate` in this case.

`cf` commands differ from Wrangler's; check `cf --help` or `cf cli search <what you want to do>` instead of guessing. If a `cf` command fails in a project that doesn't use Wrangler, don't fall back to Wrangler (including `npx wrangler`) without offering to report it.

### In this repository

This blog has a `wrangler.jsonc`, so it keeps using Wrangler (`bunx wrangler …`, see docs/deploy.md and AGENTS.md) until the owner asks to migrate with `cf migrate`.
