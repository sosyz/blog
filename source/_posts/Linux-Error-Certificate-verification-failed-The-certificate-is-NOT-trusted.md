---
title: 'Linux 报错Certificate verification failed: The certificate is NOT trusted.'
date: 2021-03-11 23:02:06
tags:
---

原因为未安装ca-certificates

可以先编辑 `/etc/apt/sources.list` 文件临时使用http源

```shell
nano /etc/apt/sources.list
```

或者

```shell
vim /etc/apt/sources.list
```

粘贴或者更改源（`https://` 到 `http://`)

> deb <http://mirrors.tuna.tsinghua.edu.cn/debian/> buster main contrib non-free
> deb <http://mirrors.tuna.tsinghua.edu.cn/debian/> buster-updates main contrib non-free
> deb <http://mirrors.tuna.tsinghua.edu.cn/debian/> buster-backports main contrib non-free
> deb <http://mirrors.tuna.tsinghua.edu.cn/debian-security> buster/updates main contrib non-free

然后安装ca-certificates包（**`注意：看到有的文章将源改为http便无下文，建议继续执行以下步骤改回https，使用http将大幅度提高网络风险`**）

```shell
apt update
apt install ca-certificates
```

安装完成后编辑源 `/etc/apt/sources.list`

> deb <https://mirrors.tuna.tsinghua.edu.cn/debian/> buster main contrib non-free
> deb <https://mirrors.tuna.tsinghua.edu.cn/debian/> buster-updates main contrib non-free
> deb <https://mirrors.tuna.tsinghua.edu.cn/debian/> buster-backports main contrib non-free
> deb <https://mirrors.tuna.tsinghua.edu.cn/debian-security> buster/updates main contrib non-free

执行`apt update`更新，完成
