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

开发需要一个ks集群，可以使用kubesphere官方提供的ks-dev环境，也可以自己搭建一个ks集群。

### 使用ks-dev环境

<https://kubesphere.cloud/sign-up/?ref=REAwGESiNA> 可以在这里注册一个账号，然后在控制台创建一个ks集群。

官方每个月会赠送10h的免费使用时间，可以用来开发测试。

### 本地安装

