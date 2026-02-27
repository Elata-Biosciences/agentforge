import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../../src/core/engine.js';
import { createLogger } from '../../src/core/logging.js';
import { createToyScenario } from '../../src/toy/toyScenario.js';

describe('Agent memory capture', () => {
  it('writes agent_memory.ndjson when enabled', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'agentforge-memory-artifact-'));
    const scenario = createToyScenario({ seed: 1, ticks: 3, traderCount: 1, momentumCount: 0 });
    const engine = new SimulationEngine({ logger: createLogger({ level: 'silent' }) });
    const result = await engine.run(scenario, {
      outDir,
      memoryCapture: { enabled: true, sampleEveryTicks: 1, maxBytesPerRecord: 262_144 },
    });

    const raw = await readFile(join(result.outputDir, 'agent_memory.ndjson'), 'utf-8');
    const lines = raw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const first = JSON.parse(lines[0] ?? '{}') as any;
    expect(typeof first.tick).toBe('number');
    expect(typeof first.agentId).toBe('string');
    expect(first).toHaveProperty('memory');
  });
});
