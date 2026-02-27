import { mean, sigmoid } from './utils.js';

export type LogisticFit = {
  intercept: number;
  coefficients: Record<string, number>;
  n: number;
  iters: number;
  loss: number;
  accuracy: number;
};

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i]! * b[i]!;
  return s;
}

export function fitLogisticRegression(options: {
  X: number[][];
  y: number[]; // 0/1
  featureNames: string[];
  maxIter: number;
  lr: number;
  l2: number;
}): LogisticFit {
  const { X, y, featureNames, maxIter, lr, l2 } = options;
  if (X.length !== y.length) throw new Error('X_y_length_mismatch');
  if (X.length === 0) throw new Error('empty_dataset');
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (p !== featureNames.length) throw new Error('feature_name_mismatch');

  let w0 = 0;
  const w = new Array<number>(p).fill(0);

  function lossAndAcc(): { loss: number; acc: number } {
    let loss = 0;
    let ok = 0;
    for (let i = 0; i < n; i += 1) {
      const z = w0 + dot(w, X[i]!);
      const p1 = sigmoid(z);
      const yi = y[i]!;
      // Cross entropy
      loss += -(yi * Math.log(Math.max(1e-12, p1)) + (1 - yi) * Math.log(Math.max(1e-12, 1 - p1)));
      const pred = p1 >= 0.5 ? 1 : 0;
      if (pred === (yi >= 0.5 ? 1 : 0)) ok += 1;
    }
    // L2 regularization (exclude intercept)
    if (l2 > 0) loss += l2 * mean(w.map((wi) => wi * wi));
    return { loss: loss / n, acc: ok / n };
  }

  let last = lossAndAcc();
  for (let iter = 0; iter < maxIter; iter += 1) {
    let g0 = 0;
    const g = new Array<number>(p).fill(0);
    for (let i = 0; i < n; i += 1) {
      const z = w0 + dot(w, X[i]!);
      const p1 = sigmoid(z);
      const err = p1 - y[i]!;
      g0 += err;
      for (let j = 0; j < p; j += 1) {
        const xij = X[i]?.[j] ?? 0;
        g[j] = (g[j] ?? 0) + err * xij;
      }
    }

    w0 -= (lr * g0) / n;
    for (let j = 0; j < p; j += 1) {
      const reg = l2 > 0 ? l2 * w[j]! : 0;
      const grad = (g[j] ?? 0) / n + reg;
      w[j] = (w[j] ?? 0) - lr * grad;
    }

    if (iter % 50 === 0 || iter === maxIter - 1) {
      last = lossAndAcc();
      if (last.loss < 1e-9) break;
    }
  }

  const coefficients: Record<string, number> = {};
  for (let j = 0; j < featureNames.length; j += 1) coefficients[featureNames[j]!] = w[j]!;
  return {
    intercept: w0,
    coefficients,
    n,
    iters: maxIter,
    loss: last.loss,
    accuracy: last.acc,
  };
}
