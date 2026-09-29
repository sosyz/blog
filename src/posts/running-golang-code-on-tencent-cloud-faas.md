---
title: "使用 Golang 开发腾讯云函数"
description: "记录用 Go 开发腾讯云函数时遇到的编译、启动、GLIBC 与部署缓存问题。"
type: 踩坑
topic: Go
tags: [Go, Serverless, 腾讯云]
pubDate: "2022-04-29"
updatedDate: "2026-09-29"
---

在腾讯云 `Serverless` 使用 `Golang` 语言进行开发时遇到的一些问题及解决办法记录。

## 编译问题

交叉编译不能用 PowerShell，需要使用 cmd。

## 启动问题

Web 函数需要一个 `scf_bootstrap` 来定义启动的文件，其内容为：

```shell
#!/bin/bash

./httpserver
```

其中 `httpserver` 为文件名，需要注意文件换行需要使用 LF，否则云函数无法识别。

## 云函数环境问题

运行报错 `` libc.so.6: version `GLIBC_2.28' not found ``（联系客服得知）。

需改为静态编译，Makefile 文件如下：

```makefile
all:
	CGO_ENABLED=0 go build -o build/xxxxx/main  -a -ldflags '-extldflags "-static"' .
	serverless deploy --target build/xxxxx/
```

注意 Makefile 里的命令行必须用 Tab 缩进；而且每行命令在单独的 shell 里执行，单独写一行 `export CGO_ENABLED=0` 不会带到下一行的 `go build`，所以要写在同一行。

## 忽略缓存

在部署命令后添加 `--force`，例如 `serverless deploy --force`。

> `--force` 强制部署，跳过缓存和 serverless 应用校验

[Tencent Serverless - Deploy 部署](https://web.archive.org/web/20240912023100/https://cn.serverless.com/framework/docs-commands-deploy)（原站已关闭，这是 archive.org 存档）
