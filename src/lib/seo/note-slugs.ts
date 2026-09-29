import { readPostFiles } from "./post-files.ts";

/**
 * Vite plugin for `virtual:note-slugs`: the set of note slugs, fixed at build
 * time. The on-demand API routes use it to refuse comments on notes that do
 * not exist, without bundling the content collection into the Worker.
 *
 * Imported by astro.config.mjs (relative imports only). Types: src/virtual.d.ts.
 */
const VIRTUAL_ID = "virtual:note-slugs";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export const noteSlugsPlugin = () => ({
  name: "journal-note-slugs",
  resolveId: (id: string) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
  load: (id: string) => {
    if (id !== RESOLVED_ID) {
      return;
    }
    const slugs = readPostFiles().map((post) => post.slug);
    return `export const noteSlugs = new Set(${JSON.stringify(slugs)});`;
  },
});
