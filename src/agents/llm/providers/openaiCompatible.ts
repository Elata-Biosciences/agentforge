import type { LlmClient, LlmCompletionInput } from '../types.js';
import { fetchWithRetry } from './request.js';

export class OpenAiCompatibleProviderClient implements LlmClient {
  constructor(
    private readonly baseUrl: string = process.env.OPENAI_COMPAT_BASE_URL ??
      'http://localhost:11434/v1',
    private readonly apiKey: string = process.env.OPENAI_COMPAT_API_KEY ?? 'local-dev-key',
    private readonly defaultModel = process.env.OPENAI_COMPAT_MODEL ?? 'llama3.1:8b'
  ) {}

  async complete(input: LlmCompletionInput): Promise<string> {
    const response = await fetchWithRetry(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
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
      throw new Error('OpenAI-compatible response contained no message content');
    }
    return content;
  }
}
