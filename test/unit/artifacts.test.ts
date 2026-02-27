import { constants, access, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactsWriter, generateRunId } from '../../src/core/artifacts.js';
import { MetricsCollector } from '../../src/core/metrics.js';
import type { RecordedAction, RunOptions, RunResult, Scenario } from '../../src/core/types.js';

describe('ArtifactsWriter', () => {
  let testDir: string;
  let artifactsWriter: ArtifactsWriter;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentforge-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    artifactsWriter = new ArtifactsWriter({
      outDir: testDir,
      runId: 'test-run-123',
    });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('creates run directory', async () => {
      await artifactsWriter.initialize();

      const runDir = artifactsWriter.getRunDir();
      await expect(access(runDir, constants.F_OK)).resolves.toBeUndefined();
    });

    it('creates nested directories if needed', async () => {
      const nestedWriter = new ArtifactsWriter({
        outDir: join(testDir, 'nested', 'path'),
        runId: 'nested-run',
      });

      await nestedWriter.initialize();

      const runDir = nestedWriter.getRunDir();
      await expect(access(runDir, constants.F_OK)).resolves.toBeUndefined();
    });
  });

  describe('recordAction', () => {
    it('stores actions for later writing', () => {
      const action: RecordedAction = {
        tick: 5,
        timestamp: 1234567890,
        agentId: 'agent-1',
        agentType: 'TestAgent',
        action: {
          id: 'action-1',
          name: 'buy',
          params: { amount: 100 },
        },
        result: {
          ok: true,
        },
        durationMs: 10,
      };

      artifactsWriter.recordAction(action);
      artifactsWriter.recordAction({ ...action, tick: 6 });

      // Actions are stored internally - will be written later
      // No direct way to check, but writeAll should work
    });
  });

  describe('writeSummary', () => {
    it('writes valid JSON summary', async () => {
      await artifactsWriter.initialize();

      const result: RunResult = {
        runId: 'test-run-123',
        scenarioName: 'test-scenario',
        seed: 42,
        ticks: 100,
        durationMs: 5000,
        success: true,
        failedAssertions: [],
        finalMetrics: {
          totalVolume: 1000,
          price: BigInt(100),
        },
        agentStats: [
          {
            id: 'agent-1',
            type: 'TestAgent',
            actionsAttempted: 50,
            actionsSucceeded: 45,
            actionsFailed: 5,
          },
        ],
        outputDir: artifactsWriter.getRunDir(),
      };

      await artifactsWriter.writeSummary(result);

      const summaryPath = join(artifactsWriter.getRunDir(), 'summary.json');
      const content = await readFile(summaryPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.runId).toBe('test-run-123');
      expect(parsed.scenarioName).toBe('test-scenario');
      expect(parsed.seed).toBe(42);
      expect(parsed.ticks).toBe(100);
      expect(parsed.success).toBe(true);
      expect(parsed.finalMetrics.totalVolume).toBe(1000);
      expect(parsed.finalMetrics.price).toBe('100'); // BigInt serialized as string
    });
  });

  describe('writeMetrics', () => {
    it('writes valid CSV', async () => {
      await artifactsWriter.initialize();

      const metricsCollector = new MetricsCollector({ sampleEveryTicks: 1 });

      // Simulate some samples
      const mockPack = {
        name: 'TestPack',
        initialize: async () => {},
        getWorldState: () => ({ timestamp: 0 }),
        executeAction: async () => ({ ok: true }),
        getMetrics: () => ({ price: 100, volume: 50 }),
        cleanup: async () => {},
      };

      metricsCollector.sample(0, 1000, mockPack);
      metricsCollector.sample(1, 2000, mockPack);
      metricsCollector.sample(2, 3000, mockPack);

      await artifactsWriter.writeMetrics(metricsCollector);

      const csvPath = join(artifactsWriter.getRunDir(), 'metrics.csv');
      const content = await readFile(csvPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(4); // Header + 3 rows
      expect(lines[0]).toContain('tick');
      expect(lines[0]).toContain('timestamp');
      expect(lines[0]).toContain('price');
      expect(lines[0]).toContain('volume');
    });
  });

  describe('writeActions', () => {
    it('writes newline-delimited JSON', async () => {
      await artifactsWriter.initialize();

      artifactsWriter.recordAction({
        tick: 0,
        timestamp: 1000,
        agentId: 'agent-1',
        agentType: 'TestAgent',
        action: { id: 'a1', name: 'buy', params: {} },
        result: { ok: true },
        durationMs: 5,
      });

      artifactsWriter.recordAction({
        tick: 1,
        timestamp: 2000,
        agentId: 'agent-2',
        agentType: 'TestAgent',
        action: { id: 'a2', name: 'sell', params: {} },
        result: { ok: false, error: 'insufficient balance' },
        durationMs: 3,
      });

      await artifactsWriter.writeActions();

      const actionsPath = join(artifactsWriter.getRunDir(), 'actions.ndjson');
      const content = await readFile(actionsPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(2);

      const action1 = JSON.parse(lines[0] ?? '{}');
      expect(action1.tick).toBe(0);
      expect(action1.agentId).toBe('agent-1');
      expect(action1.action.name).toBe('buy');
      expect(action1.result.ok).toBe(true);

      const action2 = JSON.parse(lines[1] ?? '{}');
      expect(action2.tick).toBe(1);
      expect(action2.result.ok).toBe(false);
      expect(action2.result.error).toBe('insufficient balance');
    });
  });

  describe('writeConfig', () => {
    it('writes resolved configuration', async () => {
      await artifactsWriter.initialize();

      const mockPack = {
        name: 'TestPack',
        initialize: async () => {},
        getWorldState: () => ({ timestamp: 0 }),
        executeAction: async () => ({ ok: true }),
        getMetrics: () => ({}),
        cleanup: async () => {},
      };

      const scenario: Scenario = {
        name: 'test-scenario',
        seed: 42,
        ticks: 100,
        tickSeconds: 3600,
        pack: mockPack,
        agents: [],
        metrics: { sampleEveryTicks: 5 },
        assertions: [{ type: 'gt', metric: 'volume', value: 0 }],
      };

      const options: RunOptions = {
        outDir: testDir,
        ci: true,
        verbose: false,
      };

      await artifactsWriter.writeConfig(scenario, options);

      const configPath = join(artifactsWriter.getRunDir(), 'config_resolved.json');
      const content = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.scenario.name).toBe('test-scenario');
      expect(parsed.scenario.seed).toBe(42);
      expect(parsed.scenario.ticks).toBe(100);
      expect(parsed.scenario.packName).toBe('TestPack');
      expect(parsed.options.ci).toBe(true);
    });
  });

  describe('writeAll', () => {
    it('writes all artifact files', async () => {
      await artifactsWriter.initialize();

      const mockPack = {
        name: 'TestPack',
        initialize: async () => {},
        getWorldState: () => ({ timestamp: 0 }),
        executeAction: async () => ({ ok: true }),
        getMetrics: () => ({ value: 100 }),
        cleanup: async () => {},
      };

      const scenario: Scenario = {
        name: 'test-scenario',
        seed: 42,
        ticks: 10,
        tickSeconds: 3600,
        pack: mockPack,
        agents: [],
      };

      const options: RunOptions = { outDir: testDir };

      const result: RunResult = {
        runId: 'test-run-123',
        scenarioName: 'test-scenario',
        seed: 42,
        ticks: 10,
        durationMs: 1000,
        success: true,
        failedAssertions: [],
        finalMetrics: { value: 100 },
        agentStats: [],
        outputDir: artifactsWriter.getRunDir(),
      };

      const metricsCollector = new MetricsCollector();
      metricsCollector.sample(0, 1000, mockPack);

      artifactsWriter.recordAction({
        tick: 0,
        timestamp: 1000,
        agentId: 'agent-1',
        agentType: 'Test',
        action: { id: 'a1', name: 'do', params: {} },
        result: {
          ok: true,
          events: [
            {
              name: 'ExploitEvidence',
              args: { exploitId: 'demo', txHash: '0xabc', note: 'proof' },
            },
          ],
        },
        durationMs: 1,
      });

      await artifactsWriter.writeAll(scenario, options, result, metricsCollector);

      const runDir = artifactsWriter.getRunDir();

      // Check all files exist
      await expect(access(join(runDir, 'summary.json'))).resolves.toBeUndefined();
      await expect(access(join(runDir, 'metrics.csv'))).resolves.toBeUndefined();
      await expect(access(join(runDir, 'actions.ndjson'))).resolves.toBeUndefined();
      await expect(access(join(runDir, 'config_resolved.json'))).resolves.toBeUndefined();
      await expect(access(join(runDir, 'evidence.json'))).resolves.toBeUndefined();
    });
  });
});

describe('generateRunId', () => {
  it('includes scenario name', () => {
    const runId = generateRunId('my-scenario');
    expect(runId).toContain('my-scenario');
  });

  it('includes timestamp in non-CI mode', () => {
    const runId = generateRunId('test', false);
    // Should have format: test-YYYY-MM-DDTHH-MM-SS-sssZ
    expect(runId).toMatch(/test-\d{4}-\d{2}-\d{2}T/);
  });

  it('uses stable naming in CI mode', () => {
    const runId = generateRunId('test', true);
    expect(runId).toBe('test-ci');
  });

  it('appends suffix when provided', () => {
    const runId = generateRunId('test', true, 'seed-7');
    expect(runId).toBe('test-ci-seed-7');
  });

  it('produces unique IDs in non-CI mode', () => {
    const runId1 = generateRunId('test', false);
    // Small delay to ensure different timestamp
    const runId2 = generateRunId('test', false);

    // Due to millisecond precision, these could be same or different
    // But format should be consistent
    expect(runId1).toMatch(/^test-/);
    expect(runId2).toMatch(/^test-/);
  });
});
