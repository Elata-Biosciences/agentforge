import type { LlmClient, LlmCompletionInput } from '../types.js';
import { fetchWithRetry } from './request.js';

export class GeminiProviderClient implements LlmClient {
  constructor(
    private readonly apiKey: string = process.env.GEMINI_API_KEY ?? '',
    private readonly defaultModel = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash'
  ) {}

  async complete(input: LlmCompletionInput): Promise<string> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is required for Gemini provider');
    }

    const model = input.model ?? this.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${input.system}\n\n${input.user}` }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
        },
      }),
    });

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const content = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error('Gemini response contained no text content');
    }
    return content;
  }
}
