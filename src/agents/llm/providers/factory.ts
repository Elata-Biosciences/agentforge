import type { LlmClient, LlmProviderConfig } from '../types.js';
import { AnthropicProviderClient } from './anthropic.js';
import { GeminiProviderClient } from './gemini.js';
import { OpenAiProviderClient } from './openai.js';
import { OpenAiCompatibleProviderClient } from './openaiCompatible.js';
import { OpenRouterProviderClient } from './openrouter.js';

export function createLlmProviderClient(config: LlmProviderConfig): LlmClient {
  switch (config.provider) {
    case 'openai':
      return new OpenAiProviderClient(config.apiKey, config.model ?? 'gpt-4o-mini');
    case 'anthropic':
      return new AnthropicProviderClient(config.apiKey, config.model ?? 'claude-3-5-sonnet-latest');
    case 'openai-compatible':
      return new OpenAiCompatibleProviderClient(
        config.baseUrl ?? process.env.OPENAI_COMPAT_BASE_URL ?? 'http://localhost:11434/v1',
        config.apiKey ?? process.env.OPENAI_COMPAT_API_KEY ?? 'local-dev-key',
        config.model ?? process.env.OPENAI_COMPAT_MODEL ?? 'llama3.1:8b'
      );
    case 'openrouter':
      return new OpenRouterProviderClient(
        config.apiKey ?? process.env.OPENROUTER_API_KEY ?? '',
        config.model ?? process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
        config.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
        config.appName ?? process.env.OPENROUTER_APP_NAME,
        config.appUrl ?? process.env.OPENROUTER_APP_URL
      );
    case 'gemini':
      return new GeminiProviderClient(
        config.apiKey ?? process.env.GEMINI_API_KEY ?? '',
        config.model
      );
    default:
      throw new Error(`Unsupported provider: ${String(config.provider)}`);
  }
}
