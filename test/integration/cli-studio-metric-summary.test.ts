import { exec, spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
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

describe('Studio stats: metric summary (A/B)', () => {
  it('summarizes a metric across multiple runIds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentforge-studio-ab-'));

    // Pre-create 2 completed runs via the CLI so their artifacts exist on disk.
    await execAsync(`npx tsx ${CLI_PATH} run --toy --ticks 15 --seed 1 --out ${root} --json`, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    await execAsync(`npx tsx ${CLI_PATH} run --toy --ticks 15 --seed 2 --out ${root} --json`, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Start studio pointing at the root that already contains both runs.
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

      // Verify the studio lists both runs.
      const listResp = await fetch(`${baseUrl}api/runs`);
      expect(listResp.status).toBe(200);
      const listPayload = (await listResp.json()) as any;
      const runs = Array.isArray(listPayload.runs) ? (listPayload.runs as any[]) : [];
      expect(runs.length).toBeGreaterThanOrEqual(2);

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
    } finally {
      child.kill('SIGTERM');
    }
  }, 90_000);
});
