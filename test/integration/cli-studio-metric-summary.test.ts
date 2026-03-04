import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

function stripAnsi(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) === 27) {
      while (i < s.length && s[i] !== 'm') i += 1;
      continue;
    }
    out += s[i] ?? '';
  }
  return out;
}

function fakeSummary(runId: string, ts: string): string {
  return JSON.stringify({
    runId,
    scenarioName: 'toy-market',
    timestamp: ts,
    seed: 1,
    ticks: 5,
    durationMs: 100,
    success: true,
    agentCount: 2,
  });
}

function fakeConfig(): string {
  return JSON.stringify({ scenario: { name: 'toy-market' } });
}

function fakeMetricsCsv(): string {
  return [
    'tick,totalVolume,price',
    '1,100,10',
    '2,200,11',
    '3,300,12',
    '4,400,13',
    '5,500,14',
  ].join('\n');
}

function fakeActions(): string {
  return [
    JSON.stringify({ tick: 1, agentId: 'a1', action: 'swap', params: {} }),
    JSON.stringify({ tick: 2, agentId: 'a1', action: 'swap', params: {} }),
  ].join('\n');
}

async function createFakeRun(root: string, runId: string, ts: string): Promise<string> {
  const dir = join(root, runId);
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(join(dir, 'summary.json'), fakeSummary(runId, ts)),
    writeFile(join(dir, 'config_resolved.json'), fakeConfig()),
    writeFile(join(dir, 'metrics.csv'), fakeMetricsCsv()),
    writeFile(join(dir, 'actions.ndjson'), fakeActions()),
  ]);
  return dir;
}

describe('Studio stats: metric summary (A/B)', () => {
  it('summarizes a metric across multiple runIds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentforge-studio-ab-'));

    await createFakeRun(root, 'run-a', '2025-01-01T00:00:00.000Z');
    await createFakeRun(root, 'run-b', '2025-01-01T00:01:00.000Z');

    const child = spawn(
      'npx',
      ['-s', 'tsx', CLI_PATH, 'studio', '--host', '127.0.0.1', '--port', '0', '--root', root],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });

    try {
      const start = Date.now();
      let baseUrl: string | null = null;
      while (Date.now() - start < 20_000) {
        const plain = stripAnsi(stdout);
        const m = /Studio running:\s+(http:\/\/[^\s]+)/.exec(plain);
        if (m?.[1]) {
          baseUrl = m[1];
          break;
        }
        await delay(50);
      }
      if (!baseUrl) throw new Error('timeout_waiting_for_studio_url');

      const listResp = await fetch(`${baseUrl}api/runs`);
      expect(listResp.status).toBe(200);
      const listPayload = (await listResp.json()) as any;
      const runs = Array.isArray(listPayload.runs) ? (listPayload.runs as any[]) : [];
      expect(runs.length).toBe(2);

      const runIds = runs.map((r: any) => String(r.id));
      const metricKey = 'totalVolume';

      const resp = await fetch(`${baseUrl}api/stats/metric-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runIds, metricKey }),
      });
      expect(resp.status).toBe(200);
      const payload = (await resp.json()) as any;
      expect(payload.ok).toBe(true);
      expect(payload.metricKey).toBe(metricKey);
      expect(Array.isArray(payload.rows)).toBe(true);
      expect(payload.rows.length).toBe(2);
      expect(payload.rows[0].summary).not.toBeNull();
      expect(payload.rows[1].summary).not.toBeNull();
    } finally {
      child.kill('SIGTERM');
    }
  }, 30_000);
});
