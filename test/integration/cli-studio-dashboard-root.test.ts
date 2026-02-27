import { exec, spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');
const execAsync = promisify(exec);

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

function stripAnsi(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) === 27 /* ESC */) {
      while (i < s.length && s[i] !== 'm') i += 1;
      continue;
    }
    out += s[i] ?? '';
  }
  return out;
}

describe('CLI: forge-sim studio (dashboard root)', () => {
  it('serves /runs/:id/dashboard/ as index.html', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentforge-studio-dashroot-'));
    const { stdout: runOut } = await execAsync(
      `npx tsx ${CLI_PATH} run --toy --out ${root} --ticks 80 --seed 123 --json`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    const runJson = JSON.parse(runOut.trim() || '{}') as any;
    expect(runJson.success).toBe(true);
    const runDir = String(runJson.outputDir ?? '');
    expect(runDir.length).toBeGreaterThan(0);
    await execAsync(`npx tsx ${CLI_PATH} dashboard ${runDir}`, { maxBuffer: 10 * 1024 * 1024 });

    const child = spawn(
      'npx',
      ['-s', 'tsx', CLI_PATH, 'studio', '--host', '127.0.0.1', '--port', '0', '--root', root],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr?.on('data', () => {
      // ignore
    });

    const baseUrl = await waitFor(
      () => {
        const plain = stripAnsi(stdout);
        const m = /Studio running:\s+(http:\/\/[^\s]+)/.exec(plain);
        return m?.[1] ?? null;
      },
      { timeoutMs: 20_000, intervalMs: 50 }
    );

    const listResp = await fetch(`${baseUrl}api/runs`);
    expect(listResp.status).toBe(200);
    const listPayload = (await listResp.json()) as any;
    const runs = Array.isArray(listPayload.runs) ? listPayload.runs : [];
    const entry = runs.find((r: any) => String(r.runDir ?? '') === runDir) ?? null;
    expect(entry).toBeTruthy();
    const id = String(entry.id ?? '');
    expect(id.length).toBeGreaterThan(0);

    const dashResp = await fetch(`${baseUrl}runs/${id}/dashboard/`);
    expect(dashResp.status).toBe(200);
    const html = await dashResp.text();
    expect(html).toContain('window.__AF_DATA__');

    child.kill('SIGTERM');
  }, 90_000);
});
