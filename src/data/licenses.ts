/**
 * Everything this site uses that someone else made, with its licence: the
 * canonical list behind /licenses/ (src/pages/licenses.astro). ATTRIBUTIONS.md
 * points here; add an entry when a new library, font, model or asset ships.
 *
 * `npm` entries read their version from node_modules/<pkg>/package.json at
 * build time, so the page follows upgrades. tests/licenses.test.ts checks
 * that every npm package the browser code imports is listed here.
 *
 * The site's own source code is MIT (LICENSE, `SITE_SOURCE`); the notes are
 * CC BY-NC-SA 4.0 (src/lib/seo/copyright.ts).
 *
 * Relative imports only: tests/ import it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type LicenseId =
  | "MIT"
  | "Apache-2.0"
  | "OFL-1.1"
  | "CC0-1.0"
  | "public-domain";

export type LicenseGroup = "browser" | "fonts" | "models" | "assets" | "build";

export type Component = {
  /** Anchor on /licenses/ (`/licenses/#<id>`). */
  id: string;
  name: string;
  /** npm package to read the version from. */
  npm?: string;
  /** Fixed version, for things not installed from npm. */
  version?: string;
  license: LicenseId;
  /** Copyright lines as the licence notice gives them. */
  copyright: readonly string[];
  url: string;
  /** Where the site uses it, in Chinese. */
  usedFor: string;
  group: LicenseGroup;
  /** Its code, font or data is downloaded by visitors. */
  shipsToBrowser: boolean;
  /** The licence file served next to it, when there is one. */
  licenseFile?: string;
  /** Extra notices to link to. */
  notice?: { label: string; url: string };
};

/**
 * Copyright lines of the two split CJK fonts, as in their name tables. The
 * split woff2 keep them but lose the licence fields, so scripts/build-fonts.ts
 * writes public/fonts/<family>/OFL.txt with these lines.
 */
export const FONT_COPYRIGHT = {
  xiaolai: [
    "Copyright 2020-2024 LXGW (https://github.com/lxgw/kose-font)",
    "Copyright 2014 Nozomi Seto (https://ja.osdn.net/projects/setofont/)",
  ],
  zhuque: ["Copyright 2023 JadeFoci"],
} as const;

/** The site's own source code (LICENSE at the repository root). */
export const SITE_SOURCE = {
  license: "MIT",
  copyright: "Copyright (c) 2025-2026 Sonui",
  repo: "https://github.com/sosyz/blog",
  licenseUrl: "https://github.com/sosyz/blog/blob/master/LICENSE",
} as const;

export const LICENSE_NAMES: Record<LicenseId, string> = {
  MIT: "MIT",
  "Apache-2.0": "Apache-2.0",
  "OFL-1.1": "SIL OFL 1.1",
  "CC0-1.0": "CC0 1.0",
  "public-domain": "公有领域",
};

/** Anchor of the full text on /licenses/; CC0 and public domain have none. */
export const LICENSE_TEXT_ANCHORS: Partial<Record<LicenseId, string>> = {
  MIT: "mit",
  "Apache-2.0": "apache-2-0",
  "OFL-1.1": "ofl-1-1",
};

export const GROUPS: readonly { id: LicenseGroup; title: string }[] = [
  { id: "browser", title: "浏览器里运行的代码" },
  { id: "fonts", title: "字体" },
  { id: "models", title: "模型" },
  { id: "assets", title: "素材" },
  { id: "build", title: "构建工具" },
];

export const COMPONENTS: readonly Component[] = [
  // Code that ships to the browser.
  {
    id: "astro",
    name: "Astro 客户端运行时",
    npm: "astro",
    license: "MIT",
    copyright: ["Copyright (c) 2021 Fred K. Schott"],
    url: "https://github.com/withastro/astro",
    usedFor: "页面之间的切换（ClientRouter）和页面脚本的加载",
    group: "browser",
    shipsToBrowser: true,
  },
  {
    id: "rough-notation",
    name: "Rough Notation",
    npm: "rough-notation",
    license: "MIT",
    copyright: ["Copyright (c) 2020 Preet Shihn"],
    url: "https://github.com/rough-stuff/rough-notation",
    usedFor: "正文里的荧光笔、下划线和圈注",
    group: "browser",
    shipsToBrowser: true,
  },
  {
    id: "roughjs",
    name: "Rough.js",
    npm: "roughjs",
    license: "MIT",
    copyright: ["Copyright (c) 2019 Preet Shihn"],
    url: "https://github.com/rough-stuff/rough",
    usedFor:
      "Rough Notation 里画线的部分；构建时也用它画手绘的圈、框、下划线涂鸦和图表笔触",
    group: "browser",
    shipsToBrowser: true,
  },
  {
    id: "transformers-js",
    name: "transformers.js",
    npm: "@huggingface/transformers",
    license: "Apache-2.0",
    copyright: ["Hugging Face"],
    url: "https://github.com/huggingface/transformers.js",
    usedFor: "贴纸工坊的自动抠图（在 Web Worker 里运行 U-2-Netp）",
    group: "browser",
    shipsToBrowser: true,
  },
  {
    id: "onnxruntime-web",
    name: "ONNX Runtime Web",
    npm: "onnxruntime-web",
    license: "MIT",
    copyright: ["Copyright (c) Microsoft Corporation"],
    url: "https://github.com/microsoft/onnxruntime",
    usedFor:
      "自动抠图的推理引擎（打包的脚本和 /ort/ 下的 wasm，只在打开自动抠图时下载）",
    group: "browser",
    shipsToBrowser: true,
    notice: {
      label: "wasm 内含第三方代码的声明",
      url: "https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt",
    },
  },
  {
    id: "octicons",
    name: "Octicons（mark-github）",
    license: "MIT",
    copyright: ["Copyright (c) GitHub Inc."],
    url: "https://github.com/primer/octicons",
    usedFor: "「用 GitHub 登录」按钮上的 GitHub 标志",
    group: "browser",
    shipsToBrowser: true,
  },
  {
    id: "sticker-forge",
    name: "sticker-forge（改写的部分代码）",
    license: "MIT",
    copyright: ["Copyright (c) 2026 CatsJuice"],
    url: "https://github.com/CatsJuice/sticker-forge",
    usedFor: "贴纸工坊的抠图前后处理、白边描边和撕贴纸的卷曲效果",
    group: "browser",
    shipsToBrowser: true,
  },

  // Fonts.
  {
    id: "xiaolai",
    name: "小赖字体 Xiaolai",
    version: "3.126",
    license: "OFL-1.1",
    copyright: FONT_COPYRIGHT.xiaolai,
    url: "https://github.com/lxgw/kose-font",
    usedFor: "主题名、便利贴和界面文字（切成小块，只下载用到的字）",
    group: "fonts",
    shipsToBrowser: true,
    licenseFile: "/fonts/xiaolai/OFL.txt",
  },
  {
    id: "zhuque",
    name: "朱雀仿宋 Zhuque Fangsong（技术预览版）",
    version: "0.212",
    license: "OFL-1.1",
    copyright: FONT_COPYRIGHT.zhuque,
    url: "https://github.com/TrionesType/zhuque",
    usedFor: "正文（切成小块，只下载用到的字，字形没有改动）",
    group: "fonts",
    shipsToBrowser: true,
    licenseFile: "/fonts/zhuque/OFL.txt",
  },
  {
    id: "maple-mono",
    name: "Maple Mono",
    npm: "@fontsource/maple-mono",
    license: "OFL-1.1",
    copyright: [
      "Copyright (c) 2022, subframe7536 (https://github.com/subframe7536), with Reserved Font Name Maple Mono.",
    ],
    url: "https://github.com/subframe7536/maple-font",
    usedFor: "代码（拉丁字符子集，经 Fontsource 打包）",
    group: "fonts",
    shipsToBrowser: true,
  },

  // Models.
  {
    id: "u2netp",
    name: "U-2-Netp",
    version: "rev. 7112208",
    license: "Apache-2.0",
    copyright: ["U²-Net：Xuebin Qin 等", "ONNX 转换：rembg（Daniel Gatis）"],
    url: "https://huggingface.co/BritishWerewolf/U-2-Netp",
    usedFor: "贴纸工坊的自动抠图，在你的浏览器里运行，模型文件没有改动",
    group: "models",
    shipsToBrowser: true,
    licenseFile: "/models/u2netp/LICENSE.txt",
  },

  // Assets.
  {
    id: "ambientcg",
    name: "ambientCG 纸纹",
    license: "CC0-1.0",
    copyright: ["ambientCG"],
    url: "https://ambientcg.com/",
    usedFor: "桌面、纸张、牛皮纸的纹理，纸胶带和印章斑点也由它渲染",
    group: "assets",
    shipsToBrowser: true,
  },
  {
    id: "openclipart",
    name: "Openclipart",
    license: "public-domain",
    copyright: ["Openclipart"],
    url: "https://openclipart.org/",
    usedFor: "回形针、部分涂鸦箭头和爱心、邮票框、撕纸和票根",
    group: "assets",
    shipsToBrowser: true,
  },
  {
    id: "doodle-icons",
    name: "Doodle Icons",
    license: "CC0-1.0",
    copyright: ["Khushmeen Sidhu"],
    url: "https://khushmeen.com/icons.html",
    usedFor: "手绘小图标：箭头、灯泡、咖啡杯、火箭、对勾等",
    group: "assets",
    shipsToBrowser: true,
  },

  // Build tools: they run while the site is built; their code is not in
  // what visitors download.
  {
    id: "mermaid",
    name: "Mermaid",
    npm: "mermaid",
    license: "MIT",
    copyright: ["Copyright (c) 2014 - 2022 Knut Sveidqvist"],
    url: "https://github.com/mermaid-js/mermaid",
    usedFor:
      "构建时把笔记里的 Mermaid 图画成手绘风格的 SVG（页面里只有画好的图）",
    group: "build",
    shipsToBrowser: false,
  },
  {
    id: "svgo",
    name: "SVGO",
    npm: "svgo",
    license: "MIT",
    copyright: ["Copyright (c) Kir Belevich"],
    url: "https://github.com/svg/svgo",
    usedFor: "压缩构建时生成的 SVG",
    group: "build",
    shipsToBrowser: false,
  },
  {
    id: "shiki",
    name: "Shiki",
    npm: "shiki",
    license: "MIT",
    copyright: ["Copyright (c) 2021 Pine Wu", "Copyright (c) 2023 Anthony Fu"],
    url: "https://github.com/shikijs/shiki",
    usedFor: "构建时给代码上色",
    group: "build",
    shipsToBrowser: false,
  },
  {
    id: "cn-font-split",
    name: "cn-font-split",
    npm: "cn-font-split",
    license: "Apache-2.0",
    copyright: ["KonghaYao"],
    url: "https://github.com/KonghaYao/cn-font-split",
    usedFor: "把中文字体切成小块",
    group: "build",
    shipsToBrowser: false,
  },
];

const NODE_MODULES = join(process.cwd(), "node_modules");

/**
 * The installed version of an npm package, read at build time. Undefined
 * when it is not installed (e.g. a build tool on a machine that skipped it).
 */
export const npmVersion = (name: string): string | undefined => {
  try {
    const text = readFileSync(join(NODE_MODULES, name, "package.json"), "utf8");
    const { version } = JSON.parse(text) as { version?: unknown };
    return typeof version === "string" ? version : undefined;
  } catch {
    return;
  }
};

/** The version shown on the page: installed npm version, else the fixed one. */
export const componentVersion = (component: Component) =>
  (component.npm ? npmVersion(component.npm) : undefined) ?? component.version;

/** The components of one group, in list order. */
export const componentsIn = (group: LicenseGroup) =>
  COMPONENTS.filter((component) => component.group === group);

/** Every copyright line under one licence (the site's own first for MIT). */
export const holdersOf = (license: LicenseId) => [
  ...(license === "MIT" ? [`${SITE_SOURCE.copyright}（本站源码）`] : []),
  ...COMPONENTS.filter((component) => component.license === license).map(
    (component) => `${component.name}：${component.copyright.join("；")}`
  ),
];
