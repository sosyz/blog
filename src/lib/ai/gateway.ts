import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { config } from "@/lib/config";

export const maashub = createOpenAICompatible({
  name: "maashub",
  apiKey: config.maashub.apiKey,
  baseURL: "https://fjlaskvlskslwkeldkmasldkf.maashub.cn/api/v1",
  includeUsage: true,
});

export const cloudflare = createOpenAICompatible({
  name: "cloudflare",
  apiKey: config.cloudflare.ai.apiKey,
  baseURL: `https://gateway.ai.cloudflare.com/v1/${config.cloudflare.accountId}/${config.cloudflare.ai.gatewayId}/compat`,
  includeUsage: true,
  headers: {
    "cf-aig-authorization": `Bearer ${config.cloudflare.ai.auth}`,
  },
});

export const openrouter = createOpenAICompatible({
  name: "openrouter",
  apiKey: config.openrouter.apiKey,
  baseURL: "https://openrouter.ai/api/v1",
  includeUsage: true,
});
