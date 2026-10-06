/**
 * Input validation for visitor content. Pure (no Astro/Workers imports) so it
 * is unit-tested directly (tests/validate.test.ts).
 *
 * Error messages are shown to visitors as-is: plain Simplified Chinese.
 */
import { z } from "astro/zod";
import { BUILTIN_KEY, BUILTIN_KEY_MAX } from "../builtin-stickers";
import { EDIT_TOKEN } from "./edit-token";
import { STICKER_PLACEMENT } from "./sticker-limits";

export const LIMITS = {
  body: 800,
  email: 254,
  exactMax: 200,
  /** Highlighted text for inline comments, in characters (design.md: 2–200). */
  exactMin: 2,
  inlineBody: 300,
  name: 24,
  /** Text before the highlight (~12 characters are sent; allow some slack). */
  prefix: 40,
  site: 200,
  /** Sticker upload. */
  /** 300 KB. */
  stickerBytes: 307_200,
  stickerSide: 512,
  token: 2048,
  /** World box, rotation and scale range (shared with the client). */
  ...STICKER_PLACEMENT,
} as const;

/** At most this many of the visitor's own ids per status lookup. */
const MAX_MINE_IDS = 50;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const HTTP_URL = /^https?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WHITESPACE_RUN = /\s+/g;
const MANY_NEWLINES = /\n{3,}/g;
const CRLF = /\r\n?/g;
/** GitHub logins: letters, digits and single inner hyphens, at most 39. */
export const GITHUB_LOGIN =
  /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const GITHUB_ID = /^\d{1,15}$/;

const TAB = 9;
const LINE_FEED = 10;
const SPACE = 32;
const DELETE = 127;
/** C1 controls. */
const C1_END = 0x9f;

/**
 * Invisible format characters that can disguise text in the admin queue or
 * the comment list: bidi marks, embeddings, overrides and isolates, zero-width
 * space and the byte-order mark. ZWNJ / ZWJ (U+200C / U+200D) are kept: emoji
 * sequences and some scripts need them.
 */
const INVISIBLE =
  /^[\u061c\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]$/u;

const isDropped = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code < SPACE && code !== LINE_FEED && code !== TAB) ||
    (code >= DELETE && code <= C1_END) ||
    INVISIBLE.test(char)
  );
};

/** Drops control and invisible format characters (keeps tabs and line feeds). */
const stripControl = (value: string) => {
  let out = "";
  for (const char of value) {
    if (!isDropped(char)) {
      out += char;
    }
  }
  return out;
};

/** Multi-line text: normalise newlines, drop control chars, trim, cap blank lines. */
export const cleanText = (value: string) =>
  stripControl(value.replace(CRLF, "\n")).replace(MANY_NEWLINES, "\n\n").trim();

/** One-line text: collapse all whitespace. */
export const cleanLine = (value: string) =>
  stripControl(value).replace(WHITESPACE_RUN, " ").trim();

/** Number of characters as a person counts them (code points). */
export const charCount = (value: string) => [...value].length;

/** "" / null → undefined, so optional fields can be left blank in forms. */
const blankToUndefined = (value: unknown) =>
  value === null || (typeof value === "string" && value.trim() === "")
    ? undefined
    : value;

const nameField = z
  .string({ error: "写一下昵称吧。" })
  .transform(cleanLine)
  .pipe(
    z
      .string()
      .min(1, "写一下昵称吧。")
      .max(LIMITS.name, `昵称最多 ${LIMITS.name} 个字。`)
  );

const emailField = z.preprocess(
  blankToUndefined,
  z
    .email({ error: "邮箱格式不对。" })
    .max(LIMITS.email, "邮箱太长了。")
    .optional()
);

const siteField = z.preprocess(
  blankToUndefined,
  z
    .url({
      error: "网址要以 http:// 或 https:// 开头。",
      protocol: HTTP_URL,
    })
    .max(LIMITS.site, "网址太长了。")
    .optional()
);

const bodyField = (max: number) =>
  z
    .string({ error: "内容还是空的。" })
    .transform(cleanText)
    .pipe(
      z.string().min(1, "内容还是空的。").max(max, `内容最多 ${max} 个字。`)
    );

const tokenField = z
  .string({ error: "人机验证还没完成，稍等一下再寄出。" })
  .min(1, "人机验证还没完成，稍等一下再寄出。")
  .max(LIMITS.token, "人机验证的结果不对，刷新页面再试一次。");

export const slugField = z
  .string({ error: "不知道这是哪篇笔记。" })
  .regex(SLUG, "不知道这是哪篇笔记。");

export const idField = z.string().regex(UUID, "编号不对。");

const anchorField = z.object(
  {
    exact: z
      .string()
      .transform(cleanLine)
      .refine(
        (value) =>
          charCount(value) >= LIMITS.exactMin &&
          charCount(value) <= LIMITS.exactMax,
        `划线的文字要在 ${LIMITS.exactMin}–${LIMITS.exactMax} 个字之间。`
      ),
    // Not trimmed: the client matches it against the text right before the
    // highlight, which may end in a space.
    prefix: z
      .string()
      .default("")
      .transform((value) => stripControl(value).replace(WHITESPACE_RUN, " "))
      .refine(
        (value) => charCount(value) <= LIMITS.prefix,
        "划线位置的信息太长了。"
      ),
  },
  { error: "划线评论缺少被划的文字。" }
);

const commentPlace = {
  parentId: z.preprocess(blankToUndefined, idField.optional()),
  slug: slugField,
};

/** Nickname, optional e-mail and site, and the Turnstile token. */
const anonymousFields = {
  email: emailField,
  name: nameField,
  site: siteField,
  turnstile: tokenField,
};

const commentSchema = <T extends z.ZodRawShape>(common: T) =>
  z.discriminatedUnion(
    "kind",
    [
      z.object({
        kind: z.literal("comment"),
        ...common,
        body: bodyField(LIMITS.body),
      }),
      z.object({
        kind: z.literal("inline"),
        ...common,
        anchor: anchorField,
        body: bodyField(LIMITS.inlineBody),
      }),
    ],
    { error: "不知道这是哪种留言。" }
  );

/** POST /api/comments without a login: nickname and Turnstile required. */
export const commentInput = commentSchema({
  ...commentPlace,
  ...anonymousFields,
});

export type CommentInput = z.infer<typeof commentInput>;

/**
 * POST /api/comments while logged in with GitHub: name and site come from
 * the account, no Turnstile. Other fields (name, e-mail, …) are dropped.
 */
export const memberCommentInput = commentSchema(commentPlace);

export type MemberCommentInput = z.infer<typeof memberCommentInput>;

/** Either kind of comment body, with the anonymous-only fields optional. */
export type AnyCommentInput = MemberCommentInput &
  Partial<Pick<CommentInput, "name" | "email" | "site" | "turnstile">>;

const finiteNumber = (message: string, min: number, max: number) =>
  z.coerce
    .number({ error: message })
    .refine(Number.isFinite, message)
    .refine((value) => value >= min && value <= max, message);

/**
 * A number the form must send. Missing (null) or blank fails instead of
 * being coerced to 0.
 */
const requiredNumber = (message: string, min: number, max: number) =>
  z.preprocess(
    (value) => blankToUndefined(value) ?? Number.NaN,
    finiteNumber(message, min, max)
  );

/** Where a new sticker goes (upload form fields, as strings). */
const stickerPlacementFields = {
  rotation: z.preprocess(
    (value) => blankToUndefined(value) ?? 0,
    finiteNumber("贴纸的角度不对。", -LIMITS.rotation, LIMITS.rotation)
  ),
  scale: z.preprocess(
    (value) => blankToUndefined(value) ?? 1,
    finiteNumber("贴纸的大小不对。", LIMITS.scaleMin, LIMITS.scaleMax)
  ),
  x: requiredNumber("贴纸的位置不对。", -LIMITS.world, LIMITS.world),
  y: requiredNumber("贴纸的位置不对。", -LIMITS.world, LIMITS.world),
};

/** Text fields of the sticker upload form (the image is checked separately). */
export const stickerInput = z.object({
  ...stickerPlacementFields,
  name: z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform(cleanLine)
      .pipe(z.string().max(LIMITS.name, `署名最多 ${LIMITS.name} 个字。`))
      .optional()
  ),
  turnstile: tokenField,
});

export type StickerInput = z.infer<typeof stickerInput>;

/** Logged in with GitHub: the account's login is the signature; no Turnstile. */
export const memberStickerInput = z.object(stickerPlacementFields);

/** Either kind of upload, with the anonymous-only fields optional. */
export type AnyStickerInput = z.infer<typeof memberStickerInput> &
  Partial<Pick<StickerInput, "name" | "turnstile">>;

/** A JSON number (strings, null and missing values fail, not coerced). */
const jsonNumber = (message: string, min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === "number" ? value : Number.NaN),
    finiteNumber(message, min, max)
  );

/** Position of a moved sticker: all four fields are required. */
const placementFields = {
  rotation: jsonNumber("贴纸的角度不对。", -LIMITS.rotation, LIMITS.rotation),
  scale: jsonNumber("贴纸的大小不对。", LIMITS.scaleMin, LIMITS.scaleMax),
  x: jsonNumber("贴纸的位置不对。", -LIMITS.world, LIMITS.world),
  y: jsonNumber("贴纸的位置不对。", -LIMITS.world, LIMITS.world),
};

/**
 * PATCH /api/stickers/:id — the uploader moves their own sticker. `token` is
 * the edit token from the upload; it may be left out when the request comes
 * with a GitHub session that owns the sticker (or is the blog owner).
 */
export const stickerMoveInput = z.object({
  ...placementFields,
  token: z
    .string({ error: "这张贴纸不是你贴的，挪不了。" })
    .regex(EDIT_TOKEN, "这张贴纸不是你贴的，挪不了。")
    .optional(),
});

/**
 * DELETE /api/stickers/:id — the uploader tears off their own sticker. Same
 * `token` rule as moving; an empty body parses as `{}` (a GitHub session that
 * owns the sticker, or the blog owner, needs no token).
 */
export const stickerDeleteInput = z.object({
  token: z
    .string({ error: "这张贴纸不是你贴的，撕不了。" })
    .regex(EDIT_TOKEN, "这张贴纸不是你贴的，撕不了。")
    .optional(),
});

export type StickerDeleteInput = z.infer<typeof stickerDeleteInput>;

export type StickerMoveInput = z.infer<typeof stickerMoveInput>;

/** PATCH /api/admin/stickers/:id — the owner moves any visitor sticker. */
export const adminMoveInput = z.object(placementFields);

export type AdminMoveInput = z.infer<typeof adminMoveInput>;

/**
 * POST /api/admin/decide. approve / reject / hold set the status (also on
 * items already decided: reject on an approved comment takes it down,
 * approve on a rejected one restores it); "reply" only sets the owner reply
 * and needs `reply`.
 */
export const decisionInput = z
  .object({
    decision: z.enum(["approve", "reject", "hold", "reply"], {
      error: "只能通过、拒绝、放回待审或回复。",
    }),
    id: idField,
    /** Owner reply (comments only). An empty string removes the reply. */
    reply: z
      .string()
      .transform(cleanText)
      .pipe(z.string().max(LIMITS.body, `回复最多 ${LIMITS.body} 个字。`))
      .optional(),
    type: z.enum(["comment", "sticker"], { error: "不知道要审核什么。" }),
  })
  .refine((input) => input.decision !== "reply" || input.reply !== undefined, {
    message: "回复的内容还没写。",
    path: ["reply"],
  });

export type DecisionInput = z.infer<typeof decisionInput>;

/**
 * POST /api/builtins — the owner hides a built-in sticker for everyone
 * (hidden: true) or brings it back (hidden: false). `key` is its
 * data-sticker-key (src/lib/builtin-stickers.ts).
 */
export const builtinToggleInput = z.object({
  hidden: z.boolean({ error: "要说明是收起还是放回。" }),
  key: z
    .string({ error: "不知道是哪张自带贴纸。" })
    .max(BUILTIN_KEY_MAX, "不知道是哪张自带贴纸。")
    .regex(BUILTIN_KEY, "不知道是哪张自带贴纸。"),
});

export type BuiltinToggleInput = z.infer<typeof builtinToggleInput>;

/** GET /api/auth/dev-login?login=&id= (localhost testing only). */
export const devLoginInput = z.object({
  id: z
    .string()
    .regex(GITHUB_ID, "id 要是正整数。")
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value > 0, "id 要是正整数。"),
  login: z.string().regex(GITHUB_LOGIN, "login 不对。"),
});

/** Comma-separated ids the visitor submitted (for their own 审核中 state). */
export const parseMineIds = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => UUID.test(part))
    .slice(0, MAX_MINE_IDS);

/** First validation message, for a single-line error in the form. */
export const firstIssue = (error: z.ZodError) =>
  error.issues.at(0)?.message ?? "填写的内容有问题。";
