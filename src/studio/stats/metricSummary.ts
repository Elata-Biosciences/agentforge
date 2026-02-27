export type MetricSummary = {
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
};

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  const t = idx - lo;
  return a + (b - a) * t;
}

export function summarize(values: number[]): MetricSummary | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const mean = sorted.reduce((a, c) => a + c, 0) / count;
  const p50 = percentileSorted(sorted, 0.5);
  const p95 = percentileSorted(sorted, 0.95);
  return { count, min, p50, p95, max, mean };
}
