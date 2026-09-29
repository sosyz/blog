/**
 * Per-visitor limits, counted from rows already in D1 (no extra writes).
 * A visitor is identified by ip_hash; a logged-in GitHub user is also counted
 * per account (comments.user_id / stickers.user_id), and both limits apply.
 * Sticker moves are counted per ip_hash; the owner's moves are not limited.
 *
 * The routes check early (rateLimitMessage, before Turnstile) so most extra
 * requests stop cheaply, but that read and the later write are separate, so
 * parallel requests could all pass it. The limit that holds is the one db.ts
 * checks inside the write itself (a conditional INSERT / UPDATE, see
 * limitWindow): nothing is written when the visitor is already at the limit.
 */

export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const RATE_LIMITS = {
  comment: { perHour: 6, perDay: 20 },
  sticker: { perHour: 3, perDay: 6 },
  /** Moving your own sticker (counted from moderation_log 'move' rows). */
  move: { perHour: 60, perDay: 300 },
} as const;

export type RateLimitKind = keyof typeof RATE_LIMITS;

const MESSAGES: Record<RateLimitKind, string> = {
  comment: "留言有点频繁了，歇一会儿再来。",
  sticker: "贴纸贴得有点多了，明天再来吧。",
  move: "挪得有点频繁了，歇一会儿再来。",
};

/** Counts are `[lastHour, lastDay]`. Returns a message when over the limit. */
export const rateLimitMessage = (
  kind: RateLimitKind,
  lastHour: number,
  lastDay: number
) => {
  const limit = RATE_LIMITS[kind];
  if (lastHour >= limit.perHour || lastDay >= limit.perDay) {
    return MESSAGES[kind];
  }
  return null;
};

/** The 429 message when the write itself found the visitor at the limit. */
export const limitReachedMessage = (kind: RateLimitKind) => MESSAGES[kind];

/**
 * A limit as db.ts checks it inside a write: allowed while there are fewer
 * than `perHour` rows after `hourStart` and fewer than `perDay` after
 * `dayStart` (the same windows and comparison as rateLimitMessage).
 */
export type LimitWindow = {
  perHour: number;
  perDay: number;
  hourStart: number;
  dayStart: number;
};

export const limitWindow = (kind: RateLimitKind, now: number): LimitWindow => ({
  perHour: RATE_LIMITS[kind].perHour,
  perDay: RATE_LIMITS[kind].perDay,
  hourStart: now - HOUR,
  dayStart: now - DAY,
});
