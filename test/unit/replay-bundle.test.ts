import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ReplayRecorder,
  loadReplayBundle,
  saveReplayBundle,
  selectReplayAction,
} from '../../src/replay/bundle.js';

describe('replay bundle', () => {
  let dir = '';

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('serializes and loads replay bundles', async () => {
    dir = await mkdtemp(join(tmpdir(), 'replay-bundle-'));
    const path = join(dir, 'bundle.json');
    const recorder = new ReplayRecorder();
    recorder.recordAction({
      tick: 1,
      agentId: 'agent-1',
      action: { id: 'a-1', name: 'DoNothing', params: {} },
    });

    const bundle = recorder.build('scenario', 42, 'exploration');
    await saveReplayBundle(path, bundle);
    const loaded = await loadReplayBundle(path);
    expect(loaded.actions.length).toBe(1);
    expect(loaded.seed).toBe(42);
  });

  it('selects replay actions by tick and agent', () => {
    const recorder = new ReplayRecorder();
    recorder.recordAction({
      tick: 4,
      agentId: 'agent-x',
      action: { id: 'id', name: 'DoNothing', params: {} },
    });
    const bundle = recorder.build('scenario', 1, 'exploration');
    const selected = selectReplayAction(bundle, 4, 'agent-x');
    expect(selected?.action?.name).toBe('DoNothing');
  });
});
