import { describe, expect, it } from 'vitest';
import { summarize } from '../../src/studio/stats/metricSummary.js';
import { linearRegression } from '../../src/studio/stats/regression.js';

describe('Studio stats', () => {
  it('computes linear regression fit', () => {
    const fit = linearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ]);
    expect(fit).not.toBeNull();
    expect(fit!.slope).toBeCloseTo(2, 6);
    expect(fit!.intercept).toBeCloseTo(1, 6);
    expect(fit!.r2).toBeCloseTo(1, 6);
  });

  it('summarizes a metric distribution', () => {
    const s = summarize([1, 2, 3, 4, 5]);
    expect(s).not.toBeNull();
    expect(s!.count).toBe(5);
    expect(s!.min).toBe(1);
    expect(s!.max).toBe(5);
    expect(s!.p50).toBe(3);
  });
});
