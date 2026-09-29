/**
 * Comment data for one note, shared by the comment list (comments.ts) and
 * the inline comments (inline.ts): one request per note, plus the visitor's
 * own pending items kept in localStorage so they can see 审核中.
 *
 * Pending items are reconciled on every load: the API reports the status of
 * the ids we pass as `mine`; approved ones now come from the server, rejected
 * or unknown ones are dropped. Entries also expire after 30 days.
 *
 * Logged in with GitHub, the server also sends that account's pending
 * comments (`ownPending`), so they show as 审核中 on every device.
 *
 * The owner's in-page review (review-comments.ts) changes the lists in place
 * with patchThread() after a decision, and asks with `me=1` so the browser
 * never reuses a cached list from before the decision.
 */
import type {
  Anchor,
  CommentKind,
  CommentsResponse,
  CreatedResponse,
  PublicComment,
  PublicUser,
} from "@/lib/server/types";
import { getAuth } from "./auth";
import { hasOwnerFlag, reviewTarget } from "./owner";
import { readStore, requestJson, writeStore } from "./util";

export type PendingComment = {
  id: string;
  kind: CommentKind;
  name: string;
  site: string | null;
  body: string;
  anchor: Anchor | null;
  parentId: string | null;
  createdAt: number;
  /** Written while logged in with GitHub. */
  user?: PublicUser | null;
  /** Written by the blog owner (博主 stamp). */
  isOwner?: boolean;
};

export type Thread = {
  slug: string;
  approved: PublicComment[];
  pending: PendingComment[];
  loaded: boolean;
  error: string | null;
};

const KEY = "interact:pending-comments";
/** 30 days. */
const MAX_AGE = 2_592_000_000;
const MAX_PER_NOTE = 20;
/** Re-fetch when coming back to a note after this long. */
const STALE_AFTER = 60_000;

type PendingStore = Record<string, PendingComment[]>;

const readPending = (slug: string) => {
  const all = readStore<PendingStore>(KEY, {});
  const now = Date.now();
  return (all[slug] ?? []).filter((item) => now - item.createdAt < MAX_AGE);
};

const writePending = (slug: string, items: PendingComment[]) => {
  const all = readStore<PendingStore>(KEY, {});
  const next: PendingStore = {};
  for (const [key, value] of Object.entries(all)) {
    if (key !== slug && value.length > 0) {
      next[key] = value;
    }
  }
  if (items.length > 0) {
    next[slug] = items.slice(-MAX_PER_NOTE);
  }
  writeStore(KEY, next);
};

const threads = new Map<string, Thread>();
const loadedAt = new Map<string, number>();
const inflight = new Map<string, Promise<Thread>>();
type Listener = (thread: Thread) => void;
const listeners = new Map<string, Set<Listener>>();

const emptyThread = (slug: string): Thread => ({
  slug,
  approved: [],
  pending: readPending(slug),
  loaded: false,
  error: null,
});

const threadOf = (slug: string) => threads.get(slug) ?? emptyThread(slug);

const publish = (thread: Thread) => {
  threads.set(thread.slug, thread);
  for (const listener of listeners.get(thread.slug) ?? []) {
    listener(thread);
  }
};

/** What is known right now about a note (no request). */
export const threadNow = (slug: string) => threadOf(slug);

/** Changes the known thread in place (owner decisions) and notifies. */
export const patchThread = (slug: string, change: (thread: Thread) => Thread) =>
  publish(change(threadOf(slug)));

/** Calls `listener` now (with what is known) and on every change. */
export const subscribe = (slug: string, listener: Listener) => {
  let set = listeners.get(slug);
  if (!set) {
    set = new Set();
    listeners.set(slug, set);
  }
  set.add(listener);
  listener(threadOf(slug));
  return () => set.delete(listener);
};

const toPending = (item: PublicComment): PendingComment => ({
  id: item.id,
  kind: item.kind,
  name: item.name,
  site: item.site,
  body: item.body,
  anchor: item.anchor,
  parentId: item.parentId,
  createdAt: item.createdAt,
  user: item.user,
  isOwner: item.isOwner,
});

const fetchThread = async (slug: string): Promise<Thread> => {
  const pending = readPending(slug);
  const params = new URLSearchParams({ slug });
  if (pending.length > 0) {
    params.set("mine", pending.map((item) => item.id).join(","));
  }
  // Logged in, or the owner reviewing: a private URL, so a cached anonymous
  // copy (max-age=30) is never reused.
  if (hasOwnerFlag() || reviewTarget() || (await getAuth()).user) {
    params.set("me", "1");
  }
  const result = await requestJson<CommentsResponse>(`/api/comments?${params}`);
  if (!result.ok) {
    return { ...threadOf(slug), pending, loaded: true, error: result.message };
  }
  const stillPending = pending.filter(
    (item) => result.data.mine[item.id] === "pending"
  );
  writePending(slug, stillPending);
  const local = new Set(stillPending.map((item) => item.id));
  const fromAccount = (result.data.ownPending ?? [])
    .filter((item) => !local.has(item.id))
    .map(toPending);
  return {
    slug,
    approved: result.data.comments,
    pending: [...stillPending, ...fromAccount].sort(
      (a, b) => a.createdAt - b.createdAt
    ),
    loaded: true,
    error: null,
  };
};

/** Loads (or re-uses) the comments of a note and notifies subscribers. */
export const loadThread = (slug: string, force = false) => {
  const fresh = Date.now() - (loadedAt.get(slug) ?? 0) < STALE_AFTER;
  const known = threads.get(slug);
  if (!force && fresh && known?.loaded) {
    return Promise.resolve(known);
  }
  let request = inflight.get(slug);
  if (!request) {
    request = fetchThread(slug).then((thread) => {
      inflight.delete(slug);
      loadedAt.set(slug, Date.now());
      publish(thread);
      return thread;
    });
    inflight.set(slug, request);
  }
  return request;
};

export type NewComment = {
  slug: string;
  kind: CommentKind;
  /** Left out when logged in (the account is the author). */
  name?: string;
  email?: string;
  site?: string;
  body: string;
  parentId?: string;
  anchor?: Anchor;
  /** Left out when logged in (the session stands in for Turnstile). */
  turnstile?: string;
};

/** Logged in: how the new comment shows until it is reviewed. */
type Signed = { user: PublicUser | null; isOwner: boolean };

/** Sends a comment; on success it shows up as 审核中 for this visitor. */
export const submitComment = async (
  input: NewComment,
  { user, isOwner }: Signed = { user: null, isOwner: false }
) => {
  const result = await requestJson<CreatedResponse>("/api/comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!result.ok) {
    return result;
  }
  const { id, status } = result.data;
  if (status === "approved") {
    await loadThread(input.slug, true);
  } else if (status === "pending") {
    const item: PendingComment = {
      id,
      kind: input.kind,
      name: user?.login ?? input.name?.trim() ?? "",
      site: user?.htmlUrl ?? (input.site?.trim() || null),
      user,
      isOwner: user ? isOwner : false,
      body: input.body.trim(),
      anchor: input.anchor ?? null,
      parentId: input.parentId ?? null,
      createdAt: Date.now(),
    };
    const pending = [...readPending(input.slug), item];
    writePending(input.slug, pending);
    publish({ ...threadOf(input.slug), pending });
  }
  return result;
};
