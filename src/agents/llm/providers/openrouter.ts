import type { LlmClient, LlmCompletionInput } from '../types.js';
import { fetchWithRetry } from './request.js';

export class OpenRouterProviderClient implements LlmClient {
  constructor(
    private readonly apiKey: string = process.env.OPENROUTER_API_KEY ?? '',
    private readonly defaultModel = process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
    private readonly baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    private readonly appName = process.env.OPENROUTER_APP_NAME,
    private readonly appUrl = process.env.OPENROUTER_APP_URL
  ) {}

  async complete(input: LlmCompletionInput): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is required for OpenRouter provider');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.appName) headers['X-Title'] = this.appName;
    if (this.appUrl) headers['HTTP-Referer'] = this.appUrl;

    const response = await fetchWithRetry(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
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
      throw new Error('OpenRouter response contained no message content');
    }
    return content;
  }
}
