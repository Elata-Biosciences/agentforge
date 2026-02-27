import { describe, expect, it } from 'vitest';
import { executeQuery } from '../../src/studio/query/execute.js';

describe('Studio query engine', () => {
  it('supports dotted paths in groupBy (action.name)', () => {
    const actions = [
      { tick: 0, agentId: 'a', action: { name: 'Buy' } },
      { tick: 1, agentId: 'b', action: { name: 'Sell' } },
      { tick: 2, agentId: 'c', action: { name: 'Buy' } },
    ] as any;
    const res = executeQuery(
      {
        runId: 'dummy',
        table: 'actions',
        spec: {
          v: 'v1',
          groupBy: ['action.name'],
          aggregates: [{ as: 'count', op: 'count' }],
          sort: { field: 'count', dir: 'desc' },
        },
      } as any,
      { metrics: [], actions, evidence: null }
    );
    expect(res.rows.length).toBe(2);
    expect(res.rows[0]?.['action.name']).toBe('Buy');
    expect(res.rows[0]?.count).toBe(2);
  });
});
