/**
 * Cut the two CJK fonts for the web, in two layers.
 *
 * Usage: bun run fonts (again after adding notes or UI copy: a character the
 * site files lack still shows, it just costs a second-layer chunk)
 *
 * The source TTFs are not committed (21 MB + 9 MB). Put them in `fonts-src/`:
 * - fonts-src/xiaolai-regular.ttf          小赖字体 https://github.com/lxgw/kose-font (Xiaolai SC)
 * - fonts-src/zhuque-fangsong-regular.ttf  朱雀仿宋 https://github.com/TrionesType/zhuque
 *
 * 1. Site files: every character the site itself uses (UI copy in src/**,
 *    note frontmatter and bodies, ASCII and punctuation; see font-chars.ts)
 *    in one or two woff2 per family, shared by every page:
 *    - Zhuque Fangsong: the characters on every page (UI, titles, summaries)
 *      and, separately, the ones only note bodies use, so `/` and `/list/`
 *      fetch one file and a note two.
 *    - Xiaolai: one file, the characters on every page plus the parts of note
 *      bodies set in the hand font (quotes, captions, file names, footnotes).
 *    Their @font-face rules, with metric-matched local fallback faces
 *    ("<family> Fallback", listed in tokens.css), go into
 *    src/layouts/fonts.generated.ts; Base.astro inlines them and preloads
 *    the first Zhuque file.
 * 2. The rest: cn-font-split's usual small chunks for everything else, with
 *    the site files' characters taken out of their unicode-range, so they
 *    are only fetched for text the site does not ship (visitor comments,
 *    search queries). One stylesheet, public/fonts/rest.<hash>.css, loaded
 *    without blocking rendering.
 *
 * Output (committed): public/fonts/{xiaolai,zhuque}/*.woff2,
 * public/fonts/rest.<hash>.css and src/layouts/fonts.generated.ts.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";
import { fontSplit } from "cn-font-split";
import { consola } from "consola";
import { create, type Font } from "fontkitten";
import {
  averageAdvance,
  type Chunk,
  coveredBy,
  faceRule,
  LATIN_SAMPLE,
  lineOverrides,
  local,
  minus,
  parseChunks,
  pct,
  restChunks,
  type SiteSets,
  siteSets,
  sizeAdjust,
  toUnicodeRange,
  woff2,
} from "./font-chars";

type Fallback = {
  /** local() names (PostScript and full names) for CJK text. */
  cjk: readonly string[];
  /** local() names for Latin text. */
  latin: readonly string[];
  /** Average Latin advance per em of the first `latin` font (LATIN_SAMPLE). */
  latinAverage: number;
};

type FontJob = {
  /** Source file inside fonts-src/. */
  source: string;
  /** Output folder inside public/fonts/. */
  outDir: string;
  /** CSS font-family name; tokens.css refers to it. */
  family: string;
  /** The site subsets, in order; each becomes one woff2. */
  site: (sets: SiteSets) => Set<number>[];
  /**
   * Keep OpenType layout features in the site files. Zhuque's GSUB pulls
   * ~800 accented Latin, Greek and Cyrillic glyphs into the file (+47 KB)
   * for kerning and ligatures; Xiaolai's costs nothing.
   */
  features: boolean;
  /** Preload the first site file (the body text font). */
  preload: boolean;
  fallback: Fallback;
};

const ROOT = join(import.meta.dir, "..");
const SOURCE_DIR = join(ROOT, "fonts-src");
const PUBLIC_FONTS = join(ROOT, "public", "fonts");
const GENERATED = join(ROOT, "src", "layouts", "fonts.generated.ts");
const SITE_TMP = ".site";
/** 8 MiB: big enough that cn-font-split never splits a site subset. */
const SITE_CHUNK_SIZE = 8_388_608;
const HASH_LENGTH = 10;

/*
 * Average advance of LATIN_SAMPLE per em, measured with fontkitten from the
 * macOS copies (the same metrics ship on Windows).
 */
const ARIAL_AVERAGE = 0.5743;
const TIMES_AVERAGE = 0.548;

/** Where a fallback CJK face applies: punctuation, CJK, full-width forms. */
const CJK_RANGE =
  "U+2000-206F,U+2E80-9FFF,U+F900-FAFF,U+FE30-FE4F,U+FF00-FFEF,U+20000-2FA1F";
/** Where a fallback Latin face applies. */
const LATIN_RANGE = "U+0-24F";

const JOBS: FontJob[] = [
  {
    source: "xiaolai-regular.ttf",
    outDir: "xiaolai",
    family: "Xiaolai",
    site: (sets) => [sets.hand],
    features: true,
    preload: false,
    fallback: {
      cjk: [
        "PingFangSC-Regular",
        "PingFang SC Regular",
        "HiraginoSansGB-W3",
        "Microsoft YaHei",
        "MicrosoftYaHei",
        "NotoSansCJKsc-Regular",
        "Noto Sans CJK SC",
        "Source Han Sans SC",
      ],
      latin: ["ArialMT", "Arial"],
      latinAverage: ARIAL_AVERAGE,
    },
  },
  {
    source: "zhuque-fangsong-regular.ttf",
    outDir: "zhuque",
    family: "Zhuque Fangsong",
    site: (sets) => [sets.common, sets.body],
    features: false,
    preload: true,
    fallback: {
      cjk: [
        "STSongti-SC-Regular",
        "Songti SC Regular",
        "STSong",
        "SimSun",
        "NotoSerifCJKsc-Regular",
        "Noto Serif CJK SC",
        "Source Han Serif SC",
      ],
      latin: ["TimesNewRomanPSMT", "Times New Roman"],
      latinAverage: TIMES_AVERAGE,
    },
  },
];

/* ---------- which characters the site uses ---------- */

const readAll = async (pattern: string, skip: (file: string) => boolean) => {
  const texts: string[] = [];
  for await (const file of new Glob(pattern).scan(ROOT)) {
    if (!skip(file)) {
      texts.push(await Bun.file(join(ROOT, file)).text());
    }
  }
  return texts;
};

const collectSets = async () =>
  siteSets({
    ui: await readAll(
      "src/**/*.{astro,ts,tsx,js,mjs,css}",
      (file) => file.startsWith("src/posts/") || file.includes(".generated.")
    ),
    posts: await readAll("src/posts/**/*.{md,mdx}", () => false),
  });

/* ---------- splitting ---------- */

type SplitOptions = {
  input: Uint8Array;
  outDir: string;
  family: string;
  subsets: number[][];
  site: boolean;
  features: boolean;
};

const split = async (options: SplitOptions) => {
  await fontSplit({
    input: options.input,
    outDir: options.outDir,
    subsets: options.subsets,
    css: {
      fontFamily: options.family,
      fontWeight: "400",
      fontStyle: "normal",
      fontDisplay: "swap",
      localFamily: [],
      compress: true,
    },
    // Site files: exactly one woff2 per subset and nothing else.
    ...(options.site
      ? {
          autoSubset: false,
          subsetRemainChars: false,
          languageAreas: false,
          reduceMins: false,
          chunkSize: SITE_CHUNK_SIZE,
        }
      : {}),
    fontFeature: options.features,
    testHtml: false,
    reporter: false,
    previewImage: undefined,
    silent: true,
  });
  const css = await Bun.file(join(options.outDir, "result.css")).text();
  return parseChunks(css);
};

const sortNumbers = (set: Set<number>) => [...set].sort((a, b) => a - b);

/** The chunk that holds most of `subset` (cn-font-split may reorder them). */
const chunkFor = (chunks: readonly Chunk[], subset: Set<number>) => {
  let best: Chunk | null = null;
  let bestCount = 0;
  for (const chunk of chunks) {
    const count = [...subset].filter((cp) => chunk.codePoints.has(cp)).length;
    if (count > bestCount) {
      best = chunk;
      bestCount = count;
    }
  }
  return best;
};

type JobResult = {
  /** Inline @font-face rules: site files and fallback faces. */
  faces: string[];
  /** Second-layer @font-face rules (public/fonts/rest.*.css). */
  rest: string[];
  preload: string | null;
};

const fallbackFaces = (job: FontJob, font: Font) => {
  const metrics = {
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: font.descent,
    lineGap: font.lineGap,
  };
  const webAverage = averageAdvance(
    LATIN_SAMPLE,
    font.unitsPerEm,
    (cp) => font.glyphForCodePoint(cp).advanceWidth
  );
  const adjust = sizeAdjust(webAverage, job.fallback.latinAverage);
  const family = `${job.family} Fallback`;
  return [
    faceRule({
      family,
      src: job.fallback.cjk.map(local),
      range: CJK_RANGE,
      descriptors: lineOverrides(metrics),
    }),
    faceRule({
      family,
      src: job.fallback.latin.map(local),
      range: LATIN_RANGE,
      descriptors: {
        "size-adjust": pct(adjust),
        ...lineOverrides(metrics, adjust),
      },
    }),
  ];
};

/**
 * Move the site files next to the chunks and write their @font-face rules.
 * The first file is on every page and has no unicode-range: a character it
 * lacks falls through to the next face. The others are only fetched for
 * their own characters.
 */
const placeSiteFiles = async (
  job: FontJob,
  subsets: Set<number>[],
  siteChunks: readonly Chunk[]
) => {
  const outDir = join(PUBLIC_FONTS, job.outDir);
  const faces: string[] = [];
  const siteFiles: string[] = [];
  const covered = new Set<number>();
  let preload: string | null = null;
  for (const [index, subset] of subsets.entries()) {
    const chunk = chunkFor(siteChunks, subset);
    if (!chunk || siteFiles.includes(chunk.file)) {
      throw new Error(
        `${job.family}: cn-font-split did not give subset ${index} its own file`
      );
    }
    await rename(join(outDir, SITE_TMP, chunk.file), join(outDir, chunk.file));
    siteFiles.push(chunk.file);
    const url = `/fonts/${job.outDir}/${chunk.file}`;
    const own = minus(chunk.codePoints, covered);
    faces.push(
      faceRule({
        family: job.family,
        src: [woff2(url)],
        range: index === 0 ? undefined : toUnicodeRange(own),
      })
    );
    for (const cp of chunk.codePoints) {
      covered.add(cp);
    }
    if (index === 0 && job.preload) {
      preload = url;
    }
    consola.info(
      `${job.family} site file ${index + 1}: ${chunk.codePoints.size} characters`
    );
  }
  return { faces, siteFiles, covered, preload };
};

const buildJob = async (job: FontJob, sets: SiteSets): Promise<JobResult> => {
  const input = join(SOURCE_DIR, job.source);
  if (!existsSync(input)) {
    throw new Error(
      `Missing ${input}. See the header of scripts/build-fonts.ts for download links.`
    );
  }
  const outDir = join(PUBLIC_FONTS, job.outDir);
  const siteDir = join(outDir, SITE_TMP);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(siteDir, { recursive: true });

  const buffer = new Uint8Array(await Bun.file(input).arrayBuffer());
  const font = create(Buffer.from(buffer));
  if (font.isCollection) {
    throw new Error(`${input} is a font collection; expected one font.`);
  }
  const glyphs = new Set<number>(font.characterSet);
  const subsets = job.site(sets).map((set) => coveredBy(set, glyphs));

  // 1. Site files.
  const siteChunks = await split({
    input: buffer,
    outDir: siteDir,
    family: job.family,
    subsets: subsets.map(sortNumbers),
    site: true,
    features: job.features,
  });
  const { faces, siteFiles, covered, preload } = await placeSiteFiles(
    job,
    subsets,
    siteChunks
  );
  await rm(siteDir, { recursive: true, force: true });

  // 2. The rest, in small chunks, minus what the site files cover.
  const chunks = await split({
    input: buffer,
    outDir,
    family: job.family,
    subsets: [sortNumbers(covered)],
    site: false,
    features: true,
  });
  const rest = restChunks(chunks, covered);
  const keep = new Set([...siteFiles, ...rest.map((chunk) => chunk.file)]);
  for (const file of await readdir(outDir)) {
    if (!keep.has(file)) {
      await rm(join(outDir, file), { force: true });
    }
  }

  consola.success(
    `${job.family}: ${faces.length} site woff2 + ${rest.length} chunks → ${outDir}`
  );
  return {
    faces: [...faces, ...fallbackFaces(job, font)],
    rest: rest.map((chunk) =>
      faceRule({
        family: job.family,
        src: [woff2(`/fonts/${job.outDir}/${chunk.file}`)],
        range: toUnicodeRange(chunk.codePoints),
      })
    ),
    preload,
  };
};

/* ---------- output ---------- */

const writeRestCss = async (rules: string[]) => {
  for (const file of await readdir(PUBLIC_FONTS)) {
    if (file.startsWith("rest.") && file.endsWith(".css")) {
      await rm(join(PUBLIC_FONTS, file));
    }
  }
  const css = `/* Generated by scripts/build-fonts.ts. Glyphs the site files lack. */\n${rules.join("\n")}\n`;
  const hash = new Bun.CryptoHasher("sha256")
    .update(css)
    .digest("hex")
    .slice(0, HASH_LENGTH);
  const name = `rest.${hash}.css`;
  await Bun.write(join(PUBLIC_FONTS, name), css);
  return `/fonts/${name}`;
};

const writeGenerated = async (
  faces: string[],
  preloads: string[],
  restCss: string
) => {
  const source = `// Generated by scripts/build-fonts.ts (bun run fonts). Do not edit.

/** Site-file and fallback @font-face rules, inlined by Base.astro. */
export const FONT_FACES = ${JSON.stringify(faces.join("\n"))};

/** Site files every page needs first (<link rel="preload">). */
export const FONT_PRELOADS = ${JSON.stringify(preloads)} as const;

/** Second-layer chunks for characters the site files lack. */
export const FONT_REST_CSS = ${JSON.stringify(restCss)};
`;
  await Bun.write(GENERATED, source);
  Bun.spawnSync(["bun", "x", "biome", "format", "--write", GENERATED], {
    cwd: ROOT,
  });
};

const main = async () => {
  const sets = await collectSets();
  const faces: string[] = [];
  const rest: string[] = [];
  const preloads: string[] = [];
  for (const job of JOBS) {
    // Sequential on purpose: each split already uses all cores.
    const result = await buildJob(job, sets);
    faces.push(...result.faces);
    rest.push(...result.rest);
    if (result.preload) {
      preloads.push(result.preload);
    }
  }
  const restCss = await writeRestCss(rest);
  await writeGenerated(faces, preloads, restCss);
  consola.success(`Inline faces → ${GENERATED}; rest → public${restCss}`);
};

await main();
