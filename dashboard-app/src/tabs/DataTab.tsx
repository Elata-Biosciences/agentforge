import { DataGrid } from '@/DataGrid.tsx';
import type { RunData } from '@/types/index.ts';

export function DataTab({ data }: { data: RunData }) {
  return (
    <div className="space-y-3">
      <DataGrid title="Actions" rows={(data.actions ?? []) as any[]} />
      <DataGrid title="Metrics" rows={(data.metrics ?? []) as any[]} />
      <DataGrid title="Exploit Evidence" rows={(data.evidence?.records ?? []) as any[]} defaultLimit={10_000} />
    </div>
  );
}
