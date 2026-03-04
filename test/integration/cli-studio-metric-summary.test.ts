import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

async function waitFor<T>(
  fn: () => T | null | undefined,
  options: { timeoutMs: number; intervalMs: number }
): Promise<T> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const v = fn();
    if (v !== null && v !== undefined) return v;
    if (Date.now() - start > options.timeoutMs) throw new Error('timeout');
    await delay(options.intervalMs);
  }
}

describe('Studio stats: metric summary (A/B)', () => {
  it('summarizes a metric across multiple runIds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentforge-studio-ab-'));
    const child = spawn(
      'npx',
      ['-s', 'tsx', CLI_PATH, 'studio', '--host', '127.0.0.1', '--port', '0', '--root', root],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });

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

    const baseUrl = await waitFor(
      () => {
        const plain = stripAnsi(stdout);
        const m = /Studio running:\s+(http:\/\/[^\s]+)/.exec(plain);
        return m?.[1] ?? null;
      },
      { timeoutMs: 20_000, intervalMs: 50 }
    );

    // Establish /api/ws (ensures server is ready and keeps consistent behavior with UI).
    const wsUrl = `${baseUrl.replace('http://', 'ws://')}api/ws`;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    async function startToyAndWait(seed: number, expectedCount: number): Promise<any[]> {
      const resp = await fetch(`${baseUrl}api/runs/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toy: true, mode: 'deterministic', outDir: root, ticks: 15, seed }),
      });
      expect(resp.status).toBe(200);
      const j = (await resp.json()) as any;
      expect(j.ok).toBe(true);

      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const listResp = await fetch(`${baseUrl}api/runs`);
        const listJson = (await listResp.json()) as any;
        const list = Array.isArray(listJson.runs) ? (listJson.runs as any[]) : [];
        if (list.length >= expectedCount) return list;
        await delay(300);
      }
      throw new Error(`timeout_waiting_for_runs (expected ${expectedCount})`);
    }

    await startToyAndWait(1, 1);
    const runs = await startToyAndWait(2, 2);

    const runIds = runs.slice(0, 2).map((r: any) => String(r.id));
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

    ws.close();
    child.kill('SIGTERM');
  }, 120_000);
});
