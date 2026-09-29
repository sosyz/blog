---
title: "Redis Reading Notes"
description: "Redis 源码阅读笔记，从 SDS 动态字符串的结构与内存布局讲起。"
type: 踩坑
topic: 后端
tags: [Redis, 源码阅读, C/C++]
pubDate: "2023-07-08"
updatedDate: "2026-09-29"
---

Redis 是一个开源的内存数据库，它支持多种数据结构，如字符串、列表、集合、有序集合、哈希表等，同时支持持久化、主从复制、集群等功能。在这篇文章中记录了阅读 Redis 源码的一些笔记。

本文源码版本截至 commit：

> 14f802b: Initialize cluster owner_not_claiming_slot to avoid warning (#12391)

## 数据结构

### SDS 动态字符串实现

redis 通过 sds 来存储字符串，相较于 C 语言的字符串，sds 有以下优点：

- 常数复杂度获取字符串长度（对于 C 语言字符串，需要遍历整个字符串才能获取长度）
- 减少修改字符串时所需的内存重分配次数
- 二进制安全（可以存储任意数据，包括空字符，如 `\0`）

```c
/* Note: sdshdr5 is never used, we just access the flags byte directly.
 * However is here to document the layout of type 5 SDS strings. */
struct __attribute__ ((__packed__)) hisdshdr5 {
    unsigned char flags; /* 3 lsb of type, and 5 msb of string length */
    char buf[];
};
struct __attribute__ ((__packed__)) hisdshdr8 {
    uint8_t len; /* used */
    uint8_t alloc; /* excluding the header and null terminator */
    unsigned char flags; /* 3 lsb of type, 5 unused bits */
    char buf[];
};
```

注：上面的代码摘自 Redis 仓库里自带的 hiredis（`deps/hiredis/sds.h`），所以结构体名带 `hi` 前缀；Redis 自己的实现在 `src/sds.h`，结构相同，名字是 `sdshdr5`、`sdshdr8` 等。

sds 有两种，一种是类型长度以高低位存储在一个变量中，如 `hisdshdr5`，另一种是分别存储在不同变量中，如 `hisdshdr8`、`hisdshdr16`、`hisdshdr32`、`hisdshdr64`。

在 `hisdshdr5` 中，`flags` 的低三位存储类型，高五位存储长度，长度只有 5 位，所以最大为 2^5-1，即 31 字节。

在代码注释中有以下说明：

> Note: sdshdr5 is never used, we just access the flags byte directly.
> However is here to document the layout of type 5 SDS strings.

意思是说，`hisdshdr5` 并没有被使用，我们直接访问 `flags` 字节，但是这里是为了记录类型 5 的 sds 字符串的布局。

在 `hisdshdr8` 中，`len` 存储长度，`alloc` 存储分配长度，`flags` 存储类型，所以长度最大为 8 位，即 2^8-1，即 255 字节。

结构体中使用了 `__attribute__ ((__packed__))`，这是 gcc 的扩展，用于告诉编译器不要对结构体进行字节对齐，这样可以节省内存，但是会降低访问效率，同时使用了柔性数组成员（C99 标准引入），柔性数组成员是一种特殊的数组类型，它可以在结构体中定义一个没有指定大小的数组，这样就可以根据需要动态地分配内存，而不用使用指针。柔性数组成员必须是结构体的最后一个成员，并且结构体中至少要有一个其他的命名成员。柔性数组成员是 C99 标准引入的，但是一些编译器也支持 C89 和 C++ 中使用它，只是语法有些不同。柔性数组成员的优点是可以提高内存分配的效率，提高数据的局部性，以及生成更好的代码。

## 参考资料

| 说明 | 链接 |
| ---- | ---- |
| Redis 官网 | [https://redis.io/](https://redis.io/) |
| 如何阅读 Redis 源码？（原站已失效，archive.org 存档） | <https://web.archive.org/web/20210111142707/https://blog.huangz.me/diary/2014/how-to-read-redis-source-code.html> |
