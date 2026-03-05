import { describe, expect, it } from 'vitest';
import { DivergenceTracker } from '../../src/replay/divergence.js';

describe('DivergenceTracker', () => {
  it('returns score 0 when baseline and replay results match', () => {
    const tracker = new DivergenceTracker();
    tracker.recordAction(0, 'agent-a', 'Swap', { ok: true }, { ok: true });
    tracker.recordAction(1, 'agent-a', 'Swap', { ok: true }, { ok: true });
    const result = tracker.build();
    expect(result.overallScore).toBe(0);
    expect(result.tickDivergences).toHaveLength(0);
  });

  it('returns score > 0 when baseline ok but replay fails', () => {
    const tracker = new DivergenceTracker();
    tracker.recordAction(0, 'agent-a', 'Swap', { ok: true }, { ok: false, error: 'revert' });
    const result = tracker.build();
    expect(result.overallScore).toBe(1);
    expect(result.tickDivergences).toHaveLength(1);
    expect(result.tickDivergences[0].actionDivergences[0].baselineOk).toBe(true);
    expect(result.tickDivergences[0].actionDivergences[0].replayOk).toBe(false);
  });

  it('computes weighted score across multiple actions', () => {
    const tracker = new DivergenceTracker();
    tracker.recordAction(0, 'a', 'Swap', { ok: true }, { ok: true });
    tracker.recordAction(0, 'b', 'Swap', { ok: true }, { ok: false, error: 'fail' });
    tracker.recordAction(1, 'a', 'Swap', { ok: true }, { ok: true });
    tracker.recordAction(1, 'b', 'Swap', { ok: true }, { ok: true });
    const result = tracker.build();
    expect(result.overallScore).toBe(0.25);
  });

  it('tracks metrics delta', () => {
    const tracker = new DivergenceTracker();
    tracker.recordAction(0, 'a', 'Swap', { ok: true }, { ok: false, error: 'x' }, { volume: 100 });
    tracker.setReplayMetrics(0, { volume: 80 });
    const result = tracker.build();
    expect(result.tickDivergences[0].metricsDelta.volume).toEqual({
      baseline: 100,
      replay: 80,
      pctChange: -20,
    });
  });

  it('hasDivergence reports correctly', () => {
    const tracker = new DivergenceTracker();
    expect(tracker.hasDivergence).toBe(false);
    tracker.recordAction(0, 'a', 'X', { ok: true }, { ok: true });
    expect(tracker.hasDivergence).toBe(false);
    tracker.recordAction(1, 'b', 'Y', { ok: true }, { ok: false, error: 'err' });
    expect(tracker.hasDivergence).toBe(true);
  });
});
