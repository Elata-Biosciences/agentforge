import { BaseAgent } from '../../../../src/core/agent.js';
import type { Action, TickContext } from '../../../../src/core/types.js';

/**
 * UserAgent - Regular user making normal transactions
 *
 * This agent occasionally attempts to capture opportunities and makes
 * regular trades. Unlike searchers, they don't optimize for priority
 * and may experience slippage.
 *
 * Parameters:
 * - captureChance: Probability of attempting to capture opportunity (0-1)
 * - tradeChance: Probability of making a regular trade (0-1)
 * - tradeSize: Average trade size
 */
export class UserAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | null> {
    const world = ctx.world;
    const opportunityValue = world.opportunityValue as number;
    const opportunityCaptured = world.opportunityCaptured as boolean;

    // Get parameters
    const captureChance = this.getParam<number>('captureChance', 0.3);
    const tradeChance = this.getParam<number>('tradeChance', 0.5);
    const tradeSize = this.getParam<number>('tradeSize', 50);

    // Sometimes try to capture opportunity
    if (!opportunityCaptured && opportunityValue > 0 && ctx.rng.chance(captureChance)) {
      return {
        id: this.generateActionId('captureOpportunity', ctx.tick),
        name: 'captureOpportunity',
        params: {},
      };
    }

    // Otherwise make regular trades
    if (ctx.rng.chance(tradeChance)) {
      // Expected value with random variation
      const expectedValue = tradeSize * (0.8 + ctx.rng.nextFloat() * 0.4);

      // Actual value may differ due to market conditions (slippage simulation)
      const slippageFactor = 0.95 + ctx.rng.nextFloat() * 0.1; // 0.95 to 1.05
      const actualValue = expectedValue * slippageFactor;

      return {
        id: this.generateActionId('trade', ctx.tick),
        name: 'trade',
        params: {
          expectedValue,
          actualValue,
        },
      };
    }

    return null;
  }
}
