import { exec } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

async function runJson(cmd: string): Promise<any> {
  const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout.trim() || '{}');
}

async function buildDashboard(runDir: string): Promise<string> {
  await execAsync(`npx tsx ${CLI_PATH} dashboard ${runDir}`, { maxBuffer: 10 * 1024 * 1024 });
  return readFile(join(runDir, 'dashboard', 'index.html'), 'utf-8');
}

describe('Report examples (dashboard)', () => {
  it('includes report payload for toy-market, timing-auction, and toy-chaos', async () => {
    const outA = await mkdtemp(join(tmpdir(), 'agentforge-report-toy-market-'));
    const outB = await mkdtemp(join(tmpdir(), 'agentforge-report-timing-auction-'));
    const outC = await mkdtemp(join(tmpdir(), 'agentforge-report-toy-chaos-'));

    const toy = await runJson(
      `npx tsx ${CLI_PATH} run --toy --seed 1 --ticks 40 --out ${outA} --json`
    );
    expect(toy.success).toBe(true);
    const toyHtml = await buildDashboard(String(toy.outputDir));
    expect(toyHtml).toContain('"report"');
    expect(toyHtml).toContain('"kind":"ml"');
    expect(toyHtml).toContain('"chartType":"line"');
    expect(toyHtml).toContain('"chartType":"bar"');
    expect(toyHtml).toContain('ml_pca_prices.variance');

    const timingScenario = resolve(
      process.cwd(),
      'examples',
      'mechanism-experiments',
      'timing-auction',
      'scenario.ts'
    );
    const timing = await runJson(
      `npx tsx ${CLI_PATH} run ${timingScenario} --ticks 100 --out ${outB} --json`
    );
    expect(timing.success).toBe(true);
    const timingHtml = await buildDashboard(String(timing.outputDir));
    expect(timingHtml).toContain('"report"');
    expect(timingHtml).toContain('Timing Auction Report');
    expect(timingHtml).toContain('"chartType":"bar"');

    const chaosScenario = resolve(process.cwd(), 'examples', 'toy-chaos', 'scenario.ts');
    const chaos = await runJson(
      `npx tsx ${CLI_PATH} run ${chaosScenario} --mode exploration --ticks 60 --out ${outC} --json`
    );
    expect(chaos.success).toBe(true);
    const chaosHtml = await buildDashboard(String(chaos.outputDir));
    expect(chaosHtml).toContain('"report"');
    expect(chaosHtml).toContain('Toy Chaos Report');
  }, 120_000);
});
