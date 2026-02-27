import { exec } from 'node:child_process';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), 'src/cli/index.ts');

describe('CLI: forge-sim init', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentforge-init-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('creates sim directory structure', async () => {
    await execAsync(`npx tsx ${CLI_PATH} init ${testDir}`);

    // Check that main directories exist
    const simDir = join(testDir, 'sim');
    await expect(access(simDir)).resolves.not.toThrow();

    const subdirs = ['scenarios', 'agents', 'packs', 'metrics', 'results', 'generated'];
    for (const subdir of subdirs) {
      const path = join(simDir, subdir);
      await expect(access(path)).resolves.not.toThrow();
    }
  });

  it('creates README.md in sim directory', async () => {
    await execAsync(`npx tsx ${CLI_PATH} init ${testDir}`);

    const readmePath = join(testDir, 'sim', 'README.md');
    await expect(access(readmePath)).resolves.not.toThrow();

    const content = await readFile(readmePath, 'utf-8');
    expect(content).toContain('AgentForge');
  });

  it('creates example scenario file', async () => {
    await execAsync(`npx tsx ${CLI_PATH} init ${testDir}`);

    const scenarioPath = join(testDir, 'sim', 'scenarios', 'example.ts');
    await expect(access(scenarioPath)).resolves.not.toThrow();

    const content = await readFile(scenarioPath, 'utf-8');
    expect(content).toContain('defineScenario');
  });

  it('supports --wizard scaffolding', async () => {
    await execAsync(`npx tsx ${CLI_PATH} init ${testDir} --wizard`);

    const baselineScenarioPath = join(testDir, 'sim', 'scenarios', 'baseline.ts');
    await expect(access(baselineScenarioPath)).resolves.not.toThrow();

    const reliabilityScriptPath = join(testDir, 'sim', 'scripts', 'run-reliability.ts');
    await expect(access(reliabilityScriptPath)).resolves.not.toThrow();

    const content = await readFile(baselineScenarioPath, 'utf-8');
    expect(content).toContain("name: 'baseline'");
  });

  it('supports --llm dry scaffolding from out/ artifacts', async () => {
    const { writeFile } = await import('node:fs/promises');
    // Minimal Foundry-ish shape with a single artifact
    await writeFile(join(testDir, 'foundry.toml'), '[profile.default]\n', 'utf-8');
    await mkdir(join(testDir, 'out', 'Foo.sol'), { recursive: true });
    await writeFile(
      join(testDir, 'out', 'Foo.sol', 'Foo.json'),
      JSON.stringify(
        {
          contractName: 'Foo',
          abi: [{ type: 'function', name: 'x', stateMutability: 'view', inputs: [], outputs: [] }],
        },
        null,
        2
      ),
      'utf-8'
    );

    await execAsync(`npx tsx ${CLI_PATH} init ${testDir} --llm --llm-dry`);

    const contractsJsonPath = join(testDir, 'sim', 'generated', 'llm-init', 'contracts.json');
    await expect(access(contractsJsonPath)).resolves.not.toThrow();

    const contractsTsPath = join(testDir, 'sim', 'generated', 'llm-init', 'contracts.ts');
    const contractsTs = await readFile(contractsTsPath, 'utf-8');
    expect(contractsTs).toContain('"alias": "Foo"');

    const scenarioPath = join(testDir, 'sim', 'scenarios', 'llm.ts');
    await expect(access(scenarioPath)).resolves.not.toThrow();
  });

  it('errors without key when --llm is not dry (but still writes scaffolding)', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(testDir, 'foundry.toml'), '[profile.default]\n', 'utf-8');
    await mkdir(join(testDir, 'out', 'Foo.sol'), { recursive: true });
    await writeFile(
      join(testDir, 'out', 'Foo.sol', 'Foo.json'),
      JSON.stringify({ contractName: 'Foo', abi: [] }, null, 2),
      'utf-8'
    );

    let err: any;
    try {
      await execAsync(`npx tsx ${CLI_PATH} init ${testDir} --llm`, {
        env: { ...process.env, OPENAI_API_KEY: '', OPENAI_KEY: '' },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe(2);

    const contractsJsonPath = join(testDir, 'sim', 'generated', 'llm-init', 'contracts.json');
    await expect(access(contractsJsonPath)).resolves.not.toThrow();
  });

  it('updates .gitignore if present', async () => {
    // Create existing .gitignore
    const gitignorePath = join(testDir, '.gitignore');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(gitignorePath, 'node_modules/\n');

    await execAsync(`npx tsx ${CLI_PATH} init ${testDir}`);

    const content = await readFile(gitignorePath, 'utf-8');
    expect(content).toContain('sim/results/');
    expect(content).toContain('sim/generated/');
    // Original content preserved
    expect(content).toContain('node_modules/');
  });

  it('exits with code 0 on success', async () => {
    const { stdout } = await execAsync(`npx tsx ${CLI_PATH} init ${testDir}`);
    expect(stdout).toContain('initialized successfully');
  });

  it('supports --force flag for existing directory', async () => {
    // First init
    await execAsync(`npx tsx ${CLI_PATH} init ${testDir}`);

    // Second init with force - should not throw
    const { stdout } = await execAsync(`npx tsx ${CLI_PATH} init ${testDir} --force`);
    expect(stdout).toBeDefined();
  });

  it('uses current directory when no path provided', async () => {
    const { stdout } = await execAsync(`npx tsx ${CLI_PATH} init`, {
      cwd: testDir,
    });

    expect(stdout).toContain('initialized successfully');

    const simDir = join(testDir, 'sim');
    await expect(access(simDir)).resolves.not.toThrow();
  });
});
