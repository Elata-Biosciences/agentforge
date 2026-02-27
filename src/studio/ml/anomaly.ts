import { mean } from './utils.js';

export type ZscoreAnomaly = {
  index: number;
  value: number;
  z: number;
};

export function zscoreAnomalies(
  values: number[],
  threshold: number
): {
  mean: number;
  stddev: number;
  threshold: number;
  anomalies: ZscoreAnomaly[];
} {
  const m = mean(values);
  // Use population stddev for anomaly scoring; it's the more intuitive default when
  // "the dataset" is the full time-series being evaluated (vs an estimate).
  let popVar = 0;
  for (const v of values) popVar += (v - m) * (v - m);
  popVar /= Math.max(1, values.length);
  const s = Math.sqrt(popVar) || 1e-12;
  const anomalies: ZscoreAnomaly[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    const z = (v - m) / s;
    if (Math.abs(z) >= threshold) anomalies.push({ index: i, value: v, z });
  }
  return { mean: m, stddev: s, threshold, anomalies };
}
