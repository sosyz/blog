---
title: KubeSphere 扩展组件开发笔记
tags: KubeSphere, k8s, Go, ArgoCD
---

前段时间参加了云原生 Meetup 杭州站活动，正好在这次活动上了解到了 KubeSphere 正在开展扩展组件开发训练营于是报名了这个活动，记录下学习过程。

<!-- more -->

## 说明

资料来源:

- [KUBESPHERE 扩展组件开发指南](https://dev-guide.kubesphere.io/extension-dev-guide/zh/)

## 开发环境搭建

开发需要一个 ks 集群，可以使用 kubesphere 官方提供的ks-dev环境，也可以自己搭建一个 ks 集群。

### 使用ks-dev环境

<https://kubesphere.cloud/sign-up/?ref=REAwGESiNA> 可以在这里注册一个账号，然后在控制台创建一个 ks 集群。

官方每个月会赠送 10h 的免费使用时间，可以用来开发测试。

### 本地安装

`Node` 使用 `nvm` 安装

```bash
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 18
```

安装 `yarn`

```bash
npm install --global yarn
```

安装 `helm`

这里官方提供了文件和脚本两种安装方式，因为是专门为了开发扩展组件开的环境所以为了省事直接脚本安装

<https://helm.sh/docs/intro/install/>

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

安装 `kubectl`

```bash
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo chmod +x kubectl 
sudo mv kubectl /usr/local/bin
```

安装完成以后去 `ks` 面板下载 `kubeconfig` 文件放到 `~/.kube/config` 目录下

```bash

安装 `ksbuilder`

```bash
wget https://github.com/kubesphere/ksbuilder/releases/download/v0.3.13/ksbuilder_0.3.13_linux_amd64.tar.gz
tar -zxf ksbuilder_0.3.13_linux_amd64.tar.gz
sudo mv ksbuilder /usr/local/bin
```

检查安装版本

```bash
sonui@server:~$ ksbuilder --version
ksbuilder version 0.3.13
sonui@server:~$ node --version
v18.20.2
sonui@server:~$ yarn --version
1.22.22
sonui@server:~$ helm version
version.BuildInfo{Version:"v3.14.4", GitCommit:"81c902a123462fd4052bc5e9aa9c513c4c8fc142", GitTreeState:"clean", GoVersion:"go1.21.9"}
sonui@server:~$ kubectl version
Client Version: v1.30.0
Kustomize Version: v5.0.4-0.20230601165947-6ce0bf390ce3
sonui@server:~$ kubectl get node
NAME   STATUS   ROLES                         AGE   VERSION
ks     Ready    control-plane,master,worker   15d   v1.23.10
sonui@server:~$ kubectl -n kubesphere-system get po
NAME                                     READY   STATUS    RESTARTS        AGE
ks-apiserver-754d47ffcc-fx5fz            1/1     Running   2 (6d21h ago)   15d
ks-console-54958f4674-8s225              1/1     Running   2 (6d21h ago)   15d
ks-controller-manager-59d55bc77b-vgnl7   1/1     Running   2 (6d21h ago)   15d
```

### 编写反向代理

参考官方示例

<https://raw.githubusercontent.com/kubesphere/extension-samples/master/extensions-backend/weave-scope/weave-scope-reverse-proxy.yaml>

修改为 argocd-server

```yaml
apiVersion: extensions.kubesphere.io/v1alpha1
kind: ReverseProxy
metadata:
  name: argocd-server
spec:
  directives:
    headerUp:
    - -Authorization
    stripPathPrefix: /proxy/argocd-server
  matcher:
    method: '*'
    path: /proxy/argocd-server/*
  upstream:
    url: http://argocd-server.argocd.svc
status:
  state: Available
```
