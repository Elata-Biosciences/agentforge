import { describe, expect, it } from 'vitest';
import { ReportConfigV1Schema } from '../../src/studio/report/spec.js';

describe('Studio report spec', () => {
  it('validates a basic report config', () => {
    const cfg = {
      v: 'v1',
      blocks: [
        { kind: 'markdown', markdown: '# Hello' },
        {
          kind: 'dataset',
          as: 'm',
          table: 'metrics',
          spec: { v: 'v1', select: ['tick', 'totalVolume'], limit: 1000 },
        },
        {
          kind: 'transform',
          as: 'm2',
          from: 'm',
          steps: [{ kind: 'select', fields: ['tick', 'totalVolume'] }],
        },
      ],
    };
    const parsed = ReportConfigV1Schema.parse(cfg);
    expect(parsed.v).toBe('v1');
    expect(parsed.blocks.length).toBeGreaterThan(0);
  });

  it('rejects unknown block kinds', () => {
    expect(() =>
      ReportConfigV1Schema.parse({
        v: 'v1',
        blocks: [{ kind: 'nope', x: 1 }],
      })
    ).toThrow();
  });

  it('accepts histogram chart options', () => {
    const cfg = {
      v: 'v1',
      blocks: [
        { kind: 'markdown', markdown: '# Charts' },
        {
          kind: 'dataset',
          as: 'm',
          table: 'metrics',
          spec: { v: 'v1', select: ['tick', 'totalVolume'], limit: 1000 },
        },
        {
          kind: 'chart',
          chartType: 'histogram',
          dataset: 'm',
          xField: 'totalVolume',
          xLabel: 'Volume',
          yLabel: 'Count',
          bins: 16,
          showLegend: false,
        },
      ],
    };
    const parsed = ReportConfigV1Schema.parse(cfg);
    expect(parsed.blocks.length).toBe(3);
  });
});
