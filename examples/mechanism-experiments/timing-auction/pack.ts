import type { Action, ActionResult, Pack, WorldState } from '../../../src/core/types.js';

/**
 * Configuration for the AuctionPack
 */
export interface AuctionPackConfig {
  /** Auction mode: sealed-bid or commit-reveal */
  mode: 'sealed-bid' | 'commit-reveal';
  /** How many ticks per auction cycle */
  auctionDuration: number;
  /** Base item value (bidders have private valuations around this) */
  baseItemValue: number;
  /** Reveal phase duration (for commit-reveal mode) */
  revealPhaseTicks: number;
  /** Initial balance for each bidder */
  initialBalance: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AuctionPackConfig = {
  mode: 'sealed-bid',
  auctionDuration: 5,
  baseItemValue: 100,
  revealPhaseTicks: 2,
  initialBalance: 10000,
};

/**
 * Auction state
 */
interface AuctionState {
  id: number;
  phase: 'bidding' | 'reveal' | 'settled';
  itemValue: number; // True value for this auction
  bids: Map<string, number>;
  commits: Map<string, string>; // For commit-reveal
  reveals: Map<string, number>;
  winner: string | null;
  winningBid: number;
  startTick: number;
}

/**
 * AuctionPack - A pack for demonstrating timing advantages in auctions
 */
export class AuctionPack implements Pack {
  readonly name = 'AuctionPack';

  private config: AuctionPackConfig;
  private currentTick = 0;
  private currentTimestamp = 0;
  private currentAuction: AuctionState | null = null;
  private auctionCount = 0;

  // Metrics
  private totalSellerRevenue = 0;
  private totalAuctions = 0;
  private winsByFastActor = 0;
  private winsByNormalBidders = 0;
  private totalFastActorProfit = 0;
  private totalNormalBidderProfit = 0;
  private totalBidsPlaced = 0;
  private totalPotentialBidders = 0;

  // Agent state
  private balances: Map<string, number> = new Map();
  private valuations: Map<string, number> = new Map(); // Private valuations
  private currentAgentId: string | null = null;

  constructor(config: Partial<AuctionPackConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    this.currentTick = 0;
    this.auctionCount = 0;
    this.totalSellerRevenue = 0;
    this.totalAuctions = 0;
    this.winsByFastActor = 0;
    this.winsByNormalBidders = 0;
    this.totalFastActorProfit = 0;
    this.totalNormalBidderProfit = 0;
    this.totalBidsPlaced = 0;
    this.totalPotentialBidders = 0;
    this.balances.clear();
    this.valuations.clear();
    this.currentAuction = null;
  }

  onTick(tick: number, timestamp: number): void {
    this.currentTick = tick;
    this.currentTimestamp = timestamp;

    // Check if we need to start new auction or advance phase
    if (!this.currentAuction || this.currentAuction.phase === 'settled') {
      this.startNewAuction();
    } else {
      this.advanceAuction();
    }
  }

  private startNewAuction(): void {
    this.auctionCount++;
    // Vary item value each auction
    const valueVariance = 0.8 + Math.random() * 0.4;
    const itemValue = this.config.baseItemValue * valueVariance;

    this.currentAuction = {
      id: this.auctionCount,
      phase: 'bidding',
      itemValue,
      bids: new Map(),
      commits: new Map(),
      reveals: new Map(),
      winner: null,
      winningBid: 0,
      startTick: this.currentTick,
    };

    // Generate private valuations for this auction
    this.valuations.clear();
  }

  private advanceAuction(): void {
    if (!this.currentAuction) return;

    const ticksElapsed = this.currentTick - this.currentAuction.startTick;

    if (this.config.mode === 'sealed-bid') {
      // Sealed bid: settle after duration
      if (ticksElapsed >= this.config.auctionDuration) {
        this.settleAuction();
      }
    } else {
      // Commit-reveal: transition through phases
      const commitPhaseTicks = this.config.auctionDuration - this.config.revealPhaseTicks;

      if (this.currentAuction.phase === 'bidding' && ticksElapsed >= commitPhaseTicks) {
        this.currentAuction.phase = 'reveal';
      } else if (
        this.currentAuction.phase === 'reveal' &&
        ticksElapsed >= this.config.auctionDuration
      ) {
        this.settleAuction();
      }
    }
  }

  private settleAuction(): void {
    if (!this.currentAuction) return;

    const auction = this.currentAuction;
    const bidsToConsider = this.config.mode === 'commit-reveal' ? auction.reveals : auction.bids;

    // Find highest bid
    let highestBid = 0;
    let winner: string | null = null;

    for (const [bidder, bid] of bidsToConsider) {
      if (bid > highestBid) {
        highestBid = bid;
        winner = bidder;
      }
    }

    auction.winner = winner;
    auction.winningBid = highestBid;
    auction.phase = 'settled';

    if (winner) {
      // Update metrics
      this.totalSellerRevenue += highestBid;
      this.totalAuctions++;

      const isFastActor = winner.includes('FastActor');
      if (isFastActor) {
        this.winsByFastActor++;
        const profit = auction.itemValue - highestBid;
        this.totalFastActorProfit += profit;
      } else {
        this.winsByNormalBidders++;
        const valuation = this.valuations.get(winner) ?? auction.itemValue;
        const profit = valuation - highestBid;
        this.totalNormalBidderProfit += profit;
      }

      // Deduct from winner's balance
      const balance = this.balances.get(winner) ?? 0;
      this.balances.set(winner, balance - highestBid);
    }
  }

  setCurrentAgent(agentId: string): void {
    this.currentAgentId = agentId;

    // Initialize balance if new agent
    if (!this.balances.has(agentId)) {
      this.balances.set(agentId, this.config.initialBalance);
    }

    // Generate private valuation for this auction if not set
    if (this.currentAuction && !this.valuations.has(agentId)) {
      // Private valuation is base + random noise
      const noise = (Math.random() - 0.5) * 0.4 * this.config.baseItemValue;
      this.valuations.set(agentId, this.currentAuction.itemValue + noise);
    }
  }

  getWorldState(): WorldState {
    const auction = this.currentAuction;

    // For fast actor in sealed-bid mode: expose other bids
    let visibleBids: Record<string, number> = {};
    if (
      auction &&
      this.config.mode === 'sealed-bid' &&
      this.currentAgentId?.includes('FastActor')
    ) {
      // Fast actor can see all bids
      visibleBids = Object.fromEntries(auction.bids);
    }

    // For commit-reveal: commits are visible, but not the bid values
    let visibleCommits: string[] = [];
    if (auction && this.config.mode === 'commit-reveal') {
      visibleCommits = Array.from(auction.commits.keys());
    }

    return {
      timestamp: this.currentTimestamp,
      tick: this.currentTick,
      auctionId: auction?.id ?? 0,
      auctionPhase: auction?.phase ?? 'settled',
      itemValue: auction?.itemValue ?? 0,
      privateValuation: this.currentAgentId ? (this.valuations.get(this.currentAgentId) ?? 0) : 0,
      agentBalance: this.currentAgentId ? (this.balances.get(this.currentAgentId) ?? 0) : 0,
      mode: this.config.mode,
      visibleBids,
      visibleCommits,
      hasCommitted: auction ? auction.commits.has(this.currentAgentId ?? '') : false,
      hasRevealed: auction ? auction.reveals.has(this.currentAgentId ?? '') : false,
      lastWinner: auction?.winner,
      lastWinningBid: auction?.winningBid ?? 0,
    };
  }

  async executeAction(action: Action, agentId: string): Promise<ActionResult> {
    switch (action.name) {
      case 'bid':
        return this.handleBid(action, agentId);
      case 'commit':
        return this.handleCommit(action, agentId);
      case 'reveal':
        return this.handleReveal(action, agentId);
      default:
        return { ok: false, error: `Unknown action: ${action.name}` };
    }
  }

  private handleBid(action: Action, agentId: string): ActionResult {
    if (!this.currentAuction || this.currentAuction.phase !== 'bidding') {
      return { ok: false, error: 'No active bidding phase' };
    }

    if (this.config.mode !== 'sealed-bid') {
      return { ok: false, error: 'Direct bidding only in sealed-bid mode' };
    }

    const bid = action.params.bid as number;
    if (typeof bid !== 'number' || bid <= 0) {
      return { ok: false, error: 'Invalid bid amount' };
    }

    const balance = this.balances.get(agentId) ?? 0;
    if (bid > balance) {
      return { ok: false, error: 'Insufficient balance' };
    }

    this.currentAuction.bids.set(agentId, bid);
    this.totalBidsPlaced++;

    return { ok: true };
  }

  private handleCommit(action: Action, agentId: string): ActionResult {
    if (!this.currentAuction || this.currentAuction.phase !== 'bidding') {
      return { ok: false, error: 'No active commit phase' };
    }

    if (this.config.mode !== 'commit-reveal') {
      return { ok: false, error: 'Commit only in commit-reveal mode' };
    }

    const commitHash = action.params.commitHash as string;
    const actualBid = action.params.actualBid as number; // Store secretly

    if (!commitHash || typeof actualBid !== 'number') {
      return { ok: false, error: 'Invalid commit' };
    }

    // Store commit hash and secret bid
    this.currentAuction.commits.set(agentId, commitHash);
    // In a real implementation, actualBid wouldn't be stored here
    // We cheat for simulation purposes
    this.currentAuction.bids.set(agentId, actualBid);
    this.totalBidsPlaced++;

    return { ok: true };
  }

  private handleReveal(action: Action, agentId: string): ActionResult {
    if (!this.currentAuction || this.currentAuction.phase !== 'reveal') {
      return { ok: false, error: 'No active reveal phase' };
    }

    if (!this.currentAuction.commits.has(agentId)) {
      return { ok: false, error: 'No commit found for this bidder' };
    }

    const revealedBid = action.params.bid as number;
    const storedBid = this.currentAuction.bids.get(agentId);

    // Verify the reveal matches the commit (simplified)
    if (revealedBid !== storedBid) {
      return { ok: false, error: 'Reveal does not match commit' };
    }

    this.currentAuction.reveals.set(agentId, revealedBid);

    return { ok: true };
  }

  getMetrics(): Record<string, number | bigint | string> {
    const fastActorWinRate = this.totalAuctions > 0 ? this.winsByFastActor / this.totalAuctions : 0;

    return {
      tick: this.currentTick,
      auctionCount: this.auctionCount,
      totalAuctions: this.totalAuctions,
      sellerRevenue: this.totalSellerRevenue,
      winsByFastActor: this.winsByFastActor,
      winsByNormalBidders: this.winsByNormalBidders,
      fastActorWinRate,
      fastActorProfit: this.totalFastActorProfit,
      normalBidderProfit: this.totalNormalBidderProfit,
      totalBidsPlaced: this.totalBidsPlaced,
      avgBidsPerAuction: this.totalAuctions > 0 ? this.totalBidsPlaced / this.totalAuctions : 0,
    };
  }

  async cleanup(): Promise<void> {
    // Nothing to clean up
  }
}
