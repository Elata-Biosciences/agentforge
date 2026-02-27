import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseAgent } from '../../src/core/agent.js';
import { SimulationEngine } from '../../src/core/engine.js';
import { defineScenario } from '../../src/core/scenario.js';
import type { Action, TickContext } from '../../src/core/types.js';
import { createMockLogger } from '../mocks/mockLogger.js';
import { MockPack } from '../mocks/mockPack.js';

class WorldProbeAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | null> {
    return {
      id: this.generateActionId('probe', ctx.tick),
      name: 'probe',
      params: { observed: ctx.world.shock ?? null },
    };
  }
}

describe('scheduled events', () => {
  let outDir = '';
  beforeEach(async () => {
    outDir = join(tmpdir(), `agentforge-schedule-${Date.now()}`);
    await mkdir(outDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('applies world_overlay shocks deterministically and records ScheduledEvent actions', async () => {
    const observed: Array<{ tick: number; value: unknown }> = [];
    const pack = new MockPack({
      initialState: { shock: 'none' },
      actionHandler: async (action, _agentId) => {
        observed.push({ tick: pack.getWorldState().tick as number, value: action.params.observed });
        return { ok: true };
      },
    });

    const scenario = defineScenario({
      name: 'schedule-world-overlay',
      seed: 1,
      ticks: 3,
      tickSeconds: 1,
      pack,
      agents: [{ type: WorldProbeAgent, count: 1 }],
      schedule: [{ tick: 1, type: 'world_overlay', payload: { overrides: { shock: 'depeg' } } }],
    });

    const engine = new SimulationEngine({ logger: createMockLogger() });
    const res = await engine.run(scenario, { outDir, ci: true });
    expect(res.success).toBe(true);

    // World view: tick0 none, tick1+ depeg (overlay persists)
    expect(observed.map((o) => o.value)).toEqual(['none', 'depeg', 'depeg']);

    const actionsNdjson = await readFile(join(res.outputDir, 'actions.ndjson'), 'utf8');
    expect(actionsNdjson).toContain('"agentId":"system"');
    expect(actionsNdjson).toContain('"name":"ScheduledEvent"');
    expect(actionsNdjson).toContain('"type":"world_overlay"');
  });
});
