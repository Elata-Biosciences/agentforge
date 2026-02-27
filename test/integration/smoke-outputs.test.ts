import { access, readFile } from 'node:fs/promises';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NoOpAgent } from '../../src/core/agent.js';
import { SimulationEngine } from '../../src/core/engine.js';
import { defineScenario } from '../../src/core/scenario.js';
import { createMockLogger } from '../mocks/mockLogger.js';
import { createMockPack } from '../mocks/mockPack.js';

describe('smoke outputs', () => {
  let outDir = '';
  beforeEach(async () => {
    outDir = join(tmpdir(), `agentforge-smoke-${Date.now()}`);
    await mkdir(outDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('writes smoke results artifact when smoke checkpoints are configured', async () => {
    const scenario = defineScenario({
      name: 'smoke-output',
      seed: 1,
      ticks: 3,
      tickSeconds: 1,
      pack: createMockPack({ initialMetrics: { pnl: 100 } }),
      agents: [{ type: NoOpAgent, count: 1 }],
      smoke: {
        checkpoints: [
          {
            tick: 1,
            branchTicks: 1,
            perturbations: [{ key: 'pnl', value: -10 }],
          },
        ],
      },
    });
    const engine = new SimulationEngine({ logger: createMockLogger() });
    const result = await engine.run(scenario, { outDir, ci: true });

    const smokePath = join(result.outputDir, 'smoke_results.json');
    await access(smokePath);
    const contents = JSON.parse(await readFile(smokePath, 'utf8')) as Array<{
      divergenceScore: number;
    }>;
    expect(contents.length).toBe(1);
    expect(contents[0]?.divergenceScore).toBeGreaterThan(0);
  });
});
