import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Toaster, toast } from 'sonner';

import type {
  RunData, StudioRunListItem, StudioScenarioListItem, StudioRun,
  StudioAgentSummaryRow, StudioMemorySnapshotRow, TabId, DashPanel,
} from '@/types/index.ts';
import {
  parseStudioRunIdFromPathname, truncate, safeStringify,
  prettyJson, isBundledExampleScenario,
} from '@/lib/helpers.ts';
import {
  TerminalLayout, TerminalTopBar, TerminalFunctionTabs, TerminalPanel, StatusPill,
} from '@/components/terminal/index.ts';
import { EChartsLine } from '@/components/charts/EChartsLine.tsx';
import { EChartsDonut } from '@/components/charts/EChartsDonut.tsx';

import { OverviewTab } from '@/tabs/OverviewTab.tsx';
import { EvidenceTab } from '@/tabs/EvidenceTab.tsx';
import { TimelineTab } from '@/tabs/TimelineTab.tsx';
import { AgentsTab } from '@/tabs/AgentsTab.tsx';
import { GossipTab } from '@/tabs/GossipTab.tsx';
import { DataTab } from '@/tabs/DataTab.tsx';
import { ReportTab } from '@/tabs/ReportTab.tsx';

function App() {

  const studioRunPageId = useMemo(() => {
    try { return parseStudioRunIdFromPathname(window.location.pathname); } catch { return null; }
  }, []);

  const [data, setData] = useState<RunData | null>(null);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');

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
  const [studioInspectPersonaFilter] = useState('');
  const [studioInspectIntentFilter] = useState('');
  const [studioInspectLlmSourceFilter] = useState('');
  const [studioInspectActionFamilyFilter] = useState('');
  const [studioInspectMemoryOffset, setStudioInspectMemoryOffset] = useState<number>(0);
  const [studioInspectMemoryRows, setStudioInspectMemoryRows] = useState<StudioMemorySnapshotRow[]>([]);
  const [studioInspectMemoryHasMore, setStudioInspectMemoryHasMore] = useState<boolean>(false);
  const [studioInspectBusy, setStudioInspectBusy] = useState(false);
  const [studioInspectError, setStudioInspectError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const [studioGossipOffset, setStudioGossipOffset] = useState(0);
  const [studioGossipRows, setStudioGossipRows] = useState<Array<Record<string, unknown>>>([]);
  const [studioGossipHasMore, setStudioGossipHasMore] = useState(false);
  const [studioGossipAgentNeedle, setStudioGossipAgentNeedle] = useState('');
  const [studioGossipChannelNeedle, setStudioGossipChannelNeedle] = useState('');
  const [studioGossipKind, setStudioGossipKind] = useState<'any' | 'gossip_post' | 'gossip_deliver'>('any');

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
  }>({ scenarioKind: 'example', exampleScenarioId: '', scenarioPath: '', mode: 'deterministic', seed: '', ticks: '60', outDir: 'results' });

  const [dashPanels, setDashPanels] = useState<DashPanel[]>([
    { id: 'p1', title: 'Exploit attempts over time', type: 'line', table: 'metrics', field: 'tick', valueField: 'exploitsFound', limit: 5000, autoRefresh: false, refreshEveryMs: 2000 },
    { id: 'p2', title: 'Actions (recent)', type: 'table', table: 'actions', field: 'agentId', limit: 200, autoRefresh: false, refreshEveryMs: 2000 },
    { id: 'p3', title: 'Action count by name', type: 'donut', table: 'actions', field: 'action', limit: 20, autoRefresh: false, refreshEveryMs: 2000 },
  ]);
  const dashPanelsRef = useRef<DashPanel[]>(dashPanels);
  const dashPanelInFlight = useRef<Set<string>>(new Set());
  useEffect(() => { dashPanelsRef.current = dashPanels; }, [dashPanels]);

  const [regressionY, setRegressionY] = useState<string>('exploitsFound');
  const [regressionFit, setRegressionFit] = useState<null | { n: number; slope: number; intercept: number; r2: number }>(null);
  const [compareMetricKey, setCompareMetricKey] = useState<string>('exploitsFound');
  const [compareRunIds, setCompareRunIds] = useState<string[]>([]);
  const [compareRows, setCompareRows] = useState<any[] | null>(null);

  const studioRunStatusCounts = useMemo(() => {
    let running = 0, finished = 0, failed = 0;
    for (const r of studioActiveRuns) {
      if (r.status === 'starting' || r.status === 'running') running += 1;
      else if (r.status === 'finished') finished += 1;
      else if (r.status === 'failed' || r.status === 'stopped') failed += 1;
    }
    return { running, finished, failed };
  }, [studioActiveRuns]);

  const activeRunForPage = useMemo(() => studioRunPageId ? studioActiveRuns.find((r) => r.id === studioRunPageId) ?? null : null, [studioActiveRuns, studioRunPageId]);
  const catalogRunForPage = useMemo(() => studioRunPageId ? studioRuns.find((r) => r.id === studioRunPageId) ?? null : null, [studioRuns, studioRunPageId]);
  const scenarioGroups = useMemo(() => {
    const examples: StudioScenarioListItem[] = [];
    const workspace: StudioScenarioListItem[] = [];
    for (const s of studioScenarios) { if (isBundledExampleScenario(s)) examples.push(s); else workspace.push(s); }
    return { examples, workspace };
  }, [studioScenarios]);

  const metricKeys = useMemo(() => {
    if (!data) return [];
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

  const dashEnabled = studioEnabled && studioCurrentRunId !== null;

  function goAppHome(): void {
    if (studioEnabled) {
      setData(null);
      setStudioCurrentRunId(null);
      setTab('studio');
      try { window.history.pushState(null, '', '/'); } catch { /* ignore */ }
    } else {
      try { window.location.assign('/'); } catch { /* ignore */ }
    }
  }

  async function loadAgentActionsPage(args: { runId: string; agentId: string; offset: number; totalActions: number }): Promise<void> {
    if (!studioEnabled) return;
    setStudioInspectError(null); setStudioInspectBusy(true);
    try {
      const qs = new URLSearchParams();
      qs.set('agentId', args.agentId); qs.set('offset', String(args.offset)); qs.set('limit', '200');
      if (studioInspectPersonaFilter.trim()) qs.set('personaId', studioInspectPersonaFilter.trim());
      if (studioInspectIntentFilter.trim()) qs.set('intentTag', studioInspectIntentFilter.trim());
      if (studioInspectLlmSourceFilter.trim()) qs.set('llmSource', studioInspectLlmSourceFilter.trim());
      if (studioInspectActionFamilyFilter.trim()) qs.set('actionFamily', studioInspectActionFamilyFilter.trim());
      const resp = await fetch(`${studioHost}/api/runs/${args.runId}/actions?${qs.toString()}`);
      const payload = (await resp.json()) as { ok?: boolean; rows?: any[] };
      if (!payload.ok || !Array.isArray(payload.rows)) throw new Error(payload && typeof (payload as any).error === 'string' ? (payload as any).error : 'failed_to_load_actions');
      setStudioInspectAgentId(args.agentId); setStudioInspectAgentTotal(args.totalActions);
      setStudioInspectOffset(args.offset); setStudioInspectRows(payload.rows);
    } catch (err) { setStudioInspectError(err instanceof Error ? err.message : String(err)); } finally { setStudioInspectBusy(false); }
  }

  async function loadAgentMemoryPage(args: { runId: string; agentId: string; offset: number }): Promise<void> {
    if (!studioEnabled) return;
    setStudioInspectError(null); setStudioInspectBusy(true);
    try {
      const resp = await fetch(`${studioHost}/api/runs/${args.runId}/memory?agentId=${encodeURIComponent(args.agentId)}&offset=${args.offset}&limit=50`);
      const payload = (await resp.json()) as { ok?: boolean; rows?: StudioMemorySnapshotRow[]; hasMore?: boolean };
      if (!payload.ok || !Array.isArray(payload.rows)) throw new Error(payload && typeof (payload as any).error === 'string' ? (payload as any).error : 'failed_to_load_memory');
      setStudioInspectAgentId(args.agentId); setStudioInspectMemoryOffset(args.offset);
      setStudioInspectMemoryRows(payload.rows); setStudioInspectMemoryHasMore(payload.hasMore === true);
    } catch (err) { setStudioInspectError(err instanceof Error ? err.message : String(err)); } finally { setStudioInspectBusy(false); }
  }

  async function loadStudioGossipPage(args: { runId: string; offset: number }): Promise<void> {
    if (!studioEnabled) return;
    setStudioError(null); setStudioInspectError(null); setStudioInspectBusy(true);
    try {
      const qs = new URLSearchParams();
      qs.set('offset', String(Math.max(0, args.offset))); qs.set('limit', '200');
      if (studioGossipAgentNeedle.trim()) qs.set('agentId', studioGossipAgentNeedle.trim());
      if (studioGossipChannelNeedle.trim()) qs.set('channelId', studioGossipChannelNeedle.trim());
      if (studioGossipKind !== 'any') qs.set('kind', studioGossipKind);
      const resp = await fetch(`${studioHost}/api/runs/${args.runId}/gossip?${qs.toString()}`);
      const payload = (await resp.json()) as { ok?: boolean; rows?: Array<Record<string, unknown>>; hasMore?: boolean };
      if (!payload.ok || !Array.isArray(payload.rows)) throw new Error(payload && typeof (payload as any).error === 'string' ? (payload as any).error : 'failed_to_load_gossip');
      setStudioGossipOffset(args.offset); setStudioGossipRows(payload.rows); setStudioGossipHasMore(payload.hasMore === true);
    } catch (err) { setStudioError(err instanceof Error ? err.message : String(err)); } finally { setStudioInspectBusy(false); }
  }

  async function openInspectorForAgent(args: { runId: string; agentId: string; view?: 'actions' | 'memory' }): Promise<void> {
    if (!studioEnabled) return;
    setInspectorOpen(true); setStudioInspectError(null); setStudioInspectBusy(true); setStudioInspectRunId(args.runId);
    try {
      let agents = studioInspectAgents;
      if (studioInspectRunId !== args.runId || agents.length === 0) {
        const resp = await fetch(`${studioHost}/api/runs/${args.runId}/agents`);
        const payload = (await resp.json()) as { ok?: boolean; agents?: StudioAgentSummaryRow[] };
        if (!payload.ok || !Array.isArray(payload.agents)) throw new Error(payload && typeof (payload as any).error === 'string' ? (payload as any).error : 'failed_to_load_agents');
        agents = payload.agents; setStudioInspectAgents(agents);
      }
      const row = agents.find((a) => a.agentId === args.agentId) ?? null;
      const total = row?.actions ?? 0;
      const view = args.view ?? 'actions';
      setStudioInspectView(view);
      if (view === 'memory') await loadAgentMemoryPage({ runId: args.runId, agentId: args.agentId, offset: 0 });
      else { const offset = Math.max(0, total - 200); await loadAgentActionsPage({ runId: args.runId, agentId: args.agentId, offset, totalActions: total }); }
    } catch (err) { setStudioInspectError(err instanceof Error ? err.message : String(err)); } finally { setStudioInspectBusy(false); }
  }

  // Data loading
  useEffect(() => {
    const injected = window.__AF_DATA__;
    if (injected) { setData(injected); return; }
    const url = window.__AF_DATA_URL__;
    if (url) { (async () => { try { const resp = await fetch(url); if (!resp.ok) throw new Error(`HTTP_${resp.status}`); setData((await resp.json()) as RunData); } catch (err) { setDataLoadError(err instanceof Error ? err.message : String(err)); } })(); return; }
    setData(null);
  }, []);

  // Studio detection – validate the response is real JSON from the backend,
  // not just the Vite dev server returning HTML for any path.
  useEffect(() => {
    const proto = String(window.location.protocol ?? '');
    if (proto !== 'http:' && proto !== 'https:') return;
    const base = `${proto}//${window.location.host}`;
    (async () => {
      try {
        const resp = await fetch(`${base}/api/health`);
        if (!resp.ok) return;
        const ct = resp.headers.get('content-type') ?? '';
        if (!ct.includes('json')) return;
        const body = await resp.json();
        if (!body || typeof body !== 'object') return;
        setStudioEnabled(true);
        setStudioHost(base);
        if (!studioRunPageId) setTab('studio');
      } catch { /* not studio */ }
    })();
  }, [studioRunPageId]);

  async function refreshStudioRuns(): Promise<StudioRunListItem[]> {
    if (!studioEnabled) return [];
    try { setStudioError(null); const resp = await fetch(`${studioHost}/api/runs`); const payload = (await resp.json()) as { runs?: StudioRunListItem[] }; const list = Array.isArray(payload.runs) ? payload.runs : []; setStudioRuns(list); return list; } catch (err) { setStudioError(err instanceof Error ? err.message : String(err)); return []; }
  }
  async function refreshStudioScenarios(): Promise<StudioScenarioListItem[]> {
    if (!studioEnabled) return [];
    try { const resp = await fetch(`${studioHost}/api/scenarios`); const payload = (await resp.json()) as { scenarios?: StudioScenarioListItem[] }; const list = Array.isArray(payload.scenarios) ? payload.scenarios : []; setStudioScenarios(list); if (list.length > 0) setRunForm((p) => ({ ...p, scenarioKind: p.scenarioKind === 'path' ? 'path' : 'example', exampleScenarioId: (p.exampleScenarioId && list.some((s) => s.id === p.exampleScenarioId)) ? p.exampleScenarioId : list[0]!.id })); return list; } catch { return []; }
  }

  useEffect(() => { if (studioEnabled) { void refreshStudioRuns(); void refreshStudioScenarios(); } }, [studioEnabled, studioHost]);

  // WebSocket
  useEffect(() => {
    if (!studioEnabled || !studioHost) return;
    const wsBase = studioHost.startsWith('https://') ? studioHost.replace('https://', 'wss://') : studioHost.replace('http://', 'ws://');
    const ws = new WebSocket(`${wsBase}/api/ws`);
    ws.addEventListener('open', () => setStudioWsConnected(true));
    ws.addEventListener('close', () => setStudioWsConnected(false));
    ws.addEventListener('message', (msg) => {
      try {
        const ev = JSON.parse(String((msg as any).data));
        const t = typeof ev?.type === 'string' ? ev.type : '';
        if (t === 'runs' && Array.isArray(ev?.payload)) { setStudioActiveRuns(ev.payload as StudioRun[]); return; }
        if ((t === 'run_started' || t === 'run_status') && ev?.payload?.id) { const r = ev.payload as StudioRun; setStudioActiveRuns((prev) => [r, ...prev.filter((x) => x.id !== r.id)].slice(0, 50)); return; }
      } catch { /* ignore */ }
    });
    return () => ws.close();
  }, [studioEnabled, studioHost]);

  async function loadRunIntoDashboard(runId: string): Promise<void> {
    if (!studioHost) return;
    setRunArtifactsLoading(true);
    try { setStudioError(null); const resp = await fetch(`${studioHost}/api/runs/${runId}/artifacts`); const payload = (await resp.json()) as { ok?: boolean; data?: RunData; error?: string }; if (!payload.ok || !payload.data) throw new Error(payload.error ?? 'failed_to_load_run'); setData(payload.data); setStudioCurrentRunId(runId); setTab(payload.data.report ? 'report' : 'overview'); } catch (err) { setStudioError(err instanceof Error ? err.message : String(err)); } finally { setRunArtifactsLoading(false); }
  }

  async function loadAgentsForRun(runId: string): Promise<void> {
    if (!studioEnabled) return;
    setStudioInspectError(null); setStudioInspectBusy(true); setStudioInspectRunId(runId); setStudioInspectView('actions');
    try {
      const resp = await fetch(`${studioHost}/api/runs/${runId}/agents`); const payload = (await resp.json()) as { ok?: boolean; agents?: StudioAgentSummaryRow[] };
      if (!payload.ok || !Array.isArray(payload.agents)) throw new Error(payload && typeof (payload as any).error === 'string' ? (payload as any).error : 'failed_to_load_agents');
      setStudioInspectAgents(payload.agents);
      const first = payload.agents[0];
      if (!first) { setStudioInspectAgentId(''); setStudioInspectAgentTotal(0); setStudioInspectOffset(0); setStudioInspectRows([]); setStudioInspectMemoryOffset(0); setStudioInspectMemoryRows([]); setStudioInspectMemoryHasMore(false); return; }
      setStudioInspectMemoryOffset(0); setStudioInspectMemoryRows([]); setStudioInspectMemoryHasMore(false);
      await loadAgentActionsPage({ runId, agentId: first.agentId, offset: Math.max(0, first.actions - 200), totalActions: first.actions });
    } catch (err) { setStudioInspectError(err instanceof Error ? err.message : String(err)); } finally { setStudioInspectBusy(false); }
  }

  useEffect(() => { if (studioEnabled && studioHost && studioRunPageId) { void loadRunIntoDashboard(studioRunPageId); void loadAgentsForRun(studioRunPageId); void loadStudioGossipPage({ runId: studioRunPageId, offset: 0 }); } }, [studioEnabled, studioHost, studioRunPageId]);

  useEffect(() => { if (!studioRunPageId || !studioEnabled || !studioHost) return; if (data) return; const isRunning = activeRunForPage?.status === 'starting' || activeRunForPage?.status === 'running'; if (!isRunning && !studioError) return; const t = window.setTimeout(() => { void refreshStudioRuns(); void loadRunIntoDashboard(studioRunPageId); }, 1500); return () => window.clearTimeout(t); }, [studioEnabled, studioHost, studioRunPageId, data, studioError, activeRunForPage?.status]);

  useEffect(() => { if (!studioRunPageId || !data) return; if (data.report) setTab('report'); else setTab('overview'); }, [data, studioRunPageId]);

  async function generateDashboard(runId: string): Promise<void> {
    try { setStudioError(null); const resp = await fetch(`${studioHost}/api/runs/${runId}/dashboard`, { method: 'POST' }); const payload = (await resp.json().catch(() => null)) as any; if (!payload?.ok) { const msg = payload?.error ?? `HTTP_${resp.status}`; const tail = payload?.stderr ? `\n\nstderr:\n${String(payload.stderr).slice(-1200)}` : ''; throw new Error(`${msg}${tail}`); } toast.success('Dashboard generated'); await refreshStudioRuns(); for (let i = 0; i < 6; i += 1) { await new Promise((r) => setTimeout(r, 300 * (i + 1))); await refreshStudioRuns(); if (studioRuns.some((r) => r.id === runId && r.hasDashboard)) break; } } catch (err) { setStudioError(err instanceof Error ? err.message : String(err)); }
  }

  async function startRunFromStudio(): Promise<void> {
    try { setStudioError(null); const pickedExample = studioScenarios.find((s) => s.id === runForm.exampleScenarioId) ?? null; const scenarioPath = runForm.scenarioKind === 'path' ? runForm.scenarioPath.trim() : runForm.scenarioKind === 'example' ? (pickedExample?.scenarioPath ?? '') : ''; const toy = runForm.scenarioKind === 'toy'; if (!toy && !scenarioPath) { setStudioError(runForm.scenarioKind === 'example' ? 'missing_example_scenario' : 'missing_scenario_path'); return; } const body: any = { toy, scenarioPath: toy ? undefined : scenarioPath, mode: runForm.mode, outDir: runForm.outDir.trim() || 'results' }; const seed = runForm.seed.trim(); const ticks = runForm.ticks.trim(); if (seed) body.seed = Number(seed); if (ticks) body.ticks = Number(ticks); const resp = await fetch(`${studioHost}/api/runs/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const payload = (await resp.json()) as { ok?: boolean; error?: string }; if (!payload.ok) throw new Error(payload.error ?? 'failed_to_start_run'); toast.success('Run started'); await refreshStudioRuns(); } catch (err) { setStudioError(err instanceof Error ? err.message : String(err)); }
  }

  // Dashboard panels
  const runPanel = useCallback(async (panelId: string): Promise<void> => {
    if (dashPanelInFlight.current.has(panelId)) return; dashPanelInFlight.current.add(panelId);
    setDashPanels((prev) => prev.map((p) => (p.id === panelId ? { ...p, error: undefined } : p)));
    const p = dashPanelsRef.current.find((x) => x.id === panelId);
    if (!p) { dashPanelInFlight.current.delete(panelId); return; }
    try {
      if (!studioEnabled || !studioCurrentRunId) throw new Error('studio_run_not_selected');
      let parsedFilters: any[] | undefined;
      if (p.filtersText?.trim()) { try { const v = JSON.parse(p.filtersText); if (Array.isArray(v)) parsedFilters = v; } catch { throw new Error('filtersText_invalid_json'); } }
      const parsedSelect = p.selectText?.trim() ? p.selectText.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      let spec: any = { v: 'v1', limit: p.limit };
      if (p.type === 'line') { const y = (p.valueField ?? '').trim(); if (!y) throw new Error('missing_valueField'); spec = { v: 'v1', select: [p.field.trim() || 'tick', y], filters: parsedFilters, sort: { field: 'tick', dir: 'asc' }, limit: p.limit }; }
      else if (p.type === 'table') { spec = { v: 'v1', select: parsedSelect, filters: parsedFilters, limit: p.limit, sort: { field: p.field.trim() || 'tick', dir: 'desc' } }; }
      else if (p.type === 'donut') { const groupField = p.field.trim(); if (!groupField) throw new Error('missing_groupBy_field'); spec = { v: 'v1', filters: parsedFilters, groupBy: [groupField], aggregates: [{ as: 'count', op: 'count' }], sort: { field: 'count', dir: 'desc' }, limit: p.limit }; }
      const resp = await fetch(`${studioHost}/api/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: studioCurrentRunId, table: p.table, spec }) });
      const payload = (await resp.json()) as any; if (!payload.ok) throw new Error(payload.error ?? 'query_failed');
      setDashPanels((prev) => prev.map((x) => x.id === panelId ? { ...x, result: payload.result, error: undefined } : x));
    } catch (err) { setDashPanels((prev) => prev.map((x) => x.id === panelId ? { ...x, error: err instanceof Error ? err.message : String(err) } : x)); } finally { dashPanelInFlight.current.delete(panelId); }
  }, [studioEnabled, studioCurrentRunId, studioHost]);

  async function saveDashboards(): Promise<void> {
    if (!studioEnabled || !studioCurrentRunId) return;
    try { setStudioError(null); await fetch(`${studioHost}/api/runs/${studioCurrentRunId}/dashboards`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 'v1', panels: dashPanels }) }); toast.success('Dashboards saved'); } catch (err) { setStudioError(err instanceof Error ? err.message : String(err)); }
  }
  async function runRegression(): Promise<void> {
    if (!dashEnabled) return;
    try { setStudioError(null); const resp = await fetch(`${studioHost}/api/stats/regression`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: studioCurrentRunId, table: 'metrics', xField: 'tick', yField: regressionY }) }); const payload = (await resp.json()) as any; if (!payload.ok) throw new Error(payload.error ?? 'regression_failed'); setRegressionFit(payload.fit ?? null); } catch (err) { setStudioError(err instanceof Error ? err.message : String(err)); }
  }
  async function runCompareMetric(): Promise<void> {
    if (!dashEnabled) return;
    try { setStudioError(null); const resp = await fetch(`${studioHost}/api/stats/metric-summary`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runIds: compareRunIds, metricKey: compareMetricKey }) }); const payload = (await resp.json()) as any; if (!payload.ok) throw new Error(payload.error ?? 'compare_failed'); setCompareRows(Array.isArray(payload.rows) ? payload.rows : []); } catch (err) { setStudioError(err instanceof Error ? err.message : String(err)); }
  }
  async function runMl(): Promise<void> {
    if (!studioEnabled || !mlRunId) return; setMlBusy(true); setMlRespText('');
    try { const raw = JSON.parse(mlReqText || '{}'); if (!raw.runId) raw.runId = mlRunId; const resp = await fetch(`${studioHost}/api/ml`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(raw) }); setMlRespText(await resp.text()); } catch (err) { setMlRespText(`{"ok":false,"error":"${err instanceof Error ? err.message : String(err)}"}`); } finally { setMlBusy(false); }
  }

  useEffect(() => { if (studioEnabled && !mlReqText) setMlReqText(JSON.stringify({ kind: 'linear_regression', runId: studioCurrentRunId ?? studioRuns[0]?.id ?? 'RUN_ID', table: 'metrics', x: ['tick'], y: 'totalVolume', limit: 2000 }, null, 2)); }, [studioEnabled]);
  useEffect(() => { if (studioEnabled) setMlRunId((prev) => prev ?? studioCurrentRunId ?? studioRuns[0]?.id ?? null); }, [studioEnabled, studioCurrentRunId, studioRuns.length]);
  useEffect(() => { if (dashEnabled) setCompareRunIds((prev) => prev.length === 0 ? [studioCurrentRunId!] : prev); }, [dashEnabled, studioCurrentRunId]);
  useEffect(() => { if (studioEnabled && studioCurrentRunId) { (async () => { try { const resp = await fetch(`${studioHost}/api/runs/${studioCurrentRunId}/dashboards`); const payload = (await resp.json()) as { ok?: boolean; dashboards?: any }; if (Array.isArray(payload?.dashboards?.panels)) setDashPanels(payload.dashboards.panels as DashPanel[]); } catch { /* ignore */ } })(); } }, [studioCurrentRunId, studioEnabled, studioHost]);

  const dashAutoKey = useMemo(() => dashPanels.map((p) => `${p.id}:${p.autoRefresh === true}:${p.refreshEveryMs ?? 0}`).sort().join('|'), [dashPanels]);
  useEffect(() => { if (!dashEnabled || !dashAutoKey) return; const panels = dashPanelsRef.current.filter((p) => p.autoRefresh === true); if (panels.length === 0) return; const timers = panels.map((p) => { const ms = Math.max(500, Number(p.refreshEveryMs ?? 2000) || 2000); return window.setInterval(() => { void runPanel(p.id); }, ms); }); return () => { for (const t of timers) window.clearInterval(t); }; }, [dashEnabled, dashAutoKey, studioCurrentRunId, studioHost, runPanel]);

  // Hotkeys for tab switching
  useHotkeys('alt+1', () => data?.report ? setTab('report') : setTab('overview'), { enableOnFormTags: false });
  useHotkeys('alt+2', () => setTab('overview'), { enableOnFormTags: false });
  useHotkeys('alt+3', () => setTab('evidence'), { enableOnFormTags: false });
  useHotkeys('alt+4', () => setTab('timeline'), { enableOnFormTags: false });
  useHotkeys('alt+5', () => setTab('agents'), { enableOnFormTags: false });
  useHotkeys('alt+6', () => setTab('gossip'), { enableOnFormTags: false });
  useHotkeys('alt+7', () => setTab('data'), { enableOnFormTags: false });
  useHotkeys('alt+8', () => { if (dashEnabled) setTab('tools'); }, { enableOnFormTags: false });
  useHotkeys('escape', () => setInspectorOpen(false));

  const btn = "bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-[11px] text-foreground hover:bg-muted/80 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
  const inp = "bg-muted/50 border border-border/60 rounded-sm px-2 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground/50";

  const onInspectAgent = studioEnabled && studioCurrentRunId ? (agentId: string) => void openInspectorForAgent({ runId: studioCurrentRunId!, agentId, view: 'actions' }) : undefined;
  const onInspectMemory = studioEnabled && studioCurrentRunId ? (agentId: string) => void openInspectorForAgent({ runId: studioCurrentRunId!, agentId, view: 'memory' }) : undefined;

  // ── STUDIO HOME ──
  if (tab === 'studio' && studioEnabled) {
    return (
      <TerminalLayout>
        <TerminalTopBar
          left={<a href="/" onClick={(e) => { e.preventDefault(); goAppHome(); }} className="flex items-center gap-2 cursor-pointer" title="Home"><span className="font-semibold text-xs">AgentForge Studio</span></a>}
          right={
            <div className="flex items-center gap-2">
              <StatusPill variant={studioWsConnected ? 'pass' : 'fail'} pulse={studioWsConnected}>ws:{studioWsConnected ? 'on' : 'off'}</StatusPill>
              <StatusPill variant="neutral">active:{studioActiveRuns.length}</StatusPill>
              <StatusPill variant="info">running:{studioRunStatusCounts.running}</StatusPill>
              <StatusPill variant="pass">done:{studioRunStatusCounts.finished}</StatusPill>
              <StatusPill variant="fail">fail:{studioRunStatusCounts.failed}</StatusPill>
            </div>
          }
        />
        <div className="max-w-[1400px] mx-auto p-3 space-y-3">
          <TerminalPanel title="Active Runs" actions={<button onClick={() => void refreshStudioRuns()} className={btn}>Refresh</button>}>
            {studioActiveRuns.length === 0 ? <div className="text-xs text-muted-foreground">No active runs.</div> : (
              <table className="w-full"><thead><tr className="border-b border-border/60">{['Started', 'Status', 'PID', 'Info'].map((h) => <th key={h} className="text-left text-[11px] text-muted-foreground py-1.5 px-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>{studioActiveRuns.slice().sort((a, b) => b.startedAt - a.startedAt).slice(0, 20).map((r) => (
                  <tr key={r.id} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="font-mono text-xs py-1.5 px-2 tabular-nums">{new Date(r.startedAt).toLocaleTimeString()}</td>
                    <td className="font-mono text-xs py-1.5 px-2"><StatusPill variant={r.status === 'running' || r.status === 'starting' ? 'live' : r.status === 'finished' ? 'pass' : 'fail'} pulse={r.status === 'running'}>{r.status}</StatusPill></td>
                    <td className="font-mono text-xs py-1.5 px-2 tabular-nums">{typeof r.pid === 'number' ? r.pid : '-'}</td>
                    <td className="py-1.5 px-2"><span className="text-[11px] text-muted-foreground font-mono">run:{r.id.slice(0, 12)}</span>{r.error ? <span className="text-terminal-red font-mono text-[11px] ml-2">{truncate(r.error, 80)}</span> : null}</td>
                  </tr>
                ))}</tbody></table>
            )}
          </TerminalPanel>

          {studioError && <div className="text-xs text-terminal-red font-mono border border-terminal-red/30 rounded-sm p-2 bg-terminal-red/5">{studioError}</div>}

          <TerminalPanel title="Start Run" subtitle="Launch a new simulation">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-[11px] text-muted-foreground">Scenario</label>
              <select value={runForm.scenarioKind} onChange={(e) => setRunForm((p) => ({ ...p, scenarioKind: e.target.value as any }))} className={inp}>
                <option value="example">Discovered</option><option value="toy">Toy</option><option value="path">Custom path</option>
              </select>
              {runForm.scenarioKind === 'example' && (
                <select value={runForm.exampleScenarioId} onChange={(e) => setRunForm((p) => ({ ...p, exampleScenarioId: e.target.value }))} className={`${inp} min-w-[280px]`}>
                  {studioScenarios.length === 0 ? <option value="">(none)</option> : <>
                    {scenarioGroups.workspace.length > 0 && <optgroup label="Workspace">{scenarioGroups.workspace.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>}
                    {scenarioGroups.examples.length > 0 && <optgroup label="Examples">{scenarioGroups.examples.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>}
                  </>}
                </select>
              )}
              {runForm.scenarioKind === 'path' && <input value={runForm.scenarioPath} onChange={(e) => setRunForm((p) => ({ ...p, scenarioPath: e.target.value }))} placeholder="path/to/scenario.ts" className={`${inp} min-w-[260px]`} />}
              <label className="text-[11px] text-muted-foreground">Mode</label>
              <select value={runForm.mode} onChange={(e) => setRunForm((p) => ({ ...p, mode: e.target.value as any }))} className={inp}>
                <option value="deterministic">deterministic</option><option value="exploration">exploration</option><option value="replay">replay</option>
              </select>
              <label className="text-[11px] text-muted-foreground">Seed</label>
              <input value={runForm.seed} onChange={(e) => setRunForm((p) => ({ ...p, seed: e.target.value }))} placeholder="auto" className={`${inp} w-20`} />
              <label className="text-[11px] text-muted-foreground">Ticks</label>
              <input value={runForm.ticks} onChange={(e) => setRunForm((p) => ({ ...p, ticks: e.target.value }))} className={`${inp} w-16`} />
              <label className="text-[11px] text-muted-foreground">OutDir</label>
              <input value={runForm.outDir} onChange={(e) => setRunForm((p) => ({ ...p, outDir: e.target.value }))} className={`${inp} w-28`} />
              <button onClick={() => void startRunFromStudio()} className="bg-terminal-tab-active/90 text-background font-semibold border-none rounded-sm px-3 py-1 text-xs cursor-pointer hover:bg-terminal-tab-active">Start</button>
            </div>
          </TerminalPanel>

          <TerminalPanel title="Sessions" subtitle="Completed runs" actions={<button onClick={() => void refreshStudioRuns()} className={btn}>Refresh</button>}>
            {studioRuns.length === 0 ? <div className="text-xs text-muted-foreground">No runs found.</div> : (
              <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-border/60">{['Time', 'Scenario', 'Seed', 'Ticks', 'Status', 'Run ID', 'Dashboard', 'Files'].map((h) => <th key={h} className="text-left text-[11px] text-muted-foreground py-1.5 px-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>{studioRuns.slice(0, 200).map((r) => (
                  <tr key={r.id} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="font-mono text-xs py-1.5 px-2 whitespace-nowrap">{new Date(r.timestamp).toLocaleString()}</td>
                    <td className="font-mono text-xs py-1.5 px-2">{r.scenarioName}</td>
                    <td className="font-mono text-xs py-1.5 px-2 text-right tabular-nums">{r.seed}</td>
                    <td className="font-mono text-xs py-1.5 px-2 text-right tabular-nums">{r.ticks}</td>
                    <td className="py-1.5 px-2"><StatusPill variant={r.success ? 'pass' : 'fail'}>{r.success ? 'PASSED' : 'FAILED'}</StatusPill></td>
                    <td className="font-mono text-[11px] py-1.5 px-2 text-muted-foreground">{r.id.slice(0, 12)}</td>
                    <td className="py-1.5 px-2">
                      {r.hasDashboard
                        ? <a href={`/runs/${r.id}/dashboard/index.html`} target="_blank" rel="noreferrer" className="text-[11px] text-terminal-tab-active hover:underline">Open</a>
                        : <button onClick={() => void generateDashboard(r.id)} className={btn}>Build</button>}
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="flex gap-1.5 items-center">
                        <a href={`${studioHost}/api/runs/${r.id}/file?path=summary.json`} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground bg-muted/40 border border-border/40 rounded-sm px-1.5 py-0.5">summary</a>
                        <a href={`${studioHost}/api/runs/${r.id}/file?path=actions.ndjson`} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground bg-muted/40 border border-border/40 rounded-sm px-1.5 py-0.5">actions</a>
                        <a href={`${studioHost}/api/runs/${r.id}/file?path=metrics.csv`} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground bg-muted/40 border border-border/40 rounded-sm px-1.5 py-0.5">metrics</a>
                      </div>
                    </td>
                  </tr>
                ))}</tbody></table></div>
            )}
          </TerminalPanel>
        </div>
        <Toaster position="bottom-right" theme="dark" toastOptions={{ style: { background: 'hsl(220 20% 7%)', border: '1px solid hsl(220 10% 20%)', color: 'hsl(210 14% 92%)', fontFamily: 'var(--font-mono)', fontSize: '11px', borderRadius: '4px' } }} />
      </TerminalLayout>
    );
  }

  // ── NO DATA STATE ──
  if (!data) {
    return (
      <TerminalLayout>
        <TerminalTopBar left={<a href="/" onClick={(e) => { e.preventDefault(); goAppHome(); }} className="flex items-center gap-2 cursor-pointer" title="Back to home"><span className="font-semibold text-xs">{studioEnabled ? 'AgentForge Studio' : 'AgentForge Dashboard'}</span></a>} />
        <div className="max-w-[800px] mx-auto p-6">
          <TerminalPanel title={studioRunPageId ? `Run ${studioRunPageId}` : 'No Data'}>
            {studioRunPageId && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusPill variant="neutral">{studioRunPageId}</StatusPill>
                  {activeRunForPage && <StatusPill variant={activeRunForPage.status === 'running' ? 'live' : 'neutral'} pulse={activeRunForPage.status === 'running'}>{activeRunForPage.status}</StatusPill>}
                  {catalogRunForPage && <StatusPill variant={catalogRunForPage.success ? 'pass' : 'fail'}>{catalogRunForPage.success ? 'PASSED' : 'FAILED'}</StatusPill>}
                </div>
                {!studioEnabled && <div className="text-xs text-muted-foreground">Connecting to Studio server...</div>}
                {runArtifactsLoading && <div className="text-xs text-muted-foreground">Loading run artifacts...</div>}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => { void refreshStudioRuns(); void loadRunIntoDashboard(studioRunPageId); }} className={btn}>Refresh</button>
                  <a href="/" className="text-xs text-terminal-tab-active hover:underline">Back to Studio</a>
                </div>
              </div>
            )}
            {!studioRunPageId && <div className="text-xs text-muted-foreground">No run data found. Static dashboards inject window.__AF_DATA__.</div>}
            {dataLoadError && <div className="text-xs text-terminal-red font-mono mt-2">data_load_failed:{dataLoadError}</div>}
            {studioError && <div className="text-xs text-terminal-red font-mono mt-2">run_load_error:{studioError}</div>}
          </TerminalPanel>
        </div>
        <Toaster position="bottom-right" theme="dark" toastOptions={{ style: { background: 'hsl(220 20% 7%)', border: '1px solid hsl(220 10% 20%)', color: 'hsl(210 14% 92%)', fontFamily: 'var(--font-mono)', fontSize: '11px', borderRadius: '4px' } }} />
      </TerminalLayout>
    );
  }

  // ── RUN DASHBOARD ──
  const tabDefs = [
    ...(data.report ? [{ id: 'report', label: 'REPORT', number: 1 }] : []),
    { id: 'overview', label: 'OVERVIEW', number: data.report ? 2 : 1 },
    { id: 'evidence', label: 'EVIDENCE', number: data.report ? 3 : 2 },
    { id: 'timeline', label: 'TIMELINE', number: data.report ? 4 : 3 },
    { id: 'agents', label: 'AGENTS', number: data.report ? 5 : 4 },
    { id: 'gossip', label: 'GOSSIP', number: data.report ? 6 : 5 },
    { id: 'data', label: 'DATA', number: data.report ? 7 : 6 },
    { id: 'tools', label: 'TOOLS', number: data.report ? 8 : 7, hidden: !(studioEnabled && dashEnabled) },
  ];

  return (
    <TerminalLayout>
      <TerminalTopBar
        left={<a href="/" onClick={(e) => { e.preventDefault(); goAppHome(); }} className="flex items-center gap-2 cursor-pointer" title="Back to home"><span className="font-semibold text-xs">AgentForge</span></a>}
        center={<span className="truncate">{data.summary.scenarioName}</span>}
        right={
          <div className="flex items-center gap-2">
            <StatusPill variant={data.summary.success ? 'pass' : 'fail'}>{data.summary.success ? 'PASSED' : 'FAILED'}</StatusPill>
            <StatusPill variant="neutral">{data.config?.scenario?.mode ?? 'mode:?'}</StatusPill>
            <StatusPill variant="neutral">{data.summary.runId.slice(0, 12)}</StatusPill>
          </div>
        }
      />
      <TerminalFunctionTabs tabs={tabDefs} activeTab={tab} onTabChange={(id) => setTab(id as TabId)} />

      {data.meta?.largeRunWarning && <div className="mx-3 mt-2 text-xs text-terminal-red font-mono border border-terminal-red/30 rounded-sm p-2 bg-terminal-red/5">large_run:{data.meta.largeRunWarning}</div>}

      {/* Inspector overlay */}
      {studioEnabled && inspectorOpen && (
        <div className="fixed inset-0 bg-black/60 z-[1000] p-4 overflow-auto" onClick={() => setInspectorOpen(false)}>
          <div className="max-w-[1100px] mx-auto border border-border bg-card rounded-sm p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-baseline mb-2">
              <div className="font-semibold text-sm">Agent Inspector <span className="font-mono text-xs text-muted-foreground">{studioInspectRunId}</span></div>
              <button onClick={() => setInspectorOpen(false)} className={btn}>Close</button>
            </div>
            {studioInspectError && <div className="text-xs text-terminal-red font-mono mb-2">{studioInspectError}</div>}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <label className="text-[11px] text-muted-foreground">Agent</label>
              <select value={studioInspectAgentId} onChange={(e) => { const id = e.target.value; const row = studioInspectAgents.find((a) => a.agentId === id); const total = row?.actions ?? 0; if (!studioInspectRunId) return; if (studioInspectView === 'memory') void loadAgentMemoryPage({ runId: studioInspectRunId, agentId: id, offset: 0 }); else void loadAgentActionsPage({ runId: studioInspectRunId, agentId: id, offset: Math.max(0, total - 200), totalActions: total }); }} className={`${inp} min-w-[260px]`}>
                {studioInspectAgents.length === 0 ? <option value="">(no agents)</option> : studioInspectAgents.map((a) => <option key={a.agentId} value={a.agentId}>{a.agentType}:{a.agentId} ({a.actions})</option>)}
              </select>
              <button disabled={studioInspectBusy} onClick={() => { setStudioInspectView('actions'); const row = studioInspectAgents.find((a) => a.agentId === studioInspectAgentId); const total = row?.actions ?? studioInspectAgentTotal; if (studioInspectRunId) void loadAgentActionsPage({ runId: studioInspectRunId, agentId: studioInspectAgentId, offset: Math.max(0, total - 200), totalActions: total }); }} className={`${btn} ${studioInspectView === 'actions' ? 'bg-terminal-tab-active/20 border-terminal-tab-active/40 text-terminal-tab-active' : ''}`}>Activity</button>
              <button disabled={studioInspectBusy} onClick={() => { setStudioInspectView('memory'); if (studioInspectRunId) void loadAgentMemoryPage({ runId: studioInspectRunId, agentId: studioInspectAgentId, offset: 0 }); }} className={`${btn} ${studioInspectView === 'memory' ? 'bg-terminal-tab-active/20 border-terminal-tab-active/40 text-terminal-tab-active' : ''}`}>Memory</button>
              {studioInspectView === 'actions' ? <>
                <button disabled={studioInspectBusy || studioInspectOffset <= 0} onClick={() => { if (studioInspectRunId) void loadAgentActionsPage({ runId: studioInspectRunId, agentId: studioInspectAgentId, offset: 0, totalActions: studioInspectAgentTotal }); }} className={btn}>Oldest</button>
                <button disabled={studioInspectBusy} onClick={() => { const row = studioInspectAgents.find((a) => a.agentId === studioInspectAgentId); const total = row?.actions ?? studioInspectAgentTotal; if (studioInspectRunId) void loadAgentActionsPage({ runId: studioInspectRunId, agentId: studioInspectAgentId, offset: Math.max(0, total - 200), totalActions: total }); }} className={btn}>Latest</button>
                <button disabled={studioInspectBusy || studioInspectOffset <= 0} onClick={() => { if (studioInspectRunId) void loadAgentActionsPage({ runId: studioInspectRunId, agentId: studioInspectAgentId, offset: Math.max(0, studioInspectOffset - 200), totalActions: studioInspectAgentTotal }); }} className={btn}>Older</button>
                <button disabled={studioInspectBusy || studioInspectOffset + 200 >= Math.max(0, studioInspectAgentTotal)} onClick={() => { if (studioInspectRunId) void loadAgentActionsPage({ runId: studioInspectRunId, agentId: studioInspectAgentId, offset: Math.min(Math.max(0, studioInspectAgentTotal - 1), studioInspectOffset + 200), totalActions: studioInspectAgentTotal }); }} className={btn}>Newer</button>
              </> : <>
                <button disabled={studioInspectBusy || studioInspectMemoryOffset <= 0} onClick={() => { if (studioInspectRunId) void loadAgentMemoryPage({ runId: studioInspectRunId, agentId: studioInspectAgentId, offset: Math.max(0, studioInspectMemoryOffset - 50) }); }} className={btn}>Older</button>
                <button disabled={studioInspectBusy || !studioInspectMemoryHasMore} onClick={() => { if (studioInspectRunId) void loadAgentMemoryPage({ runId: studioInspectRunId, agentId: studioInspectAgentId, offset: studioInspectMemoryOffset + 50 }); }} className={btn}>Newer</button>
              </>}
              <span className="text-[11px] text-muted-foreground font-mono">{studioInspectView === 'actions' ? `off:${studioInspectOffset} rows:${studioInspectRows.length} total:${studioInspectAgentTotal}` : `off:${studioInspectMemoryOffset} rows:${studioInspectMemoryRows.length} ${studioInspectMemoryHasMore ? 'hasMore' : 'end'}`}{studioInspectBusy ? ' loading...' : ''}</span>
            </div>
            {studioInspectView === 'actions' ? (
              <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-border/60">{['Tick', 'Action', 'Persona', 'Source', 'Rationale', 'OK', 'Error'].map((h) => <th key={h} className="text-left text-[11px] text-muted-foreground py-1.5 px-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>{studioInspectRows.slice(0, 400).map((r: any, i) => (
                  <tr key={String(r?.action?.id ?? '') + String(i)} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="font-mono text-xs py-1.5 px-2 tabular-nums">{String(r?.tick ?? '')}</td>
                    <td className="font-mono text-xs py-1.5 px-2">{String(r?.action?.name ?? '-')}</td>
                    <td className="font-mono text-[11px] py-1.5 px-2 text-muted-foreground">{String(r?.action?.metadata?.personaId ?? '-')}</td>
                    <td className="font-mono text-[11px] py-1.5 px-2 text-muted-foreground">{String(r?.action?.metadata?.llmSource ?? '-')}</td>
                    <td className="font-mono text-[11px] py-1.5 px-2 text-muted-foreground max-w-[200px] truncate">{truncate(String(r?.action?.metadata?.rationale ?? ''), 120)}</td>
                    <td className={`font-mono text-xs py-1.5 px-2 ${r?.result?.ok ? 'text-terminal-green' : 'text-terminal-red'}`}>{String(r?.result?.ok ?? '')}</td>
                    <td className="font-mono text-[11px] py-1.5 px-2 text-terminal-red max-w-[180px] truncate">{truncate(String(r?.result?.error ?? ''), 100)}</td>
                  </tr>
                ))}</tbody></table></div>
            ) : (
              <div>{studioInspectMemoryRows.length === 0 ? <div className="text-xs text-muted-foreground">No memory snapshots.</div> : studioInspectMemoryRows.slice(0, 200).map((r, i) => { const pj = prettyJson(r.memory, 20_000); return <details key={`${r.agentId}-${r.tick}-${i}`} className="mb-2"><summary className="font-mono text-xs text-muted-foreground cursor-pointer">tick:{r.tick} ts:{r.timestamp}</summary><pre className="font-mono text-[11px] whitespace-pre-wrap border border-border/40 rounded-sm p-2 mt-1 bg-card/80 max-h-[300px] overflow-auto">{pj.text}{pj.truncated ? '\n... (truncated)' : ''}</pre></details>; })}</div>
            )}
          </div>
        </div>
      )}

      <div className="max-w-[1400px] mx-auto p-3">
        {tab === 'report' && data.report && <ReportTab data={data} />}
        {tab === 'overview' && <OverviewTab data={data} />}
        {tab === 'evidence' && <EvidenceTab data={data} onInspectAgent={onInspectAgent} />}
        {tab === 'timeline' && <TimelineTab data={data} onInspectAgent={onInspectAgent} />}
        {tab === 'agents' && <AgentsTab data={data} onInspectAgent={onInspectAgent} onInspectMemory={onInspectMemory} />}
        {tab === 'gossip' && <GossipTab data={data} studioEnabled={studioEnabled} studioCurrentRunId={studioCurrentRunId} gossipRows={studioGossipRows} gossipOffset={studioGossipOffset} gossipHasMore={studioGossipHasMore} gossipAgentNeedle={studioGossipAgentNeedle} gossipChannelNeedle={studioGossipChannelNeedle} gossipKind={studioGossipKind} inspectBusy={studioInspectBusy} onSetAgentNeedle={setStudioGossipAgentNeedle} onSetChannelNeedle={setStudioGossipChannelNeedle} onSetKind={setStudioGossipKind} onRefresh={() => { if (studioCurrentRunId) void loadStudioGossipPage({ runId: studioCurrentRunId, offset: 0 }); }} onOlder={() => { if (studioCurrentRunId) void loadStudioGossipPage({ runId: studioCurrentRunId, offset: Math.max(0, studioGossipOffset - 200) }); }} onNewer={() => { if (studioCurrentRunId) void loadStudioGossipPage({ runId: studioCurrentRunId, offset: studioGossipOffset + 200 }); }} onInspectAgent={onInspectAgent} onInspectMemory={onInspectMemory} />}
        {tab === 'data' && <DataTab data={data} />}

        {tab === 'tools' && dashEnabled && (
          <div className="space-y-3">
            <TerminalPanel title="Tools" subtitle="Server-side utilities: dashboards, regression, compare, ML">
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => void saveDashboards()} className={btn}>Save dashboards.json</button>
                <button onClick={() => setDashPanels((prev) => [...prev, { id: `p${Date.now().toString(36)}`, title: `Panel ${prev.length + 1}`, type: 'table', table: 'actions', field: 'tick', limit: 200, autoRefresh: false, refreshEveryMs: 2000 }])} className={btn}>Add panel</button>
              </div>
            </TerminalPanel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <TerminalPanel title="Regression" subtitle="y = m*tick + b">
                <div className="flex items-center gap-2 mb-2">
                  <select value={regressionY} onChange={(e) => setRegressionY(e.target.value)} className={inp}>{metricKeys.length === 0 && <option value="exploitsFound">exploitsFound</option>}{metricKeys.map((k) => <option key={k} value={k}>{k}</option>)}</select>
                  <button onClick={() => void runRegression()} className={btn}>Run</button>
                </div>
                {regressionFit ? <div className="font-mono text-xs text-muted-foreground">n={regressionFit.n} slope={regressionFit.slope.toFixed(6)} intercept={regressionFit.intercept.toFixed(6)} r2={regressionFit.r2.toFixed(4)}</div> : <div className="text-xs text-muted-foreground">No fit yet.</div>}
              </TerminalPanel>
              <TerminalPanel title="Compare Metric" subtitle="p50/p95/max across runs">
                <div className="flex items-center gap-2 mb-2">
                  <select value={compareMetricKey} onChange={(e) => setCompareMetricKey(e.target.value)} className={inp}>{metricKeys.length === 0 && <option value="exploitsFound">exploitsFound</option>}{metricKeys.map((k) => <option key={k} value={k}>{k}</option>)}</select>
                  <button onClick={() => void runCompareMetric()} className={btn}>Run</button>
                </div>
                <div className="flex gap-2 flex-wrap mb-2">{studioRuns.slice(0, 12).map((r) => <label key={r.id} className="text-[11px] text-muted-foreground cursor-pointer flex items-center gap-1"><input type="checkbox" checked={compareRunIds.includes(r.id)} onChange={(e) => setCompareRunIds((prev) => e.target.checked ? [...new Set([...prev, r.id])] : prev.filter((x) => x !== r.id))} />{truncate(r.scenarioName, 18)}#{r.seed}</label>)}</div>
                {compareRows && <div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-border/60">{['Run', 'count', 'min', 'p50', 'p95', 'max', 'mean'].map((h) => <th key={h} className="text-left text-[11px] text-muted-foreground py-1 px-1 font-medium">{h}</th>)}</tr></thead><tbody>{compareRows.map((row: any) => <tr key={row.runId} className="border-b border-border/30"><td className="font-mono text-xs py-1 px-1">{row.runId.slice(0, 8)}</td>{['count', 'min', 'p50', 'p95', 'max', 'mean'].map((k) => <td key={k} className="font-mono text-xs py-1 px-1 text-right tabular-nums">{row.summary?.[k] ?? '-'}</td>)}</tr>)}</tbody></table></div>}
              </TerminalPanel>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {dashPanels.map((p) => (
                <TerminalPanel key={p.id}>
                  <div className="flex items-center gap-2 mb-2"><input value={p.title} onChange={(e) => setDashPanels((prev) => prev.map((x) => x.id === p.id ? { ...x, title: e.target.value } : x))} className={`${inp} flex-1`} /><button onClick={() => void runPanel(p.id)} className={btn}>Run</button><button onClick={() => setDashPanels((prev) => prev.filter((x) => x.id !== p.id))} className={btn}>Remove</button></div>
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <label className="text-muted-foreground">Type</label><select value={p.type} onChange={(e) => setDashPanels((prev) => prev.map((x) => x.id === p.id ? { ...x, type: e.target.value as any, result: undefined } : x))} className={inp}><option value="line">line</option><option value="table">table</option><option value="donut">donut</option></select>
                    <label className="text-muted-foreground">Table</label><select value={p.table} onChange={(e) => setDashPanels((prev) => prev.map((x) => x.id === p.id ? { ...x, table: e.target.value as any, result: undefined } : x))} className={inp}><option value="metrics">metrics</option><option value="actions">actions</option><option value="evidence">evidence</option></select>
                    <label className="text-muted-foreground">Field</label><input value={p.field} onChange={(e) => setDashPanels((prev) => prev.map((x) => x.id === p.id ? { ...x, field: e.target.value } : x))} className={`${inp} w-32`} />
                    {p.type === 'line' && <><label className="text-muted-foreground">Value</label><input value={p.valueField ?? ''} onChange={(e) => setDashPanels((prev) => prev.map((x) => x.id === p.id ? { ...x, valueField: e.target.value } : x))} className={`${inp} w-28`} /></>}
                    <label className="text-muted-foreground">Limit</label><input value={String(p.limit)} onChange={(e) => setDashPanels((prev) => prev.map((x) => x.id === p.id ? { ...x, limit: Number(e.target.value) || 200 } : x))} className={`${inp} w-16`} />
                  </div>
                  {p.error && <div className="text-xs text-terminal-red font-mono mt-1">{p.error}</div>}
                  {p.type === 'line' && p.result && <div className="mt-2"><EChartsLine metrics={(p.result.rows as any[]).map((r) => ({ tick: r.tick, [p.valueField!]: r[p.valueField!] }))} metricKey={p.valueField!} /></div>}
                  {p.type === 'donut' && p.result && <div className="mt-2"><EChartsDonut rows={p.result.rows as any[]} labelField={p.field} valueField="count" /></div>}
                  {p.type === 'table' && p.result && <div className="mt-2 overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-border/60">{(p.result.columns ?? []).slice(0, 10).map((c: any) => <th key={c.name} className="text-left text-[11px] text-muted-foreground py-1 px-1 font-medium font-mono">{c.name}</th>)}</tr></thead><tbody>{(p.result.rows ?? []).slice(0, 50).map((r: any, idx: number) => <tr key={idx} className="border-b border-border/20">{(p.result!.columns ?? []).slice(0, 10).map((c: any) => <td key={c.name} className="font-mono text-xs py-1 px-1">{truncate(safeStringify(r[c.name] ?? ''), 80)}</td>)}</tr>)}</tbody></table><div className="text-[11px] text-muted-foreground mt-1">{Math.min(50, p.result.rows?.length ?? 0)} of {p.result.rows?.length ?? 0} rows</div></div>}
                </TerminalPanel>
              ))}
            </div>

            {studioEnabled && (
              <TerminalPanel title="ML Toolkit" subtitle="Server-side via POST /api/ml">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <label className="text-[11px] text-muted-foreground">Run</label>
                  <select value={mlRunId ?? ''} onChange={(e) => setMlRunId(e.target.value || null)} className={inp}>{(studioRuns ?? []).map((r) => <option key={r.id} value={r.id}>{truncate(r.scenarioName, 18)}#{r.seed} {r.id.slice(0, 8)}</option>)}</select>
                  <button disabled={mlBusy} onClick={() => void runMl()} className={btn}>{mlBusy ? 'Running...' : 'Run'}</button>
                  <button onClick={() => setMlReqText(JSON.stringify({ kind: 'dataset', runId: mlRunId ?? studioCurrentRunId ?? 'RUN_ID', table: 'metrics', select: ['tick', 'totalVolume'], limit: 1000 }, null, 2))} className={btn}>dataset</button>
                  <button onClick={() => setMlReqText(JSON.stringify({ kind: 'pca', runId: mlRunId ?? studioCurrentRunId ?? 'RUN_ID', table: 'metrics', x: ['totalVolume'], components: 1, limit: 2000 }, null, 2))} className={btn}>pca</button>
                  <button onClick={() => setMlReqText(JSON.stringify({ kind: 'kmeans', runId: mlRunId ?? studioCurrentRunId ?? 'RUN_ID', table: 'metrics', x: ['totalVolume'], k: 3, seed: 123, limit: 2000 }, null, 2))} className={btn}>kmeans</button>
                </div>
                <textarea value={mlReqText} onChange={(e) => setMlReqText(e.target.value)} className="w-full h-[200px] bg-card/80 border border-border/60 rounded-sm p-2 font-mono text-xs text-foreground resize-y" />
                <div className="text-[11px] text-muted-foreground mt-2 mb-1">Response</div>
                <pre className="font-mono text-[11px] whitespace-pre-wrap break-words border border-border/60 rounded-sm p-2 bg-card/80 max-h-[300px] overflow-auto">{mlRespText || ''}</pre>
              </TerminalPanel>
            )}
          </div>
        )}
      </div>
      <Toaster position="bottom-right" theme="dark" toastOptions={{ style: { background: 'hsl(220 20% 7%)', border: '1px solid hsl(220 10% 20%)', color: 'hsl(210 14% 92%)', fontFamily: 'var(--font-mono)', fontSize: '11px', borderRadius: '4px' } }} />
    </TerminalLayout>
  );
}

export default App;
