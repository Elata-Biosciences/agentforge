import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { MetricsSample, RecordedAction } from '../../core/report.js';

export type PageResult<T> = {
  offset: number;
  limit: number;
  nextOffset: number;
  hasMore: boolean;
  rows: T[];
};

export type ActionsPageQuery = {
  offset: number;
  limit: number;
  agentIdContains?: string;
  personaIdContains?: string;
  llmSourceContains?: string;
  actionFamilyContains?: string;
  ok?: boolean;
};

function asBool(v: string | null): boolean | undefined {
  if (v === null) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function normalizeNeedle(s: string | undefined): string | null {
  const t = (s ?? '').trim().toLowerCase();
  return t ? t : null;
}

export function parseActionsPageQuery(url: URL): ActionsPageQuery {
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
  const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '200', 10) || 200;
  const limit = Math.min(5000, Math.max(1, limitRaw));
  const agentIdContains =
    url.searchParams.get('agentId') ?? url.searchParams.get('agentIdContains');
  const personaIdContains =
    url.searchParams.get('personaId') ?? url.searchParams.get('personaIdContains');
  const llmSourceContains =
    url.searchParams.get('llmSource') ?? url.searchParams.get('llmSourceContains');
  const actionFamilyContains = url.searchParams.get('actionFamily');
  const ok = asBool(url.searchParams.get('ok'));
  return {
    offset,
    limit,
    ...(agentIdContains ? { agentIdContains } : {}),
    ...(personaIdContains ? { personaIdContains } : {}),
    ...(llmSourceContains ? { llmSourceContains } : {}),
    ...(actionFamilyContains ? { actionFamilyContains } : {}),
    ...(ok !== undefined ? { ok } : {}),
  };
}

export async function readActionsPage(
  runDir: string,
  query: ActionsPageQuery
): Promise<PageResult<RecordedAction>> {
  const filePath = join(runDir, 'actions.ndjson');
  await stat(filePath);

  const needle = normalizeNeedle(query.agentIdContains);
  const personaNeedle = normalizeNeedle(query.personaIdContains);
  const llmSourceNeedle = normalizeNeedle(query.llmSourceContains);
  const familyNeedle = normalizeNeedle(query.actionFamilyContains);
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  const rows: RecordedAction[] = [];
  let matchIdx = 0;
  let extraFound = false;
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row: RecordedAction;
      try {
        row = JSON.parse(trimmed) as RecordedAction;
      } catch {
        continue;
      }
      if (needle) {
        const id = String((row as any).agentId ?? '').toLowerCase();
        if (!id.includes(needle)) continue;
      }
      if (personaNeedle) {
        const pid = String((row as any).action?.metadata?.personaId ?? '').toLowerCase();
        if (!pid.includes(personaNeedle)) continue;
      }
      if (llmSourceNeedle) {
        const src = String((row as any).action?.metadata?.llmSource ?? '').toLowerCase();
        if (!src.includes(llmSourceNeedle)) continue;
      }
      if (familyNeedle) {
        const actionName = String((row as any).action?.name ?? '').toLowerCase();
        if (!actionName.includes(familyNeedle)) continue;
      }
      if (query.ok !== undefined) {
        const rok = (row as any).result?.ok === true;
        if (rok !== query.ok) continue;
      }
      if (matchIdx < query.offset) {
        matchIdx += 1;
        continue;
      }
      if (rows.length < query.limit) {
        rows.push(row);
        matchIdx += 1;
        continue;
      }
      // We read one extra match to determine hasMore without consuming it into the page.
      extraFound = true;
      break;
    }
  } finally {
    rl.close();
    stream.close();
  }

  return {
    offset: query.offset,
    limit: query.limit,
    nextOffset: query.offset + rows.length,
    hasMore: extraFound,
    rows,
  };
}

export type MetricsPageQuery = {
  offset: number;
  limit: number;
};

export function parseMetricsPageQuery(url: URL): MetricsPageQuery {
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
  const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '2000', 10) || 2000;
  const limit = Math.min(10000, Math.max(1, limitRaw));
  return { offset, limit };
}

export type MetricsPageResult = PageResult<MetricsSample> & { header: string[] };

export async function readMetricsPage(
  runDir: string,
  query: MetricsPageQuery
): Promise<MetricsPageResult> {
  const filePath = join(runDir, 'metrics.csv');
  await stat(filePath);

  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  const rows: MetricsSample[] = [];
  let header: string[] = [];
  let lineNo = 0;
  let dataIdx = 0;
  let extraFound = false;

  try {
    for await (const line of rl) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      if (lineNo === 0) {
        header = trimmed.split(',');
        lineNo += 1;
        continue;
      }
      if (dataIdx < query.offset) {
        dataIdx += 1;
        continue;
      }
      if (rows.length < query.limit) {
        const values = trimmed.split(',');
        const sample: MetricsSample = { tick: 0, timestamp: 0 };
        for (let j = 0; j < header.length; j += 1) {
          const key = header[j];
          if (!key) continue;
          const v = values[j];
          const num = Number(v);
          (sample as any)[key] = Number.isNaN(num) ? (v ?? '') : num;
        }
        rows.push(sample);
        dataIdx += 1;
        continue;
      }
      extraFound = true;
      break;
    }
  } finally {
    rl.close();
    stream.close();
  }

  return {
    offset: query.offset,
    limit: query.limit,
    nextOffset: query.offset + rows.length,
    hasMore: extraFound,
    header,
    rows,
  };
}

export type GossipRow = {
  tick: number;
  timestamp: number;
  kind: 'gossip_post' | 'gossip_deliver';
  messageId: string;
  recipientAgentId?: string;
  message?: {
    envelope?: { authorAgentId?: string; channelId?: string };
    payload?: { text?: string };
  };
};

export type GossipPageQuery = {
  offset: number;
  limit: number;
  agentIdContains?: string;
  channelId?: string;
  kind?: 'gossip_post' | 'gossip_deliver';
};

export function parseGossipPageQuery(url: URL): GossipPageQuery {
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
  const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '200', 10) || 200;
  const limit = Math.min(5000, Math.max(1, limitRaw));
  const agentIdContains =
    url.searchParams.get('agentId') ?? url.searchParams.get('agentIdContains');
  const channelId = url.searchParams.get('channelId');
  const kindRaw = url.searchParams.get('kind');
  const kind = kindRaw === 'gossip_post' || kindRaw === 'gossip_deliver' ? kindRaw : undefined;
  return {
    offset,
    limit,
    ...(agentIdContains ? { agentIdContains } : {}),
    ...(channelId ? { channelId } : {}),
    ...(kind ? { kind } : {}),
  };
}

export async function readGossipPage(
  runDir: string,
  query: GossipPageQuery
): Promise<PageResult<GossipRow>> {
  const filePath = join(runDir, 'gossip.ndjson');
  await stat(filePath);

  const needle = normalizeNeedle(query.agentIdContains);
  const channelNeedle = normalizeNeedle(query.channelId);
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  const rows: GossipRow[] = [];
  let matchIdx = 0;
  let extraFound = false;
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row: GossipRow;
      try {
        row = JSON.parse(trimmed) as GossipRow;
      } catch {
        continue;
      }
      if (query.kind && row.kind !== query.kind) continue;
      if (needle) {
        const author = String((row as any).message?.envelope?.authorAgentId ?? '').toLowerCase();
        const recip = String((row as any).recipientAgentId ?? '').toLowerCase();
        if (!author.includes(needle) && !recip.includes(needle)) continue;
      }
      if (channelNeedle) {
        const chan = String((row as any).message?.envelope?.channelId ?? '').toLowerCase();
        if (!chan.includes(channelNeedle)) continue;
      }
      if (matchIdx < query.offset) {
        matchIdx += 1;
        continue;
      }
      if (rows.length < query.limit) {
        rows.push(row);
        matchIdx += 1;
        continue;
      }
      extraFound = true;
      break;
    }
  } finally {
    rl.close();
    stream.close();
  }

  return {
    offset: query.offset,
    limit: query.limit,
    nextOffset: query.offset + rows.length,
    hasMore: extraFound,
    rows,
  };
}

export type MemorySnapshotRow = {
  tick: number;
  timestamp: number;
  agentId: string;
  agentType: string;
  memory: unknown;
};

export type MemoryPageQuery = {
  offset: number;
  limit: number;
  agentIdContains?: string;
};

export function parseMemoryPageQuery(url: URL): MemoryPageQuery {
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
  const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '200', 10) || 200;
  const limit = Math.min(2000, Math.max(1, limitRaw));
  const agentIdContains =
    url.searchParams.get('agentId') ?? url.searchParams.get('agentIdContains');
  return {
    offset,
    limit,
    ...(agentIdContains ? { agentIdContains } : {}),
  };
}

export async function readMemoryPage(
  runDir: string,
  query: MemoryPageQuery
): Promise<PageResult<MemorySnapshotRow>> {
  const filePath = join(runDir, 'agent_memory.ndjson');
  try {
    await stat(filePath);
  } catch {
    // Some runs do not capture memory snapshots. Return an empty page instead of throwing.
    return {
      offset: query.offset,
      limit: query.limit,
      nextOffset: query.offset,
      hasMore: false,
      rows: [],
    };
  }

  const needle = normalizeNeedle(query.agentIdContains);
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  const rows: MemorySnapshotRow[] = [];
  let matchIdx = 0;
  let extraFound = false;
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row: MemorySnapshotRow;
      try {
        row = JSON.parse(trimmed) as MemorySnapshotRow;
      } catch {
        continue;
      }
      if (needle) {
        const id = String((row as any).agentId ?? '').toLowerCase();
        if (!id.includes(needle)) continue;
      }
      if (matchIdx < query.offset) {
        matchIdx += 1;
        continue;
      }
      if (rows.length < query.limit) {
        rows.push(row);
        matchIdx += 1;
        continue;
      }
      extraFound = true;
      break;
    }
  } finally {
    rl.close();
    stream.close();
  }

  return {
    offset: query.offset,
    limit: query.limit,
    nextOffset: query.offset + rows.length,
    hasMore: extraFound,
    rows,
  };
}

export type AgentSummaryRow = {
  agentId: string;
  agentType: string;
  actions: number;
  ok: number;
  fail: number;
  lastTick: number;
  lastError?: string;
};

export async function summarizeAgentsFromActions(runDir: string): Promise<AgentSummaryRow[]> {
  const filePath = join(runDir, 'actions.ndjson');
  await stat(filePath);

  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  const map = new Map<string, AgentSummaryRow>();

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row: RecordedAction;
      try {
        row = JSON.parse(trimmed) as RecordedAction;
      } catch {
        continue;
      }
      const agentId = String((row as any).agentId ?? '-');
      const agentType = String((row as any).agentType ?? '-');
      const tick = Number((row as any).tick ?? 0);
      const ok = (row as any).result?.ok === true;
      const error = typeof (row as any).result?.error === 'string' ? (row as any).result.error : '';

      const curr = map.get(agentId) ?? {
        agentId,
        agentType,
        actions: 0,
        ok: 0,
        fail: 0,
        lastTick: -1,
      };

      const next: AgentSummaryRow = {
        ...curr,
        agentType,
        actions: curr.actions + 1,
        ok: curr.ok + (ok ? 1 : 0),
        fail: curr.fail + (ok ? 0 : 1),
        lastTick: Math.max(curr.lastTick, tick),
        ...(error && !ok ? { lastError: error } : {}),
      };
      map.set(agentId, next);
    }
  } finally {
    rl.close();
    stream.close();
  }

  return [...map.values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
}
