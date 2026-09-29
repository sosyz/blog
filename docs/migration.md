# 旧博客迁移记录

2026-09-29 从旧 Hexo 博客（`master` 分支的 `source/_posts`）迁移了 24 篇文章到 `src/posts`。草稿 `implementing-ioc-with-the-wire-tool.md` 没有迁移。

迁移时做过的改动：

- frontmatter 改成 `src/content.config.ts` 的格式；`description` 按正文重新写成一句话。
- 配图移到 `src/assets/posts/<slug>/`，文件名改成小写短横线。Hexo 的 `{% asset_img %}` 改成标准 Markdown 图片，并补了中文替代文字。「深入 CSS」里掘金图床的外链图片已下载到本地。
- 整理了标题层级，给代码块补了语言标记，修正了明显的错别字和标点，中英文之间加了空格。代码块内容没有改动。
- 文章内容有疑问的地方迁移时没有改，先记下来；作者确认后已于 2026-09-29 统一处理，见下文「已处理（2026-09-29）」。

## 旧链接跳转

旧站的文章链接是 `/:title/`，`:title` 是原文件名：保留大小写，空格编码成 `%20`。新站的文章链接是 `/notes/<slug>/`。上线时要把下面的旧链接 301 跳转到新链接。

| 旧链接 | 新 slug |
| --- | --- |
| `/C-C-Binary-Trees/` | `c-cpp-binary-trees` |
| `/css-study-1/` | `css-study-1` |
| `/css-study-2/` | `css-study-2` |
| `/development-notes-for-apache-answer-plugin/` | `development-notes-for-apache-answer-plugin` |
| `/easySQLite-use-note/` | `easysqlite-use-note` |
| `/favorites/` | `favorites` |
| `/fitness-function-driven-development/` | `fitness-function-driven-development` |
| `/go-context/` | `go-context` |
| `/Go%20Redis%20Lib%20Serialize%20Struct/` | `go-redis-lib-serialize-struct` |
| `/how%20to%20set%20up%20cors/` | `how-to-set-up-cors` |
| `/Hydro-2-Custom-Development-Notes-Frontend-Section/` | `hydro-2-custom-development-notes-frontend-section` |
| `/Journey-to-Web-Development-Security/` | `journey-to-web-development-security` |
| `/k8s-install/` | `k8s-install` |
| `/kubesphere-extended-component-development-note/` | `kubesphere-extended-component-development-note` |
| `/Linux-Error-Certificate-verification-failed-The-certificate-is-NOT-trusted/` | `linux-certificate-not-trusted` |
| `/provide-idempotence-mechanisms/` | `provide-idempotence-mechanisms` |
| `/Python-Code-to-Convert-Chinese-Uppercase-Amounts-to-Lowercase-Numbers/` | `python-chinese-amount-to-number` |
| `/Redis-Reading-Notes/` | `redis-reading-notes` |
| `/rename-pve-hostname/` | `rename-pve-hostname` |
| `/restricting-access-to-mapped-ports-in-docker-containers/` | `restrict-docker-mapped-ports` |
| `/running-golang-code-on-tencent-cloud-FaaS/` | `running-golang-code-on-tencent-cloud-faas` |
| `/Setting-Up-the-VS-Code-C-C-Environment/` | `vscode-cpp-environment` |
| `/the-haters-guide-to-kubernetes/` | `the-haters-guide-to-kubernetes` |
| `/WireGuard%20Use%20Notes/` | `wireguard-use-notes` |

链接格式已对照线上旧站首页核实（例如 `/Go%20Redis%20Lib%20Serialize%20Struct/`、`/how%20to%20set%20up%20cors/`）。旧站的 `/archives/` 和 `/page/N/` 分页也应跳转到 `/list/`。

## 已处理（2026-09-29）

作者确认后逐条处理。只有改正了事实或代码错误的笔记把 `updatedDate` 设为 `2026-09-29`（标 ★），`pubDate` 都没动。

安全相关：

- `kubesphere-extended-component-development-note`：截图 `request-headers-with-cookie.png` 里 `argocd.token=` 后面的整段 JWT 用不透明色块盖住（文件名和格式不变）；webpack 配置里的密码改成 `'<你的密码>'`，并补一句「默认账号密码见 KubeSphere 官方文档，登录后改掉」；kubesphere.cloud 链接去掉推荐码。

失效的外链（替换前都用 curl 打开确认过）：

- `redis-reading-notes`：「如何阅读 Redis 源码？」改用 archive.org 存档，并注明原站已失效。
- `running-golang-code-on-tencent-cloud-faas`：`cn.serverless.com` 的 deploy 文档改用 archive.org 存档（Serverless 官网已没有腾讯云的 deploy 页）。
- `vscode-cpp-environment`：失效的蓝奏云链接其实是「推荐插件」的下载，改成 VS Code 扩展商店里 Code Runner 和 C/C++ 的页面。
- `development-notes-for-apache-answer-plugin`：issue 链接改到毕业后的新仓库 `apache/answer-plugins/issues/76`，注明仓库改名。
- `hydro-2-custom-development-notes-frontend-section`：「开发环境部署」改用 archive.org 存档，附上现在的文档站 docs.hydro.ac（新站上没找到对应页面）。
- `how-to-use-cloudflare-ai-by-gateway`：OpenAI Compatible 链接改为 `ai-sdk.dev/providers/openai-compatible-providers`。

结构：

- `k8s-install` ★：开头加「结论」（关闭 swap、`SystemdCgroup`、Pod 网段三条）；按步骤拆成「环境 / 安装 kubeadm… / 安装 CRI（containerd、runc 和 CNI、检查、配置）/ br_netfilter / 初始化 / 问题 / 解决」；apt、wget 等大段输出只留关键行，省略处写 `…`（顺带去掉了日志里的带签名下载地址）。
- `c-cpp-binary-trees` ★：加「查找二叉树的特性」「代码」「更正」三个 H2。
- `linux-certificate-not-trusted`：加「问题 / 原因 / 解决」H2 和解决步骤的 H3。
- `rename-pve-hostname`：加「修改主机名 / 迁移节点目录 / 检查存储配置 / 重启」H2。
- `fitness-function-driven-development` ★：加「译文」「原文段落」H2。
- `python-chinese-amount-to-number` ★：加「思路」「代码」「示例」H2。

内容错误：

- `k8s-install` ★：`--pod-network-cidr=192.168.2.0/24` 后加提醒：不能和主机网段重叠、要和 CNI 配置一致、`/24` 只够一个节点；关闭 swap 后补一句用 `cat /etc/fstab` 确认、重新 `kubeadm init`（必要时先 `kubeadm reset`）。没有替作者写初始化成功的结果。
- `css-study-1` ★：`a:active` 注释改为「鼠标按下（激活）时」；`white-space` 各取值的说明改正。
- `css-study-2` ★：`ac:link` → `a:link`；`color` 的初始值改为「由浏览器决定，是继承属性」；Flex 教程链接换成阮一峰的《Flex 布局教程：语法篇》；浮动示例的 `<img>` 属性写法改正。
- `journey-to-web-development-security` ★：CSRF 防御改为 `SameSite=Strict`（或 `Lax`），说明 `None` 不能防 CSRF；SQL 注入示例改成能闭合引号的输入和实际拼出的语句；预编译语句改为按 `gender` 查询并补上分号；`herf` → `href`，`scipt` → `script`。
- `hydro-2-custom-development-notes-frontend-section` ★：命令里的 `/var/lib/mongo` 统一成 `/var/lib/mongodb`；标题不动，`description` 改成「前端篇的第一步：搭开发环境…」。
- `provide-idempotence-mechanisms` ★：中间件改成处理前用 `SETNX` 原子占位、处理失败删 key，并加一段更正说明原来先检查后写入的并发问题；测试代码加注释说明用 GET 只是示例接口，真正要保护的是 POST 等非幂等接口。
- `redis-reading-notes` ★：「长度最大为 32 位」改为「长度只有 5 位，最大 2^5-1」；注明 `hisdshdr*` 摘自 Redis 自带的 hiredis，Redis 自己的是 `src/sds.h` 的 `sdshdr*`。
- `development-notes-for-apache-answer-plugin`：空的「0x03 接入飞书」下写「待续。」。
- `fitness-function-driven-development` ★：标题的「测试驱动开发」改为「适应度函数驱动开发」；`description` 和开头一句写明只译了开头两句。
- `go-context` ★：`WithValue` 同名 key 读到的是离当前 context 最近（最后一次）设置的值。
- `running-golang-code-on-tencent-cloud-faas` ★：Makefile 改用 Tab 缩进，`CGO_ENABLED=0` 写到 `go build` 同一行，并加一句说明原因。
- `c-cpp-binary-trees` ★：`findValue` 改成左右子树都找（树不是查找二叉树），打印地址改为 `temp`，文末「更正」说明两处改动。编译并跑过示例输入。
- `easysqlite-use-note`：删掉开头重复的第二段；注明 `GbkToUtf8` 用的是 Windows API，只能在 Windows 上用。
- `python-chinese-amount-to-number` ★：重写转换函数（按「节」累加，支持数字在末尾、「拾」开头、万和亿），加更正说明；用 python3 跑过 11 个输入。
- `wireguard-use-notes`：去掉 frontmatter 的 `heroImage`，拓扑图只留在正文「网络拓扑」小节里（卡片不再有拍立得，分享图用默认图）。

没有改的：

- `the-haters-guide-to-kubernetes`、`favorites`：以引用为主，本来就有标题；作者的看法不能代写，保持原样。`fitness-function-driven-development` 也没有补译或加评论。
- `vscode-cpp-environment` 里 MinGW-W64 的「国内下载」蓝奏云链接还能打开，保留；失效的是插件链接。
- `how-to-use-cloudflare-ai-by-gateway` 里 generateText 的 `vercel.com/docs/ai-sdk#generating-text` 仍然有效，保留。
- `k8s-install` 的结局（初始化是否成功）原文没写，没有补。

## 待作者确认

目前没有。之后发现的疑问继续记在这里。
