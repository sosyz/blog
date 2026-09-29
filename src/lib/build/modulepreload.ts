/**
 * After the build, give every page a <link rel="modulepreload"> for each
 * chunk its module scripts import statically. Astro emits the entry
 * scripts only, so the browser found the shared chunks (api, store, auth…)
 * one round trip later, and their imports one more after that.
 *
 * Dynamic imports (the review tools, the WebGL peel, the sticker workshop)
 * are not followed: they are loaded on demand on purpose.
 *
 * Used by astro.config.mjs (so imports stay relative / node:).
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

/** `import … from "./x.js"`, `import "./x.js"`, `export … from "./x.js"`. */
const STATIC_IMPORT =
  /(?:^|[;}\n])\s*(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?["']([^"']+\.js)["']/g;
const MODULE_SCRIPT = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g;
const PRELOADED = /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g;
const HEAD_END = "</head>";

/** Relative specifiers statically imported by a built chunk. */
export const staticImports = (code: string) => {
  const out: string[] = [];
  for (const match of code.matchAll(STATIC_IMPORT)) {
    const spec = match[1];
    if (spec?.startsWith(".")) {
      out.push(spec);
    }
  }
  return out;
};

/**
 * Every chunk reachable from `entries` through static imports, entries
 * excluded, in discovery order. `read` returns a chunk's code by its URL
 * path (`/_astro/x.js`), or undefined when it is not a local file.
 */
export const preloadsFor = (
  entries: readonly string[],
  read: (path: string) => string | undefined
) => {
  const seen = new Set(entries);
  const queue = [...entries];
  const out: string[] = [];
  while (queue.length > 0) {
    const path = queue.shift() ?? "";
    const code = read(path);
    if (code === undefined) {
      continue;
    }
    for (const spec of staticImports(code)) {
      const next = posix.join(posix.dirname(path), spec);
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
        out.push(next);
      }
    }
  }
  return out;
};

/** The page with modulepreload links for its scripts' static imports. */
export const withModulePreloads = (
  html: string,
  read: (path: string) => string | undefined
) => {
  if (!html.includes(HEAD_END)) {
    return html;
  }
  const entries = [...html.matchAll(MODULE_SCRIPT)]
    .map((match) => match[1] ?? "")
    .filter((src) => src.startsWith("/"));
  const already = new Set(
    [...html.matchAll(PRELOADED)].map((match) => match[1] ?? "")
  );
  const links = preloadsFor(entries, read)
    .filter((path) => !already.has(path))
    .map((path) => `<link rel="modulepreload" href="${path}">`)
    .join("");
  return links ? html.replace(HEAD_END, `${links}${HEAD_END}`) : html;
};

const filesUnder = async (dir: string, ext: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(ext))
    .map((entry) => join(entry.parentPath, entry.name));
};

/** Rewrite every prerendered page in the client output directory. */
export const addModulePreloads = async (clientDir: string) => {
  const scripts = await filesUnder(clientDir, ".js");
  const chunks = new Map<string, string>(
    await Promise.all(
      scripts.map(
        async (file) =>
          [
            `/${relative(clientDir, file).split(sep).join("/")}`,
            await readFile(file, "utf8"),
          ] as const
      )
    )
  );
  const read = (path: string) => chunks.get(path);
  const pages = await filesUnder(clientDir, ".html");
  const changed = await Promise.all(
    pages.map(async (file) => {
      const html = await readFile(file, "utf8");
      const next = withModulePreloads(html, read);
      if (next === html) {
        return false;
      }
      await writeFile(file, next);
      return true;
    })
  );
  return changed.filter(Boolean).length;
};
