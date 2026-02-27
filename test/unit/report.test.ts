import { describe, expect, it } from 'vitest';
import {
  type ActionFrequency,
  type MetricsSample,
  type RecordedAction,
  type RunArtifacts,
  compareRuns,
  computeActionFrequencies,
  computeHash,
  computeMetricStats,
  findMostExpensiveAction,
  formatNumber,
  formatPercent,
  generateCompareReport,
  generateMarkdownReport,
} from '../../src/core/report.js';

describe('Report Utilities', () => {
  describe('computeHash', () => {
    it('returns consistent hash for same content', () => {
      const hash1 = computeHash('test content');
      const hash2 = computeHash('test content');
      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different content', () => {
      const hash1 = computeHash('content a');
      const hash2 = computeHash('content b');
      expect(hash1).not.toBe(hash2);
    });

    it('returns 64 character hex string', () => {
      const hash = computeHash('any content');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('computeMetricStats', () => {
    it('computes correct statistics for numeric values', () => {
      const samples: MetricsSample[] = [
        { tick: 0, timestamp: 0, value: 10 },
        { tick: 1, timestamp: 1, value: 20 },
        { tick: 2, timestamp: 2, value: 30 },
        { tick: 3, timestamp: 3, value: 40 },
        { tick: 4, timestamp: 4, value: 50 },
      ];

      const stats = computeMetricStats(samples, 'value');

      expect(stats).not.toBeNull();
      expect(stats?.min).toBe(10);
      expect(stats?.max).toBe(50);
      expect(stats?.mean).toBe(30);
      expect(stats?.count).toBe(5);
    });

    it('returns null for non-existent metric', () => {
      const samples: MetricsSample[] = [{ tick: 0, timestamp: 0, value: 10 }];

      const stats = computeMetricStats(samples, 'nonexistent');
      expect(stats).toBeNull();
    });

    it('returns null for empty samples', () => {
      const stats = computeMetricStats([], 'value');
      expect(stats).toBeNull();
    });

    it('filters out non-numeric values', () => {
      const samples: MetricsSample[] = [
        { tick: 0, timestamp: 0, value: 10 },
        { tick: 1, timestamp: 1, value: 'not a number' },
        { tick: 2, timestamp: 2, value: 30 },
      ];

      const stats = computeMetricStats(samples, 'value');
      expect(stats?.count).toBe(2);
      expect(stats?.mean).toBe(20);
    });
  });

  describe('computeActionFrequencies', () => {
    it('computes correct frequencies for actions', () => {
      const actions: RecordedAction[] = [
        createMockAction('buy', true),
        createMockAction('buy', true),
        createMockAction('buy', false),
        createMockAction('sell', true),
        createMockAction('sell', true),
      ];

      const frequencies = computeActionFrequencies(actions);

      expect(frequencies).toHaveLength(2);

      const buyFreq = frequencies.find((f) => f.name === 'buy');
      expect(buyFreq?.count).toBe(3);
      expect(buyFreq?.successCount).toBe(2);
      expect(buyFreq?.failureCount).toBe(1);

      const sellFreq = frequencies.find((f) => f.name === 'sell');
      expect(sellFreq?.count).toBe(2);
      expect(sellFreq?.successCount).toBe(2);
      expect(sellFreq?.failureCount).toBe(0);
    });

    it('returns empty array for empty actions', () => {
      const frequencies = computeActionFrequencies([]);
      expect(frequencies).toHaveLength(0);
    });

    it('skips null actions', () => {
      const actions: RecordedAction[] = [
        {
          tick: 0,
          timestamp: 0,
          agentId: 'a',
          agentType: 'A',
          action: null,
          result: null,
          durationMs: 0,
        },
        createMockAction('buy', true),
      ];

      const frequencies = computeActionFrequencies(actions);
      expect(frequencies).toHaveLength(1);
      expect(frequencies[0]?.name).toBe('buy');
    });

    it('sorts by count descending', () => {
      const actions: RecordedAction[] = [
        createMockAction('rare', true),
        createMockAction('common', true),
        createMockAction('common', true),
        createMockAction('common', true),
      ];

      const frequencies = computeActionFrequencies(actions);
      expect(frequencies[0]?.name).toBe('common');
      expect(frequencies[1]?.name).toBe('rare');
    });
  });

  describe('findMostExpensiveAction', () => {
    it('finds action with highest gas usage', () => {
      const actions: RecordedAction[] = [
        createMockActionWithGas('buy', '100000'),
        createMockActionWithGas('sell', '500000'),
        createMockActionWithGas('transfer', '21000'),
      ];

      const mostExpensive = findMostExpensiveAction(actions);
      expect(mostExpensive?.action?.name).toBe('sell');
    });

    it('returns null for empty actions', () => {
      const mostExpensive = findMostExpensiveAction([]);
      expect(mostExpensive).toBeNull();
    });

    it('returns null when no actions have gas', () => {
      const actions: RecordedAction[] = [
        createMockAction('buy', true),
        createMockAction('sell', true),
      ];

      const mostExpensive = findMostExpensiveAction(actions);
      expect(mostExpensive).toBeNull();
    });
  });

  describe('formatNumber', () => {
    it('formats integers with commas', () => {
      expect(formatNumber(1000000)).toBe('1,000,000');
    });

    it('formats floats with 4 decimal places', () => {
      expect(formatNumber(Math.PI)).toBe('3.1416');
    });

    it('passes through strings', () => {
      expect(formatNumber('hello')).toBe('hello');
    });
  });

  describe('formatPercent', () => {
    it('formats decimal as percentage', () => {
      expect(formatPercent(0.5)).toBe('50.0%');
      expect(formatPercent(0.123)).toBe('12.3%');
      expect(formatPercent(1)).toBe('100.0%');
    });
  });

  describe('generateMarkdownReport', () => {
    it('generates valid markdown structure', () => {
      const artifacts = createMockArtifacts();
      const report = generateMarkdownReport(artifacts);

      expect(report).toContain('# Simulation Report:');
      expect(report).toContain('## Run Metadata');
      expect(report).toContain('## KPI Summary');
      expect(report).toContain('## Agent Statistics');
      expect(report).toContain('## Action Analysis');
      expect(report).toContain('## Tail Risk & Regime Signals');
      expect(report).toContain('## Determinism Fingerprint');
    });

    it('includes git commit when provided', () => {
      const artifacts = createMockArtifacts();
      const report = generateMarkdownReport(artifacts, 'abc123');

      expect(report).toContain('abc123');
    });

    it('includes failed assertions when present', () => {
      const artifacts = createMockArtifacts();
      artifacts.summary.failedAssertions = [
        {
          assertion: { type: 'gt', metric: 'volume', value: 100 },
          actualValue: 50,
          message: 'Expected volume > 100, got 50',
        },
      ];

      const report = generateMarkdownReport(artifacts);
      expect(report).toContain('## Failed Assertions');
      expect(report).toContain('Expected volume > 100, got 50');
    });
  });

  describe('compareRuns', () => {
    it('detects metadata differences', () => {
      const runA = createMockArtifacts();
      const runB = createMockArtifacts();
      runB.summary.seed = 100;

      const comparison = compareRuns(runA, runB);

      expect(comparison.metadataDiffs).toContainEqual({
        field: 'seed',
        valueA: '42',
        valueB: '100',
      });
    });

    it('computes KPI diffs correctly', () => {
      const runA = createMockArtifacts();
      const runB = createMockArtifacts();
      runA.summary.finalMetrics.volume = 100;
      runB.summary.finalMetrics.volume = 120;

      const comparison = compareRuns(runA, runB);

      const volumeDiff = comparison.kpiDiffs.find((d) => d.metric === 'volume');
      expect(volumeDiff?.valueA).toBe(100);
      expect(volumeDiff?.valueB).toBe(120);
      expect(volumeDiff?.delta).toBe(20);
      expect(volumeDiff?.percentChange).toBe('+20.0%');
    });
  });

  describe('generateCompareReport', () => {
    it('generates valid markdown structure', () => {
      const runA = createMockArtifacts();
      const runB = createMockArtifacts();
      const comparison = compareRuns(runA, runB);
      const report = generateCompareReport(comparison);

      expect(report).toContain('# Run Comparison Report');
      expect(report).toContain('## Metadata');
      expect(report).toContain('## KPI Comparison');
      expect(report).toContain('## Verdict');
      expect(report).toContain('## Determinism Check');
    });

    it('highlights significant changes', () => {
      const runA = createMockArtifacts();
      const runB = createMockArtifacts();
      runA.summary.finalMetrics.volume = 100;
      runB.summary.finalMetrics.volume = 200; // 100% change

      const comparison = compareRuns(runA, runB);
      const report = generateCompareReport(comparison);

      expect(report).toContain('Significant changes detected');
    });
  });
});

// Helper functions

function createMockAction(name: string, success: boolean): RecordedAction {
  return {
    tick: 0,
    timestamp: 0,
    agentId: 'agent-0',
    agentType: 'TestAgent',
    action: {
      id: `action-${Math.random()}`,
      name,
      params: {},
    },
    result: { ok: success },
    durationMs: 1,
  };
}

function createMockActionWithGas(name: string, gasUsed: string): RecordedAction {
  return {
    tick: 0,
    timestamp: 0,
    agentId: 'agent-0',
    agentType: 'TestAgent',
    action: {
      id: `action-${Math.random()}`,
      name,
      params: {},
    },
    result: { ok: true, gasUsed },
    durationMs: 1,
  };
}

function createMockArtifacts(): RunArtifacts {
  return {
    runDir: '/test/run',
    summary: {
      runId: 'test-run',
      scenarioName: 'test-scenario',
      seed: 42,
      ticks: 100,
      durationMs: 1000,
      success: true,
      failedAssertions: [],
      finalMetrics: { volume: 1000, tick: 99 },
      agentStats: [
        {
          id: 'agent-0',
          type: 'TestAgent',
          actionsAttempted: 100,
          actionsSucceeded: 95,
          actionsFailed: 5,
        },
      ],
      timestamp: new Date().toISOString(),
    },
    config: {
      scenario: {
        name: 'test-scenario',
        seed: 42,
        ticks: 100,
        tickSeconds: 3600,
        packName: 'TestPack',
        agentCount: 1,
        agentTypes: [{ type: 'TestAgent', count: 1 }],
      },
      options: {},
    },
    metrics: Array.from({ length: 10 }, (_v, i) => ({
      tick: i,
      timestamp: i,
      volume: i * 100,
    })),
    actions: [createMockAction('buy', true), createMockAction('sell', true)],
    hashes: {
      summary: 'hash1',
      config: 'hash2',
      metrics: 'hash3',
      actions: 'hash4',
    },
  };
}
