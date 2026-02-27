import { describe, expect, it } from 'vitest';
import { LlmPolicyAgent } from '../../src/agents/llm/llmPolicyAgent.js';
import { Rng } from '../../src/core/rng.js';
import type { TickContext } from '../../src/core/types.js';
import { createMockLogger } from '../mocks/mockLogger.js';
import { createMockPack } from '../mocks/mockPack.js';

describe('llm policy agent', () => {
  it('parses JSON decision and returns action', async () => {
    const agent = new LlmPolicyAgent(
      'llm-1',
      {},
      {
        complete: async () => '{"name":"DoNothing","params":{},"rationale":"safe"}',
      }
    );

    const pack = createMockPack();
    const ctx: TickContext = {
      tick: 1,
      timestamp: 100,
      rng: new Rng(1),
      logger: createMockLogger(),
      pack,
      world: { timestamp: 100, foo: 'bar' },
      mode: 'exploration',
    };
    const action = await agent.step(ctx);
    expect(action?.name).toBe('DoNothing');
    expect(action?.metadata?.personaId).toBe('adversarial-policy');
  });

  it('accepts persona metadata in parsed action intent', async () => {
    const agent = new LlmPolicyAgent(
      'llm-1b',
      {},
      {
        complete: async () =>
          '{"name":"DoNothing","params":{},"rationale":"safe","metadata":{"personaId":"tester","intentTag":"observer","confidence":0.9}}',
      }
    );

    const pack = createMockPack();
    const ctx: TickContext = {
      tick: 1,
      timestamp: 100,
      rng: new Rng(1),
      logger: createMockLogger(),
      pack,
      world: { timestamp: 100, foo: 'bar' },
      mode: 'exploration',
    };
    const action = await agent.step(ctx);
    expect(action?.metadata?.personaId).toBe('tester');
    expect(action?.metadata?.intentTag).toBe('observer');
  });

  it('accepts gossip semantic intent tags in parsed action intent', async () => {
    const agent = new LlmPolicyAgent(
      'llm-1c',
      {},
      {
        complete: async () =>
          '{"name":"PostMessage","params":{"channelId":"global","text":"signal","intentTag":"coordinate"},"rationale":"sync peers","metadata":{"personaId":"tester","intentTag":"inform","confidence":0.76}}',
      }
    );

    const pack = createMockPack();
    const ctx: TickContext = {
      tick: 1,
      timestamp: 100,
      rng: new Rng(1),
      logger: createMockLogger(),
      pack,
      world: { timestamp: 100, foo: 'bar' },
      mode: 'exploration',
    };
    const action = await agent.step(ctx);
    expect(action?.name).toBe('PostMessage');
    expect(action?.metadata?.intentTag).toBe('inform');
  });

  it('returns null when decision is not parseable', async () => {
    const agent = new LlmPolicyAgent(
      'llm-2',
      {},
      {
        complete: async () => 'not-json',
      }
    );
    const pack = createMockPack();
    const ctx: TickContext = {
      tick: 1,
      timestamp: 100,
      rng: new Rng(1),
      logger: createMockLogger(),
      pack,
      world: { timestamp: 100 },
      mode: 'exploration',
    };
    const action = await agent.step(ctx);
    expect(action).toBeNull();
  });

  it('includes query budget context in prompt assembly', async () => {
    let capturedUser = '';
    const agent = new LlmPolicyAgent(
      'llm-3',
      {},
      {
        complete: async (input) => {
          capturedUser = input.user;
          return '{"name":"DoNothing","params":{}}';
        },
      }
    );
    const pack = createMockPack();
    const ctx: TickContext = {
      tick: 2,
      timestamp: 200,
      rng: new Rng(2),
      logger: createMockLogger(),
      pack,
      world: { timestamp: 200, tvl: 1234 },
      mode: 'exploration',
      query: {
        query: () => ({ ok: true, data: {}, bytes: 2, cost: 1 }),
        budget: {
          usedQueries: 2,
          usedCost: 8,
          usedBytes: 100,
          remainingQueries: 8,
          remainingCost: 92,
          remainingBytes: 15_900,
        },
      },
    };

    await agent.step(ctx);
    expect(capturedUser).toContain('queryBudget');
    expect(capturedUser).toContain('remainingQueries');
  });

  it('supports two-stage plan then action loop with capability context', async () => {
    let calls = 0;
    const seenUsers: string[] = [];
    const agent = new LlmPolicyAgent(
      'llm-4',
      {},
      {
        complete: async (input) => {
          calls += 1;
          seenUsers.push(input.user);
          if (calls === 1) {
            return '{"hypothesis":"Probe governance drift","expectedEffect":"select high-signal action","preferredActionFamily":"QueryWorld","confidence":0.7}';
          }
          return '{"name":"QueryWorld","params":{"endpoint":"get_world"},"rationale":"need fresh state","metadata":{"personaId":"adversarial-policy","intentTag":"observer","confidence":0.8}}';
        },
      }
    );
    const pack = createMockPack();
    const ctx: TickContext = {
      tick: 3,
      timestamp: 300,
      rng: new Rng(3),
      logger: createMockLogger(),
      pack,
      world: { timestamp: 300, foo: 'bar' },
      mode: 'exploration',
      capabilities: {
        version: 'v1',
        tools: ['QueryWorld', 'RpcCall', 'PostMessage'],
        queryEndpoints: [{ name: 'get_world', cost: 1 }],
        contracts: [{ alias: 'AppFactory' }],
        actionTemplates: [],
      },
    };
    const action = await agent.step(ctx);
    expect(calls).toBe(2);
    expect(action?.name).toBe('QueryWorld');
    expect(seenUsers.join('\n')).toContain('capabilities');
  });
});
