/**
 * Which built-in stickers are hidden, as this browser last saw it
 * (localStorage `interact:hidden-builtins`). A per-viewer convenience: the
 * canvas hides them before GET /api/stickers answers, so a thrown-away
 * sticker does not flash on every page load. The server's `hiddenBuiltins`
 * always replaces `keys`.
 *
 * `recent`: the owner's own hides / restores (the trash on the canvas, 恢复
 * in /admin/) win over the server's list for RECENT_MS, because the
 * anonymous GET /api/stickers may come from the edge cache (up to 5 minutes
 * old) and would otherwise undo them on the next page load.
 *
 * The functions on caches are pure (tests/builtin-hidden.test.ts); only
 * readHiddenCache / writeHiddenCache touch storage.
 */
import { isBuiltinKeyShape } from "@/lib/builtin-stickers";

const STORAGE_KEY = "interact:hidden-builtins";
/** Edge cache (5 min) + browser cache (1 min) of GET /api/stickers. */
export const RECENT_MS = 360_000;
/** At most this many keys kept (the canvas has 16). */
const MAX_KEYS = 200;

export interface RecentChange {
  at: number;
  hidden: boolean;
}

export interface HiddenCache {
  keys: string[];
  recent: Record<string, RecentChange>;
}

export const EMPTY_CACHE: HiddenCache = { keys: [], recent: {} };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isChange = (value: unknown): value is RecentChange =>
  isRecord(value) &&
  typeof value.hidden === "boolean" &&
  typeof value.at === "number" &&
  Number.isFinite(value.at);

/** Only well-formed keys, at most MAX_KEYS, no duplicates. */
export const cleanKeys = (keys: unknown): string[] =>
  Array.isArray(keys)
    ? [
        ...new Set(
          keys.filter(
            (key): key is string =>
              typeof key === "string" && isBuiltinKeyShape(key)
          )
        ),
      ].slice(0, MAX_KEYS)
    : [];

/** Changes younger than RECENT_MS (older ones are left to the server). */
const freshRecent = (
  recent: Record<string, RecentChange>,
  now: number
): Record<string, RecentChange> =>
  Object.fromEntries(
    Object.entries(recent).filter(
      ([key, change]) =>
        isBuiltinKeyShape(key) &&
        now - change.at < RECENT_MS &&
        change.at <= now
    )
  );

/** Whatever was stored → a clean cache. */
export const normaliseCache = (raw: unknown, now: number): HiddenCache => {
  if (!isRecord(raw)) {
    return EMPTY_CACHE;
  }
  const recent = isRecord(raw.recent)
    ? Object.fromEntries(
        Object.entries(raw.recent).filter(([, change]) => isChange(change))
      )
    : {};
  return {
    keys: cleanKeys(raw.keys),
    recent: freshRecent(recent as Record<string, RecentChange>, now),
  };
};

/** The keys to hide now: the server's list with the fresh changes on top. */
export const hiddenKeys = (cache: HiddenCache, now: number) => {
  const hidden = new Set(cache.keys);
  for (const [key, change] of Object.entries(freshRecent(cache.recent, now))) {
    if (change.hidden) {
      hidden.add(key);
    } else {
      hidden.delete(key);
    }
  }
  return hidden;
};

/** The server answered: its list replaces ours; stale changes go. */
export const withServerKeys = (
  cache: HiddenCache,
  keys: unknown,
  now: number
): HiddenCache => ({
  keys: cleanKeys(keys),
  recent: freshRecent(cache.recent, now),
});

/** The owner hid or restored one (and the server took it). */
export const withChange = (
  cache: HiddenCache,
  key: string,
  hidden: boolean,
  now: number
): HiddenCache => {
  if (!isBuiltinKeyShape(key)) {
    return cache;
  }
  const keys = cache.keys.filter((entry) => entry !== key);
  return {
    keys: hidden ? [...keys, key] : keys,
    recent: {
      ...freshRecent(cache.recent, now),
      [key]: { at: now, hidden },
    },
  };
};

export const readHiddenCache = (): HiddenCache => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normaliseCache(JSON.parse(raw), Date.now()) : EMPTY_CACHE;
  } catch {
    return EMPTY_CACHE;
  }
};

export const writeHiddenCache = (cache: HiddenCache) => {
  try {
    if (cache.keys.length === 0 && Object.keys(cache.recent).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    }
  } catch {
    // Storage blocked: the canvas waits for the server's list instead.
  }
};

/** Remembers the owner's change (the canvas, or 恢复 in /admin/). */
export const noteBuiltinChange = (key: string, hidden: boolean) => {
  const cache = withChange(readHiddenCache(), key, hidden, Date.now());
  writeHiddenCache(cache);
  return cache;
};
