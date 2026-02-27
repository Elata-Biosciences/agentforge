import { BaseAgent } from '../core/agent.js';
import type { Action, TickContext } from '../core/types.js';
import type { ToyWorldState } from './toyPack.js';

/**
 * Random trader agent that makes buy/sell/hold decisions randomly
 */
export class RandomTraderAgent extends BaseAgent {
  private readonly buyWeight: number;
  private readonly sellWeight: number;
  private readonly holdWeight: number;
  private readonly maxTradePercent: number;

  constructor(id: string, params: Record<string, unknown> = {}) {
    super(id, params);
    this.buyWeight = this.getParam('buyWeight', 0.3);
    this.sellWeight = this.getParam('sellWeight', 0.3);
    this.holdWeight = this.getParam('holdWeight', 0.4);
    this.maxTradePercent = this.getParam('maxTradePercent', 0.1);
  }

  async step(ctx: TickContext): Promise<Action | null> {
    const world = ctx.world as ToyWorldState;

    // Choose action based on weights
    const action = ctx.rng.weightedPick([
      { item: 'buy', weight: this.buyWeight },
      { item: 'sell', weight: this.sellWeight },
      { item: 'hold', weight: this.holdWeight },
    ]);

    if (action === 'hold') {
      return null;
    }

    // Pick a random asset
    if (world.assets.length === 0) {
      return null;
    }
    const asset = ctx.rng.pickOne(world.assets);

    if (action === 'buy') {
      // Calculate buy amount based on available cash
      const maxSpend = world.agentCash * this.maxTradePercent;
      const amount = Math.floor(maxSpend / asset.price);

      if (amount <= 0) {
        return null;
      }

      return {
        id: this.generateActionId('buy', ctx.tick),
        name: 'buy',
        params: {
          asset: asset.name,
          amount,
        },
      };
    }

    if (action === 'sell') {
      // Sell some of our holdings
      const holdings = world.agentHoldings[asset.name] ?? 0;
      const amount = Math.floor(holdings * this.maxTradePercent);

      if (amount <= 0) {
        return null;
      }

      return {
        id: this.generateActionId('sell', ctx.tick),
        name: 'sell',
        params: {
          asset: asset.name,
          amount,
        },
      };
    }

    return null;
  }
}

/**
 * Momentum agent that follows price trends
 * - Buys when price is rising
 * - Sells when price is falling
 */
export class MomentumAgent extends BaseAgent {
  private readonly threshold: number; // Price change threshold to act
  private readonly tradePercent: number; // Percent of holdings to trade

  constructor(id: string, params: Record<string, unknown> = {}) {
    super(id, params);
    this.threshold = this.getParam('threshold', 2); // 2% change
    this.tradePercent = this.getParam('tradePercent', 0.2);
  }

  async step(ctx: TickContext): Promise<Action | null> {
    const world = ctx.world as ToyWorldState;

    // Find asset with strongest momentum (positive or negative)
    let bestAsset: (typeof world.assets)[0] | null = null;
    let strongestMomentum = 0;

    for (const asset of world.assets) {
      const absChange = Math.abs(asset.priceChange);
      if (absChange > this.threshold && absChange > Math.abs(strongestMomentum)) {
        bestAsset = asset;
        strongestMomentum = asset.priceChange;
      }
    }

    if (!bestAsset) {
      return null; // No significant momentum
    }

    if (strongestMomentum > 0) {
      // Price rising - buy
      const maxSpend = world.agentCash * this.tradePercent;
      const amount = Math.floor(maxSpend / bestAsset.price);

      if (amount <= 0) {
        return null;
      }

      return {
        id: this.generateActionId('buy', ctx.tick),
        name: 'buy',
        params: {
          asset: bestAsset.name,
          amount,
        },
        metadata: {
          reason: 'momentum_up',
          priceChange: strongestMomentum,
        },
      };
    }

    // Price falling - sell
    const holdings = world.agentHoldings[bestAsset.name] ?? 0;
    const amount = Math.floor(holdings * this.tradePercent);

    if (amount <= 0) {
      return null;
    }

    return {
      id: this.generateActionId('sell', ctx.tick),
      name: 'sell',
      params: {
        asset: bestAsset.name,
        amount,
      },
      metadata: {
        reason: 'momentum_down',
        priceChange: strongestMomentum,
      },
    };
  }
}

/**
 * Holder agent that does nothing (baseline for comparison)
 */
export class HolderAgent extends BaseAgent {
  async step(_ctx: TickContext): Promise<Action | null> {
    return null;
  }
}

/**
 * Chaos agent: intentionally uses non-deterministic randomness *only* in exploration mode.
 * This is useful for stress testing the non-deterministic dashboard and tooling paths.
 */
export class ChaosAgent extends BaseAgent {
  private readonly maxTradePercent: number;

  constructor(id: string, params: Record<string, unknown> = {}) {
    super(id, params);
    this.maxTradePercent = this.getParam('maxTradePercent', 0.12);
  }

  async step(ctx: TickContext): Promise<Action | null> {
    const world = ctx.world as ToyWorldState;
    if (world.assets.length === 0) return null;
    // Only introduce nondeterminism in exploration mode.
    const r = ctx.mode === 'exploration' ? Math.random() : ctx.rng.nextFloat();
    const action = r < 0.45 ? 'buy' : r < 0.9 ? 'sell' : 'hold';
    if (action === 'hold') return null;

    const pick =
      ctx.mode === 'exploration'
        ? world.assets[Math.floor(Math.random() * world.assets.length)]!
        : ctx.rng.pickOne(world.assets);

    if (action === 'buy') {
      const maxSpend = world.agentCash * this.maxTradePercent;
      const amount = Math.floor(maxSpend / pick.price);
      if (amount <= 0) return null;
      return {
        id: this.generateActionId('buy', ctx.tick),
        name: 'buy',
        params: { asset: pick.name, amount },
        metadata: { chaos: true },
      };
    }

    const holdings = world.agentHoldings[pick.name] ?? 0;
    const amount = Math.floor(holdings * this.maxTradePercent);
    if (amount <= 0) return null;
    return {
      id: this.generateActionId('sell', ctx.tick),
      name: 'sell',
      params: { asset: pick.name, amount },
      metadata: { chaos: true },
    };
  }
}

/**
 * Value agent that buys undervalued assets and sells overvalued ones
 * Uses a simple mean-reversion strategy
 */
export class ValueAgent extends BaseAgent {
  private readonly deviationThreshold: number;
  private readonly tradePercent: number;
  private priceMemory: Map<string, number[]> = new Map();

  constructor(id: string, params: Record<string, unknown> = {}) {
    super(id, params);
    this.deviationThreshold = this.getParam('deviationThreshold', 10); // 10% from average
    this.tradePercent = this.getParam('tradePercent', 0.15);
  }

  async step(ctx: TickContext): Promise<Action | null> {
    const world = ctx.world as ToyWorldState;

    // Update price memory
    for (const asset of world.assets) {
      const history = this.priceMemory.get(asset.name) ?? [];
      history.push(asset.price);
      if (history.length > 20) {
        history.shift();
      }
      this.priceMemory.set(asset.name, history);
    }

    // Find best opportunity
    let bestOpportunity: { asset: (typeof world.assets)[0]; deviation: number } | null = null;

    for (const asset of world.assets) {
      const history = this.priceMemory.get(asset.name);
      if (!history || history.length < 5) {
        continue;
      }

      const avg = history.reduce((a, b) => a + b, 0) / history.length;
      const deviation = ((asset.price - avg) / avg) * 100;

      if (Math.abs(deviation) > this.deviationThreshold) {
        if (!bestOpportunity || Math.abs(deviation) > Math.abs(bestOpportunity.deviation)) {
          bestOpportunity = { asset, deviation };
        }
      }
    }

    if (!bestOpportunity) {
      return null;
    }

    const { asset, deviation } = bestOpportunity;

    if (deviation < 0) {
      // Price below average - buy (undervalued)
      const maxSpend = world.agentCash * this.tradePercent;
      const amount = Math.floor(maxSpend / asset.price);

      if (amount <= 0) {
        return null;
      }

      return {
        id: this.generateActionId('buy', ctx.tick),
        name: 'buy',
        params: {
          asset: asset.name,
          amount,
        },
        metadata: {
          reason: 'undervalued',
          deviation,
        },
      };
    }

    // Price above average - sell (overvalued)
    const holdings = world.agentHoldings[asset.name] ?? 0;
    const amount = Math.floor(holdings * this.tradePercent);

    if (amount <= 0) {
      return null;
    }

    return {
      id: this.generateActionId('sell', ctx.tick),
      name: 'sell',
      params: {
        asset: asset.name,
        amount,
      },
      metadata: {
        reason: 'overvalued',
        deviation,
      },
    };
  }
}
