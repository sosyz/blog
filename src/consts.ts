// Owner profile shown on the canvas intro card.
// Site name, description and URLs live in src/lib/seo/site.ts.

export const PROFILE = {
  bio: "这里收集我在编程、产品构建、AI 工具链和日常观察里的笔记。内容不追求宏大，更偏向把真实踩过的坑和有效的做法留下来。",
  facts: ["Astro / TypeScript", "AI SDK", "工程实践", "持续写作中"],
  links: [
    { href: "https://github.com/sosyz", label: "GitHub" },
    { href: "/rss.xml", label: "RSS" },
    { href: "/list/", label: "全部笔记" },
  ],
  name: "Sonui",
  title: "工程、AI 与一点点生活记录",
} as const;
