import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseActionsPageQuery,
  parseGossipPageQuery,
  parseMemoryPageQuery,
  parseMetricsPageQuery,
  readActionsPage,
  readGossipPage,
  readMemoryPage,
  readMetricsPage,
  summarizeAgentsFromActions,
} from '../../src/studio/io/pagedArtifacts.js';

describe('Studio paged artifacts', () => {
  it('pages actions.ndjson with offset/limit and filters', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentforge-paged-'));

    const lines = [
      {
        tick: 0,
        agentId: 'A',
        agentType: 'X',
        action: { name: 'do', id: '1', params: {} },
        result: { ok: true },
      },
      {
        tick: 1,
        agentId: 'B',
        agentType: 'Y',
        action: { name: 'do', id: '2', params: {} },
        result: { ok: false, error: 'revert' },
      },
      {
        tick: 2,
        agentId: 'A',
        agentType: 'X',
        action: { name: 'do', id: '3', params: {} },
        result: { ok: true },
      },
      {
        tick: 3,
        agentId: 'A',
        agentType: 'X',
        action: { name: 'do', id: '4', params: {} },
        result: { ok: false, error: 'nope' },
      },
    ];
    await writeFile(
      join(dir, 'actions.ndjson'),
      `${lines.map((x) => JSON.stringify(x)).join('\n')}\n`
    );

    const u = new URL('http://x/api/runs/id/actions?offset=0&limit=2&agentId=A&ok=true');
    const q = parseActionsPageQuery(u);
    const page = await readActionsPage(dir, q);
    expect(page.rows.length).toBe(2);
    expect(page.rows.every((r) => (r as any).agentId === 'A')).toBe(true);
    expect(page.rows.every((r) => (r as any).result?.ok === true)).toBe(true);
    expect(page.nextOffset).toBe(2);
  });

  it('pages metrics.csv with offset/limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentforge-metrics-'));
    await writeFile(
      join(dir, 'metrics.csv'),
      `${['tick,timestamp,totalVolume', '0,10,1', '1,11,2', '2,12,3', '3,13,4'].join('\n')}\n`
    );

    const u = new URL('http://x/api/runs/id/metrics?offset=1&limit=2');
    const q = parseMetricsPageQuery(u);
    const page = await readMetricsPage(dir, q);
    expect(page.header).toEqual(['tick', 'timestamp', 'totalVolume']);
    expect(page.rows.length).toBe(2);
    expect((page.rows[0] as any).tick).toBe(1);
    expect((page.rows[1] as any).tick).toBe(2);
    expect(page.nextOffset).toBe(3);
  });

  it('summarizes agents from actions stream', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentforge-agents-'));
    await writeFile(
      join(dir, 'actions.ndjson'),
      `${[
        JSON.stringify({ tick: 1, agentId: 'A', agentType: 'T', result: { ok: true } }),
        JSON.stringify({
          tick: 2,
          agentId: 'A',
          agentType: 'T',
          result: { ok: false, error: 'revert' },
        }),
        JSON.stringify({ tick: 3, agentId: 'B', agentType: 'U', result: { ok: true } }),
      ].join('\n')}\n`
    );
    const agents = await summarizeAgentsFromActions(dir);
    const a = agents.find((x) => x.agentId === 'A');
    expect(a).toBeTruthy();
    expect(a?.actions).toBe(2);
    expect(a?.fail).toBe(1);
    expect(a?.lastTick).toBe(2);
  });

  it('pages agent_memory.ndjson with offset/limit and agent filter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentforge-memory-'));
    const lines = [
      { tick: 0, timestamp: 10, agentId: 'A', agentType: 'T', memory: { x: 1 } },
      { tick: 0, timestamp: 10, agentId: 'B', agentType: 'U', memory: { y: 2 } },
      { tick: 1, timestamp: 11, agentId: 'A', agentType: 'T', memory: { x: 2 } },
      { tick: 2, timestamp: 12, agentId: 'A', agentType: 'T', memory: { x: 3 } },
    ];
    await writeFile(
      join(dir, 'agent_memory.ndjson'),
      `${lines.map((x) => JSON.stringify(x)).join('\n')}\n`
    );

    const u = new URL('http://x/api/runs/id/memory?offset=1&limit=2&agentId=A');
    const q = parseMemoryPageQuery(u);
    const page = await readMemoryPage(dir, q);
    expect(page.rows.length).toBe(2);
    expect(page.rows.every((r) => (r as any).agentId === 'A')).toBe(true);
    expect((page.rows[0] as any).tick).toBe(1);
  });

  it('pages gossip.ndjson with offset/limit and filters', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentforge-gossip-'));
    const lines = [
      {
        tick: 0,
        timestamp: 10,
        kind: 'gossip_post',
        messageId: 'm1',
        message: { envelope: { authorAgentId: 'A', channelId: 'global' }, payload: { text: 'hi' } },
      },
      {
        tick: 0,
        timestamp: 10,
        kind: 'gossip_deliver',
        messageId: 'm1',
        recipientAgentId: 'B',
        message: { envelope: { authorAgentId: 'A', channelId: 'global' }, payload: { text: 'hi' } },
      },
      {
        tick: 1,
        timestamp: 11,
        kind: 'gossip_post',
        messageId: 'm2',
        message: {
          envelope: { authorAgentId: 'C', channelId: 'markets' },
          payload: { text: 'price' },
        },
      },
    ];
    await writeFile(
      join(dir, 'gossip.ndjson'),
      `${lines.map((x) => JSON.stringify(x)).join('\n')}\n`
    );

    const u = new URL(
      'http://x/api/runs/id/gossip?offset=0&limit=10&agentId=A&channelId=global&kind=gossip_post'
    );
    const q = parseGossipPageQuery(u);
    const page = await readGossipPage(dir, q);
    expect(page.rows.length).toBe(1);
    expect((page.rows[0] as any).kind).toBe('gossip_post');
    expect((page.rows[0] as any).message?.envelope?.authorAgentId).toBe('A');
  });
});
