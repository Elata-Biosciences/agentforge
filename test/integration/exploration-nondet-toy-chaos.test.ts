import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

describe('Exploration mode (toy-chaos)', () => {
  it('can be non-deterministic even with same seed', async () => {
    const outA = await mkdtemp(join(tmpdir(), 'agentforge-toy-chaos-a-'));
    const outB = await mkdtemp(join(tmpdir(), 'agentforge-toy-chaos-b-'));

    const cmd = (out: string) =>
      `npx tsx ${CLI_PATH} run --toy --mode exploration --seed 777 --ticks 120 --out ${out} --toy-chaos 1 --json`;

    const { stdout: aOut } = await execAsync(cmd(outA));
    const { stdout: bOut } = await execAsync(cmd(outB));
    const a = JSON.parse(aOut.trim() || '{}') as any;
    const b = JSON.parse(bOut.trim() || '{}') as any;
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(typeof a.outputDir).toBe('string');
    expect(typeof b.outputDir).toBe('string');

    const actionsA = await readFile(join(a.outputDir, 'actions.ndjson'), 'utf-8');
    const actionsB = await readFile(join(b.outputDir, 'actions.ndjson'), 'utf-8');
    expect(sha256(actionsA)).not.toBe(sha256(actionsB));
  }, 60000);
});
