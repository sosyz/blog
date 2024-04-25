---
title: HTTP 幂等机制支持
date: 2024-04-25T10:27:32+08:00
tags: HTTP, Backend, Idempotence
---

## 为什么要支持幂等机制

HTTP 协议中的幂等性是指对同一个资源的多次请求，结果是一致的。这种特性在实际开发中非常重要，可以保证在网络不稳定的情况下，请求重试不会导致资源状态的改变。

对于 HTTP请求来说常见的幂等方法：`GET`、`HEAD`、`PUT`、`DELETE`、`OPTIONS`、`TRACE`，非幂等方法：`POST`、`PATCH`、`CONNECT`

为什么要对非幂等方法进行特殊处理从而支持幂等机制呢？比如说以下场景

> 李四维在使用购物平台时准备提交一个订单，但是他在一个网很差的地方，而更糟糕的是因为网络不稳定他在提交时候可能会发生请求超时导致不知道是否成功提交了订单。

怎么办？提交订单前先发一个预创建订单来检查吗？除非没得选再考虑这个，因为这样会增加额外的请求和处理代码，也不是很好的解决方案

直接再请求一次呢？如果这个时候接口是非幂等的那么就会重复提交订单造成资源浪费，因此提供幂等机制在这个时候就显得非常有用。

## 幂等机制的设计

这里选择一个简单的实现方式，通过在请求头中添加一个唯一标识符来实现幂等机制，这个唯一标识符可以是一个 UUID，也可以是一个自定义的字符串，只要保证唯一性即可，而唯一性由客户端保证。

```http
POST /api/v1/orders HTTP/1.1
Host: example.com
Content-Type: application/json
X-Request-Id: e0db47c3-05c4-4205-b80a-b4a2a482fb8c

{
  "product_id": 1,
  "quantity": 1
}
```

在服务端接收到请求后，首先检查请求头中的 `X-Request-Id` 是否存在，如果存在则检查是否已经处理过，如果已经处理过则直接返回处理结果，否则继续处理请求。

请求头的 Key 可以自定义，这里使用 `X-Request-Id` 只是一个示例，实际开发中可以根据实际情况来定义。

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "message": "Request already processed"
}
```

这样客户端就可以通过 `X-Request-Id` 来确保服务端只处理一次请求，即使请求重试也不会导致资源状态的改变。

## 在 `Kratos` 中支持幂等机制

在 `Kratos` 中可以通过中间件来实现幂等机制，具体实现方式如下：

```go
type CtxRequestKey string

const (
    CtxReqKeyIdempotency CtxRequestKey = "Idempotency-Key"
)

func SetIdempotencyKeyWithCtx(ctx context.Context, key string) context.Context {
    return context.WithValue(ctx, CtxReqKeyIdempotency, key)
}

// 幂等处理
func IdempotencyMiddleware(handler middleware.Handler, r redis.Client) middleware.Handler {
    return func(ctx context.Context, req any) (any, error) {
        if httpCtx, ok := http.RequestFromServerContext(ctx); ok {
            idempotencyKey := httpCtx.Header.Get("X-Request-Id")
            if idempotencyKey != "" {
                // 检查redis中是否存在该key 如果不存在则创建一个bool类型的值
                if b, err := r.HSetNX(ctx, "idempotency", idempotencyKey, true).Result(); err != nil {
                    return nil, err
                } else if !b {
                    return nil, v1.ErrorConflict("Request already processed")
                }

                ctx = server.SetIdempotencyKeyWithCtx(ctx, idempotencyKey)
            }
        }

        return handler(ctx, req)
    }
}
```

其中 `HSetNX` 方法用于在 Redis 中创建一个唯一的键值对，如果键已经存在则返回 `false`，否则返回 `true`

具体说明: [HSETNX](https://redis.io/docs/latest/commands/hsetnx/)

测试代码如下：

```go
func TestRedisHSetNX(t *testing.T) {
    r := redis.NewClient(&redis.Options{
        Addr: "localhost:6379",
        DB:   0,
    })

    ctx := context.Background()
    b, err := r.HSetNX(ctx, "key", "field", true).Result()
    if err != nil {
        t.Fatal(err)
    }
    t.Log(b)

    c, err := r.HSetNX(ctx, "key", "field", true).Result()
    if err != nil {
        t.Fatal(err)
    }
    t.Log(c)
}
```

运行结果

```shell
Running tool: /usr/local/go/bin/go test -timeout 300s -run ^TestRedisHSetNX$ github.com/sosyz/test -v -count=1 ./...

=== RUN   TestRedisHSetNX
    /home/sonui/Documents/code/test/main_test.go:93: true
    /home/sonui/Documents/code/test/main_test.go:99: false
--- PASS: TestRedisHSetNX (0.00s)
PASS
ok      github.com/sosyz/test   0.005s
```

## 参考资料

- <https://github.com/stickfigure/blog/wiki/How-to-(and-how-not-to)-design-REST-APIs#rule-11-do-provide-idempotence-mechanisms>
- <https://redis.io/docs/latest/commands/hsetnx/>
- <https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Methods>
