/**
 * Small helpers shared by the interaction scripts (comments, inline
 * comments, stickers).
 */
import { prefersReducedMotion } from "@/scripts/canvas/api";
import { seeded } from "@/scripts/canvas/seed";

const ESCAPES: Record<string, string> = {
  "'": "&#39;",
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
const ESCAPE = /[&<>"']/g;

/** Escapes text for HTML text and attribute values. */
export const esc = (value: string) =>
  value.replace(ESCAPE, (char) => ESCAPES[char] ?? char);

export const pick = <T>(items: readonly T[], key: string): T | undefined =>
  items[Math.floor(seeded(key) * items.length)];

/** Ink colors for commenters' initials (see Comments.astro for the values). */
export const INKS = [
  "var(--link)",
  "var(--str)",
  "var(--ink-moss)",
  "var(--ink-plum)",
  "var(--pencil)",
] as const;

export const TAPES = [
  "washi-stripes-pink",
  "washi-plain-sage",
  "washi-dots-mustard",
  "masking-cream",
  "washi-grid-ivory",
] as const;

export const tapeSrc = (name: string) => `/journal/tape/${name}.webp`;

/** Made on first use: building it costs every page load a few ms of ICU. */
let dateFormat: Intl.DateTimeFormat | null = null;

/** 2025.10.08 in China time, as on the blue date stamp. */
export const dotDate = (ms: number) => {
  dateFormat ??= new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  });
  return dateFormat.format(new Date(ms)).replaceAll("-", ".");
};

/** The first character of a name, for the circled initial. */
export const initial = (name: string) => [...name.trim()].at(0) ?? "?";

export const reduceMotion = () => prefersReducedMotion();

export const scrollBehavior = (): ScrollBehavior =>
  reduceMotion() ? "auto" : "smooth";

/* ---------- browser storage (per-viewer conveniences only) ---------- */

export const readStore = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const writeStore = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

/** Name / e-mail / site remembered between forms. */
export interface Profile {
  email?: string;
  name?: string;
  site?: string;
}

const PROFILE_KEY = "interact:profile";

export const readProfile = () => readStore<Profile>(PROFILE_KEY, {});

export const saveProfile = (profile: Profile) =>
  writeStore(PROFILE_KEY, profile);

/** JSON POST/GET helper: returns data or a visitor-facing error message. */
export const requestJson = async <T>(
  input: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; message: string }> => {
  try {
    const response = await fetch(input, init);
    const data = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null;
    if (!response.ok) {
      return {
        message:
          data?.error ?? `服务器出了点问题（${response.status}），稍后再试。`,
        ok: false,
      };
    }
    if (data === null) {
      return { message: "服务器返回的内容看不懂，稍后再试。", ok: false };
    }
    return { data, ok: true };
  } catch {
    return { message: "网络好像断了，检查一下再试。", ok: false };
  }
};
