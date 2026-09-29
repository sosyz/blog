/**
 * Friend links (友链), maintained by hand. Shown on the canvas (a small pile
 * of name cards, first six in this order) and on /links/ (all of them).
 *
 * To add a friend (details in AGENTS.md「加一条友链」):
 * 1. Append an entry below. `url` must be https; names and URLs must be
 *    unique; `description` is one short sentence (≤ 40 characters).
 * 2. Optional avatar: drop a square image (≥ 96×96, png/jpg/webp/avif) into
 *    src/assets/links/ and put its file name in `avatar`. Astro resizes it at
 *    build time; never link to an avatar on another site (the CSP only allows
 *    images from this site). Without one a hand-drawn initial is shown.
 * 3. `bun run build` checks every entry (src/lib/links.ts), then deploy.
 *
 * Plain data (only a type import), so tests can read it directly.
 */
import type { FriendLink } from "../lib/links.ts";

export const FRIEND_LINKS: readonly FriendLink[] = [
  // {
  //   name: "某某的博客",
  //   url: "https://example.com/",
  //   description: "一句话介绍。",
  //   avatar: "example.webp",
  //   since: "2026-10-01",
  // },
];
