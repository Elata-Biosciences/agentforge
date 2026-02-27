import { describe, expect, it } from 'vitest';
import { createLiveServer } from '../../src/core/liveServer.js';

describe('liveServer', () => {
  it('can start, broadcast (no clients), and close', async () => {
    const srv = createLiveServer({ port: 0 });
    expect(srv.url.startsWith('ws://')).toBe(true);
    srv.broadcast({ type: 'tick_start', payload: { tick: 1, timestamp: 123 } });
    srv.broadcast({ type: 'tick_end', payload: { tick: 1, timestamp: 124 } });
    await srv.close();
  });
});
