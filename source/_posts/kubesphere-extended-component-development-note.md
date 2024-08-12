---
title: KubeSphere 扩展组件开发笔记
tags: KubeSphere, k8s, Go, ArgoCD
date: 2024-04-12 00:21:00
---

前段时间参加了云原生 Meetup 杭州站活动，正好在这次活动上了解到了 KubeSphere 正在开展扩展组件开发训练营于是报名了这个活动，记录下学习过程。

<!-- more -->

## 说明

资料来源:

- [KubeSphere 扩展组件开发指南](https://dev-guide.kubesphere.io/extension-dev-guide/zh/)

## 开发环境搭建

开发需要一个 ks 集群，可以使用 KubeSphere 官方提供的ks-dev环境，也可以自己搭建一个 ks 集群。

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

安装 `ksbuilder

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

修改为 argocd

```yaml
apiVersion: extensions.kubesphere.io/v1alpha1
kind: ReverseProxy
metadata:
  name: argocd-scope
spec:
  directives:
    headerUp:
    - -Authorization
    stripPathPrefix: /proxy/argocd
  matcher:
    method: '*'
    path: /proxy/argocd/*
  upstream:
    url: http://argocd-server.argocd.svc
status:
  state: Available

```

其中 `upstream.url` 为 argocd 的服务地址

`http://[service name].[namespace].svc`

部署 `ArgoCD` 时需要修改下 `argocd-server` Deployment 的参数

```yaml
      - args:
        - /usr/local/bin/argocd-server
        - --insecure # 关闭 http -> https 重定向
        - --basehref # 添加 basehref 参数 使用 /proxy/argocd 作为基础路径
        - /proxy/argocd
```

`basehref` 配置说明
![about basehref config](./kubesphere-extended-component-development-note/image.png)

> If the Argo CD UI is available under a non-root path (e.g. /argo-cd instead of /) then the UI path should be configured in the API server. To configure the UI path add the --basehref flag into the argocd-server deployment command
> <https://argo-cd.readthedocs.io/en/stable/operator-manual/ingress/#ui-base-path>

插件设置下 `webpack.config.js`

```js
const { merge } = require('webpack-merge');
const baseConfig = require('@ks-console/bootstrap/webpack/webpack.dev.conf');

const webpackDevConfig = merge(baseConfig, {
  devServer: {
    proxy: {
      '/proxy': {
        target: 'http://192.168.2.150:30881', // 修改为目标 ks-apiserver 的地址
        onProxyReq: (proxyReq, req, res) => {
            const username = 'admin'        // 请求代理时的用户凭证
            const password = 'P@88w0rd'
            const auth = Buffer.from(`${username}:${password}`).toString("base64");
            proxyReq.setHeader('Authorization', `Basic ${auth}`);
          },
      },
    },
  },
});

module.exports = webpackDevConfig;
```

全部完成后访问控制面板可以看到弹出 `ArgoCD` 登录界面

![ArgoCD login page in KubeSphere dashboard](./kubesphere-extended-component-development-note/image2.png)

按照文档说明尝试登录出现进入面板后又回到登录界面的问题，F12 查看有接口返回 401 错误，猜测可能是传递给 `ArgoCD` 服务的这两个请求没有认证信息

![f12 dashboard](./kubesphere-extended-component-development-note/image3.png)

查看 Pod 日志

```bash
kubectl logs argocd-server-7c8b5b9649-wgbh4 -n argocd -f
```

```log
time="2024-05-06T06:12:04Z" level=info msg="finished unary call with code OK" grpc.code=OK grpc.method=Create grpc.service=session.SessionService grpc.start_time="2024-05-06T06:12:03Z" grpc.time_ms=881.294 span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="received unary call /cluster.SettingsService/Get" grpc.method=Get grpc.request.content= grpc.service=cluster.SettingsService grpc.start_time="2024-05-06T06:12:04Z" span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="finished unary call with code OK" grpc.code=OK grpc.method=Get grpc.service=cluster.SettingsService grpc.start_time="2024-05-06T06:12:04Z" grpc.time_ms=0.335 span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="received unary call /version.VersionService/Version" grpc.method=Version grpc.request.content= grpc.service=version.VersionService grpc.start_time="2024-05-06T06:12:04Z" span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="finished unary call with code OK" grpc.code=OK grpc.method=Version grpc.service=version.VersionService grpc.start_time="2024-05-06T06:12:04Z" grpc.time_ms=0.358 span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="finished unary call with code Unauthenticated" error="rpc error: code = Unauthenticated desc = invalid session: SSO is not configured" grpc.code=Unauthenticated grpc.method=List grpc.service=application.ApplicationService grpc.start_time="2024-05-06T06:12:04Z" grpc.time_ms=0.116 span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="finished unary call with code Unauthenticated" error="rpc error: code = Unauthenticated desc = invalid session: SSO is not configured" grpc.code=Unauthenticated grpc.method=List grpc.service=cluster.ClusterService grpc.start_time="2024-05-06T06:12:04Z" grpc.time_ms=0.125 span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="received unary call /session.SessionService/GetUserInfo" grpc.method=GetUserInfo grpc.request.content= grpc.service=session.SessionService grpc.start_time="2024-05-06T06:12:04Z" span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="finished unary call with code OK" grpc.code=OK grpc.method=GetUserInfo grpc.service=session.SessionService grpc.start_time="2024-05-06T06:12:04Z" grpc.time_ms=0.205 span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="received unary call /session.SessionService/GetUserInfo" grpc.method=GetUserInfo grpc.request.content= grpc.service=session.SessionService grpc.start_time="2024-05-06T06:12:04Z" span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="finished unary call with code OK" grpc.code=OK grpc.method=GetUserInfo grpc.service=session.SessionService grpc.start_time="2024-05-06T06:12:04Z" grpc.time_ms=0.244 span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="received unary call /cluster.SettingsService/Get" grpc.method=Get grpc.request.content= grpc.service=cluster.SettingsService grpc.start_time="2024-05-06T06:12:04Z" span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="finished unary call with code OK" grpc.code=OK grpc.method=Get grpc.service=cluster.SettingsService grpc.start_time="2024-05-06T06:12:04Z" grpc.time_ms=0.23 span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="received unary call /cluster.SettingsService/Get" grpc.method=Get grpc.request.content= grpc.service=cluster.SettingsService grpc.start_time="2024-05-06T06:12:04Z" span.kind=server system=grpc
time="2024-05-06T06:12:04Z" level=info msg="finished unary call with code OK" grpc.code=OK grpc.method=Get grpc.service=cluster.SettingsService grpc.start_time="2024-05-06T06:12:04Z" grpc.time_ms=0.333 span.kind=server system=grpc
time="2024-05-06T06:12:05Z" level=info msg="received unary call /cluster.SettingsService/Get" grpc.method=Get grpc.request.content= grpc.service=cluster.SettingsService grpc.start_time="2024-05-06T06:12:05Z" span.kind=server system=grpc
time="2024-05-06T06:12:05Z" level=info msg="finished unary call with code OK" grpc.code=OK grpc.method=Get grpc.service=cluster.SettingsService grpc.start_time="2024-05-06T06:12:05Z" grpc.time_ms=0.329 span.kind=server system=grpc
```

日志显示 `invalid session: SSO is not configured` 说明 `ArgoCD` 服务没有配置 `SSO` 认证，这里需要修改 `ArgoCD` 配置文件

clone ArgoCD 代码搜索下 `no session information` 错误，
