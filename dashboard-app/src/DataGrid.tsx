import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { InfoTip } from './components/InfoTip.tsx';

type Row = Record<string, unknown>;

function asSortableString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function asSortableNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function inferColumns(rows: Row[], sampleN = 200): string[] {
  const names = new Set<string>();
  for (const r of rows.slice(0, sampleN)) for (const k of Object.keys(r)) names.add(k);
  // Put common fields first.
  const preferred = ['tick', 'timestamp', 'agentId', 'agentType', 'ok', 'action', 'result'];
  const rest = [...names].filter((k) => !preferred.includes(k)).sort((a, b) => a.localeCompare(b));
  return [...preferred.filter((k) => names.has(k)), ...rest];
}

function toCsvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : asSortableString(v);
  // Basic CSV escaping.
  if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function DataGrid({
  title,
  rows,
  defaultLimit = 50_000,
}: {
  title: string;
  rows: Row[];
  defaultLimit?: number;
}) {
  const allColumns = useMemo(() => inferColumns(rows), [rows]);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(defaultLimit);
  const [sortField, setSortField] = useState<string>('tick');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => allColumns.slice(0, 6));

  useEffect(() => {
    // When dataset changes, reset columns to a sane default.
    setVisibleColumns((prev) => (prev.length > 0 ? prev : allColumns.slice(0, 6)));
    if (!allColumns.includes(sortField)) {
      setSortField(allColumns.includes('tick') ? 'tick' : allColumns[0] ?? 'tick');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allColumns.join('|')]);

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (q) {
      const cols = visibleColumns.length > 0 ? visibleColumns : allColumns;
      out = out.filter((r) => {
        for (const k of cols) {
          const s = asSortableString(r[k]).toLowerCase();
          if (s.includes(q)) return true;
        }
        return false;
      });
    }
    if (sortField) {
      const dir = sortDir === 'desc' ? -1 : 1;
      out = [...out].sort((a, b) => {
        const av = a[sortField];
        const bv = b[sortField];
        const an = asSortableNumber(av);
        const bn = asSortableNumber(bv);
        if (an !== null && bn !== null) return dir * (an - bn);
        return dir * asSortableString(av).localeCompare(asSortableString(bv));
      });
    }
    if (limit > 0) out = out.slice(0, limit);
    return out;
  }, [allColumns, limit, query, rows, sortDir, sortField, visibleColumns]);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredSorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 16,
  });

  async function copyCsv(): Promise<void> {
    const cols = visibleColumns.length > 0 ? visibleColumns : allColumns;
    const lines = [cols.join(',')];
    for (const r of filteredSorted.slice(0, 20_000)) {
      lines.push(cols.map((k) => toCsvValue(r[k])).join(','));
    }
    const text = `${lines.join('\n')}\n`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // best-effort fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  function downloadCsv(): void {
    const cols = visibleColumns.length > 0 ? visibleColumns : allColumns;
    const lines = [cols.join(',')];
    for (const r of filteredSorted.slice(0, 50_000)) {
      lines.push(cols.map((k) => toCsvValue(r[k])).join(','));
    }
    const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cols = visibleColumns.length > 0 ? visibleColumns : allColumns;

  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="filters">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search (case-insensitive)"
          style={{ minWidth: 260 }}
        />
        <label className="muted">Limit</label>
        <input
          value={String(limit)}
          onChange={(e) => setLimit(Number(e.target.value) || defaultLimit)}
          style={{ width: 110 }}
        />
        <label className="muted">Sort</label>
        <InfoTip text="Pick a column and direction. Numeric values sort numerically; others sort lexicographically." />
        <select value={sortField} onChange={(e) => setSortField(e.target.value)}>
          {allColumns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={sortDir}
          onChange={(e) => setSortDir(e.target.value === 'asc' ? 'asc' : 'desc')}
        >
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>
        <button onClick={() => void copyCsv()}>Copy CSV</button>
        <button onClick={() => downloadCsv()}>Download CSV</button>
        <InfoTip text="CSV export includes visible columns and currently filtered/sorted rows." />
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        rows:{filteredSorted.length.toLocaleString()} cols:{cols.length.toLocaleString()}
      </div>
      <div className="dgLayout">
        <div className="dgControls">
          <div className="muted">
            Visible columns{' '}
            <InfoTip text="Choose which columns are shown in the table and included in CSV copy/download." />
          </div>
          <select
            multiple
            value={visibleColumns}
            onChange={(e) => {
              const next = [...e.target.selectedOptions].map((o) => o.value);
              setVisibleColumns(next);
            }}
            className="dgColumnsSelect"
          >
            {allColumns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="muted" style={{ marginTop: 6 }}>
            Tip: cmd/ctrl-click to multi-select.
          </div>
        </div>

        <div className="dgTablePanel">
          <div
            ref={parentRef}
            className="virtualList"
            style={{ height: 520, overflow: 'auto', whiteSpace: 'nowrap' }}
          >
            <div style={{ width: 'max-content', minWidth: '100%' }}>
              <div
                className="row dgStickyHeader"
              >
                {cols.map((c) => (
                  <div key={c} className="cell mono dgCell">
                    {c}
                  </div>
                ))}
              </div>
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((v) => {
                  const r = filteredSorted[v.index] ?? {};
                  return (
                    <div
                      key={v.key}
                      className="row"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        transform: `translateY(${v.start}px)`,
                      }}
                    >
                      {cols.map((c) => (
                        <div key={c} className="cell mono dgCell">
                          {asSortableString(r[c])}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

