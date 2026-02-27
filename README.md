<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="logo-light.svg">
    <img alt="AgentForge - Agent-based simulation framework for Foundry and EVM smart contracts" src="logo-light.svg" width="560">
  </picture>
</p>

<p align="center">
  <strong>AgentForge is a Foundry-native framework for adversarial, agent-based simulation of EVM mechanisms over time.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@elata-biosciences/agentforge"><img src="https://img.shields.io/npm/v/@elata-biosciences/agentforge?color=orange" alt="npm version"></a>
  <a href="https://github.com/Elata-Biosciences/agentforge/actions/workflows/ci.yml"><img src="https://github.com/Elata-Biosciences/agentforge/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

---

> **Note**: AgentForge is currently in alpha. APIs may change and you may encounter bugs.

## What It Complements

| Layer | Tests | Example |
|-------|-------|---------|
| Unit tests | Individual functions | `test_transfer()` |
| Fuzz tests | Random inputs | `testFuzz_transfer(uint256 amount)` |
| **AgentForge** | **Multi-actor emergent behavior** | **Traders, arbitrageurs, liquidators competing** |
| Mainnet | Real users | Production |

AgentForge fills the gap between isolated tests and production by simulating how your protocol behaves when many autonomous agents act simultaneously with different strategies over time.

## What You Get

Each simulation run produces durable artifacts:

```
results/<scenario>-<timestamp>/
├── summary.json          # Run metadata, final metrics, assertion results
├── metrics.csv           # Time-series data for analysis
├── actions.ndjson        # Complete action log
├── config_resolved.json  # Resolved configuration for reproducibility
├── replay_bundle.json    # Exploration trace bundle for replay mode
├── smoke_results.json    # Assumption perturbation divergence outputs (optional)
└── report.md             # Generated report (optional)
```

Plus reporting commands:
- `forge-sim report <runDir>` — Generate a Markdown report
- `forge-sim dashboard <runDir>` — Build a static dashboard folder for a run
- `forge-sim studio` — Launch multi-run Studio (sessions, paging, analytics)
- `forge-sim serve <runDir>` — Serve a generated dashboard over HTTP
- `forge-sim compare <runA> <runB>` — Diff two runs
- `forge-sim sweep <scenario> --seeds 1..50` — Multi-seed statistical analysis

## Installation

```bash
pnpm add @elata-biosciences/agentforge
```

Requirements: Node.js 18+ and [Foundry](https://book.getfoundry.sh/getting-started/installation) with Anvil for EVM simulations.

## Quick Start

```bash
# Initialize project structure
npx forge-sim init

# Run built-in toy scenario to verify setup
npx forge-sim run --toy

# Check environment
npx forge-sim doctor
```

## Core Concepts

### Scenarios

A scenario defines simulation parameters: seed, duration, agents, and assertions.

```typescript
import { defineScenario } from '@elata-biosciences/agentforge';
import { ToyPack, RandomTraderAgent, MomentumAgent } from '@elata-biosciences/agentforge/toy';

export default defineScenario({
  name: 'market-stress',
  seed: 42,
  ticks: 100,
  tickSeconds: 3600,

  pack: new ToyPack({
    assets: [{ name: 'TOKEN', initialPrice: 100, volatility: 0.05 }],
    initialCash: 10000,
  }),

  agents: [
    { type: RandomTraderAgent, count: 10 },
    { type: MomentumAgent, count: 5, params: { threshold: 0.02 } },
  ],

  assertions: [
    { type: 'gt', metric: 'totalVolume', value: 0 },
    { type: 'gte', metric: 'successRate', value: 0.9 },
  ],
});
```

### Agents

Agents are autonomous actors that observe state and decide actions each tick.

```typescript
import { BaseAgent, type Action, type TickContext } from '@elata-biosciences/agentforge';

export class MyAgent extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | null> {
    // 30% chance to buy each tick
    if (ctx.rng.chance(0.3)) {
      return {
        id: this.generateActionId('buy', ctx.tick),
        name: 'buy',
        params: { amount: ctx.rng.nextInt(1, 100), asset: 'TOKEN' },
      };
    }
    return null; // Skip this tick
  }
}
```

Agents have access to:
- `ctx.rng` — Deterministic random number generator
- `ctx.world` — Current protocol state
- `this.remember()` / `this.recall()` — Persist state across ticks
- `this.setCooldown()` / `this.isOnCooldown()` — Rate-limit actions

### Packs

Packs are protocol adapters that set up blockchain state and handle contract interactions.

### Determinism

Same seed + same scenario = identical results. All randomness derives from seeded RNG.

```bash
# Verify determinism
forge-sim run --toy --seed 123 --out run1 --ci
forge-sim run --toy --seed 123 --out run2 --ci
forge-sim compare run1/toy-market-ci run2/toy-market-ci
# Should report identical artifact hashes
```

## Mechanism Experiments

AgentForge is particularly useful for stress-testing mechanism designs. See `examples/mechanism-experiments/` for runnable examples:

### Ordering Policy Experiments

Explore how transaction ordering affects value capture and leakage:

```bash
cd examples/mechanism-experiments/ordering-tax
npx forge-sim run scenario.ts --seed 42
```

Questions it helps answer:
- How does priority ordering vs. random ordering affect searcher profits?
- What is the user slippage distribution under different ordering regimes?
- How do tail outcomes change across ordering policies?

### Timing Advantage Experiments

Analyze how information timing affects auction outcomes:

```bash
cd examples/mechanism-experiments/timing-auction
npx forge-sim run scenario.ts --seed 42
```

Questions it helps answer:
- How much advantage does a "fast actor" gain from late information?
- Does commit-reveal mitigate timing advantages?
- What is the impact on seller revenue and bidder participation?

## Reporting

### Generate a Report

```bash
forge-sim report sim/results/stress-ci
```

Produces `report.md` with run metadata, KPI summary, time-series statistics, action analysis, and determinism fingerprint.

### Compare Runs

```bash
forge-sim compare baseline/stress-ci current/stress-ci
```

Produces `compare.md` with metadata diff, KPI deltas, and behavioral changes.

### Seed Sweep

```bash
forge-sim sweep sim/scenarios/stress.ts --seeds 1..50
```

Runs the scenario with 50 different seeds and produces aggregate statistics: percentiles (P05/P50/P95), tail risk analysis, and per-seed summary CSV.

## CI Integration

```yaml
- name: Run simulations
  run: npx forge-sim run sim/scenarios/stress.ts --ci --seed 42

- name: Upload artifacts
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: simulation-results
    path: sim/results/
```

Exit codes:
- `0` — Success (all assertions passed)
- `1` — Assertion failure
- `2` — Infrastructure error

See [docs/ci.md](docs/ci.md) for detailed CI recipes.

## CLI Reference

```bash
forge-sim init [path]              # Initialize simulation folder
forge-sim run <scenario>           # Execute a scenario
forge-sim run --toy                # Run built-in demo
forge-sim report <runDir>          # Generate report from artifacts
forge-sim dashboard <runDir>       # Generate static dashboard/ for a run
forge-sim serve <runDir>           # Serve run dashboard over HTTP
forge-sim studio                   # Launch local Studio UI
forge-sim extract-agent <bundle>   # Generate deterministic agent from replay_bundle.json
forge-sim compare <runA> <runB>    # Compare two runs
forge-sim sweep <scenario>         # Multi-seed statistical run
forge-sim matrix <scenario>        # Multi-variant matrix run and comparison report
forge-sim doctor                   # Check dependencies
forge-sim types                    # Generate types from Foundry artifacts
```

Options for `run`:
```bash
--seed <n>           # Override random seed
--ticks <n>          # Override tick count
--out <dir>          # Output directory
--mode <mode>        # deterministic | exploration | replay
--replay-bundle <p>  # Replay bundle path for mode=replay
--capture-memory     # Persist agent memory snapshots to agent_memory.ndjson
--live               # Enable live websocket event stream
--ci                 # CI mode (no colors, stable naming)
--verbose            # Verbose logging
--json               # Output results as JSON
```

Mode guidance:
- `deterministic`: no live LLM calls, best for baseline and CI checks
- `exploration`: LLM-enabled red-team discovery, produces `replay_bundle.json`
- `replay`: deterministic re-run of prior exploration traces against updated contracts

## Persona LLM Agents

`PersonaLlmAgentBase` provides a reusable base for persona-driven LLM agents with:
- persona profile (`id`, `style`, goals, risk profile, tool preferences)
- structured prompt assembly (persona + world + memory + capability manifest context)
- two-stage decision flow (plan -> action) with fallback to single-shot action parsing
- schema-validated action intents with optional persona metadata

Use it directly for custom agents, or subclass `LlmPolicyAgent` compatibility patterns.

```ts
import { PersonaLlmAgentBase, type PersonaProfile } from '@elata-biosciences/agentforge';
```

### Autonomous RPC Policy (Exploration)

Exploration-mode `RpcCall` autonomy supports two policies:
- `strict` (default): requires explicit scenario allowlist
- `aggressive`: allows any non-empty RPC method when no explicit allowlist is configured

Controls:
- scenario config: `exploration.autonomousRpcPolicy = 'strict' | 'aggressive'`
- env override: `AGENTFORGE_AUTONOMOUS_RPC_POLICY=strict|aggressive`
- kill switch: `AGENTFORGE_DISABLE_AUTONOMOUS_RPC=1`

Example:

```ts
exploration: {
  allowArbitraryExecution: true,
  autonomousRpcPolicy: 'aggressive',
  disableAutonomousRpc: false,
  allowlist: { allowedContracts: [], allowedRpcMethods: [] },
}
```

### Capability Manifest in Tick Context

Each `TickContext` can include a `capabilities` manifest (`version`, tools, query endpoints,
contracts, action templates). Packs can provide a rich manifest via `getCapabilityManifest()`;
otherwise AgentForge builds a conservative fallback manifest from known tools/query endpoints.

## API Reference

```typescript
// Core
import { defineScenario, BaseAgent, SimulationEngine } from '@elata-biosciences/agentforge';
import type { Scenario, Action, TickContext, Pack } from '@elata-biosciences/agentforge';

// Adapters
import { spawnAnvil, createViemClient } from '@elata-biosciences/agentforge/adapters';

// Toy simulation
import { ToyPack, RandomTraderAgent, MomentumAgent } from '@elata-biosciences/agentforge/toy';
```

## Documentation

- [Core Concepts](docs/concepts.md) — Scenarios, agents, ticks, packs, determinism
- [CLI Reference](docs/cli.md) — Full command/option coverage for every `forge-sim` command
- [CI Integration](docs/ci.md) — GitHub Actions, GitLab CI, exit codes
- [Reporting](docs/reporting.md) — Report, compare, and sweep commands
- [LLM/Gossip Workflow](docs/llm-gossip-replay.md) — Exploration, replay, and information diffusion
- [Portability](docs/portability.md) — Using AgentForge in other repos and with different LLM providers
- [Competitive Landscape](docs/landscape.md) — How AgentForge complements Foundry/Echidna and differs from dashboards

## Examples

- `examples/basic-simulation/` — Minimal setup with ToyPack
- `examples/custom-agent/` — Memory, cooldowns, and parameterized behavior
- `examples/assertions/` — Assertion validation patterns
- `examples/metrics-tracking/` — CSV analysis and statistics
- `examples/mechanism-experiments/` — Ordering and timing experiments

## Roadmap

- **Replay minimization**: shrink failing replay bundles to minimal reproductions
- **Extended ordering policies**: custom ordering, bundle simulation
- **Richer Studio analytics**: larger-run workflows and stronger cross-run slicing

## Used By

- [Elata Protocol](https://github.com/Elata-Biosciences/elata-protocol) — App launchpad with bonding curves

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
