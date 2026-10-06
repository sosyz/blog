/**
 * Post queries shared by every page (canvas, list, notes, RSS, llms.txt).
 *
 * All functions are build-time only (they call `getCollection`). Results are
 * memoised per build, so calling them from many pages is cheap.
 */
import { type CollectionEntry, getCollection } from "astro:content";

export type Post = CollectionEntry<"blog">;
export type PostType = Post["data"]["type"];
export type PostStatus = NonNullable<Post["data"]["status"]>;

export interface Topic {
  /** Latest `updatedDate ?? pubDate` in the topic. */
  latest: Date;
  name: string;
  /** Posts in this topic, most recently updated first. */
  posts: Post[];
}

/** Dates are written and shown in China time, whatever the build machine's zone. */
const TIME_ZONE = "Asia/Shanghai";
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;
/** Journal numbers are shown with three digits: No. 007. */
const NOTE_NUMBER_DIGITS = 3;
const YEAR_LENGTH = 4;

const dateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TIME_ZONE,
    year: "numeric",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return { day: get("day"), month: get("month"), year: get("year") };
};

/** 2025-10-08 */
export const isoDate = (date: Date) => {
  const { year, month, day } = dateParts(date);
  return `${year}-${month}-${day}`;
};

/** 2025.10.08, as on the blue date stamp. */
export const dotDate = (date: Date) => isoDate(date).replaceAll("-", ".");

/** 周三 */
export const weekdayZh = (date: Date) => {
  const index = new Date(`${isoDate(date)}T00:00:00Z`).getUTCDay();
  return `周${WEEKDAYS[index] ?? ""}`;
};

/** Last time a post changed: `updatedDate`, else `pubDate`. */
export const lastUpdated = (post: Post) =>
  post.data.updatedDate ?? post.data.pubDate;

const byNewest = (a: Post, b: Post) =>
  b.data.pubDate.valueOf() - a.data.pubDate.valueOf() ||
  a.id.localeCompare(b.id);

const byRecentlyUpdated = (a: Post, b: Post) =>
  lastUpdated(b).valueOf() - lastUpdated(a).valueOf() || byNewest(a, b);

interface Index {
  bySlug: Map<string, Post>;
  /** Journal number: 1 = oldest post, by pubDate. */
  numbers: Map<string, number>;
  /** Newest first by pubDate. */
  posts: Post[];
  /** Bidirectional `related`, in declaration order then back-links. */
  related: Map<string, string[]>;
  /** Topics, most recently updated topic first. */
  topics: Topic[];
}

let indexPromise: Promise<Index> | undefined;

const buildIndex = async (): Promise<Index> => {
  const posts = (await getCollection("blog")).sort(byNewest);
  const bySlug = new Map(posts.map((post) => [post.id, post]));

  const numbers = new Map<string, number>();
  for (const [i, post] of [...posts].reverse().entries()) {
    numbers.set(post.id, i + 1);
  }

  const grouped = new Map<string, Post[]>();
  for (const post of posts) {
    const list = grouped.get(post.data.topic) ?? [];
    list.push(post);
    grouped.set(post.data.topic, list);
  }
  const topics: Topic[] = [...grouped].map(([name, list]) => {
    const sorted = [...list].sort(byRecentlyUpdated);
    const first = sorted.at(0);
    return {
      latest: first ? lastUpdated(first) : new Date(0),
      name,
      posts: sorted,
    };
  });
  topics.sort(
    (a, b) =>
      b.latest.valueOf() - a.latest.valueOf() || a.name.localeCompare(b.name)
  );

  const related = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const list = related.get(from) ?? [];
    if (from !== to && !list.includes(to)) {
      list.push(to);
    }
    related.set(from, list);
  };
  for (const post of posts) {
    for (const ref of post.data.related) {
      if (!bySlug.has(ref.id)) {
        throw new Error(
          `${post.id}: related entry "${ref.id}" does not match any post in src/posts`
        );
      }
      link(post.id, ref.id);
    }
  }
  for (const post of posts) {
    for (const ref of post.data.related) {
      link(ref.id, post.id);
    }
  }

  return { bySlug, numbers, posts, related, topics };
};

const getIndex = () => {
  indexPromise ??= buildIndex();
  return indexPromise;
};

/** All posts, newest first by pubDate. */
export const getPosts = async () => (await getIndex()).posts;

/** One post by slug (the collection id, e.g. `go-context`). */
export const getPost = async (slug: string) =>
  (await getIndex()).bySlug.get(slug);

/** Topics (piles on the canvas), most recently updated first. */
export const getTopics = async () => (await getIndex()).topics;

/** Journal number, 1 = oldest post. */
export const getNoteNumber = async (slug: string) =>
  (await getIndex()).numbers.get(slug) ?? 0;

/** "007" */
export const formatNoteNumber = (no: number) =>
  String(no).padStart(NOTE_NUMBER_DIGITS, "0");

/** Related posts in both directions (A lists B → B also shows A). */
export const getRelated = async (slug: string) => {
  const index = await getIndex();
  return (index.related.get(slug) ?? []).flatMap((id) => {
    const post = index.bySlug.get(id);
    return post ? [post] : [];
  });
};

/** Other posts in the same topic, in pile order (most recently updated first). */
export const getSameTopic = async (slug: string) => {
  const index = await getIndex();
  const post = index.bySlug.get(slug);
  const topic = index.topics.find((t) => t.name === post?.data.topic);
  return topic ? topic.posts.filter((p) => p.id !== slug) : [];
};

/**
 * Neighbours inside the same topic for the drawer's 上一篇 / 下一篇,
 * following pile order: `previous` is the one above (more recent),
 * `next` the one below (older).
 */
export const getTopicNeighbours = async (slug: string) => {
  const index = await getIndex();
  const post = index.bySlug.get(slug);
  const list =
    index.topics.find((t) => t.name === post?.data.topic)?.posts ?? [];
  const i = list.findIndex((p) => p.id === slug);
  return {
    next: i >= 0 ? list[i + 1] : undefined,
    previous: i > 0 ? list[i - 1] : undefined,
  };
};

/** Posts grouped by year (newest year first), for the list page. */
export const getPostsByYear = async () => {
  const groups = new Map<string, Post[]>();
  for (const post of await getPosts()) {
    const year = isoDate(post.data.pubDate).slice(0, YEAR_LENGTH);
    const list = groups.get(year) ?? [];
    list.push(post);
    groups.set(year, list);
  }
  return [...groups].map(([year, posts]) => ({ posts, year }));
};

/** Canonical path of a post page. */
export const notePath = (slug: string) => `/notes/${slug}/`;

/**
 * Plain, JSON-safe summary of a post for client scripts (canvas layout,
 * search). Keep it small: it is inlined into every canvas page.
 */
export interface NoteSummary {
  /** yyyy-mm-dd */
  date: string;
  description: string;
  href: string;
  no: number;
  related: string[];
  slug: string;
  status?: PostStatus;
  tags: string[];
  title: string;
  topic: string;
  type: PostType;
  /** yyyy-mm-dd, updatedDate ?? pubDate */
  updated: string;
}

export const getNoteSummaries = async (): Promise<NoteSummary[]> => {
  const index = await getIndex();
  return index.posts.map((post) => ({
    date: isoDate(post.data.pubDate),
    description: post.data.description,
    href: notePath(post.id),
    no: index.numbers.get(post.id) ?? 0,
    related: index.related.get(post.id) ?? [],
    slug: post.id,
    status: post.data.status,
    tags: post.data.tags,
    title: post.data.title,
    topic: post.data.topic,
    type: post.data.type,
    updated: isoDate(lastUpdated(post)),
  }));
};
