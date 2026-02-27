import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('Studio: auto dashboard generation', () => {
  it('auto-generates a dashboard for Studio-started runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentforge-studio-autodash-'));

    const child = spawn(
      'npx',
      ['-s', 'tsx', CLI_PATH, 'studio', '--host', '127.0.0.1', '--port', '0', '--root', root],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    try {
      const baseUrl = await waitForStudioBaseUrl(child);

      const startResp = await fetch(`${baseUrl}api/runs/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toy: true,
          mode: 'deterministic',
          outDir: root,
          seed: 123,
          ticks: 60,
          // keep default captureMemory=true
        }),
      });
      expect(startResp.status).toBe(200);
      const startPayload = (await startResp.json()) as any;
      expect(startPayload.ok).toBe(true);

      // Poll until the run shows up and its dashboard index includes injected data.
      const deadline = Date.now() + 60_000;
      let entry: any = null;
      let html: string | null = null;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (Date.now() > deadline) throw new Error('timeout_waiting_for_dashboard');
        const listResp = await fetch(`${baseUrl}api/runs`);
        expect(listResp.status).toBe(200);
        const listPayload = (await listResp.json()) as any;
        const runs = Array.isArray(listPayload.runs) ? listPayload.runs : [];
        entry = runs.find((r: any) => String(r.runDir ?? '').startsWith(root)) ?? null;
        if (entry) {
          const id = String(entry.id ?? '');
          if (id) {
            const dashResp = await fetch(`${baseUrl}runs/${id}/dashboard/`).catch(() => null);
            if (dashResp && dashResp.status === 200) {
              const body = await dashResp.text();
              if (body.includes('window.__AF_DATA__') || body.includes('window.__AF_DATA_URL__')) {
                html = body;
                break;
              }
            }
          }
        }
        await delay(250);
      }

      expect(entry).toBeTruthy();
      const id = String(entry.id ?? '');
      expect(id.length).toBeGreaterThan(0);

      expect(html).toBeTruthy();
      const s = String(html);
      expect(s.includes('window.__AF_DATA__') || s.includes('window.__AF_DATA_URL__')).toBe(true);
    } finally {
      child.kill('SIGTERM');
    }
  }, 90_000);
});
