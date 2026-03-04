import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TerminalPanel } from '@/components/terminal/index.ts';
import { JsonPopover } from '@/components/JsonPopover.tsx';
import { safeStringify, truncate, downloadRowsCsv, copyRowsCsv } from '@/lib/helpers.ts';
import type { RunData } from '@/types/index.ts';

export function TimelineTab({
  data,
  onInspectAgent,
}: {
  data: RunData;
  onInspectAgent?: (agentId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [okFilter, setOkFilter] = useState<'any' | 'ok' | 'fail'>('any');

  const timelineRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const agentQ = agentFilter.trim().toLowerCase();
    return data.actions
      .map((a) => {
        const tick = Number((a as any).tick ?? 0);
        const agentId = String((a as any).agentId ?? '-');
        const actionName = String((a as any).action?.name ?? '-');
        const ok = (a as any).result?.ok === true;
        const info = safeStringify({ params: (a as any).action?.params, error: (a as any).result?.error, txHash: (a as any).result?.txHash });
        return { tick, agentId, actionName, ok, info };
      })
      .filter((r) => {
        if (agentQ && !r.agentId.toLowerCase().includes(agentQ)) return false;
        if (okFilter === 'ok' && !r.ok) return false;
        if (okFilter === 'fail' && r.ok) return false;
        if (q) {
          const hay = `${r.agentId} ${r.actionName} ${r.info}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [agentFilter, data, okFilter, query]);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: timelineRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 12,
  });

  return (
    <TerminalPanel
      title="Timeline"
      actions={
        <div className="flex items-center gap-1.5">
          <button onClick={() => void copyRowsCsv(timelineRows as Array<Record<string, unknown>>)} className="bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-[11px] text-foreground hover:bg-muted/80 cursor-pointer">Copy CSV</button>
          <button onClick={() => downloadRowsCsv('timeline.csv', timelineRows as Array<Record<string, unknown>>)} className="bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-[11px] text-foreground hover:bg-muted/80 cursor-pointer">Download CSV</button>
        </div>
      }
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <input value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} placeholder="agentId contains..." className="bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 w-44" />
        <select value={okFilter} onChange={(e) => setOkFilter(e.target.value as any)} className="bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-xs font-mono text-foreground">
          <option value="any">ok:any</option>
          <option value="ok">ok:true</option>
          <option value="fail">ok:false</option>
        </select>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search..." className="bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 w-44" />
        <span className="text-[11px] text-muted-foreground font-mono">{timelineRows.length} rows</span>
      </div>

      <div ref={parentRef} className="h-[520px] overflow-auto border border-border/40 rounded-sm bg-card/50">
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = timelineRows[v.index];
            if (!row) return null;
            return (
              <div
                key={v.key}
                className={`flex items-center gap-2 px-2 border-b border-border/20 font-mono text-xs ${row.ok ? 'hover:bg-terminal-green/5' : 'bg-terminal-red/5 hover:bg-terminal-red/10'}`}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: v.size, transform: `translateY(${v.start}px)` }}
              >
                <div className="w-14 shrink-0 text-muted-foreground text-right tabular-nums">{row.tick}</div>
                <div className="w-48 shrink-0 truncate">
                  {onInspectAgent ? (
                    <button onClick={() => onInspectAgent(row.agentId)} className="text-terminal-tab-active hover:underline cursor-pointer bg-transparent border-none p-0 font-mono text-xs">{row.agentId}</button>
                  ) : row.agentId}
                </div>
                <div className="w-40 shrink-0 truncate">{row.actionName}</div>
                <div className={`w-12 shrink-0 ${row.ok ? 'text-terminal-green' : 'text-terminal-red'}`}>{row.ok ? 'true' : 'false'}</div>
                <div className="flex-1 truncate text-muted-foreground text-[11px]">
                  <JsonPopover value={row.info}>{truncate(row.info, 260)}</JsonPopover>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TerminalPanel>
  );
}
