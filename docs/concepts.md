# Core Concepts

This document explains the fundamental concepts in AgentForge.

## Scenario

A **Scenario** is the complete specification of a simulation run. It defines:

- **name**: Identifier for the scenario
- **seed**: Random seed for deterministic replay
- **ticks**: Number of discrete time steps to simulate
- **tickSeconds**: Simulated seconds per tick
- **pack**: Protocol adapter providing world state and action execution
- **agents**: List of agent types and counts
- **metrics**: Configuration for metric sampling
- **assertions**: Validations to run at end of simulation
- **probes**: Custom metric probes (optional)
- **checkpoints**: Checkpoint configuration (optional)
- **gossip**: Communication channels and attention budgets (optional)
- **query**: Budgeted world-query endpoints (optional)
- **schedule**: Info and assumption events injected at configured ticks (optional)
- **smoke**: Assumption perturbation checkpoints and divergence outputs (optional)

```typescript
import { defineScenario } from '@elata-biosciences/agentforge';

export default defineScenario({
  name: 'market-stress',
  seed: 42,
  ticks: 100,
  tickSeconds: 3600,
  pack: new MyPack(),
  agents: [
    { type: TraderAgent, count: 10 },
    { type: ArbitrageAgent, count: 2 },
  ],
  assertions: [
    { type: 'gt', metric: 'totalVolume', value: 0 },
  ],
});
```

## Tick

A **Tick** is one discrete time step in the simulation. During each tick:

1. The pack is notified via `onTick(tick, timestamp)`
2. Agents are scheduled in a deterministic order
3. Each agent observes world state and decides an action
4. Actions are executed through the pack
5. Metrics are sampled (at configured intervals)
6. Checkpoints are written (if configured)

Tick timing is simulated, not real-time. The `tickSeconds` parameter controls how much simulated time passes between ticks.

## Agent

An **Agent** is an autonomous actor that participates in the simulation. Agents:

- Observe the world state each tick
- Make decisions based on their strategy
- Emit actions to be executed
- Maintain persistent memory across ticks
- Can use cooldowns to rate-limit actions

```typescript
import { BaseAgent, type Action, type TickContext } from '@elata-biosciences/agentforge';

export class MyAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | null> {
    // Access world state
    const price = ctx.world.price as number;
    
    // Use deterministic randomness
    if (ctx.rng.chance(0.3)) {
      return {
        id: this.generateActionId('buy', ctx.tick),
        name: 'buy',
        params: { amount: ctx.rng.nextInt(1, 100) },
      };
    }
    
    return null; // Skip this tick
  }
}
```

### Agent Features

- **Memory**: `this.remember(key, value)` / `this.recall(key)` - persist state across ticks
- **Cooldowns**: `this.setCooldown(action, ticks, currentTick)` - rate-limit actions
- **Parameters**: `this.getParam(key, default)` - access scenario-defined params

## Action

An **Action** is a command emitted by an agent to be executed by the pack:

```typescript
interface Action {
  id: string;      // Unique identifier (use generateActionId)
  name: string;    // Action type (e.g., 'buy', 'sell', 'stake')
  params: Record<string, unknown>;  // Action-specific parameters
  metadata?: Record<string, unknown>;
}
```

Actions are executed through `pack.executeAction()` and return an `ActionResult`:

```typescript
interface ActionResult {
  ok: boolean;          // Success or failure
  error?: string;       // Error message if failed
  events?: ActionEvent[];    // Emitted events
  balanceDeltas?: Record<string, bigint>;
  gasUsed?: bigint;
  txHash?: string;
}
```

## Pack

A **Pack** is a protocol adapter that bridges AgentForge to your specific smart contracts or simulation environment. It provides:

- **World State**: Current protocol state observable by agents
- **Action Execution**: Execute agent actions against the protocol
- **Metrics**: Protocol-specific metrics for analysis

```typescript
interface Pack {
  name: string;
  initialize(): Promise<void>;
  onTick?(tick: number, timestamp: number): void;
  getWorldState(): WorldState;
  executeAction(action: Action, agentId: string): Promise<ActionResult>;
  getMetrics(): Record<string, number | bigint | string>;
  cleanup(): Promise<void>;
}
```

## Ordering Policy

The **Ordering Policy** determines the sequence in which agents act each tick:

- **random** (default): Fisher-Yates shuffle using seeded RNG
- **round-robin**: Rotate starting position each tick
- **priority**: Order by priority function (higher first)

Ordering is deterministic given the same seed, ensuring reproducible results.

## Determinism

AgentForge guarantees **deterministic replay**: same seed + same scenario + same code = identical results.

This is achieved through:

1. **Seeded RNG**: All randomness derives from the scenario seed
2. **Tick-derived RNG**: Each tick gets a derived RNG
3. **Agent-derived RNG**: Each agent gets a per-tick derived RNG
4. **Deterministic Action IDs**: IDs use counters, not timestamps
5. **Deterministic Ordering**: Agent order is reproducible

### Exploration/Replay Workflow (Legacy "Mode C")

Some early notes call this "Mode C", but the preferred term is **exploration/replay workflow**.

This introduces a two-step workflow:

1. **Exploration run** records actions, message flows, and query traces into `replay_bundle.json`.
2. **Replay run** reuses that bundle and executes without live LLM calls.

This lets you discover exploit paths with exploratory policies and then regression-test those paths after contract changes.

You can verify determinism by comparing artifact hashes:

```bash
# Run twice with same seed
forge-sim run --toy --seed 123 --out run1 --ci
forge-sim run --toy --seed 123 --out run2 --ci

# Compare runs
forge-sim compare run1/toy-market-ci run2/toy-market-ci
# Should report "Artifact hashes are identical"
```

## Artifacts

Each simulation run produces durable artifacts in the output directory:

```
results/<scenario>-<timestamp>/
├── summary.json          # Run metadata, final metrics, assertion results
├── metrics.csv           # Time-series metrics data
├── actions.ndjson        # All agent actions (newline-delimited JSON)
├── config_resolved.json  # Resolved scenario configuration
├── report.md             # Generated report (if requested)
└── checkpoints/          # Checkpoint snapshots (if configured)
    ├── tick_00050.json
    └── tick_00100.json
```

### summary.json

Contains run metadata, final KPIs, agent statistics, and assertion results.

### metrics.csv

Time-series data with one row per sampled tick. Columns include tick number, timestamp, and all pack metrics.

### actions.ndjson

Every action taken by every agent, with results. One JSON object per line.

### config_resolved.json

The fully resolved scenario configuration, useful for reproducing runs.

## Probes

**Probes** are custom metric samplers that extend beyond pack-provided metrics:

```typescript
defineScenario({
  // ...
  probes: [
    {
      name: 'totalSupply',
      type: 'call',
      config: { target: 'token', method: 'totalSupply' },
    },
    {
      name: 'tvlRatio',
      type: 'computed',
      config: {
        compute: (pack, probes) => {
          const tvl = pack.getMetrics().tvl as number;
          const supply = probes.totalSupply as number;
          return tvl / supply;
        },
      },
    },
  ],
  probeEveryTicks: 5,
});
```

## Checkpoints

**Checkpoints** capture simulation state at intervals for debugging:

```typescript
defineScenario({
  // ...
  checkpoints: {
    everyTicks: 50,
    includeAgentMemory: true,
    includeProbes: true,
  },
});
```

Checkpoints help identify when and where behavior changes during a simulation.
