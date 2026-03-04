import { useMemo, useState } from 'react';
import { TerminalPanel } from '@/components/terminal/index.ts';
import { LightweightLine } from '@/components/charts/LightweightLine.tsx';
import type { RunData } from '@/types/index.ts';

export function OverviewTab({ data }: { data: RunData }) {
  const metricKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const m of data.metrics ?? []) {
      for (const k of Object.keys(m)) {
        if (k === 'tick' || k === 'timestamp') continue;
        const v = (m as any)[k];
        if (typeof v === 'number') keys.add(k);
        if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) keys.add(k);
      }
    }
    return [...keys].sort();
  }, [data]);

  const [metricKey, setMetricKey] = useState<string>('');
  const effectiveKey = metricKey && metricKeys.includes(metricKey) ? metricKey : metricKeys[0] ?? 'tick';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TerminalPanel title="Run Summary">
          <table className="w-full">
            <tbody>
              {[
                ['Seed', data.summary.seed],
                ['Ticks', data.summary.ticks],
                ['Duration', `${data.summary.durationMs}ms`],
                ['Pack', data.config?.scenario?.packName ?? '-'],
                ['Mode', data.config?.scenario?.mode ?? '-'],
                ['Git', data.gitCommit ?? '-'],
              ].map(([label, value]) => (
                <tr key={String(label)} className="border-b border-border/40">
                  <th className="text-left text-xs text-muted-foreground py-1.5 pr-4 font-medium w-24">{label}</th>
                  <td className="font-mono text-xs py-1.5">{String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TerminalPanel>

        <TerminalPanel title="Final Metrics">
          <div className="max-h-[220px] overflow-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left text-xs text-muted-foreground py-1 font-medium">Metric</th>
                  <th className="text-right text-xs text-muted-foreground py-1 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.summary.finalMetrics ?? {}).slice(0, 32).map(([k, v]) => (
                  <tr key={k} className="border-b border-border/30 hover:bg-muted/30">
                    <td className="font-mono text-xs py-1">{k}</td>
                    <td className="font-mono text-xs py-1 text-right">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TerminalPanel>
      </div>

      {data.hashes && Object.keys(data.hashes).length > 0 && (
        <TerminalPanel title="Artifact Fingerprint" subtitle="Deterministic hashes for reproducibility">
          <div className="max-h-[140px] overflow-auto">
            <table className="w-full">
              <tbody>
                {Object.entries(data.hashes).slice(0, 16).map(([k, v]) => (
                  <tr key={k} className="border-b border-border/30">
                    <th className="text-left text-xs text-muted-foreground py-1 pr-4 font-medium w-40">{k}</th>
                    <td className="font-mono text-[11px] py-1 text-muted-foreground truncate">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TerminalPanel>
      )}

      <TerminalPanel title="Metrics" subtitle="Financial-style time series (zoom/pan)">
        <div className="flex items-center gap-2 mb-2">
          <select
            value={effectiveKey}
            onChange={(e) => setMetricKey(e.target.value)}
            className="bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-xs font-mono text-foreground"
          >
            {metricKeys.length === 0 && <option value="tick">tick</option>}
            {metricKeys.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">{metricKeys.length} series</span>
        </div>
        <LightweightLine metrics={data.metrics} metricKey={effectiveKey} height={360} />
      </TerminalPanel>
    </div>
  );
}
