import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as echarts from 'echarts';
import { ColorType, LineSeries, createChart } from 'lightweight-charts';
import { DataGrid } from './DataGrid.tsx';
import agentforgeLogoDark from '../../logo-dark.svg';
import agentforgeLogoLight from '../../logo-light.svg';
import { InfoTip } from './components/InfoTip.tsx';

type RunData = {
  summary: {
    runId: string;
    scenarioName: string;
    seed: number;
    ticks: number;
    durationMs: number;
    success: boolean;
    finalMetrics: Record<string, unknown>;
  };
  config: {
    scenario?: {
      packName?: string;
      mode?: string;
      agentCount?: number;
      agentTypes?: Array<{ type: string; count: number }>;
    };
  };
  metrics: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  gossip?: Array<Record<string, unknown>>;
  report?: {
    v: 'v1';
    error?: string;
    blocks?: Array<Record<string, unknown>>;
    datasets?: Record<string, { columns: Array<{ name: string; type: string }>; rows: any[] }>;
    ml?: Record<string, unknown>;
  };
  evidence: null | { version: string; records: Array<Record<string, unknown>> };
  hashes: Record<string, unknown>;
  gitCommit: string | null;
  meta?: { largeRunWarning?: string };
};

type StudioRunListItem = {
  id: string;
  scenarioName: string;
  runId: string;
  timestamp: string;
  success: boolean;
  seed: number;
  ticks: number;
  durationMs: number;
  hasDashboard: boolean;
};

type StudioScenarioListItem = {
  id: string;
  label: string;
  scenarioPath: string;
  relPath: string;
  group?: string;
  description?: string;
};

type StudioRun = {
  id: string;
  status: 'starting' | 'running' | 'finished' | 'failed' | 'stopped';
  startedAt: number;
  pid?: number;
  liveWsUrl?: string;
  outputDir?: string;
  exitCode?: number;
  error?: string;
};

type StudioAgentSummaryRow = {
  agentId: string;
  agentType: string;
  actions: number;
  ok: number;
  fail: number;
  lastTick: number;
  lastError?: string;
};

type StudioMemorySnapshotRow = {
  tick: number;
  timestamp: number;
  agentId: string;
  agentType: string;
  memory: unknown;
};

declare global {
  interface Window {
    __AF_DATA__?: RunData;
    __AF_DATA_URL__?: string;
  }
}

function parseStudioRunIdFromPathname(pathname: string): string | null {
  // /runs/<id>, /runs/<id>/, /runs/<id>/dashboard/*
  const m = /^\/runs\/([a-f0-9]{8,})(?:\/(?:dashboard(?:\/.*)?)?)?\/?$/.exec(pathname);
  if (!m) return null;
  return m[1] ?? null;
}

function parseStandaloneRunPageId(pathname: string): string | null {
  const m = /^\/runs\/([a-f0-9]{8,})\/?$/.exec(pathname);
  if (!m) return null;
  return m[1] ?? null;
}

function truncate(s: string, max = 140): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 3))}...`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function toCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : safeStringify(v);
  if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function rowsToCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const lines = [columns.join(',')];
  for (const r of rows) {
    lines.push(columns.map((c) => toCsvCell((r as any)?.[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replaceAll(/[^a-zA-Z0-9_.-]/g, '_');
  a.click();
  URL.revokeObjectURL(url);
}

function isBundledExampleScenario(s: StudioScenarioListItem): boolean {
  if (s.group === 'Bundled examples') return true;
  if (s.group === 'Workspace') return false;
  const rel = String(s.relPath ?? '');
  const abs = String(s.scenarioPath ?? '').replaceAll('\\', '/');
  return rel.startsWith('examples/') || abs.includes('/examples/');
}

function prettyJson(v: unknown, maxChars = 20_000): { text: string; truncated: boolean } {
  let text: string;
  try {
    text = JSON.stringify(v, null, 2);
  } catch {
    text = String(v);
  }
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n... (truncated)`, truncated: true };
}

function renderMarkdown(md: string): ReactElement {
  const lines = String(md ?? '').replaceAll('\r\n', '\n').split('\n');
  const out: ReactElement[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim().startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeBuf = [];
      } else {
        inCode = false;
        const code = codeBuf.join('\n');
        out.push(
          <pre
            key={`code-${i}`}
            className="mono"
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 10,
              background: 'color-mix(in oklab, var(--card) 85%, var(--bg))',
            }}
          >
            {code}
          </pre>
        );
        codeBuf = [];
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(<div key={`sp-${i}`} style={{ height: 8 }} />);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      out.push(
        <h3 key={`h3-${i}`} style={{ margin: '8px 0 6px 0' }}>
          {trimmed.slice(4)}
        </h3>
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      out.push(
        <h2 key={`h2-${i}`} style={{ margin: '8px 0 6px 0' }}>
          {trimmed.slice(3)}
        </h2>
      );
      continue;
    }
    if (trimmed.startsWith('# ')) {
      out.push(
        <div key={`h1-${i}`} style={{ fontSize: 16, fontWeight: 750, margin: '8px 0 6px 0' }}>
          {trimmed.slice(2)}
        </div>
      );
      continue;
    }
    if (trimmed.startsWith('- ')) {
      out.push(
        <div key={`li-${i}`} style={{ display: 'flex', gap: 8 }}>
          <div className="muted">-</div>
          <div>{trimmed.slice(2)}</div>
        </div>
      );
      continue;
    }
    out.push(
      <div key={`p-${i}`} style={{ fontSize: 12, color: 'var(--fg)' }}>
        {trimmed}
      </div>
    );
  }
  return <div>{out}</div>;
}

function App() {
  const preferredLight = useMemo(() => {
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches;
    } catch {
      return false;
    }
  }, []);
  const headerLogo = preferredLight ? agentforgeLogoLight : agentforgeLogoDark;

  const studioRunPageId = useMemo(() => {
    try {
      return parseStudioRunIdFromPathname(window.location.pathname);
    } catch {
      return null;
    }
  }, []);
  const standaloneRunPageId = useMemo(() => {
    try {
      return parseStandaloneRunPageId(window.location.pathname);
    } catch {
      return null;
    }
  }, []);
  const [data, setData] = useState<RunData | null>(null);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<
    | 'studio'
    | 'overview'
    | 'evidence'
    | 'timeline'
    | 'agents'
    | 'report'
    | 'gossip'
    | 'data'
    | 'tools'
  >('overview');
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [okFilter, setOkFilter] = useState<'any' | 'ok' | 'fail'>('any');
  const [metricKey, setMetricKey] = useState<string>('exploitsFound');

  // Per-run inspector pages should land on the report by default (when available).
  useEffect(() => {
    if (!studioRunPageId) return;
    if (!data) return;
    // Only override the initial default tab; don't fight the user if they've navigated elsewhere.
    if (tab !== 'overview' && tab !== 'report') return;
    if (data.report) {
      if (tab !== 'report') setTab('report');
      return;
    }
    if (tab !== 'overview') setTab('overview');
  }, [data, studioRunPageId, tab]);

  // We no longer render standalone /runs/<id> pages; keep status in Studio home only.
  useEffect(() => {
    if (!standaloneRunPageId) return;
    goAppHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standaloneRunPageId]);

  // Studio mode (served by `forge-sim studio`)
  const [studioEnabled, setStudioEnabled] = useState(false);
  const [studioHost, setStudioHost] = useState<string>('');
  const [studioRuns, setStudioRuns] = useState<StudioRunListItem[]>([]);
  const [studioScenarios, setStudioScenarios] = useState<StudioScenarioListItem[]>([]);
  const [studioWsConnected, setStudioWsConnected] = useState(false);
  const [studioActiveRuns, setStudioActiveRuns] = useState<StudioRun[]>([]);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [runArtifactsLoading, setRunArtifactsLoading] = useState(false);
  const [studioCurrentRunId, setStudioCurrentRunId] = useState<string | null>(null);
  const [studioInspectRunId, setStudioInspectRunId] = useState<string | null>(null);
  const [studioInspectAgents, setStudioInspectAgents] = useState<StudioAgentSummaryRow[]>([]);
  const [studioInspectAgentId, setStudioInspectAgentId] = useState<string>('');
  const [studioInspectView, setStudioInspectView] = useState<'actions' | 'memory'>('actions');
  const [studioInspectAgentTotal, setStudioInspectAgentTotal] = useState<number>(0);
  const [studioInspectOffset, setStudioInspectOffset] = useState<number>(0);
  const [studioInspectRows, setStudioInspectRows] = useState<Array<Record<string, unknown>>>([]);
  const [studioInspectPersonaFilter, setStudioInspectPersonaFilter] = useState('');
  const [studioInspectIntentFilter, setStudioInspectIntentFilter] = useState('');
  const [studioInspectLlmSourceFilter, setStudioInspectLlmSourceFilter] = useState('');
  const [studioInspectActionFamilyFilter, setStudioInspectActionFamilyFilter] = useState('');
  const [studioInspectMemoryOffset, setStudioInspectMemoryOffset] = useState<number>(0);
  const [studioInspectMemoryRows, setStudioInspectMemoryRows] = useState<StudioMemorySnapshotRow[]>(
    []
  );
  const [studioInspectMemoryHasMore, setStudioInspectMemoryHasMore] = useState<boolean>(false);
  const [studioInspectBusy, setStudioInspectBusy] = useState(false);
  const [studioInspectError, setStudioInspectError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [studioGossipOffset, setStudioGossipOffset] = useState(0);
  const [studioGossipRows, setStudioGossipRows] = useState<Array<Record<string, unknown>>>([]);
  const [studioGossipHasMore, setStudioGossipHasMore] = useState(false);
  const [studioGossipAgentNeedle, setStudioGossipAgentNeedle] = useState('');
  const [studioGossipChannelNeedle, setStudioGossipChannelNeedle] = useState('');
  const [studioGossipKind, setStudioGossipKind] = useState<
    'any' | 'gossip_post' | 'gossip_deliver'
  >('any');
  const [mlRunId, setMlRunId] = useState<string | null>(null);
  const [mlReqText, setMlReqText] = useState<string>('');
  const [mlRespText, setMlRespText] = useState<string>('');
  const [mlBusy, setMlBusy] = useState(false);
  const [runForm, setRunForm] = useState<{
    scenarioKind: 'toy' | 'example' | 'path';
    exampleScenarioId: string;
    scenarioPath: string;
    mode: 'deterministic' | 'exploration' | 'replay';
    seed: string;
    ticks: string;
    outDir: string;
  }>({
    scenarioKind: 'example',
    exampleScenarioId: '',
    scenarioPath: '',
    mode: 'deterministic',
    seed: '',
    ticks: '60',
    outDir: 'results',
  });

  const studioRunStatusCounts = useMemo(() => {
    let running = 0;
    let finished = 0;
    let failed = 0;
    for (const r of studioActiveRuns) {
      if (r.status === 'starting' || r.status === 'running') running += 1;
      else if (r.status === 'finished') finished += 1;
      else if (r.status === 'failed' || r.status === 'stopped') failed += 1;
    }
    return { running, finished, failed };
  }, [studioActiveRuns]);

  const activeRunForPage = useMemo(() => {
    if (!studioRunPageId) return null;
    return studioActiveRuns.find((r) => r.id === studioRunPageId) ?? null;
  }, [studioActiveRuns, studioRunPageId]);

  const catalogRunForPage = useMemo(() => {
    if (!studioRunPageId) return null;
    return studioRuns.find((r) => r.id === studioRunPageId) ?? null;
  }, [studioRuns, studioRunPageId]);

  const scenarioGroups = useMemo(() => {
    const examples: StudioScenarioListItem[] = [];
    const workspace: StudioScenarioListItem[] = [];
    for (const s of studioScenarios) {
      if (isBundledExampleScenario(s)) examples.push(s);
      else workspace.push(s);
    }
    return { examples, workspace };
  }, [studioScenarios]);

  function goAppHome(): void {
    // Always take the user back to the Studio control plane root.
    try {
      window.location.assign('/');
    } catch {
      // ignore
    }
  }

  async function loadAgentActionsPage(args: {
    runId: string;
    agentId: string;
    offset: number;
    totalActions: number;
  }): Promise<void> {
    if (!studioEnabled) return;
    setStudioInspectError(null);
    setStudioInspectBusy(true);
    try {
      const qs = new URLSearchParams();
      qs.set('agentId', args.agentId);
      qs.set('offset', String(args.offset));
      qs.set('limit', '200');
      if (studioInspectPersonaFilter.trim()) qs.set('personaId', studioInspectPersonaFilter.trim());
      if (studioInspectIntentFilter.trim()) qs.set('intentTag', studioInspectIntentFilter.trim());
      if (studioInspectLlmSourceFilter.trim()) qs.set('llmSource', studioInspectLlmSourceFilter.trim());
      if (studioInspectActionFamilyFilter.trim())
        qs.set('actionFamily', studioInspectActionFamilyFilter.trim());
      const resp = await fetch(
        `${studioHost}/api/runs/${args.runId}/actions?${qs.toString()}`
      );
      const payload = (await resp.json()) as { ok?: boolean; rows?: any[] };
      if (!payload.ok || !Array.isArray(payload.rows)) {
        throw new Error(payload && typeof (payload as any).error === 'string' ? (payload as any).error : 'failed_to_load_actions');
      }
      setStudioInspectAgentId(args.agentId);
      setStudioInspectAgentTotal(args.totalActions);
      setStudioInspectOffset(args.offset);
      setStudioInspectRows(payload.rows);
    } catch (err) {
      setStudioInspectError(err instanceof Error ? err.message : String(err));
    } finally {
      setStudioInspectBusy(false);
    }
  }

  async function loadAgentMemoryPage(args: {
    runId: string;
    agentId: string;
    offset: number;
  }): Promise<void> {
    if (!studioEnabled) return;
    setStudioInspectError(null);
    setStudioInspectBusy(true);
    try {
      const resp = await fetch(
        `${studioHost}/api/runs/${args.runId}/memory?agentId=${encodeURIComponent(args.agentId)}&offset=${args.offset}&limit=50`
      );
      const payload = (await resp.json()) as {
        ok?: boolean;
        rows?: StudioMemorySnapshotRow[];
        hasMore?: boolean;
      };
      if (!payload.ok || !Array.isArray(payload.rows)) {
        throw new Error(
          payload && typeof (payload as any).error === 'string'
            ? (payload as any).error
            : 'failed_to_load_memory'
        );
      }
      setStudioInspectAgentId(args.agentId);
      setStudioInspectMemoryOffset(args.offset);
      setStudioInspectMemoryRows(payload.rows);
      setStudioInspectMemoryHasMore(payload.hasMore === true);
    } catch (err) {
      setStudioInspectError(err instanceof Error ? err.message : String(err));
    } finally {
      setStudioInspectBusy(false);
    }
  }

  async function loadStudioGossipPage(args: { runId: string; offset: number }): Promise<void> {
    if (!studioEnabled) return;
    setStudioError(null);
    setStudioInspectError(null);
    setStudioInspectBusy(true);
    try {
      const qs = new URLSearchParams();
      qs.set('offset', String(Math.max(0, args.offset)));
      qs.set('limit', '200');
      if (studioGossipAgentNeedle.trim()) qs.set('agentId', studioGossipAgentNeedle.trim());
      if (studioGossipChannelNeedle.trim()) qs.set('channelId', studioGossipChannelNeedle.trim());
      if (studioGossipKind !== 'any') qs.set('kind', studioGossipKind);
      const resp = await fetch(`${studioHost}/api/runs/${args.runId}/gossip?${qs.toString()}`);
      const payload = (await resp.json()) as {
        ok?: boolean;
        rows?: Array<Record<string, unknown>>;
        hasMore?: boolean;
      };
      if (!payload.ok || !Array.isArray(payload.rows)) {
        throw new Error(
          payload && typeof (payload as any).error === 'string'
            ? (payload as any).error
            : 'failed_to_load_gossip'
        );
      }
      setStudioGossipOffset(args.offset);
      setStudioGossipRows(payload.rows);
      setStudioGossipHasMore(payload.hasMore === true);
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setStudioInspectBusy(false);
    }
  }

  async function loadAgentsForRun(runId: string): Promise<void> {
    if (!studioEnabled) return;
    setStudioInspectError(null);
    setStudioInspectBusy(true);
    setStudioInspectRunId(runId);
    setStudioInspectView('actions');
    try {
      const resp = await fetch(`${studioHost}/api/runs/${runId}/agents`);
      const payload = (await resp.json()) as { ok?: boolean; agents?: StudioAgentSummaryRow[] };
      if (!payload.ok || !Array.isArray(payload.agents)) {
        throw new Error(payload && typeof (payload as any).error === 'string' ? (payload as any).error : 'failed_to_load_agents');
      }
      setStudioInspectAgents(payload.agents);
      const first = payload.agents[0];
      if (!first) {
        setStudioInspectAgentId('');
        setStudioInspectAgentTotal(0);
        setStudioInspectOffset(0);
        setStudioInspectRows([]);
        setStudioInspectMemoryOffset(0);
        setStudioInspectMemoryRows([]);
        setStudioInspectMemoryHasMore(false);
        return;
      }
      setStudioInspectMemoryOffset(0);
      setStudioInspectMemoryRows([]);
      setStudioInspectMemoryHasMore(false);
      const offset = Math.max(0, first.actions - 200);
      await loadAgentActionsPage({
        runId,
        agentId: first.agentId,
        offset,
        totalActions: first.actions,
      });
    } catch (err) {
      setStudioInspectError(err instanceof Error ? err.message : String(err));
    } finally {
      setStudioInspectBusy(false);
    }
  }

  async function openInspectorForAgent(args: {
    runId: string;
    agentId: string;
    view?: 'actions' | 'memory';
  }): Promise<void> {
    if (!studioEnabled) return;
    setInspectorOpen(true);
    setStudioInspectError(null);
    setStudioInspectBusy(true);
    setStudioInspectRunId(args.runId);
    try {
      let agents = studioInspectAgents;
      if (studioInspectRunId !== args.runId || agents.length === 0) {
        const resp = await fetch(`${studioHost}/api/runs/${args.runId}/agents`);
        const payload = (await resp.json()) as { ok?: boolean; agents?: StudioAgentSummaryRow[] };
        if (!payload.ok || !Array.isArray(payload.agents)) {
          throw new Error(
            payload && typeof (payload as any).error === 'string'
              ? (payload as any).error
              : 'failed_to_load_agents'
          );
        }
        agents = payload.agents;
        setStudioInspectAgents(agents);
      }

      const row = agents.find((a) => a.agentId === args.agentId) ?? null;
      const total = row?.actions ?? 0;
      const view = args.view ?? 'actions';
      setStudioInspectView(view);
      if (view === 'memory') {
        await loadAgentMemoryPage({ runId: args.runId, agentId: args.agentId, offset: 0 });
      } else {
        const offset = Math.max(0, total - 200);
        await loadAgentActionsPage({
          runId: args.runId,
          agentId: args.agentId,
          offset,
          totalActions: total,
        });
      }
    } catch (err) {
      setStudioInspectError(err instanceof Error ? err.message : String(err));
    } finally {
      setStudioInspectBusy(false);
    }
  }

  useEffect(() => {
    const injected = window.__AF_DATA__;
    if (injected) {
      setData(injected);
      return;
    }
    const url = window.__AF_DATA_URL__;
    if (url) {
      (async () => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP_${resp.status}`);
          const payload = (await resp.json()) as RunData;
          setData(payload);
        } catch (err) {
          setDataLoadError(err instanceof Error ? err.message : String(err));
        }
      })();
      return;
    }
    setData(null);
  }, []);

  useEffect(() => {
    // Best-effort detect Studio server even on injected dashboards so the user can always
    // navigate back to the Studio home when served from `forge-sim studio`.
    const proto = String(window.location.protocol ?? '');
    if (proto !== 'http:' && proto !== 'https:') return;
    const base = `${proto}//${window.location.host}`;
    (async () => {
      try {
        const resp = await fetch(`${base}/api/health`);
        if (!resp.ok) return;
        setStudioEnabled(true);
        setStudioHost(base);
        // Only force Studio tab when we're actually on the Studio SPA (not an injected run dashboard).
        if (!window.__AF_DATA__ && !window.__AF_DATA_URL__ && !studioRunPageId) {
          setTab('studio');
        }
      } catch {
        // Not in Studio mode.
      }
    })();
  }, [studioRunPageId]);

  async function refreshStudioRuns(): Promise<StudioRunListItem[]> {
    if (!studioEnabled) return [];
    try {
      setStudioError(null);
      const resp = await fetch(`${studioHost}/api/runs`);
      const payload = (await resp.json()) as { runs?: StudioRunListItem[] };
      const list = Array.isArray(payload.runs) ? payload.runs : [];
      setStudioRuns(list);
      return list;
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  async function refreshStudioScenarios(): Promise<StudioScenarioListItem[]> {
    if (!studioEnabled) return [];
    try {
      const resp = await fetch(`${studioHost}/api/scenarios`);
      const payload = (await resp.json()) as { scenarios?: StudioScenarioListItem[] };
      const list = Array.isArray(payload.scenarios) ? payload.scenarios : [];
      setStudioScenarios(list);
      if (list.length > 0) {
        setRunForm((p) => {
          const first = list[0]!.id;
          const validSelection = p.exampleScenarioId && list.some((s) => s.id === p.exampleScenarioId);
          return {
            ...p,
            scenarioKind: p.scenarioKind === 'path' ? 'path' : 'example',
            exampleScenarioId: validSelection ? p.exampleScenarioId : first,
          };
        });
      }
      return list;
    } catch {
      return [];
    }
  }

  useEffect(() => {
    if (!studioEnabled) return;
    void refreshStudioRuns();
    void refreshStudioScenarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioEnabled, studioHost]);

  useEffect(() => {
    if (!studioEnabled) return;
    const fallback = studioCurrentRunId ?? studioRuns[0]?.id ?? null;
    setMlRunId((prev) => prev ?? fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioEnabled, studioCurrentRunId, studioRuns.length]);

  useEffect(() => {
    if (!studioEnabled) return;
    // Default template.
    if (!mlReqText) {
      const id = studioCurrentRunId ?? studioRuns[0]?.id ?? 'RUN_ID';
      setMlReqText(
        JSON.stringify(
          {
            kind: 'linear_regression',
            runId: id,
            table: 'metrics',
            x: ['tick'],
            y: 'totalVolume',
            limit: 2000,
          },
          null,
          2
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioEnabled]);

  async function runMl(): Promise<void> {
    if (!studioEnabled) return;
    if (!mlRunId) return;
    setMlBusy(true);
    setMlRespText('');
    try {
      const raw = JSON.parse(mlReqText || '{}');
      // Convenience: allow template to omit runId and use selected run.
      if (!raw.runId) raw.runId = mlRunId;
      const resp = await fetch(`${studioHost}/api/ml`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(raw),
      });
      const text = await resp.text();
      setMlRespText(text);
    } catch (err) {
      setMlRespText(`{"ok":false,"error":"${err instanceof Error ? err.message : String(err)}"}`);
    } finally {
      setMlBusy(false);
    }
  }

  useEffect(() => {
    if (!studioEnabled) return;
    if (!studioHost) return;

    const wsBase = studioHost.startsWith('https://')
      ? studioHost.replace('https://', 'wss://')
      : studioHost.replace('http://', 'ws://');
    const ws = new WebSocket(`${wsBase}/api/ws`);
    ws.addEventListener('open', () => setStudioWsConnected(true));
    ws.addEventListener('close', () => setStudioWsConnected(false));
    ws.addEventListener('message', (msg) => {
      try {
        const ev = JSON.parse(String((msg as any).data));
        const t = typeof ev?.type === 'string' ? ev.type : '';
        if (t === 'runs' && Array.isArray(ev?.payload)) {
          setStudioActiveRuns(ev.payload as StudioRun[]);
          return;
        }
        if (t === 'run_started' && ev?.payload?.id) {
          const r = ev.payload as StudioRun;
          setStudioActiveRuns((prev) => [r, ...prev.filter((x) => x.id !== r.id)].slice(0, 50));
          return;
        }
        if (t === 'run_status' && ev?.payload?.id) {
          const r = ev.payload as StudioRun;
          setStudioActiveRuns((prev) => [r, ...prev.filter((x) => x.id !== r.id)].slice(0, 50));
          return;
        }
      } catch {
        // ignore
      }
    });
    return () => ws.close();
  }, [studioEnabled, studioHost]);

  async function loadRunIntoDashboard(runId: string): Promise<void> {
    if (!studioHost) return;
    setRunArtifactsLoading(true);
    try {
      setStudioError(null);
      const resp = await fetch(`${studioHost}/api/runs/${runId}/artifacts`);
      const payload = (await resp.json()) as { ok?: boolean; data?: RunData; error?: string };
      if (!payload.ok || !payload.data) {
        throw new Error(payload.error ?? 'failed_to_load_run');
      }
      setData(payload.data);
      setStudioCurrentRunId(runId);
      setTab(payload.data.report ? 'report' : 'overview');
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunArtifactsLoading(false);
    }
  }

  useEffect(() => {
    if (!studioEnabled) return;
    if (!studioHost) return;
    if (!studioRunPageId) return;
    // Run pages should self-load the run + inspector context.
    void loadRunIntoDashboard(studioRunPageId);
    void loadAgentsForRun(studioRunPageId);
    void loadStudioGossipPage({ runId: studioRunPageId, offset: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioEnabled, studioHost, studioRunPageId]);

  useEffect(() => {
    if (!studioEnabled) return;
    if (!studioHost) return;
    if (!studioRunPageId) return;
    if (data) return;
    const isRunning = activeRunForPage?.status === 'starting' || activeRunForPage?.status === 'running';
    if (!isRunning && !studioError) return;
    const t = window.setTimeout(() => {
      void refreshStudioRuns();
      void loadRunIntoDashboard(studioRunPageId);
    }, 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioEnabled, studioHost, studioRunPageId, data, studioError, activeRunForPage?.status]);

  async function generateDashboard(runId: string): Promise<void> {
    try {
      setStudioError(null);
      const resp = await fetch(`${studioHost}/api/runs/${runId}/dashboard`, { method: 'POST' });
      const payload = (await resp.json().catch(() => null)) as any;
      if (!payload?.ok) {
        const msg = payload?.error ?? `HTTP_${resp.status}`;
        const tail = payload?.stderr ? `\n\nstderr:\n${String(payload.stderr).slice(-1200)}` : '';
        throw new Error(`${msg}${tail}`);
      }
      // It may take a moment; poll a few times so "Open dashboard" becomes clickable.
      await refreshStudioRuns();
      for (let i = 0; i < 6; i += 1) {
        // Backoff: ~0.3s, 0.6s, 0.9s...
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
        await refreshStudioRuns();
        if (studioRuns.some((r) => r.id === runId && r.hasDashboard)) break;
      }
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startRunFromStudio(): Promise<void> {
    try {
      setStudioError(null);
      const pickedExample =
        studioScenarios.find((s) => s.id === runForm.exampleScenarioId) ?? null;
      const scenarioPath =
        runForm.scenarioKind === 'path'
          ? runForm.scenarioPath.trim()
          : runForm.scenarioKind === 'example'
            ? (pickedExample?.scenarioPath ?? '')
            : '';
      const toy = runForm.scenarioKind === 'toy';
      if (!toy) {
        if (!scenarioPath) {
          setStudioError(
            runForm.scenarioKind === 'example' ? 'missing_example_scenario' : 'missing_scenario_path'
          );
          return;
        }
      }
      const body: any = {
        toy,
        scenarioPath: toy ? undefined : scenarioPath,
        mode: runForm.mode,
        outDir: runForm.outDir.trim() || 'results',
      };
      const seed = runForm.seed.trim();
      const ticks = runForm.ticks.trim();
      if (seed) body.seed = Number(seed);
      if (ticks) body.ticks = Number(ticks);
      const resp = await fetch(`${studioHost}/api/runs/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await resp.json()) as { ok?: boolean; error?: string };
      if (!payload.ok) throw new Error(payload.error ?? 'failed_to_start_run');
      await refreshStudioRuns();
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
    }
  }

  function toTabularRows(rows: Array<Record<string, unknown>>): { columns: string[]; rows: Array<Record<string, unknown>> } {
    const cols = new Set<string>();
    for (const r of rows.slice(0, 2000)) {
      for (const k of Object.keys(r)) cols.add(k);
    }
    return { columns: [...cols], rows };
  }

  function downloadRowsCsv(filename: string, rawRows: Array<Record<string, unknown>>): void {
    const table = toTabularRows(rawRows);
    if (table.columns.length === 0) return;
    const csv = rowsToCsv(table.rows, table.columns);
    downloadTextFile(filename, csv, 'text/csv;charset=utf-8');
  }

  async function copyRowsCsv(rawRows: Array<Record<string, unknown>>): Promise<void> {
    const table = toTabularRows(rawRows);
    if (table.columns.length === 0) return;
    await copyTextToClipboard(rowsToCsv(table.rows, table.columns));
  }

  const evidenceRows = useMemo(() => {
    if (!data) return [];

    const fromEvidence =
      data.evidence && Array.isArray(data.evidence.records) ? data.evidence.records : [];

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

    // Back-compat: scan action events for ExploitEvidence.
    const rows: Array<{
      tick: number;
      agentId: string;
      actionName: string;
      exploitId: string;
      txHash: string;
      evidence: string;
    }> = [];
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
          txHash:
            typeof ev.args?.txHash === 'string'
              ? ev.args.txHash
              : typeof result?.txHash === 'string'
                ? result.txHash
                : '',
          evidence: safeStringify(ev.args ?? {}),
        });
      }
    }
    return rows.sort((x, y) => x.tick - y.tick);
  }, [data]);

  const timelineRows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const agentQ = agentFilter.trim().toLowerCase();

    const rows = data.actions
      .map((a) => {
        const tick = Number((a as any).tick ?? 0);
        const agentId = String((a as any).agentId ?? '-');
        const actionName = String((a as any).action?.name ?? '-');
        const ok = (a as any).result?.ok === true;
        const info = safeStringify({
          params: (a as any).action?.params,
          error: (a as any).result?.error,
          txHash: (a as any).result?.txHash,
        });
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
    return rows;
  }, [agentFilter, data, okFilter, query]);

  const agents = useMemo(() => {
    if (!data) return [];
    const map = new Map<
      string,
      { agentId: string; agentType: string; actions: number; ok: number; fail: number; lastTick: number }
    >();
    for (const a of data.actions) {
      const agentId = String((a as any).agentId ?? '-');
      const agentType = String((a as any).agentType ?? '-');
      const tick = Number((a as any).tick ?? 0);
      const ok = (a as any).result?.ok === true;
      const curr =
        map.get(agentId) ??
        ({ agentId, agentType, actions: 0, ok: 0, fail: 0, lastTick: -1 } as const);
      map.set(agentId, {
        agentId,
        agentType,
        actions: curr.actions + 1,
        ok: curr.ok + (ok ? 1 : 0),
        fail: curr.fail + (ok ? 0 : 1),
        lastTick: Math.max(curr.lastTick, tick),
      });
    }
    return [...map.values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
  }, [data]);

  const metricKeys = useMemo(() => {
    if (!data) return [];
    const keys = new Set<string>();
    for (const m of data.metrics ?? []) {
      for (const k of Object.keys(m)) {
        if (k === 'tick' || k === 'timestamp') continue;
        // Only chart numeric-ish values.
        const v = (m as any)[k];
        if (typeof v === 'number') keys.add(k);
        if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) keys.add(k);
      }
    }
    const list = [...keys].sort();
    return list;
  }, [data]);

  type PanelType = 'line' | 'table' | 'donut';
  type DashPanel = {
    id: string;
    title: string;
    type: PanelType;
    table: 'metrics' | 'actions' | 'evidence';
    field: string; // x field (line), group field (donut), or a hint (table)
    valueField?: string;
    limit: number;
    selectText?: string; // comma-separated select fields (optional)
    filtersText?: string; // JSON array of filters (optional)
    autoRefresh?: boolean;
    refreshEveryMs?: number;
    result?: { columns: Array<{ name: string; type: string }>; rows: Array<Record<string, any>> };
    error?: string;
  };

  const [dashPanels, setDashPanels] = useState<DashPanel[]>([
    {
      id: 'p1',
      title: 'Exploit attempts over time',
      type: 'line',
      table: 'metrics',
      field: 'tick',
      valueField: 'exploitsFound',
      limit: 5000,
      autoRefresh: false,
      refreshEveryMs: 2000,
    },
    {
      id: 'p2',
      title: 'Actions (recent)',
      type: 'table',
      table: 'actions',
      field: 'agentId',
      limit: 200,
      autoRefresh: false,
      refreshEveryMs: 2000,
    },
    {
      id: 'p3',
      title: 'Action count by name',
      type: 'donut',
      table: 'actions',
      field: 'action',
      limit: 20,
      autoRefresh: false,
      refreshEveryMs: 2000,
    },
  ]);

  const dashPanelsRef = useRef<DashPanel[]>(dashPanels);
  const dashPanelInFlight = useRef<Set<string>>(new Set());
  useEffect(() => {
    dashPanelsRef.current = dashPanels;
  }, [dashPanels]);

  function addDashPanel(): void {
    const id = `p${Date.now().toString(36)}`;
    setDashPanels((prev) => [
      ...prev,
      {
        id,
        title: `Panel ${prev.length + 1}`,
        type: 'table',
        table: 'actions',
        field: 'tick',
        limit: 200,
        autoRefresh: false,
        refreshEveryMs: 2000,
      },
    ]);
  }

  function removeDashPanel(id: string): void {
    setDashPanels((prev) => prev.filter((p) => p.id !== id));
  }

  useEffect(() => {
    if (!studioEnabled || !studioCurrentRunId) return;
    (async () => {
      try {
        const resp = await fetch(`${studioHost}/api/runs/${studioCurrentRunId}/dashboards`);
        const payload = (await resp.json()) as { ok?: boolean; dashboards?: any };
        const panels = payload?.dashboards?.panels;
        if (Array.isArray(panels)) {
          // Best-effort shape match.
          setDashPanels(panels as DashPanel[]);
        }
      } catch {
        // ignore
      }
    })();
  }, [studioCurrentRunId, studioEnabled, studioHost]);

  async function saveDashboards(): Promise<void> {
    if (!studioEnabled || !studioCurrentRunId) return;
    try {
      setStudioError(null);
      await fetch(`${studioHost}/api/runs/${studioCurrentRunId}/dashboards`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 'v1', panels: dashPanels }),
      });
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
    }
  }

  const runPanel = useCallback(
    async (panelId: string): Promise<void> => {
      if (dashPanelInFlight.current.has(panelId)) return;
      dashPanelInFlight.current.add(panelId);
      setDashPanels((prev) =>
        prev.map((p) => (p.id === panelId ? { ...p, error: undefined } : p))
      );
      const p = dashPanelsRef.current.find((x) => x.id === panelId);
      if (!p) {
        dashPanelInFlight.current.delete(panelId);
        return;
      }

      try {
        if (!studioEnabled || !studioCurrentRunId) throw new Error('studio_run_not_selected');

        let parsedFilters: any[] | undefined;
        if (p.filtersText && p.filtersText.trim()) {
          try {
            const v = JSON.parse(p.filtersText);
            if (Array.isArray(v)) parsedFilters = v;
          } catch {
            throw new Error('filtersText_invalid_json');
          }
        }
        const parsedSelect =
          p.selectText && p.selectText.trim()
            ? p.selectText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined;

        let spec: any = { v: 'v1', limit: p.limit };
        if (p.type === 'line') {
          const y = (p.valueField ?? '').trim();
          if (!y) throw new Error('missing_valueField');
          spec = {
            v: 'v1',
            select: [p.field.trim() || 'tick', y],
            filters: parsedFilters,
            sort: { field: 'tick', dir: 'asc' },
            limit: p.limit,
          };
        } else if (p.type === 'table') {
          spec = {
            v: 'v1',
            select: parsedSelect,
            filters: parsedFilters,
            limit: p.limit,
            sort: { field: p.field.trim() || 'tick', dir: 'desc' },
          };
        } else if (p.type === 'donut') {
          const groupField = p.field.trim();
          if (!groupField) throw new Error('missing_groupBy_field');
          spec = {
            v: 'v1',
            filters: parsedFilters,
            groupBy: [groupField],
            aggregates: [{ as: 'count', op: 'count' }],
            sort: { field: 'count', dir: 'desc' },
            limit: p.limit,
          };
        }

        const resp = await fetch(`${studioHost}/api/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: studioCurrentRunId, table: p.table, spec }),
        });
        const payload = (await resp.json()) as any;
        if (!payload.ok) throw new Error(payload.error ?? 'query_failed');
        setDashPanels((prev) =>
          prev.map((x) =>
            x.id === panelId ? { ...x, result: payload.result, error: undefined } : x
          )
        );
      } catch (err) {
        setDashPanels((prev) =>
          prev.map((x) =>
            x.id === panelId
              ? { ...x, error: err instanceof Error ? err.message : String(err) }
              : x
          )
        );
      } finally {
        dashPanelInFlight.current.delete(panelId);
      }
    },
    [studioEnabled, studioCurrentRunId, studioHost]
  );

  const dashEnabled = studioEnabled && studioCurrentRunId !== null;
  const dashServerAvailable = studioEnabled && studioCurrentRunId !== null;
  const dashAutoKey = useMemo(() => {
    return dashPanels
      .map((p) => `${p.id}:${p.autoRefresh === true}:${p.refreshEveryMs ?? 0}`)
      .sort()
      .join('|');
  }, [dashPanels]);

  useEffect(() => {
    if (!dashEnabled) return;
    if (!dashAutoKey) return;
    const panels = dashPanelsRef.current.filter((p) => p.autoRefresh === true);
    if (panels.length === 0) return;
    const timers = panels.map((p) => {
      const ms = Math.max(500, Number(p.refreshEveryMs ?? 2000) || 2000);
      return window.setInterval(() => {
        void runPanel(p.id);
      }, ms);
    });
    return () => {
      for (const t of timers) window.clearInterval(t);
    };
  }, [dashEnabled, dashAutoKey, studioCurrentRunId, studioHost, runPanel]);

  const [regressionY, setRegressionY] = useState<string>('exploitsFound');
  const [regressionFit, setRegressionFit] = useState<
    null | { n: number; slope: number; intercept: number; r2: number }
  >(null);

  async function runRegression(): Promise<void> {
    if (!dashEnabled) return;
    try {
      setStudioError(null);
      const resp = await fetch(`${studioHost}/api/stats/regression`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: studioCurrentRunId,
          table: 'metrics',
          xField: 'tick',
          yField: regressionY,
        }),
      });
      const payload = (await resp.json()) as any;
      if (!payload.ok) throw new Error(payload.error ?? 'regression_failed');
      setRegressionFit(payload.fit ?? null);
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
    }
  }

  const [compareMetricKey, setCompareMetricKey] = useState<string>('exploitsFound');
  const [compareRunIds, setCompareRunIds] = useState<string[]>([]);
  const [compareRows, setCompareRows] = useState<any[] | null>(null);

  useEffect(() => {
    if (!dashEnabled) return;
    setCompareRunIds((prev) => (prev.length === 0 ? [studioCurrentRunId!] : prev));
  }, [dashEnabled, studioCurrentRunId]);

  async function runCompareMetric(): Promise<void> {
    if (!dashEnabled) return;
    try {
      setStudioError(null);
      const resp = await fetch(`${studioHost}/api/stats/metric-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runIds: compareRunIds, metricKey: compareMetricKey }),
      });
      const payload = (await resp.json()) as any;
      if (!payload.ok) throw new Error(payload.error ?? 'compare_failed');
      setCompareRows(Array.isArray(payload.rows) ? payload.rows : []);
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
    }
  }

  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: timelineRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });

  useEffect(() => {
    if (!data) return;
    if (metricKeys.length === 0) return;
    if (metricKeys.includes(metricKey)) return;
    setMetricKey(metricKeys[0] ?? 'exploitsFound');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, metricKey, metricKeys.join('|')]);

  if (tab === 'studio' && studioEnabled) {
    return (
      <div className="wrap">
        <div className="header">
          <a
            className="title"
            href="/"
            onClick={(e) => {
              // Keep it feeling like a standard dashboard icon/title in the top-left.
              // Use a hard navigation so the app always returns to Studio home cleanly.
              e.preventDefault();
              if (tab === 'studio') return; // already home
              goAppHome();
            }}
            style={{ cursor: tab === 'studio' ? 'default' : 'pointer' }}
          >
            <img
              src={headerLogo}
              alt="AgentForge"
              height={22}
              style={{ marginRight: 10, verticalAlign: 'text-bottom' }}
            />
          </a>
          <div className={`pill ${studioWsConnected ? 'good' : 'bad'} mono`}>
            ws:{studioWsConnected ? 'on' : 'off'}
          </div>
          <div className="pill mono">active:{studioActiveRuns.length}</div>
          <div className="pill mono">running:{studioRunStatusCounts.running}</div>
          <div className="pill mono">finished:{studioRunStatusCounts.finished}</div>
          <div className="pill mono">failed:{studioRunStatusCounts.failed}</div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>
              Active Runs{' '}
              <span className={`pill ${studioWsConnected ? 'good' : 'bad'} mono`}>
                ws:{studioWsConnected ? 'on' : 'off'}
              </span>
            </h3>
            <button onClick={() => void refreshStudioRuns()}>Refresh sessions</button>
          </div>
          <div className="muted" style={{ marginBottom: 8 }}>
            Memory snapshots appear in dashboard inspector only for runs with memory capture artifacts.
          </div>
          {studioActiveRuns.length === 0 ? (
            <div className="muted">No active runs (or none started via Studio).</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th>PID</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {studioActiveRuns
                  .slice()
                  .sort((a, b) => b.startedAt - a.startedAt)
                  .slice(0, 20)
                  .map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{new Date(r.startedAt).toLocaleTimeString()}</td>
                      <td className="mono">{r.status}</td>
                      <td className="mono">{typeof r.pid === 'number' ? r.pid : '-'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span className="muted mono">run:{r.id.slice(0, 12)}</span>
                          {r.outputDir ? null : (
                            <span className="muted">artifacts:pending</span>
                          )}
                          {r.error ? <span className="error mono">{truncate(r.error, 80)}</span> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>

        {studioError ? (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="error mono">{studioError}</div>
          </div>
        ) : null}

          <div className="card" style={{ marginTop: 12 }}>
            <h3>
              Start Run{' '}
              <InfoTip text="Custom report dashboards are defined in scenario.studio.report and validated when artifacts are loaded." />
            </h3>
            <div className="muted" style={{ marginTop: 6 }}>
              Discovered scenarios are listed first. Use custom path only for advanced/manual runs.
            </div>
            <div className="filters" style={{ paddingTop: 6 }}>
              <label className="muted">Scenario</label>
              <select
                value={runForm.scenarioKind}
                onChange={(e) =>
                  setRunForm((p) => ({ ...p, scenarioKind: e.target.value as any }))
                }
              >
                <option value="example">Discovered scenario</option>
                <option value="toy">Toy scenario (quick smoke)</option>
                <option value="path">Custom scenario path (advanced)</option>
              </select>
              <input
                value={studioInspectPersonaFilter}
                onChange={(e) => setStudioInspectPersonaFilter(e.target.value)}
                placeholder="persona id filter"
                style={{ minWidth: 140 }}
              />
              <input
                value={studioInspectIntentFilter}
                onChange={(e) => setStudioInspectIntentFilter(e.target.value)}
                placeholder="intent tag filter"
                style={{ minWidth: 140 }}
              />
              <input
                value={studioInspectLlmSourceFilter}
                onChange={(e) => setStudioInspectLlmSourceFilter(e.target.value)}
                placeholder="llm source filter"
                style={{ minWidth: 140 }}
              />
              <input
                value={studioInspectActionFamilyFilter}
                onChange={(e) => setStudioInspectActionFamilyFilter(e.target.value)}
                placeholder="action family filter"
                style={{ minWidth: 150 }}
              />
              <button
                disabled={studioInspectBusy || !studioInspectRunId}
                onClick={() => {
                  if (!studioInspectRunId) return;
                  const row = studioInspectAgents.find((a) => a.agentId === studioInspectAgentId);
                  const total = row?.actions ?? studioInspectAgentTotal;
                  const offset = Math.max(0, total - 200);
                  void loadAgentActionsPage({
                    runId: studioInspectRunId,
                    agentId: studioInspectAgentId,
                    offset,
                    totalActions: total,
                  });
                }}
              >
                Apply Filters
              </button>
              {runForm.scenarioKind === 'example' ? (
                <select
                  value={runForm.exampleScenarioId}
                  onChange={(e) =>
                    setRunForm((p) => ({ ...p, exampleScenarioId: e.target.value }))
                  }
                  style={{ minWidth: 360 }}
                >
                  {studioScenarios.length === 0 ? (
                    <option value="">(no scenarios found)</option>
                  ) : (
                    <>
                      {scenarioGroups.workspace.length > 0 ? (
                        <optgroup label="Workspace scenarios">
                          {scenarioGroups.workspace.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {scenarioGroups.examples.length > 0 ? (
                        <optgroup label="Bundled examples">
                          {scenarioGroups.examples.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </>
                  )}
                </select>
              ) : null}
              {runForm.scenarioKind === 'path' ? (
                <input
                  value={runForm.scenarioPath}
                  onChange={(e) => setRunForm((p) => ({ ...p, scenarioPath: e.target.value }))}
                  placeholder="examples/mechanism-experiments/timing-auction/scenario.ts"
                  style={{ minWidth: 320 }}
                />
              ) : null}
              <label className="muted">Mode</label>
              <select
                value={runForm.mode}
                onChange={(e) =>
                  setRunForm((p) => ({ ...p, mode: e.target.value as any }))
                }
              >
                <option value="deterministic">Deterministic baseline (seed reproducible, no live LLM)</option>
                <option value="exploration">Non-deterministic exploration (live LLM + gossip variation)</option>
                <option value="replay">Deterministic replay (re-run recorded behavior bundle)</option>
              </select>
              <label className="muted">Seed</label>
              <input
                value={runForm.seed}
                onChange={(e) => setRunForm((p) => ({ ...p, seed: e.target.value }))}
                placeholder="(optional)"
                style={{ width: 120 }}
              />
              <label className="muted">Ticks</label>
              <input
                value={runForm.ticks}
                onChange={(e) => setRunForm((p) => ({ ...p, ticks: e.target.value }))}
                style={{ width: 100 }}
              />
              <label className="muted">OutDir</label>
              <input
                value={runForm.outDir}
                onChange={(e) => setRunForm((p) => ({ ...p, outDir: e.target.value }))}
                style={{ minWidth: 220 }}
              />
              <button style={{ flexShrink: 0 }} onClick={() => void startRunFromStudio()}>
                Start
              </button>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              Deterministic mode is best for reproducible CI baselines. Exploration mode is for live
              provider behavior discovery. Replay mode deterministically validates a previously captured
              exploration bundle.
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>Sessions</h3>
              <button onClick={() => void refreshStudioRuns()}>Refresh</button>
            </div>
            <div className="muted" style={{ marginBottom: 8 }}>
              Workflow: click <span className="mono">Generate dashboard</span>, then{' '}
              <span className="mono">Open dashboard</span>.
            </div>
            {studioRuns.length === 0 ? (
              <div className="muted">No runs found in configured roots.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Scenario</th>
                    <th>Seed</th>
                    <th>Ticks</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {studioRuns.slice(0, 200).map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{new Date(r.timestamp).toLocaleString()}</td>
                      <td className="mono">{r.scenarioName}</td>
                      <td className="mono">{r.seed}</td>
                      <td className="mono">{r.ticks}</td>
                      <td>{r.success ? 'PASSED' : 'FAILED'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span className="muted mono">run:{r.id.slice(0, 12)}</span>
                          {r.hasDashboard ? (
                            <a
                              href={`/runs/${r.id}/dashboard/index.html`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open dashboard
                            </a>
                          ) : (
                            <span className="muted">Generate dashboard to open report + charts.</span>
                          )}
                          <button onClick={() => void generateDashboard(r.id)}>
                            Generate dashboard
                          </button>
                          <a
                            href={`${studioHost}/api/runs/${r.id}/file?path=summary.json`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            summary.json
                          </a>
                          <a
                            href={`${studioHost}/api/runs/${r.id}/file?path=actions.ndjson`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            actions.ndjson
                          </a>
                          <a
                            href={`${studioHost}/api/runs/${r.id}/file?path=metrics.csv`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            metrics.csv
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Agent Inspector is shown on dashboard run pages (/runs/<id>/dashboard/*). */}

      </div>
    );
  }

  if (!data) {
    let runPageState:
      | 'detecting_studio'
      | 'loading_run'
      | 'run_in_progress'
      | 'run_failed'
      | 'artifacts_not_ready'
      | 'no_data' = 'no_data';
    if (studioRunPageId) {
      if (!studioEnabled) runPageState = 'detecting_studio';
      else if (runArtifactsLoading) runPageState = 'loading_run';
      else if (activeRunForPage?.status === 'starting' || activeRunForPage?.status === 'running')
        runPageState = 'run_in_progress';
      else if (
        activeRunForPage?.status === 'failed' ||
        activeRunForPage?.status === 'stopped' ||
        activeRunForPage?.status === 'finished'
      )
        runPageState = 'run_failed';
      else runPageState = 'artifacts_not_ready';
    }
    return (
      <div className="wrap">
        <div className="header">
          {studioEnabled ? (
            <a
              className="title"
              href="/"
              onClick={(e) => {
                e.preventDefault();
                goAppHome();
              }}
              style={{ cursor: 'pointer' }}
            >
              <img
                src={headerLogo}
                alt="AgentForge"
                height={22}
                style={{ marginRight: 10, verticalAlign: 'text-bottom' }}
              />
              AgentForge Studio
            </a>
          ) : (
            <div className="title">AgentForge Dashboard</div>
          )}
        </div>
        <div className="card">
          {studioRunPageId ? (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 650 }}>Run</div>
                <div className="pill mono">{studioRunPageId}</div>
                {activeRunForPage ? <div className="pill mono">{activeRunForPage.status}</div> : null}
                {catalogRunForPage ? (
                  <div className={`pill ${catalogRunForPage.success ? 'good' : 'bad'}`}>
                    {catalogRunForPage.success ? 'PASSED' : 'FAILED'}
                  </div>
                ) : null}
              </div>
              <div style={{ height: 8 }} />
              {runPageState === 'detecting_studio' ? (
                <div className="muted">Connecting to Studio server...</div>
              ) : null}
              {runPageState === 'loading_run' ? (
                <div className="muted">Loading run artifacts...</div>
              ) : null}
              {runPageState === 'run_in_progress' ? (
                <div className="muted">
                  Run is still in progress. Results tabs will appear once artifacts are written.
                </div>
              ) : null}
              {runPageState === 'run_failed' ? (
                <div className="muted">
                  Run finished/failed but full artifacts are not available for this page.
                </div>
              ) : null}
              {runPageState === 'artifacts_not_ready' ? (
                <div className="muted">
                  Artifacts are not ready yet for this run.
                </div>
              ) : null}
              <div style={{ height: 10 }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => {
                    if (!studioRunPageId) return;
                    void refreshStudioRuns();
                    void loadRunIntoDashboard(studioRunPageId);
                  }}
                >
                  Refresh run status
                </button>
                <a href="/">Back to Studio home</a>
              </div>
            </>
          ) : (
            <div className="muted">No run data found.</div>
          )}
          {dataLoadError ? (
            <div className="error mono" style={{ marginTop: 10 }}>
              data_load_failed:{dataLoadError}
            </div>
          ) : null}
          {studioError ? (
            <div className="error mono" style={{ marginTop: 10 }}>
              run_load_error:{studioError}
            </div>
          ) : null}
          <div style={{ height: 10 }} />
          <div className="muted">
            Static dashboards inject <span className="mono">window.__AF_DATA__</span>. Large
            dashboards inject <span className="mono">window.__AF_DATA_URL__</span> and must be
            served (use <span className="mono">forge-sim serve &lt;runDir&gt;</span> or Studio).
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="header">
        {studioEnabled ? (
          <a
            className="title"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              goAppHome();
            }}
            style={{ cursor: 'pointer' }}
            title="Back to Studio home"
          >
              <img
                src={headerLogo}
                alt="AgentForge"
                height={22}
                style={{ marginRight: 10, verticalAlign: 'text-bottom' }}
              />
            AgentForge Studio <span className="mono">{data.summary.scenarioName}</span>
          </a>
        ) : (
          <div className="title">
            AgentForge Dashboard <span className="mono">{data.summary.scenarioName}</span>
          </div>
        )}
        <div className={`pill ${data.summary.success ? 'good' : 'bad'}`}>
          {data.summary.success ? 'PASSED' : 'FAILED'}
        </div>
        <div className="pill">{data.config?.scenario?.mode ?? 'mode:?'}</div>
        <div className="pill mono">{data.summary.runId}</div>
      </div>

      <div className="tabs">
        {data.report ? (
          <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>
            Report
          </button>
        ) : null}
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button className={tab === 'evidence' ? 'active' : ''} onClick={() => setTab('evidence')}>
          Exploit Evidence
        </button>
        <button className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>
          Timeline
        </button>
        <button className={tab === 'agents' ? 'active' : ''} onClick={() => setTab('agents')}>
          Agents
        </button>
        <button className={tab === 'gossip' ? 'active' : ''} onClick={() => setTab('gossip')}>
          Gossip
        </button>
        <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}>
          Data
        </button>
        {studioEnabled && dashEnabled ? (
          <button className={tab === 'tools' ? 'active' : ''} onClick={() => setTab('tools')}>
            Tools
          </button>
        ) : null}
      </div>

      {data.meta?.largeRunWarning ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="error mono">large_run:{data.meta.largeRunWarning}</div>
        </div>
      ) : null}

      {studioEnabled && inspectorOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 1000,
            padding: 18,
            overflow: 'auto',
          }}
          onClick={() => setInspectorOpen(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 1100, margin: '0 auto', padding: 14 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontWeight: 750 }}>
                Agent Inspector{' '}
                {studioInspectRunId ? <span className="mono">{studioInspectRunId}</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setInspectorOpen(false)}>Close</button>
              </div>
            </div>

            {studioInspectError ? (
              <div className="error mono" style={{ marginTop: 10 }}>
                {studioInspectError}
              </div>
            ) : null}

            {studioInspectRunId && studioCurrentRunId && studioInspectRunId !== studioCurrentRunId ? (
              <div className="muted" style={{ marginTop: 10 }}>
                This inspector is for a different run than the currently loaded artifacts.
              </div>
            ) : null}

            <div className="filters" style={{ paddingTop: 10 }}>
              <label className="muted">Agent</label>
              <select
                value={studioInspectAgentId}
                onChange={(e) => {
                  const id = e.target.value;
                  const row = studioInspectAgents.find((a) => a.agentId === id) ?? null;
                  const total = row?.actions ?? 0;
                  const offset = Math.max(0, total - 200);
                  if (!studioInspectRunId) return;
                  if (studioInspectView === 'memory') {
                    void loadAgentMemoryPage({ runId: studioInspectRunId, agentId: id, offset: 0 });
                  } else {
                    void loadAgentActionsPage({
                      runId: studioInspectRunId,
                      agentId: id,
                      offset,
                      totalActions: total,
                    });
                  }
                }}
                style={{ minWidth: 320 }}
              >
                {studioInspectAgents.length === 0 ? (
                  <option value="">(no agents)</option>
                ) : (
                  studioInspectAgents.map((a) => (
                    <option key={a.agentId} value={a.agentId}>
                      {a.agentType}:{a.agentId} ({a.actions} actions)
                    </option>
                  ))
                )}
              </select>

              <button
                disabled={studioInspectBusy}
                onClick={() => {
                  setStudioInspectView('actions');
                  const row = studioInspectAgents.find((a) => a.agentId === studioInspectAgentId);
                  const total = row?.actions ?? studioInspectAgentTotal;
                  const offset = Math.max(0, total - 200);
                  if (!studioInspectRunId) return;
                  void loadAgentActionsPage({
                    runId: studioInspectRunId,
                    agentId: studioInspectAgentId,
                    offset,
                    totalActions: total,
                  });
                }}
                style={{
                  background: studioInspectView === 'actions' ? '#222' : undefined,
                  color: studioInspectView === 'actions' ? '#fff' : undefined,
                }}
              >
                Activity
              </button>
              <button
                disabled={studioInspectBusy}
                onClick={() => {
                  setStudioInspectView('memory');
                  if (!studioInspectRunId) return;
                  void loadAgentMemoryPage({
                    runId: studioInspectRunId,
                    agentId: studioInspectAgentId,
                    offset: 0,
                  });
                }}
                style={{
                  background: studioInspectView === 'memory' ? '#222' : undefined,
                  color: studioInspectView === 'memory' ? '#fff' : undefined,
                }}
              >
                Memory
              </button>

              {studioInspectView === 'actions' ? (
                <>
                  <button
                    disabled={studioInspectBusy || studioInspectOffset <= 0}
                    onClick={() => {
                      if (!studioInspectRunId) return;
                      void loadAgentActionsPage({
                        runId: studioInspectRunId,
                        agentId: studioInspectAgentId,
                        offset: 0,
                        totalActions: studioInspectAgentTotal,
                      });
                    }}
                  >
                    Oldest
                  </button>
                  <button
                    disabled={studioInspectBusy}
                    onClick={() => {
                      const row = studioInspectAgents.find((a) => a.agentId === studioInspectAgentId);
                      const total = row?.actions ?? studioInspectAgentTotal;
                      const offset = Math.max(0, total - 200);
                      if (!studioInspectRunId) return;
                      void loadAgentActionsPage({
                        runId: studioInspectRunId,
                        agentId: studioInspectAgentId,
                        offset,
                        totalActions: total,
                      });
                    }}
                  >
                    Latest
                  </button>
                  <button
                    disabled={studioInspectBusy || studioInspectOffset <= 0}
                    onClick={() => {
                      const nextOffset = Math.max(0, studioInspectOffset - 200);
                      if (!studioInspectRunId) return;
                      void loadAgentActionsPage({
                        runId: studioInspectRunId,
                        agentId: studioInspectAgentId,
                        offset: nextOffset,
                        totalActions: studioInspectAgentTotal,
                      });
                    }}
                  >
                    Older
                  </button>
                  <button
                    disabled={
                      studioInspectBusy ||
                      studioInspectOffset + 200 >= Math.max(0, studioInspectAgentTotal)
                    }
                    onClick={() => {
                      const nextOffset = Math.min(
                        Math.max(0, studioInspectAgentTotal - 1),
                        studioInspectOffset + 200
                      );
                      if (!studioInspectRunId) return;
                      void loadAgentActionsPage({
                        runId: studioInspectRunId,
                        agentId: studioInspectAgentId,
                        offset: nextOffset,
                        totalActions: studioInspectAgentTotal,
                      });
                    }}
                  >
                    Newer
                  </button>
                </>
              ) : (
                <>
                  <button
                    disabled={studioInspectBusy || studioInspectMemoryOffset <= 0}
                    onClick={() => {
                      const nextOffset = Math.max(0, studioInspectMemoryOffset - 50);
                      if (!studioInspectRunId) return;
                      void loadAgentMemoryPage({
                        runId: studioInspectRunId,
                        agentId: studioInspectAgentId,
                        offset: nextOffset,
                      });
                    }}
                  >
                    Older
                  </button>
                  <button
                    disabled={studioInspectBusy || !studioInspectMemoryHasMore}
                    onClick={() => {
                      const nextOffset = studioInspectMemoryOffset + 50;
                      if (!studioInspectRunId) return;
                      void loadAgentMemoryPage({
                        runId: studioInspectRunId,
                        agentId: studioInspectAgentId,
                        offset: nextOffset,
                      });
                    }}
                  >
                    Newer
                  </button>
                </>
              )}

              {studioInspectView === 'actions' ? (
                <>
                  <button
                    onClick={() =>
                      downloadRowsCsv(
                        `inspector-actions-${studioInspectAgentId}.csv`,
                        studioInspectRows as Array<Record<string, unknown>>
                      )
                    }
                  >
                    Download page CSV
                  </button>
                  <button
                    onClick={() => void copyRowsCsv(studioInspectRows as Array<Record<string, unknown>>)}
                  >
                    Copy page CSV
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() =>
                      downloadRowsCsv(
                        `inspector-memory-${studioInspectAgentId}.csv`,
                        studioInspectMemoryRows as Array<Record<string, unknown>>
                      )
                    }
                  >
                    Download page CSV
                  </button>
                  <button
                    onClick={() =>
                      void copyRowsCsv(studioInspectMemoryRows as Array<Record<string, unknown>>)
                    }
                  >
                    Copy page CSV
                  </button>
                </>
              )}

              <div className="muted">
                {studioInspectView === 'actions' ? (
                  <>
                    offset:{studioInspectOffset} rows:{studioInspectRows.length} total:
                    {studioInspectAgentTotal}
                  </>
                ) : (
                  <>
                    offset:{studioInspectMemoryOffset} rows:{studioInspectMemoryRows.length}{' '}
                    {studioInspectMemoryHasMore ? 'hasMore' : 'end'}
                  </>
                )}
                {studioInspectBusy ? ' loading...' : ''}
              </div>
            </div>

            <div style={{ height: 10 }} />
            {studioInspectView === 'actions' ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tick</th>
                      <th>Action</th>
                      <th>Persona</th>
                      <th>Intent</th>
                      <th>Source</th>
                      <th>Rationale</th>
                      <th>OK</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studioInspectRows.slice(0, 400).map((r: any, i) => (
                      <tr key={String(r?.action?.id ?? '') + String(i)}>
                        <td className="mono">{String(r?.tick ?? '')}</td>
                        <td className="mono">{String(r?.action?.name ?? '-')}</td>
                        <td className="mono">{String(r?.action?.metadata?.personaId ?? '-')}</td>
                        <td className="mono">{String(r?.action?.metadata?.intentTag ?? '-')}</td>
                        <td className="mono">{String(r?.action?.metadata?.llmSource ?? '-')}</td>
                        <td className="mono">{truncate(String(r?.action?.metadata?.rationale ?? ''), 160)}</td>
                        <td className="mono">{String(r?.result?.ok ?? '')}</td>
                        <td className="mono">{truncate(String(r?.result?.error ?? ''), 140)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div>
                {studioInspectMemoryRows.length === 0 ? (
                  <div className="muted">
                    No memory snapshots for this run (capture-memory not present in artifacts).
                  </div>
                ) : (
                  studioInspectMemoryRows.slice(0, 200).map((r, i) => {
                    const pj = prettyJson(r.memory, 20_000);
                    return (
                      <details key={`${r.agentId}-${r.tick}-${i}`} style={{ marginBottom: 8 }}>
                        <summary className="mono">
                          tick:{r.tick} ts:{r.timestamp}
                        </summary>
                        <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                          {pj.text}
                          {pj.truncated ? '\n... (truncated)' : ''}
                        </pre>
                      </details>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === 'report' && data.report ? (
        <div className="card">
          <h2>
            Report{' '}
            <InfoTip text="Author blocks in scenario.studio.report. Flow: dataset -> transform -> ml -> chart/table." />
          </h2>
          {data.report.error ? (
            <div className="error mono">
              report_error:{data.report.error} (check scenario.studio.report schema)
            </div>
          ) : null}
          <div className="muted">
            Config-driven, post-run dashboard blocks defined in your scenario config.
          </div>
          <div style={{ height: 10 }} />

          <div className="studioReportBlock" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(data.report.blocks ?? []).map((b: any, idx: number) => {
              const kind = String(b?.kind ?? 'unknown');
              const title = String(b?.title ?? b?.id ?? b?.as ?? kind);

              if (kind === 'markdown') {
                return (
                  <div key={idx} className="card studioReportBlock" style={{ padding: 14 }}>
                    {renderMarkdown(String(b?.markdown ?? ''))}
                  </div>
                );
              }

              if (kind === 'dataset' || kind === 'transform') {
                const as = String(b?.as ?? '');
                const ds = (data.report?.datasets ?? {})[as] ?? b?.result ?? null;
                return (
                  <div key={idx} className="card studioReportBlock" style={{ padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontWeight: 750 }}>{title}</div>
                      <div className="pill muted">{kind}</div>
                      {as ? <div className="pill mono muted">{as}</div> : null}
                    </div>
                    {b?.error ? <div className="error mono">{String(b.error)}</div> : null}
                    <div style={{ height: 10 }} />
                    <DataGrid title="Table" rows={(ds?.rows ?? []) as any[]} defaultLimit={50_000} />
                  </div>
                );
              }

              if (kind === 'ml') {
                const as = String(b?.as ?? '');
                const res = (data.report?.ml ?? {})[as] ?? b?.result ?? null;
                const pj = prettyJson(res, 60_000);
                const datasets =
                  res && typeof res === 'object' && (res as any).datasets && typeof (res as any).datasets === 'object'
                    ? ((res as any).datasets as Record<string, any>)
                    : null;

                function toCsvValue(v: unknown): string {
                  if (v === null || v === undefined) return '';
                  const s = typeof v === 'string' ? v : safeStringify(v);
                  if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
                  return s;
                }

                function downloadDatasetCsv(label: string, ds: any): void {
                  try {
                    const rows = Array.isArray(ds?.rows) ? (ds.rows as any[]) : [];
                    const cols =
                      Array.isArray(ds?.columns) && ds.columns.length > 0
                        ? (ds.columns as any[]).map((c) => String(c?.name ?? '')).filter(Boolean)
                        : Object.keys(rows[0] ?? {});
                    const lines = [cols.join(',')];
                    for (const r of rows.slice(0, 200_000)) {
                      lines.push(cols.map((c) => toCsvValue(r?.[c])).join(','));
                    }
                    const blob = new Blob([`${lines.join('\n')}\n`], {
                      type: 'text/csv;charset=utf-8',
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${label.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch {
                    // ignore
                  }
                }
                async function copyDatasetCsv(ds: any): Promise<void> {
                  try {
                    const rows = Array.isArray(ds?.rows) ? (ds.rows as any[]) : [];
                    const cols =
                      Array.isArray(ds?.columns) && ds.columns.length > 0
                        ? (ds.columns as any[]).map((c) => String(c?.name ?? '')).filter(Boolean)
                        : Object.keys(rows[0] ?? {});
                    const lines = [cols.join(',')];
                    for (const r of rows.slice(0, 200_000)) {
                      lines.push(cols.map((c) => toCsvValue(r?.[c])).join(','));
                    }
                    await navigator.clipboard.writeText(`${lines.join('\n')}\n`);
                  } catch {
                    // ignore
                  }
                }
                return (
                  <div key={idx} className="card studioReportBlock" style={{ padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontWeight: 750 }}>{title}</div>
                      <div className="pill muted">ml</div>
                      {as ? <div className="pill mono muted">{as}</div> : null}
                    </div>
                    <div style={{ height: 10 }} />
                    {datasets ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {Object.keys(datasets)
                          .sort()
                          .slice(0, 50)
                          .map((k) => (
                            <div key={k} style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => downloadDatasetCsv(`${as || title}-${k}`, datasets[k])}
                                title={`Download dataset: ${k}`}
                              >
                                Download {k}.csv
                              </button>
                              <button
                                onClick={() => void copyDatasetCsv(datasets[k])}
                                title={`Copy dataset as CSV: ${k}`}
                              >
                                Copy {k}.csv
                              </button>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="muted">Charts below visualize this ML output (if configured).</div>
                    )}
                    <details style={{ marginTop: 10 }}>
                      <summary className="muted">Advanced: raw ML output</summary>
                      <pre className="mono" style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>
                        {pj.text}
                        {pj.truncated ? '\n... (truncated)' : ''}
                      </pre>
                    </details>
                  </div>
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
                  <div key={idx} className="card studioReportBlock" style={{ padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontWeight: 750 }}>{title}</div>
                      <div className="pill muted">{chartType}</div>
                      {dsId ? <div className="pill mono muted">{dsId}</div> : null}
                    </div>
                    <div style={{ height: 10 }} />
                    {!ds ? (
                      <div className="error mono">missing_dataset:{dsId}</div>
                    ) : chartType === 'donut' ? (
                      <EChartsDonut
                        rows={(ds.rows ?? []) as any[]}
                        labelField={xField}
                        valueField={yField || 'value'}
                      />
                    ) : chartType === 'bar' ? (
                      <EChartsBar
                        rows={(ds.rows ?? []) as any[]}
                        xField={xField}
                        yField={yField || 'value'}
                        xLabel={xLabel}
                        yLabel={yLabel}
                      />
                    ) : chartType === 'histogram' ? (
                      <EChartsHistogram
                        rows={(ds.rows ?? []) as any[]}
                        valueField={xField}
                        bins={bins}
                        xLabel={xLabel}
                      />
                    ) : (
                      <EChartsXY
                        rows={(ds.rows ?? []) as any[]}
                        xField={xField}
                        yField={yField || 'value'}
                        seriesField={seriesField}
                        seriesType={chartType === 'scatter' ? 'scatter' : 'line'}
                        xLabel={xLabel}
                        yLabel={yLabel}
                        showLegend={showLegend}
                      />
                    )}
                  </div>
                );
              }

              if (kind === 'table') {
                const dsId = String(b?.dataset ?? '');
                const ds = (data.report?.datasets ?? {})[dsId] ?? null;
                const cols = Array.isArray(b?.columns) ? (b.columns as any[]).map(String) : null;
                const limit = typeof b?.limit === 'number' ? b.limit : 50_000;
                const rows = (ds?.rows ?? []) as any[];
                const sliced = cols
                  ? rows.map((r) => {
                      const out: any = {};
                      for (const c of cols) out[c] = r?.[c];
                      return out;
                    })
                  : rows;
                return (
                  <div key={idx} className="card studioReportBlock" style={{ padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontWeight: 750 }}>{title}</div>
                      <div className="pill muted">table</div>
                      {dsId ? <div className="pill mono muted">{dsId}</div> : null}
                    </div>
                    <div style={{ height: 10 }} />
                    {!ds ? (
                      <div className="error mono">missing_dataset:{dsId}</div>
                    ) : (
                      <DataGrid title="Table" rows={sliced} defaultLimit={limit} />
                    )}
                  </div>
                );
              }

              return (
                <div key={idx} className="card studioReportBlock" style={{ padding: 14 }}>
                  <div className="error mono">unknown_block_kind:{kind}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === 'tools' && dashEnabled && (
        <div className="card">
          <h2>
            Tools{' '}
            <InfoTip text="Edit scenario.studio.report for end-of-run custom dashboards. Use dashboards.json for Studio panel presets." />
          </h2>
          <div className="muted">
            Server-side utilities for this run (dashboards, comparisons, and ML).
          </div>
          <div
            className="muted"
            style={{
              marginTop: 8,
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 8,
            }}
          >
            Authoring flow: <span className="mono">dataset -&gt; transform -&gt; ml -&gt; chart/table</span>. Main
            config location: <span className="mono">scenario.studio.report</span>. Use report errors to fix
            schema issues quickly.
          </div>
          <div style={{ height: 10 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button disabled={!dashServerAvailable} onClick={() => void saveDashboards()}>
              Save dashboards.json
            </button>
            <button onClick={() => addDashPanel()}>Add panel</button>
          </div>
          {!dashServerAvailable ? (
            <div className="muted" style={{ marginTop: 10 }}>
              Select a run to edit dashboards.
            </div>
          ) : null}
          <div style={{ height: 10 }} />

          {dashServerAvailable ? (
            <div className="grid">
              <div className="card">
                <h2>
                  Regression <InfoTip text="Quick linear fit on metrics (y = m*tick + b)." />
                </h2>
              <div className="muted">Fit y = m*tick + b over metrics samples.</div>
              <div style={{ height: 10 }} />
              <div className="filters">
                <select value={regressionY} onChange={(e) => setRegressionY(e.target.value)}>
                  {metricKeys.length === 0 && <option value="exploitsFound">exploitsFound</option>}
                  {metricKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <button onClick={() => void runRegression()}>Run</button>
              </div>
              {regressionFit ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  n={regressionFit.n} slope={regressionFit.slope.toFixed(6)} intercept=
                  {regressionFit.intercept.toFixed(6)} r2={regressionFit.r2.toFixed(4)}
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 10 }}>
                  No fit yet.
                </div>
              )}
              </div>

              <div className="card">
                <h2>
                  Compare Metric{' '}
                  <InfoTip text="Compare summary stats (count/min/p50/p95/max/mean) across selected runs." />
                </h2>
              <div className="muted">Summaries across multiple runs (p50/p95/max).</div>
              <div style={{ height: 10 }} />
              <div className="filters">
                <select
                  value={compareMetricKey}
                  onChange={(e) => setCompareMetricKey(e.target.value)}
                >
                  {metricKeys.length === 0 && <option value="exploitsFound">exploitsFound</option>}
                  {metricKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <button onClick={() => void runCompareMetric()}>Run</button>
              </div>
              <div style={{ height: 10 }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {studioRuns.slice(0, 12).map((r) => {
                  const checked = compareRunIds.includes(r.id);
                  return (
                    <label key={r.id} className="muted" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setCompareRunIds((prev) => {
                            if (e.target.checked) return [...new Set([...prev, r.id])];
                            return prev.filter((x) => x !== r.id);
                          });
                        }}
                      />{' '}
                      {truncate(r.scenarioName, 18)}#{r.seed}
                    </label>
                  );
                })}
              </div>
              {compareRows ? (
                <div style={{ marginTop: 10, overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>count</th>
                        <th>min</th>
                        <th>p50</th>
                        <th>p95</th>
                        <th>max</th>
                        <th>mean</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareRows.map((row: any) => (
                        <tr key={row.runId}>
                          <td className="mono">{row.runId.slice(0, 8)}</td>
                          <td className="mono">{row.summary?.count ?? '-'}</td>
                          <td className="mono">{row.summary?.min ?? '-'}</td>
                          <td className="mono">{row.summary?.p50 ?? '-'}</td>
                          <td className="mono">{row.summary?.p95 ?? '-'}</td>
                          <td className="mono">{row.summary?.max ?? '-'}</td>
                          <td className="mono">{row.summary?.mean ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              </div>
            </div>
          ) : null}

          <div style={{ height: 14 }} />

          <div className="grid">
            {dashPanels.map((p) => (
              <div key={p.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="mono" style={{ flex: 1 }}>
                    <input
                      value={p.title}
                      onChange={(e) =>
                        setDashPanels((prev) =>
                          prev.map((x) => (x.id === p.id ? { ...x, title: e.target.value } : x))
                        )
                      }
                      style={{ width: '100%' }}
                    />
                  </div>
                  <button onClick={() => void runPanel(p.id)}>Run</button>
                  <button onClick={() => removeDashPanel(p.id)}>Remove</button>
                </div>
                <div className="filters" style={{ marginTop: 8 }}>
                  <label className="muted">Type</label>
                  <select
                    value={p.type}
                    onChange={(e) =>
                      setDashPanels((prev) =>
                        prev.map((x) =>
                          x.id === p.id ? { ...x, type: e.target.value as any, result: undefined } : x
                        )
                      )
                    }
                  >
                    <option value="line">line</option>
                    <option value="table">table</option>
                    <option value="donut">donut</option>
                  </select>
                  <label className="muted">Table</label>
                  <select
                    value={p.table}
                    onChange={(e) =>
                      setDashPanels((prev) =>
                        prev.map((x) =>
                          x.id === p.id ? { ...x, table: e.target.value as any, result: undefined } : x
                        )
                      )
                    }
                  >
                    <option value="metrics">metrics</option>
                    <option value="actions">actions</option>
                    <option value="evidence">evidence</option>
                  </select>
                  <label className="muted">{p.type === 'donut' ? 'Group field' : 'Field'}</label>
                  <input
                    value={p.field}
                    onChange={(e) =>
                      setDashPanels((prev) =>
                        prev.map((x) => (x.id === p.id ? { ...x, field: e.target.value } : x))
                      )
                    }
                    placeholder={p.type === 'donut' ? 'action.name' : 'tick'}
                    style={{ width: 180 }}
                  />
                  {p.type === 'line' ? (
                    <>
                      <label className="muted">Value</label>
                      <input
                        value={p.valueField ?? ''}
                        onChange={(e) =>
                          setDashPanels((prev) =>
                            prev.map((x) =>
                              x.id === p.id ? { ...x, valueField: e.target.value } : x
                            )
                          )
                        }
                        placeholder="exploitsFound"
                        style={{ width: 160 }}
                      />
                    </>
                  ) : null}
                  <label className="muted">Limit</label>
                  <input
                    value={String(p.limit)}
                    onChange={(e) =>
                      setDashPanels((prev) =>
                        prev.map((x) =>
                          x.id === p.id ? { ...x, limit: Number(e.target.value) || 200 } : x
                        )
                      )
                    }
                    style={{ width: 90 }}
                  />
                  <label className="muted">Auto</label>
                  <input
                    type="checkbox"
                    checked={p.autoRefresh === true}
                    onChange={(e) =>
                      setDashPanels((prev) =>
                        prev.map((x) =>
                          x.id === p.id ? { ...x, autoRefresh: e.target.checked } : x
                        )
                      )
                    }
                  />
                  <label className="muted">ms</label>
                  <input
                    value={String(p.refreshEveryMs ?? 2000)}
                    onChange={(e) =>
                      setDashPanels((prev) =>
                        prev.map((x) =>
                          x.id === p.id
                            ? { ...x, refreshEveryMs: Number(e.target.value) || 2000 }
                            : x
                        )
                      )
                    }
                    style={{ width: 90 }}
                  />
                </div>
                <details style={{ marginTop: 10 }}>
                  <summary className="muted">Advanced (select + filters)</summary>
                  <div style={{ height: 10 }} />
                  <div className="muted">
                    `selectText` is a comma-separated field list. `filtersText` is JSON, e.g.
                    [{`{ "field": "agentId", "op": "contains", "value": "Momentum" }`}]
                  </div>
                  <div style={{ height: 10 }} />
                  <div className="filters">
                    <input
                      value={p.selectText ?? ''}
                      onChange={(e) =>
                        setDashPanels((prev) =>
                          prev.map((x) =>
                            x.id === p.id ? { ...x, selectText: e.target.value } : x
                          )
                        )
                      }
                      placeholder="selectText: tick,agentId,action.name,result.ok"
                      style={{ minWidth: 420 }}
                    />
                  </div>
                  <div style={{ height: 10 }} />
                  <textarea
                    value={p.filtersText ?? ''}
                    onChange={(e) =>
                      setDashPanels((prev) =>
                        prev.map((x) =>
                          x.id === p.id ? { ...x, filtersText: e.target.value } : x
                        )
                      )
                    }
                    placeholder='filtersText JSON: [{"field":"action.name","op":"contains","value":"Exploit"}]'
                    style={{
                      width: '100%',
                      height: 110,
                      background: 'transparent',
                      color: 'var(--fg)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: 8,
                      fontFamily: 'var(--mono)',
                      fontSize: 12,
                    }}
                  />
                </details>
                {p.error ? <div className="error">{p.error}</div> : null}

                {p.type === 'line' && p.result ? (
                  <div style={{ marginTop: 10 }}>
                    <EChartsLine
                      metrics={(p.result.rows as any[]).map((r) => ({ tick: r.tick, [p.valueField!]: r[p.valueField!] }))}
                      metricKey={p.valueField!}
                    />
                  </div>
                ) : null}

                {p.type === 'donut' && p.result ? (
                  <div style={{ marginTop: 10 }}>
                    <EChartsDonut
                      rows={p.result.rows as any[]}
                      labelField={p.field}
                      valueField="count"
                    />
                  </div>
                ) : null}

                {p.type === 'table' && p.result ? (
                  <div style={{ marginTop: 10, overflowX: 'auto' }}>
                    {(() => {
                      const res = p.result!;
                      return (
                    <table>
                      <thead>
                        <tr>
                          {(res.columns ?? []).slice(0, 10).map((c: any) => (
                            <th key={c.name} className="mono">
                              {c.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(res.rows ?? []).slice(0, 50).map((r: any, idx: number) => (
                          <tr key={idx}>
                            {(res.columns ?? []).slice(0, 10).map((c: any) => (
                              <td key={c.name} className="mono">
                                {truncate(safeStringify(r[c.name] ?? ''), 80)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                      );
                    })()}
                    <div className="muted" style={{ marginTop: 6 }}>
                      Showing {Math.min(50, p.result.rows?.length ?? 0)} of {p.result.rows?.length ?? 0} rows
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <DataGrid title="Actions" rows={(data.actions ?? []) as any[]} />
          <DataGrid title="Metrics" rows={(data.metrics ?? []) as any[]} />
          <DataGrid
            title="Exploit Evidence"
            rows={(data.evidence?.records ?? []) as any[]}
            defaultLimit={10_000}
          />
        </div>
      )}

      {tab === 'gossip' && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Gossip</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => void copyRowsCsv((studioGossipRows ?? []) as Array<Record<string, unknown>>)}>
                Copy CSV
              </button>
              <button onClick={() => downloadRowsCsv('gossip.csv', (studioGossipRows ?? []) as Array<Record<string, unknown>>)}>
                Download CSV
              </button>
            </div>
          </div>
          <div className="muted">
            Agent-to-agent messages (posts + deliveries). Click an agent to inspect actions/memory.
          </div>
          <div style={{ height: 10 }} />

          {studioEnabled && studioCurrentRunId ? (
            <>
              <div className="filters">
                <label className="muted">agent</label>
                <input
                  value={studioGossipAgentNeedle}
                  onChange={(e) => setStudioGossipAgentNeedle(e.target.value)}
                  placeholder="agent id contains"
                  style={{ width: 180 }}
                />
                <label className="muted">channel</label>
                <input
                  value={studioGossipChannelNeedle}
                  onChange={(e) => setStudioGossipChannelNeedle(e.target.value)}
                  placeholder="channel id contains"
                  style={{ width: 160 }}
                />
                <label className="muted">kind</label>
                <select
                  value={studioGossipKind}
                  onChange={(e) => setStudioGossipKind(e.target.value as any)}
                >
                  <option value="any">any</option>
                  <option value="gossip_post">gossip_post</option>
                  <option value="gossip_deliver">gossip_deliver</option>
                </select>
                <button
                  disabled={studioInspectBusy}
                  onClick={() => void loadStudioGossipPage({ runId: studioCurrentRunId, offset: 0 })}
                >
                  Refresh
                </button>
                <button
                  disabled={studioInspectBusy || studioGossipOffset <= 0}
                  onClick={() =>
                    void loadStudioGossipPage({
                      runId: studioCurrentRunId,
                      offset: Math.max(0, studioGossipOffset - 200),
                    })
                  }
                >
                  Older
                </button>
                <button
                  disabled={studioInspectBusy || !studioGossipHasMore}
                  onClick={() =>
                    void loadStudioGossipPage({
                      runId: studioCurrentRunId,
                      offset: studioGossipOffset + 200,
                    })
                  }
                >
                  Newer
                </button>
                <div className="muted">
                  offset:{studioGossipOffset} rows:{studioGossipRows.length}{' '}
                  {studioGossipHasMore ? 'hasMore' : 'end'}
                </div>
              </div>

              <div style={{ height: 10 }} />
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tick</th>
                      <th>Kind</th>
                      <th>Channel</th>
                      <th>Author</th>
                      <th>Recipient</th>
                      <th>Text</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(studioGossipRows ?? []).slice(0, 400).map((r: any, i) => {
                      const author = String(r?.message?.envelope?.authorAgentId ?? '');
                      const chan = String(r?.message?.envelope?.channelId ?? '');
                      const recip = String(r?.recipientAgentId ?? '');
                      const text = String(r?.message?.payload?.text ?? '');
                      return (
                        <tr key={`${String(r?.messageId ?? '')}-${String(r?.kind ?? '')}-${i}`}>
                          <td className="mono">{String(r?.tick ?? '')}</td>
                          <td className="mono">{String(r?.kind ?? '')}</td>
                          <td className="mono">{chan || '-'}</td>
                          <td className="mono">
                            {author ? (
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  void openInspectorForAgent({
                                    runId: studioCurrentRunId,
                                    agentId: author,
                                    view: 'actions',
                                  });
                                }}
                              >
                                {author}
                              </a>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="mono">
                            {recip ? (
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  void openInspectorForAgent({
                                    runId: studioCurrentRunId,
                                    agentId: recip,
                                    view: 'memory',
                                  });
                                }}
                              >
                                {recip}
                              </a>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="mono">{truncate(text, 140)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {studioGossipRows.length === 0 ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  No gossip rows found. This usually means the scenario didn’t enable gossip, or no
                  agents posted messages. Try the bundled <span className="mono">toy-chaos</span>{' '}
                  example (it includes a report and is a good place to add a “chatter” agent).
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="muted">
                Live-only view (no Studio run selected). Showing gossip events received over the
                websocket.
              </div>
              <div style={{ height: 10 }} />
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tick</th>
                      <th>Kind</th>
                      <th>Channel</th>
                      <th>Author</th>
                      <th>Recipient</th>
                      <th>Text</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.gossip ?? []).slice(-800).map((r: any, i) => (
                      <tr key={`${String(r?.messageId ?? '')}-${String(r?.kind ?? '')}-${i}`}>
                        <td className="mono">{String(r?.tick ?? '')}</td>
                        <td className="mono">{String(r?.kind ?? '')}</td>
                        <td className="mono">{String(r?.message?.envelope?.channelId ?? '')}</td>
                        <td className="mono">{String(r?.message?.envelope?.authorAgentId ?? '')}</td>
                        <td className="mono">{String(r?.recipientAgentId ?? '')}</td>
                        <td className="mono">
                          {truncate(String(r?.message?.payload?.text ?? ''), 140)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'tools' && studioEnabled ? (
        <div className="card">
          <h2>
            ML Toolkit (Studio){' '}
            <InfoTip text="Runs server-side via /api/ml. Use report blocks to chart and tabulate ML outputs." />
          </h2>
          <div className="muted">
            Runs server-side on Node via <span className="mono">POST /api/ml</span>. Paste/edit a JSON
            request and run it.
          </div>
          <div style={{ height: 10 }} />
          <div className="filters">
            <label className="muted">Run</label>
            <select value={mlRunId ?? ''} onChange={(e) => setMlRunId(e.target.value || null)}>
              {(studioRuns ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {truncate(r.scenarioName, 18)}#{r.seed} {r.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <button disabled={mlBusy} onClick={() => void runMl()}>
              {mlBusy ? 'Running…' : 'Run'}
            </button>
            <button
              onClick={() =>
                setMlReqText(
                  JSON.stringify(
                    {
                      kind: 'dataset',
                      runId: mlRunId ?? studioCurrentRunId ?? 'RUN_ID',
                      table: 'metrics',
                      select: ['tick', 'totalVolume'],
                      limit: 1000,
                    },
                    null,
                    2
                  )
                )
              }
            >
              Template: dataset
            </button>
            <button
              onClick={() =>
                setMlReqText(
                  JSON.stringify(
                    {
                      kind: 'pca',
                      runId: mlRunId ?? studioCurrentRunId ?? 'RUN_ID',
                      table: 'metrics',
                      x: ['totalVolume'],
                      components: 1,
                      limit: 2000,
                    },
                    null,
                    2
                  )
                )
              }
            >
              Template: pca
            </button>
            <button
              onClick={() =>
                setMlReqText(
                  JSON.stringify(
                    {
                      kind: 'kmeans',
                      runId: mlRunId ?? studioCurrentRunId ?? 'RUN_ID',
                      table: 'metrics',
                      x: ['totalVolume'],
                      k: 3,
                      seed: 123,
                      limit: 2000,
                    },
                    null,
                    2
                  )
                )
              }
            >
              Template: kmeans
            </button>
          </div>
          <div style={{ height: 10 }} />
          <textarea
            value={mlReqText}
            onChange={(e) => setMlReqText(e.target.value)}
            style={{
              width: '100%',
              height: 260,
              background: 'transparent',
              color: 'var(--fg)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 10,
              fontFamily: 'var(--mono)',
              fontSize: 12,
            }}
          />
          <div style={{ height: 10 }} />
          <div className="muted">Response</div>
          <pre
            className="mono"
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 10,
              background: 'color-mix(in oklab, var(--card) 85%, var(--bg))',
              margin: 0,
              maxHeight: 420,
              overflow: 'auto',
            }}
          >
            {mlRespText || ''}
          </pre>
        </div>
      ) : null}

      {tab === 'overview' && (
        <>
          <div className="grid">
            <div className="card">
              <h2>Run</h2>
              <table>
                <tbody>
                  <tr>
                    <th>Seed</th>
                    <td className="mono">{data.summary.seed}</td>
                  </tr>
                  <tr>
                    <th>Ticks</th>
                    <td className="mono">{data.summary.ticks}</td>
                  </tr>
                  <tr>
                    <th>Duration</th>
                    <td className="mono">{data.summary.durationMs}ms</td>
                  </tr>
                  <tr>
                    <th>Pack</th>
                    <td className="mono">{data.config?.scenario?.packName ?? '-'}</td>
                  </tr>
                  <tr>
                    <th>Git</th>
                    <td className="mono">{data.gitCommit ?? '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="card">
              <h2>Final Metrics</h2>
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.summary.finalMetrics ?? {})
                    .slice(0, 32)
                    .map(([k, v]) => (
                      <tr key={k}>
                        <td className="mono">{k}</td>
                        <td className="mono">{String(v)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ height: 14 }} />

          <div className="grid">
            <div className="card">
              <h2>Metrics (ECharts)</h2>
              <div className="filters">
                <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
                  {metricKeys.length === 0 && <option value="tick">tick</option>}
                  {metricKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <div className="muted">{metricKeys.length} numeric series</div>
              </div>
              <div style={{ height: 10 }} />
              <EChartsLine metrics={data.metrics} metricKey={metricKey} />
            </div>

            <div className="card">
              <h2>Metrics (Lightweight Charts)</h2>
              <div className="muted">
                Useful for financial-style time series panels (zoom/pan).
              </div>
              <div style={{ height: 10 }} />
              <LightweightLine metrics={data.metrics} metricKey={metricKey} />
            </div>
          </div>
        </>
      )}

      {tab === 'evidence' && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Exploit Evidence</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => void copyRowsCsv(evidenceRows as Array<Record<string, unknown>>)}>
                Copy CSV
              </button>
              <button onClick={() => downloadRowsCsv('evidence.csv', evidenceRows as Array<Record<string, unknown>>)}>
                Download CSV
              </button>
            </div>
          </div>
          <div className="muted">
            Prefer <span className="mono">evidence.json</span> (post-condition checks). Falls back
            to scanning <span className="mono">actions.ndjson</span>.
          </div>
          <div style={{ height: 12 }} />
          <table>
            <thead>
              <tr>
                <th>Tick</th>
                <th>Agent</th>
                <th>Action</th>
                <th>Exploit</th>
                <th>TxHash</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {evidenceRows.slice(0, 500).map((r, idx) => (
                <tr key={idx}>
                  <td className="mono">{r.tick}</td>
                  <td className="mono">
                    {studioEnabled && studioCurrentRunId ? (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          void openInspectorForAgent({
                            runId: studioCurrentRunId,
                            agentId: r.agentId,
                            view: 'actions',
                          });
                        }}
                      >
                        {r.agentId}
                      </a>
                    ) : (
                      r.agentId
                    )}
                  </td>
                  <td className="mono">{r.actionName}</td>
                  <td className="mono">{r.exploitId}</td>
                  <td className="mono">{truncate(r.txHash, 18)}</td>
                  <td className="mono">{truncate(r.evidence, 200)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {evidenceRows.length === 0 && <div className="muted">No evidence records found.</div>}
        </div>
      )}

      {tab === 'timeline' && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Timeline</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => void copyRowsCsv(timelineRows as Array<Record<string, unknown>>)}>
                Copy CSV
              </button>
              <button onClick={() => downloadRowsCsv('timeline.csv', timelineRows as Array<Record<string, unknown>>)}>
                Download CSV
              </button>
            </div>
          </div>
          <div className="filters">
            <input
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              placeholder="agentId contains..."
            />
            <select value={okFilter} onChange={(e) => setOkFilter(e.target.value as any)}>
              <option value="any">ok:any</option>
              <option value="ok">ok:true</option>
              <option value="fail">ok:false</option>
            </select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search..." />
            <div className="muted">{timelineRows.length} rows</div>
          </div>
          {studioEnabled && studioCurrentRunId ? (
            <div className="muted" style={{ marginTop: 8 }}>
              Click an agent id to open inspector. Use inspector controls to jump to oldest/newest
              pages for full history traversal.
            </div>
          ) : null}
          <div style={{ height: 10 }} />
          <div ref={parentRef} className="virtualList">
            <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
              {virtualizer.getVirtualItems().map((v) => {
                const row = timelineRows[v.index];
                if (!row) return null;
                return (
                  <div
                    key={v.key}
                    className={`row ${row.ok ? 'ok' : 'fail'}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: v.size,
                      transform: `translateY(${v.start}px)`,
                    }}
                  >
                    <div className="mono cell tick">{row.tick}</div>
                    <div className="mono cell agent">
                      {studioEnabled && studioCurrentRunId ? (
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            void openInspectorForAgent({
                              runId: studioCurrentRunId,
                              agentId: row.agentId,
                              view: 'actions',
                            });
                          }}
                        >
                          {row.agentId}
                        </a>
                      ) : (
                        row.agentId
                      )}
                    </div>
                    <div className="mono cell action">{row.actionName}</div>
                    <div className="mono cell ok">{row.ok ? 'true' : 'false'}</div>
                    <div className="mono cell info">{truncate(row.info, 260)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'agents' && (
        <div className="grid">
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Agents</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => void copyRowsCsv(agents as Array<Record<string, unknown>>)}>
                  Copy CSV
                </button>
                <button onClick={() => downloadRowsCsv('agents.csv', agents as Array<Record<string, unknown>>)}>
                  Download CSV
                </button>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Type</th>
                  <th>Actions</th>
                  <th>OK</th>
                  <th>Fail</th>
                  <th>Last Tick</th>
                  <th>Inspect</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agentId}>
                    <td className="mono">
                      {studioEnabled && studioCurrentRunId ? (
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            void openInspectorForAgent({
                              runId: studioCurrentRunId,
                              agentId: a.agentId,
                              view: 'actions',
                            });
                          }}
                        >
                          {a.agentId}
                        </a>
                      ) : (
                        a.agentId
                      )}
                    </td>
                    <td className="mono">{a.agentType}</td>
                    <td className="mono">{a.actions}</td>
                    <td className="mono">{a.ok}</td>
                    <td className="mono">{a.fail}</td>
                    <td className="mono">{a.lastTick}</td>
                    <td className="mono">
                      {studioEnabled && studioCurrentRunId ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              void openInspectorForAgent({
                                runId: studioCurrentRunId,
                                agentId: a.agentId,
                                view: 'actions',
                              });
                            }}
                          >
                            actions
                          </a>
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              void openInspectorForAgent({
                                runId: studioCurrentRunId,
                                agentId: a.agentId,
                                view: 'memory',
                              });
                            }}
                          >
                            memory
                          </a>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {studioEnabled && studioCurrentRunId ? (
            <div className="card">
              <h2>Inspector</h2>
              <div className="muted">
                Click an agent id to open the inspector modal (activity + memory history).
              </div>
            </div>
          ) : null}

          {/*
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2>
                  Agent Inspector <span className="mono">{studioCurrentRunId}</span>
                </h2>
                <button onClick={goStudioHome}>Back to Studio</button>
              </div>

              {studioInspectRunId !== studioCurrentRunId ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  Loading inspector…
                </div>
              ) : null}

              {studioInspectError ? (
                <div className="error mono" style={{ marginTop: 10 }}>
                  {studioInspectError}
                </div>
              ) : null}

              {studioInspectRunId === studioCurrentRunId ? (
                <>
                  <div className="filters" style={{ paddingTop: 6 }}>
                    <label className="muted">Agent</label>
                    <select
                      value={studioInspectAgentId}
                      onChange={(e) => {
                        const id = e.target.value;
                        const row = studioInspectAgents.find((a) => a.agentId === id) ?? null;
                        const total = row?.actions ?? 0;
                        const offset = Math.max(0, total - 200);
                        if (studioInspectView === 'memory') {
                          void loadAgentMemoryPage({
                            runId: studioInspectRunId ?? 'RUN_ID',
                            agentId: id,
                            offset: 0,
                          });
                        } else {
                          void loadAgentActionsPage({
                            runId: studioInspectRunId ?? 'RUN_ID',
                            agentId: id,
                            offset,
                            totalActions: total,
                          });
                        }
                      }}
                      style={{ minWidth: 320 }}
                    >
                      {studioInspectAgents.length === 0 ? (
                        <option value="">(no agents)</option>
                      ) : (
                        studioInspectAgents.map((a) => (
                          <option key={a.agentId} value={a.agentId}>
                            {a.agentType}:{a.agentId} ({a.actions} actions)
                          </option>
                        ))
                      )}
                    </select>

                    <button
                      disabled={studioInspectBusy}
                      onClick={() => {
                        setStudioInspectView('actions');
                        const row = studioInspectAgents.find((a) => a.agentId === studioInspectAgentId);
                        const total = row?.actions ?? studioInspectAgentTotal;
                        const offset = Math.max(0, total - 200);
                        void loadAgentActionsPage({
                          runId: studioInspectRunId ?? 'RUN_ID',
                          agentId: studioInspectAgentId,
                          offset,
                          totalActions: total,
                        });
                      }}
                      style={{
                        background: studioInspectView === 'actions' ? '#222' : undefined,
                        color: studioInspectView === 'actions' ? '#fff' : undefined,
                      }}
                    >
                      Actions
                    </button>
                    <button
                      disabled={studioInspectBusy}
                      onClick={() => {
                        setStudioInspectView('memory');
                        void loadAgentMemoryPage({
                          runId: studioInspectRunId ?? 'RUN_ID',
                          agentId: studioInspectAgentId,
                          offset: 0,
                        });
                      }}
                      style={{
                        background: studioInspectView === 'memory' ? '#222' : undefined,
                        color: studioInspectView === 'memory' ? '#fff' : undefined,
                      }}
                    >
                      Memory
                    </button>

                    {studioInspectView === 'actions' ? (
                      <>
                        <button
                          disabled={studioInspectBusy || studioInspectOffset <= 0}
                          onClick={() => {
                            const nextOffset = Math.max(0, studioInspectOffset - 200);
                            void loadAgentActionsPage({
                              runId: studioInspectRunId ?? 'RUN_ID',
                              agentId: studioInspectAgentId,
                              offset: nextOffset,
                              totalActions: studioInspectAgentTotal,
                            });
                          }}
                        >
                          Older
                        </button>
                        <button
                          disabled={
                            studioInspectBusy ||
                            studioInspectOffset + 200 >= Math.max(0, studioInspectAgentTotal)
                          }
                          onClick={() => {
                            const nextOffset = Math.min(
                              Math.max(0, studioInspectAgentTotal - 1),
                              studioInspectOffset + 200
                            );
                            void loadAgentActionsPage({
                              runId: studioInspectRunId ?? 'RUN_ID',
                              agentId: studioInspectAgentId,
                              offset: nextOffset,
                              totalActions: studioInspectAgentTotal,
                            });
                          }}
                        >
                          Newer
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          disabled={studioInspectBusy || studioInspectMemoryOffset <= 0}
                          onClick={() => {
                            const nextOffset = Math.max(0, studioInspectMemoryOffset - 50);
                            void loadAgentMemoryPage({
                              runId: studioInspectRunId ?? 'RUN_ID',
                              agentId: studioInspectAgentId,
                              offset: nextOffset,
                            });
                          }}
                        >
                          Older
                        </button>
                        <button
                          disabled={studioInspectBusy || !studioInspectMemoryHasMore}
                          onClick={() => {
                            const nextOffset = studioInspectMemoryOffset + 50;
                            void loadAgentMemoryPage({
                              runId: studioInspectRunId ?? 'RUN_ID',
                              agentId: studioInspectAgentId,
                              offset: nextOffset,
                            });
                          }}
                        >
                          Newer
                        </button>
                      </>
                    )}

                    <div className="muted">
                      {studioInspectView === 'actions' ? (
                        <>
                          offset:{studioInspectOffset} rows:{studioInspectRows.length} total:
                          {studioInspectAgentTotal}
                        </>
                      ) : (
                        <>
                          offset:{studioInspectMemoryOffset} rows:{studioInspectMemoryRows.length}{' '}
                          {studioInspectMemoryHasMore ? 'hasMore' : 'end'}
                        </>
                      )}
                      {studioInspectBusy ? ' loading...' : ''}
                    </div>
                  </div>

                  <div style={{ height: 10 }} />
                  {studioInspectView === 'actions' ? (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Tick</th>
                            <th>Action</th>
                            <th>Persona</th>
                            <th>Intent</th>
                            <th>Source</th>
                            <th>Rationale</th>
                            <th>OK</th>
                            <th>Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {studioInspectRows.slice(0, 400).map((r: any, i) => (
                            <tr key={String(r?.action?.id ?? '') + String(i)}>
                              <td className="mono">{String(r?.tick ?? '')}</td>
                              <td className="mono">{String(r?.action?.name ?? '-')}</td>
                              <td className="mono">{String(r?.action?.metadata?.personaId ?? '-')}</td>
                              <td className="mono">{String(r?.action?.metadata?.intentTag ?? '-')}</td>
                              <td className="mono">{String(r?.action?.metadata?.llmSource ?? '-')}</td>
                              <td className="mono">{truncate(String(r?.action?.metadata?.rationale ?? ''), 160)}</td>
                              <td className="mono">{String(r?.result?.ok ?? '')}</td>
                              <td className="mono">{truncate(String(r?.result?.error ?? ''), 140)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div>
                      {studioInspectMemoryRows.length === 0 ? (
                        <div className="muted">No memory snapshots found.</div>
                      ) : (
                        studioInspectMemoryRows.slice(0, 200).map((r, i) => {
                          const pj = prettyJson(r.memory, 20_000);
                          return (
                            <details key={`${r.agentId}-${r.tick}-${i}`} style={{ marginBottom: 8 }}>
                              <summary className="mono">
                                tick:{r.tick} ts:{r.timestamp}
                              </summary>
                              <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
                                {pj.text}
                              </pre>
                            </details>
                          );
                        })
                      )}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          */}
        </div>
      )}

      {tab === 'tools' && <ComparePanel runA={data} />}
    </div>
  );
}

function ComparePanel({ runA }: { runA: RunData }) {
  const [runB, setRunB] = useState<RunData['summary'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onPickFile(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as RunData['summary'];
      if (!parsed || typeof parsed.runId !== 'string') {
        throw new Error('Expected a summary.json file');
      }
      setRunB(parsed);
    } catch (e) {
      setRunB(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const deltas = useMemo(() => {
    if (!runB) return [];
    const keys = new Set<string>([
      ...Object.keys(runA.summary.finalMetrics ?? {}),
      ...Object.keys(runB.finalMetrics ?? {}),
    ]);
    return [...keys]
      .map((k) => {
        const a = (runA.summary.finalMetrics as any)?.[k];
        const b = (runB.finalMetrics as any)?.[k];
        if (typeof a === 'number' && typeof b === 'number') {
          const d = b - a;
          const pct = a !== 0 ? (d / a) * 100 : null;
          return { k, a, b, d, pct };
        }
        return { k, a: a ?? null, b: b ?? null, d: null, pct: null };
      })
      .slice(0, 64);
  }, [runA.summary.finalMetrics, runB]);

  return (
    <div className="card">
      <h2>Compare</h2>
      <div className="muted">
        For now, select another run&apos;s <span className="mono">summary.json</span> to view KPI
        deltas.
      </div>
      <div style={{ height: 10 }} />
      <input
        type="file"
        accept="application/json"
        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
      />
      {error && <div className="error">{error}</div>}
      {runB && (
        <>
          <div style={{ height: 12 }} />
          <div className="muted">
            A: <span className="mono">{runA.summary.runId}</span> vs B:{' '}
            <span className="mono">{runB.runId}</span>
          </div>
          <div style={{ height: 12 }} />
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>A</th>
                <th>B</th>
                <th>Delta</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {deltas.map((r) => (
                <tr key={r.k}>
                  <td className="mono">{r.k}</td>
                  <td className="mono">{String(r.a)}</td>
                  <td className="mono">{String(r.b)}</td>
                  <td className="mono">{r.d === null ? '-' : String(r.d)}</td>
                  <td className="mono">{r.pct === null ? '-' : `${r.pct.toFixed(2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default App;

function EChartsLine({
  metrics,
  metricKey,
}: {
  metrics: Array<Record<string, unknown>>;
  metricKey: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    function render() {
      const points: Array<[number, number]> = [];
      for (const m of metrics) {
        const x = Number((m as any).tick);
        const y = Number((m as any)[metricKey]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        points.push([x, y]);
      }
      chart.setOption({
        animation: false,
        grid: { left: 40, right: 10, top: 10, bottom: 30 },
        xAxis: { type: 'value', name: 'tick' },
        yAxis: { type: 'value', name: metricKey },
        series: [{ type: 'line', data: points, showSymbol: false }],
        tooltip: { trigger: 'axis' },
      });
      chart.resize();
    }
    render();
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [metrics, metricKey]);

  return <div ref={ref} style={{ height: 320, width: '100%' }} />;
}

function EChartsDonut({
  rows,
  labelField,
  valueField,
}: {
  rows: Array<Record<string, unknown>>;
  labelField: string;
  valueField: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    function render() {
      const data = rows
        .map((r) => {
          const name = String((r as any)[labelField] ?? '-');
          const value = Number((r as any)[valueField]);
          if (!Number.isFinite(value)) return null;
          return { name, value };
        })
        .filter(Boolean) as Array<{ name: string; value: number }>;
      chart.setOption({
        animation: false,
        tooltip: { trigger: 'item' },
        series: [
          {
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: true,
            label: { show: true, formatter: '{b}: {c}' },
            data,
          },
        ],
      });
      chart.resize();
    }
    render();
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [labelField, rows, valueField]);

  return <div ref={ref} style={{ height: 320, width: '100%' }} />;
}

function EChartsXY({
  rows,
  xField,
  yField,
  seriesField,
  seriesType,
  xLabel,
  yLabel,
  showLegend,
}: {
  rows: Array<Record<string, unknown>>;
  xField: string;
  yField: string;
  seriesField?: string;
  seriesType: 'line' | 'scatter';
  xLabel?: string;
  yLabel?: string;
  showLegend?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    function render() {
      const buckets = new Map<string, Array<[number, number]>>();
      for (const r of rows) {
        const x = Number((r as any)[xField]);
        const y = Number((r as any)[yField]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const s = seriesField ? String((r as any)[seriesField] ?? '-') : yField;
        const curr = buckets.get(s) ?? [];
        curr.push([x, y]);
        buckets.set(s, curr);
      }
      const series = [...buckets.entries()].map(([name, data]) => ({
        name,
        type: seriesType,
        data,
        showSymbol: seriesType === 'scatter',
        symbolSize: seriesType === 'scatter' ? 6 : 2,
      }));
      chart.setOption({
        animation: false,
        grid: { left: 50, right: 10, top: 10, bottom: 35 },
        xAxis: { type: 'value', name: xLabel ?? xField },
        yAxis: { type: 'value', name: yLabel ?? yField },
        series,
        tooltip: { trigger: 'axis' },
        legend:
          showLegend === undefined
            ? series.length > 1
              ? { show: true, type: 'scroll' }
              : { show: false }
            : { show: showLegend, type: 'scroll' },
      });
      chart.resize();
    }
    render();
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [rows, seriesField, seriesType, xField, yField, xLabel, yLabel, showLegend]);

  return <div ref={ref} style={{ height: 320, width: '100%' }} />;
}

function EChartsBar({
  rows,
  xField,
  yField,
  xLabel,
  yLabel,
}: {
  rows: Array<Record<string, unknown>>;
  xField: string;
  yField: string;
  xLabel?: string;
  yLabel?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    function render() {
      const xs: string[] = [];
      const ys: number[] = [];
      for (const r of rows) {
        const x = String((r as any)[xField] ?? '');
        const y = Number((r as any)[yField]);
        if (!x) continue;
        if (!Number.isFinite(y)) continue;
        xs.push(x);
        ys.push(y);
      }
      chart.setOption({
        animation: false,
        grid: { left: 55, right: 10, top: 10, bottom: 60 },
        xAxis: { type: 'category', name: xLabel ?? xField, data: xs, axisLabel: { rotate: 35 } },
        yAxis: { type: 'value', name: yLabel ?? yField },
        series: [{ type: 'bar', data: ys }],
        tooltip: { trigger: 'axis' },
      });
      chart.resize();
    }
    render();
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [rows, xField, yField, xLabel, yLabel]);

  return <div ref={ref} style={{ height: 320, width: '100%' }} />;
}

function EChartsHistogram({
  rows,
  valueField,
  bins,
  xLabel,
}: {
  rows: Array<Record<string, unknown>>;
  valueField: string;
  bins?: number;
  xLabel?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    function render() {
      const values: number[] = [];
      for (const r of rows) {
        const v = Number((r as any)[valueField]);
        if (Number.isFinite(v)) values.push(v);
      }
      if (values.length === 0) {
        chart.clear();
        return;
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      const nBins = Math.max(2, Math.min(200, Math.floor(bins ?? 20)));
      const width = max === min ? 1 : (max - min) / nBins;
      const counts = new Array<number>(nBins).fill(0);
      for (const v of values) {
        const idx = Math.max(0, Math.min(nBins - 1, Math.floor((v - min) / width)));
        counts[idx] = (counts[idx] ?? 0) + 1;
      }
      const labels = counts.map((_c, i) => {
        const lo = min + i * width;
        const hi = lo + width;
        return `${lo.toFixed(2)}-${hi.toFixed(2)}`;
      });
      chart.setOption({
        animation: false,
        grid: { left: 55, right: 10, top: 10, bottom: 60 },
        xAxis: { type: 'category', name: xLabel ?? valueField, data: labels, axisLabel: { rotate: 35 } },
        yAxis: { type: 'value', name: 'count' },
        series: [{ type: 'bar', data: counts }],
        tooltip: { trigger: 'axis' },
      });
      chart.resize();
    }
    render();
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [rows, valueField, bins, xLabel]);

  return <div ref={ref} style={{ height: 320, width: '100%' }} />;
}

function LightweightLine({
  metrics,
  metricKey,
}: {
  metrics: Array<Record<string, unknown>>;
  metricKey: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#12141b' },
        textColor: '#e8e8e8',
      },
      grid: {
        vertLines: { color: '#2a2e3a' },
        horzLines: { color: '#2a2e3a' },
      },
      width: el.clientWidth,
      height: 320,
      timeScale: { timeVisible: false },
    });
    const series = chart.addSeries(LineSeries, { color: '#2ecc71', lineWidth: 2 });

    const data: Array<{ time: any; value: number }> = [];
    for (const m of metrics) {
      const t = Number((m as any).tick);
      const v = Number((m as any)[metricKey]);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      // Lightweight Charts expects a branded Time type; tick number is fine for local runs.
      data.push({ time: t as any, value: v });
    }
    series.setData(data);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [metrics, metricKey]);

  return <div ref={ref} style={{ height: 320, width: '100%' }} />;
}
