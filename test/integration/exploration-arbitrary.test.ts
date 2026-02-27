import { describe, expect, it } from 'vitest';
import { ArbitraryExecutor } from '../../src/exploration/arbitraryExecutor.js';
import { createMockPack } from '../mocks/mockPack.js';

describe('exploration arbitrary execution policy', () => {
  it('rejects arbitrary calls outside exploration mode and enforces allowlist', async () => {
    const pack = createMockPack();
    const deterministicExecutor = new ArbitraryExecutor({
      mode: 'deterministic',
      pack,
      allowlist: { allowedContracts: ['0xaaa'], allowedRpcMethods: ['eth_call'] },
    });
    const deterministic = await deterministicExecutor.executeTx(0, 'agent-x', {
      to: '0xaaa',
      data: '0x00',
    });
    expect(deterministic.ok).toBe(false);

    const explorationExecutor = new ArbitraryExecutor({
      mode: 'exploration',
      pack,
      allowlist: { allowedContracts: ['0xaaa'], allowedRpcMethods: ['eth_call'] },
    });
    const blocked = await explorationExecutor.executeTx(0, 'agent-x', {
      to: '0xbbb',
      data: '0x00',
    });
    expect(blocked.ok).toBe(false);
  });
});
