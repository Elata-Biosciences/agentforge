import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

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

async function waitForStudioBaseUrl(child: ReturnType<typeof spawn>): Promise<string> {
  let stdout = '';
  child.stdout?.on('data', (d) => {
    stdout += String(d);
  });
  child.stderr?.on('data', () => {
    // ignore
  });

  const start = Date.now();
  while (Date.now() - start < 20_000) {
    const plain = stripAnsi(stdout);
    const m = /Studio running:\s+(http:\/\/[^\s]+)/.exec(plain);
    const baseUrl = m?.[1] ?? null;
    if (baseUrl) return baseUrl;
    await delay(50);
  }
  throw new Error('timeout_waiting_for_studio_url');
}

describe('Gossip example (toy-chaos)', () => {
  it('records gossip_post + gossip_deliver and is queryable via Studio paging API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentforge-gossip-example-'));
    const scenarioPath = resolve(process.cwd(), 'examples', 'toy-chaos', 'scenario.ts');

    // Run the example.
    const runChild = spawn(
      'npx',
      [
        '-s',
        'tsx',
        CLI_PATH,
        'run',
        scenarioPath,
        '--mode',
        'exploration',
        '--ticks',
        '40',
        '--seed',
        '123',
        '--out',
        root,
        '--capture-memory',
        '--json',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let runStdout = '';
    runChild.stdout?.on('data', (d) => {
      runStdout += String(d);
    });
    runChild.stderr?.on('data', () => {
      // ignore
    });

    const exitCode: number = await new Promise((resolve) => {
      runChild.on('exit', (code) => resolve(code ?? 1));
    });
    expect(exitCode).toBe(0);
    const runJson = JSON.parse(runStdout.trim() || '{}') as any;
    expect(runJson.success).toBe(true);
    const runDir = String(runJson.outputDir ?? '');
    expect(runDir.length).toBeGreaterThan(0);

    const gossipRaw = await readFile(join(runDir, 'gossip.ndjson'), 'utf-8');
    const rows = gossipRaw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const posts = rows.filter((r: any) => r?.kind === 'gossip_post').length;
    const delivers = rows.filter((r: any) => r?.kind === 'gossip_deliver').length;
    expect(posts).toBeGreaterThan(0);
    expect(delivers).toBeGreaterThan(0);

    // Start Studio and verify /api/runs/:id/gossip returns rows.
    const studioChild = spawn(
      'npx',
      ['-s', 'tsx', CLI_PATH, 'studio', '--host', '127.0.0.1', '--port', '0', '--root', root],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    try {
      const baseUrl = await waitForStudioBaseUrl(studioChild);
      const listResp = await fetch(`${baseUrl}api/runs`);
      expect(listResp.status).toBe(200);
      const listPayload = (await listResp.json()) as any;
      const runs = Array.isArray(listPayload.runs) ? listPayload.runs : [];
      const entry = runs.find((r: any) => String(r.runDir ?? '') === runDir) ?? null;
      expect(entry).toBeTruthy();
      const id = String(entry.id ?? '');
      expect(id.length).toBeGreaterThan(0);

      const pageResp = await fetch(`${baseUrl}api/runs/${id}/gossip?offset=0&limit=200`);
      expect(pageResp.status).toBe(200);
      const page = (await pageResp.json()) as any;
      expect(page.ok).toBe(true);
      expect(Array.isArray(page.rows)).toBe(true);
      expect(page.rows.length).toBeGreaterThan(0);
    } finally {
      studioChild.kill('SIGTERM');
    }
  }, 120_000);
});
