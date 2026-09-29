/**
 * Pure helpers for reviewing stickers on the canvas (review-stickers.ts):
 * finding the review target, the camera target of a review link, where the
 * floating review card goes, and the toolbar badge. No DOM access, so bun
 * test can import it. The API shapes are in src/lib/server/types.ts.
 */

/** GET /api/admin/queue (only the parts the badge reads). */
export type QueueSummary = {
  counts?: { comments?: number; stickers?: number };
  comments?: readonly unknown[];
  stickers?: readonly unknown[];
};

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

/** The Access session is gone (or never was): moderation is not allowed. */
export const isAuthLost = (status: number, redirected = false) =>
  redirected || status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN;

const countOf = (value: number | undefined, list?: readonly unknown[]) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : (list?.length ?? 0);

/** 待审 N: pending comments + pending stickers. */
export const badgeCount = (queue: QueueSummary | null | undefined) => {
  if (!queue) {
    return 0;
  }
  return (
    countOf(queue.counts?.comments, queue.comments) +
    countOf(queue.counts?.stickers, queue.stickers)
  );
};

/** The first item with this id in the first list that has it. */
export const findById = <T extends { id: string }>(
  id: string,
  ...lists: readonly (readonly T[])[]
): T | null => {
  for (const list of lists) {
    const found = list.find((item) => item.id === id);
    if (found) {
      return found;
    }
  }
  return null;
};

/**
 * Items of `rest` whose id is not in `taken` (the review copy of a sticker
 * wins over the uploader's own 审核中 copy of the same sticker).
 */
export const withoutIds = <T extends { id: string }>(
  rest: readonly T[],
  taken: Iterable<string>
) => {
  const ids = new Set(taken);
  return rest.filter((item) => !ids.has(item.id));
};

/** Zoom used when a review link glides to a sticker (not too far out). */
export const REVIEW_SCALE_MIN = 0.8;
export const REVIEW_SCALE_MAX = 1.4;
/** Screen px the sticker sits above the centre, so the card below fits. */
export const REVIEW_LIFT = 80;

export type CameraTarget = { x: number; y: number; scale: number };

/**
 * Where the camera should centre (world px) and at which zoom, so the
 * sticker at `point` and its review card below it are both in view.
 */
export const reviewCamera = (
  point: { x: number; y: number },
  currentScale: number
): CameraTarget => {
  const safe =
    Number.isFinite(currentScale) && currentScale > 0 ? currentScale : 1;
  const scale = Math.min(REVIEW_SCALE_MAX, Math.max(REVIEW_SCALE_MIN, safe));
  return { x: point.x, y: point.y + REVIEW_LIFT / scale, scale };
};

/** Screen px kept between the card and the viewport edge. */
const EDGE = 12;

/**
 * Put the card below the sticker unless that runs off the bottom of the
 * viewport and there is more room above. All values are screen px.
 */
export const cardSide = ({
  top,
  bottom,
  cardHeight,
  viewportHeight,
}: {
  top: number;
  bottom: number;
  cardHeight: number;
  viewportHeight: number;
}): "below" | "above" => {
  const roomBelow = viewportHeight - bottom - EDGE;
  if (roomBelow >= cardHeight) {
    return "below";
  }
  return top - EDGE > roomBelow ? "above" : "below";
};

const FINGERPRINT_CHARS = 8;

/** The first few characters are enough to tell uploaders apart. */
export const shortFingerprint = (fingerprint: string) =>
  fingerprint.trim().slice(0, FINGERPRINT_CHARS);

const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 2025.10.08 14:03 in China time. */
export const reviewTime = (ms: number) => {
  const parts = Object.fromEntries(
    timeFormat
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
};

/** What the card says after a decision. */
export const decidedText = (
  decision: "approve" | "reject",
  wasApproved: boolean
) => {
  if (decision === "approve") {
    return "已通过，别人最多 5 分钟后能看到";
  }
  return wasApproved ? "已撤下，图片删掉了" : "已拒绝，图片删掉了";
};
