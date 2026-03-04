import { useMemo } from 'react';
import { TerminalPanel } from '@/components/terminal/index.ts';
import { safeStringify, truncate, downloadRowsCsv, copyRowsCsv } from '@/lib/helpers.ts';
import type { RunData } from '@/types/index.ts';

export function EvidenceTab({
  data,
  onInspectAgent,
}: {
  data: RunData;
  onInspectAgent?: (agentId: string) => void;
}) {
  const evidenceRows = useMemo(() => {
    const fromEvidence = data.evidence && Array.isArray(data.evidence.records) ? data.evidence.records : [];
    if (fromEvidence.length > 0) {
      return fromEvidence.map((r) => ({
        tick: Number(r.tick ?? 0),
        agentId: String(r.agentId ?? '-'),
        actionName: String(r.actionName ?? '-'),
        exploitId: typeof r.exploitId === 'string' ? r.exploitId : '-',
        txHash: typeof r.txHash === 'string' ? r.txHash : '',
        evidence: safeStringify(r.evidence ?? {}),
      }));
    }
    const rows: Array<{ tick: number; agentId: string; actionName: string; exploitId: string; txHash: string; evidence: string }> = [];
    for (const a of data.actions) {
      const result = (a as any).result;
      const evs = Array.isArray(result?.events) ? result.events : [];
      for (const ev of evs) {
        if (ev?.name !== 'ExploitEvidence') continue;
        rows.push({
          tick: Number((a as any).tick ?? 0),
          agentId: String((a as any).agentId ?? '-'),
          actionName: String((a as any).action?.name ?? '-'),
          exploitId: typeof ev.args?.exploitId === 'string' ? ev.args.exploitId : '-',
          txHash: typeof ev.args?.txHash === 'string' ? ev.args.txHash : typeof result?.txHash === 'string' ? result.txHash : '',
          evidence: safeStringify(ev.args ?? {}),
        });
      }
    }
    return rows.sort((x, y) => x.tick - y.tick);
  }, [data]);

  return (
    <TerminalPanel
      title="Exploit Evidence"
      subtitle="Post-condition checks from evidence.json; falls back to scanning actions.ndjson"
      actions={
        <div className="flex items-center gap-1.5">
          <button onClick={() => void copyRowsCsv(evidenceRows as Array<Record<string, unknown>>)} className="bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-[11px] text-foreground hover:bg-muted/80 cursor-pointer">Copy CSV</button>
          <button onClick={() => downloadRowsCsv('evidence.csv', evidenceRows as Array<Record<string, unknown>>)} className="bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-[11px] text-foreground hover:bg-muted/80 cursor-pointer">Download CSV</button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/60">
              {['Tick', 'Agent', 'Action', 'Exploit', 'TxHash', 'Evidence'].map((h) => (
                <th key={h} className="text-left text-[11px] text-muted-foreground py-1.5 px-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evidenceRows.slice(0, 500).map((r, idx) => (
              <tr key={idx} className="border-b border-border/30 hover:bg-muted/20">
                <td className="font-mono text-xs py-1.5 px-2 tabular-nums">{r.tick}</td>
                <td className="font-mono text-xs py-1.5 px-2">
                  {onInspectAgent ? (
                    <button onClick={() => onInspectAgent(r.agentId)} className="text-terminal-tab-active hover:underline cursor-pointer bg-transparent border-none p-0 font-mono text-xs">{r.agentId}</button>
                  ) : r.agentId}
                </td>
                <td className="font-mono text-xs py-1.5 px-2">{r.actionName}</td>
                <td className="font-mono text-xs py-1.5 px-2">{r.exploitId}</td>
                <td className="font-mono text-[11px] py-1.5 px-2 text-muted-foreground">{truncate(r.txHash, 18)}</td>
                <td className="font-mono text-[11px] py-1.5 px-2 text-muted-foreground max-w-[300px] truncate">{truncate(r.evidence, 200)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {evidenceRows.length === 0 && <div className="text-xs text-muted-foreground mt-2">No evidence records found.</div>}
    </TerminalPanel>
  );
}
