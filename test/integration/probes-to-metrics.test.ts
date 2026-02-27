import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BaseAgent } from '../../src/core/agent.js';
import { SimulationEngine } from '../../src/core/engine.js';
import { createLogger } from '../../src/core/logging.js';
import { defineScenario } from '../../src/core/scenario.js';
import { createMockPack } from '../mocks/mockPack.js';

class NoopAgent extends BaseAgent {
  async step(): Promise<null> {
    return null;
  }
}

describe('Probes -> metrics.csv', () => {
  it('emits selected probe samples into metrics.csv columns', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'agentforge-probes-'));
    const pack = createMockPack({
      initialState: { 'foo.bar': 7 },
      initialMetrics: { balance_eth_agent0: 100 },
    });

    const scenario = defineScenario({
      name: 'probe-metrics',
      seed: 1,
      ticks: 2,
      tickSeconds: 1,
      pack,
      agents: [{ type: NoopAgent, count: 1 }],
      metrics: { sampleEveryTicks: 1, probeEmitMode: 'selected', emitProbes: ['callFoo', 'balA'] },
      probes: [
        { name: 'callFoo', type: 'call', config: { target: 'foo', method: 'bar' } },
        {
          name: 'balA',
          type: 'balance',
          config: { addresses: ['agent0'], token: undefined },
        },
      ],
      probeEveryTicks: 1,
    });

    const engine = new SimulationEngine({ logger: createLogger({ level: 'silent' }) });
    const result = await engine.run(scenario, { outDir });

    const csv = await readFile(join(result.outputDir, 'metrics.csv'), 'utf-8');
    const header = csv.split('\n')[0] ?? '';
    expect(header).toContain('probe.callFoo');
    expect(header).toContain('probe.balA');
  });
});
