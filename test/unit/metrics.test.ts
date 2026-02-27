import { beforeEach, describe, expect, it } from 'vitest';
import { MetricsCollector, createMetricsCollector } from '../../src/core/metrics.js';
import { type MockPack, createMockLogger, createMockPack } from '../mocks/index.js';

describe('MetricsCollector', () => {
  let mockPack: MockPack;

  beforeEach(() => {
    mockPack = createMockPack({
      initialMetrics: {
        value1: 100,
        value2: 200,
        value3: 300,
      },
    });
  });

  describe('constructor', () => {
    it('creates with default options', () => {
      const collector = new MetricsCollector();
      expect(collector).toBeDefined();
    });

    it('accepts custom sample interval', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 5 });
      expect(collector).toBeDefined();
    });

    it('accepts tracked metrics filter', () => {
      const collector = new MetricsCollector({ track: ['value1', 'value2'] });
      expect(collector).toBeDefined();
    });

    it('accepts logger option', () => {
      const logger = createMockLogger();
      const collector = new MetricsCollector({ logger });
      expect(collector).toBeDefined();
    });
  });

  describe('sample', () => {
    it('samples metrics at specified interval', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 2 });

      // Tick 0 - should sample (0 % 2 === 0)
      collector.sample(0, 1000, mockPack);
      // Tick 1 - should NOT sample
      collector.sample(1, 1001, mockPack);
      // Tick 2 - should sample
      collector.sample(2, 1002, mockPack);
      // Tick 3 - should NOT sample
      collector.sample(3, 1003, mockPack);

      const samples = collector.getSamples();
      expect(samples.length).toBe(2);
      expect(samples[0]?.tick).toBe(0);
      expect(samples[1]?.tick).toBe(2);
    });

    it('samples every tick when interval is 1', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });

      for (let i = 0; i < 5; i++) {
        collector.sample(i, 1000 + i, mockPack);
      }

      expect(collector.getSamples().length).toBe(5);
    });

    it('filters metrics when track is specified', () => {
      const collector = new MetricsCollector({
        sampleEveryTicks: 1,
        track: ['value1', 'value2'],
      });

      collector.sample(0, 1000, mockPack);

      const samples = collector.getSamples();
      expect(samples[0]?.metrics).toHaveProperty('value1');
      expect(samples[0]?.metrics).toHaveProperty('value2');
      expect(samples[0]?.metrics).not.toHaveProperty('value3');
    });

    it('records all metrics when track is not specified', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });

      collector.sample(0, 1000, mockPack);

      const samples = collector.getSamples();
      expect(samples[0]?.metrics).toHaveProperty('value1');
      expect(samples[0]?.metrics).toHaveProperty('value2');
      expect(samples[0]?.metrics).toHaveProperty('value3');
    });

    it('records timestamp in sample', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });

      collector.sample(5, 12345, mockPack);

      const samples = collector.getSamples();
      expect(samples[0]?.timestamp).toBe(12345);
    });
  });

  describe('forceSample', () => {
    it('samples regardless of interval', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 100 });

      // Normal sample won't trigger at tick 5
      collector.sample(5, 1000, mockPack);
      expect(collector.getSamples().length).toBe(0);

      // Force sample should work
      collector.forceSample(5, 1000, mockPack);
      expect(collector.getSamples().length).toBe(1);
    });

    it('applies same track filter as sample', () => {
      const collector = new MetricsCollector({
        sampleEveryTicks: 1,
        track: ['value1'],
      });

      collector.forceSample(0, 1000, mockPack);

      const samples = collector.getSamples();
      expect(samples[0]?.metrics).toHaveProperty('value1');
      expect(samples[0]?.metrics).not.toHaveProperty('value2');
    });
  });

  describe('getSamples', () => {
    it('returns all collected samples', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });

      collector.sample(0, 100, mockPack);
      collector.sample(1, 200, mockPack);
      collector.sample(2, 300, mockPack);

      const samples = collector.getSamples();
      expect(samples.length).toBe(3);
      expect(samples.map((s) => s.tick)).toEqual([0, 1, 2]);
    });

    it('returns empty array when no samples', () => {
      const collector = new MetricsCollector();
      expect(collector.getSamples()).toEqual([]);
    });
  });

  describe('getFinalMetrics', () => {
    it('returns metrics from last sample', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });

      mockPack.setMetrics({ finalValue: 999 });
      collector.sample(0, 100, mockPack);
      mockPack.setMetrics({ finalValue: 1000 });
      collector.sample(1, 200, mockPack);

      const final = collector.getFinalMetrics();
      expect(final.finalValue).toBe(1000);
    });

    it('returns empty object when no samples', () => {
      const collector = new MetricsCollector();
      expect(collector.getFinalMetrics()).toEqual({});
    });
  });

  describe('toCSV', () => {
    it('generates CSV with headers', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });

      mockPack.setMetrics({ metricA: 10, metricB: 20 });
      collector.sample(0, 1000, mockPack);

      const csv = collector.toCSV();
      const lines = csv.split('\n');
      expect(lines[0]).toContain('tick');
      expect(lines[0]).toContain('timestamp');
      expect(lines[0]).toContain('metricA');
      expect(lines[0]).toContain('metricB');
    });

    it('includes data rows', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });

      mockPack.setMetrics({ count: 5 });
      collector.sample(0, 1000, mockPack);
      collector.sample(1, 2000, mockPack);

      const csv = collector.toCSV();
      const lines = csv.split('\n');
      expect(lines.length).toBe(3); // header + 2 data rows
    });

    it('returns header when no samples', () => {
      const collector = new MetricsCollector();
      const csv = collector.toCSV();
      expect(csv).toBe('tick,timestamp\n');
    });

    it('converts bigint values', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });

      mockPack.setMetrics({ bigValue: 12345n });
      collector.sample(0, 1000, mockPack);

      const csv = collector.toCSV();
      expect(csv).toContain('12345');
    });

    it('includes merged extra columns across samples', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });
      mockPack.setMetrics({ a: 1 });
      collector.sample(0, 1000, mockPack);
      collector.mergeIntoSample(0, { 'probe.x': 10 });

      mockPack.setMetrics({ a: 2 });
      collector.sample(1, 2000, mockPack);
      collector.mergeIntoSample(1, { 'probe.y': 20 });

      const csv = collector.toCSV();
      // Headers should include both probe columns even if they appear on different ticks.
      expect(csv.split('\n')[0]).toContain('probe.x');
      expect(csv.split('\n')[0]).toContain('probe.y');
      expect(csv).toContain('10');
      expect(csv).toContain('20');
    });
  });

  describe('getMetricStats', () => {
    it('calculates min, max, mean for a metric', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });

      mockPack.setMetrics({ value: 10 });
      collector.sample(0, 1000, mockPack);
      mockPack.setMetrics({ value: 20 });
      collector.sample(1, 2000, mockPack);
      mockPack.setMetrics({ value: 30 });
      collector.sample(2, 3000, mockPack);

      const stats = collector.getMetricStats('value');
      expect(stats?.min).toBe(10);
      expect(stats?.max).toBe(30);
      expect(stats?.mean).toBe(20);
      expect(stats?.count).toBe(3);
    });

    it('returns undefined for missing metric', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });

      mockPack.setMetrics({ other: 100 });
      collector.sample(0, 1000, mockPack);

      const stats = collector.getMetricStats('nonexistent');
      expect(stats).toBeUndefined();
    });

    it('handles single sample', () => {
      const collector = new MetricsCollector({ sampleEveryTicks: 1 });

      mockPack.setMetrics({ single: 42 });
      collector.sample(0, 1000, mockPack);

      const stats = collector.getMetricStats('single');
      expect(stats?.min).toBe(42);
      expect(stats?.max).toBe(42);
      expect(stats?.mean).toBe(42);
      expect(stats?.count).toBe(1);
    });
  });

  describe('createMetricsCollector', () => {
    it('creates collector with options', () => {
      const collector = createMetricsCollector({ sampleEveryTicks: 10 });
      expect(collector).toBeInstanceOf(MetricsCollector);
    });

    it('creates collector with default options', () => {
      const collector = createMetricsCollector();
      expect(collector).toBeInstanceOf(MetricsCollector);
    });
  });
});
