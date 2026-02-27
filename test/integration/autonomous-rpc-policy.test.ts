import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BaseAgent } from '../../src/core/agent.js';
import { SimulationEngine } from '../../src/core/engine.js';
import { defineScenario } from '../../src/core/scenario.js';
import type { Action, Pack, TickContext } from '../../src/core/types.js';
import { MockPack } from '../mocks/mockPack.js';

class RpcProbeAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | null> {
    if (ctx.tick > 0) return null;
    return {
      id: this.generateActionId('RpcCall', ctx.tick),
      name: 'RpcCall',
      params: { method: 'eth_chainId', params: [] },
    };
  }
}

class ArbitraryRpcProbeAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | null> {
    if (ctx.tick > 0) return null;
    return {
      id: this.generateActionId('RpcCall', ctx.tick),
      name: 'RpcCall',
      params: { method: 'debug_traceTransaction', params: ['0xabc'] },
    };
  }
}

class RpcPack extends MockPack implements Pack {
  rpcCalls = 0;

  async callRpc(method: string): Promise<unknown> {
    this.rpcCalls += 1;
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'debug_traceTransaction') return { gas: '0x123' };
    throw new Error(`unsupported_rpc:${method}`);
  }
}

describe('autonomous rpc policy', () => {
  let dir = '';

  afterEach(async () => {
    process.env.AGENTFORGE_AUTONOMOUS_RPC_POLICY = undefined;
    process.env.AGENTFORGE_DISABLE_AUTONOMOUS_RPC = undefined;
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('blocks rpc by default when strict and not allowlisted', async () => {
    dir = await mkdtemp(join(tmpdir(), 'agentforge-rpc-policy-'));
    const pack = new RpcPack();
    const scenario = defineScenario({
      name: 'rpc-strict',
      seed: 1,
      ticks: 1,
      tickSeconds: 1,
      pack,
      agents: [{ type: RpcProbeAgent, count: 1 }],
      exploration: {
        allowArbitraryExecution: true,
        allowlist: { allowedContracts: [], allowedRpcMethods: [] },
      },
    });

    const result = await new SimulationEngine().run(scenario, {
      outDir: dir,
      mode: 'exploration',
      ci: true,
    });
    expect(result.success).toBe(true);
    expect(pack.rpcCalls).toBe(0);
  });

  it('allows arbitrary rpc in aggressive policy with empty allowlist', async () => {
    dir = await mkdtemp(join(tmpdir(), 'agentforge-rpc-policy-'));
    const pack = new RpcPack();
    const scenario = defineScenario({
      name: 'rpc-aggressive',
      seed: 1,
      ticks: 1,
      tickSeconds: 1,
      pack,
      agents: [{ type: ArbitraryRpcProbeAgent, count: 1 }],
      exploration: {
        allowArbitraryExecution: true,
        autonomousRpcPolicy: 'aggressive',
        allowlist: { allowedContracts: [], allowedRpcMethods: [] },
      },
    });

    const result = await new SimulationEngine().run(scenario, {
      outDir: dir,
      mode: 'exploration',
      ci: true,
    });
    expect(result.success).toBe(true);
    expect(pack.rpcCalls).toBe(1);
  });

  it('kill-switch disables autonomous rpc even in aggressive policy', async () => {
    process.env.AGENTFORGE_DISABLE_AUTONOMOUS_RPC = '1';
    dir = await mkdtemp(join(tmpdir(), 'agentforge-rpc-policy-'));
    const pack = new RpcPack();
    const scenario = defineScenario({
      name: 'rpc-disabled',
      seed: 1,
      ticks: 1,
      tickSeconds: 1,
      pack,
      agents: [{ type: RpcProbeAgent, count: 1 }],
      exploration: {
        allowArbitraryExecution: true,
        autonomousRpcPolicy: 'aggressive',
        allowlist: { allowedContracts: [], allowedRpcMethods: [] },
      },
    });

    const result = await new SimulationEngine().run(scenario, {
      outDir: dir,
      mode: 'exploration',
      ci: true,
    });
    expect(result.success).toBe(true);
    expect(pack.rpcCalls).toBe(0);
  });
});
