---
title: go 中的context
date: 2023-01-30 00:24
tags: golang, context
---

context 是 go 语言中的一个包， 用于在多个 goroutine 之间传递数据， 以及控制 goroutine 的执行， 在这篇文章中记录了 context 的使用方法。

<!-- more -->

## 0x00 背景

设想这样一个场景

> 你是一个店主，经营着一家餐饮店
> 你有时会遇到这种情况：
> 有一个顾客点了一份炒饭， 收银将单子打印出来交给了服务员， 服务员传递给后厨， 后厨收到单子后开始做菜
> 顾客在等待的过程中， 突然想起了一些事情， 他想要取消这份炒饭的订单
> 但是服务员已经把单子传递给了后厨， 后厨已经开始做菜了， 我们该如何去通知后厨取消这份炒饭的订单呢？

而在我们的项目之中， 经常可以遇到这类的问题

例如在后端开发中，用户的请求忽然断开，我们如果接着去处理用户请求显然是在浪费时间， 我们应该尽快的通知底层的服务， 取消这个请求的处理

## 0x01 context

context 是 go 语言中的一个包， 用于在多个 goroutine 之间传递数据， 以及控制 goroutine 的执行

在上面这个场景中，我们就可以使用 context 来解决这个问题

我们可以在用户发起请求的时候， 创建一个 context 对象， 并将这个 context 对象传递给后端的服务， 服务在处理用户请求的时候， 可以通过 context 对象来实现通知取消处理

## 0x02 context 的使用

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func doSomething(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            if err := ctx.Err(); err != nil {
                fmt.Printf("err: %s\n", err)
            }
            fmt.Println("Done at", time.Now().Format("15:04:05"))
            return
        case <-time.After(4 * time.Second):
            fmt.Println("Doing something at", time.Now().Format("15:04:05"))
        }
    }
}

func main() {
    ctx, cancelCtx := context.WithCancel(context.Background())
    go doSomething(ctx)
    time.Sleep(10 * time.Second)
    cancelCtx()
    // 让主线程等待一段时间，以便 doSomething() 打印 Done
    time.Sleep(2 * time.Second)
}
```

```bash
Doing something at 16:05:40
Doing something at 16:05:44
err: context canceled
Done at 16:05:46
```

注意输出的时间间隔

有时我们也会遇到需要超时的场景，这时候我们可以使用 context.WithTimeout() 来创建一个 context 对象

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func doSomething(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            if err := ctx.Err(); err != nil {
                fmt.Printf("err: %s\n", err)
            }
            fmt.Println("Done at", time.Now().Format("15:04:05"))
            return
        case <-time.After(4 * time.Second):
            fmt.Println("Doing something at", time.Now().Format("15:04:05"))
        }
    }
}

func main() {
    ctx, cancelCtx := context.WithTimeout(context.Background(), 10*time.Second)
    go doSomething(ctx)
    time.Sleep(60 * time.Second)
    cancelCtx()
}

```

```bash
Doing something at 16:12:54
Doing something at 16:12:58
err: context deadline exceeded
Done at 16:13:00
```

## 0x03 总结

在很多需要 context 的场景中，如果我们不知道该如何使用 context，我们可以使用 context.Background() 来创建一个 context 对象， 然后将这个 context 对象传递给需要使用 context 的函数

如果需要函数需要 context 而我们又有接收 context，那么直接透传即可不要再创建一个 context 对象

对于在 context 中添加数据，我们可以使用 context.WithValue() 来创建一个 context 对象， 然后将这个 context 对象传递给需要使用 context 的函数，这样就达到了传递数据的目的，需要注意的是数据是只读的，同名下最外层的数据才有效

## 0x04 参考资料

[How To Use Contexts in Go](https://www.digitalocean.com/community/tutorials/how-to-use-contexts-in-go)
