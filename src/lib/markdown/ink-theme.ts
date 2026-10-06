import type { AstroUserConfig } from "astro";

type ShikiConfig = NonNullable<
  NonNullable<AstroUserConfig["markdown"]>["shikiConfig"]
>;
type ShikiTheme = Exclude<NonNullable<ShikiConfig["theme"]>, string>;

/*
 * Code is written with a few stationery inks (docs/design.md), the same
 * values as the --kw / --str / --com / --fn / --punct tokens in
 * src/styles/tokens.css:
 * blue-black for keywords, ochre for strings and numbers, grey for comments,
 * vermilion for functions, types and tags, and pencil for punctuation and
 * operators so they recede. Everything else is body ink. Contrast on the
 * slip paper (#fdfaf2): 4.5:1 or more for every ink.
 * The background is transparent because the slip's paper shows through
 * (Astro copies the theme background into the <pre>'s inline style, so CSS
 * could not override it).
 *
 * TextMate picks the deepest matching scope, so the specific scopes kept in
 * the keyword, string, comment and plain-ink rules (support.type.primitive,
 * punctuation.definition.string, keyword.operator.new, …) win over the broad
 * support.type / punctuation / keyword.operator rules below.
 */
const INK = "#2d2822";
const KEYWORD = "#3d5f8f";
const STRING = "#9a4d2c";
const COMMENT = "#736b59";
const FUNCTION = "#9e3129";
const PUNCTUATION = "#524a3e";

export const inkTheme: ShikiTheme = {
  bg: "#00000000",
  colors: {
    "editor.background": "#00000000",
    "editor.foreground": INK,
  },
  fg: INK,
  name: "journal-ink",
  settings: [
    { settings: { background: "#00000000", foreground: INK } },
    {
      // Recede: brackets, commas, dots and operators.
      scope: ["punctuation", "keyword.operator", "meta.brace"],
      settings: { foreground: PUNCTUATION },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call.generic",
        "entity.name.type",
        "entity.name.class",
        "entity.name.namespace",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
        "entity.name.tag",
      ],
      settings: { foreground: FUNCTION },
    },
    {
      scope: [
        "comment",
        "punctuation.definition.comment",
        "string.comment",
        "comment.line.number-sign",
      ],
      settings: { foreground: COMMENT },
    },
    {
      scope: [
        "keyword",
        "keyword.control",
        "keyword.operator.new",
        "keyword.operator.expression",
        "keyword.other",
        "storage",
        "storage.type",
        "storage.modifier",
        "constant.language",
        "variable.language",
        "support.type.primitive",
        "support.type.builtin",
        "support.function.builtin",
        "keyword.operator.word",
        "keyword.operator.sizeof",
        "keyword.operator.delete",
        "keyword.operator.cast",
        "keyword.operator.wordlike",
        "meta.preprocessor",
        "punctuation.definition.directive",
        "keyword.control.directive",
        "entity.name.function.preprocessor",
      ],
      settings: { foreground: KEYWORD },
    },
    {
      scope: [
        "string",
        "string.quoted",
        "string.template",
        "string.unquoted.heredoc",
        "punctuation.definition.string",
        "constant.numeric",
        "constant.character",
        "constant.other.color",
        "entity.other.attribute-name",
        "support.type.property-name",
        "string.regexp",
        "markup.inline.raw",
      ],
      settings: { foreground: STRING },
    },
    {
      // Back to plain ink: template interpolations, and shell arguments
      // (`bun add ai`), which the grammar scopes as unquoted strings.
      scope: [
        "string.unquoted.argument",
        "meta.template.expression",
        "punctuation.definition.template-expression",
      ],
      settings: { foreground: INK },
    },
  ],
  type: "light",
};
