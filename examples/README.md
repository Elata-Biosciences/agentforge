# AgentForge Examples

This directory contains example scenarios demonstrating various AgentForge features. Each example is self-contained and can be run directly.

## Quick Start

Run any example with:

```bash
# Using the CLI
npx forge-sim run examples/<example-name>/scenario.ts

# Or directly with tsx
npx tsx examples/<example-name>/scenario.ts
```

---

## Examples Overview

| Example | Description | Key Concepts |
|---------|-------------|--------------|
| [basic-simulation](#1-basic-simulation) | Minimal setup with built-in agents | Scenarios, ToyPack, metrics |
| [custom-agent](#2-custom-agent) | Create custom agent behaviors | Memory, cooldowns, parameters |
| [assertions](#3-assertions) | Validate simulation outcomes | All assertion types, CI testing |
| [metrics-tracking](#4-metrics-tracking) | Detailed metrics and analysis | CSV export, statistics |
| [llm-gossip](#5-llm--gossip-canonical) | Real-provider gossip workflow | exploration/replay modes, gossip observability |

---

## 1. Basic Simulation

**Path:** `basic-simulation/`

A minimal simulation setup using the built-in toy market pack and standard agent types. This is the best place to start.

```bash
npx forge-sim run examples/basic-simulation/scenario.ts
```

**What it demonstrates:**

- Defining a scenario with `defineScenario()`
- Configuring the `ToyPack` with multiple assets
- Using built-in agents:
  - `RandomTraderAgent` — Random buy/sell decisions
  - `MomentumAgent` — Trend-following behavior
  - `HolderAgent` — Minimal trading activity
- Basic metrics configuration
- Simple assertions for validation

**Key code snippet:**

```typescript
const scenario = defineScenario({
  name: 'basic-simulation',
  seed: 42,           // Deterministic randomness
  ticks: 50,          // 50 simulation steps
  tickSeconds: 3600,  // 1 hour per tick

  pack: new ToyPack({
    assets: [
      { name: 'TOKEN', initialPrice: 100, volatility: 0.03 },
    ],
    initialCash: 10000,
  }),

  agents: [
    { type: RandomTraderAgent, count: 5 },
    { type: MomentumAgent, count: 3 },
  ],
});
```

---

## 2. Custom Agent

**Path:** `custom-agent/`

Learn how to create custom agents with advanced features like memory, cooldowns, and parameterized behavior.

```bash
npx forge-sim run examples/custom-agent/scenario.ts
```

**What it demonstrates:**

- Extending `BaseAgent` to create custom agents
- **Memory persistence** — Store and retrieve state between ticks:
  ```typescript
  this.remember('priceHistory', prices);
  const history = this.recall<number[]>('priceHistory', []);
  ```
- **Cooldowns** — Prevent action spam:
  ```typescript
  if (this.isOnCooldown('trade', ctx.tick)) return null;
  this.setCooldown('trade', 5, ctx.tick);  // 5 tick cooldown
  ```
- **Parameters** — Configure agent behavior from scenario:
  ```typescript
  const size = this.getParam('tradeSize', 50);  // default 50
  ```
- Accessing world state for decision-making
- Using deterministic RNG (`ctx.rng`)

**Custom agents included:**

| Agent | Behavior |
|-------|----------|
| `TrendFollowerAgent` | Tracks price history, buys on uptrends, sells on downtrends |
| `ContrarianAgent` | Does the opposite of the trend (mean reversion) |
| `ScheduledTraderAgent` | Only trades on specific tick numbers |

---

## 3. Assertions

**Path:** `assertions/`

How to use assertions to validate simulation outcomes and integrate with CI pipelines.

```bash
npx forge-sim run examples/assertions/scenario.ts
```

**What it demonstrates:**

- All assertion types:
  - `gt` — Greater than
  - `gte` — Greater than or equal
  - `lt` — Less than
  - `lte` — Less than or equal
  - `eq` — Exactly equal (use with caution for floats)
- Multiple assertions on different metrics
- Assertion failure handling and exit codes
- CI-friendly validation

**Assertion examples:**

```typescript
assertions: [
  { type: 'gt', metric: 'totalVolume', value: 0 },       // Must have trades
  { type: 'lt', metric: 'price_TOKEN', value: 500 },     // Price cap
  { type: 'gte', metric: 'totalAgentValue', value: 0 },  // No bankruptcy
]
```

**CI integration:**

```yaml
- name: Run simulation tests
  run: npx forge-sim run examples/assertions/scenario.ts --ci
  # Exit code 0 = all assertions pass
  # Exit code 1 = assertion failures
```

---

## 4. Metrics Tracking

**Path:** `metrics-tracking/`

Detailed metrics collection, CSV export, and statistical analysis.

```bash
npx forge-sim run examples/metrics-tracking/scenario.ts
```

**What it demonstrates:**

- Configuring metrics sampling frequency
- Tracking specific metrics
- Reading and parsing CSV output
- Calculating statistics (min, max, avg, change)
- Visualizing price trajectories

**Metrics configuration:**

```typescript
metrics: {
  sampleEveryTicks: 1,  // Record every tick
  track: [              // Specific metrics to track
    'price_TOKEN',
    'totalVolume',
    'totalAgentValue',
  ],
}
```

**Output analysis:**

The example shows how to:
1. Read the generated `metrics.csv`
2. Parse time-series data
3. Calculate statistics per metric
4. Display ASCII price charts

---

## 5. LLM + Gossip (Canonical)

**Path:** `llm-gossip/`

Canonical reference for real-provider LLM runs with gossip messages and deterministic fallback mode.

```bash
# Non-deterministic, live provider behavior
npx forge-sim run examples/llm-gossip/scenario.ts --mode exploration

# Deterministic baseline (no live provider calls)
npx forge-sim run examples/llm-gossip/scenario.ts --mode deterministic
```

**What it demonstrates:**

- Exploration mode with real provider-generated gossip
- Deterministic/replay-safe fallback messaging
- Gossip inspection in Studio (Gossip tab + Agent Inspector)
- Notebook-style report blocks for run interpretation

---

## Output Structure

Each example writes artifacts to its own `results/` directory:

```
examples/<name>/results/
├── summary.json          # Run metadata, final metrics, assertion results
├── metrics.csv           # Time-series data for analysis
├── actions.ndjson        # Every action taken (newline-delimited JSON)
├── config_resolved.json  # Final resolved configuration
├── replay_bundle.json    # Exploration traces (mode=exploration)
├── gossip.ndjson         # Gossip bus artifacts (if enabled)
└── agent_memory.ndjson   # Agent memory snapshots (if capture enabled)
```

### summary.json

```json
{
  "runId": "basic-simulation-ci",
  "scenarioName": "basic-simulation",
  "seed": 42,
  "ticks": 50,
  "success": true,
  "durationMs": 234,
  "finalMetrics": {
    "totalVolume": 15234.56,
    "price_TOKEN": 102.34
  }
}
```

### metrics.csv

```csv
tick,timestamp,price_TOKEN,totalVolume
0,1706400000,100.00,0.00
1,1706403600,101.23,543.21
2,1706407200,99.87,1205.67
```

---

## Creating Your Own

Use these examples as templates:

1. **Copy an example directory:**
   ```bash
   cp -r examples/basic-simulation my-scenario
   ```

2. **Modify the scenario:**
   - Change assets, agents, parameters
   - Add custom agents if needed
   - Define assertions for your invariants

3. **Run and iterate:**
   ```bash
   npx forge-sim run my-scenario/scenario.ts --verbose
   ```

4. **Analyze results:**
   - Check `summary.json` for metrics
   - Import `metrics.csv` into your analysis tool
   - Review `actions.ndjson` for agent behavior

---

## Tips

- **Reproducibility:** Same `seed` always produces identical results
- **Verbose mode:** Add `--verbose` to see detailed logs
- **CI mode:** Add `--ci` for stable paths and no colors
- **Override seed:** Use `--seed 12345` to test different scenarios
- **More ticks:** Use `--ticks 1000` for longer simulations

---

See the main [README](../README.md) for comprehensive documentation.
