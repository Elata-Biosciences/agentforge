import type { EvidenceBundleV1, MetricsSample, RecordedAction } from '../../core/report.js';
import { executeQuery } from '../query/execute.js';
import type { Filter, QueryTable } from '../query/spec.js';
import type { Row } from './utils.js';

export function buildDatasetRows(options: {
  table: QueryTable;
  select: string[];
  filters?: Filter[];
  limit?: number;
  data: { metrics: MetricsSample[]; actions: RecordedAction[]; evidence: EvidenceBundleV1 | null };
}): { rows: Row[]; columns: string[] } {
  const { table, select, filters, limit, data } = options;
  const res = executeQuery(
    {
      runId: 'x',
      table,
      spec: {
        v: 'v1',
        select,
        filters,
        limit,
      },
    },
    data
  );
  return { rows: res.rows as Row[], columns: select };
}
