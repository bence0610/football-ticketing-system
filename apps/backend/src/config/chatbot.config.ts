import { registerAs } from '@nestjs/config';

export interface ChatbotConfig {
  rateLimitAuth: number;
  rateLimitAnon: number;
  historyTtlSeconds: number;
  historyMaxMessages: number;
  contextCacheTtlSeconds: number;
}

export default registerAs(
  'chatbot',
  (): ChatbotConfig => ({
    rateLimitAuth: parseInt(process.env.CHATBOT_RATE_LIMIT_AUTH ?? '100', 10),
    rateLimitAnon: parseInt(process.env.CHATBOT_RATE_LIMIT_ANON ?? '20', 10),
    historyTtlSeconds: parseInt(process.env.CHATBOT_HISTORY_TTL_SECONDS ?? '86400', 10),
    historyMaxMessages: parseInt(process.env.CHATBOT_HISTORY_MAX_MESSAGES ?? '20', 10),
    contextCacheTtlSeconds: parseInt(process.env.CHATBOT_CONTEXT_CACHE_TTL_SECONDS ?? '300', 10),
  }),
);
