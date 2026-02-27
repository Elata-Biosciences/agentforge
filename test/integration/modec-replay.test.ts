import { readFile } from 'node:fs/promises';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseAgent } from '../../src/core/agent.js';
import { SimulationEngine } from '../../src/core/engine.js';
import { defineScenario } from '../../src/core/scenario.js';
import type { Action, TickContext } from '../../src/core/types.js';
import { createMockLogger } from '../mocks/mockLogger.js';
import { createMockPack } from '../mocks/mockPack.js';

class FixedActionAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | null> {
    return {
      id: this.generateActionId('fixed', ctx.tick),
      name: 'DoNothing',
      params: {},
    };
  }
}

describe('Mode C replay', () => {
  let outDir = '';
  beforeEach(async () => {
    outDir = join(tmpdir(), `agentforge-replay-${Date.now()}`);
    await mkdir(outDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('records exploration trace and replays without policy calls', async () => {
    const engine = new SimulationEngine({ logger: createMockLogger() });
    const pack = createMockPack();
    const exploreScenario = defineScenario({
      name: 'modec-explore',
      seed: 7,
      ticks: 3,
      tickSeconds: 1,
      pack,
      agents: [{ type: FixedActionAgent, count: 1 }],
    });

    const exploreResult = await engine.run(exploreScenario, {
      outDir,
      ci: true,
      mode: 'exploration',
    });
    const bundlePath = join(exploreResult.outputDir, 'replay_bundle.json');
    const bundleRaw = await readFile(bundlePath, 'utf8');
    const bundle = JSON.parse(bundleRaw) as { actions: Array<unknown> };
    expect(bundle.actions.length).toBe(3);

    const replayPack = createMockPack();
    const replayScenario = defineScenario({
      name: 'modec-replay',
      seed: 7,
      ticks: 3,
      tickSeconds: 1,
      pack: replayPack,
      agents: [{ type: FixedActionAgent, count: 1 }],
    });

    const replayResult = await engine.run(replayScenario, {
      outDir,
      ci: true,
      mode: 'replay',
      replayBundlePath: bundlePath,
    });
    expect(replayResult.success).toBe(true);
    expect(replayPack.executedActions.length).toBe(3);
  });
});
