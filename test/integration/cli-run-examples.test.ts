import { exec } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

describe('CLI: forge-sim run (examples)', () => {
  let testDir: string;
  let outDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentforge-examples-${Date.now()}`);
    outDir = join(testDir, 'results');
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('runs timing-auction example successfully (json)', async () => {
    const scenarioPath = join(
      process.cwd(),
      'examples',
      'mechanism-experiments',
      'timing-auction',
      'scenario.ts'
    );
    const { stdout } = await execAsync(
      `npx tsx ${CLI_PATH} run ${scenarioPath} --json --ci --out ${outDir}`,
      {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    const payload = JSON.parse(stdout.trim()) as any;
    expect(payload.success).toBe(true);
    expect(payload.scenarioName).toBe('timing-auction');
  });
});
