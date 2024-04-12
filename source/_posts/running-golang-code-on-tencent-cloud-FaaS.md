---
title: 使用Golang开发腾讯云函数
date: 2022-04-29T10:35:51+08:00
tags: Golang, Serverless
---

在腾讯云 `Serverless` 使用 `Golang` 语言进行开发时遇到的一些问题及解决办法记录

<!-- more -->

## 编译问题

交叉编译不能用powershell，需要使用cmd

## 启动问题

web函数需要一个scf_bootstrap来定义启动的文件，其内容为

```shell
#!/bin/bash

./httpserver
```

其中 `httpserver` 为文件名，需要注意文件换行需要使用LF，否则云函数无法识别

## 云函数环境问题

运行报错 `libc.so.6: version GLIBC_2.28' not found （联系客服得知）

需改为静态编译，Makefile文件如下

```Makefile
all:
    export CGO_ENABLED=0
    go build -o build/xxxxx/main  -a -ldflags '-extldflags "-static"' .
    serverless deploy --target build/xxxxx/
```

## 忽略缓存

在部署命令后添加 --force 例如  serverless deploy --force ，

> --force 强制部署，跳过缓存和 serverless 应用校验

[Tencent Serverless - Deploy 部署](https://cn.serverless.com/framework/docs-commands-deploy)
