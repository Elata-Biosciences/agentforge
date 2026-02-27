import { OpenAiProviderClient } from './providers/openai.js';
import type { LlmClient } from './types.js';

export type { LlmClient, LlmCompletionInput } from './types.js';

export class OpenAiChatClient extends OpenAiProviderClient implements LlmClient {}
