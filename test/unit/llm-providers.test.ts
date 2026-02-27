import { describe, expect, it } from 'vitest';
import {
  AnthropicProviderClient,
  GeminiProviderClient,
  OpenAiCompatibleProviderClient,
  OpenAiProviderClient,
  OpenRouterProviderClient,
  createLlmProviderClient,
} from '../../src/agents/llm/providers/index.js';

describe('llm provider factory', () => {
  it('creates OpenAI provider', () => {
    const client = createLlmProviderClient({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });
    expect(client).toBeInstanceOf(OpenAiProviderClient);
  });

  it('creates Anthropic provider', () => {
    const client = createLlmProviderClient({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3-5-sonnet-latest',
    });
    expect(client).toBeInstanceOf(AnthropicProviderClient);
  });

  it('creates openai-compatible provider', () => {
    const client = createLlmProviderClient({
      provider: 'openai-compatible',
      apiKey: 'test-key',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1:8b',
    });
    expect(client).toBeInstanceOf(OpenAiCompatibleProviderClient);
  });

  it('creates OpenRouter provider', () => {
    const client = createLlmProviderClient({
      provider: 'openrouter',
      apiKey: 'test-key',
      model: 'openai/gpt-4o-mini',
      baseUrl: 'https://openrouter.ai/api/v1',
      appName: 'AgentForge Tests',
      appUrl: 'https://example.com',
    });
    expect(client).toBeInstanceOf(OpenRouterProviderClient);
  });

  it('creates Gemini provider', () => {
    const client = createLlmProviderClient({
      provider: 'gemini',
      apiKey: 'test-key',
      model: 'gemini-1.5-flash',
    });
    expect(client).toBeInstanceOf(GeminiProviderClient);
  });

  it('throws for unsupported providers', () => {
    expect(() =>
      createLlmProviderClient({
        provider: 'unknown' as 'openai',
      })
    ).toThrow('Unsupported provider');
  });

  it('fails fast for missing OpenAI key', async () => {
    const client = new OpenAiProviderClient('', 'gpt-4o-mini');
    await expect(
      client.complete({
        system: 's',
        user: 'u',
      })
    ).rejects.toThrow('OPENAI_API_KEY');
  });

  it('fails fast for missing Anthropic key', async () => {
    const client = new AnthropicProviderClient('', 'claude-3-5-sonnet-latest');
    await expect(
      client.complete({
        system: 's',
        user: 'u',
      })
    ).rejects.toThrow('ANTHROPIC_API_KEY');
  });

  it('fails fast for missing OpenRouter key', async () => {
    const client = new OpenRouterProviderClient('', 'openai/gpt-4o-mini');
    await expect(
      client.complete({
        system: 's',
        user: 'u',
      })
    ).rejects.toThrow('OPENROUTER_API_KEY');
  });

  it('fails fast for missing Gemini key', async () => {
    const client = new GeminiProviderClient('', 'gemini-1.5-flash');
    await expect(
      client.complete({
        system: 's',
        user: 'u',
      })
    ).rejects.toThrow('GEMINI_API_KEY');
  });
});
