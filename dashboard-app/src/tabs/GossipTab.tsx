import { TerminalPanel } from '@/components/terminal/index.ts';
import { JsonPopover } from '@/components/JsonPopover.tsx';
import { truncate, downloadRowsCsv, copyRowsCsv } from '@/lib/helpers.ts';
import type { RunData } from '@/types/index.ts';

export function GossipTab({
  data,
  studioEnabled,
  studioCurrentRunId,
  gossipRows,
  gossipOffset,
  gossipHasMore,
  gossipAgentNeedle,
  gossipChannelNeedle,
  gossipKind,
  inspectBusy,
  onSetAgentNeedle,
  onSetChannelNeedle,
  onSetKind,
  onRefresh,
  onOlder,
  onNewer,
  onInspectAgent,
  onInspectMemory,
}: {
  data: RunData;
  studioEnabled: boolean;
  studioCurrentRunId: string | null;
  gossipRows: Array<Record<string, unknown>>;
  gossipOffset: number;
  gossipHasMore: boolean;
  gossipAgentNeedle: string;
  gossipChannelNeedle: string;
  gossipKind: 'any' | 'gossip_post' | 'gossip_deliver';
  inspectBusy: boolean;
  onSetAgentNeedle: (v: string) => void;
  onSetChannelNeedle: (v: string) => void;
  onSetKind: (v: 'any' | 'gossip_post' | 'gossip_deliver') => void;
  onRefresh: () => void;
  onOlder: () => void;
  onNewer: () => void;
  onInspectAgent?: (agentId: string) => void;
  onInspectMemory?: (agentId: string) => void;
}) {
  const rows = studioEnabled && studioCurrentRunId ? gossipRows : (data.gossip ?? []).slice(-800);
  const btn = "bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-[11px] text-foreground hover:bg-muted/80 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
  const inp = "bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground/50";

  return (
    <TerminalPanel
      title="Gossip"
      subtitle="Agent-to-agent messages (posts + deliveries)"
      actions={
        <div className="flex items-center gap-1.5">
          <button onClick={() => void copyRowsCsv(rows as Array<Record<string, unknown>>)} className={btn}>Copy CSV</button>
          <button onClick={() => downloadRowsCsv('gossip.csv', rows as Array<Record<string, unknown>>)} className={btn}>Download CSV</button>
        </div>
      }
    >
      {studioEnabled && studioCurrentRunId ? (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <label className="text-[11px] text-muted-foreground">agent</label>
            <input value={gossipAgentNeedle} onChange={(e) => onSetAgentNeedle(e.target.value)} placeholder="agent id" className={`${inp} w-40`} />
            <label className="text-[11px] text-muted-foreground">channel</label>
            <input value={gossipChannelNeedle} onChange={(e) => onSetChannelNeedle(e.target.value)} placeholder="channel id" className={`${inp} w-36`} />
            <label className="text-[11px] text-muted-foreground">kind</label>
            <select value={gossipKind} onChange={(e) => onSetKind(e.target.value as any)} className={inp}>
              <option value="any">any</option>
              <option value="gossip_post">gossip_post</option>
              <option value="gossip_deliver">gossip_deliver</option>
            </select>
            <button disabled={inspectBusy} onClick={onRefresh} className={btn}>Refresh</button>
            <button disabled={inspectBusy || gossipOffset <= 0} onClick={onOlder} className={btn}>Older</button>
            <button disabled={inspectBusy || !gossipHasMore} onClick={onNewer} className={btn}>Newer</button>
            <span className="text-[11px] text-muted-foreground font-mono">off:{gossipOffset} rows:{gossipRows.length} {gossipHasMore ? 'hasMore' : 'end'}</span>
          </div>
        </>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/60">
              {['Tick', 'Kind', 'Channel', 'Author', 'Recipient', 'Text'].map((h) => (
                <th key={h} className="text-left text-[11px] text-muted-foreground py-1.5 px-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 400).map((r: any, i) => {
              const author = String(r?.message?.envelope?.authorAgentId ?? '');
              const chan = String(r?.message?.envelope?.channelId ?? '');
              const recip = String(r?.recipientAgentId ?? '');
              const text = String(r?.message?.payload?.text ?? '');
              return (
                <tr key={`${String(r?.messageId ?? '')}-${String(r?.kind ?? '')}-${i}`} className="border-b border-border/30 hover:bg-muted/20">
                  <td className="font-mono text-xs py-1.5 px-2 tabular-nums">{String(r?.tick ?? '')}</td>
                  <td className="font-mono text-xs py-1.5 px-2">{String(r?.kind ?? '')}</td>
                  <td className="font-mono text-xs py-1.5 px-2">{chan || '-'}</td>
                  <td className="font-mono text-xs py-1.5 px-2">
                    {author && onInspectAgent ? (
                      <button onClick={() => onInspectAgent(author)} className="text-terminal-tab-active hover:underline cursor-pointer bg-transparent border-none p-0 font-mono text-xs">{author}</button>
                    ) : (author || '-')}
                  </td>
                  <td className="font-mono text-xs py-1.5 px-2">
                    {recip && onInspectMemory ? (
                      <button onClick={() => onInspectMemory(recip)} className="text-terminal-tab-active hover:underline cursor-pointer bg-transparent border-none p-0 font-mono text-xs">{recip}</button>
                    ) : (recip || '-')}
                  </td>
                  <td className="font-mono text-[11px] py-1.5 px-2 text-muted-foreground max-w-[300px]">
                    <JsonPopover value={text}>{truncate(text, 140)}</JsonPopover>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <div className="text-xs text-muted-foreground mt-2">No gossip rows found.</div>}
    </TerminalPanel>
  );
}
