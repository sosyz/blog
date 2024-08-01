---
title: HTTP 幂等机制支持
date: 2024-04-25T10:27:32+08:00
tags: HTTP, Backend, Idempotence
---

## 引言

在HTTP协议的世界里，幂等性是一个核心概念，它确保对同一资源的多次请求结果保持一致。这一特性对于开发者来说至关重要，尤其是在网络环境不稳定时，能够保障重复的请求不会引起资源状态的变化。

HTTP协议中定义了多种请求方法，其中`GET`、`HEAD`、`PUT`、`DELETE`、`OPTIONS`和`TRACE`被认为是幂等的，而`POST`、`PATCH`和`CONNECT`则不是。那么，面对非幂等的请求方法，我们如何通过特殊处理来支持幂等性呢？

<!-- more -->

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

在 `Kratos` 框架中可以通过中间件来轻松实现幂等性。以下是一个示例实现

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
                    // 检查redis中是否存在该key 如果存在则拒绝请求
                    if b, err := r.Exists(ctx, idempotencyKey).Result(); err != nil {
                        return nil, err
                    } else if b > 0 {
                        return nil, v1.ErrorErrorReasonErrorConflict("idempotency key already exists")
                    }

                    ctx = SetIdempotencyKeyWithCtx(ctx, idempotencyKey)
                }
            }

            res, err := handler(ctx, req)
            if err == nil && idempotencyKey != "" {
                if err := r.Set(ctx, idempotencyKey, true, 24*time.Hour).Err(); err != nil {
                    return nil, err
                }
            }

            return res, err
        }
    }
}
```

通过这种方式我们可以确保即使在多次请求的情况下服务端也只处理一次请求，有效避免了重复处理的问题。

## 测试与验证

通过以下测试代码验证幂等性中间件的有效性

```go
func TestIdempotencyMiddleware(t *testing.T) {
    uniqueIdKey := "abcd-efg1-2345"

    call := func() *http.Response {
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

运行结果

```shell
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
