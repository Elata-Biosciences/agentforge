import { exec } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), 'src', 'cli', 'index.ts');

describe('CLI: forge-sim extract-agent', () => {
  let testDir: string;
  let bundlePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentforge-extract-agent-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    bundlePath = join(testDir, 'replay_bundle.json');

    const bundle = {
      version: 'v1',
      scenarioName: 'test-scenario',
      seed: 42,
      mode: 'exploration',
      actions: [
        { tick: 0, agentId: 'A', action: { id: 'a0', name: 'DoNothing', params: {} } },
        {
          tick: 1,
          agentId: 'A',
          action: {
            id: 'a1',
            name: 'ContractCall',
            params: { contract: 'X', function: 'f', args: [] },
          },
        },
        { tick: 2, agentId: 'B', action: { id: 'b2', name: 'DoNothing', params: {} } },
      ],
      messages: [],
      queries: [],
      arbitraryExecutions: [],
    };

    await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('writes an ExtractedAgent TypeScript file', async () => {
    const outPath = join(testDir, 'ExtractedAgent.ts');
    const { stdout } = await execAsync(
      `npx tsx ${CLI_PATH} extract-agent ${bundlePath} --agent-id A --output ${outPath}`
    );
    expect(stdout).toContain('Extracted agent written to');

    const content = await readFile(outPath, 'utf8');
    expect(content).toContain('export class ExtractedAgent');
    expect(content).toContain('ActionSequenceAgent');
    expect(content).toContain('ContractCall');
  });
});
