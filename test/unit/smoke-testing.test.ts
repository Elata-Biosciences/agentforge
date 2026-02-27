import { describe, expect, it } from 'vitest';
import {
  applyAssumptionPatches,
  computeDivergenceScore,
  createSmokeDivergenceResult,
} from '../../src/core/smoke.js';

describe('smoke testing helpers', () => {
  it('applies assumption patches', () => {
    const base = { latency: 1, dropRate: 0 };
    const next = applyAssumptionPatches(base, [{ key: 'latency', value: 3 }]);
    expect(next.latency).toBe(3);
    expect(next.dropRate).toBe(0);
  });

  it('computes divergence score from numeric metrics', () => {
    const score = computeDivergenceScore({ a: 10, b: 5 }, { a: 7, b: 8 });
    expect(score).toBe(6);
  });

  it('creates divergence result object', () => {
    const result = createSmokeDivergenceResult(
      10,
      { key: 'oracle_noise', value: 0.2 },
      { pnl: 100 },
      { pnl: 80 }
    );
    expect(result.checkpointTick).toBe(10);
    expect(result.divergenceScore).toBe(20);
  });
});
