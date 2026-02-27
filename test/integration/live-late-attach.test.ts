import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

async function connectWs(url: string, seen: string[], timeoutMs = 15_000): Promise<WebSocket> {
  const start = Date.now();
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      const ws = new WebSocket(url);
      ws.on('message', (buf) => {
        seen.push(String(buf));
      });
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ws_timeout')), 3000);
        ws.on('open', () => {
          clearTimeout(t);
          resolve();
        });
        ws.on('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });
      return ws;
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error('ws_connect_timeout');
      await delay(Math.min(800, 50 + attempt * 50));
    }
  }
}

async function getFreePort(host: string): Promise<number> {
  const srv = createNetServer();
  await new Promise<void>((resolve, reject) => {
    srv.on('error', reject);
    srv.listen(0, host, () => resolve());
  });
  const addr = srv.address();
  const port = addr && typeof addr !== 'string' ? addr.port : 0;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  if (!port) throw new Error('failed_to_allocate_port');
  return port;
}

describe('Live websocket (late attach)', () => {
  it('replays simulation_start to clients connecting mid-run', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'agentforge-live-late-'));
    const host = '127.0.0.1';
    const livePort = await getFreePort(host);
    const child = spawn(
      'npx',
      [
        '-s',
        'tsx',
        CLI_PATH,
        'run',
        '--toy',
        '--mode',
        'deterministic',
        '--ticks',
        '8000',
        '--seed',
        '123',
        '--out',
        outDir,
        '--live',
        '--live-host',
        host,
        '--live-port',
        String(livePort),
        '--json',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    // Give it a moment to start and broadcast simulation_start before we connect.
    await delay(250);

    const seen: string[] = [];
    const ws = await connectWs(`ws://${host}:${livePort}`, seen, 15_000);

    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() - start > 10_000) {
        throw new Error('timeout_waiting_for_simulation_start');
      }
      if (seen.some((s) => s.includes('"type":"simulation_start"'))) break;
      await delay(30);
    }

    ws.close();
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  }, 30_000);
});
