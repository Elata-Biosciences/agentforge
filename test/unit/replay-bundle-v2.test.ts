import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReplayRecorder, loadReplayBundle, saveReplayBundle } from '../../src/replay/bundle.js';

describe('replay bundle v2', () => {
  let dir = '';

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records and preserves action results in v2 bundles', async () => {
    dir = await mkdtemp(join(tmpdir(), 'replay-v2-'));
    const path = join(dir, 'bundle.json');
    const recorder = new ReplayRecorder();
    recorder.recordAction({
      tick: 0,
      agentId: 'agent-a',
      action: { id: 'a1', name: 'Swap', params: { amount: 100 } },
      result: { ok: true },
    });
    recorder.recordAction({
      tick: 1,
      agentId: 'agent-a',
      action: { id: 'a2', name: 'Swap', params: { amount: 200 } },
      result: { ok: false, error: 'insufficient_balance' },
    });

    const bundle = recorder.build('test-scenario', 99, 'exploration');
    expect(bundle.version).toBe('v2');

    await saveReplayBundle(path, bundle);
    const loaded = await loadReplayBundle(path);
    expect(loaded.version).toBe('v2');
    expect(loaded.actions).toHaveLength(2);
    expect(loaded.actions[0].result).toEqual({ ok: true });
    expect(loaded.actions[1].result).toEqual({ ok: false, error: 'insufficient_balance' });
  });

  it('handles v1 bundles without results gracefully', async () => {
    dir = await mkdtemp(join(tmpdir(), 'replay-v1-compat-'));
    const path = join(dir, 'bundle.json');
    const recorder = new ReplayRecorder();
    recorder.recordAction({
      tick: 0,
      agentId: 'agent-a',
      action: { id: 'a1', name: 'DoNothing', params: {} },
    });
    const bundle = recorder.build('compat-test', 1, 'exploration');
    const v1Bundle = { ...bundle, version: 'v1' as const };

    await saveReplayBundle(path, v1Bundle);
    const loaded = await loadReplayBundle(path);
    expect(loaded.version).toBe('v1');
    expect(loaded.actions[0].result).toBeUndefined();
  });
});
