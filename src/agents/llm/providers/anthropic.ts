import type { LlmClient, LlmCompletionInput } from '../types.js';
import { fetchWithRetry } from './request.js';

export class AnthropicProviderClient implements LlmClient {
  constructor(
    private readonly apiKey: string = process.env.ANTHROPIC_API_KEY ?? '',
    private readonly defaultModel = 'claude-3-5-sonnet-latest'
  ) {}

  async complete(input: LlmCompletionInput): Promise<string> {
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for Anthropic provider');
    }

    const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: input.model ?? this.defaultModel,
        max_tokens: 1024,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
      }),
    });

    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const content = payload.content?.find((item) => item.type === 'text')?.text;
    if (!content) {
      throw new Error('Anthropic response contained no text content');
    }
    return content;
  }
}
