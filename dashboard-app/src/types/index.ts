export type RunData = {
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

export type StudioRunListItem = {
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

export type StudioScenarioListItem = {
  id: string;
  label: string;
  scenarioPath: string;
  relPath: string;
  group?: string;
  description?: string;
};

export type StudioRun = {
  id: string;
  status: 'starting' | 'running' | 'finished' | 'failed' | 'stopped';
  startedAt: number;
  pid?: number;
  liveWsUrl?: string;
  outputDir?: string;
  exitCode?: number;
  error?: string;
};

export type StudioAgentSummaryRow = {
  agentId: string;
  agentType: string;
  actions: number;
  ok: number;
  fail: number;
  lastTick: number;
  lastError?: string;
};

export type StudioMemorySnapshotRow = {
  tick: number;
  timestamp: number;
  agentId: string;
  agentType: string;
  memory: unknown;
};

export type TabId =
  | 'studio'
  | 'overview'
  | 'evidence'
  | 'timeline'
  | 'agents'
  | 'report'
  | 'gossip'
  | 'data'
  | 'tools';

export type PanelType = 'line' | 'table' | 'donut';

export type DashPanel = {
  id: string;
  title: string;
  type: PanelType;
  table: 'metrics' | 'actions' | 'evidence';
  field: string;
  valueField?: string;
  limit: number;
  selectText?: string;
  filtersText?: string;
  autoRefresh?: boolean;
  refreshEveryMs?: number;
  result?: { columns: Array<{ name: string; type: string }>; rows: Array<Record<string, any>> };
  error?: string;
};

declare global {
  interface Window {
    __AF_DATA__?: RunData;
    __AF_DATA_URL__?: string;
  }
}
