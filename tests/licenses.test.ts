import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  APACHE_2_0_TEXT,
  MIT_TEXT,
  mitLicense,
  OFL_1_1_TEXT,
  oflFile,
} from "../src/data/license-texts";
import {
  COMPONENTS,
  componentVersion,
  FONT_COPYRIGHT,
  GROUPS,
  holdersOf,
  LICENSE_TEXT_ANCHORS,
  SITE_SOURCE,
} from "../src/data/licenses";

const ROOT = join(import.meta.dir, "..");
/** Where code that can end up in the browser lives. */
const BROWSER_DIRS = [
  "src/scripts",
  "src/components",
  "src/layouts",
  "src/pages",
];
const SCRIPT_FILE = /\.(?:ts|mts|js|mjs)$/;
const ASTRO_FILE = /\.astro$/;
/** <script> bodies of an .astro file (not JSON-LD, which has a type). */
const SCRIPT_BLOCK =
  /<script(?![^>]*\btype=)[^>]*>(?<body>[\s\S]*?)<\/script>/g;
/** Runtime imports: `import … from "x"`, `import "x"`, `import("x")`. */
const IMPORT =
  /(?:^|[;\s])(?:import\s+(?!type\s)(?:[^"';]*?\s+from\s+)?|export\s+(?!type\s)[^"';]*?\s+from\s+|import\s*\(\s*)["'](?<spec>[^"']+)["']/gm;
const NOT_A_PACKAGE = /^(?:\.|\/|@\/|astro:|virtual:|node:|bun:)/;
const FONT_DIRS = ["xiaolai", "zhuque"] as const;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

/** `rough-notation/lib/model` → `rough-notation`; `@a/b/c` → `@a/b`. */
const packageName = (spec: string) =>
  spec
    .split("/")
    .slice(0, spec.startsWith("@") ? 2 : 1)
    .join("/");

/**
 * Code that runs in the browser: whole TS/JS modules outside src/pages
 * (those are endpoints, run on the server or at build time) and the <script>
 * blocks of .astro files (their frontmatter runs at build time).
 */
const browserSources = () =>
  BROWSER_DIRS.flatMap((dir) => walk(join(ROOT, dir))).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    const path = relative(ROOT, file);
    if (ASTRO_FILE.test(file)) {
      return [...text.matchAll(SCRIPT_BLOCK)].map((match) => ({
        path,
        code: match.groups?.body ?? "",
      }));
    }
    if (SCRIPT_FILE.test(file) && !path.startsWith("src/pages/")) {
      return [{ path, code: text }];
    }
    return [];
  });

const browserPackages = () => {
  const found = new Map<string, string>();
  for (const { path, code } of browserSources()) {
    for (const match of code.matchAll(IMPORT)) {
      const spec = match.groups?.spec ?? "";
      if (!NOT_A_PACKAGE.test(spec)) {
        found.set(packageName(spec), path);
      }
    }
  }
  return found;
};

describe("browser dependencies", () => {
  test("the scan finds the packages we know about", () => {
    const found = browserPackages();
    expect(found.has("rough-notation")).toBe(true);
    expect(found.has("@huggingface/transformers")).toBe(true);
  });

  test("every npm package imported by browser code is listed", () => {
    const listed = new Set(COMPONENTS.flatMap((c) => (c.npm ? [c.npm] : [])));
    const missing = [...browserPackages()]
      .filter(([name]) => !listed.has(name))
      .map(([name, file]) => `${name} (${file})`);
    expect(missing).toEqual([]);
  });

  test("listed browser packages resolve to an installed version", () => {
    for (const component of COMPONENTS) {
      if (component.npm && component.shipsToBrowser) {
        expect(componentVersion(component)).toBeString();
      }
    }
  });
});

describe("the list", () => {
  test("ids are unique and groups exist", () => {
    const ids = COMPONENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(GROUPS.map((g) => g.id));
    for (const component of COMPONENTS) {
      expect(groups.has(component.group)).toBe(true);
      expect(component.copyright.length).toBeGreaterThan(0);
      expect(component.url).toStartWith("https://");
    }
  });

  test("the sticker workshop's #u2netp anchor exists", () => {
    const model = COMPONENTS.find((c) => c.id === "u2netp");
    expect(model?.license).toBe("Apache-2.0");
    expect(model?.licenseFile).toBe("/models/u2netp/LICENSE.txt");
  });

  test("licence files it links to are served", () => {
    for (const component of COMPONENTS) {
      if (component.licenseFile) {
        const text = readFileSync(
          join(ROOT, "public", component.licenseFile),
          "utf8"
        );
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  test("every licence with a full text has holders", () => {
    for (const license of Object.keys(LICENSE_TEXT_ANCHORS)) {
      expect(
        holdersOf(license as keyof typeof LICENSE_TEXT_ANCHORS).length
      ).toBeGreaterThan(0);
    }
    expect(holdersOf("MIT")[0]).toContain(SITE_SOURCE.copyright);
  });
});

describe("licence texts", () => {
  test("are the full texts", () => {
    expect(MIT_TEXT).toStartWith("Permission is hereby granted");
    expect(MIT_TEXT).toEndWith("SOFTWARE.");
    expect(APACHE_2_0_TEXT).toContain("Version 2.0, January 2004");
    expect(APACHE_2_0_TEXT).toContain("END OF TERMS AND CONDITIONS");
    expect(OFL_1_1_TEXT).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(OFL_1_1_TEXT).toContain("TERMINATION");
  });

  test("mitLicense puts the copyright line on top", () => {
    expect(mitLicense("Copyright (c) 2026 Someone")).toStartWith(
      "MIT License\n\nCopyright (c) 2026 Someone\n\nPermission"
    );
  });
});

describe("OFL.txt next to the split fonts", () => {
  for (const dir of FONT_DIRS) {
    test(`public/fonts/${dir}/OFL.txt`, () => {
      const text = readFileSync(
        join(ROOT, "public", "fonts", dir, "OFL.txt"),
        "utf8"
      );
      for (const line of FONT_COPYRIGHT[dir]) {
        expect(text).toContain(line);
      }
      expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
      // No Reserved Font Name after the copyright lines.
      expect(text.split("\n\n")[0]).not.toContain("Reserved Font Name");
      // Exactly what `bun run fonts` writes, so rerunning it leaves no diff.
      expect(text).toBe(oflFile(FONT_COPYRIGHT[dir]));
    });
  }
});

describe("LICENSE", () => {
  const text = readFileSync(join(ROOT, "LICENSE"), "utf8");

  test("is MIT for Sonui, with the standard text", () => {
    expect(text).toStartWith("MIT License\n");
    expect(text).toContain("Sonui");
    expect(text).toContain(SITE_SOURCE.copyright);
    expect(text).toContain(MIT_TEXT);
  });

  test("says the notes are CC BY-NC-SA 4.0", () => {
    expect(text).toContain("src/posts/");
    expect(text).toContain("CC BY-NC-SA 4.0");
    expect(text).toContain("ATTRIBUTIONS.md");
  });
});
