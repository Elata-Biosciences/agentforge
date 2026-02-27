import { BaseAgent } from '../../../src/core/agent.js';
import type { TickContext } from '../../../src/core/types.js';

/**
 * A tiny agent that posts short gossip messages periodically.
 * Useful for demoing gossip observability in Studio + dashboards.
 */
export class GossipChatterAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<null> {
    const every = this.getParam<number>('postEveryTicks', 5);
    if (!ctx.gossip) return null;
    if (every <= 0) return null;
    if (ctx.tick % every !== 0) return null;

    const asset = ['ALPHA', 'BETA', 'GAMMA'][ctx.tick % 3] ?? 'ALPHA';
    const price = (ctx.pack.getMetrics() as any)?.[`price_${asset}`];
    const text = `tick=${ctx.tick} asset=${asset} price=${String(price ?? '?')}`;
    const channel = (['global', 'markets', 'governance'] as const)[ctx.tick % 3] ?? 'global';
    ctx.gossip.postMessage(
      this.id,
      channel,
      { text },
      { intentTag: 'inform', audience: { type: 'public' } }
    );
    return null;
  }
}
