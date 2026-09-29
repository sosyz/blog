---
title: "Hydro 二开笔记 前端篇"
description: "Hydro 评测系统二开前端篇的第一步：搭开发环境，安装 Node、MongoDB，拉取源码并用 pm2 启动。"
type: 踩坑
topic: Web
tags: [Hydro, 前端, MongoDB]
pubDate: "2022-04-03"
updatedDate: "2026-09-29"
---

Hydro 是一个开源的在线评测系统，支持多种语言和评测方式，其良好的用户体验和丰富的功能使其成为一个优秀的评测系统。本文记录了 Hydro 的二次开发笔记，主要是前端部分。

## 前置知识

- React（JavaScript 框架）
- Stylus（Node.js 的 CSS 处理器）

## 开发环境

- Node.js 16.14.2：Hydro 的 workspace 需要至少 Node 16，而 17 会出现问题没细研究，用 16 了
- VS Code
- Git
- MongoDB
- Linux：如果习惯 Windows 推荐使用 WSL

然后安装 yarn 及 npx

```shell
npm install -g yarn
yarn global add npx
npm install -g pm2
```

**确保安装过程中无错误后继续下一步**

## 数据库

### 安装

我使用的环境是 Ubuntu 20.04，安装的版本为 5.0，如果同需求可以到 [Install MongoDB Community Edition on Linux — MongoDB Manual](https://www.mongodb.com/docs/manual/administration/install-on-linux/) 参考安装方法

**接下来步骤均在 root 下执行**

```shell
wget -qO - https://www.mongodb.org/static/pgp/server-5.0.asc | sudo apt-key add -  #添加证书
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/5.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-5.0.list #添加mongodb安装源
apt-get update
sudo apt-get install -y mongodb-org
```

### 启动 MongoDB

默认情况下 MongoDB 启动后会初始化以下两个目录：

- 数据存储目录：/var/lib/mongodb
- 日志文件目录：/var/log/mongodb

在启动前可以先创建这两个目录并设置当前用户有读写权限：

```shell
sudo mkdir -p /var/lib/mongodb
sudo mkdir -p /var/log/mongodb
sudo chown `whoami` /var/lib/mongodb   # 设置权限
sudo chown `whoami` /var/log/mongodb   # 设置权限
```

接下来启动 MongoDB 服务：

```shell
mongod --dbpath /var/lib/mongodb --logpath /var/log/mongodb/mongod.log --fork
```

打开 /var/log/mongodb/mongod.log 文件看到以下信息，说明启动成功。

```shell
# tail -10f /var/log/mongodb/mongod.log
2020-07-09T12:20:17.391+0800 I  NETWORK  [listener] Listening on /tmp/mongodb-27017.sock
2020-07-09T12:20:17.392+0800 I  NETWORK  [listener] Listening on 127.0.0.1
2020-07-09T12:20:17.392+0800 I  NETWORK  [listener] waiting for connections on port 27017
```

## 拉取源码

```shell
git clone https://github.com/hydro-dev/Hydro.git /root/Hydro --recursive # 可以fork原仓库后拉取到本地
cd /root/Hydro # 进入工作目录
yarn # 安装依赖包
yarn build:ui:production # 编译前端
```

## 启动项目

```shell
pm2 start packages/hydrooj/bin/hydrooj.js
```

看到状态为绿色启动成功以后，就可以通过 `http://[::1]:8888` 访问

## 参考资料

> [开发环境部署 | Hydro](https://web.archive.org/web/20240226114053/https://hydro.js.org/dev/)（原页面已下线，archive.org 存档；现在的文档站是 <https://docs.hydro.ac/>）
>
> [Linux 平台安装 MongoDB | 菜鸟教程 (runoob.com)](https://www.runoob.com/mongodb/mongodb-linux-install.html)
>
> [Install MongoDB Community Edition on Linux — MongoDB Manual](https://www.mongodb.com/docs/manual/administration/install-on-linux/)
