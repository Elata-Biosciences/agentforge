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

async function connectWsWithRetry(url: string, timeoutMs = 15_000): Promise<WebSocket> {
  const start = Date.now();
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      const ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
      });
      return ws;
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error('ws_connect_timeout');
      await delay(Math.min(800, 60 + attempt * 50));
    }
  }
}

describe('CLI: forge-sim studio (live ws)', () => {
  it('proxies live events over /api/ws and reports run status', async () => {
    const child = spawn(
      'npx',
      ['-s', 'tsx', CLI_PATH, 'studio', '--live', '--host', '127.0.0.1', '--port', '0'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let stdout = '';
    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr?.on('data', () => {
      // ignore
    });

    function stripAnsi(s: string): string {
      // Avoid regex control characters for Biome; strip common ESC[...]m sequences.
      let out = '';
      for (let i = 0; i < s.length; i += 1) {
        if (s.charCodeAt(i) === 27 /* ESC */) {
          // Skip until the trailing 'm' (or end of string).
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

    const wsUrl = `${baseUrl.replace('http://', 'ws://')}api/ws`;
    const ws = await connectWsWithRetry(wsUrl, 10_000);
    const seen: any[] = [];
    ws.on('message', (buf) => {
      try {
        seen.push(JSON.parse(String(buf)));
      } catch {
        // ignore
      }
    });

    const resp = await fetch(`${baseUrl}api/runs/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toy: true,
        mode: 'deterministic',
        outDir: await mkdtemp(join(tmpdir(), 'agentforge-studio-live-')),
        // Keep it long enough that the live websocket stays up long enough to connect reliably.
        ticks: 5_000,
        seed: 123,
      }),
    });
    expect(resp.status).toBe(200);
    const payload = (await resp.json()) as any;
    expect(payload.ok).toBe(true);
    expect(typeof payload.liveWsUrl).toBe('string');
    const liveWsUrl = String(payload.liveWsUrl);
    const studioRunId = String(payload.studioRunId ?? '');
    expect(studioRunId.length).toBeGreaterThan(0);

    // The dashboard connects to the run's dedicated live websocket directly.
    // Connect immediately to avoid races with very fast runs.
    const liveWs = await connectWsWithRetry(liveWsUrl, 15_000);
    const liveSeen: any[] = [];
    liveWs.on('message', (buf) => {
      try {
        liveSeen.push(JSON.parse(String(buf)));
      } catch {
        // ignore
      }
    });

    await waitFor(() => seen.find((e) => e?.type === 'run_started') ?? null, {
      timeoutMs: 20_000,
      intervalMs: 50,
    });

    // Studio should also emit a run_status update.
    await waitFor(
      () =>
        seen.find(
          (e) => e?.type === 'run_status' && e?.payload?.id === studioRunId && e?.payload?.status
        ) ?? null,
      { timeoutMs: 20_000, intervalMs: 50 }
    );

    await waitFor(
      () =>
        liveSeen.find((e) => e?.type === 'simulation_start') ??
        liveSeen.find((e) => e?.type === 'tick_start') ??
        null,
      { timeoutMs: 20_000, intervalMs: 50 }
    );

    liveWs.close();
    ws.close();
    child.kill('SIGTERM');
  }, 90_000);
});
