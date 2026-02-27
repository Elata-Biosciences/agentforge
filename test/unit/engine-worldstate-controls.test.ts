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

class ObservingAgent extends BaseAgent {
  static observedTicks: number[] = [];

  async step(ctx: TickContext): Promise<Action | null> {
    ObservingAgent.observedTicks.push(Number(ctx.world.tick ?? -1));
    return {
      id: this.generateActionId('DoNothing', ctx.tick),
      name: 'DoNothing',
      params: {},
    };
  }

  static reset(): void {
    ObservingAgent.observedTicks = [];
  }
}

describe('engine world-state controls', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `engine-world-controls-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    ObservingAgent.reset();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('applies indexing delay for agent-observed world state', async () => {
    const pack = createMockPack();
    const scenario = defineScenario({
      name: 'index-delay',
      seed: 1,
      ticks: 3,
      tickSeconds: 1,
      pack,
      agents: [{ type: ObservingAgent, count: 1 }],
      query: {
        defaultBudget: {
          maxQueriesPerTick: 10,
          maxCostPerTick: 10,
          maxBytesPerTick: 1_000,
        },
        indexingDelayTicks: 1,
      },
    });

    const engine = new SimulationEngine({ logger: createMockLogger() });
    await engine.run(scenario, { outDir: testDir, ci: true });

    expect(ObservingAgent.observedTicks[0]).toBe(0);
    expect(ObservingAgent.observedTicks[1]).toBe(0);
    expect(ObservingAgent.observedTicks[2]).toBe(1);
  });
});
