import { defineScenario } from '../../../src/index.js';
import { SearcherAgent } from './agents/SearcherAgent.js';
import { UserAgent } from './agents/UserAgent.js';
import { OrderingPack } from './pack.js';

/**
 * Ordering Tax Experiment
 *
 * This scenario demonstrates how transaction ordering policies affect
 * value distribution between searchers, users, and the mechanism.
 *
 * Change the `orderingPolicy` to observe different dynamics:
 * - 'priority': Higher priority fee = earlier execution (searcher-favoring)
 * - 'random': Shuffled each tick (more fair, deterministic with seed)
 * - 'round-robin': Rotating first position (most predictable)
 */
export default defineScenario({
  name: 'ordering-tax',
  seed: 42,
  ticks: 100,
  tickSeconds: 12, // ~12 seconds per block

  pack: new OrderingPack({
    opportunityValue: 100,
    valueVolatility: 0.2,
    orderingPolicy: 'priority', // Try: 'random', 'round-robin'
    taxRate: 0.1,
    initialBalance: 10000,
  }),

  agents: [
    // Aggressive searchers
    {
      type: SearcherAgent,
      count: 3,
      params: {
        aggression: 0.8,
        minProfitThreshold: 5,
      },
    },
    // Conservative searchers
    {
      type: SearcherAgent,
      count: 2,
      params: {
        aggression: 0.3,
        minProfitThreshold: 20,
      },
    },
    // Regular users
    {
      type: UserAgent,
      count: 10,
      params: {
        captureChance: 0.2,
        tradeChance: 0.4,
        tradeSize: 50,
      },
    },
  ],

  metrics: {
    sampleEveryTicks: 1,
    track: [
      'totalOpportunities',
      'capturedBySearchers',
      'capturedByUsers',
      'totalSearcherProfit',
      'mechanismRevenue',
      'averageSlippage',
      'searcherDominance',
    ],
  },

  assertions: [
    // Ensure opportunities are being captured
    { type: 'gt', metric: 'captureRate', value: 0.5 },
    // Ensure mechanism is collecting revenue
    { type: 'gt', metric: 'mechanismRevenue', value: 0 },
  ],
});
