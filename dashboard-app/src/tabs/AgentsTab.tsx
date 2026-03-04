import { useMemo } from 'react';
import { TerminalPanel } from '@/components/terminal/index.ts';
import { downloadRowsCsv, copyRowsCsv } from '@/lib/helpers.ts';
import type { RunData } from '@/types/index.ts';

export function AgentsTab({
  data,
  onInspectAgent,
  onInspectMemory,
}: {
  data: RunData;
  onInspectAgent?: (agentId: string) => void;
  onInspectMemory?: (agentId: string) => void;
}) {
  const agents = useMemo(() => {
    const map = new Map<string, { agentId: string; agentType: string; actions: number; ok: number; fail: number; lastTick: number }>();
    for (const a of data.actions) {
      const agentId = String((a as any).agentId ?? '-');
      const agentType = String((a as any).agentType ?? '-');
      const tick = Number((a as any).tick ?? 0);
      const ok = (a as any).result?.ok === true;
      const curr = map.get(agentId) ?? { agentId, agentType, actions: 0, ok: 0, fail: 0, lastTick: -1 };
      map.set(agentId, { agentId, agentType, actions: curr.actions + 1, ok: curr.ok + (ok ? 1 : 0), fail: curr.fail + (ok ? 0 : 1), lastTick: Math.max(curr.lastTick, tick) });
    }
    return [...map.values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
  }, [data]);

  return (
    <TerminalPanel
      title="Agents"
      subtitle={`${agents.length} agents detected`}
      actions={
        <div className="flex items-center gap-1.5">
          <button onClick={() => void copyRowsCsv(agents as Array<Record<string, unknown>>)} className="bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-[11px] text-foreground hover:bg-muted/80 cursor-pointer">Copy CSV</button>
          <button onClick={() => downloadRowsCsv('agents.csv', agents as Array<Record<string, unknown>>)} className="bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-[11px] text-foreground hover:bg-muted/80 cursor-pointer">Download CSV</button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/60">
              {['Agent', 'Type', 'Actions', 'OK', 'Fail', 'Last Tick', ''].map((h) => (
                <th key={h} className="text-left text-[11px] text-muted-foreground py-1.5 px-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.agentId} className="border-b border-border/30 hover:bg-muted/20">
                <td className="font-mono text-xs py-1.5 px-2">
                  {onInspectAgent ? (
                    <button onClick={() => onInspectAgent(a.agentId)} className="text-terminal-tab-active hover:underline cursor-pointer bg-transparent border-none p-0 font-mono text-xs">{a.agentId}</button>
                  ) : a.agentId}
                </td>
                <td className="font-mono text-xs py-1.5 px-2 text-muted-foreground">{a.agentType}</td>
                <td className="font-mono text-xs py-1.5 px-2 text-right tabular-nums">{a.actions}</td>
                <td className="font-mono text-xs py-1.5 px-2 text-right tabular-nums text-terminal-green">{a.ok}</td>
                <td className="font-mono text-xs py-1.5 px-2 text-right tabular-nums text-terminal-red">{a.fail}</td>
                <td className="font-mono text-xs py-1.5 px-2 text-right tabular-nums">{a.lastTick}</td>
                <td className="py-1.5 px-2">
                  {(onInspectAgent || onInspectMemory) && (
                    <div className="flex gap-2">
                      {onInspectAgent && <button onClick={() => onInspectAgent(a.agentId)} className="text-[11px] text-terminal-tab-active hover:underline cursor-pointer bg-transparent border-none p-0">actions</button>}
                      {onInspectMemory && <button onClick={() => onInspectMemory(a.agentId)} className="text-[11px] text-terminal-tab-active hover:underline cursor-pointer bg-transparent border-none p-0">memory</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TerminalPanel>
  );
}
