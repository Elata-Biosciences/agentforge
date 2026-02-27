import { describe, expect, it } from 'vitest';
import { zscoreAnomalies } from '../../src/studio/ml/anomaly.js';
import { kmeans } from '../../src/studio/ml/kmeans.js';
import { fitLogisticRegression } from '../../src/studio/ml/logistic.js';
import { pca } from '../../src/studio/ml/pca.js';
import { fitLinearRegression, fitRidgeRegression } from '../../src/studio/ml/regression.js';
import { rollingStats } from '../../src/studio/ml/timeseries.js';

describe('ML toolkit', () => {
  it('fits linear regression (multivariate)', () => {
    // y = 1 + 2*x
    const X = [[0], [1], [2], [3]];
    const y = [1, 3, 5, 7];
    const fit = fitLinearRegression(X, y, ['x']);
    expect(fit.intercept).toBeCloseTo(1, 6);
    expect(fit.coefficients.x).toBeCloseTo(2, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
  });

  it('fits ridge regression', () => {
    const X = [[0], [1], [2], [3]];
    const y = [1, 3, 5, 7];
    const fit = fitRidgeRegression(X, y, ['x'], 10);
    expect(Number.isFinite(fit.intercept)).toBe(true);
    expect(Number.isFinite(fit.coefficients.x)).toBe(true);
  });

  it('fits logistic regression (simple separable)', () => {
    // label = x > 0.5
    const X = [[0], [0.2], [0.4], [0.8], [1.0], [1.2]];
    const y = [0, 0, 0, 1, 1, 1];
    const fit = fitLogisticRegression({
      X,
      y,
      featureNames: ['x'],
      maxIter: 1200,
      lr: 0.5,
      l2: 0,
    });
    expect(fit.accuracy).toBeGreaterThan(0.9);
  });

  it('clusters with kmeans', () => {
    const X = [
      [0, 0],
      [0.1, -0.1],
      [10, 10],
      [9.9, 10.2],
    ];
    const res = kmeans({ X, k: 2, seed: 123, maxIter: 50 });
    expect(res.assignments.length).toBe(4);
    expect(res.centers.length).toBe(2);
  });

  it('runs PCA', () => {
    const X = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ];
    const res = pca({ X, components: 1 });
    expect(res.components.length).toBe(1);
    expect(res.explainedVarianceRatio[0]!).toBeGreaterThan(0.95);
  });

  it('detects zscore anomalies', () => {
    const res = zscoreAnomalies([0, 0, 0, 0, 10], 2);
    expect(res.anomalies.length).toBeGreaterThan(0);
  });

  it('computes rolling stats', () => {
    const pts = rollingStats([1, 2, 3, 4, 5], 3);
    expect(pts.length).toBe(5);
    expect(pts[2]!.mean).toBeCloseTo(2, 6);
  });
});
