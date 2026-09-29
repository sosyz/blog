---
title: "HTTP 幂等机制支持"
description: "借助请求头唯一标识与 Redis，在 Kratos 中间件里为非幂等接口实现幂等。"
type: 踩坑
topic: 后端
tags: [HTTP, 后端, 幂等, Go]
pubDate: "2024-04-25"
updatedDate: "2026-09-29"
---

## 引言

在 HTTP 协议的世界里，幂等性是一个核心概念，它确保对同一资源的多次请求结果保持一致。这一特性对于开发者来说至关重要，尤其是在网络环境不稳定时，能够保障重复的请求不会引起资源状态的变化。

HTTP 协议中定义了多种请求方法，其中 `GET`、`HEAD`、`PUT`、`DELETE`、`OPTIONS` 和 `TRACE` 被认为是幂等的，而 `POST`、`PATCH` 和 `CONNECT` 则不是。那么，面对非幂等的请求方法，我们如何通过特殊处理来支持幂等性呢？

设想这样一个场景：用户在网络条件极差的环境下尝试提交一个订单，但因为网络不稳定他无法确定订单是否成功提交。这时如果接口不支持幂等性，重复提交可能会导致订单被重复处理，造成资源浪费。因此实现幂等机制显得尤为重要。

## 幂等机制的设计与实现

一种简单有效的实现幂等性的方法是在请求头中添加一个唯一标识符，如 `UUID` 或自定义字符串以确保每次请求的唯一性。这个唯一性由客户端保证。

例如，客户端在提交订单时发送如下请求：

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

服务端在接收到请求后，首先检查 `X-Request-Id` 是否已存在。如果该标识符已存在表明请求已被处理，服务端则直接返回一个表示已处理的状态码，如 `400 Bad Request`。这样即使在网络不稳定导致的重试中服务端也只处理一次请求，避免了资源状态的改变。

## 在 `Kratos` 框架中实现幂等性

在 `Kratos` 框架中可以通过中间件来轻松实现幂等性。以下是一个示例实现：

```go
type CtxRequestKey string

const (
    CtxReqKeyIdempotency CtxRequestKey = "Idempotency-Key"
)

func SetIdempotencyKeyWithCtx(ctx context.Context, key string) context.Context {
    return context.WithValue(ctx, CtxReqKeyIdempotency, key)
}

// IdempotencyMiddleware 幂等性中间件
func IdempotencyMiddleware(r *redis.Client) middleware.Middleware {
    return func(handler middleware.Handler) middleware.Handler {
        return func(ctx context.Context, req any) (any, error) {
            idempotencyKey := ""

            if httpCtx, ok := http.RequestFromServerContext(ctx); ok {
                idempotencyKey = httpCtx.Header.Get("X-Request-Id")
                if idempotencyKey != "" {
                    // 用 SETNX 原子地占住这个 key，已经存在则拒绝请求
                    // 并发的重复请求里只有一个能占住，其余的直接返回冲突
                    ok, err := r.SetNX(ctx, idempotencyKey, true, 24*time.Hour).Result()
                    if err != nil {
                        return nil, err
                    }
                    if !ok {
                        return nil, v1.ErrorErrorReasonErrorConflict("idempotency key already exists")
                    }

                    ctx = SetIdempotencyKeyWithCtx(ctx, idempotencyKey)
                }
            }

            res, err := handler(ctx, req)
            if err != nil && idempotencyKey != "" {
                // 处理失败时删掉 key，允许客户端带同一个标识重试
                _ = r.Del(ctx, idempotencyKey).Err()
            }

            return res, err
        }
    }
}
```

通过这种方式我们可以确保即使在多次请求的情况下服务端也只处理一次请求，有效避免了重复处理的问题。

> 更正（2026-09-29）：最初的写法是先用 `Exists` 检查 key，处理成功后再 `Set`。检查和写入之间有时间差，两个同时到达的重复请求可能都通过检查、都被处理。现在改成处理前用 `SETNX` 原子地占位，处理失败再删掉 key。

## 测试与验证

通过以下测试代码验证幂等性中间件的有效性：

```go
func TestIdempotencyMiddleware(t *testing.T) {
    uniqueIdKey := "abcd-efg1-2345"

    call := func() *http.Response {
        // 示例项目的 helloworld 接口是 GET，这里只用来验证中间件的效果；
        // GET 本身就是幂等的，实际要保护的是 POST 这类非幂等接口
        req, err := http.NewRequest("GET", "http://127.0.0.1:8000/helloworld", nil)
        if err != nil {
            t.Fatalf("创建请求失败: %v", err)
        }

        req.Header.Set("X-Request-Id", uniqueIdKey)

        client := &http.Client{}
        resp, err := client.Do(req)
        if err != nil {
            t.Fatalf("请求失败: %v", err)
        }
        defer resp.Body.Close()

        t.Logf("响应状态码: %v", resp.StatusCode)

        buf, _ := io.ReadAll(resp.Body)
        t.Logf("响应内容: %v", string(buf))
        return resp

    }

    if call().StatusCode != 200 {
        t.Fatalf("第一次请求失败")
    }

    if call().StatusCode != 400 {
        t.Fatalf("第二次请求失败")
    }
}
```

运行结果：

```text
Running tool: /usr/local/go/bin/go test -timeout 300s -run ^TestIdempotencyMiddleware$ kratos-test/internal/server -count=1

=== RUN   TestIdempotencyMiddleware
    http_test.go:27: 响应状态码: 200
    http_test.go:30: 响应内容: {"message":"Hello "}
    http_test.go:27: 响应状态码: 400
    http_test.go:30: 响应内容: {"code":400,"reason":"ERROR_REASON_ERROR_CONFLICT","message":"idempotency key already exists","metadata":{}}
--- PASS: TestIdempotencyMiddleware (0.01s)
PASS
ok      kratos-test/internal/server     0.927s
```

## 参考资料

- <https://github.com/stickfigure/blog/wiki/How-to-(and-how-not-to)-design-REST-APIs#rule-11-do-provide-idempotence-mechanisms>
- <https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Methods>
- <https://http.cat/>
