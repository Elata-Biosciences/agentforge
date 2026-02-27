import { exec } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

describe('CLI: forge-sim studio', () => {
  it('self-checks /api/health and exits', async () => {
    const { stdout } = await execAsync(`npx tsx ${CLI_PATH} studio --port 0 --check`);
    expect(stdout).toContain('Studio running');
  }, 30000);
});
