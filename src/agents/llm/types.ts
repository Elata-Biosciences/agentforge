export interface LlmCompletionInput {
  system: string;
  user: string;
  model?: string;
}

export interface LlmClient {
  complete(input: LlmCompletionInput): Promise<string>;
}

export interface LlmProviderConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible' | 'openrouter' | 'gemini';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  appName?: string;
  appUrl?: string;
}
