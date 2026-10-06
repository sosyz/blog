/** Window events between the interaction scripts. */

/** Comment list → inline comments: scroll to a highlight and open its note. */
export const JUMP_EVENT = "interact:jump";
export interface JumpDetail {
  exact: string;
  slug: string;
}

/** Sticker upload → sticker layer: the visitor's pending stickers changed. */
export const STICKERS_CHANGED = "interact:stickers-changed";

/** Sticker layer → sticker editing: the layer's stickers were (re)built. */
export const STICKERS_RENDERED = "interact:stickers-rendered";
