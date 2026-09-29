/**
 * Screen-reader status messages for things that only change visually: a
 * comment or sticker was sent (WCAG 4.1.3). Messages go to a `role="status"`
 * region: the comment form has its own; everything else shares one hidden
 * region on <body>, created on load and again after every ClientRouter swap
 * (the router replaces <body>).
 */
import type { ItemStatus } from "@/lib/server/types";

const REGION_ID = "sr-status";

/**
 * The spoken confirmation after a comment or highlight comment is sent.
 * A comment the spam check turned away reads like a pending one.
 */
export const sentMessage = (status: ItemStatus) =>
  status === "approved" ? "已寄出，已经公开。" : "已寄出，审核通过后公开。";

const ensureRegion = () => {
  const found = document.getElementById(REGION_ID);
  if (found) {
    return found;
  }
  const region = document.createElement("p");
  region.id = REGION_ID;
  region.className = "sr-only";
  region.setAttribute("role", "status");
  document.body.appendChild(region);
  return region;
};

/**
 * Say `message` politely. The text is set on the next frame after clearing,
 * so the same message twice in a row is still read out.
 */
export const announce = (message: string, region?: HTMLElement | null) => {
  const target = region ?? ensureRegion();
  target.textContent = "";
  requestAnimationFrame(() => {
    target.textContent = message;
  });
};

if (typeof document !== "undefined") {
  ensureRegion();
  document.addEventListener("astro:page-load", ensureRegion);
}
