import { describe, expect, it } from 'vitest';
import type { QueryEndpoint } from '../../src/core/types.js';
import { QueryApi } from '../../src/query/queryApi.js';

describe('query budget api', () => {
  const endpoints: QueryEndpoint[] = [
    {
      name: 'get_price',
      cost: 2,
      handler: (_params, world) => world.price,
    },
  ];

  it('enforces query count and cost budgets', () => {
    const api = new QueryApi(endpoints, {
      maxQueriesPerTick: 1,
      maxCostPerTick: 2,
      maxBytesPerTick: 1024,
    });

    const first = api.run({ endpoint: 'get_price' }, { timestamp: 1, price: 100 });
    expect(first.ok).toBe(true);

    const second = api.run({ endpoint: 'get_price' }, { timestamp: 1, price: 101 });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('query_count_budget_exceeded');
  });

  it('returns unknown endpoint error deterministically', () => {
    const api = new QueryApi([], {
      maxQueriesPerTick: 5,
      maxCostPerTick: 5,
      maxBytesPerTick: 50,
    });
    const result = api.run({ endpoint: 'missing' }, { timestamp: 0 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unknown_endpoint');
  });

  it('applies deterministic response truncation when endpoint maxResponseBytes is set', () => {
    const api = new QueryApi(
      [
        {
          name: 'big_response',
          cost: 1,
          maxResponseBytes: 10,
          handler: () => ({ payload: 'abcdefghijklmnopqrstuvwxyz' }),
        },
      ],
      {
        maxQueriesPerTick: 10,
        maxCostPerTick: 10,
        maxBytesPerTick: 100,
      }
    );
    const result = api.run({ endpoint: 'big_response' }, { timestamp: 0 });
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBe(10);
  });
});
