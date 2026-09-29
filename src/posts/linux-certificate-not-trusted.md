---
title: "Linux 报错 Certificate verification failed: The certificate is NOT trusted."
description: "apt 使用 https 源报证书不受信任，先临时换 http 源安装 ca-certificates 再改回。"
type: 踩坑
topic: 运维与网络
tags: [Linux, 安全]
status: 已解决
pubDate: "2021-03-11"
---

## 问题

在 Linux 系统中使用 apt-get 更新软件时，出现错误 `Certificate verification failed: The certificate is NOT trusted.` 的解决方法。

## 原因

原因为未安装 ca-certificates。

## 解决

### 临时换成 http 源

可以先编辑 `/etc/apt/sources.list` 文件临时使用 http 源。

```shell
nano /etc/apt/sources.list
```

或者

```shell
vim /etc/apt/sources.list
```

粘贴或者更改源（`https://` 到 `http://`）

```text
deb http://mirrors.tuna.tsinghua.edu.cn/debian/ buster main contrib non-free
deb http://mirrors.tuna.tsinghua.edu.cn/debian/ buster-updates main contrib non-free
deb http://mirrors.tuna.tsinghua.edu.cn/debian/ buster-backports main contrib non-free
deb http://mirrors.tuna.tsinghua.edu.cn/debian-security buster/updates main contrib non-free
```

### 安装 ca-certificates

然后安装 ca-certificates 包（**`注意：看到有的文章将源改为http便无下文，建议继续执行以下步骤改回https，使用http将大幅度提高网络风险`**）

```shell
apt update
apt install ca-certificates
```

### 改回 https 源

安装完成后编辑源 `/etc/apt/sources.list`

```text
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ buster main contrib non-free
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ buster-updates main contrib non-free
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ buster-backports main contrib non-free
deb https://mirrors.tuna.tsinghua.edu.cn/debian-security buster/updates main contrib non-free
```

执行 `apt update` 更新，完成。
