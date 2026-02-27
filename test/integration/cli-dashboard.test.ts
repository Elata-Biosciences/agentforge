import { exec } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

describe('CLI: forge-sim dashboard', () => {
  let testDir: string;
  let runDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentforge-dashboard-test-${Date.now()}`);
    runDir = join(testDir, 'test-run');
    await mkdir(runDir, { recursive: true });

    const summary = {
      runId: 'test-run',
      scenarioName: 'test-scenario',
      seed: 42,
      ticks: 3,
      durationMs: 100,
      success: true,
      failedAssertions: [],
      finalMetrics: { exploitsFound: 1, tick: 2 },
      agentStats: [
        {
          id: 'agent-0',
          type: 'TestAgent',
          actionsAttempted: 3,
          actionsSucceeded: 3,
          actionsFailed: 0,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    const config = {
      scenario: {
        name: 'test-scenario',
        seed: 42,
        ticks: 3,
        tickSeconds: 1,
        packName: 'TestPack',
        agentCount: 1,
        agentTypes: [{ type: 'TestAgent', count: 1 }],
        mode: 'deterministic',
        studio: {
          report: {
            v: 'v1',
            blocks: [
              { kind: 'markdown', markdown: '# Report' },
              {
                kind: 'dataset',
                as: 'm',
                table: 'metrics',
                spec: { v: 'v1', select: ['tick', 'exploitsFound'], limit: 10 },
              },
              {
                kind: 'chart',
                chartType: 'line',
                dataset: 'm',
                xField: 'tick',
                yField: 'exploitsFound',
              },
            ],
          },
        },
      },
      options: {},
    };

    const actions = [
      {
        tick: 0,
        timestamp: 0,
        agentId: 'agent-0',
        agentType: 'TestAgent',
        action: { id: 'a1', name: 'QueryWorld', params: { endpoint: 'get_world' } },
        result: { ok: true },
        durationMs: 1,
      },
      {
        tick: 1,
        timestamp: 1,
        agentId: 'agent-0',
        agentType: 'TestAgent',
        action: { id: 'a2', name: 'exploit_x', params: {} },
        result: { ok: true, txHash: '0xabc', gasUsed: '21000' },
        durationMs: 1,
      },
    ];

    const metricsCSV = 'tick,timestamp,exploitsFound\n0,0,0\n1,1,1\n2,2,1';

    await writeFile(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    await writeFile(join(runDir, 'config_resolved.json'), `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(
      join(runDir, 'actions.ndjson'),
      actions.map((a) => JSON.stringify(a)).join('\n')
    );
    await writeFile(join(runDir, 'metrics.csv'), metricsCSV);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('generates a static dashboard folder', async () => {
    const { stdout } = await execAsync(`npx tsx ${CLI_PATH} dashboard ${runDir}`);
    expect(stdout).toContain('Dashboard written to');

    const dashboardPath = join(runDir, 'dashboard', 'index.html');
    const html = await readFile(dashboardPath, 'utf-8');
    expect(html).toContain('AgentForge Dashboard');
    expect(html).toContain('window.__AF_DATA__');
    expect(html).toContain('test-scenario');
    expect(html).toContain('"report"');
    expect(html).toContain('"kind":"markdown"');

    // Ensure the referenced entry asset exists (prevents blank screens).
    const m = /src="\.\/(assets\/index-[^"]+\.js)"/.exec(html);
    expect(m?.[1]).toBeTruthy();
    await expect(stat(join(runDir, 'dashboard', String(m?.[1] ?? '')))).resolves.toBeTruthy();
  });
});
