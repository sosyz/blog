/**
 * GET  /api/stickers?mine=<id,id>  approved visitor stickers (world coords)
 *      + statuses of the visitor's own ids; with a GitHub session also that
 *      account's stickers in `mine`, their ids in `owned` and the pending
 *      ones in full in `ownPending`. `hiddenBuiltins`: keys of the built-in
 *      stickers the owner threw away (POST /api/builtins).
 * POST /api/stickers  multipart/form-data: image (≤ 300 KB, PNG/WebP/GIF/JPEG,
 *      ≤ 512×512), x, y, rotation, scale, name?, turnstile.
 *      → {id, status, token}: `token` lets the uploader move the sticker
 *      later (PATCH /api/stickers/:id); only its salted hash is stored.
 *      With a GitHub session: no Turnstile, the login is the signature, the
 *      sticker belongs to the account; rate-limited per account and per IP.
 */
import type { APIRoute } from "astro";
import {
  listApprovedStickers,
  listOwnStickers,
  recentCounts,
  recentCountsByUser,
  statusesByIds,
  visitorLimits,
} from "@/lib/server/db";
import { hashEditToken, newEditToken } from "@/lib/server/edit-token";
import {
  database,
  ipSalt,
  moderator,
  stickerBucket,
  turnstileSecret,
  viewerOf,
} from "@/lib/server/env";
import { listHiddenBuiltins } from "@/lib/server/hidden-builtins";
import {
  clientIp,
  crossOrigin,
  fail,
  hashIp,
  isSameOrigin,
  JSON_BODY_LIMIT,
  json,
  KIB,
  parseForm,
  readBodyBytes,
  STATUS,
} from "@/lib/server/http";
import { checkStickerImage } from "@/lib/server/image-header";
import { moderate } from "@/lib/server/moderation";
import {
  DAY,
  HOUR,
  limitReachedMessage,
  limitWindow,
  rateLimitMessage,
} from "@/lib/server/rate-limit";
import type { Viewer } from "@/lib/server/session";
import { roundPlacement } from "@/lib/server/sticker-limits";
import { storeSticker } from "@/lib/server/sticker-store";
import { verifyTurnstile } from "@/lib/server/turnstile";
import type {
  StickerCreatedResponse,
  StickersResponse,
} from "@/lib/server/types";
import {
  type AnyStickerInput,
  firstIssue,
  LIMITS,
  memberStickerInput,
  parseMineIds,
  stickerInput,
} from "@/lib/server/validate";
import { listCacheHeaders, needsTurnstile } from "@/lib/server/visitor";

export const prerender = false;

/** Image limit plus room for the other form fields and multipart framing. */
const MAX_REQUEST_BYTES = LIMITS.stickerBytes + JSON_BODY_LIMIT;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
};

export const GET: APIRoute = async ({ url, request }) => {
  const mineIds = parseMineIds(url.searchParams.get("mine"));
  const db = database();
  const { viewer } = await viewerOf(request);
  const [stickers, mine, own, hiddenBuiltins] = await Promise.all([
    listApprovedStickers(db),
    statusesByIds(db, "stickers", mineIds),
    viewer ? listOwnStickers(db, viewer.userId) : null,
    listHiddenBuiltins(db),
  ]);
  const body: StickersResponse = {
    stickers,
    // The account's stickers report through `mine` like remembered ids.
    mine: { ...mine, ...own?.statuses },
    owned: own?.ids ?? [],
    ownPending: own?.pending ?? [],
    hiddenBuiltins,
  };
  // Only the plain anonymous list is cached at the edge; anything that
  // depends on who asks (mine=, me=1, a GitHub session) is private.
  const headers = listCacheHeaders(
    {
      mine: mineIds.length > 0,
      me: url.searchParams.has("me"),
      session: viewer !== null,
    },
    "public, max-age=60, s-maxage=300"
  );
  return json(body, { headers });
};

const TOO_LARGE = `图片太大了，最大 ${Math.round(LIMITS.stickerBytes / KIB)} KB。`;

/**
 * Reads and checks the upload: size (counted while reading, so a chunked
 * upload cannot skip the limit), form fields and the image header.
 */
const readUpload = async (request: Request, member: boolean) => {
  const raw = await readBodyBytes(request, MAX_REQUEST_BYTES).catch(
    () => "unreadable" as const
  );
  if (raw === null) {
    return { ok: false as const, response: fail(STATUS.tooLarge, TOO_LARGE) };
  }
  const form =
    raw === "unreadable"
      ? null
      : await parseForm(raw, request.headers.get("content-type") ?? "");
  if (!form) {
    return {
      ok: false as const,
      response: fail(STATUS.badRequest, "提交的内容格式不对。"),
    };
  }
  const fields = {
    x: form.get("x"),
    y: form.get("y"),
    rotation: form.get("rotation"),
    scale: form.get("scale"),
    name: form.get("name") ?? undefined,
    turnstile: form.get("turnstile"),
  };
  // Logged in: no Turnstile, and the login is the signature.
  const parsed = member
    ? memberStickerInput.safeParse(fields)
    : stickerInput.safeParse(fields);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: fail(STATUS.badRequest, firstIssue(parsed.error)),
    };
  }
  const file = form.get("image");
  if (!(file instanceof File)) {
    return {
      ok: false as const,
      response: fail(STATUS.badRequest, "没有收到图片。"),
    };
  }
  const input: AnyStickerInput = parsed.data;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = checkStickerImage(bytes, {
    maxBytes: LIMITS.stickerBytes,
    maxSide: LIMITS.stickerSide,
  });
  if (!image.ok) {
    return {
      ok: false as const,
      response: fail(STATUS.badRequest, image.message),
    };
  }
  return { ok: true as const, input, bytes, header: image.header };
};

/**
 * Per IP always; per account too when logged in. An early, cheap check
 * before Turnstile; storeSticker checks the same limits again in the D1
 * write, which is what holds when requests arrive in parallel.
 */
const rateLimited = async (
  db: D1Database,
  {
    ipHash,
    viewer,
    now,
  }: { ipHash: string; viewer: Viewer | null; now: number }
) => {
  const window = { table: "stickers" as const, now, hour: HOUR, day: DAY };
  const [byIp, byUser] = await Promise.all([
    recentCounts(db, { ...window, ipHash }),
    viewer
      ? recentCountsByUser(db, { ...window, userId: viewer.userId })
      : ([0, 0] as const),
  ]);
  return (
    rateLimitMessage("sticker", byIp[0], byIp[1]) ??
    rateLimitMessage("sticker", byUser[0], byUser[1])
  );
};

/** Turnstile for anonymous visitors; a GitHub session stands in for it. */
const humanCheck = async (
  viewer: Viewer | null,
  {
    token,
    ip,
    hostname,
  }: { token: string | undefined; ip: string; hostname: string }
) => {
  if (!needsTurnstile(viewer !== null)) {
    return null;
  }
  const human = await verifyTurnstile({
    secret: turnstileSecret(),
    token: token ?? "",
    remoteip: ip === "unknown" ? undefined : ip,
    action: "sticker",
    hostname,
  });
  return human.ok ? null : fail(human.status, human.message);
};

export const POST: APIRoute = async ({ request, url }) => {
  if (!isSameOrigin(request)) {
    return crossOrigin();
  }
  const { viewer } = await viewerOf(request);
  const upload = await readUpload(request, Boolean(viewer));
  if (!upload.ok) {
    return upload.response;
  }
  const { input, bytes } = upload;
  const db = database();
  const now = Date.now();
  const ip = clientIp(request);
  const ipHash = await hashIp(ip, ipSalt());

  const limited = await rateLimited(db, { ipHash, viewer, now });
  if (limited) {
    return fail(STATUS.tooManyRequests, limited);
  }

  const refused = await humanCheck(viewer, {
    token: input.turnstile,
    ip,
    hostname: url.hostname,
  });
  if (refused) {
    return refused;
  }
  const name = viewer ? viewer.user.login : input.name;

  const id = crypto.randomUUID();
  const { mime, width, height } = upload.header;
  const r2Key = `stickers/${id}.${EXTENSIONS[mime] ?? "bin"}`;
  const result = await moderate(moderator(), {
    type: "sticker",
    id,
    name,
    mime,
    width,
    height,
  });

  // A sticker the moderator rejects is only logged; its image is not kept
  // (nothing else would ever delete it from R2; see storeSticker).
  const keepImage = result.status !== "rejected";
  // The uploader may move their sticker later (PATCH /api/stickers/:id):
  // the token goes back once in this response, only its hash is stored.
  const token = keepImage ? newEditToken() : undefined;
  const editTokenHash = token ? await hashEditToken(token, ipSalt()) : null;
  const placement = roundPlacement(input);
  const stored = await storeSticker(db, stickerBucket(), {
    bytes,
    row: {
      id,
      r2Key,
      mime,
      bytes: bytes.length,
      width,
      height,
      ...placement,
      editTokenHash,
      name: name ?? null,
      status: result.status,
      createdAt: now,
      ipHash,
      userId: viewer?.userId ?? null,
    },
    log: {
      itemType: "sticker",
      itemId: id,
      decision: result.decision,
      actor: result.actor,
      note: result.note,
      createdAt: now,
    },
    limits: visitorLimits(limitWindow("sticker", now), {
      ipHash,
      userId: viewer?.userId ?? null,
    }),
  });
  if (!stored) {
    return fail(STATUS.tooManyRequests, limitReachedMessage("sticker"));
  }

  const body: StickerCreatedResponse = { id, status: result.status, token };
  return json(body, { status: STATUS.created });
};
