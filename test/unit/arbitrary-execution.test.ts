import { describe, expect, it } from 'vitest';
import { ArbitraryExecutor } from '../../src/exploration/arbitraryExecutor.js';
import { createMockPack } from '../mocks/mockPack.js';

describe('arbitrary execution', () => {
  it('allows tx execution only in exploration mode and allowlisted targets', async () => {
    const pack = createMockPack();
    const executor = new ArbitraryExecutor({
      mode: 'exploration',
      pack,
      allowlist: {
        allowedContracts: ['0xabc'],
        allowedRpcMethods: ['eth_call'],
      },
    });

    const allowed = await executor.executeTx(1, 'agent-1', {
      to: '0xabc',
      data: '0x1234',
    });
    const denied = await executor.executeTx(1, 'agent-1', {
      to: '0xdef',
      data: '0x1234',
    });

    expect(allowed.ok).toBe(true);
    expect(denied.ok).toBe(false);
  });

  it('rejects arbitrary execution in deterministic mode', async () => {
    const pack = createMockPack();
    const executor = new ArbitraryExecutor({
      mode: 'deterministic',
      pack,
      allowlist: {
        allowedContracts: ['0xabc'],
        allowedRpcMethods: ['eth_call'],
      },
    });

    const result = await executor.executeTx(1, 'agent-1', {
      to: '0xabc',
      data: '0x1234',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('exploration_mode');
  });
});
