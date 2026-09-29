import type { AstroUserConfig } from "astro";

type ShikiConfig = NonNullable<
  NonNullable<AstroUserConfig["markdown"]>["shikiConfig"]
>;
type ShikiTheme = Exclude<NonNullable<ShikiConfig["theme"]>, string>;

/*
 * Code is written with three stationery inks only (docs/design.md):
 * blue-black for keywords, ochre for strings and numbers, grey for comments.
 * Everything else is body ink. The background is transparent because the
 * slip's paper shows through (Astro copies the theme background into the
 * <pre>'s inline style, so CSS could not override it).
 */
const INK = "#2d2822";
const KEYWORD = "#3d5f8f";
const STRING = "#9a4d2c";
const COMMENT = "#736b59";

export const inkTheme: ShikiTheme = {
  name: "journal-ink",
  type: "light",
  colors: {
    "editor.background": "#00000000",
    "editor.foreground": INK,
  },
  fg: INK,
  bg: "#00000000",
  settings: [
    { settings: { foreground: INK, background: "#00000000" } },
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
        "entity.name.tag",
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
};
