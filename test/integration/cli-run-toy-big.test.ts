import { exec } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

describe('CLI: forge-sim run --toy (big-ish)', () => {
  it('supports agent count flags and completes successfully', async () => {
    const out = await mkdtemp(join(tmpdir(), 'agentforge-toy-big-'));
    const { stdout } = await execAsync(
      `npx tsx ${CLI_PATH} run --toy --mode deterministic --seed 123 --ticks 250 --out ${out} --toy-traders 40 --toy-momentum 12 --toy-holders 4 --json`,
      { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout.trim() || '{}') as any;
    expect(parsed.success).toBe(true);
    expect(typeof parsed.outputDir).toBe('string');
    const summaryRaw = await readFile(join(parsed.outputDir, 'summary.json'), 'utf-8');
    const summary = JSON.parse(summaryRaw) as any;
    expect(summary.scenarioName).toBe('toy-market');
  }, 60000);
});
