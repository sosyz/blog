/**
 * Finding an inline comment's highlighted text again (design.md: store the
 * text and ~12 characters before it, so small edits to the article do not
 * lose the position).
 *
 * Pure string logic over the text nodes of one block, so it is unit-tested
 * (tests/anchor.test.ts). The DOM side lives in inline.ts.
 *
 * Whitespace is compared collapsed ("a \n  b" equals "a b"), because a
 * selection's toString() and the block's text nodes rarely agree on it.
 * Offsets are UTF-16 code units, like DOM Text offsets.
 */

const WHITESPACE = /\s/;
const WHITESPACE_RUN = /\s+/g;

/** How many characters before the selection are stored. */
export const PREFIX_LENGTH = 12;
/** Shorter prefix tried when the full one no longer matches. */
const SHORT_PREFIX = 6;

export const collapseSpace = (value: string) =>
  value.replace(WHITESPACE_RUN, " ");

/** The stored prefix for the text before a selection. */
export const prefixOf = (before: string) =>
  collapseSpace(before).slice(-PREFIX_LENGTH);

/** A part of one text node: `texts[index].slice(start, end)`. */
export interface TextPart {
  end: number;
  index: number;
  start: number;
}

interface Index {
  /** For every character of `text`: which text node and offset it came from. */
  node: number[];
  offset: number[];
  /** Concatenated text with whitespace runs collapsed to one space. */
  text: string;
}

const buildIndex = (texts: readonly string[]): Index => {
  let text = "";
  const node: number[] = [];
  const offset: number[] = [];
  let lastWasSpace = false;
  for (const [index, value] of texts.entries()) {
    for (let i = 0; i < value.length; i += 1) {
      const char = value.charAt(i);
      const space = WHITESPACE.test(char);
      if (!(space && lastWasSpace)) {
        text += space ? " " : char;
        node.push(index);
        offset.push(i);
      }
      lastWasSpace = space;
    }
  }
  return { node, offset, text };
};

const toParts = (index: Index, start: number, length: number) => {
  const parts: TextPart[] = [];
  for (let i = start; i < start + length; i += 1) {
    const nodeIndex = index.node[i] ?? 0;
    const at = index.offset[i] ?? 0;
    const last = parts.at(-1);
    if (last && last.index === nodeIndex) {
      last.end = at + 1;
    } else {
      parts.push({ end: at + 1, index: nodeIndex, start: at });
    }
  }
  return parts;
};

/**
 * Where `exact` (preceded by `prefix`, if it still matches) sits in these
 * text nodes. Tries the full prefix, then its last few characters, then the
 * first occurrence of `exact` alone. Returns null when the text is gone.
 */
export const locateAnchor = (
  texts: readonly string[],
  exact: string,
  prefix: string
): TextPart[] | null => {
  const target = collapseSpace(exact).trim();
  if (!target) {
    return null;
  }
  const index = buildIndex(texts);
  const before = collapseSpace(prefix);
  const candidates = [...new Set([before, before.slice(-SHORT_PREFIX), ""])];
  for (const candidate of candidates) {
    const at = index.text.indexOf(candidate + target);
    if (at >= 0) {
      return toParts(index, at + candidate.length, target.length);
    }
  }
  return null;
};
