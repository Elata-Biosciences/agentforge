import type { LlmClient, LlmCompletionInput } from '../types.js';
import { fetchWithRetry } from './request.js';

export class OpenAiProviderClient implements LlmClient {
  constructor(
    private readonly apiKey: string = process.env.OPENAI_API_KEY ?? '',
    private readonly defaultModel = 'gpt-4o-mini'
  ) {}

  async complete(input: LlmCompletionInput): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAI provider');
    }

    const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model ?? this.defaultModel,
        temperature: 0.2,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      }),
    });

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI response contained no message content');
    }
    return content;
  }
}
