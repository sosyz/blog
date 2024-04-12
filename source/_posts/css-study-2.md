---
title: 深入CSS
date: 2022-07-26 23:09
tags: css
---

字节青训营学习笔记 - CSS 2

<!-- more -->

## 特异度

随着特异度程度越高，优先级越高

### 特异度计算

`#nav .list li ac:link`: 1个ID, 两个(伪)类, 2个标签

`.hd ul .links a`: 0个ID, 2个(伪)类, 2个标签

## 选择器语法

通过选择器复用

```html
<button class="btn">普通按钮</button>
<button class="btn primary">主要按钮</button>
<style>
  .btn {
    display: inline-block;
    padding: .36em .8em;
    margin-right: .5em;
    line-height: 1.5;
    text-align: center;
    cursor: pointer;
    border-radius: .3em;
    border: none;
    background: #e6e6e6;
    color: #333;
  }
  .btn.primary {
    color: #fff;
    background: #218de6;
  }
</style>
```

## 继承

某些属性会自动继承父元素的属性, 除非显性指定一个值

```css

* {
    box-sizing: inherit;
}

html {
    box-sizing: border-box;
}

.some-widget {
    box-sizing: border-box;
}
```

## 值

CSS中, 每个属性都用一个初始值

* `background-color` 的初始值为 `transparent`
* `color` 的初始值为 `inherit`
* `margin` 的初始值为 `0`

可以使用 `initial` 关键字显示的重置为初始值

* `background-color: initial`

### 求值过程

> [求值过程](https://cdpn.io/webzhao/debug/xxXyzRd)
> 存档: [求值过程](https://web.archive.org/web/20220725134302/https://cdpn.io/webzhao/debug/xxXyzRd)

## 布局

作用

* 确定内容的大小和位置
* 依据元素、容器、兄弟节点和内容等信息来计算位置

### 布局类型

常规布局

* 行级
* 块级
* 表格布局
* FlexBox
* Grid布局

### 盒型布局

* margin: 外边距
* border: 边框
* padding: 内边距
* width: 宽度
* height: 高度

![image.png](https://p1-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/bd549d712fec475eacae23e934dc0ccb~tplv-k3u1fbpfcp-watermark.image?)

### 属性

![image.png](https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/f260d9480e81488fbccc9bce94c345b2~tplv-k3u1fbpfcp-watermark.image?)

| 属性      | 取值                                                                                                                             | 说明   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `width`   | 长度、百分数、auto(默认值为 `auto`)                                                                                              | 宽度   |
| `height`  | 长度、百分数、auto(默认值为 `auto`)                                                                                              | 高度   |
| `margin`  | 长度、百分数、auto(默认值为 `0`)                                                                                                 | 外边距 |
| `padding` | 长度、百分数、auto(默认值为 `0`)                                                                                                 | 内边距 |
| `border`  | 三种属性: `border-width`, `border-style`, `border-color`, 四个方向: `border-top`, `border-right`, `border-bottom`, `border-left` | 边框   |

**特殊**
`margin` 可设置为 `auto` 使元素居中
`box-sizing` 设置是否需要加上内边距(padding)和边框等
`overflow` 当元素溢出时如何处理, 其取值可为

* visible: 可见
* hidden: 隐藏
* scroll: 滚动

## 块级 vs 行级

| 块级                      | 行级                              |
| ------------------------- | --------------------------------- |
| 不和其它盒子并列摆放      | 和其它盒子一起放一行或拆开成多行  |
| 可以放置多个盒子          | 盒模型中的width、height不适用     |
| 生成块级盒子              | 生成行级盒子 内容分散在多个行盒中 |
| body, article, div, h1-h6 | span, em, code                    |
| display: block            | display: inline                   |

**display 属性**

| 值             | 说明             |
| -------------- | ---------------- |
| `block`        | 块级元素         |
| `inline`       | 内联元素         |
| `inline-block` | 内联元素块级元素 |
| `none`         | 排版时忽略       |

## 常规流

### 行级

`Inline Formatting Context`(`IFC`)
当只包含行级盒子的容器会创建一个`IFC`

`IFC` 内的排版规则

* 盒子在一行内水平排列
* 一行放不下时, 换行显示
* `text-align` 决定一行内盒子的水平对齐
* `vertical-align` 决定一个盒子在行内的垂直对齐
* ***避开浮动(floar)元素***

### 块级

`Block Formatting Context`(`BFC`)
某些容器会创建一个`BFC`
例如:

* 根元素
* 浮动, 绝对定位, inline-block
* Flex子项Grid子项
* overflow 值不是visible的块盒
* `display: flow-root`

`BFC` 内的排版规则

* 盒子从上到下摆放
* 垂直 margin 合并
* `BFC` 内盒子的margin不会与外面的合并
* `BFC` 不会盒浮动元素重叠

## Flex布局

Flex布局阮一峰老师总结的就很好理解, 一篇足以

[Flex 布局教程](https://www.w3schools.com/cssref/css3_pr_flex.asp)

## Grid布局

`display: grid`会创建一个块级的Grid容器, 可以以此来实现磁贴
也同样推荐阮一峰老师的总结

[CSS Grid 网格布局教程](http://www.ruanyifeng.com/blog/2019/03/grid-layout-tutorial.html)

## Float浮动

可以实现图片环绕的效果

```html
<section>
    <img
      src="https:/ / p4.ssl.qhimg.com/t017aec0e7edc961740.jpg" width="300""alt="mojave"/>
    <p>莫哈韦沙漠不仅纬度较高，而且温度要稍微低些，是命名该公园的短叶丝兰—约书亚树的特殊栖息地。约书亚树以从茂密的森林到远远间隔的实例等各种形式出现。除了约书亚树森林之外，该公园的西部包括加州沙漠里发现的最有趣的地质外观。
    </p>
</section>

<style>
img {
    float: left;
}
</style>
```

效果图

![image.png](https://p9-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/43f05e255f0a4c538194d0c8fa938038~tplv-k3u1fbpfcp-watermark.image?)

其它的无需了解

position 属性值

* static: 默认值, 没有浮动
* relative: 相对定位, 可以使用left, top, right, bottom来定位, 不影响其它元素的排版
* absolute: 绝对定位, 脱离常规流, 可以使用left, top, right, bottom来定位, 其它元素当没有它
* fixed: 固定定位, 可以使用left, top, right, bottom来定位, 可用来做导航条、回到顶部等
* sticky: 粘性定位, 元素根据正常文档流进行定位，然后相对它的最近滚动祖先和最近块级祖先，包括 table-related 元素，基于top, right, bottom, 和 left的值进行偏移。偏移值不会影响任何其他元素的位置。

[详细说明](https://developer.mozilla.org/zh-CN/docs/Web/CSS/position)
