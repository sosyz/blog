# 部署

博客部署成一个 Cloudflare Worker（带静态资源，不用 Pages），域名 `blog.sonui.cn`。页面是构建好的静态文件；只有 `/api/*` 和 `/admin/` 在 Worker 上运行，用到 D1、R2、Turnstile 和 Cloudflare Access，访客的 GitHub 登录（可选）用一个 GitHub OAuth App。代码结构见 [architecture.md](architecture.md)。

下面的步骤按第一次上线的顺序写。控制台里的菜单名称会调整，以当前控制台为准。命令都在仓库根目录运行，用 `bunx wrangler …`（项目自带的 wrangler）。

## 0. 准备

```bash
bun install
bunx wrangler login          # 浏览器里授权 Cloudflare 账号
bunx wrangler whoami         # 确认账号正确
```

`blog.sonui.cn` 所在的 zone（`sonui.cn`）已经在这个 Cloudflare 账号里。

## 1. 创建 D1 数据库

```bash
bunx wrangler d1 create sonui-blog
```

命令会打印 `database_id`。把它填进 `wrangler.jsonc` 的 `d1_databases` 里（wrangler 问是否替你写入时也可以选是）：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "sonui-blog",
    "database_id": "<粘贴 id>",
    "migrations_dir": "migrations"
  }
]
```

`database_id` 不是密钥，可以提交。然后建表：

```bash
bun run build                                          # 让 dist/server/wrangler.json 带上新的 id
bunx wrangler d1 migrations apply sonui-blog --remote
```

构建之后，`.wrangler/deploy/config.json` 会把 wrangler 指向 `dist/server/wrangler.json`，所以填好 id 后要先构建一次，再执行迁移。以后新增迁移文件时，每次部署前都执行一次这条命令。

上线前的表结构都在 `migrations/0001_init.sql` 一个文件里（users、sessions、comments、stickers、moderation_log、hidden_builtins），第一次执行这条命令就全部建好。新代码会查这些表，所以**先迁移，再部署**。

本地开发用的数据库：`bunx wrangler d1 migrations apply sonui-blog --local`。

## 2. 创建 R2 存储桶

第一次用 R2 需要先在控制台 **R2** 页面开通（免费额度内不收费）。然后：

```bash
bunx wrangler r2 bucket create sonui-blog-stickers
```

桶名要和 `wrangler.jsonc` 里的 `bucket_name` 一致。桶保持私有，不用开公开访问：贴纸图片由 `/api/stickers/:id/image` 读出。

## 3. 创建 Turnstile 小组件

1. 控制台 → **Turnstile** → **Add widget**。
2. 名称随意（例如 `sonui-blog`）；**Hostname** 填 `blog.sonui.cn`。上线前如果要在 `*.workers.dev` 地址上试评论，临时把那个主机名也加进来，切换完成后删掉。
3. **Widget mode** 选 **Managed**。页面用 `appearance: "interaction-only"` 渲染，平时看不到验证框，只有 Cloudflare 要求交互时才显示。
4. 保存后记下 **Site Key** 和 **Secret Key**。

- Site Key 是公开的，由 Worker 在**运行时**通过 `GET /api/turnstile` 提供给页面，换 key 不用重新构建。填进 `wrangler.jsonc` 的 `vars`：

  ```jsonc
  "vars": {
    "TURNSTILE_SITE_KEY": "<Site Key>"
  }
  ```

  也可以在构建时的 `.env` 里设置同名变量，这时它会直接写进页面并优先使用。一般不需要，**不要**把测试 key 留在构建用的 `.env` 里。

- Secret Key 是 Worker 密钥，见第 5 步。

服务端会检查 siteverify 返回的 hostname 和 action（`comment`、`inline`、`sticker`）；hostname 不在小组件里时提交会被拒绝。本地开发一直用 `.env.example` / `.dev.vars.example` 里的测试 key。

## 4. 配置 Cloudflare Access（保护后台）

1. 打开 **Zero Trust** 控制台。第一次进入时会要求起一个团队名，得到团队域名 `<team>.cloudflareaccess.com`（之后在 **Settings** 里能看到）。
2. **Access → Applications → Add an application → Self-hosted**。
3. 应用名称：`sonui-blog admin`。添加两个目标（public hostname）：
   - 域名 `blog.sonui.cn`，路径 `admin`
   - 域名 `blog.sonui.cn`，路径 `api/admin`
4. 登录方式：用默认的 **One-time PIN**（邮箱验证码）即可，也可以接 GitHub。这里说的是后台的登录方式，和第 10 步访客用的 GitHub 登录是两回事：GitHub 登录打不开 `/admin/`。
5. 策略：**Action = Allow**，**Include → Emails** 填 `<你的邮箱>`。只放这一个邮箱。
6. 保存后，在应用详情里复制 **Application Audience (AUD) Tag**。

代码也会自己验证 Access 的 JWT（`src/lib/server/access.ts`：按团队的 JWKS 验签，RS256，校验 `iss` 和 `aud`），所以就算有人绕过 Access 直接访问（例如 workers.dev 地址），没有有效 JWT 也只会得到 401。后台预览待审贴纸时请求的是 `/api/stickers/:id/image`，不在应用路径内，靠 Access 在 `blog.sonui.cn` 上设置的 `CF_Authorization` cookie 识别，所以后台要在 `blog.sonui.cn` 上使用。

## 5. 首次部署和设置密钥

```bash
bun run build
bunx wrangler deploy
```

部署后会得到 `https://sonui-blog.<你的子域>.workers.dev`。然后设置密钥（每条命令会提示输入值；设置后立即生效，不需要重新部署）：

```bash
bunx wrangler secret put TURNSTILE_SECRET_KEY    # 第 3 步的 Secret Key
bunx wrangler secret put ACCESS_TEAM_DOMAIN      # <team>.cloudflareaccess.com，不带 https://
bunx wrangler secret put ACCESS_AUD              # 第 4 步的 AUD Tag
bunx wrangler secret put IP_HASH_SALT            # 可选，随机串，例如 openssl rand -hex 32 的输出
bunx wrangler secret put EDGE_ORIGIN_SECRET      # EdgeOne 回源密钥（第 7 步），例如 openssl rand -hex 24 的输出
```

- `IP_HASH_SALT` 不设时用 Turnstile Secret 做盐；单独设置后，以后更换 Turnstile Secret 不会让已有的 IP 哈希失效。
- 不要在线上设置 `ADMIN_DEV_BYPASS`（它只对 localhost 生效，但也没有理由出现在线上）。
- 可选的构建时变量 `OPENROUTER_API_KEY`（AI 替代文字）放在构建机器的 `.env` 里，不是 Worker 密钥。
- GitHub 登录的 `GITHUB_CLIENT_SECRET` 在第 10 步设置。

没有配置密钥时，页面照常可用，评论和贴纸接口会返回「人机验证还没配置好」，后台返回「后台还没配置 Cloudflare Access」。没有配置 GitHub 登录时，表单只提供昵称留言，其它功能不受影响。

## 6. 在 cf-blog.sonui.cn 上检查

切换域名前，先在 Worker 自己的域名 `https://cf-blog.sonui.cn` 上确认（第 7 步说明为什么是它）：

- `/`、`/list/`、几篇 `/notes/<slug>/` 能正常显示，画布能拖动，抽屉能开关。
- `/notes/go-context.md`、`/llms.txt`、`/rss.xml`、`/robots.txt`、`/sitemap-index.xml` 返回正确内容。
- 旧链接跳转（见第 9 步，把域名换成 `cf-blog.sonui.cn`）。
- `/admin/` 先跳到 Access 登录页。

## 7. 接入 EdgeOne，切换域名 blog.sonui.cn

`sonui.cn` 有备案，国内访客走腾讯云 EdgeOne（中国大陆节点）。架构：

```
访客 → blog.sonui.cn（Cloudflare DNS：仅 DNS 的 CNAME，指向 EdgeOne）
     → EdgeOne 回源 https://cf-blog.sonui.cn（Worker 的自定义域，wrangler.jsonc `routes`）
```

Worker 不能直接挂 `blog.sonui.cn`：这个主机名要解析到 EdgeOne，而 Cloudflare 只处理自己代理的主机名，所以 Worker 用自己的主机名 `cf-blog.sonui.cn`，回源 Host 也必须是它（填 `blog.sonui.cn` 的话 Cloudflare 不会把请求交给 Worker）。代码靠一个回源密钥认出 EdgeOne（`src/worker.ts` → `src/lib/server/edge.ts`）：请求带着正确的 `x-edge-auth` 时，Worker 把它当成发往 `https://blog.sonui.cn` 的请求（同源检查、GitHub 登录回调、cookie 都按正式域名），访客 IP 取 EdgeOne 的 `EO-Client-IP`（没有就取 `X-Forwarded-For` 第一个），限流按真实访客计。没有这个头或值不对时原样处理，直接访问 `cf-blog.sonui.cn` 伪造不了 IP 和域名。

1. **Cloudflare 这边（已完成）**：`cf-blog.sonui.cn` 是 Worker 的自定义域；Worker 密钥 `EDGE_ORIGIN_SECRET`（随机串，`openssl rand -hex 24`）；Access 应用保护 `cf-blog.sonui.cn/admin` 和 `cf-blog.sonui.cn/api/admin`；Turnstile 小组件的主机名是 `blog.sonui.cn`（组件在访客浏览器里运行，看的是访客所在的域名）。
2. **EdgeOne 加速域名 `blog.sonui.cn`**：
   - 源站：域名 `cf-blog.sonui.cn`，HTTPS 443 回源；**回源 Host** 和 SNI 都填 `cf-blog.sonui.cn`。
   - 回源请求头：加 `x-edge-auth: <EDGE_ORIGIN_SECRET 的值>`；确认 `EO-Client-IP` 会带上（EdgeOne 默认带；关掉的话至少保留 `X-Forwarded-For`）。
   - 缓存：`/api/*`、`/admin*` 不缓存；其它遵循源站 `Cache-Control`（`/_astro/*`、`/fonts/*` 源站给了一年 immutable，HTML 是短缓存）。
   - 证书：给 `blog.sonui.cn` 申请或上传 HTTPS 证书，开启 HTTP→HTTPS 跳转。
3. **切 DNS**：先记下旧配置（`blog` 是 CNAME `blog-6mi.pages.dev`，开代理，是 Pages 项目 `blog` 的自定义域），在 Pages 项目 `blog` 的 **Custom domains** 里移除 `blog.sonui.cn`，再把 DNS 里这条记录改成 EdgeOne 给的 CNAME，**关闭代理（灰云，仅 DNS）**。
4. **确认**：按第 9 步检查（`H=https://blog.sonui.cn`）；在 `blog.sonui.cn` 发一条真实评论，用 GitHub 登录一次。
5. **后台**：`https://cf-blog.sonui.cn/admin/`（Access 登录，邮箱验证码）。经 EdgeOne 打开 `blog.sonui.cn/admin/` 也会跳到 Access 登录，登录后停在 `cf-blog.sonui.cn`。后台里的「去看看」审核链接是相对地址，留在 `cf-blog.sonui.cn` 上，页内审核在这个域名上用；在 `blog.sonui.cn` 上浏览时没有审核工具（Access 的 cookie 属于 `cf-blog.sonui.cn`）。
6. **workers.dev**：`wrangler.jsonc` 没写 `workers_dev`，部署时默认关闭，不用再管。

**限流规则**：留言、贴纸和挪贴纸的频率限制在 Worker 里检查（写入 D1 时一起判断，并发请求也绕不过）。经 EdgeOne 的请求在 Cloudflare 看来都来自 EdgeOne 的回源节点，所以**不要**在 Cloudflare WAF 里按 IP 限流（会把大量访客算成同一个 IP 一起挡掉）；要加的话加在 EdgeOne 上，按访客 IP 计数。

**回滚**：在 DNS 里把 `blog` 改回 CNAME `blog-6mi.pages.dev`（开代理），并把 `blog.sonui.cn` 加回 Pages 项目 `blog`。旧站源码在 `master` 分支。只回滚代码版本时用 `bunx wrangler rollback`。

## 8. AI 爬虫设置（GEO）

站点希望被搜索引擎和 AI 读到，`robots.txt` 已明确允许主要 AI 爬虫（`src/pages/robots.txt.ts`）。在 `sonui.cn` zone 的控制台里：

- **Security → AI bot policies**（或 Bots / AI Crawl Control 下的同类设置）：Search、Agent、Training 三类都设为 **Allow**。
- 旧的 **Block AI bots** 开关保持**关闭**。
- **不要**开启 Cloudflare 托管的 robots.txt（managed robots.txt）：它会改写站点自己的 `robots.txt`。
- 如果出现 **Content Signals Policy** 的选项，取消勾选，保持站点原本的 `robots.txt`。
- Bot Fight Mode 这类会挑战爬虫的功能也不要对整个站点开启。

改完后用 `curl https://blog.sonui.cn/robots.txt` 确认内容和 `src/pages/robots.txt.ts` 生成的一致。

## 9. 用 curl 检查跳转和端点

```bash
H=https://blog.sonui.cn

# 旧 Hexo 文章（大小写敏感，空格是 %20）→ 301 到 /notes/<slug>/
curl -sI "$H/Go%20Redis%20Lib%20Serialize%20Struct/" | grep -iE '^(HTTP|location)'
curl -sI "$H/C-C-Binary-Trees/" | grep -iE '^(HTTP|location)'
curl -sI "$H/WireGuard%20Use%20Notes/" | grep -iE '^(HTTP|location)'

# 旧的关于页、1.x 的 /blog/、Hexo 归档/标签/分页 → / 或 /list/
curl -sI "$H/about/" | grep -iE '^(HTTP|location)'
curl -sI "$H/blog/go-context/" | grep -iE '^(HTTP|location)'
curl -sI "$H/tags/Go/" | grep -iE '^(HTTP|location)'
curl -sI "$H/archives/2024/05/" | grep -iE '^(HTTP|location)'
curl -sI "$H/page/2/" | grep -iE '^(HTTP|location)'

# 给 AI 的端点
curl -sI "$H/notes/go-context.md" | grep -iE '^(HTTP|content-type)'   # text/markdown
curl -s  "$H/llms.txt" | head -5
curl -s  "$H/robots.txt"

# 后台没有登录时不应该返回 200
curl -sI "$H/admin/" | grep -iE '^(HTTP|location)'
curl -s  "$H/api/admin/queue"
```

期望：旧链接都是 `301` 且 `location` 指向新地址；`.md` 的 `content-type` 是 `text/markdown; charset=utf-8`；`/admin/` 跳到 `<team>.cloudflareaccess.com` 的登录页（没有 Access 时是 401）。完整的旧链接表在 [migration.md](migration.md)，规则在 `src/lib/seo/redirects.ts` 和 `src/lib/seo/redirect-rules.ts`（`/tags/*` 等通配）。

本地也能检查：`bun run build && bun run preview`，把 `H` 换成 preview 打印的本地地址。

## 10. GitHub 登录（可选）

访客可以不登录，照常填昵称、过 Turnstile 留言和贴贴纸。配置 GitHub 登录后，表单上多一个「用 GitHub 登录」：登录的访客不用过 Turnstile，评论显示 GitHub 头像和用户名（链接到 GitHub 主页），换设备登录也能看到自己待审的评论和贴纸、挪自己的贴纸。博主（`OWNER_GITHUB_ID`）用 GitHub 登录后，评论带「博主」戳，画布工具条出现「整理贴纸」。所有评论和贴纸仍然先审核，登录的人和博主也一样。`/admin/` 仍然只认 Cloudflare Access。

登录的回调地址按请求的域名生成（`https://<当前域名>/api/auth/github/callback`）。OAuth App 可以填多个回调地址：现在用的是同一个 App（Client ID `d0ca547fe3adf273324b`），回调里填了 `https://blog.sonui.cn/api/auth/github/callback` 和本地的 `http://localhost:4321/api/auth/github/callback`。没填进去的域名（例如 workers.dev 地址）上点登录，GitHub 会报 `redirect_uri` 不匹配，所以线上登录在第 7 步切换域名之后验证。

### 10.1 创建 GitHub OAuth App

1. 用博主的 GitHub 账号（`sosyz`）打开 **Settings → Developer settings → OAuth Apps → New OAuth App**（直达：<https://github.com/settings/applications/new>）。用 OAuth App，不用 GitHub App：只需要读一次公开资料。
2. 填写：
   - **Application name**：`Sonui 的手账`（显示在 GitHub 的授权页上，随意）
   - **Homepage URL**：`https://blog.sonui.cn`
   - **Authorization callback URL**：`https://blog.sonui.cn/api/auth/github/callback`
   - **Enable Device Flow** 不勾选。
3. **Register application**，页面上显示 **Client ID**（公开的，可以提交）。
4. 点 **Generate a new client secret**，立刻复制（只显示一次）。丢了就再生成一个，删掉旧的。

登录只申请 `read:user`，读一次 `GET https://api.github.com/user`，存下数字 id、login、显示名称、头像地址和主页地址，不读邮箱。GitHub 返回的访问令牌读完资料就丢掉，不存。

### 10.2 配置 Worker

1. **变量**：在 `wrangler.jsonc` 的 `vars` 里填 `GITHUB_CLIENT_ID`；`OWNER_GITHUB_ID` 已经是 `"30596875"`（`sosyz` 的数字 id）：

   ```jsonc
   "vars": {
     "TURNSTILE_SITE_KEY": "<Site Key>",
     "GITHUB_CLIENT_ID": "<Client ID>",
     "OWNER_GITHUB_ID": "30596875"
   }
   ```

   博主按数字 id 认，不按用户名认：改名不影响，别人注册同名账号也冒充不了。确认 id：`curl -s https://api.github.com/users/sosyz | grep '"id"'`。改了 `wrangler.jsonc` 后运行 `bun run cf-typegen`。

2. **密钥**：

   ```bash
   bunx wrangler secret put GITHUB_CLIENT_SECRET   # 10.1 第 4 步的 client secret
   ```

3. **迁移**：`users`、`sessions` 两张表和 `comments`、`stickers` 的 `user_id` 已经在 `migrations/0001_init.sql` 里，按第 3 步执行过迁移就不用再做。改了 `vars` 或密钥后重新构建、部署：

   ```bash
   bun run build
   bunx wrangler d1 migrations apply sonui-blog --remote
   bunx wrangler deploy
   ```

   `vars` 会在构建时写进 `dist/server/wrangler.json`，所以改了 `vars` 要**重新构建再部署**；`secret put` 立即生效。本地同理：`bun run build` 会把 `.dev.vars` 带进 `dist/server`，改了 `.dev.vars` 后 `bun run preview` 前要重新构建（`bun run dev` 不用）。`GITHUB_CLIENT_ID` 或 `GITHUB_CLIENT_SECRET` 有一个为空时，登录接口返回 503「GitHub 登录还没配置好」，页面不显示登录入口。

线上**不要**设置 `AUTH_DEV_LOGIN` 或 `ADMIN_DEV_BYPASS`。它们只对 localhost 的请求生效，但线上没有理由出现。

### 10.3 本地测试

先建好本地表：`bunx wrangler d1 migrations apply sonui-blog --local`。然后两种方式任选：

- **假登录（不用 OAuth App）**：`.dev.vars` 里 `AUTH_DEV_LOGIN=1`（`ADMIN_DEV_BYPASS=1` 也会打开它），`GITHUB_CLIENT_ID` 留空，表单上的登录入口就换成本地假登录。也可以直接打开：

  ```text
  http://localhost:4321/api/auth/dev-login                                  # 默认 dev-visitor，id 10000001
  http://localhost:4321/api/auth/dev-login?login=someone&id=123&next=/list/  # 指定账号和回到哪页
  http://localhost:4321/api/auth/dev-login?login=sosyz&id=30596875           # 以博主身份（OWNER_GITHUB_ID）
  ```

  它和真登录走同一套会话（写 `users`、`sessions`，设置 `sid` cookie）。只对 localhost / 127.0.0.1 的请求生效，其它地址一律 404。

- **真登录**：再建一个只给本地用的 OAuth App（例如 `Sonui 的手账（本地）`），**Homepage URL** 填 `http://localhost:4321`，**Authorization callback URL** 填 `http://localhost:4321/api/auth/github/callback`，把它的 Client ID 和 secret 写进 `.dev.vars` 的 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`。用 `localhost` 打开页面，不要用 `127.0.0.1`（回调地址按当前域名生成，要和 App 里填的一致）。本地 http 下 cookie 不带 `Secure`，其它和线上一样。

### 10.4 检查

```bash
H=https://blog.sonui.cn

# 登录是否可用：{"enabled":true,"user":null,"isOwner":false,"login":"github"}
curl -s "$H/api/auth/me"

# 开始登录：302 到 github.com/login/oauth/authorize，带 client_id、
# redirect_uri=https%3A%2F%2Fblog.sonui.cn%2Fapi%2Fauth%2Fgithub%2Fcallback、scope=read%3Auser、state；
# 同时设置 gh_oauth cookie（Path=/api/auth/github; Max-Age=600; HttpOnly; Secure; SameSite=Lax）
curl -s -o /dev/null -D - "$H/api/auth/github/login?next=/list/" | grep -iE '^(HTTP|location|set-cookie)'

# 没有 gh_oauth cookie 的回调：400（state 对不上）
curl -s -o /dev/null -w '%{http_code}\n' "$H/api/auth/github/callback?code=x&state=y"

# 本地假登录在线上不存在：404
curl -s -o /dev/null -w '%{http_code}\n' "$H/api/auth/dev-login"

# 跨站退出被拒：403（同源时是 204）
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Origin: https://example.com' "$H/api/auth/logout"
```

然后在浏览器里走一遍：打开一篇笔记，点「用 GitHub 登录」，授权后回到原来的页面；工具条出现头像；开发者工具里 `sid` cookie 是 HttpOnly、Secure、SameSite=Lax。用博主账号发一条评论，确认显示「审核中」，在 `/admin/` 通过后带「博主」戳；画布工具条出现「整理贴纸」。查看登录过的账号：

```bash
bunx wrangler d1 execute sonui-blog --remote --command "SELECT github_id, login, name FROM users"
```

### 10.5 退出和删除账号

- 访客点「退出登录」只结束这个浏览器的会话；其它设备的会话 30 天不用后失效。在 GitHub 的 **Settings → Applications → Authorized OAuth Apps** 撤销授权，只影响以后的登录，不会让已有会话失效（本站不存 GitHub 令牌）。
- 有人要求删除账号时，先查出 `users.id`，结束所有会话，再处理评论和贴纸（删掉，或把 `user_id` 置空变回匿名），最后删账号：

  ```bash
  d1() { bunx wrangler d1 execute sonui-blog --remote --command "$1"; }
  d1 "SELECT id, login FROM users WHERE login = '<login>'"
  d1 "DELETE FROM sessions WHERE user_id = '<id>'"
  d1 "UPDATE comments SET user_id = NULL WHERE user_id = '<id>'"   # 或 DELETE，按对方的要求
  d1 "UPDATE stickers SET user_id = NULL WHERE user_id = '<id>'"   # 删贴纸时还要删 R2 里的 r2_key
  d1 "DELETE FROM users WHERE id = '<id>'"
  ```

  登录时写的评论，昵称和网址取自 GitHub 资料（名字和主页地址），只置空 `user_id` 时它们还在，需要时一起改掉。

## 日常更新

```bash
bun run build
bunx wrangler d1 migrations apply sonui-blog --remote   # 只在新增了迁移文件时
bunx wrangler deploy
```

部署后在 EdgeOne 控制台 **缓存清除** 里按 Host 清除 `blog.sonui.cn`（或按目录清除 `https://blog.sonui.cn/`）。页面和文本端点（`/`、`/list/`、`/notes/*`、`/privacy/`、`/rss.xml`、`/llms*.txt`、`/robots.txt`、`/sitemap-*`）由 `public/_headers` 发 `s-maxage=600`，EdgeOne 缓存 10 分钟；不清除的话新内容最多晚 10 分钟出现。浏览器是 `max-age=0`，每次向 EdgeOne 重新验证。`/_astro/*` 的文件名每次构建都会变，不受影响。

如果表单显示「人机验证暂时不可用」，说明 `wrangler.jsonc` 的 `vars.TURNSTILE_SITE_KEY` 是空的（可以 `curl https://blog.sonui.cn/api/turnstile` 确认），填好后重新部署即可，不用重新构建页面。Worker 日志在控制台 **Workers & Pages → sonui-blog → Logs**（`wrangler.jsonc` 已开启 observability）。

## 免费额度

| 服务 | 免费额度 | 本站用到的地方 |
| --- | --- | --- |
| Workers | 每天 10 万次请求，每次 10 ms CPU | 只有 `/api/*` 和 `/admin/`；静态页面和资源由静态资源直接返回，不跑 Worker 代码 |
| D1 | 每天 10 万次写入 | 每条评论、贴纸、审核决定各写一两行；频率限制从已有行计数，不额外写入 |
| R2 | 10 GB 存储 | 访客贴纸，每张不超过 300 KB；被拒绝的贴纸图片会删除 |

接口处理保持轻量（不在 Worker 里处理图片），就能一直留在免费额度内。
