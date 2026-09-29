/**
 * Loads the in-page sticker review tools (review-stickers.ts and what only
 * it needs) in a browser that may moderate, and nowhere else: the same gate
 * as `canModerate()` in owner.ts, i.e. the `interact:owner` flag that
 * /admin/ sets, or a `?review=` link. Visitors never download that code.
 *
 * Checked again on every router navigation: a review link can arrive
 * without a full page load. review-stickers.ts starts itself once imported
 * (it waits for the canvas and asks the server).
 */
import { hasOwnerFlag, reviewTarget } from "./owner";

let requested = false;

const loadIfOwner = () => {
  if (requested || !(hasOwnerFlag() || reviewTarget())) {
    return;
  }
  requested = true;
  import("./review-stickers").catch(() => {
    // Offline or a stale deploy: try again on the next navigation.
    requested = false;
  });
};

document.addEventListener("astro:page-load", loadIfOwner);
loadIfOwner();
