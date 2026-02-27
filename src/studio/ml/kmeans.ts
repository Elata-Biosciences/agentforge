import { SmallRng, mean } from './utils.js';

export type KmeansResult = {
  k: number;
  centers: number[][];
  assignments: number[];
  inertia: number;
  iters: number;
};

function dist2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return s;
}

function argmin(xs: number[]): number {
  let best = 0;
  let bestV = xs[0] ?? Number.POSITIVE_INFINITY;
  for (let i = 1; i < xs.length; i += 1) {
    if (xs[i]! < bestV) {
      bestV = xs[i]!;
      best = i;
    }
  }
  return best;
}

export function kmeans(options: {
  X: number[][];
  k: number;
  seed?: number;
  maxIter: number;
}): KmeansResult {
  const { X, k, seed = 1337, maxIter } = options;
  if (X.length === 0) throw new Error('empty_dataset');
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (p === 0) throw new Error('empty_features');

  const rng = new SmallRng(seed);
  const centers: number[][] = [];
  // Simple deterministic init: pick k points without replacement.
  const used = new Set<number>();
  while (centers.length < k) {
    const idx = rng.pickInt(n);
    if (used.has(idx)) continue;
    used.add(idx);
    centers.push([...X[idx]!] as number[]);
  }

  const assignments = new Array<number>(n).fill(0);
  let inertia = Number.POSITIVE_INFINITY;

  for (let iter = 0; iter < maxIter; iter += 1) {
    let changed = 0;
    let nextInertia = 0;
    // Assign
    for (let i = 0; i < n; i += 1) {
      const dists = centers.map((c) => dist2(X[i]!, c));
      const a = argmin(dists);
      nextInertia += dists[a]!;
      if (assignments[i] !== a) {
        assignments[i] = a;
        changed += 1;
      }
    }

    // Recompute centers
    const buckets: number[][][] = new Array(k).fill(0).map(() => []);
    for (let i = 0; i < n; i += 1) buckets[assignments[i]!]!.push(X[i]!);
    for (let c = 0; c < k; c += 1) {
      const pts = buckets[c]!;
      if (pts.length === 0) continue;
      const nc: number[] = [];
      for (let j = 0; j < p; j += 1) nc.push(mean(pts.map((r) => r[j]!)));
      centers[c] = nc;
    }

    inertia = nextInertia;
    if (changed === 0) return { k, centers, assignments, inertia, iters: iter + 1 };
  }

  return { k, centers, assignments, inertia, iters: maxIter };
}
