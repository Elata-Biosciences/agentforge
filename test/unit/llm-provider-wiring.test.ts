import { describe, expect, it, vi } from 'vitest';
import { PersonaLlmAgentBase } from '../../src/agents/llm/personaLlmAgentBase.js';

vi.mock('../../src/agents/llm/providers/factory.js', () => ({
  createLlmProviderClient: vi.fn((config: { provider: string }) => ({
    complete: async () =>
      JSON.stringify({
        name: 'DoNothing',
        params: {},
        rationale: `mock-${config.provider}`,
      }),
  })),
}));

describe('PersonaLlmAgentBase provider wiring', () => {
  it('creates client from params.provider when no LlmClient injected', async () => {
    const { createLlmProviderClient } = await import('../../src/agents/llm/providers/factory.js');

    const agent = new PersonaLlmAgentBase('test-agent', {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(createLlmProviderClient).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', model: 'gpt-4o-mini' })
    );
    expect(agent).toBeDefined();
  });

  it('falls back to DoNothing stub when no provider specified', () => {
    const agent = new PersonaLlmAgentBase('stub-agent', {});
    expect(agent).toBeDefined();
  });

  it('prefers injected LlmClient over params.provider', async () => {
    const { createLlmProviderClient } = await import('../../src/agents/llm/providers/factory.js');
    const mockFn = createLlmProviderClient as unknown as ReturnType<typeof vi.fn>;
    const callCountBefore = mockFn.mock.calls.length;

    const mockClient = { complete: async () => '{"name":"DoNothing","params":{}}' };
    const agent = new PersonaLlmAgentBase('injected-agent', { provider: 'openai' }, mockClient);
    expect(agent).toBeDefined();
    expect(mockFn.mock.calls.length).toBe(callCountBefore);
  });
});
