import { defineScenario } from '../core/scenario.js';
import type { Scenario } from '../core/types.js';
import { ChaosAgent, HolderAgent, MomentumAgent, RandomTraderAgent } from './toyAgents.js';
import { ToyPack } from './toyPack.js';

/**
 * Create a default toy scenario for testing
 *
 * Features:
 * - 3 assets with different volatilities
 * - Mix of random traders, momentum followers, and holders
 * - 100 ticks of simulation
 */
export function createToyScenario(
  options: {
    seed?: number;
    ticks?: number;
    traderCount?: number;
    momentumCount?: number;
    holderCount?: number;
    chaosCount?: number;
  } = {}
): Scenario {
  const {
    seed = 1337,
    ticks = 100,
    traderCount = 5,
    momentumCount = 3,
    holderCount = 2,
    chaosCount = 0,
  } = options;

  const pack = new ToyPack({
    assets: [
      { name: 'ALPHA', initialPrice: 100, volatility: 0.03 },
      { name: 'BETA', initialPrice: 50, volatility: 0.06 },
      { name: 'GAMMA', initialPrice: 25, volatility: 0.1 },
    ],
    initialCash: 10000,
  });

  return defineScenario({
    name: 'toy-market',
    seed,
    ticks,
    tickSeconds: 3600, // 1 hour per tick
    pack,
    agents: [
      {
        type: RandomTraderAgent,
        count: traderCount,
        params: {
          buyWeight: 0.35,
          sellWeight: 0.25,
          holdWeight: 0.4,
          maxTradePercent: 0.08,
        },
      },
      {
        type: MomentumAgent,
        count: momentumCount,
        params: {
          threshold: 1.5,
          tradePercent: 0.15,
        },
      },
      {
        type: HolderAgent,
        count: holderCount,
      },
      ...(chaosCount > 0
        ? [
            {
              type: ChaosAgent,
              count: chaosCount,
            },
          ]
        : []),
    ],
    metrics: {
      sampleEveryTicks: 1,
    },
    assertions: [
      // Ensure some trading occurred
      { type: 'gt', metric: 'totalVolume', value: 0 },
    ],
    studio: {
      report: {
        v: 'v1',
        blocks: [
          {
            kind: 'markdown',
            markdown:
              '# Toy Market Report\n\nA config-driven report dashboard (markdown + tables + charts + local ML) rendered from `forge-sim dashboard` output.',
          },
          {
            kind: 'dataset',
            as: 'metrics_core',
            title: 'Core metrics',
            table: 'metrics',
            spec: {
              v: 'v1',
              select: [
                'tick',
                'timestamp',
                'totalVolume',
                'price_ALPHA',
                'price_BETA',
                'price_GAMMA',
              ],
              sort: { field: 'tick', dir: 'asc' },
              limit: 2000,
            },
          },
          {
            kind: 'transform',
            as: 'metrics_roll',
            title: 'Rolling volume mean (window=10)',
            from: 'metrics_core',
            steps: [
              { kind: 'select', fields: ['tick', 'totalVolume'] },
              {
                kind: 'rolling',
                as: 'totalVolume_roll_mean_10',
                field: 'totalVolume',
                op: 'mean',
                window: 10,
              },
            ],
          },
          {
            kind: 'chart',
            title: 'Total volume (raw)',
            chartType: 'line',
            dataset: 'metrics_core',
            xField: 'tick',
            yField: 'totalVolume',
          },
          {
            kind: 'chart',
            title: 'Total volume (rolling mean)',
            chartType: 'line',
            dataset: 'metrics_roll',
            xField: 'tick',
            yField: 'totalVolume_roll_mean_10',
          },
          {
            kind: 'table',
            title: 'Metrics table',
            dataset: 'metrics_core',
            limit: 2000,
          },
          {
            kind: 'ml',
            as: 'ml_linear_alpha',
            title: 'Linear regression: price_ALPHA ~ tick',
            request: {
              kind: 'linear_regression',
              runId: 'RUN_ID',
              table: 'metrics',
              x: ['tick'],
              y: 'price_ALPHA',
              limit: 2000,
            },
          },
          {
            kind: 'chart',
            title: 'Linear regression coefficients',
            chartType: 'bar',
            dataset: 'ml_linear_alpha.coefficients',
            xField: 'feature',
            yField: 'value',
          },
          {
            kind: 'chart',
            title: 'Linear regression fit vs actual',
            chartType: 'line',
            dataset: 'ml_linear_alpha.predictions_long',
            xField: 'index',
            yField: 'value',
            seriesField: 'series',
          },
          {
            kind: 'ml',
            as: 'ml_ridge_alpha',
            title: 'Ridge regression: price_ALPHA ~ tick',
            request: {
              kind: 'ridge_regression',
              runId: 'RUN_ID',
              table: 'metrics',
              x: ['tick'],
              y: 'price_ALPHA',
              lambda: 1,
              limit: 2000,
            },
          },
          {
            kind: 'ml',
            as: 'ml_logistic_dummy',
            title: 'Logistic regression (demo): totalVolume>=0.5 ~ tick',
            request: {
              kind: 'logistic_regression',
              runId: 'RUN_ID',
              table: 'metrics',
              x: ['tick'],
              y: 'totalVolume',
              limit: 2000,
            },
          },
          {
            kind: 'chart',
            title: 'Logistic regression coefficients',
            chartType: 'bar',
            dataset: 'ml_logistic_dummy.coefficients',
            xField: 'feature',
            yField: 'value',
          },
          {
            kind: 'chart',
            title: 'Logistic regression p(y=1) vs y',
            chartType: 'line',
            dataset: 'ml_logistic_dummy.predictions_long',
            xField: 'index',
            yField: 'value',
            seriesField: 'series',
          },
          {
            kind: 'ml',
            as: 'ml_kmeans_prices',
            title: 'K-means clustering (prices)',
            request: {
              kind: 'kmeans',
              runId: 'RUN_ID',
              table: 'metrics',
              x: ['price_ALPHA', 'price_BETA', 'price_GAMMA'],
              k: 3,
              seed: 1,
              limit: 2000,
            },
          },
          {
            kind: 'chart',
            title: 'K-means clusters (2D projection)',
            chartType: 'scatter',
            dataset: 'ml_kmeans_prices.points',
            xField: 'x',
            yField: 'y',
            seriesField: 'cluster',
          },
          {
            kind: 'ml',
            as: 'ml_pca_prices',
            title: 'PCA (prices)',
            request: {
              kind: 'pca',
              runId: 'RUN_ID',
              table: 'metrics',
              x: ['price_ALPHA', 'price_BETA', 'price_GAMMA'],
              components: 2,
              limit: 2000,
            },
          },
          {
            kind: 'chart',
            title: 'PCA scatter (PC1 vs PC2)',
            chartType: 'scatter',
            dataset: 'ml_pca_prices.points',
            xField: 'pc1',
            yField: 'pc2',
          },
          {
            kind: 'chart',
            title: 'PCA explained variance ratio',
            chartType: 'bar',
            dataset: 'ml_pca_prices.variance',
            xField: 'component',
            yField: 'explainedVarianceRatio',
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
              limit: 2000,
            },
          },
          {
            kind: 'chart',
            title: 'Z-score anomalies (points)',
            chartType: 'scatter',
            dataset: 'ml_anomaly_volume.anomalies',
            xField: 'index',
            yField: 'value',
          },
          {
            kind: 'ml',
            as: 'ml_roll_price_alpha',
            title: 'Time-series rolling stats: price_ALPHA (window=20)',
            request: {
              kind: 'timeseries_rolling',
              runId: 'RUN_ID',
              table: 'metrics',
              field: 'price_ALPHA',
              window: 20,
              limit: 2000,
            },
          },
          {
            kind: 'chart',
            title: 'Rolling mean (price_ALPHA)',
            chartType: 'line',
            dataset: 'ml_roll_price_alpha.points',
            xField: 'index',
            yField: 'mean',
          },
          {
            kind: 'chart',
            title: 'Rolling stddev (price_ALPHA)',
            chartType: 'line',
            dataset: 'ml_roll_price_alpha.points',
            xField: 'index',
            yField: 'stddev',
          },
        ],
      },
    },
  });
}

/**
 * Default toy scenario instance
 */
export const toyScenario = createToyScenario();

/**
 * Export scenario as default for dynamic loading
 */
export default toyScenario;
