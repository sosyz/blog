---
title: "k8s 集群安装"
description: "用 kubeadm 和 containerd 在三台 Ubuntu 上搭建集群，记录安装过程与关闭 swap 的坑。"
type: 踩坑
topic: 云原生
tags: [Kubernetes, Linux, containerd]
pubDate: "2024-05-09"
updatedDate: "2026-09-29"
---

搭建一个 k8s 集群，记录一下过程。本次使用三台主机，分别是 master 节点和两个 worker 节点。

## 结论

- `kubeadm init` 失败的原因是节点开着 swap，kubelet 默认不支持 swap，==每台节点都要关闭 swap==（`swapoff -a` 并注释掉 `/etc/fstab` 里的 swap 行）。
- containerd 的配置里要把 `SystemdCgroup` 改为 `true`。
- `--pod-network-cidr` 不要和主机所在网段重叠（见下文「初始化 master 节点」）。

## 环境

主机配置统一如下：

| 配置项 | 配置 |
| --- | --- |
| OS | Ubuntu 22.04.4 LTS x86_64 |
| Kernel | 5.15.0-102-generic |
| CPU | AMD Ryzen 7 5700X (16) @ 3.399GHz |
| Memory | 8G |
| Disk | 100G |

Cluster 节点信息如下：

| 主机名 | IP 地址 | 角色 |
| --- | --- | --- |
| k8s-master | 192.168.2.216 | master |
| k8s-worker-1 | 192.168.2.215 | worker |
| k8s-worker-2 | 192.168.2.217 | worker |

下面以 k8s-worker-2 上的记录为例，终端输出只保留了关键的几行，省略的部分用 `…` 表示。

## 安装 kubeadm、kubelet 和 kubectl

先检查网卡 MAC 地址和 `product_uuid`，确保每台节点都不一样：

```bash
sonui@k8s-worker-2:~$ ip link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: enp6s18: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 36:3b:1e:33:1f:a4 brd ff:ff:ff:ff:ff:ff
sonui@k8s-worker-2:~$ sudo cat /sys/class/dmi/id/product_uuid
7247c410-2833-4bcf-9757-165f23dcbec4
```

添加 Kubernetes 的 apt 源并安装：

```bash
sonui@k8s-worker-2:~$ sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl gpg
sonui@k8s-worker-2:~$ curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
sonui@k8s-worker-2:~$ echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /
sonui@k8s-worker-2:~$ sudo apt-get update && sudo apt-get install -y kubelet kubeadm kubectl && sudo apt-mark hold kubelet kubeadm kubectl
…
The following NEW packages will be installed:
  conntrack cri-tools ebtables ethtool iptables kubeadm kubectl kubelet kubernetes-cni libip6tc2 libnetfilter-conntrack3 libnfnetlink0 libnftnl11 socat
…
Setting up kubelet (1.29.4-2.1) ...
Setting up kubeadm (1.29.4-2.1) ...
…
kubelet set on hold.
kubeadm set on hold.
kubectl set on hold.
```

## 安装 CRI

这里选择使用 [containerd](https://kubernetes.io/zh-cn/docs/setup/production-environment/tools/kubeadm/install-kubeadm/) 作为 CRI，安装过程如下。

### 安装 containerd

解压 containerd，并安装 systemd 服务文件：

```bash
sonui@k8s-worker-2:~$ sudo tar Cxzvf /usr/local containerd-1.7.16-linux-amd64.tar.gz
bin/
bin/containerd-shim-runc-v2
bin/containerd-stress
bin/containerd
bin/containerd-shim-runc-v1
bin/ctr
bin/containerd-shim
sonui@k8s-worker-2:~$ wget https://raw.githubusercontent.com/containerd/containerd/main/containerd.service && \
> sudo mv containerd.service /lib/systemd/system/ && \
> sudo systemctl daemon-reload && \
> sudo systemctl enable --now containerd
…
mv: cannot move 'containerd.service' to '/lib/systemd/system/containerd.service': Permission denied
…
sonui@k8s-worker-2:~$ rm containerd.service*
sonui@k8s-worker-2:~$ wget https://raw.githubusercontent.com/containerd/containerd/main/containerd.service
…
sonui@k8s-worker-2:~$ sudo mv containerd.service /lib/systemd/system/
sonui@k8s-worker-2:~$ sudo systemctl daemon-reload
sonui@k8s-worker-2:~$ sudo systemctl enable --now containerd
Created symlink /etc/systemd/system/multi-user.target.wants/containerd.service → /lib/systemd/system/containerd.service.
```

### 安装 runc 和 CNI 插件

```bash
sonui@k8s-worker-2:~$ wget https://github.com/opencontainers/runc/releases/download/v1.1.12/runc.amd64
…
sonui@k8s-worker-2:~$ sudo install -m 755 runc.amd64 /usr/local/sbin/runc
sonui@k8s-worker-2:~$ wget https://github.com/containernetworking/plugins/releases/download/v1.4.1/cni-plugins-linux-amd64-v1.4.1.tgz
…
sonui@k8s-worker-2:~$ sudo mkdir -p /opt/cni/bin && sudo  tar Cxzvf /opt/cni/bin cni-plugins-linux-amd64-v1.4.1.tgz
./
./LICENSE
./host-device
…
./portmap
./vrf
```

### 检查 containerd

不加 `sudo` 连不上 containerd 的 socket，加上以后能看到 Server 信息：

```bash
sonui@k8s-worker-2:~$ ctr version
…
ctr: failed to dial "/run/containerd/containerd.sock": connection error: desc = "transport: error while dialing: dial unix /run/containerd/containerd.sock: connect: permission denied"
sonui@k8s-worker-2:~$ sudo ctr version
Client:
  Version:  v1.7.16
  Revision: 83031836b2cf55637d7abf847b17134c51b38e53
  Go version: go1.21.9

Server:
  Version:  v1.7.16
  Revision: 83031836b2cf55637d7abf847b17134c51b38e53
  UUID: 95166d03-6fc0-4748-8165-4a1ffb9a5e0a
```

### 重新安装服务文件和 runc

```bash
sonui@k8s-worker-2:~$ sudo curl -o /etc/systemd/system/containerd.service https://raw.githubusercontent.com/containerd/containerd/main/containerd.service
…
sonui@k8s-worker-2:~$ sudo systemctl daemon-reload
sonui@k8s-worker-2:~$ sudo systemctl enable --now containerd
Removed /etc/systemd/system/multi-user.target.wants/containerd.service.
Created symlink /etc/systemd/system/multi-user.target.wants/containerd.service → /etc/systemd/system/containerd.service.
sonui@k8s-worker-2:~$ wget https://github.com/opencontainers/runc/releases/download/v1.1.13/libseccomp-2.5.5.tar.gz
…
sonui@k8s-worker-2:~$ tar -zxf libseccomp-2.5.5.tar.gz
sonui@k8s-worker-2:~$ sudo install -m 755 runc.amd64 /usr/local/sbin/runc
```

### 配置 containerd

生成默认配置，把 `SystemdCgroup` 改为 `true`，然后重启 containerd：

```bash
sonui@k8s-worker-2:~$ containerd config default > /etc/containerd/config.toml
-bash: /etc/containerd/config.toml: No such file or directory
sonui@k8s-worker-2:~$ mkdir /etc/containerd/
mkdir: cannot create directory ‘/etc/containerd/’: Permission denied
sonui@k8s-worker-2:~$ sudo mkdir /etc/containerd/
sonui@k8s-worker-2:~$ sudo sh -c 'containerd config default > /etc/containerd/config.toml'
sonui@k8s-worker-2:~$ sudo nano /etc/containerd/config.toml # 搜索SystemdCgroup 改为true
sonui@k8s-worker-2:~$ sudo systemctl restart containerd
```

master 节点上的 containerd 配置：

```bash
root@k8s-master:/home/sonui# containerd config default > /etc/containerd/config.toml
root@k8s-master:/home/sonui# nano /etc/containerd/config.toml
root@k8s-master:/home/sonui# sudo systemctl restart containerd
```

## 加载 br_netfilter

执行下面的命令，确保 `br_netfilter` 模块已加载：

```bash
modprobe br_netfilter
echo 1 > /proc/sys/net/bridge/bridge-nf-call-iptables
echo 1 > /proc/sys/net/ipv4/ip_forward
```

## 初始化 master 节点

执行 `kubeadm init` 初始化 master 节点：

```bash
kubeadm init --pod-network-cidr=192.168.2.0/24 --apiserver-advertise-address=192.168.2.216
```

> 注意：`--pod-network-cidr` 是分给 Pod 的网段，不能和主机所在的 `192.168.2.0/24` 重叠，否则 Pod 地址会和主机地址冲突、路由出错。它还要和之后装的 CNI 插件的配置一致，例如 Flannel 默认是 `10.244.0.0/16`。另外 kubeadm 默认给每个节点分一个 `/24`，整个网段只给 `/24` 的话只够一个节点用。

## 问题：kubelet 报 swap 未关闭

安装发生错误，查看 `kubelet` 日志，发现一条错误：

```text
Jul 12 15:29:34 k8s-master kubelet[8988]: E0712 15:29:34.379885    8988 run.go:74] "command failed" err="failed to run Kubelet: running with swap on is not supported, please disable swap! or set --fail-swap-on flag to false. /proc/swaps contained: [Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority /swap.img                               file\t\t4194300\t\t0\t\t-2]"
```

## 解决：关闭 swap

解决方法是永久关闭 swap 分区：

```bash
sudo swapoff -a
sudo sed -i '/ swap / s/^\(.*\)$/#\1/g' /etc/fstab
```

执行后用 `cat /etc/fstab` 确认 swap 那一行已经被注释掉（如果字段之间是 Tab 而不是空格，上面的 `sed` 匹配不到，需要手动注释）。关闭 swap 后重新执行 `kubeadm init`；之前失败留下的文件可以先用 `sudo kubeadm reset` 清理。
