export type Row = Record<string, unknown>;

export function getField(row: Row, field: string): unknown {
  if (!field.includes('.')) return row[field];
  const parts = field.split('.').filter(Boolean);
  let curr: any = row;
  for (const p of parts) {
    if (curr === null || curr === undefined) return undefined;
    curr = curr[p];
  }
  return curr;
}

export function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'bigint') return Number(v);
  return null;
}

export function mean(xs: number[]): number {
  return xs.reduce((a, c) => a + c, 0) / Math.max(1, xs.length);
}

export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (xs.length - 1);
}

export function stddev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function sigmoid(x: number): number {
  // Avoid overflow.
  if (x > 30) return 1;
  if (x < -30) return 0;
  return 1 / (1 + Math.exp(-x));
}

export function toCsvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function rowsToCsv(rows: Row[], columns: string[]): string {
  const header = columns.join(',');
  const lines = [header];
  for (const r of rows) {
    lines.push(columns.map((c) => toCsvValue(r[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export class SmallRng {
  private state: number;
  constructor(seed: number) {
    this.state = seed | 0;
    if (this.state === 0) this.state = 123456789;
  }
  nextU32(): number {
    // xorshift32
    let x = this.state | 0;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.state = x | 0;
    return x >>> 0;
  }
  nextFloat(): number {
    return this.nextU32() / 0xffffffff;
  }
  pickInt(maxExclusive: number): number {
    return Math.floor(this.nextFloat() * Math.max(1, maxExclusive));
  }
}
