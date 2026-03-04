import { DataGrid } from '@/DataGrid.tsx';
import { EChartsDonut } from '@/components/charts/EChartsDonut.tsx';
import { EChartsXY } from '@/components/charts/EChartsXY.tsx';
import { EChartsBar } from '@/components/charts/EChartsBar.tsx';
import { EChartsHistogram } from '@/components/charts/EChartsHistogram.tsx';
import { MarkdownRenderer } from '@/components/MarkdownRenderer.tsx';
import { TerminalPanel } from '@/components/terminal/index.ts';
import { safeStringify, prettyJson } from '@/lib/helpers.ts';
import type { RunData } from '@/types/index.ts';

function toCsvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : safeStringify(v);
  if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function ReportTab({ data }: { data: RunData }) {
  if (!data.report) return null;
  const btn = "bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-[11px] text-foreground hover:bg-muted/80 cursor-pointer";

  return (
    <div className="space-y-3">
      <TerminalPanel title="Report" subtitle="Config-driven post-run dashboard blocks from scenario.studio.report">
        {data.report.error && <div className="text-xs text-terminal-red font-mono mb-2">report_error:{data.report.error}</div>}
      </TerminalPanel>

      {(data.report.blocks ?? []).map((b: any, idx: number) => {
        const kind = String(b?.kind ?? 'unknown');
        const title = String(b?.title ?? b?.id ?? b?.as ?? kind);

        if (kind === 'markdown') {
          return <TerminalPanel key={idx}><MarkdownRenderer content={String(b?.markdown ?? '')} /></TerminalPanel>;
        }

        if (kind === 'dataset' || kind === 'transform') {
          const as = String(b?.as ?? '');
          const ds = (data.report?.datasets ?? {})[as] ?? b?.result ?? null;
          return (
            <TerminalPanel key={idx} title={title} subtitle={`${kind}${as ? ` → ${as}` : ''}`}>
              {b?.error && <div className="text-xs text-terminal-red font-mono mb-2">{String(b.error)}</div>}
              <DataGrid title="Table" rows={(ds?.rows ?? []) as any[]} defaultLimit={50_000} />
            </TerminalPanel>
          );
        }

        if (kind === 'ml') {
          const as = String(b?.as ?? '');
          const res = (data.report?.ml ?? {})[as] ?? b?.result ?? null;
          const pj = prettyJson(res, 60_000);
          const datasets = res && typeof res === 'object' && (res as any).datasets && typeof (res as any).datasets === 'object' ? ((res as any).datasets as Record<string, any>) : null;

          return (
            <TerminalPanel key={idx} title={title} subtitle={`ml${as ? ` → ${as}` : ''}`}>
              {datasets ? (
                <div className="flex gap-2 flex-wrap mb-2">
                  {Object.keys(datasets).sort().slice(0, 50).map((k) => (
                    <div key={k} className="flex gap-1">
                      <button onClick={() => {
                        const ds = datasets[k];
                        const rows = Array.isArray(ds?.rows) ? (ds.rows as any[]) : [];
                        const cols = Array.isArray(ds?.columns) && ds.columns.length > 0 ? (ds.columns as any[]).map((c: any) => String(c?.name ?? '')).filter(Boolean) : Object.keys(rows[0] ?? {});
                        const lines = [cols.join(',')];
                        for (const r of rows.slice(0, 200_000)) lines.push(cols.map((c: string) => toCsvValue(r?.[c])).join(','));
                        const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = `${(as || title).replaceAll(/[^a-zA-Z0-9_-]/g, '_')}-${k}.csv`; a.click();
                        URL.revokeObjectURL(url);
                      }} className={btn}>Download {k}.csv</button>
                    </div>
                  ))}
                </div>
              ) : <div className="text-xs text-muted-foreground">Charts below visualize this ML output (if configured).</div>}
              <details className="mt-2">
                <summary className="text-xs text-muted-foreground cursor-pointer">Advanced: raw ML output</summary>
                <pre className="font-mono text-[11px] whitespace-pre-wrap mt-2 border border-border/60 rounded-sm p-2 bg-card/80 max-h-[300px] overflow-auto">{pj.text}{pj.truncated ? '\n... (truncated)' : ''}</pre>
              </details>
            </TerminalPanel>
          );
        }

        if (kind === 'chart') {
          const dsId = String(b?.dataset ?? '');
          const ds = (data.report?.datasets ?? {})[dsId] ?? null;
          const chartType = String(b?.chartType ?? 'line');
          const xField = String(b?.xField ?? 'tick');
          const yField = b?.yField ? String(b.yField) : '';
          const seriesField = b?.seriesField ? String(b.seriesField) : undefined;
          const xLabel = b?.xLabel ? String(b.xLabel) : xField;
          const yLabel = b?.yLabel ? String(b.yLabel) : (yField || 'value');
          const showLegend = typeof b?.showLegend === 'boolean' ? b.showLegend : undefined;
          const bins = typeof b?.bins === 'number' ? Number(b.bins) : undefined;

          return (
            <TerminalPanel key={idx} title={title} subtitle={`${chartType}${dsId ? ` from ${dsId}` : ''}`}>
              {!ds ? <div className="text-xs text-terminal-red font-mono">missing_dataset:{dsId}</div>
                : chartType === 'donut' ? <EChartsDonut rows={(ds.rows ?? []) as any[]} labelField={xField} valueField={yField || 'value'} />
                : chartType === 'bar' ? <EChartsBar rows={(ds.rows ?? []) as any[]} xField={xField} yField={yField || 'value'} xLabel={xLabel} yLabel={yLabel} />
                : chartType === 'histogram' ? <EChartsHistogram rows={(ds.rows ?? []) as any[]} valueField={xField} bins={bins} xLabel={xLabel} />
                : <EChartsXY rows={(ds.rows ?? []) as any[]} xField={xField} yField={yField || 'value'} seriesField={seriesField} seriesType={chartType === 'scatter' ? 'scatter' : 'line'} xLabel={xLabel} yLabel={yLabel} showLegend={showLegend} />}
            </TerminalPanel>
          );
        }

        if (kind === 'table') {
          const dsId = String(b?.dataset ?? '');
          const ds = (data.report?.datasets ?? {})[dsId] ?? null;
          const cols = Array.isArray(b?.columns) ? (b.columns as any[]).map(String) : null;
          const limit = typeof b?.limit === 'number' ? b.limit : 50_000;
          const rows = (ds?.rows ?? []) as any[];
          const sliced = cols ? rows.map((r: any) => { const out: any = {}; for (const c of cols) out[c] = r?.[c]; return out; }) : rows;
          return (
            <TerminalPanel key={idx} title={title} subtitle={`table${dsId ? ` from ${dsId}` : ''}`}>
              {!ds ? <div className="text-xs text-terminal-red font-mono">missing_dataset:{dsId}</div>
                : <DataGrid title="Table" rows={sliced} defaultLimit={limit} />}
            </TerminalPanel>
          );
        }

        return <TerminalPanel key={idx}><div className="text-xs text-terminal-red font-mono">unknown_block_kind:{kind}</div></TerminalPanel>;
      })}
    </div>
  );
}
