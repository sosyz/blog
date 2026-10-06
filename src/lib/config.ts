export const config = {
  cloudflare: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    ai: {
      apiKey: process.env.CLOUDFLARE_AI_API_KEY,
      auth: process.env.CLOUDFLARE_GATEWAY_AUTH,
      gatewayId: process.env.CLOUDFLARE_GATEWAY_ID,
    },
  },
  maashub: {
    apiKey: process.env.MAASHUB_API_KEY,
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
  },
} as const;
