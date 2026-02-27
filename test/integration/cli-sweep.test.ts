import { exec } from 'node:child_process';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

describe('CLI: forge-sim sweep', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentforge-sweep-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('runs sweep with --toy and generates reports', async () => {
    const outDir = join(testDir, 'sweep-results');

    const { stdout } = await execAsync(
      `npx tsx ${CLI_PATH} sweep --toy --seeds 1..3 --ticks 5 -o ${outDir}`
    );

    expect(stdout).toContain('Sweep');
    expect(stdout).toContain('3 runs');
  }, 30000);

  it('creates summary.csv with all seed results', async () => {
    const outDir = join(testDir, 'sweep-results');

    await execAsync(`npx tsx ${CLI_PATH} sweep --toy --seeds 1..3 --ticks 5 -o ${outDir}`);

    // Find the generated sweep directory
    const { readdir } = await import('node:fs/promises');
    const dirs = await readdir(outDir);
    expect(dirs.length).toBeGreaterThan(0);

    const sweepDir = join(outDir, dirs[0] as string);
    const csvPath = join(sweepDir, 'summary.csv');

    await access(csvPath);
    const csvContent = await readFile(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n');

    // Header + 3 data rows
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('seed');
    expect(lines[0]).toContain('success');
  }, 30000);

  it('creates report.md with statistics', async () => {
    const outDir = join(testDir, 'sweep-results');

    await execAsync(`npx tsx ${CLI_PATH} sweep --toy --seeds 1..3 --ticks 5 -o ${outDir}`);

    const { readdir } = await import('node:fs/promises');
    const dirs = await readdir(outDir);
    const sweepDir = join(outDir, dirs[0] as string);
    const reportPath = join(sweepDir, 'report.md');

    const reportContent = await readFile(reportPath, 'utf-8');

    expect(reportContent).toContain('# Sweep Report');
    expect(reportContent).toContain('## Configuration');
    expect(reportContent).toContain('## Results Summary');
    expect(reportContent).toContain('## Metric Statistics');
  }, 30000);

  it('creates one run directory per seed (no overwrites)', async () => {
    const outDir = join(testDir, 'sweep-results');
    await execAsync(`npx tsx ${CLI_PATH} sweep --toy --seeds 1..3 --ticks 5 -o ${outDir}`);

    const { readdir } = await import('node:fs/promises');
    const dirs = await readdir(outDir);
    const sweepDir = join(outDir, dirs[0] as string);

    const entries = await readdir(sweepDir, { withFileTypes: true });
    const runDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name.startsWith('toy-market-ci-seed-'));

    expect(runDirs.length).toBe(3);
  }, 30000);

  it('outputs JSON when --json flag is provided', async () => {
    const outDir = join(testDir, 'sweep-results');

    const { stdout } = await execAsync(
      `npx tsx ${CLI_PATH} sweep --toy --seeds 1..2 --ticks 5 -o ${outDir} --json`
    );

    const result = JSON.parse(stdout);
    expect(result.seeds).toBe(2);
    expect(result.successCount).toBeDefined();
    expect(result.metricStats).toBeDefined();
    expect(result.outputDir).toBeDefined();
  }, 30000);

  it('parses comma-separated seed list', async () => {
    const outDir = join(testDir, 'sweep-results');

    const { stdout } = await execAsync(
      `npx tsx ${CLI_PATH} sweep --toy --seeds 1,5,10 --ticks 5 -o ${outDir} --json`
    );

    const result = JSON.parse(stdout);
    expect(result.seeds).toBe(3);
  }, 30000);

  it('treats single number as count', async () => {
    const outDir = join(testDir, 'sweep-results');

    const { stdout } = await execAsync(
      `npx tsx ${CLI_PATH} sweep --toy --seeds 4 --ticks 5 -o ${outDir} --json`
    );

    const result = JSON.parse(stdout);
    expect(result.seeds).toBe(4);
  }, 30000);
});
