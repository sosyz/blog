# AGENTS.md

给编码助手的项目指南。先读这份，再按需要读：

- [docs/design.md](docs/design.md)：设计决定（手账视觉、动效、互动、SEO），改界面或交互前必读。
- [docs/architecture.md](docs/architecture.md)：目录、负责区域、组件 props、接口、客户端事件等约定，改代码前查这里。
- [docs/deploy.md](docs/deploy.md)：Cloudflare 部署和上线切换。
- [docs/migration.md](docs/migration.md)：旧 Hexo 链接对照表和待作者确认的内容问题。
- [src/lib/markdown/README.md](src/lib/markdown/README.md)：Markdown 能写出哪些手账元素。
- [ATTRIBUTIONS.md](ATTRIBUTIONS.md)：字体、纸纹、贴纸的授权。

文末附有 Ultracite 规则全文（与 `.claude/CLAUDE.md` 相同），写 TS/JS 时遵守。

## 项目

Sonui 的博客 2.0：一本灵感手账。首页是一块无限画布，中央是自我介绍卡，笔记按主题堆成一堆一堆的卡片；点卡片从右侧拉出抽屉读全文。笔记分两种：「踩坑」（技术问题记录，横线索引卡）和「随想」（短想法，便利贴）。访客可以评论、划线评论、往画布上贴贴纸，都要先过人机验证（或用 GitHub 登录，可选）和人工审核。

所有面向读者的文字用简体中文，平实直接。

## 技术栈

- Astro 7.3，页面全部在构建时预渲染；`/api/*` 和 `/admin/` 按需运行。
- `@astrojs/cloudflare` 14 → Cloudflare Workers + 静态资源（不是 Pages）。D1 存评论和贴纸信息（以及 GitHub 登录的账号和会话），R2 存贴纸图片，Turnstile 人机验证，GitHub OAuth App 做可选的访客登录，Cloudflare Access 保护后台。
- 纯 TypeScript + 纯 CSS。交互写在 Astro `<script>` 里的 TS 模块中；页面之间用 `<ClientRouter />`，画布 `transition:persist`，切换笔记时镜头不动。
- Markdown 用 Astro 默认的 Sätteri 处理器，加自己的插件（代码纸条、拍立得、荧光笔、页边便利贴）。
- 字体：小赖（手写，主题名、便利贴、界面）、朱雀仿宋（正文），用 cn-font-split 切片；Maple Mono（代码，关闭连字）。
- 包管理器 bun，Node 24。TS/JS/CSS/JSON 用 Ultracite（Biome），`.astro` 用 Prettier。

## 目录与负责区域

| 区域 | 主要文件 |
| --- | --- |
| 内容 | `src/posts/`、`src/assets/posts/<slug>/`、`src/assets/covers/`、`src/content.config.ts` |
| 文章查询 | `src/lib/posts.ts`（所有页面都经过它读文章） |
| 画布与抽屉 | `src/components/canvas/`、`src/components/drawer/`、`src/scripts/canvas/`、`src/styles/canvas.css`、`src/pages/{index,list}.astro`、`src/pages/notes/[slug].astro` |
| 友链与版权 | `src/data/links.ts`（友链数据）、`src/lib/{links,friends}.ts`、`src/assets/links/`、`src/components/links/`、`src/pages/links.astro`、`src/lib/seo/copyright.ts`、`src/components/post/CopyrightSlip.astro`、`src/components/site/SiteFooter.astro`、`src/scripts/copy.ts` |
| 正文排版 | `src/components/post/`、`src/lib/markdown/`、`src/styles/prose.css` |
| 访客互动 / 后端 | `src/components/interact/`、`src/scripts/interact/`、`src/lib/server/`、`src/pages/api/`、`src/pages/admin/`、`src/pages/privacy.astro`、`migrations/`、`tests/` |
| SEO / GEO | `src/components/seo/`、`src/lib/seo/`、`src/pages/{rss.xml,llms.txt,llms-full.txt,robots.txt}.ts`、`src/pages/notes/[slug].md.ts`、`src/pages/404.astro`、`src/integrations/legacy-list-redirects.ts`、`public/_redirects`（只放注释） |
| 共用基础 | `astro.config.mjs`、`wrangler.jsonc`、`src/middleware.ts`（Worker 响应的安全头）、`public/_headers`、`src/lib/build/`、`src/layouts/Base.astro`、`src/layouts/fonts.generated.ts`（`bun run fonts` 生成）、`src/styles/{tokens,base,materials}.css`、`src/scripts/canvas/{api,seed}.ts`、`public/journal/`、`public/stickers/`、`public/fonts/` |

完整目录和各区域之间的约定见 [docs/architecture.md](docs/architecture.md)。改动尽量留在一个区域；动到「共用基础」或别的区域时，改最小的范围并在说明里写出来。改之前先看附近已有的写法，照着写。工作区里与你无关的改动保持原样。

## 命令

在仓库根目录运行。脚本的准确定义以 `package.json` 为准。

| 命令 | 作用 |
| --- | --- |
| `bun install` | 安装依赖 |
| `bun run dev` | 本地开发（workerd 运行时，D1/R2 在 `.wrangler/state` 里本地模拟） |
| `bun run build` | 构建到 `dist/`。**必须是 `bun run build`**：`bun build` 是 Bun 自己的打包器，不会运行 Astro |
| `bun run preview` | 在 workerd 上预览构建结果（最接近线上）；可能在后台运行，用 `bunx astro preview stop` 停止 |
| `bun run check` | `astro check` 类型检查 |
| `bun x ultracite check` / `bun x ultracite fix` | Biome 检查 / 自动修复 TS、JS、CSS、JSON |
| `bun run lint` | 用 Prettier 格式化 `src/**/*.astro`（会直接改文件） |
| `bun run test` | 单元测试（`bun test tests`） |
| `bun run fonts` | 重新切分中文字体（源文件放 `fonts-src/`，见 `scripts/build-fonts.ts` 开头） |
| `bun run og` | 重新生成默认分享图 `public/og-default.png`（需要 `fonts-src/xiaolai-regular.ttf`） |
| `bun run diagrams` | 把笔记里的 Mermaid 块渲染成手绘 SVG（`src/assets/diagrams/`，要提交）；需要本机 Chrome（或 `CHROME_PATH`）和 `fonts-src/xiaolai-regular.ttf`，已有的跳过，`--force` 全部重画，升级 mermaid / svgo 后改 `DIAGRAM_CONFIG_VERSION` |
| `bun scripts/build-tapes.ts` | 重新生成纸胶带 `public/journal/tape/*.webp` |
| `bun scripts/build-papers.ts` | 把 `--desk` / `--doc` / `--sticky` 烘焙进纸纹（`public/journal/paper/{desk,doc,sticky}.jpg`）；改了这三个 token 或纹理后运行 |
| `bun scripts/build-cutout-assets.ts` | 复制 / 校验贴纸工坊的抠图文件（`public/ort/<版本>/`、`public/models/u2netp/`）；升级 `@huggingface/transformers` 后运行 |
| `bun run cf-typegen` | 改了 `wrangler.jsonc` 后重新生成 `worker-configuration.d.ts` |
| `bunx wrangler d1 migrations apply sonui-blog --local` | 创建 / 升级本地 D1（第一次跑 `dev` 前执行） |
| `bunx wrangler d1 migrations apply sonui-blog --remote` | 升级线上 D1（部署前执行） |
| `bunx wrangler deploy --dry-run` | 构建后检查 Worker 包 |
| `bun run build && bunx wrangler deploy` | 部署；首次部署和密钥设置见 [docs/deploy.md](docs/deploy.md) |

本地环境：`.env.example` 复制成 `.env`（构建时变量，如图片 alt 用的 `OPENROUTER_API_KEY`），`.dev.vars.example` 复制成 `.dev.vars`（Worker 变量和密钥，含 Turnstile 的 site key 和 secret）。Turnstile 的 site key 在运行时由 `/api/turnstile` 提供，不用写进构建；`.dev.vars.example` 里已经填好 Cloudflare 的测试 key，`.dev.vars` 里的 `ADMIN_DEV_BYPASS=1` 让本地 `/admin/` 不经过 Access。GitHub 登录的变量：`GITHUB_CLIENT_ID`（公开，线上在 `wrangler.jsonc` 的 `vars`）、`GITHUB_CLIENT_SECRET`（密钥）、`OWNER_GITHUB_ID`（博主 `sosyz` 的数字 id `30596875`，已写在 `wrangler.jsonc`）；本地不建 OAuth App 时，`.dev.vars` 的 `AUTH_DEV_LOGIN=1` 打开 `/api/auth/dev-login?login=&id=`（只对 localhost 生效，`ADMIN_DEV_BYPASS=1` 也会打开它）。详见 [docs/deploy.md](docs/deploy.md#10-github-登录可选)。

## 写一篇新笔记

1. **建文件**：`src/posts/<slug>.md`（需要组件时用 `.mdx`）。文件名就是 slug，用小写字母、数字和短横线，页面地址是 `/notes/<slug>/`。发布后不要改文件名；实在要改，在 `src/lib/seo/redirects.ts` 里加一条 301。
2. **写 frontmatter**（schema 在 `src/content.config.ts`，构建时校验）：

   ```yaml
   ---
   title: "通过 Cloudflare AI Gateway 使用 LLM"
   description: "资源准备、配置和使用示例。"
   type: 踩坑
   topic: AI
   tags: [AI, LLM, Cloudflare]
   status: 已解决
   related: [some-other-note]
   source: "https://example.com/original"
   pubDate: "2025-10-08"
   updatedDate: "2025-10-09"
   heroImage: "../assets/covers/cloudflare-ai-gateway-llama.png"
   ---
   ```

   | 字段 | 规则 |
   | --- | --- |
   | `title` | 必填。正文开头如果有和它完全相同的 `# 标题`，渲染时会去掉（抽屉已经显示标题）。 |
   | `description` | 必填，一句话摘要。显示在卡片上（索引卡最多 4 行，便利贴最多 6 行），也是 meta description、RSS 和 `llms.txt` 里的摘要。 |
   | `type` | 必填，`踩坑` 或 `随想`。踩坑是横线索引卡（标题、摘要、标签、日期戳，可带状态戳和拍立得）；随想是便利贴，只显示标题和摘要，要短到在画布上就能读完。 |
   | `topic` | 必填，只能一个，决定卡片在哪一堆。优先用已有主题：AI、Web、后端、Go、云原生、运维与网络、早年笔记。写新值就会多出一堆（见下一节）。 |
   | `tags` | 可选，数组。用于搜索；卡片上显示前 3 个。 |
   | `status` | 可选，只给解决具体问题的踩坑：`已解决`（朱红戳）或 `未解决`（没盖实的铅笔灰戳）。随想不写。 |
   | `related` | 可选，其它笔记的 slug 数组。关系是双向的：A 写了 B，B 的抽屉也列出 A，画布上画一条手绘线。slug 不存在时构建失败。 |
   | `source` | 可选，翻译或转载的原文，必须是完整 URL。显示在抽屉页眉和 `.md` 版本里。 |
   | `pubDate` | 必填，写成带引号的 `"YYYY-MM-DD"`。手账编号 No. 按发布日期排（最早的是 001），补一篇更早的笔记会让之后的编号都加一。 |
   | `updatedDate` | 可选。有实质更新时再填：它决定主题堆的顺序（最近更新的主题离中心最近）、堆内顺序和 sitemap 的 lastmod。 |
   | `heroImage` | 可选，相对路径（`../assets/covers/…` 或 `../assets/posts/<slug>/…`）。踩坑卡片上贴成拍立得（装饰性，`alt` 为空）；也是分享图（裁成 1200×630）。随想卡片不显示它。 |

3. **放配图**：放进 `src/assets/posts/<slug>/`，文件名用小写短横线，正文里写 `![替代文字](../assets/posts/<slug>/xxx.png)`。替代文字自己写，用中文描述图里的内容，不写「图片」「照片」这类词。只有图片的段落会显示成拍立得。构建时的 AI 替代文字（`src/lib/ai/image.ts`）只在图片完全没有 `alt` 属性时才调用，Markdown 图片总会带 `alt`，所以不要指望它补。
4. **用手账元素**（详见 [src/lib/markdown/README.md](src/lib/markdown/README.md)）：代码块写语言，想要文件名标签就写 ```` ```ts title="gateway.ts" ````；`==重点==` 画荧光笔；`> [!aside] 吐槽` 开头的引用块变成页边便利贴；脚注显示为「注释」。```` ```mermaid ```` 画成手绘图：块里先写 `accTitle: 一句话标题` 和 `accDescr: 一句话说明`（读屏软件读它们），然后 `bun run diagrams` 把图渲染成 `src/assets/diagrams/<哈希>.svg` 并一起提交；改了图就再跑一次。构建只内联这些 SVG，缺了就失败，不需要浏览器。
5. **画布会自动处理**：卡片进入对应主题堆；胶带颜色、回形针、倾斜角和偏移由 slug 决定，每次构建都一样；RSS、sitemap、`llms.txt`、`llms-full.txt`、`/notes/<slug>.md` 都自动包含新笔记。不需要手动摆放。
6. **预览**：`bun run dev`，打开 `/notes/<slug>/`，再看一眼 `/`（卡片在哪堆、摘要是否截断）和 `/notes/<slug>.md`。然后 `bun run fonts`（约 2 秒，把新笔记用到的字放进全站字体文件，否则这些字要多下载切片），最后跑 `bun run build`：frontmatter、`related`、图片路径的错误都在这一步暴露。

改已有笔记时只改需要改的地方。正文里有疑问的内容先记到 [docs/migration.md](docs/migration.md) 的「待作者确认」，由作者决定。

## 加一个主题

- 在笔记里写一个新的 `topic` 值即可。画布、列表筛选、`llms.txt` 的分组都会自动出现这个主题。
- 可选：在 `src/scripts/canvas/seed.ts` 的 `TOPIC_STICKERS` 里给它配一两张贴纸（第一张贴在主题名旁边，也用在抽屉页眉；第二张贴在这堆的右下角）。没有配置的主题不贴贴纸。
- 同步更新 [docs/design.md](docs/design.md) 和本文件里的主题列表。

## 加一条友链

友链只在 `src/data/links.ts` 里手写维护，画布的「友链」一角（前 6 张名片）、`/links/`、列表页底部的「友链」都从这里读。

1. 在 `FRIEND_LINKS` 末尾加一条：`{ name, url, description, avatar?, since? }`。`url` 必须是 `https://`；`name` 和网站都不能重复；`description` 一句话，最多 40 字；`since` 写 `"YYYY-MM-DD"` 或 `"YYYY-MM"`（名片上盖日期戳）。顺序就是显示顺序。
2. 头像（可选）：把方形图片（≥ 96×96，png / jpg / webp / avif，文件名小写短横线）放进 `src/assets/links/`，`avatar` 写文件名。构建时由 Astro 缩小并放在本站。头像一律存进仓库：CSP 的 `img-src` 只允许本站（和 GitHub 头像），外链图片会被拦。没有头像时显示手写首字圆圈。
3. `bun run build`：`src/lib/links.ts` 的 `checkedLinks` 检查每一条，头像文件不存在也会失败，错误里写明是第几条。然后 `bun run fonts`（名字和介绍里的新字进字体文件）、部署。

友链的规则有单元测试（`tests/links.test.ts`）；改规则时一起改。

## 版权

文章署名 Sonui，采用 CC BY-NC-SA 4.0。协议、转载说明、年份、备案号都在 `src/lib/seo/copyright.ts`（纯函数，`tests/copyright.test.ts`）：

- 每篇笔记末尾的版权纸条（`CopyrightSlip.astro`，在抽屉里 `<PostBody>` 之后、`[data-post-body]` 外面，划线评论不会落到它上面）；站点页脚一行（`SiteFooter.astro`：画布自我介绍卡、列表、`/links/`、`/privacy/`、404）。年份从最早一篇笔记的发布年到构建那年，每次构建自动更新。
- 源码（代码、样式、脚本、配置、文档）用 MIT，见根目录 `LICENSE`；文章和配图仍是 CC BY-NC-SA 4.0。页脚「隐私说明 · 开源许可」链到 `/licenses/`：用到的第三方库、字体、模型、素材及其许可证，数据在 `src/data/licenses.ts`（`tests/licenses.test.ts` 检查浏览器代码用到的 npm 包都列上了）。加依赖、字体或素材时同步更新它和 [ATTRIBUTIONS.md](ATTRIBUTIONS.md)。
- 给机器读的：`BlogPosting` 的 `license`、`copyrightHolder`、`copyrightYear`，笔记页 `<link rel="license">`，RSS 的 `<copyright>` 和每条的 `<dc:rights>` 加正文末尾一段版权说明，`llms.txt` / `llms-full.txt` 的协议一行，`/notes/<slug>.md` 的 YAML front matter（`url`、`license`、`license_url`）。机器读的地方用协议的规范地址 `LICENSE.url`，给人点的链接用中文版 `LICENSE.deed`。
- 备案号：`ICP_RECORD.number` 现在是空的，页脚不显示；填上（如 `"京ICP备12345678号-1"`）后所有页脚都出现一行链接到 `beian.miit.gov.cn`，再 `bun run fonts`、构建。

## 加一张手账贴纸

1. 准备 320×320、透明背景的 webp，控制在 20 KB 左右。必须是原创或可免费商用的素材。
2. 按类别命名放进 `public/stickers/`：`place-*`（地方）、`people-*`（人物）、`obj-*`（开发小物）。
3. 在 `src/scripts/canvas/seed.ts` 里引用：`TOPIC_STICKERS`（主题堆旁）或 `OUTER_STICKERS`（画布外圈）。`people-dog` 是博主头像（一只小黑猫；文件名和 key 保留旧名，别改），用在自我介绍卡、列表页和博主回复上。
4. 在 [ATTRIBUTIONS.md](ATTRIBUTIONS.md) 里写上来源和授权。

访客上传的贴纸走接口和审核，存在 R2，不进仓库。

## 改样式

- **颜色、字体、时长、曲线、阴影**：只用 `src/styles/tokens.css` 里的 token。需要新颜色时先加 token，并确认它来自文具（墨水、印泥、纸、胶带），文字对所在纸色的对比度不低于 4.5:1。
- **材质**：用 `src/styles/materials.css` 的类（`.doc-paper`、`.sticky-paper`、`.kraft-paper`、`.desk-paper`、`.tape`、`.clip`、`.stamp`、`.date-stamp`、`.polaroid`、`.sticker`、`.doodle`）。纸纹、胶带、回形针、涂鸦都是 `public/journal/` 里的真实素材；新材质也要找可商用的真实素材或原创绘制，写进 `ATTRIBUTIONS.md`。不要用 CSS 噪点、渐变去模拟纸或胶带的质感。
- **组件样式**：画布、卡片、抽屉、列表在 `src/styles/canvas.css`；正文在 `src/styles/prose.css`（作用域 `.post-body`）；互动组件用各自的 scoped `<style>`。材质类只管外观，位置由组件决定。
- **手账的样子**（详见 design.md「视觉」「手账组件」）：浅色纸面，只有浅色主题；点阵只画在桌面背景上；文档（索引卡、抽屉、列表）用更浅的纸色加阴影浮在桌面上；便利贴统一一种淡黄，不按主题或类型分色；代码只用三种墨水色；代码文字始终 `font-feature-settings: "calt" 0`。
- **动效**：每个动效都模拟真实材料（纸落下、被拿起、胶带、笔迹），只在加载和交互时出现，没有持续循环的背景动画；一般动作 150–350ms，用 `--out`（ease-out）；抽屉用 `--spring`（几乎察觉不到的回弹）。参数以 design.md 的动效清单为准。
- **减弱动效**：`prefers-reduced-motion: reduce` 时一切直接切换。`base.css` 已全局处理 CSS；脚本里的动画用 `src/scripts/canvas/api.ts` 的 `prefersReducedMotion()` 判断。
- **无障碍**：按钮写 `type`，有意义的图片写替代文字、装饰图片写 `alt=""`，保留可见的焦点框，交互元素能用键盘操作。

## 访客互动与审核

- 流程：前端表单拿到 Turnstile token → POST `/api/comments` 或 `/api/stickers` → 服务端检查同源、校验输入（`src/lib/server/validate.ts`）、验证 Turnstile、按 IP 哈希限频 → 写入 D1（贴纸图片写 R2）→ 交给审核器 → 状态为待审时只有提交者自己（localStorage 记的 id；登录的访客按账号）能看到「审核中」→ 博主在现场审核（见下一条）。接口表见 [docs/architecture.md](docs/architecture.md#访客内容接口互动)。
- **审核在现场**：`/admin/`（`src/pages/admin/index.astro` + `src/scripts/admin/inbox.ts`）只是收件箱，每张卡片链接到内容所在的地方：评论 `/notes/<slug>/?review=c:<id>#comments`，贴纸 `/?review=s:<id>`（`db.ts` 的 `reviewHref` 生成，`owner.ts` 解析）。页面上的审核工具（`src/scripts/interact/review-comments.ts`、`review-stickers.ts`）在那里通过、回复，按 `decide` 响应的 `next` 去下一条；拒绝和撤下没有按钮，是把评论纸条或贴纸拖进垃圾桶（或选中后按 Delete），「已扔掉 · 撤销」约 5 秒后才发请求（`trash.ts`、`comment-drag.ts`、`sticker-trash.ts`）。被撤下的评论能恢复，已公开的能改回复；贴纸扔掉会删图片、不能恢复。审核只认 Access：`owner.ts` 的 `canModerate()` 只在带 `interact:owner` 标记（`/admin/` 通过时 `setOwnerFlag()`）或 `?review=` 的浏览器里请求 `/api/admin/whoami`。`/admin/` 不打包内容集合，笔记标题在客户端从 `/llms.txt` 填。设计见 [docs/design.md](docs/design.md#审核)，路由和模块见 [docs/architecture.md](docs/architecture.md#在现场审核)。
- **GitHub 登录（可选）**：不登录的流程完全不变。登录的访客带 `sid` cookie 提交：跳过 Turnstile（仍要同源），作者 / 署名取 GitHub 资料，`user_id` 记账号，限频按 IP 和账号都算；**审核不变**，博主自己也先进待审。博主按 `OWNER_GITHUB_ID`（数字 id，不是 login）认：评论带「博主」戳，可以用 GitHub 会话整理贴纸；审核（`/admin/` 和页面上的审核工具）仍然只认 Access。代码：`src/lib/server/{auth,github,login,session,users,visitor}.ts`、`src/pages/api/auth/`、客户端 `src/scripts/interact/{auth,auth-menu}.ts`。流程、路由、表、cookie 见 [docs/architecture.md](docs/architecture.md#github-登录)。改了存储的字段、cookie 或 localStorage 键，同步改 `/privacy/`（`src/pages/privacy.astro`）。
- **挪动已贴的贴纸**（`src/scripts/interact/sticker-edit.ts`，拖动 / 旋转 / 缩放的手势与摆放共用 `sticker-transform.ts`）：
  1. **上传者挪自己的贴纸**：用 GitHub 登录时贴的贴纸记在账号上（`stickers.user_id`），任何设备登录后都能挪，不用口令。没登录时，POST `/api/stickers` 生成 256 位编辑口令（`src/lib/server/edit-token.ts`），只存加盐哈希 `edit_token_hash`，口令只在响应里返回一次；浏览器把 id + 口令记在 localStorage `interact:owned-stickers`（`sticker-store.ts`，审核通过后仍保留，被拒后删除）。点选自己的贴纸出现旋转 / 缩放手柄，松手（键盘和滚轮停下约 0.7 秒后）PATCH `/api/stickers/:id` 保存，所有人可见、不重新审核；待审和已通过的都能挪，已拒绝的不能。按访客 IP 哈希限频（每小时 60 次、每天 300 次，从 `moderation_log` 里带 IP 哈希的 `move` 和 `reject` 行计数，挪动和撕掉共用这个额度；博主不限）。上传者和博主也可以把贴纸撕下来扔进垃圾桶：`DELETE /api/stickers/:id`，权限同 PATCH，删除 R2 图片并把状态改为 `rejected`。
  2. **博主整理贴纸**：两条路。用 GitHub 登录为博主（`/api/auth/me` 的 `isOwner`）时直接显示「整理贴纸」，存到 PATCH `/api/stickers/:id`（不限频）。否则 `/admin/` 通过 Access 后在 localStorage 记 `interact:owner`；只有带这个标记（或地址带 `?review=`）的浏览器才请求 GET `/api/admin/whoami`，200 才显示「整理贴纸」，存到 PATCH `/api/admin/stickers/:id`。打开后所有访客贴纸都能像自己的一样挪。内置贴纸是代码的一部分，这个模式不保存它们的位置。
  3. **任何人只为自己挪贴纸**：所有贴纸（访客贴纸和内置的主题贴纸、头像小黑猫、外圈贴纸）都能拖，偏移（世界坐标 dx、dy）按贴纸存在 localStorage `interact:sticker-offsets`（`sticker-offsets.ts`；访客贴纸键 `vs:<id>`，内置贴纸用 `Canvas.astro` 里的 `data-sticker-key`）。只能拖，不能转或缩放。有偏移时工具条出现「贴纸放回原位」。偏移写在 `--dx` / `--dy`（`translate`）上，画布重新排版只改 left / top，不会丢。
  4. **博主扔掉内置贴纸**：博主（上面两条路任一条）撕下内置贴纸时也出现垃圾桶（聚焦后按 Delete 也行），「已扔掉 · 撤销」过后 POST `/api/builtins` `{key, hidden: true}`，所有访客都看不到它（表 `hidden_builtins`，`migrations/0001_init.sql`；`GET /api/stickers` 的 `hiddenBuiltins`；客户端 `builtin-hidden.ts`，localStorage `interact:hidden-builtins` 记上次的名单防闪烁）。`/admin/` 的「藏起来的自带贴纸」点「恢复」（`hidden: false`）。key 和缩略图都从 `src/lib/builtin-stickers.ts` 取，`Canvas.astro` 也用它生成 `data-sticker-key`。这个接口不在 `/api/admin/` 下（GitHub 登录的博主要能访问），自己检查 Access 或博主会话。
  - 按下贴纸不会拖动画布；移动不到 4px 算点击。每次保存的挪动都在 `moderation_log` 记一条 `move`（note 写旧 → 新位置），`/admin/` 的待审贴纸显示「挪过 N 次」。
- **贴纸工坊**：选图之后、摆放之前的一步（`src/scripts/interact/sticker-workshop.ts`，模态 `<dialog>`）。自动抠图、白边、手账滤镜都在访客浏览器里做，输出 ≤ 512×512、≤ 300 KB 的 WebP（不支持时 PNG），服务端限制不变。抠图 worker（`cutout.worker.ts`）用 transformers.js + ONNX Runtime Web 跑 U-2-Netp，所有文件自托管、打开开关才下载（约 18 MB）。约定和尺寸见 [docs/architecture.md](docs/architecture.md#贴纸工坊)。`@huggingface/transformers` 固定版本；升级时改 `cutout-assets.ts` 的 `ORT_VERSION` 并运行 `bun scripts/build-cutout-assets.ts`，`tests/cutout-assets.test.ts` 会检查。不要换成 asyncify / JSEP 版 wasm（超过 Workers 单文件 25 MiB）。
- `src/lib/server/` 里除 `env.ts` 外都是纯模块，有对应的单元测试；新逻辑也写成纯函数并在 `tests/` 里加测试。只有 `env.ts` 读绑定和密钥。
- 改表结构时新增 `migrations/000N_*.sql`，不要改已经应用过的迁移文件；然后本地和线上各执行一次 `d1 migrations apply`。
- **审核器**在 `src/lib/server/moderation.ts`：`Moderator.review(item)` 返回 `approve` / `reject` / `hold`，审核器抛错时一律按 `hold` 处理，每次决定写进 `moderation_log`。现在用的是 `ManualModerator`（全部等人工）。接入 AI 审核，调用方不用改：
  1. 在 `wrangler.jsonc` 加 Workers AI 绑定 `"ai": { "binding": "AI" }`，运行 `bun run cf-typegen`。
  2. 在 `src/lib/server/env.ts` 的 `moderator()` 里把 `ai: (prompt) => env.AI.run(<模型>, …)` 传给 `createModerator`（返回模型回复的文字）。**只设 `MODERATOR=ai` 不会生效**：现在 `env.ts` 没有传 `ai`，`createModerator` 会退回人工审核。
  3. 设置变量 `MODERATOR=ai`（`wrangler.jsonc` 的 `vars` 或 secret）。
  4. `AiModerator` 只审评论，贴纸一律交给人工；回答不明确时是 `hold`。改提示词或规则时同步更新 `tests/moderation.test.ts`。
  也可以写一个新的 `Moderator` 实现，在 `createModerator` 里注册。

## SEO 与 GEO（保持这些不变）

- 每篇笔记是独立的静态页面，正文直接在 HTML 里；画布上的卡片都是真实的 `<a href="/notes/<slug>/">`。不要把正文改成只靠脚本渲染。
- `<head>` 由 `src/components/seo/Seo.astro` 统一输出：canonical、Open Graph、Twitter 卡片；首页 `WebSite` + `Person` JSON-LD，笔记页 `BlogPosting` + `BreadcrumbList`，以及指向 `.md` 版本的 `rel="alternate"`。新页面通过 `Base` 的 props 传入，不要另写 meta。
- 给 AI 的入口：`/llms.txt`（按主题列出全部笔记的 `.md` 链接）、`/llms-full.txt`（全文）、`/notes/<slug>.md`（单篇 Markdown，图片换成绝对地址）、全文 RSS `/rss.xml`、`/sitemap-index.xml`。
- `robots.txt` 明确允许主要 AI 爬虫，只禁止 `/admin/` 和 `/api/`。Cloudflare 上不要开启「Block AI bots」或托管 robots.txt（见 deploy.md）。
- 旧链接的 301：Hexo 文章（`src/lib/seo/redirects.ts`，对照 docs/migration.md；带空格的旧地址写成 `%20`，大小写敏感）、`/about/` → `/`、`/blog/*` → `/notes/*`、标签/分类/归档（通配规则在 `src/lib/seo/redirect-rules.ts`，由 `src/integrations/legacy-list-redirects.ts` 追加到 `_redirects` 末尾）。改 slug 或删页面时补跳转，不要删已有的跳转。不要往 `public/_redirects` 写规则：第一条通配之后的规则都算动态规则，超过 100 条的部分会被静默丢弃（构建和 `tests/redirect-rules.test.ts` 会检查）。
- `/admin/`、`/api/`、404 不进 sitemap，也不被索引。

## 安全

- **不公开访客的邮箱和 IP。** 数据库只存加盐哈希（`email_hash`、`ip_hash`），公开接口只选明确列出的列；不要把邮箱、IP、UA 加进任何公开响应、页面或日志。评论者网址链接带 `rel="nofollow ugc"`。
- **每个匿名提交都要过 Turnstile**，服务端用 `src/lib/server/turnstile.ts` 验证（真实 key 还会校验 hostname 和 action）。只有带有效 GitHub 会话的请求可以跳过（`visitor.ts` 的 `needsTurnstile`），同源检查和限频照旧。新增提交入口时同样加同源检查、输入校验和限频。
- **GitHub 登录**：只申请 `read:user`；访问令牌用完即丢，不存、不打日志；`sessions` 只存 `sid` 令牌的 SHA-256；登录后的跳转只走 `safeNext`（防开放跳转）；OAuth `state` 放在 HttpOnly cookie 里常量时间比较。公开接口里账号只给 `login`、`name`、`avatarUrl`、`htmlUrl`。`AUTH_DEV_LOGIN` 和 `ADMIN_DEV_BYPASS` 一样只在本地用，不要设到线上。
- **后台由 Cloudflare Access 保护**，代码里也用 `src/lib/server/access.ts` 自己验证 JWT（RS256、`iss`、`aud`）。新的后台路由放在 `/admin/` 或 `/api/admin/` 下，并调用 `checkAdmin`。`ADMIN_DEV_BYPASS` 只对 localhost 生效，不要设到线上。
- **安全响应头和 CSP**：静态文件的在 `public/_headers` 的 `/*` 规则，Worker 响应的由 `src/middleware.ts` 从 `src/lib/server/http.ts` 的 `SECURITY_HEADERS` 补上，两处要一致（`tests/security-headers.test.ts`）。完整 CSP 目前是 Report-Only：新增外部来源（脚本、图片、iframe、字体）时两处一起改；不要写内联脚本或 `onload=` 之类的事件属性（`astro.config.mjs` 已禁止把小 `<script>` 内联进页面），改完在浏览器控制台确认没有 `[Report Only]` 违规。
- **密钥**（含 `GITHUB_CLIENT_SECRET`）只放 `.env`、`.dev.vars`（都已 gitignore）或 `wrangler secret put`。仓库里只出现 Cloudflare 公开的测试 key。博主的邮箱只写在 Access 策略里，不写进仓库。

## 不要做的事

- 不要提交密钥、`.env`、`.dev.vars`、真实的 Access / Turnstile / AI 配置。
- 不要用 `bun build`，用 `bun run build`。
- 不要把完整的中文字体文件放进 `public/` 或打包；字体一律经 `bun run fonts` 切片。`public/fonts/lxgw-wenkai/` 已不使用，但保留在仓库里，不要删。
- 不要引入 React、Tailwind 或其它 UI 框架；交互写成 TS 模块。
- 不要随手改笔记正文；只在作者要求或修明显的格式问题时改。
- 不要在按需路由（`prerender = false`）里用 `<Image>` / `getImage()`；图片服务只在构建时可用。
- 不要在被 `astro.config.mjs` 导入的文件里用 `@/` 别名或 `astro:*` 导入。
- 不要改写 git 历史，也不要丢弃工作区里别人的改动。

## 收尾检查清单

- [ ] `bun x ultracite fix`，然后 `bun x ultracite check` 没有新问题（改了 TS/JS/CSS/JSON 时）。
- [ ] `bun run lint`（改了 `.astro` 时）。
- [ ] `bun run check` 通过。
- [ ] `bun run test` 通过（改了 `src/lib/server/`、`src/scripts/interact/` 或 `tests/` 时）。
- [ ] `bun run build` 成功（不是 `bun build`）。
- [ ] 在 `bun run dev` 或 `bun run preview` 里实际打开改过的页面；交互改动再用键盘走一遍，并打开「减弱动效」看一遍。
- [ ] 改了 `wrangler.jsonc` 就跑 `bun run cf-typegen`；改了表结构就有新的迁移文件。
- [ ] 新素材写进 `ATTRIBUTIONS.md`；约定变了就更新 `docs/architecture.md`；设计实现状态变了就更新 `docs/design.md` 的「实现状态」。
- [ ] `git status` 里没有密钥文件，改动没有超出自己负责的区域（超出的在说明里列出）。

## 附录：Ultracite 规则

以下与 `.claude/CLAUDE.md` 相同。

# Project Context

Ultracite enforces strict type safety, accessibility standards, and consistent code quality for JavaScript/TypeScript projects using Biome's lightning-fast formatter and linter.

## Key Principles

- Zero configuration required
- Subsecond performance
- Maximum type safety
- AI-friendly code generation

## Before Writing Code

1. Analyze existing patterns in the codebase
2. Consider edge cases and error scenarios
3. Follow the rules below strictly
4. Validate accessibility requirements

## Rules

### Accessibility (a11y)

- Don't use `accessKey` attribute on any HTML element.
- Don't set `aria-hidden="true"` on focusable elements.
- Don't add ARIA roles, states, and properties to elements that don't support them.
- Don't use distracting elements like `<marquee>` or `<blink>`.
- Only use the `scope` prop on `<th>` elements.
- Don't assign non-interactive ARIA roles to interactive HTML elements.
- Make sure label elements have text content and are associated with an input.
- Don't assign interactive ARIA roles to non-interactive HTML elements.
- Don't assign `tabIndex` to non-interactive HTML elements.
- Don't use positive integers for `tabIndex` property.
- Don't include "image", "picture", or "photo" in img alt prop.
- Don't use explicit role property that's the same as the implicit/default role.
- Make static elements with click handlers use a valid role attribute.
- Always include a `title` element for SVG elements.
- Give all elements requiring alt text meaningful information for screen readers.
- Make sure anchors have content that's accessible to screen readers.
- Assign `tabIndex` to non-interactive HTML elements with `aria-activedescendant`.
- Include all required ARIA attributes for elements with ARIA roles.
- Make sure ARIA properties are valid for the element's supported roles.
- Always include a `type` attribute for button elements.
- Make elements with interactive roles and handlers focusable.
- Give heading elements content that's accessible to screen readers (not hidden with `aria-hidden`).
- Always include a `lang` attribute on the html element.
- Always include a `title` attribute for iframe elements.
- Accompany `onClick` with at least one of: `onKeyUp`, `onKeyDown`, or `onKeyPress`.
- Accompany `onMouseOver`/`onMouseOut` with `onFocus`/`onBlur`.
- Include caption tracks for audio and video elements.
- Use semantic elements instead of role attributes in JSX.
- Make sure all anchors are valid and navigable.
- Ensure all ARIA properties (`aria-*`) are valid.
- Use valid, non-abstract ARIA roles for elements with ARIA roles.
- Use valid ARIA state and property values.
- Use valid values for the `autocomplete` attribute on input elements.
- Use correct ISO language/country codes for the `lang` attribute.

### Code Complexity and Quality

- Don't use consecutive spaces in regular expression literals.
- Don't use the `arguments` object.
- Don't use primitive type aliases or misleading types.
- Don't use the comma operator.
- Don't use empty type parameters in type aliases and interfaces.
- Don't write functions that exceed a given Cognitive Complexity score.
- Don't nest describe() blocks too deeply in test files.
- Don't use unnecessary boolean casts.
- Don't use unnecessary callbacks with flatMap.
- Use for...of statements instead of Array.forEach.
- Don't create classes that only have static members (like a static namespace).
- Don't use this and super in static contexts.
- Don't use unnecessary catch clauses.
- Don't use unnecessary constructors.
- Don't use unnecessary continue statements.
- Don't export empty modules that don't change anything.
- Don't use unnecessary escape sequences in regular expression literals.
- Don't use unnecessary fragments.
- Don't use unnecessary labels.
- Don't use unnecessary nested block statements.
- Don't rename imports, exports, and destructured assignments to the same name.
- Don't use unnecessary string or template literal concatenation.
- Don't use String.raw in template literals when there are no escape sequences.
- Don't use useless case statements in switch statements.
- Don't use ternary operators when simpler alternatives exist.
- Don't use useless `this` aliasing.
- Don't use any or unknown as type constraints.
- Don't initialize variables to undefined.
- Don't use the void operators (they're not familiar).
- Use arrow functions instead of function expressions.
- Use Date.now() to get milliseconds since the Unix Epoch.
- Use .flatMap() instead of map().flat() when possible.
- Use literal property access instead of computed property access.
- Don't use parseInt() or Number.parseInt() when binary, octal, or hexadecimal literals work.
- Use concise optional chaining instead of chained logical expressions.
- Use regular expression literals instead of the RegExp constructor when possible.
- Don't use number literal object member names that aren't base 10 or use underscore separators.
- Remove redundant terms from logical expressions.
- Use while loops instead of for loops when you don't need initializer and update expressions.
- Don't pass children as props.
- Don't reassign const variables.
- Don't use constant expressions in conditions.
- Don't use `Math.min` and `Math.max` to clamp values when the result is constant.
- Don't return a value from a constructor.
- Don't use empty character classes in regular expression literals.
- Don't use empty destructuring patterns.
- Don't call global object properties as functions.
- Don't declare functions and vars that are accessible outside their block.
- Make sure builtins are correctly instantiated.
- Don't use super() incorrectly inside classes. Also check that super() is called in classes that extend other constructors.
- Don't use variables and function parameters before they're declared.
- Don't use 8 and 9 escape sequences in string literals.
- Don't use literal numbers that lose precision.

### React and JSX Best Practices

- Don't use the return value of React.render.
- Make sure all dependencies are correctly specified in React hooks.
- Make sure all React hooks are called from the top level of component functions.
- Don't forget key props in iterators and collection literals.
- Don't destructure props inside JSX components in Solid projects.
- Don't define React components inside other components.
- Don't use event handlers on non-interactive elements.
- Don't assign to React component props.
- Don't use both `children` and `dangerouslySetInnerHTML` props on the same element.
- Don't use dangerous JSX props.
- Don't use Array index in keys.
- Don't insert comments as text nodes.
- Don't assign JSX properties multiple times.
- Don't add extra closing tags for components without children.
- Use `<>...</>` instead of `<Fragment>...</Fragment>`.
- Watch out for possible "wrong" semicolons inside JSX elements.

### Correctness and Safety

- Don't assign a value to itself.
- Don't return a value from a setter.
- Don't compare expressions that modify string case with non-compliant values.
- Don't use lexical declarations in switch clauses.
- Don't use variables that haven't been declared in the document.
- Don't write unreachable code.
- Make sure super() is called exactly once on every code path in a class constructor before this is accessed if the class has a superclass.
- Don't use control flow statements in finally blocks.
- Don't use optional chaining where undefined values aren't allowed.
- Don't have unused function parameters.
- Don't have unused imports.
- Don't have unused labels.
- Don't have unused private class members.
- Don't have unused variables.
- Make sure void (self-closing) elements don't have children.
- Don't return a value from a function with the return type 'void'
- Use isNaN() when checking for NaN.
- Make sure "for" loop update clauses move the counter in the right direction.
- Make sure typeof expressions are compared to valid values.
- Make sure generator functions contain yield.
- Don't use await inside loops.
- Don't use bitwise operators.
- Don't use expressions where the operation doesn't change the value.
- Make sure Promise-like statements are handled appropriately.
- Don't use **dirname and **filename in the global scope.
- Prevent import cycles.
- Don't use configured elements.
- Don't hardcode sensitive data like API keys and tokens.
- Don't let variable declarations shadow variables from outer scopes.
- Don't use the TypeScript directive @ts-ignore.
- Prevent duplicate polyfills from Polyfill.io.
- Don't use useless backreferences in regular expressions that always match empty strings.
- Don't use unnecessary escapes in string literals.
- Don't use useless undefined.
- Make sure getters and setters for the same property are next to each other in class and object definitions.
- Make sure object literals are declared consistently (defaults to explicit definitions).
- Use static Response methods instead of new Response() constructor when possible.
- Make sure switch-case statements are exhaustive.
- Make sure the `preconnect` attribute is used when using Google Fonts.
- Use `Array#{indexOf,lastIndexOf}()` instead of `Array#{findIndex,findLastIndex}()` when looking for the index of an item.
- Make sure iterable callbacks return consistent values.
- Use `with { type: "json" }` for JSON module imports.
- Use numeric separators in numeric literals.
- Use object spread instead of `Object.assign()` when constructing new objects.
- Always use the radix argument when using `parseInt()`.
- Make sure JSDoc comment lines start with a single asterisk, except for the first one.
- Include a description parameter for `Symbol()`.
- Don't use spread (`...`) syntax on accumulators.
- Don't use the `delete` operator.
- Don't access namespace imports dynamically.
- Don't use namespace imports.
- Declare regex literals at the top level.
- Don't use `target="_blank"` without `rel="noopener"`.

### TypeScript Best Practices

- Don't use TypeScript enums.
- Don't export imported variables.
- Don't add type annotations to variables, parameters, and class properties that are initialized with literal expressions.
- Don't use TypeScript namespaces.
- Don't use non-null assertions with the `!` postfix operator.
- Don't use parameter properties in class constructors.
- Don't use user-defined types.
- Use `as const` instead of literal types and type annotations.
- Use either `T[]` or `Array<T>` consistently.
- Initialize each enum member value explicitly.
- Use `export type` for types.
- Use `import type` for types.
- Make sure all enum members are literal values.
- Don't use TypeScript const enum.
- Don't declare empty interfaces.
- Don't let variables evolve into any type through reassignments.
- Don't use the any type.
- Don't misuse the non-null assertion operator (!) in TypeScript files.
- Don't use implicit any type on variable declarations.
- Don't merge interfaces and classes unsafely.
- Don't use overload signatures that aren't next to each other.
- Use the namespace keyword instead of the module keyword to declare TypeScript namespaces.

### Style and Consistency

- Don't use global `eval()`.
- Don't use callbacks in asynchronous tests and hooks.
- Don't use negation in `if` statements that have `else` clauses.
- Don't use nested ternary expressions.
- Don't reassign function parameters.
- This rule lets you specify global variable names you don't want to use in your application.
- Don't use specified modules when loaded by import or require.
- Don't use constants whose value is the upper-case version of their name.
- Use `String.slice()` instead of `String.substr()` and `String.substring()`.
- Don't use template literals if you don't need interpolation or special-character handling.
- Don't use `else` blocks when the `if` block breaks early.
- Don't use yoda expressions.
- Don't use Array constructors.
- Use `at()` instead of integer index access.
- Follow curly brace conventions.
- Use `else if` instead of nested `if` statements in `else` clauses.
- Use single `if` statements instead of nested `if` clauses.
- Use `new` for all builtins except `String`, `Number`, and `Boolean`.
- Use consistent accessibility modifiers on class properties and methods.
- Use `const` declarations for variables that are only assigned once.
- Put default function parameters and optional function parameters last.
- Include a `default` clause in switch statements.
- Use the `**` operator instead of `Math.pow`.
- Use `for-of` loops when you need the index to extract an item from the iterated array.
- Use `node:assert/strict` over `node:assert`.
- Use the `node:` protocol for Node.js builtin modules.
- Use Number properties instead of global ones.
- Use assignment operator shorthand where possible.
- Use function types instead of object types with call signatures.
- Use template literals over string concatenation.
- Use `new` when throwing an error.
- Don't throw non-Error values.
- Use `String.trimStart()` and `String.trimEnd()` over `String.trimLeft()` and `String.trimRight()`.
- Use standard constants instead of approximated literals.
- Don't assign values in expressions.
- Don't use async functions as Promise executors.
- Don't reassign exceptions in catch clauses.
- Don't reassign class members.
- Don't compare against -0.
- Don't use labeled statements that aren't loops.
- Don't use void type outside of generic or return types.
- Don't use console.
- Don't use control characters and escape sequences that match control characters in regular expression literals.
- Don't use debugger.
- Don't assign directly to document.cookie.
- Use `===` and `!==`.
- Don't use duplicate case labels.
- Don't use duplicate class members.
- Don't use duplicate conditions in if-else-if chains.
- Don't use two keys with the same name inside objects.
- Don't use duplicate function parameter names.
- Don't have duplicate hooks in describe blocks.
- Don't use empty block statements and static blocks.
- Don't let switch clauses fall through.
- Don't reassign function declarations.
- Don't allow assignments to native objects and read-only global variables.
- Use Number.isFinite instead of global isFinite.
- Use Number.isNaN instead of global isNaN.
- Don't assign to imported bindings.
- Don't use irregular whitespace characters.
- Don't use labels that share a name with a variable.
- Don't use characters made with multiple code points in character class syntax.
- Make sure to use new and constructor properly.
- Don't use shorthand assign when the variable appears on both sides.
- Don't use octal escape sequences in string literals.
- Don't use Object.prototype builtins directly.
- Don't redeclare variables, functions, classes, and types in the same scope.
- Don't have redundant "use strict".
- Don't compare things where both sides are exactly the same.
- Don't let identifiers shadow restricted names.
- Don't use sparse arrays (arrays with holes).
- Don't use template literal placeholder syntax in regular strings.
- Don't use the then property.
- Don't use unsafe negation.
- Don't use var.
- Don't use with statements in non-strict contexts.
- Make sure async functions actually use await.
- Make sure default clauses in switch statements come last.
- Make sure to pass a message value when creating a built-in error.
- Make sure get methods always return a value.
- Use a recommended display strategy with Google Fonts.
- Make sure for-in loops include an if statement.
- Use Array.isArray() instead of instanceof Array.
- Make sure to use the digits argument with Number#toFixed().
- Make sure to use the "use strict" directive in script files.

### Next.js Specific Rules

- Don't use `<img>` elements in Next.js projects.
- Don't use `<head>` elements in Next.js projects.
- Don't import next/document outside of pages/\_document.jsx in Next.js projects.
- Don't use the next/head module in pages/\_document.js on Next.js projects.

### Testing Best Practices

- Don't use export or module.exports in test files.
- Don't use focused tests.
- Make sure the assertion function, like expect, is placed inside an it() function call.
- Don't use disabled tests.

## Common Tasks

- `npx ultracite init` - Initialize Ultracite in your project
- `npx ultracite fix` - Format and fix code automatically
- `npx ultracite check` - Check for issues without fixing

## Example: Error Handling

```typescript
// ✅ Good: Comprehensive error handling
try {
  const result = await fetchData();
  return { success: true, data: result };
} catch (error) {
  console.error("API call failed:", error);
  return { success: false, error: error.message };
}

// ❌ Bad: Swallowing errors
try {
  return await fetchData();
} catch (e) {
  console.log(e);
}
```
