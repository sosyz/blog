/**
 * GET  /api/comments?slug=<slug>&mine=<id,id>  approved comments of a note
 *      (normal and inline, with owner replies) + statuses of the visitor's own
 *      ids; with a GitHub session also that account's pending comments (their
 *      ids in `mine`, the comments in `ownPending`). Every comment carries
 *      `user` (GitHub profile or null) and `isOwner` (博主).
 * POST /api/comments  JSON body, see `commentInput` in src/lib/server/validate.ts.
 *      With a GitHub session: `memberCommentInput` (no name / site / Turnstile;
 *      the account is the author), rate-limited per account and per IP.
 */

import { noteSlugs } from "virtual:note-slugs";
import type { APIRoute } from "astro";
import {
  insertComment,
  listApprovedComments,
  listOwnPendingComments,
  parentExists,
  recentCounts,
  recentCountsByUser,
  statusesByIds,
  visitorLimits,
} from "@/lib/server/db";
import {
  authConfig,
  database,
  ipSalt,
  moderator,
  turnstileSecret,
  viewerOf,
} from "@/lib/server/env";
import {
  clientIp,
  crossOrigin,
  fail,
  hashEmail,
  hashIp,
  isSameOrigin,
  JSON_BODY_LIMIT,
  json,
  readJson,
  STATUS,
} from "@/lib/server/http";
import { moderate } from "@/lib/server/moderation";
import {
  DAY,
  HOUR,
  limitReachedMessage,
  limitWindow,
  rateLimitMessage,
} from "@/lib/server/rate-limit";
import type { Viewer } from "@/lib/server/session";
import { verifyTurnstile } from "@/lib/server/turnstile";
import type { CommentsResponse, CreatedResponse } from "@/lib/server/types";
import {
  type AnyCommentInput,
  commentInput,
  firstIssue,
  memberCommentInput,
  parseMineIds,
  slugField,
} from "@/lib/server/validate";
import {
  commentAuthor,
  listCacheHeaders,
  needsTurnstile,
} from "@/lib/server/visitor";

export const prerender = false;

const UA_LENGTH = 200;
const UNKNOWN_NOTE = "不知道这是哪篇笔记。";

export const GET: APIRoute = async ({ url, request }) => {
  const slug = slugField.safeParse(url.searchParams.get("slug"));
  if (!slug.success) {
    return fail(STATUS.badRequest, firstIssue(slug.error));
  }
  if (!noteSlugs.has(slug.data)) {
    return fail(STATUS.notFound, UNKNOWN_NOTE);
  }
  const mineIds = parseMineIds(url.searchParams.get("mine"));
  const db = database();
  const { ownerId } = authConfig();
  const { viewer } = await viewerOf(request);
  const [comments, mine, ownPending] = await Promise.all([
    listApprovedComments(db, slug.data, ownerId),
    statusesByIds(db, "comments", mineIds),
    viewer
      ? listOwnPendingComments(db, {
          ownerId,
          slug: slug.data,
          userId: viewer.userId,
        })
      : [],
  ]);
  // The account's pending comments report through `mine` like the ids a
  // browser remembers, and in full in `ownPending` for other devices.
  for (const item of ownPending) {
    mine[item.id] = "pending";
  }
  const body: CommentsResponse = { comments, mine, ownPending };
  // Shared caches may keep the plain list briefly; anything that depends on
  // who asks (mine=, me=1, a GitHub session) is private.
  const headers = listCacheHeaders(
    {
      me: url.searchParams.has("me"),
      mine: mineIds.length > 0,
      session: viewer !== null,
    },
    "public, max-age=30, s-maxage=60"
  );
  return json(body, { headers });
};

type Parsed =
  | { ok: true; input: AnyCommentInput }
  | { ok: false; response: Response };

/** Reads the body with the schema for a logged-in or an anonymous visitor. */
const readComment = async (
  request: Request,
  member: boolean
): Promise<Parsed> => {
  const raw = await readJson(request, JSON_BODY_LIMIT);
  if (raw === null) {
    return {
      ok: false,
      response: fail(STATUS.badRequest, "提交的内容格式不对。"),
    };
  }
  const parsed = member
    ? memberCommentInput.safeParse(raw)
    : commentInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail(STATUS.badRequest, firstIssue(parsed.error)),
    };
  }
  if (!noteSlugs.has(parsed.data.slug)) {
    return { ok: false, response: fail(STATUS.badRequest, UNKNOWN_NOTE) };
  }
  return { input: parsed.data, ok: true };
};

/**
 * Per IP always; per account too when logged in. An early, cheap check
 * before Turnstile; insertComment checks the same limits again in the write,
 * which is what holds when requests arrive in parallel.
 */
const rateLimited = async (
  db: D1Database,
  {
    ipHash,
    viewer,
    now,
  }: { ipHash: string; viewer: Viewer | null; now: number }
) => {
  const window = { day: DAY, hour: HOUR, now, table: "comments" as const };
  const [byIp, byUser] = await Promise.all([
    recentCounts(db, { ...window, ipHash }),
    viewer
      ? recentCountsByUser(db, { ...window, userId: viewer.userId })
      : ([0, 0] as const),
  ]);
  return (
    rateLimitMessage("comment", byIp[0], byIp[1]) ??
    rateLimitMessage("comment", byUser[0], byUser[1])
  );
};

/** Who wrote it (see commentAuthor); the e-mail is stored only hashed. */
const authorFields = async (
  input: AnyCommentInput,
  viewer: Viewer | null,
  salt: string
) => {
  const { email, ...author } = commentAuthor(viewer?.user ?? null, input);
  return {
    ...author,
    emailHash: email ? await hashEmail(email, salt) : null,
  };
};

/**
 * A GitHub session (same-origin POST, SameSite=Lax cookie) stands in for
 * Turnstile; everyone else proves they are human.
 */
const humanCheck = async (
  viewer: Viewer | null,
  {
    token,
    ip,
    action,
    hostname,
  }: { token: string | undefined; ip: string; action: string; hostname: string }
) => {
  if (!needsTurnstile(viewer !== null)) {
    return null;
  }
  const human = await verifyTurnstile({
    action,
    hostname,
    remoteip: ip === "unknown" ? undefined : ip,
    secret: turnstileSecret(),
    token: token ?? "",
  });
  return human.ok ? null : fail(human.status, human.message);
};

export const POST: APIRoute = async ({ request, url }) => {
  if (!isSameOrigin(request)) {
    return crossOrigin();
  }
  const { viewer } = await viewerOf(request);
  const read = await readComment(request, Boolean(viewer));
  if (!read.ok) {
    return read.response;
  }
  const { input } = read;
  const db = database();
  const now = Date.now();
  const ip = clientIp(request);
  const salt = ipSalt();
  const ipHash = await hashIp(ip, salt);

  const limited = await rateLimited(db, { ipHash, now, viewer });
  if (limited) {
    return fail(STATUS.tooManyRequests, limited);
  }

  const refused = await humanCheck(viewer, {
    action: input.kind,
    hostname: url.hostname,
    ip,
    token: input.turnstile,
  });
  if (refused) {
    return refused;
  }

  if (input.parentId && !(await parentExists(db, input.slug, input.parentId))) {
    return fail(STATUS.badRequest, "要回复的留言不存在。");
  }

  const id = crypto.randomUUID();
  const anchor = input.kind === "inline" ? input.anchor : null;
  const author = await authorFields(input, viewer, salt);
  // Everyone is pre-moderated, logged in or not (the owner too).
  const result = await moderate(moderator(), {
    body: input.body,
    id,
    kind: input.kind,
    name: author.name,
    quote: anchor?.exact,
    site: author.site ?? undefined,
    slug: input.slug,
    type: "comment",
  });

  const inserted = await insertComment(
    db,
    {
      anchor,
      body: input.body,
      createdAt: now,
      emailHash: author.emailHash,
      id,
      ipHash,
      kind: input.kind,
      name: author.name,
      parentId: input.parentId ?? null,
      site: author.site,
      slug: input.slug,
      status: result.status,
      ua: request.headers.get("user-agent")?.slice(0, UA_LENGTH) ?? null,
      userId: viewer?.userId ?? null,
    },
    {
      actor: result.actor,
      createdAt: now,
      decision: result.decision,
      itemId: id,
      itemType: "comment",
      note: result.note,
    },
    visitorLimits(limitWindow("comment", now), {
      ipHash,
      userId: viewer?.userId ?? null,
    })
  );
  if (!inserted) {
    return fail(STATUS.tooManyRequests, limitReachedMessage("comment"));
  }

  const body: CreatedResponse = { id, status: result.status };
  return json(body, { status: STATUS.created });
};
