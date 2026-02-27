import type { EvidenceBundleV1, MetricsSample, RecordedAction } from '../../core/report.js';
import type { Filter, QueryTable } from '../query/spec.js';
import { zscoreAnomalies } from './anomaly.js';
import { buildDatasetRows } from './dataset.js';
import { kmeans } from './kmeans.js';
import { fitLogisticRegression } from './logistic.js';
import { pca } from './pca.js';
import { fitLinearRegression, fitRidgeRegression } from './regression.js';
import type { MlRequest } from './spec.js';
import { rollingStats } from './timeseries.js';
import { asNumber, getField, rowsToCsv, sigmoid } from './utils.js';

function toNumericMatrix(rows: Record<string, unknown>[], fields: string[]): number[][] {
  const out: number[][] = [];
  for (const r of rows) {
    const row: number[] = [];
    let ok = true;
    for (const f of fields) {
      const n = asNumber(getField(r, f));
      if (n === null) {
        ok = false;
        break;
      }
      row.push(n);
    }
    if (ok) out.push(row);
  }
  return out;
}

function toNumericVector(rows: Record<string, unknown>[], field: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const n = asNumber(getField(r, field));
    if (n === null) continue;
    out.push(n);
  }
  return out;
}

type DatasetResult = {
  columns: Array<{ name: string; type: 'number' | 'string' | 'boolean' | 'json' | 'null' }>;
  rows: Array<Record<string, unknown>>;
};

type MlDatasetLookup = Record<
  string,
  { columns: Array<{ name: string; type: string }>; rows: Array<Record<string, unknown>> }
>;

function inferColumns(rows: Array<Record<string, unknown>>): DatasetResult['columns'] {
  const names = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) names.add(k);
  const cols: DatasetResult['columns'] = [];
  for (const name of [...names]) {
    let t: DatasetResult['columns'][number]['type'] = 'null';
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

function toDataset(rows: Array<Record<string, unknown>>): DatasetResult {
  return { rows, columns: inferColumns(rows) };
}

function buildXYPoints(args: {
  rows: Array<Record<string, unknown>>;
  assignments?: number[];
  xFields: string[];
}): { points: DatasetResult; centers?: DatasetResult } {
  const { rows, assignments, xFields } = args;
  const x0 = xFields[0] ?? 'x0';
  const x1 = xFields[1] ?? xFields[0] ?? 'x1';
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    const x = asNumber(getField(r, x0));
    const y = asNumber(getField(r, x1));
    if (x === null || y === null) continue;
    const rowOut: Record<string, unknown> = { index: i, x, y };
    for (const f of xFields) rowOut[f] = getField(r, f);
    if (assignments) rowOut.cluster = assignments[i] ?? 0;
    out.push(rowOut);
  }
  return { points: toDataset(out) };
}

function buildCoefficientsDataset(
  coefficients: Record<string, number>,
  intercept: number
): DatasetResult {
  const rows: Array<Record<string, unknown>> = [
    { feature: '(intercept)', value: intercept },
    ...Object.entries(coefficients).map(([feature, value]) => ({ feature, value })),
  ];
  return toDataset(rows);
}

export async function runMlRequest(
  req: MlRequest,
  data: {
    metrics: MetricsSample[];
    actions: RecordedAction[];
    evidence: EvidenceBundleV1 | null;
  },
  datasets?: MlDatasetLookup
): Promise<any> {
  const filters: Filter[] | undefined = req.filters;
  const table: QueryTable | undefined = req.table;
  const datasetRef = req.dataset;
  const limit = req.limit;

  function passesFilters(row: Record<string, unknown>, fs: Filter[]): boolean {
    for (const f of fs) {
      const lhs = getField(row, f.field);
      const rhs = f.value;
      if (f.op === 'eq' && lhs !== rhs) return false;
      if (f.op === 'neq' && lhs === rhs) return false;
      if (f.op === 'contains') {
        const l = String(lhs ?? '').toLowerCase();
        const r = String(rhs ?? '').toLowerCase();
        if (!l.includes(r)) return false;
      }
      if (f.op === 'gt' || f.op === 'gte' || f.op === 'lt' || f.op === 'lte') {
        const ln = asNumber(lhs);
        const rn = asNumber(rhs);
        if (ln === null || rn === null) return false;
        if (f.op === 'gt' && !(ln > rn)) return false;
        if (f.op === 'gte' && !(ln >= rn)) return false;
        if (f.op === 'lt' && !(ln < rn)) return false;
        if (f.op === 'lte' && !(ln <= rn)) return false;
      }
    }
    return true;
  }

  function ds(select: string[]) {
    if (datasetRef) {
      const src = datasets?.[datasetRef];
      if (!src) throw new Error(`missing_dataset:${datasetRef}`);
      const rowsIn = src.rows ?? [];
      const filtered = filters ? rowsIn.filter((r) => passesFilters(r, filters)) : rowsIn;
      const projectedRows = filtered.map((r) => {
        const out: Record<string, unknown> = {};
        for (const f of select) out[f] = getField(r, f);
        return out;
      });
      const lim =
        limit !== undefined
          ? Math.max(1, Math.min(limit, projectedRows.length))
          : projectedRows.length;
      return toDataset(projectedRows.slice(0, lim));
    }
    if (!table) throw new Error('missing_table_or_dataset');
    return buildDatasetRows({
      table,
      select,
      data,
      ...(filters ? { filters } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  }

  if (req.kind === 'dataset') {
    const out = ds(req.select);
    return { ok: true, kind: req.kind, ...out, datasets: { dataset: out } };
  }

  if (req.kind === 'export_csv') {
    const out = ds(req.select);
    const csvColumns = (out.columns as any[]).map((c) =>
      typeof c === 'string' ? c : String(c?.name ?? '')
    );
    return {
      ok: true,
      kind: req.kind,
      filename: req.filename ?? 'dataset.csv',
      csv: rowsToCsv(out.rows, csvColumns),
      datasets: { dataset: out },
    };
  }

  if (req.kind === 'linear_regression') {
    const out = ds([...req.x, req.y]);
    const X = toNumericMatrix(out.rows, req.x);
    const y = toNumericVector(out.rows, req.y).slice(0, X.length);
    let fit:
      | ReturnType<typeof fitLinearRegression>
      | (ReturnType<typeof fitRidgeRegression> & { warning?: string });
    try {
      fit = fitLinearRegression(X, y, req.x);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Collinearity is common on short runs; fall back to a tiny ridge penalty.
      fit = {
        ...fitRidgeRegression(X, y, req.x, 1e-6),
        warning: `linear_regression_fallback_to_ridge:${message}`,
      };
    }
    const coeffs = buildCoefficientsDataset(fit.coefficients, fit.intercept);
    const preds: Array<Record<string, unknown>> = [];
    const predsLong: Array<Record<string, unknown>> = [];
    for (let i = 0; i < X.length; i += 1) {
      const xi = X[i]!;
      let yHat = fit.intercept;
      for (let j = 0; j < req.x.length; j += 1) {
        const name = req.x[j]!;
        yHat += (fit.coefficients[name] ?? 0) * (xi[j] ?? 0);
      }
      preds.push({ index: i, y: y[i] ?? null, yHat });
      predsLong.push({ index: i, series: 'y', value: y[i] ?? null });
      predsLong.push({ index: i, series: 'yHat', value: yHat });
    }
    return {
      ok: true,
      kind: req.kind,
      fit,
      datasets: {
        coefficients: coeffs,
        predictions: toDataset(preds),
        predictions_long: toDataset(predsLong),
      },
    };
  }

  if (req.kind === 'ridge_regression') {
    const out = ds([...req.x, req.y]);
    const X = toNumericMatrix(out.rows, req.x);
    const y = toNumericVector(out.rows, req.y).slice(0, X.length);
    const fit = fitRidgeRegression(X, y, req.x, req.lambda);
    const coeffs = buildCoefficientsDataset(fit.coefficients, fit.intercept);
    const preds: Array<Record<string, unknown>> = [];
    const predsLong: Array<Record<string, unknown>> = [];
    for (let i = 0; i < X.length; i += 1) {
      const xi = X[i]!;
      let yHat = fit.intercept;
      for (let j = 0; j < req.x.length; j += 1) {
        const name = req.x[j]!;
        yHat += (fit.coefficients[name] ?? 0) * (xi[j] ?? 0);
      }
      preds.push({ index: i, y: y[i] ?? null, yHat });
      predsLong.push({ index: i, series: 'y', value: y[i] ?? null });
      predsLong.push({ index: i, series: 'yHat', value: yHat });
    }
    return {
      ok: true,
      kind: req.kind,
      fit,
      datasets: {
        coefficients: coeffs,
        predictions: toDataset(preds),
        predictions_long: toDataset(predsLong),
      },
    };
  }

  if (req.kind === 'logistic_regression') {
    const out = ds([...req.x, req.y]);
    const X = toNumericMatrix(out.rows, req.x);
    const yRaw = toNumericVector(out.rows, req.y).slice(0, X.length);
    const y = yRaw.map((v) => (v >= 0.5 ? 1 : 0));
    const fit = fitLogisticRegression({
      X,
      y,
      featureNames: req.x,
      maxIter: req.maxIter,
      lr: req.lr,
      l2: req.l2,
    });
    const coeffs = buildCoefficientsDataset(fit.coefficients, fit.intercept);
    const preds: Array<Record<string, unknown>> = [];
    const predsLong: Array<Record<string, unknown>> = [];
    for (let i = 0; i < X.length; i += 1) {
      const xi = X[i]!;
      let z = fit.intercept;
      for (let j = 0; j < req.x.length; j += 1) {
        const name = req.x[j]!;
        z += (fit.coefficients[name] ?? 0) * (xi[j] ?? 0);
      }
      const p1 = sigmoid(z);
      preds.push({ index: i, y: y[i] ?? null, p1 });
      predsLong.push({ index: i, series: 'y', value: y[i] ?? null });
      predsLong.push({ index: i, series: 'p1', value: p1 });
    }
    return {
      ok: true,
      kind: req.kind,
      fit,
      datasets: {
        coefficients: coeffs,
        predictions: toDataset(preds),
        predictions_long: toDataset(predsLong),
      },
    };
  }

  if (req.kind === 'kmeans') {
    const out = ds(req.x);
    const X = toNumericMatrix(out.rows, req.x);
    const res = kmeans({
      X,
      k: req.k,
      maxIter: req.maxIter,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    });
    const pts = buildXYPoints({
      rows: out.rows as any,
      assignments: res.assignments,
      xFields: req.x,
    });
    const centersRows: Array<Record<string, unknown>> = res.centers.map((c, cluster) => {
      const row: Record<string, unknown> = { cluster };
      for (let j = 0; j < req.x.length; j += 1) row[req.x[j]!] = c[j] ?? null;
      row.x = c[0] ?? null;
      row.y = c[1] ?? c[0] ?? null;
      return row;
    });
    return {
      ok: true,
      kind: req.kind,
      ...res,
      datasets: { points: pts.points, centers: toDataset(centersRows) },
    };
  }

  if (req.kind === 'pca') {
    const out = ds(req.x);
    const X = toNumericMatrix(out.rows, req.x);
    const res = pca({ X, ...(req.components !== undefined ? { components: req.components } : {}) });
    // Project rows onto the principal components to produce a chartable scatter dataset.
    const colMeans = new Array<number>(res.p).fill(0);
    for (const row of X) {
      for (let j = 0; j < res.p; j += 1) {
        colMeans[j] = (colMeans[j] ?? 0) + (row[j] ?? 0);
      }
    }
    for (let j = 0; j < res.p; j += 1) {
      colMeans[j] = (colMeans[j] ?? 0) / Math.max(1, X.length);
    }
    const pointsRows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < X.length; i += 1) {
      const row = X[i]!;
      const centered = row.map((v, j) => (v ?? 0) - (colMeans[j] ?? 0));
      const pc1 = res.components[0]
        ? res.components[0]!.reduce((a, c, j) => a + c * (centered[j] ?? 0), 0)
        : 0;
      const pc2 = res.components[1]
        ? res.components[1]!.reduce((a, c, j) => a + c * (centered[j] ?? 0), 0)
        : 0;
      pointsRows.push({ index: i, pc1, pc2 });
    }
    const varianceRows = res.explainedVarianceRatio.map((r, i) => ({
      component: i + 1,
      explainedVarianceRatio: r,
      explainedVariance: res.explainedVariance[i] ?? null,
    }));
    return {
      ok: true,
      kind: req.kind,
      ...res,
      datasets: { points: toDataset(pointsRows), variance: toDataset(varianceRows) },
    };
  }

  if (req.kind === 'anomaly_zscore') {
    const out = ds([req.field]);
    const values = toNumericVector(out.rows, req.field);
    const res = zscoreAnomalies(values, req.threshold);
    const seriesRows = values.map((value, index) => ({
      index,
      value,
      z: (value - res.mean) / (res.stddev || 1e-12),
    }));
    const anomaliesRows = res.anomalies.map((a) => ({ index: a.index, value: a.value, z: a.z }));
    return {
      ok: true,
      kind: req.kind,
      field: req.field,
      ...res,
      datasets: { points: toDataset(seriesRows), anomalies: toDataset(anomaliesRows) },
    };
  }

  if (req.kind === 'timeseries_rolling') {
    const out = ds([req.field]);
    const values = toNumericVector(out.rows, req.field);
    const points = rollingStats(values, req.window);
    const rows = points.map((p) => ({
      index: p.index,
      value: p.value,
      mean: p.mean,
      stddev: p.stddev,
      upper: p.mean + p.stddev,
      lower: p.mean - p.stddev,
    }));
    return {
      ok: true,
      kind: req.kind,
      field: req.field,
      window: req.window,
      points,
      datasets: { points: toDataset(rows) },
    };
  }

  return { ok: false, error: 'unsupported_kind' };
}
