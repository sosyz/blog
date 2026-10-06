/**
 * Edit tokens for moving a placed sticker. POST /api/stickers creates one,
 * returns it once, and stores only its salted hash; the uploader's browser
 * keeps the token (localStorage) and sends it with PATCH /api/stickers/:id.
 *
 * Pure (Web Crypto only) so it is unit-tested (tests/sticker-move.test.ts).
 */
import { randomToken, sha256Hex } from "./http";
import type { Placement } from "./sticker-limits";

/** base64url of 32 random bytes (256 bits), no padding. */
export const EDIT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const newEditToken = randomToken;

/** Salted like the IP and e-mail hashes, with its own label. */
export const hashEditToken = (token: string, salt: string) =>
  sha256Hex(`${salt}:edit:${token}`);

/**
 * Compares two hex digests without stopping at the first difference, so the
 * time taken does not tell how much of a guess was right.
 */
export const sameDigest = (a: string, b: string) => {
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: constant-time comparison
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
};

/** True when `token` is the edit token whose hash is stored. */
export const checkEditToken = async (
  token: string,
  storedHash: string | null,
  salt: string
) => {
  if (!(storedHash && EDIT_TOKEN.test(token))) {
    return false;
  }
  return sameDigest(await hashEditToken(token, salt), storedHash);
};

const describe = ({ x, y, rotation, scale }: Placement) =>
  `(${x}, ${y}) ${rotation}° ×${scale}`;

/** moderation_log note for a move: "(10, 20) 0° ×1 → (40, 20) 5° ×1.2". */
export const moveNote = (from: Placement, to: Placement, who?: string) =>
  `${who ? `${who}：` : ""}${describe(from)} → ${describe(to)}`;
