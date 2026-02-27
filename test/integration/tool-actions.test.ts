import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BaseAgent } from '../../src/core/agent.js';
import { SimulationEngine } from '../../src/core/engine.js';
import { defineScenario } from '../../src/core/scenario.js';
import type { Action, Pack, TickContext } from '../../src/core/types.js';
import { MockPack } from '../mocks/mockPack.js';

let sawCapabilityManifest = false;

class ToolActionAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | null> {
    sawCapabilityManifest =
      sawCapabilityManifest || (ctx.capabilities?.tools.includes('QueryWorld') ?? false);
    if (ctx.tick === 0) {
      return {
        id: this.generateActionId('QueryWorld', ctx.tick),
        name: 'QueryWorld',
        params: { endpoint: 'get_world', params: {} },
      };
    }
    if (ctx.tick === 1) {
      return {
        id: this.generateActionId('RpcCall', ctx.tick),
        name: 'RpcCall',
        params: { method: 'eth_chainId', params: [] },
      };
    }
    if (ctx.tick === 2) {
      return {
        id: this.generateActionId('PostMessage', ctx.tick),
        name: 'PostMessage',
        params: { channelId: 'global', text: 'hello', intentTag: 'inform' },
      };
    }
    return { id: this.generateActionId('DoNothing', ctx.tick), name: 'DoNothing', params: {} };
  }
}

class RpcCapableMockPack extends MockPack implements Pack {
  override async executeAction(action: Action, agentId: string) {
    if (action.name === 'QueryWorld' || action.name === 'RpcCall') {
      throw new Error('engine should not forward tool actions to pack.executeAction');
    }
    return super.executeAction(action, agentId);
  }

  async callRpc(method: string, _params: unknown[] = []): Promise<unknown> {
    if (method === 'eth_chainId') return '0x7a69';
    throw new Error(`unsupported_rpc:${method}`);
  }
}

describe('engine tool-like actions', () => {
  let dir = '';

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('executes QueryWorld and RpcCall and records them in replay bundle', async () => {
    sawCapabilityManifest = false;
    dir = await mkdtemp(join(tmpdir(), 'agentforge-tool-actions-'));
    const pack = new RpcCapableMockPack({
      name: 'rpc-mock-pack',
      initialState: {},
      initialMetrics: {},
    });

    const scenario = defineScenario({
      name: 'tool-actions',
      seed: 1,
      ticks: 3,
      tickSeconds: 1,
      pack,
      agents: [{ type: ToolActionAgent, count: 1 }],
      query: {
        defaultBudget: { maxQueriesPerTick: 5, maxCostPerTick: 10, maxBytesPerTick: 20_000 },
        endpoints: [
          {
            name: 'get_world',
            cost: 1,
            handler: (_params, world) => world,
          },
        ],
      },
      exploration: {
        allowArbitraryExecution: true,
        allowlist: { allowedContracts: [], allowedRpcMethods: ['eth_chainId'] },
      },
    });

    const engine = new SimulationEngine();
    const result = await engine.run(scenario, { outDir: dir, mode: 'exploration', ci: true });
    expect(result.success).toBe(true);
    expect(result.replayBundlePath).toBeDefined();

    const bundlePath = join(result.outputDir, result.replayBundlePath!);
    const raw = await readFile(bundlePath, 'utf8');
    const bundle = JSON.parse(raw) as {
      queries?: unknown[];
      arbitraryExecutions?: unknown[];
      messages?: unknown[];
    };
    expect(sawCapabilityManifest).toBe(true);
    expect(bundle.queries?.length).toBe(1);
    expect(bundle.arbitraryExecutions?.length).toBe(1);
    expect(bundle.messages?.length).toBe(1);
  });
});
