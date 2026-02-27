import type { Logger } from 'pino';
import { GossipBus, createDefaultGossipConfig } from '../gossip/bus.js';
import { QueryApi } from '../query/queryApi.js';
import { ReplayRecorder, loadReplayBundle, selectReplayAction } from '../replay/bundle.js';
import { createDefaultActionRegistry } from './actionRegistry.js';
import type { BaseAgent } from './agent.js';
import { ArtifactsWriter, generateRunId } from './artifacts.js';
import {
  type CheckpointWriter,
  type ProbeSampler,
  createCheckpointWriter,
  createProbeSampler,
} from './checkpoints.js';
import type { LiveServer } from './liveServer.js';
import { createLiveServer } from './liveServer.js';
import { LogEvents, createLogger } from './logging.js';
import { MetricsCollector } from './metrics.js';
import { Rng } from './rng.js';
import { Scheduler } from './scheduler.js';
import { createSmokeDivergenceResult } from './smoke.js';
import type {
  Action,
  ActionResult,
  Assertion,
  CapabilityManifest,
  FailedAssertion,
  GossipConfig,
  QueryConfig,
  RecordedAction,
  RunMode,
  RunOptions,
  RunResult,
  Scenario,
  SmokeDivergenceResult,
  TickContext,
  WorldState,
} from './types.js';

/**
 * Default run options
 */
const DEFAULT_OPTIONS: Required<
  Omit<
    RunOptions,
    | 'seed'
    | 'ticks'
    | 'tickSeconds'
    | 'replayBundlePath'
    | 'runIdSuffix'
    | 'live'
    | 'liveHost'
    | 'livePort'
    | 'memoryCapture'
  >
> = {
  outDir: 'sim/results',
  ci: false,
  verbose: false,
  mode: 'deterministic',
};

type ResolvedRunOptions = {
  seed: number;
  ticks: number;
  tickSeconds: number;
  outDir: string;
  ci: boolean;
  verbose: boolean;
  mode: RunMode;
  replayBundlePath?: string;
  runIdSuffix?: string;
  live: boolean;
  liveHost: string;
  livePort: number;
  memoryCapture: {
    enabled: boolean;
    sampleEveryTicks: number;
    maxBytesPerRecord: number | null;
  };
};

/**
 * The simulation engine orchestrates agent-based simulations
 *
 * It handles:
 * - Tick loop execution
 * - Agent scheduling and execution
 * - Metrics collection
 * - Artifact generation
 * - Assertion validation
 */
export class SimulationEngine {
  private readonly logger: Logger;
  private readonly scheduler: Scheduler;
  private readonly worldHistory = new Map<number, WorldState>();
  private worldOverlay: Record<string, unknown> = {};

  constructor(options: { logger?: Logger } = {}) {
    this.logger = options.logger ?? createLogger({ level: 'info' });
    this.scheduler = new Scheduler({ strategy: 'random' });
  }

  /**
   * Run a simulation scenario
   * @param scenario - The scenario to execute
   * @param options - Optional run configuration overrides
   * @returns The simulation result with metrics, stats, and assertion outcomes
   */
  async run(scenario: Scenario, options: RunOptions = {}): Promise<RunResult> {
    const startTime = Date.now();
    const resolvedOptions = this.resolveOptions(scenario, options);

    // Generate run ID
    const runId = generateRunId(scenario.name, resolvedOptions.ci, resolvedOptions.runIdSuffix);

    this.logger.info(
      {
        event: LogEvents.SIMULATION_START,
        scenario: scenario.name,
        runId,
        seed: resolvedOptions.seed,
        ticks: resolvedOptions.ticks,
      },
      `Starting simulation: ${scenario.name}`
    );

    // Initialize components
    this.worldHistory.clear();
    this.worldOverlay = {};
    const rng = new Rng(resolvedOptions.seed);
    const replayRecorder = new ReplayRecorder();
    const actionRegistry = createDefaultActionRegistry();
    const metricsConfig: import('./metrics.js').MetricsCollectorOptions = {
      sampleEveryTicks: scenario.metrics?.sampleEveryTicks ?? 1,
      logger: this.logger,
    };
    if (scenario.metrics?.track) {
      metricsConfig.track = scenario.metrics.track;
    }
    const metricsCollector = new MetricsCollector(metricsConfig);

    let liveServer: LiveServer | null = null;
    if (resolvedOptions.live) {
      liveServer = createLiveServer({
        host: resolvedOptions.liveHost,
        port: resolvedOptions.livePort,
        logger: this.logger as any,
      });
      this.logger.info({ url: liveServer.url }, 'Live websocket stream enabled');
      // Yield once so the WS server can begin accepting connections before we enter a potentially
      // CPU-heavy tick loop. This does not affect simulation determinism (no state changes).
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const artifactsWriter = new ArtifactsWriter({
      outDir: resolvedOptions.outDir,
      runId,
      logger: this.logger,
      onActionRecorded: (action) => {
        if (!liveServer) return;
        liveServer.broadcast({ type: 'action', payload: jsonSafe(action) });
      },
      onGossipRecorded: (event) => {
        if (!liveServer) return;
        liveServer.broadcast({ type: event.kind, payload: jsonSafe(event) });
      },
    });

    await artifactsWriter.initialize();
    liveServer?.broadcast({
      type: 'simulation_start',
      payload: {
        scenarioName: scenario.name,
        runId,
        seed: resolvedOptions.seed,
        ticks: resolvedOptions.ticks,
        mode: resolvedOptions.mode,
        packName: scenario.pack.name,
      },
    });

    // Initialize checkpoint writer if configured
    let checkpointWriter: CheckpointWriter | null = null;
    if (scenario.checkpoints) {
      checkpointWriter = createCheckpointWriter({
        outDir: artifactsWriter.getRunDir(),
        config: scenario.checkpoints,
        logger: this.logger,
      });
      await checkpointWriter.initialize();
    }

    // Initialize probe sampler if configured
    let probeSampler: ProbeSampler | null = null;
    if (scenario.probes && scenario.probes.length > 0) {
      probeSampler = createProbeSampler(scenario.probes, this.logger);
    }
    const probeEveryTicks = scenario.probeEveryTicks ?? scenario.metrics?.sampleEveryTicks ?? 1;

    // Initialize pack
    await scenario.pack.initialize();

    // Create agents
    const agents = this.createAgents(scenario, rng);
    const lastResults = new Map<string, ActionResult | null>();
    for (const agent of agents) {
      lastResults.set(agent.id, null);
    }
    const gossipConfig = this.resolveGossipConfig(
      scenario.gossip,
      agents.map((a) => a.id)
    );
    const gossipBus = new GossipBus(gossipConfig);
    let replayBundle: Awaited<ReturnType<typeof loadReplayBundle>> | null = null;
    if (resolvedOptions.mode === 'replay') {
      if (!resolvedOptions.replayBundlePath) {
        throw new Error('replayBundlePath is required when mode=replay');
      }
      replayBundle = await loadReplayBundle(resolvedOptions.replayBundlePath);
    }
    const smokeResults: SmokeDivergenceResult[] = [];

    // Initialize agents
    // Use deterministic timestamp for reproducibility
    // Base timestamp (Nov 2023) + seed offset ensures different seeds get different but deterministic start times
    const initialTimestamp = 1700000000 + (resolvedOptions.seed % 1000000);
    for (const agent of agents) {
      const ctx = this.createTickContext(0, initialTimestamp, rng, scenario);
      await agent.initialize(ctx);
    }

    // Run tick loop
    let currentTimestamp = initialTimestamp;
    let lastProbeValues: Record<string, unknown> = {};

    for (let tick = 0; tick < resolvedOptions.ticks; tick++) {
      if (liveServer && tick % 25 === 0) {
        // Periodically yield so the UI can connect and receive events during long runs.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      liveServer?.broadcast({
        type: 'tick_start',
        payload: { tick, timestamp: currentTimestamp },
      });
      await this.executeTick(
        tick,
        currentTimestamp,
        agents,
        scenario,
        rng,
        metricsCollector,
        artifactsWriter,
        gossipBus,
        replayBundle,
        replayRecorder,
        resolvedOptions,
        actionRegistry,
        smokeResults,
        lastResults
      );

      // Sample probes at configured interval (and optionally emit into metrics.csv).
      if (probeSampler && tick % probeEveryTicks === 0) {
        lastProbeValues = await probeSampler.sample(scenario.pack);
        const mode = scenario.metrics?.probeEmitMode ?? 'none';
        if (mode !== 'none') {
          const allow =
            mode === 'all'
              ? null
              : new Set((scenario.metrics?.emitProbes ?? []).map((s) => String(s)));
          const extras: Record<string, number | bigint | string | undefined> = {};
          for (const [k, raw] of Object.entries(lastProbeValues)) {
            if (allow && !allow.has(k)) continue;
            const v = coerceProbeValueForMetrics(raw);
            if (v !== undefined) {
              extras[`probe.${k}`] = v;
            }
          }
          metricsCollector.mergeIntoSample(tick, extras);
        }
        this.logger.debug({ tick, probes: Object.keys(lastProbeValues) }, 'Sampled probes');
      }

      const latestMetrics = metricsCollector.getLatestSample();
      if (latestMetrics && latestMetrics.tick === tick) {
        liveServer?.broadcast({
          type: 'metric_sample',
          payload: jsonSafe({
            tick: latestMetrics.tick,
            timestamp: latestMetrics.timestamp,
            ...latestMetrics.metrics,
          }),
        });
      }
      liveServer?.broadcast({
        type: 'tick_end',
        payload: { tick, timestamp: currentTimestamp },
      });

      // Write checkpoint at configured interval
      if (checkpointWriter?.shouldCheckpoint(tick)) {
        await checkpointWriter.writeCheckpoint(
          tick,
          currentTimestamp,
          agents,
          scenario.pack,
          lastProbeValues
        );
      }

      currentTimestamp += resolvedOptions.tickSeconds;
    }

    // Final metrics sample
    metricsCollector.forceSample(resolvedOptions.ticks - 1, currentTimestamp, scenario.pack);

    // Cleanup agents
    for (const agent of agents) {
      await agent.cleanup();
    }

    // Validate assertions
    const finalMetrics = metricsCollector.getFinalMetrics();
    const failedAssertions = this.validateAssertions(scenario.assertions ?? [], finalMetrics);

    // Build result
    const replayOutputPath =
      resolvedOptions.mode === 'exploration' ? 'replay_bundle.json' : undefined;
    const resultBase: RunResult = {
      runId,
      scenarioName: scenario.name,
      seed: resolvedOptions.seed,
      ticks: resolvedOptions.ticks,
      durationMs: Date.now() - startTime,
      success: failedAssertions.length === 0,
      failedAssertions,
      finalMetrics,
      agentStats: agents.map((a) => a.getStats()),
      outputDir: artifactsWriter.getRunDir(),
    };
    const result: RunResult =
      replayOutputPath !== undefined
        ? { ...resultBase, replayBundlePath: replayOutputPath }
        : resultBase;

    if (resolvedOptions.mode === 'exploration') {
      artifactsWriter.setReplayBundle(
        replayRecorder.build(scenario.name, resolvedOptions.seed, resolvedOptions.mode)
      );
    }
    if (smokeResults.length > 0) {
      artifactsWriter.setSmokeResults(smokeResults);
    }

    // Write artifacts
    await artifactsWriter.writeAll(scenario, resolvedOptions, result, metricsCollector);

    // Cleanup
    await scenario.pack.cleanup();
    await artifactsWriter.cleanup();

    liveServer?.broadcast({
      type: 'simulation_end',
      payload: { runId, success: result.success, durationMs: result.durationMs },
    });
    await liveServer?.close();

    this.logger.info(
      {
        event: LogEvents.SIMULATION_END,
        runId,
        durationMs: result.durationMs,
        success: result.success,
      },
      `Simulation complete: ${result.success ? 'PASSED' : 'FAILED'}`
    );

    return result;
  }

  /**
   * Resolve options with defaults and scenario values
   */
  private resolveOptions(scenario: Scenario, options: RunOptions): ResolvedRunOptions {
    const memoryCapture = options.memoryCapture ?? {
      enabled: false,
      sampleEveryTicks: 1,
      maxBytesPerRecord: 262_144,
    };
    return {
      seed: options.seed ?? scenario.seed,
      ticks: options.ticks ?? scenario.ticks,
      tickSeconds: options.tickSeconds ?? scenario.tickSeconds,
      outDir: options.outDir ?? DEFAULT_OPTIONS.outDir,
      ci: options.ci ?? DEFAULT_OPTIONS.ci,
      verbose: options.verbose ?? DEFAULT_OPTIONS.verbose,
      mode: options.mode ?? DEFAULT_OPTIONS.mode,
      live: options.live ?? false,
      liveHost: options.liveHost ?? 'localhost',
      livePort: options.livePort ?? 8787,
      memoryCapture: {
        enabled: memoryCapture.enabled === true,
        sampleEveryTicks: Math.max(1, Math.floor(memoryCapture.sampleEveryTicks || 1)),
        maxBytesPerRecord:
          memoryCapture.maxBytesPerRecord === null
            ? null
            : Math.max(1024, Math.floor(memoryCapture.maxBytesPerRecord || 262_144)),
      },
      ...(options.replayBundlePath !== undefined
        ? { replayBundlePath: options.replayBundlePath }
        : {}),
      ...(options.runIdSuffix !== undefined ? { runIdSuffix: options.runIdSuffix } : {}),
    };
  }

  /**
   * Create agent instances from scenario configuration
   */
  private createAgents(scenario: Scenario, _rng: Rng): BaseAgent[] {
    const agents: BaseAgent[] = [];
    let agentIndex = 0;

    for (const config of scenario.agents) {
      for (let i = 0; i < config.count; i++) {
        const id = `${config.type.name}-${agentIndex++}`;
        const agent = new config.type(id, config.params);
        agents.push(agent);
      }
    }

    this.logger.debug({ agentCount: agents.length }, 'Created agents');

    return agents;
  }

  /**
   * Execute a single tick
   */
  private async executeTick(
    tick: number,
    timestamp: number,
    agents: BaseAgent[],
    scenario: Scenario,
    rng: Rng,
    metricsCollector: MetricsCollector,
    artifactsWriter: ArtifactsWriter,
    gossipBus: GossipBus,
    replayBundle: Awaited<ReturnType<typeof loadReplayBundle>> | null,
    replayRecorder: ReplayRecorder,
    resolvedOptions: ResolvedRunOptions,
    actionRegistry: ReturnType<typeof createDefaultActionRegistry>,
    smokeResults: SmokeDivergenceResult[],
    lastResults: Map<string, ActionResult | null>
  ): Promise<void> {
    this.logger.debug({ event: LogEvents.TICK_START, tick }, `Tick ${tick}`);

    // Phase A: scheduled events
    this.applyScheduledEvents(tick, timestamp, scenario, gossipBus, rng, artifactsWriter);

    // Phase B: gossip delivery
    const deliveryEvents = gossipBus.advanceTick(tick);
    for (const ev of deliveryEvents) {
      const msg = gossipBus.getMessageById(ev.messageId);
      artifactsWriter.recordGossipEvent({
        tick,
        timestamp,
        kind: 'gossip_deliver',
        messageId: ev.messageId,
        recipientAgentId: ev.recipientAgentId,
        ...(msg ? { message: msg } : {}),
      });
    }
    if (resolvedOptions.mode === 'exploration') {
      for (const event of deliveryEvents) {
        replayRecorder.recordMessage({
          tick: event.tick,
          message: {
            envelope: {
              id: event.messageId,
              tick: event.tick,
              authorAgentId: 'system',
              channelId: 'delivery',
              audience: { type: 'agents', agentIds: [event.recipientAgentId] },
              intentTag: 'inform',
              costPaid: 0,
              credibilityPrior: 1,
              payloadHash: event.messageId,
            },
            payload: { text: `delivered:${event.messageId}` },
          },
        });
      }
    }

    // Notify pack of tick advancement
    scenario.pack.onTick?.(tick, timestamp);

    // Get tick-specific RNG
    const tickRng = rng.derive(tick);

    // Determine agent order
    const orderedAgents = this.scheduler.getOrder(agents, tick, tickRng);

    // Execute each agent
    for (const agent of orderedAgents) {
      await this.executeAgent(
        agent,
        tick,
        timestamp,
        scenario,
        tickRng,
        artifactsWriter,
        gossipBus,
        replayBundle,
        replayRecorder,
        resolvedOptions,
        actionRegistry,
        lastResults
      );
    }

    // Record agent memory snapshots (optional; artifacts only).
    if (
      resolvedOptions.memoryCapture.enabled &&
      tick % resolvedOptions.memoryCapture.sampleEveryTicks === 0
    ) {
      for (const agent of agents) {
        artifactsWriter.recordAgentMemorySnapshot(
          jsonSafe({
            tick,
            timestamp,
            agentId: agent.id,
            agentType: agent.type,
            memory: agent.exportMemory(),
          }) as Record<string, unknown>,
          resolvedOptions.memoryCapture.maxBytesPerRecord
        );
      }
    }

    // Sample metrics
    metricsCollector.sample(tick, timestamp, scenario.pack);

    // Phase E: smoke testing hooks
    this.runSmokeHooks(tick, scenario, smokeResults);

    this.logger.debug({ event: LogEvents.TICK_END, tick }, `Tick ${tick} complete`);
  }

  /**
   * Execute a single agent's step
   */
  private async executeAgent(
    agent: BaseAgent,
    tick: number,
    timestamp: number,
    scenario: Scenario,
    tickRng: Rng,
    artifactsWriter: ArtifactsWriter,
    gossipBus: GossipBus,
    replayBundle: Awaited<ReturnType<typeof loadReplayBundle>> | null,
    replayRecorder: ReplayRecorder,
    resolvedOptions: ResolvedRunOptions,
    actionRegistry: ReturnType<typeof createDefaultActionRegistry>,
    lastResults: Map<string, ActionResult | null>
  ): Promise<void> {
    const agentRng = tickRng.derive(tick, agent.id);

    // Set current agent context in pack
    scenario.pack.setCurrentAgent?.(agent.id);

    const ctx = this.createTickContext(
      tick,
      timestamp,
      agentRng,
      scenario,
      agent.id,
      gossipBus,
      resolvedOptions,
      replayRecorder,
      artifactsWriter,
      lastResults.get(agent.id) ?? null
    );
    const stepStart = Date.now();

    let action: Action | null = null;
    let result: ActionResult | null = null;

    try {
      // Get agent action from replay or live policy
      if (resolvedOptions.mode === 'replay' && replayBundle) {
        action = selectReplayAction(replayBundle, tick, agent.id)?.action ?? null;
      } else {
        action = await agent.step(ctx);
      }

      if (action) {
        const validation = actionRegistry.validate(action, {
          mode: resolvedOptions.mode,
          world: ctx.world,
        });
        if (!validation.ok) {
          result = { ok: false, error: validation.error ?? 'action_validation_failed' };
          agent.recordFailure();
          if (resolvedOptions.mode === 'exploration') {
            replayRecorder.recordAction({ tick, agentId: agent.id, action: null });
          }
          return;
        }

        // Execute action through engine/pack (tool-like actions are engine-handled)
        if (action.name === 'QueryWorld') {
          if (!ctx.query) {
            result = { ok: false, error: 'query_context_not_available' };
          } else {
            const endpoint = action.params.endpoint;
            const params = action.params.params;
            const queryParams =
              params !== undefined &&
              params !== null &&
              typeof params === 'object' &&
              !Array.isArray(params)
                ? (params as Record<string, unknown>)
                : undefined;
            const queryResult = ctx.query.query({
              endpoint: String(endpoint),
              ...(queryParams !== undefined ? { params: queryParams } : {}),
            });
            result =
              queryResult.error !== undefined
                ? {
                    ok: false,
                    error: queryResult.error,
                    events: [
                      {
                        name: 'QueryResult',
                        args: { endpoint: String(endpoint), ok: false, error: queryResult.error },
                      },
                    ],
                  }
                : {
                    ok: queryResult.ok,
                    events: [
                      {
                        name: 'QueryResult',
                        args: {
                          endpoint: String(endpoint),
                          ok: true,
                          response: queryResult.data,
                        },
                      },
                    ],
                  };
          }
        } else if (action.name === 'RpcCall') {
          result = await this.executeRpcToolAction(
            tick,
            agent.id,
            action,
            scenario,
            resolvedOptions,
            replayRecorder
          );
        } else if (action.name === 'PostMessage') {
          if (!ctx.gossip) {
            result = { ok: false, error: 'gossip_context_not_available' };
          } else {
            const channelId = String(action.params.channelId ?? '').trim();
            const text = String(action.params.text ?? '').trim();
            if (!channelId || !text) {
              result = { ok: false, error: 'post_message_requires_channel_and_text' };
            } else {
              const rawIntentTag = String(action.params.intentTag ?? '')
                .trim()
                .toLowerCase();
              const normalizedIntentTag = rawIntentTag
                ? this.coerceIntentTag(rawIntentTag)
                : undefined;
              const postOptions = {
                ...(normalizedIntentTag
                  ? {
                      intentTag: normalizedIntentTag as
                        | 'inform'
                        | 'persuade'
                        | 'coordinate'
                        | 'deceive'
                        | 'probe'
                        | 'other',
                    }
                  : {}),
                ...(typeof action.params.credibilityPrior === 'number'
                  ? { credibilityPrior: action.params.credibilityPrior }
                  : {}),
              };
              const posted = ctx.gossip.postMessage(
                agent.id,
                channelId,
                { text },
                {
                  ...postOptions,
                }
              );
              result = posted.ok
                ? {
                    ok: true,
                    events: [
                      {
                        name: 'GossipPostResult',
                        args: { ok: true, channelId, messageId: posted.messageId ?? null },
                      },
                    ],
                  }
                : {
                    ok: false,
                    error: posted.error ?? 'post_message_failed',
                    events: [
                      {
                        name: 'GossipPostResult',
                        args: {
                          ok: false,
                          channelId,
                          error: posted.error ?? 'post_message_failed',
                        },
                      },
                    ],
                  };
            }
          }
        } else {
          result = await scenario.pack.executeAction(action, agent.id);
        }

        if (result.ok) {
          agent.recordSuccess();
          this.logger.trace(
            {
              event: LogEvents.AGENT_ACTION,
              agentId: agent.id,
              action: action.name,
              success: true,
            },
            `${agent.id} executed ${action.name}`
          );
        } else {
          agent.recordFailure();
          this.logger.trace(
            {
              event: LogEvents.AGENT_ACTION,
              agentId: agent.id,
              action: action.name,
              success: false,
              error: result.error,
            },
            `${agent.id} failed ${action.name}: ${result.error}`
          );
        }
      } else {
        agent.recordSkip();
      }
    } catch (error) {
      agent.recordFailure();
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        {
          event: LogEvents.AGENT_ERROR,
          agentId: agent.id,
          error: errorMessage,
        },
        `Agent ${agent.id} error: ${errorMessage}`
      );
      result = { ok: false, error: errorMessage };
    }

    lastResults.set(agent.id, result);

    // Record action
    const recorded: RecordedAction = {
      tick,
      timestamp,
      agentId: agent.id,
      agentType: agent.type,
      action,
      result,
      durationMs: Date.now() - stepStart,
    };
    artifactsWriter.recordAction(recorded);

    if (resolvedOptions.mode === 'exploration') {
      replayRecorder.recordAction({
        tick,
        agentId: agent.id,
        action,
      });
    }
  }

  private async executeRpcToolAction(
    tick: number,
    agentId: string,
    action: Action,
    scenario: Scenario,
    resolvedOptions: ResolvedRunOptions,
    replayRecorder: ReplayRecorder
  ): Promise<ActionResult> {
    if (resolvedOptions.mode === 'deterministic') {
      return { ok: false, error: 'rpc_call_requires_exploration_or_replay' };
    }
    if (!scenario.pack.callRpc) {
      return { ok: false, error: 'pack_does_not_support_rpc' };
    }

    const method = String(action.params.method ?? '').trim();
    const params = Array.isArray(action.params.params) ? action.params.params : [];
    if (resolvedOptions.mode === 'exploration') {
      if (this.isAutonomousRpcDisabled(scenario)) {
        return { ok: false, error: 'autonomous_rpc_disabled' };
      }
      const allowlist = scenario.exploration?.allowlist;
      const rpcPolicy = this.getAutonomousRpcPolicy(scenario);
      if (rpcPolicy === 'strict') {
        if (!scenario.exploration?.allowArbitraryExecution || !allowlist) {
          return { ok: false, error: 'rpc_call_not_enabled_by_scenario' };
        }
        if (!allowlist.allowedRpcMethods.includes(method)) {
          return { ok: false, error: `rpc_method_not_allowlisted:${method}` };
        }
      } else if (allowlist && allowlist.allowedRpcMethods.length > 0) {
        // In aggressive mode, explicit allowlists still narrow scope when provided.
        if (!allowlist.allowedRpcMethods.includes(method)) {
          return { ok: false, error: `rpc_method_not_allowlisted:${method}` };
        }
      }
    }

    try {
      const response = await scenario.pack.callRpc(method, params);
      if (resolvedOptions.mode === 'exploration') {
        replayRecorder.recordArbitraryExecution({
          tick,
          agentId,
          kind: 'rpc',
          intent: { method, params },
          result: { ok: true, response },
        });
      }
      return { ok: true, events: [{ name: 'RpcResult', args: { method, ok: true, response } }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (resolvedOptions.mode === 'exploration') {
        replayRecorder.recordArbitraryExecution({
          tick,
          agentId,
          kind: 'rpc',
          intent: { method, params },
          result: { ok: false, error: message },
        });
      }
      return {
        ok: false,
        error: message,
        events: [{ name: 'RpcResult', args: { method, ok: false, error: message } }],
      };
    }
  }

  private getAutonomousRpcPolicy(scenario: Scenario): 'strict' | 'aggressive' {
    const envPolicy = process.env.AGENTFORGE_AUTONOMOUS_RPC_POLICY;
    if (envPolicy === 'strict' || envPolicy === 'aggressive') {
      return envPolicy;
    }
    return scenario.exploration?.autonomousRpcPolicy ?? 'strict';
  }

  private isAutonomousRpcDisabled(scenario: Scenario): boolean {
    if (process.env.AGENTFORGE_DISABLE_AUTONOMOUS_RPC === '1') {
      return true;
    }
    return scenario.exploration?.disableAutonomousRpc === true;
  }

  /**
   * Create a tick context for an agent
   */
  private createTickContext(
    tick: number,
    timestamp: number,
    rng: Rng,
    scenario: Scenario,
    agentId?: string,
    gossipBus?: GossipBus,
    resolvedOptions?: ResolvedRunOptions,
    replayRecorder?: ReplayRecorder,
    artifactsWriter?: ArtifactsWriter,
    lastResult: ActionResult | null = null
  ): TickContext {
    const queryConfig = this.resolveQueryConfig(scenario.query);
    const queryApi = new QueryApi(queryConfig.endpoints ?? [], queryConfig.defaultBudget);
    const world = this.getObservedWorldForTick(tick, scenario, queryConfig, rng);
    const capabilities = this.buildCapabilityManifest(
      scenario,
      queryConfig,
      tick,
      resolvedOptions?.mode
    );

    const base: TickContext = {
      tick,
      timestamp,
      rng,
      logger: this.logger,
      pack: scenario.pack,
      world,
      lastResult,
      query: {
        query: (request) => {
          const result = queryApi.run(request, world);
          if (resolvedOptions?.mode === 'exploration' && replayRecorder && agentId) {
            replayRecorder.recordQuery({
              tick,
              agentId,
              request,
              result,
            });
          }
          return result;
        },
        budget: queryApi.budgetState(),
      },
      capabilities,
    };

    const withMode = resolvedOptions?.mode ? { ...base, mode: resolvedOptions.mode } : base;
    if (!gossipBus) {
      return withMode;
    }

    return {
      ...withMode,
      gossip: {
        readInbox: (targetAgentId: string) => gossipBus.readInbox(targetAgentId),
        postMessage: (targetAgentId, channelId, payload, options) => {
          const posted = gossipBus.postMessage(targetAgentId, channelId, payload, rng, options);
          if (posted.ok && posted.message && artifactsWriter) {
            artifactsWriter.recordGossipEvent({
              tick,
              timestamp,
              kind: 'gossip_post',
              messageId: posted.message.envelope.id,
              message: posted.message,
            });
          }
          if (
            posted.ok &&
            posted.message &&
            resolvedOptions?.mode === 'exploration' &&
            replayRecorder
          ) {
            replayRecorder.recordMessage({
              tick,
              message: posted.message,
            });
          }
          if (posted.ok) {
            const messageId = posted.message?.envelope.id;
            return messageId ? { ok: true, messageId } : { ok: true };
          }
          return { ok: false, error: posted.error ?? 'post_message_failed' };
        },
      },
    };
  }

  private resolveGossipConfig(config: GossipConfig | undefined, agentIds: string[]): GossipConfig {
    if (config) {
      return {
        ...config,
        channels: (config.channels ?? []).map((channel) => ({
          ...channel,
          members: channel.members ?? agentIds,
        })),
      };
    }
    const defaults = createDefaultGossipConfig();
    defaults.channels = defaults.channels.map((channel) => ({
      ...channel,
      members: channel.members ?? agentIds,
    }));
    return defaults;
  }

  private resolveQueryConfig(config: QueryConfig | undefined): QueryConfig {
    return (
      config ?? {
        defaultBudget: {
          maxQueriesPerTick: 10,
          maxCostPerTick: 100,
          maxBytesPerTick: 16_000,
        },
        endpoints: [
          {
            name: 'get_world',
            cost: 1,
            handler: (_params, world) => world,
          },
        ],
        indexingDelayTicks: 0,
        redactWorldKeys: [],
        noisyWorldKeys: [],
        noiseSigma: 0,
      }
    );
  }

  private buildCapabilityManifest(
    scenario: Scenario,
    queryConfig: QueryConfig,
    tick: number,
    mode: RunMode | undefined
  ): CapabilityManifest {
    const fromPack = scenario.pack.getCapabilityManifest?.();
    if (fromPack) {
      return {
        ...fromPack,
        generatedAtTick: tick,
        mode: mode ?? 'deterministic',
      };
    }

    const deployedContracts = scenario.pack.getDeployedContracts?.() ?? [];
    return {
      version: 'v1',
      generatedAtTick: tick,
      mode: mode ?? 'deterministic',
      tools: [
        'QueryWorld',
        'RpcCall',
        'PostMessage',
        'ContractCall',
        'ContractRead',
        'arbitrary_tx',
      ],
      queryEndpoints: (queryConfig.endpoints ?? []).map((ep) => ({
        name: ep.name,
        cost: ep.cost,
        ...(ep.maxResponseBytes !== undefined ? { maxResponseBytes: ep.maxResponseBytes } : {}),
      })),
      contracts: deployedContracts.map((alias) => ({
        alias,
      })),
      actionTemplates: [
        {
          name: 'QueryWorld',
          description: 'Read scenario-indexed world state endpoint',
          exampleParams: { endpoint: 'get_world', params: {} },
        },
        {
          name: 'RpcCall',
          description: 'Issue a JSON-RPC call to chain node',
          exampleParams: { method: 'eth_blockNumber', params: [] },
        },
        {
          name: 'PostMessage',
          description: 'Publish a gossip message to channel',
          exampleParams: { channelId: 'global', text: 'state update', intentTag: 'inform' },
        },
      ],
    };
  }

  private getObservedWorldForTick(
    tick: number,
    scenario: Scenario,
    queryConfig: QueryConfig,
    rng: Rng
  ): WorldState {
    const liveWorld = scenario.pack.getWorldState();
    this.worldHistory.set(tick, liveWorld);
    const delay = Math.max(0, queryConfig.indexingDelayTicks ?? 0);
    const observedTick = Math.max(0, tick - delay);
    const base = this.worldHistory.get(observedTick) ?? liveWorld;
    const withOverlay =
      Object.keys(this.worldOverlay).length > 0 ? { ...base, ...this.worldOverlay } : base;
    return this.applyObservabilityControls(withOverlay, queryConfig, rng);
  }

  private applyObservabilityControls(
    world: WorldState,
    queryConfig: QueryConfig,
    rng: Rng
  ): WorldState {
    const cloned: WorldState = { ...world };
    for (const key of queryConfig.redactWorldKeys ?? []) {
      if (key in cloned) {
        cloned[key] = '[REDACTED]';
      }
    }
    const noiseSigma = queryConfig.noiseSigma ?? 0;
    if (noiseSigma > 0) {
      for (const key of queryConfig.noisyWorldKeys ?? []) {
        const value = cloned[key];
        if (typeof value === 'number') {
          const noise = (rng.nextFloat() * 2 - 1) * noiseSigma;
          cloned[key] = value + noise;
        }
      }
    }
    return cloned;
  }

  private applyScheduledEvents(
    tick: number,
    timestamp: number,
    scenario: Scenario,
    gossipBus: GossipBus,
    rng: Rng,
    artifactsWriter: ArtifactsWriter
  ): void {
    if (!scenario.schedule || scenario.schedule.length === 0) {
      return;
    }
    let idx = 0;
    for (const event of scenario.schedule) {
      if (event.tick !== tick) {
        continue;
      }
      // Record as a system action for timelines/debuggability.
      artifactsWriter.recordAction({
        tick,
        timestamp,
        agentId: 'system',
        agentType: 'system',
        action: {
          id: `scheduled-${tick}-${idx++}`,
          name: 'ScheduledEvent',
          params: { type: event.type, payload: event.payload },
        },
        result: { ok: true },
        durationMs: 0,
      });

      if (event.type === 'info_event') {
        const channelId = String(event.payload.channelId ?? 'global');
        const text = String(event.payload.text ?? '');
        const posted = gossipBus.postSystemMessage(channelId, { text }, rng, {
          intentTag: 'inform',
          credibilityPrior: 1,
        });
        if (posted.ok && posted.message) {
          artifactsWriter.recordGossipEvent({
            tick,
            timestamp,
            kind: 'gossip_post',
            messageId: posted.message.envelope.id,
            message: posted.message,
          });
        }
        continue;
      }

      if (event.type === 'gossip_inject') {
        const channelId = String(event.payload.channelId ?? 'global');
        const text = String(event.payload.text ?? '');
        const intentTag = this.coerceIntentTag(String(event.payload.intentTag ?? 'inform'));
        const credibilityPrior = Number(event.payload.credibilityPrior ?? 1);
        const posted = gossipBus.postSystemMessage(channelId, { text }, rng, {
          intentTag,
          credibilityPrior,
        });
        if (posted.ok && posted.message) {
          artifactsWriter.recordGossipEvent({
            tick,
            timestamp,
            kind: 'gossip_post',
            messageId: posted.message.envelope.id,
            message: posted.message,
          });
        }
        continue;
      }

      if (event.type === 'world_overlay') {
        const overrides = (event.payload.overrides ?? {}) as Record<string, unknown>;
        this.worldOverlay = { ...this.worldOverlay, ...overrides };
        continue;
      }

      if (event.type === 'world_overlay_clear') {
        const keys = Array.isArray(event.payload.keys) ? (event.payload.keys as string[]) : null;
        if (!keys) {
          this.worldOverlay = {};
        } else {
          const next = { ...this.worldOverlay };
          for (const k of keys) {
            delete next[k];
          }
          this.worldOverlay = next;
        }
      }
    }
  }

  private coerceIntentTag(
    input: string
  ): 'inform' | 'persuade' | 'coordinate' | 'deceive' | 'probe' | 'other' {
    if (input === 'creator' || input === 'economic' || input === 'observer') {
      return 'inform';
    }
    if (input === 'bad_actor' || input === 'saboteur') {
      return 'deceive';
    }
    if (input === 'hacker') {
      return 'probe';
    }
    if (
      input === 'inform' ||
      input === 'persuade' ||
      input === 'coordinate' ||
      input === 'deceive' ||
      input === 'probe' ||
      input === 'other'
    ) {
      return input;
    }
    return 'other';
  }

  private runSmokeHooks(
    tick: number,
    scenario: Scenario,
    smokeResults: SmokeDivergenceResult[]
  ): void {
    if (!scenario.smoke || scenario.smoke.checkpoints.length === 0) {
      return;
    }
    const checkpoint = scenario.smoke.checkpoints.find((item) => item.tick === tick);
    if (!checkpoint) {
      return;
    }
    const baseline = scenario.pack.getMetrics();
    for (const perturbation of checkpoint.perturbations) {
      const perturbed = { ...baseline };
      if (
        typeof perturbed[perturbation.key] === 'number' &&
        typeof perturbation.value === 'number'
      ) {
        perturbed[perturbation.key] = (perturbed[perturbation.key] as number) + perturbation.value;
      }
      smokeResults.push(createSmokeDivergenceResult(tick, perturbation, baseline, perturbed));
    }
  }

  /**
   * Validate assertions against final metrics
   */
  private validateAssertions(
    assertions: Assertion[],
    metrics: Record<string, number | bigint | string>
  ): FailedAssertion[] {
    const failures: FailedAssertion[] = [];

    for (const assertion of assertions) {
      const actualValue = metrics[assertion.metric];
      if (actualValue === undefined) {
        failures.push({
          assertion,
          actualValue: 'undefined',
          message: `Metric "${assertion.metric}" not found`,
        });
        continue;
      }

      const actual =
        typeof actualValue === 'bigint'
          ? Number(actualValue)
          : typeof actualValue === 'string'
            ? Number.parseFloat(actualValue)
            : actualValue;

      const expected =
        typeof assertion.value === 'string' ? Number.parseFloat(assertion.value) : assertion.value;

      let passed = false;
      switch (assertion.type) {
        case 'eq':
          passed = actual === expected;
          break;
        case 'gt':
          passed = actual > expected;
          break;
        case 'gte':
          passed = actual >= expected;
          break;
        case 'lt':
          passed = actual < expected;
          break;
        case 'lte':
          passed = actual <= expected;
          break;
      }

      if (!passed) {
        failures.push({
          assertion,
          actualValue: actual,
          message: `Expected ${assertion.metric} ${assertion.type} ${expected}, got ${actual}`,
        });
      }
    }

    return failures;
  }
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  ) as T;
}

function coerceProbeValueForMetrics(raw: unknown): number | bigint | string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

/**
 * Convenience function to run a scenario
 * @param scenario - The scenario to execute
 * @param options - Optional run configuration overrides
 * @returns The simulation result with metrics, stats, and assertion outcomes
 */
export async function runScenario(scenario: Scenario, options?: RunOptions): Promise<RunResult> {
  const engine = new SimulationEngine();
  return engine.run(scenario, options);
}
