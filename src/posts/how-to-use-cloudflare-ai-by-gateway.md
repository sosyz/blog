---
title: "通过 Cloudflare AI Gateway 使用 LLM"
description: "详细介绍如何通过 Cloudflare AI Gateway 使用 LLM，包括资源准备、配置方法和使用示例，帮助开发者快速集成 Cloudflare 的 AI 服务。" 
pubDate: "Oct 08 2025"
---

## 资源准备

- apiKey: 需要 `Workers AI:Read` 权限
- auth: 需要 `AI Gateway:Read` 权限（嫌麻烦一个 `token` 俩权限都给也可以）
- accountId: 账号 ID，从页面获取（看控制台的访问链接也能拿到）
- gatewayId: 感觉应该叫 gatewayName 比较好？直接给网关名称就好

## 使用方式

这里搭配 Vercel AI SDK 的 [OpenAI Compatible](https://vercel.com/docs/ai-sdk/openai-compatible) 和 [generateText](https://vercel.com/docs/ai-sdk#generating-text) 使用。

安装依赖。

```bash
bun add ai @ai-sdk/openai-compatible
```

添加 Cloudflare AI Gateway 的配置。

```ts
const { accountId, gatewayId, apiKey, auth } = config.cloudflare.gateway;

export const cloudflare = createOpenAICompatible({
  name: "cloudflare",
  apiKey: apiKey,
  baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat`,
  includeUsage: true,
  headers: {
    "cf-aig-authorization": `Bearer ${auth}`,
  },
});
```

### 使用示例

模型名称这里绕了好久，试了半天才找到正确的格式。

如果使用 Cloudflare Workers AI Provider 的话模型名称应该遵循这个格式

```text
workers-ai/[model_name]

^^^^^^^^^^ ^^^^^^^^^^^^

|                 |

|                 +--> 从页面复制的模型名称，eg.@cf/meta/llama-3.2-1b-instruct

|

+--> Provider = "workers-ai"
```

```ts
// lab.ts
const result = await generateText({
  model: cloudflare("workers-ai/@cf/meta/llama-3.2-1b-instruct"),
  system: "你是一名助手。",
  prompt: "hello",
});

consola.log(result.content[0]);
```

```bash
❯ bun run lab.ts
{ type: 'text', text: 'hello!' }
```

## 参考资料

- [Unified API (OpenAI compat) | Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/)
- [Generating text | Vercel AI SDK](https://vercel.com/docs/ai-sdk#generating-text)
- [OpenAI Compatible Providers | AI SDK](https://ai-sdk.dev/providers/openai-compatible-providers)
