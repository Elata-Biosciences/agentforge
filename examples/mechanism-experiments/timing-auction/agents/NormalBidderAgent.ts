import { BaseAgent } from '../../../../src/core/agent.js';
import type { Action, TickContext } from '../../../../src/core/types.js';

/**
 * NormalBidderAgent - A standard auction bidder
 *
 * Bids based on private valuation with some noise. Does not have
 * timing advantages or information about other bids.
 *
 * Parameters:
 * - bidAggressiveness: How close to valuation to bid (0-1)
 * - participationRate: Probability of participating in each auction (0-1)
 */
export class NormalBidderAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | null> {
    const world = ctx.world;
    const auctionPhase = world.auctionPhase as string;
    const privateValuation = world.privateValuation as number;
    const mode = world.mode as string;
    const hasCommitted = world.hasCommitted as boolean;
    const hasRevealed = world.hasRevealed as boolean;
    const balance = world.agentBalance as number;

    // Get parameters
    const bidAggressiveness = this.getParam<number>('bidAggressiveness', 0.7);
    const participationRate = this.getParam<number>('participationRate', 0.8);

    // Decide whether to participate this auction
    const auctionId = world.auctionId as number;
    const lastAuctionId = this.recall<number>('lastAuctionId') ?? 0;

    if (auctionId !== lastAuctionId) {
      // New auction - decide if participating
      this.remember('lastAuctionId', auctionId);
      this.remember('participating', ctx.rng.chance(participationRate));
      this.forget('hasBid');
    }

    if (!this.recall<boolean>('participating')) {
      return null;
    }

    // Calculate bid based on valuation
    const bidNoise = (ctx.rng.nextFloat() - 0.5) * 0.1 * privateValuation;
    const bid = Math.max(1, privateValuation * bidAggressiveness + bidNoise);

    // Don't bid more than we can afford
    const safeBid = Math.min(bid, balance * 0.9);

    if (mode === 'sealed-bid') {
      // Direct bidding
      if (auctionPhase === 'bidding' && !this.recall<boolean>('hasBid')) {
        this.remember('hasBid', true);
        return {
          id: this.generateActionId('bid', ctx.tick),
          name: 'bid',
          params: { bid: safeBid },
        };
      }
    } else {
      // Commit-reveal
      if (auctionPhase === 'bidding' && !hasCommitted) {
        // Generate a simple hash (in real impl, use crypto)
        const commitHash = `commit-${this.id}-${auctionId}-${Math.floor(safeBid)}`;
        return {
          id: this.generateActionId('commit', ctx.tick),
          name: 'commit',
          params: { commitHash, actualBid: safeBid },
        };
      }

      if (auctionPhase === 'reveal' && hasCommitted && !hasRevealed) {
        return {
          id: this.generateActionId('reveal', ctx.tick),
          name: 'reveal',
          params: { bid: safeBid },
        };
      }
    }

    return null;
  }
}
