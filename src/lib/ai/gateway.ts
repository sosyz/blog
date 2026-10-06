import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { config } from "@/lib/config";

export const maashub = createOpenAICompatible({
  apiKey: config.maashub.apiKey,
  baseURL: "https://fjlaskvlskslwkeldkmasldkf.maashub.cn/api/v1",
  includeUsage: true,
  name: "maashub",
});

export const cloudflare = createOpenAICompatible({
  apiKey: config.cloudflare.ai.apiKey,
  baseURL: `https://gateway.ai.cloudflare.com/v1/${config.cloudflare.accountId}/${config.cloudflare.ai.gatewayId}/compat`,
  headers: {
    "cf-aig-authorization": `Bearer ${config.cloudflare.ai.auth}`,
  },
  includeUsage: true,
  name: "cloudflare",
});

export const openrouter = createOpenAICompatible({
  apiKey: config.openrouter.apiKey,
  baseURL: "https://openrouter.ai/api/v1",
  includeUsage: true,
  name: "openrouter",
});
