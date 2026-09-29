/**
 * Storing a new sticker across D1 and R2 (POST /api/stickers). The D1 row
 * goes in first, with the rate limit checked by the INSERT itself, and only
 * then the image: a request over the limit never uploads anything, so no
 * image is left in R2 without a row. Pure apart from the D1 / R2 objects
 * passed in, so it is unit-tested with tests/support/d1.ts and a fake bucket.
 */
import {
  discardSticker,
  insertSticker,
  type LimitKey,
  type LogEntry,
  type NewSticker,
  settleSticker,
} from "./db";

/** The two R2 calls used here (R2Bucket fits). */
export type StickerBucket = {
  put: (
    key: string,
    value: Uint8Array,
    options: R2PutOptions
  ) => Promise<unknown>;
  delete: (key: string) => Promise<unknown>;
};

export type StoreStickerInput = {
  bytes: Uint8Array;
  /** Status as moderated; a rejected sticker's image is never stored. */
  row: NewSticker;
  log: LogEntry;
  limits: readonly LimitKey[];
};

/**
 * 1. Insert the row (and log row) if the visitor is under `limits`; false
 *    when not (nothing written). A sticker to keep goes in as 'pending', so
 *    it is not listed before its image exists; a rejected one is only logged
 *    (nothing else would ever delete its image from R2).
 * 2. Put the image; if that fails, remove the row and its log rows again.
 * 3. Give the row its moderated status. Rejected or torn off while the image
 *    was on its way: delete the image, nothing else would.
 */
export const storeSticker = async (
  db: D1Database,
  bucket: StickerBucket,
  { bytes, row, log, limits }: StoreStickerInput
) => {
  const keepImage = row.status !== "rejected";
  const inserted = await insertSticker(
    db,
    keepImage ? { ...row, status: "pending" } : row,
    log,
    limits
  );
  if (!(inserted && keepImage)) {
    return inserted;
  }
  try {
    await bucket.put(row.r2Key, bytes, {
      httpMetadata: { contentType: row.mime },
      customMetadata: { id: row.id },
    });
  } catch (error) {
    await discardSticker(db, row.id);
    throw error;
  }
  const status = await settleSticker(db, row.id, row.status, row.createdAt);
  if (status === null || status === "rejected") {
    await bucket.delete(row.r2Key);
  }
  return true;
};
