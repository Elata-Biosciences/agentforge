import { defineScenario } from '../../src/index.js';
import { HolderAgent, MomentumAgent, RandomTraderAgent, ToyPack } from '../../src/toy/index.js';
import { ProviderBackedGossipAgent } from './agents/ProviderBackedGossipAgent.js';

/**
 * Canonical LLM + Gossip example.
 *
 * Recommended:
 * - exploration mode: live provider-backed gossip generation
 * - deterministic/replay mode: no live LLM calls, reproducible gossip text
 */
export default defineScenario({
  name: 'llm-gossip-provider',
  seed: 2026,
  ticks: 80,
  tickSeconds: 3600,

  pack: new ToyPack({
    assets: [
      { name: 'ALPHA', initialPrice: 100, volatility: 0.04 },
      { name: 'BETA', initialPrice: 40, volatility: 0.07 },
    ],
    initialCash: 10_000,
  }),

  agents: [
    { type: RandomTraderAgent, count: 5 },
    { type: MomentumAgent, count: 2 },
    { type: HolderAgent, count: 2 },
    {
      type: ProviderBackedGossipAgent,
      count: 2,
      params: {
        provider: 'openai',
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        channelId: 'governance',
        postEveryTicks: 2,
      },
    },
  ],

  metrics: {
    sampleEveryTicks: 1,
    track: ['totalVolume', 'price_ALPHA', 'price_BETA', 'totalAgentValue'],
  },

  assertions: [{ type: 'gt', metric: 'totalVolume', value: 0 }],

  studio: {
    report: {
      v: 'v1',
      blocks: [
        {
          kind: 'markdown',
          markdown:
            '# LLM + Gossip (Canonical)\n\n- `exploration`: live provider responses are posted to gossip channels.\n- `deterministic` / `replay`: deterministic fallback messages, no live provider calls.\n\nUse this run to compare reproducibility versus discovery behavior.',
        },
        {
          kind: 'dataset',
          as: 'core',
          title: 'Core Metrics',
          table: 'metrics',
          spec: {
            v: 'v1',
            select: ['tick', 'totalVolume', 'price_ALPHA', 'price_BETA'],
            sort: { field: 'tick', dir: 'asc' },
            limit: 5000,
          },
        },
        {
          kind: 'chart',
          title: 'Volume over Time',
          chartType: 'line',
          dataset: 'core',
          xField: 'tick',
          yField: 'totalVolume',
        },
      ],
    },
  },
});
