---
title: PVE 修改节点主机名
date: 2024-04-12T00:07:35+08:00
tags: PVE, Proxmox VE
---

由于前期安装的时随便起的 Proxmox VE 节点主机名，现在想要修改为更有意义的名字便于多集群管理。

<!-- more -->

修改的文件有：

- /etc/hosts
- /etc/hostname
- /etc/postfix/main.cf

对于主机名也可以通过 `hostnamectl` 命令来修改。

```bash
hostnamectl set-hostname hangzhou-home-pve
```

然后修改 `/etc/pve/nodes/` 下的文件夹名字，以及文件夹下的配置文件。

需要注意的是可能在对旧文件夹拷贝至新文件夹时会产生已存在错误，需要把旧文件夹下的文件放到一个临时的地方，然后删除旧文件夹，再把文件拷贝到新文件夹。

```bash
ll /etc/pve/nodes/
mkdir /etc/pve/nodes/hangzhou-home-pve
mkdir ~/old-pve
cp -r /etc/pve/nodes/pve/* ~/old-pve/
rm -rf /etc/pve/nodes/pve
cp -r ~/old-pve/* /etc/pve/nodes/hangzhou-home-pve/
```

如果创建了额外的存储，可能需要修改 `PVE` 的存储配置文件。

```bash
nano /etc/pve/storage.cfg
```

检查配置文件

```text
dir: local
        path /var/lib/vz
        content vztmpl,backup,iso

lvmthin: local-lvm
        thinpool data
        vgname pve
        content rootdir,images

zfspool: bucket1
        pool bucket1
        content rootdir,images
        mountpoint /bucket1
        nodes hangzhou-home-pve  # 检查这里
```

检查 `nodes` 是否正确，如果不正确，修改为新的主机名。

`nodes` 配置说明如下

> Source: <https://pve.proxmox.com/wiki/Storage>
> nodes
> List of cluster node names where this storage is usable/accessible. One can use this property to restrict storage access to a limited set of nodes.

最后重启

```bash
reboot
```
