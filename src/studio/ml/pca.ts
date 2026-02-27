import { Matrix, SVD } from 'ml-matrix';
import { mean, variance } from './utils.js';

export type PcaResult = {
  n: number;
  p: number;
  components: number[][]; // rows: component vectors
  explainedVariance: number[];
  explainedVarianceRatio: number[];
};

export function pca(options: { X: number[][]; components?: number }): PcaResult {
  const { X, components } = options;
  if (X.length === 0) throw new Error('empty_dataset');
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (p === 0) throw new Error('empty_features');

  // Center columns.
  const colMeans = new Array<number>(p).fill(0).map((_, j) => mean(X.map((r) => r[j]!)));
  const centered = X.map((r) => r.map((v, j) => v - colMeans[j]!));
  const M = new Matrix(centered);

  // SVD: M = U S V^T, principal components are rows of V^T (or cols of V).
  const svd = new SVD(M, { autoTranspose: true });
  const V = svd.rightSingularVectors; // p x p
  const S = svd.diagonal; // singular values

  const ev = S.map((s) => (s * s) / Math.max(1, n - 1));
  const totalVar = ev.reduce((a, c) => a + c, 0) || 1;
  const ratio = ev.map((v) => v / totalVar);

  const k = Math.min(components ?? p, p);
  const comps: number[][] = [];
  for (let i = 0; i < k; i += 1) {
    // Component i is column i of V (length p).
    comps.push(V.getColumn(i));
  }

  // Sanity: explained variance should not exceed raw variance by much.
  // (Not used directly, but keeps behavior explicit.)
  const rawVar = new Array(p).fill(0).map((_, j) => variance(X.map((r) => r[j]!)));
  void rawVar;

  return {
    n,
    p,
    components: comps,
    explainedVariance: ev.slice(0, k),
    explainedVarianceRatio: ratio.slice(0, k),
  };
}
