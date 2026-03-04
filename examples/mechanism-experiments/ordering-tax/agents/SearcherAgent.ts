import { BaseAgent } from '../../../../src/core/agent.js';
import type { Action, TickContext } from '../../../../src/core/types.js';

/**
 * SearcherAgent - Professional opportunity capturer
 *
 * This agent aggressively attempts to capture opportunities by:
 * 1. Setting priority fees to get earlier execution
 * 2. Capturing opportunities when they appear
 *
 * Parameters:
 * - aggression: How aggressively to bid for priority (0-1)
 * - minProfitThreshold: Minimum expected profit to attempt capture
 */
export class SearcherAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | null> {
    const world = ctx.world;
    const opportunityValue = world.opportunityValue as number;
    const opportunityCaptured = world.opportunityCaptured as boolean;
    const taxRate = world.taxRate as number;
    const balance = world.agentBalance as number;
    const orderingPolicy = world.orderingPolicy as string;

    // Skip if opportunity already captured
    if (opportunityCaptured) {
      return null;
    }

    // Get parameters
    const aggression = this.getParam<number>('aggression', 0.5);
    const minProfitThreshold = this.getParam<number>('minProfitThreshold', 10);

    // Calculate expected profit
    const tax = opportunityValue * taxRate;
    const maxPriorityFee = opportunityValue - tax - minProfitThreshold;

    if (maxPriorityFee <= 0) {
      // Not profitable enough
      return null;
    }

    // For priority ordering, set priority fee first
    if (orderingPolicy === 'priority') {
      // Calculate priority fee based on aggression and expected competition
      const priorityFee = Math.min(maxPriorityFee * aggression, balance * 0.1);

      if (priorityFee > 0 && !this.recall<boolean>('feeSet')) {
        this.remember('feeSet', true);
        return {
          id: this.generateActionId('setPriorityFee', ctx.tick),
          name: 'setPriorityFee',
          params: { fee: priorityFee },
        };
      }
    }

    // Attempt to capture opportunity
    this.forget('feeSet'); // Reset for next tick
    return {
      id: this.generateActionId('captureOpportunity', ctx.tick),
      name: 'captureOpportunity',
      params: {},
    };
  }
}
