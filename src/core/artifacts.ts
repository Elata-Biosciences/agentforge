import { mkdir, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { MetricsCollector } from './metrics.js';
import type {
  GossipMessage,
  RecordedAction,
  ReplayBundle,
  RunOptions,
  RunResult,
  Scenario,
  SmokeDivergenceResult,
} from './types.js';

/**
 * Options for the artifacts writer
 */
export interface ArtifactsWriterOptions {
  /** Base output directory */
  outDir: string;
  /** Run identifier */
  runId: string;
  /** Logger instance */
  logger?: Logger;
  /** Optional hook for live streaming / sidecars */
  onActionRecorded?: (action: RecordedAction) => void;
  onGossipRecorded?: (event: GossipArtifactRow) => void;
}

export type GossipArtifactRow = {
  tick: number;
  timestamp: number;
  kind: 'gossip_post' | 'gossip_deliver';
  messageId: string;
  recipientAgentId?: string;
  message?: GossipMessage;
};

/**
 * Writes simulation artifacts to disk
 *
 * Output structure:
 * - summary.json: Run metadata and final KPIs
 * - metrics.csv: Time-series metrics data
 * - actions.ndjson: Newline-delimited JSON of all actions
 * - evidence.json: Extracted exploit evidence records (if any)
 * - config_resolved.json: Resolved scenario configuration
 * - run.log: Structured log output (if configured)
 */
export class ArtifactsWriter {
  private readonly outDir: string;
  private readonly runId: string;
  private readonly logger: Logger | undefined;
  private readonly onActionRecorded: ((action: RecordedAction) => void) | undefined;
  private readonly onGossipRecorded: ((event: GossipArtifactRow) => void) | undefined;
  private readonly runDir: string;
  private readonly actions: RecordedAction[] = [];
  private replayBundle: ReplayBundle | null = null;
  private replayDivergence: import('./types.js').ReplayDivergenceResult | null = null;
  private smokeResults: SmokeDivergenceResult[] = [];
  private logFileHandle: Awaited<ReturnType<typeof import('node:fs/promises').open>> | null = null;
  private memoryFileHandle: Awaited<ReturnType<typeof import('node:fs/promises').open>> | null =
    null;
  private memoryBuffer: string[] = [];
  private memoryWriteChain: Promise<void> = Promise.resolve();
  private gossipFileHandle: Awaited<ReturnType<typeof import('node:fs/promises').open>> | null =
    null;
  private gossipBuffer: string[] = [];
  private gossipWriteChain: Promise<void> = Promise.resolve();
  private gossipStats = {
    posts: 0,
    deliveries: 0,
    byChannel: {} as Record<string, number>,
    byAgent: {} as Record<string, number>,
  };

  constructor(options: ArtifactsWriterOptions) {
    this.outDir = options.outDir;
    this.runId = options.runId;
    this.logger = options.logger;
    this.onActionRecorded = options.onActionRecorded;
    this.onGossipRecorded = options.onGossipRecorded;
    this.runDir = join(this.outDir, this.runId);
  }

  /**
   * Initialize the artifacts directory
   */
  async initialize(): Promise<void> {
    await mkdir(this.runDir, { recursive: true });
    this.logger?.debug({ runDir: this.runDir }, 'Created artifacts directory');
  }

  /**
   * Get the run directory path
   * @returns The absolute path to the run output directory
   */
  getRunDir(): string {
    return this.runDir;
  }

  /**
   * Record an action for later writing
   * @param action - The recorded action to store
   */
  recordAction(action: RecordedAction): void {
    this.actions.push(action);
    try {
      this.onActionRecorded?.(action);
    } catch (err) {
      this.logger?.warn({ err }, 'onActionRecorded hook threw');
    }
  }

  recordGossipEvent(event: GossipArtifactRow): void {
    if (event.kind === 'gossip_post') {
      this.gossipStats.posts++;
      const channel = event.message?.envelope?.channelId;
      if (channel)
        this.gossipStats.byChannel[channel] = (this.gossipStats.byChannel[channel] ?? 0) + 1;
      const author = event.message?.envelope?.authorAgentId;
      if (author) this.gossipStats.byAgent[author] = (this.gossipStats.byAgent[author] ?? 0) + 1;
    } else if (event.kind === 'gossip_deliver') {
      this.gossipStats.deliveries++;
    }
    try {
      this.onGossipRecorded?.(event);
    } catch (err) {
      this.logger?.warn({ err }, 'onGossipRecorded hook threw');
    }
    let line: string;
    try {
      line = JSON.stringify(event);
    } catch (err) {
      this.logger?.warn({ err }, 'Failed to stringify gossip event');
      return;
    }
    this.gossipBuffer.push(line);
    if (this.gossipBuffer.length >= 200) {
      this.flushGossipBuffer();
    }
  }

  private flushGossipBuffer(): void {
    if (this.gossipBuffer.length === 0) return;
    const chunk = `${this.gossipBuffer.join('\n')}\n`;
    this.gossipBuffer = [];
    const path = join(this.runDir, 'gossip.ndjson');
    this.gossipWriteChain = this.gossipWriteChain
      .then(async () => {
        if (!this.gossipFileHandle) {
          this.gossipFileHandle = await open(path, 'a');
        }
        await this.gossipFileHandle.write(chunk);
      })
      .catch((err) => {
        this.logger?.warn({ err }, 'Failed to write gossip.ndjson chunk');
      });
  }

  async flushGossip(): Promise<void> {
    this.flushGossipBuffer();
    await this.gossipWriteChain;
  }

  recordAgentMemorySnapshot(
    record: Record<string, unknown>,
    maxBytesPerRecord: number | null
  ): void {
    const safeBase = record;
    let line: string;
    try {
      line = JSON.stringify(safeBase);
    } catch (err) {
      line = JSON.stringify({
        ...(typeof record === 'object' && record ? record : {}),
        memory: { __error: 'memory_snapshot_stringify_failed' },
      });
      this.logger?.warn({ err }, 'Failed to stringify agent memory snapshot');
    }

    if (maxBytesPerRecord !== null) {
      const bytes = Buffer.byteLength(line, 'utf8');
      if (bytes > maxBytesPerRecord) {
        const memory = (record as any).memory;
        const keys =
          memory && typeof memory === 'object' && !Array.isArray(memory)
            ? Object.keys(memory as Record<string, unknown>).slice(0, 200)
            : [];
        line = JSON.stringify({
          ...record,
          memory: {
            __truncated: true,
            originalBytes: bytes,
            maxBytes: maxBytesPerRecord,
            keys,
          },
        });
      }
    }

    this.memoryBuffer.push(line);
    if (this.memoryBuffer.length >= 100) {
      this.flushAgentMemoryBuffer();
    }
  }

  private flushAgentMemoryBuffer(): void {
    if (this.memoryBuffer.length === 0) return;
    const chunk = `${this.memoryBuffer.join('\n')}\n`;
    this.memoryBuffer = [];
    const path = join(this.runDir, 'agent_memory.ndjson');
    this.memoryWriteChain = this.memoryWriteChain
      .then(async () => {
        if (!this.memoryFileHandle) {
          this.memoryFileHandle = await open(path, 'a');
        }
        await this.memoryFileHandle.write(chunk);
      })
      .catch((err) => {
        this.logger?.warn({ err }, 'Failed to write agent_memory.ndjson chunk');
      });
  }

  async flushAgentMemory(): Promise<void> {
    this.flushAgentMemoryBuffer();
    await this.memoryWriteChain;
  }

  /**
   * Write all artifacts at the end of the simulation
   * @param scenario - The scenario that was executed
   * @param options - The resolved run options
   * @param result - The simulation result
   * @param metricsCollector - The metrics collector with all samples
   */
  async writeAll(
    scenario: Scenario,
    options: RunOptions,
    result: RunResult,
    metricsCollector: MetricsCollector
  ): Promise<void> {
    await Promise.all([
      this.writeSummary(result),
      this.writeMetrics(metricsCollector),
      this.writeActions(),
      this.writeEvidence(),
      this.writeConfig(scenario, options),
      this.writeReplayBundle(),
      this.writeSmokeResults(),
      this.writeReplayDivergence(),
    ]);

    await this.flushAgentMemory();
    await this.flushGossip();
    this.logger?.info({ runDir: this.runDir }, 'Wrote all artifacts');
  }

  /**
   * Write the summary.json file
   * @param result - The simulation result to write
   */
  async writeSummary(result: RunResult): Promise<void> {
    const summary = {
      runId: result.runId,
      scenarioName: result.scenarioName,
      seed: result.seed,
      ticks: result.ticks,
      durationMs: result.durationMs,
      success: result.success,
      failedAssertions: result.failedAssertions,
      finalMetrics: serializeMetrics(result.finalMetrics),
      agentStats: result.agentStats,
      gossipStats: this.gossipStats,
      timestamp: new Date().toISOString(),
    };

    const path = join(this.runDir, 'summary.json');
    await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`);
    this.logger?.debug({ path }, 'Wrote summary.json');
  }

  /**
   * Write the metrics.csv file
   * @param metricsCollector - The metrics collector with time-series data
   */
  async writeMetrics(metricsCollector: MetricsCollector): Promise<void> {
    const csv = metricsCollector.toCSV();
    const path = join(this.runDir, 'metrics.csv');
    await writeFile(path, csv);
    this.logger?.debug({ path, rows: metricsCollector.getSamples().length }, 'Wrote metrics.csv');
  }

  /**
   * Write the actions.ndjson file
   */
  async writeActions(): Promise<void> {
    const lines = this.actions.map((action) => JSON.stringify(serializeAction(action)));
    const path = join(this.runDir, 'actions.ndjson');
    await writeFile(path, lines.join('\n'));
    this.logger?.debug({ path, count: this.actions.length }, 'Wrote actions.ndjson');
  }

  /**
   * Write evidence.json if ExploitEvidence events exist.
   */
  async writeEvidence(): Promise<void> {
    const evidence = extractExploitEvidence(this.actions);
    if (evidence.records.length === 0) {
      return;
    }
    const path = join(this.runDir, 'evidence.json');
    await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
    this.logger?.debug({ path, count: evidence.records.length }, 'Wrote evidence.json');
  }

  /**
   * Write the config_resolved.json file
   * @param scenario - The scenario configuration
   * @param options - The resolved run options
   */
  async writeConfig(scenario: Scenario, options: RunOptions): Promise<void> {
    const config = {
      scenario: {
        name: scenario.name,
        seed: options.seed ?? scenario.seed,
        ticks: options.ticks ?? scenario.ticks,
        tickSeconds: options.tickSeconds ?? scenario.tickSeconds,
        packName: scenario.pack.name,
        agentCount: scenario.agents.reduce((sum, a) => sum + a.count, 0),
        agentTypes: scenario.agents.map((a) => ({
          type: a.type.name,
          count: a.count,
        })),
        metrics: scenario.metrics,
        assertions: scenario.assertions,
        mode: options.mode ?? 'deterministic',
        // Report/dashboard configuration (JSON-only; validated downstream).
        studio: scenario.studio ?? undefined,
      },
      options: {
        outDir: options.outDir,
        ci: options.ci,
        verbose: options.verbose,
        ...(options.memoryCapture ? { memoryCapture: options.memoryCapture } : {}),
      },
    };

    const path = join(this.runDir, 'config_resolved.json');
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
    this.logger?.debug({ path }, 'Wrote config_resolved.json');
  }

  setReplayBundle(bundle: ReplayBundle): void {
    this.replayBundle = bundle;
  }

  setReplayDivergence(divergence: import('./types.js').ReplayDivergenceResult): void {
    this.replayDivergence = divergence;
  }

  setSmokeResults(results: SmokeDivergenceResult[]): void {
    this.smokeResults = results;
  }

  async writeReplayBundle(): Promise<void> {
    if (!this.replayBundle) {
      return;
    }
    const path = join(this.runDir, 'replay_bundle.json');
    await writeFile(
      path,
      `${JSON.stringify(
        this.replayBundle,
        (_k, value) => (typeof value === 'bigint' ? value.toString() : value),
        2
      )}\n`
    );
    this.logger?.debug({ path }, 'Wrote replay_bundle.json');
  }

  async writeSmokeResults(): Promise<void> {
    if (this.smokeResults.length === 0) {
      return;
    }
    const path = join(this.runDir, 'smoke_results.json');
    await writeFile(path, `${JSON.stringify(this.smokeResults, null, 2)}\n`);
    this.logger?.debug({ path }, 'Wrote smoke_results.json');
  }

  async writeReplayDivergence(): Promise<void> {
    if (!this.replayDivergence) {
      return;
    }
    const path = join(this.runDir, 'replay_divergence.json');
    await writeFile(path, `${JSON.stringify(this.replayDivergence, null, 2)}\n`);
    this.logger?.debug({ path }, 'Wrote replay_divergence.json');
  }

  /**
   * Append a log line to run.log
   * @param line - The log line to append
   */
  async appendLog(line: string): Promise<void> {
    const path = join(this.runDir, 'run.log');
    await writeFile(path, `${line}\n`, { flag: 'a' });
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.logFileHandle) {
      await this.logFileHandle.close();
      this.logFileHandle = null;
    }
    await this.flushAgentMemory();
    if (this.memoryFileHandle) {
      await this.memoryFileHandle.close();
      this.memoryFileHandle = null;
    }
    await this.flushGossip();
    if (this.gossipFileHandle) {
      await this.gossipFileHandle.close();
      this.gossipFileHandle = null;
    }
  }
}

type EvidenceRecordV1 = {
  tick: number;
  timestamp: number;
  agentId: string;
  agentType: string;
  actionId: string;
  actionName: string;
  txHash?: string;
  exploitId?: string;
  evidence: Record<string, unknown>;
};

type EvidenceBundleV1 = {
  version: 'v1';
  records: EvidenceRecordV1[];
};

function extractExploitEvidence(actions: RecordedAction[]): EvidenceBundleV1 {
  const records: EvidenceRecordV1[] = [];
  for (const a of actions) {
    if (!a.action || !a.result?.events) continue;
    for (const ev of a.result.events) {
      if (ev.name !== 'ExploitEvidence') continue;
      const exploitId = typeof ev.args.exploitId === 'string' ? ev.args.exploitId : undefined;
      const txHash =
        typeof ev.args.txHash === 'string'
          ? ev.args.txHash
          : typeof a.result.txHash === 'string'
            ? a.result.txHash
            : undefined;
      const evidence = serializeBigInts(ev.args) as Record<string, unknown>;
      const base: EvidenceRecordV1 = {
        tick: a.tick,
        timestamp: a.timestamp,
        agentId: a.agentId,
        agentType: a.agentType,
        actionId: a.action.id,
        actionName: a.action.name,
        evidence,
        ...(txHash !== undefined ? { txHash } : {}),
        ...(exploitId !== undefined ? { exploitId } : {}),
      };
      records.push(base);
    }
  }
  return { version: 'v1', records };
}

/**
 * Serialize metrics, converting bigints to strings
 */
function serializeMetrics(
  metrics: Record<string, number | bigint | string>
): Record<string, number | string> {
  const result: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(metrics)) {
    result[key] = typeof value === 'bigint' ? value.toString() : value;
  }
  return result;
}

/**
 * Recursively convert BigInt values to strings for JSON serialization
 */
function serializeBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeBigInts);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = serializeBigInts(v);
    }
    return result;
  }
  return value;
}

/**
 * Serialize an action for JSON output
 */
function serializeAction(action: RecordedAction): Record<string, unknown> {
  return {
    tick: action.tick,
    timestamp: action.timestamp,
    agentId: action.agentId,
    agentType: action.agentType,
    action: action.action
      ? {
          id: action.action.id,
          name: action.action.name,
          params: serializeBigInts(action.action.params),
          ...(action.action.metadata !== undefined
            ? { metadata: serializeBigInts(action.action.metadata) }
            : {}),
        }
      : null,
    result: action.result
      ? {
          ok: action.result.ok,
          error: action.result.error,
          events: action.result.events ? serializeBigInts(action.result.events) : undefined,
          balanceDeltas: action.result.balanceDeltas
            ? serializeBigInts(action.result.balanceDeltas)
            : undefined,
          gasUsed: action.result.gasUsed?.toString(),
          txHash: action.result.txHash,
        }
      : null,
    durationMs: action.durationMs,
  };
}

/**
 * Generate a unique run ID
 * @param scenarioName - The name of the scenario
 * @param ci - Whether running in CI mode (uses stable naming)
 * @returns A unique identifier for this run
 */
export function generateRunId(scenarioName: string, ci = false, runIdSuffix?: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (ci) {
    // In CI mode, use a more stable naming convention
    return runIdSuffix ? `${scenarioName}-ci-${runIdSuffix}` : `${scenarioName}-ci`;
  }

  return runIdSuffix
    ? `${scenarioName}-${timestamp}-${runIdSuffix}`
    : `${scenarioName}-${timestamp}`;
}

/**
 * Create an artifacts writer
 * @param options - Configuration for the artifacts writer
 * @returns A new ArtifactsWriter instance
 */
export function createArtifactsWriter(options: ArtifactsWriterOptions): ArtifactsWriter {
  return new ArtifactsWriter(options);
}
