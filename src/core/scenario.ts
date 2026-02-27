import type { BaseAgent } from './agent.js';
import type {
  Assertion,
  CheckpointConfig,
  ExplorationConfig,
  GossipConfig,
  MetricsConfig,
  Pack,
  ProbeConfig,
  QueryConfig,
  ReplayConfig,
  Scenario,
  ScheduledEvent,
  SmokeTestConfig,
} from './types.js';

/**
 * Options for defining a scenario
 */
export interface DefineScenarioOptions {
  /** Scenario name */
  name: string;
  /** Random seed for deterministic runs (default: 1337) */
  seed?: number;
  /** Number of ticks to simulate (default: 100) */
  ticks?: number;
  /** Simulated seconds per tick (default: 86400 = 1 day) */
  tickSeconds?: number;
  /** Pack to use for the simulation */
  pack: Pack;
  /** Agent configurations */
  agents: AgentDefinition[];
  /** Metrics configuration */
  metrics?: MetricsConfig;
  /** Assertions to validate at the end */
  assertions?: Assertion[];
  /** Probes for custom metric sampling */
  probes?: ProbeConfig[];
  /** Sample probes every N ticks (default: same as metrics) */
  probeEveryTicks?: number;
  /** Checkpoint configuration */
  checkpoints?: CheckpointConfig;
  /** Gossip configuration */
  gossip?: GossipConfig;
  /** Query configuration */
  query?: QueryConfig;
  /** Scheduled events */
  schedule?: ScheduledEvent[];
  /** Replay configuration */
  replay?: ReplayConfig;
  /** Smoke testing configuration */
  smoke?: SmokeTestConfig;
  /** Exploration configuration */
  exploration?: ExplorationConfig;
  /** Studio/report configuration */
  studio?: Scenario['studio'];
}

/**
 * Agent definition for scenario configuration
 */
export interface AgentDefinition {
  /** Agent class constructor */
  type: new (
    id: string,
    params?: Record<string, unknown>
  ) => BaseAgent;
  /** Number of agents of this type to create */
  count: number;
  /** Parameters to pass to each agent */
  params?: Record<string, unknown>;
}

/**
 * Default scenario values
 */
const DEFAULTS = {
  seed: 1337,
  ticks: 100,
  tickSeconds: 86400, // 1 day
  metrics: {
    sampleEveryTicks: 1,
  },
} as const;

/**
 * Define a simulation scenario with type-safe configuration
 *
 * @example
 * ```ts
 * const scenario = defineScenario({
 *   name: 'revenue_smoke',
 *   seed: 42,
 *   ticks: 200,
 *   pack: myPack,
 *   agents: [
 *     { type: TraderAgent, count: 10, params: { maxBuys: 5 } },
 *     { type: HolderAgent, count: 5 },
 *   ],
 * });
 * ```
 */
export function defineScenario(options: DefineScenarioOptions): Scenario {
  const {
    name,
    seed = DEFAULTS.seed,
    ticks = DEFAULTS.ticks,
    tickSeconds = DEFAULTS.tickSeconds,
    pack,
    agents,
    metrics = DEFAULTS.metrics,
    assertions = [],
    probes,
    probeEveryTicks,
    checkpoints,
    gossip,
    query,
    schedule,
    replay,
    smoke,
    exploration,
    studio,
  } = options;

  // Validate inputs
  if (!name || name.trim() === '') {
    throw new Error('Scenario name is required');
  }
  if (ticks <= 0) {
    throw new Error('Ticks must be positive');
  }
  if (tickSeconds <= 0) {
    throw new Error('Tick seconds must be positive');
  }
  if (agents.length === 0) {
    throw new Error('At least one agent configuration is required');
  }

  // Convert agent definitions to agent configs
  const agentConfigs = agents.map((def) => ({
    type: def.type,
    count: def.count,
    params: def.params ?? {},
  }));

  const base: Scenario = {
    name,
    seed,
    ticks,
    tickSeconds,
    pack,
    agents: agentConfigs,
    metrics,
    assertions,
  };
  return {
    ...base,
    ...(probes ? { probes } : {}),
    ...(probeEveryTicks !== undefined ? { probeEveryTicks } : {}),
    ...(checkpoints ? { checkpoints } : {}),
    ...(gossip ? { gossip } : {}),
    ...(query ? { query } : {}),
    ...(schedule ? { schedule } : {}),
    ...(replay ? { replay } : {}),
    ...(smoke ? { smoke } : {}),
    ...(exploration ? { exploration } : {}),
    ...(studio ? { studio } : {}),
  };
}

/**
 * Create a scenario from a TypeScript or JavaScript file path
 * Used by CLI to dynamically load scenarios
 *
 * For TypeScript files, this uses tsx to load the module.
 * @param path - File URL or path to the scenario file
 * @returns The loaded scenario
 */
export async function loadScenario(path: string): Promise<Scenario> {
  try {
    // Check if this is a TypeScript file
    const isTypeScript = path.endsWith('.ts') || path.includes('.ts?');

    let module: Record<string, unknown>;

    if (isTypeScript) {
      // Use tsx to load TypeScript files
      const { tsImport } = await import('tsx/esm/api');
      module = (await tsImport(path, import.meta.url)) as Record<string, unknown>;
    } else {
      // Use native import for JavaScript files
      module = await import(path);
    }

    // Check for default export
    if (module.default) {
      if (isScenario(module.default)) {
        return module.default;
      }
      throw new Error('Default export is not a valid Scenario');
    }

    // Check for named 'scenario' export
    if (module.scenario && isScenario(module.scenario)) {
      return module.scenario;
    }

    throw new Error('No valid scenario found in module');
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load scenario from ${path}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Type guard to check if an object is a valid Scenario
 */
function isScenario(obj: unknown): obj is Scenario {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const scenario = obj as Record<string, unknown>;

  return (
    typeof scenario.name === 'string' &&
    typeof scenario.seed === 'number' &&
    typeof scenario.ticks === 'number' &&
    typeof scenario.tickSeconds === 'number' &&
    typeof scenario.pack === 'object' &&
    Array.isArray(scenario.agents)
  );
}
