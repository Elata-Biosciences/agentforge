import type { AssumptionPatch, SmokeDivergenceResult } from './types.js';

type Metrics = Record<string, number | bigint | string>;

export function applyAssumptionPatches<T extends Record<string, unknown>>(
  source: T,
  patches: AssumptionPatch[]
): T {
  const next = { ...source };
  for (const patch of patches) {
    next[patch.key as keyof T] = patch.value as T[keyof T];
  }
  return next;
}

export function computeDivergenceScore(
  baselineMetrics: Metrics,
  perturbedMetrics: Metrics
): number {
  let score = 0;
  const keys = new Set([...Object.keys(baselineMetrics), ...Object.keys(perturbedMetrics)]);
  for (const key of keys) {
    const a = numericValue(baselineMetrics[key]);
    const b = numericValue(perturbedMetrics[key]);
    if (a === null || b === null) {
      continue;
    }
    score += Math.abs(a - b);
  }
  return score;
}

export function createSmokeDivergenceResult(
  checkpointTick: number,
  perturbation: AssumptionPatch,
  baselineMetrics: Metrics,
  perturbedMetrics: Metrics
): SmokeDivergenceResult {
  return {
    checkpointTick,
    perturbation,
    divergenceScore: computeDivergenceScore(baselineMetrics, perturbedMetrics),
    baselineMetrics,
    perturbedMetrics,
  };
}

function numericValue(value: number | bigint | string | undefined): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
