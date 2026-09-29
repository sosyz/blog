import { satteri } from "@astrojs/markdown-satteri";
import type { AstroUserConfig } from "astro";
import { inkTheme } from "./ink-theme.ts";
import {
  asideStickies,
  codeSlips,
  dropTitleHeading,
  highlightMarks,
  pictureParagraphs,
  responsivePictures,
} from "./plugins.ts";

type MarkdownConfig = NonNullable<AstroUserConfig["markdown"]>;
type ShikiTransformer = Entry<
  NonNullable<NonNullable<MarkdownConfig["shikiConfig"]>["transformers"]>
>;
type Entry<T> = T extends readonly (infer E)[] ? E : never;

// ```ts title="gateway.ts"  or  ```ts file=gateway.ts
const TITLE_META = /(?:title|file)=(?:"([^"]+)"|'([^']+)'|(\S+))/;

/**
 * Astro only hands the fence meta to Shiki, so read the file name here and
 * leave it on the <pre> for the code-slip plugin's kraft label.
 */
const fenceTitle: ShikiTransformer = {
  name: "journal-fence-title",
  pre(node) {
    const raw = (this.options.meta as { __raw?: string } | undefined)?.__raw;
    const match = raw ? TITLE_META.exec(raw) : null;
    const title = match?.[1] ?? match?.[2] ?? match?.[3];
    if (title) {
      node.properties.dataTitle = title;
    }
  },
};

/**
 * Markdown pipeline for `.md` posts (MDX inherits it). Imported by
 * astro.config.mjs, so imports here stay relative. See ./README.md.
 */
export const markdownConfig: MarkdownConfig = {
  processor: satteri({
    mdastPlugins: [highlightMarks],
    hastPlugins: [
      dropTitleHeading,
      codeSlips,
      pictureParagraphs,
      responsivePictures,
      asideStickies,
    ],
    features: {
      gfm: {
        footnotes: {
          label: "注释",
          backLabel: "回到正文第 {reference} 处",
        },
      },
    },
  }),
  shikiConfig: {
    theme: inkTheme,
    transformers: [fenceTitle],
  },
};
