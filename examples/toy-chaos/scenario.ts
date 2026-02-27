import { defineScenario } from '../../src/index.js';
import {
  ChaosAgent,
  HolderAgent,
  MomentumAgent,
  RandomTraderAgent,
  ToyPack,
} from '../../src/toy/index.js';
import { GossipChatterAgent } from './agents/GossipChatterAgent.js';

/**
 * Toy Chaos (example)
 *
 * This is a "toy-market" style simulation, but with at least one ChaosAgent.
 * Run with `--mode exploration` to intentionally allow non-deterministic behaviors.
 */
export default defineScenario({
  name: 'toy-chaos',
  seed: 777,
  ticks: 150,
  tickSeconds: 3600,

  pack: new ToyPack({
    assets: [
      { name: 'ALPHA', initialPrice: 100, volatility: 0.05 },
      { name: 'BETA', initialPrice: 50, volatility: 0.08 },
      { name: 'GAMMA', initialPrice: 25, volatility: 0.12 },
    ],
    initialCash: 10000,
  }),

  agents: [
    { type: RandomTraderAgent, count: 6 },
    { type: MomentumAgent, count: 3 },
    { type: HolderAgent, count: 2 },
    { type: ChaosAgent, count: 1 },
    { type: GossipChatterAgent, count: 1, params: { postEveryTicks: 3 } },
  ],

  metrics: {
    sampleEveryTicks: 1,
    probeEmitMode: 'none',
  },

  assertions: [{ type: 'gt', metric: 'totalVolume', value: 0 }],

  studio: {
    report: {
      v: 'v1',
      blocks: [
        {
          kind: 'markdown',
          markdown:
            '# Toy Chaos Report\n\nThis example includes a `ChaosAgent` (best viewed in exploration mode).',
        },
        {
          kind: 'dataset',
          as: 'metrics_core',
          title: 'Core metrics',
          table: 'metrics',
          spec: {
            v: 'v1',
            select: ['tick', 'totalVolume', 'price_ALPHA', 'price_BETA', 'price_GAMMA'],
            sort: { field: 'tick', dir: 'asc' },
            limit: 5000,
          },
        },
        {
          kind: 'chart',
          title: 'Total volume',
          chartType: 'line',
          dataset: 'metrics_core',
          xField: 'tick',
          yField: 'totalVolume',
        },
        {
          kind: 'ml',
          as: 'ml_anomaly_volume',
          title: 'Anomaly detection (z-score): totalVolume',
          request: {
            kind: 'anomaly_zscore',
            runId: 'RUN_ID',
            table: 'metrics',
            field: 'totalVolume',
            threshold: 3.5,
            limit: 5000,
          },
        },
        {
          kind: 'chart',
          title: 'Z-score anomalies (totalVolume)',
          chartType: 'scatter',
          dataset: 'ml_anomaly_volume.anomalies',
          xField: 'index',
          yField: 'value',
        },
      ],
    },
  },
});
