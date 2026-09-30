import { satteri } from "@astrojs/markdown-satteri";
import type { AstroUserConfig } from "astro";
import { mermaidDiagrams } from "./diagrams.ts";
import {
  asideStickies,
  codeSlips,
  dropTitleHeading,
  highlightMarks,
  pictureParagraphs,
  responsivePictures,
  shikiConfig,
} from "./plugins.ts";

type MarkdownConfig = NonNullable<AstroUserConfig["markdown"]>;

/**
 * Markdown pipeline for `.md` posts (MDX inherits it). Imported by
 * astro.config.mjs, so imports here stay relative. See ./README.md.
 */
export const markdownConfig: MarkdownConfig = {
  processor: satteri({
    mdastPlugins: [highlightMarks],
    hastPlugins: [
      dropTitleHeading,
      // Before codeSlips: it swaps mermaid blocks for drawn diagrams, and
      // codeSlips leaves any mermaid block it did not draw alone.
      mermaidDiagrams,
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
  // Mermaid is drawn by mermaidDiagrams, so Shiki must leave it as source.
  syntaxHighlight: { type: "shiki", excludeLangs: ["math", "mermaid"] },
  shikiConfig,
};
