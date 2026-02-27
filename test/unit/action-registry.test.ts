import { describe, expect, it } from 'vitest';
import {
  InMemoryActionValidatorRegistry,
  createDefaultActionRegistry,
} from '../../src/core/actionRegistry.js';
import type { Action } from '../../src/core/types.js';

describe('action registry', () => {
  it('validates with custom validator', () => {
    const registry = new InMemoryActionValidatorRegistry();
    registry.register('custom', (action) => ({
      ok: action.params.allowed === true,
      error: action.params.allowed === true ? undefined : 'denied',
    }));

    const allowed: Action = { id: '1', name: 'custom', params: { allowed: true } };
    const denied: Action = { id: '2', name: 'custom', params: { allowed: false } };
    expect(registry.validate(allowed, { mode: 'deterministic', world: { timestamp: 0 } }).ok).toBe(
      true
    );
    expect(registry.validate(denied, { mode: 'deterministic', world: { timestamp: 0 } }).ok).toBe(
      false
    );
  });

  it('uses default core validators', () => {
    const registry = createDefaultActionRegistry();
    expect(
      registry.validate(
        { id: 'a', name: 'DoNothing', params: {} },
        { mode: 'deterministic', world: { timestamp: 0 } }
      ).ok
    ).toBe(true);
    expect(
      registry.validate(
        { id: 'b', name: 'PostMessage', params: { channelId: 'global', text: 'hi' } },
        { mode: 'deterministic', world: { timestamp: 0 } }
      ).ok
    ).toBe(true);
    expect(
      registry.validate(
        { id: 'c', name: 'PostMessage', params: { channelId: '' } },
        { mode: 'deterministic', world: { timestamp: 0 } }
      ).ok
    ).toBe(false);
  });
});
