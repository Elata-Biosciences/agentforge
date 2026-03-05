<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="logo-light.svg">
    <img alt="AgentForge - Agent-based simulation framework for Foundry and EVM smart contracts" src="logo-light.svg" width="560">
  </picture>
</p>

<p align="center">
  <strong>Adversarial, agent-based simulation of EVM mechanisms — stress-test your protocol before mainnet does it for you.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@elata-biosciences/agentforge"><img src="https://img.shields.io/npm/v/@elata-biosciences/agentforge?color=orange" alt="npm version"></a>
  <a href="https://github.com/Elata-Biosciences/agentforge/actions/workflows/ci.yml"><img src="https://github.com/Elata-Biosciences/agentforge/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <img src="docs/screenshots/studio-home.png" alt="AgentForge Studio — Bloomberg-style simulation dashboard" width="820">
</p>
<p align="center"><em>AgentForge Studio — real-time simulation dashboard with financial charts, gossip analysis, and ML tooling</em></p>

---

AgentForge simulates how your protocol behaves when many autonomous agents — traders, arbitrageurs, liquidators, LLM-driven strategists — act simultaneously with competing strategies over time. It fills the gap between isolated unit tests and production:

| Layer | Tests | Example |
|-------|-------|---------|
| Unit tests | Individual functions | `test_transfer()` |
| Fuzz tests | Random inputs | `testFuzz_transfer(uint256 amount)` |
| **AgentForge** | **Multi-actor emergent behavior** | **Traders, arbitrageurs, liquidators competing** |
| Mainnet | Real users | Production |

## See It In Action

The [Uniswap v4 AgentForge Demo](https://github.com/wkyleg/v4-core/tree/main/sim/agentforge-demo) demonstrates AgentForge integrated into a fork of the Uniswap v4 protocol. It includes:

- Deterministic and LLM-driven agent strategies for Uniswap v4 pools
- Multi-action agents that trade and communicate within the same tick
- Strategy channels for LLM agent coordination
- Studio dashboards with financial charts, gossip analysis, and ML tooling

> **[See all Studio screenshots](docs/studio-screenshots.md)** — Overview, Timeline, Gossip, Report, Data, and Docs tabs.

## Quick Start

```bash
# Install
pnpm add @elata-biosciences/agentforge

# Scaffold a simulation folder
npx forge-sim init

# Run the built-in toy scenario
npx forge-sim run --toy

# Launch the Studio dashboard
npx forge-sim studio
```

Requirements: Node.js 18+ and optionally [Foundry](https://book.getfoundry.sh/getting-started/installation) with Anvil for EVM simulations.

## Writing Your First Agent

**1. Define an agent** that observes state and decides actions each tick:

```typescript
import { BaseAgent, type Action, type TickContext } from '@elata-biosciences/agentforge';

export class MyTrader extends BaseAgent {
  async step(ctx: TickContext): Promise<Action | Action[] | null> {
    if (ctx.rng.chance(0.3)) {
      return {
        id: this.generateActionId('buy', ctx.tick),
        name: 'buy',
        params: { amount: ctx.rng.nextInt(1, 100), asset: 'TOKEN' },
      };
    }
    return null;
  }
}
```

**2. Define a scenario** that wires agents together:

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

**3. Run it:**

```bash
npx forge-sim run sim/scenarios/market-stress.ts --seed 42
```

**4. Inspect results** — every run produces durable artifacts:

```
results/market-stress-ci/
├── summary.json          # Run metadata, final metrics, assertion results
├── metrics.csv           # Time-series data for analysis
├── actions.ndjson        # Complete action log
├── gossip.ndjson         # Gossip posts/deliveries
├── config_resolved.json  # Resolved configuration for reproducibility
├── replay_bundle.json    # Exploration trace bundle for replay mode
└── report.md             # Generated report
```

**5. Launch Studio** for multi-run dashboards:

```bash
npx forge-sim studio
```

## Agents

Agents are autonomous actors with access to:

- `ctx.rng` — Deterministic random number generator
- `ctx.world` — Current protocol state
- `ctx.gossip` — Read/post gossip messages
- `ctx.capabilities` — Available contracts, tools, and action templates
- `this.remember()` / `this.recall()` — Persist state across ticks
- `this.setCooldown()` / `this.isOnCooldown()` — Rate-limit actions

### Multi-Action Support

Agents can return a single action, an array of up to 3 actions, or `null`. The engine executes each action in order within the same tick:

```typescript
async step(ctx: TickContext): Promise<Action | Action[] | null> {
  const trade = { id: this.generateActionId('swap', ctx.tick), name: 'u4_swap', params: { poolId: 'eth_usdc', side: 'buy_token0', amountIn: 1000 } };
  const note = { id: this.generateActionId('post', ctx.tick), name: 'PostMessage', params: { channelId: 'strategy', text: 'Bought ETH — expecting upward pressure' } };
  return [trade, note];
}
```

### Persona LLM Agents

`PersonaLlmAgentBase` provides a reusable base for persona-driven LLM agents with:

- Persona profile (id, style, goals, risk profile, tool preferences)
- Structured prompt assembly with full capability manifest context (contracts, tools, action templates)
- Two-stage OODA loop: plan then act, with fallback to single-shot action parsing
- Multi-action support — LLMs can return arrays of actions (e.g., trade + gossip)
- Schema-validated action intents via Zod (`LlmActionIntentSchema`, `LlmMultiActionSchema`)

```typescript
import { PersonaLlmAgentBase, type PersonaProfile } from '@elata-biosciences/agentforge';
```

## Gossip

The gossip bus enables bounded inter-agent communication:

- **Channels**: global broadcast or scoped strategy channels with membership lists
- **Free-form messages**: agents post text payloads with optional `credibilityPrior` scores
- **Budgets**: configurable `maxPostsPerTick` and `maxReadsPerTick` per agent
- **Trust primitives**: `credibilityPrior` (0-1) for information weighting and misinformation modeling
- **Cooldowns**: per-channel `postCooldownTicks` to rate-limit posting

```typescript
gossip: {
  channels: [
    { id: 'global', members: 'all' },
    { id: 'strategy', members: ['LlmAgent-0', 'LlmAgent-1'] },
  ],
  budgets: { maxPostsPerTick: 3, maxReadsPerTick: 10 },
}
```

Strategy channels are useful for LLM-only coordination without flooding deterministic agents.

## Studio Dashboard

`forge-sim studio` launches a Bloomberg Terminal-inspired dashboard for multi-run analysis:

- **Session management** — browse all runs, build/open dashboards, download artifacts
- **Financial charts** — interactive Lightweight Charts with zoom/pan and crosshair tooltips
- **Timeline inspector** — virtualized action log with JSON inspection popovers
- **Gossip analysis** — channel-level message flow, author tracking, delivery status
- **Agent stats** — per-agent action counts, success rates, and drill-down
- **ML toolkit** — server-side regression, PCA, k-means, and cross-run metric comparison
- **Keyboard-driven** — tab navigation, command palette, terminal aesthetic

## Determinism

Same seed + same scenario = identical results. All randomness derives from seeded RNG.

```bash
forge-sim run --toy --seed 123 --out run1 --ci
forge-sim run --toy --seed 123 --out run2 --ci
forge-sim compare run1/toy-market-ci run2/toy-market-ci
# Should report identical artifact hashes
```

## Packs

Packs are protocol adapters that set up world state and handle contract interactions. Implement the `Pack` interface to bridge AgentForge to your protocol.

## Mechanism Experiments

AgentForge is particularly useful for stress-testing mechanism designs. See `examples/mechanism-experiments/`:

- **Ordering Policy** (`ordering-tax/`): How does priority vs. random ordering affect searcher profits and user slippage?
- **Timing Advantage** (`timing-auction/`): How much advantage does a "fast actor" gain? Does commit-reveal mitigate it?

```bash
cd examples/mechanism-experiments/ordering-tax
npx forge-sim run scenario.ts --seed 42
```

## Reporting

```bash
forge-sim report <runDir>              # Generate Markdown report
forge-sim dashboard <runDir>           # Build static dashboard
forge-sim studio                       # Launch multi-run Studio
forge-sim serve <runDir>               # Serve dashboard over HTTP
forge-sim compare <runA> <runB>        # Diff two runs
forge-sim sweep <scenario> --seeds 1..50  # Multi-seed statistical analysis
forge-sim matrix <scenario>            # Multi-variant matrix comparison
```

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

Exit codes: `0` success, `1` assertion failure, `2` infrastructure error. See [docs/ci.md](docs/ci.md) for detailed recipes.

## CLI Reference

```bash
forge-sim init [path]              # Initialize simulation folder
forge-sim run <scenario>           # Execute a scenario
forge-sim run --toy                # Run built-in demo
forge-sim report <runDir>          # Generate report from artifacts
forge-sim dashboard <runDir>       # Generate static dashboard
forge-sim serve <runDir>           # Serve run dashboard over HTTP
forge-sim studio                   # Launch local Studio UI
forge-sim extract-agent <bundle>   # Generate deterministic agent from replay bundle
forge-sim compare <runA> <runB>    # Compare two runs
forge-sim sweep <scenario>         # Multi-seed statistical run
forge-sim matrix <scenario>        # Multi-variant matrix run
forge-sim doctor                   # Check dependencies
forge-sim types                    # Generate types from Foundry artifacts
```

<details>
<summary>Options for <code>run</code></summary>

```bash
--seed <n>           # Override random seed
--ticks <n>          # Override tick count
--out <dir>          # Output directory
--mode <mode>        # deterministic | exploration | replay
--replay-bundle <p>  # Replay bundle path for mode=replay
--capture-memory     # Persist agent memory snapshots
--live               # Enable live websocket event stream
--ci                 # CI mode (no colors, stable naming)
--verbose            # Verbose logging
--json               # Output results as JSON
```

Mode guidance:
- `deterministic`: no live LLM calls, best for baseline and CI checks
- `exploration`: LLM-enabled red-team discovery, produces `replay_bundle.json`
- `replay`: deterministic re-run of prior exploration traces against updated contracts

</details>

## Exploration/Replay Workflow

1. **Explore**: discover behaviors with LLM agents
2. **Capture**: `replay_bundle.json` records the full trace
3. **Replay**: deterministic regression against updated contracts

```bash
forge-sim run scenario.ts --mode exploration
forge-sim run scenario.ts --mode replay --replay-bundle results/run/replay_bundle.json
```

See [docs/llm-gossip-replay.md](docs/llm-gossip-replay.md) for provider config (OpenAI, Anthropic, DeepSeek, OpenRouter, Gemini).

### Autonomous RPC Policy (Exploration)

Exploration-mode `RpcCall` autonomy supports two policies:
- `strict` (default): requires explicit scenario allowlist
- `aggressive`: allows any non-empty RPC method when no explicit allowlist is configured

Controls: `exploration.autonomousRpcPolicy`, env override `AGENTFORGE_AUTONOMOUS_RPC_POLICY`, kill switch `AGENTFORGE_DISABLE_AUTONOMOUS_RPC=1`.

### Capability Manifest

Each `TickContext` can include a `capabilities` manifest with tool/query/contract metadata. Packs provide rich manifests via `getCapabilityManifest()` with contract addresses, callable functions, descriptions, and action templates.

## API Reference

```typescript
// Core
import { defineScenario, BaseAgent, SimulationEngine } from '@elata-biosciences/agentforge';
import type { Scenario, Action, TickContext, Pack, CapabilityManifest } from '@elata-biosciences/agentforge';

// LLM agents
import { PersonaLlmAgentBase, type PersonaProfile } from '@elata-biosciences/agentforge';
import { LlmActionIntentSchema, LlmMultiActionSchema } from '@elata-biosciences/agentforge';

// Adapters
import { spawnAnvil, createViemClient } from '@elata-biosciences/agentforge/adapters';

// Toy simulation
import { ToyPack, RandomTraderAgent, MomentumAgent } from '@elata-biosciences/agentforge/toy';
```

## Documentation

- [Core Concepts](docs/concepts.md) — Scenarios, agents, ticks, packs, determinism
- [CLI Reference](docs/cli.md) — Full command/option coverage
- [CI Integration](docs/ci.md) — GitHub Actions, GitLab CI, exit codes
- [Reporting](docs/reporting.md) — Report, compare, and sweep commands
- [LLM/Gossip Workflow](docs/llm-gossip-replay.md) — Exploration, replay, gossip channels, and trust primitives
- [Portability](docs/portability.md) — Using AgentForge in other repos
- [Competitive Landscape](docs/landscape.md) — How AgentForge complements Foundry/Echidna

## Examples

- `examples/basic-simulation/` — Minimal setup with ToyPack
- `examples/custom-agent/` — Memory, cooldowns, and parameterized behavior
- `examples/assertions/` — Assertion validation patterns
- `examples/metrics-tracking/` — CSV analysis and statistics
- `examples/mechanism-experiments/` — Ordering and timing experiments
- [Uniswap v4 Fork Demo](https://github.com/wkyleg/v4-core/tree/main/sim/agentforge-demo) — Integration demo with deterministic + LLM agents

## Demo Integrations

- [Uniswap v4 Fork](https://github.com/wkyleg/v4-core/tree/main/sim/agentforge-demo) — Agent-based simulation of v4 pool mechanisms (community demo)
- [Elata Protocol](https://github.com/Elata-Biosciences/elata-protocol) — App launchpad with bonding curves

## Roadmap

- **Replay minimization**: shrink failing replay bundles to minimal reproductions
- **Extended ordering policies**: custom ordering, bundle simulation
- **Richer Studio analytics**: larger-run workflows and stronger cross-run slicing

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
