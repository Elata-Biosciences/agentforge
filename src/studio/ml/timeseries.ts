import { mean, stddev } from './utils.js';

export type RollingPoint = {
  index: number;
  value: number;
  mean: number;
  stddev: number;
};

export function rollingStats(values: number[], window: number): RollingPoint[] {
  const out: RollingPoint[] = [];
  const w = Math.max(2, Math.floor(window));
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - w + 1);
    const slice = values.slice(start, i + 1);
    out.push({ index: i, value: values[i]!, mean: mean(slice), stddev: stddev(slice) });
  }
  return out;
}
