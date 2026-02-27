import { describe, expect, it } from 'vitest';
import { executeReportConfig } from '../../src/studio/report/execute.js';
import type { ReportConfigV1 } from '../../src/studio/report/spec.js';

describe('Report execution', () => {
  it('executes dataset + transform blocks deterministically', async () => {
    const cfg: ReportConfigV1 = {
      v: 'v1',
      blocks: [
        {
          kind: 'dataset',
          as: 'm',
          table: 'metrics',
          spec: { v: 'v1', select: ['tick', 'x'], sort: { field: 'tick', dir: 'asc' }, limit: 10 },
        },
        {
          kind: 'transform',
          as: 'm_abs',
          from: 'm',
          steps: [{ kind: 'derive', as: 'x_abs', op: 'abs', field: 'x' }],
        },
      ],
    };

    const out = await executeReportConfig({
      config: cfg,
      runId: 'RUN_ID',
      data: {
        metrics: [
          { tick: 0, timestamp: 0, x: -2 },
          { tick: 1, timestamp: 1, x: 3 },
        ] as any,
        actions: [],
        evidence: null,
      },
    });

    expect(out.datasets.m).toBeTruthy();
    expect(out.datasets.m_abs).toBeTruthy();
    expect((out.datasets.m_abs.rows[0] as any).x_abs).toBe(2);
    expect((out.datasets.m_abs.rows[1] as any).x_abs).toBe(3);
  });

  it('allows ML blocks to consume computed datasets', async () => {
    const cfg: ReportConfigV1 = {
      v: 'v1',
      blocks: [
        {
          kind: 'dataset',
          as: 'm',
          table: 'metrics',
          spec: { v: 'v1', select: ['tick', 'x'], sort: { field: 'tick', dir: 'asc' }, limit: 10 },
        },
        {
          kind: 'transform',
          as: 'm_abs',
          from: 'm',
          steps: [{ kind: 'derive', as: 'x_abs', op: 'abs', field: 'x' }],
        },
        {
          kind: 'ml',
          as: 'ml_abs',
          request: {
            kind: 'anomaly_zscore',
            runId: 'RUN_ID',
            dataset: 'm_abs',
            field: 'x_abs',
            threshold: 0.5,
          } as any,
        },
      ],
    };

    const out = await executeReportConfig({
      config: cfg,
      runId: 'RUN_ID',
      data: {
        metrics: [
          { tick: 0, timestamp: 0, x: -2 },
          { tick: 1, timestamp: 1, x: 3 },
          { tick: 2, timestamp: 2, x: -8 },
          { tick: 3, timestamp: 3, x: 1 },
        ] as any,
        actions: [],
        evidence: null,
      },
    });

    expect((out.ml.ml_abs as any)?.ok).toBe(true);
    expect(out.datasets['ml_abs.points']).toBeTruthy();
    expect(out.datasets['ml_abs.anomalies']).toBeTruthy();
  });

  it('supports extended transform operations', async () => {
    const cfg: ReportConfigV1 = {
      v: 'v1',
      blocks: [
        {
          kind: 'dataset',
          as: 'm',
          table: 'metrics',
          spec: {
            v: 'v1',
            select: ['tick', 'a', 'b'],
            sort: { field: 'tick', dir: 'asc' },
            limit: 10,
          },
        },
        {
          kind: 'transform',
          as: 'm2',
          from: 'm',
          steps: [
            { kind: 'expr', as: 'a_over_b', op: 'ratio', left: 'a', right: 'b' },
            { kind: 'expr', as: 'a_minus_b', op: 'diff', left: 'a', right: 'b' },
            { kind: 'cumulative', as: 'a_cum', field: 'a', op: 'sum' },
            { kind: 'bucket', as: 'a_bucket', field: 'a', size: 2 },
            { kind: 'rank', as: 'a_rank', field: 'a', dir: 'desc' },
          ] as any,
        },
      ],
    };
    const out = await executeReportConfig({
      config: cfg,
      runId: 'RUN_ID',
      data: {
        metrics: [
          { tick: 0, timestamp: 0, a: 2, b: 1 },
          { tick: 1, timestamp: 1, a: 4, b: 2 },
          { tick: 2, timestamp: 2, a: 1, b: 1 },
        ] as any,
        actions: [],
        evidence: null,
      },
    });

    const rows = out.datasets.m2.rows as any[];
    expect(rows[0]?.a_over_b).toBe(2);
    expect(rows[1]?.a_minus_b).toBe(2);
    expect(rows[1]?.a_cum).toBe(6);
    expect(rows[1]?.a_bucket).toBe(4);
    expect(rows[0]?.a_rank).toBe(2);
  });
});
