import { describe, expect, it } from 'vitest';
import { OpenAiChatClient } from '../../src/agents/llm/openaiClient.js';

const runLive =
  Boolean(process.env.RUN_OPENAI_INTEGRATION_TEST) && Boolean(process.env.OPENAI_API_KEY);

describe('OpenAI optional integration', () => {
  it.runIf(runLive)('performs a live completion when explicitly enabled', async () => {
    const client = new OpenAiChatClient(process.env.OPENAI_API_KEY);
    const content = await client.complete({
      system: 'You are terse.',
      user: 'Reply with only: OK',
      model: process.env.OPENAI_TEST_MODEL ?? 'gpt-4o-mini',
    });
    expect(content.toUpperCase()).toContain('OK');
  });
});
