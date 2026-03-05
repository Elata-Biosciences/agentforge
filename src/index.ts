/**
 * AgentForge - Type-safe agent-based simulation framework for Foundry/EVM protocols
 *
 * @packageDocumentation
 */

// Core exports
export { Rng } from './core/rng.js';
export { BaseAgent, NoOpAgent } from './core/agent.js';
export type { AgentMemory, ExtendedAgentStats } from './core/agent.js';
export { defineScenario, loadScenario } from './core/scenario.js';
export { Scheduler, createScheduler } from './core/scheduler.js';

// Engine exports
export { SimulationEngine, runScenario } from './core/engine.js';
export { ArtifactsWriter } from './core/artifacts.js';
export { MetricsCollector, createMetricsCollector } from './core/metrics.js';
export { createLogger, createChildLogger, LogEvents } from './core/logging.js';
export {
  InMemoryActionValidatorRegistry,
  createDefaultActionRegistry,
} from './core/actionRegistry.js';
export {
  applyAssumptionPatches,
  computeDivergenceScore,
  createSmokeDivergenceResult,
} from './core/smoke.js';
export {
  LlmActionIntentSchema,
  LlmPlanIntentSchema,
  ReplayBundleSchema,
} from './core/llmSchemas.js';
export { GossipBus, createDefaultGossipConfig } from './gossip/bus.js';
export { QueryApi } from './query/queryApi.js';
export { QueryBudgetManager } from './query/budgetManager.js';
export { ReplayRecorder, loadReplayBundle, saveReplayBundle } from './replay/bundle.js';
export { DivergenceTracker } from './replay/divergence.js';
export { ArbitraryExecutor } from './exploration/arbitraryExecutor.js';
export { LlmPolicyAgent } from './agents/llm/llmPolicyAgent.js';
export {
  PersonaLlmAgentBase,
  type PersonaLlmAgentParams,
  type PersonaProfile,
} from './agents/llm/personaLlmAgentBase.js';
export { ActionSequenceAgent } from './agents/deterministic/actionSequenceAgent.js';
export { OpenAiChatClient } from './agents/llm/openaiClient.js';
export {
  AnthropicProviderClient,
  OpenAiCompatibleProviderClient,
  OpenAiProviderClient,
  createLlmProviderClient,
} from './agents/llm/providers/index.js';
export type { LlmClient, LlmCompletionInput, LlmProviderConfig } from './agents/llm/types.js';

// Error exports
export {
  AgentForgeError,
  RevertError,
  RpcError,
  TimeoutError,
  NonceError,
  ConfigurationError,
  PreconditionError,
  AssertionError,
  AgentError,
  AnvilError,
  isAgentForgeError,
  isRevertError,
  isRpcError,
  isTimeoutError,
  classifyError,
  wrapError,
} from './core/errors.js';

// Schema/validation exports
export {
  AssertionSchema,
  MetricsConfigSchema,
  AgentConfigSchema,
  RunOptionsSchema,
  ScenarioConfigSchema,
  CliRunArgsSchema,
  CliInitArgsSchema,
  ActionSchema,
  ActionResultSchema,
  validateScenarioConfig,
  validateRunOptions,
  safeValidateScenarioConfig,
  safeValidateRunOptions,
  formatZodError,
  validateCliRunArgs,
} from './core/schemas.js';

// Precondition exports
export {
  hasBalance,
  hasAllowance,
  withinTimeWindow,
  notOnCooldown,
  inRange,
  greaterThan,
  lessThan,
  all,
  any,
  assertPrecondition,
  checkPreconditions,
  PreconditionBuilder,
  preconditions,
} from './core/preconditions.js';
export type { PreconditionResult } from './core/preconditions.js';

// Type exports
export type {
  Action,
  ActionResult,
  ActionEvent,
  TickContext,
  WorldState,
  Pack,
  Scenario,
  AgentConfig,
  MetricsConfig,
  Assertion,
  RunOptions,
  RunResult,
  FailedAssertion,
  AgentStats,
  RecordedAction,
  MetricsSample,
  Address,
  FundingConfig,
  RunMode,
  QueryBudget,
  QueryRequest,
  QueryResult,
  QueryEndpoint,
  QueryConfig,
  QueryContext,
  QueryBudgetState,
  CapabilityManifest,
  CapabilityContract,
  CapabilityActionTemplate,
  GossipChannelType,
  GossipChannel,
  AudienceSpec,
  MessageEnvelope,
  MessagePayload,
  GossipMessage,
  DeliveryEvent,
  GossipBudgets,
  GossipContext,
  GossipConfig,
  ScheduledEvent,
  ReplayActionRecord,
  ReplayMessageRecord,
  ReplayQueryRecord,
  ReplayArbitraryExecutionRecord,
  ReplayBundle,
  ReplayConfig,
  AssumptionPatch,
  SmokeCheckpointConfig,
  SmokeDivergenceResult,
  SmokeTestConfig,
  ActionValidationContext,
  ActionValidator,
  ActionValidatorRegistry,
  ArbitraryTxIntent,
  RpcCallIntent,
  ExplorationAllowlistPolicy,
  ExplorationConfig,
} from './core/types.js';

export type {
  DefineScenarioOptions,
  AgentDefinition,
} from './core/scenario.js';

export type {
  SchedulingStrategy,
  SchedulerOptions,
} from './core/scheduler.js';

export type {
  AssertionInput,
  MetricsConfigInput,
  AgentConfigInput,
  RunOptionsInput,
  ScenarioConfigInput,
  CliRunArgs,
  CliInitArgs,
  ActionInput,
  ActionResultInput,
} from './core/schemas.js';

// Utility exports
export {
  type Statistics,
  type ConfidenceInterval,
  type AggregatedMetrics,
  calculateStatistics,
  mean,
  standardDeviation,
  median,
  percentile,
  calculateConfidenceInterval,
  aggregateMetrics,
  successRate,
  ratePerTime,
  ratePerTick,
  simpleMovingAverage,
  exponentialMovingAverage,
} from './utils/statistics.js';

// Testing helper exports
export {
  assertGte,
  assertLte,
  assertEqual,
  assertNotEqual,
  assertAgentSuccess,
  assertEconomics,
  formatNumber,
  formatDuration,
  formatPercent,
  summarizeResult,
} from './testing/helpers.js';
