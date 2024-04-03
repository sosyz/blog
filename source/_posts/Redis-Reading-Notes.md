---
title: Redis Reading Notes
date: 2023-07-08 20:40:16
tags: redis
description: Redis 源码阅读笔记
---

本文源码版本截至commit：
> 14f802b: Initialize cluster owner_not_claiming_slot to avoid warning (#12391)

## 数据结构

### SDS 动态字符串实现

redis通过sds来存储字符串，相较于c语言的字符串，sds有以下优点：

- 常数复杂度获取字符串长度（对于c语言字符串，需要遍历整个字符串才能获取长度）
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

sds有两种，一种是类型长度以高低位存储在一个变量中如 `hisdshdr5`，另一种是分别存储在不同变量中，如 `hisdshdr8`，`hisdshdr16`，`hisdshdr32`，`hisdshdr64`

在`hisdshdr5`中，`flags`的低三位存储类型，高五位存储长度，所以长度最大为32位，即2^5-1，即31字节

在代码注释中有以下说明

> Note: sdshdr5 is never used, we just access the flags byte directly.
> However is here to document the layout of type 5 SDS strings.

意思是说，`hisdshdr5`并没有被使用，我们直接访问`flags`字节，但是这里是为了记录类型5的sds字符串的布局。

在`hisdshdr8`中，`len`存储长度，`alloc`存储分配长度，`flags`存储类型，所以长度最大为8位，即2^8-1，即255字节

结构体中使用了`__attribute__ ((__packed__))`，这是gcc的扩展，用于告诉编译器不要对结构体进行字节对齐，这样可以节省内存，但是会降低访问效率，同时使用了柔性数组成员（C99标准引入），柔性数组成员是一种特殊的数组类型，它可以在结构体中定义一个没有指定大小的数组，这样就可以根据需要动态地分配内存，而不用使用指针。柔性数组成员必须是结构体的最后一个成员，并且结构体中至少要有一个其他的命名成员。柔性数组成员是C99标准引入的，但是一些编译器也支持C89和C++中使用它，只是语法有些不同。柔性数组成员的优点是可以提高内存分配的效率，提高数据的局部性，以及生成更好的代码。

## 参考资料

| 说明 | 链接 |
| ---- | ---- |
| Redis 官网 | [https://redis.io/](https://redis.io/) |
| 如何阅读 Redis 源码？ | <https://blog.huangz.me/diary/2014/how-to-read-redis-source-code.html> |
