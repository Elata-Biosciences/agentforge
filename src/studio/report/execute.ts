import type { EvidenceBundleV1, MetricsSample, RecordedAction } from '../../core/report.js';
import { runMlRequest } from '../ml/runMl.js';
import type { MlRequest } from '../ml/spec.js';
import { executeQuery } from '../query/execute.js';
import type { QuerySpecV1 } from '../query/spec.js';
import type { ReportConfigV1, TransformStep } from './spec.js';

type Row = Record<string, unknown>;

export type DatasetResult = {
  columns: Array<{ name: string; type: string }>;
  rows: Row[];
};

export type ReportRunOutputV1 = {
  v: 'v1';
  blocks: Array<Record<string, unknown>>;
  datasets: Record<string, DatasetResult>;
  ml: Record<string, unknown>;
};

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'bigint') return Number(v);
  return null;
}

function applyTransformSteps(input: DatasetResult, steps: TransformStep[]): DatasetResult {
  let curr: DatasetResult = { columns: [...input.columns], rows: [...input.rows] };
  for (const step of steps) {
    if (step.kind === 'select') {
      const keep = new Set(step.fields);
      curr = {
        columns: curr.columns.filter((c) => keep.has(c.name)),
        rows: curr.rows.map((r) => {
          const out: Row = {};
          for (const f of step.fields) out[f] = r[f];
          return out;
        }),
      };
      continue;
    }
    if (step.kind === 'derive') {
      const outRows = curr.rows.map((r) => {
        const v = r[step.field];
        let next: unknown = v;
        if (step.op === 'to_number') {
          next = asNumber(v);
        } else if (step.op === 'to_string') {
          next = String(v ?? '');
        } else if (step.op === 'abs') {
          const n = asNumber(v);
          next = n === null ? null : Math.abs(n);
        }
        return { ...r, [step.as]: next };
      });
      curr = {
        columns: [...curr.columns, { name: step.as, type: 'any' }],
        rows: outRows,
      };
    }
    if (step.kind === 'expr') {
      const outRows = curr.rows.map((r) => {
        const l = asNumber(r[step.left]);
        const rr = asNumber(r[step.right]);
        let next: number | null = null;
        if (l !== null && rr !== null) {
          if (step.op === 'ratio') next = rr === 0 ? null : l / rr;
          if (step.op === 'diff') next = l - rr;
          if (step.op === 'sum') next = l + rr;
          if (step.op === 'product') next = l * rr;
        }
        return { ...r, [step.as]: next };
      });
      curr = {
        columns: [...curr.columns, { name: step.as, type: 'any' }],
        rows: outRows,
      };
    }
    if (step.kind === 'rolling') {
      const outRows: Row[] = [];
      const win = Math.max(2, Math.floor(step.window));
      for (let i = 0; i < curr.rows.length; i += 1) {
        const slice = curr.rows.slice(Math.max(0, i - win + 1), i + 1);
        const nums = slice
          .map((r) => asNumber(r[step.field]))
          .filter((n): n is number => n !== null);
        let val: number | null = null;
        if (nums.length > 0) {
          if (step.op === 'sum') val = nums.reduce((a, c) => a + c, 0);
          if (step.op === 'mean') val = nums.reduce((a, c) => a + c, 0) / nums.length;
          if (step.op === 'min') val = Math.min(...nums);
          if (step.op === 'max') val = Math.max(...nums);
        }
        outRows.push({ ...curr.rows[i], [step.as]: val });
      }
      curr = {
        columns: [...curr.columns, { name: step.as, type: 'any' }],
        rows: outRows,
      };
    }
    if (step.kind === 'cumulative') {
      let runningSum = 0;
      let runningCount = 0;
      const outRows = curr.rows.map((r) => {
        const n = asNumber(r[step.field]);
        if (n !== null) {
          runningSum += n;
          runningCount += 1;
        }
        const next =
          step.op === 'mean' ? (runningCount > 0 ? runningSum / runningCount : null) : runningSum;
        return { ...r, [step.as]: runningCount > 0 ? next : null };
      });
      curr = {
        columns: [...curr.columns, { name: step.as, type: 'any' }],
        rows: outRows,
      };
      continue;
    }
    if (step.kind === 'bucket') {
      const outRows = curr.rows.map((r) => {
        const n = asNumber(r[step.field]);
        const bucket =
          n === null
            ? null
            : Math.floor(n / Math.max(step.size, Number.EPSILON)) *
              Math.max(step.size, Number.EPSILON);
        return { ...r, [step.as]: bucket };
      });
      curr = {
        columns: [...curr.columns, { name: step.as, type: 'any' }],
        rows: outRows,
      };
      continue;
    }
    if (step.kind === 'rank') {
      const indexed = curr.rows.map((r, i) => ({ i, v: asNumber(r[step.field]) }));
      indexed.sort((a, b) => {
        const av =
          a.v ?? (step.dir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
        const bv =
          b.v ?? (step.dir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
        return step.dir === 'asc' ? av - bv : bv - av;
      });
      const rankByIndex = new Map<number, number>();
      for (let rank = 0; rank < indexed.length; rank += 1) {
        rankByIndex.set(indexed[rank]!.i, rank + 1);
      }
      const outRows = curr.rows.map((r, i) => ({ ...r, [step.as]: rankByIndex.get(i) ?? null }));
      curr = {
        columns: [...curr.columns, { name: step.as, type: 'any' }],
        rows: outRows,
      };
    }
    // Exhaustive by zod, but keep a safety default.
  }
  return curr;
}

export async function executeReportConfig(args: {
  config: ReportConfigV1;
  runId: string;
  data: { metrics: MetricsSample[]; actions: RecordedAction[]; evidence: EvidenceBundleV1 | null };
}): Promise<ReportRunOutputV1> {
  const datasets: Record<string, DatasetResult> = {};
  const ml: Record<string, unknown> = {};
  const blocksOut: Array<Record<string, unknown>> = [];

  for (const b of args.config.blocks) {
    if (b.kind === 'markdown') {
      blocksOut.push(b);
      continue;
    }
    if (b.kind === 'dataset') {
      const req = { runId: args.runId, table: b.table, spec: b.spec as QuerySpecV1 };
      const res = executeQuery(req, args.data);
      const ds: DatasetResult = { columns: res.columns as any, rows: res.rows as any };
      datasets[b.as] = ds;
      blocksOut.push({ ...b, result: ds });
      continue;
    }
    if (b.kind === 'transform') {
      const src = datasets[b.from];
      if (!src) {
        blocksOut.push({ ...b, error: `missing_dataset:${b.from}` });
        continue;
      }
      const ds = applyTransformSteps(src, b.steps);
      datasets[b.as] = ds;
      blocksOut.push({ ...b, result: ds });
      continue;
    }
    if (b.kind === 'ml') {
      const req = { ...(b.request as MlRequest), runId: args.runId };
      const res = await runMlRequest(req, args.data, datasets);
      ml[b.as] = res;
      const resDatasets = (res as any)?.datasets;
      if (resDatasets && typeof resDatasets === 'object') {
        for (const [k, v] of Object.entries(resDatasets)) {
          if (!k) continue;
          if (!v || typeof v !== 'object') continue;
          datasets[`${b.as}.${k}`] = v as any;
        }
      }
      blocksOut.push({ ...b, result: res });
      continue;
    }
    if (b.kind === 'chart' || b.kind === 'table') {
      // Rendered by the UI; execution is just reference validation.
      blocksOut.push(b);
      continue;
    }
    const _exhaustive: never = b as never;
    void _exhaustive;
  }

  return { v: 'v1', blocks: blocksOut, datasets, ml };
}
