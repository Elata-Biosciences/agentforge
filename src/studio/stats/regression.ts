type Point = { x: number; y: number };

export type LinearRegressionResult = {
  n: number;
  slope: number;
  intercept: number;
  r2: number;
};

export function linearRegression(points: Point[]): LinearRegressionResult | null {
  const clean = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = clean.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const p of clean) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumXY += p.x * p.y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R^2
  const meanY = sumY / n;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of clean) {
    const yHat = slope * p.x + intercept;
    ssRes += (p.y - yHat) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { n, slope, intercept, r2 };
}
