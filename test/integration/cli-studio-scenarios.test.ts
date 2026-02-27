import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

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

function stripAnsi(s: string): string {
  // Avoid regex control characters for Biome; strip common ESC[...]m sequences.
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

describe('CLI: forge-sim studio (scenarios)', () => {
  it('lists bundled example scenarios via /api/scenarios', async () => {
    const child = spawn(
      'npx',
      ['-s', 'tsx', CLI_PATH, 'studio', '--host', '127.0.0.1', '--port', '0'],
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

    const resp = await fetch(`${baseUrl}api/scenarios`);
    expect(resp.status).toBe(200);
    const payload = (await resp.json()) as any;
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.scenarios)).toBe(true);
    expect(payload.scenarios.length).toBeGreaterThan(0);

    const wantedRel = 'examples/mechanism-experiments/timing-auction/scenario.ts';
    const found = payload.scenarios.find((s: any) => String(s.relPath).includes(wantedRel));
    expect(found).toBeTruthy();
    expect(String(found.scenarioPath).replaceAll('\\', '/')).toContain(wantedRel);

    child.kill();
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  }, 30000);
});
