import { describe, expect, it } from 'vitest';
import { runMlRequest } from '../../src/studio/ml/runMl.js';
import { MlRequestSchema } from '../../src/studio/ml/spec.js';

describe('ML dataset inputs', () => {
  it('accepts dataset-only requests in schema', () => {
    const parsed = MlRequestSchema.parse({
      kind: 'dataset',
      runId: 'RUN_ID',
      dataset: 'm_abs',
      select: ['tick', 'x_abs'],
      limit: 10,
    });
    expect(parsed.dataset).toBe('m_abs');
    expect(parsed.table).toBeUndefined();
  });

  it('runs ML dataset query against provided computed dataset', async () => {
    const req = MlRequestSchema.parse({
      kind: 'dataset',
      runId: 'RUN_ID',
      dataset: 'm_abs',
      select: ['tick', 'x_abs'],
      filters: [{ field: 'x_abs', op: 'gt', value: 2 }],
    });
    const res = await runMlRequest(
      req,
      {
        metrics: [] as any,
        actions: [] as any,
        evidence: null,
      },
      {
        m_abs: {
          columns: [
            { name: 'tick', type: 'number' },
            { name: 'x_abs', type: 'number' },
          ],
          rows: [
            { tick: 0, x_abs: 1 },
            { tick: 1, x_abs: 3 },
            { tick: 2, x_abs: 5 },
          ],
        },
      }
    );
    expect(res.ok).toBe(true);
    expect(res.rows.length).toBe(2);
    expect(res.rows[0].tick).toBe(1);
    expect(res.rows[1].tick).toBe(2);
  });
});
