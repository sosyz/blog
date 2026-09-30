# 架构

Blog 2.0：一本画在无限画布上的手绘手账。设计决定见 [design.md](design.md)，旧链接对照表见 [migration.md](migration.md)，部署步骤见 [deploy.md](deploy.md)。这份文档说明代码怎么组织、各部分归谁管、部分之间的约定（contract）。给编码助手的操作指南在仓库根目录的 [AGENTS.md](../AGENTS.md)。

## 技术栈

- **Astro 7.3**，页面在构建时预渲染（默认静态输出）。只有声明了 `export const prerender = false` 的路由（`src/pages/api/**`、`src/pages/admin/**`）按需在 Worker 上运行。`compressHTML: true`，`trailingSlash: "ignore"`。
- **@astrojs/cloudflare 14** → 一个带静态资源的 Cloudflare Worker（不用 Pages）。`imageService: "compile"`、`prerenderEnvironment: "node"`（构建时的图片服务要用 sharp 和 AI SDK）；`session: false`，所以不会自动创建 SESSION KV。
- **D1**（绑定 `DB`）存评论、贴纸信息、审核记录和 GitHub 登录的账号与会话；**R2**（绑定 `STICKERS`）存访客贴纸图片；**Turnstile** 做人机验证；**Cloudflare Access** 保护 `/admin/` 和 `/api/admin/*`；**GitHub OAuth App** 提供可选的访客登录（见「GitHub 登录」）。
- **不用 React，不用 Tailwind。** 交互是 Astro `<script>` 里的 TypeScript 模块；样式是纯 CSS：全局 token 和材质，加上组件内的 scoped `<style>`。原型是纯 CSS，直接移植过来。
- 页面之间用 **`<ClientRouter />`** 切换；画布是 `transition:persist="canvas"`，切换笔记时镜头保持不动。
- Markdown：Astro 7 默认的 Sätteri 处理器，通过 `@astrojs/markdown-satteri` 的 `satteri()` 固定版本并挂上自己的 mdast/hast 插件（`src/lib/markdown/`，详见那里的 [README](../src/lib/markdown/README.md)）。
- 构建时 AI 生成图片替代文字（`src/lib/ai/image.ts`）：只在图片完全没有 `alt` 属性时才调用；没有 `OPENROUTER_API_KEY` 时直接用兜底文字「一张图片」，构建不会失败。

## 目录

```text
astro.config.mjs          站点、adapter、集成、astro:env schema；从 src/lib 引入 markdown / redirects / sitemap 配置和 note-slugs 插件
wrangler.jsonc            Worker 名称、D1/R2 绑定（database_id 部署时填，见 deploy.md）
worker-configuration.d.ts `bun run cf-typegen` 生成的 Env 和运行时类型
src/worker.ts             Worker 入口（wrangler.jsonc `main`）：先用 src/lib/server/edge.ts 认出 EdgeOne 的回源请求（x-edge-auth + EDGE_ORIGIN_SECRET），改写成 blog.sonui.cn 的请求、取访客真实 IP，再交给 Astro
.dev.vars.example         本地 Worker 密钥模板（复制成 .dev.vars）
.env.example              构建时变量模板（OPENROUTER_API_KEY；可选的 TURNSTILE_SITE_KEY）
migrations/0001_init.sql  D1 全部表结构：users、sessions、comments、stickers、moderation_log、hidden_builtins（上线前合并成一个文件；以后改表新增 0002_*.sql）
scripts/build-fonts.ts    把 fonts-src/ 里的中文字体切片到 public/fonts/（bun run fonts），生成 src/layouts/fonts.generated.ts
scripts/font-chars.ts     build-fonts 用的纯函数：全站用字、unicode-range、回退字体度量
scripts/build-diagrams.ts 把笔记里的 ```mermaid 块用本机 Chrome 渲染成手绘 SVG（bun run diagrams），SVGO 压缩后写进 src/assets/diagrams/<哈希>.svg（提交），删掉不再用的
scripts/build-tapes.ts    把 scripts/assets/tape/ 的纸胶带缩到 public/journal/tape/
scripts/build-icons.ts    从 public/favicon.svg（手画的矢量小黑猫头）生成 favicon.ico（16/32/48）和 apple-touch-icon.png（180，纸色底）（bun run icons）
scripts/build-cutout-assets.ts  复制 ONNX Runtime Web 到 public/ort/<版本>/，校验 U-2-Netp 模型
tests/                    bun test 单元测试（src/lib/server 的纯模块、划线定位）
ATTRIBUTIONS.md           字体、纸纹、贴纸、库的授权（规范清单是 src/data/licenses.ts）
LICENSE                   源码 MIT（Copyright (c) 2025-2026 Sonui）；文章仍是 CC BY-NC-SA 4.0
public/
  _headers                静态资源的安全头（/*）、缓存规则、.md 的 canonical、llms-full.txt 的 noindex
  _redirects              只放注释；规则见 lib/seo/redirects.ts 和 lib/seo/redirect-rules.ts
  .assetsignore           不上传的文件（旧的 lxgw-wenkai、atkinson 字体）
  fonts/xiaolai/          小赖：全站用字的 woff2 + 其余字的小切片
  fonts/zhuque/           朱雀仿宋：同上（全站用字分成「每页都有」和「只在正文」两个文件）
  fonts/{xiaolai,zhuque}/OFL.txt  字体的版权行和 OFL 全文（切片丢了许可字段；bun run fonts 重写）
  fonts/rest.<hash>.css   其余切片的 @font-face（unicode-range 不含全站用字），不阻塞渲染
  journal/                纸纹、纸胶带、涂鸦、回形针、印章斑驳纹理、手账配件
  stickers/               16 张手账贴纸（webp）
  ort/<版本>/             贴纸工坊用的 ONNX Runtime Web（CPU wasm，约 14 MB），SOURCE.md 写来源和哈希
  models/u2netp/          贴纸工坊的抠图模型 U-2-Netp（约 4.6 MB），SOURCE.md、LICENSE.txt
  og-default.png          默认分享图（bun run og 生成）
src/
  content.config.ts       `blog` 集合的 schema
  consts.ts               自我介绍卡上的主人信息；站点名称等在 lib/seo/site.ts
  data/links.ts           友链（手写维护的 FRIEND_LINKS，见 AGENTS.md「加一条友链」）
  data/licenses.ts        第三方许可清单（/licenses/ 和 ATTRIBUTIONS.md 以它为准）；data/license-texts.ts 是 MIT / Apache-2.0 / OFL 全文
  posts/                  笔记（.md / .mdx）
  assets/posts/<slug>/    正文配图
  assets/covers/          封面图（卡片上的拍立得、分享图）
  assets/links/           友链头像（data/links.ts 的 avatar 写文件名，构建时缩小）
  assets/diagrams/        Mermaid 图的手绘 SVG（bun run diagrams 生成、提交；lib/markdown/diagrams.ts 内联进正文）
  layouts/Base.astro      页面外壳
  layouts/fonts.generated.ts  全站用字的 @font-face、preload 列表、rest.<hash>.css 地址（bun run fonts 生成；Base.astro 和 /admin/ 引用）
  middleware.ts           给 Worker 渲染的响应（/api/*、/admin/）补安全头，已有的同名头不覆盖
  integrations/legacy-list-redirects.ts  构建结束时把 /tags/* 等通配规则追加到 dist/client/_redirects 末尾并检查规则数
  components/
    seo/Seo.astro         <head> 元信息和 JSON-LD            （SEO）
    post/PostBody.astro   文章 HTML；post/marks.ts 画 Rough Notation （正文）
    canvas/*              画布、工具条、卡片、列表              （画布）
    drawer/Drawer.astro   包住 PostBody 的抽屉                  （画布）
    post/CopyrightSlip.astro  笔记末尾的版权纸条（作者、原文链接和复制、日期、协议）
    links/*               友链名片 FriendCard、交换友链便利贴 ExchangeCard、画布上的友链堆 FriendsPile
    site/SiteFooter.astro © 年份 · 协议 · 隐私说明 · 开源许可 · RSS（· 备案号）
    interact/*            评论、划线评论、贴纸、Turnstile        （互动）
  scripts/
    canvas/api.ts         客户端约定：CanvasApi 和抽屉事件
    canvas/*              布局、镜头、输入、抽屉动效、列表、工具条
    interact/*            评论、划线评论、贴纸上传、Turnstile、在现场审核的客户端逻辑
    admin/inbox.ts        /admin/ 审核台：记住博主、填笔记标题、直接拒绝
    copy.ts               复制按钮（button[data-copy]，document 上一个监听，结果写进 role="status"）
  lib/
    posts.ts              所有页面共用的文章查询
    links.ts              友链类型、构建时检查（https、不重复、一句话介绍、头像文件名、since）、JSON-LD，纯函数
    friends.ts            页面用的友链：检查后把头像文件名换成图片（import.meta.glob，只在构建时）
    build/modulepreload.ts  构建后给预渲染页面加 <link rel="modulepreload">（只含静态 import 的 chunk）
    markdown/             Markdown 管线（Sätteri 插件、代码墨水主题）
    seo/                  站点信息、版权与协议（copyright.ts）、跳转、sitemap、.md 输出、RSS 渲染、分享图脚本
    server/               API 和后台用的服务端模块（env.ts 以外都是纯函数）
    ai/, config.ts        AI 提供方和替代文字图片服务
    convert/img.ts        Bun/ffmpeg 图片转换工具（没有接入任何路由或脚本）
  styles/
    tokens.css            颜色、字体、曲线、时长、阴影、纹理 URL
    base.css              reset、焦点框、.sr-only、减弱动效
    materials.css         文档纸、便利贴、牛皮纸、桌面、胶带、回形针、印章、拍立得、贴纸、涂鸦
    canvas.css            画布、卡片、抽屉、列表、工具条
    prose.css             文章排版（.post-body）
  pages/                  路由（见下）
```

## 路由

| 地址 | 文件 | 渲染 | 负责区域 |
| --- | --- | --- | --- |
| `/` | `pages/index.astro` | 静态 | 画布（窄于 640px 先显示列表） |
| `/list/` | `pages/list.astro` | 静态 | 画布（按年分组，类型/主题筛选） |
| `/notes/<slug>/` | `pages/notes/[slug].astro` | 静态 | 画布（画布 + 打开的抽屉和全文） |
| `/notes/<slug>.md` | `pages/notes/[slug].md.ts` | 静态 | SEO |
| `/rss.xml` | `pages/rss.xml.ts` | 静态 | SEO（全文） |
| `/sitemap-index.xml` | @astrojs/sitemap + `lib/seo/sitemap.ts` | 静态 | SEO |
| `/robots.txt`、`/llms.txt`、`/llms-full.txt` | `pages/robots.txt.ts`、`pages/llms.txt.ts`、`pages/llms-full.txt.ts` | 静态 | SEO |
| 404 | `pages/404.astro` | 静态 | SEO |
| `/links/` | `pages/links.astro` | 静态 | 友链（全部名片 + 交换友链；JSON-LD `CollectionPage` + `ItemList`；在 sitemap 里） |
| `/privacy/` | `pages/privacy.astro` | 静态 | 互动（存了什么、怎么删除；改表、cookie、localStorage 键时同步） |
| `/licenses/` | `pages/licenses.astro` | 静态 | 友链与版权（开源许可：清单 `data/licenses.ts`，全文 `data/license-texts.ts`；在 sitemap 里） |
| `/admin/` | `pages/admin/index.astro` | 按需，Access 之后 | 互动（审核台：收件箱，链接到现场审核） |
| `/api/*` | `pages/api/**`（见「访客内容接口」「GitHub 登录」） | 按需 | 互动 |
| 旧 Hexo 链接、`/about/`、`/blog/*` | `lib/seo/redirects.ts`（静态）+ `lib/seo/redirect-rules.ts`（`/tags/*` 等通配，由 `integrations/legacy-list-redirects.ts` 追加到末尾）→ `dist/client/_redirects` | 301 | SEO |

## 负责区域

改动尽量留在一个区域里。确实要动别的区域时，改最小的范围，并在说明里写出来。

- **画布**：`src/components/canvas/**`、`src/components/drawer/**`、`src/scripts/canvas/**`、`src/styles/canvas.css`、`src/pages/index.astro`、`src/pages/list.astro`、`src/pages/notes/[slug].astro`
- **正文**：`src/components/post/**`、`src/lib/markdown/**`、`src/styles/prose.css`
- **互动 / 后端**：`src/components/interact/**`、`src/scripts/interact/**`、`src/lib/server/**`、`src/pages/api/**`、`src/pages/admin/**`、`src/pages/privacy.astro`、`migrations/**`、`wrangler.jsonc` 的绑定和 `vars`、`tests/**`
- **SEO**：`src/components/seo/**`、`src/lib/seo/**`、`src/pages/rss.xml.ts`、`src/pages/llms*.ts`、`src/pages/notes/[slug].md.ts`、`src/pages/404.astro`、`src/pages/robots.txt.ts`、`public/og-default.png`、`public/_redirects`、`public/_headers`
- **友链与版权**：`src/data/links.ts`、`src/lib/{links,friends}.ts`、`src/assets/links/**`、`src/components/links/**`、`src/components/site/**`、`src/components/post/CopyrightSlip.astro`、`src/pages/links.astro`、`src/lib/seo/copyright.ts`、`src/scripts/copy.ts`、`LICENSE`、`src/data/{licenses,license-texts}.ts`、`src/pages/licenses.astro`、`ATTRIBUTIONS.md`
- **共用基础（小心改）**：`astro.config.mjs`、`package.json`、`tsconfig.json`、`src/layouts/Base.astro`、`src/lib/posts.ts`、`src/styles/{tokens,base,materials}.css`、`src/scripts/canvas/api.ts`（约定本身）、`src/scripts/canvas/seed.ts`、`src/content.config.ts`、`public/journal/**`、`public/stickers/**`、`public/fonts/**`

## 数据流

1. **内容。** `src/posts/*.md` → `blog` 集合（`content.config.ts`）→ `src/lib/posts.ts`。页面都通过 `posts.ts` 读文章，不直接调用 `getCollection`，这样排序、编号和关联在各处一致。只有配置阶段的代码（`lib/seo/post-files.ts`，给 redirects、sitemap 和 `virtual:note-slugs` 用）直接读文件。
2. **页面。** 页面是静态 HTML。`/notes/<slug>/` 包含画布和打开的抽屉（里面是完整的 `<PostBody>`），所以不运行脚本也能读每篇笔记；画布上的每张卡片都是指向 `/notes/<slug>/` 的真实 `<a>`。
3. **客户端。** 画布脚本排布世界、处理拖动和缩放，并发布 `CanvasApi`（见下）。点击卡片由 ClientRouter 导航；保留下来的画布保持镜头，抽屉内容被替换，然后画布发出 `drawer:rendered`。互动脚本监听这些事件。
4. **访客内容。** 评论和贴纸表单拿到 Turnstile token 后 POST 到 `/api/*`（Worker）；用 GitHub 登录的访客带着 `sid` cookie 提交，不用 Turnstile。服务端验证 Turnstile（`https://challenges.cloudflare.com/turnstile/v0/siteverify`），把内容存进 D1（图片存 R2），交给审核器（通过 / 拒绝 / 待人工），默认全部待人工。提交者在自己的浏览器里能看到「审核中」（登录的访客换设备也能看到）。`/admin/` 和 `/api/admin/*` 校验 Access JWT（`Cf-Access-Jwt-Assertion` 头或 `CF_Authorization` cookie，按 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` 验签，RS256，校验 `iss` 和 `aud`）。博主在 `/admin/` 看到待审列表，点一条跳到笔记页或画布上，由页面里的审核工具调用 `/api/admin/*` 审核（见「在现场审核」）。

## 约定

### 页面外壳和 head

- `src/layouts/Base.astro` 的 props = `Seo` 的 props + `bodyClass?: string`。插槽：默认（body）、`head`（额外的 head 标签）。它加载字体（内联 `src/layouts/fonts.generated.ts` 里全站用字文件和度量匹配回退字体的 @font-face，preload 朱雀仿宋的第一个文件；`/fonts/rest.<hash>.css` 以 `media="print"` 加载、载入后切成 `all`；`@fontsource/maple-mono/latin-400.css`）、`tokens.css`、`base.css`、`materials.css`、`<Seo>` 和 `<ClientRouter />`。`<html lang="zh-CN">`。
- `src/components/seo/Seo.astro` 的 props：`title?`（不带站点后缀；首页不传）、`description?`、`canonical?`（路径，如 `/notes/go-context/`）、`type?: "website" | "article"`、`image?: ImageMetadata`、`publishedTime?`、`modifiedTime?`、`tags?`、`noindex?`、`jsonLd?`。
  - 首页输出 `WebSite` + `Person` JSON-LD。
  - `canonical` 是笔记地址时，自动查出文章，输出 `BlogPosting` + `BreadcrumbList` JSON-LD，并加 `<link rel="alternate" type="text/markdown">` 指向 `.md` 版本。
  - `image`（文章的 `heroImage`）在构建时裁成 1200×630 JPEG；没有时用 `public/og-default.png`。按需路由不要传 `image`（图片服务只在构建时可用）。
- 站点名称、描述、作者、JSON-LD 节点：`src/lib/seo/site.ts`（没有 `astro:*` 导入，配置文件也在用）。

### 文章和互动组件

- `post/PostBody.astro` — `{ entry: Post }`。文章渲染在带 `data-post-body`（和 `data-slug`）的元素里，`<Content />` 必须是它的直接子元素：划线评论和页边便签选择 `:scope > p`、`:scope > ul > li` 等。
- `interact/AuthMenu.astro` — 无 props，放在工具条里：登录后显示 GitHub 头像，点开是「退出登录」；没登录时隐藏（登录入口在各个表单上）。
- `interact/Comments.astro` — `{ slug }`；`interact/InlineComments.astro` — `{ slug }`；`interact/StickerLayer.astro` — 无 props；`interact/StickerUpload.astro` — 无 props；`interact/Turnstile.astro` — `{ action: string }`。抽屉把 `Comments` 和 `InlineComments` 放在「相关 / 同一主题」之后；画布放 `StickerLayer`；`StickerUpload` 放在工具条的插槽里。

### 文章查询（`src/lib/posts.ts`）

| 函数 | 返回 |
| --- | --- |
| `getPosts()` | 全部文章，按 `pubDate` 从新到旧 |
| `getPost(slug)` | 一篇文章或 `undefined` |
| `getTopics()` | `Topic[]`（`{ name, posts, latest }`），最近更新的主题在前；主题内按最近更新排序（即堆内顺序） |
| `getNoteNumber(slug)` / `formatNoteNumber(n)` | 手账编号，最早的文章是 1；`"007"` |
| `getRelated(slug)` | 双向 `related`（目标不存在时构建报错） |
| `getSameTopic(slug)` | 同一堆里的其它文章，堆内顺序 |
| `getTopicNeighbours(slug)` | `{ previous, next }`，堆内顺序，用于上一篇 / 下一篇 |
| `getPostsByYear()` | 列表页用的 `{ year, posts }[]` |
| `getNoteSummaries()` | 给客户端脚本的 JSON 安全摘要 `NoteSummary[]` |
| `notePath(slug)` | `/notes/<slug>/` |
| `lastUpdated(post)` | `updatedDate ?? pubDate` |
| `isoDate`、`dotDate`、`weekdayZh` | `2025-10-08`、`2025.10.08`、`周三`（固定按 Asia/Shanghai 时区） |

slug 就是集合 id（文件名去掉扩展名）。

### 友链与版权

- **友链数据**：`src/data/links.ts` 的 `FRIEND_LINKS: FriendLink[]`（`{name, url, description, avatar?, since?}`）。页面只通过 `src/lib/friends.ts` 的 `getFriends()` 读：先 `checkedLinks()`（`lib/links.ts`，有问题就让构建失败并列出每一条），再把 `avatar` 文件名换成 `src/assets/links/` 里的 `ImageMetadata`（`Friend.image`），名片用 `<Image>` 缩到 88px。头像不能用外链（CSP `img-src` 只有本站和 GitHub 头像）。
- **画布上的友链堆**（`components/links/FriendsPile.astro`，放在 `Canvas.astro` 的主题堆之后）：`section.pile.friends[data-friends]`，里面是前 `CANVAS_FRIENDS`（6）张名片（两列 CSS grid）和「全部友链 →」；没有友链时是「交换友链」便利贴。`layout.ts` 的 `layoutFriends` 把它当成一个盒子，在所有主题堆之后用同一条螺旋找空位，放进 `taken`，所以外圈贴纸绕开它、主题堆顺序不变。它**不带** `data-pile` / `data-card`：搜索、连线、抽屉、焦点回到卡片都只认笔记。标题「友链」是去 `/links/` 的普通链接（不进抽屉：抽屉和评论都按笔记 slug 工作）。入场动画和 `setStagger` 包括 `.friend`、`.exchange`。
- **名片**（`FriendCard.astro`）：整张是外链 `target="_blank" rel="noopener noreferrer"`，末尾有 sr-only「（在新标签页打开）」；胶带、倾斜、首字墨水色（`--link` / `--str` / `--stamp-ink` / `--pencil`）按名字取种子。
- **交换友链**（`ExchangeCard.astro`，props `id`、`headingTag`）：怎么申请（任意笔记下留言或 GitHub），本站名片（`lib/links.ts` 的 `SELF_CARD`：名称、地址、`PROFILE.title`、头像贴纸（小黑猫，`people-dog.webp`）绝对地址），每项一个复制按钮。
- **复制按钮**（`src/scripts/copy.ts`）：`<button type="button" data-copy="文字" data-copy-status="<id>">`，`<id>` 是页面里已有的 `role="status"` 元素；成功写「已复制」，失败写「没复制成功，请手动选中复制」，约 2.4 秒后清空。document 上只挂一次监听，抽屉换页后照样有效。
- **版权**：协议、转载说明、备案号、年份和各种输出格式在 `src/lib/seo/copyright.ts`（纯函数，只用相对导入）。`LICENSE.url` 是规范地址（JSON-LD `license`、`<link rel="license">`、RSS、`.md`），`LICENSE.deed` 是中文说明页（页面上的链接）。`copyrightYears(dates, now)` 按上海时区取年：最早一篇笔记的年份到构建时的年份；`SiteFooter` 和 RSS 的 `<copyright>` 用它。`ICP_RECORD.number` 为空时页脚不显示备案行。
- **开源许可**：`src/data/licenses.ts` 的 `COMPONENTS`（`{id, name, npm?, version?, license, copyright, url, usedFor, group, shipsToBrowser, licenseFile?, notice?}`）是第三方许可的规范清单，`/licenses/` 按 `GROUPS` 分组显示，`id` 是锚点（贴纸工坊链到 `#u2netp`）；有 `npm` 的项构建时从 `node_modules/<pkg>/package.json` 读版本（`npmVersion`，读不到就不显示）。许可证全文在 `src/data/license-texts.ts`（`MIT_TEXT`、`APACHE_2_0_TEXT`、`OFL_1_1_TEXT`、`oflFile`），两者都只用相对导入；`scripts/build-fonts.ts` 用 `oflFile(FONT_COPYRIGHT.<family>)` 写 `public/fonts/<family>/OFL.txt`。`tests/licenses.test.ts` 扫描浏览器代码（`src/scripts` 等的 TS 和 `.astro` 的 `<script>`）里的 npm 包，没列进清单就失败，也检查 OFL.txt 与 `oflFile` 一致、`LICENSE` 的内容。
- **版权纸条**（`CopyrightSlip.astro`）在 `Drawer.astro` 里 `<PostBody>` 之后、`.dfoot` 之前，不在 `[data-post-body]` 里。原文链接是 `noteUrl(slug)`；「更新于」只在 `updatedDate` 和发布日不同时显示；状态行 id 是 `note-copy-status`。
- **机器可读**：`Seo.astro` 的 `BlogPosting` 展开 `licenseFields(pubDate)`（`license`、`copyrightHolder: {"@id": PERSON_ID}`、`copyrightYear`）并在笔记页输出 `<link rel="license">`；`rss.xml.ts` 频道 `<copyright>`、每条 `<dc:rights>` 和正文末尾的 `feedItemFooter`；`llms.txt` / `llms-full.txt` 开头的 `llmsLicenseLine()`（不以 `- [` 开头，`/admin/` 按那个格式解析笔记标题）；`/notes/<slug>.md` 用 `noteMarkdown(post, { frontMatter: true })` 在开头加 YAML front matter（`title`、`description`、`author`、`url`、`published`、`updated?`、`license`、`license_url`、`based_on?`），`llms-full.txt` 不加 front matter，只在每篇的头部列表里多一行「协议」。

### 访客内容接口（互动）

全部是 JSON；出错时返回 `{ "error": "<中文说明>" }`。POST 必须同源（`Origin` 或 `Sec-Fetch-Site`）。服务端代码在 `src/lib/server/`：除 `env.ts` 外都是纯模块（只有 `env.ts` 导入 `cloudflare:workers` 和 `astro:env/server`），因此可以直接单元测试。表结构：`migrations/0001_init.sql`。带有效 `sid` cookie 的请求是「登录的访客」（`env.ts` 的 `viewerOf` → `session.ts` 的 `resolveViewer`），见下一节「GitHub 登录」。

| 路由 | 作用 |
| --- | --- |
| `GET /api/comments?slug=&mine=id,id&me=1` | `{comments, mine, ownPending}`：已通过的评论（`kind` 为 comment/inline、`anchor`、博主回复 `reply`；登录时写的带 `user: {login, name, avatarUrl, htmlUrl}`，匿名的是 `null`；`isOwner` 为真时显示「博主」戳；登录评论的公开 `name` 是 `user.name || user.login`，`site` 是 GitHub 主页）+ `mine`：访客自己那些 id 的状态；登录时 `mine` 还包括这个账号在这篇笔记下待审的评论，`ownPending` 是它们的全文（换设备也能显示「审核中」）。页面认为自己已登录时带 `me=1` |
| `POST /api/comments` | 匿名：`{slug, kind, name, email?, site?, body, parentId?, anchor?: {exact, prefix}, turnstile}` → `{id, status}`。登录：不要 `name`、`email`、`site`、`turnstile`（发了也忽略），作者取 GitHub 资料，`user_id` 记这个账号 |
| `GET /api/stickers?mine=&me=1` | `{stickers, mine, owned, ownPending, hiddenBuiltins}`：`hiddenBuiltins` 是博主扔掉的自带贴纸的 `data-sticker-key`（所有访客的画布都藏起来）；已通过的贴纸，世界坐标（`x`、`y` 是中心，`rotation`、`scale`、`width`、`height`、`src`）；登录时 `owned` 是这个账号没被拒绝的贴纸 id（最近 50 张，可以挪），`ownPending` 是它待审的贴纸，`mine` 也包括这些 id 的状态 |
| `POST /api/stickers` | multipart：`image`（≤ 300 KB，PNG/WebP/GIF/JPEG，≤ 512×512）+ `x, y, rotation, scale, name?, turnstile` → `{id, status, token}`（`token` 是编辑口令，只返回这一次，服务端只存加盐哈希）。登录：不要 `turnstile`，署名是 GitHub 用户名，`user_id` 记这个账号 |
| `POST /api/builtins` | 博主把自带贴纸扔进垃圾桶或从审核台恢复：JSON `{key, hidden}` → `{key, hidden, hiddenBuiltins}`（整张名单）。`key` 是 `data-sticker-key`（`src/lib/builtin-stickers.ts` 的 `BUILTIN_KEY`，最长 100）；`hidden: true` 只接受画布上有的贴纸（否则 404），`hidden: false` 接受任何格式正确的 key。允许 Cloudflare Access 登录（`checkAdmin`，含本地 `ADMIN_DEV_BYPASS`；这个路径不在 Access 应用里，靠全站的 `CF_Authorization` cookie）或博主的 GitHub 会话（`OWNER_GITHUB_ID`）；都不是时 401（有 GitHub 会话但不是博主、或 Access 令牌无效时 403）。故意不放在 `/api/admin/` 下：那里在边缘就被 Access 挡住，GitHub 登录的博主进不去。同源检查、16 KB 请求体上限；幂等（再藏一次保留第一次的 `hidden_at` / `hidden_by`，再恢复一次什么也不做）。不写 `moderation_log`（它的 `item_type` 只允许评论和贴纸），`hidden_builtins` 自己记谁、什么时候藏的。匿名 `GET /api/stickers` 有边缘缓存，别的访客最多晚 5 分钟看到 |
| `GET /api/stickers/:id/image` | 从 R2 读图片；待审的只给管理员（Access 或本地绕过）、上传它的账号、博主的 GitHub 会话 |
| `PATCH /api/stickers/:id` | 挪一张贴纸（待审或已通过）：`{x, y, rotation, scale, token?}` → `{id, x, y, rotation, scale}`（存下的位置）。允许三种人（`sticker-move.ts` 的 `planMove`）：带编辑口令的上传者浏览器（`token` 和 `edit_token_hash` 常量时间比较）、上传它的 GitHub 账号（任何设备，不用口令）、博主的 GitHub 会话（整理贴纸，不限频）。都不满足或没有这张贴纸是 404，已拒绝 409；不要 Turnstile、不重新审核；限频 429。`moderation_log` 的 note 按来源加前缀：`编辑口令：`、`GitHub @<login>：`、`博主整理贴纸：`（`visitor.ts` 的 `moveActor`） |
| `DELETE /api/stickers/:id` | 撕掉一张贴纸：JSON `{token?}`（登录的上传者或博主可以不带口令，空请求体也行）→ 204，无响应体。允许的人和 `PATCH` 完全相同（`sticker-move.ts` 的 `authoriseStickerEdit`，`planDelete`）；没有这张贴纸或不是你的都是同样的 404（连错误文字都一样）。效果：`status = 'rejected'`、写 `decided_at`（之后不能再通过，和博主撤下一样），删掉 R2 图片，`moderation_log` 记一条 `reject`（actor 同挪动：`visitor:owner` / `user:<login>` / `owner:github:<login>`，note `上传者撕掉了`，博主是 `博主扔掉了`）。已经被拒绝的再撕一次也返回 204（只重试删 R2 图片，不再记日志），所以可以放心重试。同源检查、16 KB 请求体上限；和挪动共用限频（429），博主不限频。匿名 `GET /api/stickers` 在边缘缓存 5 分钟，别的访客最多 5 分钟后才看不到它 |
| `GET /api/admin/queue` | 审核台和工具条「待审 N」用：`{comments, stickers, recent, counts}`。待审评论和贴纸各最多 200 条，最早的在前；`recent` 是最近通过的评论；`counts: {comments, stickers}` 是全部待审条数（不受 200 条限制）。每条都带 `href`（现场审核的地址，见「在现场审核」）。需要 Access JWT |
| `GET /api/admin/comments?slug=` | 笔记页的现场审核：`{pending, hidden}`，这篇笔记待审的评论（普通和划线，带 `anchor`，最早的在前）和被拒绝 / 撤下的评论（最新的在前，最多 50 条，可以恢复）。每条是公开评论的字段加 `status`、`createdAt`、`fingerprint`（IP 哈希前 8 位）；不返回邮箱哈希、完整 IP 哈希和 UA。需要 Access JWT，不缓存 |
| `GET /api/admin/stickers` | 画布的现场审核：`{pending}`，全部待审贴纸（位置、`src`、`status`、`createdAt`、`fingerprint`），最早的在前。图片走 `GET /api/stickers/:id/image`。需要 Access JWT，不缓存 |
| `POST /api/admin/decide` | `{type: comment/sticker, id, decision: approve/reject/hold/reply, reply?}` → `{ok, id, decision, status, next}`。待审和已处理的都能改：已通过的评论 `reject` 就是撤下，被拒绝的评论 `approve` 就是恢复；`reply` 只设置博主回复（`""` 删除），`reply` 字段跟着 approve / reject / hold 发也一样生效；贴纸不能回复。贴纸 `reject` 同时删掉 R2 图片，之后再 `approve` 返回 409（撤下贴纸不可恢复）。已经是这个状态时返回 200、不重复记日志。`status` 是处理后的状态；`next` 是除这一条以外最早的待审（`{type, id, href}`，没有时 `null`），给「下一条」用。需要 Access JWT，同源 |
| `PATCH /api/admin/stickers/:id` | 博主挪任意访客贴纸（整理贴纸）：`{x, y, rotation, scale}`，需要 Access JWT，校验同上 |
| `GET /api/admin/whoami` | 已登录 Access（或本地绕过）时 200 `{ok: true}`，否则 401 / 403 / 503。画布先看 `/api/auth/me` 的 `isOwner`；不是博主的 GitHub 会话时，只在 localStorage 有 `interact:owner`（打开过 `/admin/`）或地址带 `?review=` 时才请求它（`owner.ts` 的 `canModerate`），用 `redirect: "manual"`，200 时记上标记，不是 200 就清掉 |

- 输入校验：`src/lib/server/validate.ts`（长度上限、控制字符和不可见字符过滤、划线原文 2–200 字）。
- 评论只接受存在的笔记：`virtual:note-slugs`（`src/lib/seo/note-slugs.ts` 在构建时生成 slug 集合），Worker 不需要打包内容集合。
- 审核：`src/lib/server/moderation.ts`（`Moderator.review(item)` → `approve` / `reject` / `hold`）。现在启用的是 `ManualModerator`（全部 hold）；`AiModerator` 是写好说明、没有启用的桩。接入方法见 [AGENTS.md](../AGENTS.md#访客互动与审核)。审核器出错一律按 hold 处理。每次决定都写入 `moderation_log`。
- 频率限制（按加盐 IP 哈希：IPv4 地址或 IPv6 的 /64，从 D1 已有的行计数，不额外写入）：评论每小时 6 条、每天 20 条；贴纸每小时 3 张、每天 6 张；挪或撕掉自己的贴纸合计每小时 60 次、每天 300 次（数 `moderation_log` 里带 `ip_hash` 的 `move` 和 `reject` 行；上传和审核记的行不带 `ip_hash`，不算）。登录的访客同时按 IP 和按账号（`user_id`）计数，额度相同；博主整理贴纸不限频。接口在 Turnstile 之前先数一次（快速返回 429），真正起作用的是写入时的检查：`db.ts` 的 `insertComment` / `insertSticker` 用条件 `INSERT … SELECT … WHERE (SELECT COUNT(*) …) < 额度`，挪 / 撕用 `moveStickerWithinLimit` / `tearOffStickerWithinLimit` 把同样的条件放进同一个 batch，没写入就是 429，所以并发请求也绕不过。贴纸先写 D1 行（先存为 `pending`）再上传 R2（`src/lib/server/sticker-store.ts` 的 `storeSticker`，和客户端的 `src/scripts/interact/sticker-store.ts` 同名但无关），被限流的请求不会留下图片；上传失败会删掉这一行。
- 挪贴纸：位置按上传时的范围校验（`validate.ts` 的 `stickerMoveInput` / `adminMoveInput`，必须是 JSON 数字），按同样的精度取整（`sticker-limits.ts` 的 `roundPlacement`，客户端也用它的范围）；判断逻辑是纯函数 `sticker-move.ts` 的 `planMove`。每次保存写两行：更新 `stickers` 的位置和 `updated_at`，加一条 `moderation_log`（`decision = 'move'`，actor `visitor:owner` 或 `admin:<email>`，note 写旧 → 新位置）。位置没变时不写。
- 缓存（`visitor.ts` 的 `listCacheHeaders`）：匿名、不带 `mine=` / `me=1` 的 `GET /api/stickers` 在边缘缓存 5 分钟（`s-maxage=300`），`GET /api/comments` 1 分钟，所以别人最多晚 5 分钟看到挪动后的位置，撕掉的贴纸也可能还显示 5 分钟（已通过贴纸的图片地址按一年缓存，R2 里删了之后，已经缓存过的地方仍可能打开它）；带 `mine=`、`me=1` 或有效会话的请求是 `private, no-store`。两个接口都带 `Vary: Cookie`。
- 隐私：不保存原始邮箱和 IP。`email_hash`、`ip_hash` 都加盐（`IP_HASH_SALT`，未设置时用 Turnstile secret），公开接口不返回这两列和 `ua`。登录的访客也照样记 `ip_hash`（限频），`email_hash` 为空。面向访客的说明在 `/privacy/`（`src/pages/privacy.astro`）：改了存储的字段、cookie 或 localStorage 键时同步改它。
- Turnstile action：`comment`、`inline`、`sticker`。用真实 key 时校验 hostname 和 action；用 Cloudflare 测试 key 时 siteverify 返回 `result_with_testing_key`，跳过这两项。带有效 GitHub 会话的 POST 不验证 Turnstile（`visitor.ts` 的 `needsTurnstile`）：同源检查 + SameSite=Lax 的 `sid` 已经说明是本人在本站提交。
- 本地后台：`.dev.vars` 里 `ADMIN_DEV_BYPASS=1` 时跳过 Access，只对 localhost / 127.0.0.1 的请求生效。
- `/admin/` 是独立页面（不用 `Base`，避免把构建时的图片服务和内容集合打进 Worker），响应带 `noindex`、`frame-ancestors 'none'`。它在服务端直接调用 `db.ts` 的 `adminQueue`，把待审评论和贴纸按时间混排成卡片，整张卡片链接到 `href`；「从第一条开始」是最早一条的 `href`。笔记标题在客户端从 `/llms.txt` 填（`src/scripts/admin/inbox.ts`，读不到时显示 slug），所以 `/llms.txt` 每行 `- [标题](…/notes/<slug>.md)` 的格式改了要同步改这里。「直接拒绝」点两下才发 `decide`，之后按响应的 `next` 更新计数和「从第一条开始」。
- 客户端：`src/scripts/interact/`。评论和划线评论共用 `store.ts`；访客自己待审的条目存在 localStorage，每次加载通过 `mine=` 对账。GitHub 登录的客户端：
  - `auth.ts`：`getAuth()`（每次整页加载只请求一次 `/api/auth/me`，ClientRouter 换页时沿用）、`authNow()`（不等待，`/me` 回来前是 null）、`refreshAuth()`、`subscribe(fn)`（登录状态变化时通知，退出登录后各处原地更新，不刷新页面）；还有登录链接、表单上方的登录条、`已登录，不用人机验证` 提示。登录时表单隐藏昵称、邮箱、网址和 Turnstile 状态行。
  - `comment-view.ts`：纯函数，评论者名字、头像圆圈（GitHub 头像或手写首字）、「博主」戳的 HTML。
  - `auth-menu.ts` + `components/interact/AuthMenu.astro`：工具条头像和「退出登录」（disclosure，不是 ARIA menu）。
  - 测试：`tests/interact-auth.test.ts`。

#### 在现场审核

审核发生在内容所在的页面，`/admin/` 只是入口。设计见 [design.md](design.md#审核)。

- **深链接**（`db.ts` 的 `reviewHref`，客户端 `owner.ts` 的 `parseReview` / `reviewValue`）：评论和划线评论 `/notes/<slug>/?review=c:<id>#comments`，贴纸 `/?review=s:<id>`。id 是 UUID、slug 是 `[a-z0-9-]`，不用转义。
- **`src/scripts/interact/owner.ts`**：`canModerate()`（Access 会话在不在：只有带 `interact:owner` 标记或 `?review=` 的浏览器才请求 `/api/admin/whoami`，每次整页加载一次，`resetModerate()` 在动作返回 401 / 403 后重新问）、`isGithubOwner()`（GitHub 登录的博主，只能整理贴纸，不能审核）、`reviewTarget()`、`setOwnerFlag()` / `clearOwnerFlag()`（`/admin/` 通过 Access 时设、没通过时清）。
- **`review-comments.ts`**（纯函数在 `review-state.ts`，`tests/review-comments.test.ts`）：笔记页上，`canModerate()` 为真时读 `GET /api/admin/comments?slug=`，在评论区显示待审和被撤下的评论，每条有通过 / 回复；已公开的评论可以改回复、删回复；被撤下的可以恢复。拒绝和撤下没有按钮：把评论纸条（或划线评论小窗里的一条、只有一条评论的页边便签）拖进垃圾桶，或选中后按 Delete（`comment-drag.ts`，`throwComment`），「已扔掉 · 撤销」过后发 `reject`。都走 `POST /api/admin/decide`，完成后「下一条」跳到响应的 `next.href`。
- **`trash.ts`**：贴纸和评论共用的垃圾桶：桶（`showTrash({raised})` 在抽屉上面）、「已扔掉 · 撤销」、延迟提交（`hold` / `flushHeld`，`pagehide` 时带 keepalive 立即发出）、把固定定位的纸条揉进桶里（`crumpleInto`）。`sticker-trash.ts` 在它上面加贴纸的权限、世界坐标里的揉团和请求。
- **`review-stickers.ts`**（纯函数在 `sticker-review.ts`，有单元测试；由 `review-stickers-lazy.ts` 只在带 `interact:owner` 标记或 `?review=` 的浏览器里动态加载，普通访客不下载）：画布上读 `GET /api/admin/stickers`，把待审贴纸按位置贴出来，`?review=s:<id>` 时镜头移过去并显示审核小卡（通过 / 下一条，写着「不要就拖进垃圾桶（或按 Delete）」）；拒绝和撤下已通过的贴纸（整理贴纸时）都是扔进垃圾桶（`sticker-trash.ts`，这里注册 admin remover），删图片，不可恢复，只能在「已扔掉 · 撤销」时撤销。工具条的「待审 N」读 `GET /api/admin/queue` 的 `counts`。
- 只有 Access 能审核；GitHub 登录的博主（`isOwner`）只多一个「整理贴纸」。

### GitHub 登录

可选的访客登录，设计规则见 [design.md](design.md#访客互动)，配置步骤见 [deploy.md](deploy.md#10-github-登录可选)。不配置时（`GITHUB_CLIENT_ID` 或 `GITHUB_CLIENT_SECRET` 为空）一切照旧，只是没有登录入口。

**流程**

1. 表单上的「用 GitHub 登录」链接到 `GET /api/auth/github/login?next=<当前路径>`。服务端生成 256 位随机 `state`，和 `next` 一起写进短期 cookie `gh_oauth`（`<state>.<encodeURIComponent(next)>`，`Path=/api/auth/github`，10 分钟），302 到 `https://github.com/login/oauth/authorize`（`scope=read:user`，`redirect_uri` = 当前域名 + `/api/auth/github/callback`）。
2. GitHub 把浏览器送回 `GET /api/auth/github/callback?code=&state=`。服务端常量时间比较 `state` 和 cookie；`next` 只从 cookie 取，不信任回调地址里的任何参数。用户在 GitHub 取消时直接回到 `next`。
3. 用 `code` 换访问令牌（`POST https://github.com/login/oauth/access_token`），用它请求一次 `GET https://api.github.com/user`，然后丢掉令牌。只保留数字 id、login、显示名称（去掉控制字符，最多 60 字）、头像地址（只接受 `https://avatars.githubusercontent.com/…`，否则用默认头像）、主页地址（按 login 拼成 `https://github.com/<login>`，不取返回值）。
4. `login.ts` 的 `finishLogin`：按 `github_id` upsert `users`；生成新的 256 位会话令牌，`sessions.id` 存它的 SHA-256；同一批里删掉这个浏览器原来的会话和这个用户已过期的会话；设置 `sid` cookie，清掉 `gh_oauth`，302 回 `next`。
5. 之后每个 `/api/*` 请求按 `sid` 查会话（`sessions JOIN users`，只读）。`GET /api/auth/me` 是唯一延长会话的地方：上次刷新超过一天就把到期时间推到 30 天后并重发 cookie（每个会话每天最多一次 D1 写入）。无效或过期的 `sid` 会被清掉。
6. 「退出登录」POST `/api/auth/logout`：删这一行会话，清 `sid`。其它设备的会话不受影响。

**路由**

| 路由 | 作用 |
| --- | --- |
| `GET /api/auth/github/login?next=` | 开始登录：设置 `gh_oauth`，302 到 GitHub 授权页。没配置时 503 `{error}` |
| `GET /api/auth/github/callback?code=&state=` | GitHub 回调：校验 state、换令牌、读资料、建会话，302 回 `next`。state 不对 400、GitHub 出错 502，都返回一个 `noindex` 的小 HTML 页面，带「回到刚才的页面」链接 |
| `POST /api/auth/logout` | 同源；删掉这个浏览器的会话，清 `sid` → 204。页面原地更新（表单变回匿名、工具条头像消失），不刷新 |
| `GET /api/auth/me` | `{enabled, user: {login, name, avatarUrl, htmlUrl} \| null, isOwner, login: "github" \| "dev" \| null}`，`private, no-store`。`login` 是页面该提供哪种登录（GitHub、本地假登录或没有），`enabled` 表示有没有 |
| `GET /api/auth/dev-login?login=&id=&next=` | 本地测试的假登录（默认 `dev-visitor` / `10000001`）。只在 `AUTH_DEV_LOGIN=1` 或 `ADMIN_DEV_BYPASS=1` **并且**请求的是 localhost / 127.0.0.1 时可用，其它情况 404 |

**表**（`migrations/0001_init.sql`，时间都是 Unix 毫秒）

| 表 / 列 | 内容 |
| --- | --- |
| `users` | `id`（TEXT，UUID）、`github_id`（唯一）、`login`、`name`、`avatar_url`、`html_url`、`created_at`、`updated_at`。没有邮箱，没有令牌；每次登录更新资料 |
| `sessions` | `id`（`sid` 令牌的 SHA-256 hex）、`user_id`、`created_at`、`expires_at`、`last_seen_at`（滑动续期的依据） |
| `comments.user_id`、`stickers.user_id` | 登录时提交的内容属于哪个账号；匿名为 NULL。用于按账号限频、`ownPending` / `owned`、换设备挪自己的贴纸 |

**Cookie**

| 名称 | 属性 | 内容 |
| --- | --- | --- |
| `sid` | `Path=/; Max-Age=30 天; HttpOnly; Secure; SameSite=Lax` | 256 位随机令牌（base64url，43 字符）。数据库只存哈希 |
| `gh_oauth` | `Path=/api/auth/github; Max-Age=600; HttpOnly; Secure; SameSite=Lax` | 登录中的 `state` 和 `next`，回调后清掉 |

本地 `http://localhost` / `127.0.0.1` 上不加 `Secure`（`auth.ts` 的 `secureCookies`），否则浏览器不收。

**博主**：`OWNER_GITHUB_ID`（`sosyz` = `30596875`）按数字 id 认，不按 login（改名、同名注册都不影响）。博主的会话：评论带「博主」戳（`isOwner`），可以用 `PATCH /api/stickers/:id` 挪任何访客贴纸（不限频，`moderation_log` 的 actor 是 `owner:github:<login>`），能看待审贴纸的图片。审核、回复（`/admin/` 和页面上的现场审核）只认 Cloudflare Access；GitHub 会话打不开 `/admin/` 和 `/api/admin/*`，也看不到审核工具。

**安全要点**

- `state` 防登录 CSRF：随机 256 位，放 HttpOnly cookie，常量时间比较。
- `next` 防开放跳转（`auth.ts` 的 `safeNext`）：只接受本站路径，拒绝 `//host`、反斜杠、控制字符、`/api/*`，其它一律回 `/`。
- 会话固定：每次登录都发新令牌并删掉浏览器原来的会话。数据库泄露也拿不到能用的会话（只有哈希）。
- GitHub 访问令牌只在回调这一个请求里用，不写 D1、不写日志；scope 只有 `read:user`。`GITHUB_CLIENT_SECRET` 是 Worker secret。
- 登录的 POST 仍要同源（`Origin` / `Sec-Fetch-Site`），`sid` 是 SameSite=Lax，跨站 POST 不带它。
- 公开接口里账号只露出 `login`、`name`、`avatarUrl`、`htmlUrl`，不露出 `github_id` 和 `users.id`。
- 纯函数在 `auth.ts`（cookie、state、`safeNext`、博主、假登录开关）、`github.ts`（解析 GitHub 返回，`fetch` 可注入）、`visitor.ts`（缓存头、作者、要不要 Turnstile、挪动的 actor），测试在 `tests/auth.test.ts`、`tests/visitor.test.ts`（客户端的在 `tests/interact-auth.test.ts`）。D1 查询在 `users.ts`（账号、会话）和 `db.ts`。

### 贴纸工坊

访客选图（PNG / JPEG / WebP / GIF 第一帧，≤ 10 MB，≤ 5000 万像素，按文件头判断类型）后先进工坊，再进摆放。全部在浏览器里完成，服务端的限制（≤ 300 KB、≤ 512×512、四种格式）不变。

| 文件 | 作用 |
| --- | --- |
| `sticker-upload.ts` | 工具条按钮、文件检查 → `StickerWorkshop` →「用这张」→ 摆放（`StickerSession`，收的是 Blob）；成功后把编辑口令记进 `sticker-store.ts` |
| `sticker-transform.ts` | 摆放和挪动共用：手柄、拖动 / 旋转 / 缩放、滚轮缩放、键盘（方向键、`[` `]`、`-` `=`） |
| `sticker-edit.ts` | 挪已贴的贴纸：自己的（口令）、整理贴纸（博主）、只为自己拖（本地偏移，`sticker-offsets.ts`；博主拖内置贴纸时也有垃圾桶，见下文「内置贴纸」）；拖动要等 `sticker-peel.ts` 的 `move()` 返回 true（完全撕下来）才改位置、显示垃圾桶、松手保存，之前松手什么都不存；手柄、滚轮、键盘不经过撕；工具条的「整理贴纸」「贴纸放回原位」 |
| `sticker-peel.ts` | 撕下来 / 贴回去 / 扔进垃圾桶的控制器：按下时建 WebGL 卷曲层；超过 4px 后进入「撕」：贴纸留在原处（DOM 隐藏），卷曲方向是拉的方向（`shapePull`），进度用 `progressForPull` 解出，让卷起的后边跟着指针；进度到 `PEEL.detach` 就「弹」起（`popPose`，约 340ms 的临界阻尼缓动，不回弹），此后 `move()` 返回 true，调用方才移动贴纸（保持按下点相对贴纸的位置）；卷曲画在 `pinnedCentre`（让卷起的后边留在手里），撕下那一帧剩下的偏差用 `settleSlack` 在 `PEEL_MS.settle` 内收掉，所以画面不跳；弹起时方向不变，之后按 `PEEL_TAU.carryDirection` 慢慢转向抓住的角。松手展平在拿着的位置后恢复 DOM（撕的途中松手就展平在原处）。无 WebGL 或减弱动效时退回 CSS：拉超过长边的 `CSS_DETACH` 才算撕下，之前 `.is-tugged`（小角度翘起），之后 `.is-lifted`，并用 `--peel-lag-x` / `--peel-lag-y` 从原处滑到手里（减弱动效时直接到位）。`warmPeel()` 预取 WebGL chunk |
| `peel-gl.ts` | 单独的 chunk，由 `sticker-edit.ts` 在指针移到 / 焦点落到贴纸上或画布空闲时预取（`warmPeel`，减弱动效和手机列表视图不取），按下时也会加载（来不及时这一次先用 CSS 退路，层到了再接手）。原生 WebGL 卷曲渲染器（改编自 sticker-forge 的着色器，MIT）：48×48 网格按圆柱卷曲，正面是贴纸、背面是米白背纸，带明暗和投影；每次按下一个 GL context，用完 `destroy()`；`hull` 是贴纸轮廓的凸包 |
| `peel-math.ts` | 卷曲几何的纯函数（折线位置、圆柱映射、半径随进度变化），以及跟手的解：`rearShift`（某个进度下卷起的后边沿拉的方向走了多远，屏幕 px）、`progressForPull`（二分求让后边走到指针处的进度）、`heldShift` / `pinnedCentre`（撕下后把卷曲画在哪里，后边才留在手里），`tests/peel-math.test.ts` 覆盖。`PeelLayer.hull` 把渲染用的轮廓凸包交给控制器，两边算的一致 |
| `sticker-gesture.ts` | 手势纯函数：抓取点、卷曲方向、`shapePull`（拉的方向：4px 死区、与起始方向夹角超过 `PULL_CONE` 时保持上一个方向）、`cssDetached`、按拖速算进度、缓动和弹起 / 贴回 / 扔掉的时间线（`PEEL`、`PEEL_MS`、`popPose`、`layBackPose`、`throwPose`）、`rotateDegrees`（兼容各浏览器的 computed `rotate` 写法），`tests/sticker-gesture.test.ts` 覆盖 |
| `sticker-workshop.ts` | 模态 `<dialog class="vs-shop">`：预览、自动抠图 / 手账滤镜开关、白边粗细（细 / 中 / 粗）、重新选图 / 不贴了 / 用这张；解码到最长边 1024 px 再处理 |
| `cutout.ts` → `cutout.worker.ts` | 自动抠图。worker 在开关第一次打开时才创建；关掉开关或关闭工坊会 terminate，下载随之停止 |
| `cutout-assets.ts` | 自托管文件的地址、大小、哈希（`tests/cutout-assets.test.ts` 核对） |
| `die-cut.ts` | 纯函数：精确欧氏距离变换白边（封闭的洞填白）、圆角矩形、alpha 边界、抠图 matte 清理 |
| `journal-filter.ts` | 纯函数：手账滤镜（去一点饱和、偏暖、提一点黑、叠 `grain-overlay-gray.jpg` 纸纹），只作用于图案，不作用于白边 |
| `sticker-fit.ts` | 纯函数：输入检查、尺寸（图案 + 白边 ≤ 512，白边默认为图案长边的 4.5%，与手绘贴纸一致）、编码尝试顺序（WebP 质量 0.9 → 0.5，再整体缩小；PNG 只缩小） |

- 默认值：图片没有明显透明区域时自动抠图打开（`navigator.connection.saveData` 时关闭），已有透明背景时关闭；手账滤镜打开；白边「中」。不抠图的不透明图片做成圆角矩形贴纸。
- 抠图：U-2-Netp（320×320 fp32）经 transformers.js（`@huggingface/transformers` 4.3.0，固定版本）+ ONNX Runtime Web 在 worker 里运行。worker 自己下载 wasm 和模型（报告进度），通过 `env.customCache` 交给 transformers.js，避免它为了读大小把 model.onnx 下载两次。`allowRemoteModels = false`、`localModelPath = "/models/"`、`wasmPaths` 指向 `/ort/<版本>/`，不访问 CDN 或 Hugging Face。
- 为什么是 CPU wasm：transformers.js 默认引入 `onnxruntime-web/webgpu`，它的 asyncify wasm（约 27 MB）超过 Workers 静态资源单文件 25 MiB，而且 Vite 会把它打进 `_astro/`。`astro.config.mjs` 用别名把 `onnxruntime-web/webgpu` 换成 `ort.wasm.min.mjs`（只含 CPU，配 `ort-wasm-simd-threaded.wasm`，约 14 MB，gzip 约 3.6 MB），并设 `vite.worker.format = "es"`。没有 COOP/COEP，所以单线程。
- 第一次抠图下载：wasm 14.3 MB + 模型 4.6 MB + worker 脚本约 470 KB；之后走 HTTP 缓存（`public/_headers`：`/ort/*` 一年 immutable，`/models/*` 30 天）。
- 失败（下载失败、wasm 不可用）时关掉开关，提示「抠图没成功，先用原图做成贴纸」，照常可以用。

### 客户端画布接口（`src/scripts/canvas/api.ts`）

画布排好世界后调用 `publishCanvas(api)`。使用方调用 `whenCanvasReady()`（不管画布先好还是后好都能拿到），不要去碰画布内部。

```ts
type CanvasApi = {
  viewportEl: HTMLElement;          // 固定全屏，接收指针和滚轮
  worldEl: HTMLElement;             // 被变换的元素；按世界坐标 px 往里加子元素，原点是自我介绍卡中心
  screenToWorld(p: Point): Point;   // 视口坐标 → 世界坐标
  worldToScreen(p: Point): Point;
  getCamera(): Camera;              // { x, y, scale }：screen = world * scale + (x, y)
  onCameraChange(fn): () => void;   // 每一帧拖动 / 缩放 / 惯性 / 平移
  panTo(p: Point, opts?): void;
  currentNote(): string | null;
  openNote(slug): void;             // 导航到 /notes/<slug>/
  closeNote(): void;
};
```

window 事件（在 `WindowEventMap` 里有类型；`onDrawerOpen`、`onDrawerRendered`、`onDrawerClose` 返回取消订阅函数）：

| 事件 | detail | 时机 |
| --- | --- | --- |
| `canvas:ready` | `CanvasApi` | 每次整页加载一次 |
| `drawer:open` | `{ slug }` | 抽屉开始打开或切换笔记 |
| `drawer:rendered` | `{ slug, drawerEl, scrollEl, bodyEl }` | 文章 DOM 已就位：首次加载 `/notes/<slug>/`，以及每次换页后显示笔记时 |
| `drawer:close` | `{ slug }` | 抽屉关闭 |

`transition:persist` 带来的规则：

- 被保留元素里的脚本只运行一次；初始化时在元素上打标记（如 `data-ready`），重复执行时直接返回。
- 每页都要做的事放在 `document.addEventListener("astro:page-load", …)` 里。
- 抽屉里的一切在导航时都会被替换。每次 `drawer:rendered` 都重新绑定到新的 `bodyEl`；在 `drawer:close` 或下一次 `drawer:open` 时清理监听。
- 用同一模块的 `prefersReducedMotion()`；减弱动效时所有动画直接切换（`base.css` 也全局强制）。

### 画布和抽屉的 DOM 钩子

- 卡片：`a[data-card][data-slug][data-topic][data-tags][data-related][data-q]`，是指向 `/notes/<slug>/` 的真实链接。搜索目标是 `[data-q]`。
- 抽屉：`[data-drawer][data-slug]`（一个 `<main id="main">`），滚动元素 `[data-drawer-scroll]`，淡入淡出的页面 `[data-drawer-page]`，文章 `[data-post-body]`。正在滑出的抽屉带 `data-leaving`、是 `inert` 且去掉了 id；忽略 `[data-drawer][data-leaving]`。
- `Esc` 在 window 的 keydown 上关闭抽屉。自己处理 `Esc` 的浮层要调用 `event.preventDefault()`（或者是打开的 `<dialog>` / `aria-modal="true"`）。在输入框里按 `Esc` 不关抽屉。
- `<StickerLayer/>` 在 `[data-world]` 里；访客贴纸用 `.vs` / `.vs-place`（不用 `.sticker`，那是 `layout.ts` 负责定位的）。自己的贴纸（和整理模式下的所有访客贴纸）渲染成 `<button class="vs is-editable">`，选中时加 `.is-selected` 并显示 `.vs-rot` / `.vs-scale` 手柄。
- 内置贴纸（`.sticker`）带 `data-sticker-key`：博主头像 `dog:people-dog`（现在画的是小黑猫，key 沿用旧名）、主题贴纸 `pile:<主题>:<贴纸名>`、外圈 `outer:<贴纸名>`（`src/lib/builtin-stickers.ts` 生成这些 key，并给审核台提供 key → 图片、中文名；`Canvas.astro` 和 `/admin/` 都从这里取）。博主扔掉的内置贴纸（表 `hidden_builtins`，`migrations/0001_init.sql`：`key` 主键、`hidden_at`、`hidden_by` = `admin:<email>` / `owner:github:<login>`；`src/lib/server/hidden-builtins.ts`）由 `builtin-hidden.ts` 加 `.is-thrown-away`（`visibility: hidden`，盒子保留，不进 Tab 顺序和无障碍树）；名单来自 `GET /api/stickers` 的 `hiddenBuiltins`，加载前先用 localStorage `interact:hidden-builtins`（`builtin-hidden-store.ts`：`keys` 是上次的名单，`recent` 是博主自己 6 分钟内的藏 / 恢复，压过可能来自边缘缓存的旧名单）。博主（`sticker-edit.ts` 的 `owner`：GitHub 博主或 `canModerate()`）撕下内置贴纸时显示垃圾桶，扔进去走 `sticker-trash.ts` 的 `throwBuiltin`（`trash.ts` 的 `hold`，撤销期过后 `POST /api/builtins`）；对博主内置贴纸有 `tabindex="0"`、`aria-label`、`aria-keyshortcuts`，Delete / Backspace 扔掉。审核台 `/admin/` 的「藏起来的自带贴纸」用 `inbox.ts` 恢复（`hidden: false`，同时写 `recent`）。`sticker-edit.ts` 在 `worldEl` 上监听 `pointerdown` 并 `stopPropagation`，所以按在贴纸上不会拖动画布；访客自己拖出的偏移写在这些元素的 `--dx` / `--dy` 上（CSS 在 `StickerLayer.astro`，`translate`），`layout.ts` 只改 left / top，重新排版不会丢。改 `Canvas.astro` 时保留这个属性和值，否则访客存的偏移对不上。
- 窄屏的 `/`：`.home[data-view=auto|canvas|list]`，选择记在 sessionStorage 的 `journal:view`。列表视图下隐藏上传按钮。
- `src/scripts/canvas/seed.ts`（`seeded`、`rot`、`pick`、`TAPES`、`tapeSrc`、`stickerSrc`、`cardTilt`、`cardFixing`、`TOPIC_STICKERS`、`OUTER_STICKERS`、`DOG_STICKER`）服务端和客户端共用，保证胶带和倾斜角一致；请复用它。

### 样式

- 用 `tokens.css` 里的 token（`--desk`、`--doc`、`--sticky`、`--slip`、`--ink`、`--pencil`、`--faint`、`--faint-mark`、`--link`、`--stamp`、`--kw`/`--str`/`--com`、`--hand`/`--body`/`--code`/`--ui`、`--out`、`--spring`、`--dur*`、各种阴影）。不要新写死颜色。
- 材质（`materials.css`）：`.doc-paper`、`.sticky-paper`、`.kraft-paper`、`.desk-paper`、`.tape`（`--tape-w`、`--tr`）、`.clip`、`.stamp`（+ `.is-open`、`.is-mini`）、`.date-stamp`、`.stamp-btn`、`.polaroid`、`.sticker`（`--w`、`--r`）、`.doodle`（`--doodle: url(...)`）。位置由使用它的组件决定。
- 代码文字一律 `font-feature-settings: "calt" 0`（关闭 Maple Mono 连字）；`base.css` 已经对 `code, pre, kbd, samp` 设置。
- 只有浅色：手账是纸，没有深色主题（`color-scheme: light`）。

### 素材

手账材质和贴纸放在 `public/`，不放 `src/assets/`：脚本按名字在运行时取用（`/journal/tape/${name}.webp`、`/stickers/${name}.webp`），CSS 通过自定义属性引用纹理（`tokens.css` 里的 `url()`），两者都不能用带哈希的导入。它们已经很小（webp/jpg/svg）。

- `/journal/paper/{canvas-beige-fine,document-ivory,grain-overlay-gray,kraft-smooth}.jpg`
- `/journal/tape/{washi-grid-ivory,washi-stripes-pink,washi-dots-mustard,washi-plain-sage,masking-cream,kraft-brown}.webp`（2 倍渲染，按一半宽度显示，例如 108–130px；源文件在 `scripts/assets/tape/`，`bun scripts/build-tapes.ts` 重新生成）
- `/journal/doodle/*.svg`（单色，当 CSS mask 用），`/journal/accessory/*.svg`
- `/journal/paperclip.svg`、`/journal/stamp-speckle.png`
- `/stickers/{place,people,obj}-*.webp`（`people-dog` 是博主头像）
- 文章封面放 `src/assets/covers/`（或 `src/assets/posts/<slug>/`），走 `astro:assets`。
- Rough Notation：`import { annotate, annotationGroup } from "rough-notation"`。

### 配置和环境变量

- 被 `astro.config.mjs` 导入的文件（`src/lib/markdown/*`、`src/lib/seo/redirects.ts`、`sitemap.ts`、`note-slugs.ts`、`post-files.ts`、`site.ts`）在 Vite 别名生效之前加载：只能用相对路径导入，不能用 `@/`，也不能导入 `astro:*`。
- `astro:env` schema（全部可选，缺值时构建不会失败）：
  - `TURNSTILE_SITE_KEY` — 公开的 site key。默认在**运行时**由 `GET /api/turnstile`（`src/pages/api/turnstile.ts`）从 Worker 变量读取：线上是 `wrangler.jsonc` 的 `vars`，本地是 `.dev.vars`。如果构建时 `.env` 里也设置了（astro:env client），客户端优先用构建时的值。测试 key：`1x00000000000000000000AA`。
  - `TURNSTILE_SECRET_KEY`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` — server/secret；线上用 `wrangler secret put`，本地放 `.dev.vars`。通过 `src/lib/server/env.ts` 读取。测试 secret：`1x0000000000000000000000000000000AA`。
  - 不在 schema 里的可选变量（`env.ts` 直接从 `env` 读）：`ADMIN_DEV_BYPASS`、`IP_HASH_SALT`、`MODERATOR`，以及 GitHub 登录的 `GITHUB_CLIENT_ID`（公开，`wrangler.jsonc` 的 `vars`）、`GITHUB_CLIENT_SECRET`（`wrangler secret put`）、`OWNER_GITHUB_ID`（`vars`，博主的数字 id）、`AUTH_DEV_LOGIN`（只在本地 `.dev.vars` 里，打开 `/api/auth/dev-login`；`ADMIN_DEV_BYPASS=1` 也会打开它）。
- 绑定：`import { env } from "cloudflare:workers"` → `env.DB`（`D1Database`）、`env.STICKERS`（`R2Bucket`）。`Astro.locals.runtime` 已经不存在。类型来自 `worker-configuration.d.ts`；改了 `wrangler.jsonc` 后运行 `bun run cf-typegen`。
- 按需路由：`export const prerender = false`。不要在里面用 `<Image>` / `getImage()`：自定义图片服务（sharp + AI SDK）只在构建时用。
- `OPENROUTER_API_KEY`（可选，只在构建时）开启 AI 替代文字。`src/lib/config.ts` 还读 `MAASHUB_API_KEY`、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_GATEWAY_ID`、`CLOUDFLARE_GATEWAY_AUTH`、`CLOUDFLARE_AI_API_KEY`，目前替代文字只用 OpenRouter。

## 字体

`bun run fonts` 读取 `fonts-src/xiaolai-regular.ttf` 和 `fonts-src/zhuque-fangsong-regular.ttf`（已 gitignore；下载地址写在 `scripts/build-fonts.ts` 开头），分两层输出（都要提交）：

1. 全站用字：扫描 `src/**` 的界面文案、笔记 frontmatter 和正文（加 ASCII、常用标点，逻辑在 `scripts/font-chars.ts`），每个字族切成一两个 woff2，放在 `public/fonts/{xiaolai,zhuque}/`。朱雀仿宋分「每页都有」（界面、标题、摘要）和「只在正文」两个文件，首页和列表只下载第一个；小赖一个文件（加上正文里用手写体的引用、图注、文件名、脚注）。它们的 @font-face 和度量匹配的本地回退字体（`"Xiaolai Fallback"`、`"Zhuque Fangsong Fallback"`，`size-adjust` / `ascent-override` 等，写在 `tokens.css` 的字体栈里）生成到 `src/layouts/fonts.generated.ts`，由 `Base.astro` 和独立的 `/admin/` 页面内联。
2. 其余的字：cn-font-split 的小切片，unicode-range 去掉了第一层已有的字，写在 `public/fonts/rest.<hash>.css`（文件名是内容哈希，`public/_headers` 让 `/fonts/*.css` 和 woff2 一样按一年 immutable 缓存），只有访客留言、搜索词等站内没用过的字才会下载。

加了新笔记或界面文案后重新运行 `bun run fonts`（约 2 秒）；不运行也能显示，只是新字要多下载一个切片。CSS 字体名由脚本固定为 `"Xiaolai"` 和 `"Zhuque Fangsong"`；Maple Mono 来自 `@fontsource/maple-mono`（latin，400）。旧的 `public/fonts/lxgw-wenkai/` 和 Atkinson 字体不再使用，保留在仓库里，但 `public/.assetsignore` 让它们不被部署。

## 构建产物

- `bun run build` 写出 `dist/client`（静态文件，含合并后的 `_redirects` 和 `_headers`）和 `dist/server`（Worker 和最终的 `wrangler.json`）。之后 `.wrangler/deploy/config.json` 把 wrangler 指向 `dist/server/wrangler.json`，所以构建后的 `wrangler deploy`、`wrangler d1 …` 都用这份配置。
- `_redirects` 由 Workers 静态资源在 Worker 运行之前处理；adapter 会为每条规则同时写 `/x` 和 `/x/` 两种形式。第一条通配（`*` 或 `:name`）之后的规则都算动态规则，动态上限 100 条（静态 2000 条），超出的整段丢弃且没有构建警告；所以 `public/_redirects` 不放规则，通配规则由 `src/integrations/legacy-list-redirects.ts` 追加到文件末尾，并在构建时检查（`tests/redirect-rules.test.ts` 也检查）。
- 安全响应头：静态文件由 `public/_headers` 的 `/*` 规则发送，Worker 渲染的响应（`/api/*`、`/admin/`）由 `src/middleware.ts` 补上（404 页是预渲染文件，走 `_headers`），值都来自 `src/lib/server/http.ts` 的 `SECURITY_HEADERS`（`tests/security-headers.test.ts` 保持一致）。强制的 CSP 只禁止被嵌入、`<base>` 和插件；完整策略是 `Content-Security-Policy-Report-Only`，没有上报地址，在浏览器控制台看违规，跑干净后再改成强制。新增外部来源（脚本、图片、iframe）时同步改这两处。
- 页面里不出现内联脚本：`astro.config.mjs` 的 `vite.build.assetsInlineLimit` 对 `.js` 返回 `false`，Astro 不会把小的 `<script>` 内联进 HTML（CSP 的 `script-src` 没有 `'unsafe-inline'`）。JSON-LD 是数据块，不受影响。
- `astro:build:done` 里还有 `journal-modulepreload`（`src/lib/build/modulepreload.ts`）：给每个预渲染页面加上入口脚本静态依赖的 `modulepreload`；动态 import（审核代码 `review-stickers.ts`、WebGL `peel-gl.ts`）不预加载。
- 非交互 shell 里 `astro dev` / `astro preview` 可能在后台启动并打印地址，用 `bunx astro dev stop` / `bunx astro preview stop` 停止。
- Biome 忽略 `.astro` 文件、`public/fonts`、`public/ort`、`public/models`（第三方原样文件，格式化会改掉哈希）、`fonts-src`、`wrangler.jsonc` 和 `worker-configuration.d.ts`；`.astro` 用 Prettier 格式化。

## 免费额度

Workers 每天 10 万次请求、每次 10 ms CPU；D1 每天 10 万次写入；R2 10 GB。静态页面由静态资源直接返回，不消耗 Worker CPU；接口处理要保持轻量。
