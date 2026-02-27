import { exec } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

describe('CLI: forge-sim dashboard (large)', () => {
  it('writes data.json instead of inlining huge payload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentforge-large-dash-'));
    const runDir = join(root, 'run');
    await mkdir(runDir, { recursive: true });

    // Minimal artifacts required by parseRunArtifacts.
    await writeFile(
      join(runDir, 'summary.json'),
      `${JSON.stringify({
        runId: 'large-test',
        scenarioName: 'large-test',
        seed: 1,
        ticks: 1,
        tickSeconds: 1,
        timestamp: new Date().toISOString(),
        durationMs: 1,
        success: true,
        agentCount: 1,
        agentTypes: [],
        finalMetrics: { tick: 0 },
        failedAssertions: [],
      })}\n`
    );
    await writeFile(join(runDir, 'config_resolved.json'), `${JSON.stringify({ scenario: {} })}\n`);
    await writeFile(join(runDir, 'metrics.csv'), 'tick,timestamp,exploitsFound\n0,0,0\n');

    // One NDJSON line with a very large blob to force the size threshold.
    const big = 'x'.repeat(6 * 1024 * 1024);
    await writeFile(
      join(runDir, 'actions.ndjson'),
      `${JSON.stringify({
        tick: 0,
        agentId: 'a',
        agentType: 't',
        action: { name: 'noop' },
        result: { ok: true, blob: big },
      })}\n`
    );

    await execAsync(`npx tsx ${CLI_PATH} dashboard ${runDir} --no-git`);

    const dashDir = join(runDir, 'dashboard');
    expect((await stat(dashDir)).isDirectory()).toBe(true);

    const indexHtml = await readFile(join(dashDir, 'index.html'), 'utf-8');
    expect(indexHtml).toContain('window.__AF_DATA_URL__');
    expect(indexHtml).not.toContain('window.__AF_DATA__ = {');

    expect((await stat(join(dashDir, 'data.json'))).isFile()).toBe(true);
  }, 60000);
});
