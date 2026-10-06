/**
 * The visitor's own stickers, per browser (localStorage):
 *
 * - pending ones, shown to them with a dashed outline and 审核中 until a
 *   moderator decides. The image is kept as a data URL (≤ 300 KB each, at
 *   most 3) because pending images are not served publicly;
 * - owned ones: id + the edit token POST /api/stickers returned, kept after
 *   approval so the uploader can still move the sticker (PATCH
 *   /api/stickers/:id). Dropped when the sticker is rejected or gone.
 */
import type { PublicSticker } from "@/lib/server/types";
import { STICKERS_CHANGED } from "./events";
import type { EditPlacement } from "./sticker-transform";
import { readStore, writeStore } from "./util";

export type PendingSticker = Omit<PublicSticker, "src" | "name"> & {
  name: string | null;
  dataUrl: string;
  createdAt: number;
};

const KEY = "interact:pending-stickers";
const MAX = 3;
/** 30 days. */
const MAX_AGE = 2_592_000_000;

export const readPendingStickers = () => {
  const now = Date.now();
  return readStore<PendingSticker[]>(KEY, []).filter(
    (item) => now - item.createdAt < MAX_AGE
  );
};

export const writePendingStickers = (items: PendingSticker[]) => {
  let list = items.slice(-MAX);
  // Quota is small; drop the oldest until it fits.
  while (list.length > 0 && !writeStore(KEY, list)) {
    list = list.slice(1);
  }
  if (list.length === 0) {
    writeStore(KEY, []);
  }
};

export const addPendingSticker = (item: PendingSticker) => {
  writePendingStickers([...readPendingStickers(), item]);
  window.dispatchEvent(new CustomEvent(STICKERS_CHANGED));
};

/** Moved by its owner: keep the pending copy where the sticker now is. */
export const movePendingSticker = (id: string, placement: EditPlacement) => {
  const items = readPendingStickers();
  const item = items.find((entry) => entry.id === id);
  if (item) {
    Object.assign(item, placement);
    writePendingStickers(items);
  }
};

export interface OwnedSticker {
  createdAt: number;
  id: string;
  token: string;
}

const OWNED_KEY = "interact:owned-stickers";
/** Stickers the upload limit allows in a few weeks; oldest go first. */
const MAX_OWNED = 40;

export const readOwnedStickers = () =>
  readStore<OwnedSticker[]>(OWNED_KEY, []).filter(
    (item) => typeof item?.id === "string" && typeof item.token === "string"
  );

export const ownedToken = (id: string) =>
  readOwnedStickers().find((item) => item.id === id)?.token ?? null;

export const addOwnedSticker = (item: { id: string; token: string }) => {
  const rest = readOwnedStickers().filter((entry) => entry.id !== item.id);
  writeStore(OWNED_KEY, [
    ...rest.slice(-(MAX_OWNED - 1)),
    { ...item, createdAt: Date.now() },
  ]);
};

/** Keeps only the owned stickers `keep` says yes to. */
export const keepOwnedStickers = (keep: (item: OwnedSticker) => boolean) => {
  const items = readOwnedStickers();
  const kept = items.filter(keep);
  if (kept.length !== items.length) {
    writeStore(OWNED_KEY, kept);
  }
};
