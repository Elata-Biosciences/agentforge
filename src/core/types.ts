import type { Logger } from 'pino';
import type { Rng } from './rng.js';

/**
 * Represents an action that an agent wants to take
 */
export interface Action {
  /** Unique identifier for this action instance */
  id: string;
  /** Action type name (e.g., 'buy', 'sell', 'stake') */
  name: string;
  /** Action-specific parameters */
  params: Record<string, unknown>;
  /** Optional metadata about the action */
  metadata?: Record<string, unknown>;
}

/**
 * Result of executing an action
 */
export interface ActionResult {
  /** Whether the action succeeded */
  ok: boolean;
  /** Error message if action failed */
  error?: string;
  /** Events emitted during action execution */
  events?: ActionEvent[];
  /** Balance changes resulting from the action */
  balanceDeltas?: Record<string, bigint>;
  /** Gas used (for on-chain actions) */
  gasUsed?: bigint;
  /** Transaction hash (for on-chain actions) */
  txHash?: string;
}

/**
 * An event emitted during action execution
 * Used to track contract events, state changes, or other side effects
 */
export interface ActionEvent {
  /** Event name (e.g., 'Transfer', 'Approval') */
  name: string;
  /** Event arguments/parameters */
  args: Record<string, unknown>;
}

/**
 * Context provided to agents during each tick
 */
export interface TickContext {
  /** Current tick number (0-indexed) */
  tick: number;
  /** Simulated timestamp for this tick */
  timestamp: number;
  /** Seeded RNG bound to this tick */
  rng: Rng;
  /** Structured logger */
  logger: Logger;
  /** The pack providing world state and action execution */
  pack: Pack;
  /** Read-only world state snapshot */
  world: WorldState;
  /** Optional query context for budgeted world access */
  query?: QueryContext;
  /** Optional gossip context for reading/posting messages */
  gossip?: GossipContext;
  /** Current run mode */
  mode?: RunMode;
  /** Last action result for this agent (previous tick) */
  lastResult?: ActionResult | null;
  /** Optional capability manifest describing callable tools/contracts */
  capabilities?: CapabilityManifest;
}

/**
 * World state provided by a pack
 */
export interface WorldState {
  /** Current simulated timestamp */
  timestamp: number;
  /** Protocol-specific state */
  [key: string]: unknown;
}

/**
 * Hex address type (0x-prefixed string)
 */
export type Address = `0x${string}`;

/**
 * Configuration for funding agents with tokens
 * Projects implement this to define how agents receive initial balances
 *
 * This interface is protocol-agnostic - each project defines their own
 * token address and funding method based on their protocol's requirements.
 *
 * @example
 * // Transfer from treasury (most common)
 * const funding: FundingConfig = {
 *   tokenAddress: '0x...',
 *   amountPerAgent: parseEther('10000'),
 *   method: 'transfer',
 *   treasuryAddress: '0x...',
 * };
 *
 * @example
 * // Mint tokens (if protocol allows)
 * const funding: FundingConfig = {
 *   tokenAddress: '0x...',
 *   amountPerAgent: parseEther('10000'),
 *   method: 'mint',
 * };
 *
 * @example
 * // Custom funding logic
 * const funding: FundingConfig = {
 *   amountPerAgent: parseEther('10000'),
 *   method: 'custom',
 *   customFunder: async (toAddress, amount, wallet) => {
 *     // Custom implementation
 *   },
 * };
 */
export interface FundingConfig {
  /** Token address to fund agents with (project-specific) */
  tokenAddress?: Address;

  /** Amount per agent (in token's smallest unit, e.g., wei) */
  amountPerAgent: bigint;

  /** Funding method: 'transfer' from treasury, 'mint' if allowed, or 'custom' */
  method: 'transfer' | 'mint' | 'custom';

  /** For 'transfer': address holding tokens to distribute */
  treasuryAddress?: Address;

  /**
   * For 'custom': project provides implementation
   * @param toAddress - Address to fund
   * @param amount - Amount to fund
   * @param deployerWallet - Wallet client for the deployer (for signing transactions)
   */
  customFunder?: (toAddress: Address, amount: bigint, deployerWallet: unknown) => Promise<void>;
}

/**
 * A Pack provides protocol-specific bindings
 */
export interface Pack {
  /** Pack name */
  name: string;

  /** Initialize the pack (deploy contracts, set up state) */
  initialize(): Promise<void>;

  /** Called at the start of each tick to update state */
  onTick?(tick: number, timestamp: number): void;

  /** Set the current agent context for world state queries */
  setCurrentAgent?(agentId: string): void;

  /** Get current world state */
  getWorldState(): WorldState;

  /** Execute an action and return the result */
  executeAction(action: Action, agentId: string): Promise<ActionResult>;

  /** Optional read-only RPC call support for exploration features */
  callRpc?(method: string, params?: unknown[]): Promise<unknown>;

  /** Optional list of scenario-deployed contracts for allowlist checks */
  getDeployedContracts?(): string[];
  /** Optional rich capability manifest for LLM/tooling context */
  getCapabilityManifest?(agentId?: string): CapabilityManifest;

  /** Get metrics for the current state */
  getMetrics(): Record<string, number | bigint | string>;

  /** Clean up resources */
  cleanup(): Promise<void>;

  /**
   * Register an agent and optionally fund them
   * Returns the agent's wallet address
   *
   * Projects implement this to:
   * 1. Create a wallet for the agent (from HD derivation or Anvil accounts)
   * 2. Fund the agent with native currency (ETH) if needed
   * 3. Fund the agent with protocol tokens using fundAgent()
   *
   * @param agentId - Unique identifier for the agent
   * @returns The agent's wallet address
   */
  registerAgent?(agentId: string): Promise<Address>;

  /**
   * Fund an agent with project-specific tokens
   * Projects implement this based on their FundingConfig
   *
   * This method is protocol-agnostic - each project defines what "funding" means
   * for their protocol (e.g., ELTA for Elata, DAI for MakerDAO, etc.)
   *
   * @param agentId - Unique identifier for the agent
   * @param config - Funding configuration (token, amount, method)
   */
  fundAgent?(agentId: string, config: FundingConfig): Promise<void>;
}

/**
 * Scenario configuration
 */
export interface Scenario {
  /** Scenario name */
  name: string;
  /** Random seed for deterministic runs */
  seed: number;
  /** Number of ticks to simulate */
  ticks: number;
  /** Simulated seconds per tick */
  tickSeconds: number;
  /** Pack to use for the simulation */
  pack: Pack;
  /** Agents participating in the simulation */
  agents: AgentConfig[];
  /** Metrics configuration */
  metrics?: MetricsConfig;
  /** Optional assertions to validate at the end */
  assertions?: Assertion[];
  /** Probes for custom metric sampling */
  probes?: ProbeConfig[];
  /** Sample probes every N ticks (default: same as metrics) */
  probeEveryTicks?: number;
  /** Checkpoint configuration */
  checkpoints?: CheckpointConfig;
  /** Optional gossip configuration */
  gossip?: GossipConfig;
  /** Optional scheduled events injected into the run */
  schedule?: ScheduledEvent[];
  /** Optional query configuration */
  query?: QueryConfig;
  /** Optional replay settings */
  replay?: ReplayConfig;
  /** Optional smoke testing configuration */
  smoke?: SmokeTestConfig;
  /** Optional exploration policy settings */
  exploration?: ExplorationConfig;
  /**
   * Optional Studio/report configuration.
   *
   * This is consumed by Studio and `forge-sim dashboard` for report dashboards.
   * The shape is validated by Studio zod schemas (kept out of core types to avoid cycles).
   */
  studio?: { report?: unknown };
}

/**
 * Agent configuration within a scenario
 */
export interface AgentConfig {
  /** Agent class/constructor */
  type: new (
    id: string,
    params?: Record<string, unknown>
  ) => import('./agent.js').BaseAgent;
  /** Number of agents of this type to create */
  count: number;
  /** Parameters to pass to agent constructor */
  params?: Record<string, unknown>;
}

/**
 * Metrics collection configuration
 */
export interface MetricsConfig {
  /** Sample metrics every N ticks */
  sampleEveryTicks: number;
  /** Specific metrics to track */
  track?: string[];
  /**
   * Emit probe samples into metrics.csv as additional columns.
   *
   * Default: 'none' (probes are still available for checkpoints and other artifacts).
   */
  probeEmitMode?: 'none' | 'selected' | 'all';
  /**
   * Probe names to emit when probeEmitMode='selected'.
   */
  emitProbes?: string[];
}

/**
 * Probe configuration for custom metric sampling
 */
export interface ProbeConfig {
  /** Unique name for this probe */
  name: string;
  /** Probe type */
  type: 'call' | 'balance' | 'computed';
  /** Probe-specific configuration */
  config: ProbeCallConfig | ProbeBalanceConfig | ProbeComputedConfig;
}

/**
 * Call probe - execute a view function
 */
export interface ProbeCallConfig {
  /** Contract address or role identifier */
  target: string;
  /** Function name or selector */
  method: string;
  /** Arguments to pass */
  args?: unknown[];
}

/**
 * Balance probe - track token/ETH balances
 */
export interface ProbeBalanceConfig {
  /** Token address (omit for native ETH) */
  token?: string;
  /** Addresses or role identifiers to track */
  addresses: string[];
}

/**
 * Computed probe - derive from other probes or pack state
 */
export interface ProbeComputedConfig {
  /** Function to compute the probe value */
  compute: (pack: Pack, probeValues: Record<string, unknown>) => number | bigint | string;
}

/**
 * Checkpoint configuration
 */
export interface CheckpointConfig {
  /** Create checkpoints every N ticks */
  everyTicks: number;
  /** Include agent memory in checkpoints */
  includeAgentMemory?: boolean;
  /** Include full probe values */
  includeProbes?: boolean;
}

/**
 * An assertion to validate at the end of a run
 */
export interface Assertion {
  /** Assertion type */
  type: 'gte' | 'lte' | 'eq' | 'gt' | 'lt' | 'neq';
  /** Metric name to check */
  metric: string;
  /** Expected value */
  value: number | string;
  /** Optional custom message for the assertion */
  message?: string;
}

/**
 * Options for running a scenario
 */
export interface RunOptions {
  /** Override seed from scenario */
  seed?: number;
  /** Override ticks from scenario */
  ticks?: number;
  /** Override tick seconds from scenario */
  tickSeconds?: number;
  /** Output directory for artifacts */
  outDir?: string;
  /** CI mode (no colors, strict exit codes) */
  ci?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Run mode */
  mode?: RunMode;
  /** Optional replay bundle path for Mode C */
  replayBundlePath?: string;
  /** Optional suffix appended to the runId (useful for sweeps/matrices in CI) */
  runIdSuffix?: string;
  /** Optional live websocket event stream (best-effort; does not affect determinism) */
  live?: boolean;
  /** Host/interface for the live websocket server (default: 127.0.0.1) */
  liveHost?: string;
  /** Port for the live websocket server (default: 8787) */
  livePort?: number;
  /**
   * Agent memory capture to `agent_memory.ndjson`.
   *
   * This is an artifacts/observability feature; it does not affect simulation determinism.
   */
  memoryCapture?: MemoryCaptureConfig;
}

export type MemoryCaptureConfig = {
  enabled: boolean;
  /** Capture every N ticks (default: 1) */
  sampleEveryTicks: number;
  /**
   * Max bytes for a single snapshot record (default: 262144). Use null to disable truncation.
   * Note: this is measured on the JSON stringified record.
   */
  maxBytesPerRecord: number | null;
};

/**
 * Result of a simulation run
 */
export interface RunResult {
  /** Run identifier */
  runId: string;
  /** Scenario name */
  scenarioName: string;
  /** Seed used */
  seed: number;
  /** Number of ticks executed */
  ticks: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Whether all assertions passed */
  success: boolean;
  /** Failed assertions */
  failedAssertions: FailedAssertion[];
  /** Final metrics snapshot */
  finalMetrics: Record<string, number | bigint | string>;
  /** Per-agent statistics */
  agentStats: AgentStats[];
  /** Path to output directory */
  outputDir: string;
  /** Optional replay bundle path if generated */
  replayBundlePath?: string;
  /** Divergence result when running in replay mode against a v2 bundle */
  replayDivergence?: ReplayDivergenceResult;
}

/**
 * A failed assertion
 */
export interface FailedAssertion {
  assertion: Assertion;
  actualValue: number | string;
  message: string;
}

/**
 * Statistics for a single agent
 */
export interface AgentStats {
  id: string;
  type: string;
  actionsAttempted: number;
  actionsSucceeded: number;
  actionsFailed: number;
}

/**
 * Recorded action for logging
 */
export interface RecordedAction {
  tick: number;
  timestamp: number;
  agentId: string;
  agentType: string;
  action: Action | null;
  result: ActionResult | null;
  durationMs: number;
}

/**
 * Metrics sample at a point in time
 */
export interface MetricsSample {
  tick: number;
  timestamp: number;
  metrics: Record<string, number | bigint | string>;
}

export type RunMode = 'deterministic' | 'exploration' | 'replay';

export interface QueryBudget {
  maxQueriesPerTick: number;
  maxCostPerTick: number;
  maxBytesPerTick: number;
}

export interface QueryRequest {
  endpoint: string;
  params?: Record<string, unknown>;
}

export interface QueryResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  bytes: number;
  cost: number;
  truncated?: boolean;
}

export interface QueryEndpoint {
  name: string;
  cost: number;
  maxResponseBytes?: number;
  priority?: 'low' | 'normal' | 'high';
  handler: (params: Record<string, unknown> | undefined, world: WorldState) => unknown;
}

export interface QueryContext {
  query: (request: QueryRequest) => QueryResult;
  budget: QueryBudgetState;
}

export interface QueryBudgetState {
  usedQueries: number;
  usedCost: number;
  usedBytes: number;
  remainingQueries: number;
  remainingCost: number;
  remainingBytes: number;
}

export interface QueryConfig {
  defaultBudget: QueryBudget;
  endpoints?: QueryEndpoint[];
  indexingDelayTicks?: number;
  redactWorldKeys?: string[];
  noisyWorldKeys?: string[];
  noiseSigma?: number;
}

export interface CapabilityContract {
  alias: string;
  address?: string;
  description?: string;
  callable?: Array<{
    kind: 'view' | 'write' | 'rpc';
    name: string;
    args?: string[];
    notes?: string;
  }>;
}

export interface CapabilityActionTemplate {
  name: string;
  description: string;
  exampleParams: Record<string, unknown>;
}

export interface CapabilityManifest {
  version: 'v1';
  generatedAtTick?: number;
  mode?: RunMode;
  tools: string[];
  queryEndpoints: Array<{ name: string; cost: number; maxResponseBytes?: number }>;
  contracts: CapabilityContract[];
  actionTemplates: CapabilityActionTemplate[];
}

export type GossipChannelType = 'global' | 'topic' | 'dm' | 'group';

export interface GossipChannel {
  id: string;
  type: GossipChannelType;
  members?: string[];
  /** Optional per-channel post cooldown, enforced across ticks */
  postCooldownTicks?: number;
  /** Clamp credibilityPrior into [min,max] for this channel */
  minCredibilityPrior?: number;
  maxCredibilityPrior?: number;
}

export type AudienceSpec =
  | { type: 'public' }
  | { type: 'agents'; agentIds: string[] }
  | { type: 'channel'; channelId: string };

export interface MessageEnvelope {
  id: string;
  tick: number;
  authorAgentId: string;
  channelId: string;
  audience: AudienceSpec;
  costPaid: number;
  credibilityPrior: number;
  payloadHash: string;
}

export interface MessagePayload {
  text: string;
  attachments?: Record<string, unknown>;
}

export interface GossipMessage {
  envelope: MessageEnvelope;
  payload: MessagePayload;
}

export interface DeliveryEvent {
  tick: number;
  messageId: string;
  recipientAgentId: string;
}

export interface GossipBudgets {
  maxPostsPerTick: number;
  maxPostCostPerTick: number;
  maxMessagesReadPerTick: number;
  maxCharsReadPerTick: number;
}

export interface GossipContext {
  readInbox: (agentId: string) => GossipMessage[];
  postMessage: (
    agentId: string,
    channelId: string,
    payload: MessagePayload,
    options?: Partial<
      Omit<MessageEnvelope, 'id' | 'tick' | 'authorAgentId' | 'channelId' | 'payloadHash'>
    >
  ) => { ok: boolean; error?: string; messageId?: string };
}

export interface GossipConfig {
  channels: GossipChannel[];
  budgets: GossipBudgets;
  defaultLatencyTicks?: number;
  dropRate?: number;
  paraphraseRate?: number;
}

export type ScheduledEventType =
  | 'info_event'
  | 'assumption_update'
  | 'gossip_inject'
  | 'world_overlay'
  | 'world_overlay_clear';

export interface ScheduledEvent {
  tick: number;
  type: ScheduledEventType;
  payload: Record<string, unknown>;
}

export interface ReplayActionRecord {
  tick: number;
  agentId: string;
  action: Action | null;
  result?: ActionResult;
  metricsSnapshot?: Record<string, number>;
}

export interface ReplayMessageRecord {
  tick: number;
  message: GossipMessage;
}

export interface ReplayQueryRecord {
  tick: number;
  agentId: string;
  request: QueryRequest;
  result: QueryResult;
}

export interface ReplayArbitraryExecutionRecord {
  tick: number;
  agentId: string;
  kind: 'tx' | 'rpc';
  intent: ArbitraryTxIntent | RpcCallIntent;
  result: { ok: boolean; response?: unknown; error?: string };
}

export interface ReplayBundle {
  version: 'v1' | 'v2';
  scenarioName: string;
  seed: number;
  mode: RunMode;
  actions: ReplayActionRecord[];
  messages: ReplayMessageRecord[];
  queries: ReplayQueryRecord[];
  arbitraryExecutions: ReplayArbitraryExecutionRecord[];
}

export interface ReplayDivergenceResult {
  overallScore: number;
  tickDivergences: TickDivergence[];
}

export interface TickDivergence {
  tick: number;
  actionDivergences: ActionDivergence[];
  metricsDelta: Record<string, { baseline: number; replay: number; pctChange: number }>;
}

export interface ActionDivergence {
  agentId: string;
  actionName: string;
  baselineOk: boolean;
  replayOk: boolean;
  score: number;
}

export interface ReplayConfig {
  enabled?: boolean;
}

export interface AssumptionPatch {
  key: string;
  value: unknown;
}

export interface SmokeCheckpointConfig {
  tick: number;
  perturbations: AssumptionPatch[];
  branchTicks: number;
}

export interface SmokeDivergenceResult {
  checkpointTick: number;
  perturbation: AssumptionPatch;
  divergenceScore: number;
  baselineMetrics: Record<string, number | bigint | string>;
  perturbedMetrics: Record<string, number | bigint | string>;
}

export interface SmokeTestConfig {
  checkpoints: SmokeCheckpointConfig[];
}

export interface ActionValidationContext {
  mode: RunMode;
  world: WorldState;
}

export type ActionValidator = (
  action: Action,
  context: ActionValidationContext
) => { ok: boolean; error?: string };

export interface ActionValidatorRegistry {
  register: (actionName: string, validator: ActionValidator) => void;
  validate: (action: Action, context: ActionValidationContext) => { ok: boolean; error?: string };
}

export interface ArbitraryTxIntent {
  to: string;
  data: string;
  value?: string;
}

export interface RpcCallIntent {
  method: string;
  params?: unknown[];
}

export interface ExplorationAllowlistPolicy {
  allowedContracts: string[];
  allowedRpcMethods: string[];
}

export interface ExplorationConfig {
  allowArbitraryExecution?: boolean;
  allowlist?: ExplorationAllowlistPolicy;
  autonomousRpcPolicy?: 'strict' | 'aggressive';
  disableAutonomousRpc?: boolean;
}
