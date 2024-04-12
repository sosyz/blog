---
title: Fitness function-driven development（测试驱动开发） 翻译
date: 2023-03-30T16:35:13+08:00
tags: TDD, 测试驱动开发
---

对 `TDD` 的一个翻译，原文地址：[Fitness function-driven development](https://www.thoughtworks.com/insights/articles/fitness-function-driven-development)

<!-- more -->

> 原文：[Fitness function-driven development](https://www.thoughtworks.com/insights/articles/fitness-function-driven-development)

测试驱动开发是以先编写测试样例然后编写最少可以通过测试样例的代码为基准进行开发的开发方式 TDD是一种成熟的功能开发实践，可以提高代码质量和测试覆盖率

Test-driven development, or TDD, involves writing tests first then developing the minimal code needed to pass the tests. TDD is an established practice for feature development that can improve code quality and test coverage. What about other, non-functional requirements such as scalability, reliability, observability, and other architectural “-ilities”? How do we ensure operability and resiliency of features when they go to production? How can we encourage teams to build in these architectural standards, just as test-driven development builds in code quality and test coverage?
