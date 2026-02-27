import { exec } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

describe('CLI: forge-sim serve', () => {
  let testDir: string;
  let runDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentforge-serve-test-${Date.now()}`);
    runDir = join(testDir, 'run');
    await mkdir(join(runDir, 'dashboard'), { recursive: true });
    await writeFile(join(runDir, 'dashboard', 'index.html'), '<!doctype html><div>ok</div>\n');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('self-checks a served dashboard', async () => {
    const { stdout } = await execAsync(`npx tsx ${CLI_PATH} serve ${runDir} --port 0 --check`);
    expect(stdout).toContain('Serving dashboard');
  }, 30000);
});
