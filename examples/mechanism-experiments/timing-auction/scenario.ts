import { defineScenario } from '../../../src/index.js';
import { FastActorAgent } from './agents/FastActorAgent.js';
import { NormalBidderAgent } from './agents/NormalBidderAgent.js';
import { AuctionPack } from './pack.js';

/**
 * Timing Auction Experiment
 *
 * This scenario demonstrates how timing advantages affect auction outcomes.
 *
 * Change the `mode` to compare:
 * - 'sealed-bid': Fast actor can see other bids (information advantage)
 * - 'commit-reveal': Bids are hidden until reveal (mitigates advantage)
 */
export default defineScenario({
  name: 'timing-auction',
  seed: 42,
  ticks: 100,
  tickSeconds: 12,

  pack: new AuctionPack({
    mode: 'sealed-bid', // Try: 'commit-reveal'
    auctionDuration: 5,
    baseItemValue: 100,
    revealPhaseTicks: 2,
    initialBalance: 10000,
  }),

  agents: [
    // Fast actor with timing advantage
    {
      type: FastActorAgent,
      count: 1,
      params: {
        minMargin: 2,
        maxBidFraction: 0.95,
      },
    },
    // Normal bidders
    {
      type: NormalBidderAgent,
      count: 8,
      params: {
        bidAggressiveness: 0.7,
        participationRate: 0.85,
      },
    },
    // Conservative bidders
    {
      type: NormalBidderAgent,
      count: 4,
      params: {
        bidAggressiveness: 0.5,
        participationRate: 0.6,
      },
    },
  ],

  metrics: {
    sampleEveryTicks: 1,
    track: [
      'totalAuctions',
      'sellerRevenue',
      'winsByFastActor',
      'winsByNormalBidders',
      'fastActorWinRate',
      'fastActorProfit',
      'normalBidderProfit',
      'avgBidsPerAuction',
    ],
  },

  assertions: [
    // Ensure auctions are running
    { type: 'gt', metric: 'totalAuctions', value: 9 },
    // Ensure bids are being placed
    { type: 'gt', metric: 'avgBidsPerAuction', value: 2 },
  ],

  studio: {
    report: {
      v: 'v1',
      blocks: [
        {
          kind: 'markdown',
          markdown:
            '# Timing Auction Report\n\nThis report is driven entirely by `scenario.studio.report` and rendered in the static dashboard output.',
        },
        {
          kind: 'dataset',
          as: 'metrics_auc',
          title: 'Auction metrics',
          table: 'metrics',
          spec: {
            v: 'v1',
            select: [
              'tick',
              'totalAuctions',
              'sellerRevenue',
              'fastActorWinRate',
              'fastActorProfit',
              'normalBidderProfit',
              'avgBidsPerAuction',
            ],
            sort: { field: 'tick', dir: 'asc' },
            limit: 5000,
          },
        },
        {
          kind: 'transform',
          as: 'metrics_auc_roll',
          title: 'Rolling seller revenue mean (window=10)',
          from: 'metrics_auc',
          steps: [
            { kind: 'select', fields: ['tick', 'sellerRevenue'] },
            {
              kind: 'rolling',
              as: 'sellerRevenue_roll_mean_10',
              field: 'sellerRevenue',
              op: 'mean',
              window: 10,
            },
          ],
        },
        {
          kind: 'chart',
          title: 'Fast actor win rate',
          chartType: 'line',
          dataset: 'metrics_auc',
          xField: 'tick',
          yField: 'fastActorWinRate',
        },
        {
          kind: 'chart',
          title: 'Seller revenue (rolling mean)',
          chartType: 'line',
          dataset: 'metrics_auc_roll',
          xField: 'tick',
          yField: 'sellerRevenue_roll_mean_10',
        },
        {
          kind: 'table',
          title: 'Auction metrics table',
          dataset: 'metrics_auc',
          limit: 5000,
        },
        {
          kind: 'ml',
          as: 'ml_linear_revenue',
          title: 'Linear regression: sellerRevenue ~ tick',
          request: {
            kind: 'linear_regression',
            runId: 'RUN_ID',
            table: 'metrics',
            x: ['tick'],
            y: 'sellerRevenue',
            limit: 5000,
          },
        },
        {
          kind: 'chart',
          title: 'Linear regression coefficients',
          chartType: 'bar',
          dataset: 'ml_linear_revenue.coefficients',
          xField: 'feature',
          yField: 'value',
        },
        {
          kind: 'chart',
          title: 'Linear regression fit vs actual',
          chartType: 'line',
          dataset: 'ml_linear_revenue.predictions_long',
          xField: 'index',
          yField: 'value',
          seriesField: 'series',
        },
        {
          kind: 'ml',
          as: 'ml_ridge_revenue',
          title: 'Ridge regression: sellerRevenue ~ tick',
          request: {
            kind: 'ridge_regression',
            runId: 'RUN_ID',
            table: 'metrics',
            x: ['tick'],
            y: 'sellerRevenue',
            lambda: 1,
            limit: 5000,
          },
        },
        {
          kind: 'chart',
          title: 'Ridge regression coefficients',
          chartType: 'bar',
          dataset: 'ml_ridge_revenue.coefficients',
          xField: 'feature',
          yField: 'value',
        },
        {
          kind: 'chart',
          title: 'Ridge regression fit vs actual',
          chartType: 'line',
          dataset: 'ml_ridge_revenue.predictions_long',
          xField: 'index',
          yField: 'value',
          seriesField: 'series',
        },
        {
          kind: 'ml',
          as: 'ml_kmeans_auction',
          title: 'K-means: (winrate, revenue, avg bids)',
          request: {
            kind: 'kmeans',
            runId: 'RUN_ID',
            table: 'metrics',
            x: ['fastActorWinRate', 'sellerRevenue', 'avgBidsPerAuction'],
            k: 3,
            seed: 1,
            limit: 5000,
          },
        },
        {
          kind: 'chart',
          title: 'K-means clusters (2D projection)',
          chartType: 'scatter',
          dataset: 'ml_kmeans_auction.points',
          xField: 'x',
          yField: 'y',
          seriesField: 'cluster',
        },
        {
          kind: 'ml',
          as: 'ml_pca_auction',
          title: 'PCA: (winrate, revenue, profits)',
          request: {
            kind: 'pca',
            runId: 'RUN_ID',
            table: 'metrics',
            x: ['fastActorWinRate', 'sellerRevenue', 'fastActorProfit', 'normalBidderProfit'],
            components: 2,
            limit: 5000,
          },
        },
        {
          kind: 'chart',
          title: 'PCA scatter (PC1 vs PC2)',
          chartType: 'scatter',
          dataset: 'ml_pca_auction.points',
          xField: 'pc1',
          yField: 'pc2',
        },
        {
          kind: 'chart',
          title: 'PCA explained variance ratio',
          chartType: 'bar',
          dataset: 'ml_pca_auction.variance',
          xField: 'component',
          yField: 'explainedVarianceRatio',
        },
        {
          kind: 'ml',
          as: 'ml_anomaly_bids',
          title: 'Anomaly detection (z-score): avgBidsPerAuction',
          request: {
            kind: 'anomaly_zscore',
            runId: 'RUN_ID',
            table: 'metrics',
            field: 'avgBidsPerAuction',
            threshold: 3.5,
            limit: 5000,
          },
        },
        {
          kind: 'chart',
          title: 'Z-score anomalies (avg bids)',
          chartType: 'scatter',
          dataset: 'ml_anomaly_bids.anomalies',
          xField: 'index',
          yField: 'value',
        },
        {
          kind: 'ml',
          as: 'ml_roll_winrate',
          title: 'Time-series rolling stats: fastActorWinRate (window=20)',
          request: {
            kind: 'timeseries_rolling',
            runId: 'RUN_ID',
            table: 'metrics',
            field: 'fastActorWinRate',
            window: 20,
            limit: 5000,
          },
        },
        {
          kind: 'chart',
          title: 'Rolling mean (win rate)',
          chartType: 'line',
          dataset: 'ml_roll_winrate.points',
          xField: 'index',
          yField: 'mean',
        },
      ],
    },
  },
});
