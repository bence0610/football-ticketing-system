import { registerAs } from '@nestjs/config';

/**
 * Fallback when ANTHROPIC_MODEL is unset. Anthropic retires model ids, and a
 * retired id answers 404, so prefer pinning the model in the environment.
 */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
}

export default registerAs(
  'anthropic',
  (): AnthropicConfig => ({
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
    maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS ?? '1024', 10),
  }),
);
