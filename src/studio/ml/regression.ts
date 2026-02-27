import { Matrix, inverse } from 'ml-matrix';
import { mean } from './utils.js';

export type RegressionFit = {
  intercept: number;
  coefficients: Record<string, number>;
  r2: number;
  mse: number;
  n: number;
};

function r2Score(y: number[], yHat: number[]): number {
  const yBar = mean(y);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < y.length; i += 1) {
    const e = y[i]! - yHat[i]!;
    ssRes += e * e;
    const d = y[i]! - yBar;
    ssTot += d * d;
  }
  if (ssTot === 0) return 1;
  return 1 - ssRes / ssTot;
}

export function fitLinearRegression(
  X: number[][],
  y: number[],
  featureNames: string[]
): RegressionFit {
  if (X.length !== y.length) throw new Error('X_y_length_mismatch');
  if (X.length === 0) throw new Error('empty_dataset');
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (p !== featureNames.length) throw new Error('feature_name_mismatch');

  // Add intercept column of ones.
  const Xb = new Matrix(n, p + 1);
  for (let i = 0; i < n; i += 1) {
    Xb.set(i, 0, 1);
    for (let j = 0; j < p; j += 1) Xb.set(i, j + 1, X[i]![j]!);
  }
  const yM = Matrix.columnVector(y);
  const Xt = Xb.transpose();
  const beta = inverse(Xt.mmul(Xb)).mmul(Xt).mmul(yM);

  const yHat = Xb.mmul(beta).to1DArray();
  const mse = mean(yHat.map((yh, i) => (y[i]! - yh) ** 2));
  const r2 = r2Score(y, yHat);

  const intercept = beta.get(0, 0);
  const coefficients: Record<string, number> = {};
  for (let j = 0; j < featureNames.length; j += 1) {
    coefficients[featureNames[j]!] = beta.get(j + 1, 0);
  }
  return { intercept, coefficients, r2, mse, n };
}

export function fitRidgeRegression(
  X: number[][],
  y: number[],
  featureNames: string[],
  lambda: number
): RegressionFit {
  if (X.length !== y.length) throw new Error('X_y_length_mismatch');
  if (X.length === 0) throw new Error('empty_dataset');
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (p !== featureNames.length) throw new Error('feature_name_mismatch');

  const Xb = new Matrix(n, p + 1);
  for (let i = 0; i < n; i += 1) {
    Xb.set(i, 0, 1);
    for (let j = 0; j < p; j += 1) Xb.set(i, j + 1, X[i]![j]!);
  }
  const yM = Matrix.columnVector(y);
  const Xt = Xb.transpose();
  const XtX = Xt.mmul(Xb);

  // Ridge penalty (do not penalize intercept).
  const I = Matrix.eye(p + 1, p + 1);
  I.set(0, 0, 0);
  const beta = inverse(XtX.add(I.mul(lambda)))
    .mmul(Xt)
    .mmul(yM);

  const yHat = Xb.mmul(beta).to1DArray();
  const mse = mean(yHat.map((yh, i) => (y[i]! - yh) ** 2));
  const r2 = r2Score(y, yHat);

  const intercept = beta.get(0, 0);
  const coefficients: Record<string, number> = {};
  for (let j = 0; j < featureNames.length; j += 1) {
    coefficients[featureNames[j]!] = beta.get(j + 1, 0);
  }
  return { intercept, coefficients, r2, mse, n };
}
