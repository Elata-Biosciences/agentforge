import { BaseAgent } from '../../../../src/core/agent.js';
import type { Action, TickContext } from '../../../../src/core/types.js';

/**
 * FastActorAgent - A bidder with timing/information advantage
 *
 * In sealed-bid mode: Can observe other bids and bid just above the highest.
 * In commit-reveal mode: Cannot see bids, so advantage is neutralized.
 *
 * Parameters:
 * - minMargin: Minimum margin above highest bid (to ensure profit)
 * - maxBidFraction: Maximum fraction of valuation to bid
 */
export class FastActorAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | null> {
    const world = ctx.world;
    const auctionPhase = world.auctionPhase as string;
    const privateValuation = world.privateValuation as number;
    const mode = world.mode as string;
    const visibleBids = world.visibleBids as Record<string, number>;
    const hasCommitted = world.hasCommitted as boolean;
    const hasRevealed = world.hasRevealed as boolean;
    const balance = world.agentBalance as number;
    const itemValue = world.itemValue as number;

    // Get parameters
    const minMargin = this.getParam<number>('minMargin', 1);
    const maxBidFraction = this.getParam<number>('maxBidFraction', 0.95);

    // Track auction participation
    const auctionId = world.auctionId as number;
    const lastAuctionId = this.recall<number>('lastAuctionId') ?? 0;

    if (auctionId !== lastAuctionId) {
      this.remember('lastAuctionId', auctionId);
      this.forget('hasBid');
    }

    if (mode === 'sealed-bid') {
      // Exploit timing advantage: see other bids and bid just above
      if (auctionPhase === 'bidding' && !this.recall<boolean>('hasBid')) {
        // Find highest competing bid
        const otherBids = Object.values(visibleBids);
        const highestOtherBid = otherBids.length > 0 ? Math.max(...otherBids) : 0;

        // Calculate optimal bid: just above highest, but below valuation
        const targetBid = highestOtherBid + minMargin;
        const maxBid = Math.min(
          privateValuation * maxBidFraction,
          itemValue * 0.9, // Don't overpay
          balance * 0.9
        );

        // Only bid if profitable
        if (targetBid <= maxBid) {
          this.remember('hasBid', true);
          return {
            id: this.generateActionId('bid', ctx.tick),
            name: 'bid',
            params: { bid: targetBid },
          };
        }

        // If can't profitably outbid, bid conservatively or skip
        const conservativeBid = itemValue * 0.5;
        if (conservativeBid < maxBid && conservativeBid > highestOtherBid) {
          this.remember('hasBid', true);
          return {
            id: this.generateActionId('bid', ctx.tick),
            name: 'bid',
            params: { bid: conservativeBid },
          };
        }

        // Skip this auction
        return null;
      }
    } else {
      // Commit-reveal mode: timing advantage is neutralized
      // Fast actor must bid like a normal bidder
      if (auctionPhase === 'bidding' && !hasCommitted) {
        // Can't see other bids, so bid based on valuation
        const bidNoise = (ctx.rng.nextFloat() - 0.5) * 0.1 * privateValuation;
        const bid = Math.max(1, privateValuation * 0.7 + bidNoise);
        const safeBid = Math.min(bid, balance * 0.9);

        const commitHash = `commit-${this.id}-${auctionId}-${Math.floor(safeBid)}`;
        return {
          id: this.generateActionId('commit', ctx.tick),
          name: 'commit',
          params: { commitHash, actualBid: safeBid },
        };
      }

      if (auctionPhase === 'reveal' && hasCommitted && !hasRevealed) {
        // Retrieve stored bid and reveal
        const storedBid = privateValuation * 0.7; // Simplified
        return {
          id: this.generateActionId('reveal', ctx.tick),
          name: 'reveal',
          params: { bid: storedBid },
        };
      }
    }

    return null;
  }
}
