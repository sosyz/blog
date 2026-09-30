/**
 * The built-in stickers on the canvas (the dog, the topic stickers, the outer
 * ring) and their keys. Canvas.astro writes the keys as `data-sticker-key`;
 * the owner can throw a built-in into the trash for every visitor
 * (hidden_builtins, POST /api/builtins) and bring it back from /admin/, which
 * shows the thumbnails from `builtinStickers()`. Pure data, shared by the
 * pages, the API and the client scripts.
 *
 * Keys:
 *   dog:<file>              the owner's avatar next to the intro card
 *   pile:<topic>:<file>     a sticker next to a topic pile
 *   outer:<file>            the outer ring of places and people
 */
import {
  DOG_STICKER,
  OUTER_STICKERS,
  stickerSrc,
  TOPIC_STICKERS,
} from "../scripts/canvas/seed";

export type BuiltinSticker = {
  key: string;
  /** /stickers/<file>.webp */
  src: string;
  /** What it shows, in Chinese (aria-label, /admin/ alt text). */
  label: string;
  /** Where it is on the canvas, e.g. 「Go」旁边. */
  place: string;
};

/** Longest key the API accepts. */
export const BUILTIN_KEY_MAX = 100;

/**
 * dog:/outer: a sticker file name; pile: a topic name (no colon, no control
 * characters, at most 24 characters) and a file name.
 */
export const BUILTIN_KEY =
  /^(?:(?:dog|outer):[a-z][a-z0-9-]{0,39}|pile:[^:\p{C}]{1,24}:[a-z][a-z0-9-]{0,39})$/u;

export const dogKey = (file: string) => `dog:${file}`;
export const pileKey = (topic: string, file: string) => `pile:${topic}:${file}`;
export const outerKey = (file: string) => `outer:${file}`;

/** What each sticker file shows. */
const LABELS: Readonly<Record<string, string>> = {
  "obj-bug": "小虫子",
  "obj-cloud": "云朵",
  "obj-coffee": "咖啡杯",
  "obj-idea": "灯泡",
  "obj-laptop": "笔记本电脑",
  "obj-tools": "工具",
  "people-coder": "写代码的人",
  "people-coffee": "喝咖啡的人",
  "people-dog": "看萤火虫的小黑猫",
  "people-traveler": "旅行的人",
  "place-bridge": "桥",
  "place-lighthouse": "灯塔",
  "place-mountain": "山",
  "place-shop": "小店",
  "place-tower": "塔",
  "place-tram": "电车",
};

export const stickerLabel = (file: string) => LABELS[file] ?? "贴纸";

/** Every built-in sticker the canvas can show, in canvas order. */
export const builtinStickers = (): BuiltinSticker[] => [
  {
    key: dogKey(DOG_STICKER),
    src: stickerSrc(DOG_STICKER),
    label: stickerLabel(DOG_STICKER),
    place: "自我介绍旁边",
  },
  ...Object.entries(TOPIC_STICKERS).flatMap(([topic, files]) =>
    files.map((file) => ({
      key: pileKey(topic, file),
      src: stickerSrc(file),
      label: stickerLabel(file),
      place: `「${topic}」旁边`,
    }))
  ),
  ...OUTER_STICKERS.map((file) => ({
    key: outerKey(file),
    src: stickerSrc(file),
    label: stickerLabel(file),
    place: "画布外圈",
  })),
];

/** key → sticker, for /admin/ and the API. */
export const builtinByKey = (): Map<string, BuiltinSticker> =>
  new Map(builtinStickers().map((sticker) => [sticker.key, sticker]));

/** Shape check (the API validates with it; unknown keys pass). */
export const isBuiltinKeyShape = (key: string) =>
  key.length <= BUILTIN_KEY_MAX && BUILTIN_KEY.test(key);
