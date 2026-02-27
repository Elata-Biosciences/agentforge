import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { GossipBus } from '../../src/gossip/bus.js';

describe('gossip bus', () => {
  it('routes messages to configured channel members', () => {
    const bus = new GossipBus({
      channels: [{ id: 'global', type: 'global', members: ['agent-a', 'agent-b'] }],
      budgets: {
        maxPostsPerTick: 2,
        maxPostCostPerTick: 20,
        maxMessagesReadPerTick: 10,
        maxCharsReadPerTick: 2000,
      },
      defaultLatencyTicks: 0,
    });
    bus.advanceTick(1);
    const post = bus.postMessage('agent-a', 'global', { text: 'hello' }, new Rng(1));
    expect(post.ok).toBe(true);
    bus.advanceTick(1);
    const inbox = bus.readInbox('agent-b');
    expect(inbox.length).toBe(1);
    expect(inbox[0]?.payload.text).toBe('hello');
  });

  it('enforces post budgets', () => {
    const bus = new GossipBus({
      channels: [{ id: 'global', type: 'global', members: ['a', 'b'] }],
      budgets: {
        maxPostsPerTick: 1,
        maxPostCostPerTick: 2,
        maxMessagesReadPerTick: 10,
        maxCharsReadPerTick: 2000,
      },
    });
    bus.advanceTick(1);
    const first = bus.postMessage('a', 'global', { text: 'ok' }, new Rng(2));
    const second = bus.postMessage('a', 'global', { text: 'again' }, new Rng(2));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  it('enforces per-channel post cooldown across ticks', () => {
    const bus = new GossipBus({
      channels: [{ id: 'global', type: 'global', members: ['a', 'b'], postCooldownTicks: 2 }],
      budgets: {
        maxPostsPerTick: 10,
        maxPostCostPerTick: 100,
        maxMessagesReadPerTick: 10,
        maxCharsReadPerTick: 2000,
      },
    });
    const rng = new Rng(1);
    bus.advanceTick(1);
    expect(bus.postMessage('a', 'global', { text: 't1' }, rng).ok).toBe(true);
    bus.advanceTick(2);
    expect(bus.postMessage('a', 'global', { text: 't2' }, rng).ok).toBe(false);
    bus.advanceTick(3);
    expect(bus.postMessage('a', 'global', { text: 't3' }, rng).ok).toBe(true);
  });

  it('allows system message injection bypassing budgets', () => {
    const bus = new GossipBus({
      channels: [{ id: 'global', type: 'global', members: ['a', 'b'] }],
      budgets: {
        maxPostsPerTick: 0,
        maxPostCostPerTick: 0,
        maxMessagesReadPerTick: 10,
        maxCharsReadPerTick: 2000,
      },
    });
    const rng = new Rng(1);
    bus.advanceTick(1);
    expect(bus.postMessage('a', 'global', { text: 'should fail' }, rng).ok).toBe(false);
    expect(bus.postSystemMessage('global', { text: 'shock' }, rng).ok).toBe(true);
    bus.advanceTick(1);
    const inbox = bus.readInbox('b');
    expect(inbox.length).toBe(1);
    expect(inbox[0]?.payload.text).toBe('shock');
  });
});
