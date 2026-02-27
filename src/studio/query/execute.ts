import type { EvidenceBundleV1, MetricsSample, RecordedAction } from '../../core/report.js';
import type { QueryRequest, QuerySpecV1 } from './spec.js';

type Row = Record<string, unknown>;

function getField(row: Row, field: string): unknown {
  if (!field.includes('.')) return row[field];
  const parts = field.split('.').filter(Boolean);
  let curr: any = row;
  for (const p of parts) {
    if (curr === null || curr === undefined) return undefined;
    curr = curr[p];
  }
  return curr;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'bigint') return Number(v);
  return null;
}

function applyFilters(rows: Row[], spec: QuerySpecV1): Row[] {
  const filters = spec.filters ?? [];
  if (filters.length === 0) return rows;
  return rows.filter((r) => {
    for (const f of filters) {
      const v = getField(r, f.field);
      if (f.op === 'contains') {
        const s = String(v ?? '').toLowerCase();
        const q = String(f.value ?? '').toLowerCase();
        if (!s.includes(q)) return false;
        continue;
      }
      const a = asNumber(v);
      const b = asNumber(f.value);
      if (a === null || b === null) {
        // Non-numeric compare falls back to string equality only.
        if (f.op === 'eq' && String(v) !== String(f.value)) return false;
        if (f.op === 'neq' && String(v) === String(f.value)) return false;
        continue;
      }
      if (f.op === 'eq' && a !== b) return false;
      if (f.op === 'neq' && a === b) return false;
      if (f.op === 'gt' && !(a > b)) return false;
      if (f.op === 'gte' && !(a >= b)) return false;
      if (f.op === 'lt' && !(a < b)) return false;
      if (f.op === 'lte' && !(a <= b)) return false;
    }
    return true;
  });
}

function applySelect(rows: Row[], spec: QuerySpecV1): Row[] {
  const sel = spec.select ?? [];
  if (sel.length === 0) return rows;
  return rows.map((r) => {
    const out: Row = {};
    for (const k of sel) out[k] = getField(r, k);
    return out;
  });
}

function aggregateGroup(rows: Row[], spec: QuerySpecV1): Row[] {
  const groupBy = spec.groupBy ?? [];
  const aggs = spec.aggregates ?? [];
  if (groupBy.length === 0 || aggs.length === 0) return rows;

  const buckets = new Map<string, { key: Row; rows: Row[] }>();
  for (const r of rows) {
    const key: Row = {};
    for (const k of groupBy) key[k] = getField(r, k);
    const hash = JSON.stringify(key);
    const b = buckets.get(hash) ?? { key, rows: [] };
    b.rows.push(r);
    buckets.set(hash, b);
  }

  const out: Row[] = [];
  for (const b of buckets.values()) {
    const row: Row = { ...b.key };
    for (const agg of aggs) {
      if (agg.op === 'count') {
        row[agg.as] = b.rows.length;
        continue;
      }
      const vals = b.rows
        .map((r) => asNumber(getField(r, String(agg.field ?? ''))))
        .filter((n): n is number => n !== null);
      if (vals.length === 0) {
        row[agg.as] = null;
        continue;
      }
      if (agg.op === 'sum') row[agg.as] = vals.reduce((a, c) => a + c, 0);
      if (agg.op === 'avg') row[agg.as] = vals.reduce((a, c) => a + c, 0) / vals.length;
      if (agg.op === 'min') row[agg.as] = Math.min(...vals);
      if (agg.op === 'max') row[agg.as] = Math.max(...vals);
    }
    out.push(row);
  }
  return out;
}

function applySortLimit(rows: Row[], spec: QuerySpecV1): Row[] {
  const sort = spec.sort;
  let out = rows;
  if (sort) {
    out = [...out].sort((a, b) => {
      const av = getField(a, sort.field);
      const bv = getField(b, sort.field);
      const an = asNumber(av);
      const bn = asNumber(bv);
      const cmp =
        an !== null && bn !== null ? an - bn : String(av ?? '').localeCompare(String(bv ?? ''));
      return sort.dir === 'desc' ? -cmp : cmp;
    });
  }
  if (spec.limit) {
    out = out.slice(0, spec.limit);
  }
  return out;
}

export type QueryResult = {
  rows: Row[];
  columns: Array<{ name: string; type: 'number' | 'string' | 'boolean' | 'json' | 'null' }>;
};

function inferColumns(rows: Row[]): QueryResult['columns'] {
  const names = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) names.add(k);
  const cols: QueryResult['columns'] = [];
  for (const name of [...names]) {
    let t: QueryResult['columns'][number]['type'] = 'null';
    for (const r of rows) {
      const v = r[name];
      if (v === null || v === undefined) continue;
      if (typeof v === 'number') {
        t = 'number';
        break;
      }
      if (typeof v === 'string') {
        t = 'string';
        break;
      }
      if (typeof v === 'boolean') {
        t = 'boolean';
        break;
      }
      t = 'json';
      break;
    }
    cols.push({ name, type: t });
  }
  cols.sort((a, b) => a.name.localeCompare(b.name));
  return cols;
}

export function executeQuery(
  req: QueryRequest,
  data: { metrics: MetricsSample[]; actions: RecordedAction[]; evidence: EvidenceBundleV1 | null }
): QueryResult {
  let rows: Row[] = [];
  if (req.table === 'metrics') rows = data.metrics as unknown as Row[];
  if (req.table === 'actions') rows = data.actions as unknown as Row[];
  if (req.table === 'evidence') rows = (data.evidence?.records ?? []) as unknown as Row[];

  const spec = req.spec;
  let out = rows;
  out = applyFilters(out, spec);
  out = aggregateGroup(out, spec);
  out = applySelect(out, spec);
  out = applySortLimit(out, spec);
  return { rows: out, columns: inferColumns(out) };
}
