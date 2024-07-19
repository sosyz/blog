---
title: k8s 集群安装
date: 2024-05-09T23:42:16+08:00
tags: k8s, Linux
---

决定重新搭建一个 k8s 集群，记录一下过程。本次使用三台主机，分别是 master 节点和两个 worker 节点。

主机配置统一如下：

| 配置项 |配置 |
| --- |--- |
| OS |Ubuntu 22.04.4 LTS x86_64 |
| Kernel |5.15.0-102-generic |
| CPU |AMD Ryzen 7 5700X (16) @ 3.399GHz |
| Memory | 8G |
| Disk | 100G |

Cluster 节点信息如下：

| 主机名 |IP 地址 |角色 |
| --- | --- | --- |
| k8s-master | 192.168.2.216 | master |
| k8s-worker-1 | 192.168.2.215 | worker |
| k8s-worker-2 | 192.168.2.217 | worker |

## 安装 CRI

这里选择使用 [containerd](https://kubernetes.io/zh-cn/docs/setup/production-environment/tools/kubeadm/install-kubeadm/) 作为 CRI，安装过程如下：

```bash
sonui@k8s-worker-2:~$ ip link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: enp6s18: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 36:3b:1e:33:1f:a4 brd ff:ff:ff:ff:ff:ff
sonui@k8s-worker-2:~$ sudo cat /sys/class/dmi/id/product_uuid
7247c410-2833-4bcf-9757-165f23dcbec4
sonui@k8s-worker-2:~$ sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl gpg
sonui@k8s-worker-2:~$ curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
sonui@k8s-worker-2:~$ echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /
sonui@k8s-worker-2:~$ sudo apt-get update && sudo apt-get install -y kubelet kubeadm kubectl && sudo apt-mark hold kubelet kubeadm kubectl
Hit:2 https://cn.archive.ubuntu.com/ubuntu jammy InRelease                  
Get:1 https://prod-cdn.packages.k8s.io/repositories/isv:/kubernetes:/core:/stable:/v1.29/deb  InRelease [1186 B]
Hit:3 https://cn.archive.ubuntu.com/ubuntu jammy-updates InRelease
Get:4 https://prod-cdn.packages.k8s.io/repositories/isv:/kubernetes:/core:/stable:/v1.29/deb  Packages [7781 B]
Hit:5 https://cn.archive.ubuntu.com/ubuntu jammy-backports InRelease
Hit:6 https://cn.archive.ubuntu.com/ubuntu jammy-security InRelease
Fetched 8967 B in 2s (4871 B/s)
Reading package lists... Done
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
The following additional packages will be installed:
  conntrack cri-tools ebtables ethtool iptables kubernetes-cni libip6tc2 libnetfilter-conntrack3 libnfnetlink0 libnftnl11 socat
Suggested packages:
  nftables firewalld
The following NEW packages will be installed:
  conntrack cri-tools ebtables ethtool iptables kubeadm kubectl kubelet kubernetes-cni libip6tc2 libnetfilter-conntrack3 libnfnetlink0 libnftnl11 socat
0 upgraded, 14 newly installed, 0 to remove and 18 not upgraded.
Need to get 93.3 MB of archives.
After this operation, 350 MB of additional disk space will be used.
Get:6 https://cn.archive.ubuntu.com/ubuntu jammy-updates/main amd64 libip6tc2 amd64 1.8.7-1ubuntu5.2 [20.3 kB]
Get:1 https://prod-cdn.packages.k8s.io/repositories/isv:/kubernetes:/core:/stable:/v1.29/deb  cri-tools 1.29.0-1.1 [20.1 MB]
Get:7 https://cn.archive.ubuntu.com/ubuntu jammy/main amd64 libnfnetlink0 amd64 1.0.1-3build3 [14.6 kB]
Get:8 https://cn.archive.ubuntu.com/ubuntu jammy/main amd64 libnetfilter-conntrack3 amd64 1.0.9-1 [45.3 kB]
Get:9 https://cn.archive.ubuntu.com/ubuntu jammy/main amd64 libnftnl11 amd64 1.2.1-1build1 [65.5 kB]
Get:10 https://cn.archive.ubuntu.com/ubuntu jammy-updates/main amd64 iptables amd64 1.8.7-1ubuntu5.2 [455 kB]
Get:11 https://cn.archive.ubuntu.com/ubuntu jammy/main amd64 conntrack amd64 1:1.4.6-2build2 [33.5 kB]
Get:12 https://cn.archive.ubuntu.com/ubuntu jammy/main amd64 ebtables amd64 2.0.11-4build2 [84.9 kB]
Get:13 https://cn.archive.ubuntu.com/ubuntu jammy-updates/main amd64 ethtool amd64 1:5.16-1ubuntu0.1 [207 kB]
Get:14 https://cn.archive.ubuntu.com/ubuntu jammy/main amd64 socat amd64 1.7.4.1-3ubuntu4 [349 kB]
Get:2 https://prod-cdn.packages.k8s.io/repositories/isv:/kubernetes:/core:/stable:/v1.29/deb  kubernetes-cni 1.3.0-1.1 [31.4 MB]
Get:3 https://prod-cdn.packages.k8s.io/repositories/isv:/kubernetes:/core:/stable:/v1.29/deb  kubelet 1.29.4-2.1 [19.9 MB]                                         
Get:4 https://prod-cdn.packages.k8s.io/repositories/isv:/kubernetes:/core:/stable:/v1.29/deb  kubectl 1.29.4-2.1 [10.5 MB]                                         
Get:5 https://prod-cdn.packages.k8s.io/repositories/isv:/kubernetes:/core:/stable:/v1.29/deb  kubeadm 1.29.4-2.1 [10.1 MB]                                         
Fetched 93.3 MB in 11s (8519 kB/s)                                                                                                                                 
debconf: delaying package configuration, since apt-utils is not installed
Selecting previously unselected package libip6tc2:amd64.
(Reading database ... 66219 files and directories currently installed.)
Preparing to unpack .../00-libip6tc2_1.8.7-1ubuntu5.2_amd64.deb ...
Unpacking libip6tc2:amd64 (1.8.7-1ubuntu5.2) ...
Selecting previously unselected package libnfnetlink0:amd64.
Preparing to unpack .../01-libnfnetlink0_1.0.1-3build3_amd64.deb ...
Unpacking libnfnetlink0:amd64 (1.0.1-3build3) ...
Selecting previously unselected package libnetfilter-conntrack3:amd64.
Preparing to unpack .../02-libnetfilter-conntrack3_1.0.9-1_amd64.deb ...
Unpacking libnetfilter-conntrack3:amd64 (1.0.9-1) ...
Selecting previously unselected package libnftnl11:amd64.
Preparing to unpack .../03-libnftnl11_1.2.1-1build1_amd64.deb ...
Unpacking libnftnl11:amd64 (1.2.1-1build1) ...
Selecting previously unselected package iptables.
Preparing to unpack .../04-iptables_1.8.7-1ubuntu5.2_amd64.deb ...
Unpacking iptables (1.8.7-1ubuntu5.2) ...
Selecting previously unselected package conntrack.
Preparing to unpack .../05-conntrack_1%3a1.4.6-2build2_amd64.deb ...
Unpacking conntrack (1:1.4.6-2build2) ...
Selecting previously unselected package cri-tools.
Preparing to unpack .../06-cri-tools_1.29.0-1.1_amd64.deb ...
Unpacking cri-tools (1.29.0-1.1) ...
Selecting previously unselected package ebtables.
Preparing to unpack .../07-ebtables_2.0.11-4build2_amd64.deb ...
Unpacking ebtables (2.0.11-4build2) ...
Selecting previously unselected package ethtool.
Preparing to unpack .../08-ethtool_1%3a5.16-1ubuntu0.1_amd64.deb ...
Unpacking ethtool (1:5.16-1ubuntu0.1) ...
Selecting previously unselected package kubernetes-cni.
Preparing to unpack .../09-kubernetes-cni_1.3.0-1.1_amd64.deb ...
Unpacking kubernetes-cni (1.3.0-1.1) ...
Selecting previously unselected package socat.
Preparing to unpack .../10-socat_1.7.4.1-3ubuntu4_amd64.deb ...
Unpacking socat (1.7.4.1-3ubuntu4) ...
Selecting previously unselected package kubelet.
Preparing to unpack .../11-kubelet_1.29.4-2.1_amd64.deb ...
Unpacking kubelet (1.29.4-2.1) ...
Selecting previously unselected package kubectl.
Preparing to unpack .../12-kubectl_1.29.4-2.1_amd64.deb ...
Unpacking kubectl (1.29.4-2.1) ...
Selecting previously unselected package kubeadm.
Preparing to unpack .../13-kubeadm_1.29.4-2.1_amd64.deb ...
Unpacking kubeadm (1.29.4-2.1) ...
Setting up libip6tc2:amd64 (1.8.7-1ubuntu5.2) ...
Setting up libnftnl11:amd64 (1.2.1-1build1) ...
Setting up kubectl (1.29.4-2.1) ...
Setting up ebtables (2.0.11-4build2) ...
update-alternatives: using /usr/sbin/ebtables-legacy to provide /usr/sbin/ebtables (ebtables) in auto mode
Setting up socat (1.7.4.1-3ubuntu4) ...
Setting up libnfnetlink0:amd64 (1.0.1-3build3) ...
Setting up cri-tools (1.29.0-1.1) ...
Setting up kubernetes-cni (1.3.0-1.1) ...
Setting up ethtool (1:5.16-1ubuntu0.1) ...
Setting up libnetfilter-conntrack3:amd64 (1.0.9-1) ...
Setting up iptables (1.8.7-1ubuntu5.2) ...
update-alternatives: using /usr/sbin/iptables-legacy to provide /usr/sbin/iptables (iptables) in auto mode
update-alternatives: using /usr/sbin/ip6tables-legacy to provide /usr/sbin/ip6tables (ip6tables) in auto mode
update-alternatives: using /usr/sbin/iptables-nft to provide /usr/sbin/iptables (iptables) in auto mode
update-alternatives: using /usr/sbin/ip6tables-nft to provide /usr/sbin/ip6tables (ip6tables) in auto mode
update-alternatives: using /usr/sbin/arptables-nft to provide /usr/sbin/arptables (arptables) in auto mode
update-alternatives: using /usr/sbin/ebtables-nft to provide /usr/sbin/ebtables (ebtables) in auto mode
Setting up conntrack (1:1.4.6-2build2) ...
Setting up kubelet (1.29.4-2.1) ...
Setting up kubeadm (1.29.4-2.1) ...
Processing triggers for libc-bin (2.35-0ubuntu3.6) ...
debconf: unable to initialize frontend: Dialog
debconf: (No usable dialog-like program is installed, so the dialog based frontend cannot be used. at /usr/share/perl5/Debconf/FrontEnd/Dialog.pm line 78.)
debconf: falling back to frontend: Readline
Scanning processes...                                                                                                                                               
Scanning linux images...                                                                                                                                            

Running kernel seems to be up-to-date.

No services need to be restarted.

No containers need to be restarted.

No user sessions are running outdated binaries.

No VM guests are running outdated hypervisor (qemu) binaries on this host.
kubelet set on hold.
kubeadm set on hold.
kubectl set on hold.
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
--2024-05-09 15:35:50--  https://raw.githubusercontent.com/containerd/containerd/main/containerd.service
Resolving raw.githubusercontent.com (raw.githubusercontent.com)... 198.18.0.23
Connecting to raw.githubusercontent.com (raw.githubusercontent.com)|198.18.0.23|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 1251 (1.2K) [text/plain]
Saving to: ‘containerd.service’

containerd.service                                100%[==========================================================================================================>]   1.22K  --.-KB/s    in 0s      

2024-05-09 15:35:50 (103 MB/s) - ‘containerd.service’ saved [1251/1251]

mv: cannot move 'containerd.service' to '/lib/systemd/system/containerd.service': Permission denied
sonui@k8s-worker-2:~$ wget https://raw.githubusercontent.com/containerd/containerd/main/containerd.service && > sudo mv containerd.service /lib/systemd/system/ && > sudo systemctl daemon-reload && sudo systemctl enable --now containerd
--2024-05-09 15:36:05--  https://raw.githubusercontent.com/containerd/containerd/main/containerd.service
Resolving raw.githubusercontent.com (raw.githubusercontent.com)... 198.18.0.23
Connecting to raw.githubusercontent.com (raw.githubusercontent.com)|198.18.0.23|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 1251 (1.2K) [text/plain]
Saving to: ‘containerd.service.1’

containerd.service.1                              100%[==========================================================================================================>]   1.22K  --.-KB/s    in 0s      

2024-05-09 15:36:06 (104 MB/s) - ‘containerd.service.1’ saved [1251/1251]

mv: cannot move 'containerd.service' to '/lib/systemd/system/containerd.service': Permission denied
sonui@k8s-worker-2:~$ sudo systemctl daemon-reload
sonui@k8s-worker-2:~$ sudo systemctl enable --now containerd
Failed to enable unit: Unit file containerd.service does not exist.
sonui@k8s-worker-2:~$ ll
total 46836
drwxr-x--- 4 sonui sonui     4096 May  9 15:36 ./
drwxr-xr-x 3 root  root      4096 Apr 17 12:25 ../
-rw------- 1 sonui sonui      259 May  9 12:42 .bash_history
-rw-r--r-- 1 sonui sonui      220 Jan  6  2022 .bash_logout
-rw-r--r-- 1 sonui sonui     3771 Jan  6  2022 .bashrc
drwx------ 2 sonui sonui     4096 Apr 17 12:26 .cache/
-rw-r--r-- 1 sonui sonui      807 Jan  6  2022 .profile
drwx------ 2 sonui sonui     4096 Apr 17 12:25 .ssh/
-rw-r--r-- 1 sonui sonui        0 Apr 17 12:26 .sudo_as_admin_successful
-rw-rw-r-- 1 sonui sonui      180 May  9 15:36 .wget-hsts
-rw-r--r-- 1 sonui sonui 47913222 May  9 15:28 containerd-1.7.16-linux-amd64.tar.gz
-rw-rw-r-- 1 sonui sonui     1251 May  9 15:35 containerd.service
-rw-rw-r-- 1 sonui sonui     1251 May  9 15:36 containerd.service.1
-rw-rw-r-- 1 sonui sonui        0 May  9 15:36 sudo
sonui@k8s-worker-2:~$ rm containerd.service*
sonui@k8s-worker-2:~$ wget https://raw.githubusercontent.com/containerd/containerd/main/containerd.service
--2024-05-09 15:36:37--  https://raw.githubusercontent.com/containerd/containerd/main/containerd.service
Resolving raw.githubusercontent.com (raw.githubusercontent.com)... 198.18.0.23
Connecting to raw.githubusercontent.com (raw.githubusercontent.com)|198.18.0.23|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 1251 (1.2K) [text/plain]
Saving to: ‘containerd.service’

containerd.service                                100%[==========================================================================================================>]   1.22K  --.-KB/s    in 0s      

2024-05-09 15:36:37 (108 MB/s) - ‘containerd.service’ saved [1251/1251]

sonui@k8s-worker-2:~$ sudo mv containerd.service /lib/systemd/system/
sonui@k8s-worker-2:~$ sudo systemctl daemon-reload
sonui@k8s-worker-2:~$ sudo systemctl enable --now containerd
Created symlink /etc/systemd/system/multi-user.target.wants/containerd.service → /lib/systemd/system/containerd.service.
sonui@k8s-worker-2:~$ wget https://github.com/opencontainers/runc/releases/download/v1.1.12/runc.amd64
--2024-05-09 15:37:44--  https://github.com/opencontainers/runc/releases/download/v1.1.12/runc.amd64
Resolving github.com (github.com)... 198.18.0.74
Connecting to github.com (github.com)|198.18.0.74|:443... connected.
HTTP request sent, awaiting response... 302 Found
Location: https://objects.githubusercontent.com/github-production-release-asset-2e65be/36960321/d0ba447a-440a-43bd-a9eb-a8a2b071c200?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAVCODYLSA53PQK4ZA%2F20240509%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20240509T153739Z&X-Amz-Expires=300&X-Amz-Signature=7aec0ec31ec98dbd606dd01d5ac35f78865af07746d8c6f73974cfed6a70059b&X-Amz-SignedHeaders=host&actor_id=0&key_id=0&repo_id=36960321&response-content-disposition=attachment%3B%20filename%3Drunc.amd64&response-content-type=application%2Foctet-stream [following]
--2024-05-09 15:37:44--  https://objects.githubusercontent.com/github-production-release-asset-2e65be/36960321/d0ba447a-440a-43bd-a9eb-a8a2b071c200?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAVCODYLSA53PQK4ZA%2F20240509%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20240509T153739Z&X-Amz-Expires=300&X-Amz-Signature=7aec0ec31ec98dbd606dd01d5ac35f78865af07746d8c6f73974cfed6a70059b&X-Amz-SignedHeaders=host&actor_id=0&key_id=0&repo_id=36960321&response-content-disposition=attachment%3B%20filename%3Drunc.amd64&response-content-type=application%2Foctet-stream
Resolving objects.githubusercontent.com (objects.githubusercontent.com)... 198.18.6.233
Connecting to objects.githubusercontent.com (objects.githubusercontent.com)|198.18.6.233|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 10709696 (10M) [application/octet-stream]
Saving to: ‘runc.amd64’

runc.amd64                                        100%[==========================================================================================================>]  10.21M  9.02MB/s    in 1.1s    

2024-05-09 15:37:46 (9.02 MB/s) - ‘runc.amd64’ saved [10709696/10709696]

sonui@k8s-worker-2:~$ sudo install -m 755 runc.amd64 /usr/local/sbin/runc
sonui@k8s-worker-2:~$ wget https://github.com/containernetworking/plugins/releases/download/v1.4.1/cni-plugins-linux-amd64-v1.4.1.tgz
--2024-05-09 15:38:40--  https://github.com/containernetworking/plugins/releases/download/v1.4.1/cni-plugins-linux-amd64-v1.4.1.tgz
Resolving github.com (github.com)... 198.18.0.74
Connecting to github.com (github.com)|198.18.0.74|:443... connected.
HTTP request sent, awaiting response... 302 Found
Location: https://objects.githubusercontent.com/github-production-release-asset-2e65be/84575398/856f0a89-6331-497a-86af-60b02836794d?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAVCODYLSA53PQK4ZA%2F20240509%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20240509T153841Z&X-Amz-Expires=300&X-Amz-Signature=f1d20ade075f1f5bcdc0a3c215e5bb6cfec76df5bf7887c6a738b6800a62fa32&X-Amz-SignedHeaders=host&actor_id=0&key_id=0&repo_id=84575398&response-content-disposition=attachment%3B%20filename%3Dcni-plugins-linux-amd64-v1.4.1.tgz&response-content-type=application%2Foctet-stream [following]
--2024-05-09 15:38:41--  https://objects.githubusercontent.com/github-production-release-asset-2e65be/84575398/856f0a89-6331-497a-86af-60b02836794d?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAVCODYLSA53PQK4ZA%2F20240509%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20240509T153841Z&X-Amz-Expires=300&X-Amz-Signature=f1d20ade075f1f5bcdc0a3c215e5bb6cfec76df5bf7887c6a738b6800a62fa32&X-Amz-SignedHeaders=host&actor_id=0&key_id=0&repo_id=84575398&response-content-disposition=attachment%3B%20filename%3Dcni-plugins-linux-amd64-v1.4.1.tgz&response-content-type=application%2Foctet-stream
Resolving objects.githubusercontent.com (objects.githubusercontent.com)... 198.18.6.233
Connecting to objects.githubusercontent.com (objects.githubusercontent.com)|198.18.6.233|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 46991561 (45M) [application/octet-stream]
Saving to: ‘cni-plugins-linux-amd64-v1.4.1.tgz’

cni-plugins-linux-amd64-v1.4.1.tgz                100%[==========================================================================================================>]  44.81M  18.7MB/s    in 2.4s    

2024-05-09 15:38:44 (18.7 MB/s) - ‘cni-plugins-linux-amd64-v1.4.1.tgz’ saved [46991561/46991561]

sonui@k8s-worker-2:~$ sudo mkdir -p /opt/cni/bin && sudo  tar Cxzvf /opt/cni/bin cni-plugins-linux-amd64-v1.4.1.tgz
./
./LICENSE
./host-device
./dummy
./README.md
./firewall
./macvlan
./bridge
./dhcp
./bandwidth
./tuning
./vlan
./ipvlan
./ptp
./static
./loopback
./tap
./host-local
./sbr
./portmap
./vrf
sonui@k8s-worker-2:~$ ctr version
Client:
  Version:  v1.7.16
  Revision: 83031836b2cf55637d7abf847b17134c51b38e53
  Go version: go1.21.9

ctr: failed to dial "/run/containerd/containerd.sock": connection error: desc = "transport: error while dialing: dial unix /run/containerd/containerd.sock: connect: permission denied"
sonui@k8s-worker-2:~$ sudo ctr version
[sudo] password for sonui: 
Client:
  Version:  v1.7.16
  Revision: 83031836b2cf55637d7abf847b17134c51b38e53
  Go version: go1.21.9

Server:
  Version:  v1.7.16
  Revision: 83031836b2cf55637d7abf847b17134c51b38e53
  UUID: 95166d03-6fc0-4748-8165-4a1ffb9a5e0a

sonui@k8s-worker-2:~$ sudo curl -o /etc/systemd/system/containerd.service https://raw.githubusercontent.com/containerd/containerd/main/containerd.service
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  1251  100  1251    0     0   2596      0 --:--:-- --:--:-- --:--:--  2600
sonui@k8s-worker-2:~$ sudo systemctl daemon-reload
sonui@k8s-worker-2:~$ sudo systemctl enable --now containerd
Removed /etc/systemd/system/multi-user.target.wants/containerd.service.
Created symlink /etc/systemd/system/multi-user.target.wants/containerd.service → /etc/systemd/system/containerd.service.
sonui@k8s-worker-2:~$ wget https://github.com/opencontainers/runc/releases/download/v1.1.13/libseccomp-2.5.5.tar.gz
--2024-07-12 16:17:49--  https://github.com/opencontainers/runc/releases/download/v1.1.13/libseccomp-2.5.5.tar.gz
Resolving github.com (github.com)... 198.18.0.19
Connecting to github.com (github.com)|198.18.0.19|:443... connected.
HTTP request sent, awaiting response... 302 Found
Location: https://objects.githubusercontent.com/github-production-release-asset-2e65be/36960321/4218e064-d5e7-4b91-9312-30b5325ec9b6?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=releaseassetproduction%2F20240712%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20240712T161751Z&X-Amz-Expires=300&X-Amz-Signature=ef50a778c5f266afac04e05cc9a3ca00efffbcfac7225cb1896388e6be6eda81&X-Amz-SignedHeaders=host&actor_id=0&key_id=0&repo_id=36960321&response-content-disposition=attachment%3B%20filename%3Dlibseccomp-2.5.5.tar.gz&response-content-type=application%2Foctet-stream [following]
--2024-07-12 16:17:50--  https://objects.githubusercontent.com/github-production-release-asset-2e65be/36960321/4218e064-d5e7-4b91-9312-30b5325ec9b6?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=releaseassetproduction%2F20240712%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20240712T161751Z&X-Amz-Expires=300&X-Amz-Signature=ef50a778c5f266afac04e05cc9a3ca00efffbcfac7225cb1896388e6be6eda81&X-Amz-SignedHeaders=host&actor_id=0&key_id=0&repo_id=36960321&response-content-disposition=attachment%3B%20filename%3Dlibseccomp-2.5.5.tar.gz&response-content-type=application%2Foctet-stream
Resolving objects.githubusercontent.com (objects.githubusercontent.com)... 198.18.1.22
Connecting to objects.githubusercontent.com (objects.githubusercontent.com)|198.18.1.22|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 642445 (627K) [application/octet-stream]
Saving to: ‘libseccomp-2.5.5.tar.gz’

libseccomp-2.5.5.tar.gz                                         100%[======================================================================================================================================================>] 627.39K  1.08MB/s    in 0.6s    

2024-07-12 16:17:51 (1.08 MB/s) - ‘libseccomp-2.5.5.tar.gz’ saved [642445/642445]
sonui@k8s-worker-2:~$ tar -zxf libseccomp-2.5.5.tar.gz 
sonui@k8s-worker-2:~$ sudo install -m 755 runc.amd64 /usr/local/sbin/runc
sonui@k8s-worker-2:~$ containerd config default > /etc/containerd/config.toml
-bash: /etc/containerd/config.toml: No such file or directory
sonui@k8s-worker-2:~$ mkdir /etc/containerd/
mkdir: cannot create directory ‘/etc/containerd/’: Permission denied
sonui@k8s-worker-2:~$ sudo mkdir /etc/containerd/
sonui@k8s-worker-2:~$ sudo sh -c 'containerd config default > /etc/containerd/config.toml'
sonui@k8s-worker-2:~$ sudo nano /etc/containerd/config.toml # 搜索SystemdCgroup 改为true
sonui@k8s-worker-2:~$ sudo systemctl restart containerd



root@k8s-master:/home/sonui# containerd config default > /etc/containerd/config.toml
root@k8s-master:/home/sonui# nano /etc/con
console-setup/ containerd/    
root@k8s-master:/home/sonui# nano /etc/containerd/config.toml 
root@k8s-master:/home/sonui# sudo systemctl restart containerd
```

执行下面的命令，确保 `br_netfilter` 模块已加载：

```bash
modprobe br_netfilter
echo 1 > /proc/sys/net/bridge/bridge-nf-call-iptables
echo 1 > /proc/sys/net/ipv4/ip_forward
```

执行 `kubeadm init` 初始化 master 节点：

```bash
kubeadm init --pod-network-cidr=192.168.2.0/24 --apiserver-advertise-address=192.168.2.216
```

安装发生错误，查看 `kubelet` 日志，发现一条错误

```bash
Jul 12 15:29:34 k8s-master kubelet[8988]: E0712 15:29:34.379885    8988 run.go:74] "command failed" err="failed to run Kubelet: running with swap on is not supported, please disable swap! or set --fail-swap-on flag to false. /proc/swaps contained: [Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority /swap.img                               file\t\t4194300\t\t0\t\t-2]"
```

解决方法是永久关闭 swap 分区：

```bash
sudo swapoff -a
sudo sed -i '/ swap / s/^\(.*\)$/#\1/g' /etc/fstab
```
